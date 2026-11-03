// @vitest-environment jsdom

import type { App } from 'obsidian';

import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { OpenFeatureRequestCommandHandler } from './open-feature-request-command-handler.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpenFeatureRequestCommandHandler', () => {
  const app = strictProxy<App>({ plugins: { manifests: { alpha: { version: '1.2.3' } } } });

  it('should offer Request a feature and open the version-prefilled form', async () => {
    const handler = new OpenFeatureRequestCommandHandler({ app, gitHubRepo: 'owner/repo', pluginId: 'alpha' });
    expect(handler.buildCommand()).toMatchObject({ icon: 'lightbulb', id: 'request-feature', name: 'Request a feature' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await handler.execute();
    expect(open).toHaveBeenCalledWith('https://github.com/owner/repo/issues/new?template=feature_request.yml&plugin-version=1.2.3', '_blank');
  });

  it('should open the selected form with a custom title', async () => {
    const handler = new OpenFeatureRequestCommandHandler({ app, gitHubRepo: 'owner/repo', pluginId: 'alpha', template: 'ideas.yml', title: 'Alpha & bravo' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await handler.execute();
    expect(open).toHaveBeenCalledWith('https://github.com/owner/repo/issues/new?template=ideas.yml&title=Alpha+%26+bravo&plugin-version=1.2.3', '_blank');
  });
});
