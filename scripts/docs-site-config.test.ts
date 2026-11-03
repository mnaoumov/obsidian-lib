import type { TypeInfo } from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-types';

import {
  registerMemberPages,
  registerRouteSegments
} from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-link-rendering';
import { generateOverviewPage } from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-page-generation';
import { configureApiDocs } from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-settings';
import { processSourceFile } from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-source-processing';
import { resolveInheritedMembers } from '@mnaoumov/typescript-dev-toolkit/docs-site/api-doc-type-merging';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import dedent from 'dedent';
import { Project } from 'ts-morph';
import {
  describe,
  expect,
  it
} from 'vitest';

import { DOCS_SITE_CONFIG } from './docs-site-config.ts';

describe('API documentation links', () => {
  it.each(['OpenBugReportCommandHandler', 'OpenFeatureRequestCommandHandler'])('links external types and inherited members on %s', async (name) => {
    configureApiDocs({
      basePath: `/${DOCS_SITE_CONFIG.repo}`,
      externalTypeLinks: ensureNonNullable(DOCS_SITE_CONFIG.externalTypeLinks),
      outputDirectory: '/out/api',
      packageName: '@mnaoumov/obsidian-lib',
      packageSites: new Map(),
      sidebarFile: '/out/sidebar.json'
    });
    const project = new Project({ useInMemoryFileSystem: true });
    const source = project.createSourceFile(
      'commands.ts',
      dedent`
        export abstract class CommandHandler {
          protected icon: IconName;
          protected id: string;
          protected name: string;
          public buildCommand(): Command { throw new Error(); }
          public onRegistered(context: CommandHandlerRegistrationContext): void {}
        }
        export abstract class GlobalCommandHandler extends CommandHandler {}
        export abstract class OpenGitHubCommandHandler extends GlobalCommandHandler {
          protected gitHubRepo: string;
        }
        export class OpenBugReportCommandHandler extends OpenGitHubCommandHandler {
          protected app: App;
        }
        export class OpenFeatureRequestCommandHandler extends OpenGitHubCommandHandler {
          protected app: App;
        }
      `
    );
    const types = new Map<string, TypeInfo>();
    processSourceFile(source, types, 'command-handlers');
    resolveInheritedMembers(types);
    registerRouteSegments(types);
    registerMemberPages(types);
    const page = await generateOverviewPage(name, ensureNonNullable(types.get(`command-handlers#${name}`)), types);

    for (const type of ['App', 'Command', 'IconName']) {
      expect(page.content).toContain(JSON.stringify(`<a href="https://docs.obsidian.md/Reference/TypeScript%20API/${type}">${type}</a>`));
    }
    for (const member of ['icon', 'id', 'name', 'buildCommand', 'onRegistered']) {
      expect(page.content).toContain(`href: "/obsidian-lib/api/command-handlers/CommandHandler/${member}/"`);
    }
    expect(page.content).toContain('name: "app", href: "./app/"');
  });
});
