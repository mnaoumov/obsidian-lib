# CHANGELOG

## 5.0.0

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
