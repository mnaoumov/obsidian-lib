/**
 * @file
 *
 * The folder-note concept: which note, if any, is the one whose properties describe a FOLDER itself.
 *
 * Obsidian has no such concept — it is a convention the community settled on, and the plugin that owns it
 * for most vaults is [`folder-notes`](https://community.obsidian.md/plugins/folder-notes). So the answer to
 * "which note belongs to this folder" is that plugin's to give whenever it is installed, and this module
 * asks it rather than inventing a second answer: {@link FolderNoteLocation.Auto} — the default — reads its
 * live configuration at every use.
 *
 * Reading it live rather than copying its values into a consumer's own settings is deliberate: a copy goes
 * stale the moment that plugin is reconfigured, and it would need a settings migration to seed. Everything
 * else is the caller's explicit choice, and then the other plugin is not consulted at all.
 *
 * The other folder-note plugins (`Folder Note`, `Waypoint`, `Folder Index`) are read the same way, each through a`n * `ThirdPartyPluginAdapter` whose API is its verified live settings, and {@link resolveFolderNotePluginConfigs}`n * collects the setups of every enabled one.
 *
 * Nothing here ever CREATES a note. A folder with no folder note answers `null`, which is what lets a
 * caller layer folder-note behavior onto a click without risking a file appearing on the user's disk.
 */

import type {
  App,
  Plugin,
  TFile,
  TFolder
} from 'obsidian';

import { join } from '@mnaoumov/typescript-lib/path';
import { replaceAll } from '@mnaoumov/typescript-lib/string';
import { normalizePath } from 'obsidian';

import type { ThirdPartyPluginAdapter } from './plugin/third-party-plugin.ts';

import {
  isFolder,
  MARKDOWN_FILE_EXTENSION
} from './file-system.ts';

/**
 * Where a folder's folder note lives.
 *
 * The three concrete members are the shapes the folder-note ecosystem actually uses:
 * `charlie/charlie.md` and `charlie/index.md` are both {@link FolderNoteLocation.InsideFolder} (they
 * differ only in the NAME, which is why naming is a callback and not a fourth member), while
 * `charlie.md` beside the folder is {@link FolderNoteLocation.ParentFolder} — whose whole point is that
 * `[[alpha/bravo/charlie]]` links to a folder with no special syntax.
 */
export enum FolderNoteLocation {
  /**
   * Take the answer from the installed `folder-notes` plugin, falling back to a note named after its
   * folder, inside it. The default, and resolved LIVE rather than copied.
   */
  Auto = 'Auto',

  /**
   * `alpha/bravo/charlie/<name>.md`.
   */
  InsideFolder = 'InsideFolder',

  /**
   * The vault has no folder notes at all, so every folder answers `null`. This is also how a caller opts
   * out of folder-note behavior entirely.
   */
  None = 'None',

  /**
   * `alpha/bravo/<name>.md`, beside the folder.
   */
  ParentFolder = 'ParentFolder'
}

/**
 * The settings of the `Folder Index` plugin (`obsidian-folder-index`), narrowed to what names its index note.
 * Read from its `1.0.30`.
 */
export interface FolderIndexPluginSettings {
  /**
   * The index note's name, WITHOUT its extension, used when {@link indexFileUserSpecified} is on.
   */
  readonly indexFilename: string;

  /**
   * Whether the index note carries {@link indexFilename} rather than its folder's name.
   */
  readonly indexFileUserSpecified: boolean;
}

/**
 * A folder-note setup with {@link FolderNoteLocation.Auto} already resolved to a concrete answer.
 */
export interface FolderNoteConfig {
  /**
   * The extensions a folder note may carry, WITHOUT the leading dot, in resolution order — the first one
   * that names an existing file wins.
   */
  readonly extensions: readonly string[];

  /**
   * Whether the folder note is hidden in the file explorer.
   *
   * Read rather than acted upon here: it changes nothing about WHICH file is the folder note, but a caller
   * that reveals the note has to know there is nothing to reveal and fall back to revealing the folder.
   */
  readonly isHidden: boolean;

