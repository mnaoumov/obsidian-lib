# CHANGELOG

## 10.12.0

This release has 8 new features, 3 fixes and 3 documentation changes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **components:** support custom subpaths for non-Markdown embeds
- **components:** add status-bar items for existing and future popout windows
- **components:** add lifecycle-managed shared component resources
- **data-handler:** guard plugin data.json size before loading and saving
- **workspace-layout-state:** add optional workspace layout state for plugin views
- **plugin-instance:** add waitForPlugin, getLoadedPlugin and requirePlugin for plugins that publish no API
- **markdown-view:** add rerenderPreviews to refresh open Reading views
- **bug-report:** add reviewed diagnostics and a clipboard fallback for long reports

### Fixed

- **plugin:** keep a plugin unloaded mid-load from blocking its API republish
- **components:** keep the embeddable editor focused while another window is in front
- **git-rename-history:** read git renames from a plugin bundle again

### Documentation

- **readme:** link the changelog from README and the docs site
- **readme:** compare similar runtime libraries in See also
- **cross-plugin-apis:** document typed provider events with lifecycle-safe subscriptions

## 10.11.0

This release has 2 new features and 1 fix.

### New

- **link:** edit reference-style link definition destinations
- **release-asset:** download optional plugin release assets on demand with consent and checksum

### Fixed

- **workspace:** load plugins enabled at Obsidian startup again

## 10.10.0

This release has 4 new features and 1 fix.

### New

- **codemirror:** add Live Preview only and Source mode only extensions
- **i18n:** load locale translations on demand
- **modals:** add the code block builder modal
- **plugin:** await the previous instance's async cleanups on reload

### Fixed

