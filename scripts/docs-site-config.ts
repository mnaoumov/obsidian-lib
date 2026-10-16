/**
 * @file
 *
 * This repository's documentation site, shared by `astro.config.ts` and the `docs:*` scripts.
 */

import type { DocsSiteConfig } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-config';

// The CodeMirror and Moment types this package's API names. They left the generic link map of
// `@mnaoumov/typescript-dev-toolkit`, which leaves an ecosystem's references to the layer documenting it.
// Cspell:disable -- URL fragments are not words
const EXTERNAL_TYPE_LINKS = new Map<string, string>([
  ['ChangeSpec', 'https://codemirror.net/docs/ref/#state.ChangeSpec'],
  ['CharCategory', 'https://codemirror.net/docs/ref/#state.CharCategory'],
  ['DecorationSet', 'https://codemirror.net/docs/ref/#view.DecorationSet'],
  ['Direction', 'https://codemirror.net/docs/ref/#view.Direction'],
  ['DOMEventHandlers', 'https://codemirror.net/docs/ref/#view.DOMEventHandlers'],
  ['Extension', 'https://codemirror.net/docs/ref/#state.Extension'],
  ['FacetReader', 'https://codemirror.net/docs/ref/#state.FacetReader'],
  ['Moment', 'https://momentjs.com/docs/#/parsing/'],
  ['MomentInput', 'https://momentjs.com/docs/#/parsing/'],
  ['RangeCursor', 'https://codemirror.net/docs/ref/#state.RangeCursor']
]);
// Cspell:enable

export const DOCS_SITE_CONFIG: DocsSiteConfig = {
  externalTypeLinks: EXTERNAL_TYPE_LINKS,
  repo: 'obsidian-lib',
  title: 'Obsidian Lib'
};
