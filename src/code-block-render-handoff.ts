/**
 * @file
 *
 * Carries focus and plugin state from a code block to its next render.
 *
 * Obsidian renders a code block again whenever its source text changes: Reading view re-renders the section and Live
 * Preview replaces the widget. So a block that edits its own source (a counter, a checkbox, a settings form) loses the
 * element the user was interacting with, its focus and whatever the plugin kept on it. The element itself cannot be
 * kept without patching Obsidian's renderers, so the write records a handoff instead, and the processor rendering the
 * new source claims it: it gets back the state the write passed and can put the focus back on the same element.
 *
 * The handoff is matched by source path, language and the new block content, and it lives for
 * {@link CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS}. The first render to claim it consumes it, so when the
 * note is open in two panes only one of the new renders gets it.
 */

import type { MarkdownPostProcessorContext } from 'obsidian';

import { requestAnimationFrameAsync } from '@mnaoumov/typescript-lib/async';
import {
  getMandatoryNamedGroup,
  getOptionalNamedGroup
} from '@mnaoumov/typescript-lib/reg-exp';
import { ensureLfEndings } from '@mnaoumov/typescript-lib/string';

import { createCodeBlockRegExp } from './code-block-reg-exp.ts';
import { getObsidianLibState } from './obsidian-lib-state.ts';

/**
 * How long a recorded handoff waits for the render that claims it.
 */
export const CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS = 10_000;

const HANDOFF_STATE_KEY = 'codeBlockRenderHandoffV1';
const MAX_FRAMES_TO_WAIT_FOR_CONNECTION = 60;

/**
 * Options for {@link claimCodeBlockRenderHandoff}.
 */
export interface ClaimCodeBlockRenderHandoffParams {
  /**
   * The {@link MarkdownPostProcessorContext} the processor received.
   */
  readonly context: MarkdownPostProcessorContext;

  /**
   * The element the processor renders into.
   */
  readonly el: HTMLElement;

  /**
   * The source the processor received.
   */
  readonly source: string;
}

/**
 * Where the focus was inside a rendered code block.
 */
export interface CodeBlockFocusSnapshot {
  /**
   * The child indices leading from the code block element to the focused element.
   */
  readonly childIndexPath: readonly number[];

  /**
   * The text selection of a focused input or text area.
   */
  readonly selection: null | TextSelection;
}

/**
 * A handoff claimed by the render of a code block whose source a write just changed.
 */
export interface CodeBlockRenderHandoff {
  /**
   * Whether the write recorded a focused element to restore.
   */
  readonly hasFocus: boolean;

  /**
   * Puts the focus back on the element at the same position inside the new render, with the same text selection.
   *
   * Call it once the processor has rendered the block. It waits for the element to be attached to a document.
   *
   * @returns Whether an element was focused.
   */
  readonly restoreFocus: () => Promise<boolean>;

  /**
   * The state passed to the write, or `undefined` when none was.
   */
  readonly state: unknown;
}

/**
 * Options for {@link recordCodeBlockRenderHandoff}.
 */
export interface RecordCodeBlockRenderHandoffParams {
  /**
   * The focus captured from the old render with {@link captureCodeBlockFocus}.
   */
  readonly focus: CodeBlockFocusSnapshot | null;

  /**
   * The code block written to the note, fences included.
   */
  readonly newCodeBlock: string;

  /**
   * The path of the note the code block is in.
   */
  readonly sourcePath: string;

  /**
   * The state to pass to the next render.
   */
  readonly state: unknown;
}

interface HandoffEntry {
  readonly expiresAt: number;
  readonly focus: CodeBlockFocusSnapshot | null;
  readonly state: unknown;
}

interface TextSelection {
  readonly direction: 'backward' | 'forward' | 'none';
  readonly end: number;
  readonly start: number;
}

interface TextSelectionElement extends HTMLElement {
  readonly selectionDirection: 'backward' | 'forward' | 'none' | null;
  readonly selectionEnd: null | number;
  readonly selectionStart: null | number;
  readonly setSelectionRange: (start: number, end: number, direction?: 'backward' | 'forward' | 'none') => void;
}

/**
 * Captures where the focus is inside a rendered code block.
 *
 * @param el - The code block element.
 * @returns The snapshot, or `null` when the focus is not inside the element.
 */
export function captureCodeBlockFocus(el: HTMLElement): CodeBlockFocusSnapshot | null {
  const activeElement = el.ownerDocument.activeElement;
  if (!activeElement || activeElement === el || !el.contains(activeElement)) {
    return null;
  }

  const childIndexPath: number[] = [];
  let current: Element | null = activeElement;
  while (current && current !== el) {
    let index = 0;
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      index++;
    }
    childIndexPath.unshift(index);
    current = current.parentElement;
  }

  return {
    childIndexPath,
    selection: getTextSelection(activeElement)
  };
}

/**
 * Claims the handoff a write recorded for the code block being rendered.
 *
 * Call it from a code block processor. It returns `null` when no write is waiting for this render.
 *
 * @param params - The parameters for the function.
 * @returns The handoff, or `null`.
 */