- **settings:** stop rewriting data.json on an external settings reload (<https://github.com/mnaoumov/obsidian-custom-attachment-location/issues/102>)

## 10.9.0

This release has 3 new features, 1 fix and 1 documentation change. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- add disposable read-only virtual files
- add window helpers with automatic cleanup
- add Bases formula function helpers

### Fixed

- SharedDataStore.acknowledgements treats a stray file in devices/ as a device, and compaction then fails with "Data-store path leaves its configured folder" (#1)

### Documentation

- restore external type and inherited member links

## 10.8.0

1. Keep a shared data store entirely local with `isSyncEnabled: false`, then enable synchronization without resetting identity, causal history or deletions.
2. Write new transport documents as versioned JSON to keep them out of Markdown note indexing. Markdown remains the default; JSON requires a sync tool configured to carry it on every device.
3. Relocate shared history through `relocate`, with verified immutable copies, retained old-root readers, interrupted-copy retries and explicit conflict detection. Keep the original folder as the discovery anchor.
4. Filter transport events through `transportRoots` or `containsTransportPath`, including remembered migration roots while disabled. Bound reconstructed snapshots before parsing.

This library prerequisite supports the configurable/local-only storage work in [`obsidian-custom-attachment-location` #99](https://github.com/mnaoumov/obsidian-custom-attachment-location/issues/99); the plugin's settings and migration flow are delivered separately.

## 10.7.0

This release has 4 new features, 1 improvement and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- add broken-link candidate discovery and git rename evidence
- add feature request and discussion commands
- **data-stores:** allow explicit hidden vault folders (<https://github.com/mnaoumov/obsidian-custom-attachment-location/issues/99>)
- **components:** add registerStyle for plugin stylesheets in every window

### Improved

- **vault:** remove an emptied folder outright instead of trashing it

### Documentation

- **changelog:** credit the embeddable editor gist authors in 10.5.0

## 10.6.0

This release has 6 new features, 1 fix and 1 documentation change.

### New

- **request-url:** add a requestUrl wrapper with abort, timeout, FormData, rich errors and streaming
- **input:** open suggests at an anchor or from a command, edit lists and tabs
- **input:** complete links and tags in any input, and record hotkeys
- **codemirror:** add inline token renderer and settings facet
- **markdown:** carry focus and state across a self-editing code block's re-render
- **markdown:** footnote clicks and folding in rendered markdown

### Fixed

- **bug-report:** list only the loaded plugins, as Show debug info does (<https://github.com/mnaoumov/obsidian-advanced-debug-mode/issues/5>)

### Documentation

- add a fresh data reads guide

## 10.5.1

This release has 2 fixes, 1 improvement and 1 documentation change. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- keep a bulk operation fresh while it waits on a dialog
- throw PluginEnableRefusedError when Obsidian refuses to enable a plugin

### Improved

- **rename:** narrow the rename link snapshot and speed up the backlink and path indexes

### Documentation

- add issue-filing instructions for AI agents

## 10.5.0

- docs: record that the harness, not the embeddable editor, doubles an Android Enter
- refactor: type the embeddable editor through the released constructor typing
- chore: wrap pinned-versions.json entries under a pins key
- feat: add bug-report links, a settings-tab opener and single-choice menu items
- feat(codemirror): add all-editor dispatch, reconfigurable extension, RangeSet and parse helpers
- feat(components): add EmbeddableMarkdownEditorComponent
  - Adapted from the [embeddable editor gist](https://gist.github.com/Fevol/caa478ce303e69eabede7b12b2323838) by Matthew Meyers (mgmeyers) and Fevol, MIT
- build(deps): bump typescript-dev-toolkit to ^5.4.1 and obsidian-dev-toolkit to ^7.4.0

## 10.4.1

This release has 1 improvement. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Improved

- **data-stores:** commit local data-store writes without a whole-store count

## 10.4.0

This release has 1 new feature.

### New

- **bulk-operation:** wrap bulk operations in git commits, undone by revert

## 10.3.0

This release has 1 new feature.

### New

- **link:** let shouldSkipReference accept null like an absent key

## 10.2.0

This release has 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **attachment-path:** let folder-only callers skip the generated attachment name

## 10.1.1

This release has 1 fix.

### Fixed

- **link:** stop reporting bare URLs in code and wrapping bare file: URLs as empty links

## 10.1.0

This release has 1 new feature and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **link:** let callers exclude chosen links from the reference-editing passes (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/45>)

### Fixed

- **resource-lock:** match ResourceLockedError thrown by any library copy

## 10.0.0

This release has 1 breaking change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- rename isPositionInsideAnyOf to isPositionInsideSome

## 9.0.0

This release has 1 breaking change and 1 new feature. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- name the Reference-typed API after Reference

### New

- **position:** add Pos containment helpers and use them in reference checks

## 8.1.0

This release has 3 new features, 1 fix and 1 documentation change. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **components:** let an incremental file index await metadata changes and move records on rename
- **data-stores:** clear and reseed a local store in one commit
- **link:** leave links inside headings unchanged on request (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/44>)

### Fixed

- run each integration project in its own vitest invocation

### Documentation

- re-derive the bundled @lezer/common against Obsidian 1.15.0 and 1.5.4

## 8.0.0

This release has 1 breaking change and 2 fixes. 3 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Breaking changes

- make interface members readonly by default

### Fixed

- escape angle-bracket Markdown link destinations (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/43>)
- preserve active modal toggle colors on hover

## 7.1.0

This release has 1 new feature and 1 documentation change.

### New

- **indexing:** share incremental file projections and Obsidian word matching

### Documentation

- **indexing:** link to the published data-store guide route

## 7.0.0

This release has 1 breaking change, 1 new feature and 1 other change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- organize library modules by subject

### New

- **data-stores:** add local and shared plugin persistence

### Other changes

- restore the previous library module layout

## 6.3.0

This release has 1 new feature.

### New

- **components:** share the File Explorer vault-root menu across plugins

## 6.2.1

This release has 2 fixes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **link:** keep a folder note's folder name as its link caption
- **settings:** detect text-based components without reading unmocked members

## 6.2.0

This release has 2 new features.

### New

- **debug:** own showInitialDebugMessage in obsidian-lib
- **validation:** refuse the file name characters Obsidian refuses off Windows

## 6.1.0

This release has 1 new feature.

### New

- **validation:** validate a whole file name or path against every naming rule

## 6.0.4

This release has 3 fixes. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- **plugin-gate:** announce an unloaded dependency as lost, not as publishing no readable API
- **deps:** stop logging the initial debug line while debug messages are disabled
- **plugin-gate:** ask to update an enabled dependency that publishes no readable API

## 6.0.3

This release has 1 fix and 2 documentation changes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **parse-link:** read a frontmatter caption with an unbalanced [ as one link, as Obsidian does

### Documentation

- name obsidian-lib where comments said dev-utils
- give the Advanced Debug Mode route in the debugging guide

## 6.0.2

This release has 1 fix. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- close Settings right before each demo-vault plugin enable

## 6.0.1

This release has 2 fixes.

### Fixed

- close Settings before the demo-vault bootstrap enables plugins
- read the link span of an offset-carrying frontmatter link

## 6.0.0

Migration: this release drops every name the library kept from the retired `obsidian-dev-utils` package. Plugins built on `obsidian-dev-utils`, or on `@mnaoumov/obsidian-lib` before `6.0.0`, no longer share the shared-state bag (plugin-API registry, queue, resource locks, backlink index), the lifecycle events, the debug namespace or the CSS class with a plugin on this release, so rebuild every plugin that depends on another one through the plugin-API registry on `6.0.0` together.

- The shared-state module `@mnaoumov/obsidian-lib/obsidian-dev-utils-state` is now `@mnaoumov/obsidian-lib/obsidian-lib-state`: `getObsidianDevUtilsState` is `getObsidianLibState` and `resetObsidianDevUtilsState` is `resetObsidianLibState`. The bag lives on `globalThis.__obsidianLib` only, and `shareTypescriptLibStateWithObsidianDevUtilsState` is gone.
- Elements carry only the `obsidian-lib` CSS class: `CssClass.LegacyLibraryName` is gone, so select `.obsidian-lib`. The stylesheet element id is `obsidian-lib-styles`, and the lock indicator classes are `obsidian-lib-lock-indicator` and `obsidian-lib-lock-indicator-flash`.
- The lifecycle events fire as `obsidian-lib:plugin-loaded` / `obsidian-lib:plugin-unloaded` only. `LEGACY_PLUGIN_LOADED_EVENT_NAME`, `LEGACY_PLUGIN_UNLOADED_EVENT_NAME` and `registerPluginLifecycleEventRelay` are gone.
- The library logs under `obsidian-lib` only. `LEGACY_OBSIDIAN_LIBRARY_NAME` is gone, and a debug filter on `obsidian-dev-utils` shows nothing.
- The i18n namespace `obsidianDevUtils` is `obsidianLib`, so `t(($) => $.obsidianDevUtils.buttons.ok)` becomes `t(($) => $.obsidianLib.buttons.ok)`.
- `VaultTransaction` stages under `.obsidian-lib-temp`, and a default-path transaction moves a leftover `.obsidian-dev-utils-temp` folder to the trash once it settles.
- The deprecated `PluginApiContract`, `TypedPluginApiContract`, `PluginApiMethodContract`, `PluginApiMethodName` and `PluginApiMethods` aliases and the `@mnaoumov/obsidian-lib/plugin/plugin-api-schema` re-exports are removed. Use `ApiContract`, `TypedApiContract`, `ApiMethodContract`, `ApiMethodName`, `ApiMethods`, `createArgumentsSchema` and `createTypeGuardSchema` from `@mnaoumov/typescript-lib/api-contract`.

- refactor!: drop the obsidian-dev-utils wire names

## 5.2.1

This release has 2 fixes. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Fixed

- **plugin-notice:** drop a leading plugin name and colon from a notice message
- **plugin-suggestion:** space the notice's action and decline buttons apart

## 5.2.0

This release has 1 new feature.

### New

- **debug:** log the generic typescript-lib modules under obsidian-lib

## 5.1.0

This release has 1 new feature and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- publish the wire names under obsidian-lib, keeping the legacy ones

### Documentation

- **changelog:** add the 5.0.0 path settings migration note

## 5.0.0

Migration: `PathSettings` entries now all match case-insensitively, whether they are plain paths, globs or regular expressions. An unescaped `*`, `?` or `[` makes an entry a glob (`*.pdf`, `Attachments/**/*.pdf`, `tmp*/`), so a plain path that contains one of those characters literally must escape it (`Notes \[old\]`). An entry shaped `/pattern/flags` is a regular expression whose flags are honoured, and `isPathIgnored` takes an optional `isFolder`. The `pathSettings.invalidRegularExpression` message now carries a `{{reason}}`.

- feat(path-settings)!: support glob entries, case-insensitive matching and regex flags
- build: take typescript-dev-toolkit 3.7.0's shared documentation checks
- docs: mark plugin names as code
- fix(components): accept a typed settings component without a cast
- docs: fix guide snippets and retired obsidian-dev-utils references
- build(docs): re-render the OG cards when the favicon changes
- docs: replace the site logo and favicon with the approved obsidian-lib mark

## 4.3.0

This release has 2 new features and 1 fix. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### New

- **plugin-api:** gate payload validation on the obsidian-lib:validate-plugin-api-payloads debug switch
- **link:** decide the link style per reference when updating links

### Fixed

- **vault:** treat a file gone from disk as not read in readSafe and process

## 4.2.1

This release has 1 fix.

### Fixed

- **metadata-cache:** skip a backlink holder's unparseable frontmatter instead of throwing

## 4.2.0

This release has 1 new feature. 4 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### New

- **plugin-gate:** offer an update for an enabled dependency that is too old

## 4.1.0

This release has 1 new feature.

### New

- **plugin-gate:** let a dependency require a minimum plugin version

## 4.0.0

This release has 1 breaking change and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Breaking changes

- narrow postPatchHandler so a patch cannot graft members

### Documentation

- merge showing the package logo as the home page hero image

## 3.4.0

This release has 1 fix and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- merge pointing the debugging guide links at this package's site

### Documentation

- merge linking the documentation site from the README

## 3.3.1

This release has 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Documentation

- merge publishing this package's documentation site

## 3.3.0

This release has 1 new feature.

### New

- **plugin-api:** merge building the contract on @mnaoumov/typescript-lib/api-contract

## 3.2.0

This release has 1 new feature.

### New

- merge letting loop's progressBarTitle be a DocumentFragment

## 3.1.0

This release has 1 new feature, 1 fix and 2 documentation changes.

### New

- merge letting plugin suggestion and gate reasons be a DocumentFragment

### Fixed

- **plugin-api:** merge making the copied provider contracts agree with the providers' own

### Documentation

- mark plugin names as code in comments and AGENTS.md
- name the `Dataview` import replacement in the 3.0.0 changelog

## 3.0.0

- feat!: type `Dataview` through @mnaoumov/obsidian-dataview and drop the vendored declarations
  - BREAKING: `@mnaoumov/obsidian-lib/@types/dataview/<x>` is removed; import `@mnaoumov/obsidian-dataview/<x>` instead.

## 2.0.0

This release has 3 breaking changes and 1 new feature. 2 maintenance commits (tests, build, CI, refactoring, dependencies) are not listed.

### Breaking changes

- type plugin API contracts over their APIs, with full payload schemas
- merge finding `Custom Attachment Location` through its plugin API, not grafted members
- merge finding `Advanced Metadata Cache` through its plugin API, not a grafted .safe

### New

- render plugin names in notices and dialogs as inline code

## 1.0.1

This release has 2 fixes and 1 documentation change. 1 maintenance commit (tests, build, CI, refactoring, dependencies) is not listed.

### Fixed

- declare LIBRARY_VERSION and LIBRARY_STYLES as string in the published types
- drop the regex lookbehinds iOS 15 cannot parse, and move to obsidian 1.14.4

### Documentation

- stop saying the lookbehind regexes still carry disable comments

## 1.0.0

- Initial release as a standalone repository: the package moved out of the [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) workspace with its history, and its version line restarts at `1.0.0`
