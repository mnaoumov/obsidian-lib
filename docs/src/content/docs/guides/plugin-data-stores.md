---
title: Plugin data stores
description: Device-local records, validated cache seeds, and mergeable shared plugin state.
---

Choose persistence by what the records mean. Device-specific state belongs in `LocalDataStore`. Expensive derived caches can use `DataStoreSeeds` to bootstrap another device, with per-file validation before reuse. Authoritative state that must survive concurrent device edits belongs in `SharedDataStore`.

## Moving out of `data.json`

A plugin's `data.json` is for small settings. `PluginDataHandler` refuses one larger than 16 MiB, in both directions, and leaves the file untouched (see [the `data.json` size limit](/obsidian-lib/guides/plugin-helpers/#the-datajson-size-limit)). State that grows with the vault, or records each device keeps for itself, belongs in the stores below. To migrate, read the old field once from the loaded settings and write it into the store. Confirm the store holds it. Only then drop the field from the settings class, so the next save shrinks `data.json`. If some users' files are already over the limit, the plugin cannot load them. Ship one release that raises `maxSizeInBytes` and performs the migration.

## Local records

`LocalDataStore` uses IndexedDB and never writes to the vault. Scope it by the device-local vault identity (`app.appId`), plugin manifest id and a store id including your schema version. A vault display name is insufficient: two vaults can have the same name. Close every connection when its owner unloads.

```typescript
import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

const local = await LocalDataStore.open({
  pluginId: 'example-plugin',
  storeId: 'rename-history-v1',
  vaultId: app.appId
});
try {
  await local.set('note.md', { originalPath: 'old-name.md' });
  const record = await local.get('note.md');
  void record;
} finally {
  local.close();
}
```

Values use IndexedDB's structured-clone contract. Reads return `unknown` so consumers validate their own schema. `commit({ entries, removedKeys })` updates several records atomically. Writes resolve after transaction completion, including disk/quota failures, rather than after the individual request succeeds. `getOrCreate` initializes a value atomically across connections. `entries()` reads every record in key order from one consistent snapshot.

To replace a whole store, pass `shouldClear: true`: the store is cleared and `entries` are written in the same transaction, so a marker or metadata record written with them can never land without the clear, and a failed commit keeps every previous record. Prefer it over listing every existing key in `removedKeys`, which deletes record by record: at 90,000 records in Obsidian a per-key reset took 7 to 16 s, a clearing commit about 1 s.

```typescript
import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';

declare const local: LocalDataStore;

await local.commit({
  entries: [['schema-marker', 2], ['metadata', { resetAt: Date.now() }]],
  shouldClear: true
});
```

## Shared authoritative state

Every writer owns its own folder under `Plugin data/<plugin id>/<store id>/devices/<device id>/`. Device identity lives exclusively in IndexedDB, so copying plugin settings or synchronizing a vault does not clone a writer. Only a folder under `devices/` whose name is a valid device id (letters, digits, `_` and `-`) counts as a device; anything else there, such as the `.DS_Store` file macOS Finder writes, is ignored, so it never holds back compaction. Calls from several library copies or windows serialize through a Web Lock named after the dedicated local database. Do not reuse that local database for another shared store.

```typescript
import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';

const local = await LocalDataStore.open({
  pluginId: 'example-plugin',
  storeId: 'heading-times-v1',
  vaultId: app.appId
});
try {
  const shared = await SharedDataStore.open({
    adapter: app.vault.adapter,
    kind: 'minimum',
    local,
    pluginId: 'example-plugin',
    storeId: 'heading-times-v1'
  });
  await shared.set('note.md#Introduction', Date.now());
  await shared.synchronize();
  const headingTimes = shared.entries();
  void headingTimes;
  await shared.compact();
} finally {
  local.close();
}
```

The merge policy is immutable for a store id:

1. `last-write-wins` stores JSON-compatible values and deletion tombstones. A hybrid logical clock orders writes by wall time, logical counter and writer id, so clock rollback does not reverse a writer's operations. Concurrent ties resolve deterministically; clock skew still affects which value wins.
2. `minimum` and `maximum` store finite numbers, or `{ rank: number, value: JsonValue }` envelopes when the winning rank must retain a payload (for example, an arrival time paired with an original file name). They do not support deletion. Use them for observations such as the earliest time a heading appeared.
3. `observed-remove-set` treats keys as members. `set(member, true)` adds a tagged membership; `delete(member)` removes additions this device has observed. An unseen concurrent addition survives. Snapshot state retains a compact per-member causal summary, preventing old snapshots or returning devices from resurrecting removed additions.

