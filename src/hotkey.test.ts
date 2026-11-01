// @vitest-environment jsdom

import type { Modifier } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { Platform } from 'obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  formatHotkey,
  getHotkeyFromKeyboardEvent,
  isSameHotkey
} from './hotkey.ts';

function keyDown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

describe('formatHotkey', () => {
  it('should join modifiers in display order with a plus outside macOS', () => {
    expect(formatHotkey({ hotkey: { key: 'P', modifiers: ['Shift', 'Mod'] }, isMacOS: false })).toBe('Ctrl + Shift + P');
  });

  it('should name every modifier outside macOS', () => {
    expect(formatHotkey({ hotkey: { key: 'K', modifiers: ['Alt', 'Meta', 'Ctrl'] }, isMacOS: false })).toBe('Ctrl + Win + Alt + K');
  });

  it('should use symbols and no separator on macOS', () => {
    expect(formatHotkey({ hotkey: { key: 'P', modifiers: ['Mod', 'Shift', 'Alt', 'Ctrl'] }, isMacOS: true })).toBe('⌘⌃⌥⇧P');
  });

  it('should name special keys', () => {
    expect(formatHotkey({ hotkey: { key: 'ArrowUp', modifiers: [] }, isMacOS: false })).toBe('↑');
    expect(formatHotkey({ hotkey: { key: ' ', modifiers: ['Mod'] }, isMacOS: false })).toBe('Ctrl + Space');
  });

  it('should show an unknown modifier by its own name', () => {
    expect(formatHotkey({ hotkey: { key: 'A', modifiers: [castTo<Modifier>('Hyper')] }, isMacOS: false })).toBe('A');
  });

  it('should default to the platform', () => {
    vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(true);
    expect(formatHotkey({ hotkey: { key: 'A', modifiers: ['Mod'] } })).toBe('⌘A');
    vi.restoreAllMocks();
  });
});

describe('getHotkeyFromKeyboardEvent', () => {
  it('should return null for a modifier key alone', () => {
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ ctrlKey: true, key: 'Control' }), isMacOS: false })).toBeNull();
  });

  it('should read Ctrl as Mod outside macOS and the letter from the code', () => {
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'KeyP', ctrlKey: true, key: 'p', shiftKey: true }), isMacOS: false }))
      .toEqual({ key: 'P', modifiers: ['Mod', 'Shift'] });
  });

  it('should read Meta outside macOS', () => {
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ altKey: true, code: 'Digit1', key: '!', metaKey: true }), isMacOS: false }))
      .toEqual({ key: '1', modifiers: ['Meta', 'Alt'] });
  });

  it('should read Command as Mod and Ctrl as Ctrl on macOS', () => {
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'KeyA', ctrlKey: true, key: 'a', metaKey: true }), isMacOS: true }))
      .toEqual({ key: 'A', modifiers: ['Mod', 'Ctrl'] });
  });

  it('should uppercase a single-character key and keep a named key', () => {
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'Comma', key: ',' }), isMacOS: false })).toEqual({ key: ',', modifiers: [] });
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'IntlRo', key: 'ä' }), isMacOS: false })).toEqual({ key: 'Ä', modifiers: [] });
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'F5', key: 'F5' }), isMacOS: false })).toEqual({ key: 'F5', modifiers: [] });
  });

  it('should default to the platform', () => {
    vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(false);
    expect(getHotkeyFromKeyboardEvent({ event: keyDown({ code: 'KeyB', ctrlKey: true, key: 'b' }) })).toEqual({ key: 'B', modifiers: ['Mod'] });
    vi.restoreAllMocks();
  });
});

describe('isSameHotkey', () => {
  it('should ignore modifier order and key case', () => {
    expect(isSameHotkey({ key: 'p', modifiers: ['Mod', 'Shift'] }, { key: 'P', modifiers: ['Shift', 'Mod'] })).toBe(true);
  });

  it('should tell different hotkeys apart', () => {
    expect(isSameHotkey({ key: 'P', modifiers: ['Mod'] }, { key: 'P', modifiers: ['Mod', 'Shift'] })).toBe(false);
    expect(isSameHotkey({ key: 'P', modifiers: ['Mod'] }, { key: 'P', modifiers: ['Alt'] })).toBe(false);
    expect(isSameHotkey({ key: 'P', modifiers: ['Mod'] }, { key: 'Q', modifiers: ['Mod'] })).toBe(false);
  });
});
