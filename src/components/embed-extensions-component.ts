/**
 * @file
 *
 * Contains class {@link EmbedExtensionsComponent} that registers embed extensions.
 */

import type { EmbedCreator } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { ComponentEx } from './component-ex.ts';

/**
 * A component that registers and unregisters embed extensions.
 *
 * @remarks
 * This component is useful for plugins that want to register custom embed types for specific file extensions.
 * It ensures that the extensions are registered when the component is loaded and unregistered when the component is unloaded.
 */
export class EmbedExtensionsComponent extends ComponentEx {
  /**
   * Creates a new instance of the {@link EmbedExtensionsComponent} class.
   *
   * @param app - The Obsidian app instance.
   */
  public constructor(protected readonly app: App) {
    super();
  }

  /**
   * Registers the specified file extensions with the given embed type in the Obsidian app.
   * The extensions will be automatically unregistered when the component is unloaded.
   *
   * The registration is all or nothing: Obsidian throws for an extension that is already registered (by the core or by
   * another plugin), and in that case every extension this call registered before the conflict is unregistered again
   * before the error is rethrown. An extension registered by someone else is never unregistered.
   *
   * The creator serves every surface that loads an embed: `![[file.ext#subpath]]` in Reading view and Live Preview,
   * canvas file nodes and the page-preview hover popover. It receives the link's subpath with its leading `#`, or an
   * empty string. Returning `null` makes Obsidian fall back to its generic file embed.
   *
   * @param extensions - An array of file extensions to register.
   * @param embedCreator - The embed creator function to associate with the extensions.
   *
   * @example
   * ```ts
   * component.registerExtensions(['ext1', 'ext2'], (context, file, subpath) => new MyEmbedComponent(context, file, subpath));
   * ```
   */
  public registerExtensions(extensions: string[], embedCreator: EmbedCreator): void {
    this.ensureLoaded();

    const registeredExtensions: string[] = [];
    try {
      for (const extension of extensions) {
        this.app.embedRegistry.registerExtension(extension, embedCreator);
        registeredExtensions.push(extension);
      }
    } catch (error) {
      this.app.embedRegistry.unregisterExtensions(registeredExtensions);
      throw error;
    }

    this.register(() => {
      this.app.embedRegistry.unregisterExtensions(registeredExtensions);
    });
  }
}
