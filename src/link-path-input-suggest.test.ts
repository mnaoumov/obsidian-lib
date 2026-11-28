// @vitest-environment jsdom

import type {
  App as AppOriginal,
  HeadingCache
} from 'obsidian';

import { renderMatches } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { LinkSuggestion } from './link-and-tag-input-suggest.ts';
import type {
  LinkPathHeadingSuggestion,
  LinkPathInputSuggestConstructorParams,
  LinkPathSuggestion
} from './link-path-input-suggest.ts';

import { LinkPathInputSuggest } from './link-path-input-suggest.ts';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<typeof import('obsidian')>()),
  renderMatches: vi.fn((el: HTMLElement, text: string) => {
    el.appendText(text);
  })
}));

interface CreatedSuggest {
  readonly inputEl: HTMLInputElement;
  readonly suggest: TestSuggest;
}

class TestSuggest extends LinkPathInputSuggest {
  public suggest(value: string): LinkPathSuggestion[] {
    this.inputEl.value = value;
    return this.getSuggestions(value);
  }
}

const POSITION = { end: { col: 0, line: 0, offset: 0 }, start: { col: 0, line: 0, offset: 0 } };

function heading(text: string, level = 1): HeadingCache {
  return { heading: text, level, position: POSITION };
}

function headingTexts(suggestions: LinkPathSuggestion[]): string[] {
  return suggestions.map((suggestion) => (isHeading(suggestion) ? suggestion.heading.heading : `file:${suggestion.file.path}`));
}

function isHeading(suggestion: LinkPathSuggestion | undefined): suggestion is LinkPathHeadingSuggestion {
  return suggestion !== undefined && 'heading' in suggestion;
}

function isLink(suggestion: LinkPathSuggestion | undefined): suggestion is LinkSuggestion {
  return suggestion !== undefined && !('heading' in suggestion);
}

