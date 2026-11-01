// @vitest-environment jsdom

import type { MarkdownPostProcessorContext } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  captureCodeBlockFocus,
  claimCodeBlockRenderHandoff,
  CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS,
  recordCodeBlockRenderHandoff,
  restoreCodeBlockFocus
} from './code-block-render-handoff.ts';

const SOURCE_PATH = 'note.md';

function createBlock(language = 'counter'): HTMLDivElement {
  const el = createDiv();
  el.classList.add(`block-language-${language}`);
  return el;
}

function createContext(sourcePath = SOURCE_PATH): MarkdownPostProcessorContext {
  return castTo<MarkdownPostProcessorContext>({ sourcePath });
}

function renderForm(el: HTMLElement): HTMLInputElement {
  const wrapper = el.createDiv();
  wrapper.createEl('button');
  const input = wrapper.createEl('input', { type: 'text', value: 'hello world' });
  return input;
}

afterEach(() => {
  document.body.empty();
  vi.useRealTimers();
});

describe('captureCodeBlockFocus', () => {
  it('should return null when nothing inside the element is focused', () => {
    const el = createBlock();
    document.body.append(el);
    renderForm(el);
    expect(captureCodeBlockFocus(el)).toBeNull();
  });

  it('should return null when the element itself is focused', () => {
    const el = createBlock();
    el.tabIndex = 0;
    document.body.append(el);
    el.focus();
    expect(captureCodeBlockFocus(el)).toBeNull();
  });

  it('should record the child path and the text selection of a focused input', () => {
    const el = createBlock();
    document.body.append(el);
    const input = renderForm(el);
    input.focus();
    input.setSelectionRange(2, 5, 'backward');

    expect(captureCodeBlockFocus(el)).toEqual({
      childIndexPath: [0, 1],
      selection: { direction: 'backward', end: 5, start: 2 }
    });
  });

  it('should record no selection for an input without a text selection', () => {
    const el = createBlock();
    document.body.append(el);
    const checkbox = el.createEl('input', { type: 'checkbox' });
    checkbox.focus();

    expect(captureCodeBlockFocus(el)).toEqual({ childIndexPath: [0], selection: null });
  });

  it('should record no selection for a focused element that is not a text field', () => {
    const el = createBlock();
    document.body.append(el);
    const button = el.createEl('button');
    button.focus();

    expect(captureCodeBlockFocus(el)).toEqual({ childIndexPath: [0], selection: null });
  });

  it('should default the selection direction to none', () => {
    const el = createBlock();
    document.body.append(el);
    const input = renderForm(el);
    input.focus();
    vi.spyOn(input, 'selectionDirection', 'get').mockReturnValue(castTo<'none'>(null));

    expect(captureCodeBlockFocus(el)?.selection?.direction).toBe('none');
  });
});

