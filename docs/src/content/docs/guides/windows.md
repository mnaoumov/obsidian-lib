---
title: Windows and Popouts
description: Apply window-specific behavior and body classes with automatic cleanup.
---

Obsidian's main window and desktop popouts have separate documents. Use the window passed to your callback for DOM access. Mobile has only the main window.

## Apply behavior to every window

`forEachWindow` calls your handler for the main window immediately, then for existing popouts after layout ready and for later `window-open` events. Return a synchronous cleanup function to undo each window's changes when that window closes or the owning component unloads. Each registration visits a window once.

`registerBodyClass` uses the same lifecycle for one plugin-specific CSS class. It removes the class on cleanup. Use a plugin-specific class owned exclusively by this registration: Obsidian can copy main-window body classes into a newly opened popout, so class presence alone cannot establish ownership.

```ts
import { forEachWindow, registerBodyClass } from '@mnaoumov/obsidian-lib/components/all-windows-event-component';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    registerBodyClass({ app: this.app, className: 'alpha-plugin-enabled', component: this });

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

The owner must already be loaded, as it is inside `Plugin.onload`. Both helpers return an `AllWindowsEventComponent` child. Call `owner.removeChild(registration)` to stop early. For a one-time snapshot without subscriptions or cleanup, use `getAllDomWindows(app)` from `@mnaoumov/obsidian-lib/workspace`.

## Use the component directly

`AllWindowsEventComponent.registerAllWindowsHandler` supports the same returned cleanup. Its `registerAllWindowsDomEvent` and `registerAllDocumentsDomEvent` methods register DOM listeners across windows and remove them when the component unloads.

## Notices and requests in popouts

Import `Notice` and `requestUrl` from `obsidian`. They are module exports, so access them through the import rather than expecting properties named `Notice` or `requestUrl` on a popout's `window`. The imported APIs work while a popout is active: `Notice` targets the active document, and `requestUrl` does not need a document. The desktop integration test exercises both against a real popout and a local HTTP server; no per-window API injection is required.
