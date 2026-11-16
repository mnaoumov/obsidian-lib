/**
 * @file
 *
 * Contains a component that edits a reorderable list of folders, with a folder suggest.
 */

import type {
  App,
  SearchResult,
  TFolder
} from 'obsidian';

import {
  AbstractInputSuggest,
  normalizePath,
  prepareFuzzySearch,
  renderMatches
} from 'obsidian';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `SettingEx` to use it in the tsdocs.
import type { SettingEx } from '../setting-ex.ts';

import { CssClass } from '../css-class.ts';
import { ListComponent } from './list-component.ts';

interface FolderMatch {
  readonly folder: TFolder;
  readonly result: SearchResult;
}

/**
 * Suggests the vault's folders, the root included, in an `<input>`, matching the typed text against the folder path
 * and highlighting the matched characters.
 */
export class FolderInputSuggest extends AbstractInputSuggest<TFolder> {
  /**
   * The input the suggest completes.
   */
  protected readonly inputEl: HTMLInputElement;

  private readonly resultsByFolder = new Map<TFolder, SearchResult>();

  /**
   * Creates a new folder suggest.
   *
   * @param app - The Obsidian app.
   * @param inputEl - The input.
   */
  public constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  /**
   * Renders a folder path, the matched characters highlighted.
   *
   * @param folder - The folder.
   * @param el - The element to render into.
   */
  public renderSuggestion(folder: TFolder, el: HTMLElement): void {
    renderMatches(el, getFolderDisplayPath(folder), this.resultsByFolder.get(folder)?.matches ?? null);
  }

  /**
   * Puts the folder path into the input, dispatches an `input` event, then calls the `onSelect` callback.
   *
   * @param folder - The folder.
   * @param $event - The event that picked it.
   */
  public override selectSuggestion(folder: TFolder, $event: KeyboardEvent | MouseEvent): void {
    this.setValue(getFolderDisplayPath(folder));
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    super.selectSuggestion(folder, $event);
    this.close();
  }

  /**
   * Gets the folders matching the typed text.
   *
   * @param query - The typed text.
   * @returns The folders, best match first.
   */
  protected override getSuggestions(query: string): TFolder[] {
    const fuzzySearch = prepareFuzzySearch(query.trim());
    const folderMatches: FolderMatch[] = [];
    for (const folder of this.app.vault.getAllFolders(true)) {
      const result = fuzzySearch(getFolderDisplayPath(folder));
      if (result) {
        folderMatches.push({ folder, result });
      }
    }
    folderMatches.sort((folderMatch1, folderMatch2) => folderMatch2.result.score - folderMatch1.result.score);
    this.resultsByFolder.clear();
    for (const folderMatch of folderMatches) {
      this.resultsByFolder.set(folderMatch.folder, folderMatch.result);
    }
    return folderMatches.map((folderMatch) => folderMatch.folder);
  }
}

/**
 * A {@link ListComponent} of vault folder paths: the add row suggests the vault's folders, and a typed path is
 * normalized with Obsidian's `normalizePath`, so the root reads as `/`. A path need not exist yet.
 *
 * You can add this component using {@link SettingEx.addFolderList}.
 */
export class FolderListComponent extends ListComponent {
  /**
   * The folder suggest attached to {@link ListComponent.newItemInputEl}.
   */
  public readonly suggest: FolderInputSuggest;

  /**
   * Creates a new folder list component.
   *
   * @param containerEl - The container element.
   * @param app - The Obsidian app.
   */
  public constructor(containerEl: HTMLElement, app: App) {
    super(containerEl, CssClass.FolderListComponent);
    this.suggest = new FolderInputSuggest(app, this.newItemInputEl);
    this.suggest.onSelect(() => {
      this.addTypedItem();
    });
  }

  /**
   * Normalizes a typed folder path.
   *
   * @param text - The typed text.
   * @returns The normalized path, or `null` for empty text.
   */
  protected override normalizeItem(text: string): null | string {
    const path = text.trim();
    return path ? normalizePath(path) : null;
  }
}

function getFolderDisplayPath(folder: TFolder): string {
  return folder.isRoot() ? '/' : folder.path;
}
