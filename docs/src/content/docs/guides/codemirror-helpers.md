---
title: CodeMirror helpers
description: Reach every open editor, swap an editor extension at runtime, feed settings to extensions through a facet, render inline tokens in Reading view and Live Preview from one definition, list a RangeSet, and keep an incremental Lezer parse of the document.
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

## Settings through a facet

An extension that closes over a settings object never sees the settings change. `createSettingsFacet` from `@mnaoumov/obsidian-lib/codemirror/settings-facet` makes a facet the extension reads instead, and `SettingsFacetComponent` from `@mnaoumov/obsidian-lib/components/settings-facet-component` provides the current settings to it in every open editor and every editor opened later. It is a `ReconfigurableEditorExtensionComponent` holding `facet.of(settings)`, so `setSettings` is one reconfigure, and every view plugin sees the new value in the same update.

```ts
import { createSettingsFacet } from '@mnaoumov/obsidian-lib/codemirror/settings-facet';
import { SettingsFacetComponent } from '@mnaoumov/obsidian-lib/components/settings-facet-component';
import { PluginEditorExtensionRegistrar } from '@mnaoumov/obsidian-lib/editor-extension-registrar';
import { Plugin } from 'obsidian';

interface MySettings {
  readonly color: string;
}

const settingsFacet = createSettingsFacet<MySettings>({ color: 'red' });

class MyPlugin extends Plugin {
  private settingsFacetComponent?: SettingsFacetComponent<MySettings>;

  public override onload(): void {
    this.settingsFacetComponent = this.addChild(
      new SettingsFacetComponent({
        app: this.app,
        editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this),
        facet: settingsFacet,
        settings: { color: 'red' }
      })
    );
  }

  public onSettingsChanged(settings: MySettings): void {
    this.settingsFacetComponent?.setSettings(settings);
  }
}
```

An extension reads the value with `state.facet(settingsFacet)`. A view plugin must rebuild when the configuration changes (`update.transactions.some((transaction) => transaction.reconfigured)`), which the inline token widgets below already do.

## Inline tokens in Reading view and Live Preview

`registerInlineTokenRenderer` from `@mnaoumov/obsidian-lib/inline-token-renderer` takes one definition, a regular expression and a render function, and registers it twice: as a Markdown post processor for Reading view, and as an editor extension that replaces each match with a widget in Live Preview. Both call the same function, so the two views render a token the same way.

```ts
import { PluginEditorExtensionRegistrar } from '@mnaoumov/obsidian-lib/editor-extension-registrar';
import { registerInlineTokenRenderer } from '@mnaoumov/obsidian-lib/inline-token-renderer';
import { PluginMarkdownPostProcessorRegistrar } from '@mnaoumov/obsidian-lib/markdown-post-processor-registrar';
import { Plugin } from 'obsidian';

class MyPlugin extends Plugin {
  public override onload(): void {
    registerInlineTokenRenderer({
      editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this),
      markdownPostProcessorRegistrar: new PluginMarkdownPostProcessorRegistrar(this),
      regExp: /::kbd-(\w+)::/,
      render({ containerEl, match }) {
        containerEl.createEl('kbd', { text: match[1] ?? '' });
      }
    });
  }
}
```

The render function gets the container element, the match, and the note's path. In Live Preview it also gets the editor state, so it can read a settings facet.

In Live Preview a token shows its source again while the cursor or a selection touches it, the way Obsidian's own links do. Set `shouldRevealOnSelection: false` to keep it rendered. Nothing is replaced in Source mode.

The two halves see different text. Reading view walks the rendered text nodes, skipping the elements `skipSelector` names (`code, pre` by default), so a token never spans formatting. Live Preview matches each line of the source, Markdown markup included, and skips nothing by default. To skip code there, pass `shouldDecorate` and ask the syntax tree, which needs `@codemirror/language` from Obsidian's module map:

<!-- snippet-check: skip @codemirror/language is not a dependency of this package -->

```ts
import { syntaxTree } from '@codemirror/language';

const shouldDecorate = ({ from, state }: InlineTokenShouldDecorateParams): boolean =>
  !syntaxTree(state).resolveInner(from, 1).name.includes('code');
```

`createInlineTokenWidgetsExtension` from `@mnaoumov/obsidian-lib/codemirror/inline-token-widgets` and `createInlineTokenPostProcessor` are the two halves, for a plugin that registers them some other way.

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
