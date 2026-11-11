/**
 * @file
 *
 * Tests for {@link WorkspaceLayoutStateComponent}.
 */

import type {
  App as AppOriginal,
  WorkspaceLeaf as WorkspaceLeafOriginal
} from 'obsidian';
import type { JsonValue } from 'type-fest';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  parseWorkspaceLayoutStateRecord,
  serializeWorkspaceLayoutStateRecord,
  WORKSPACE_LAYOUT_STATE_LAYOUT_KEY,
  WorkspaceLayoutStateComponent
} from './workspace-layout-state-component.ts';

interface ItemsValue {
  readonly items: number[];
}

interface WorkspaceWithLayout {
  readonly getLayout: () => Record<string, unknown>;
  readonly layoutReady: boolean;
  readonly readWorkspaceFile: () => Promise<Record<string, unknown>>;
  readonly setLayout: (layout: Record<string, unknown>) => Promise<void>;
}

const LEAF_A = castTo<WorkspaceLeafOriginal>({ id: 'leaf-a' });
const LEAF_B = castTo<WorkspaceLeafOriginal>({ id: 'leaf-b' });

const LAYOUT_WITH_LEAVES = {
  floating: { children: [{ children: [{ children: [{ id: 'leaf-b', type: 'leaf' }], type: 'tabs' }], type: 'window' }], type: 'floating' },
  left: 'not an item',
  main: { children: [{ children: [{ id: 'leaf-a', type: 'leaf' }, { id: 42, type: 'leaf' }], type: 'tabs' }], type: 'split' }
};

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

