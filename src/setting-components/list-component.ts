/**
 * @file
 *
 * Contains a component that edits a reorderable list of strings.
 */

import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  ExtraButtonComponent,
  ValueComponent
} from 'obsidian';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `initPluginContext` to use it in the tsdocs.
import type { initPluginContext } from '../plugin/plugin-context.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `SettingEx` to use it in the tsdocs.
import type { SettingEx } from '../setting-ex.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import FolderListComponent to use it in the tsdocs.
import type { FolderListComponent } from './folder-list-component.ts';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import TagListComponent to use it in the tsdocs.
import type { TagListComponent } from './tag-list-component.ts';
import type { ValueComponentWithChangeTracking } from './value-component-with-change-tracking.ts';

import { CssClass } from '../css-class.ts';
import { t } from '../i18n/i18n.ts';
import { addPluginCssClasses } from '../plugin/plugin-context.ts';

/**
 * A component that edits a reorderable list of strings: each item has move-up, move-down and remove buttons, and a row
 * below the list adds an item, on its button or on Enter.
 *
 * {@link ListComponent.newItemInputEl} is a plain `<input>`, so a suggest can be attached to it; {@link FolderListComponent}
 * and {@link TagListComponent} do exactly that. A subclass shapes what is added by overriding
 * {@link ListComponent.normalizeItem} and how an item reads by overriding {@link ListComponent.formatItem}. An item
 * already in the list is not added twice.
 *
 * You can add this component using {@link SettingEx.addList}.
 *
 * In order to add the styles for the component, use {@link initPluginContext} in your plugin's `onload()` function.
 *
 * Alternatively, you can copy styles from {@link https://unpkg.com/@mnaoumov/obsidian-lib/dist/styles.css}.
 */
export class ListComponent extends ValueComponent<readonly string[]> implements ValueComponentWithChangeTracking<readonly string[]> {
  /**
   * The element holding one row per item.
   */
  public readonly listEl: HTMLElement;

  /**
   * The button that adds the typed item.
   */
  public readonly newItemButton: ExtraButtonComponent;

  /**
   * The input the next item is typed into.
   */
  public readonly newItemInputEl: HTMLInputElement;

  private changeCallback?: (newValue: readonly string[]) => void;
  private value: readonly string[] = [];

  /**
   * Creates a new list component.
   *
   * @param containerEl - The container element.
   * @param cssClass - An extra CSS class for the container, for a subclass.
   */
  public constructor(containerEl: HTMLElement, cssClass?: string) {
    super();
    addPluginCssClasses(containerEl, cssClass ? [CssClass.ListComponent, cssClass] : CssClass.ListComponent);
    this.listEl = containerEl.createDiv({ cls: 'list-component-items' });
    const newItemRowEl = containerEl.createDiv({ cls: 'list-component-new-item' });
    this.newItemInputEl = newItemRowEl.createEl('input', { type: 'text' });
    this.newItemInputEl.addEventListener('keydown', (event_) => {
      if (event_.key !== 'Enter' || event_.isComposing) {
        return;
      }

      event_.preventDefault();
      this.addTypedItem();
    });
    this.newItemButton = new ExtraButtonComponent(newItemRowEl)
      .setIcon('plus')
      .setTooltip(t(($) => $.obsidianLib.list.add))
      .onClick(() => {
        this.addTypedItem();
      });
    this.render();
  }

  /**
   * Adds the text typed into {@link ListComponent.newItemInputEl}, when it normalizes to an item not yet in the list, and
   * clears the input.
   *
   * @returns Whether an item was added.
   */
  public addTypedItem(): boolean {
    if (this.disabled) {
      return false;
    }
    const item = this.normalizeItem(this.newItemInputEl.value);
    if (item === null || this.value.includes(item)) {
      return false;
    }
    this.newItemInputEl.value = '';
    this.setValueAndNotify([...this.value, item]);
    return true;
  }

  /**
   * Gets the items.
   *
   * @returns The items, in order.
   */
  public override getValue(): readonly string[] {
    return this.value;
  }

  /**
   * Sets the callback to be called when the user adds, moves or removes an item.
   *
   * @param callback - The callback.
   * @returns The component.
   */
  public onChange(callback: (newValue: readonly string[]) => void): this {
    this.changeCallback = callback;
    return this;
  }

  /**
   * Sets the disabled state of the component.
   *
   * @param isDisabled - The disabled state.
   * @returns The component.
   */
  public override setDisabled(isDisabled: boolean): this {
    super.setDisabled(isDisabled);
    this.newItemInputEl.disabled = isDisabled;
    this.newItemButton.setDisabled(isDisabled);
    this.render();
    return this;
  }

  /**
   * Sets the placeholder of {@link ListComponent.newItemInputEl}.
   *
   * @param placeholder - The placeholder.
   * @returns The component.
   */
  public setPlaceholder(placeholder: string): this {
    this.newItemInputEl.placeholder = placeholder;
    return this;
  }

  /**
   * Sets the items.
   *
   * @param value - The items, in order.
   * @returns The component.
   */
  public override setValue(value: readonly string[]): this {
    this.value = [...value];
    this.render();
    return this;
  }

  /**
   * Formats an item for display.
   *
   * @param item - The item.
   * @returns The text shown for it.
   */
  protected formatItem(item: string): string {
    return item;
  }

  /**
   * Turns the typed text into an item. By default, trims it and refuses an empty one.
   *
   * @param text - The typed text.
   * @returns The item, or `null` to add nothing.
   */
  protected normalizeItem(text: string): null | string {
    const item = text.trim();
    return item || null;
  }

  private moveItem(index: number, offset: number): void {
    const items = [...this.value];
    // The buttons that would move an item off either end are disabled.
    const item = ensureNonNullable(items.splice(index, 1)[0]);
    items.splice(index + offset, 0, item);
    this.setValueAndNotify(items);
  }

  private removeItem(index: number): void {
    this.setValueAndNotify(this.value.filter((_, itemIndex) => itemIndex !== index));
  }

  private render(): void {
    this.listEl.empty();
    if (this.value.length === 0) {
      this.listEl.createDiv({ cls: 'list-component-empty', text: t(($) => $.obsidianLib.list.empty) });
      return;
    }

    for (const [index, item] of this.value.entries()) {
      const rowEl = this.listEl.createDiv({ cls: 'list-component-item' });
      rowEl.createSpan({ cls: 'list-component-item-text', text: this.formatItem(item) });
      new ExtraButtonComponent(rowEl)
        .setIcon('arrow-up')
        .setTooltip(t(($) => $.obsidianLib.list.moveUp))
        .setDisabled(this.disabled || index === 0)
        .onClick(() => {
          this.moveItem(index, -1);
        });
      new ExtraButtonComponent(rowEl)
        .setIcon('arrow-down')
        .setTooltip(t(($) => $.obsidianLib.list.moveDown))
        .setDisabled(this.disabled || index === this.value.length - 1)
        .onClick(() => {
          this.moveItem(index, 1);
        });
      new ExtraButtonComponent(rowEl)
        .setIcon('x')
        .setTooltip(t(($) => $.obsidianLib.list.remove))
        .setDisabled(this.disabled)
        .onClick(() => {
          this.removeItem(index);
        });
    }
  }

  private setValueAndNotify(value: readonly string[]): void {
    this.setValue(value);
    this.changeCallback?.(this.value);
  }
}
