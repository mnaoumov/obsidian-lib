/**
 * @file
 *
 * Reads a {@link Hotkey} from a key press and formats one for display.
 */

import type {
  Hotkey,
  Modifier
} from 'obsidian';

import { Platform } from 'obsidian';

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift']);
const CODE_KEY_REG_EXP = /^(?:Key(?<letter>[A-Z])|Digit(?<digit>\d))$/;

type ModifierName = readonly [Modifier, string];

// Both lists hold the modifiers in display order.
const MAC_MODIFIER_NAMES: readonly ModifierName[] = [
  ['Mod', '⌘'],
  ['Ctrl', '⌃'],
  ['Meta', '⌘'],
  ['Alt', '⌥'],
  ['Shift', '⇧']
];

const OTHER_MODIFIER_NAMES: readonly ModifierName[] = [
  ['Mod', 'Ctrl'],
  ['Ctrl', 'Ctrl'],
  ['Meta', 'Win'],
  ['Alt', 'Alt'],
  ['Shift', 'Shift']
];

const KEY_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  'ArrowDown': '↓',
  'ArrowLeft': '←',
  'ArrowRight': '→',
  'ArrowUp': '↑'
};

/**
 * Parameters of {@link formatHotkey}.
 */
export interface FormatHotkeyParams {
  /**
   * The hotkey to format.
   */
  readonly hotkey: Hotkey;

  /**
   * Whether to format it the macOS way, with modifier symbols and no separator. Defaults to `Platform.isMacOS`.
   */
  readonly isMacOS?: boolean;
}

/**
 * Parameters of {@link getHotkeyFromKeyboardEvent}.
 */
export interface GetHotkeyFromKeyboardEventParams {
  /**
   * The key press.
   */
  readonly event: KeyboardEvent;

  /**
   * Whether the platform is macOS, where `Mod` is the Command key rather than Ctrl. Defaults to `Platform.isMacOS`.
   */
  readonly isMacOS?: boolean;
}

/**
 * Formats a hotkey the way Obsidian's hotkey settings show it: `Ctrl + Shift + P`, or `⌘⇧P` on macOS.
 *
 * @param params - The parameters.
 * @returns The display string.
 */
export function formatHotkey(params: FormatHotkeyParams): string {
  const isMacOS = params.isMacOS ?? Platform.isMacOS;
  const modifierNames = isMacOS ? MAC_MODIFIER_NAMES : OTHER_MODIFIER_NAMES;
  const parts = modifierNames.filter(([modifier]) => params.hotkey.modifiers.includes(modifier)).map(([, name]) => name);
  parts.push(KEY_DISPLAY_NAMES[params.hotkey.key] ?? params.hotkey.key);
  return parts.join(isMacOS ? '' : ' + ');
}

/**
 * Reads the hotkey a key press makes, in the shape Obsidian stores in `hotkeys.json`.
 *
 * The Ctrl key reads as `Mod` everywhere but macOS, and the Command key as `Mod` on macOS. Letters and digits come from
 * the physical key, so Shift or a keyboard layout does not change them.
 *
 * @param params - The parameters.
 * @returns The hotkey, or `null` when only a modifier key was pressed.
 */
export function getHotkeyFromKeyboardEvent(params: GetHotkeyFromKeyboardEventParams): Hotkey | null {
  const keyboardEvent = params.event;
  if (MODIFIER_KEYS.has(keyboardEvent.key)) {
    return null;
  }

  const isMacOS = params.isMacOS ?? Platform.isMacOS;
  const modifiers: Modifier[] = [];
  if (isMacOS ? keyboardEvent.metaKey : keyboardEvent.ctrlKey) {
    modifiers.push('Mod');
  }
  if (isMacOS ? keyboardEvent.ctrlKey : keyboardEvent.metaKey) {
    modifiers.push(isMacOS ? 'Ctrl' : 'Meta');
  }
  if (keyboardEvent.altKey) {
    modifiers.push('Alt');
  }
  if (keyboardEvent.shiftKey) {
    modifiers.push('Shift');
  }

  const codeGroups = CODE_KEY_REG_EXP.exec(keyboardEvent.code)?.groups;
  const key = codeGroups?.['letter'] ?? codeGroups?.['digit'] ?? (keyboardEvent.key.length === 1 ? keyboardEvent.key.toUpperCase() : keyboardEvent.key);
  return { key, modifiers };
}

/**
 * Checks whether two hotkeys are the same key combination, whatever order their modifiers are listed in.
 *
 * @param hotkey1 - The first hotkey.
 * @param hotkey2 - The second hotkey.
 * @returns Whether they are equal.
 */
export function isSameHotkey(hotkey1: Hotkey, hotkey2: Hotkey): boolean {
  return hotkey1.key.toUpperCase() === hotkey2.key.toUpperCase()
    && hotkey1.modifiers.length === hotkey2.modifiers.length
    && hotkey1.modifiers.every((modifier) => hotkey2.modifiers.includes(modifier));
}
