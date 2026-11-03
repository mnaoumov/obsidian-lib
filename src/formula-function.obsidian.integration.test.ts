/// <reference types="obsidian-integration-testing/vitest/typings" />

import type { BasesView } from '@obsidian-typings/obsidian-public-latest';
import type { QueryController } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import {
  describe,
  expect,
  it
} from 'vitest';

describe('formula functions', () => {
  it('should evaluate plugin global and instance functions in a real Base and unregister on unload', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { castTo, createFormulaFunctionParameter, registerFormulaFunction, waitUntil }, obsidianModule: { NumberValue, Plugin, StringValue } }) {
        class AlphaPlugin extends Plugin {}
        const plugin = new AlphaPlugin(app, { author: 'alpha', description: 'alpha', id: 'alpha-formula-test', isDesktopOnly: false, minAppVersion: '1.10.0', name: 'alpha', version: '1.0.0' });
        plugin.load();
        let hasContext = false;
        const globalFunction = registerFormulaFunction({
          evaluate(context, ...arguments_) {
            hasContext = context !== null;
            return new NumberValue(Number(arguments_[0]?.toString()) * 2);
          },
          name: 'alphaDouble',
          params: [createFormulaFunctionParameter({ name: 'value', type: [NumberValue] })],
          plugin
        });
        const instanceFunction = registerFormulaFunction({
          evaluate(_context, ...arguments_) {
            return new StringValue(`${arguments_[0]?.toString() ?? ''}!`);
          },
          instanceType: StringValue,
          name: 'alphaShout',
          params: [createFormulaFunctionParameter({ name: 'value', type: [StringValue] })],
          plugin
        });
        const note = await app.vault.create('alpha-formula.md', 'alpha');
        const file = await app.vault.create('alpha-formulas.base', 'formulas:\n  doubled: alphaDouble(21)\n  shouted: \'"bravo".alphaShout()\'\nviews:\n  - type: table\n    name: Alpha\n');
        const leaf = app.workspace.getLeaf('tab');
        try {
          await leaf.openFile(file);
          const view = castTo<BasesView>(leaf.view);
          await waitUntil({ message: 'the Base query is ready', predicate: () => !!view.controller.query });
          const controller = castTo<QueryController>(view.controller);
          await waitUntil({ message: 'the Base indexes the note', predicate: () => controller.results.has(note) });
          const entry = controller.results.get(note);
          const doubled = entry?.getValue('formula.doubled')?.toString();
          const shouted = entry?.getValue('formula.shouted')?.toString();
          plugin.unload();
          const previousContext = controller.ctx;
          const content = await app.vault.read(file);
          view.setViewData(content.replace('(21)', '(22)'), false);
          await waitUntil({ message: 'the Base rebuilds after unload', predicate: () => controller.ctx !== previousContext && controller.results.has(note) });
          let isRemoved = false;
          try {
            isRemoved = controller.results.get(note)?.getValue('formula.doubled')?.toString() !== '44';
          } catch {
            isRemoved = true;
          }
          return { doubled, globalContext: globalFunction.ctx, hasContext, instanceContext: instanceFunction.ctx, isRemoved, shouted };
        } finally {
          plugin.unload();
          leaf.detach();
          await app.fileManager.trashFile(file);
          await app.fileManager.trashFile(note);
        }
      }
    });
    expect(result).toEqual({ doubled: '42', globalContext: null, hasContext: true, instanceContext: null, isRemoved: true, shouted: 'bravo!' });
  });
});