  /**
   * Where the note sits relative to its folder.
   */
  readonly location: FolderNoteLocation.InsideFolder | FolderNoteLocation.None | FolderNoteLocation.ParentFolder;

  /**
   * Names the folder note of a folder, WITHOUT its extension.
   *
   * @param folder - The folder whose note is being named.
   * @returns The note's name; an empty (or blank) name means the folder has no folder note.
   */
  // A function property rather than a method, because it is a standalone callback, never a method of the
  // config — which is also what lets it be destructured and handed on without tripping `unbound-method`.
  readonly resolveName: (folder: TFolder) => string;
}

/**
 * The settings of the `Folder Note` plugin (`folder-note-plugin`), narrowed to what places and names its
 * folder note. Read from its `0.7.3`.
 */
export interface FolderNotePluginSettings {
  /**
   * Whether the folder note is hidden in the file explorer. Absent from releases that predate the setting.
   */
  readonly folderNoteHide?: boolean;

  /**
   * The note's name, WITHOUT its extension, under the `index` type.
   */
  readonly folderNoteName: string;

  /**
   * `inside` (`folder/folder.md`), `outside` (`folder.md` beside the folder) or `index`
   * (`folder/<folderNoteName>.md`). Any other value is read as `inside`, the plugin's own default.
   */
  readonly folderNoteType: string;
}

/**
 * The settings of the `Folder notes` plugin (`folder-notes`), narrowed to what places, names and hides its
 * folder note. Read from its `1.8.26`.
 */
export interface FolderNotesPluginSettings {
  /**
   * The note's name template, where `{{folder_name}}` stands for the folder's name.
   */
  readonly folderNoteName: string;

  /**
   * The primary extension of a new folder note, with its leading dot (`.md`, `.canvas`, `.excalidraw`).
   */
  readonly folderNoteType?: string;

  /**
   * Whether the folder note is hidden in the file explorer.
   */
  readonly hideFolderNote?: boolean;

  /**
   * `insideFolder`, `parentFolder` or `vaultFolder`.
   */
  readonly storageLocation: string;

  /**
   * Every extension a folder note may carry.
   */
  readonly supportedFileTypes?: readonly string[];
}

/**
 * Parameters for {@link getFolderNoteFolder}.
 */
export interface GetFolderNoteFolderParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The already-resolved setup to use.
   *
   * @default `resolveFolderNoteConfig({ app })`
   */
  readonly config?: FolderNoteConfig;

  /**
   * The file that may be a folder note.
   */
  readonly file: TFile;
}

/**
 * Parameters for {@link resolveFolderNoteConfig}.
 */
export interface ResolveFolderNoteConfigParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The extensions a folder note may carry, with or without the leading dot, in resolution order. Ignored
   * under {@link FolderNoteLocation.Auto}, which takes the installed plugin's answer whole.
   *
   * @default `['md']`
   */
  readonly extensions?: readonly string[];

  /**
   * Whether the folder note is hidden in the file explorer. Ignored under {@link FolderNoteLocation.Auto}.
   *
   * @default `false`
   */
  readonly isHidden?: boolean;

  /**
   * Where the note sits relative to its folder.
   *
   * @default {@link FolderNoteLocation.Auto}
   */
  readonly location?: FolderNoteLocation;

  /**
   * Names the folder note of a folder, WITHOUT its extension. Ignored under
   * {@link FolderNoteLocation.Auto}, which names the note the way the installed plugin does.
   *
   * A callback rather than a name template, because a template needs a token vocabulary and this library
   * has none to impose — a caller that has one (`{{folderName}}`, `{{folderPath}}`, …) renders it here.
   *
   * @param folder - The folder whose note is being named.
   * @returns The note's name.
   * @default `(folder) => folder.name`
   */
  // See {@link FolderNoteConfig.resolveName} for why this is a function property.
  readonly resolveName?: (folder: TFolder) => string;
}

/**
 * Parameters for {@link resolveFolderNote}.
 */
