# @mnaoumov/obsidian-lib

The runtime library for Obsidian plugins: plugin base classes, components, settings tabs and setting components, modals, popovers, and vault, metadata-cache and link helpers. It continues the runtime half of `obsidian-dev-utils`.

## Installation

```bash
npm install @mnaoumov/obsidian-lib
```

`obsidian`, `@codemirror/state`, `@codemirror/view` and `@obsidian-typings/obsidian-public-latest` are peer dependencies, so your plugin's own copies are the ones this package uses. Your `obsidian` must satisfy `^1.14.4`.

## Documentation

The guides and the API reference are at [mnaoumov.dev/obsidian-lib](https://mnaoumov.dev/obsidian-lib/).

Register custom global and instance functions for Bases with the [formula-function helpers](./docs/src/content/docs/guides/bases-formula-functions.md).

Apply behavior and body classes to the main window and existing or future popouts with the [window helpers](./docs/src/content/docs/guides/windows.md), with cleanup when the window closes or the owner unloads.

Keep plugin state with the workspace layout, so each saved workspace restores its own values, with [workspace layout state](./docs/src/content/docs/guides/workspace-layout-state.md).

Share one loaded component per key among several panels, and unload it after the last one closes, with [shared component pools](./docs/src/content/docs/guides/shared-component-pools.md).

## Where it fits

It is one of five packages that replace [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils): [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib), [`@mnaoumov/typescript-test-toolkit`](https://github.com/mnaoumov/typescript-test-toolkit), [`@mnaoumov/typescript-dev-toolkit`](https://github.com/mnaoumov/typescript-dev-toolkit), [`@mnaoumov/obsidian-lib`](https://github.com/mnaoumov/obsidian-lib) and [`@mnaoumov/obsidian-dev-toolkit`](https://github.com/mnaoumov/obsidian-dev-toolkit). It depends on [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib). It moved here from that repository with its history.

## See also

<!-- cspell:words insurgently ophidian polyipseity vrtmrz Fevol -->

[My other Obsidian resources](https://mnaoumov.dev/obsidian/)

| Library | Features | How `@mnaoumov/obsidian-lib` differs |
| --- | --- | --- |
| [`@insurgently/obsidian-ui`](https://www.npmjs.com/package/@insurgently/obsidian-ui) | Command catalog; side panels; dialogs; notices with undo; background jobs; design tokens and layout classes; control gallery; automation surface for tests | Overlaps with `@insurgently/obsidian-ui` in dialogs, notices and command registration; adds plugin base classes, settings, data stores and vault, metadata-cache and link helpers; omits its design tokens, control set and automation surface |
| [`@ophidian/core`](https://github.com/ophidian-lib/core) | Service container; per-window components; settings with subscriptions; workspace layout settings; shared resources; per-window status-bar items; promise dialogs; metadata indexing | Same goal as `@ophidian/core`, a component framework for plugins; covers its layout settings, shared resources and per-window status-bar items with explicit component ownership instead of a service container; keeps `obsidian` a peer dependency; omits its service container and reactive jobs |
| [`@polyipseity/obsidian-plugin-library`](https://github.com/polyipseity/obsidian-plugin-library) | Settings with immutable updates and change notifications; patches reapplied across plugin reloads; translations; source maps for dynamically built functions; `Svelte` UI parts | Same goal as `@polyipseity/obsidian-plugin-library`, a general plugin library; keeps `obsidian` a peer dependency; adds data stores and vault, metadata-cache and link helpers; omits `Svelte` components and dynamic source maps |
| [`@vrtmrz/obsidian-plugin-kit`](https://github.com/vrtmrz/fancy-kit) | Prompt, selection and confirmation dialogs; keyed notices; progress notices; vault text and front matter capabilities; `SecretStorage` and local-storage adapters; app-free UI and vault test harnesses | Overlaps with `@vrtmrz/obsidian-plugin-kit` in dialogs, notices and front matter helpers; adds plugin base classes, settings tabs, data stores and link helpers; omits its `SecretStorage` and local-storage adapters and app-free test harnesses |
| [`monkey-around`](https://github.com/pjeby/monkey-around) | Removable, cooperative method wrappers; serialized execution | Extends `monkey-around`: wraps its patches in components that remove them when their owner unloads |
| [`obsidian-database-library`](https://github.com/Fevol/obsidian-database-library) | `IndexedDB` database kept in step with vault events; schema rebuilds; optional worker parsing | Overlaps with `obsidian-database-library` in persistent per-file caches; stores data through its own local and synced data stores and incremental file indexes; omits worker parsing |
| [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils) (my library) | Runtime helpers for plugins; `esbuild` builder; shared lint configurations; release script | Supersedes the runtime half of `obsidian-dev-utils`, which is retired; its tooling half moved to `@mnaoumov/obsidian-dev-toolkit` |

Last searched for similar libraries on 2026-11-11.

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/obsidian-lib/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/obsidian-lib/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
