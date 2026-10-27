// @vitest-environment jsdom

import { noop } from '@mnaoumov/typescript-lib/function';
import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  TextComponent,
  ToggleComponent
} from 'obsidian';
import {
  describe,
  expect,
  it
} from 'vitest';

import { getTextBasedComponentValue } from './text-based-component.ts';

describe('getTextBasedComponentValue', () => {
  it('should return null for objects without TextBasedComponent interface', () => {
    expect(getTextBasedComponentValue({})).toBeNull();
    expect(getTextBasedComponentValue({ unrelated: true })).toBeNull();
    expect(getTextBasedComponentValue({ setPlaceholderValue: noop })).toBeNull();
    expect(getTextBasedComponentValue({ isEmpty: noop, setPlaceholderValue: 'not a function' })).toBeNull();
  });

  it('should return null for non-objects', () => {
    expect(getTextBasedComponentValue(null)).toBeNull();
    expect(getTextBasedComponentValue('text')).toBeNull();
  });

  it('should return null for a strict-proxy ToggleComponent without reading its unmocked members', () => {
    const toggle = new ToggleComponent(createDiv());
    expect(getTextBasedComponentValue(toggle)).toBeNull();
  });

  it('should return the object if it already implements TextBasedComponent', () => {
    const textBased = {
      empty: (): void => {
        noop();
      },
      isEmpty: (): boolean => false,
      setPlaceholderValue: (): unknown => textBased
    };
    const result = getTextBasedComponentValue(textBased);
    expect(result).toBe(textBased);
  });

  it('should wrap AbstractTextComponent', () => {
    const container = createDiv();
    const atc = new TextComponent(container);
    atc.setValue('hello');

    const result = getTextBasedComponentValue<string>(atc);
    expect(result).not.toBeNull();
    assertNonNullable(result);
    expect(result.isEmpty()).toBe(false);
  });

  it('should empty the wrapped AbstractTextComponent', () => {
    const container = createDiv();
    const atc = new TextComponent(container);
    atc.setValue('hello');

    const result = getTextBasedComponentValue<string>(atc);
    assertNonNullable(result);
    result.empty();
    expect(atc.getValue()).toBe('');
  });

  it('should check isEmpty on wrapped AbstractTextComponent', () => {
    const container = createDiv();
    const atc = new TextComponent(container);

    const result = getTextBasedComponentValue<string>(atc);
    assertNonNullable(result);
    expect(result.isEmpty()).toBe(true);
    atc.setValue('x');
    expect(result.isEmpty()).toBe(false);
  });

  it('should set placeholder value on wrapped AbstractTextComponent', () => {
    const container = createDiv();
    const atc = new TextComponent(container);

    const result = getTextBasedComponentValue<string>(atc);
    assertNonNullable(result);
    const returned = result.setPlaceholderValue('hint');
    expect(returned).toBe(result);
  });
});
