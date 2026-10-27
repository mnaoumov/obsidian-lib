/**
 * @file
 *
 * This module provides classes and validators for managing include/exclude path settings.
 *
 * An entry takes one of three forms, and every form matches case-insensitively:
 *
 * - A regular expression literal, `/pattern/flags`. Its own flags are honoured and `i` is always added. `g` and `y` are
 *   accepted and dropped, since they make `RegExp.test` stateful and say nothing about which paths match.
 * - A glob, an entry holding an unescaped `*`, `?` or `[`. `*` matches within one path segment, `**` across segments,
 *   `?` one character and `[abc]` / `[!abc]` a character class. A glob with no `/` matches a file or folder NAME at any
 *   depth, as in `.gitignore` (`*.pdf` matches `a/b/c.pdf`); one with a `/` is anchored to the vault root
 *   (`Attachments/*.pdf`). A trailing `/` makes it match folders only.
 * - A plain path, every other entry, which matches that path and everything inside it. A literal `*`, `?`, `[` or `\` in
 *   a plain path or a glob is written escaped (`\*`).
 */

import type { MaybeReturn } from '@mnaoumov/typescript-lib/type';

import { escapeRegExp } from '@mnaoumov/typescript-lib/reg-exp';
import { assertNever } from '@mnaoumov/typescript-lib/type-guards';

import { t } from './i18n/i18n.ts';

enum PathSettingType {
  Exclude = 'Exclude',
  Include = 'Include'
}

type CharacterClassSourceResult = InvalidSourceResult | ValidCharacterClassSourceResult;

interface CompileResult {
  readonly error?: string;
  readonly matcher?: PathMatcher;
}

type GlobSourceResult = InvalidSourceResult | ValidGlobSourceResult;

interface InvalidSourceResult {
  readonly error: string;
  readonly isValid: false;
}

interface PathMatcher {
  readonly isMatch: (path: string, isFolder: boolean) => boolean;
}

interface ValidCharacterClassSourceResult extends ValidGlobSourceResult {
  readonly endIndex: number;
}

interface ValidGlobSourceResult {
  readonly isValid: true;
  readonly source: string;
}

const REG_EXP_ENTRY_REG_EXP = /^\/.*\/[a-z]*$/s;
const CASE_INSENSITIVE_FLAG = 'i';
const STATEFUL_FLAGS_REG_EXP = /[gy]/g;
const GLOB_CHARACTERS = new Set(['?', '[', '*']);
const GLOBSTAR = '**';
const GLOBSTAR_FOLDERS = '**/';

const ALWAYS_MATCHER: PathMatcher = {
  isMatch: () => true
};

const NEVER_MATCHER: PathMatcher = {
  isMatch: () => false
};

class PathSetting {
  public get array(): string[] {
    return this._array;
  }

  public set array(value: string[]) {
    this._array = value.filter(Boolean);
    this.matchers = makeMatchers(this._array, this.defaultMatcher) ?? [this.defaultMatcher];
  }

  private _array: string[] = [];
  private readonly defaultMatcher: PathMatcher;
  private matchers: PathMatcher[];

  public constructor(private readonly type: PathSettingType) {
    this.defaultMatcher = getDefaultMatcher(type);
    this.matchers = [this.defaultMatcher];
  }

  public isPathIgnored(path: string, isFolder: boolean): boolean {
    const isMatch = this.matchers.some((matcher) => matcher.isMatch(path, isFolder));
    /* v8 ignore start -- All branches covered but v8 reports switch as partial. */
    switch (this.type) {
      /* v8 ignore stop */
      case PathSettingType.Exclude: {
        return isMatch;
      }
      case PathSettingType.Include: {
        return !isMatch;
      }
      default: {
        /* v8 ignore start -- Exhaustive switch guard. */
        assertNever(this.type);
      }
        /* v8 ignore stop */
    }
  }
}

/**
 * A class for managing include/exclude path settings.
 *
 * See the module documentation for the entry syntax: plain paths, globs and regular expression literals, all matched
 * case-insensitively.
 */
export class PathSettings {
  /**
   * Gets the exclude paths.
   *
   * @returns The exclude paths.
   */
  public get excludePaths(): string[] {
    return this._excludePaths.array;
  }

  /**
   * Sets the exclude paths.
   *
   * @param value - The exclude paths.
   */
  public set excludePaths(value: string[]) {
    this._excludePaths.array = value;
  }

  /**
   * Gets the include paths.
   *
   * @returns The include paths.
   */
  public get includePaths(): string[] {
    return this._includePaths.array;
  }

  /**
   * Sets the include paths.
   *
   * @param value - The include paths.
   */
  public set includePaths(value: string[]) {
    this._includePaths.array = value;
  }

