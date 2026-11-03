import type { App } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it
} from 'vitest';

import { getFeatureRequestIssueFormUrl } from './feature-request.ts';

describe('getFeatureRequestIssueFormUrl', () => {
  it('should prefill only the plugin version in the feature form', () => {
    const app = strictProxy<App>({ plugins: { manifests: { alpha: { version: '1.2.3' } } } });
    const url = new URL(getFeatureRequestIssueFormUrl({ app, gitHubRepo: 'owner/repo', pluginId: 'alpha' }));
    expect(url.pathname).toBe('/owner/repo/issues/new');
    expect([...url.searchParams]).toEqual([['template', 'feature_request.yml'], ['plugin-version', '1.2.3']]);
  });

  it('should preserve a custom template and title and report an unknown version', () => {
    const app = strictProxy<App>({ plugins: { manifests: { alpha: undefined } } });
    const url = new URL(getFeatureRequestIssueFormUrl({
      app,
      gitHubRepo: 'owner/repo',
      pluginId: 'alpha',
      template: 'ideas.yml',
      title: 'Alpha & bravo'
    }));
    expect(url.searchParams.get('template')).toBe('ideas.yml');
    expect(url.searchParams.get('title')).toBe('Alpha & bravo');
    expect(url.searchParams.get('plugin-version')).toBe('unknown');
  });
});
