// @vitest-environment jsdom

import { assertNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import { Menu } from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { addSingleChoiceMenuItems } from './menu.ts';

const OPTIONS = [
  { icon: 'align-left', title: 'Left', value: 'left' },
  { title: 'Center', value: 'center' },
  { icon: 'align-right', title: 'Right', value: 'right' }
] as const;

function click(menu: Menu, index: number): void {
  const onClick = menu.menuItems__[index]?.onClick__;
  assertNonNullable(onClick);
  onClick(new MouseEvent('click'));
}

describe('addSingleChoiceMenuItems', () => {
  it('should add one item per option, checking the current value', () => {
    const menu = Menu.create2__();
    const items = addSingleChoiceMenuItems({
      currentValue: 'center',
      menu: menu.asOriginalType2__(),
      onChange: vi.fn(),
      options: OPTIONS
    });

    expect(items).toHaveLength(3);
    expect(menu.menuItems__.map((item) => item.title__)).toEqual(['Left', 'Center', 'Right']);
    expect(menu.menuItems__.map((item) => item.checked)).toEqual([false, true, false]);
    expect(menu.menuItems__.map((item) => item.icon__)).toEqual(['align-left', null, 'align-right']);
    expect(menu.menuItems__.map((item) => item.section)).toEqual(['', '', '']);
  });

  it('should put the items in the given section', () => {
    const menu = Menu.create2__();
    addSingleChoiceMenuItems({
      currentValue: 'left',
      menu: menu.asOriginalType2__(),
      onChange: vi.fn(),
      options: OPTIONS,
      section: 'alignment'
    });

    expect(menu.menuItems__.map((item) => item.section)).toEqual(['alignment', 'alignment', 'alignment']);
  });

  it('should move the check mark to the clicked item and report its value', () => {
    const menu = Menu.create2__();
    const onChange = vi.fn();
    addSingleChoiceMenuItems({
      currentValue: 'left',
      menu: menu.asOriginalType2__(),
      onChange,
      options: OPTIONS
    });

    click(menu, 2);

    expect(menu.menuItems__.map((item) => item.checked)).toEqual([false, false, true]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('right');
  });

  it('should leave items outside the group alone', () => {
    const menu = Menu.create2__();
    menu.addItem((item) => item.setTitle('Other').setChecked(true));
    addSingleChoiceMenuItems({
      currentValue: 'left',
      menu: menu.asOriginalType2__(),
      onChange: vi.fn(),
      options: OPTIONS
    });

    click(menu, 2);

    expect(menu.menuItems__[0]?.checked).toBe(true);
  });
});
