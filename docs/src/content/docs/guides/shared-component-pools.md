---
title: Shared Component Pools
description: Share one loaded component per key among several consumers, and unload it after the last one releases it.
---

Some components are expensive to run twice: a watcher that follows one note's changes, or a renderer that keeps a parsed copy of a file. When several panels show the same note, each panel wants that component, and none of them owns it, because any panel can close first. `SharedComponentPoolComponent` keeps one loaded instance per key, hands it to every consumer, and unloads it when the last consumer lets go.

## When `addChild` is enough

Most components have one owner. A component that only one panel, one modal or the plugin itself uses is that owner's child: `this.addChild(component)` loads it with its owner and unloads it with its owner, and nothing else is needed. Reach for a pool only when two or more independent consumers want the same instance, and the instance must outlive whichever of them closes first.

## Two panels sharing one watcher

The pool is a component, and its parent owns every shared instance. Add it to the plugin, give it a factory that builds the component for a key, and let each panel acquire by key.

<!-- snippet-check: context declare class NoteWatcherComponent extends Component { constructor(app: App, path: string); } -->

```ts
import type { App } from 'obsidian';

import { SharedComponentPoolComponent } from '@mnaoumov/obsidian-lib/components/shared-component-pool-component';
import {
  Component,
  ItemView,
  Plugin
} from 'obsidian';

export class AlphaPlugin extends Plugin {
  public watcherPool!: SharedComponentPoolComponent<string, NoteWatcherComponent>;

  public override onload(): void {
    this.watcherPool = this.addChild(
      new SharedComponentPoolComponent<string, NoteWatcherComponent>({
        createComponent: (path: string): NoteWatcherComponent => new NoteWatcherComponent(this.app, path)
      })
    );
  }
}

export class NotePanelView extends ItemView {
  public constructor(leaf: ConstructorParameters<typeof ItemView>[0], private readonly plugin: AlphaPlugin, private readonly path: string) {
    super(leaf);
  }

  public override getDisplayText(): string {
    return this.path;
  }

  public override getViewType(): string {
    return 'alpha-note-panel';
  }

  public override async onOpen(): Promise<void> {
    const acquisition = await this.plugin.watcherPool.acquire(this.path, { consumer: this });
    const watcher = acquisition.component;
    // Read from the watcher. Closing this panel releases the acquisition automatically.
    console.debug(watcher);
  }
}
```

With two `NotePanelView`s open on the same note, the factory runs once and both panels receive the same watcher. Closing the first panel unloads that view, which releases its acquisition; the watcher keeps running for the second. Closing the second releases the last acquisition, and the pool unloads the watcher. Opening a panel on that note again builds a fresh watcher.

The `consumer` option is what ties the release to the panel's own unload. Without it, release the acquisition yourself: call `release()`, or declare it with `using` so the block's end releases it. Release is idempotent, so a consumer link and a manual call never release twice.

## What the pool guarantees

1. **One load, shared.** The first acquire of a key calls the factory and loads the component. A `ComponentEx` loads through `loadWithPromises()`, so every acquire of that key, the concurrent ones included, resolves only once its `onloadAsync` and its children have settled.
2. **One unload.** The release of the last acquisition unloads the component exactly once, and the next acquire of the key builds a new one.
3. **Failures leave the pool usable.** A factory that throws, or a load that fails, rejects every acquire waiting for that key, unloads what was built, and frees the key, so a later acquire tries again from scratch.
4. **Cancellation.** An `abortSignal` cancels an acquire that is still waiting for the load, and so does the unload of its `consumer`. When the cancelled acquire was the last one waiting, the half-loaded component is unloaded, and the load finishing later does not bring it back.
5. **Owner unload.** Unloading the pool's owner unloads every shared component still held, rejects every waiting acquire with a `SilentError`, and refuses every later acquire. Releasing an acquisition after that does nothing.
6. **Isolation.** Keys are compared the way a `Map` compares them, so two equal-looking object keys are two resources; use a string such as the note path when equal values should share. The instances live on the pool object, never in the library's cross-plugin shared state, so two plugins, or two pools in one plugin, never share an instance.
7. **No acquiring from inside a creation.** Acquiring a key from inside that key's own factory, or from its synchronous `onload`, is refused with an error, since the component cannot wait for itself. Acquiring a different key from a factory works. Do not await an acquire of the same key from its own `onloadAsync` either: that load would then wait for itself.

`getConsumerCount(key)` reports how many acquisitions hold a key, pending ones included, which is handy in tests.
