// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for {@link createInlineTokenWidgetsExtension}.
 */

import type { Extension } from '@codemirror/state';
import type { MarkdownFileInfo as MarkdownFileInfoOriginal } from 'obsidian';

import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  editorInfoField,
  editorLivePreviewField
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  CreateInlineTokenWidgetsExtensionParams,
  InlineTokenRenderParams
} from './inline-token-widgets.ts';

import {
  createInlineTokenWidgetsExtension,
  execAll,
  toGlobalRegExp
} from './inline-token-widgets.ts';
import { createSettingsFacet } from './settings-facet.ts';

interface CreateViewParams {
  readonly doc: string;
  readonly extensions?: Extension[];
  readonly isLivePreview?: boolean;
  readonly selection?: number;
  readonly widgetParams?: Partial<CreateInlineTokenWidgetsExtensionParams>;
}

describe('createInlineTokenWidgetsExtension', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy();
    }
  });

  function renderName({ containerEl, match }: InlineTokenRenderParams): void {
    containerEl.textContent = `<${match[1] ?? ''}>`;
  }

  function createView(params: CreateViewParams): EditorView {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: params.doc,
        extensions: [
          editorLivePreviewField.init(() => params.isLivePreview ?? true),
          createInlineTokenWidgetsExtension({ regExp: /:(?<name>\w+):/, render: renderName, ...params.widgetParams }),
          ...params.extensions ?? []
        ],
        selection: EditorSelection.cursor(params.selection ?? 0)
      })
    });
    views.push(view);
    return view;
  }

  function widgetTexts(view: EditorView): string[] {
    return Array.from(view.contentDOM.querySelectorAll('.inline-token'), (el) => el.textContent);
  }

  it('should replace every match with a widget', () => {
    const view = createView({ doc: 'a :one: b :two:\n:three:', selection: 1 });
    expect(widgetTexts(view)).toEqual(['<one>', '<two>', '<three>']);
    expect(view.contentDOM.querySelector('.inline-token')?.classList.contains('obsidian-lib')).toBe(true);
  });

  it('should reveal a token while the cursor touches it, and hide it again once the cursor leaves', () => {
    const view = createView({ doc: ':one: :two:', selection: 0 });
    expect(widgetTexts(view)).toEqual(['<two>']);

    view.dispatch({ selection: EditorSelection.cursor(6) });
    expect(widgetTexts(view)).toEqual(['<one>']);
  });

  it('should keep a token rendered under the cursor when revealing is off', () => {
    const view = createView({ doc: ':one:', selection: 0, widgetParams: { shouldRevealOnSelection: false } });
    expect(widgetTexts(view)).toEqual(['<one>']);
  });

  it('should render nothing outside Live Preview', () => {
    const view = createView({ doc: 'x :one:', isLivePreview: false });
    expect(widgetTexts(view)).toEqual([]);
  });

  it('should skip a match shouldDecorate rejects', () => {
    const view = createView({
      doc: 'x :one: :two:',
      widgetParams: { shouldDecorate: ({ match }) => match[1] !== 'one' }
    });
    expect(widgetTexts(view)).toEqual(['<two>']);
  });

  it('should re-render on a document change', () => {
    const view = createView({ doc: 'x :one:' });
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' :two:' } });
    expect(widgetTexts(view)).toEqual(['<one>', '<two>']);
  });

  it('should hand the render the source path and the editor state', () => {
    const facet = createSettingsFacet('default');
    const render = vi.fn(({ containerEl, state }: InlineTokenRenderParams) => {
      containerEl.textContent = state?.facet(facet) ?? '';
    });
    const view = createView({
      doc: 'x :one:',
      extensions: [
        editorInfoField.init(() => castTo<MarkdownFileInfoOriginal>({ file: { path: 'folder/note.md' } }))
      ],
      widgetParams: { render }
    });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: 'folder/note.md' }));
    expect(widgetTexts(view)).toEqual(['default']);
  });

  it('should rebuild with the new settings when a compartment holding the facet is reconfigured', () => {
    const facet = createSettingsFacet('default');
    const compartment = new Compartment();
    const view = createView({
      doc: 'x :one:',
      extensions: [compartment.of(facet.of('first'))],
      widgetParams: {
        render({ containerEl, state }): void {
          containerEl.textContent = state?.facet(facet) ?? '';
        }
      }
    });
    expect(widgetTexts(view)).toEqual(['first']);

    view.dispatch({ effects: compartment.reconfigure(facet.of('second')) });
    expect(widgetTexts(view)).toEqual(['second']);
  });

  it('should show the widgets in an editor without a Live Preview field', () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: 'x :one:',
        extensions: [createInlineTokenWidgetsExtension({ regExp: /:(?<name>\w+):/, render: renderName })]
      })
    });
    views.push(view);
    expect(widgetTexts(view)).toEqual(['<one>']);
  });

  it('should not rebuild on a transaction that changes nothing the widgets depend on', () => {
    const render = vi.fn(renderName);
    const view = createView({ doc: 'x :one:', widgetParams: { render } });
    render.mockClear();
    view.dispatch({ annotations: Transaction.userEvent.of('test') });
    expect(render).not.toHaveBeenCalled();
    expect(widgetTexts(view)).toEqual(['<one>']);
  });
  it('should use an empty source path when the editor has no file', () => {
    const render = vi.fn(renderName);
    createView({ doc: 'x :one:', widgetParams: { render } });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: '' }));
  });
});

describe('execAll', () => {
  it('should list every non-empty match and step over empty ones', () => {
    expect(execAll(/a*/g, 'b aa b').map((match) => [match.index, match[0]])).toEqual([[2, 'aa']]);
  });
});

describe('toGlobalRegExp', () => {
  it('should add the g flag to a copy', () => {
    const regExp = /x/i;
    const globalRegExp = toGlobalRegExp(regExp);
    expect(globalRegExp).not.toBe(regExp);
    expect(globalRegExp.flags).toBe('gi');
  });

  it('should copy a global regular expression too', () => {
    const regExp = /x/g;
    expect(toGlobalRegExp(regExp)).not.toBe(regExp);
    expect(toGlobalRegExp(regExp).flags).toBe('g');
  });
});
