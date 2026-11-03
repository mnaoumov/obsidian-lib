/// <reference types="obsidian-integration-testing/vitest/typings" />

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('GitHub community commands', () => {
  it('should execute registered feature and discussion commands and hide disabled Discussions', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { OpenDiscussionCommandHandler, OpenFeatureRequestCommandHandler, waitUntil } }) {
        const pluginId = 'obsidian-lib-integration-test';
        const plugin = app.plugins.getPlugin(pluginId);
        if (!plugin) {
          throw new Error('Integration plugin is not loaded');
        }
        const urls: string[] = [];
        const originalOpen = window.open;
        // Capture the external-navigation boundary so the test does not launch the user's browser.
        window.open = (url): null => {
          urls.push(String(url));
          return null;
        };
        const feature = new OpenFeatureRequestCommandHandler({ app, gitHubRepo: 'owner/repo', pluginId });
        const discussion = new OpenDiscussionCommandHandler({ gitHubRepo: 'owner/repo', isDiscussionsEnabled: true });
        const disabled = new OpenDiscussionCommandHandler({ gitHubRepo: 'owner/repo', isDiscussionsEnabled: false });
        const featureCommand = plugin.addCommand(feature.buildCommand());
        const discussionCommand = plugin.addCommand(discussion.buildCommand());
        try {
          const isFeatureExecuted = app.commands.executeCommandById(featureCommand.id);
          const isDiscussionExecuted = app.commands.executeCommandById(discussionCommand.id);
          await waitUntil({ message: 'Both community commands open their URLs', predicate: () => urls.length === 2 });
          return {
            disabledAvailable: disabled.buildCommand().checkCallback?.(true),
            discussionExecuted: isDiscussionExecuted,
            featureExecuted: isFeatureExecuted,
            urls,
            version: plugin.manifest.version
          };
        } finally {
          app.commands.removeCommand(featureCommand.id);
          app.commands.removeCommand(discussionCommand.id);
          restoreOpen();
        }

        function restoreOpen(): void {
          window.open = originalOpen;
        }
      }
    });
    expect(result.featureExecuted).toBe(true);
    expect(result.discussionExecuted).toBe(true);
    expect(result.disabledAvailable).toBe(false);
    const featureUrl = new URL(result.urls[0] ?? '');
    expect(featureUrl.pathname).toBe('/owner/repo/issues/new');
    expect(featureUrl.searchParams.get('template')).toBe('feature_request.yml');
    expect(featureUrl.searchParams.get('plugin-version')).toBe(result.version);
    expect(result.urls[1]).toBe('https://github.com/owner/repo/discussions/new?category=q-a');
  });
});
