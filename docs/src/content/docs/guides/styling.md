---
title: Styling
description: Initialize the plugin context so the extensible styles behind the library's UI controls are applied.
---

`@mnaoumov/obsidian-lib` provides some extensible styles that you can use to style your plugin UI controls.

In order to use those styles in your plugin, the plugin context has to be initialized.

If your plugin class extends `PluginBase` (it does if your project was generated using [create-obsidian-plugin](https://github.com/mnaoumov/create-obsidian-plugin)), this is handled automatically.

Otherwise, you need to initialize it manually:

```ts
import { Plugin } from 'obsidian';

import {
  initPluginContext
} from '@mnaoumov/obsidian-lib/plugin/plugin-context';

export class MyPlugin extends Plugin {
  public override onload(): void {
    initPluginContext(this.manifest.id);
    // ...
  }
}
```

Default styles are defined in [main.scss](https://github.com/mnaoumov/obsidian-lib/blob/main/src/styles/main.scss).

The list of css classes is defined in [css-class.ts](https://github.com/mnaoumov/obsidian-lib/blob/main/src/css-class.ts).

You can override those styles in your plugin's `styles.css` file via adding your plugin's id to the selector, e.g. for plugin `alpha-bravo`:

```css
.alpha-bravo.obsidian-lib :invalid {
  box-shadow: 0 0 0 2px var(--text-error);
}
```

Every element the library styles carries the `obsidian-lib` class, so a stylesheet scopes a rule to the library's elements by selecting `.obsidian-lib`.
