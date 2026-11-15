/**
 * @file
 *
 * Tests for {@link PluginMarkdownCodeBlockProcessorRegistrar}.
 */

import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  Plugin as PluginOriginal
} from 'obsidian';

import { noop } from '@mnaoumov/typescript-lib/function';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { PluginMarkdownCodeBlockProcessorRegistrar } from './markdown-code-block-processor-registrar.ts';

describe('PluginMarkdownCodeBlockProcessorRegistrar', () => {
  it('should delegate registerMarkdownCodeBlockProcessor to the plugin', async () => {
    const mockPostProcessor = noop;
    const registerMarkdownCodeBlockProcessor = vi.fn<PluginOriginal['registerMarkdownCodeBlockProcessor']>().mockReturnValue(mockPostProcessor as MarkdownPostProcessor);
    const plugin = strictProxy<PluginOriginal>({ _loaded: true, registerMarkdownCodeBlockProcessor });
    const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin);
    const handler = vi.fn();

    const result = registrar.registerMarkdownCodeBlockProcessor({
      handler,
      language: 'dataview',
      sortOrder: 100
    });

    expect(registerMarkdownCodeBlockProcessor).toHaveBeenCalledWith('dataview', expect.any(Function), 100);
    expect(result).toBe(mockPostProcessor);

    const element = strictProxy<HTMLElement>({});
    const context = strictProxy<MarkdownPostProcessorContext>({});
    const wrappedHandler = registerMarkdownCodeBlockProcessor.mock.calls[0]?.[1];
    await wrappedHandler?.('source', element, context);
    expect(handler).toHaveBeenCalledWith('source', element, context);
  });

  it('should not register a processor on a plugin instance that is not loaded', () => {
    const registerMarkdownCodeBlockProcessor = vi.fn<PluginOriginal['registerMarkdownCodeBlockProcessor']>();
    const plugin = strictProxy<PluginOriginal>({ _loaded: false, registerMarkdownCodeBlockProcessor });
    const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin);
    const handler = vi.fn();

    const result = registrar.registerMarkdownCodeBlockProcessor({
      handler,
      language: 'code-button'
    });

    expect(registerMarkdownCodeBlockProcessor).not.toHaveBeenCalled();
    expect(result).toBe(noop);
  });
});
