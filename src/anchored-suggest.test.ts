// @vitest-environment jsdom

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { AnchoredSuggest } from './anchored-suggest.ts';

class TestSuggest extends AnchoredSuggest<string> {
  public readonly chosen: string[] = [];
  public items: Promise<string[]> | string[] = ['a', 'b', 'c'];
  public readonly queries: string[] = [];

  public renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  protected getSuggestions(query: string): Promise<string[]> | string[] {
    this.queries.push(query);
    return this.items;
  }

  protected onChooseSuggestion(value: string): void {
    this.chosen.push(value);
  }
}

function pointerDown(target: EventTarget): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
}

describe('AnchoredSuggest', () => {
  let suggest: TestSuggest;

  beforeEach(() => {
    const app = App.createConfigured__().asOriginalType__();
    suggest = new TestSuggest(app);
    // The mock popover has none of the members the real one renders with.
    Object.assign(suggest, { reposition: vi.fn(), setAutoDestroy: vi.fn(), suggestEl: createDiv(), suggestions: { setSuggestions: vi.fn() } });
    activeDocument.body.append(suggest.suggestEl);
  });

  it('should open at an element and track it', async () => {
    const anchorEl = activeDocument.body.createDiv();
    expect(await suggest.openAt({ anchor: anchorEl, query: 'q' })).toBe(true);
    expect(suggest.queries).toEqual(['q']);
    expect(suggest.isOpen).toBe(true);
    expect(vi.mocked(suggest.suggestions.setSuggestions)).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(suggest.reposition).toHaveBeenCalledOnce();
    expect(suggest.setAutoDestroy).toHaveBeenCalledWith(anchorEl);

    pointerDown(anchorEl);
    pointerDown(suggest.suggestEl);
    expect(suggest.isOpen).toBe(true);

    pointerDown(activeDocument.body);
    expect(suggest.isOpen).toBe(false);
  });

  it('should open at a rectangle with the default query and limit', async () => {
    suggest.limit = 2;
    expect(await suggest.openAt({ anchor: new DOMRect(1, 2, 3, 4) })).toBe(true);
    expect(suggest.queries).toEqual(['']);
    expect(vi.mocked(suggest.suggestions.setSuggestions)).toHaveBeenCalledWith(['a', 'b']);
    expect(suggest.setAutoDestroy).not.toHaveBeenCalled();
    pointerDown(activeDocument.body);
    expect(suggest.isOpen).toBe(false);
  });

  it('should show every suggestion when the limit is off', async () => {
    suggest.limit = 0;
    await suggest.openAt({ anchor: new DOMRect() });
    expect(vi.mocked(suggest.suggestions.setSuggestions)).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('should stay closed with nothing to suggest', async () => {
    suggest.items = [];
    expect(await suggest.openAt({ anchor: new DOMRect() })).toBe(false);
    expect(suggest.isOpen).toBe(false);
  });

  it('should drop suggestions that arrive after a close', async () => {
    let resolve: ((value: string[]) => void) | undefined;
    suggest.items = new Promise((innerResolve) => {
      resolve = innerResolve;
    });
    const promise = suggest.openAt({ anchor: new DOMRect() });
    suggest.close();
    resolve?.(['late']);
    expect(await promise).toBe(false);
    expect(suggest.isOpen).toBe(false);
  });

  it('should refresh for a new query only once anchored', async () => {
    expect(await suggest.setQuery('x')).toBe(false);
    await suggest.openAt({ anchor: new DOMRect() });
    expect(await suggest.setQuery('y')).toBe(true);
    expect(suggest.queries).toEqual(['', 'y']);
  });

  it('should close before handing over the chosen suggestion', async () => {
    await suggest.openAt({ anchor: new DOMRect() });
    suggest.selectSuggestion('b', new MouseEvent('click'));
    expect(suggest.isOpen).toBe(false);
    expect(suggest.chosen).toEqual(['b']);
  });
});