export interface ResolveFolderNoteParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The already-resolved setup to use.
   *
   * Omitted means {@link FolderNoteLocation.Auto} — the setup is resolved on the spot, which is what makes
   * `resolveFolderNote({ app, folder })` the one-liner every caller wants. Pass one when the same setup is
   * used more than once, or when its {@link FolderNoteConfig.isHidden} is needed alongside the note.
   *
   * @default `resolveFolderNoteConfig({ app })`
   */
  readonly config?: FolderNoteConfig;

  /**
   * The folder whose folder note is wanted. Read AFTER any rename: the note is named from the folder's
   * CURRENT name, and a `folder-notes` install with `syncFolderName` on will have renamed it already.
   */
  readonly folder: TFolder;
}

/**
 * Parameters for {@link resolveFolderNotePluginConfigs}.
 */
export interface ResolveFolderNotePluginConfigsParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;
}

/**
 * The settings of the `Waypoint` plugin (`waypoint`), narrowed to what places and names its folder note.
 * Read from its `3.0.1`.
 */
export interface WaypointPluginSettings {
  /**
   * The note's name, WITHOUT its extension, under the `CUSTOM_FILENAME` type.
   */
  readonly folderNoteFilename: string;

  /**
   * `INSIDE_FOLDER` (`folder/folder.md`), `OUTSIDE_FOLDER` (`folder.md` beside the folder) or `CUSTOM_FILENAME`
   * (`folder/<folderNoteFilename>.md`). Any other value is read as `INSIDE_FOLDER`, the plugin's own default.
   */
  readonly folderNoteType: string;
}

/**
 * The `folder-notes` plugin's id, as its manifest declares it.
 */
export const FOLDER_NOTES_PLUGIN_ID = 'folder-notes';

/**
 * The `Folder Note` plugin's id, as its manifest declares it.
 */
export const FOLDER_NOTE_PLUGIN_ID = 'folder-note-plugin';

/**
 * The `Waypoint` plugin's id, as its manifest declares it.
 */
export const WAYPOINT_PLUGIN_ID = 'waypoint';

/**
 * The `Folder Index` plugin's id, as its manifest declares it.
 */
export const FOLDER_INDEX_PLUGIN_ID = 'obsidian-folder-index';

/**
 * The one token `folder-notes`' own name template understands. Every other character in that template is
 * a literal, so translating this token is the whole of the translation.
 */
const FOLDER_NOTES_FOLDER_NAME_TOKEN_REG_EXP = /\{\{folder_name\}\}/gi;

/**
 * `folder-notes` offers `Excalidraw` folder notes, which are Markdown files with an `Excalidraw` payload — its
 * own resolver normalizes the type the same way before looking the file up.
 */
const EXCALIDRAW_FILE_EXTENSION = 'excalidraw';

/**
 * What {@link FolderNoteLocation.Auto} falls back to: the layout every folder-note plugin supports, and
 * the one `folder-notes` itself ships as its default. Nothing hides a note when no plugin is there to hide
 * it, so {@link FolderNoteConfig.isHidden} is `false`.
 */
const FALLBACK_FOLDER_NOTE_CONFIG: FolderNoteConfig = {
  extensions: [MARKDOWN_FILE_EXTENSION],
  isHidden: false,
  location: FolderNoteLocation.InsideFolder,
  resolveName: (folder: TFolder): string => folder.name
};

/**
 * The same layout as {@link FALLBACK_FOLDER_NOTE_CONFIG}, beside the folder rather than inside it.
 */
const BESIDE_FOLDER_NOTE_CONFIG: FolderNoteConfig = {
  ...FALLBACK_FOLDER_NOTE_CONFIG,
  location: FolderNoteLocation.ParentFolder
};

/**
 * The {@link ThirdPartyPluginAdapter} of `Folder notes`. Its API is the plugin's LIVE `settings` object, verified
 * as {@link FolderNotesPluginSettings}, so a reconfiguration is read at once.
 */
export const FOLDER_NOTES_PLUGIN_ADAPTER: ThirdPartyPluginAdapter<FolderNotesPluginSettings> = {
  getApi: (plugin) => getVerifiedSettings(plugin, isFolderNotesPluginSettings),
  pluginId: FOLDER_NOTES_PLUGIN_ID,
  pluginName: 'Folder notes'
};

/**
 * The {@link ThirdPartyPluginAdapter} of `Folder Note`. Its API is the plugin's LIVE `settings` object, verified
 * as {@link FolderNotePluginSettings}.
 */
