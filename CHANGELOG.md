# CHANGELOG

## 10.4.1

- perf(data-stores): commit local data-store writes without a whole-store count
- build(deps): override re2js to ^2.9.1 for GHSA-gg6h-894w-4m9c

## 10.4.0

- feat(bulk-operation): wrap bulk operations in git commits, undone by revert

## 10.3.0

- feat(link): let shouldSkipReference accept null like an absent key

## 10.2.0

- feat(attachment-path): let folder-only callers skip the generated attachment name
- build(deps): bump typescript-dev-toolkit to ^5.2.0 and apply prefer-dedent

## 10.1.1

- fix(link): stop reporting bare URLs in code and wrapping bare file: URLs as empty links

## 10.1.0

- feat(link): let callers exclude chosen links from the reference-editing passes (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/45>)
- chore(scripts): forward CLI arguments from the test scripts to vitest
- fix(resource-lock): match ResourceLockedError thrown by any library copy

## 10.0.0

- refactor!: rename isPositionInsideAnyOf to isPositionInsideSome
- refactor: name Reference-typed locals and parameters reference

## 9.0.0

- refactor!: name the Reference-typed API after Reference
- feat(position): add Pos containment helpers and use them in reference checks
- build(deps): bump @mnaoumov/typescript-dev-toolkit to ^5.1.0

## 8.1.0

- test(integration): keep VITEST_MAX_WORKERS from running shared-instance files at once
- test(integration): keep a leaked minimized modal from failing unrelated suites
- feat(components): let an incremental file index await metadata changes and move records on rename
- feat(data-stores): clear and reseed a local store in one commit
- docs: re-derive the bundled @lezer/common against Obsidian 1.15.0 and 1.5.4
- feat(link): leave links inside headings unchanged on request (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/44>)
- fix: run each integration project in its own vitest invocation

## 8.0.0

