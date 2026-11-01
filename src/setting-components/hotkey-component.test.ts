// @vitest-environment jsdom

import { Platform } from 'obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { HotkeyComponent } from './hotkey-component.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

function press(component: HotkeyComponent, init: KeyboardEventInit): KeyboardEvent {
  const keyboardEvent = new KeyboardEvent('keydown', { cancelable: true, ...init });
  component.buttonEl.dispatchEvent(keyboardEvent);
  return keyboardEvent;
}

describe('HotkeyComponent', () => {
  let component: HotkeyComponent;

  beforeEach(() => {
    vi.spyOn(Platform, 'isMacOS', 'get').mockReturnValue(false);
    component = new HotkeyComponent(createDiv());
  });

  it('should show a placeholder when no hotkey is set', () => {
    expect(component.getValue()).toBeNull();
    expect(component.buttonEl.textContent).toBe('Not set');
    expect(component.buttonEl.hasClass('is-placeholder')).toBe(true);
  });

  it('should show a set hotkey', () => {
    component.setValue({ key: 'P', modifiers: ['Mod'] });
    expect(component.buttonEl.textContent).toBe('Ctrl + P');
    expect(component.buttonEl.hasClass('is-placeholder')).toBe(false);
  });

  it('should record a key press after a click', () => {
    const onChange = vi.fn();
    component.onChange(onChange);
    component.buttonEl.click();
    expect(component.isRecording).toBe(true);
    expect(component.buttonEl.textContent).toBe('Press a hotkey...');
    expect(component.buttonEl.hasClass('is-active')).toBe(true);

    expect(press(component, { ctrlKey: true, key: 'Control' }).defaultPrevented).toBe(true);
    expect(component.isRecording).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    press(component, { code: 'KeyK', ctrlKey: true, key: 'k', shiftKey: true });
    expect(component.isRecording).toBe(false);
    expect(component.getValue()).toEqual({ key: 'K', modifiers: ['Mod', 'Shift'] });
    expect(onChange).toHaveBeenCalledWith({ key: 'K', modifiers: ['Mod', 'Shift'] });
    expect(component.buttonEl.textContent).toBe('Ctrl + Shift + K');
  });

  it('should ignore key presses when not recording', () => {
    const keyboardEvent = press(component, { code: 'KeyK', key: 'k' });
    expect(keyboardEvent.defaultPrevented).toBe(false);
    expect(component.getValue()).toBeNull();
  });

  it('should cancel the recording on Escape and on blur', () => {
    component.setValue({ key: 'P', modifiers: ['Mod'] });
    component.startRecording();
    press(component, { key: 'Escape' });
    expect(component.isRecording).toBe(false);
    expect(component.getValue()).toEqual({ key: 'P', modifiers: ['Mod'] });

    component.startRecording();
    component.buttonEl.dispatchEvent(new FocusEvent('blur'));
    expect(component.isRecording).toBe(false);
  });

  it('should clear the hotkey with the clear button', () => {
    const onChange = vi.fn();
    component.setValue({ key: 'P', modifiers: ['Mod'] }).onChange(onChange);
    component.clearButton.extraSettingsEl.click();
    expect(component.getValue()).toBeNull();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('should not record while disabled', () => {
    component.startRecording();
    component.setDisabled(true);
    expect(component.isRecording).toBe(false);
    expect(component.buttonEl.disabled).toBe(true);
    component.startRecording();
    expect(component.isRecording).toBe(false);

    component.setDisabled(false);
    expect(component.buttonEl.disabled).toBe(false);
    component.startRecording();
    expect(component.isRecording).toBe(true);
  });
});
