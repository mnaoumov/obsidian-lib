/**
 * @file
 *
 * Registers a markdown code block processor.
 */

import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  Plugin
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { normalizePromisable } from '@mnaoumov/typescript-lib/async';
import { noop } from '@mnaoumov/typescript-lib/function';

import { getObsidianLibDebugger } from './debug.ts';

/**
 * A registrar for markdown code block processors.
 */
export interface MarkdownCodeBlockProcessorRegistrar {
  /**
   * Registers a markdown code block processor.
   *
   * @param params - The parameters for the markdown code block processor.
   * @returns The markdown post processor.
   */
  readonly registerMarkdownCodeBlockProcessor: (params: MarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams) => MarkdownPostProcessor;
}

interface MarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams {
  /**
   * Handler function for the code block processor.
   *
   * @param source - The source code of the code block.
   * @param element - The HTML element representing the code block.
   * @param context - The context for the markdown post processor.
   */
  readonly handler: (source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => Promisable<void>;

  /**
   * The language of the code block to register the processor for.
   */
  readonly language: string;

  /**
   * The sort order of the processor. Lower numbers are processed first. Defaults to 0.
   */
  readonly sortOrder?: number;
}

type PluginMarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams = MarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams;

/**
 * A registrar for markdown code block processors.
 */
export class PluginMarkdownCodeBlockProcessorRegistrar implements MarkdownCodeBlockProcessorRegistrar {
  /**
   * The Obsidian plugin instance the code block processors are registered with.
   */
  protected readonly plugin: Plugin;

  /**
   * Creates a new markdown code block processor registrar.
   *
   * @param plugin - The plugin to register the markdown code block processor with.
   */
  public constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  /**
   * Registers a markdown code block processor.
   *
   * Does nothing, and returns a no-op processor, when the plugin instance is not loaded. Obsidian `1.15.1`'s
   * `Component.register` keeps a cleanup handed to an unloaded component without ever running it, so a processor
   * registered by an instance that was unloaded while it was still loading (a plugin update, an install over an
   * existing copy, a Hot Reload) would stay in Obsidian's global language map for the rest of the session, and the
   * next instance's registration of the same language would throw `Code block postprocessor for language ... is
   * already registered`.
   *
   * @param params - The parameters for the markdown code block processor.
   * @returns The markdown post processor.
   */
  public registerMarkdownCodeBlockProcessor(params: PluginMarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams): MarkdownPostProcessor {
    if (!this.plugin._loaded) {
      getObsidianLibDebugger('PluginMarkdownCodeBlockProcessorRegistrar')(
        `Skipped registering the code block processor for language ${params.language}: the plugin instance is not loaded.`
      );
      return noop;
    }

    return this.plugin.registerMarkdownCodeBlockProcessor(params.language, (source, element, context) => normalizePromisable(params.handler(source, element, context)), params.sortOrder);
  }
}
