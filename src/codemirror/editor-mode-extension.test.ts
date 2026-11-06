// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for {@link createLivePreviewOnlyExtension}, {@link createSourceModeOnlyExtension} and {@link isLivePreview}.
 *
 * The mock `editorLivePreviewField` always reads `false`, so a test switches the mode the one way the mock allows:
 * Source mode is the field present, and Live Preview is the field absent, which the helpers read as Live Preview. A
 * compartment holding the field moves between the two in a transaction with effects, the shape of Obsidian's own
 * mode switch.
 */

import type { Extension } from '@codemirror/state';

import {
  Compartment,
  EditorState
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { editorLivePreviewField } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import {
  createLivePreviewOnlyExtension,
  createSourceModeOnlyExtension,
  isLivePreview
} from './editor-mode-extension.ts';

const CLASS_NAME = 'mode-scoped-test';

interface CreateViewParams {
  readonly isLivePreview: boolean;
  readonly scope: (extension: Extension) => Extension;
}

interface TestView {
  readonly modeCompartment: Compartment;
  readonly view: EditorView;
}

describe('editor mode extensions', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy();
    }
  });

  function modeExtension(isLivePreviewMode: boolean): Extension {
    return isLivePreviewMode ? [] : editorLivePreviewField.init(() => false);
  }

  function createView(params: CreateViewParams): TestView {
    const modeCompartment = new Compartment();
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        extensions: [
          modeCompartment.of(modeExtension(params.isLivePreview)),
          params.scope(EditorView.editorAttributes.of({ class: CLASS_NAME }))
        ]
      })
    });
    views.push(view);
    return { modeCompartment, view };
  }

  function switchMode(testView: TestView, isLivePreviewMode: boolean): void {
    testView.view.dispatch({ effects: testView.modeCompartment.reconfigure(modeExtension(isLivePreviewMode)) });
  }

  function hasClass(testView: TestView): boolean {
    return testView.view.dom.classList.contains(CLASS_NAME);
  }

  async function flushMicrotasks(): Promise<void> {
    await noopAsync();
  }

  describe('isLivePreview', () => {
    it('should read Source mode from the field', () => {
      expect(isLivePreview(EditorState.create({ extensions: modeExtension(false) }))).toBe(false);
    });

    it('should count a state without the field as Live Preview', () => {
      expect(isLivePreview(EditorState.create())).toBe(true);
    });
  });

  describe('createLivePreviewOnlyExtension', () => {
    it('should be active in a Live Preview editor', () => {
      expect(hasClass(createView({ isLivePreview: true, scope: createLivePreviewOnlyExtension }))).toBe(true);
    });

    it('should switch off in the transaction that switches to Source mode, and back on again', () => {
      const testView = createView({ isLivePreview: true, scope: createLivePreviewOnlyExtension });

      switchMode(testView, false);
      expect(hasClass(testView)).toBe(false);

      switchMode(testView, true);
      expect(hasClass(testView)).toBe(true);
    });

    it('should switch off before the first paint of an editor created in Source mode', async () => {
      const testView = createView({ isLivePreview: false, scope: createLivePreviewOnlyExtension });
      expect(hasClass(testView)).toBe(true);

      await flushMicrotasks();
      expect(hasClass(testView)).toBe(false);
    });

    it('should leave the extension alone on a transaction without effects', () => {
      const testView = createView({ isLivePreview: true, scope: createLivePreviewOnlyExtension });

      testView.view.dispatch({ changes: { from: 0, insert: 'text' } });
      expect(hasClass(testView)).toBe(true);
    });

    it('should leave the extension alone on an effect that keeps the mode', () => {
      const testView = createView({ isLivePreview: true, scope: createLivePreviewOnlyExtension });

      switchMode(testView, true);
      expect(hasClass(testView)).toBe(true);
    });

    it('should not dispatch to an editor destroyed before the microtask runs', async () => {
      const testView = createView({ isLivePreview: false, scope: createLivePreviewOnlyExtension });
      testView.view.destroy();

      await flushMicrotasks();
      expect(hasClass(testView)).toBe(true);
    });

    it('should not dispatch when the mode was corrected before the microtask runs', async () => {
      const testView = createView({ isLivePreview: false, scope: createLivePreviewOnlyExtension });
      switchMode(testView, true);
      const state = testView.view.state;

      await flushMicrotasks();
      expect(testView.view.state).toBe(state);
      expect(hasClass(testView)).toBe(true);
    });
  });

  describe('createSourceModeOnlyExtension', () => {
    it('should be inactive in a Live Preview editor', async () => {
      const testView = createView({ isLivePreview: true, scope: createSourceModeOnlyExtension });

      await flushMicrotasks();
      expect(hasClass(testView)).toBe(false);
    });

    it('should switch on in Source mode, and off again in Live Preview', () => {
      const testView = createView({ isLivePreview: true, scope: createSourceModeOnlyExtension });

      switchMode(testView, false);
      expect(hasClass(testView)).toBe(true);

      switchMode(testView, true);
      expect(hasClass(testView)).toBe(false);
    });

    it('should switch on before the first paint of an editor created in Source mode', async () => {
      const testView = createView({ isLivePreview: false, scope: createSourceModeOnlyExtension });

      await flushMicrotasks();
      expect(hasClass(testView)).toBe(true);
    });
  });
});
