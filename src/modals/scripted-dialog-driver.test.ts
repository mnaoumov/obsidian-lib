import type { App as AppOriginal } from 'obsidian';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { confirm } from './confirm.ts';
import { DialogContext } from './dialog-context.ts';
import {
  createDialogTestHarness,
  ScriptedDialogDriver
} from './scripted-dialog-driver.ts';

vi.mock('./confirm.ts', () => ({ confirm: vi.fn() }));

let app: AppOriginal;

beforeEach(() => {
  vi.clearAllMocks();
  app = App.createConfigured__().asOriginalType__();
});

describe('ScriptedDialogDriver', () => {
  it('should answer dialogs in order and record a transcript', async () => {
    const target = { name: 'target' };
    const harness = createDialogTestHarness([
      { interactionId: 'device-name', kind: 'prompt', value: 'laptop' },
      { kind: 'selectItem', value: target },
      { interactionId: 'apply', kind: 'confirm', value: true },
      { kind: 'alert' }
    ]);
    const context = harness.dialogContext;

    expect(await context.prompt({ interactionId: 'device-name', title: 'Device name' })).toBe('laptop');
    expect(await context.selectItem({ items: [target], itemTextFunction: (item) => item.name })).toBe(target);
    expect(harness.driver.remainingStepCount).toBe(2);
    expect(await context.confirm({ interactionId: 'apply', message: 'Continue?' })).toBe(true);
    await context.alert({ message: 'Done' });

    harness.assertDone();
    expect(harness.driver.transcript.map((request) => request.kind)).toEqual(['prompt', 'selectItem', 'confirm', 'alert']);
    expect(harness.driver.transcript[0]).toEqual({ interactionId: 'device-name', kind: 'prompt', params: { title: 'Device name' } });
  });

  it('should derive an answer from the request, and answer with a function item as is', async () => {
    function noopItem(): void {
      // An item that is itself a function.
    }
    const harness = createDialogTestHarness([
      {
        kind: 'prompt',
        valueProvider: (request): string => `${typeof request.params.title === 'string' ? request.params.title : ''}!`
      },
      {
        kind: 'selectOption',
        valueProvider: async (request): Promise<unknown> => {
          await noopAsync();
          return request.params.options[1]?.value;
        }
      },
      {
        kind: 'selectItem',
        value: noopItem
      }
    ]);
    expect(await harness.dialogContext.prompt({ title: 'Hello' })).toBe('Hello!');
    expect(await harness.dialogContext.selectOption({ options: [{ text: 'A', value: 'a' }, { text: 'B', value: 'b' }] })).toBe('b');
    expect(await harness.dialogContext.selectItem({ items: [noopItem], itemTextFunction: () => 'noop' })).toBe(noopItem);
  });

  it('should refuse a dialog of another kind', async () => {
    const harness = createDialogTestHarness([{ kind: 'prompt', value: 'x' }]);
    await expect(harness.dialogContext.confirm({ interactionId: 'apply', message: 'm' })).rejects.toThrow('Expected a prompt dialog, got confirm (apply)');
  });

  it('should refuse a dialog with another interaction id', async () => {
    const harness = createDialogTestHarness([{ interactionId: 'apply', kind: 'confirm', value: true }]);
    await expect(harness.dialogContext.confirm({ interactionId: 'restore', message: 'm' })).rejects.toThrow(
      'Expected the confirm dialog apply, got confirm (restore)'
    );
    await expect(createDialogTestHarness([{ interactionId: 'apply', kind: 'confirm', value: true }]).dialogContext.confirm({ message: 'm' })).rejects
      .toThrow('Expected the confirm dialog apply, got confirm');
  });

  it('should refuse a dialog after the script runs out when strict', async () => {
    const harness = createDialogTestHarness([]);
    await expect(harness.dialogContext.confirm({ message: 'm' })).rejects.toThrow('Unexpected dialog: confirm');
    expect(harness.driver.transcript).toHaveLength(1);
  });

  it('should pass a dialog through after the script runs out when not strict', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const driver = new ScriptedDialogDriver([], { isStrict: false });
    expect(await new DialogContext({ app, driver }).confirm({ message: 'm' })).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('should check a passthrough step, then open the real modal', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const driver = new ScriptedDialogDriver([{ interactionId: 'apply', isPassthrough: true, kind: 'confirm' }]);
    expect(await new DialogContext({ app, driver }).confirm({ interactionId: 'apply', message: 'm' })).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    driver.assertDone();
  });

  it('should keep its own copy of the steps', async () => {
    const steps = [{ kind: 'confirm' as const, value: true }];
    const harness = createDialogTestHarness(steps);
    steps.length = 0;
    expect(await harness.dialogContext.confirm({ message: 'm' })).toBe(true);
  });

  it('should name the unused steps in assertDone', () => {
    const harness = createDialogTestHarness([
      { interactionId: 'apply', kind: 'confirm', value: true },
      { kind: 'alert' }
    ]);
    expect(() => {
      harness.assertDone();
    }).toThrow('Unused scripted dialog steps: confirm (apply), alert');
  });
});
