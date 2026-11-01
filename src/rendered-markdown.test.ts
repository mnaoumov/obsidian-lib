// @vitest-environment jsdom

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { sanitizeHTMLToDom } from 'obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  isOwnedByRenderedMarkdown,
  registerFoldHandlers,
  registerFootnoteLinkHandler
} from './rendered-markdown.ts';

const scrollIntoView = vi.fn();

function click(element: Element, init: MouseEventInit = {}): MouseEvent {
  const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(clickEvent);
  return clickEvent;
}

function getBlocks(rootEl: HTMLElement): HTMLElement[] {
  return rootEl.findAll(':scope > *');
}

function getIndicator(parentEl: Element): HTMLElement {
  const indicatorEl = parentEl.querySelector<HTMLElement>(':scope > .collapse-indicator');
  if (!indicatorEl) {
    throw new Error('No indicator');
  }
  return indicatorEl;
}

function isHidden(element: HTMLElement): boolean {
  return element.style.display === 'none';
}

function render(html: string): HTMLElement {
  const el = createDiv();
  el.append(sanitizeHTMLToDom(html));
  document.body.append(el);
  return el;
}

beforeEach(() => {
  scrollIntoView.mockClear();
  // Jsdom has no layout, so it does not implement `scrollIntoView`.
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  document.body.empty();
  vi.useRealTimers();
});

describe('isOwnedByRenderedMarkdown', () => {
  it('should own the root and its descendants', () => {
    const el = render('<p><a>x</a></p>');
    expect(isOwnedByRenderedMarkdown(el, el)).toBe(true);
    expect(isOwnedByRenderedMarkdown(el.find('a'), el)).toBe(true);
  });

  it('should not own an element inside a nested view', () => {
    const el = render('<div class="markdown-preview-view"><a class="a"></a></div><div class="bases-view"><a class="b"></a></div>');
    expect(isOwnedByRenderedMarkdown(el.find('a.a'), el)).toBe(false);
    expect(isOwnedByRenderedMarkdown(el.find('a.b'), el)).toBe(false);
  });

  it('should not own an element outside the root', () => {
    const el = render('');
    expect(isOwnedByRenderedMarkdown(createDiv(), el)).toBe(false);
  });
});

