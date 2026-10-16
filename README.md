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

## License

© [Michael Naumov](https://github.com/mnaoumov/)
