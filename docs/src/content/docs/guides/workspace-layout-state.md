---
title: Workspace Layout State
description: Keep plugin state with the workspace layout, so each saved workspace restores its own values.
---

Plugin settings live in one `data.json`, so every workspace sees the same value. Some state belongs to a layout instead: a panel width, a filter for one sidebar, a mode chosen for one tab. Saving it with the layout lets each saved workspace remember its own value, and loading a workspace restores it.

## Plugin-owned views: use `getState` and `setState`

A view your plugin registers needs nothing from this library. Obsidian already stores the result of `View.getState()` in each leaf's serialized state, in `workspace.json` and in every saved workspace. It hands that state back to `View.setState()` when the leaf is restored, popouts included. Keep that state in the view, and call `app.workspace.requestSaveLayout()` after it changes.

## Everything else: `WorkspaceLayoutStateComponent`

`getState` and `setState` cannot hold state for the layout as a whole, or for a leaf showing a view your plugin does not own. `WorkspaceLayoutStateComponent` covers both. Each key is typed and namespaced by your plugin id, and it reads as its default until a value is stored.

```ts
import { WorkspaceLayoutStateComponent } from '@mnaoumov/obsidian-lib/components/workspace-layout-state-component';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    const layoutState = this.addChild(new WorkspaceLayoutStateComponent({ app: this.app, pluginId: this.manifest.id }));
    const isCompact = layoutState.defineKey({
      defaultValue: false,
      isValid: (value): value is boolean => typeof value === 'boolean',
      key: 'isCompact'
    });

    const apply = (): void => {
      this.app.workspace.containerEl.toggleClass('alpha-compact', isCompact.get());
    };

    this.app.workspace.onLayoutReady(apply);
    layoutState.onLayoutLoad(apply);
    isCompact.onChange(apply);

    this.addCommand({
      callback: () => {
        isCompact.set(!isCompact.get());
      },
      id: 'toggle-compact',
      name: 'Toggle compact mode for this workspace'
    });
  }
}
```

Pass a leaf to any method of a key to scope the value to that leaf, for example `isCompact.get(leaf)` or `isCompact.set(true, leaf)`. A leaf in a popout window works the same way.

## Values and their lifecycle

1. A value must be JSON-safe: plain objects, arrays, strings, finite numbers, booleans and `null`. `set` throws a `TypeError` on anything else. Values are cloned on write and on read, so changing a value you hold never changes the stored one.
2. A missing value reads as the default. So does a stored value that fails the key's `isValid` guard, which stays stored until it is replaced or unset. `null` is a value: `set(null)` stores `null`, and `unset()` removes the value.
3. `set` and `unset` request a layout save, and every key handle subscribed through `onChange` hears about the change, including handles of other plugins' copies of this library with the same plugin id.
4. Loading a layout REPLACES every value. That happens when a saved workspace loads, when the layout is restored at startup, and once when the component first loads after layout-ready. In that last case it reads the saved `workspace.json` and keeps whatever you set in the meantime. Re-read your values in `onLayoutLoad`, which runs once the layout's leaves exist.
5. Values set before layout-ready are replaced by the restored layout, so write them in `onLayoutReady` or later.

## What is saved, and when it is lost

The values are written into the serialized layout under the `obsidianLibLayoutStateV1` key, grouped by plugin id. That is the same object Obsidian saves to `workspace.json` and the Workspaces core plugin saves into each workspace. Leaf values are dropped once their leaf is no longer in the layout. Values of other plugins, and fields this version of the library does not know, are kept as they are. A malformed record is ignored one part at a time: a malformed plugin entry drops that plugin only, and a malformed leaf entry drops that leaf only.

The values ride only while at least one plugin using this component is enabled. With none enabled, Obsidian's next save of `workspace.json` leaves the key out. A saved workspace keeps its values until it is saved again. Disabling and re-enabling one plugin within a session loses nothing, because the values stay in memory.

## Choosing the right store

1. Plugin settings (`PluginSettingsComponentBase`, `data.json`): one value per vault, synced with the vault, and the right place for anything the user configures.
2. `LocalDataStore`: one value per device, never synced, for caches and device-local records.
3. Workspace layout state: one value per layout, saved with `workspace.json` and with each saved workspace. It follows the layout rather than the user's configuration.
