/**
 * @file
 *
 * Completes `[[` links and `#` tags at the caret of any `<input>` or `<textarea>`, the way the editor does.
 */

import type {
  App,
  SearchResult,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  AbstractInputSuggest,
  getAllTags,
  prepareFuzzySearch,
  sortSearchResults
} from 'obsidian';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `TagListComponent` to use it in the tsdocs.
import type { TagListComponent } from './setting-components/tag-list-component.ts';

/**
 * What a completion trigger completes.
 */
export enum LinkAndTagCompletionKind {
  /**
   * A `[[` wikilink to a vault file.
   */
  Link = 'link',

  /**
   * A `#` tag.
   */
  Tag = 'tag'
}

/**
 * A completion trigger found before the caret.
 */
export interface LinkAndTagCompletionTrigger {
  /**
   * The offset of the caret, where the query ends.
   */
  readonly end: number;

  /**
   * What the trigger completes.
   */
  readonly kind: LinkAndTagCompletionKind;

  /**
   * The text typed after the trigger characters.
   */
  readonly query: string;

  /**
   * The offset of the trigger characters: the first `[` of `[[`, or the `#`.
   */
  readonly start: number;
}

/**
 * Parameters of {@link LinkAndTagInputSuggest}.
 */
export interface LinkAndTagInputSuggestConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The element to complete in.
   */
  readonly inputEl: HTMLInputElement | HTMLTextAreaElement;

  /**
   * Whether `[[` completes links. Defaults to `true`.
   */
  readonly shouldSuggestLinks?: boolean;

  /**
   * Whether `#` completes tags. Defaults to `true`.
   */
  readonly shouldSuggestTags?: boolean;

  /**
   * The path that inserted links are relative to. Defaults to the vault root.
   */
  readonly sourcePath?: string;
}

/**
 * A suggestion of {@link LinkAndTagInputSuggest}.
 */
export type LinkAndTagSuggestion = LinkSuggestion | TagSuggestion;

/**
 * A suggested link.
 */
export interface LinkSuggestion {
  /**
   * The file the link points to.
   */
  readonly file: TFile;

  /**
   * The kind of the suggestion.
   */
  readonly kind: LinkAndTagCompletionKind.Link;

  /**
   * The link text inserted between `[[` and `]]`.
   */
  readonly linktext: string;
}

/**
 * A suggested tag.
 */
export interface TagSuggestion {
  /**
   * How many tag occurrences the vault holds.
   */
  readonly count: number;

  /**
   * The kind of the suggestion.
   */
  readonly kind: LinkAndTagCompletionKind.Tag;

  /**
   * The tag, without its `#`.
   */
  readonly tag: string;
}

interface SuggestionSearchResult<T> {
  readonly match: SearchResult;
  readonly suggestion: T;
}

const LINK_OPEN = '[[';
const LINK_CLOSE = ']]';
const TAG_PREFIX = '#';
const TAG_BEFORE_CARET_REG_EXP = /(?:^|\s)#[\p{L}\p{N}_/-]*$/u;

/**
 * Parameters for {@link getVaultTagSuggestions}.
 */
export interface GetVaultTagSuggestionsParams {
  /**
   * The Obsidian app.
   */
  readonly app: App;

  /**
   * The text typed, without the `#`.
   */
  readonly query: string;
}

/**
 * Completes `[[` links and `#` tags inside any `<input>` or `<textarea>`.
 *
 * Obsidian's {@link AbstractInputSuggest} treats the whole value as the query and replaces it on selection. This one
 * reads the trigger before the caret and replaces only that, so it works inside free text such as a template or a
 * description setting, and it accepts a `<textarea>` too.
 *
 * ```ts
 * new Setting(containerEl).addTextArea((textArea) => {
 *   new LinkAndTagInputSuggest({ app: this.app, inputEl: textArea.inputEl });
 * });
 * ```
 */
export class LinkAndTagInputSuggest extends AbstractInputSuggest<LinkAndTagSuggestion> {
  /**
   * The element the suggest completes in.
   */
  protected readonly inputEl: HTMLInputElement | HTMLTextAreaElement;

