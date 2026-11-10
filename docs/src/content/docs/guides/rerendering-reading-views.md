---
title: Rerendering Reading views
description: Render the open Reading views again after a processor's settings change, and wait until they show the change.
---

A markdown post-processor or code block processor runs when a Reading view renders a section. A view that was rendered before the plugin loaded, or before the user changed one of its settings, keeps showing the old output until something renders it again. `rerenderPreviews` from `@mnaoumov/obsidian-lib/markdown-view` does that, and its promise settles once the views show the change.

## Every Reading view

<!-- snippet-check: context declare const app: import('obsidian').App; -->

```typescript
import { rerenderPreviews } from '@mnaoumov/obsidian-lib/markdown-view';

await rerenderPreviews({ app });
```

This is the refresh Obsidian itself makes when a post-processor is registered: every section of every Markdown view is rendered again, in every window, popouts included. The header and the footer are left alone, so the inline title, the properties and the backlinks keep their elements. The note is never written, the view mode never changes, and the scroll position is restored once the view has rendered.

## Only one language

A code block processor whose settings changed needs only its own blocks rendered again:

<!-- snippet-check: context declare const app: import('obsidian').App; -->

```typescript
import { rerenderPreviews } from '@mnaoumov/obsidian-lib/markdown-view';

await rerenderPreviews({ app, language: 'my-language' });
```

A section is rendered again when it holds a fenced block of exactly that language, the match Obsidian makes for a code block processor: case-sensitive, so `My-language` is another language. Other processors do not run, and a view holding no such block is not touched. When no view holds one, the promise settles at once.

## When the promise settles

The promise settles once every view shown in Reading view has finished rendering, including the promises that asynchronous post-processors return. Obsidian does not render a preview that is not shown, such as a background tab or a view in editing mode, so such a view is only marked: it renders the change when it is next shown, and is not waited for. A view that is closed, hidden or switched to editing mode while it renders stops being waited for.

A post-processor whose promise never settles, or rejects, keeps its view's render open, just as it keeps Obsidian's own render open. Pass an `abortSignal` to bound the wait. Aborting rejects the promise with the signal's reason and leaves the requested renders to finish on their own.

<!-- snippet-check: context declare const app: import('obsidian').App; -->

```typescript
import { rerenderPreviews } from '@mnaoumov/obsidian-lib/markdown-view';

await rerenderPreviews({ abortSignal: AbortSignal.timeout(10_000), app });
```

## What it does not cover

Hover popovers, embeds, canvas cards and Live Preview widgets are not refreshed. Live Preview renders a code block widget again whenever its source changes, and an embed renders again when it is opened.
