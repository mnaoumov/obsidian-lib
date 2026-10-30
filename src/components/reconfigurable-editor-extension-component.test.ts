/**
 * @file
 *
 * Tests for {@link ReconfigurableEditorExtensionComponent}.
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

import { ReconfigurableEditorExtensionComponent } from './reconfigurable-editor-extension-component.ts';

const mocks = vi.hoisted(() => ({
  dispatchToAllMarkdownEditorViews: vi.fn()
}));

vi.mock('../codemirror/markdown-editor-views.ts', () => ({
  dispatchToAllMarkdownEditorViews: mocks.dispatchToAllMarkdownEditorViews
}));

const tabSize = EditorState.tabSize;

describe('ReconfigurableEditorExtensionComponent', () => {
  let app: AppOriginal;
  let registered: Extension[];
  let registrar: EditorExtensionRegistrar;

  beforeEach(() => {
    mocks.dispatchToAllMarkdownEditorViews.mockClear();
    app = strictProxy<AppOriginal>({});
    registered = [];
    registrar = {
      registerEditorExtension: vi.fn((extension: Extension) => {
        registered.push(extension);
      })
    };
  });

  function createComponent(extension?: Extension): ReconfigurableEditorExtensionComponent {
    return new ReconfigurableEditorExtensionComponent({
      app,
      editorExtensionRegistrar: registrar,
      ...(extension !== undefined && { extension })
    });
  }

  function tabSizeOfNewEditor(): number {
    return EditorState.create({ extensions: registered }).facet(tabSize);
  }

  function dispatchedSpecs(): TransactionSpec[] {
    return mocks.dispatchToAllMarkdownEditorViews.mock.calls.map((call) => castTo<TransactionSpec>(call[1]));
  }

  it('should register the initial extension once on load, wrapped in its compartment', () => {
    const component = createComponent(tabSize.of(3));

    component.load();

    expect(registrar.registerEditorExtension).toHaveBeenCalledTimes(1);
    expect(tabSizeOfNewEditor()).toBe(3);
    expect(mocks.dispatchToAllMarkdownEditorViews).not.toHaveBeenCalled();
  });

  it('should default to an empty extension', () => {
    const component = createComponent();

    component.load();

    expect(component.extension).toEqual([]);
    expect(tabSizeOfNewEditor()).toBe(4);
  });

  it('should only record the extension when reconfigured before load', () => {
    const component = createComponent();

    const extension = tabSize.of(2);
    component.reconfigure(extension);

    expect(component.extension).toBe(extension);
    expect(mocks.dispatchToAllMarkdownEditorViews).not.toHaveBeenCalled();

    component.load();

    expect(tabSizeOfNewEditor()).toBe(2);
  });

  it('should swap the extension in open and future editors when reconfigured', () => {
    const component = createComponent(tabSize.of(3));
    component.load();
    const openEditor = EditorState.create({ extensions: registered });

    component.reconfigure(tabSize.of(8));

    expect(mocks.dispatchToAllMarkdownEditorViews).toHaveBeenCalledWith(app, expect.anything());
    const reconfiguredEditor = openEditor.update(...dispatchedSpecs()).state;
    expect(reconfiguredEditor.facet(tabSize)).toBe(8);
    expect(tabSizeOfNewEditor()).toBe(8);
    expect(registrar.registerEditorExtension).toHaveBeenCalledTimes(1);
  });

  it('should empty the extension on unload and restore it on a later load without registering again', () => {
    const component = createComponent(tabSize.of(3));
    component.load();

    component.unload();

    expect(tabSizeOfNewEditor()).toBe(4);
    expect(dispatchedSpecs()).toHaveLength(1);

    component.reconfigure(tabSize.of(6));

    expect(dispatchedSpecs()).toHaveLength(1);
    expect(tabSizeOfNewEditor()).toBe(4);

    component.load();

    expect(tabSizeOfNewEditor()).toBe(6);
    expect(dispatchedSpecs()).toHaveLength(2);
    expect(registrar.registerEditorExtension).toHaveBeenCalledTimes(1);
  });
});