  private readonly _excludePaths = new PathSetting(PathSettingType.Exclude);
  private readonly _includePaths = new PathSetting(PathSettingType.Include);

  /**
   * Checks if a path is ignored by the include/exclude path settings.
   *
   * @param path - The path to check.
   * @param isFolder - Whether the path is a folder. Only a folder-only glob (one ending in `/`) reads it: such a glob
   * always matches the contents of a matching folder, and matches the folder itself only when this is `true`.
   * @returns `true` if the path is ignored, `false` otherwise.
   */
  public isPathIgnored(path: string, isFolder = false): boolean {
    return this._includePaths.isPathIgnored(path, isFolder) || this._excludePaths.isPathIgnored(path, isFolder);
  }
}

/**
 * Validates include/exclude path entries, reporting the first entry that is not a valid regular expression or glob.
 *
 * An invalid entry does not throw when assigned to {@link PathSettings} — the whole list falls back to its default
 * pattern instead — so this validator is what surfaces the problem to the user. The message names the entry and the
 * reason it is invalid.
 *
 * @param paths - The path entries to validate.
 * @returns A message naming the first invalid entry, or nothing when every entry is valid.
 */
export function pathsValidator(paths: string[]): MaybeReturn<string> {
  for (const path of paths) {
    const { error } = compileEntry(path, NEVER_MATCHER);
    if (error !== undefined) {
      return error;
    }
  }
}

function compileEntry(entry: string, defaultMatcher: PathMatcher): CompileResult {
  if (entry === '/') {
    return { matcher: defaultMatcher };
  }

  if (REG_EXP_ENTRY_REG_EXP.test(entry)) {
    const flagsSeparatorIndex = entry.lastIndexOf('/');
    return compileRegExpEntry(entry, entry.slice(1, flagsSeparatorIndex), entry.slice(flagsSeparatorIndex + 1));
  }

  return hasUnescapedGlobCharacter(entry) ? compileGlobEntry(entry) : compilePlainPathEntry(entry);
}

function compileGlobEntry(glob: string): CompileResult {
  const isFolderOnly = glob.endsWith('/');
  const body = glob.replace(/\/+$/, '');
  const globSource = getGlobSource(body);
  if (!globSource.isValid) {
    return {
      error: t(($) => $.obsidianLib.pathSettings.invalidGlob, { glob, reason: globSource.error })
    };
  }
  const { source } = globSource;

  const prefix = body.includes('/') ? '^' : '(?:^|/)';

  let selfRegExp: RegExp;
  let contentsRegExp: RegExp;
  try {
    selfRegExp = new RegExp(`${prefix}${source}$`, CASE_INSENSITIVE_FLAG);
    contentsRegExp = new RegExp(`${prefix}${source}/`, CASE_INSENSITIVE_FLAG);
  } catch (error_) {
    // An out-of-order character class range (`[z-a]`) is the one invalid glob only the engine can tell.
    return {
      error: t(($) => $.obsidianLib.pathSettings.invalidGlob, { glob, reason: getRegExpErrorReason(error_) })
    };
  }

  return {
    matcher: {
      isMatch: (path, isFolder) => contentsRegExp.test(path) || ((isFolder || !isFolderOnly) && selfRegExp.test(path))
    }
  };
}

function compilePlainPathEntry(path: string): CompileResult {
  const unescapedPath = path.replaceAll(/\\(?<character>.)/gs, '$<character>').replace(/\/+$/, '');
  const regExp = new RegExp(`^${escapeRegExp(unescapedPath)}(?:/|$)`, CASE_INSENSITIVE_FLAG);
  return {
    matcher: {
      isMatch: (pathToCheck) => regExp.test(pathToCheck)
    }
  };
}

function compileRegExpEntry(entry: string, source: string, flags: string): CompileResult {
  let regExp: RegExp;
  try {
    // Compiled with the flags as written first, so an unknown or repeated flag is reported rather than ignored.
    new RegExp(source, flags);
    const effectiveFlags = flags.replaceAll(STATEFUL_FLAGS_REG_EXP, '');
    regExp = new RegExp(source, effectiveFlags.includes(CASE_INSENSITIVE_FLAG) ? effectiveFlags : `${effectiveFlags}${CASE_INSENSITIVE_FLAG}`);
  } catch (error) {
    // A partially typed regex literal (`/^Inbox\/`) is not parseable.
    // Report it instead of throwing from a settings setter, which would break both the settings UI and the save path.
    return {
      error: t(($) => $.obsidianLib.pathSettings.invalidRegularExpression, { reason: getRegExpErrorReason(error), regExp: entry })
    };
  }

  return {
    matcher: {
      isMatch: (path) => regExp.test(path)
    }
  };
}