describe('LinkPathInputSuggest', () => {
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
    mockApp.metadataCache.setCache__('Folder/Project plan.md', {
      headings: [heading('Goals'), heading('Open questions #next', 2), heading('Risks', 2)]
    });
    mockApp.metadataCache.setCache__('notes.md', { headings: [heading('Inbox'), heading('Archive')] });
    app = mockApp.asOriginalType__();
  });

  function create(params: Partial<LinkPathInputSuggestConstructorParams> = {}): CreatedSuggest {
    const inputEl = params.inputEl ?? createEl('input');
    return { inputEl, suggest: new TestSuggest({ app, ...params, inputEl }) };
  }

  it('should suggest files by the whole value before a #', () => {
    const { suggest } = create();
    expect(headingTexts(suggest.suggest('plan'))).toEqual(['file:Folder/Project plan.md']);
  });

  it('should suggest every file for an empty value', () => {
    const { suggest } = create();
    expect(suggest.suggest('')).toHaveLength(4);
  });

  it('should make file link text relative to the source path', () => {
    const { suggest } = create({ sourcePath: 'Folder/x.md' });
    const fileToLinktext = vi.spyOn(app.metadataCache, 'fileToLinktext');
    suggest.suggest('plan');
    expect(fileToLinktext).toHaveBeenCalledWith(expect.anything(), 'Folder/x.md', true);
  });

  it('should resolve against the vault root when no source path is given', () => {
    const { suggest } = create();
    const fileToLinktext = vi.spyOn(app.metadataCache, 'fileToLinktext');
    const getFirstLinkpathDestinationSpy = vi.spyOn(app.metadataCache, 'getFirstLinkpathDest');
    suggest.suggest('plan');
    suggest.suggest('notes#');
    expect(fileToLinktext).toHaveBeenCalledWith(expect.anything(), '', true);
    expect(getFirstLinkpathDestinationSpy).toHaveBeenCalledWith('notes', '');
  });

  it('should suggest the headings of the file the path resolves to, in document order for an empty query', () => {
    const { suggest } = create();
    expect(headingTexts(suggest.suggest('Project plan#'))).toEqual(['Goals', 'Open questions #next', 'Risks']);
  });

  it('should filter the headings by the text after the #', () => {
    const { suggest } = create();
    const suggestions = suggest.suggest('Project plan#ris');
    expect(headingTexts(suggestions)).toEqual(['Risks']);
    const [suggestion] = suggestions;
    if (!isHeading(suggestion)) {
      throw new Error('Expected a heading suggestion');
    }
    expect(suggestion.matches).toEqual([[0, 3]]);
    expect(suggestion.file.path).toBe('Folder/Project plan.md');
  });

  it('should build the value from the path and the heading stripped for a link', () => {
    const { suggest } = create();
    const [suggestion] = suggest.suggest('Project plan#open');
    if (!isHeading(suggestion)) {
      throw new Error('Expected a heading suggestion');
    }
    expect(suggestion.value).toBe('Project plan#Open questions next');
  });

  it('should suggest the headings of the source file for a bare #', () => {
    const { suggest } = create({ sourcePath: 'notes.md' });
    expect(headingTexts(suggest.suggest('#arch'))).toEqual(['Archive']);
  });

  it('should suggest nothing for a bare # with no source file', () => {
    const { suggest } = create();
    expect(suggest.suggest('#')).toEqual([]);
  });

  it('should complete the last heading of a nested heading path, keeping the earlier ones', () => {
    const { suggest } = create();
    const [suggestion] = suggest.suggest('Project plan#Goals#ris');
    if (!isHeading(suggestion)) {
      throw new Error('Expected a heading suggestion');
    }
    expect(suggestion.value).toBe('Project plan#Goals#Risks');
  });

  it('should suggest nothing for a block subpath', () => {
    const { suggest } = create();
    expect(suggest.suggest('Project plan#^abc')).toEqual([]);
  });

  it('should suggest nothing when the path resolves to no file', () => {
    const { suggest } = create();
    expect(suggest.suggest('missing#')).toEqual([]);
  });

  it('should suggest nothing for a file with no headings or no metadata', () => {
    const { suggest } = create();
    expect(suggest.suggest('other#')).toEqual([]);
    vi.spyOn(app.metadataCache, 'getFileCache').mockReturnValue(null);
    expect(suggest.suggest('notes#')).toEqual([]);
  });

  it('should replace the value with a picked file, move the caret to the end and notify listeners', () => {
    const { inputEl, suggest } = create();
    const onSelect = vi.fn();
    const onInput = vi.fn();
    suggest.onSelect(onSelect);
    inputEl.addEventListener('input', onInput);
    const [suggestion] = suggest.suggest('plan');
    if (!isLink(suggestion)) {
      throw new Error('Expected a file suggestion');
    }
    const clickEvent = new MouseEvent('click');
    inputEl.setSelectionRange(0, 0);
    suggest.selectSuggestion(suggestion, clickEvent);
    expect(inputEl.value).toBe('Project plan');
    expect(inputEl.selectionStart).toBe('Project plan'.length);
    expect(onInput).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(suggestion, clickEvent);
  });

  it('should replace the value with the link path of a picked heading', () => {
    const { inputEl, suggest } = create();
    const [suggestion] = suggest.suggest('Project plan#ris');
    if (!suggestion) {
      throw new Error('Expected a suggestion');
    }
    suggest.selectSuggestion(suggestion, new KeyboardEvent('keydown'));
    expect(inputEl.value).toBe('Project plan#Risks');
    expect(inputEl.selectionStart).toBe('Project plan#Risks'.length);
  });

  it('should render a heading with its matches and its file path', () => {
    const { suggest } = create();
    const [suggestion] = suggest.suggest('Project plan#ris');
    if (!isHeading(suggestion)) {
      throw new Error('Expected a heading suggestion');
    }
    vi.mocked(renderMatches).mockClear();
    const el = createDiv();
    suggest.renderSuggestion(suggestion, el);
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(el.querySelector('.suggestion-title'), 'Risks', [[0, 3]]);
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Folder/Project plan.md');
  });

  it('should render a heading with nothing highlighted when it has no matches', () => {
    const { suggest } = create();
    const [suggestion] = suggest.suggest('Project plan#ris');
    if (!isHeading(suggestion)) {
      throw new Error('Expected a heading suggestion');
    }
    vi.mocked(renderMatches).mockClear();
    const el = createDiv();
    suggest.renderSuggestion({ file: suggestion.file, heading: suggestion.heading, value: suggestion.value }, el);
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(el.querySelector('.suggestion-title'), 'Risks', null);
  });

  it('should render a file like the [[ link suggest does', () => {
    const { suggest } = create();
    const [suggestion] = suggest.suggest('plan');
    if (!isLink(suggestion)) {
      throw new Error('Expected a file suggestion');
    }
    const el = createDiv();
    suggest.renderSuggestion(suggestion, el);
    expect(el.textContent).toBe('Project planFolder/Project plan.md');
  });
});
