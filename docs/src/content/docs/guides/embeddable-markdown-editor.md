---
title: Embeddable Markdown editor
description: Mount a full Obsidian Markdown editor in any element, owned as a component.
---

`EmbeddableMarkdownEditorComponent` from `@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component` mounts the editor Obsidian uses for notes in any element: Live Preview, the editor commands, hotkeys and the link and tag suggesters all work in it. Use it for a multi-line field in a modal, a view or a settings tab where a plain `<textarea>` would lose Markdown editing.

Add it as a child of the component that owns its element. The editor is built when the component loads, and unloading it destroys the editor and removes only the element it appended, so the container keeps everything else it holds.

```ts
import { EmbeddableMarkdownEditorComponent } from '@mnaoumov/obsidian-lib/components/embeddable-markdown-editor-component';
import { Component } from 'obsidian';

const owner = new Component();
owner.load();

const editorComponent = owner.addChild(
  new EmbeddableMarkdownEditorComponent({
    app,
    containerEl,
    onEnter: ({ isModifierPressed }) => {
      if (!isModifierPressed) {
        return false;
      }
      console.debug('Submitted:', editorComponent.value);
      return true;
    },
    onEscape: (): void => {
      owner.removeChild(editorComponent);
    },
    placeholder: 'Write something',
    value: 'Initial **text**'
  })
);
```

`value` reads the document and `setValue()` replaces it; `editor` is the same `Editor` a note's view exposes, and `editorView` is the CodeMirror view behind it. `onChange` runs after every change to the document, `onBlur` when the editor loses focus, and `onPaste` before the editor handles a paste.

The key handlers follow CodeMirror's convention. `onEnter` returns `true` when it handled the key, which stops the line break; return `false` to let the editor insert one. Passing `onEnter` also stops Obsidian's own `Mod+Enter` hotkey (opening the link under the cursor in a new tab) while the editor has the focus, so a form can submit on `Mod+Enter`. Passing `onEscape` keeps `Escape` from going any further.

While the editor has the focus it is the workspace's active editor, which is what lets editor commands such as **Toggle bold** act on it, and a leaf the workspace activates in the meantime does not take the focus away. When the component unloads, it clears the active editor only if that still points at this editor.

Obsidian does not export its editor class, so the component borrows it from a Markdown embed it builds on a detached element and unloads straight away. That happens once per copy of the library, on the first editor built, and it opens no tab and raises no `file-open` or `active-leaf-change` event.