export const FOLDER_NOTE_PLUGIN_ADAPTER: ThirdPartyPluginAdapter<FolderNotePluginSettings> = {
  getApi: (plugin) => getVerifiedSettings(plugin, isFolderNotePluginSettings),
  pluginId: FOLDER_NOTE_PLUGIN_ID,
  pluginName: 'Folder Note'
};

/**
 * The {@link ThirdPartyPluginAdapter} of `Waypoint`. Its API is the plugin's LIVE `settings` object, verified as
 * {@link WaypointPluginSettings}.
 */
export const WAYPOINT_PLUGIN_ADAPTER: ThirdPartyPluginAdapter<WaypointPluginSettings> = {
  getApi: (plugin) => getVerifiedSettings(plugin, isWaypointPluginSettings),
  pluginId: WAYPOINT_PLUGIN_ID,
  pluginName: 'Waypoint'
};

/**
 * The {@link ThirdPartyPluginAdapter} of `Folder Index`. Its API is the plugin's LIVE `settings` object, verified
 * as {@link FolderIndexPluginSettings}.
 */
export const FOLDER_INDEX_PLUGIN_ADAPTER: ThirdPartyPluginAdapter<FolderIndexPluginSettings> = {
  getApi: (plugin) => getVerifiedSettings(plugin, isFolderIndexPluginSettings),
  pluginId: FOLDER_INDEX_PLUGIN_ID,
  pluginName: 'Folder Index'
};

/**
 * Maps `Folder Index`'s settings onto a folder-note setup: the index note sits inside its folder, named
 * {@link FolderIndexPluginSettings.indexFilename} when the user specified one, otherwise after the folder.
 *
 * @param settings - The plugin's settings, as {@link FOLDER_INDEX_PLUGIN_ADAPTER} reads them.
 * @returns The setup.
 */
export function getFolderIndexFolderNoteConfig(settings: FolderIndexPluginSettings): FolderNoteConfig {
  return settings.indexFileUserSpecified ? createFixedNameConfig(settings.indexFilename, false) : FALLBACK_FOLDER_NOTE_CONFIG;
}

/**
 * Finds the folder a file is the folder note of — the inverse of {@link resolveFolderNote}.
 *
 * The answer is checked through {@link resolveFolderNote} itself, so the two can never disagree: a file is
 * a folder's note exactly when resolving that folder's note yields this very file. A file that does not
 * exist in the vault (one built for a path with nothing at it) is never a folder note.
 *
 * @param params - The file, and optionally the setup to resolve it with.
 * @returns The folder, or `null` when the file is not a folder note.
 */
export function getFolderNoteFolder(params: GetFolderNoteFolderParams): null | TFolder {
  const { app, file } = params;
  const config = params.config ?? resolveFolderNoteConfig({ app });
  const parent = file.parent;
  if (!parent || config.location === FolderNoteLocation.None) {
    return null;
  }

  let candidateFolders: TFolder[];
  if (config.location === FolderNoteLocation.InsideFolder) {
    // The vault root has no folder note under this layout, since nothing names it.
    candidateFolders = parent.isRoot() ? [] : [parent];
  } else {
    candidateFolders = parent.children.filter(isFolder);
  }

  return candidateFolders.find((folder) => resolveFolderNote({ app, config, folder }) === file) ?? null;
}

/**
 * Maps `Folder Note`'s settings onto a folder-note setup.
 *
 * @param settings - The plugin's settings, as {@link FOLDER_NOTE_PLUGIN_ADAPTER} reads them.
 * @returns The setup.
 */
export function getFolderNotePluginFolderNoteConfig(settings: FolderNotePluginSettings): FolderNoteConfig {
  const isHidden = settings.folderNoteHide === true;
  switch (settings.folderNoteType) {
    case 'index': {
      return createFixedNameConfig(settings.folderNoteName, isHidden);
    }
    case 'outside': {
      return { ...BESIDE_FOLDER_NOTE_CONFIG, isHidden };
    }
    default: {
      return { ...FALLBACK_FOLDER_NOTE_CONFIG, isHidden };
    }
  }
}

