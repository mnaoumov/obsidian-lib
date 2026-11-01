/**
 * @file
 *
 * One definition of an inline token that renders in both Reading view and Live Preview.
 *
 * A token is a regular expression and a render function. {@link registerInlineTokenRenderer} registers a Markdown
 * post processor that renders every match found in the rendered text, and an editor extension that replaces every
 * match with a widget in Live Preview, both calling the same function, so the two views cannot drift apart.
 *
 * The Reading-view half walks text nodes only, so a token is never matched across an element boundary, and it skips
 * text inside the elements `skipSelector` names (code by default). The editor half matches each line's source text,
 * Markdown markup included; see `shouldDecorate` to skip code there.
 */

import type { MarkdownPostProcessorContext } from 'obsidian';

import type {
  CreateInlineTokenWidgetsExtensionParams,
  InlineTokenRenderFunction
} from './codemirror/inline-token-widgets.ts';
import type { EditorExtensionRegistrar } from './editor-extension-registrar.ts';
import type { MarkdownPostProcessorRegistrar } from './markdown-post-processor-registrar.ts';

import {
  createInlineTokenWidgetsExtension,
  execAll,
  toGlobalRegExp
} from './codemirror/inline-token-widgets.ts';
import { CssClass } from './css-class.ts';

/**
 * The default selector of the elements whose text is never matched in Reading view.
 */
export const DEFAULT_INLINE_TOKEN_SKIP_SELECTOR = 'code, pre';

/**
 * Parameters for {@link createInlineTokenPostProcessor}.
 */
export interface CreateInlineTokenPostProcessorParams {
  /**
   * The regular expression a token matches. The `g` flag is added when missing.
   */
  readonly regExp: RegExp;

  /**
   * Renders a token into its element.
   */
  readonly render: InlineTokenRenderFunction;

  /**
   * The selector of the elements whose text is never matched.
   *
   * @default {@link DEFAULT_INLINE_TOKEN_SKIP_SELECTOR}
   */
  readonly skipSelector?: string;
}

/**
 * Parameters for {@link registerInlineTokenRenderer}.
 */
export interface RegisterInlineTokenRendererParams extends CreateInlineTokenPostProcessorParams, CreateInlineTokenWidgetsExtensionParams {
  /**
   * The registrar the editor extension is registered through.
   */
  readonly editorExtensionRegistrar: EditorExtensionRegistrar;

  /**
   * The registrar the Reading-view post processor is registered through.
   */
  readonly markdownPostProcessorRegistrar: MarkdownPostProcessorRegistrar;

  /**
   * The sort order of the post processor.
   *
   * @default `0`
   */
  readonly sortOrder?: number;
}

/**
 * Creates a Markdown post processor that renders every match of a regular expression found in the rendered text.
 *
 * @param params - The post processor parameters.
 * @returns The post processor.
 */
export function createInlineTokenPostProcessor(
  params: CreateInlineTokenPostProcessorParams
): (element: HTMLElement, context: Pick<MarkdownPostProcessorContext, 'sourcePath'>) => void {
  const regExp = toGlobalRegExp(params.regExp);
  const skipSelector = params.skipSelector ?? DEFAULT_INLINE_TOKEN_SKIP_SELECTOR;

  return (element, context) => {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      if (textNode.parentElement?.closest(skipSelector)) {
        continue;
      }
      const text = textNode.data;
      const matches = execAll(regExp, text);
      if (matches.length === 0) {
        continue;
      }

      const fragment = doc.win.createFragment();
      let lastIndex = 0;
      for (const match of matches) {
        fragment.append(text.slice(lastIndex, match.index));
        const containerEl = doc.win.createSpan();
        containerEl.classList.add(CssClass.LibraryName, CssClass.InlineToken);
        params.render({ containerEl, match, sourcePath: context.sourcePath });
        fragment.append(containerEl);
        lastIndex = match.index + match[0].length;
      }
      fragment.append(text.slice(lastIndex));
      textNode.replaceWith(fragment);
    }
  };
}

/**
 * Registers an inline token in both Reading view and Live Preview, from one definition.
 *
 * Obsidian ties both registrations to the plugin's lifetime and offers no way to remove either earlier.
 *
 * @param params - The registration parameters.
 *
 * @example
 * ```ts
 * registerInlineTokenRenderer({
 *   editorExtensionRegistrar: new PluginEditorExtensionRegistrar(this),
 *   markdownPostProcessorRegistrar: new PluginMarkdownPostProcessorRegistrar(this),
 *   regExp: /:([a-z]+):/,
 *   render({ containerEl, match }) {
 *     containerEl.setText(EMOJI[match[1] ?? ''] ?? match[0]);
 *   }
 * });
 * ```
 */
export function registerInlineTokenRenderer(params: RegisterInlineTokenRendererParams): void {
  params.markdownPostProcessorRegistrar.registerMarkdownPostProcessor({
    postProcessor: createInlineTokenPostProcessor(params),
    ...(params.sortOrder !== undefined && { sortOrder: params.sortOrder })
  });
  params.editorExtensionRegistrar.registerEditorExtension(createInlineTokenWidgetsExtension(params));
}
