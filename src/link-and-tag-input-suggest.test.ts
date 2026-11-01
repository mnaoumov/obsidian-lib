// @vitest-environment jsdom
// cspell:words área

import type { App as AppOriginal } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  LinkAndTagInputSuggestConstructorParams,
  LinkAndTagSuggestion,
  LinkSuggestion,
  TagSuggestion
} from './link-and-tag-input-suggest.ts';

import {
  getLinkAndTagCompletionTrigger,
  LinkAndTagCompletionKind,
  LinkAndTagInputSuggest
} from './link-and-tag-input-suggest.ts';

interface CreatedSuggest {
  readonly inputEl: HTMLInputElement | HTMLTextAreaElement;
  readonly suggest: TestSuggest;
}

class TestSuggest extends LinkAndTagInputSuggest {
  public suggest(): LinkAndTagSuggestion[] {
    return this.getSuggestions();
  }
}

function isLink(suggestion: LinkAndTagSuggestion | undefined): suggestion is LinkSuggestion {
  return suggestion?.kind === LinkAndTagCompletionKind.Link;
}

function isTag(suggestion: LinkAndTagSuggestion | undefined): suggestion is TagSuggestion {
  return suggestion?.kind === LinkAndTagCompletionKind.Tag;
}

function typeText(el: HTMLInputElement | HTMLTextAreaElement, text: string, caret = text.length): void {
  el.value = text;
  el.setSelectionRange(caret, caret);
}

describe('getLinkAndTagCompletionTrigger', () => {
  it('should find an unclosed link before the caret', () => {
    expect(getLinkAndTagCompletionTrigger('see [[fo', 8)).toEqual({ end: 8, kind: LinkAndTagCompletionKind.Link, query: 'fo', start: 4 });
  });

  it('should find a link with the caret inside the text', () => {
    expect(getLinkAndTagCompletionTrigger('[[fo]] rest', 4)).toEqual({ end: 4, kind: LinkAndTagCompletionKind.Link, query: 'fo', start: 0 });
  });

  it('should not complete a closed link, an alias, or a link across lines', () => {
    expect(getLinkAndTagCompletionTrigger('[[foo]] x', 9)).toBeNull();
    expect(getLinkAndTagCompletionTrigger('[[foo|al', 8)).toBeNull();
    expect(getLinkAndTagCompletionTrigger('[[foo\nbar', 9)).toBeNull();
  });

  it('should find a tag at the start or after whitespace', () => {
    expect(getLinkAndTagCompletionTrigger('#pro', 4)).toEqual({ end: 4, kind: LinkAndTagCompletionKind.Tag, query: 'pro', start: 0 });
    expect(getLinkAndTagCompletionTrigger('a #área/sub-1', 13)).toEqual({ end: 13, kind: LinkAndTagCompletionKind.Tag, query: 'área/sub-1', start: 2 });
    expect(getLinkAndTagCompletionTrigger('x #', 3)).toEqual({ end: 3, kind: LinkAndTagCompletionKind.Tag, query: '', start: 2 });
  });

  it('should not complete a hash inside a word or after punctuation', () => {
    expect(getLinkAndTagCompletionTrigger('a#b', 3)).toBeNull();
    expect(getLinkAndTagCompletionTrigger('#a.b', 4)).toBeNull();
    expect(getLinkAndTagCompletionTrigger('plain', 5)).toBeNull();
  });

  it('should fall back to a tag after a closed link', () => {
    expect(getLinkAndTagCompletionTrigger('[[a]] #t', 8)).toEqual({ end: 8, kind: LinkAndTagCompletionKind.Tag, query: 't', start: 6 });
  });
});