/**
 * Maps `Folder notes`' settings onto a folder-note setup — the mapping {@link FolderNoteLocation.Auto} uses.
 *
 * @param settings - The plugin's settings, as {@link FOLDER_NOTES_PLUGIN_ADAPTER} reads them.
 * @returns The setup, or `null` for the `vaultFolder` storage location (every note pooled in one folder, so a
 * folder's note is not derivable from its path), for a location it does not document, and for an empty name.
 */
export function getFolderNotesPluginFolderNoteConfig(settings: FolderNotesPluginSettings): FolderNoteConfig | null {
  const location = toFolderNoteLocation(settings.storageLocation);
  const { folderNoteName } = settings;
  if (!location || !folderNoteName) {
    return null;
  }

  return {
    // Its own resolver tries the primary type first and every other supported type after it, which is the
    // order reproduced here. Markdown is kept last, the extension it cannot be configured without.
    extensions: normalizeExtensions([
      settings.folderNoteType ?? MARKDOWN_FILE_EXTENSION,
      ...settings.supportedFileTypes ?? [],
      MARKDOWN_FILE_EXTENSION
    ]),
    isHidden: settings.hideFolderNote === true,
    location,
    resolveName: (folder: TFolder): string =>
      replaceAll({
        $string: folderNoteName,
        // A function replacer, so a folder name containing `$&` is inserted literally.
        replacer: () => folder.name,
        searchValue: FOLDER_NOTES_FOLDER_NAME_TOKEN_REG_EXP
      })
  };
}

/**
 * Maps `Waypoint`'s settings onto a folder-note setup.
 *
 * @param settings - The plugin's settings, as {@link WAYPOINT_PLUGIN_ADAPTER} reads them.
 * @returns The setup.
 */
export function getWaypointFolderNoteConfig(settings: WaypointPluginSettings): FolderNoteConfig {
  switch (settings.folderNoteType) {
    case 'CUSTOM_FILENAME': {
      return createFixedNameConfig(settings.folderNoteFilename, false);
    }
    case 'OUTSIDE_FOLDER': {
      return BESIDE_FOLDER_NOTE_CONFIG;
    }
    default: {
      return FALLBACK_FOLDER_NOTE_CONFIG;
    }
  }
}

/**
 * Finds a folder's folder note — the one note whose properties describe the folder itself.
 *
 * **Never creates.** A folder that has no folder note answers `null`, and so does the vault root under
 * {@link FolderNoteLocation.ParentFolder} (nothing can sit beside it).
 *
 * @param params - The folder, and optionally the setup to resolve it with.
 * @returns The folder note, or `null` when there is none.
 */
export function resolveFolderNote(params: ResolveFolderNoteParams): null | TFile {
  const { app, folder } = params;
  const config = params.config ?? resolveFolderNoteConfig({ app });
  if (config.location === FolderNoteLocation.None) {
    return null;
  }

  const parentFolderPath = config.location === FolderNoteLocation.ParentFolder ? folder.parent?.path : folder.path;
  if (parentFolderPath === undefined) {
    return null;
  }

  const noteName = config.resolveName(folder).trim();
  if (!noteName) {
    return null;
  }

  for (const extension of config.extensions) {
    const file = app.vault.getFileByPath(normalizePath(join(parentFolderPath, `${noteName}.${extension}`)));
    if (file) {
      return file;
    }
  }

  return null;
}

/**
 * Resolves {@link FolderNoteLocation.Auto} into a concrete folder-note setup.
 *
 * `folder-notes`' `vaultFolder` storage (every folder note pooled in one central folder) has no
 * counterpart here and falls back rather than guessing: with the notes pooled, the note belonging to a
 * folder is no longer derivable from that folder's path alone.
 *
 * @param params - The setup, and the app to read the installed plugin from.
 * @returns The resolved setup.
 */