describe('registerFootnoteLinkHandler', () => {
  const FOOTNOTE_HTML = [
    '<p><sup data-footnote-id="fnref-1-x" id="fnref-1-x"><a class="footnote-link" href="#fn-1-x">[1]</a></sup></p>',
    '<section class="footnotes"><ol><li data-footnote-id="fn-1-x" id="fn-1-x">Note <a class="footnote-backref footnote-link" href="#fnref-1-x">back</a></li></ol></section>'
  ].join('');

  it('should scroll to the footnote and flash it', async () => {
    vi.useFakeTimers();
    const el = render(FOOTNOTE_HTML);
    registerFootnoteLinkHandler({ el });

    const clickEvent = click(el.find('sup a'));

    const footnoteEl = el.find('li');
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(footnoteEl);
    expect(footnoteEl.hasClass('is-flashing')).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    await waitForAllAsyncOperations();
    expect(footnoteEl.hasClass('is-flashing')).toBe(false);
  });

  it('should scroll back to the reference and move the flash there', () => {
    const el = render(FOOTNOTE_HTML);
    registerFootnoteLinkHandler({ el });

    click(el.find('sup a'));
    click(el.find('a.footnote-backref'));

    expect(scrollIntoView.mock.contexts[1]).toBe(el.find('sup'));
    expect(el.find('sup').hasClass('is-flashing')).toBe(true);
    expect(el.find('li').hasClass('is-flashing')).toBe(false);
  });

  it('should ignore a click that is not a plain left click', () => {
    const el = render(FOOTNOTE_HTML);
    registerFootnoteLinkHandler({ el });

    const clickEvent = click(el.find('sup a'), { button: 1 });

    expect(clickEvent.defaultPrevented).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('should leave a footnote link of a nested view to that view', () => {
    const el = render(`<div class="markdown-preview-view">${FOOTNOTE_HTML}</div>`);
    registerFootnoteLinkHandler({ el });

    const clickEvent = click(el.find('sup a'));

    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('should do nothing more for a link whose target is missing or not a hash', () => {
    const el = render('<a class="footnote-link m" href="#fn-9">a</a><a class="footnote-link n" href="https://x">b</a><a class="footnote-link o">c</a>');
    registerFootnoteLinkHandler({ el });

    expect(click(el.find('a.m')).defaultPrevented).toBe(true);
    expect(click(el.find('a.n')).defaultPrevented).toBe(true);
    expect(click(el.find('a.o')).defaultPrevented).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('should unfold the list items and headings hiding the footnote', () => {
    const el = render([
      '<div><h1>A</h1></div>',
      '<div><p><a class="footnote-link" href="#fn-1">1</a></p></div>',
      '<div><h2>B</h2></div>',
      '<div><h3>C</h3></div>',
      '<div><ul><li>Outer<ul><li data-footnote-id="fn-1">Note</li></ul></li></ul></div>'
    ].join(''));
    registerFoldHandlers({ el });
    registerFootnoteLinkHandler({ el });
    click(getIndicator(el.find('ul > li')));
    click(getIndicator(el.find('h3')));
    click(getIndicator(el.find('h2')));
    expect(isHidden(ensureNonNullable(getBlocks(el)[4]))).toBe(true);

    click(el.find('a.footnote-link'));

    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, false, false, false, false]);
    expect(el.find('h2').hasClass('is-collapsed')).toBe(false);
    expect(el.find('h3').hasClass('is-collapsed')).toBe(false);
    expect(el.find('ul > li').hasClass('is-collapsed')).toBe(false);
  });

  it('should unfold only the headings above a reference that sits in a heading', () => {
    const el = render([
      '<div><p><a class="footnote-link" href="#ref">back</a></p></div>',
      '<div><h1>A</h1></div>',
      '<div><h2 class="other">Other</h2></div>',
      '<div><h2>Title<sup data-footnote-id="ref">1</sup></h2></div>'
    ].join(''));
    registerFoldHandlers({ el });
    registerFootnoteLinkHandler({ el });
    click(getIndicator(el.find('h2.other')));
    click(getIndicator(el.find('h1')));

    click(el.find('a.footnote-link'));

    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, false, false, false]);
    expect(el.find('h1').hasClass('is-collapsed')).toBe(false);
    expect(el.find('h2.other').hasClass('is-collapsed')).toBe(true);
  });

  it('should unfold nothing when nothing hides the footnote', () => {
    const el = render('<h1>A</h1><p data-footnote-id="fn-1">Note</p><p><a class="footnote-link" href="#fn-1">1</a></p>');
    registerFootnoteLinkHandler({ el });

    click(el.find('a.footnote-link'));

    expect(scrollIntoView.mock.contexts[0]).toBe(el.find('p'));
  });
});

describe('registerFoldHandlers', () => {
  const HEADINGS_HTML = [
    '<div><h1>One</h1></div>',
    '<div><p>a</p></div>',
    '<div><h2>Two</h2></div>',
    '<div><p>b</p></div>',
    '<div><h3>Three</h3></div>',
    '<div><p>c</p></div>',
    '<div><h2>Four</h2></div>',
    '<div><p>d</p></div>',
    '<div><h1>Five</h1></div>'
  ].join('');

  it('should add an indicator to every heading block and every list item with a nested list', () => {
    const el = render(`${HEADINGS_HTML}<h4>Bare</h4><ul><li>x<ul><li>y</li></ul></li><li>z</li></ul>`);
    registerFoldHandlers({ el });

    expect(el.hasClass('obsidian-lib')).toBe(true);
    expect(el.hasClass('foldable-markdown')).toBe(true);
    expect(el.findAll('.heading-collapse-indicator')).toHaveLength(6);
    expect(el.findAll('.list-collapse-indicator')).toHaveLength(1);
    expect(el.find('li').firstElementChild?.hasClass('list-collapse-indicator')).toBe(true);
  });

  it('should add nothing it is told not to, and nothing twice', () => {
    const el = render('<h1>A</h1><ul><li>x<ul><li>y</li></ul></li></ul><div class="markdown-preview-view"><ul><li>p<ol><li>q</li></ol></li></ul></div>');
    registerFoldHandlers({ el, shouldFoldHeadings: false });
    registerFoldHandlers({ el, shouldFoldLists: false });
    registerFoldHandlers({ el });

    expect(el.findAll('.heading-collapse-indicator')).toHaveLength(1);
    expect(el.findAll('.list-collapse-indicator')).toHaveLength(1);
  });

  it('should hide the blocks under a folded heading up to the next heading of the same or a higher level', () => {
    const el = render(HEADINGS_HTML);
    registerFoldHandlers({ el });

    const clickEvent = click(getIndicator(el.find('h2')));

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(el.find('h2').hasClass('is-collapsed')).toBe(true);
    expect(getIndicator(el.find('h2')).hasClass('is-collapsed')).toBe(true);
    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, false, false, true, true, true, false, false, false]);

    click(getIndicator(el.find('h2')));
    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it('should keep a nested folded heading folded when its parent unfolds', () => {
    const el = render(HEADINGS_HTML);
    registerFoldHandlers({ el });

    click(getIndicator(el.find('h3')));
    click(getIndicator(el.find('h1')));
    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, true, true, true, true, true, true, true, false]);

    click(getIndicator(el.find('h1')));
    expect(getBlocks(el).map((block) => isHidden(block))).toEqual([false, false, false, false, false, true, false, false, false]);
  });

  it('should fold a list item\'s nested lists', () => {
    const el = render('<ul><li>x<ul><li>y</li></ul></li></ul>');
    registerFoldHandlers({ el });
    const listItemEl = el.find('li');

    click(getIndicator(listItemEl));
    expect(listItemEl.hasClass('is-collapsed')).toBe(true);

    click(getIndicator(listItemEl));
    expect(listItemEl.hasClass('is-collapsed')).toBe(false);
  });

  it('should ignore a click that is not a plain left click, or that something else handled', () => {
    const el = render(HEADINGS_HTML);
    registerFoldHandlers({ el });
    const indicatorEl = getIndicator(el.find('h2'));

    click(indicatorEl, { button: 1 });
    function preventingListener(clickEvent: Event): void {
      clickEvent.preventDefault();
    }
    indicatorEl.addEventListener('click', preventingListener);
    click(indicatorEl);
    indicatorEl.removeEventListener('click', preventingListener);

    expect(el.find('h2').hasClass('is-collapsed')).toBe(false);
  });

  it('should ignore an indicator that is not under a heading of its own', () => {
    const el = render('<p><span class="heading-collapse-indicator">x</span></p><div class="markdown-preview-view"><h1><span class="heading-collapse-indicator">y</span></h1></div>');
    registerFoldHandlers({ el });

    expect(click(el.find('p > span')).defaultPrevented).toBe(true);
    expect(click(el.find('h1 > span')).defaultPrevented).toBe(false);
    expect(el.find('h1').hasClass('is-collapsed')).toBe(false);
  });
});
