/**
 * @file
 *
 * Contains class {@link SettingsFacetComponent}: a plugin's settings provided to a settings facet in every editor,
 * swapped at runtime.
 */

import type { Facet } from '@codemirror/state';

import type { ReconfigurableEditorExtensionComponentConstructorParams } from './reconfigurable-editor-extension-component.ts';

import { ReconfigurableEditorExtensionComponent } from './reconfigurable-editor-extension-component.ts';

/**
 * Parameters for the {@link SettingsFacetComponent} constructor.
 *
 * @typeParam T - The settings type.
 */
export interface SettingsFacetComponentConstructorParams<T> extends Pick<ReconfigurableEditorExtensionComponentConstructorParams, 'app' | 'editorExtensionRegistrar'> {
  /**
   * The facet the settings are provided to, usually made by `createSettingsFacet`.
   */
  readonly facet: Facet<T, T>;

  /**
   * The settings the editors start with.
   */
  readonly settings: T;
}

/**
 * Provides a plugin's settings to a settings facet in every open editor and in every editor opened later.
 *
 * @typeParam T - The settings type.
 *
 * @example
 * ```ts
 * const settingsFacet = createSettingsFacet<MySettings>(DEFAULT_SETTINGS);
 * const settingsFacetComponent = this.addChild(new SettingsFacetComponent({
 *   app: this.app,
 *   editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this),
 *   facet: settingsFacet,
 *   settings: this.settings
 * }));
 * // After the settings change:
 * settingsFacetComponent.setSettings(this.settings);
 * ```
 */
export class SettingsFacetComponent<T> extends ReconfigurableEditorExtensionComponent {
  /**
   * The settings the editors currently read.
   *
   * @returns The current settings.
   */
  public get settings(): T {
    return this._settings;
  }

  /**
   * The facet the settings are provided to.
   */
  protected readonly facet: Facet<T, T>;

  private _settings: T;

  /**
   * Creates a new instance of the {@link SettingsFacetComponent} class.
   *
   * @param params - The constructor parameters.
   */
  public constructor(params: SettingsFacetComponentConstructorParams<T>) {
    super({
      app: params.app,
      editorExtensionRegistrar: params.editorExtensionRegistrar,
      extension: params.facet.of(params.settings)
    });
    this.facet = params.facet;
    this._settings = params.settings;
  }

  /**
   * Provides new settings to every open editor and to every editor opened later.
   *
   * @param settings - The new settings.
   */
  public setSettings(settings: T): void {
    this._settings = settings;
    this.reconfigure(this.facet.of(settings));
  }
}
