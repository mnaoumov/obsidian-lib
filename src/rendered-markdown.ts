/**
 * @file
 *
 * The parts of a Reading view's behavior that Obsidian keeps inside its preview renderer, ported for
 * markdown rendered anywhere else with `MarkdownRenderer.render`.
 *
 * `MarkdownPreviewRenderer.registerDomEvents` covers internal and external links, tags, drags, context
 * menus and the footnote HOVER. Three things it does not cover, read from Obsidian `1.15.0`: the footnote
 * CLICK (`onFootnoteLinkClick`), and the heading and list FOLDING, whose indicators the renderer only adds
 * in its own `onRender` and whose clicks only it handles. Without these, a footnote click in standalone
 * rendered markdown falls through to the browser's hash navigation, and nothing can be folded.
 */

import {
  invokeAsyncSafely,
  sleep
} from '@mnaoumov/typescript-lib/async';
import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { setIcon } from 'obsidian';

import { CssClass } from './css-class.ts';

/**
 * How long a footnote's target stays highlighted after a click took it there, as in Obsidian's own
 * `highlightEl`.
 */
const FLASH_DURATION_IN_MILLISECONDS = 3000;

const FOLD_ICON = 'right-triangle';

const HEADING_TAG_NAMES = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/**
 * Parameters for {@link registerFoldHandlers}.
 */
export interface RegisterFoldHandlersParams {
  /**
   * The element markdown was rendered into, the one `MarkdownRenderer.render` was handed. Its direct
   * children are the rendered blocks a folded heading hides.
   */
  readonly el: HTMLElement;

  /**
   * Whether headings can be folded.
   *
   * @default `true`
   */
  readonly shouldFoldHeadings?: boolean;

  /**
   * Whether list items with a nested list can be folded.
   *
   * @default `true`
   */
  readonly shouldFoldLists?: boolean;
}

/**
 * Parameters for {@link registerFootnoteLinkHandler}.
 */
export interface RegisterFootnoteLinkHandlerParams {
  /**
   * The element markdown was rendered into.
   */
  readonly el: HTMLElement;
}

/**
 * Whether an element belongs to the markdown rendered into `rootEl`, rather than to a Reading view or a
 * Bases view nested inside it (an embed), which handles its own events. A port of Obsidian's static
 * `MarkdownPreviewRenderer.belongsToMe`, which `obsidian-typings` does not declare.
 *
 * @param element - The element an event landed on.
 * @param rootEl - The element markdown was rendered into.
 * @returns Whether the element is `rootEl` itself or sits inside it with no nested view in between.
 */
