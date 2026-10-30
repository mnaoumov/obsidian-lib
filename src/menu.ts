/**
 * @file
 *
 * Helpers for Obsidian menus.
 */

import type {
  Menu,
  MenuItem
} from 'obsidian';

/**
 * Parameters for {@link addSingleChoiceMenuItems}.
 *
 * @typeParam T - The type of the values to choose from.
 */
export interface AddSingleChoiceMenuItemsParams<T> {
  /**
   * The value checked when the menu opens.
   */
  readonly currentValue: T;

  /**
   * The menu to add the items to.
   */
  readonly menu: Menu;

  /**
   * Called with the chosen value when the user clicks an item.
   */
  readonly onChange: (value: T) => void;

  /**
   * The choices, in menu order.
   */
  readonly options: readonly SingleChoiceMenuOption<T>[];

  /**
   * The menu section to put the items in.
   */
  readonly section?: string;
}

/**
 * One choice of a single-choice menu group.
 *
 * @typeParam T - The type of the value.
 */
export interface SingleChoiceMenuOption<T> {
  /**
   * The item's icon.
   */
  readonly icon?: string;

  /**
   * The item's title.
   */
  readonly title: string;

  /**
   * The value the item stands for.
   */
  readonly value: T;
}

/**
 * Adds a group of menu items of which exactly one is checked, like radio buttons.
 *
 * A click checks the clicked item and unchecks the rest of the group before calling `onChange`, so a menu
 * that is shown again shows the new choice. Obsidian still closes the menu after a click (read from its
 * `1.15.0` `MenuItem.handleEvent`). Values are compared with `===`.
 *
 * @typeParam T - The type of the values to choose from.
 * @param params - The parameters.
 * @returns The items added, in option order.
 */
export function addSingleChoiceMenuItems<T>(params: AddSingleChoiceMenuItemsParams<T>): MenuItem[] {
  const items: MenuItem[] = [];

  for (const option of params.options) {
    params.menu.addItem((item) => {
      items.push(item);
      item
        .setTitle(option.title)
        .setChecked(option.value === params.currentValue)
        .onClick(() => {
          for (const groupItem of items) {
            groupItem.setChecked(groupItem === item);
          }
          params.onChange(option.value);
        });

      if (option.icon !== undefined) {
        item.setIcon(option.icon);
      }
      if (params.section !== undefined) {
        item.setSection(params.section);
      }
    });
  }

  return items;
}