export function resolveFolderNoteConfig(params: ResolveFolderNoteConfigParams): FolderNoteConfig {
  const {
    app,
    extensions,
    isHidden = false,
    location,
    resolveName
  } = params;

  return location === undefined || location === FolderNoteLocation.Auto
    ? readFolderNotesPluginConfig(app) ?? FALLBACK_FOLDER_NOTE_CONFIG
    : {
      extensions: normalizeExtensions(extensions ?? [MARKDOWN_FILE_EXTENSION]),
      isHidden,
      location,
      resolveName: resolveName ?? FALLBACK_FOLDER_NOTE_CONFIG.resolveName
    };
}

/**
 * Resolves the folder-note setup of every ENABLED folder-note plugin this library recognizes, so every
 * consumer reads their conventions the same way: `Folder notes`, `Folder Note`, `Waypoint` and `Folder Index`,
 * in the order of their downloads. A plugin whose settings are not a shape its adapter recognizes, and a
 * `Folder notes` set to a storage location with no counterpart here, contribute nothing.
 *
 * The settings are read on every call, so a plugin reconfigured, enabled or disabled is followed at once.
 *
 * @param params - The app to read the plugins from.
 * @returns The setups, in that order; empty when no such plugin is enabled.
 */
export function resolveFolderNotePluginConfigs(params: ResolveFolderNotePluginConfigsParams): FolderNoteConfig[] {
  const { app } = params;
  const folderNotesSettings = getSettingsThroughAdapter(app, FOLDER_NOTES_PLUGIN_ADAPTER);
  const folderNoteSettings = getSettingsThroughAdapter(app, FOLDER_NOTE_PLUGIN_ADAPTER);
  const waypointSettings = getSettingsThroughAdapter(app, WAYPOINT_PLUGIN_ADAPTER);
  const folderIndexSettings = getSettingsThroughAdapter(app, FOLDER_INDEX_PLUGIN_ADAPTER);
  return [
    folderNotesSettings ? getFolderNotesPluginFolderNoteConfig(folderNotesSettings) : null,
    folderNoteSettings ? getFolderNotePluginFolderNoteConfig(folderNoteSettings) : null,
    waypointSettings ? getWaypointFolderNoteConfig(waypointSettings) : null,
    folderIndexSettings ? getFolderIndexFolderNoteConfig(folderIndexSettings) : null
  ].filter((config) => config !== null);
}

/**
 * Builds a setup whose note sits inside its folder under a fixed name.
 *
 * @param name - The note's name, WITHOUT its extension.
 * @param isHidden - Whether the note is hidden in the file explorer.
 * @returns The setup.
 */
function createFixedNameConfig(name: string, isHidden: boolean): FolderNoteConfig {
  return {
    ...FALLBACK_FOLDER_NOTE_CONFIG,
    isHidden,
    resolveName: (): string => name
  };
}

/**
 * Reads an ENABLED plugin's settings through its adapter.
 *
 * Reads `app.plugins.getPlugin` directly rather than through `getThirdPartyPluginApi`, which keeps the plugin
 * availability machinery off this module's load path; the answers agree for an enabled, loaded plugin.
 *
 * @typeParam TSettings - The adapter's settings type.
 * @param app - The Obsidian application instance.
 * @param adapter - The plugin's adapter.
 * @returns The verified settings, or `null` when the plugin is not enabled or not a recognized shape.
 */
function getSettingsThroughAdapter<TSettings extends object>(app: App, adapter: ThirdPartyPluginAdapter<TSettings>): null | TSettings {
  const plugin = app.plugins.getPlugin(adapter.pluginId);
  return plugin ? adapter.getApi(plugin) : null;
}

/**
 * Reads a plugin instance's `settings` and verifies their shape.
 *
 * Every value is read as `unknown` and checked rather than asserted: this is another plugin's private settings
 * object, so a version that renames or retypes a key must read as "not there" instead of throwing inside a
 * click handler. The object itself is returned, not a copy, so a later reconfiguration is seen.
 *
 * @typeParam TSettings - The verified settings type.
 * @param plugin - The plugin instance.
 * @param isSettings - The shape guard.
 * @returns The settings, or `null` when the instance carries none or they are not the expected shape.
 */
function getVerifiedSettings<TSettings extends object>(plugin: Plugin, isSettings: (value: object) => value is TSettings): null | TSettings {
  if (!('settings' in plugin)) {
    return null;
  }

  const settings: unknown = plugin.settings;
  return typeof settings === 'object' && settings !== null && isSettings(settings) ? settings : null;
}

