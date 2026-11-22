/**
 * @file
 *
 * Integration tests for the link-at-position helper, in a real Markdown editor.
 *
 * They move the real cursor of a real editor onto each link position, including the position right before
 * a link and a link in the frontmatter, and resolve each link's target through the real metadata cache.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface Probe {
  readonly ch: number;
  readonly frontmatterKey: null | string;
  readonly isInFrontmatter: boolean | null;
  readonly line: number;
  readonly raw: null | string;
  readonly targetPath: null | string;
}

interface ProbeResult {
  readonly probes: readonly Probe[];
}

describe('getLinkAtEditorPosition', () => {
  it('finds the link at the cursor in the body and the frontmatter of a real editor', async () => {
    const result = await evalInObsidian<Record<string, never>, ProbeResult>({
      async callback({ app, lib: { getLinkAtEditorPosition, getLinkAtPositionTarget, waitUntil } }) {
        const folder = 'link-at-position-integration';
        if (!app.vault.getFolderByPath(folder)) {
          await app.vault.createFolder(folder);
        }

        const targetPath = `${folder}/target.md`;
        if (!app.vault.getFileByPath(targetPath)) {
          await app.vault.create(targetPath, 'target');
        }

        const sourcePath = `${folder}/source.md`;
        const content = [
          '---',
          'single: "[[target]]"',
          'list:',
          '  - "[[target#Heading]]"',
          '---',
          'before [alias](target.md) after',
          '- [[target]][x](https://example.com)'
        ].join('\n');
        const existing = app.vault.getFileByPath(sourcePath);
        const file = existing ?? await app.vault.create(sourcePath, content);
        if (existing) {
          await app.vault.modify(file, content);
        }

        const leaf = app.workspace.getLeaf(true);
        // Source mode: Live Preview renders the frontmatter as the Properties widget, which the cursor cannot enter.
        await leaf.openFile(file, { state: { mode: 'source', source: true } });
        await waitUntil({
          message: 'the editor shows the note',
          predicate: () => app.workspace.activeEditor?.editor?.getValue() === content,
          timeoutInMilliseconds: 10_000
        });
        const editor = app.workspace.activeEditor?.editor;
        if (!editor) {
          throw new Error('no active editor after opening the note');
        }

        const positions = [
          { ch: 8, line: 1 },
          { ch: 20, line: 1 },
          { ch: 0, line: 2 },
          { ch: 7, line: 5 },
          { ch: 15, line: 5 },
          { ch: 25, line: 5 },
          { ch: 6, line: 5 },
          { ch: 2, line: 6 },
          { ch: 12, line: 6 }
        ];
        const probes: Probe[] = [];
        for (const position of positions) {
          editor.setCursor(position);
          const link = getLinkAtEditorPosition({ editor });
          const target = link ? getLinkAtPositionTarget({ app, link, sourcePath }) : null;
          probes.push({
            ch: position.ch,
            frontmatterKey: link?.frontmatterKey ?? null,
            isInFrontmatter: link?.isInFrontmatter ?? null,
            line: position.line,
            raw: link?.parseLinkResult.raw ?? null,
            targetPath: target?.path ?? null
          });
        }

        leaf.detach();
        return { probes };
      }
    });

    expect(result.probes).toEqual([
      // The quotes belong to the link: the opening quote, then the closing one.
      { ch: 8, frontmatterKey: 'single', isInFrontmatter: true, line: 1, raw: '[[target]]', targetPath: 'link-at-position-integration/target.md' },
      { ch: 20, frontmatterKey: 'single', isInFrontmatter: true, line: 1, raw: '[[target]]', targetPath: 'link-at-position-integration/target.md' },
      // A key whose nested value holds one link.
      { ch: 0, frontmatterKey: 'list', isInFrontmatter: true, line: 2, raw: '[[target#Heading]]', targetPath: 'link-at-position-integration/target.md' },
      // Right before the link, inside it and right after it.
      { ch: 7, frontmatterKey: null, isInFrontmatter: false, line: 5, raw: '[alias](target.md)', targetPath: 'link-at-position-integration/target.md' },
      { ch: 15, frontmatterKey: null, isInFrontmatter: false, line: 5, raw: '[alias](target.md)', targetPath: 'link-at-position-integration/target.md' },
      { ch: 25, frontmatterKey: null, isInFrontmatter: false, line: 5, raw: '[alias](target.md)', targetPath: 'link-at-position-integration/target.md' },
      { ch: 6, frontmatterKey: null, isInFrontmatter: null, line: 5, raw: null, targetPath: null },
      { ch: 2, frontmatterKey: null, isInFrontmatter: false, line: 6, raw: '[[target]]', targetPath: 'link-at-position-integration/target.md' },
      // Two touching links: the one the cursor is before.
      { ch: 12, frontmatterKey: null, isInFrontmatter: false, line: 6, raw: '[x](https://example.com)', targetPath: null }
    ]);
  });
});
