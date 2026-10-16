---
title: Helper Functions
description: The Obsidian-specific helpers, the import paths they are grouped under, and the flat `__merged` barrel.
---

`@mnaoumov/obsidian-lib` provides a range of Obsidian-specific helper functions. The general-purpose ones live in `@mnaoumov/typescript-lib`; see its [Getting started](https://mnaoumov.dev/typescript-lib/guides/getting-started/) guide.

The functions are grouped by files and folders and you have multiple ways to import them:

```typescript
import { prompt } from '@mnaoumov/obsidian-lib/modals/prompt';
await prompt({
  app,
  title: 'Enter your name'
});

import { prompt } from '@mnaoumov/obsidian-lib/modals';
await prompt.prompt({
  app,
  title: 'Enter your name'
});

import { modals } from '@mnaoumov/obsidian-lib';
await modals.prompt.prompt({
  app,
  title: 'Enter your name'
});

import * as obsidianLib from '@mnaoumov/obsidian-lib';
await obsidianLib.modals.prompt.prompt({
  app,
  title: 'Enter your name'
});
```

For files/folders that use `kebab-case` names, namespace-style imports require bracket notation because kebab-case names are not valid JavaScript identifiers:

```typescript
import * as obsidianLib from '@mnaoumov/obsidian-lib';
await obsidianLib['file-manager'].addAlias({
  alias: 'new-alias',
  app,
  pathOrFile: file,
  resourceLockComponent: null
});
```

Prefer the module subpath. A namespace import from the root loads every module of the library, while a subpath loads only the module it names and what that module imports.

## Flat imports via `__merged`

If you would rather not remember which file a helper lives in, `__merged` gives you every value export of the library flattened into a single namespace — no deep paths, no nesting. It is a generated barrel of every value export, deduplicated so each name is unique, and it includes the value exports of `@mnaoumov/typescript-lib` too.

Import the names directly from the `@mnaoumov/obsidian-lib/__merged` subpath:

```typescript
import {
  invokeAsyncSafely,
  prompt,
  unique
} from '@mnaoumov/obsidian-lib/__merged';

const ids = unique([1, 1, 2]);

await prompt({
  app,
  title: 'Enter your name'
});
```

Or pull the whole flat barrel as a single namespace from the main entry:

```typescript
import { __merged } from '@mnaoumov/obsidian-lib';

const ids = __merged.unique([1, 1, 2]);

await __merged.prompt({
  app,
  title: 'Enter your name'
});
```

`__merged` only contains **value** exports (functions, classes, constants) — it deliberately omits type-only exports. Where a cross-platform module has `desktop-` and `mobile-` twins of the same name, it carries the cross-platform one. It is the same flat surface that backs the `lib` bag inside `evalInObsidian` integration-test closures.
