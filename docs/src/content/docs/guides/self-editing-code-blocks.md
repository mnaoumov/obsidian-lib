---
title: Self-editing code blocks
description: Rewrite a code block's own source from its rendered element, keep the focus and plugin state across the re-render, and inside callouts.
---

A code block processor often renders controls that change the block's own source: a counter, a checkbox, a small settings form. `@mnaoumov/obsidian-lib/markdown-code-block-processor` has the helpers that do the write, and `@mnaoumov/obsidian-lib/code-block-render-handoff` carries what the write would otherwise lose.

## Rewrite the block

`replaceCodeBlock` finds the block the processor rendered and replaces it. It locates the block from the rendered element and its source, not from `ctx.getSectionInfo(el)`, so it also works where that returns `null`, such as inside a callout. Pass `shouldPreserveLinePrefix: true` there, so the new block keeps the callout's quote prefix.

<!-- snippet-check: context declare const el: HTMLElement; declare const ctx: import('obsidian').MarkdownPostProcessorContext; declare const source: string; -->

```ts
import { replaceCodeBlock } from '@mnaoumov/obsidian-lib/markdown-code-block-processor';

await replaceCodeBlock({
  app,
  codeBlockProvider: '```counter\ncount: 2\n```',
  context: ctx,
  el,
  resourceLockComponent: null,
  shouldPreserveLinePrefix: true,
  source
});
```

When the note is open in an editor, Obsidian applies the write as one change, so the user can undo it with one `Ctrl+Z` and the cursor stays where it was.

## Keep the focus and the state

Obsidian renders the block again whenever its source changes: Reading view renders the section again, and Live Preview replaces the widget. The new render is a new element, so the focus is lost, and so is anything the plugin kept on the old element. The element itself cannot be kept without patching Obsidian's renderers. Instead, the write records a handoff, and the processor rendering the new source claims it.

- `shouldCarryFocusToNextRender: true` records which element inside `el` has the focus, and the text selection in it.
- `nextRenderState` passes any value to the next render.

<!-- snippet-check: context declare const el: HTMLElement; declare const ctx: import('obsidian').MarkdownPostProcessorContext; declare const source: string; declare const clicks: number; -->

```ts
import { replaceCodeBlock } from '@mnaoumov/obsidian-lib/markdown-code-block-processor';

await replaceCodeBlock({
  app,
  codeBlockProvider: `\`\`\`counter\ncount: ${String(clicks + 1)}\n\`\`\``,
  context: ctx,
  el,
  nextRenderState: { clicks: clicks + 1 },
  resourceLockComponent: null,
  shouldCarryFocusToNextRender: true,
  source
});
```

In the processor, render first, then claim the handoff and restore the focus. `restoreFocus()` waits for the new element to be attached, puts the focus on the element at the same position, and puts the text selection back.

<!-- snippet-check: context declare const plugin: import('obsidian').Plugin; -->

```ts
import { claimCodeBlockRenderHandoff } from '@mnaoumov/obsidian-lib/code-block-render-handoff';

plugin.registerMarkdownCodeBlockProcessor('counter', async (source, el, ctx) => {
  el.createEl('input', { type: 'text', value: source });

  const handoff = claimCodeBlockRenderHandoff({ context: ctx, el, source });
  if (handoff) {
    console.log(handoff.state);
    await handoff.restoreFocus();
  }
});
```

A handoff is matched by the note path, the language and the new source, and lives for 10 seconds. The first render that claims it consumes it, so when the note is open in two panes only one of them gets it.