function escapeCharacterClassCharacter(character: string): string {
  return /[-\\\]^[]/.test(character) ? `\\${character}` : character;
}

function getCharacterClassSource(glob: string, openIndex: number): CharacterClassSourceResult {
  let index = openIndex + 1;
  let isNegated = false;
  if (glob[index] === '!' || glob[index] === '^') {
    isNegated = true;
    index++;
  }

  let content = '';
  if (glob[index] === ']') {
    content += String.raw`\]`;
    index++;
  }

  while (index < glob.length) {
    const character = glob.charAt(index);
    if (character === ']') {
      return {
        endIndex: index + 1,
        isValid: true,
        source: `[${isNegated ? '^/' : ''}${content}]`
      };
    }

    if (character === '\\') {
      index++;
      if (index >= glob.length) {
        break;
      }
      content += escapeCharacterClassCharacter(glob.charAt(index));
    } else {
      content += character === '-' ? character : escapeCharacterClassCharacter(character);
    }
    index++;
  }

  return { error: t(($) => $.obsidianLib.pathSettings.unclosedCharacterClass), isValid: false };
}

function getDefaultMatcher(type: PathSettingType): PathMatcher {
  /* v8 ignore start -- All branches covered but v8 reports switch as partial. */
  switch (type) {
    /* v8 ignore stop */
    case PathSettingType.Exclude: {
      return NEVER_MATCHER;
    }
    case PathSettingType.Include: {
      return ALWAYS_MATCHER;
    }
    default: {
      /* v8 ignore start -- Exhaustive switch guard. */
      assertNever(type);
    }
      /* v8 ignore stop */
  }
}

function getGlobSource(glob: string): GlobSourceResult {
  let source = '';
  let index = 0;

  while (index < glob.length) {
    const character = glob.charAt(index);
    switch (character) {
      case '?': {
        source += '[^/]';
        index++;
        break;
      }
      case '[': {
        const characterClass = getCharacterClassSource(glob, index);
        if (!characterClass.isValid) {
          return characterClass;
        }
        source += characterClass.source;
        index = characterClass.endIndex;
        break;
      }
      case '*': {
        if (!glob.startsWith(GLOBSTAR, index)) {
          source += '[^/]*';
          index++;
          break;
        }

        const isSegmentStart = index === 0 || glob[index - 1] === '/';
        if (isSegmentStart && glob.startsWith(GLOBSTAR_FOLDERS, index)) {
          // `**/` is zero or more whole folders.
          source += '(?:[^/]*/)*';
          index += GLOBSTAR_FOLDERS.length;
        } else if (isSegmentStart && index + GLOBSTAR.length === glob.length) {
          // A trailing `/**` is everything inside the folder.
          source += '.*';
          index += GLOBSTAR.length;
        } else {
          // Any other `**` is an ordinary `*`, as in `.gitignore`.
          source += '[^/]*';
          index += GLOBSTAR.length;
        }
        break;
      }
      case '\\': {
        index++;
        if (index >= glob.length) {
          return { error: t(($) => $.obsidianLib.pathSettings.trailingEscape), isValid: false };
        }
        source += escapeRegExp(glob.charAt(index));
        index++;
        break;
      }
      default: {
        source += escapeRegExp(character);
        index++;
        break;
      }
    }
  }

  return { isValid: true, source };
}

function getRegExpErrorReason(error: unknown): string {
  /* v8 ignore start -- The RegExp constructor only ever throws a SyntaxError. */
  const message = error instanceof Error ? error.message : String(error);
  /* v8 ignore stop */
  // V8 phrases it `Invalid regular expression: /<source>/<flags>: <reason>`; the entry is already named.
  const match = /^Invalid regular expression: \/.*\/[a-z]*: (?<reason>.*)$/s.exec(message);
  return match?.groups?.['reason'] ?? message;
}

function hasUnescapedGlobCharacter(entry: string): boolean {
  for (let index = 0; index < entry.length; index++) {
    const character = entry.charAt(index);
    if (character === '\\') {
      index++;
    } else if (GLOB_CHARACTERS.has(character)) {
      return true;
    }
  }
  return false;
}

function makeMatchers(paths: string[], defaultMatcher: PathMatcher): null | PathMatcher[] {
  if (paths.length === 0) {
    return [defaultMatcher];
  }

  const matchers: PathMatcher[] = [];
  for (const path of paths) {
    const { matcher } = compileEntry(path, defaultMatcher);
    if (!matcher) {
      return null;
    }
    matchers.push(matcher);
  }
  return matchers;
}
