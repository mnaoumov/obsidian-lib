// @vitest-environment jsdom

import type {
  App as AppOriginal,
  TFile
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

import {
  clipMatches,
  FileInputSuggest
} from './file-input-suggest.ts';

vi.mock('obsidian', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian')>(),
  renderMatches: vi.fn()
}));

class TestFileInputSuggest extends FileInputSuggest {
  public suggest(query: string): TFile[] {
    return this.getSuggestions(query);
  }
}

function getFile(app: AppOriginal, path: string): TFile {
  const file = app.vault.getFileByPath(path);
  if (!file) {
    throw new Error(`The test file ${path} is missing`);
  }
  return file;
}

describe('FileInputSuggest', () => {
  let app: AppOriginal;

  beforeEach(() => {
    vi.mocked(renderMatches).mockClear();
    app = App.createConfigured__({
      files: {
        'Archive/old.md': '',
        'Images/photo.png': '',
        'Projects/Alpha/note.md': '',
        'Projects/Beta/note.md': ''
      }
    }).asOriginalType__();
  });

  it('should suggest matching files by path, sorted by score then path', () => {
    const suggest = new TestFileInputSuggest(app, createEl('input'));
    expect(suggest.suggest(' alpha ').map((file) => file.path)).toEqual(['Projects/Alpha/note.md']);
    expect(suggest.suggest('note').map((file) => file.path)).toEqual(['Projects/Alpha/note.md', 'Projects/Beta/note.md']);
    expect(suggest.suggest('')).toHaveLength(4);
    expect(suggest.suggest('zzz')).toEqual([]);
  });

  it('should offer only the files the filter includes', () => {
    const suggest = new TestFileInputSuggest(app, createEl('input'), {
      shouldIncludeFile: (file): boolean => file.extension === 'md'
    });
    expect(suggest.suggest('').map((file) => file.path)).not.toContain('Images/photo.png');
    expect(suggest.suggest('')).toHaveLength(3);
  });

  it('should render the name and the path with the matched characters', () => {
    const suggest = new TestFileInputSuggest(app, createEl('input'));
    const file = getFile(app, 'Projects/Alpha/note.md');
    suggest.suggest('a/note');
    const el = createDiv();
    suggest.renderSuggestion(file, el);

    const titleEl = el.querySelector(':scope > .suggestion-content > .suggestion-title');
    const noteEl = el.querySelector(':scope > .suggestion-content > .suggestion-note');
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(titleEl, 'note.md', [[0, 4]]);
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(noteEl, 'Projects/Alpha/note.md', [[9, 10], [14, 19]]);
  });

  it('should render a file it never matched without highlights', () => {
    const suggest = new TestFileInputSuggest(app, createEl('input'));
    const el = createDiv();
    suggest.renderSuggestion(getFile(app, 'Archive/old.md'), el);
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(expect.anything(), 'old.md', []);
    expect(vi.mocked(renderMatches)).toHaveBeenCalledWith(expect.anything(), 'Archive/old.md', []);
  });

  it('should put the picked path into the input and notify', () => {
    const inputEl = createEl('input');
    const suggest = new FileInputSuggest(app, inputEl);
    const onInput = vi.fn();
    const onSelect = vi.fn();
    inputEl.addEventListener('input', onInput);
    suggest.onSelect(onSelect);
    const file = getFile(app, 'Projects/Beta/note.md');
    suggest.selectSuggestion(file, new MouseEvent('click'));
    expect(inputEl.value).toBe('Projects/Beta/note.md');
    expect(onInput).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(file, expect.any(MouseEvent));
  });
});

describe('clipMatches', () => {
  it('should keep, cut and shift the ranges inside the span', () => {
    expect(clipMatches([[0, 2], [4, 7], [9, 12]], 5, 10)).toEqual([[0, 2], [4, 5]]);
    expect(clipMatches([], 0, 3)).toEqual([]);
  });
});
