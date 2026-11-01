/**
 * @file
 *
 * Tests for {@link PluginEditorSuggestRegistrar}.
 */

import type {
  EditorSuggest as EditorSuggestOriginal,
  Plugin as PluginOriginal
} from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginEditorSuggestRegistrar } from './editor-suggest-registrar.ts';

describe('PluginEditorSuggestRegistrar', () => {
  it('should delegate registerEditorSuggest to the plugin', () => {
    const registerEditorSuggest = vi.fn();
    const plugin = strictProxy<PluginOriginal>({ registerEditorSuggest });
    const registrar = new PluginEditorSuggestRegistrar(plugin);
    const editorSuggest = strictProxy<EditorSuggestOriginal<unknown>>({});

    registrar.registerEditorSuggest(editorSuggest);

    expect(registerEditorSuggest).toHaveBeenCalledWith(editorSuggest);
  });

  it('should move a prioritized suggest to the front', () => {
    const other = strictProxy<EditorSuggestOriginal<unknown>>({});
    const editorSuggest = strictProxy<EditorSuggestOriginal<unknown>>({});
    const suggests: EditorSuggestOriginal<unknown>[] = [other];
    const app = { workspace: { editorSuggest: { suggests } } };
    const plugin = strictProxy<PluginOriginal>({
      app,
      registerEditorSuggest: vi.fn((suggest: EditorSuggestOriginal<unknown>) => {
        suggests.push(suggest);
      })
    });

    new PluginEditorSuggestRegistrar(plugin).registerEditorSuggest(editorSuggest, { shouldPrioritize: true });

    expect(suggests).toEqual([editorSuggest, other]);
    expect(suggests[0]).toBe(editorSuggest);
  });
});
