---
title: Rendered Markdown
description: Render markdown outside a note and make its links, footnotes and headings act as they do in a Reading view.
---

`MarkdownRenderer.render` turns markdown into HTML anywhere: a modal, a view, a settings tab, a popover. What it does not do is make that HTML behave. In a Reading view, Obsidian's preview renderer handles every click on a link, a footnote or a fold indicator, and markdown rendered elsewhere has no preview renderer behind it. `@mnaoumov/obsidian-lib/markdown` fills that gap.

## Render and wire it up

`fullRender` renders the markdown, embeds included, and optionally wires up the behavior:

```typescript
import { fullRender } from '@mnaoumov/obsidian-lib/markdown';

await fullRender({
  app,
  el: containerEl,
  markdown: '# Notes\n\nSee [[Some note]] and the footnote[^1].\n\n[^1]: Like this one.',
  shouldRegisterFoldHandlers: true,
  shouldRegisterLinkHandlers: true,
  sourcePath: file.path
});
```

For markdown rendered some other way, call the two registrations on the element it was rendered into:

```typescript
import { registerLinkHandlers } from '@mnaoumov/obsidian-lib/markdown';
import { registerFoldHandlers } from '@mnaoumov/obsidian-lib/rendered-markdown';

registerLinkHandlers({ app, el: containerEl, sourcePath: file.path });
registerFoldHandlers({ el: containerEl });
```

## Links

`registerLinkHandlers` makes the links act as core links do:

- a click opens an internal link, mod-click and middle-click open it in a new tab, and a drag drags it;
- hovering an internal link raises the page preview, and hovering a footnote reference previews the footnote;
- right-clicking a link opens Obsidian's own link context menu, so every plugin that adds to `file-menu` or `url-menu` shows up there;
- an external link opens in the browser, and a tag opens the search for it;
- a footnote reference scrolls to its footnote and flashes it, and the footnote's back link scrolls back. Without this, the click falls through to the browser's hash navigation.

Obsidian's own `MarkdownPreviewRenderer.registerDomEvents` decides which element an event landed on; the library supplies what each event does, which Obsidian keeps private. Links inside an embedded note are left to that embed's own handlers.

## Folding

`registerFoldHandlers` adds Obsidian's collapse indicators to every heading and to every list item with a nested list, and handles their clicks. A folded heading hides every block below it up to the next heading of the same or a higher level, and a folded list item hides its nested lists. A footnote click unfolds whatever hides its target. `shouldFoldHeadings: false` or `shouldFoldLists: false` leaves either kind alone.

It is opt-in, because it adds elements to the rendered markdown. Call it again after re-rendering into the same element: blocks that already have an indicator are left as they are.

The indicators sit in the margin to the left of their heading or list item, as in a Reading view, so give the element enough left padding to show them. Their layout comes from the library's styles; see [Styling](/obsidian-lib/guides/styling/).
