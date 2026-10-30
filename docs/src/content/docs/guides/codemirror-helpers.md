---
title: CodeMirror helpers
description: Reach every open editor, swap an editor extension at runtime, list a RangeSet, and keep an incremental Lezer parse of the document.
---

## Every open editor

`getAllMarkdownEditorViews` from `@mnaoumov/obsidian-lib/codemirror/markdown-editor-views` returns the CodeMirror `EditorView` of every open Markdown view, in every window. `dispatchToAllMarkdownEditorViews` dispatches the same transaction specs to each of them, which is how a plugin tells all its editors to recompute something after a setting changed.

```ts
import { Annotation } from '@codemirror/state';
import { dispatchToAllMarkdownEditorViews } from '@mnaoumov/obsidian-lib/codemirror/markdown-editor-views';

const settingsChanged = Annotation.define<boolean>();
dispatchToAllMarkdownEditorViews(app, { annotations: settingsChanged.of(true) });
```

A view in Reading mode is included, because it keeps its source editor alive and that editor would otherwise be stale when the user switches back. Only editors that live in a workspace leaf are reached; an editor in a canvas card, an editable embed or a hover popover is not.

## A reconfigurable editor extension

`ReconfigurableEditorExtensionComponent` from `@mnaoumov/obsidian-lib/components/reconfigurable-editor-extension-component` registers an extension once and lets you swap it later. `reconfigure` reaches every open editor and every editor opened afterwards.

```ts
import type { Extension } from '@codemirror/state';

import { ReconfigurableEditorExtensionComponent } from '@mnaoumov/obsidian-lib/components/reconfigurable-editor-extension-component';
import { PluginEditorExtensionRegistrar } from '@mnaoumov/obsidian-lib/editor-extension-registrar';
import { Plugin } from 'obsidian';

declare const highlightExtension: Extension;

class MyPlugin extends Plugin {
  private highlighting?: ReconfigurableEditorExtensionComponent;

  public override onload(): void {
    this.highlighting = this.addChild(
      new ReconfigurableEditorExtensionComponent({
        app: this.app,
        editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this)
      })
    );
  }

  public toggleHighlighting(isOn: boolean): void {
    this.highlighting?.reconfigure(isOn ? highlightExtension : []);
  }
}
```

The extension lives in a CodeMirror `Compartment`. A reconfigure dispatches the compartment's reconfigure effect to the open editors and swaps the entry in the registered array, which new editors read. That avoids `workspace.updateOptions()`, which Obsidian describes as fairly expensive. Obsidian cannot unregister an editor extension, so unloading the component empties the compartment instead.

## Listing a RangeSet

`rangeSetToArray` from `@mnaoumov/obsidian-lib/codemirror/range-set` lists a `RangeSet`, such as a `DecorationSet`, as plain `{ from, to, value }` objects in document order. It is meant for test assertions and debugging.

```ts
import { RangeSet } from '@codemirror/state';
import { rangeSetToArray } from '@mnaoumov/obsidian-lib/codemirror/range-set';

console.debug(rangeSetToArray(RangeSet.empty));
```

## An incremental Lezer parse

`createIncrementalParseStateField` from `@mnaoumov/obsidian-lib/codemirror/incremental-parse-state-field` returns a `StateField` that parses the document with a Lezer parser when the state is created. On every change it parses again, reusing every tree fragment the change left intact.

```ts
import type { Parser } from '@lezer/common';

import { createIncrementalParseStateField } from '@mnaoumov/obsidian-lib/codemirror/incremental-parse-state-field';
import { EditorView } from '@codemirror/view';

declare const myParser: Parser;
declare const view: EditorView;

const parseField = createIncrementalParseStateField(myParser);
// Register `parseField` as an editor extension, then read the tree from any state.
const tree = view.state.field(parseField).tree;
console.debug(tree.length);
```

The parse is synchronous and runs to the end of the document. That suits a grammar a plugin owns, such as a markup extension or a small DSL. For a full language on a large document, `@codemirror/language`'s time-sliced parser is the better tool. `@lezer/common` is in the module map Obsidian hands to plugins, so the field adds nothing to a plugin's bundle.
