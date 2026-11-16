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

import { FileInputSuggest } from '../file-input-suggest.ts';
import { FilePathComponent } from './file-path-component.ts';

vi.mock('../plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

describe('FilePathComponent', () => {
  let app: AppOriginal;

  beforeEach(() => {
    app = App.createConfigured__({ files: { 'Projects/note.md': '' } }).asOriginalType__();
  });

  it('should edit the path as text and resolve it to a file', () => {
    const component = new FilePathComponent(createDiv(), app);
    expect(component.suggest).toBeInstanceOf(FileInputSuggest);
    expect(component.isEmpty()).toBe(true);
    expect(component.getFile()).toBeNull();

    component.setValue(' Projects//note.md ');
    expect(component.getValue()).toBe(' Projects//note.md ');
    expect(component.isEmpty()).toBe(false);
    expect(component.getFile()?.path).toBe('Projects/note.md');

    component.setValue('Missing.md');
    expect(component.getFile()).toBeNull();

    component.empty();
    expect(component.getValue()).toBe('');
  });

  it('should take a picked file and report it through onChange', () => {
    const component = new FilePathComponent(createDiv(), app);
    const onChange = vi.fn();
    component.onChange(onChange);
    const file = app.vault.getFileByPath('Projects/note.md');
    if (!file) {
      throw new Error('The test file is missing');
    }
    component.suggest.selectSuggestion(file, new MouseEvent('click'));
    expect(component.getValue()).toBe('Projects/note.md');
    expect(onChange).toHaveBeenCalledWith('Projects/note.md');
  });

  it('should set the placeholder', () => {
    const component = new FilePathComponent(createDiv(), app, { shouldIncludeFile: (): boolean => true });
    expect(component.setPlaceholderValue('Pick a note')).toBe(component);
    expect(component.inputEl.placeholder).toBe('Pick a note');
  });
});
