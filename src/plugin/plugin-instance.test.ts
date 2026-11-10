// @vitest-environment jsdom

/**
 * @file
 *
 * Tests for the plugin instance helpers.
 */

import type {
  App as AppOriginal,
  Notice,
  Plugin as PluginOriginal
} from 'obsidian';
import type { ButtonComponent } from 'obsidian-test-mocks/obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { mockImplementation } from '@mnaoumov/typescript-test-toolkit/mock-implementation';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  ButtonComponent as ButtonComponentOriginal,
  Component,
  Events
} from 'obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginNoticeComponent } from '../components/plugin-notice-component.ts';

import { PluginEnableRefusedError } from '../community-plugins.ts';
import {
  getLoadedPlugin,
  getPluginAvailability,
  PluginAvailability,
  PluginInstanceUnavailableError,
  requirePlugin,
  waitForPlugin
} from './plugin-instance.ts';
import { PLUGIN_LOADED_EVENT_NAME } from './plugin-lifecycle-events.ts';

interface FakePlugin extends PluginOriginal {
  readonly marker?: string;
}

interface MarkedPlugin extends PluginOriginal {
  readonly marker: string;
}

interface NoticeComponentContext {
  readonly hide: ReturnType<typeof vi.fn>;
  readonly messages: string[];
  readonly pluginNoticeComponent: PluginNoticeComponent;
}

interface Vault {
  readonly app: AppOriginal;
  readonly enabledPlugins: Set<string>;
  readonly finishLayout: () => void;
  readonly install: (version?: string) => void;
  readonly load: (version?: string, extra?: Partial<FakePlugin>) => FakePlugin;
  readonly plugins: Events;
  readonly setLayoutReady: (isReady: boolean) => void;
  readonly setLoadingPluginId: (value: null | string) => void;
  readonly workspace: Events;
}

const PLUGIN_ID = 'required-plugin';
const PLUGIN_NAME = 'Required Plugin';
const REQUESTING_PLUGIN_NAME = 'Requesting Plugin';

const {
  mockInstallAndEnablePlugin,
  mockOpenSettingTab,
  mockUpdatePlugin
} = vi.hoisted(() => ({
  mockInstallAndEnablePlugin: vi.fn(),
  mockOpenSettingTab: vi.fn(),
  mockUpdatePlugin: vi.fn()
}));

vi.mock('./plugin-install-state.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./plugin-install-state.ts')>(),
  installAndEnablePlugin: mockInstallAndEnablePlugin,
  updatePlugin: mockUpdatePlugin
}));

vi.mock('../settings-modal.ts', () => ({
  openSettingTab: mockOpenSettingTab
}));

const buttonInstances: ButtonComponentOriginal[] = [];

let vault: Vault;
let enablePluginAndSave: ReturnType<typeof vi.fn<(pluginId: string) => Promise<boolean>>>;

beforeEach(() => {
  vi.clearAllMocks();
  mockInstallAndEnablePlugin.mockResolvedValue(undefined);
  mockUpdatePlugin.mockResolvedValue(undefined);
  buttonInstances.length = 0;
  mockImplementation({
    $object: ButtonComponentOriginal.prototype,
    impl: function impl(this: ButtonComponentOriginal, originalImplementation, containerEl: HTMLElement): ButtonComponentOriginal {
      originalImplementation.call(this, containerEl);
      buttonInstances.push(this);
      return this;
    },
    method: 'constructor2__'
  });
  enablePluginAndSave = vi.fn<(pluginId: string) => Promise<boolean>>().mockResolvedValue(true);
  vault = createVault();
});

afterEach(() => {
  vi.useRealTimers();
});

function clickButton(text: string): void {
  const button = buttonInstances.find((candidate) => candidate.buttonEl.textContent === text);
  if (!button) {
    throw new Error(`No button "${text}" among ${buttonInstances.map((candidate) => candidate.buttonEl.textContent).join(', ')}.`);
  }
  castTo<ButtonComponent>(button).simulateClick__();
}

function createNoticeComponent(): NoticeComponentContext {
  const messages: string[] = [];
  const hide = vi.fn();
  const showNotice = vi.fn((message: DocumentFragment | string) => {
    messages.push(typeof message === 'string' ? message : message.textContent);
    return castTo<Notice>({ hide });
  });
  return {
    hide,
    messages,
    pluginNoticeComponent: strictProxy<PluginNoticeComponent>({ showNotice })
  };
}

