# @mnaoumov/obsidian-lib

The runtime library for Obsidian plugins: plugin base classes, components, settings tabs and setting components, modals, popovers, and vault, metadata-cache and link helpers. It continues the runtime half of `obsidian-dev-utils`.

## Installation

```bash
npm install @mnaoumov/obsidian-lib
```

`obsidian`, `@codemirror/state`, `@codemirror/view` and `@obsidian-typings/obsidian-public-latest` are peer dependencies, so your plugin's own copies are the ones this package uses. Your `obsidian` must satisfy `^1.14.4`.

## Documentation

The guides and the API reference are at [mnaoumov.dev/obsidian-lib](https://mnaoumov.dev/obsidian-lib/).

## Where it fits

It is one of five packages that replace [`obsidian-dev-utils`](https://github.com/mnaoumov/obsidian-dev-utils): [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib), [`@mnaoumov/typescript-test-toolkit`](https://github.com/mnaoumov/typescript-test-toolkit), [`@mnaoumov/typescript-dev-toolkit`](https://github.com/mnaoumov/typescript-dev-toolkit), [`@mnaoumov/obsidian-lib`](https://github.com/mnaoumov/obsidian-lib) and [`@mnaoumov/obsidian-dev-toolkit`](https://github.com/mnaoumov/obsidian-dev-toolkit). It depends on [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib). It moved here from that repository with its history.

## Filing an issue (for AI agents and humans)

Open issues through the [issue forms](https://github.com/mnaoumov/obsidian-lib/issues/new/choose), not as blank issues.

Filing from the CLI or the API (`gh issue create --body`, or an AI agent filing for you) skips the form, and `gh issue create --template` cannot load an issue form. In that case, open the matching form in [`.github/ISSUE_TEMPLATE/`](https://github.com/mnaoumov/obsidian-lib/tree/HEAD/.github/ISSUE_TEMPLATE), copy every field as a `### <label>` heading in the form's order, and fill in each one. Always state the version you used and your operating system.

## License

© [Michael Naumov](https://github.com/mnaoumov/)
