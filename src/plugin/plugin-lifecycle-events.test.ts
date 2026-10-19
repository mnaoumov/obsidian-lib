/**
 * @file
 *
 * Tests for the plugin lifecycle broadcast.
 */

import type { App as AppOriginal } from 'obsidian';

import {
  App,
  Component
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { PluginLifecycleEventPayload } from './plugin-lifecycle-events.ts';

import { resetObsidianDevUtilsState } from '../obsidian-dev-utils-state.ts';
import {
  LEGACY_PLUGIN_LOADED_EVENT_NAME,
  LEGACY_PLUGIN_UNLOADED_EVENT_NAME,
  PLUGIN_LOADED_EVENT_NAME,
  PLUGIN_UNLOADED_EVENT_NAME,
  registerPluginLifecycleEventRelay,
  triggerPluginLifecycleEvent
} from './plugin-lifecycle-events.ts';

const PAYLOAD: PluginLifecycleEventPayload = {
  apiVersions: ['1.0.0'],
  dependencyPluginIds: ['required-plugin'],
  pluginId: 'host-plugin',
  pluginName: 'Host Plugin',
  pluginVersion: '2.3.4'
};

let app: AppOriginal;

beforeEach(() => {
  app = App.createConfigured__().asOriginalType__();
});

describe('event names', () => {
  it('should namespace on the package name, so a plugin author who does not use this library can recognize them', () => {
    expect(PLUGIN_LOADED_EVENT_NAME).toBe('obsidian-lib:plugin-loaded');
    expect(PLUGIN_UNLOADED_EVENT_NAME).toBe('obsidian-lib:plugin-unloaded');
  });

  it('should keep the legacy names older copies emit and listen on', () => {
    expect(LEGACY_PLUGIN_LOADED_EVENT_NAME).toBe('obsidian-dev-utils:plugin-loaded');
    expect(LEGACY_PLUGIN_UNLOADED_EVENT_NAME).toBe('obsidian-dev-utils:plugin-unloaded');
  });
});

describe('interop with older copies', () => {
  afterEach(() => {
    resetObsidianDevUtilsState();
  });

  function registerRelay(): Component {
    const component = new Component();
    component.load();
    registerPluginLifecycleEventRelay({ app, component: component.asOriginalType__() });
    return component;
  }

  it('should let an older-style listener on the legacy name hear a current copy', () => {
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(LEGACY_PLUGIN_LOADED_EVENT_NAME, callback);

    triggerPluginLifecycleEvent({ app, name: PLUGIN_LOADED_EVENT_NAME, payload: PAYLOAD });

    expect(callback).toHaveBeenCalledExactlyOnceWith(PAYLOAD);
  });

  it('should relay an older copy, which emits only the legacy name, to a listener on the current name', () => {
    registerRelay();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, PAYLOAD);

    expect(callback).toHaveBeenCalledExactlyOnceWith(PAYLOAD);
  });

  it('should relay the unloaded event of a payload already relayed as loaded', () => {
    registerRelay();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_UNLOADED_EVENT_NAME, callback);

    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, PAYLOAD);
    app.workspace.trigger(LEGACY_PLUGIN_UNLOADED_EVENT_NAME, PAYLOAD);

    expect(callback).toHaveBeenCalledExactlyOnceWith(PAYLOAD);
  });

  it('should not announce a current copy twice to a listener on the current name', () => {
    registerRelay();
    registerRelay();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    triggerPluginLifecycleEvent({ app, name: PLUGIN_LOADED_EVENT_NAME, payload: PAYLOAD });

    expect(callback).toHaveBeenCalledExactlyOnceWith(PAYLOAD);
  });

  it('should relay an older copy once however many current copies relay it', () => {
    registerRelay();
    registerRelay();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, PAYLOAD);

    expect(callback).toHaveBeenCalledExactlyOnceWith(PAYLOAD);
  });

  it('should stop relaying once the owning component unloads', () => {
    const component = registerRelay();
    component.unload();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, PAYLOAD);

    expect(callback).not.toHaveBeenCalled();
  });

  it('should ignore a legacy event carrying no payload object', () => {
    registerRelay();
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, null);
    app.workspace.trigger(LEGACY_PLUGIN_LOADED_EVENT_NAME, 'not a payload');

    expect(callback).not.toHaveBeenCalled();
  });
});

describe('triggerPluginLifecycleEvent', () => {
  it('should deliver the loaded payload to a workspace subscriber', () => {
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, callback);

    triggerPluginLifecycleEvent({
      app,
      name: PLUGIN_LOADED_EVENT_NAME,
      payload: PAYLOAD
    });

    expect(callback).toHaveBeenCalledWith(PAYLOAD);
  });

  it('should deliver the unloaded payload to a workspace subscriber', () => {
    const callback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_UNLOADED_EVENT_NAME, callback);

    triggerPluginLifecycleEvent({
      app,
      name: PLUGIN_UNLOADED_EVENT_NAME,
      payload: PAYLOAD
    });

    expect(callback).toHaveBeenCalledWith(PAYLOAD);
  });

  it('should keep the two events apart, so a listener for one never hears the other', () => {
    const loadedCallback = vi.fn<(payload: PluginLifecycleEventPayload) => void>();
    app.workspace.on(PLUGIN_LOADED_EVENT_NAME, loadedCallback);

    triggerPluginLifecycleEvent({
      app,
      name: PLUGIN_UNLOADED_EVENT_NAME,
      payload: PAYLOAD
    });

    expect(loadedCallback).not.toHaveBeenCalled();
  });
});
