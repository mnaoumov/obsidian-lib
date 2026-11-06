/**
 * @file
 *
 * Creates an editor extension that replaces every match of a regular expression with a widget in Live Preview, and
 * shows the source again while a selection touches it, the way Obsidian treats its own links and formatting.
 *
 * Only the visible ranges are matched, line by line, so a token never spans two lines. The decorations are rebuilt
 * when the document, the viewport, the selection, the Live Preview mode or the configuration changes; a
 * configuration change is what a `SettingsFacetComponent` dispatches, so a render that reads a settings facet
 * re-runs when the settings do.
 *
 * Outside an Obsidian Markdown editor there is no `editorLivePreviewField`, and the widgets are shown.
 */

import type {
  EditorState,
  Extension,
  Range,
  StateField
} from '@codemirror/state';
import type {
  DecorationSet,
  EditorView,
  PluginValue,
  ViewUpdate
} from '@codemirror/view';
import type { MarkdownFileInfo } from 'obsidian';

import {
  Decoration,
  ViewPlugin,
  WidgetType
} from '@codemirror/view';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { editorInfoField } from 'obsidian';

import { CssClass } from '../css-class.ts';
import { isLivePreview } from './editor-mode-extension.ts';

// Obsidian.d.ts reaches @codemirror/state through its CommonJS declarations and this module through the ES ones, and
// StateField has private members, so the two declarations of one runtime class do not type-check against each other.
const editorInfoStateField = castTo<StateField<MarkdownFileInfo>>(editorInfoField);

/**
 * Parameters for {@link createInlineTokenWidgetsExtension}.
 */
export interface CreateInlineTokenWidgetsExtensionParams {
  /**
   * The regular expression a token matches. The `g` flag is added when missing.
   */
  readonly regExp: RegExp;

  /**
   * Renders a token into the widget's element.
   */
  readonly render: InlineTokenRenderFunction;

  /**
   * Decides whether a match becomes a widget, such as to skip a match inside code. Every match does by default.
   */
  readonly shouldDecorate?: (params: InlineTokenShouldDecorateParams) => boolean;

  /**
   * Whether a token shows its source while a selection, the cursor included, touches it.
   *
   * @default `true`
   */
  readonly shouldRevealOnSelection?: boolean;
}

/**
 * Renders an inline token into its container element.
 *
 * @param params - The render parameters.
 */
export type InlineTokenRenderFunction = (params: InlineTokenRenderParams) => void;

/**
 * Parameters handed to an inline token render function.
 */
export interface InlineTokenRenderParams {
  /**
   * The element to render the token into.
   */
  readonly containerEl: HTMLElement;

  /**
   * The match of the token's regular expression.
   */
  readonly match: RegExpExecArray;

  /**
   * The path of the note the token is in, or an empty string when it is not known.
   */
  readonly sourcePath: string;

  /**
   * The editor state, when the token renders in an editor. Absent in Reading view.
   */
  readonly state?: EditorState;
}

/**
 * Parameters handed to {@link CreateInlineTokenWidgetsExtensionParams.shouldDecorate}.
 */
export interface InlineTokenShouldDecorateParams {
  /**
   * The document position the match starts at.
   */
  readonly from: number;

  /**
   * The match of the token's regular expression.
   */
  readonly match: RegExpExecArray;

  /**
   * The editor state.
   */
  readonly state: EditorState;

  /**
   * The document position the match ends at.
   */
  readonly to: number;
}

interface InlineTokenWidgetParams {
  readonly configVersion: number;
  readonly match: RegExpExecArray;
  readonly render: InlineTokenRenderFunction;
  readonly sourcePath: string;
  readonly state: EditorState;
}

class InlineTokenWidget extends WidgetType {
  private readonly configVersion: number;
  private readonly match: RegExpExecArray;
  private readonly render: InlineTokenRenderFunction;
  private readonly sourcePath: string;
  private readonly state: EditorState;

  public constructor(params: InlineTokenWidgetParams) {
    super();
    this.configVersion = params.configVersion;
    this.match = params.match;
    this.render = params.render;
    this.sourcePath = params.sourcePath;
    this.state = params.state;
  }

