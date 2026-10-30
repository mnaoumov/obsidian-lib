/**
 * @file
 *
 * Contains class {@link EmbeddableMarkdownEditorComponent}: a full Obsidian Markdown editor (Live Preview, editor
 * commands, hotkeys) mounted in any element and owned as a component.
 *
 * Obsidian does not export its editor class, so the component borrows it from a throwaway Markdown embed: an editable
 * embed builds an iframed editor whose grandparent prototype is the scrollable Markdown editor every embed and table
 * cell editor uses. The probe opens no leaf and fires no workspace event (`embeddable-markdown-editor-component
 * .obsidian.integration.test.ts` measures that), and it runs once per copy of this library, on first use rather than at
 * module load. The class is cached per copy and never in the shared-state bag, because a constructor is not plain data.
 *
 * Adapted from the "Embeddable CM Markdown Editor" gist
 * (https://gist.github.com/Fevol/caa478ce303e69eabede7b12b2323838), itself a rework of the `Kanban` plugin's
 * `src/components/Editor/MarkdownEditor.tsx`, under the MIT license below.
 *
 * Copyright 2024 Matthew Meyers, Fevol
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the “Software”), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// cspell:words Fevol -- The gist author's handle, as the license notice above names it.

/* v8 ignore start -- Builds on Obsidian's unexported editor class, which only a running Obsidian has; covered by its integration test. */

import type { Extension } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import type {
  ExtractConstructor,
  MarkdownScrollableEditView,
  MarkdownScrollableEditViewOwner,
  WidgetEditorView
} from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Editor,
  TFile
} from 'obsidian';

import {
  EditorSelection,
  Prec
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder
} from '@codemirror/view';
import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Scope } from 'obsidian';

import { ComponentEx } from './component-ex.ts';
import { MonkeyAroundComponent } from './monkey-around-component.ts';

/**
 * The parameters of the {@link EmbeddableMarkdownEditorComponent} constructor.
 */
export interface EmbeddableMarkdownEditorComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * A CSS class added to the editor element.
   */
  readonly cls?: string;

  /**
   * The element the editor is mounted in. The editor appends its own element to it and removes only that element when
   * it unloads.
   */
  readonly containerEl: HTMLElement;

  /**
   * The initial selection, as document offsets. The cursor starts at the beginning of the document otherwise.
   */
  readonly cursorLocation?: EmbeddableMarkdownEditorComponentSelection;

  /**
   * Called when the editor loses focus, while the component is still loaded.
   */
  readonly onBlur?: (component: EmbeddableMarkdownEditorComponent) => void;

  /**
   * Called after every change to the document.
   */
  readonly onChange?: (update: ViewUpdate, component: EmbeddableMarkdownEditorComponent) => void;

  /**
   * Called on `Enter`, `Shift+Enter`, `Mod+Enter` and `Mod+Shift+Enter`.
   *
   * When given, `Mod+Enter` no longer runs the Obsidian hotkey bound to it (by default, opening the link under the
   * cursor in a new tab) while the editor has the focus, so a form can use it to submit.
   *
   * @returns `true` when the key was handled, which stops the editor inserting a line break; `false` otherwise.
   */
  readonly onEnter?: (params: EmbeddableMarkdownEditorComponentEnterParams) => boolean;

  /**
   * Called on `Escape`. When given, the key goes no further.
   */
  readonly onEscape?: (component: EmbeddableMarkdownEditorComponent) => void;

  /**
   * Called on a paste into the editor, before the editor handles it.
   */
  readonly onPaste?: ($event: ClipboardEvent, component: EmbeddableMarkdownEditorComponent) => void;

  /**
   * The text shown while the document is empty.
   */
  readonly placeholder?: string;

  /**
   * The initial document.
   */
  readonly value?: string;
}

/**
 * The parameters of {@link EmbeddableMarkdownEditorComponentConstructorParams.onEnter}.
 */
export interface EmbeddableMarkdownEditorComponentEnterParams {
  /**
   * The editor component the key was pressed in.
   */
  readonly component: EmbeddableMarkdownEditorComponent;

