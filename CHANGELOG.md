# CHANGELOG

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
- docs: name the Dataview import replacement in the 3.0.0 changelog

## 3.0.0

- feat!: type Dataview through @mnaoumov/obsidian-dataview and drop the vendored declarations
  - BREAKING: `@mnaoumov/obsidian-lib/@types/dataview/<x>` is removed; import `@mnaoumov/obsidian-dataview/<x>` instead.

## 2.0.0

- feat: render plugin names in notices and dialogs as inline code
- feat!: type plugin API contracts over their APIs, with full payload schemas
- feat!: merge finding Custom Attachment Location through its plugin API, not grafted members
- build: drop stale workspace sibling includes from tsconfig.types.json
- refactor: read the global app through obsidian-typings' declaration
- feat!: merge finding Advanced Metadata Cache through its plugin API, not a grafted .safe

## 1.0.1

- fix: declare LIBRARY_VERSION and LIBRARY_STYLES as string in the published types
- docs: stop saying the lookbehind regexes still carry disable comments
- build(deps): merge the lockfile resolved on obsidian 1.14.4
- fix: drop the regex lookbehinds iOS 15 cannot parse, and move to obsidian 1.14.4

## 1.0.0

- Initial release as a standalone repository: the package moved out of the [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) workspace with its history, and its version line restarts at `1.0.0`
