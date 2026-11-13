/**
 * @file
 *
 * Tabbed sections inside a plugin's settings.
 */

import { setIcon } from 'obsidian';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- We need to import `initPluginContext` to use it in the tsdocs.
import type { initPluginContext } from './plugin/plugin-context.ts';

import { CssClass } from './css-class.ts';
import { addPluginCssClasses } from './plugin/plugin-context.ts';

/**
 * A tab of {@link SettingsTabs}.
 */
export interface SettingsTab {
  /**
   * The name of an Obsidian icon shown before the name.
   */
  readonly icon?: string;

  /**
   * The id of the tab, unique among the tabs.
   */
  readonly id: string;

  /**
   * The name shown on the tab button.
   */
  readonly name: string;

  /**
   * Renders the tab's settings into the panel, which is empty each time the tab is selected.
   *
   * @param containerEl - The panel.
   */
  readonly render: (containerEl: HTMLElement) => void;
}

interface SettingsTabEntry {
  readonly buttonEl: HTMLButtonElement;
  readonly tab: SettingsTab;
}

/**
 * Tabbed sections inside a plugin's settings: a row of tab buttons and one panel, which renders only the selected tab.
 * The arrow keys, Home and End move between tabs, as in the WAI-ARIA tabs pattern.
 *
 * ```ts
 * public override display(): void {
 *   this.containerEl.empty();
 *   new SettingsTabs(this.containerEl)
 *     .addTab({ id: 'general', name: 'General', render: (el) => this.renderGeneral(el) })
 *     .addTab({ id: 'advanced', name: 'Advanced', render: (el) => this.renderAdvanced(el) })
 *     .selectTab(this.lastTabId)
 *     .onTabChange((tabId) => {
 *       this.lastTabId = tabId;
 *     });
 * }
 * ```
 *
 * In order to add the styles for the component, use {@link initPluginContext} in your plugin's `onload()` function.
 *
 * Alternatively, you can copy styles from {@link https://unpkg.com/@mnaoumov/obsidian-lib/dist/styles.css}.
 */
export class SettingsTabs {
  /**
   * The panel the selected tab renders into.
   */
  public readonly panelEl: HTMLElement;

  /**
   * The row of tab buttons.
   */
  public readonly tabBarEl: HTMLElement;

  private changeCallback?: (tabId: string) => void;
  private readonly entries: SettingsTabEntry[] = [];
  private selectedTabId: null | string = null;

  /**
   * Creates new settings tabs.
   *
   * @param containerEl - The container element.
   */
  public constructor(containerEl: HTMLElement) {
    addPluginCssClasses(containerEl, CssClass.SettingsTabs);
    this.tabBarEl = containerEl.createDiv({ attr: { role: 'tablist' }, cls: 'settings-tabs-bar' });
    this.tabBarEl.addEventListener('keydown', this.onKeyDown.bind(this));
    this.panelEl = containerEl.createDiv({ attr: { role: 'tabpanel' }, cls: 'settings-tabs-panel' });
  }

  /**
   * Adds a tab. The first tab added is selected.
   *
   * @param tab - The tab.
   * @returns The tabs.
   * @throws If a tab with the same id was already added.
   */
  public addTab(tab: SettingsTab): this {
    if (this.findEntry(tab.id)) {
      throw new Error(`A settings tab with the id ${tab.id} was already added.`);
    }
    const buttonEl = this.tabBarEl.createEl('button', { attr: { 'aria-selected': 'false', 'role': 'tab', 'tabindex': '-1' }, cls: 'settings-tabs-button' });
    if (tab.icon) {
      setIcon(buttonEl.createSpan({ cls: 'settings-tabs-icon' }), tab.icon);
    }
    buttonEl.createSpan({ text: tab.name });
    buttonEl.addEventListener('click', () => {
      this.selectTab(tab.id);
    });
    this.entries.push({ buttonEl, tab });
    if (this.selectedTabId === null) {
      this.selectTab(tab.id);
    }
    return this;
  }

  /**
   * Gets the id of the selected tab.
   *
   * @returns The id, or `null` before any tab is added.
   */
  public getSelectedTabId(): null | string {
    return this.selectedTabId;
  }

  /**
   * Sets the callback to be called when the user selects another tab.
   *
   * @param callback - The callback, given the id of the selected tab.
   * @returns The tabs.
   */
  public onTabChange(callback: (tabId: string) => void): this {
    this.changeCallback = callback;
    return this;
  }

  /**
   * Selects a tab and renders it into the panel. An unknown id, such as a stored id whose tab was since removed, leaves
   * the selection as it is.
   *
   * @param tabId - The id of the tab.
   * @returns The tabs.
   */
  public selectTab(tabId: null | string | undefined): this {
    const entry = this.findEntry(tabId);
    if (!entry) {
      return this;
    }
    const { tab } = entry;
    const isChange = this.selectedTabId !== null && this.selectedTabId !== tab.id;
    this.selectedTabId = tab.id;
    for (const { buttonEl, tab: candidate } of this.entries) {
      const isSelected = candidate === tab;
      buttonEl.toggleClass(CssClass.IsActive, isSelected);
      buttonEl.setAttribute('aria-selected', String(isSelected));
      buttonEl.setAttribute('tabindex', isSelected ? '0' : '-1');
    }
    this.panelEl.empty();
    tab.render(this.panelEl);
    if (isChange) {
      this.changeCallback?.(tab.id);
    }
    return this;
  }

  private findEntry(tabId: null | string | undefined): null | SettingsTabEntry {
    return this.entries.find((entry) => entry.tab.id === tabId) ?? null;
  }

  private onKeyDown(event_: KeyboardEvent): void {
    const count = this.entries.length;
    const index = this.entries.findIndex((entry) => entry.tab.id === this.selectedTabId);
    let nextIndex: number;
    switch (event_.key) {
      case 'ArrowLeft': {
        nextIndex = (index - 1 + count) % count;
        break;
      }
      case 'ArrowRight': {
        nextIndex = (index + 1) % count;
        break;
      }
      case 'End': {
        nextIndex = count - 1;
        break;
      }
      case 'Home': {
        nextIndex = 0;
        break;
      }
      default: {
        return;
      }
    }
    const nextEntry = this.entries[nextIndex];
    if (!nextEntry) {
      return;
    }
    event_.preventDefault();
    this.selectTab(nextEntry.tab.id);
    nextEntry.buttonEl.focus();
  }
}