describe('LinkAndTagInputSuggest', () => {
  let app: AppOriginal;

  beforeEach(() => {
    const mockApp = App.createConfigured__({
      files: {
        'Folder/Project plan.md': '',
        'image.png': '',
        'notes.md': '',
        'other.md': ''
      }
    });
    mockApp.metadataCache.setCache__('notes.md', { tags: [{ position: { end: { col: 0, line: 0, offset: 0 }, start: { col: 0, line: 0, offset: 0 } }, tag: '#project' }] });
    mockApp.metadataCache.setCache__('other.md', {
      frontmatter: { tags: ['project', 'zeta', 'area/home'] }
    });
    app = mockApp.asOriginalType__();
  });

  function create(params: Partial<LinkAndTagInputSuggestConstructorParams> = {}): CreatedSuggest {
    const inputEl = params.inputEl ?? createEl('input');
    return { inputEl, suggest: new TestSuggest({ app, ...params, inputEl }) };
  }

  it('should read and write the value of a textarea', () => {
    const { inputEl, suggest } = create({ inputEl: createEl('textarea') });
    suggest.setValue('abc');
    expect(inputEl.value).toBe('abc');
    expect(suggest.getValue()).toBe('abc');
  });

  it('should suggest nothing outside a trigger', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, 'plain');
    expect(suggest.suggest()).toEqual([]);
  });

  it('should suggest files for a link trigger', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, 'see [[plan');
    const suggestions = suggest.suggest();
    expect(suggestions.map((suggestion) => isLink(suggestion) && suggestion.file.path)).toEqual(['Folder/Project plan.md']);
  });

  it('should suggest every file for an empty link query', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, '[[');
    expect(suggest.suggest()).toHaveLength(4);
  });

  it('should match a file by its path when the link text does not match', () => {
    const { inputEl, suggest } = create();
    vi.spyOn(app.metadataCache, 'fileToLinktext').mockReturnValue('zzz');
    typeText(inputEl, '[[other');
    expect(suggest.suggest().map((suggestion) => isLink(suggestion) && suggestion.file.path)).toEqual(['other.md']);
  });

  it('should suggest tags with their counts', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, 'x #');
    const suggestions = suggest.suggest();
    expect(suggestions.map((suggestion) => isTag(suggestion) && [suggestion.tag, suggestion.count])).toEqual([['project', 2], ['area/home', 1], ['zeta', 1]]);
  });

  it('should skip a note with no metadata', () => {
    const { inputEl, suggest } = create();
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    typeText(inputEl, '#');
    expect(suggest.suggest()).toEqual([]);
  });

  it('should filter tags by the query', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, '#home');
    expect(suggest.suggest().map((suggestion) => isTag(suggestion) && suggestion.tag)).toEqual(['area/home']);
  });

  it('should honor turned-off triggers', () => {
    const { inputEl, suggest } = create({ shouldSuggestLinks: false, shouldSuggestTags: false });
    typeText(inputEl, '[[a');
    expect(suggest.suggest()).toEqual([]);
    typeText(inputEl, '#a');
    expect(suggest.suggest()).toEqual([]);
  });

  it('should use the value length when the element has no selection', () => {
    const { inputEl, suggest } = create();
    inputEl.value = '#pro';
    Object.defineProperty(inputEl, 'selectionStart', { value: null });
    expect(suggest.suggest().map((suggestion) => isTag(suggestion) && suggestion.tag)).toEqual(['project']);
  });

  it('should insert a link at the caret, consuming a closing bracket pair, and notify listeners', () => {
    const { inputEl, suggest } = create({ inputEl: createEl('textarea'), sourcePath: 'Folder/x.md' });
    const onSelect = vi.fn();
    const onInput = vi.fn();
    suggest.onSelect(onSelect);
    inputEl.addEventListener('input', onInput);
    typeText(inputEl, 'a [[pla]] b', 7);
    const [suggestion] = suggest.suggest();
    if (!suggestion) {
      throw new Error('Expected a suggestion');
    }
    const clickEvent = new MouseEvent('click');
    suggest.selectSuggestion(suggestion, clickEvent);
    expect(inputEl.value).toBe('a [[Project plan]] b');
    expect(inputEl.selectionStart).toBe('a [[Project plan]]'.length);
    expect(onInput).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(suggestion, clickEvent);
  });

  it('should insert a link with no closing brackets after the caret', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, '[[oth');
    const [suggestion] = suggest.suggest();
    if (!suggestion) {
      throw new Error('Expected a suggestion');
    }
    suggest.selectSuggestion(suggestion, new KeyboardEvent('keydown'));
    expect(inputEl.value).toBe('[[other]]');
  });

  it('should insert a tag followed by a space', () => {
    const { inputEl, suggest } = create();
    typeText(inputEl, 'x #pro y', 6);
    suggest.selectSuggestion({ count: 2, kind: LinkAndTagCompletionKind.Tag, tag: 'project' }, new KeyboardEvent('keydown'));
    expect(inputEl.value).toBe('x #project  y');
    expect(inputEl.selectionStart).toBe('x #project '.length);
  });

  it('should leave the value alone when the caret left the trigger', () => {
    const { inputEl, suggest } = create();
    const onSelect = vi.fn();
    suggest.onSelect(onSelect);
    typeText(inputEl, 'plain');
    suggest.selectSuggestion({ count: 1, kind: LinkAndTagCompletionKind.Tag, tag: 'x' }, new KeyboardEvent('keydown'));
    expect(inputEl.value).toBe('plain');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('should render a link with its path when the link text differs', () => {
    const { suggest } = create();
    const el = createDiv();
    const file = app.vault.getFileByPath('Folder/Project plan.md');
    if (!file) {
      throw new Error('Expected a file');
    }
    suggest.renderSuggestion({ file, kind: LinkAndTagCompletionKind.Link, linktext: 'Project plan' }, el);
    expect(el.textContent).toBe('Project planFolder/Project plan.md');
    const sameEl = createDiv();
    suggest.renderSuggestion({ file, kind: LinkAndTagCompletionKind.Link, linktext: file.path }, sameEl);
    expect(sameEl.textContent).toBe(file.path);
  });

  it('should render a tag with its count', () => {
    const { suggest } = create();
    const el = createDiv();
    suggest.renderSuggestion({ count: 3, kind: LinkAndTagCompletionKind.Tag, tag: 'project' }, el);
    expect(el.textContent).toBe('#project3');
    expect(el.hasClass('mod-complex')).toBe(true);
  });
});