function createVault(): Vault {
  const enabledPlugins = new Set<string>();
  const manifests: AppOriginal['plugins']['manifests'] = {};
  Object.setPrototypeOf(manifests, null);
  const instances = new Map<string, FakePlugin>();
  const plugins = new Events();
  const workspace = new Events();
  const layoutReadyCallbacks: (() => void)[] = [];
  let isLayoutReady = true;
  let loadingPluginId: null | string = null;

  function install(version = '1.0.0'): void {
    manifests[PLUGIN_ID] = strictProxy<PluginOriginal['manifest']>({ id: PLUGIN_ID, version });
  }

  Object.assign(plugins, {
    enabledPlugins,
    enablePluginAndSave,
    getPlugin: (pluginId: string): FakePlugin | null => instances.get(pluginId) ?? null,
    manifests
  });
  Object.defineProperty(plugins, 'loadingPluginId', { get: () => loadingPluginId });
  Object.defineProperty(workspace, 'layoutReady', { get: () => isLayoutReady });
  Object.assign(workspace, {
    onLayoutReady: (callback: () => void): void => {
      if (isLayoutReady) {
        callback();
        return;
      }
      layoutReadyCallbacks.push(callback);
    }
  });

  return {
    app: castTo<AppOriginal>({ plugins, workspace }),
    enabledPlugins,
    finishLayout(): void {
      isLayoutReady = true;
      for (const callback of layoutReadyCallbacks.splice(0)) {
        callback();
      }
    },
    install,
    load(version = '1.0.0', extra = {}): FakePlugin {
      install(version);
      enabledPlugins.add(PLUGIN_ID);
      const plugin = castTo<FakePlugin>({
        manifest: { id: PLUGIN_ID, version },
        ...extra
      });
      instances.set(PLUGIN_ID, plugin);
      return plugin;
    },
    plugins,
    setLayoutReady(isReady: boolean): void {
      isLayoutReady = isReady;
    },
    setLoadingPluginId(value: null | string): void {
      loadingPluginId = value;
    },
    workspace
  };
}
function isMarkedPlugin(plugin: PluginOriginal): plugin is MarkedPlugin {
  return typeof (plugin as Partial<MarkedPlugin>).marker === 'string';
}

async function settle(): Promise<void> {
  await noopAsync();
  await noopAsync();
}

describe('getPluginAvailability', () => {
  it('should report a plugin that is not installed', () => {
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.NotInstalled);
  });

  it('should report an installed plugin that is not enabled', () => {
    vault.install();
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.NotEnabled);
  });

  it('should report an enabled plugin with no running instance as not loaded', () => {
    vault.install();
    vault.enabledPlugins.add(PLUGIN_ID);
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.NotLoaded);
  });

  it('should report an instance whose onload is still running as loading', () => {
    vault.load();
    vault.setLoadingPluginId(PLUGIN_ID);
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.Loading);
  });

  it('should report a loaded plugin as available', () => {
    vault.load();
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.Available);
  });

  it('should accept a release at or above the minimum', () => {
    vault.load('2.0.0');
    expect(getPluginAvailability({ app: vault.app, minPluginVersion: '2.0.0', pluginId: PLUGIN_ID })).toBe(PluginAvailability.Available);
  });

  it('should report a release below the minimum as outdated', () => {
    vault.load('1.9.9');
    expect(getPluginAvailability({ app: vault.app, minPluginVersion: '2.0.0', pluginId: PLUGIN_ID })).toBe(PluginAvailability.Outdated);
  });

  it('should report an unparseable release as an invalid version', () => {
    vault.load('');
    expect(getPluginAvailability({ app: vault.app, minPluginVersion: '2.0.0', pluginId: PLUGIN_ID })).toBe(PluginAvailability.InvalidVersion);
  });

  it('should ignore the release when no minimum is declared', () => {
    vault.load('');
    expect(getPluginAvailability({ app: vault.app, pluginId: PLUGIN_ID })).toBe(PluginAvailability.Available);
  });

  it('should report an instance failing the guard as a shape mismatch', () => {
    vault.load();
    expect(getPluginAvailability({ app: vault.app, isPlugin: isMarkedPlugin, pluginId: PLUGIN_ID })).toBe(PluginAvailability.ShapeMismatch);
  });

  it('should accept an instance passing the guard', () => {
    vault.load('1.0.0', { marker: 'x' });
    expect(getPluginAvailability({ app: vault.app, isPlugin: isMarkedPlugin, pluginId: PLUGIN_ID })).toBe(PluginAvailability.Available);
  });
});

describe('getLoadedPlugin', () => {
  it('should return the instance when it is available', () => {
    const plugin = vault.load('1.0.0', { marker: 'x' });
    const loaded = getLoadedPlugin<MarkedPlugin>({ app: vault.app, isPlugin: isMarkedPlugin, pluginId: PLUGIN_ID });
    expect(loaded).toBe(plugin);
    expect(loaded?.marker).toBe('x');
  });

  it('should return null for an instance still loading', () => {
    vault.load();
    vault.setLoadingPluginId(PLUGIN_ID);
    expect(getLoadedPlugin({ app: vault.app, pluginId: PLUGIN_ID })).toBeNull();
  });
});

