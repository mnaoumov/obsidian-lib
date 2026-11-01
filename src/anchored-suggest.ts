/**
 * @file
 *
 * A suggest popover opened at an element or a rectangle, with no input behind it.
 */

import type {
  App,
  Scope
} from 'obsidian';

import { PopoverSuggest } from 'obsidian';

const DEFAULT_LIMIT = 100;

/**
 * Parameters for {@link AnchoredSuggest.openAt}.
 */
export interface AnchoredSuggestOpenAtParams {
  /**
   * The element or the viewport rectangle the popover is placed against. When an element is given, the popover closes
   * once the element leaves the DOM, and a pointer-down on it does not count as an outside click.
   */
  readonly anchor: DOMRectReadOnly | HTMLElement;

  /**
   * The query handed to {@link AnchoredSuggest.getSuggestions}. Defaults to `''`.
   */
  readonly query?: string;
}

/**
 * A suggest popover opened at an anchor, for a picker that has no text input: a toolbar button, a context-menu action,
 * a decoration in the editor.
 *
 * Obsidian's `AbstractInputSuggest` opens only from an input and `EditorSuggest` only from the editor. This one is
 * opened by {@link AnchoredSuggest.openAt} and closes on Escape, on a pointer-down outside it, and when its anchor
 * element leaves the DOM. The keyboard works as in Obsidian's own popovers: arrows move, Enter picks.
 *
 * ```ts
 * class ColorSuggest extends AnchoredSuggest<string> {
 *   protected getSuggestions(): string[] {
 *     return ['red', 'green', 'blue'];
 *   }
 *
 *   public renderSuggestion(color: string, el: HTMLElement): void {
 *     el.setText(color);
 *   }
 *
 *   protected onChooseSuggestion(color: string): void {
 *     console.log(color);
 *   }
 * }
 *
 * await new ColorSuggest(this.app).openAt({ anchor: buttonEl });
 * ```
 *
 * It relies on `PopoverSuggest` members that `obsidian.d.ts` does not declare (`suggestions`, `reposition`,
 * `setAutoDestroy`, `suggestEl`), read from Obsidian `1.15.0`.
 *
 * @typeParam T - The type of a suggestion.
 */
export abstract class AnchoredSuggest<T> extends PopoverSuggest<T> {
  /**
   * The maximum number of suggestions shown. `0` disables the limit. Defaults to `100`.
   */
  public limit = DEFAULT_LIMIT;

  private anchorEl: HTMLElement | null = null;
  private anchorRect: DOMRectReadOnly | null = null;
  private outsidePointerDownDocument: Document | null = null;
  private readonly outsidePointerDownHandler = this.onOutsidePointerDown.bind(this);
  private requestCount = 0;

  /**
   * Creates a new anchored suggest.
   *
   * @param app - The Obsidian app.
   * @param scope - The parent keymap scope.
   */
  public constructor(app: App, scope?: Scope) {
    super(app, scope);
  }

  /**
   * Closes the popover.
   */
  public override close(): void {
    this.requestCount++;
    this.removeOutsidePointerDownHandler();
    super.close();
  }

  /**
   * Opens the popover at an anchor, or moves it there when it is already open.
   *
   * @param params - The parameters.
   * @returns Whether the popover is open: `false` when there is nothing to suggest, or when it was closed or reopened
   *   while the suggestions were computed.
   */
  public async openAt(params: AnchoredSuggestOpenAtParams): Promise<boolean> {
    const { anchor } = params;
    if (isElement(anchor)) {
      this.anchorEl = anchor;
      this.anchorRect = anchor.getBoundingClientRect();
    } else {
      this.anchorEl = null;
      this.anchorRect = anchor;
    }
    return await this.refresh(params.query ?? '', this.anchorRect);
  }

  /**
   * Picks a suggestion: closes the popover, then hands the suggestion to {@link AnchoredSuggest.onChooseSuggestion}.
   *
   * @param value - The suggestion.
   * @param $event - The event that picked it.
   */
  public override selectSuggestion(value: T, $event: KeyboardEvent | MouseEvent): void {
    this.close();
    this.onChooseSuggestion(value, $event);
  }

  /**
   * Recomputes the suggestions for a new query at the current anchor.
   *
   * @param query - The query.
   * @returns Whether the popover is open afterwards.
   */
  public async setQuery(query: string): Promise<boolean> {
    return this.anchorRect ? (await this.refresh(query, this.anchorRect)) : false;
  }

  /**
   * Gets the suggestions for a query.
   *
   * @param query - The query passed to {@link AnchoredSuggest.openAt} or {@link AnchoredSuggest.setQuery}.
   * @returns The suggestions, directly or as a promise.
   */
  protected abstract getSuggestions(query: string): Promise<T[]> | T[];

  /**
   * Called with the suggestion the user picked, after the popover closed.
   *
   * @param value - The suggestion.
   * @param $event - The event that picked it.
   */
  protected abstract onChooseSuggestion(value: T, $event: KeyboardEvent | MouseEvent): void;

  private addOutsidePointerDownHandler(): void {
    this.removeOutsidePointerDownHandler();
    this.outsidePointerDownDocument = this.suggestEl.ownerDocument;
    this.outsidePointerDownDocument.addEventListener('pointerdown', this.outsidePointerDownHandler, { capture: true });
  }

  private onOutsidePointerDown(event_: PointerEvent): void {
    const path = event_.composedPath();
    if (path.includes(this.suggestEl) || (this.anchorEl && path.includes(this.anchorEl))) {
      return;
    }
    this.close();
  }

  private async refresh(query: string, anchorRect: DOMRectReadOnly): Promise<boolean> {
    const requestId = ++this.requestCount;
    let suggestions = await this.getSuggestions(query);
    if (requestId !== this.requestCount) {
      return false;
    }
    if (suggestions.length === 0) {
      this.close();
      return false;
    }
    if (this.limit > 0) {
      suggestions = suggestions.slice(0, this.limit);
    }

    this.suggestions.setSuggestions(suggestions);
    this.open();
    this.reposition(DOMRect.fromRect(anchorRect));
    if (this.anchorEl) {
      this.setAutoDestroy(this.anchorEl);
    }
    this.addOutsidePointerDownHandler();
    return true;
  }

  private removeOutsidePointerDownHandler(): void {
    this.outsidePointerDownDocument?.removeEventListener('pointerdown', this.outsidePointerDownHandler, { capture: true });
    this.outsidePointerDownDocument = null;
  }
}

function isElement(anchor: DOMRectReadOnly | HTMLElement): anchor is HTMLElement {
  return 'getBoundingClientRect' in anchor;
}
