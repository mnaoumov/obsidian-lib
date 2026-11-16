---
title: Windows and Popouts
description: Apply window-specific behavior with automatic cleanup.
---

Obsidian's main window and desktop popouts have separate documents. Use the window passed to your callback for DOM access. Mobile has only the main window.

## Apply behavior to every window

`forEachWindow` calls your handler for the main window immediately, then for existing popouts after layout ready and for later `window-open` events. Return a synchronous cleanup function to undo each window's changes when that window closes or the owning component unloads. Each registration visits a window once.

```ts
import { forEachWindow } from '@mnaoumov/obsidian-lib/components/all-windows-event-component';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    forEachWindow({
      app: this.app,
      callback(win) {
        const marker = win.document.body.createDiv({ text: 'Alpha is enabled' });
        return () => {
          marker.remove();
        };
      },
      component: this
    });
  }
}
```

The owner must already be loaded, as it is inside `Plugin.onload`. `forEachWindow` returns an `AllWindowsEventComponent` child. Call `owner.removeChild(registration)` to stop early. For a one-time snapshot without subscriptions or cleanup, use `getAllDomWindows(app)` from `@mnaoumov/obsidian-lib/workspace`.

## Body classes

Add a body class to the main window only, for example with `document.body.addClass(...)` and a matching `register` cleanup. Obsidian copies the main window's body classes to every popout and keeps them in step while the popout lives, removals included. It also copies the main body's `--` CSS variables. So a class on the main body reaches every popout with no library code. This was read from Obsidian `1.15.1`, and the desktop integration test checks it against a real popout.

## What Obsidian relays by itself

Read from Obsidian `1.15.1` and checked by `core-popout-relay.desktop.obsidian.integration.test.ts` against a real popout:

- **Body classes and `--` variables** on the main body reach every popout, as above.
- **Style elements**: Obsidian clones every `<style>` and `<link rel="stylesheet">` element in the main window's `<head>` into each popout and keeps them in step. A constructed sheet in `document.adoptedStyleSheets` is NOT copied, which is why `registerStyle` adopts one sheet per window itself.
- **Events**: a popout re-dispatches a copy of these events on the main `window`: `auxclick`, `click`, `contextmenu`, `copy`, `cut`, `drag`, `dragend`, `dragenter`, `dragleave`, `dragover`, `dragstart`, `drop`, `fullscreenchange`, `keydown`, `keyup`, `mousedown`, `mousemove`, `mouseup` and `paste`. The copy goes to the main `window` only, never to the main `document`. A listener on `document` therefore misses popout events, and any other type stays in the popout: `focus`, `blur`, `focusin`, `focusout`, `input`, `wheel`, `resize`, `selectionchange` and the `pointer*` events. For those, and for any listener that must sit on a popout's own `document`, use `registerAllWindowsDomEvent` or `registerAllDocumentsDomEvent` below.

## Use the component directly

`AllWindowsEventComponent.registerAllWindowsHandler` supports the same returned cleanup. Its `registerAllWindowsDomEvent` and `registerAllDocumentsDomEvent` methods register DOM listeners across windows and remove them when the component unloads.

## Status-bar items in every window

`Plugin.addStatusBarItem` adds one item to the main window only. `registerAllWindowsStatusBarItem` is an optional desktop facility that adds one item to the main window and to every popout, including popouts opened later. It removes each item when its window closes or the owning component unloads. It removes only the items it created, held by reference, so it never touches another plugin's items.

You render the content. The library calls `render({ el, win })` when it creates the item in a window, and again for every window when you call `refresh()`. Write `render` so that a repeated call on the same element is safe, for example with `setText` or `empty()` followed by the new content.

```ts
import { registerAllWindowsStatusBarItem } from '@mnaoumov/obsidian-lib/components/all-windows-status-bar-item-component';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  private count = 0;

  public override onload(): void {
    const statusBarItem = registerAllWindowsStatusBarItem({
      app: this.app,
      component: this,
      pluginId: this.manifest.id,
      render: ({ el }) => {
        el.setText(`Alpha: ${String(this.count)}`);
      }
    });

    this.addCommand({
      callback: () => {
        this.count++;
        statusBarItem.refresh();
      },
      id: 'increment',
      name: 'Increment'
    });
  }
}
```

Passing `pluginId` adds the same `plugin-<id>` class that `addStatusBarItem` adds, so themes and CSS snippets that target your plugin's status-bar items match these items too. `getItemEl(win)` and `getItemEls()` return the current items.

**Popouts have no status bar.** In Obsidian `1.15.1`, a popout builds its workspace and no `.status-bar`. By default the component creates one inside the popout's `.app-container`, and Obsidian's own CSS lays it out like the main one. The created bar carries the `obsidian-lib-window-status-bar` class (`WINDOW_STATUS_BAR_CSS_CLASS`). Every copy of the library reuses a marked bar, and the copy that removes the last item from it removes the bar too. Pass `shouldCreateMissingStatusBar: false` to skip windows without a status bar instead.

**On mobile it does nothing.** Mobile has no popouts, and Obsidian hides the status bar there, so no item is created and `render` is never called.

## Notices and requests in popouts

Import `Notice` and `requestUrl` from `obsidian`. They are module exports, so access them through the import rather than expecting properties named `Notice` or `requestUrl` on a popout's `window`. The imported APIs work while a popout is active: `Notice` targets the active document, and `requestUrl` does not need a document. The desktop integration test exercises both against a real popout and a local HTTP server; no per-window API injection is required.