  /**
   * Whether the platform modifier (`Ctrl`, or `Cmd` on macOS) was held.
   */
  readonly isModifierPressed: boolean;

  /**
   * Whether `Shift` was held.
   */
  readonly isShiftPressed: boolean;
}

/**
 * A selection in an {@link EmbeddableMarkdownEditorComponent}, as document offsets.
 */
export interface EmbeddableMarkdownEditorComponentSelection {
  /**
   * The offset the selection starts from.
   */
  readonly anchor: number;

  /**
   * The offset the selection extends to, where the cursor is.
   */
  readonly head: number;
}

interface EditorHooks {
  readonly buildExtensions: () => Extension[];
  readonly handleUpdate: (update: ViewUpdate, isChanged: boolean) => void;
}

type EmbeddedScrollableMarkdownEditorConstructor = new (
  app: App,
  containerEl: HTMLElement,
  owner: MarkdownScrollableEditViewOwner,
  hooks: EditorHooks
) => MarkdownScrollableEditView;

type ScrollableMarkdownEditorConstructor = ExtractConstructor<MarkdownScrollableEditView>;

interface ScrollableMarkdownEditorConstructorCache {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- Filled on first use.
  value: null | ScrollableMarkdownEditorConstructor;
}

/* eslint-disable typescript-dev-toolkit/readonly-interface-members -- The owner learns its editor after the editor, which needs the owner, is built. */
interface ScrollableMarkdownEditorOwner extends MarkdownScrollableEditViewOwner {
  editMode: MarkdownScrollableEditView | null;
  readonly getMode: () => 'source';
}
/* eslint-enable typescript-dev-toolkit/readonly-interface-members -- Restore the rule after the owner. */

interface ScrollableMarkdownEditorPrototype {
  readonly constructor: ScrollableMarkdownEditorConstructor;
}

const scrollableMarkdownEditorConstructorCache: ScrollableMarkdownEditorConstructorCache = { value: null };

/**
 * A full Obsidian Markdown editor mounted in any element: Live Preview, editor commands, hotkeys and the editor
 * suggesters all work in it as they do in a note.
 *
 * Add it as a child of the component that owns its element; unloading it destroys the editor and removes the editor's
 * element. It works on desktop and mobile.
 *
 * @example
 * ```ts
 * const editorComponent = this.addChild(new EmbeddableMarkdownEditorComponent({
 *   app: this.app,
 *   containerEl,
 *   onEnter: ({ component, isModifierPressed }) => {
 *     if (!isModifierPressed) {
 *       return false;
 *     }
 *     save(component.value);
 *     return true;
 *   },
 *   value: 'Initial text'
 * }));
 * ```
 */
export class EmbeddableMarkdownEditorComponent extends ComponentEx {
  /**
   * The Obsidian editor, as in a note.
   *
   * @returns The editor.
   */
  public get editor(): Editor {
    return ensureNonNullable(this.getScrollableEditor().editor);
  }

  /**
   * The CodeMirror view behind the editor.
   *
   * @returns The CodeMirror view.
   */
  public get editorView(): EditorView {
    return this.getScrollableEditor().cm;
  }

  /**
   * The current document.
   *
   * @returns The document text.
   */
  public get value(): string {
    return this.getScrollableEditor().cm.state.doc.toString();
  }

  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * The element the editor is mounted in.
   */
  protected readonly containerEl: HTMLElement;

  private readonly cls: string;
  private readonly cursorLocation: EmbeddableMarkdownEditorComponentSelection | null;
  private readonly initialValue: string;
  private readonly keymapScope: Scope;
  private readonly onBlur: ((component: EmbeddableMarkdownEditorComponent) => void) | null;
  private readonly onChange: ((update: ViewUpdate, component: EmbeddableMarkdownEditorComponent) => void) | null;
  private readonly onEnter: ((params: EmbeddableMarkdownEditorComponentEnterParams) => boolean) | null;
  private readonly onEscape: ((component: EmbeddableMarkdownEditorComponent) => void) | null;
  private readonly onPaste: (($event: ClipboardEvent, component: EmbeddableMarkdownEditorComponent) => void) | null;
  private readonly owner: ScrollableMarkdownEditorOwner;
  private readonly placeholderText: string;
  private scrollableEditor: MarkdownScrollableEditView | null = null;