describe('recordCodeBlockRenderHandoff and claimCodeBlockRenderHandoff', () => {
  it('should hand the state to the render of the new source, once', () => {
    expect(recordCodeBlockRenderHandoff({
      focus: null,
      newCodeBlock: '```counter\ncount: 2\n```',
      sourcePath: SOURCE_PATH,
      state: { clicks: 2 }
    })).toBe(true);

    const handoff = claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'count: 2' });
    expect(handoff?.state).toEqual({ clicks: 2 });
    expect(handoff?.hasFocus).toBe(false);

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'count: 2' })).toBeNull();
  });

  it('should not hand the state to a different note, language or source', () => {
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\ncount: 2\n```', sourcePath: SOURCE_PATH, state: 1 });

    expect(claimCodeBlockRenderHandoff({ context: createContext('other.md'), el: createBlock(), source: 'count: 2' })).toBeNull();
    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock('other'), source: 'count: 2' })).toBeNull();
    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'count: 3' })).toBeNull();
    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createDiv(), source: 'count: 2' })).toBeNull();
  });

  it('should strip a callout prefix and match a CRLF source', () => {
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '> ```counter\n> a\n> b\n> ```', sourcePath: SOURCE_PATH, state: 'callout' });

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'a\r\nb' })?.state).toBe('callout');
  });

  it('should match an empty code block', () => {
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\n```', sourcePath: SOURCE_PATH, state: 'empty' });

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: '' })?.state).toBe('empty');
  });

  it('should queue two handoffs for the same source in order', () => {
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: 1 });
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: 2 });

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'x' })?.state).toBe(1);
    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'x' })?.state).toBe(2);
  });

  it('should refuse a text that is not exactly one code block', () => {
    expect(recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: 'plain text', sourcePath: SOURCE_PATH, state: 1 })).toBe(false);
    expect(recordCodeBlockRenderHandoff({
      focus: null,
      newCodeBlock: '```counter\na\n```\n```counter\nb\n```',
      sourcePath: SOURCE_PATH,
      state: 1
    })).toBe(false);
  });

  it('should expire a handoff nobody claimed', () => {
    vi.useFakeTimers();
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: 1 });
    vi.advanceTimersByTime(CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS / 2);
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: 2 });
    vi.advanceTimersByTime(CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS / 2);

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'x' })?.state).toBe(2);

    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\ny\n```', sourcePath: SOURCE_PATH, state: 3 });
    vi.advanceTimersByTime(CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS);

    expect(claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'y' })).toBeNull();
  });

  it('should restore the focus captured from the old render', async () => {
    const oldEl = createBlock();
    document.body.append(oldEl);
    const oldInput = renderForm(oldEl);
    oldInput.focus();
    oldInput.setSelectionRange(1, 3);
    recordCodeBlockRenderHandoff({ focus: captureCodeBlockFocus(oldEl), newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: undefined });
    oldEl.remove();

    const newEl = createBlock();
    const newInput = renderForm(newEl);
    document.body.append(newEl);
    const handoff = claimCodeBlockRenderHandoff({ context: createContext(), el: newEl, source: 'x' });

    expect(handoff?.hasFocus).toBe(true);
    expect(await handoff?.restoreFocus()).toBe(true);
    expect(document.activeElement).toBe(newInput);
    expect([newInput.selectionStart, newInput.selectionEnd]).toEqual([1, 3]);
  });

  it('should restore nothing when no focus was captured', async () => {
    recordCodeBlockRenderHandoff({ focus: null, newCodeBlock: '```counter\nx\n```', sourcePath: SOURCE_PATH, state: 1 });
    const handoff = claimCodeBlockRenderHandoff({ context: createContext(), el: createBlock(), source: 'x' });

    expect(await handoff?.restoreFocus()).toBe(false);
  });
});

describe('restoreCodeBlockFocus', () => {
  it('should wait for the element to be attached', async () => {
    const el = createBlock();
    const button = el.createEl('button');
    const promise = restoreCodeBlockFocus(el, { childIndexPath: [0], selection: null });
    document.body.append(el);

    expect(await promise).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('should give up when the element is never attached', async () => {
    const el = createBlock();
    el.createEl('button');

    expect(await restoreCodeBlockFocus(el, { childIndexPath: [0], selection: null })).toBe(false);
  });

  it('should give up when the new render has no element at the path', async () => {
    const el = createBlock();
    document.body.append(el);
    el.createEl('button');

    expect(await restoreCodeBlockFocus(el, { childIndexPath: [3], selection: null })).toBe(false);
  });

  it('should give up when the element at the path cannot take the focus', async () => {
    const el = createBlock();
    document.body.append(el);
    el.createDiv();

    expect(await restoreCodeBlockFocus(el, { childIndexPath: [0], selection: null })).toBe(false);
  });

  it('should give up when the element has no focus method', async () => {
    const el = createBlock();
    document.body.append(el);
    const child = el.createDiv();
    Object.defineProperty(child, 'focus', { value: undefined });

    expect(await restoreCodeBlockFocus(el, { childIndexPath: [0], selection: null })).toBe(false);
  });

  it('should skip the selection on an element that is not a text field', async () => {
    const el = createBlock();
    document.body.append(el);
    const button = el.createEl('button');

    expect(await restoreCodeBlockFocus(el, { childIndexPath: [0], selection: { direction: 'none', end: 1, start: 0 } })).toBe(true);
    expect(document.activeElement).toBe(button);
  });
});
