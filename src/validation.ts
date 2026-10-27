/**
 * @file
 *
 * Validation utilities.
 */

import {
  basename,
  extname
} from '@mnaoumov/typescript-lib/path';
import { oneOf } from '@mnaoumov/typescript-lib/reg-exp';
import { Platform } from 'obsidian';

import { t } from './i18n/i18n.ts';

/**
 * Holds a validation message.
 */
export interface ValidationMessageHolder {
  /**
   * A validation message.
   */
  validationMessage: string;
}

/**
 * Type guard to check if a value is a validation message holder.
 *
 * @param value - The value to check.
 * @returns `true` if the value is a validation message holder, `false` otherwise.
 */
export function isValidationMessageHolder(value: unknown): value is ValidationMessageHolder {
  return (value as Partial<ValidationMessageHolder>).validationMessage !== undefined;
}

/**
 * Matches characters that are not safe to use in file names within Obsidian.
 */
export const OBSIDIAN_UNSAFE_FILENAME_CHARS = /[#^[\]|]/g;

/**
 * The characters Obsidian refuses in a file name on Windows.
 *
 * Read from Obsidian 1.15.0's `app.js`, whose name check throws on this set from `app.vault.create`, a
 * rename and Sync alike.
 */
export const WINDOWS_UNSAFE_PATH_CHARS = /[*\\/<>:|?"]/g;

/**
 * The characters Obsidian refuses in a file name on macOS, Linux and iOS, plus the NUL no file system stores.
 *
 * This is Obsidian's refusal set, not the file system's: macOS and Linux store `\` and `:`, but Obsidian
 * refuses both, so a name holding either cannot be created through the vault there. Read from Obsidian
 * 1.15.0's `app.js`.
 */
export const UNIX_UNSAFE_PATH_CHARS = /[\0\\/:]/g;

/**
 * The characters Obsidian refuses in a file name on Android, plus the NUL no file system stores.
 *
 * Obsidian adds `* ? < > "` to the {@link UNIX_UNSAFE_PATH_CHARS} set there, because Android's shared
 * storage refuses them. Read from Obsidian 1.15.0's `app.js`.
 */
export const ANDROID_UNSAFE_PATH_CHARS = /[\0*\\/<>:?"]/g;

/**
 * The MS-DOS device names Windows still refuses as a file name, with or without an extension.
 *
 * `CONIN$` / `CONOUT$` and the superscript `COM²` forms are deliberately absent: they are accepted by
 * every Windows version that runs Obsidian, and matching them would rename files that work.
 *
 * Unlike the exported character sets above, this carries no `g` flag, so `test` may be called on it
 * repeatedly — a `g`-flagged regexp advances `lastIndex` and answers differently on consecutive calls.
 */
const WINDOWS_RESERVED_NAME_REG_EXP = /^(?:AUX|COM[1-9]|CON|LPT[1-9]|NUL|PRN)$/i;

/**
 * The trailing dots and spaces Windows strips from a name before it does anything else with it.
 */
const WINDOWS_TRAILING_CHARS_REG_EXP = /[ .]+$/;

/**
 * The first character after the C0 control range, U+0000 to U+001F, which Windows refuses in a name.
 */
const FIRST_NON_CONTROL_CHAR = ' ';

/**
 * Validates a single file or folder name against every naming rule this module owns.
 *
 * The rules, checked in this order, and the first one broken names the message:
 *
 * 1. The name is not empty.
 * 2. It holds no control character (U+0000 to U+001F).
 * 3. It holds none of the characters {@link getOsAndObsidianUnsafePathCharsRegExp} matches.
 * 4. It does not end with a dot or a space ({@link hasWindowsTrailingChars}).
 * 5. It is not an MS-DOS device name ({@link isWindowsReservedName}), with or without an extension.
 *
 * Only rule 3 depends on the platform. Rules 2, 4 and 5 apply on every platform, because a vault is synced,
 * and a name created on macOS or Linux that Windows refuses breaks the vault there. The character set follows
 * the platform because it is Obsidian's own refusal set, which differs per platform: a name such as `a?b` is
 * accepted on macOS, where Obsidian creates it.
 *
 * @param name - The name to validate. A single path segment, with or without its extension.
 * @param isWindows - Whether to use the Windows character set. Defaults to `Platform.isWin`.
 * @param isAndroid - Whether to use the Android character set when `isWindows` is false. Defaults to
 * `Platform.isAndroidApp`.
 * @returns A message describing the first broken rule, or an empty string if the name is valid.
 */
export function getFileNameValidationMessage(name: string, isWindows?: boolean, isAndroid?: boolean): string {
  if (name === '') {
    return t(($) => $.obsidianLib.validation.emptyName);
  }

  if (hasControlChars(name)) {
    return t(($) => $.obsidianLib.validation.controlCharacter, { name });
  }

  const unsafeChars = new Set(name.match(getOsAndObsidianUnsafePathCharsRegExp(isWindows, isAndroid)));
  if (unsafeChars.size > 0) {
    return t(($) => $.obsidianLib.validation.unsafeCharacters, { characters: [...unsafeChars].join(' '), name });
  }

  if (hasWindowsTrailingChars(name)) {
    return t(($) => $.obsidianLib.validation.trailingCharacters, { name });
  }

  return isWindowsReservedName(name) ? t(($) => $.obsidianLib.validation.windowsReservedName, { name }) : '';
}

/**
 * Returns a regexp matching all unsafe characters in file names/paths.
 *
 * Includes both the platform's refused characters ({@link getOsUnsafePathCharsRegExp}) and the ones that break
 * links ({@link OBSIDIAN_UNSAFE_FILENAME_CHARS}).
 *
 * @param isWindows - Whether to use the Windows character set. Defaults to `Platform.isWin`.
 * @param isAndroid - Whether to use the Android character set when `isWindows` is false. Defaults to
 * `Platform.isAndroidApp`.
 * @returns A regexp matching all unsafe characters in file names/paths.
 */
export function getOsAndObsidianUnsafePathCharsRegExp(isWindows?: boolean, isAndroid?: boolean): RegExp {
  return oneOf([
    getOsUnsafePathCharsRegExp(isWindows, isAndroid),
    OBSIDIAN_UNSAFE_FILENAME_CHARS
  ]);
}

/**
 * Returns a regexp matching the characters Obsidian refuses in a file name on the given platform.
 *
 * That is {@link WINDOWS_UNSAFE_PATH_CHARS} on Windows, {@link ANDROID_UNSAFE_PATH_CHARS} on Android and
 * {@link UNIX_UNSAFE_PATH_CHARS} everywhere else. It is Obsidian's set rather than the file system's, so a
 * name it accepts can be created through the vault.
 *
 * @param isWindows - Whether to use the Windows character set. Defaults to `Platform.isWin`.
 * @param isAndroid - Whether to use the Android character set when `isWindows` is false. Defaults to
 * `Platform.isAndroidApp`.
 * @returns A regexp matching the characters Obsidian refuses in a file name on the given platform.
 */
export function getOsUnsafePathCharsRegExp(isWindows?: boolean, isAndroid?: boolean): RegExp {
  isWindows ??= Platform.isWin;
  if (isWindows) {
    return WINDOWS_UNSAFE_PATH_CHARS;
  }

  isAndroid ??= Platform.isAndroidApp;
  return isAndroid ? ANDROID_UNSAFE_PATH_CHARS : UNIX_UNSAFE_PATH_CHARS;
}

/**
 * Validates every segment of a vault path with {@link getFileNameValidationMessage}.
 *
 * @param path - The vault-relative path to validate, with `/` as the separator.
 * @param isWindows - Whether to use the Windows character set. Defaults to `Platform.isWin`.
 * @param isAndroid - Whether to use the Android character set when `isWindows` is false. Defaults to
 * `Platform.isAndroidApp`.
 * @returns The message for the first invalid segment, or an empty string if every segment is valid.
 */
export function getPathValidationMessage(path: string, isWindows?: boolean, isAndroid?: boolean): string {
  return path.split('/').map((segment) => getFileNameValidationMessage(segment, isWindows, isAndroid)).find(Boolean) ?? '';
}

/**
 * Checks whether a name ends with the dots or spaces Windows refuses.
 *
 * Answers for Windows regardless of the platform in use: a vault is synced, so the rules that matter are
 * not necessarily those of the machine asking.
 *
 * @param name - The name to check. A single path segment, not a path.
 * @returns `true` if the name ends with a dot or a space, `false` otherwise.
 */
export function hasWindowsTrailingChars(name: string): boolean {
  return WINDOWS_TRAILING_CHARS_REG_EXP.test(name);
}

/**
 * Checks whether a name is one of the MS-DOS device names Windows refuses.
 *
 * Two steps the caller would otherwise have to know about happen here: trailing dots and spaces are
 * trimmed BEFORE the test, because Windows strips them before deciding and `CON ` is therefore as
 * reserved as `CON`; and the extension is dropped, because `CON.md` is reserved too.
 *
 * `CONIN$` / `CONOUT$` and the superscript `COM²` forms are deliberately NOT reserved: they are accepted
 * by every Windows version that runs Obsidian, and matching them would rename files that work.
 *
 * Answers for Windows regardless of the platform in use: a vault is synced, so the rules that matter are
 * not necessarily those of the machine asking.
 *
 * @param name - The name to check. A single path segment, with or without its extension.
 * @returns `true` if the name is reserved, `false` otherwise.
 */
export function isWindowsReservedName(name: string): boolean {
  const trimmedName = trimWindowsTrailingChars(name);
  return WINDOWS_RESERVED_NAME_REG_EXP.test(basename(trimmedName, extname(trimmedName)));
}

/**
 * Removes the trailing dots and spaces Windows refuses from the end of a name.
 *
 * Trim before testing for a reserved name, never after: trimming afterwards turns an accepted `CON ` into
 * a rejected `CON`. {@link isWindowsReservedName} already does this internally.
 *
 * @param name - The name to trim. A single path segment, not a path.
 * @returns The name without its trailing dots and spaces, which may be empty.
 */
export function trimWindowsTrailingChars(name: string): string {
  return name.replace(WINDOWS_TRAILING_CHARS_REG_EXP, '');
}

/**
 * Checks whether a name holds a control character, U+0000 to U+001F.
 *
 * @param name - The name to check.
 * @returns `true` if the name holds a control character, `false` otherwise.
 */
function hasControlChars(name: string): boolean {
  for (const char of name) {
    if (char < FIRST_NON_CONTROL_CHAR) {
      return true;
    }
  }

  return false;
}
