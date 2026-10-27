/**
 * @file
 *
 * This repository's documentation site, shared by `astro.config.ts` and the `docs:*` scripts.
 */

import type { DocsSiteConfig } from '@mnaoumov/typescript-dev-toolkit/docs-site/docs-site-config';

import { OBSIDIAN_EXTERNAL_TYPE_LINKS } from '@mnaoumov/obsidian-dev-toolkit/docs-site/obsidian-external-type-links';

export const DOCS_SITE_CONFIG: DocsSiteConfig = {
  externalTypeLinks: OBSIDIAN_EXTERNAL_TYPE_LINKS,
  repo: 'obsidian-lib',
  repoHomepage: 'set',
  title: 'Obsidian Lib'
};
