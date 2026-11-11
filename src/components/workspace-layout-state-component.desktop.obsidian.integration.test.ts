/**
 * @file
 *
 * Integration tests for {@link WorkspaceLayoutStateComponent} against a real Obsidian: values saved with two real
 * saved workspaces of the Workspaces core plugin, in the workspace scope and on a main-window and a popout leaf, are
 * restored when each workspace loads. Desktop-only, because a popout window is part of what is saved.
 */

/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

interface RoundTripResult {
  readonly afterReload: ScopeValues;
  readonly alpha: ScopeValues;
  readonly beta: ScopeValues;
  readonly foreignRecord: unknown;
  readonly hasKeyWithoutInstallation: boolean;
  readonly malformedPluginKept: boolean;
}

interface ScopeValues {
  readonly main: string;
  readonly popout: string;
  readonly workspace: string;
}

describe('WorkspaceLayoutStateComponent', () => {
  it('restores values with each saved workspace, on main-window and popout leaves', async () => {
    const result = await evalInObsidian<Record<string, never>, RoundTripResult>({
      async callback({ app, lib: { castTo, waitUntil, WORKSPACE_LAYOUT_STATE_LAYOUT_KEY, WorkspaceLayoutStateComponent } }): Promise<RoundTripResult> {
        // Under the transport's ~30s per-closure cap, not at it: one 5 s wait for the popout, plus three layout loads.
        const POPOUT_TIMEOUT_IN_MILLISECONDS = 5000;
        const PLUGIN_ID = 'obsidian-lib-layout-state-test';
        const ALPHA = 'layout-state-test-alpha';
        const BETA = 'layout-state-test-beta';

        interface SavedRecord {
          readonly plugins: Record<string, unknown>;
        }

        // TODO: Drop this local shape once obsidian-typings types the Workspaces plugin instance (T6117).
        interface WorkspacesInstance {
          readonly loadWorkspace: (name: string) => Promise<void>;
          readonly saveWorkspace: (name: string) => void;
          readonly workspaces: Record<string, Record<string, unknown>>;
        }

        const workspacesPlugin = app.internalPlugins.getPluginById('workspaces');
        if (!workspacesPlugin) {
          throw new Error('The Workspaces core plugin is missing');
        }
        const wasEnabled = workspacesPlugin.enabled;
        if (!wasEnabled) {
          await workspacesPlugin.enable(true);
        }
        const workspaces = castTo<WorkspacesInstance>(workspacesPlugin.instance);
        const originalLayout = app.workspace.getLayout();

        const component = new WorkspaceLayoutStateComponent({ app, pluginId: PLUGIN_ID });
        component.load();
        const key = component.defineKey({ defaultValue: 'default', key: 'mode' });
        const reloadedComponent = new WorkspaceLayoutStateComponent({ app, pluginId: PLUGIN_ID });

        function getLeafOrThrow(id: string): object & ReturnType<typeof app.workspace.getLeafById> {
          const leaf = app.workspace.getLeafById(id);
          if (!leaf) {
            throw new Error(`Leaf ${id} is missing`);
          }
          return leaf;
        }

        function read(readKey: typeof key, mainId: string, popoutId: string): ScopeValues {
          return { main: readKey.get(getLeafOrThrow(mainId)), popout: readKey.get(getLeafOrThrow(popoutId)), workspace: readKey.get() };
        }

        try {
          const mainLeaf = app.workspace.getLeaf('tab');
          const popoutLeaf = app.workspace.openPopoutLeaf();
          await waitUntil({
            message: 'the popout window opens',
            predicate: () => popoutLeaf.view.containerEl.win !== window,
            timeoutInMilliseconds: POPOUT_TIMEOUT_IN_MILLISECONDS
          });
          const mainId = mainLeaf.id;
          const popoutId = popoutLeaf.id;

          key.set('alpha');
          key.set('alpha-main', mainLeaf);
          key.set('alpha-popout', popoutLeaf);
          workspaces.saveWorkspace(ALPHA);

          key.set('beta');
          key.set('beta-main', mainLeaf);
          key.set('beta-popout', popoutLeaf);
          workspaces.saveWorkspace(BETA);

          // Another plugin's record, and a malformed one, ride in the saved workspace untouched by this plugin.
          const savedAlpha = workspaces.workspaces[ALPHA];
          const savedRecord = castTo<SavedRecord>(savedAlpha?.[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]);
          savedRecord.plugins['other-plugin'] = { leaves: {}, workspace: { width: 300 } };
          savedRecord.plugins['malformed-plugin'] = 'not a record';

          await workspaces.loadWorkspace(ALPHA);
          const alpha = read(key, mainId, popoutId);
          const alphaLayout = app.workspace.getLayout();
          const alphaRecord = castTo<SavedRecord>(alphaLayout[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY]);

          await workspaces.loadWorkspace(BETA);
          const beta = read(key, mainId, popoutId);

          component.unload();
          const hasKeyWithoutInstallation = app.workspace.getLayout()[WORKSPACE_LAYOUT_STATE_LAYOUT_KEY] !== undefined;
          reloadedComponent.load();
          const afterReload = read(reloadedComponent.defineKey({ defaultValue: 'default', key: 'mode' }), mainId, popoutId);

          return {
            afterReload,
            alpha,
            beta,
            foreignRecord: alphaRecord.plugins['other-plugin'],
            hasKeyWithoutInstallation,
            malformedPluginKept: 'malformed-plugin' in alphaRecord.plugins
          };
        } finally {
          key.unset();
          component.unload();
          reloadedComponent.unload();
          Reflect.deleteProperty(workspaces.workspaces, ALPHA);
          Reflect.deleteProperty(workspaces.workspaces, BETA);
          await app.workspace.changeLayout(originalLayout);
          if (!wasEnabled) {
            workspacesPlugin.disable(false);
          }
        }
      }
    });

    expect(result.alpha).toEqual({ main: 'alpha-main', popout: 'alpha-popout', workspace: 'alpha' });
    expect(result.beta).toEqual({ main: 'beta-main', popout: 'beta-popout', workspace: 'beta' });
    expect(result.afterReload).toEqual(result.beta);
    expect(result.foreignRecord).toEqual({ leaves: {}, workspace: { width: 300 } });
    expect(result.malformedPluginKept).toBe(false);
    expect(result.hasKeyWithoutInstallation).toBe(false);
  });
});
