/**
 * @file
 *
 * Helpers for Obsidian's Settings modal.
 */

import type {
  App,
  SettingTab
} from 'obsidian';

/**
 * Parameters for {@link openSettingTab}.
 */
export interface OpenSettingTabParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;

  /**
   * The id of the tab to open: a plugin's id for its own tab, or a core tab id such as `'hotkeys'`.
   */
  readonly tabId: string;
}

/**
 * Opens Settings on a tab, without opening that tab a second time when it is already the active one.
 *
 * Opening a tab hides the active tab and renders the new one, so opening the tab that is already shown
 * runs its `display()` again for nothing, and a tab whose mount logic does not expect that can break.
 * Settings re-opens its last tab by itself when it opens on desktop and tablet, but not on a phone, where
 * it shows the tab list instead. So the check is on the tab that is active after Settings opened, not on
 * the last tab id, which on a phone would leave the user on the list.
 *
 * @param params - The parameters.
 * @returns The tab now shown, or `null` when no tab has that id.
 */
export function openSettingTab(params: OpenSettingTabParams): null | SettingTab {
  const { app, tabId } = params;
  app.setting.open();
  const activeTab = app.setting.activeTab;
  return activeTab?.id === tabId ? activeTab : app.setting.openTabById(tabId);
}
