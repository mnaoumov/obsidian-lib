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

import { OpenSettingsCommandHandler } from './open-settings-command-handler.ts';

interface CreateHandlerResult {
  readonly handler: OpenSettingsCommandHandler;
  readonly open: ReturnType<typeof vi.fn>;
  readonly openTabById: ReturnType<typeof vi.fn>;
}

describe('OpenSettingsCommandHandler', () => {
  function createHandler(): CreateHandlerResult {
    const settingTab = strictProxy<SettingTabOriginal>({ id: 'my-plugin' });
    const open = vi.fn();
    const openTabById = vi.fn().mockReturnValue(settingTab);
    const app = strictProxy<AppOriginal>({
      // Cast: `openTabById` is overloaded, and a plain mock cannot satisfy an overload set.
      setting: castTo<AppOriginal['setting']>({ activeTab: null, open, openTabById })
    });
    const handler = new OpenSettingsCommandHandler({
      app,
      settingTab
    });
    return { handler, open, openTabById };
  }

  it('should build a command with checkCallback', () => {
    const { handler } = createHandler();
    const command = handler.buildCommand();
    expect(command.id).toBe('open-settings');
    expect(command.name).toBe('Open settings');
    expect(command.icon).toBe('settings');
    expect(command.checkCallback).toBeTypeOf('function');
  });

  it('should open Settings on the plugin tab when executed', () => {
    const { handler, open, openTabById } = createHandler();
    handler.execute();
    expect(open).toHaveBeenCalled();
    expect(openTabById).toHaveBeenCalledWith('my-plugin');
  });

  it('should execute via checkCallback with checking=false', () => {
    const { handler, open } = createHandler();
    const command = handler.buildCommand();
    const result = command.checkCallback?.(false);
    expect(result).toBe(true);
    expect(open).toHaveBeenCalled();
  });

  it('should return true from checkCallback with checking=true without executing', () => {
    const { handler, open } = createHandler();
    const command = handler.buildCommand();
    const result = command.checkCallback?.(true);
    expect(result).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
