// @vitest-environment jsdom

import type { App as AppOriginal } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { TagSuggestion } from '../link-and-tag-input-suggest.ts';

import { LinkAndTagCompletionKind } from '../link-and-tag-input-suggest.ts';
import {
  TagInputSuggest,
  TagListComponent
} from './tag-list-component.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

class TestTagInputSuggest extends TagInputSuggest {
  public suggest(query: string): string[] {
    return this.getSuggestions(query).map((suggestion) => suggestion.tag);
  }
}

const POSITION = { end: { col: 0, line: 0, offset: 0 }, start: { col: 0, line: 0, offset: 0 } };

describe('TagListComponent', () => {
  let app: AppOriginal;

  beforeEach(() => {
    const mockApp = App.createConfigured__({ files: { 'a.md': '', 'b.md': '' } });
    mockApp.metadataCache.setCache__('a.md', { tags: [{ position: POSITION, tag: '#project' }] });
    mockApp.metadataCache.setCache__('b.md', { tags: [{ position: POSITION, tag: '#project/alpha' }, { position: POSITION, tag: '#idea' }] });
    app = mockApp.asOriginalType__();
  });

  it('should store tags without # and show them with it', () => {
    const component = new TagListComponent(createDiv(), app);
    component.newItemInputEl.value = ' ##project ';
    expect(component.addTypedItem()).toBe(true);
    expect(component.getValue()).toEqual(['project']);
    expect(component.listEl.querySelector('.list-component-item-text')?.textContent).toBe('#project');
  });

  it('should refuse invalid tags', () => {
    const component = new TagListComponent(createDiv(), app);
    for (const text of ['#', '123', 'with space', 'a.b']) {
      component.newItemInputEl.value = text;
      expect(component.addTypedItem()).toBe(false);
    }
    component.newItemInputEl.value = 'y2026';
    expect(component.addTypedItem()).toBe(true);
  });

  it('should add a tag picked from the suggest', () => {
    const component = new TagListComponent(createDiv(), app);
    const onInput = vi.fn();
    component.newItemInputEl.addEventListener('input', onInput);
    const suggestion: TagSuggestion = { count: 2, kind: LinkAndTagCompletionKind.Tag, tag: 'idea' };
    component.suggest.selectSuggestion(suggestion, new MouseEvent('click'));
    expect(onInput).toHaveBeenCalledOnce();
    expect(component.getValue()).toEqual(['idea']);
  });
});

describe('TagInputSuggest', () => {
  it('should suggest vault tags with or without the typed #', () => {
    const mockApp = App.createConfigured__({ files: { 'a.md': '' } });
    mockApp.metadataCache.setCache__('a.md', { tags: [{ position: POSITION, tag: '#project' }, { position: POSITION, tag: '#idea' }] });
    const suggest = new TestTagInputSuggest(mockApp.asOriginalType__(), createEl('input'));
    expect(suggest.suggest('#pro')).toEqual(['project']);
    expect(suggest.suggest(' ide')).toEqual(['idea']);

    const el = createDiv();
    suggest.renderSuggestion({ count: 3, kind: LinkAndTagCompletionKind.Tag, tag: 'project' }, el);
    expect(el.hasClass('mod-complex')).toBe(true);
    expect(el.textContent).toBe('#project3');
  });
});