export function isOwnedByRenderedMarkdown(element: Element, rootEl: HTMLElement): boolean {
  let current: Element | null = element;
  while (current) {
    if (current === rootEl) {
      return true;
    }
    if (current.hasClass('markdown-preview-view') || current.hasClass('bases-view')) {
      return false;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Makes the headings and the nested lists of rendered markdown foldable, the way they are in a Reading
 * view: it adds Obsidian's own collapse indicators and handles their clicks.
 *
 * A folded heading hides every block after it up to the next heading of the same or a higher level;
 * unfolding it shows them again, except those a folded heading among them still hides. A folded list
 * item hides its nested lists. Call it again after the element is re-rendered: blocks that already have
 * an indicator are left alone, and the click handler is registered only once per element.
 *
 * @param params - The parameters.
 */
export function registerFoldHandlers(params: RegisterFoldHandlersParams): void {
  const {
    el,
    shouldFoldHeadings = true,
    shouldFoldLists = true
  } = params;

  el.addClass(CssClass.LibraryName, CssClass.FoldableMarkdown);

  if (shouldFoldHeadings) {
    for (const block of getBlocks(el)) {
      const headingEl = getBlockHeading(block);
      if (headingEl && !headingEl.querySelector(':scope > .heading-collapse-indicator')) {
        addIndicator(headingEl, 'heading-collapse-indicator');
      }
    }
  }

  if (shouldFoldLists) {
    for (const listItemEl of el.findAll('li')) {
      if (
        isOwnedByRenderedMarkdown(listItemEl, el)
        && listItemEl.querySelector(':scope > ul, :scope > ol')
        && !listItemEl.querySelector(':scope > .list-collapse-indicator')
      ) {
        addIndicator(listItemEl, 'list-collapse-indicator');
      }
    }
  }

  if (registeredFoldEls.has(el)) {
    return;
  }
  registeredFoldEls.add(el);

  el.on('click', '.heading-collapse-indicator', (clickEvent, indicatorEl) => {
    handleIndicatorClick(clickEvent, indicatorEl, el, (headingEl) => {
      if (!isHeading(headingEl)) {
        return;
      }
      toggleCollapsed(headingEl, !headingEl.hasClass('is-collapsed'));
      updateFoldedBlocks(el);
      el.win.getSelection()?.removeAllRanges();
    });
  });

  el.on('click', 'li > .list-collapse-indicator', (clickEvent, indicatorEl) => {
    handleIndicatorClick(clickEvent, indicatorEl, el, (listItemEl) => {
      toggleCollapsed(listItemEl, !listItemEl.hasClass('is-collapsed'));
    });
  });
}

/**
 * Makes a footnote link in rendered markdown act as it does in a Reading view: a click scrolls to the
 * footnote, or back to its reference, and flashes it, instead of navigating to the link's `#` hash.
 *
 * Registered by `registerLinkHandlers`, which is the usual way in; call it directly only for an element
 * whose other links are handled some other way.
 *
 * @param params - The parameters.
 */
export function registerFootnoteLinkHandler(params: RegisterFootnoteLinkHandlerParams): void {
  const { el } = params;
  el.on('click', 'a.footnote-link', (clickEvent, linkEl) => {
    if (clickEvent.button !== 0 || !isOwnedByRenderedMarkdown(linkEl, el)) {
      return;
    }
    clickEvent.preventDefault();

    const href = linkEl.getAttr('href');
    if (!href?.startsWith('#')) {
      return;
    }
    const footnoteId = href.slice(1);
    const targetEl = el.findAll('[data-footnote-id]').find((candidateEl) => candidateEl.getAttr('data-footnote-id') === footnoteId);
    if (!targetEl) {
      return;
    }

    unfoldAncestors(targetEl, el);
    targetEl.scrollIntoView({ block: 'center' });
    flash(targetEl, el);
  });
}

const registeredFoldEls = new WeakSet<HTMLElement>();

function addIndicator(parentEl: HTMLElement, cls: string): void {
  const indicatorEl = parentEl.createSpan({
    cls: [cls, 'collapse-indicator', 'collapse-icon'],
    prepend: true
  });
  setIcon(indicatorEl, FOLD_ICON);
}

function flash(targetEl: HTMLElement, rootEl: HTMLElement): void {
  for (const flashingEl of rootEl.findAll('.is-flashing')) {
    flashingEl.removeClass('is-flashing');
  }
  targetEl.addClass('is-flashing');
  invokeAsyncSafely(async () => {
    await sleep({ milliseconds: FLASH_DURATION_IN_MILLISECONDS });
    targetEl.removeClass('is-flashing');
  });
}

function getBlockHeading(block: Element): HTMLElement | null {
  if (isHeading(block)) {
    return block;
  }
  const firstChild = block.firstElementChild;
  return firstChild && isHeading(firstChild) ? firstChild : null;
}

function getBlockHeadingLevel(block: Element): null | number {
  const headingEl = getBlockHeading(block);
  return headingEl ? getHeadingLevel(headingEl) : null;
}

function getBlocks(rootEl: HTMLElement): HTMLElement[] {
  return rootEl.findAll(':scope > *');
}

function getHeadingLevel(headingEl: HTMLElement): number {
  return Number(headingEl.tagName.slice(1));
}

function handleIndicatorClick(
  clickEvent: MouseEvent,
  indicatorEl: HTMLElement,
  rootEl: HTMLElement,
  toggle: (parentEl: Element) => void
): void {
  if (clickEvent.button !== 0 || clickEvent.defaultPrevented || !isOwnedByRenderedMarkdown(indicatorEl, rootEl)) {
    return;
  }
  clickEvent.preventDefault();
  // The delegated click matched the indicator inside `rootEl`, so it has a parent.
  toggle(ensureNonNullable(indicatorEl.parentElement));
}

function isHeading(element: Element): element is HTMLElement {
  return HEADING_TAG_NAMES.has(element.tagName);
}

function toggleCollapsed(parentEl: Element, isCollapsed: boolean): void {
  parentEl.toggleClass('is-collapsed', isCollapsed);
  parentEl.querySelector<HTMLElement>(':scope > .collapse-icon')?.toggleClass('is-collapsed', isCollapsed);
}

/**
 * Unfolds whatever hides `targetEl`: every folded list item around it, and every folded heading it sits
 * under, so a footnote click never scrolls to an element nobody can see.
 *
 * @param targetEl - The element to reveal.
 * @param rootEl - The element markdown was rendered into.
 */
function unfoldAncestors(targetEl: HTMLElement, rootEl: HTMLElement): void {
  let targetBlock: Element = targetEl;
  for (;;) {
    if (targetBlock.tagName === 'LI' && targetBlock.hasClass('is-collapsed')) {
      toggleCollapsed(targetBlock, false);
    }
    // `targetEl` was found inside `rootEl`, so the walk reaches it before running out of parents.
    const parentEl = ensureNonNullable(targetBlock.parentElement);
    if (parentEl === rootEl) {
      break;
    }
    targetBlock = parentEl;
  }

  // The headings a block sits under are the nearest earlier heading of each strictly lower level.
  const blocks: Element[] = getBlocks(rootEl);
  let level = getBlockHeadingLevel(targetBlock) ?? Infinity;
  let hasUnfolded = false;
  for (let index = blocks.indexOf(targetBlock) - 1; index >= 0; index--) {
    const headingEl = getBlockHeading(ensureNonNullable(blocks[index]));
    if (!headingEl || getHeadingLevel(headingEl) >= level) {
      continue;
    }
    level = getHeadingLevel(headingEl);
    if (!headingEl.hasClass('is-collapsed')) {
      continue;
    }

    toggleCollapsed(headingEl, false);
    hasUnfolded = true;
  }

  if (hasUnfolded) {
    updateFoldedBlocks(rootEl);
  }
}

/**
 * Shows or hides every block of `rootEl` after the folded headings, so a block is hidden exactly when a
 * folded heading above it has no heading of the same or a higher level in between.
 *
 * @param rootEl - The element markdown was rendered into.
 */
function updateFoldedBlocks(rootEl: HTMLElement): void {
  let foldedLevel: null | number = null;
  for (const block of getBlocks(rootEl)) {
    const headingEl = getBlockHeading(block);
    const headingLevel = headingEl ? getHeadingLevel(headingEl) : null;
    if (foldedLevel !== null && headingLevel !== null && headingLevel <= foldedLevel) {
      foldedLevel = null;
    }
    const isShown = foldedLevel === null;
    block.toggle(isShown);
    if (isShown && headingEl?.hasClass('is-collapsed')) {
      foldedLevel = headingLevel;
    }
  }
}
