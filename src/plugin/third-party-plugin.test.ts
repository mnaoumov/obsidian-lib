// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for the third-party plugin adapters.
 */

import type {
  App as AppOriginal,
  Plugin as PluginOriginal
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Component,
  Events
} from 'obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginNoticeComponent } from '../components/plugin-notice-component.ts';
import type { ThirdPartyPluginAdapter } from './third-party-plugin.ts';

import { PluginAvailability } from './plugin-instance.ts';
import {
  PLUGIN_LOADED_EVENT_NAME,
  PLUGIN_UNLOADED_EVENT_NAME
} from './plugin-lifecycle-events.ts';
import {
  createThirdPartyPluginDependency,
  getThirdPartyPluginApi,
  getThirdPartyPluginAvailability,
  isThirdPartyPluginDependency,
  requireThirdPartyPluginApi,
  waitForThirdPartyPluginApi,
  watchThirdPartyPluginApi
} from './third-party-plugin.ts';

interface FakeApi {
  readonly greet: () => string;
}

interface Vault {
  readonly app: AppOriginal;
  readonly load: (version?: string, extra?: object) => PluginOriginal;
  readonly plugins: Events;
  readonly unload: () => void;
  readonly workspace: Events;
}

const PLUGIN_ID = 'third-party';
const PLUGIN_NAME = 'Third Party';

const ADAPTER: ThirdPartyPluginAdapter<FakeApi> = {
  getApi: (plugin) => {
    if (!('api' in plugin)) {
      return null;
    }
    const api: unknown = plugin.api;
    return typeof api === 'object' && api !== null && 'greet' in api && typeof api.greet === 'function' ? castTo<FakeApi>(api) : null;
  },
  pluginId: PLUGIN_ID,
  pluginName: PLUGIN_NAME
};

const API: FakeApi = { greet: () => 'hello' };

let vault: Vault;

beforeEach(() => {
  vault = createVault();
});

function createVault(): Vault {
  const enabledPlugins = new Set<string>();
  const manifests: AppOriginal['plugins']['manifests'] = {};
  Object.setPrototypeOf(manifests, null);
  const instances = new Map<string, PluginOriginal>();
  const plugins = new Events();
  const workspace = new Events();

  Object.assign(plugins, {
    enabledPlugins,
    getPlugin: (pluginId: string): null | PluginOriginal => instances.get(pluginId) ?? null,
    loadingPluginId: null,
    manifests
  });
  Object.assign(workspace, { layoutReady: true });

  return {
    app: castTo<AppOriginal>({ plugins, workspace }),
    load(version = '1.0.0', extra?: object): PluginOriginal {
      manifests[PLUGIN_ID] = strictProxy<PluginOriginal['manifest']>({ id: PLUGIN_ID, version });
      enabledPlugins.add(PLUGIN_ID);
      const plugin = castTo<PluginOriginal>({ manifest: { id: PLUGIN_ID, version }, ...(extra ?? { api: API }) });
      instances.set(PLUGIN_ID, plugin);
      return plugin;
    },
    plugins,
    unload(): void {
      instances.delete(PLUGIN_ID);
    },
    workspace
  };
}

describe('getThirdPartyPluginApi', () => {
  it('should return null when the plugin is not installed', () => {
    expect(getThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app })).toBeNull();
    expect(getThirdPartyPluginAvailability({ adapter: ADAPTER, app: vault.app })).toBe(PluginAvailability.NotInstalled);
  });

  it('should return the typed API of a loaded plugin', () => {
    vault.load();
    expect(getThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app })?.greet()).toBe('hello');
  });

  it('should report a shape the adapter does not recognize', () => {
    vault.load('1.0.0', { api: {} });
    expect(getThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app })).toBeNull();
    expect(getThirdPartyPluginAvailability({ adapter: ADAPTER, app: vault.app })).toBe(PluginAvailability.ShapeMismatch);
  });

  it('should apply the adapter minimum version', () => {
    vault.load('1.0.0');
    const adapter = { ...ADAPTER, minPluginVersion: '2.0.0' };
    expect(getThirdPartyPluginAvailability({ adapter, app: vault.app })).toBe(PluginAvailability.Outdated);
    expect(getThirdPartyPluginApi({ adapter, app: vault.app })).toBeNull();
  });

  it('should let the caller override the adapter minimum version', () => {
    vault.load('1.0.0');
    const adapter = { ...ADAPTER, minPluginVersion: '2.0.0' };
    expect(getThirdPartyPluginAvailability({ adapter, app: vault.app, minPluginVersion: '0.5.0' })).toBe(PluginAvailability.Available);
  });
});