  /**
   * Creates the component. The editor is built when the component loads.
   *
   * @param params - The parameters.
   */
  public constructor(params: EmbeddableMarkdownEditorComponentConstructorParams) {
    super();
    this.app = params.app;
    this.containerEl = params.containerEl;
    this.cls = params.cls ?? '';
    this.cursorLocation = params.cursorLocation ?? null;
    this.initialValue = params.value ?? '';
    this.onBlur = params.onBlur ?? null;
    this.onChange = params.onChange ?? null;
    this.onEnter = params.onEnter ?? null;
    this.onEscape = params.onEscape ?? null;
    this.onPaste = params.onPaste ?? null;
    this.placeholderText = params.placeholder ?? '';
    this.keymapScope = new Scope(params.app.scope);
    // The editor's owner stands in for a `MarkdownView`. The editor commands reach the editor through
    // `activeEditor.editMode` and `activeEditor.editor`, and scrolling calls back into the owner.
    this.owner = {
      app: params.app,
      editMode: null,
      file: null,
      getMode: (): 'source' => 'source',
      hoverPopover: null,
      syncScroll: noop
    };
  }

  /**
   * Focuses the editor.
   */
  public focus(): void {
    this.getScrollableEditor().focus();
  }

  /**
   * Builds the editor and mounts it in the container.
   */
  public override onload(): void {
    super.onload();
    const EditorConstructor = createEditorClass(getScrollableMarkdownEditorConstructor(this.app));
    const scrollableEditor = new EditorConstructor(this.app, this.containerEl, this.owner, {
      buildExtensions: (): Extension[] => this.buildExtensions(),
      handleUpdate: (update: ViewUpdate, isChanged: boolean): void => {
        this.handleUpdate(update, isChanged);
      }
    });
    this.scrollableEditor = scrollableEditor;
    this.owner.editMode = scrollableEditor;
    this.owner.editor = ensureNonNullable(scrollableEditor.editor);
    this.addChild(scrollableEditor);

    if (this.onEnter) {
      // Obsidian's hotkeys run before CodeMirror's keymap, and `Mod+Enter` opens the link under the cursor. A handler
      // returning `true` stops that hotkey without stopping the event, so the editor keymap still sees the key.
      const submitHotkeyHandler = this.keymapScope.register(['Mod'], 'Enter', () => true);
      this.register(() => {
        this.keymapScope.unregister(submitHotkeyHandler);
      });
    }

    if (this.cls) {
      scrollableEditor.editorEl.addClass(this.cls);
    }

    scrollableEditor.set(this.initialValue, false);

    if (this.cursorLocation) {
      scrollableEditor.cm.dispatch({
        selection: EditorSelection.range(this.cursorLocation.anchor, this.cursorLocation.head)
      });
    }

    const focusGuardPatchComponent = this.addChild(new MonkeyAroundComponent());
    focusGuardPatchComponent.registerMethodPatch({
      $object: this.app.workspace,
      methodName: 'setActiveLeaf',
      patchHandler: ({ fallback }) => {
        // A focused editor that belongs to no leaf would otherwise lose its focus to the leaf the workspace activates.
        if (scrollableEditor.activeCM.hasFocus) {
          return;
        }
        fallback();
      }
    });

    this.register(() => {
      this.app.keymap.popScope(this.keymapScope);
      if (this.app.workspace.activeEditor === this.owner) {
        this.app.workspace.activeEditor = null;
      }
      scrollableEditor.destroy();
      scrollableEditor.editorEl.remove();
      this.owner.editMode = null;
      delete this.owner.editor;
      this.scrollableEditor = null;
    });
  }

  /**
   * Replaces the document.
   *
   * @param value - The new document.
   */
  public setValue(value: string): void {
    this.getScrollableEditor().set(value, false);
  }

