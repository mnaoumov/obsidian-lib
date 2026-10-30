// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for {@link getAllMarkdownEditorViews} and {@link dispatchToAllMarkdownEditorViews}.
 */

import type { EditorView } from '@codemirror/view';
import type {
  App as AppOriginal,
  View as ViewOriginal,
  WorkspaceLeaf as WorkspaceLeafOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  App,
  MarkdownView,
  WorkspaceLeaf
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  dispatchToAllMarkdownEditorViews,
  getAllMarkdownEditorViews
} from './markdown-editor-views.ts';

describe('markdown-editor-views', () => {
  let app: AppOriginal;
  let mockApp: App;

  beforeEach(() => {
    mockApp = App.createConfigured__({});
    app = mockApp.asOriginalType__();
  });

  describe('getAllMarkdownEditorViews', () => {
    it('should return the editor of every Markdown view and skip other views', () => {
      const first = createEditorView();
      const second = createEditorView();
      stubLeaves(leafOf(createMarkdownView(first)), leafOf(strictProxy<ViewOriginal>({})), leafOf(createMarkdownView(second)));

      expect(getAllMarkdownEditorViews(app)).toEqual([first, second]);
    });

    it('should return an empty array when no Markdown view is open', () => {
      stubLeaves();

      expect(getAllMarkdownEditorViews(app)).toEqual([]);
    });
  });

  describe('dispatchToAllMarkdownEditorViews', () => {
    it('should dispatch the same specs to every editor', () => {
      const first = createEditorView();
      const second = createEditorView();
      stubLeaves(leafOf(createMarkdownView(first)), leafOf(createMarkdownView(second)));
      const firstSpec = { scrollIntoView: true };
      const secondSpec = { userEvent: 'test' };

      dispatchToAllMarkdownEditorViews(app, firstSpec, secondSpec);

      expect(first.dispatch).toHaveBeenCalledWith(firstSpec, secondSpec);
      expect(second.dispatch).toHaveBeenCalledWith(firstSpec, secondSpec);
    });
  });

  function createEditorView(): EditorView {
    return strictProxy<EditorView>({ dispatch: vi.fn() });
  }

  function createMarkdownView(editorView: EditorView): ViewOriginal {
    const mockLeaf = WorkspaceLeaf.create2__(mockApp);
    const view = MarkdownView.create2__(mockLeaf).asOriginalType7__();
    Object.defineProperty(view, 'editor', { value: castTo<typeof view.editor>({ cm: editorView }) });
    return view;
  }

  function leafOf(view: ViewOriginal): WorkspaceLeafOriginal {
    return strictProxy<WorkspaceLeafOriginal>({ view });
  }

  function stubLeaves(...leaves: WorkspaceLeafOriginal[]): void {
    vi.spyOn(app.workspace, 'getLeavesOfType').mockReturnValue(leaves);
  }
});
