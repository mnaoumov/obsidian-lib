/**
 * @file
 *
 * Contains a component that edits a reorderable list of tags, with a tag suggest.
 */

import type { App } from 'obsidian';

import { AbstractInputSuggest } from 'obsidian';

import type { TagSuggestion } from '../link-and-tag-input-suggest.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `SettingEx` to use it in the tsdocs.
import type { SettingEx } from '../setting-ex.ts';

import { CssClass } from '../css-class.ts';
import { getVaultTagSuggestions } from '../link-and-tag-input-suggest.ts';
import { ListComponent } from './list-component.ts';

const TAG_PREFIX = '#';
const LEADING_TAG_PREFIXES_REG_EXP = /^#+/u;
const TAG_REG_EXP = /^[\p{L}\p{N}_/-]+$/u;
const DIGITS_ONLY_REG_EXP = /^\d+$/u;

/**
 * Suggests the vault's tags in an `<input>`, whether or not the typed text starts with `#`. A picked tag is put into the
 * input without the `#`.
 */
export class TagInputSuggest extends AbstractInputSuggest<TagSuggestion> {
  /**
   * The input the suggest completes.
   */
  protected readonly inputEl: HTMLInputElement;

  /**
   * Creates a new tag suggest.
   *
   * @param app - The Obsidian app.
   * @param inputEl - The input.
   */
  public constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  /**
   * Renders a tag with its note count.
   *
   * @param suggestion - The tag.
   * @param el - The element to render into.
   */
  public renderSuggestion(suggestion: TagSuggestion, el: HTMLElement): void {
    el.addClass('mod-complex');
    el.createDiv({ cls: 'suggestion-content', text: `${TAG_PREFIX}${suggestion.tag}` });
    el.createDiv({ cls: 'suggestion-aux', text: String(suggestion.count) });
  }

  /**
   * Puts the tag into the input, dispatches an `input` event, then calls the `onSelect` callback.
   *
   * @param suggestion - The tag.
   * @param $event - The event that picked it.
   */
  public override selectSuggestion(suggestion: TagSuggestion, $event: KeyboardEvent | MouseEvent): void {
    this.setValue(suggestion.tag);
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    super.selectSuggestion(suggestion, $event);
    this.close();
  }

  /**
   * Gets the tags matching the typed text.
   *
   * @param query - The typed text.
   * @returns The tags, best match first, then the most used.
   */
  protected override getSuggestions(query: string): TagSuggestion[] {
    return getVaultTagSuggestions({ app: this.app, query: query.trim().replace(LEADING_TAG_PREFIXES_REG_EXP, '') });
  }
}

/**
 * A {@link ListComponent} of tags, stored without the `#` and shown with it. The add row suggests the vault's tags, and
 * a typed tag is refused unless it is a valid Obsidian tag: letters, digits, `_`, `-` and `/`, not digits only.
 *
 * You can add this component using {@link SettingEx.addTagList}.
 */
export class TagListComponent extends ListComponent {
  /**
   * The tag suggest attached to {@link ListComponent.newItemInputEl}.
   */
  public readonly suggest: TagInputSuggest;

  /**
   * Creates a new tag list component.
   *
   * @param containerEl - The container element.
   * @param app - The Obsidian app.
   */
  public constructor(containerEl: HTMLElement, app: App) {
    super(containerEl, CssClass.TagListComponent);
    this.suggest = new TagInputSuggest(app, this.newItemInputEl);
    this.suggest.onSelect(() => {
      this.addTypedItem();
    });
  }

  /**
   * Shows a tag with its `#`.
   *
   * @param item - The tag.
   * @returns The tag with its `#`.
   */
  protected override formatItem(item: string): string {
    return `${TAG_PREFIX}${item}`;
  }

  /**
   * Strips the `#` from a typed tag and validates it.
   *
   * @param text - The typed text.
   * @returns The tag, or `null` when it is not a valid tag.
   */
  protected override normalizeItem(text: string): null | string {
    const tag = text.trim().replace(LEADING_TAG_PREFIXES_REG_EXP, '');
    return TAG_REG_EXP.test(tag) && !DIGITS_ONLY_REG_EXP.test(tag) ? tag : null;
  }
}
