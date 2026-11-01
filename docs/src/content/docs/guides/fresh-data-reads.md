---
title: Fresh data reads
description: Read a note's current text and metadata, and rewrite it, without racing the open editor or the metadata cache.
---

Obsidian keeps three copies of a note: the text in an open editor, the file on disk, and the parsed metadata in `app.metadataCache`. Nothing keeps them in step for a plugin. An editor holds the user's typing for a moment before it saves. The metadata cache is rebuilt after a write, not during it. So a plugin that formats, lints or rewrites a note can read stale text, act on stale metadata, or write a result that the editor's next autosave overwrites.

This library has helpers that close those gaps. This page says which to call, and when not to.

## Read what the user sees

`readSafe(app, file)` from `@mnaoumov/obsidian-lib/vault` saves every open editor of the note that has unsaved changes, then reads the file. It returns `null` when the file is missing or was deleted during the read.

```ts
import { readSafe } from '@mnaoumov/obsidian-lib/vault';

const content = await readSafe(app, file);
if (content !== null) {
  console.log(content.length);
}
```

`app.vault.cachedRead(file)` and `app.vault.read(file)` read the file on disk. While the user is typing, that is not the text on screen.

## Read metadata that matches the text

`getCacheSafe(app, file)` from `@mnaoumov/obsidian-lib/metadata-cache` saves the open editors the same way. When the cached entry's `mtime` and `size` do not match the file, it recomputes the note's metadata and waits until the cache is clean. Only then does it return the cache. `getFrontmatterSafe(app, file)` does the same and returns the front matter alone.

```ts
import { getCacheSafe } from '@mnaoumov/obsidian-lib/metadata-cache';

const cache = await getCacheSafe(app, file);
const headings = cache?.headings ?? [];
console.log(headings.length);
```

`app.metadataCache.getFileCache(file)` straight after `app.vault.modify` can return the metadata of the text before the write.

`ensureMetadataCacheReady(app)` waits for `onCleanCache`, which is all most code needs after a batch of writes. It is not enough for a file you created a moment ago: the indexing work is not queued yet, so the cache reports clean at once. For one file, call `getCacheSafe`.

## Rewrite a note without losing an edit

`process` from `@mnaoumov/obsidian-lib/vault` rewrites a note in four steps:

1. It reads the note through `readSafe`, so pending editor changes are saved first.
2. It calls your `newContentProvider` with that text.
3. Inside `app.vault.process`, it checks that the file still holds the text it read. If it does not, the user or another plugin wrote in between, and it retries from step 1.
4. Otherwise it writes your result.

```ts
import { process } from '@mnaoumov/obsidian-lib/vault';

await process({
  app,
  newContentProvider: ({ content }) => content.replaceAll('\t', '  '),
  pathOrFile: file,
  pluginNoticeComponent: null,
  resourceLockComponent: null
});
```

The provider has three outcomes:

1. Return the new text to write it.
2. Return the text it was given, unchanged, when there is nothing to change. Nothing is written.
3. Return `null` to ask for a retry, when the text cannot be handled yet. Return `null` only for a condition that can change: the retry does not stop on its own, and a timeout only shows a notice with a Cancel button.

Pass a `PluginNoticeComponent` to show that notice, and a `ResourceLockComponent` to make the note's editors read-only while the rewrite runs.

## When not to use them

`readSafe`, `getCacheSafe`, `getFrontmatterSafe` and `getBacklinksForFileSafe` are not pure reads. Each one saves the open editor first, which is a write. That is right for a command the user runs, and for a rewrite such as a format-on-save that you start yourself.

Do not call them from an automatic trigger that only decides whether to act: a vault or metadata event, a render, or a layout hook. A save forced there, one tick after another plugin has sent a change into the editor, can leave the editor showing stale state. To check a note's text without a view, a cache or a save, read the text yourself and parse it with `parseMetadata(app, text)` from `@mnaoumov/obsidian-lib/metadata-cache`.

```ts
import { parseMetadata } from '@mnaoumov/obsidian-lib/metadata-cache';

const metadata = await parseMetadata(app, '# Title\n\nBody');
console.log(metadata.headings?.length);
```

## Without the library

Each helper is short, and the source is the reference. They are in `src/vault.ts` (`saveNote`, `readSafe`, `process`) and `src/metadata-cache.ts` (`getCacheSafe`, `ensureMetadataCacheReady`). A plugin that does not depend on this library can copy the pattern:

1. Before you read, call `save()` on every `MarkdownView` of the note whose `dirty` flag is set.
2. Before you read the metadata, compare `app.metadataCache.fileCache[path]`'s `mtime` and `size` with `file.stat`. If they differ, recompute the metadata and wait for `onCleanCache`. `fileCache` and the recompute (`computeFileMetadataAsync`) are not in Obsidian's public API; `obsidian-typings` declares them.
3. Inside `app.vault.process`, compare the text you are given with the text you read. If they differ, return it unchanged and start again.
