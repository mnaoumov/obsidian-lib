# CHANGELOG

## 3.0.0

- feat!: type Dataview through @mnaoumov/obsidian-dataview and drop the vendored declarations

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