  /**
   * Whether `[[` completes links.
   */
  protected readonly shouldSuggestLinks: boolean;

  /**
   * Whether `#` completes tags.
   */
  protected readonly shouldSuggestTags: boolean;

  /**
   * The path that inserted links are relative to.
   */
  protected readonly sourcePath: string;

  /**
   * Creates the suggest and attaches it to the element.
   *
   * @param params - The parameters.
   */
  public constructor(params: LinkAndTagInputSuggestConstructorParams) {
    // Obsidian's suggest reads the value only through `getValue` and `setValue`, both overridden here, so a textarea works too.
    super(params.app, castTo<HTMLInputElement>(params.inputEl));
    this.inputEl = params.inputEl;
    this.shouldSuggestLinks = params.shouldSuggestLinks ?? true;
    this.shouldSuggestTags = params.shouldSuggestTags ?? true;
    this.sourcePath = params.sourcePath ?? '';
  }

  /**
   * Gets the value of the element.
   *
   * @returns The value.
   */
  public override getValue(): string {
    return this.inputEl.value;
  }

  /**
   * Renders a suggestion.
   *
   * @param suggestion - The suggestion.
   * @param el - The element to render into.
   */
  public renderSuggestion(suggestion: LinkAndTagSuggestion, el: HTMLElement): void {
    if (suggestion.kind === LinkAndTagCompletionKind.Link) {
      el.createDiv({ cls: 'suggestion-title', text: suggestion.linktext });
      if (suggestion.linktext !== suggestion.file.path) {
        el.createDiv({ cls: 'suggestion-note', text: suggestion.file.path });
      }
      return;
    }

    el.addClass('mod-complex');
    el.createDiv({ cls: 'suggestion-content', text: `${TAG_PREFIX}${suggestion.tag}` });
    el.createDiv({ cls: 'suggestion-aux', text: String(suggestion.count) });
  }