describe('WorkspaceLayoutStateComponent', () => {
  let app: AppOriginal;
  let workspace: WorkspaceWithLayout;
  let baseLayout: Record<string, unknown>;
  let savedFile: Record<string, unknown>;
  let setLayoutImpl: () => Promise<void>;
  const components: WorkspaceLayoutStateComponent[] = [];

  function load(pluginId = 'plugin-a'): WorkspaceLayoutStateComponent {
    const component = new WorkspaceLayoutStateComponent({ app, pluginId });
    component.load();
    components.push(component);
    return component;
  }

  beforeEach(() => {
    app = App.createConfigured__().asOriginalType__();
    workspace = castTo<WorkspaceWithLayout>(app.workspace);
    baseLayout = { ...LAYOUT_WITH_LEAVES };
    savedFile = {};
    setLayoutImpl = async (): Promise<void> => {
      await noopAsync();
    };
    Object.assign(workspace, {
      getLayout: (): Record<string, unknown> => ({ ...baseLayout }),
      async readWorkspaceFile(): Promise<Record<string, unknown>> {
        await noopAsync();
        return savedFile;
      },
      async setLayout(): Promise<void> {
        await setLayoutImpl();
      }
    });
    vi.spyOn(app.workspace, 'requestSaveLayout');
  });

  afterEach(() => {
    for (const component of components.splice(0)) {
      component.unload();
    }
  });

  it('rejects an empty plugin id and an empty key', () => {
    expect(() => new WorkspaceLayoutStateComponent({ app, pluginId: '' })).toThrow(TypeError);
    expect(() => load().defineKey({ defaultValue: 1, key: '' })).toThrow(TypeError);
  });

  it('rejects a default or a value that is not JSON-safe', () => {
    const component = load();
    expect(() => component.defineKey({ defaultValue: castTo<JsonValue>(NaN), key: 'k' })).toThrow(TypeError);
    const key = component.defineKey<JsonValue>({ defaultValue: 1, key: 'k' });
    expect(() => {
      key.set(castTo<JsonValue>(new Map()));
    }).toThrow(TypeError);
  });

  it('reads the default, then a stored value, and removes it explicitly', () => {
    const key = load().defineKey({ defaultValue: { size: 1 }, key: 'panel' });
    expect(key.key).toBe('panel');
    expect(key.get()).toEqual({ size: 1 });
    expect(key.has()).toBe(false);

    key.set({ size: 2 });
    expect(key.get()).toEqual({ size: 2 });
    expect(key.has()).toBe(true);
    expect(app.workspace.requestSaveLayout).toHaveBeenCalledTimes(1);

    key.unset();
    expect(key.get()).toEqual({ size: 1 });
    expect(key.has()).toBe(false);
    expect(app.workspace.requestSaveLayout).toHaveBeenCalledTimes(2);
  });

  it('clones on write and on read', () => {
    const value = { items: [1] };
    const key = load().defineKey<ItemsValue>({ defaultValue: { items: [] }, key: 'k' });
    key.set(value);
    value.items.push(2);
    const read = key.get();
    read.items.push(3);
    expect(key.get()).toEqual({ items: [1] });
  });

  it('stores an explicit null as null', () => {
    const key = load().defineKey<JsonValue>({ defaultValue: 'default', key: 'k' });
    key.set(null);
    expect(key.has()).toBe(true);
    expect(key.get()).toBeNull();
  });

  it('reads a value failing the guard as the default and keeps it stored', () => {
    const component = load();
    component.defineKey<JsonValue>({ defaultValue: 0, key: 'count' }).set('not a number');
    const key = component.defineKey({ defaultValue: 0, isValid: isNumber, key: 'count' });
    expect(key.get()).toBe(0);
    expect(key.has()).toBe(true);
  });

  it('keeps leaf scopes and the workspace scope apart', () => {
    const key = load().defineKey({ defaultValue: 0, key: 'k' });
    key.set(1);
    key.set(2, LEAF_A);
    expect(key.get()).toBe(1);
    expect(key.get(LEAF_A)).toBe(2);
    expect(key.get(LEAF_B)).toBe(0);
    key.unset(LEAF_B);
    key.unset(LEAF_A);
    expect(key.has(LEAF_A)).toBe(false);
  });

  it('does nothing when the value does not change', () => {
    const component = load();
    const key = component.defineKey({ defaultValue: 0, key: 'k' });
    const callback = vi.fn();
    key.onChange(callback);
    key.unset();
    key.set(1);
    key.set(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(app.workspace.requestSaveLayout).toHaveBeenCalledTimes(1);
  });

  it('reports changes of its own key and plugin, with the leaf resolved', () => {
    const component = load();
    const other = load('plugin-b');
    const key = component.defineKey({ defaultValue: 0, key: 'k' });
    const sibling = component.defineKey({ defaultValue: 0, key: 'sibling' });
    const otherKey = other.defineKey({ defaultValue: 0, key: 'k' });
    vi.spyOn(app.workspace, 'getLeafById').mockImplementation((id) => id === 'leaf-a' ? LEAF_A : null);
    const callback = vi.fn();
    const unsubscribe = key.onChange(callback);

    sibling.set(5);
    otherKey.set(5);
    key.set(3, LEAF_A);
    key.set(4);
    expect(callback.mock.calls).toEqual([
      [{ leaf: LEAF_A, leafId: 'leaf-a', oldValue: 0, value: 3 }],
      [{ leaf: null, leafId: null, oldValue: 0, value: 4 }]
    ]);

    unsubscribe();
    key.set(5);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('reports changes made through another copy, and isolates a failing listener', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = load();
    const second = load();
    const callback = vi.fn();
    first.defineKey({ defaultValue: 0, key: 'k' }).onChange(() => {
      throw new Error('boom');
    });
    first.defineKey({ defaultValue: 0, key: 'k' }).onChange(callback);
    second.defineKey({ defaultValue: 0, key: 'k' }).set(7);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ value: 7 }));
    expect(consoleError).toHaveBeenCalled();
  });

  it('writes the records into the serialized layout, leaving out leaves no longer there', () => {
    const key = load().defineKey({ defaultValue: 0, key: 'k' });
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toBeUndefined();

    key.set(1);
    key.set(2, LEAF_A);
    key.set(3, LEAF_B);
    key.set(4, castTo<WorkspaceLeafOriginal>({ id: 'closed-leaf' }));
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toEqual({
      plugins: { 'plugin-a': { leaves: { 'leaf-a': { k: 2 }, 'leaf-b': { k: 3 } }, workspace: { k: 1 } } }
    });
  });

  it('replaces the records when a layout loads, and reports the load once the layout is set', async () => {
    const component = load();
    const key = component.defineKey({ defaultValue: 0, key: 'k' });
    key.set(1);
    const events: string[] = [];
    setLayoutImpl = async (): Promise<void> => {
      events.push(`during: ${String(key.get())}`);
      await noopAsync();
    };
    const unsubscribe = component.onLayoutLoad(() => {
      events.push(`after: ${String(key.get(LEAF_A))}`);
    });

    await workspace.setLayout({
      [WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]: { plugins: { 'plugin-a': { leaves: { 'leaf-a': { k: 9 } }, workspace: { k: 8 } } } }
    });
    expect(events).toEqual(['during: 8', 'after: 9']);

    unsubscribe();
    await workspace.setLayout({});
    expect(key.get()).toBe(0);
    expect(events).toEqual(['during: 8', 'after: 9', 'during: 0']);
  });

  it('reports a layout load even when setting the layout fails', async () => {
    const component = load();
    const callback = vi.fn();
    component.onLayoutLoad(callback);
    setLayoutImpl = async (): Promise<void> => {
      await noopAsync();
      throw new Error('broken layout');
    };
    await expect(workspace.setLayout({})).rejects.toThrow('broken layout');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('hydrates once from the saved layout when loaded after layout-ready, keeping values set meanwhile', async () => {
    Object.assign(workspace, { layoutReady: true });
    savedFile = {
      [WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]: {
        plugins: {
          'plugin-a': { leaves: { 'leaf-a': { k: 1 }, 'leaf-b': { k: 2 } }, workspace: { k: 3, other: 4 } },
          'plugin-b': { leaves: {}, workspace: { k: 5 } }
        }
      }
    };
    const component = load();
    const key = component.defineKey({ defaultValue: 0, key: 'k' });
    const loaded = new Promise<void>((resolve) => {
      component.onLayoutLoad(resolve);
    });
    key.set(10);
    key.set(20, LEAF_A);
    await loaded;

    expect(key.get()).toBe(10);
    expect(key.get(LEAF_A)).toBe(20);
    expect(key.get(LEAF_B)).toBe(2);
    expect(component.defineKey({ defaultValue: 0, key: 'other' }).get()).toBe(4);
    expect(load('plugin-b').defineKey({ defaultValue: 0, key: 'k' }).get()).toBe(5);
  });

  it('skips hydration when a layout loaded first, or the installation is gone', async () => {
    Object.assign(workspace, { layoutReady: true });
    savedFile = { [WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]: { plugins: { 'plugin-a': { leaves: {}, workspace: { k: 1 } } } } };
    const component = load();
    const key = component.defineKey({ defaultValue: 0, key: 'k' });
    await workspace.setLayout({});
    await noopAsync();
    await noopAsync();
    expect(key.get()).toBe(0);

    component.unload();
    components.length = 0;
  });

  it('skips hydration when unloaded before the saved layout is read', async () => {
    Object.assign(workspace, { layoutReady: true });
    savedFile = { [WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]: { plugins: { 'plugin-x': { leaves: {}, workspace: { k: 1 } } } } };
    const component = load();
    component.unload();
    components.length = 0;
    await noopAsync();
    await noopAsync();
    expect(load('plugin-x').defineKey({ defaultValue: 0, key: 'k' }).get()).toBe(0);
  });

  it('hands the installation over to the next subscriber, and removes it after the last', async () => {
    const originalGetLayout = workspace.getLayout;
    const first = load();
    const second = load();
    const key = second.defineKey({ defaultValue: 0, key: 'k' });
    key.set(1);

    first.unload();
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toBeDefined();
    second.unload();
    components.length = 0;
    expect(workspace.getLayout).toBe(originalGetLayout);
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toBeUndefined();

    // The records outlive every installation, so a plugin re-enabled in the same session finds them.
    expect(load().defineKey({ defaultValue: 0, key: 'k' }).get()).toBe(1);
    await noopAsync();
  });

  it('reads a layout that is not an object as one without records', async () => {
    const key = load().defineKey({ defaultValue: 0, key: 'k' });
    key.set(1);
    await workspace.setLayout(castTo<Record<string, unknown>>(null));
    expect(key.get()).toBe(0);
  });

  it('cooperates with a second copy of the library loaded as its own module instance', async () => {
    vi.resetModules();
    const secondCopy = await import('./workspace-layout-state-component.ts');
    expect(secondCopy.WorkspaceLayoutStateComponent).not.toBe(WorkspaceLayoutStateComponent);

    const first = load();
    const second = new secondCopy.WorkspaceLayoutStateComponent({ app, pluginId: 'plugin-a' });
    second.load();
    const callback = vi.fn();
    second.defineKey({ defaultValue: 0, key: 'k' }).onChange(callback);

    first.defineKey({ defaultValue: 0, key: 'k' }).set(1);
    expect(second.defineKey({ defaultValue: 0, key: 'k' }).get()).toBe(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ value: 1 }));

    first.unload();
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toEqual({ plugins: { 'plugin-a': { leaves: {}, workspace: { k: 1 } } } });
    second.unload();
  });

  it('unloading a non-owner keeps the installation', () => {
    const first = load();
    const second = load();
    second.unload();
    expect(workspace.getLayout).not.toBe(undefined);
    first.defineKey({ defaultValue: 0, key: 'k' }).set(1);
    expect(workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]).toBeDefined();
  });
});

