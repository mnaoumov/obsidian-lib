---
title: Cross-plugin APIs
description: Publish and consume another plugin's API with version negotiation, revocable handles, typed failures, and optional payload validation.
---

Obsidian gives plugins no first-class way to expose an API to each other. The usual workaround — [`@vanakat/plugin-api`](https://github.com/vanakat/plugin-api) — puts an object on `window.PluginApi` and types both ends as `any`. That works right up until one of five things happens:

1. **Load order.** The lookup runs in your `onload` before the provider has loaded, and returns `undefined`.
2. **Version drift.** The provider ships API v2, you compiled against v1, and nothing says so.
3. **Stale handles.** The provider gets disabled and you keep calling into a torn-down plugin.
4. **Name collisions.** Nothing stops two plugins claiming the same free-form key.
5. **Opaque failure.** Not-installed, not-enabled and no-API-published are one indistinguishable `Notice` plus `undefined` — and a version or shape mismatch produces no signal at all, because the object is never examined before it is handed to you.

`@mnaoumov/obsidian-lib` ships a registry that answers all five.

```typescript
import {
  publishPluginApi,
  watchPluginApi
} from '@mnaoumov/obsidian-lib/plugin/plugin-api';
```

Publishing an API here does not confine your consumers to this library. The events and the registry below are a documented wire protocol, reachable with nothing but the `obsidian` module — see [Plugin API protocol](/obsidian-lib/guides/plugin-api-protocol/), which is the page to hand a developer who wants your API and not your framework.

## Declaring the contract

A cross-plugin call is **RPC across a version boundary**: the code on the other side was compiled separately, released separately, and may be older or newer than what you compiled against. So the contract is where you write down what each method takes and returns — and the payload schemas are the substance of it, not a decoration.

Schemas are reached through [Standard Schema](https://standardschema.dev), so zod, valibot, arktype or a hand-written validator all plug in and **none of them becomes a dependency of this library** or of a plugin that does not want one.

```typescript
import type { ApiContract } from '@mnaoumov/typescript-lib/api-contract';

import { z } from 'zod';

export interface SearchOptions {
  limit: number;
}

export interface SearchHit {
  path: string;
  score: number;
}

export interface SearchApi {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
}

export const SEARCH_CONTRACT: ApiContract<SearchApi> = {
  search: {
    // `input` validates the ARGUMENT LIST as an array — hence a tuple, one member per parameter.
    input: z.tuple([
      z.string().min(1),
      z.object({ limit: z.number().int().positive() })
    ]),
    // `output` validates the return value — or, for a method returning a thenable, what it resolves to.
    output: z.array(z.object({
      path: z.string(),
      score: z.number()
    }))
  }
};
```

That is what turns "the provider is on 1.9 and returns `{ path }` where I expect `{ file }`" into a legible error naming the method and the offending field, at the call site that made the call:

```text
PluginApiValidationError: The output of "their-plugin-id" API method "search"
failed validation: 0.path: Invalid input: expected string, received undefined
```

A contract typed over its API, as above, has exactly one entry per method of that API, so a missing, extra or misspelled method does not compile, and every entry must carry both schemas. The untyped form, `ApiContract` with no type argument, keeps both schemas optional per method. A method entry may then declare only its input, only its output, or neither — `{ search: {} }` still declares that `search` must **exist**, which is the shape check every consumer gets for free, and it is already more than `@vanakat/plugin-api` does: that never examines the object at all, so a provider missing the method hands you a value and fails as a `TypeError` at your first call. Here it fails as a `ShapeMismatch` before you are given a handle.

But the names are the cheap half. The schemas are the half that checks the version boundary, which is the thing that actually drifts.

## Providing an API

A plugin built on `PluginBase` declares its APIs by overriding `getPluginApis()`:

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context declare const SEARCH_CONTRACT: import('@mnaoumov/typescript-lib/api-contract').ApiContract<SearchApi>; -->
<!-- snippet-check: context declare class MySearchApi implements SearchApi { public constructor(plugin: import('obsidian').Plugin); public search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
```typescript
import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

export class Plugin extends PluginBase {
  protected override getPluginApis(): PluginApiDeclaration[] {
    return [{
      api: new MySearchApi(this),
      apiVersion: '2.1.0',
      contract: SEARCH_CONTRACT
    }];
  }
}
```

The base publishes every declaration before it announces the plugin as loaded, lists their versions in that announcement, and revokes them when the plugin's feature surface unloads. Do not call `publishPluginApi` by hand from a `PluginBase` subclass: the announcement is derived from `getPluginApis()` alone, so a hand-published API is announced as no API at all. `publishPluginApi` is for a plugin that does not extend `PluginBase`.

The record is keyed by `plugin.manifest.id`, which Obsidian already keeps unique — so no consumer can be misdirected by a typo, and no two plugins can collide.

`apiVersion` is the **contract** version, not the plugin version. Plugin `1.4.7` may perfectly well expose API `2.1.0`, and the two move independently. You may publish several versions side by side, which is how you move to `3.0.0` without breaking consumers pinned to `^2`:

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context interface SearchApiV3 { search(query: string): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context declare const SEARCH_CONTRACT: import('@mnaoumov/typescript-lib/api-contract').ApiContract<SearchApi>; -->
<!-- snippet-check: context declare const SEARCH_CONTRACT_V3: import('@mnaoumov/typescript-lib/api-contract').ApiContract<SearchApiV3>; -->
<!-- snippet-check: context declare const legacyApi: SearchApi; -->
<!-- snippet-check: context declare const nextApi: SearchApiV3; -->
```typescript
import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

export class Plugin extends PluginBase {
  protected override getPluginApis(): PluginApiDeclaration[] {
    return [
      { api: legacyApi, apiVersion: '2.1.0', contract: SEARCH_CONTRACT },
      { api: nextApi, apiVersion: '3.0.0', contract: SEARCH_CONTRACT_V3 }
    ];
  }
}
```

## Consuming an API

`watchPluginApi` is the whole consumer surface. It returns a **live ref** whose `value` is always current.

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context declare const SEARCH_CONTRACT: import('@mnaoumov/typescript-lib/api-contract').ApiContract<SearchApi>; -->
```typescript
import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { Plugin } from 'obsidian';

export default class MyConsumerPlugin extends Plugin {
  private searchApi: null | SearchApi = null;

  public override onload(): void {
    const ref = watchPluginApi<SearchApi>({
      apiVersionRange: '^2',
      app: this.app,
      component: this,
      contract: SEARCH_CONTRACT,
      pluginId: 'their-plugin-id'
    });

    ref.on('change', () => {
      this.searchApi = ref.value;
    });
  }
}
```

Three ways to read it, in the order you will usually want them:

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context declare const ref: import('@mnaoumov/obsidian-lib/plugin/plugin-api').PluginApiRef<SearchApi>; -->
```typescript
ref.value;                   // SearchApi | null — synchronous, free, always correct
await ref.whenAvailable();   // one-shot flows: a command execution, a script
ref.on('change', () => {});  // when you must REACT rather than read
```

`null` from `ref.value` means **"not available right now"**, not "not installed". During your `onload` the provider may simply not have loaded yet; the value becomes non-`null` on its own, with no polling on your part.

The watch is scoped to the `component` you pass, so it is torn down with it.

### Prefer the ref over a one-shot lookup

Some Obsidian callbacks cannot `await` — `checkCallback(isChecking): boolean`, `canExecute()`, a settings-row `visible` predicate. The answer is not a lookup function; it is the field the ref already maintains for you:

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
```typescript
import type { PluginApiRef } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

import { GlobalCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/global-command-handler';

export class SearchCommandHandler extends GlobalCommandHandler {
  private readonly searchApiRef: PluginApiRef<SearchApi>;

  public constructor(searchApiRef: PluginApiRef<SearchApi>) {
    super({ icon: 'search', id: 'search', name: 'Search' });
    this.searchApiRef = searchApiRef;
  }

  protected override canExecute(): boolean {
    return this.searchApiRef.value !== null;
  }

  protected override async execute(): Promise<void> {
    await this.searchApiRef.value?.search('query', { limit: 10 });
  }
}
```

That is free (no registry lookup per keystroke in the command palette) and it is correct across **both** edges, which a probe never is — a probe only ever answers "now", and never tells you when "now" changed.

The one-shot lookup does exist, as `findPluginApi`, for code that has no component to own a watch: a free function called on a user-driven path, such as a backlink lookup made while a rename is handled. It applies the same selection rule and hands out the same revocable handle as `watchPluginApi`, but subscribes to nothing. Never call it from `onload`: plugins load in an unspecified order, so `null` there means "not yet" as often as "not installed".

### Version negotiation

`apiVersionRange` is evaluated by [`compare-versions`](https://github.com/omichelsen/compare-versions), and the **highest** published version satisfying it wins. It accepts `^`, `~`, comparison operators and `x` wildcards — but not a bare `*`. Spell "any version" as `'>=0.0.0'`.

### Revoked handles

`ref.value` is a revocable handle. Once the provider unloads, reading any property off a handle you cached throws a `PluginApiRevokedError` naming the provider — instead of a `Cannot read properties of undefined` deep inside somebody else's torn-down stack.

Note that a re-enabled provider publishes a **new** record, so an old handle stays dead forever. This is exactly why the watch, and not a one-shot "give me the API" call, is the entire consumer surface: `ref.value` recovers, a cached handle does not.

## Provider events

The ref's `change` event says one thing only: whether the API is there. A provider often has news of its own as well, such as "this file was re-indexed" or "this note was removed". A consumer would otherwise have to poll for that. These are **application events**, and they belong in the contract like any method. Their lifecycle is harder, though, because each subscription outlives the call that made it and has to be torn down and made again around the provider being turned off and on.

The example below is a link index. It is modelled on a real provider, [Advanced Metadata Cache](https://github.com/mnaoumov/obsidian-advanced-metadata-cache), whose answers change as notes are re-indexed. That plugin publishes its API through this registry and ships it as a self-contained `api.d.ts`. Its predecessor, Backlink Cache, is the pattern this registry replaced: it attached extra functions (`.safe`, `.originalFn`) to Obsidian's own `getBacklinksForFile`, with no version, no revocation and no events, and its current release only points to its successor. Neither plugin publishes events today, so the event half below is the shape to copy, not a quote.

### The event map is part of the contract

Declare the events as a map from event name to argument tuple, the same shape `AsyncEvents` from `@mnaoumov/typescript-lib/async-events` takes. Then expose ONE `on` method that returns an unsubscribe function:

```typescript
import type { ApiContract } from '@mnaoumov/typescript-lib/api-contract';

import {
  createArgumentsSchema,
  createExpectedTypeGuard,
  createTypeGuardSchema,
  literalGuard,
  NUMBER_GUARD,
  STRING_GUARD
} from '@mnaoumov/typescript-lib/api-contract';

export interface LinkIndexEventMap {
  'file-indexed': [path: string, linkCount: number];
  'file-removed': [path: string];
}

export type LinkIndexEventName = keyof LinkIndexEventMap;

export type LinkIndexListener<EventName extends LinkIndexEventName> = (...payload: LinkIndexEventMap[EventName]) => void;

export interface LinkIndexApi {
  getLinkCount(path: string): number;
  on<EventName extends LinkIndexEventName>(name: EventName, listener: LinkIndexListener<EventName>): () => void;
}

const FUNCTION_GUARD = createExpectedTypeGuard('a function', (value: unknown): value is () => void => typeof value === 'function');

export const LINK_INDEX_CONTRACT: ApiContract<LinkIndexApi> = {
  getLinkCount: {
    input: createArgumentsSchema([STRING_GUARD]),
    output: createTypeGuardSchema(NUMBER_GUARD)
  },
  on: {
    // A record rather than an array, so a new event name that is missing here does not compile.
    input: createArgumentsSchema([
      literalGuard<LinkIndexEventName>({ 'file-indexed': true, 'file-removed': true }),
      FUNCTION_GUARD
    ]),
    output: createTypeGuardSchema(FUNCTION_GUARD)
  }
};
```

`on` returns a plain function instead of an `AsyncEventRef` with an `off` method beside it. There are two reasons:

- **Teardown must not go through the handle.** Once the provider is disabled, `ref.value` is `null` and a cached handle throws `PluginApiRevokedError` on every property read. So an `offref` reached through the API cannot run at the very moment a consumer most needs to clean up. The unsubscribe function `on` returns is the provider's own closure, not a property of the handle, so calling it after revocation is safe.
- **What crosses the registry is plain functions and plain data.** An `AsyncEventRef` carries the provider's emitter, a class instance from the provider's copy of this library. The consumer may run a different copy, which is exactly what [A note on library copies](#a-note-on-library-copies) rules out.

The contract checks the `on` call itself while the validation debug switch is on: an unknown event name fails at the call site. It does **not** check the event payloads, because a payload travels into the consumer's listener and is never a value the handle returns. A listener that does not trust its provider validates the payload itself.

### Emitting from the feature surface

The emitter has to live and die with the published record, so put it in a child component. On a `PluginBase`, `addChild` attaches to the plugin's feature surface, the half that is torn down while a dependency is missing and rebuilt when the dependency comes back. `registerEvent` and `register` called on the plugin itself attach to the plugin. A listener registered that way in `onloadImpl` keeps firing after the surface is gone, and each rebuild adds another.

<!-- snippet-check: context interface LinkIndexEventMap { 'file-indexed': [path: string, linkCount: number]; 'file-removed': [path: string]; } -->
<!-- snippet-check: context type LinkIndexEventName = keyof LinkIndexEventMap; -->
<!-- snippet-check: context type LinkIndexListener<EventName extends LinkIndexEventName> = (...payload: LinkIndexEventMap[EventName]) => void; -->
<!-- snippet-check: context interface LinkIndexApi { getLinkCount(path: string): number; on<EventName extends LinkIndexEventName>(name: EventName, listener: LinkIndexListener<EventName>): () => void; } -->
<!-- snippet-check: context declare const LINK_INDEX_CONTRACT: import('@mnaoumov/typescript-lib/api-contract').ApiContract<LinkIndexApi>; -->
```typescript
import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import type { App } from 'obsidian';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { AsyncEvents } from '@mnaoumov/typescript-lib/async-events';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Component } from 'obsidian';

class LinkIndexComponent extends Component {
  public readonly api: LinkIndexApi;
  private readonly events = new AsyncEvents<LinkIndexEventMap>();
  private readonly linkCounts = new Map<string, number>();

  public constructor(private readonly app: App) {
    super();
    // The published object holds the two API methods and nothing else, so a consumer holding
    // the handle cannot reach `trigger` or the index.
    this.api = {
      getLinkCount: (path) => this.linkCounts.get(path) ?? 0,
      on: (name, listener) => {
        // `AsyncEvents.on` cannot carry a generic event name through to its listener type, so the listener is
        // widened to every event's payload. `name` still picks the one event it is called for.
        const eventRef = this.events.on<LinkIndexEventName, LinkIndexEventMap[LinkIndexEventName]>(
          name,
          castTo<(...payload: LinkIndexEventMap[LinkIndexEventName]) => void>(listener)
        );
        return () => {
          this.events.offref(eventRef);
        };
      }
    };
  }

  public override onload(): void {
    this.registerEvent(this.app.metadataCache.on('resolve', (resolvedFile) => {
      const linkCount = this.app.metadataCache.getFileCache(resolvedFile)?.links?.length ?? 0;
      this.linkCounts.set(resolvedFile.path, linkCount);
      this.events.trigger('file-indexed', resolvedFile.path, linkCount);
    }));
    this.registerEvent(this.app.metadataCache.on('deleted', (deletedFile) => {
      this.linkCounts.delete(deletedFile.path);
      this.events.trigger('file-removed', deletedFile.path);
    }));
  }
}

export class Plugin extends PluginBase {
  private linkIndexComponent: LinkIndexComponent | null = null;

  protected override getPluginApis(): PluginApiDeclaration[] {
    if (this.linkIndexComponent === null) {
      return [];
    }

    return [{
      api: this.linkIndexComponent.api,
      apiVersion: '1.0.0',
      contract: LINK_INDEX_CONTRACT
    }];
  }

  protected override onloadImpl(): void {
    // `addChild` on a `PluginBase` attaches to the feature surface, so the index and its Obsidian
    // listeners go down with the published record and come back with the next one.
    this.linkIndexComponent = this.addChild(new LinkIndexComponent(this.app));
  }
}
```

`onloadImpl` runs again on every rebuild of the surface, so each published record gets its own emitter. A listener added to the old record's emitter is never called again. That is what the consumer side below relies on.

`AsyncEvents.trigger` calls every listener in order, even after one of them throws. So one consumer's broken listener cannot keep the provider's other consumers from hearing the event.

### Subscribing for as long as the provider is there

The consumer subscribes whenever the ref gains a value and unsubscribes whenever it loses one. The ref's `change` event marks both edges:

<!-- snippet-check: context interface LinkIndexEventMap { 'file-indexed': [path: string, linkCount: number]; 'file-removed': [path: string]; } -->
<!-- snippet-check: context type LinkIndexEventName = keyof LinkIndexEventMap; -->
<!-- snippet-check: context type LinkIndexListener<EventName extends LinkIndexEventName> = (...payload: LinkIndexEventMap[EventName]) => void; -->
<!-- snippet-check: context interface LinkIndexApi { getLinkCount(path: string): number; on<EventName extends LinkIndexEventName>(name: EventName, listener: LinkIndexListener<EventName>): () => void; } -->
<!-- snippet-check: context declare const LINK_INDEX_CONTRACT: import('@mnaoumov/typescript-lib/api-contract').ApiContract<LinkIndexApi>; -->
```typescript
import { watchPluginApi } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import { Plugin } from 'obsidian';

export default class MyConsumerPlugin extends Plugin {
  private unsubscribeFromLinkIndex: (() => void) | null = null;

  public override onload(): void {
    const ref = watchPluginApi<LinkIndexApi>({
      apiVersionRange: '^1',
      app: this.app,
      component: this,
      contract: LINK_INDEX_CONTRACT,
      pluginId: 'link-index'
    });

    const rebind = (): void => {
      // Drop the subscription on the previous record first. The unsubscribe function is the
      // provider's own closure, not a property of the revoked handle, so it does not throw.
      this.unsubscribeFromLinkIndex?.();
      this.unsubscribeFromLinkIndex = ref.value?.on('file-indexed', (path, linkCount) => {
        console.log(`${path} now has ${String(linkCount)} links`);
      }) ?? null;
    };

    ref.on('change', rebind);
    // `watchPluginApi` has already read the registry once, so a provider that loaded first is
    // available now and fires no `change` until it goes away.
    rebind();

    this.register(() => {
      this.unsubscribeFromLinkIndex?.();
      this.unsubscribeFromLinkIndex = null;
    });
  }
}
```

The listener's arguments are typed from the event name: `path` is a `string` and `linkCount` a `number`, and a misspelled event name does not compile.

What happens across a provider's lifecycle:

| Moment | What the consumer sees |
| --- | --- |
| The consumer loads first | `ref.value` is `null`, `rebind` subscribes to nothing, and the first `change` subscribes. |
| The provider loads first | `rebind()` in `onload` subscribes straight away. |
| The provider is disabled, or loses a dependency of its own | Its surface unloads and its record is revoked. `change` fires, `rebind` calls the old unsubscribe and leaves nothing subscribed. |
| The provider is enabled again | A new record with a new emitter is published. `change` fires and `rebind` subscribes to the new emitter. |
| The consumer unloads | The watch stops, and the `register` callback drops the live subscription so the provider stops calling into an unloaded plugin. |

Three shortcuts look right and are wrong:

- **Subscribing once in `onload`.** It subscribes to nothing when the provider loads second, and it never hears from a re-enabled provider, whose emitter is a new one.
- **Subscribing on `change` without unsubscribing first.** Every disable-and-enable cycle of the provider then leaves one more subscription behind on an emitter that is never called again, and each one holds your listener in memory. Because `rebind` unsubscribes before it subscribes, there is never more than one.
- **Reading `ref.value` inside the teardown.** By then it is `null` or revoked. Keep the unsubscribe function you were given instead.

## When it is not available

`whenAvailable()` waits (10 seconds by default, configurable via `timeoutInMilliseconds`) and then rejects with a `PluginApiUnavailableError` carrying the reason:

| `PluginApiUnavailabilityReason` | What happened |
| --- | --- |
| `NotInstalled` | The plugin is not installed in this vault. |
| `NotEnabled` | It is installed but switched off. |
| `NotPublished` | It is running but published no API — likely too old to have one. |
| `VersionMismatch` | It published an API, but nothing satisfies your range. |
| `ShapeMismatch` | A satisfying record exists, but the object is missing a method the contract declares. |

`ref.unavailabilityReason` gives the same classification synchronously, for a caller that must decide now which message or button to show. It is `null` while the API is available, and like `ref.value` it describes this moment: a provider that has not loaded yet reads as `NotPublished`.

There is a sixth reason, `Revoked`, which `whenAvailable()` never reports: it describes a handle that *was* valid, and it arrives on a `PluginApiRevokedError` thrown by the handle itself. See [Revoked handles](#revoked-handles).

<!-- snippet-check: context interface SearchApi { search(query: string, options: { limit: number }): Promise<{ path: string; score: number }[]>; } -->
<!-- snippet-check: context declare const ref: import('@mnaoumov/obsidian-lib/plugin/plugin-api').PluginApiRef<SearchApi>; -->
```typescript
import { PluginApiUnavailableError } from '@mnaoumov/obsidian-lib/plugin/plugin-api';

try {
  const api = await ref.whenAvailable();
  await api.search('query', { limit: 10 });
} catch (error) {
  if (error instanceof PluginApiUnavailableError) {
    console.log(error.reason, error.pluginId);
  }
}
```

## When validation runs

Validation runs **only while the `obsidian-lib:validate-plugin-api-payloads` debug switch is on**, and it is off by default, so production pays no schema call. A debug switch is an app-wide boolean from `@mnaoumov/typescript-lib/debug-switches`, shared by every copy of the library loaded in the app: turn it on with `getValidatePluginApiPayloadsDebugSwitch().setEnabled(true)`, with `setDebugSwitch('obsidian-lib:validate-plugin-api-payloads', true)`, or from a debug-settings UI that lists `getDebugSwitches()`. The switch is checked per call, so flipping it at runtime takes effect without re-acquiring the handle. The `obsidian-lib:PluginApi` debugger does not turn validation on: a debug namespace controls logging only (see [Debugging](/obsidian-lib/guides/debugging/)).

A schema that answers **synchronously** throws a `PluginApiValidationError` at the call site — which is the point, because that is where the wrong assumption lives. A schema that answers with a **`Promise`** cannot do that: the synchronous call it was guarding has already returned by the time the answer arrives, so there is nothing left to throw into and the failure is logged through the `obsidian-lib:PluginApi` debugger instead, so turn that namespace on too to see it. Prefer synchronous schemas for anything you want to fail loudly.

Both sides may declare a contract, and **the consumer's wins when it supplies one** — it is the consumer's own compiled-against expectation, so its violation is the consumer's problem to see. With no consumer contract, the provider's published one is used.

### Why the contract is a map of methods, not one schema over the whole API

An API is a bag of functions, and in zod 4 `z.function()` returns a function *factory* rather than a schema, so it cannot be a `z.object()` member directly. There is a [known workaround](https://github.com/colinhacks/zod/issues/4143#issuecomment-2845134912):

```typescript
import { z } from 'zod/v4';

const functionSchema = <T extends z.core.$ZodFunction>(schema: T) =>
  z.custom<Parameters<T['implement']>[0]>((fn) => schema.implement(fn as Parameters<T['implement']>[0]));
```

It is genuinely useful if you want `z.infer` to produce your API type from a single schema. It does **not** give you runtime validation, though: `z.custom` is a boolean predicate that returns its input unchanged, so the validating wrapper `implement` builds is thrown away and the runtime check collapses back to "is it callable". Keeping the wrapper would take a further `.transform()` — and that would put validation on every call rather than behind the debug gate, and tie the contract to zod specifically, which is the coupling reaching through Standard Schema is meant to avoid.

So the contract declares method **names**, checked with a plain `typeof`, and validates **payloads** per method.

## Handing settings over

When a feature moves from one plugin to another, the settings the user configured for it have to move too — otherwise taking the suggestion to install the new plugin means re-entering everything by hand. That handover is a whole little protocol, and `SettingsMigrationComponent` is it, ready-made.

The envelope is generic, so both ends compile against one declaration:

<!-- snippet-check: context interface MyMigratableSettings { shouldHandleRenames: boolean; } -->
<!-- snippet-check: context declare const settingsMigrationApi: import('@mnaoumov/obsidian-lib/plugin/settings-migration-api').SettingsMigrationApi<MyMigratableSettings>; -->
```typescript
import type { PluginApiDeclaration } from '@mnaoumov/obsidian-lib/plugin/plugin-api';
import type { SettingsMigrationApi } from '@mnaoumov/obsidian-lib/plugin/settings-migration-api';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { getSettingsMigrationApiContract } from '@mnaoumov/obsidian-lib/plugin/settings-migration-api';

export class Plugin extends PluginBase {
  protected override getPluginApis(): PluginApiDeclaration[] {
    // The payload type is yours; the envelope is not.
    const declaration: PluginApiDeclaration<SettingsMigrationApi<MyMigratableSettings>> = {
      api: settingsMigrationApi,
      apiVersion: '1.0.0',
      contract: getSettingsMigrationApiContract<MyMigratableSettings>()
    };
    return [declaration];
  }
}
```

The consumer parks the values it no longer acts on in its own settings, and lets the component do the rest:

<!-- snippet-check: context interface MyMigratableSettings { shouldHandleRenames: boolean; } -->
<!-- snippet-check: context interface MyPluginSettings { proposedShouldHandleRenames: boolean | null; } -->
<!-- snippet-check: context declare const settingsComponent: import('@mnaoumov/obsidian-lib/components/plugin-settings-component').PluginSettingsComponentBase<MyPluginSettings>; -->
```typescript
import { SettingsMigrationComponent } from '@mnaoumov/obsidian-lib/components/settings-migration-component';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

export class Plugin extends PluginBase {
  protected override onloadImpl(): void {
    // `settingsComponent` is your own `PluginSettingsComponentBase<MyPluginSettings>`.
    this.addChild(new SettingsMigrationComponent<MyMigratableSettings>({
      apiVersionRange: '^1',
      app: this.app,
      getProposedSettings: () => {
        const pending = settingsComponent.settings.proposedShouldHandleRenames;
        return pending === null ? null : { shouldHandleRenames: pending };
      },
      pluginSettingsComponent: settingsComponent,
      providerPluginId: 'their-plugin-id',
      retireProposedSettings: async () => {
        await settingsComponent.editAndSave((settings) => {
          settings.proposedShouldHandleRenames = null;
        });
      },
      sourcePluginId: this.manifest.id
    }));
  }
}
```

Your plugin **proposes**; it never writes into another plugin's `data.json`. The provider owns the settings, so it owns the dialog, and the user approves, edits or declines.

Four things the component gets right, each of which is a bug the first time you write this by hand:

- **It gates on nothing during `onload`.** Your settings component is a sibling whose own read of `data.json` is still in flight, so a pending value read there still looks like its default. Deciding then would lose the migration permanently on exactly the vaults that have one. Both edges — the provider appearing, and your settings arriving — are wired instead, in either order, and each re-reads the current state.
- **It watches rather than waits.** `whenAvailable()` would block for ten seconds and then throw for every user who simply does not have the provider installed. Watching costs nothing while it is absent and offers the migration the moment it appears, including right after the user installs it from a `PluginSuggestionComponent` banner.
- **A cancel is not an answer.** `retireProposedSettings` is called only when `isApplied` comes back `true`, so a declined offer comes back on the next load.
- **The retirement has to be persisted.** Use `editAndSave`, not `setProperty` — the latter edits only the in-memory state, so the retirement is forgotten on the next reload and the offer returns forever.

The component's `contract` defaults to `getSettingsMigrationApiContract()`, which declares `migrateSettings` and nothing else. If you pass your own, keep it **narrow**. A migration usually needs one method that has existed since the provider's first contract version, while the same plugin may read other parts of that API through a much newer one. Declaring the wider expectation here would refuse the migration to a user on an older provider — precisely the user who still has settings to migrate.

## A note on library copies

Every plugin bundles its own copy of this library, so a registry record travels between **different library versions**. The record therefore holds nothing but plain data and plain functions, and every read of it is structural — never `instanceof`. You do not have to do anything about this; it just means a provider on an old library version and a consumer on a new one keep working.

## Requiring another plugin

Everything above assumes your plugin keeps working when the other one is absent. Sometimes it cannot: the behavior it advertises simply is not there. Obsidian gives a manifest no dependency field, so the usual outcome is a plugin that half-works and a user who has no way to know why.

Declare the dependency instead:

```typescript
import type { PluginDependency } from '@mnaoumov/obsidian-lib/components/plugin-gate-component';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

export class Plugin extends PluginBase {
  protected override getPluginDependencies(): PluginDependency[] {
    return [{
      apiVersionRange: '^2',
      pluginId: 'their-plugin-id',
      pluginName: 'Their Plugin',
      reason: 'Handles renames and deletes so links stay correct.'
    }];
  }
}
```

While that dependency is missing, disabled, or outside `apiVersionRange`, your `onloadImpl` **does not run**. No command is registered, no handler installed, nothing patched. What the user gets instead is a notice naming the plugin, and a settings tab standing in for the one you never got to register — carrying your `reason`, a button that installs and enables the dependency, and, once it is there, a link straight into its settings.

The contract version cannot see a provider whose behavior changed while its API stayed the same. When you rely on such a change, add `minPluginVersion: '2.2.0'`: a dependency enabled below that release counts as unsatisfied too, and the notice asks the user to update it. The version is read from the provider's manifest, and one that cannot be parsed counts as too old. A provider whose published contract falls outside `apiVersionRange` gets the same "update it" notice. So does one that is enabled and running but publishes no API your plugin can read, or one whose shape fails the contract: the notice says it is enabled and asks for an update, rather than asking the user to install and enable a plugin that already is. The usual cause is a provider built on a copy of this library older than `6.0.0`, which publishes under a name `6.0.0` and later never read.

An enabled dependency that is still unsatisfied gets an `Update` button in place of the install button. It installs the provider's latest release over the old one through Obsidian's own install path, which reloads the plugin, so your load completes as soon as the update lands. If the provider is already at its latest release, the notice says that no update can help yet. `updateCommunityPlugin` in `@mnaoumov/obsidian-lib/community-plugins` is the same update as a function.

The moment the dependency arrives, your load completes. No restart, no toggle. And if it later goes away, the feature surface is torn down again and the user is told at that instant — which is the point. The failure this prevents is not "a plugin is missing"; it is a user removing an unfamiliar plugin months later and meeting the damage weeks after that, with nothing connecting the two.

Three deliberate choices, each with an obvious-looking alternative:

- **Blocked means enabled-but-inert, never self-disabled.** Calling `disablePluginAndSave` on yourself is the literal reading of "refuses to load", and it rewrites a config that belongs to the user — who then has to remember to re-enable you after fixing the dependency.
- **Blocked is not an error.** Throwing from `onload` marks the plugin failed and hands the user a stack trace where a sentence and a button belong.
- **A dependency must publish an API.** That is what makes presence, absence, version and departure all observable through one mechanism. A provider with nothing to expose can publish an empty API purely so it can be depended upon — which is cheaper than a second, weaker detection path beside the registry.

Reach for `PluginSuggestionComponent` instead whenever the other plugin merely **adds** something. The two are siblings, and the question that separates them is whether your plugin still does what it says on the tin.

## Refusing to run beside another plugin

The mirror image of a dependency. Two plugins that took over the same behavior — an old release of another plugin that still owns a handler you now own, or two plugins registering the same command — collide, and there is usually no way to win that collision from inside: a handler is elected by registry order, but the patches doing the work sit outside that election, so whichever plugin loaded first keeps a hand on the wheel. Refusing deterministically beats competing unpredictably.

Declare the overlap:

```typescript
import type { PluginConflict } from '@mnaoumov/obsidian-lib/components/plugin-gate-component';

import { PluginConflictSeverity } from '@mnaoumov/obsidian-lib/components/plugin-gate-component';
import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';

export class Plugin extends PluginBase {
  protected override getPluginConflicts(): PluginConflict[] {
    return [{
      conflictingVersionRange: '<12.0.0',
      pluginId: 'their-plugin-id',
      pluginName: 'Their Plugin',
      reason: 'Both would act on the same rename, and two handlers corrupt links.',
      severity: PluginConflictSeverity.Block
    }];
  }
}
```

`Block` behaves exactly like an unsatisfied dependency: `onloadImpl` does not run, and the user gets a notice plus a stand-in settings tab carrying your `reason`, a button that disables the other plugin, and a link into its settings. `Warn` is for an overlap that is annoying rather than destructive — a duplicated command, work done twice — where refusing to load would cost the user more than the overlap does. Both plugins keep running, the user is told once, and you can place the same explanation in your own settings tab:

```typescript
import type { PluginGateComponent } from '@mnaoumov/obsidian-lib/components/plugin-gate-component';
import type { App } from 'obsidian';

import { PluginBase } from '@mnaoumov/obsidian-lib/plugin/plugin';
import { PluginSettingTab } from 'obsidian';

class MySettingTab extends PluginSettingTab {
  private readonly pluginGateComponent: PluginGateComponent;

  public constructor(app: App, plugin: PluginBase, pluginGateComponent: PluginGateComponent) {
    super(app, plugin);
    this.pluginGateComponent = pluginGateComponent;
  }

  public override display(): void {
    this.containerEl.empty();
    this.pluginGateComponent.renderConflictWarningBanner(this.containerEl);
    // Your own settings follow.
  }
}

export class Plugin extends PluginBase {
  protected override onloadImpl(): void {
    // `pluginGateComponent` is protected, so the plugin hands it to its settings tab.
    this.addSettingTab(new MySettingTab(this.app, this, this.pluginGateComponent));
  }
}
```

Three things about the detection are worth knowing, because each has a plausible-looking alternative:

- **It reads the other plugin's VERSION, not the registry.** A plugin that has not loaded yet has registered nothing, so the registry answers differently depending on when it is asked, while `app.plugins.manifests` is populated for everything installed before any of them load. Unlike a dependency, a conflicting plugin need not publish anything at all.
- **Only enabled plugins count, and an unparseable version counts as conflicting.** A disabled plugin registers nothing, so refusing over it would be an alarm the user can only answer by uninstalling something they already switched off. Failing closed on a version it cannot read is the other direction of the same care: a false alarm costs a notice, a false all-clear costs a vault.
- **Obsidian raises no event for another plugin being enabled or disabled.** A conflicting plugin built on this library announces itself through the `obsidian-lib:plugin-loaded` / `-unloaded` broadcast below, so it is caught the moment it is toggled. Any other plugin is caught at your next load. That is a real ceiling, not an oversight.

`conflictingVersionRange` is a range rather than a minimum, so an overlap confined to one major is expressible as `'>=3 <4'`. Spell "every version conflicts" as `'>=0.0.0'` — `compare-versions` rejects a bare `*`.

## Knowing when a plugin loads

Every `PluginBase` announces itself on `app.workspace`:

```typescript
import {
  PLUGIN_LOADED_EVENT_NAME,
  PLUGIN_UNLOADED_EVENT_NAME
} from '@mnaoumov/obsidian-lib/plugin/plugin-lifecycle-events';
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  public override onload(): void {
    this.registerEvent(this.app.workspace.on(PLUGIN_LOADED_EVENT_NAME, (payload) => {
      console.log(payload.pluginId, payload.apiVersions);
    }));
    this.registerEvent(this.app.workspace.on(PLUGIN_UNLOADED_EVENT_NAME, (payload) => {
      console.log(payload.pluginId);
    }));
  }
}
```

`obsidian-lib:plugin-loaded` fires only after every API that plugin declares has been published, so a listener may call them immediately. The payload carries `pluginId`, `pluginName`, `pluginVersion`, `apiVersions`, and `dependencyPluginIds` — the last of which is how a provider answers "which installed plugins depend on me", something the registry cannot tell it.

It deliberately carries **no API handle**. A handle delivered by a one-shot event is a probe: it answers "now" and never says when "now" changed, and one that outlives its provider is exactly the stale handle the revocable handles exist to prevent. Hold a `PluginApiRef` for that.

Because it rides Obsidian's own event source rather than anything belonging to this library, a plugin that does not use this library at all can still listen. A `trigger` has no replay, though, so a listener that starts late reads the current state once and uses the events for the transitions after that.

Those two names, their payload, and the registry the APIs themselves sit in are a frozen, documented protocol. [Plugin API protocol](/obsidian-lib/guides/plugin-api-protocol/) writes all of it down for a consumer who will never install this library — including the part `watchPluginApi` hides from you, which is how a published API is actually located and which version wins.

## Plugins that publish no API

Most plugins publish nothing through the registry, so everything above has nothing to watch. For those, `@mnaoumov/obsidian-lib/plugin/plugin-instance` reaches the plugin INSTANCE instead:

```typescript
import type { Plugin } from 'obsidian';

import {
  getLoadedPlugin,
  getPluginAvailability,
  waitForPlugin
} from '@mnaoumov/obsidian-lib/plugin/plugin-instance';
import { Plugin as ObsidianPlugin } from 'obsidian';

interface DataviewPlugin extends Plugin {
  readonly api: object;
}

function isDataviewPlugin(plugin: Plugin): plugin is DataviewPlugin {
  return 'api' in plugin;
}

export default class MyPlugin extends ObsidianPlugin {
  public override async onload(): Promise<void> {
    // Synchronous: the instance, or `null` while it is missing, disabled or still loading.
    const dataview = getLoadedPlugin<DataviewPlugin>({ app: this.app, isPlugin: isDataviewPlugin, pluginId: 'dataview' });

    // Why it is not there: 'notInstalled', 'notEnabled', 'notLoaded', 'loading', 'outdated', ...
    console.log(getPluginAvailability({ app: this.app, minPluginVersion: '0.5.0', pluginId: 'dataview' }));

    // Waits for it, by default for 10 seconds; ends early when this plugin unloads.
    const waited = await waitForPlugin<DataviewPlugin>({ app: this.app, component: this, isPlugin: isDataviewPlugin, pluginId: 'dataview' });
    console.log(dataview, waited.api);
  }
}
```

What "loaded" means here, read from Obsidian `1.15.1`: Obsidian stores a plugin's instance before it awaits its `onload`, so `app.plugins.getPlugin` can hand you a plugin that is still loading. These helpers count it as available only once `onload` has settled. That is the most anything can promise: a plugin that starts more work without awaiting it, or waits for layout-ready, is "loaded" before that work is done, and Obsidian has no hook saying every plugin has finished initializing.

The type argument alone is your assertion, not a check. Pass `isPlugin` and an instance that fails it reads as `shapeMismatch`, the usual sign of a release that renamed what you use. `minPluginVersion` is a plugin RELEASE compared with its `manifest.version`; it is not the API contract version `apiVersionRange` negotiates.

`waitForPlugin` resolves at once when the plugin is already there, which covers your plugin being reloaded after its dependency. Otherwise it listens to `app.plugins`, which triggers `changed` after every enable, disable, install and uninstall, and to the `obsidian-lib:plugin-loaded` broadcast, so nothing polls. It subscribes before it first looks, so a change in between cannot be missed, and it removes every listener when it settles. A timeout rejects with `PluginInstanceUnavailableError`, whose `availability` says what was wrong at that moment; an `abortSignal` or the unload of `component` rejects with the abort reason.

When your plugin cannot go on without the other one, ask the user:

```typescript
import { PluginNoticeComponent } from '@mnaoumov/obsidian-lib/components/plugin-notice-component';
import { requirePlugin } from '@mnaoumov/obsidian-lib/plugin/plugin-instance';
import { Plugin } from 'obsidian';

export default class MyPlugin extends Plugin {
  public override async onload(): Promise<void> {
    const pluginNoticeComponent = new PluginNoticeComponent({ app: this.app, pluginName: this.manifest.name });
    this.addChild(pluginNoticeComponent);

    const dataview = await requirePlugin({
      app: this.app,
      component: this,
      minPluginVersion: '0.5.0',
      pluginId: 'dataview',
      pluginName: 'Dataview',
      pluginNoticeComponent,
      requestingPluginName: this.manifest.name
    });
    console.log(dataview.manifest.version);
  }
}
```

`requirePlugin` waits like `waitForPlugin`, with no timeout unless you pass one. Once the layout is ready (before that, a plugin Obsidian has not reached yet looks exactly like a missing one), it shows a notice saying what is wrong, with the button that fixes it: install, enable, or update, plus a way to the community plugins list. The notice follows the state as it changes and goes away when the plugin arrives. A repair that fails is reported and the wait goes on, so the user can try again. A `PluginBase` plugin passes its own `pluginNoticeComponent` and `this`.

It settles once, and that is the line between it and [Requiring another plugin](#requiring-another-plugin). `requirePlugin` is for an optional feature, or a one-time step, that needs the other plugin when it runs. A plugin that must stop working whenever the other one goes away declares a `PluginDependency` instead, which owns that teardown; a second teardown mechanism beside it would only conflict with it.
