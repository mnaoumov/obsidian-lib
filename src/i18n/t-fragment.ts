/**
 * @file
 *
 * Translates one whole sentence whose placeholders are DOM nodes, so translators get the full sentence and can move
 * each node wherever their language needs it.
 */

import type { SelectorParam } from 'i18next';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';

import { t } from './i18n.ts';

/**
 * A DOM value of a {@link tFragment} placeholder: a node placed as is, or a builder that appends the node to the
 * fragment at the placeholder's position.
 */
export type TranslationNode = ((parent: DocumentFragment) => void) | Node;

const MARKER_START = '';
const MARKER_END = '';
const MARKER_REG_EXP = new RegExp(`${MARKER_START}([^${MARKER_END}]*)${MARKER_END}`, 'u');

/**
 * Translates a sentence like {@link t}, but places DOM nodes at its `{{name}}` placeholders.
 *
 * Each key of `nodes` is a placeholder of the translated sentence. Its value is placed where the translation puts
 * that placeholder, so `'Running for {{duration}} milliseconds'` and a translation that moves `{{duration}}` to the
 * end both render correctly. Every other placeholder is interpolated by `i18next` as usual, from `options`.
 *
 * A {@link Node} placeholder used more than once is placed at its first position and deep-cloned at the later ones; a
 * builder runs once per position. A placeholder the translation leaves out is not placed at all.
 *
 * @param selector - The translation selector, as {@link t} takes it.
 * @param nodes - The DOM values of the placeholders, by placeholder name.
 * @param options - The `i18next` options, including the plain values of the other placeholders.
 * @returns A fragment holding the translated sentence with the nodes in place.
 */
export function tFragment(
  selector: SelectorParam,
  nodes: Readonly<Record<string, TranslationNode>>,
  options?: Readonly<Record<string, unknown>>
): DocumentFragment {
  const markers: Record<string, string> = {};
  for (const name of Object.keys(nodes)) {
    markers[name] = `${MARKER_START}${name}${MARKER_END}`;
  }

  const translate = castTo<(selector: SelectorParam, options: Record<string, unknown>) => string>(t);
  const text = translate(selector, { ...options, ...markers });
  const placedNodes = new Set<Node>();

  return createFragment((fragment) => {
    // `split` with one capturing group alternates: text, placeholder name, text, ...
    let isPlaceholder = true;
    for (const part of text.split(MARKER_REG_EXP)) {
      isPlaceholder = !isPlaceholder;
      const node = isPlaceholder ? nodes[part] : undefined;
      if (node === undefined) {
        if (part) {
          fragment.append(part);
        }
        continue;
      }

      if (typeof node === 'function') {
        node(fragment);
        continue;
      }

      fragment.append(placedNodes.has(node) ? node.cloneNode(true) : node);
      placedNodes.add(node);
    }
  });
}
