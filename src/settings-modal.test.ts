import type {
  App as AppOriginal,
  SettingTab as SettingTabOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { openSettingTab } from './settings-modal.ts';

interface CreateAppResult {
  readonly app: AppOriginal;
  readonly open: ReturnType<typeof vi.fn>;
  readonly openTabById: ReturnType<typeof vi.fn>;
}

const PLUGIN_TAB = strictProxy<SettingTabOriginal>({ id: 'my-plugin' });
const OTHER_TAB = strictProxy<SettingTabOriginal>({ id: 'other-plugin' });

function createApp(activeTabAfterOpen: null | SettingTabOriginal, foundTab: null | SettingTabOriginal): CreateAppResult {
  const setting = {
    activeTab: null as null | SettingTabOriginal,
    open: vi.fn(() => {
      setting.activeTab = activeTabAfterOpen;
    }),
    openTabById: vi.fn().mockReturnValue(foundTab)
  };
  // Cast: `openTabById` is overloaded, and a plain mock cannot satisfy an overload set.
  const app = strictProxy<AppOriginal>({ setting: castTo<AppOriginal['setting']>(setting) });
  return { app, open: setting.open, openTabById: setting.openTabById };
}

describe('openSettingTab', () => {
  it('should not open the tab again when Settings re-opened on it', () => {
    const { app, open, openTabById } = createApp(PLUGIN_TAB, PLUGIN_TAB);
    expect(openSettingTab({ app, tabId: 'my-plugin' })).toBe(PLUGIN_TAB);
    expect(open).toHaveBeenCalledOnce();
    expect(openTabById).not.toHaveBeenCalled();
  });

  it('should open the tab when another tab is active', () => {
    const { app, openTabById } = createApp(OTHER_TAB, PLUGIN_TAB);
    expect(openSettingTab({ app, tabId: 'my-plugin' })).toBe(PLUGIN_TAB);
    expect(openTabById).toHaveBeenCalledWith('my-plugin');
  });

  it('should open the tab when no tab is active, as on a phone', () => {
    const { app, openTabById } = createApp(null, PLUGIN_TAB);
    expect(openSettingTab({ app, tabId: 'my-plugin' })).toBe(PLUGIN_TAB);
    expect(openTabById).toHaveBeenCalledWith('my-plugin');
  });

  it('should return null when no tab has the id', () => {
    const { app } = createApp(null, null);
    expect(openSettingTab({ app, tabId: 'missing' })).toBeNull();
  });
});