Use `setMany` for a bulk import. A batch splits into bounded journal segments; each segment commits independently. A failed batch can have a published prefix. Retrying register writes is safe; a retried set addition is a new causal addition. Each segment is a fenced JSON document in a Markdown file. A partially copied document remains pending until a complete copy arrives; it advances no acknowledgement. A writer never appends after a torn suffix.

Each device grows ONE open journal segment rather than creating a file per batch. A batch is appended to the device's newest segment, which is rewritten with the longer operation list, while that segment ends at the device's last sequence and is below 64 KiB (or the file limit, when that is smaller); otherwise the batch opens a new `log-<first sequence>` file, which becomes the open one. Only the owning device writes its segments, and a rewrite only ever extends the stored list, so a device that receives an older copy reads a prefix: it applies fewer operations, never different ones, and picks up the rest when the longer copy arrives. Any other change to a stored segment fails as a conflict. Relocation copies follow the same rule: a destination that is a shorter copy is replaced, and a longer one is kept.

Measured with one small batch every 5 s for an hour and compaction every 120 writes (`src/data-stores/shared-data-store-churn.test.ts`): one device used to create 732 files, modify 726 and delete 730, and now creates 18, modifies 714 and deletes 16. Almost all of the remaining modifies are rewrites of the open segment. A second device that synchronizes after every batch adds one acknowledgement rewrite per batch it merges, 720 in that hour; synchronize less often to write fewer.

Call `synchronize` after relevant vault changes, when returning to the foreground, and periodically while the plugin is active. The library installs no timer or event listener: the consumer owns scheduling and teardown. Ignore `have.md` events: acknowledgements are used by compaction and carry no new records. A device rewrites its acknowledgement only when it has merged another device's newer operations, or once a day (a quarter of the retirement interval when that is shorter) so it keeps counting as active; a synchronization that merged nothing new writes no file. Filter journal and snapshot events to the configured store folder and debounce them. This prevents a synchronization callback from repeatedly triggering itself through its own acknowledgement writes. Query results are eventually consistent with the files currently delivered by the sync tool.

Compaction writes numbered snapshot chunks and then their manifest. Readers verify every chunk's SHA-256 before adopting any of that snapshot. Acknowledgements cover only contiguous sequences. A writer deletes its own journal segments only after a complete replacement snapshot exists and every active device acknowledges those sequences. The default retirement interval is 30 days; returning retired devices merge snapshots to catch up. Each writer replaces only its own older snapshots. Register tombstones and set causal summaries remain in the current snapshot.

Shared state is held as individual local records; changed records and the version vector commit in one IndexedDB transaction. Journal publication precedes the local commit, which precedes acknowledgement publication. If a process stops between those steps, synchronization replays its published history before issuing another sequence.

### Local-only shared replicas and JSON transport

Pass `isSyncEnabled: false` to `SharedDataStore.open` for authoritative local history without any vault adapter calls. `set`, `delete`, `setMany`, `synchronize`, `compact` and reopening preserve device identity, clocks, vectors and deletion summaries in IndexedDB. No transport folder is created. Use a dedicated local database as usual; never edit the library's private checkpoint records.

```typescript
import { LocalDataStore } from '@mnaoumov/obsidian-lib/data-stores/local-data-store';
import { SharedDataStore } from '@mnaoumov/obsidian-lib/data-stores/shared-data-store';

const local = await LocalDataStore.open({ pluginId: 'example-plugin', storeId: 'history-v1', vaultId: app.appId });
const shared = await SharedDataStore.open({
  adapter: app.vault.adapter,
  format: 'json',
  isSyncEnabled: false,
  kind: 'last-write-wins',
  local,
  pluginId: 'example-plugin',
  storeId: 'history-v1'
});
try {
  await shared.set('note.md', { originalPath: 'old-name.md' });
  // Call from the user's explicit enable-sync action after configuring their sync tool.
  await shared.setSyncEnabled(true);
  await shared.setSyncEnabled(false);
} finally {
  local.close();
}
```

Persist the user's sync preference in consumer settings and pass it on every open. The toggle controls this instance; callers sharing a local database should coordinate their settings. Enabling merges delivered history and publishes a complete causal checkpoint, including tombstones and all observed device vectors, before acknowledgement. Offline sequences therefore do not leave journal gaps, even after local compaction. A failed enable remains retryable: the durable unpublished marker is cleared only after checkpoint publication succeeds. A local-only write commits locally first; it does not promise that another device has received it.

