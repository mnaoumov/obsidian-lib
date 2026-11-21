/**
 * @file
 *
 * Tests for {@link PluginMarkdownCodeBlockProcessorRegistrar}.
 */

import type {
  Component as ComponentOriginal,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  Plugin as PluginOriginal
} from 'obsidian';

import { noop } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  Component,
  MarkdownPreviewRenderer
} from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
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

  describe('with a lifetime owner', () => {
    interface CodeBlockRendererStatics {
      codeBlockPostProcessors?: Record<string, unknown>; // eslint-disable-line typescript-dev-toolkit/readonly-interface-members -- The test installs and removes the statics the mock lacks.
      unregisterCodeBlockPostProcessor?: (language: string) => void; // eslint-disable-line typescript-dev-toolkit/readonly-interface-members -- The test installs and removes the statics the mock lacks.
    }

    const statics = castTo<CodeBlockRendererStatics>(MarkdownPreviewRenderer);
    let codeBlockPostProcessors: Record<string, unknown>;

    beforeEach(() => {
      codeBlockPostProcessors = {};
      statics.codeBlockPostProcessors = codeBlockPostProcessors;
      statics.unregisterCodeBlockPostProcessor = (language: string): void => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Mirrors how Obsidian removes a language.
        delete codeBlockPostProcessors[language];
      };
    });

    afterEach(() => {
      delete statics.codeBlockPostProcessors;
      delete statics.unregisterCodeBlockPostProcessor;
    });

    function createPlugin(): PluginOriginal {
      const trigger = vi.fn();
      return strictProxy<PluginOriginal>({
        _loaded: true,
        app: strictProxy<PluginOriginal['app']>({ workspace: strictProxy<PluginOriginal['app']['workspace']>({ trigger }) }),
        registerMarkdownCodeBlockProcessor: vi.fn()
      });
    }

    it('should unregister the processor when the owner unloads, so the language can be registered again', async () => {
      const plugin = createPlugin();
      const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin);
      const handler = vi.fn();
      const owner = new Component().asOriginalType__();
      owner.load();

      const postProcessor = registrar.registerMarkdownCodeBlockProcessor({ handler, language: 'owned', lifetimeOwner: owner, sortOrder: 5 });

      expect(plugin.registerMarkdownCodeBlockProcessor).not.toHaveBeenCalled();
      expect(postProcessor).toBeTypeOf('function');
      const registeredHandler = codeBlockPostProcessors['owned'] as (source: string, element: HTMLElement, context: MarkdownPostProcessorContext) => Promise<void>;
      expect(registeredHandler).toBeTypeOf('function');
      const element = strictProxy<HTMLElement>({});
      const context = strictProxy<MarkdownPostProcessorContext>({});
      await registeredHandler('source', element, context);
      expect(handler).toHaveBeenCalledWith('source', element, context);
      expect(() => registrar.registerMarkdownCodeBlockProcessor({ handler, language: 'owned', lifetimeOwner: owner })).toThrow(
        'Code block postprocessor for language owned is already registered'
      );

      owner.unload();
      expect(codeBlockPostProcessors).not.toHaveProperty('owned');
      expect(plugin.app.workspace.trigger).toHaveBeenCalledWith('post-processor-change');

      const nextOwner = new Component().asOriginalType__();
      nextOwner.load();
      expect(() => registrar.registerMarkdownCodeBlockProcessor({ handler, language: 'owned', lifetimeOwner: nextOwner })).not.toThrow();
      nextOwner.unload();
    });

    it('should not remove a later registration of the same language when an earlier owner unloads', () => {
      const plugin = createPlugin();
      const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin);
      const owner = new Component().asOriginalType__();
      owner.load();
      registrar.registerMarkdownCodeBlockProcessor({ handler: vi.fn(), language: 'shared', lifetimeOwner: owner });
      const foreignHandler = vi.fn();
      codeBlockPostProcessors['shared'] = foreignHandler;

      owner.unload();

      expect(codeBlockPostProcessors['shared']).toBe(foreignHandler);
    });

    it('should resolve the owner from the provider on every registration', () => {
      const plugin = createPlugin();
      let currentOwner = new Component().asOriginalType__();
      currentOwner.load();
      const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin, { lifetimeOwnerProvider: (): ComponentOriginal => currentOwner });

      registrar.registerMarkdownCodeBlockProcessor({ handler: vi.fn(), language: 'provided' });
      currentOwner.unload();
      currentOwner = new Component().asOriginalType__();
      currentOwner.load();
      registrar.registerMarkdownCodeBlockProcessor({ handler: vi.fn(), language: 'provided' });

      expect(codeBlockPostProcessors).toHaveProperty('provided');
      currentOwner.unload();
      expect(codeBlockPostProcessors).not.toHaveProperty('provided');
    });

    it('should not register a processor for an owner that is not loaded', () => {
      const plugin = createPlugin();
      const registrar = new PluginMarkdownCodeBlockProcessorRegistrar(plugin);
      const owner = new Component().asOriginalType__();

      const result = registrar.registerMarkdownCodeBlockProcessor({ handler: vi.fn(), language: 'unloaded', lifetimeOwner: owner });

      expect(result).toBe(noop);
      expect(codeBlockPostProcessors).not.toHaveProperty('unloaded');
    });
  });
});
