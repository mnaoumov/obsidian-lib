/**
 * @file
 *
 * Registers a markdown code block processor.
 */

import type { CodeBlockPostProcessorHandler } from '@obsidian-typings/obsidian-public-latest';
import type {
  Component,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  Plugin
} from 'obsidian';
import type { Promisable } from 'type-fest';

import { noop } from '@mnaoumov/typescript-lib/function';
import { MarkdownPreviewRenderer } from 'obsidian';

import { getObsidianLibDebugger } from './debug.ts';

/**
 * Resolves the component whose unload unregisters a code block processor, for a registration that names none.
 *
 * @returns The lifetime owner.
 */
export type MarkdownCodeBlockProcessorLifetimeOwnerProvider = () => Component;

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
   * The component whose unload unregisters the processor, overriding the registrar's lifetime owner provider for this
   * one call.
   *
   * It must be the plugin or a component in the plugin's tree, so the plugin's own unload reaches it.
   */
  readonly lifetimeOwner?: Component | undefined;

  /**
   * The sort order of the processor. Lower numbers are processed first. Defaults to 0.
   */
  readonly sortOrder?: number;
}

interface PluginMarkdownCodeBlockProcessorRegistrarConstructorOptions {
  /**
   * Resolves the lifetime owner for a registration that names none of its own. It is called on every registration,
   * never captured, so a provider may answer a component that is replaced over time, such as a plugin's gated feature
   * surface.
   *
   * When omitted, every registration is owned by the plugin, which is what Obsidian's own
   * `Plugin.registerMarkdownCodeBlockProcessor` does.
   */
  readonly lifetimeOwnerProvider?: MarkdownCodeBlockProcessorLifetimeOwnerProvider | undefined;
}

type PluginMarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams = MarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams;

const POST_PROCESSOR_CHANGE_EVENT_NAME = 'post-processor-change';

/**
 * A registrar for markdown code block processors.
 *
 * Obsidian ties a processor registered through `Plugin.registerMarkdownCodeBlockProcessor` to the plugin's unload, so
 * a component that registers one from its own `onload` and is later unloaded while the plugin stays loaded leaves the
 * processor behind, and registering the same language again throws `Code block postprocessor for language ... is
 * already registered`. A lifetime owner ties the processor to that component instead.
 */
export class PluginMarkdownCodeBlockProcessorRegistrar implements MarkdownCodeBlockProcessorRegistrar {
  /**
   * The Obsidian plugin instance the code block processors are registered with.
   */
  protected readonly plugin: Plugin;

  private readonly lifetimeOwnerProvider: MarkdownCodeBlockProcessorLifetimeOwnerProvider;

  /**
   * Creates a new markdown code block processor registrar.
   *
   * @param plugin - The plugin to register the markdown code block processor with.
   * @param options - The optional registrar options.
   */
  public constructor(plugin: Plugin, options?: PluginMarkdownCodeBlockProcessorRegistrarConstructorOptions) {
    this.plugin = plugin;
    this.lifetimeOwnerProvider = options?.lifetimeOwnerProvider ?? ((): Component => this.plugin);
  }

  /**
   * Registers a markdown code block processor, unregistered when its lifetime owner unloads.
   *
   * Does nothing, and returns a no-op processor, when the plugin instance or the lifetime owner is not loaded. Obsidian
   * `1.15.1`'s `Component.register` keeps a cleanup handed to an unloaded component without ever running it, so a
   * processor registered by an instance that was unloaded while it was still loading (a plugin update, an install over
   * an existing copy, a Hot Reload) would stay in Obsidian's global language map for the rest of the session, and the
   * next registration of the same language would throw `Code block postprocessor for language ... is already
   * registered`.
   *
   * @param params - The parameters for the markdown code block processor.
   * @returns The markdown post processor.
   */
  public registerMarkdownCodeBlockProcessor(params: PluginMarkdownCodeBlockProcessorRegistrarRegisterMarkdownCodeBlockProcessorParams): MarkdownPostProcessor {
    const lifetimeOwner = params.lifetimeOwner ?? this.lifetimeOwnerProvider();
    if (!this.plugin._loaded || !lifetimeOwner._loaded) {
      getObsidianLibDebugger('PluginMarkdownCodeBlockProcessorRegistrar')(
        `Skipped registering the code block processor for language ${params.language}: the plugin instance or the lifetime owner is not loaded.`
      );
      return noop;
    }

    async function handler(source: string, element: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> {
      await params.handler(source, element, context);
    }

    return lifetimeOwner === this.plugin
      ? this.plugin.registerMarkdownCodeBlockProcessor(params.language, handler, params.sortOrder)
      : this.registerOwnedProcessor(params.language, handler, lifetimeOwner, params.sortOrder);
  }

  /**
   * Registers a processor the way Obsidian `1.15.1`'s `Plugin.registerMarkdownCodeBlockProcessor` does, with the
   * cleanup on the lifetime owner instead of the plugin.
   *
   * @param language - The code block language.
   * @param handler - The code block handler.
   * @param lifetimeOwner - The component whose unload unregisters the processor.
   * @param sortOrder - The post processor sort order.
   * @returns The markdown post processor.
   */
  private registerOwnedProcessor(
    language: string,
    handler: CodeBlockPostProcessorHandler,
    lifetimeOwner: Component,
    sortOrder: number | undefined
  ): MarkdownPostProcessor {
    const codeBlockPostProcessors: Record<string, CodeBlockPostProcessorHandler> = MarkdownPreviewRenderer.codeBlockPostProcessors;
    // `Object.hasOwn` is a type guard here, which would narrow `language` to `never` for the assignment below.
    if (Object.keys(codeBlockPostProcessors).includes(language)) {
      throw new Error(`Code block postprocessor for language ${language} is already registered`);
    }

    const postProcessor = MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, handler);
    MarkdownPreviewRenderer.registerPostProcessor(postProcessor, sortOrder);
    // TODO: Call `MarkdownPreviewRenderer.registerCodeBlockPostProcessor` once `obsidian-typings` declares it; this line and the check above mirror it.
    codeBlockPostProcessors[language] = handler;
    this.plugin.app.workspace.trigger(POST_PROCESSOR_CHANGE_EVENT_NAME);

    lifetimeOwner.register(() => {
      if (codeBlockPostProcessors[language] === handler) {
        MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(language);
      }
      MarkdownPreviewRenderer.unregisterPostProcessor(postProcessor);
      this.plugin.app.workspace.trigger(POST_PROCESSOR_CHANGE_EVENT_NAME);
    });

    return postProcessor;
  }
}