describe('parseWorkspaceLayoutStateRecord', () => {
  it('reads anything malformed at the top as empty', () => {
    expect(parseWorkspaceLayoutStateRecord(undefined)).toEqual({ plugins: {} });
    expect(parseWorkspaceLayoutStateRecord([1])).toEqual({ plugins: {} });
    expect(parseWorkspaceLayoutStateRecord({ plugins: 'nope' })).toEqual({ plugins: {} });
  });

  it('drops malformed parts one level at a time, and keeps unknown fields', () => {
    const raw = {
      future: { a: 1 },
      plugins: {
        bad: 3,
        good: { extra: true, leaves: { bad: [1], ok: { k: 1 } }, workspace: { k: 2 } },
        partial: { leaves: 'nope', workspace: null }
      }
    };
    const parsed = parseWorkspaceLayoutStateRecord(raw);
    expect(parsed).toEqual({
      future: { a: 1 },
      plugins: {
        good: { extra: true, leaves: { ok: { k: 1 } }, workspace: { k: 2 } },
        partial: { leaves: {}, workspace: {} }
      }
    });
    raw.plugins.good.workspace.k = 99;
    expect(parsed.plugins['good']?.workspace['k']).toBe(2);
  });
});

describe('serializeWorkspaceLayoutStateRecord', () => {
  it('keeps plugins and records that carry unknown fields', () => {
    const record = parseWorkspaceLayoutStateRecord({ future: 1, plugins: { p: { extra: 1, leaves: { gone: { k: 1 } }, workspace: {} } } });
    expect(serializeWorkspaceLayoutStateRecord(record, {})).toEqual({ future: 1, plugins: { p: { extra: 1, leaves: {}, workspace: {} } } });
  });

  it('drops empty plugins and empty leaf buckets, and returns null when nothing is left', () => {
    const record = parseWorkspaceLayoutStateRecord({ plugins: { p: { leaves: { 'leaf-a': {} }, workspace: {} } } });
    expect(serializeWorkspaceLayoutStateRecord(record, LAYOUT_WITH_LEAVES)).toBeNull();
    expect(serializeWorkspaceLayoutStateRecord(record, 'not a layout')).toBeNull();
  });
});
