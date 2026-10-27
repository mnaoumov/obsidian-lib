---
title: Plugin data stores
description: Device-local records, validated cache seeds, and mergeable shared plugin state.
---

Choose persistence by what the records mean. Device-specific state belongs in `LocalDataStore`. Expensive derived caches can use `DataStoreSeeds` to bootstrap another device, with per-file validation before reuse. Authoritative state that must survive concurrent device edits belongs in `SharedDataStore`.

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

Values use IndexedDB's structured-clone contract. Reads return `unknown` so consumers validate their own schema. `commit({ entries, removedKeys })` updates several records atomically. Writes resolve after transaction completion, including disk/quota failures, rather than after the individual request succeeds. `getOrCreate` initializes a value atomically across connections.

## Shared authoritative state

Every writer owns its own folder under `Plugin data/<plugin id>/<store id>/devices/<device id>/`. Device identity lives exclusively in IndexedDB, so copying plugin settings or synchronizing a vault does not clone a writer. Calls from several library copies or windows serialize through a Web Lock named after the dedicated local database. Do not reuse that local database for another shared store.

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

Use `setMany` for a bulk import. A batch splits into bounded immutable journal segments; each segment commits independently. A failed batch can have a published prefix. Retrying register writes is safe; a retried set addition is a new causal addition. Each segment is a fenced JSON document in a Markdown file. A partially copied document remains pending until a complete copy arrives; it advances no acknowledgement. A writer never appends after a torn suffix.

Call `synchronize` after relevant vault changes, when returning to the foreground, and periodically while the plugin is active. The library installs no timer or event listener: the consumer owns scheduling and teardown. Ignore `have.md` events: acknowledgements are used by compaction and carry no new records. Filter journal and snapshot events to the configured store folder and debounce them. This prevents a synchronization callback from repeatedly triggering itself through its own acknowledgement writes. Query results are eventually consistent with the files currently delivered by the sync tool.

Compaction writes numbered snapshot chunks and then their manifest. Readers verify every chunk's SHA-256 before adopting any of that snapshot. Acknowledgements cover only contiguous sequences. A writer deletes its own journal segments only after a complete replacement snapshot exists and every active device acknowledges those sequences. The default retirement interval is 30 days; returning retired devices merge snapshots to catch up. Each writer replaces only its own older snapshots. Register tombstones and set causal summaries remain in the current snapshot.

Shared state is held as individual local records; changed records and the version vector commit in one IndexedDB transaction. Journal publication precedes the local commit, which precedes acknowledgement publication. If a process stops between those steps, synchronization replays its published history before issuing another sequence.

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

Add the data folder to Obsidian's **Excluded files** if it should stay out of search, graph and quick-switcher results. The library does not silently change vault-wide exclusions. Excluded Markdown still gets metadata-cache entries: an isolated desktop measurement of four approximately 1 MB fenced chunks took 150 ms for the cold sample and 19–22 ms afterward from creation to metadata readiness. On a two-core Android emulator, the corresponding samples took 356 ms cold and 156–208 ms afterward; the real store smoke test also passed there. Hashing a preallocated 109 MB buffer took 197 ms on that emulator, excluding vault read I/O. These are emulator measurements, not physical-phone guarantees. Exclusion does not eliminate parsing. Journals should be batched, and snapshots published infrequently.

Do not put the store under `.obsidian/plugins/<id>/`: Sync carries only selected plugin files there. Do not share IndexedDB itself or place a live SQLite database in the vault. Synchronization transports these immutable documents; it does not provide transactions or a globally current view across devices.
