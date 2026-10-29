// @vitest-environment jsdom

import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { BulkOperationCommitComponent } from '../components/bulk-operation-commit-component.ts';

import { UndoBulkOperationCommandHandler } from './undo-bulk-operation-command-handler.ts';

const { platformState } = vi.hoisted(() => ({
  platformState: { isDesktopApp: true }
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<typeof import('obsidian')>();
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get isDesktopApp(): boolean {
        return platformState.isDesktopApp;
      }
    }
  };
});

const undoBulkOperation = vi.fn();
let isEnabled: boolean;

function createHandler(): UndoBulkOperationCommandHandler {
  return new UndoBulkOperationCommandHandler({
    bulkOperationCommitComponent: strictProxy<BulkOperationCommitComponent>({ undoBulkOperation }),
    isEnabled: () => isEnabled
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isEnabled = true;
  platformState.isDesktopApp = true;
  undoBulkOperation.mockResolvedValue(undefined);
});

describe('UndoBulkOperationCommandHandler', () => {
  it('should build the command', () => {
    const command = createHandler().buildCommand();
    expect(command.id).toBe('undo-bulk-operation');
    expect(command.name).toBe('Undo a bulk operation...');
    expect(command.icon).toBe('undo-2');
  });

  it('should be available on desktop with the setting on', () => {
    expect(createHandler().buildCommand().checkCallback?.(true)).toBe(true);
  });

  it('should be unavailable with the setting off', () => {
    isEnabled = false;
    expect(createHandler().buildCommand().checkCallback?.(true)).toBe(false);
  });

  it('should be unavailable on mobile', () => {
    platformState.isDesktopApp = false;
    expect(createHandler().buildCommand().checkCallback?.(true)).toBe(false);
  });

  it('should start the undo', async () => {
    createHandler().buildCommand().checkCallback?.(false);
    await waitForAllAsyncOperations();
    expect(undoBulkOperation).toHaveBeenCalledWith();
  });
});