function hasBoolean(value: object, key: string): boolean {
  return typeof readProperty(value, key) === 'boolean';
}

function hasOptionalBoolean(value: object, key: string): boolean {
  return readProperty(value, key) === undefined || hasBoolean(value, key);
}

function hasOptionalString(value: object, key: string): boolean {
  return readProperty(value, key) === undefined || hasString(value, key);
}

function hasOptionalStringArray(value: object, key: string): boolean {
  const property = readProperty(value, key);
  return property === undefined || (Array.isArray(property) && property.every((element: unknown) => typeof element === 'string'));
}

function hasString(value: object, key: string): boolean {
  return typeof readProperty(value, key) === 'string';
}

function isFolderIndexPluginSettings(value: object): value is FolderIndexPluginSettings {
  return hasBoolean(value, 'indexFileUserSpecified') && hasString(value, 'indexFilename');
}

function isFolderNotePluginSettings(value: object): value is FolderNotePluginSettings {
  return hasString(value, 'folderNoteType') && hasString(value, 'folderNoteName') && hasOptionalBoolean(value, 'folderNoteHide');
}

function isFolderNotesPluginSettings(value: object): value is FolderNotesPluginSettings {
  return hasString(value, 'folderNoteName')
    && hasString(value, 'storageLocation')
    && hasOptionalString(value, 'folderNoteType')
    && hasOptionalBoolean(value, 'hideFolderNote')
    && hasOptionalStringArray(value, 'supportedFileTypes');
}

function isWaypointPluginSettings(value: object): value is WaypointPluginSettings {
  return hasString(value, 'folderNoteType') && hasString(value, 'folderNoteFilename');
}

/**
 * Normalizes extensions the way `folder-notes` does before it looks a file up: no leading dot, lower-case,
 * `Excalidraw` treated as Markdown, blanks dropped, duplicates collapsed while keeping the first occurrence's
 * position.
 *
 * @param extensions - The extensions as configured.
 * @returns The normalized extensions, in resolution order.
 */
function normalizeExtensions(extensions: readonly string[]): readonly string[] {
  const normalizedExtensions = extensions
    .map((extension) => extension.trim().toLowerCase().replace(/^\./, ''))
    .map((extension) => extension === EXCALIDRAW_FILE_EXTENSION ? MARKDOWN_FILE_EXTENSION : extension)
    .filter(Boolean);
  return [...new Set(normalizedExtensions)];
}

/**
 * Reads the installed `folder-notes` plugin's own configuration, through {@link FOLDER_NOTES_PLUGIN_ADAPTER}.
 *
 * @param app - The Obsidian application instance.
 * @returns The configuration, or `null` when the plugin is absent, not configured the way it documents, or set
 * to a storage location with no counterpart here.
 */
function readFolderNotesPluginConfig(app: App): FolderNoteConfig | null {
  const settings = getSettingsThroughAdapter(app, FOLDER_NOTES_PLUGIN_ADAPTER);
  return settings ? getFolderNotesPluginFolderNoteConfig(settings) : null;
}

/**
 * Reads one property of a foreign object as `unknown`.
 *
 * @param value - The object.
 * @param key - The property's name.
 * @returns The property's value, `undefined` when absent.
 */
function readProperty(value: object, key: string): unknown {
  // `Reflect.get` rather than an index into a cast record: the object is another plugin's, typed only as `object`.
  const property: unknown = Reflect.get(value, key);
  return property;
}

/**
 * Maps `folder-notes`' `storageLocation` onto this library's own location.
 *
 * @param storageLocation - The value read out of that plugin's settings.
 * @returns The location, or `null` for `vaultFolder` and for anything that is not one of its values.
 */
function toFolderNoteLocation(storageLocation: unknown): FolderNoteConfig['location'] | null {
  switch (storageLocation) {
    case 'insideFolder': {
      return FolderNoteLocation.InsideFolder;
    }
    case 'parentFolder': {
      return FolderNoteLocation.ParentFolder;
    }
    default: {
      return null;
    }
  }
}
