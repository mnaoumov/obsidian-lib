/**
 * @file
 *
 * Contains a suggest that completes any vault file in an `<input>`, showing each file's name and path with the
 * matched characters highlighted.
 */

import type {
  App,
  SearchMatches,
  SearchResult,
  TFile
} from 'obsidian';

import {
  AbstractInputSuggest,
  prepareFuzzySearch,
  renderMatches
} from 'obsidian';

/**
 * The parameters for constructing a {@link FileInputSuggest}.
 */
export interface FileInputSuggestConstructorOptions {
  /**
   * Decides whether a file is offered: `true` offers it, `false` leaves it out. Every file is offered when omitted.
   */
  readonly shouldIncludeFile?: (file: TFile) => boolean;
}

interface FileMatch {
  readonly file: TFile;
  readonly result: SearchResult;
}

/**
 * Suggests the vault's files in an `<input>`, matching the typed text fuzzily against the file path.
 *
 * Each suggestion shows the file name as its title and the full path below it, with the matched characters
 * highlighted in both. Picking one puts its path into the input and dispatches an `input` event, so a wrapping text
 * component's `onChange` fires.
 */
export class FileInputSuggest extends AbstractInputSuggest<TFile> {
  /**
   * The input the suggest completes.
   */
  protected readonly inputEl: HTMLInputElement;

  /**
   * Decides whether a file is offered.
   */
  protected readonly shouldIncludeFile: (file: TFile) => boolean;

  private readonly resultsByFile = new Map<TFile, SearchResult>();

  /**
   * Creates a new file suggest.
   *
   * @param app - The Obsidian app.
   * @param inputEl - The input.
   * @param options - The optional parameters.
   */
  public constructor(app: App, inputEl: HTMLInputElement, options: FileInputSuggestConstructorOptions = {}) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.shouldIncludeFile = options.shouldIncludeFile ?? ((): boolean => true);
  }

  /**
   * Renders a file: its name as the title and its path as the note, the matched characters highlighted.
   *
   * @param file - The file.
   * @param el - The element to render into.
   */
  public renderSuggestion(file: TFile, el: HTMLElement): void {
    const matches = this.resultsByFile.get(file)?.matches ?? [];
    const nameStart = file.path.length - file.name.length;
    const contentEl = el.createDiv('suggestion-content');
    renderMatches(contentEl.createDiv('suggestion-title'), file.name, clipMatches(matches, nameStart, file.path.length));
    renderMatches(contentEl.createDiv('suggestion-note'), file.path, matches);
  }

  /**
   * Puts the file path into the input, dispatches an `input` event, then calls the `onSelect` callback.
   *
   * @param file - The file.
   * @param $event - The event that picked it.
   */
  public override selectSuggestion(file: TFile, $event: KeyboardEvent | MouseEvent): void {
    this.setValue(file.path);
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    super.selectSuggestion(file, $event);
    this.close();
  }

  /**
   * Gets the files matching the typed text.
   *
   * @param query - The typed text.
   * @returns The files, best match first.
   */
  protected override getSuggestions(query: string): TFile[] {
    const fuzzySearch = prepareFuzzySearch(query.trim());
    const fileMatches: FileMatch[] = [];
    for (const file of this.app.vault.getFiles()) {
      if (!this.shouldIncludeFile(file)) {
        continue;
      }
      const result = fuzzySearch(file.path);
      if (result) {
        fileMatches.push({ file, result });
      }
    }
    fileMatches.sort((fileMatch1, fileMatch2) => fileMatch2.result.score - fileMatch1.result.score || fileMatch1.file.path.localeCompare(fileMatch2.file.path));
    this.resultsByFile.clear();
    for (const fileMatch of fileMatches) {
      this.resultsByFile.set(fileMatch.file, fileMatch.result);
    }
    return fileMatches.map((fileMatch) => fileMatch.file);
  }
}

/**
 * Clips match ranges to a span of the searched text and shifts them to the span's start.
 *
 * @param matches - The match ranges over the whole text.
 * @param start - The span start.
 * @param end - The span end.
 * @returns The ranges inside the span, relative to its start.
 */
export function clipMatches(matches: SearchMatches, start: number, end: number): SearchMatches {
  const clipped: SearchMatches = [];
  for (const [matchStart, matchEnd] of matches) {
    const clippedStart = Math.max(matchStart, start);
    const clippedEnd = Math.min(matchEnd, end);
    if (clippedStart < clippedEnd) {
      clipped.push([clippedStart - start, clippedEnd - start]);
    }
  }
  return clipped;
}
