// @vitest-environment jsdom

import type { GenericObject } from '@mnaoumov/typescript-lib/type-guards';
import type { SelectorParam } from 'i18next';

import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { tFragment } from './t-fragment.ts';

const translations = vi.hoisted(() => ({
  current: ''
}));

vi.mock('./i18n.ts', () => ({
  t: vi.fn((_selector: unknown, options: GenericObject) =>
    translations.current.replaceAll(/\{\{(?<name>\w+)\}\}/gu, (match, name: number | string) => {
      const value = options[String(name)];
      return typeof value === 'string' ? value : match;
    })
  )
}));

const SELECTOR: SelectorParam = selectNothing;

function render(
  translation: string,
  nodes: Parameters<typeof tFragment>[1],
  options?: Parameters<typeof tFragment>[2]
): HTMLDivElement {
  translations.current = translation;
  const container = createDiv();
  container.append(tFragment(SELECTOR, nodes, options));
  return container;
}

function selectNothing(): string {
  return '';
}

describe('tFragment', () => {
  it('should place a node where the sentence puts its placeholder', () => {
    const span = createSpan({ text: '42' });
    const container = render('Running for {{duration}} milliseconds...', { duration: span });
    expect(container.innerHTML).toBe('Running for <span>42</span> milliseconds...');
    expect(container.querySelector('span')).toBe(span);
  });

  it('should follow a translation that moves the placeholder', () => {
    const container = render('{{duration}} ms elapsed', { duration: createSpan({ text: '7' }) });
    expect(container.innerHTML).toBe('<span>7</span> ms elapsed');
  });

  it('should interpolate plain values from the options', () => {
    const container = render('{{name}} took {{duration}}', { duration: createEl('b', { text: '3' }) }, { name: 'Sync' });
    expect(container.innerHTML).toBe('Sync took <b>3</b>');
  });

  it('should run a builder at each position', () => {
    const builder = vi.fn((parent: DocumentFragment) => {
      parent.createEl('i', { text: 'x' });
    });
    const container = render('{{mark}} and {{mark}}', { mark: builder });
    expect(container.innerHTML).toBe('<i>x</i> and <i>x</i>');
    expect(builder).toHaveBeenCalledTimes(2);
  });

  it('should clone a node used more than once', () => {
    const span = createSpan({ text: 'a' });
    const container = render('{{node}}-{{node}}', { node: span });
    const spans = container.querySelectorAll('span');
    expect(container.innerHTML).toBe('<span>a</span>-<span>a</span>');
    expect(spans[0]).toBe(span);
    expect(spans[1]).not.toBe(span);
  });

  it('should leave out a node whose placeholder the translation drops', () => {
    const container = render('No placeholder here', { duration: createSpan() });
    expect(container.innerHTML).toBe('No placeholder here');
  });

  it('should keep a marker that names no node as text', () => {
    const container = render('{{value}}', {}, { value: 'unknown' });
    expect(container.textContent).toBe('unknown');
  });
});