  /**
   * Inserts the suggestion in place of the trigger, moves the caret after it and dispatches an `input` event, so a
   * component listening on the element sees the change.
   *
   * @param suggestion - The suggestion.
   * @param $event - The event that selected it.
   */
  public override selectSuggestion(suggestion: LinkAndTagSuggestion, $event: KeyboardEvent | MouseEvent): void {
    const trigger = this.getTrigger();
    if (trigger) {
      const value = this.getValue();
      let after = value.slice(trigger.end);
      let insertion: string;
      if (suggestion.kind === LinkAndTagCompletionKind.Link) {
        insertion = `${LINK_OPEN}${suggestion.linktext}${LINK_CLOSE}`;
        if (after.startsWith(LINK_CLOSE)) {
          after = after.slice(LINK_CLOSE.length);
        }
      } else {
        insertion = `${TAG_PREFIX}${suggestion.tag} `;
      }

      this.setValue(value.slice(0, trigger.start) + insertion + after);
      const caret = trigger.start + insertion.length;
      this.inputEl.setSelectionRange(caret, caret);
      this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    super.selectSuggestion(suggestion, $event);
    this.close();
  }

  /**
   * Sets the value of the element.
   *
   * @param value - The value.
   */
  public override setValue(value: string): void {
    this.inputEl.value = value;
  }

  /**
   * Gets the link suggestions for a query.
   *
   * @param query - The text typed after `[[`.
   * @returns The suggestions, best match first.
   */
  protected getLinkSuggestions(query: string): LinkSuggestion[] {
    const fuzzySearch = prepareFuzzySearch(query);
    const results: SuggestionSearchResult<LinkSuggestion>[] = [];
    for (const file of this.app.vault.getFiles()) {
      const linktext = this.app.metadataCache.fileToLinktext(file, this.sourcePath, true);
      const match = fuzzySearch(linktext) ?? fuzzySearch(file.path);
      if (match) {
        results.push({ match, suggestion: { file, kind: LinkAndTagCompletionKind.Link, linktext } });
      }
    }
    sortSearchResults(results);
    return results.map((result) => result.suggestion);
  }

  /**
   * Gets the suggestions for the trigger before the caret. The query Obsidian passes is the whole value, so it is
   * ignored.
   *
   * @returns The suggestions.
   */
  protected override getSuggestions(): LinkAndTagSuggestion[] {
    const trigger = this.getTrigger();
    if (trigger?.kind === LinkAndTagCompletionKind.Link) {
      return this.getLinkSuggestions(trigger.query);
    }
    return trigger?.kind === LinkAndTagCompletionKind.Tag ? this.getTagSuggestions(trigger.query) : [];
  }

  /**
   * Gets the tag suggestions for a query, from the tags of every note.
   *
   * @param query - The text typed after `#`.
   * @returns The suggestions, best match first, then the most used.
   */
  protected getTagSuggestions(query: string): TagSuggestion[] {
    return getVaultTagSuggestions({ app: this.app, query });
  }

  /**
   * Gets the enabled trigger before the caret.
   *
   * @returns The trigger, or `null`.
   */
  protected getTrigger(): LinkAndTagCompletionTrigger | null {
    const value = this.getValue();
    const trigger = getLinkAndTagCompletionTrigger(value, this.inputEl.selectionStart ?? value.length);
    if (trigger?.kind === LinkAndTagCompletionKind.Link && !this.shouldSuggestLinks) {
      return null;
    }
    return trigger?.kind === LinkAndTagCompletionKind.Tag && !this.shouldSuggestTags ? null : trigger;
  }
}

/**
 * Finds the `[[` link or `#` tag being typed before the caret.
 *
 * A link trigger is an unclosed `[[` on the caret's line with no `|` after it, so an alias being typed is left alone. A
 * tag trigger is a `#` at the start of the text or after whitespace, followed only by tag characters.
 *
 * @param text - The text of the element.
 * @param caret - The offset of the caret.
 * @returns The trigger, or `null` when the caret is not in one.
 */
export function getLinkAndTagCompletionTrigger(text: string, caret: number): LinkAndTagCompletionTrigger | null {
  const beforeCaret = text.slice(0, caret);
  const linkStart = beforeCaret.lastIndexOf(LINK_OPEN);
  if (linkStart !== -1) {
    const query = beforeCaret.slice(linkStart + LINK_OPEN.length);
    if (!query.includes(LINK_CLOSE) && !query.includes('\n') && !query.includes('|')) {
      return { end: caret, kind: LinkAndTagCompletionKind.Link, query, start: linkStart };
    }
  }

  if (TAG_BEFORE_CARET_REG_EXP.test(beforeCaret)) {
    // The query holds no #, so the last one is the trigger.
    const start = beforeCaret.lastIndexOf(TAG_PREFIX);
    return { end: caret, kind: LinkAndTagCompletionKind.Tag, query: beforeCaret.slice(start + TAG_PREFIX.length), start };
  }

  return null;
}

/**
 * Gets the tags of every note matching a query, as {@link LinkAndTagInputSuggest} and {@link TagListComponent}
 * suggest them.
 *
 * @param params - The parameters.
 * @returns The suggestions, best match first, then the most used.
 */
export function getVaultTagSuggestions(params: GetVaultTagSuggestionsParams): TagSuggestion[] {
  const { app, query } = params;
  const counts = new Map<string, number>();
  for (const file of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(file);
    for (const tag of (cache ? getAllTags(cache) : null) ?? []) {
      const name = tag.slice(TAG_PREFIX.length);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const fuzzySearch = prepareFuzzySearch(query);
  const results: SuggestionSearchResult<TagSuggestion>[] = [];
  const sortedCounts = [...counts].sort(([tag1, count1], [tag2, count2]) => count2 - count1 || tag1.localeCompare(tag2));
  for (const [tag, count] of sortedCounts) {
    const match = fuzzySearch(tag);
    if (match) {
      results.push({ match, suggestion: { count, kind: LinkAndTagCompletionKind.Tag, tag } });
    }
  }
  sortSearchResults(results);
  return results.map((result) => result.suggestion);
}
