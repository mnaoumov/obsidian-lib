/**
 * @file
 *
 * Integration tests for link editing against a real Obsidian instance.
 *
 * The `file://` cases confirm the end-to-end round-trip (real metadata parse -> link selection ->
 * converter -> frontmatter/body write-back) normalizes `file://` links in BOTH the note body and
 * frontmatter values.
 *
 * The offset-range cases confirm the range filter against positions produced by Obsidian's own parser
 * rather than hand-built fixtures, and pin the contract a selection command depends on: a range taken
 * from an UNSAVED editor buffer is valid, because the buffer is flushed to disk before the content is
 * read. The last of them pins the range reaching `editLinks` through `updateLinksInFile`, the wrapper a
 * plugin actually calls, so an out-of-range link is proved to survive a real conversion.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

// cspell:ignoreRegExp /%[0-9A-F]{2}/g

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface AngleDestinationResult {
  readonly converted: string;
  readonly convertedAgain: string;
  readonly renderedDestinations: string[];
  readonly resolvedHeadings: (string | undefined)[];
}

/**
 * Result of the `file://` normalization test.
 */
interface NormalizeResult {
  readonly result: string;
}

/**
 * Result of the dirty-editor-buffer offset-range test.
 */
interface OffsetRangeFromEditorResult {
  readonly diskAfterEdit: string;
  readonly selectedEndOffset: number;
  readonly selectedStartOffset: number;
}

/**
 * Result of the `updateLinksInFile` selection-scope test.
 */
interface UpdateLinksInFileResult {
  readonly diskAfterEdit: string;
}

describe('angle-bracket heading destinations', () => {
  it('should keep plain and code-span headings linked after repeated conversion', async () => {
    const result = await evalInObsidian<Record<string, never>, AngleDestinationResult>({
      async callback({ app, lib: { LinkStyle, updateLinksInContent, waitUntil }, obsidianModule }) {
        const { Component, MarkdownRenderer, resolveSubpath } = obsidianModule;
        const headings = ['Angle <note> in a heading', 'Code `<note>` in a heading'];
        const path = 'angle-destination-headings.md';
        const content = headings.map((heading) => `## ${heading}\n\n[heading](#${heading.replaceAll(' ', '%20')})\n`).join('\n');
        const file = await app.vault.create(path, content);
        const component = new Component();
        component.load();
        try {
          await waitUntil({
            message: 'index angle-destination headings',
            predicate: () => app.metadataCache.getFileCache(file)?.headings?.length === headings.length
          });
          const converted = await updateLinksInContent({
            app,
            content,
            linkStyle: LinkStyle.Markdown,
            newSourcePathOrFile: file,
            shouldUseAngleBrackets: true
          });
          const convertedAgain = await updateLinksInContent({
            app,
            content: converted,
            linkStyle: LinkStyle.Markdown,
            newSourcePathOrFile: file,
            shouldUseAngleBrackets: true
          });
          const container = createDiv();
          await MarkdownRenderer.render(app, converted, container, path, component);
          const renderedDestinations = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.internal-link'), (anchor) => anchor.dataset['href'] ?? '');
          const cache = app.metadataCache.getFileCache(file);
          if (!cache) {
            throw new Error('Expected indexed headings');
          }
          const resolvedHeadings = renderedDestinations.map((destination) => {
            const resolved = resolveSubpath(cache, decodeURIComponent(destination.slice(destination.indexOf('#'))));
            return resolved?.type === 'heading' ? resolved.current.heading : undefined;
          });
          return { converted, convertedAgain, renderedDestinations, resolvedHeadings };
        } finally {
          component.unload();
          await app.fileManager.trashFile(file);
        }
      }
    });

    expect(result.converted).toContain('[heading](<#Angle %3Cnote%3E in a heading>)');
    expect(result.converted).toContain('[heading](<#Code `%3Cnote%3E` in a heading>)');
    expect(result.convertedAgain).toBe(result.converted);
    expect(result.renderedDestinations).toHaveLength(2);
    expect(result.resolvedHeadings).toEqual(['Angle <note> in a heading', 'Code `<note>` in a heading']);
  });
});

describe('file:// link normalization', () => {
  it('should normalize file:// links in both frontmatter and body', async () => {
    const { result } = await evalInObsidian<Record<string, never>, NormalizeResult>({
      async callback({ app, lib: { updateFileUrlLinksInContent } }) {
        const content = '---\nurl: file:///F:%5Cover%5Care.txt\n---\n\n[body](file:///F:%5Cover%5Cage.txt)\n';
        const normalized = await updateFileUrlLinksInContent({ app, content });
        return { result: normalized };
      }
    });

    expect(result).toContain('file:///F:/over/are.txt');
    expect(result).toContain('[body](file:///F:/over/age.txt)');
    expect(result).not.toContain('%5C');
  });

  it('should normalize each file:// link within a multi-link frontmatter value', async () => {
    const { result } = await evalInObsidian<Record<string, never>, NormalizeResult>({
      async callback({ app, lib: { updateFileUrlLinksInContent } }) {
        const content = '---\nurls: "file:///F:%5Ca%5Cx.txt file:///F:%5Cb%5Cy.txt"\n---\n';
        const normalized = await updateFileUrlLinksInContent({ app, content });
        return { result: normalized };
      }
    });

    expect(result).toContain('file:///F:/a/x.txt');
    expect(result).toContain('file:///F:/b/y.txt');
    expect(result).not.toContain('%5C');
  });
});