describe('waitForPlugin', () => {
  it('should resolve at once with an instance that is already available', async () => {
    const plugin = vault.load();
    await expect(waitForPlugin({ app: vault.app, pluginId: PLUGIN_ID })).resolves.toBe(plugin);
  });

  it('should resolve when app.plugins reports a change that made it available', async () => {
    vault.install();
    const promise = waitForPlugin({ app: vault.app, pluginId: PLUGIN_ID });
    const plugin = vault.load();
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
  });

  it('should resolve on the library lifecycle broadcast', async () => {
    const promise = waitForPlugin({ app: vault.app, pluginId: PLUGIN_ID });
    const plugin = vault.load();
    vault.workspace.trigger(PLUGIN_LOADED_EVENT_NAME, { pluginId: PLUGIN_ID });
    await expect(promise).resolves.toBe(plugin);
  });

  it('should keep waiting while the instance is still loading', async () => {
    const plugin = vault.load();
    vault.setLoadingPluginId(PLUGIN_ID);
    let isResolved = false;
    const promise = waitForPlugin({ app: vault.app, pluginId: PLUGIN_ID }).then((value) => {
      isResolved = true;
      return value;
    });
    vault.plugins.trigger('changed');
    await settle();
    expect(isResolved).toBe(false);

    vault.setLoadingPluginId(null);
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
  });

  it('should reject with the availability at the moment the timeout elapses', async () => {
    vi.useFakeTimers();
    vault.load('1.0.0');
    const promise = waitForPlugin({ app: vault.app, minPluginVersion: '2.0.0', pluginId: PLUGIN_ID, timeoutInMilliseconds: 100 });
    const assertion = expect(promise).rejects.toMatchObject({
      availability: PluginAvailability.Outdated,
      name: 'PluginInstanceUnavailableError',
      pluginId: PLUGIN_ID
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    await expect(promise).rejects.toBeInstanceOf(PluginInstanceUnavailableError);
  });

  it('should time out after ten seconds by default', async () => {
    vi.useFakeTimers();
    const promise = waitForPlugin({ app: vault.app, pluginId: PLUGIN_ID });
    const assertion = expect(promise).rejects.toMatchObject({ availability: PluginAvailability.NotInstalled });
    let isSettled = false;
    promise.catch(() => {
      isSettled = true;
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(isSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('should reject with the abort reason', async () => {
    const abortController = new AbortController();
    const promise = waitForPlugin({ abortSignal: abortController.signal, app: vault.app, pluginId: PLUGIN_ID });
    const reason = new Error('stop');
    abortController.abort(reason);
    await expect(promise).rejects.toBe(reason);
  });

  it('should wrap an abort reason that is not an error', async () => {
    const abortController = new AbortController();
    const promise = waitForPlugin({ abortSignal: abortController.signal, app: vault.app, pluginId: PLUGIN_ID });
    abortController.abort('stop');
    await expect(promise).rejects.toMatchObject({ cause: 'stop', message: 'stop' });
  });

  it('should reject at once when already aborted', async () => {
    const reason = new Error('already');
    await expect(waitForPlugin({ abortSignal: AbortSignal.abort(reason), app: vault.app, pluginId: PLUGIN_ID })).rejects.toBe(reason);
  });

  it('should reject when its component unloads', async () => {
    const component = new Component();
    component.load();
    const promise = waitForPlugin({ app: vault.app, component, pluginId: PLUGIN_ID });
    component.unload();
    await expect(promise).rejects.toThrow('ended because its component unloaded');
  });

  it('should remove every listener and its child component once settled', async () => {
    const component = new Component();
    component.load();
    const offPlugins = vi.spyOn(vault.plugins, 'offref');
    const offWorkspace = vi.spyOn(vault.workspace, 'offref');
    const removeChild = vi.spyOn(component, 'removeChild');
    const promise = waitForPlugin({ app: vault.app, component, pluginId: PLUGIN_ID });
    vault.load();
    vault.plugins.trigger('changed');
    await promise;
    expect(offPlugins).toHaveBeenCalledTimes(1);
    expect(offWorkspace).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);

    // A later unload of the consumer is no longer a rejection of anything.
    component.unload();
  });

  it('should ignore a change after it settled', async () => {
    const abortController = new AbortController();
    const promise = waitForPlugin({ abortSignal: abortController.signal, app: vault.app, pluginId: PLUGIN_ID });
    abortController.abort(new Error('stop'));
    await expect(promise).rejects.toThrow('stop');
    vault.load();
    vault.plugins.trigger('changed');
  });
});

describe('requirePlugin', () => {
  it('should resolve at once without a notice when the plugin is available', async () => {
    const plugin = vault.load();
    const { messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    await expect(requirePlugin({
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    })).resolves.toBe(plugin);
    expect(messages).toEqual([]);
  });

  it('should hold its notice until layout-ready, then offer an install', async () => {
    vault.setLayoutReady(false);
    const { hide, messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });
    expect(messages).toEqual([]);

    vault.finishLayout();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('which is not installed');

    clickButton('Install and enable');
    await settle();
    expect(mockInstallAndEnablePlugin).toHaveBeenCalledWith(expect.objectContaining({ pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME }));

    const plugin = vault.load();
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('should not speak at layout-ready when it settled before', async () => {
    vault.setLayoutReady(false);
    const { messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });
    vault.load();
    vault.plugins.trigger('changed');
    await promise;
    vault.finishLayout();
    expect(messages).toEqual([]);
  });

  it('should follow the state as it changes and not repeat an unchanged one', async () => {
    vault.install();
    const { hide, messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      minPluginVersion: '2.0.0',
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('installed but not enabled');

    vault.plugins.trigger('changed');
    expect(messages).toHaveLength(1);

    clickButton('Enable');
    await settle();
    expect(mockInstallAndEnablePlugin).toHaveBeenCalledTimes(1);

    vault.load('1.0.0');
    vault.setLoadingPluginId(PLUGIN_ID);
    vault.plugins.trigger('changed');
    expect(messages).toHaveLength(1);

    vault.setLoadingPluginId(null);
    vault.plugins.trigger('changed');
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain('2.0.0 or newer');
    expect(hide).toHaveBeenCalledTimes(1);

    clickButton(`Update ${PLUGIN_NAME}`);
    await settle();
    expect(mockUpdatePlugin).toHaveBeenCalledWith(expect.objectContaining({ pluginId: PLUGIN_ID, requestingPluginName: REQUESTING_PLUGIN_NAME }));

    const plugin = vault.load('2.0.0');
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it('should explain an invalid version and a shape mismatch, and open the community plugins tab', async () => {
    vault.load('');
    const { messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      isPlugin: isMarkedPlugin,
      minPluginVersion: '2.0.0',
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });
    expect(messages[0]).toContain('cannot be read');

    vault.load('2.0.0');
    vault.plugins.trigger('changed');
    expect(messages[1]).toContain('not in a form');

    clickButton('Open community plugins');
    expect(mockOpenSettingTab).toHaveBeenCalledWith({ app: vault.app, tabId: 'community-plugins' });

    component.unload();
    await expect(promise).rejects.toThrow('component unloaded');
  });

  it('should load a plugin enabled in the configuration but not running', async () => {
    vault.install();
    vault.enabledPlugins.add(PLUGIN_ID);
    const { messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });
    expect(messages[0]).toContain('did not load');

    clickButton(`Enable ${PLUGIN_NAME}`);
    await settle();
    expect(enablePluginAndSave).toHaveBeenCalledWith(PLUGIN_ID);

    const plugin = vault.load();
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
  });

  it('should report a refused enable and keep waiting', async () => {
    vi.useFakeTimers();
    enablePluginAndSave.mockResolvedValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vault.install();
    vault.enabledPlugins.add(PLUGIN_ID);
    const { messages, pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME,
      timeoutInMilliseconds: 1000
    });
    const assertion = expect(promise).rejects.toMatchObject({ availability: PluginAvailability.NotLoaded });

    clickButton(`Enable ${PLUGIN_NAME}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(messages[1]).toContain('Failed to enable');
    expect(consoleError).toHaveBeenCalledWith(expect.any(PluginEnableRefusedError));

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('should keep waiting when an install fails', async () => {
    mockInstallAndEnablePlugin.mockRejectedValue(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const abortController = new AbortController();
    const { pluginNoticeComponent } = createNoticeComponent();
    const component = new Component();
    component.load();
    const promise = requirePlugin({
      abortSignal: abortController.signal,
      app: vault.app,
      component,
      pluginId: PLUGIN_ID,
      pluginName: PLUGIN_NAME,
      pluginNoticeComponent,
      requestingPluginName: REQUESTING_PLUGIN_NAME
    });

    clickButton('Install and enable');
    await settle();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));

    const plugin = vault.load();
    vault.plugins.trigger('changed');
    await expect(promise).resolves.toBe(plugin);
  });
});