`format: 'json'` writes version-one JSON envelopes (`{ format: 1, payload: ... }`) with `.json` extensions, so these documents are not Markdown notes. It uses browser JSON and Web Crypto on desktop and mobile. Both encodings retain the same journal/checkpoint protocol; readers recognize both extensions. JSON requires a sync tool configured to carry these files. Obsidian Sync's default file selection does not carry arbitrary JSON. Compression is deliberately absent.

An existing Markdown store without transition records can be opened at its original folder with `format: 'json'`: its history is read in place and new documents use JSON. Choose that initial format consistently on every upgraded device, then keep it fixed when using the relocation protocol below.

Every encoded document is checked against `maxFileBytes` before writing and before parsing on read. Reconstructed snapshots are bounded separately by `maxSnapshotBytes` (default and ceiling 64,000,000 UTF-8 bytes), before parsing the joined JSON. Truncated JSON envelopes are pending and retried; complete envelopes with an unsupported version fail explicitly. Snapshot chunks retain their SHA-256 completeness checks.

### Relocating history and changing formats

Keep `folder` and the initial `format` passed to `open` as the **permanent discovery anchor** on every device, including newly installed devices. Do not replace those parameters with a synchronized destination preference: selecting a different anchor creates an independent store. Change the destination through `relocate` from an explicit user action instead. Normal startup calls `synchronize`, which discovers the recorded destination, so an older synchronized settings value cannot move the store backwards.

<!-- snippet-check: context declare const shared: import('@mnaoumov/obsidian-lib/data-stores/shared-data-store').SharedDataStore; -->
```typescript
await shared.relocate({ folder: '.plugin-data', format: 'json' });
const roots = shared.transportRoots;
const affectsHistory = shared.containsTransportPath('.plugin-data');
void roots;
void affectsHistory;
```

Relocation announces an append-only version-one transition under the original anchor's `locations-v1` subtree, then copies complete journals and validated complete snapshots byte for byte before activating the new writer. It copies only this plugin/store's device history, never sibling plugins, cache seeds or acknowledgements. Existing immutable destinations must have identical bytes. Interrupted copies retry safely; incomplete source deliveries stay in the retained reader roots until they become complete. Each synchronization revisits those roots and copies newly delivered history, including publications from an old offline client. Reopening with the anchor discovers the same chain. The original anchor must remain synchronized even when JSON is selected; its small transition records are JSON files. A JSON destination can contain copied legacy `.md` documents, which retain their indexing behavior until safe history retirement; the selected format controls new documents.

There is no global transaction across sync clients. Reordered or incomplete transition records stop synchronization until the chain is complete. Concurrent requests from the same source to different destinations fail explicitly when both are delivered; no branch of history is deleted or silently selected. Resolve such a conflict by restoring one agreed transition chain on all devices after preserving every root. Identical concurrent destinations are equivalent. Loops, unsafe paths, overlapping anchor subtrees and chains over 32 locations are refused. A device that has not yet received a transition may still write to its previous root; retained readers reconcile that history later. Never treat a missing transition on a new device as evidence that an independently configured destination is a new empty ledger.

Older library copies continue reading and writing Markdown in their old location; they do not follow JSON transition records or see new-root writes. Upgrade all active clients for bidirectional convergence. Sources and the anchor are retained indefinitely by this API. Manual retirement of source device history is safe only after every possible old writer has upgraded or been permanently retired, all its writes have arrived and are covered by verified destination history, and every device and new-device bootstrap uses the same discovery anchor. Preserve the anchor and its `locations-v1` records permanently, including when clearing its old `devices` subtree. Deleting source history while an offline writer may return is unsafe.

Use `transportRoots` or `containsTransportPath(path)` to filter raw/lifecycle events, including ancestor folder operations. The list includes the configured anchor and locally remembered migration roots even while disabled, so old transport files remain excluded after a disabled restart without any adapter access. These local hints are only for filtering; enabled synchronization discovers the authoritative writer from the anchor. Ignore both `have.md` and `have.json` acknowledgement events and debounce synchronization. Hidden roots still require periodic or foreground synchronization because ordinary Vault events do not cover them.

## Cache seeds

Cache seeds are optional performance hints, never authoritative state. Expose a per-store sharing setting and pass it to `DataStoreSeeds`. Store records with their file path, size, mtime, content hash and consumer-defined JSON value. Publish on idle or another infrequent schedule; no journal of derived changes is required.