export function claimCodeBlockRenderHandoff(params: ClaimCodeBlockRenderHandoffParams): CodeBlockRenderHandoff | null {
  const { context, el, source } = params;
  const entries = getHandoffEntries();
  pruneExpiredEntries(entries);

  const key = getHandoffKey(context.sourcePath, getLanguageFromElement(el), ensureLfEndings(source));
  const queue = entries.get(key);
  const entry = queue?.shift();
  if (!queue || !entry) {
    return null;
  }

  if (queue.length === 0) {
    entries.delete(key);
  }

  return {
    hasFocus: entry.focus !== null,
    async restoreFocus(): Promise<boolean> {
      return entry.focus ? (await restoreCodeBlockFocus(el, entry.focus)) : false;
    },
    state: entry.state
  };
}

/**
 * Records a handoff for the next render of a code block a write is about to change.
 *
 * @param params - The parameters for the function.
 * @returns Whether a handoff was recorded: `false` when the new text is not exactly one code block.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- A verb names the action; the boolean only reports whether it took place.
export function recordCodeBlockRenderHandoff(params: RecordCodeBlockRenderHandoffParams): boolean {
  const { focus, newCodeBlock, sourcePath, state } = params;
  const matches = [...ensureLfEndings(newCodeBlock).matchAll(createCodeBlockRegExp())];
  const match = matches[0];
  if (matches.length !== 1 || !match) {
    return false;
  }

  const linePrefix = getMandatoryNamedGroup(match, 'LinePrefix');
  const language = getMandatoryNamedGroup(match, 'CodeBlockLanguage');
  const content = (getOptionalNamedGroup(match, 'CodeBlockContent') ?? '').split('\n').map((line) => line.slice(linePrefix.length)).join('\n');

  const entries = getHandoffEntries();
  pruneExpiredEntries(entries);
  const key = getHandoffKey(sourcePath, language, content);
  let queue = entries.get(key);
  if (!queue) {
    queue = [];
    entries.set(key, queue);
  }
  queue.push({
    expiresAt: Date.now() + CODE_BLOCK_RENDER_HANDOFF_LIFETIME_IN_MILLISECONDS,
    focus,
    state
  });
  return true;
}

/**
 * Puts the focus back on the element a {@link CodeBlockFocusSnapshot} describes.
 *
 * @param el - The new code block element.
 * @param focus - The snapshot captured from the old render.
 * @returns Whether an element was focused.
 */
// eslint-disable-next-line unicorn/consistent-boolean-name -- A verb names the action; the boolean only reports whether it took place.
export async function restoreCodeBlockFocus(el: HTMLElement, focus: CodeBlockFocusSnapshot): Promise<boolean> {
  for (let frame = 0; !el.isConnected && frame < MAX_FRAMES_TO_WAIT_FOR_CONNECTION; frame++) {
    await requestAnimationFrameAsync();
  }

  if (!el.isConnected) {
    return false;
  }

  let target: Element | undefined = el;
  for (const index of focus.childIndexPath) {
    target = target.children[index];
    if (!target) {
      return false;
    }
  }

  if (!isHTMLElementLike(target)) {
    return false;
  }

  target.focus({ preventScroll: true });
  if (el.ownerDocument.activeElement !== target) {
    return false;
  }

  if (focus.selection && isTextSelectionElement(target)) {
    target.setSelectionRange(focus.selection.start, focus.selection.end, focus.selection.direction);
  }

  return true;
}

function getHandoffEntries(): Map<string, HandoffEntry[]> {
  return getObsidianLibState(HANDOFF_STATE_KEY, new Map<string, HandoffEntry[]>()).value;
}

function getHandoffKey(sourcePath: string, language: string, content: string): string {
  return JSON.stringify([sourcePath, language, content]);
}

function getLanguageFromElement(element: HTMLElement): string {
  const BLOCK_LANGUAGE_PREFIX = 'block-language-';
  return [...element.classList].find((cls) => cls.startsWith(BLOCK_LANGUAGE_PREFIX))?.slice(BLOCK_LANGUAGE_PREFIX.length) ?? '';
}

function getTextSelection(element: Element): null | TextSelection {
  if (!isTextSelectionElement(element)) {
    return null;
  }

  // An input type without a text selection (a checkbox, a number field) reads `null` here.
  if (element.selectionStart === null || element.selectionEnd === null) {
    return null;
  }

  return {
    direction: element.selectionDirection ?? 'none',
    end: element.selectionEnd,
    start: element.selectionStart
  };
}

function isHTMLElementLike(element: Element): element is HTMLElement {
  return typeof (element as Partial<HTMLElement>).focus === 'function';
}

function isTextSelectionElement(element: Element): element is TextSelectionElement {
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

function pruneExpiredEntries(entries: Map<string, HandoffEntry[]>): void {
  const now = Date.now();
  for (const [key, queue] of entries) {
    const liveEntries = queue.filter((entry) => entry.expiresAt > now);
    if (liveEntries.length === 0) {
      entries.delete(key);
    } else if (liveEntries.length !== queue.length) {
      entries.set(key, liveEntries);
    }
  }
}
