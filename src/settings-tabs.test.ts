// @vitest-environment jsdom

import type { Mock } from 'vitest';

import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { SettingsTabs } from './settings-tabs.ts';

vi.mock('./plugin/plugin-context.ts', () => ({
  addPluginCssClasses: vi.fn()
}));

function getButtons(tabs: SettingsTabs): HTMLButtonElement[] {
  return [...tabs.tabBarEl.querySelectorAll('button')];
}

function press(tabs: SettingsTabs, key: string): KeyboardEvent {
  const keyboardEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  tabs.tabBarEl.dispatchEvent(keyboardEvent);
  return keyboardEvent;
}

describe('SettingsTabs', () => {
  let tabs: SettingsTabs;
  let onTabChange: Mock<(tabId: string) => void>;

  beforeEach(() => {
    tabs = new SettingsTabs(activeDocument.body.createDiv());
    onTabChange = vi.fn<(tabId: string) => void>();
    tabs.onTabChange(onTabChange);
  });

  it('should have no selection before a tab is added', () => {
    expect(tabs.getSelectedTabId()).toBeNull();
    expect(press(tabs, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('should select and render the first tab added', () => {
    const renderGeneral = vi.fn((el: HTMLElement) => {
      el.setText('General settings');
    });
    tabs.addTab({ icon: 'settings', id: 'general', name: 'General', render: renderGeneral }).addTab({
      id: 'advanced',
      name: 'Advanced',
      render: (el) => {
        el.setText('Advanced settings');
      }
    });
    expect(tabs.getSelectedTabId()).toBe('general');
    expect(renderGeneral).toHaveBeenCalledWith(tabs.panelEl);
    expect(tabs.panelEl.textContent).toBe('General settings');
    const [generalButton, advancedButton] = getButtons(tabs);
    expect(generalButton?.querySelector('.settings-tabs-icon')).not.toBeNull();
    expect(generalButton?.getAttribute('aria-selected')).toBe('true');
    expect(generalButton?.hasClass('is-active')).toBe(true);
    expect(advancedButton?.getAttribute('tabindex')).toBe('-1');
    expect(onTabChange).not.toHaveBeenCalled();

    advancedButton?.click();
    expect(tabs.panelEl.textContent).toBe('Advanced settings');
    expect(onTabChange).toHaveBeenCalledWith('advanced');
    expect(advancedButton?.getAttribute('aria-selected')).toBe('true');
    expect(generalButton?.getAttribute('tabindex')).toBe('-1');
  });

  it('should ignore an unknown id and refuse a duplicate one', () => {
    tabs.addTab({ id: 'a', name: 'A', render: vi.fn() });
    tabs.selectTab('missing').selectTab(undefined);
    expect(tabs.getSelectedTabId()).toBe('a');
    expect(() => tabs.addTab({ id: 'a', name: 'A again', render: vi.fn() })).toThrow('already added');
  });

  it('should move between tabs with the keyboard', () => {
    for (const id of ['a', 'b', 'c']) {
      tabs.addTab({ id, name: id.toUpperCase(), render: vi.fn() });
    }
    expect(press(tabs, 'ArrowLeft').defaultPrevented).toBe(true);
    expect(tabs.getSelectedTabId()).toBe('c');
    expect(activeDocument.activeElement).toBe(getButtons(tabs)[2]);
    press(tabs, 'ArrowRight');
    expect(tabs.getSelectedTabId()).toBe('a');
    press(tabs, 'End');
    expect(tabs.getSelectedTabId()).toBe('c');
    press(tabs, 'Home');
    expect(tabs.getSelectedTabId()).toBe('a');
    expect(press(tabs, 'Enter').defaultPrevented).toBe(false);
    expect(tabs.getSelectedTabId()).toBe('a');
  });
});
