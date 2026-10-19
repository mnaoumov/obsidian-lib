/**
 * @file
 *
 * Helpers for working with the `@mnaoumov/obsidian-lib` library.
 *
 * The user-visible name is `obsidian-lib`: the debug namespace of this library's own modules and its CSS class. The
 * legacy name, `obsidian-dev-utils`, is the one this library was published under before it split into packages, and
 * it is kept beside the new one for good, so plugins, their users' debug filters and their stylesheets keep matching:
 * every element carries both classes, and a debug filter on either namespace shows the messages. The stylesheet id
 * and the namespace of the generic `@mnaoumov/typescript-lib` modules stay legacy only.
 */

/**
 * The user-visible name of the library: the debug namespace of its own modules, and its CSS class.
 */
export const OBSIDIAN_LIBRARY_NAME = 'obsidian-lib';

/**
 * The legacy user-visible name of the library, kept beside {@link OBSIDIAN_LIBRARY_NAME} for good: a debug namespace
 * and a CSS class that older copies and existing filters and stylesheets use, and the stylesheet id.
 */
export const LEGACY_OBSIDIAN_LIBRARY_NAME = 'obsidian-dev-utils';

/**
 * Parameters for {@link ObsidianLibrary.init}.
 */
export interface ObsidianLibraryInitParams {
  /**
   * The per-plugin CSS class scope applied alongside the library class by `addPluginCssClasses`.
   */
  readonly cssClassScope: string;
}

const DEFAULT_PARAMS: ObsidianLibraryInitParams = {
  cssClassScope: ''
};

/**
 * The Obsidian half of the library's initialization state. `initPluginContext` initializes it beside the
 * generic `Library` from `@mnaoumov/typescript-lib/library`.
 */
class ObsidianLibraryContext {
  /**
   * The per-plugin CSS class scope applied alongside the library class by `addPluginCssClasses`.
   * Empty until {@link init} is called.
   *
   * @returns The CSS class scope.
   */
  public get cssClassScope(): string {
    return this.params.cssClassScope;
  }

  private isInitialized = false;

  private params: ObsidianLibraryInitParams = { ...DEFAULT_PARAMS };

  /**
   * Initializes the context. Must be called exactly once; calling it again before {@link resetToDefault} throws.
   *
   * @param params - The configuration to inject.
   */
  public init(params: ObsidianLibraryInitParams): void {
    if (this.isInitialized) {
      throw new Error(`${OBSIDIAN_LIBRARY_NAME} is already initialized. Call ObsidianLibrary.resetToDefault() before initializing again.`);
    }
    this.isInitialized = true;
    this.params = { ...params };
  }

  /**
   * Resets the context back to its default (uninitialized) state, allowing {@link init} to be called again.
   */
  public resetToDefault(): void {
    this.isInitialized = false;
    this.params = { ...DEFAULT_PARAMS };
  }
}

/**
 * The single {@link ObsidianLibraryContext} instance.
 */
export const ObsidianLibrary = new ObsidianLibraryContext();
