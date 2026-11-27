/**
 * @file
 *
 * Completes the whole value of an `<input>` as a link path: a vault file, then, after `#`, one of that file's headings.
 */

import type {
  App,
  HeadingCache,
  SearchMatches,
  SearchResult,
  TFile
} from 'obsidian';

import {
  AbstractInputSuggest,
  prepareFuzzySearch,
  renderMatches,
  sortSearchResults,
  stripHeadingForLink
} from 'obsidian';

import type { LinkSuggestion } from './link-and-tag-input-suggest.ts';

import {
  getVaultLinkSuggestions,
  renderLinkSuggestion
} from './link-and-tag-input-suggest.ts';

const SUBPATH_SEPARATOR = '#';
const BLOCK_SUBPATH_PREFIX = '^';

/**
 * A suggested heading of the file a link path resolves to.
 */
export interface LinkPathHeadingSuggestion {
  /**
   * The file the heading belongs to.
   */
  readonly file: TFile;

  /**
   * The heading.
   */
  readonly heading: HeadingCache;

  /**
   * The characters of the heading text the query matched, highlighted when the suggestion renders. Nothing is
   * highlighted when omitted.
   */
  readonly matches?: SearchMatches;

  /**
   * The whole link path the input takes when the suggestion is picked: the path, `#`, and the heading as a link
   * subpath.
   */
  readonly value: string;
}

/**
 * Parameters of {@link LinkPathInputSuggest}.
 */
export interface LinkPathInputSuggestConstructorParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The input whose whole value is a link path.
   */
  readonly inputEl: HTMLInputElement;

  /**
   * The path that link paths are resolved and made relative against. A value starting with `#` suggests the headings
   * of this file.
   *
   * @default `''`
   */
  readonly sourcePath?: string;
}

/**
 * A suggestion of {@link LinkPathInputSuggest}: a file before the `#`, a heading after it.
 */
export type LinkPathSuggestion = LinkPathHeadingSuggestion | LinkSuggestion;

interface HeadingSearchResult {
  readonly match: SearchResult;
  readonly suggestion: LinkPathHeadingSuggestion;
}

/**
 * Completes the WHOLE value of an input as a link path, for a field that holds only a link target, such as the target
 * field of a link editor. It is the counterpart of `LinkAndTagInputSuggest`, which completes a `[[` link typed inside
 * free text.
 *
 * Before a `#` it suggests vault files by their link text relative to the source path. After `<path>#` it suggests the
 * headings of the file that path resolves to, and after a bare `#` those of the source file. A block subpath (`#^`)
 * gets no suggestions. Picking a suggestion replaces the value and dispatches an `input` event, so a component
 * listening on the input sees the change.
 *
 * The value is the link path as Obsidian resolves it, not URL-encoded: a caller that writes it into a Markdown link
 * encodes it there.
 *
 * ```ts
 * new Setting(containerEl).addText((text) => {
 *   new LinkPathInputSuggest({ app: this.app, inputEl: text.inputEl, sourcePath: file.path });
 * });
 * ```
 */
export class LinkPathInputSuggest extends AbstractInputSuggest<LinkPathSuggestion> {
  /**
   * The input the suggest completes.
   */
  protected readonly inputEl: HTMLInputElement;

  /**
   * The path that link paths are resolved and made relative against.
   */
  protected readonly sourcePath: string;

  /**
   * Creates the suggest and attaches it to the input.
   *
   * @param params - The parameters.
   */
  public constructor(params: LinkPathInputSuggestConstructorParams) {
    super(params.app, params.inputEl);
    this.inputEl = params.inputEl;
    this.sourcePath = params.sourcePath ?? '';
  }

  /**
   * Renders a suggestion.
   *
   * @param suggestion - The suggestion.
   * @param el - The element to render into.
   */
  public renderSuggestion(suggestion: LinkPathSuggestion, el: HTMLElement): void {
    if (isHeadingSuggestion(suggestion)) {
      renderMatches(el.createDiv('suggestion-title'), suggestion.heading.heading, suggestion.matches ?? null);
      el.createDiv({ cls: 'suggestion-note', text: suggestion.file.path });
      return;
    }

    renderLinkSuggestion(suggestion, el);
  }

  /**
   * Replaces the value with the picked link path, moves the caret to its end and dispatches an `input` event.
   *
   * @param suggestion - The suggestion.
   * @param $event - The event that picked it.
   */
  public override selectSuggestion(suggestion: LinkPathSuggestion, $event: KeyboardEvent | MouseEvent): void {
    const value = isHeadingSuggestion(suggestion) ? suggestion.value : suggestion.linktext;
    this.setValue(value);
    this.inputEl.setSelectionRange(value.length, value.length);
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    super.selectSuggestion(suggestion, $event);
    this.close();
  }

  /**
   * Gets the heading suggestions for a value holding a `#`.
   *
   * @param value - The whole value.
   * @returns The headings of the file the path before the first `#` resolves to that match the text after the last
   *   `#`, best match first, then in document order.
   */
  protected getHeadingSuggestions(value: string): LinkPathHeadingSuggestion[] {
    const firstSeparatorIndex = value.indexOf(SUBPATH_SEPARATOR);
    if (value.slice(firstSeparatorIndex + SUBPATH_SEPARATOR.length).startsWith(BLOCK_SUBPATH_PREFIX)) {
      return [];
    }

    const file = this.resolveFile(value.slice(0, firstSeparatorIndex));
    if (!file) {
      return [];
    }

    const lastSeparatorIndex = value.lastIndexOf(SUBPATH_SEPARATOR);
    const prefix = value.slice(0, lastSeparatorIndex + SUBPATH_SEPARATOR.length);
    const fuzzySearch = prepareFuzzySearch(value.slice(lastSeparatorIndex + SUBPATH_SEPARATOR.length));
    const results: HeadingSearchResult[] = [];
    for (const heading of this.app.metadataCache.getFileCache(file)?.headings ?? []) {
      const match = fuzzySearch(heading.heading);
      if (match) {
        results.push({
          match,
          suggestion: { file, heading, matches: match.matches, value: prefix + stripHeadingForLink(heading.heading) }
        });
      }
    }
    sortSearchResults(results);
    return results.map((result) => result.suggestion);
  }

  /**
   * Gets the suggestions for the whole value: files before a `#`, headings after it.
   *
   * @param value - The value of the input.
   * @returns The suggestions.
   */
  protected override getSuggestions(value: string): LinkPathSuggestion[] {
    return value.includes(SUBPATH_SEPARATOR) ? this.getHeadingSuggestions(value) : getVaultLinkSuggestions({ app: this.app, query: value, sourcePath: this.sourcePath });
  }

  /**
   * Resolves the path part of the value to a file.
   *
   * @param linkpath - The text before the first `#`.
   * @returns The file, the source file for an empty path, or `null` when nothing resolves.
   */
  protected resolveFile(linkpath: string): null | TFile {
    return linkpath === '' ? this.app.vault.getFileByPath(this.sourcePath) : this.app.metadataCache.getFirstLinkpathDest(linkpath, this.sourcePath);
  }
}

function isHeadingSuggestion(suggestion: LinkPathSuggestion): suggestion is LinkPathHeadingSuggestion {
  return 'heading' in suggestion;
}