- fix: escape angle-bracket Markdown link destinations (<https://github.com/mnaoumov/obsidian-better-markdown-links/issues/43>)
- fix: preserve active modal toggle colors on hover
- chore: adopt keyword identifier lint rule
- refactor!: make interface members readonly by default
- chore(deps): clear development dependency audit findings
- refactor: store app-wide state once per renderer realm

## 7.1.0

- docs(indexing): link to the published data-store guide route
- feat(indexing): share incremental file projections and Obsidian word matching

## 7.0.0

- feat(data-stores): add local and shared plugin persistence
- chore(test): remove the typescript-lib dedupe workaround
- revert: restore the previous library module layout
- refactor!: organize library modules by subject

## 6.3.0

- feat(components): share the File Explorer vault-root menu across plugins

## 6.2.1

- build(deps): bump @mnaoumov/typescript-lib to 2.0.0
- fix(link): keep a folder note's folder name as its link caption
- fix(settings): detect text-based components without reading unmocked members

## 6.2.0

- feat(debug): own showInitialDebugMessage in obsidian-lib
- feat(validation): refuse the file name characters Obsidian refuses off Windows

## 6.1.0

- feat(validation): validate a whole file name or path against every naming rule

## 6.0.4

- fix(plugin-gate): announce an unloaded dependency as lost, not as publishing no readable API
- fix(deps): stop logging the initial debug line while debug messages are disabled
- fix(plugin-gate): ask to update an enabled dependency that publishes no readable API
- build(test): add the on-demand Stryker mutation run

## 6.0.3

- fix(parse-link): read a frontmatter caption with an unbalanced [ as one link, as Obsidian does
- chore(lint): keep the two deliberate code elements past no-bare-code-element
- docs: name obsidian-lib where comments said dev-utils
- test: re-enable the demo-vault-helper reading-view case
- docs: give the Advanced Debug Mode route in the debugging guide

## 6.0.2

- fix: close Settings right before each demo-vault plugin enable
- test: re-enable the demo-vault-helper reading-view regression test
- chore(deps): move to obsidian-dev-toolkit 5

## 6.0.1

- fix: close Settings before the demo-vault bootstrap enables plugins
- fix: read the link span of an offset-carrying frontmatter link

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

- fix(plugin-notice): drop a leading plugin name and colon from a notice message
- test(docs): give the outdated-reference check a timeout sized for the full gate's load
- chore(deps): float brace-expansion, sharp and fast-uri past their advisories
- fix(plugin-suggestion): space the notice's action and decline buttons apart

## 5.2.0

- feat(debug): log the generic typescript-lib modules under obsidian-lib

## 5.1.0

- feat: publish the wire names under obsidian-lib, keeping the legacy ones
- chore(build): drop the duplicate build:compile:typescript script
- docs(changelog): add the 5.0.0 path settings migration note

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

- chore(deps): bump obsidian-test-mocks to 7.2.3 and pin the root path answers
- fix(vault): treat a file gone from disk as not read in readSafe and process
- feat(plugin-api): gate payload validation on the obsidian-lib:validate-plugin-api-payloads debug switch
- feat(link): decide the link style per reference when updating links

## 4.2.1

- fix(metadata-cache): skip a backlink holder's unparseable frontmatter instead of throwing

## 4.2.0

- build(deps): take obsidian-dev-toolkit 3.2.1 for the guarded require patch
- build: run validate-dependencies in the build
- build: declare the integration harness as an optional peer and add validate-dependencies
- ci(docs-site): set the repository homepage from the docs site build
- feat(plugin-gate): offer an update for an enabled dependency that is too old

## 4.1.0

- feat(plugin-gate): let a dependency require a minimum plugin version

## 4.0.0

- feat!: narrow postPatchHandler so a patch cannot graft members
- docs: merge showing the package logo as the home page hero image
- build(docs): merge taking the external type links from obsidian-dev-toolkit

## 3.4.0

- build(deps): merge taking obsidian and its type packages as peer dependencies
- fix: merge pointing the debugging guide links at this package's site
- docs: merge linking the documentation site from the README

## 3.3.1

- docs: merge publishing this package's documentation site
- build(deps): merge taking the typescript-dev-toolkit and obsidian-dev-toolkit 2.0.0 majors

## 3.3.0

- feat(plugin-api): merge building the contract on @mnaoumov/typescript-lib/api-contract

## 3.2.0

- feat: merge letting loop's progressBarTitle be a DocumentFragment

## 3.1.0

- feat: merge letting plugin suggestion and gate reasons be a DocumentFragment
- fix(plugin-api): merge making the copied provider contracts agree with the providers' own
- docs: mark plugin names as code in comments and AGENTS.md
- docs: name the `Dataview` import replacement in the 3.0.0 changelog

## 3.0.0

- feat!: type `Dataview` through @mnaoumov/obsidian-dataview and drop the vendored declarations
  - BREAKING: `@mnaoumov/obsidian-lib/@types/dataview/<x>` is removed; import `@mnaoumov/obsidian-dataview/<x>` instead.

## 2.0.0

- feat: render plugin names in notices and dialogs as inline code
- feat!: type plugin API contracts over their APIs, with full payload schemas
- feat!: merge finding `Custom Attachment Location` through its plugin API, not grafted members
- build: drop stale workspace sibling includes from tsconfig.types.json
- refactor: read the global app through obsidian-typings' declaration
- feat!: merge finding `Advanced Metadata Cache` through its plugin API, not a grafted .safe

## 1.0.1

- fix: declare LIBRARY_VERSION and LIBRARY_STYLES as string in the published types
- docs: stop saying the lookbehind regexes still carry disable comments
- build(deps): merge the lockfile resolved on obsidian 1.14.4
- fix: drop the regex lookbehinds iOS 15 cannot parse, and move to obsidian 1.14.4

## 1.0.0

- Initial release as a standalone repository: the package moved out of the [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) workspace with its history, and its version line restarts at `1.0.0`