`DataStoreSeeds.publish` writes immutable bounded chunks and replaces only that device's earlier seed. `readLatest` returns the newest complete, recognized seed, or `undefined` when none has arrived. Include the consumer schema version in the transport's store id. An unrecognized schema requires a fresh build; a partial delivery should first be given time to finish syncing.

```typescript
import { validateDataStoreSeed } from '@mnaoumov/obsidian-lib/data-stores/data-store-seeds';

const result = await validateDataStoreSeed({
  entries: [{ hash: 'previous-content-hash', mtime: 10, path: 'note.md', size: 42, value: ['cached', 'terms'] }],
  files: app.vault.getMarkdownFiles().map((file) => ({
    mtime: file.stat.mtime,
    path: file.path,
    size: file.stat.size
  })),
  async hashFile(path) {
    const text = await app.vault.adapter.read(path);
    const bytes = new TextEncoder().encode(text);
    const hash = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
});
void result.reusable;
void result.rebuild;
```

Matching size and mtime reuses a record without reading note text. Equal size with a changed mtime hashes only that file. A size or hash mismatch, or a new local file, goes into `rebuild`. Deleted local files are dropped. Reusable entries carry the local file statistics. This follows the consumer's size/mtime freshness contract; a consumer requiring protection against same-size, same-mtime external edits must validate hashes for those files too. Keep the ordinary per-file change pipeline active after adoption.

## Vault and sync settings

The configurable folder defaults to the non-dot `Plugin data`. Markdown synchronizes without enabling Sync's unsupported-file toggle. Canvas and Bases extensions are not repurposed. Files default to at most 1,000,000 UTF-8 bytes, including their Markdown wrapper. The configurable limit stays below Sync Standard's current 5 MB per-file limit; oversized records or manifests produce a notice and debug message and fail before publication. Account storage limits still apply. See [Obsidian Sync plans](https://obsidian.md/help/sync/plans) and [selective syncing](https://obsidian.md/help/sync/settings).

Set `folder` explicitly to use a hidden vault-relative location such as `.plugin-data` or `.obsidian/plugins/my-plugin/shared-data`. Hidden storage is opt-in: the caller and user must arrange synchronization of that location on every device. Do not assume Obsidian Sync carries arbitrary hidden folders or arbitrary files under `.obsidian/plugins`. These files hold durable shared metadata, so treating them as a disposable cache can lose state. Paths must use forward slashes and stay inside the vault; absolute paths, empty segments, `.` / `..` segments, backslashes, control characters, Windows-reserved punctuation and trailing dots or spaces are rejected.

The transport uses the vault adapter directly, including for listing hidden files. Hidden files are outside the regular vault file index, so do not rely on `Vault` file events to schedule synchronization there. Call `synchronize` periodically and when returning to the foreground, or use a notification mechanism appropriate to the chosen sync tool. Changing the anchor `folder` selects a different store location; use `relocate` to preserve existing shared history.

Add a visible data folder to Obsidian's **Excluded files** if it should stay out of search, graph and quick-switcher results. The library does not silently change vault-wide exclusions. Excluded Markdown still gets metadata-cache entries: an isolated desktop measurement of four approximately 1 MB fenced chunks took 150 ms for the cold sample and 19–22 ms afterward from creation to metadata readiness. On a two-core Android emulator, the corresponding samples took 356 ms cold and 156–208 ms afterward; the real store smoke test also passed there. Hashing a preallocated 109 MB buffer took 197 ms on that emulator, excluding vault read I/O. These are emulator measurements, not physical-phone guarantees. Exclusion does not eliminate parsing. Journals should be batched, and snapshots published infrequently.

A Markdown-format store is seen by every Markdown indexer and create handler in the vault. The library writes through `vault.adapter`, but Obsidian's file watcher still reports each write as a vault `create`, `modify` or `delete`, so other plugins receive them: `Dataview` tries to index each file, a handler that lints or templates new notes runs on it, and a folder-note plugin may add a note to each new store folder. Excluded files changes none of this. That is why the store creates as few files as it can, and why consumers should filter `transportRoots` out of their own handlers. `markdown` stays the default anyway, because Obsidian Sync carries `.md` files without the **Other file types** toggle, which most vaults leave off; choose `format: 'json'` only where every device's sync tool carries arbitrary files.

Do not put the store under `.obsidian/plugins/<id>/`: Sync carries only selected plugin files there. Do not share IndexedDB itself or place a live SQLite database in the vault. Synchronization transports these immutable documents; it does not provide transactions or a globally current view across devices.
