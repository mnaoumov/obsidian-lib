import type {
  App as AppOriginal,
  Plugin as PluginOriginal,
  TFile,
  TFolder
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import type { FolderNoteConfig } from './folder-note.ts';
import type { ThirdPartyPluginAdapter } from './plugin/third-party-plugin.ts';

import { getFile } from './file-system.ts';
import {
  FOLDER_INDEX_PLUGIN_ADAPTER,
  FOLDER_INDEX_PLUGIN_ID,
  FOLDER_NOTE_PLUGIN_ADAPTER,
  FOLDER_NOTE_PLUGIN_ID,
  FOLDER_NOTES_PLUGIN_ADAPTER,
  FOLDER_NOTES_PLUGIN_ID,
  FolderNoteLocation,
  getFolderIndexFolderNoteConfig,
  getFolderNoteFolder,
  getFolderNotePluginFolderNoteConfig,
  getFolderNotesPluginFolderNoteConfig,
  getWaypointFolderNoteConfig,
  resolveFolderNote,
  resolveFolderNoteConfig,
  resolveFolderNotePluginConfigs,
  WAYPOINT_PLUGIN_ADAPTER,
  WAYPOINT_PLUGIN_ID
} from './folder-note.ts';

const DEFAULT_FILES = { 'alpha/bravo/charlie/charlie.md': '' };

let app: AppOriginal;
// Kept alongside `app` because `registerPlugin__` is a mock-only seam: `asOriginalType__()` hands back the
// same object typed as Obsidian's `App`, whose `plugins` does not declare it.
let appMock: App;

/**
 * Resolves a config against a vault that has the folder-notes plugin configured as given.
 *
 * @param folderNotesSettings - That plugin's private settings, or `undefined` for "not installed".
 * @returns The resolved config.
 */
function autoConfigFor(folderNotesSettings?: unknown): FolderNoteConfig {
  initApp(DEFAULT_FILES, folderNotesSettings);
  return resolveFolderNoteConfig({ app });
}

function getFolder(path: string): TFolder {
  return ensureNonNullable(app.vault.getFolderByPath(path));
}

/**
 * Builds an app whose vault holds the given files, and whose plugin registry holds a `folder-notes` with
 * the given settings.
 *
 * @param files - The vault's files.
 * @param folderNotesSettings - That plugin's private settings, or `undefined` for "not installed".
 */
function initApp(files: Record<string, string>, folderNotesSettings?: unknown): void {
  appMock = App.createConfigured__({ files });
  if (folderNotesSettings !== undefined) {
    // The registry is typed to return a `Plugin` and every shape under test is deliberately NOT one —
    // that is the point, since these are another plugin's private settings.
    appMock.plugins.registerPlugin__(FOLDER_NOTES_PLUGIN_ID, castTo<PluginOriginal>({ settings: folderNotesSettings }));
  }
  app = appMock.asOriginalType__();
}

/**
 * Names the folder the fixtures use, through a resolved config.
 *
 * @param config - The config to name through.
 * @param folderPath - The folder's path.
 * @returns The resolved name.
 */
function resolveNameOf(config: FolderNoteConfig, folderPath = 'alpha/bravo/charlie'): string {
  return config.resolveName(getFolder(folderPath));
}

describe('resolveFolderNoteConfig', () => {
  describe('an explicit setup', () => {
    it('should be taken as given, defaulting to a Markdown note named after its folder', () => {
      initApp(DEFAULT_FILES);
      const config = resolveFolderNoteConfig({ app, location: FolderNoteLocation.InsideFolder });
      expect(config.extensions).toEqual(['md']);
      expect(config.isHidden).toBe(false);
      expect(config.location).toBe(FolderNoteLocation.InsideFolder);
      expect(resolveNameOf(config)).toBe('charlie');
    });

    it('should keep the caller\'s own naming, hiding and extensions', () => {
      initApp(DEFAULT_FILES);
      const config = resolveFolderNoteConfig({
        app,
        extensions: ['.CANVAS', 'md'],
        isHidden: true,
        location: FolderNoteLocation.ParentFolder,
        resolveName: () => 'index'
      });
      expect(config.extensions).toEqual(['canvas', 'md']);
      expect(config.isHidden).toBe(true);
      expect(config.location).toBe(FolderNoteLocation.ParentFolder);
      expect(resolveNameOf(config)).toBe('index');
    });

    it('should normalize extensions the way the folder-notes plugin does', () => {
      initApp(DEFAULT_FILES);
      expect(
        resolveFolderNoteConfig({
          app,
          extensions: [' .Excalidraw ', 'md', '', 'canvas', '.canvas'],
          location: FolderNoteLocation.InsideFolder
        }).extensions
      ).toEqual(['md', 'canvas']);
    });

    it('should ignore the installed plugin entirely', () => {
      initApp(DEFAULT_FILES, { folderNoteName: 'index', storageLocation: 'parentFolder' });
      const config = resolveFolderNoteConfig({ app, location: FolderNoteLocation.InsideFolder });
      expect(config.location).toBe(FolderNoteLocation.InsideFolder);
      expect(resolveNameOf(config)).toBe('charlie');
    });

    it('should report None as itself, so the caller resolves no note at all', () => {
      initApp(DEFAULT_FILES);
      expect(resolveFolderNoteConfig({ app, location: FolderNoteLocation.None }).location).toBe(FolderNoteLocation.None);
    });
  });

  describe('Auto', () => {
    it('should fall back to a Markdown note named after its folder, inside it, when the plugin is absent', () => {
      const config = autoConfigFor();
      expect(config.extensions).toEqual(['md']);
      expect(config.isHidden).toBe(false);
      expect(config.location).toBe(FolderNoteLocation.InsideFolder);
      expect(resolveNameOf(config)).toBe('charlie');
    });

    it('should be what an omitted location means', () => {
      initApp(DEFAULT_FILES, { folderNoteName: 'index', storageLocation: 'parentFolder' });
      expect(resolveFolderNoteConfig({ app }).location).toBe(FolderNoteLocation.ParentFolder);
    });

    it('should read the installed plugin, translating its own token', () => {
      const config = autoConfigFor({ folderNoteName: '{{folder_name}}', storageLocation: 'insideFolder' });
      expect(config.location).toBe(FolderNoteLocation.InsideFolder);
      expect(resolveNameOf(config)).toBe('charlie');
    });

    it('should read a fixed folder-note name from the installed plugin', () => {
      expect(resolveNameOf(autoConfigFor({ folderNoteName: 'index', storageLocation: 'insideFolder' }))).toBe('index');
    });

    it('should insert the folder name literally, never as a replacement pattern', () => {
      initApp({ 'alpha/$&/note.md': '' }, { folderNoteName: '{{folder_name}} note', storageLocation: 'insideFolder' });
      expect(resolveNameOf(resolveFolderNoteConfig({ app }), 'alpha/$&')).toBe('$& note');
    });

    it('should read the outside-the-folder location from the installed plugin', () => {
      expect(autoConfigFor({ folderNoteName: '{{folder_name}}', storageLocation: 'parentFolder' }).location).toBe(FolderNoteLocation.ParentFolder);
    });

    it('should read the plugin\'s hiding setting', () => {
      expect(autoConfigFor({ folderNoteName: 'index', hideFolderNote: true, storageLocation: 'insideFolder' }).isHidden).toBe(true);
      expect(autoConfigFor({ folderNoteName: 'index', hideFolderNote: 'yes', storageLocation: 'insideFolder' }).isHidden).toBe(false);
    });

    it('should try the plugin\'s primary type first and its other supported types after it', () => {
      expect(
        autoConfigFor({
          folderNoteName: 'index',
          folderNoteType: '.canvas',
          storageLocation: 'insideFolder',
          supportedFileTypes: ['md', 'canvas']
        }).extensions
      ).toEqual(['canvas', 'md']);
    });

    it('should treat the plugin\'s Excalidraw type as Markdown, as the plugin itself does', () => {
      expect(
        autoConfigFor({
          folderNoteName: 'index',
          folderNoteType: '.excalidraw',
          storageLocation: 'insideFolder',
          supportedFileTypes: ['excalidraw']
        }).extensions
      ).toEqual(['md']);
    });

    it('should keep Markdown resolvable even when the plugin names no usable type at all', () => {
      expect(
        autoConfigFor({
          folderNoteName: 'index',
          folderNoteType: 42,
          storageLocation: 'insideFolder',
          supportedFileTypes: 'not an array'
        }).extensions
      ).toEqual(['md']);
    });

    /*
     * Every shape below is a folder-notes install too old, too new or too broken to read. Each has to read
     * as "not configured" and fall back, because the alternative is an exception raised inside a click
     * handler.
     */
    it.each([
      ['the plugin keeps its notes in one central folder', { folderNoteName: '{{folder_name}}', storageLocation: 'vaultFolder' }],
      ['the storage location is not one it documents', { folderNoteName: '{{folder_name}}', storageLocation: null }],
      ['the settings are not an object', 'not an object'],
      ['the settings carry neither key', {}],
      ['no folder note is named at all', { storageLocation: 'insideFolder' }],
      ['the folder-note name is not a usable string', { folderNoteName: '', storageLocation: 'insideFolder' }],
      ['the folder-note name is not a string', { folderNoteName: 42, storageLocation: 'insideFolder' }]
    ])('should fall back when %s', (_description: string, folderNotesSettings: unknown) => {
      const config = autoConfigFor(folderNotesSettings);
      expect(config.extensions).toEqual(['md']);
      expect(config.location).toBe(FolderNoteLocation.InsideFolder);
      expect(resolveNameOf(config)).toBe('charlie');
    });

    it('should fall back when the installed plugin exposes no settings at all', () => {
      initApp(DEFAULT_FILES);
      // Registered directly rather than through `initApp`, which would give it a `settings` key: the case
      // under test is a plugin that exposes none at all.
      appMock.plugins.registerPlugin__(FOLDER_NOTES_PLUGIN_ID, castTo<PluginOriginal>({}));
      expect(resolveFolderNoteConfig({ app }).location).toBe(FolderNoteLocation.InsideFolder);
    });
  });
});

describe('resolveFolderNote', () => {
  function resolve(files: Record<string, string>, folderPath: string, config?: FolderNoteConfig): null | string {
    initApp(files);
    return resolveFolderNote({
      app,
      folder: getFolder(folderPath),
      ...config && { config }
    })?.path ?? null;
  }

  function configFor(location: FolderNoteLocation, extensions?: readonly string[], name?: string): FolderNoteConfig {
    return {
      extensions: extensions ?? ['md'],
      isHidden: false,
      location: location as FolderNoteConfig['location'],
      resolveName: name === undefined ? (folder: TFolder): string => folder.name : (): string => name
    };
  }

  it('should find a note named after its folder, inside it', () => {
    expect(resolve(DEFAULT_FILES, 'alpha/bravo/charlie')).toBe('alpha/bravo/charlie/charlie.md');
  });

  it('should find a fixed-name note inside the folder', () => {
    expect(resolve({ 'alpha/bravo/charlie/!.md': '' }, 'alpha/bravo/charlie', configFor(FolderNoteLocation.InsideFolder, undefined, '!')))
      .toBe('alpha/bravo/charlie/!.md');
  });

  it('should find a note sitting beside the folder', () => {
    expect(resolve(
      {
        'alpha/bravo/charlie.md': '',
        'alpha/bravo/charlie/note.md': ''
      },
      'alpha/bravo/charlie',
      configFor(FolderNoteLocation.ParentFolder)
    )).toBe('alpha/bravo/charlie.md');
  });

  it('should find a note beside a top-level folder, at the vault root', () => {
    expect(resolve(
      {
        'charlie.md': '',
        'charlie/note.md': ''
      },
      'charlie',
      configFor(FolderNoteLocation.ParentFolder)
    )).toBe('charlie.md');
  });

  it('should try the configured extensions in order', () => {
    expect(resolve({ 'alpha/bravo/charlie/charlie.canvas': '' }, 'alpha/bravo/charlie', configFor(FolderNoteLocation.InsideFolder, ['md', 'canvas'])))
      .toBe('alpha/bravo/charlie/charlie.canvas');
  });

  it('should find nothing when folder notes are turned off', () => {
    expect(resolve(DEFAULT_FILES, 'alpha/bravo/charlie', configFor(FolderNoteLocation.None))).toBeNull();
  });

  it('should find nothing when the folder simply has no folder note', () => {
    expect(resolve({ 'alpha/bravo/charlie/other.md': '' }, 'alpha/bravo/charlie')).toBeNull();
  });

  it('should find nothing when the name resolves to nothing', () => {
    expect(resolve(DEFAULT_FILES, 'alpha/bravo/charlie', configFor(FolderNoteLocation.InsideFolder, undefined, ' '.repeat(3)))).toBeNull();
  });

  it('should find nothing beside the vault root, which has no parent to hold a note', () => {
    initApp({ 'charlie/note.md': '' });
    expect(resolveFolderNote({
      app,
      config: configFor(FolderNoteLocation.ParentFolder),
      folder: app.vault.getRoot()
    })).toBeNull();
  });
});

describe('getFolderNoteFolder', () => {
  function fixedNameConfig(location: FolderNoteConfig['location'], name: string): FolderNoteConfig {
    return {
      extensions: ['md'],
      isHidden: false,
      location,
      resolveName: (folder: TFolder): string => name.replaceAll('{{folder_name}}', () => folder.name)
    };
  }

  function folderOf(files: Record<string, string>, filePath: string, config?: FolderNoteConfig): null | string {
    initApp(files);
    return getFolderNoteFolder({
      app,
      file: getFile({ app, pathOrFile: filePath, shouldIncludeNonExisting: true }),
      ...config && { config }
    })?.path ?? null;
  }

  it('should find the folder a fixed-name note sits inside', () => {
    expect(folderOf({ 'alpha/bravo/charlie/!.md': '' }, 'alpha/bravo/charlie/!.md', fixedNameConfig(FolderNoteLocation.InsideFolder, '!')))
      .toBe('alpha/bravo/charlie');
  });

  it('should find the folder a note sits beside', () => {
    expect(folderOf(
      { 'alpha/bravo/charlie/delta.md': '', 'alpha/bravo/charlie note.md': '' },
      'alpha/bravo/charlie note.md',
      fixedNameConfig(FolderNoteLocation.ParentFolder, '{{folder_name}} note')
    )).toBe('alpha/bravo/charlie');
  });

  it('should find a folder beside a note at the vault root', () => {
    expect(folderOf({ 'charlie.md': '', 'charlie/delta.md': '' }, 'charlie.md', fixedNameConfig(FolderNoteLocation.ParentFolder, '{{folder_name}}')))
      .toBe('charlie');
  });

  it('should take the installed plugin\'s setup when no config is given', () => {
    initApp({ 'alpha/bravo/charlie/!.md': '' }, { folderNoteName: '!', storageLocation: 'insideFolder' });
    expect(getFolderNoteFolder({ app, file: getFile({ app, pathOrFile: 'alpha/bravo/charlie/!.md' }) })?.path).toBe('alpha/bravo/charlie');
  });

  it('should not treat a note at the vault root as the root\'s folder note', () => {
    expect(folderOf({ '!.md': '' }, '!.md', fixedNameConfig(FolderNoteLocation.InsideFolder, '!'))).toBeNull();
  });

  it('should not treat an ordinary note as a folder note', () => {
    expect(folderOf({ 'alpha/bravo/charlie/note.md': '' }, 'alpha/bravo/charlie/note.md', fixedNameConfig(FolderNoteLocation.InsideFolder, '!')))
      .toBeNull();
    expect(folderOf(
      { 'alpha/bravo/charlie/delta.md': '', 'alpha/bravo/note.md': '' },
      'alpha/bravo/note.md',
      fixedNameConfig(FolderNoteLocation.ParentFolder, '{{folder_name}}')
    )).toBeNull();
  });

  it('should answer null when the vault has no folder notes', () => {
    expect(folderOf({ 'alpha/bravo/charlie/!.md': '' }, 'alpha/bravo/charlie/!.md', fixedNameConfig(FolderNoteLocation.None, '!'))).toBeNull();
  });

  it('should not treat a non-existing file as a folder note', () => {
    expect(folderOf({ 'alpha/bravo/charlie/delta.md': '' }, 'alpha/bravo/charlie/!.md', fixedNameConfig(FolderNoteLocation.InsideFolder, '!')))
      .toBeNull();
  });

  it('should answer null for a file with no parent', () => {
    initApp({});
    const file = castTo<TFile>({ parent: null });
    expect(getFolderNoteFolder({ app, config: fixedNameConfig(FolderNoteLocation.InsideFolder, '!'), file })).toBeNull();
  });
});

describe('folder-note plugin adapters', () => {
  function pluginWith(settings: unknown): PluginOriginal {
    return castTo<PluginOriginal>({ settings });
  }

  it('should hand back the live settings object of a recognized shape', () => {
    const settings = { folderNoteName: '{{folder_name}}', storageLocation: 'insideFolder' };
    expect(FOLDER_NOTES_PLUGIN_ADAPTER.getApi(pluginWith(settings))).toBe(settings);
    const folderNoteSettings = { folderNoteHide: true, folderNoteName: '_about_', folderNoteType: 'index' };
    expect(FOLDER_NOTE_PLUGIN_ADAPTER.getApi(pluginWith(folderNoteSettings))).toBe(folderNoteSettings);
    const waypointSettings = { folderNoteFilename: 'index', folderNoteType: 'INSIDE_FOLDER' };
    expect(WAYPOINT_PLUGIN_ADAPTER.getApi(pluginWith(waypointSettings))).toBe(waypointSettings);
    const folderIndexSettings = { indexFilename: '!', indexFileUserSpecified: false };
    expect(FOLDER_INDEX_PLUGIN_ADAPTER.getApi(pluginWith(folderIndexSettings))).toBe(folderIndexSettings);
  });

  it('should name each plugin by its manifest id', () => {
    expect(FOLDER_NOTES_PLUGIN_ADAPTER.pluginId).toBe(FOLDER_NOTES_PLUGIN_ID);
    expect(FOLDER_NOTE_PLUGIN_ADAPTER.pluginId).toBe(FOLDER_NOTE_PLUGIN_ID);
    expect(WAYPOINT_PLUGIN_ADAPTER.pluginId).toBe(WAYPOINT_PLUGIN_ID);
    expect(FOLDER_INDEX_PLUGIN_ADAPTER.pluginId).toBe(FOLDER_INDEX_PLUGIN_ID);
  });

  it.each([
    ['an instance with no settings', castTo<PluginOriginal>({})],
    ['settings that are not an object', pluginWith('not an object')],
    ['settings that are null', pluginWith(null)]
  ])('should answer null for %s', (_description: string, plugin: PluginOriginal) => {
    expect(FOLDER_NOTES_PLUGIN_ADAPTER.getApi(plugin)).toBeNull();
    expect(FOLDER_NOTE_PLUGIN_ADAPTER.getApi(plugin)).toBeNull();
    expect(WAYPOINT_PLUGIN_ADAPTER.getApi(plugin)).toBeNull();
    expect(FOLDER_INDEX_PLUGIN_ADAPTER.getApi(plugin)).toBeNull();
  });

  it.each([
    ['folder-notes: a numeric primary type', FOLDER_NOTES_PLUGIN_ADAPTER, { folderNoteName: 'index', folderNoteType: 42, storageLocation: 'insideFolder' }],
    ['folder-notes: a non-boolean hide flag', FOLDER_NOTES_PLUGIN_ADAPTER, { folderNoteName: 'index', hideFolderNote: 'yes', storageLocation: 'insideFolder' }],
    ['folder-notes: supported types that are not an array', FOLDER_NOTES_PLUGIN_ADAPTER, {
      folderNoteName: 'index',
      storageLocation: 'insideFolder',
      supportedFileTypes: 'md'
    }],
    ['folder-notes: a supported type that is not a string', FOLDER_NOTES_PLUGIN_ADAPTER, {
      folderNoteName: 'index',
      storageLocation: 'insideFolder',
      supportedFileTypes: ['md', 42]
    }],
    ['folder-notes: no storage location', FOLDER_NOTES_PLUGIN_ADAPTER, { folderNoteName: 'index' }],
    ['Folder Note: no type', FOLDER_NOTE_PLUGIN_ADAPTER, { folderNoteName: '_about_' }],
    ['Folder Note: a non-boolean hide flag', FOLDER_NOTE_PLUGIN_ADAPTER, { folderNoteHide: 1, folderNoteName: '_about_', folderNoteType: 'inside' }],
    ['Waypoint: no file name', WAYPOINT_PLUGIN_ADAPTER, { folderNoteType: 'CUSTOM_FILENAME' }],
    ['Folder Index: a non-boolean switch', FOLDER_INDEX_PLUGIN_ADAPTER, { indexFilename: '!', indexFileUserSpecified: 'true' }]
  ])('should answer null for %s', (_description: string, adapter: ThirdPartyPluginAdapter<object>, settings: unknown) => {
    expect(adapter.getApi(pluginWith(settings))).toBeNull();
  });
});

describe('folder-note plugin mappings', () => {
  function describeConfig(config: FolderNoteConfig | null): null | string {
    if (!config) {
      return null;
    }
    initApp(DEFAULT_FILES);
    return `${config.location}:${resolveNameOf(config)}:${config.extensions.join(',')}:${String(config.isHidden)}`;
  }

  it('should map folder-notes the way Auto reads it', () => {
    expect(describeConfig(getFolderNotesPluginFolderNoteConfig({
      folderNoteName: '{{folder_name}} note',
      folderNoteType: '.canvas',
      hideFolderNote: true,
      storageLocation: 'parentFolder',
      supportedFileTypes: ['md', 'canvas']
    }))).toBe('ParentFolder:charlie note:canvas,md:true');
    expect(getFolderNotesPluginFolderNoteConfig({ folderNoteName: '{{folder_name}}', storageLocation: 'vaultFolder' })).toBeNull();
    expect(getFolderNotesPluginFolderNoteConfig({ folderNoteName: '', storageLocation: 'insideFolder' })).toBeNull();
  });

  it.each([
    [{ folderNoteName: '_about_', folderNoteType: 'index' }, 'InsideFolder:_about_:md:false'],
    [{ folderNoteHide: true, folderNoteName: '_about_', folderNoteType: 'inside' }, 'InsideFolder:charlie:md:true'],
    [{ folderNoteName: '_about_', folderNoteType: 'outside' }, 'ParentFolder:charlie:md:false'],
    [{ folderNoteName: '_about_', folderNoteType: 'unknown' }, 'InsideFolder:charlie:md:false']
  ])('should map Folder Note %o', (settings, expected: string) => {
    expect(describeConfig(getFolderNotePluginFolderNoteConfig(settings))).toBe(expected);
  });

  it.each([
    [{ folderNoteFilename: 'index', folderNoteType: 'CUSTOM_FILENAME' }, 'InsideFolder:index:md:false'],
    [{ folderNoteFilename: 'index', folderNoteType: 'INSIDE_FOLDER' }, 'InsideFolder:charlie:md:false'],
    [{ folderNoteFilename: 'index', folderNoteType: 'OUTSIDE_FOLDER' }, 'ParentFolder:charlie:md:false'],
    [{ folderNoteFilename: 'index', folderNoteType: 'unknown' }, 'InsideFolder:charlie:md:false']
  ])('should map Waypoint %o', (settings, expected: string) => {
    expect(describeConfig(getWaypointFolderNoteConfig(settings))).toBe(expected);
  });

  it.each([
    [{ indexFilename: '!', indexFileUserSpecified: true }, 'InsideFolder:!:md:false'],
    [{ indexFilename: '!', indexFileUserSpecified: false }, 'InsideFolder:charlie:md:false']
  ])('should map Folder Index %o', (settings, expected: string) => {
    expect(describeConfig(getFolderIndexFolderNoteConfig(settings))).toBe(expected);
  });
});

describe('resolveFolderNotePluginConfigs', () => {
  it('should answer nothing when no folder-note plugin is enabled', () => {
    initApp(DEFAULT_FILES);
    expect(resolveFolderNotePluginConfigs({ app })).toEqual([]);
  });

  it('should list every recognized plugin, in download order, skipping what it cannot read', () => {
    initApp(DEFAULT_FILES, { folderNoteName: '{{folder_name}}', storageLocation: 'vaultFolder' });
    appMock.plugins.registerPlugin__(FOLDER_INDEX_PLUGIN_ID, castTo<PluginOriginal>({ settings: { indexFilename: '!', indexFileUserSpecified: true } }));
    appMock.plugins.registerPlugin__(WAYPOINT_PLUGIN_ID, castTo<PluginOriginal>({ settings: { folderNoteFilename: 'index', folderNoteType: 'OUTSIDE_FOLDER' } }));
    appMock.plugins.registerPlugin__(FOLDER_NOTE_PLUGIN_ID, castTo<PluginOriginal>({ settings: { folderNoteType: 'index' } }));
    const configs = resolveFolderNotePluginConfigs({ app });
    expect(configs.map((config) => `${config.location}:${resolveNameOf(config)}`)).toEqual(['ParentFolder:charlie', 'InsideFolder:!']);
  });

  it('should put folder-notes first', () => {
    initApp(DEFAULT_FILES, { folderNoteName: 'index', storageLocation: 'insideFolder' });
    appMock.plugins.registerPlugin__(FOLDER_NOTE_PLUGIN_ID, castTo<PluginOriginal>({ settings: { folderNoteName: '_about_', folderNoteType: 'index' } }));
    expect(resolveFolderNotePluginConfigs({ app }).map((config) => resolveNameOf(config))).toEqual(['index', '_about_']);
  });
});
