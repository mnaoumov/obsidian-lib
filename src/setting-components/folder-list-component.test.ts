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

import {
  FolderInputSuggest,
  FolderListComponent
} from './folder-list-component.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

class TestFolderInputSuggest extends FolderInputSuggest {
  public suggest(query: string): string[] {
    return this.getSuggestions(query).map((folder) => folder.path);
  }
}

describe('FolderListComponent', () => {
  let app: AppOriginal;

  beforeEach(() => {
    const mockApp = App.createConfigured__({ files: { 'Projects/Alpha/note.md': '', 'Projects/Beta/note.md': '' } });
    app = mockApp.asOriginalType__();
  });

  it('should normalize typed paths and refuse empty text', () => {
    const component = new FolderListComponent(createDiv(), app);
    component.newItemInputEl.value = ' Projects//Alpha/ ';
    expect(component.addTypedItem()).toBe(true);
    component.newItemInputEl.value = ' ';
    expect(component.addTypedItem()).toBe(false);
    expect(component.getValue()).toEqual(['Projects/Alpha']);
  });

  it('should add a folder picked from the suggest', () => {
    const component = new FolderListComponent(createDiv(), app);
    const folder = app.vault.getFolderByPath('Projects/Beta');
    if (!folder) {
      throw new Error('The test folder is missing');
    }
    const onInput = vi.fn();
    component.newItemInputEl.addEventListener('input', onInput);
    component.suggest.selectSuggestion(folder, new MouseEvent('click'));
    expect(onInput).toHaveBeenCalledOnce();
    expect(component.getValue()).toEqual(['Projects/Beta']);
  });
});

describe('FolderInputSuggest', () => {
  it('should suggest matching folders, the root as /', () => {
    const app = App.createConfigured__({ files: { 'Other/note.md': '', 'Projects/Alpha/note.md': '' } }).asOriginalType__();
    const suggest = new TestFolderInputSuggest(app, createEl('input'));
    expect(suggest.suggest('alp')).toEqual(['Projects/Alpha']);
    expect(suggest.suggest('')).toContain('/');

    const rootEl = createDiv();
    suggest.renderSuggestion(app.vault.getRoot(), rootEl);
    expect(rootEl.textContent).toBe('/');
    const folderEl = createDiv();
    const otherFolder = app.vault.getFolderByPath('Other');
    if (!otherFolder) {
      throw new Error('The test folder is missing');
    }
    suggest.renderSuggestion(otherFolder, folderEl);
    expect(folderEl.textContent).toBe('Other');
  });
});
