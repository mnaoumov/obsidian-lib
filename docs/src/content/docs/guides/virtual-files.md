---
title: Virtual files
description: Open immutable in-memory text through Obsidian's file and link APIs without creating vault files.
---

`registerVirtualFile` from `@mnaoumov/obsidian-lib/virtual-file` gives immutable UTF-8 text a `TFile` and a link destination for the lifetime of a disposable registration. Use it for a generated manual or a temporary note. Nothing is written to disk or synchronized.

## Register and open a note

The path must be unoccupied, vault-relative and inside an existing folder. Registrations across copies of the library reserve paths case-insensitively. Real files and concurrent registrations at the same path are rejected.

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; -->
```ts
import { registerVirtualFile } from '@mnaoumov/obsidian-lib/virtual-file';

const registration = await registerVirtualFile({
  app,
  content: '# Plugin manual\n\nGenerated in memory.',
  path: 'Plugin manual.md'
});

plugin.register(() => registration[Symbol.dispose]());
await app.workspace.getLeaf('tab').openFile(registration.file);
```

Keep the registration alive while readers need it. Dispose it when replacing the content or unloading its owner. If registration runs during asynchronous plugin initialization, dispose the result immediately when the owner has already unloaded. Disposal is idempotent: it closes views of the virtual file, removes its resolver and metadata entries, restores patched methods and revokes its resource URL.

While registered, `[[Plugin manual]]` resolves to the in-memory file, and ordinary Markdown links and embeds use that destination. The helper supplies parsed Markdown metadata, including headings. It emits no vault create or delete events; it does not ask indexers or synchronization to treat the file as a persisted note.

## Read and protect the content

`registration.content` is the synchronous read. Obsidian 1.15.0 has no synchronous vault or adapter text-read method. `vault.read`, `vault.cachedRead`, `vault.readBinary`, adapter reads and `vault.readRaw` serve the immutable text or its UTF-8 bytes. Binary reads return independent buffers. `vault.getResourcePath` and the adapter counterpart return a revocable blob URL.

Markdown editors reject changes, including programmatic editor transactions. Vault and adapter writes, renames, moves and deletion targeting the virtual path or its parent folders throw before reaching storage. Operations on unrelated files retain their normal behavior. The adapter's `exists`, `stat` and directory listings continue to describe disk, so `adapter.exists(registration.file.path)` is `false`.

This is an integration with Obsidian's internal resolver and Markdown view, verified against 1.15.0. It is not a filesystem sandbox. Raw Node or native filesystem calls bypass it. Other text extensions can use memory reads and resource URLs, but third-party and Canvas views do not acquire a read-only editing UI through this helper. A saved workspace does not preserve the registration: register it again before reopening its path in a later session. Use a real vault file when content must survive or synchronize.
