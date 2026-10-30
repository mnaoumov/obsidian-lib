/**
 * @file
 *
 * Contains class {@link ReconfigurableEditorExtensionComponent}: an editor extension that can be swapped at runtime,
 * in every open editor and in every editor opened later.
 *
 * Obsidian's documented route is to mutate the array handed to `registerEditorExtension` and call
 * `workspace.updateOptions()`, which Obsidian itself calls "fairly expensive". This component instead wraps the
 * extension in a {@link Compartment}: it swaps the entry in the array it registered, which future editors read, and
 * dispatches the compartment's reconfigure effect to the open ones, which touches nothing else in their configuration.
 * A later `updateOptions()` from anywhere re-reads the array and so lands on the same extension.
 *
 * Obsidian offers no way to unregister an editor extension, so unloading reconfigures the compartment to an empty
 * extension, and loading the component again restores the current one into the array it already registered.
 */

import type { Extension } from '@codemirror/state';
import type { App } from 'obsidian';

import { Compartment } from '@codemirror/state';

import type { EditorExtensionRegistrar } from '../editor-extension-registrar.ts';

import { dispatchToAllMarkdownEditorViews } from '../codemirror/markdown-editor-views.ts';
import { ComponentEx } from './component-ex.ts';

/**
 * Parameters for the {@link ReconfigurableEditorExtensionComponent} constructor.
 */
export interface ReconfigurableEditorExtensionComponentConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The registrar the extension is registered through, once, on the first load.
   */
  readonly editorExtensionRegistrar: EditorExtensionRegistrar;

  /**
   * The extension the editors start with. Defaults to an empty extension.
   */
  readonly extension?: Extension;
}

/**
 * An editor extension that can be swapped at runtime, in every open editor and in every editor opened later.
 *
 * @example
 * ```ts
 * const highlighting = this.addChild(new ReconfigurableEditorExtensionComponent({
 *   app: this.app,
 *   editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this)
 * }));
 * highlighting.reconfigure(settings.shouldHighlight ? highlightExtension : []);
 * ```
 */
export class ReconfigurableEditorExtensionComponent extends ComponentEx {
  /**
   * The extension the editors currently carry, or the one they will carry once the component loads.
   *
   * @returns The current extension.
   */
  public get extension(): Extension {
    return this._extension;
  }

  /**
   * The Obsidian app instance.
   */
  protected readonly app: App;

  /**
   * The compartment the extension lives in, in every editor.
   */
  protected readonly compartment = new Compartment();

  /**
   * The registrar the extension is registered through, once, on the first load.
   */
  protected readonly editorExtensionRegistrar: EditorExtensionRegistrar;

  private _extension: Extension;
  private isRegistered = false;
  private readonly registeredExtensions: Extension[] = [];

  /**
   * Creates a new instance of the {@link ReconfigurableEditorExtensionComponent} class.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: ReconfigurableEditorExtensionComponentConstructorParams) {
    super();
    this.app = params.app;
    this.editorExtensionRegistrar = params.editorExtensionRegistrar;
    this._extension = params.extension ?? [];
  }

  /**
   * Registers the extension on the first load, or restores it into every editor on a later one.
   */
  public override onload(): void {
    super.onload();
    if (this.isRegistered) {
      this.apply(this._extension);
      return;
    }
    this.registeredExtensions.push(this.compartment.of(this._extension));
    this.editorExtensionRegistrar.registerEditorExtension(this.registeredExtensions);
    this.isRegistered = true;
  }

  /**
   * Empties the extension in every editor, since Obsidian cannot unregister it.
   */
  public override onunload(): void {
    super.onunload();
    this.apply([]);
  }

  /**
   * Swaps the extension in every open editor and in every editor opened later.
   *
   * Before the component loads, this only records the extension the editors will start with.
   *
   * @param extension - The new extension.
   */
  public reconfigure(extension: Extension): void {
    this._extension = extension;
    if (this.isRegistered && this._loaded) {
      this.apply(extension);
    }
  }

  private apply(extension: Extension): void {
    this.registeredExtensions.splice(0, this.registeredExtensions.length, this.compartment.of(extension));
    dispatchToAllMarkdownEditorViews(this.app, { effects: this.compartment.reconfigure(extension) });
  }
}