  /**
   * Builds the editor's own extensions: the placeholder, the focus and paste handlers, and the key handlers.
   *
   * @returns The extensions.
   */
  protected buildExtensions(): Extension[] {
    const extensions: Extension[] = [
      EditorView.domEventHandlers({
        blur: (): void => {
          this.app.keymap.popScope(this.keymapScope);
          if (this._loaded) {
            this.onBlur?.(this);
          }
        },
        focus: (): void => {
          this.app.keymap.pushScope(this.keymapScope);
        },
        paste: ($event: ClipboardEvent): void => {
          this.onPaste?.($event, this);
        }
      }),
      Prec.highest(keymap.of([
        {
          key: 'Enter',
          run: (): boolean => this.isEnterHandled(false, false),
          shift: (): boolean => this.isEnterHandled(false, true)
        },
        {
          key: 'Mod-Enter',
          run: (): boolean => this.isEnterHandled(true, false),
          shift: (): boolean => this.isEnterHandled(true, true)
        },
        {
          key: 'Escape',
          preventDefault: true,
          run: (): boolean => {
            if (!this.onEscape) {
              return false;
            }
            this.onEscape(this);
            return true;
          }
        }
      ]))
    ];

    if (this.placeholderText) {
      extensions.push(placeholder(this.placeholderText));
    }

    return extensions;
  }

  /**
   * Called after every update of the editor, with whether the document changed.
   *
   * @param update - The CodeMirror update.
   * @param isChanged - Whether the document changed.
   */
  protected handleUpdate(update: ViewUpdate, isChanged: boolean): void {
    if (isChanged) {
      this.onChange?.(update, this);
    }
  }

  private getScrollableEditor(): MarkdownScrollableEditView {
    return ensureNonNullable(this.scrollableEditor, 'The editor is built when the component loads.');
  }

  private isEnterHandled(isModifierPressed: boolean, isShiftPressed: boolean): boolean {
    return this.onEnter?.({ component: this, isModifierPressed, isShiftPressed }) ?? false;
  }
}

function createEditorClass(BaseConstructor: ScrollableMarkdownEditorConstructor): EmbeddedScrollableMarkdownEditorConstructor {
  return class EmbeddedScrollableMarkdownEditor extends BaseConstructor {
    public constructor(app: App, containerEl: HTMLElement, owner: MarkdownScrollableEditViewOwner, private readonly hooks: EditorHooks) {
      // The base builds its extensions lazily, on the first `set()`, so the hooks are not needed during `super()`.
      super(app, containerEl, owner);
    }

    public override buildLocalExtensions(): Extension[] {
      return [...super.buildLocalExtensions(), ...this.hooks.buildExtensions()];
    }

    public override onUpdate(update: ViewUpdate, isChanged: boolean): void {
      super.onUpdate(update, isChanged);
      this.hooks.handleUpdate(update, isChanged);
    }
  };
}

function getScrollableMarkdownEditorConstructor(app: App): ScrollableMarkdownEditorConstructor {
  if (scrollableMarkdownEditorConstructorCache.value) {
    return scrollableMarkdownEditorConstructorCache.value;
  }

  // An editable Markdown embed builds an iframed editor whose base class is the scrollable editor. The embed is given
  // no file, which is what keeps it from reading or watching one.
  const widgetEditorView = castTo<WidgetEditorView>(app.embedRegistry.embedByExtension.md({ app, containerEl: createDiv() }, castTo<TFile>(null), ''));

  try {
    widgetEditorView.editable = true;
    widgetEditorView.showEditor();
    const iframedEditor = ensureNonNullable(widgetEditorView.editMode, 'The Markdown embed built no editor.');
    const scrollableEditorPrototype = castTo<ScrollableMarkdownEditorPrototype>(Object.getPrototypeOf(Object.getPrototypeOf(iframedEditor) as object));
    scrollableMarkdownEditorConstructorCache.value = scrollableEditorPrototype.constructor;
    return scrollableEditorPrototype.constructor;
  } finally {
    widgetEditorView.unload();
  }
}

/* v8 ignore stop */
