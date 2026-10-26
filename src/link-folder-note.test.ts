import type {
  App as AppOriginal,
  Plugin as PluginOriginal,
  Reference
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
// @vitest-environment jsdom
import {
  describe,
  expect,
  it
} from 'vitest';

import { FOLDER_NOTES_PLUGIN_ID } from './folder-note.ts';
import {
  generateMarkdownLink,
  LinkPathStyle,
  LinkStyle,
  updateLink
} from './link.ts';

/**
 * Builds an app whose vault holds the given files and whose `folder-notes` is configured as given.
 *
 * @param files - The vault's files.
 * @param folderNotesSettings - That plugin's private settings.
 * @returns The app.
 */
function createApp(files: Record<string, string>, folderNotesSettings: unknown): AppOriginal {
  const appMock = App.createConfigured__({ files });
  appMock.plugins.registerPlugin__(FOLDER_NOTES_PLUGIN_ID, castTo<PluginOriginal>({ settings: folderNotesSettings }));
  return appMock.asOriginalType__();
}

const INSIDE_FOLDER_SETTINGS = { folderNoteName: '!', storageLocation: 'insideFolder' };
const INSIDE_FOLDER_FILES = { 'alpha/bravo/charlie/!.md': '', 'note.md': '' };

interface UpdateParams {
  readonly app?: AppOriginal;
  readonly linkStyle?: LinkStyle;
  readonly newTargetPath?: string;
  readonly oldTargetPath?: string;
  readonly original: string;
  readonly shouldUpdateFileNameAlias?: boolean;
}

function update(params: UpdateParams): string {
  const {
    linkStyle,
    newTargetPath = 'alpha/bravo/charlie/!.md',
    oldTargetPath = 'alpha/bravo/charlie.md',
    original,
    shouldUpdateFileNameAlias = true
  } = params;
  const app = params.app ?? createApp(INSIDE_FOLDER_FILES, INSIDE_FOLDER_SETTINGS);
  const linkPath = /\[\[(?<path>[^\]|]*)/.exec(original)?.groups?.['path'] ?? /\((?<path>[^)]*)\)/.exec(original)?.groups?.['path'] ?? '';
  const link = castTo<Reference>({
    displayText: '',
    link: linkPath,
    original
  });
  return updateLink({
    app,
    link,
    linkPathStyle: LinkPathStyle.AbsolutePathInVault,
    ...linkStyle && { linkStyle },
    newSourcePathOrFile: 'note.md',
    newTargetPathOrFile: newTargetPath,
    oldTargetPathOrFile: oldTargetPath,
    shouldUpdateFileNameAlias
  });
}

describe('folder-note link captions', () => {
  describe('updateLink', () => {
    it('should keep the folder\'s name as the caption when a note becomes a folder note', () => {
      expect(update({ linkStyle: LinkStyle.Markdown, original: '[charlie](alpha/bravo/charlie.md)' }))
        .toBe('[charlie](alpha/bravo/charlie/!.md)');
    });

    it('should keep the folder\'s name with the extension when the caption carried one', () => {
      expect(update({ linkStyle: LinkStyle.Markdown, original: '[charlie.md](alpha/bravo/charlie.md)' }))
        .toBe('[charlie.md](alpha/bravo/charlie/!.md)');
    });

    it('should give an alias-less wikilink the folder\'s name as its alias', () => {
      expect(update({ linkStyle: LinkStyle.Wikilink, original: '[[alpha/bravo/charlie]]' }))
        .toBe('[[alpha/bravo/charlie/!|charlie]]');
    });

    it('should leave an alias-less wikilink alone when the flag is off', () => {
      expect(update({ linkStyle: LinkStyle.Wikilink, original: '[[alpha/bravo/charlie]]', shouldUpdateFileNameAlias: false }))
        .toBe('[[alpha/bravo/charlie/!]]');
    });

    it('should not alias an embed or a wikilink with a subpath', () => {
      expect(update({ linkStyle: LinkStyle.Wikilink, original: '![[alpha/bravo/charlie]]' })).toBe('![[alpha/bravo/charlie/!]]');
      expect(update({ linkStyle: LinkStyle.Wikilink, original: '[[alpha/bravo/charlie#Heading]]' }))
        .toBe('[[alpha/bravo/charlie/!#Heading]]');
    });

    it('should refresh the folder\'s name when the folder itself is renamed', () => {
      const app = createApp({ 'alpha/bravo/delta/!.md': '', 'note.md': '' }, INSIDE_FOLDER_SETTINGS);
      expect(update({
        app,
        linkStyle: LinkStyle.Markdown,
        newTargetPath: 'alpha/bravo/delta/!.md',
        oldTargetPath: 'alpha/bravo/charlie/!.md',
        original: '[charlie](alpha/bravo/charlie/!.md)'
      })).toBe('[delta](alpha/bravo/delta/!.md)');
    });

    it('should keep the folder\'s name for a note beside its folder', () => {
      const app = createApp(
        { 'alpha/bravo/charlie/delta.md': '', 'alpha/bravo/charlie note.md': '', 'note.md': '' },
        { folderNoteName: '{{folder_name}} note', storageLocation: 'parentFolder' }
      );
      expect(update({
        app,
        linkStyle: LinkStyle.Markdown,
        newTargetPath: 'alpha/bravo/charlie note.md',
        oldTargetPath: 'alpha/bravo/charlie.md',
        original: '[charlie](alpha/bravo/charlie.md)'
      })).toBe('[charlie](alpha/bravo/charlie%20note.md)');
    });
  });

  describe('generateMarkdownLink', () => {
    it('should caption a new markdown link to a folder note with the folder\'s name', () => {
      const app = createApp(INSIDE_FOLDER_FILES, INSIDE_FOLDER_SETTINGS);
      expect(generateMarkdownLink({
        app,
        linkPathStyle: LinkPathStyle.AbsolutePathInVault,
        linkStyle: LinkStyle.Markdown,
        sourcePathOrFile: 'note.md',
        targetPathOrFile: 'alpha/bravo/charlie/!.md'
      })).toBe('[charlie](alpha/bravo/charlie/!.md)');
    });

    it('should caption an ordinary note with its base name', () => {
      const app = createApp({ 'alpha/bravo/charlie/delta.md': '', 'note.md': '' }, INSIDE_FOLDER_SETTINGS);
      expect(generateMarkdownLink({
        app,
        linkPathStyle: LinkPathStyle.AbsolutePathInVault,
        linkStyle: LinkStyle.Markdown,
        sourcePathOrFile: 'note.md',
        targetPathOrFile: 'alpha/bravo/charlie/delta.md'
      })).toBe('[delta](alpha/bravo/charlie/delta.md)');
    });
  });
});