  public override eq(other: WidgetType): boolean {
    return other instanceof InlineTokenWidget
      && other.configVersion === this.configVersion
      && other.render === this.render
      && other.sourcePath === this.sourcePath
      && areMatchesEqual(other.match, this.match);
  }

  public override toDOM(view: EditorView): HTMLElement {
    const containerEl = view.dom.ownerDocument.win.createSpan();
    containerEl.classList.add(CssClass.LibraryName, CssClass.InlineToken);
    this.render({
      containerEl,
      match: this.match,
      sourcePath: this.sourcePath,
      state: this.state
    });
    return containerEl;
  }
}

/**
 * Creates an editor extension that replaces every match of a regular expression with a widget in Live Preview.
 *
 * @param params - The extension parameters.
 * @returns The editor extension.
 */
export function createInlineTokenWidgetsExtension(params: CreateInlineTokenWidgetsExtensionParams): Extension {
  const regExp = toGlobalRegExp(params.regExp);
  const shouldRevealOnSelection = params.shouldRevealOnSelection ?? true;

  class InlineTokenWidgetsPluginValue implements PluginValue {
    public decorations: DecorationSet;
    private configVersion = 0;

    /**
     * Builds the decorations of a new editor.
     *
     * @param view - The editor view.
     */
    public constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    /**
     * Rebuilds the decorations when what they depend on changed.
     *
     * @param update - The view update.
     */
    public update(update: ViewUpdate): void {
      const isReconfigured = update.transactions.some((transaction) => transaction.reconfigured);
      if (isReconfigured) {
        this.configVersion++;
      }
      if (
        update.docChanged
        || update.viewportChanged
        || update.selectionSet
        || isReconfigured
        || isLivePreview(update.startState) !== isLivePreview(update.state)
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    private buildDecorations(view: EditorView): DecorationSet {
      const state = view.state;
      if (!isLivePreview(state)) {
        return Decoration.none;
      }

      const sourcePath = state.field(editorInfoStateField, false)?.file?.path ?? '';
      const ranges: Range<Decoration>[] = [];
      let lastLineNumber = 0;

      for (const visibleRange of view.visibleRanges) {
        const firstLineNumber = Math.max(state.doc.lineAt(visibleRange.from).number, lastLineNumber + 1);
        const endLineNumber = state.doc.lineAt(visibleRange.to).number;
        for (let lineNumber = firstLineNumber; lineNumber <= endLineNumber; lineNumber++) {
          const line = state.doc.line(lineNumber);
          for (const match of execAll(regExp, line.text)) {
            const from = line.from + match.index;
            const to = from + match[0].length;
            if (shouldRevealOnSelection && state.selection.ranges.some((range) => range.from <= to && range.to >= from)) {
              continue;
            }
            if (params.shouldDecorate && !params.shouldDecorate({ from, match, state, to })) {
              continue;
            }
            ranges.push(
              Decoration.replace({
                widget: new InlineTokenWidget({ configVersion: this.configVersion, match, render: params.render, sourcePath, state })
              }).range(from, to)
            );
          }
        }
        lastLineNumber = endLineNumber;
      }

      return Decoration.set(ranges);
    }
  }

  return ViewPlugin.fromClass(InlineTokenWidgetsPluginValue, {
    decorations: (value) => value.decorations
  });
}

/**
 * Lists every non-empty match of a global regular expression in a text.
 *
 * @param regExp - The global regular expression.
 * @param text - The text to match.
 * @returns The matches, in order.
 */
export function execAll(regExp: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  regExp.lastIndex = 0;
  for (let match = regExp.exec(text); match !== null; match = regExp.exec(text)) {
    if (match[0] === '') {
      regExp.lastIndex++;
      continue;
    }
    matches.push(match);
  }
  return matches;
}

/**
 * Copies a regular expression with the `g` flag set, so matching never moves the caller's `lastIndex`.
 *
 * @param regExp - The regular expression.
 * @returns A global copy of the regular expression.
 */
export function toGlobalRegExp(regExp: RegExp): RegExp {
  return new RegExp(regExp.source, regExp.global ? regExp.flags : `${regExp.flags}g`);
}

function areMatchesEqual(a: RegExpExecArray, b: RegExpExecArray): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