describe('offset range', () => {
  it('should rewrite only the link fully contained in the range, against real parsed positions', async () => {
    const { result } = await evalInObsidian<Record<string, never>, NormalizeResult>({
      async callback({ app, lib: { editLinksInContent } }) {
        const content = '[[alpha]] [[bravo]] [[charlie]]\n';
        // `[[bravo]]` spans exactly 10-19, so this also pins the inclusive bounds.
        const edited = await editLinksInContent({
          app,
          content,
          linkConverter: (link) => `[[new-${link.link}]]`,
          offsetRange: { endOffset: 19, startOffset: 10 }
        });
        return { result: edited };
      }
    });

    expect(result).toBe('[[alpha]] [[new-bravo]] [[charlie]]\n');
  });

  it('should honour a range taken from a dirty editor buffer, because the buffer is flushed before reading', async () => {
    const result = await evalInObsidian<Record<string, never>, OffsetRangeFromEditorResult>({
      async callback({ app, lib: { editLinks }, obsidianModule }) {
        const { MarkdownView } = obsidianModule;
        const targetPath = 'offset-range.md';
        const diskContent = '[[alpha]] [[bravo]] [[charlie]]\n';
        // The buffer gains a heading, shifting every link 7 characters past its on-disk offset.
        const bufferContent = `# note\n${diskContent}`;

        const file = await app.vault.create(targetPath, diskContent);
        const leaf = app.workspace.getLeaf(true);
        try {
          await leaf.openFile(file);
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) {
            throw new TypeError('expected a MarkdownView');
          }
          const editor = view.editor;

          // Mimic a consumer that typed into the note and has not saved: disk and buffer now disagree.
          editor.setValue(bufferContent);

          // Select `[[bravo]]` the way a selection command does, then convert the selection to offsets.
          const bravoStart = bufferContent.indexOf('[[bravo]]');
          editor.setSelection(editor.offsetToPos(bravoStart), editor.offsetToPos(bravoStart + '[[bravo]]'.length));
          const selectedStartOffset = editor.posToOffset(editor.getCursor('from'));
          const selectedEndOffset = editor.posToOffset(editor.getCursor('to'));

          await editLinks({
            app,
            linkConverter: (link) => `[[new-${link.link}]]`,
            offsetRange: { endOffset: selectedEndOffset, startOffset: selectedStartOffset },
            pathOrFile: file,
            pluginNoticeComponent: null,
            resourceLockComponent: null,
            timeoutInMilliseconds: 10_000
          });

          return {
            diskAfterEdit: await app.vault.adapter.read(targetPath),
            selectedEndOffset,
            selectedStartOffset
          };
        } finally {
          leaf.detach();
          if (await app.vault.adapter.exists(targetPath)) {
            await app.vault.adapter.trashLocal(targetPath);
          }
        }
      }
    });

    /*
     * The offsets are the BUFFER's, 7 past the on-disk ones — applying them to the stale disk content
     * would have matched no link at all.
     */
    expect(result.selectedStartOffset).toBe(17);
    expect(result.selectedEndOffset).toBe(26);
    expect(result.diskAfterEdit).toBe('# note\n[[alpha]] [[new-bravo]] [[charlie]]\n');
  });

  /*
   * `updateLinksInFile` is the function a plugin actually calls to convert the links in a note, and it
   * reaches the range filter only by forwarding the param on to `editLinks`. The unit suite pins the
   * forward against a hand-built cache; this pins it end to end, against Obsidian's own parser and its own
   * link generator, so an out-of-range link is proved to survive a real conversion rather than a mocked one.
   */
  it('should leave a link outside the range untouched when updateLinksInFile converts a selection', async () => {
    const { diskAfterEdit } = await evalInObsidian<Record<string, never>, UpdateLinksInFileResult>({
      async callback({ app, lib: { LinkStyle, updateLinksInFile } }) {
        const targetPath = 'selection-scope.md';
        const alphaPath = 'alpha.md';
        const charliePath = 'charlie.md';
        const content = '[[alpha]] [[charlie]]\n';

        const alphaFile = await app.vault.create(alphaPath, '# alpha\n');
        const charlieFile = await app.vault.create(charliePath, '# charlie\n');
        const file = await app.vault.create(targetPath, content);
        try {
          // `[[alpha]]` spans exactly 0-9; `[[charlie]]` starts at 10 and is therefore wholly outside.
          await updateLinksInFile({
            app,
            linkStyle: LinkStyle.Markdown,
            newSourcePathOrFile: file,
            offsetRange: { endOffset: '[[alpha]]'.length, startOffset: 0 },
            pluginNoticeComponent: null,
            resourceLockComponent: null,
            timeoutInMilliseconds: 10_000
          });

          return { diskAfterEdit: await app.vault.adapter.read(targetPath) };
        } finally {
          await app.fileManager.trashFile(file);
          await app.fileManager.trashFile(alphaFile);
          await app.fileManager.trashFile(charlieFile);
        }
      }
    });

    expect(diskAfterEdit).toBe('[alpha](alpha.md) [[charlie]]\n');
  });
});
