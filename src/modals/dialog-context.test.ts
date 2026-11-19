import type { App as AppOriginal } from 'obsidian';

import { App } from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { DialogDriver } from './dialog-context.ts';

import { alert } from './alert.ts';
import { confirm } from './confirm.ts';
import {
  describeDialogRequest,
  DialogContext,
  InvalidDialogResponseError
} from './dialog-context.ts';
import { prompt } from './prompt.ts';
import { selectItem } from './select-item.ts';
import { selectOption } from './select-option.ts';

vi.mock('./alert.ts', () => ({ alert: vi.fn() }));
vi.mock('./confirm.ts', () => ({ confirm: vi.fn() }));
vi.mock('./prompt.ts', () => ({ prompt: vi.fn() }));
vi.mock('./select-item.ts', () => ({ selectItem: vi.fn() }));
vi.mock('./select-option.ts', () => ({ selectOption: vi.fn() }));

let app: AppOriginal;

function answer(value: unknown): DialogDriver {
  return { handle: () => ({ isHandled: true, value }) };
}

const PASSTHROUGH_DRIVER: DialogDriver = { handle: () => ({ isHandled: false }) };

beforeEach(() => {
  vi.clearAllMocks();
  app = App.createConfigured__().asOriginalType__();
});

describe('DialogContext without a driver', () => {
  it('should open the real modals with its app and without the interaction id', async () => {
    vi.mocked(alert).mockResolvedValue();
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(prompt).mockResolvedValue('typed');
    vi.mocked(selectItem).mockResolvedValue('b');
    vi.mocked(selectOption).mockResolvedValue(2);
    const context = new DialogContext({ app });

    await context.alert({ interactionId: 'a', message: 'm' });
    expect(await context.confirm({ interactionId: 'c', message: 'm' })).toBe(true);
    expect(await context.prompt({ title: 't' })).toBe('typed');
    expect(await context.selectItem({ items: ['a', 'b'], itemTextFunction: String })).toBe('b');
    expect(await context.selectOption({ options: [{ text: 'Two', value: 2 }] })).toBe(2);

    expect(alert).toHaveBeenCalledWith({ app, message: 'm' });
    expect(confirm).toHaveBeenCalledWith({ app, message: 'm' });
    expect(prompt).toHaveBeenCalledWith({ app, title: 't' });
    expect(selectItem).toHaveBeenCalledWith({ app, items: ['a', 'b'], itemTextFunction: String });
    expect(selectOption).toHaveBeenCalledWith({ app, options: [{ text: 'Two', value: 2 }] });
  });

  it('should throw on a passed-through dialog when it has no app', async () => {
    const context = new DialogContext({ driver: PASSTHROUGH_DRIVER });
    await expect(context.confirm({ interactionId: 'x', message: 'm' })).rejects.toThrow('No app to open the real dialog for confirm (x)');
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('DialogContext with a driver', () => {
  it('should hand the driver the request without the app', async () => {
    const handle = vi.fn<DialogDriver['handle']>(() => ({ isHandled: true, value: true }));
    const context = new DialogContext({ app, driver: { handle } });
    await context.confirm({ interactionId: 'restore', message: 'm', title: 't' });
    await context.confirm({ message: 'n' });
    expect(handle).toHaveBeenNthCalledWith(1, { interactionId: 'restore', kind: 'confirm', params: { message: 'm', title: 't' } });
    expect(handle).toHaveBeenNthCalledWith(2, { kind: 'confirm', params: { message: 'n' } });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('should open the real modal when the driver passes through', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const context = new DialogContext({ app, driver: PASSTHROUGH_DRIVER });
    expect(await context.confirm({ message: 'm' })).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  describe('alert', () => {
    it('should accept an acknowledgement with no value', async () => {
      await expect(new DialogContext({ driver: answer(undefined) }).alert({ message: 'm' })).resolves.toBeUndefined();
      expect(alert).not.toHaveBeenCalled();
    });

    it('should refuse a value', async () => {
      await expect(new DialogContext({ driver: answer('x') }).alert({ message: 'm' })).rejects.toThrow(InvalidDialogResponseError);
    });
  });

  describe('confirm', () => {
    it('should return a boolean answer', async () => {
      expect(await new DialogContext({ driver: answer(false) }).confirm({ message: 'm' })).toBe(false);
    });

    it('should refuse a non-boolean answer', async () => {
      await expect(new DialogContext({ driver: answer(null) }).confirm({ message: 'm' })).rejects.toThrow('expected a boolean');
    });
  });

  describe('prompt', () => {
    it('should return a string or null answer', async () => {
      expect(await new DialogContext({ driver: answer('text') }).prompt({})).toBe('text');
      expect(await new DialogContext({ driver: answer(null) }).prompt({})).toBeNull();
    });

    it('should refuse a non-string answer', async () => {
      await expect(new DialogContext({ driver: answer(5) }).prompt({})).rejects.toThrow('expected a string or null');
    });

    it('should run the validator over a scripted text', async () => {
      const valueValidator = vi.fn((value: string) => value.length < 3 ? 'Too short' : null);
      await expect(new DialogContext({ driver: answer('ab') }).prompt({ interactionId: 'name', valueValidator })).rejects.toThrow(
        'Invalid scripted answer for prompt (name): the prompt\'s validator refused it: Too short'
      );
      expect(await new DialogContext({ driver: answer('abc') }).prompt({ valueValidator })).toBe('abc');
      expect(valueValidator).toHaveBeenCalledTimes(2);
    });

    it('should not run the validator over a dismissal', async () => {
      const valueValidator = vi.fn(() => 'never valid');
      expect(await new DialogContext({ driver: answer(null) }).prompt({ valueValidator })).toBeNull();
      expect(valueValidator).not.toHaveBeenCalled();
    });
  });

  describe('selectItem', () => {
    const first = { name: 'first' };
    const second = { name: 'second' };
    const items = [first, second];

    it('should return the identical item', async () => {
      expect(await new DialogContext({ driver: answer(second) }).selectItem({ items, itemTextFunction: (item) => item.name })).toBe(second);
    });

    it('should return null on a dismissal', async () => {
      expect(await new DialogContext({ driver: answer(null) }).selectItem({ items, itemTextFunction: (item) => item.name })).toBeNull();
    });

    it('should refuse an equal item that is not one of the supplied instances', async () => {
      await expect(new DialogContext({ driver: answer({ name: 'first' }) }).selectItem({ items, itemTextFunction: (item) => item.name })).rejects
        .toThrow('expected null or one of the supplied items');
    });
  });

  describe('selectOption', () => {
    const options = [{ text: 'Keep', value: 'keep' }, { text: 'Drop', value: 'drop' }];

    it('should return one of the option values', async () => {
      expect(await new DialogContext({ driver: answer('drop') }).selectOption({ options })).toBe('drop');
    });

    it('should return null on a dismissal', async () => {
      expect(await new DialogContext({ driver: answer(null) }).selectOption({ options })).toBeNull();
    });

    it('should refuse a value no option has', async () => {
      await expect(new DialogContext({ driver: answer('Drop') }).selectOption({ options })).rejects.toThrow('expected null or one of the option values');
    });
  });
});

describe('describeDialogRequest', () => {
  it('should name the kind and the interaction id', () => {
    expect(describeDialogRequest({ kind: 'alert', params: { message: 'm' } })).toBe('alert');
    expect(describeDialogRequest({ interactionId: 'id', kind: 'alert', params: { message: 'm' } })).toBe('alert (id)');
  });
});