describe('watchThirdPartyPluginApi', () => {
  it('should follow the plugin through load and unload', () => {
    const component = new Component();
    component.load();
    const ref = watchThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app, component });
    const onChange = vi.fn();
    ref.on('change', onChange);

    expect(ref.value).toBeNull();
    expect(ref.availability).toBe(PluginAvailability.NotInstalled);

    vault.load();
    vault.plugins.trigger('changed');
    expect(ref.value?.greet()).toBe('hello');
    expect(ref.availability).toBe(PluginAvailability.Available);
    expect(onChange).toHaveBeenCalledTimes(1);

    vault.workspace.trigger(PLUGIN_LOADED_EVENT_NAME, { pluginId: PLUGIN_ID });
    expect(onChange).toHaveBeenCalledTimes(1);

    vault.unload();
    vault.workspace.trigger(PLUGIN_UNLOADED_EVENT_NAME, { pluginId: PLUGIN_ID });
    expect(ref.value).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('should stop watching when its component unloads', () => {
    const component = new Component();
    component.load();
    const ref = watchThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app, component });
    component.unload();

    vault.load();
    vault.plugins.trigger('changed');
    expect(ref.value).toBeNull();
  });
});

describe('waitForThirdPartyPluginApi', () => {
  it('should resolve with the typed API', async () => {
    vault.load();
    const api = await waitForThirdPartyPluginApi({ adapter: ADAPTER, app: vault.app });
    expect(api.greet()).toBe('hello');
  });

  it('should fail by name when the adapter stops recognizing the instance after the check', async () => {
    vault.load();
    let calls = 0;
    const flakyAdapter: ThirdPartyPluginAdapter<FakeApi> = {
      ...ADAPTER,
      getApi: (plugin) => {
        calls++;
        return calls === 1 ? ADAPTER.getApi(plugin) : null;
      }
    };
    await expect(waitForThirdPartyPluginApi({ adapter: flakyAdapter, app: vault.app })).rejects.toThrow(
      `The plugin "${PLUGIN_ID}" does not expose the API its adapter expects.`
    );
  });
});

describe('requireThirdPartyPluginApi', () => {
  it('should resolve with the typed API', async () => {
    vault.load();
    const component = new Component();
    component.load();
    const api = await requireThirdPartyPluginApi({
      adapter: ADAPTER,
      app: vault.app,
      component,
      pluginNoticeComponent: strictProxy<PluginNoticeComponent>({}),
      requestingPluginName: 'Requesting'
    });
    expect(api.greet()).toBe('hello');
  });
});

describe('createThirdPartyPluginDependency', () => {
  it('should copy the adapter identity and minimum version', () => {
    const dependency = createThirdPartyPluginDependency({ adapter: { ...ADAPTER, minPluginVersion: '1.2.0' }, reason: 'why' });
    expect(dependency).toMatchObject({ minPluginVersion: '1.2.0', pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME, reason: 'why' });
    expect(isThirdPartyPluginDependency(dependency)).toBe(true);
  });

  it('should prefer the dependent minimum version and omit an absent one', () => {
    expect(createThirdPartyPluginDependency({ adapter: ADAPTER, minPluginVersion: '3.0.0', reason: 'why' }).minPluginVersion).toBe('3.0.0');
    expect('minPluginVersion' in createThirdPartyPluginDependency({ adapter: ADAPTER, reason: 'why' })).toBe(false);
  });

  it('should not mistake an own-plugin dependency for a third-party one', () => {
    expect(isThirdPartyPluginDependency({ pluginId: 'x', pluginName: 'X', reason: 'why' })).toBe(false);
  });
});
