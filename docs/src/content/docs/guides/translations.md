---
title: Translations
description: Ship many locales in one plugin without initializing every one of them at startup, and know what that does and does not save.
---

`PluginBase` initializes [`i18next`](https://www.i18next.com/) from the map `createTranslationsMap()` returns, and `t` from `@mnaoumov/obsidian-lib/i18n/i18n` reads the result with typed keys. Each language in that map is either its translations object or a `LocaleLoader`, a function that returns them. `initI18N` calls a loader only when its language can be shown, so a plugin with many locales initializes one or two of them at startup instead of all of them.

## What a plugin can and cannot defer

A community plugin is installed as `main.js`, `manifest.json` and `styles.css`, and nothing else, so every locale ships inside `main.js`. A loader therefore cannot save download or disk bytes, and it must not fetch a locale from the network: the plugin has to work offline, and the [developer policies](https://docs.obsidian.md/Developer+policies) forbid obfuscated code, so encoded, compressed or `eval`-ed payloads are not an option either. What a loader can save is the work of building the locale objects at startup.

## Use locale loaders

Keep each locale in its own module and return it from an async loader through a dynamic `import()`. Keep the default language, English, as a plain object, so the fallback never depends on a loader:

<!-- snippet-check: skip the locale modules are the plugin's own files, which this package does not have -->
```ts
import type { TranslationsMap } from '@mnaoumov/obsidian-lib/i18n/i18n';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

import { en } from './locales/en.ts';

export class FooPlugin extends PluginBase {
  protected override createTranslationsMap(): TranslationsMap {
    return {
      de: async () => (await import('./locales/de.ts')).de,
      en,
      'pt-BR': async () => (await import('./locales/pt-br.ts')).ptBr,
      uk: async () => (await import('./locales/uk.ts')).uk
    };
  }
}
```

esbuild bundles a plugin as one CommonJS file, so it does not split the dynamic `import()` into a separate file: it bundles the module inline, wrapped so that its body runs only when the loader runs. Nothing is downloaded, and the bundle contains no `eval`, no `new Function` and no decoding. The community directory's release scanner reported nothing on such a bundle (see the measurements below).

Give each locale module a type derived from the English one, so a missing or misspelled key is a compile error in that module rather than a silent fallback at runtime. Only English is imported statically, and it is the only locale whose type `t` reads its keys from, so the keys stay typed.

## How a language is chosen

`initI18N` reads Obsidian's language with `getLanguage()` and calls the loaders of three languages at most: that language, its base language (`pt` for `pt-BR`, `zh` for `zh-TW`), and the default language, `en`. A plain object entry is always registered. The loaders run one after another, before `i18next` is initialized, so the plugin's `onloadImpl` already sees the chosen language.

- A language with no entry, or only a regional one the plugin does not have, falls back to its base language and then to English.
- A loader that throws, rejects, or returns something other than an object is reported with `console.error` naming the language, and is skipped. That language then falls back to English, and the plugin still loads.
- A change of Obsidian's language takes effect after a restart, as it does for Obsidian itself. `initI18N` runs again on every plugin load, so a reload picks up a new language.

## Measurements

A fixture of 12 locales with 1 200 strings each (1.2 MB of source, 1.1 MB minified), bundled by esbuild 0.28.2 into one CommonJS file and loaded 21 times in fresh Node 26.10 processes on Windows, gave these medians:

| Variant | `main.js` | Load and evaluate | Then load `de` |
| --- | --- | --- | --- |
| Every locale imported statically | 1 130 663 bytes | 11.5 ms | 0 ms |
| Locale loaders, dynamic `import()` | 1 131 763 bytes | 10.0 ms | 0.8 ms |
| Loaders over `JSON.parse` of a string literal | 1 158 053 bytes | 5.5 ms | 0.5 ms |

Three things follow:

1. **Loaders save startup work, not bytes.** The bundle grew by 1.1 KB of module wrappers. To ship fewer bytes, ship fewer or smaller locales.
2. **Deferring initialization alone saves little.** Most of the startup cost is the JavaScript engine parsing 1.1 MB of object literals, and a module wrapped by esbuild is still parsed in full. On this fixture the dynamic import saved 1.5 ms of 11.5.
3. **Parsing is what costs, so a locale kept as a JSON string literal costs much less.** The engine scans a string literal far faster than it parses an object literal, and `JSON.parse` runs only for the chosen locale: load time halved, for 2.4% more bytes. The text stays readable in `main.js`, and the scanner reported nothing on it. A loader may return `JSON.parse(...)` of a string the build produced, but write the locale itself as an object or a `.json` file and let the build make the string. Hand-written JSON strings lose the type check against English and the sentence-case lint of locale files.

All three bundles produced no obfuscation finding once the minifier was told to break lines (esbuild's `lineLimit`). Without it, each was one 1.1 MB line, and the scanner reported a packed file for all three alike. That finding comes from minification, not from the way the locales load.
