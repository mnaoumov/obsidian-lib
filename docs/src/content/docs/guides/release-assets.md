---
title: Release assets
description: Download an optional data asset of a plugin release on demand, with the user's consent, a SHA-256 check and a local cache.
---

A community plugin installs only `main.js`, `manifest.json` and `styles.css`. A large optional data file, such as a dictionary, a model or a WASM payload a feature needs only when the user turns it on, does not belong in `main.js`, where every user pays for it at every startup. `ensureReleaseAsset` from `@mnaoumov/obsidian-lib/release-asset` fetches such a file from the plugin's release when it is first needed, and works the same on desktop and mobile.

Keep code out of it: a worker or any other executable code ships readable inside the bundle, where the community review can read it. This helper is for data.

## `ensureReleaseAsset`

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; declare const abortSignal: AbortSignal; -->

```ts
import {
  ensureReleaseAsset,
  getGitHubReleaseAssetUrl
} from '@mnaoumov/obsidian-lib/release-asset';

const asset = await ensureReleaseAsset({
  abortSignal,
  app: plugin.app,
  cacheFolderPath: `${plugin.manifest.dir ?? ''}/assets`,
  fileName: 'dictionary.bin',
  sha256: '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7',
  sizeInBytes: 12_582_912,
  url: getGitHubReleaseAssetUrl({ fileName: 'dictionary.bin', repository: 'owner/my-plugin', tag: plugin.manifest.version })
});

if (asset) {
  const bytes = await plugin.app.vault.adapter.readBinary(asset.path);
  console.log(asset.resourceUrl, bytes.byteLength);
}
```

It resolves with the `path` of the cached file, its `resourceUrl` from the adapter's `getResourcePath`, and `wasCached`, which says whether anything was downloaded. It resolves with `null` when the user declines.

Put the cache under the plugin's own folder, `plugin.manifest.dir`. That folder is not synced, so every device downloads the asset once, and uninstalling the plugin removes it.

Inside a plugin built on `PluginBase`, pass `this.abortSignalComponent.abortSignal`, so unloading the plugin stops the operation.

## What it guarantees

1. **The cache is checked first, by content.** A cached file is hashed on every call. A match is returned without asking anything or touching the network. A mismatch, from a truncated write or a hand edit, is removed and downloaded again, so a corrupt cache repairs itself.
2. **The user is asked only when a download is needed.** By default a confirmation modal names the file, its size when `sizeInBytes` is given, and the host it comes from. Pass `shouldDownload` to ask another way, or `() => Promise.resolve(true)` when the user has already agreed through a setting. Declining writes nothing and resolves with `null`, so the next call asks again.
3. **Nothing unverified is written or exposed.** The downloaded bytes are hashed before they are written. A mismatch throws a `ReleaseAssetChecksumError` carrying `expectedSha256`, `actualSha256` and `url`.
4. **No partial file is left under the cached name.** The bytes are written to `<fileName>.download` and then renamed into place. A failed write removes the temporary file and rethrows.
5. **An abort stops it at every step.** An aborted signal rejects with the signal's reason before the cache is read, after the user answers and after the download, so nothing is written once the plugin has unloaded. `requestUrl` cannot be cancelled, so a download in progress runs on in the background and its bytes are dropped.
6. **Concurrent calls share one operation.** Two features asking for the same file at the same time see one question and one download.
7. **A download failure is not swallowed.** A network error, a timeout (`timeoutInMilliseconds`) or an HTTP error status rejects with the error from `requestUrlEx`. See [HTTP requests](/obsidian-lib/guides/http-requests/).

## Getting the checksum

Compute the SHA-256 of the file you attach to the release, and keep it in the plugin's source beside the file name, so a release can only serve the bytes that version was built with. `computeSha256` gives the same lowercase hexadecimal form in the renderer, and `sha256sum` or `Get-FileHash` gives it on the command line.
