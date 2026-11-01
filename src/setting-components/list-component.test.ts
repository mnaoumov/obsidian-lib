// @vitest-environment jsdom

import type { Mock } from 'vitest';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { ListComponent } from './list-component.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

function getButton(component: ListComponent, rowIndex: number, buttonIndex: number): HTMLElement {
  const buttonEl = component.listEl.querySelectorAll('.list-component-item')[rowIndex]?.querySelectorAll<HTMLElement>('.extra-setting-button')[buttonIndex];
  if (!buttonEl) {
    throw new Error(`No button ${String(buttonIndex)} in row ${String(rowIndex)}`);
  }
  return buttonEl;
}

function getItemTexts(component: ListComponent): string[] {
  return [...component.listEl.querySelectorAll('.list-component-item-text')].map((el) => el.textContent);
}

function pressEnter(component: ListComponent, isComposing = false): KeyboardEvent {
  const keyboardEvent = new KeyboardEvent('keydown', { cancelable: true, isComposing, key: 'Enter' });
  component.newItemInputEl.dispatchEvent(keyboardEvent);
  return keyboardEvent;
}

describe('ListComponent', () => {
  let component: ListComponent;
  let onChange: Mock<(newValue: readonly string[]) => void>;

  beforeEach(() => {
    component = new ListComponent(createDiv());
    onChange = vi.fn<(newValue: readonly string[]) => void>();
    component.onChange(onChange);
  });

  it('should show an empty state', () => {
    expect(component.getValue()).toEqual([]);
    expect(component.listEl.textContent).toBe('No items');
  });

  it('should add trimmed items on Enter and on the add button', () => {
    component.setPlaceholder('Add a value');
    expect(component.newItemInputEl.placeholder).toBe('Add a value');

    component.newItemInputEl.value = '  one ';
    expect(pressEnter(component).defaultPrevented).toBe(true);
    expect(component.getValue()).toEqual(['one']);
    expect(component.newItemInputEl.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(['one']);

    component.newItemInputEl.value = 'two';
    component.newItemButton.extraSettingsEl.click();
    expect(getItemTexts(component)).toEqual(['one', 'two']);
  });

  it('should refuse empty text, duplicates, other keys and composition', () => {
    component.setValue(['one']);
    component.newItemInputEl.value = ' '.repeat(3);
    expect(component.addTypedItem()).toBe(false);
    component.newItemInputEl.value = 'one';
    expect(component.addTypedItem()).toBe(false);
    expect(component.newItemInputEl.value).toBe('one');

    component.newItemInputEl.value = 'two';
    expect(pressEnter(component, true).defaultPrevented).toBe(false);
    component.newItemInputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(component.getValue()).toEqual(['one']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should move and remove items', () => {
    component.setValue(['a', 'b', 'c']);
    getButton(component, 0, 1).click();
    expect(component.getValue()).toEqual(['b', 'a', 'c']);
    getButton(component, 2, 0).click();
    expect(component.getValue()).toEqual(['b', 'c', 'a']);
    getButton(component, 1, 2).click();
    expect(component.getValue()).toEqual(['b', 'a']);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('should disable the ends of the list', () => {
    component.setValue(['a', 'b']);
    getButton(component, 0, 0).click();
    getButton(component, 1, 1).click();
    expect(component.getValue()).toEqual(['a', 'b']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should not edit while disabled', () => {
    component.setValue(['a', 'b']).setDisabled(true);
    expect(component.newItemInputEl.disabled).toBe(true);
    component.newItemInputEl.value = 'c';
    expect(component.addTypedItem()).toBe(false);
    getButton(component, 0, 2).click();
    getButton(component, 0, 1).click();
    expect(component.getValue()).toEqual(['a', 'b']);

    component.setDisabled(false);
    expect(component.newItemInputEl.disabled).toBe(false);
    expect(component.addTypedItem()).toBe(true);
  });

  it('should copy the value it is given', () => {
    const value = ['a'];
    component.setValue(value);
    value.push('b');
    expect(component.getValue()).toEqual(['a']);
  });
});
