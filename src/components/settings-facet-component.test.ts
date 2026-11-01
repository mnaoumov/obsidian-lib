/**
 * @file
 *
 * Tests for {@link SettingsFacetComponent}.
 */

import type {
  Extension,
  TransactionSpec
} from '@codemirror/state';
import type { App as AppOriginal } from 'obsidian';

import { EditorState } from '@codemirror/state';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { EditorExtensionRegistrar } from '../editor-extension-registrar.ts';

import { createSettingsFacet } from '../codemirror/settings-facet.ts';
import { SettingsFacetComponent } from './settings-facet-component.ts';

const mocks = vi.hoisted(() => ({
  dispatchToAllMarkdownEditorViews: vi.fn()
}));

vi.mock('../codemirror/markdown-editor-views.ts', () => ({
  dispatchToAllMarkdownEditorViews: mocks.dispatchToAllMarkdownEditorViews
}));

interface Settings {
  readonly color: string;
}

describe('SettingsFacetComponent', () => {
  const facet = createSettingsFacet<Settings>({ color: 'default' });
  let registered: Extension[];
  let registrar: EditorExtensionRegistrar;

  beforeEach(() => {
    mocks.dispatchToAllMarkdownEditorViews.mockClear();
    registered = [];
    registrar = {
      registerEditorExtension: vi.fn((extension: Extension) => {
        registered.push(extension);
      })
    };
  });

  it('should provide the initial settings and swap them in open and future editors', () => {
    const component = new SettingsFacetComponent<Settings>({
      app: strictProxy<AppOriginal>({}),
      editorExtensionRegistrar: registrar,
      facet,
      settings: { color: 'red' }
    });
    component.load();
    const openEditor = EditorState.create({ extensions: registered });

    expect(openEditor.facet(facet)).toEqual({ color: 'red' });
    expect(component.settings).toEqual({ color: 'red' });

    const newSettings = { color: 'blue' };
    component.setSettings(newSettings);

    expect(component.settings).toBe(newSettings);
    const specs = mocks.dispatchToAllMarkdownEditorViews.mock.calls.map((call) => castTo<TransactionSpec>(call[1]));
    expect(openEditor.update(...specs).state.facet(facet)).toEqual({ color: 'blue' });
    expect(EditorState.create({ extensions: registered }).facet(facet)).toEqual({ color: 'blue' });
  });
});
