import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  BulkOperationLock,
  BulkOperationLockStalenessContext
} from './bulk-operation.ts';

import {
  buildBeforeOperationCommitSubject,
  buildOperationCommitMessage,
  BULK_OPERATION_LOCK_STALE_AFTER_IN_MILLISECONDS,
  formatOperationId,
  getNextOperationId,
  isBulkOperationLock,
  isBulkOperationLockStale,
  parseBulkOperationCommit,
  parseOperationNumber
} from './bulk-operation.ts';

const NOW = 1_000_000_000;

const lock: BulkOperationLock = {
  heartbeatAt: NOW,
  host: 'host-a',
  operationId: 'OP3',
  pluginId: 'my-plugin',
  processId: 42,
  processStartedAt: NOW - 5000,
  startedAt: NOW - 1000
};

function createContext(overrides: Partial<BulkOperationLockStalenessContext> = {}): BulkOperationLockStalenessContext {
  return {
    bootedAt: NOW - 3_600_000,
    host: 'host-a',
    isProcessAlive: () => true,
    now: NOW,
    ...overrides
  };
}

describe('buildBeforeOperationCommitSubject', () => {
  it('should name the operation', () => {
    expect(buildBeforeOperationCommitSubject('OP7')).toBe('chore: before OP7');
  });
});

describe('buildOperationCommitMessage', () => {
  it('should build the subject and the trailers', () => {
    expect(buildOperationCommitMessage({
      changedFileCount: 3,
      operationId: 'OP7',
      pluginId: 'my-plugin',
      summary: '  Collect\n attachments  ',
      timestamp: new Date(Date.UTC(2026, 9, 29, 12, 0, 0))
    })).toEqual({
      body: 'Timestamp: 2026-10-29T12:00:00.000Z\nChanged-Files: 3\nObsidian-Plugin: my-plugin\nObsidian-Bulk-Operation: OP7',
      subject: 'OP7: Collect attachments'
    });
  });

  it('should fall back to a generic summary', () => {
    expect(buildOperationCommitMessage({ changedFileCount: 0, operationId: 'OP1', pluginId: 'p', timestamp: new Date(0) }).subject)
      .toBe('OP1: bulk operation');
  });

  it('should mark an interrupted operation', () => {
    expect(
      buildOperationCommitMessage({
        changedFileCount: 1,
        isInterrupted: true,
        operationId: 'OP2',
        pluginId: 'p',
        summary: 'ignored',
        timestamp: new Date(0)
      }).subject
    ).toBe('OP2 interrupted');
  });
});

describe('formatOperationId', () => {
  it('should prefix the number', () => {
    expect(formatOperationId(12)).toBe('OP12');
  });
});

describe('getNextOperationId', () => {
  it('should start at OP1', () => {
    expect(getNextOperationId([])).toBe('OP1');
  });

  it('should go one past the highest id of every kind of subject', () => {
    expect(getNextOperationId(['OP3: a', 'chore: before OP9', 'OP5 interrupted', 'feat: OP100 mentioned', 'OP2: b', '']))
      .toBe('OP10');
  });
});

describe('parseOperationNumber', () => {
  it.each([
    ['OP12: summary', 12],
    ['OP12 interrupted', 12],
    ['chore: before OP12', 12],
    ['OP12', 12],
    ['OP12x: summary', null],
    ['OP12 interrupted later', null],
    ['fix: OP12', null]
  ])('should parse %j', (subject, expected) => {
    expect(parseOperationNumber(subject)).toBe(expected);
  });
});

describe('parseBulkOperationCommit', () => {
  it('should parse a completed operation', () => {
    expect(parseBulkOperationCommit({ date: 'd', sha: 's', subject: 'OP4: rename' })).toEqual({
      date: 'd',
      isInterrupted: false,
      operationId: 'OP4',
      sha: 's',
      subject: 'OP4: rename'
    });
  });

  it('should parse an interrupted operation', () => {
    expect(parseBulkOperationCommit({ date: 'd', sha: 's', subject: 'OP4 interrupted' })?.isInterrupted).toBe(true);
  });

  it('should skip a before commit', () => {
    expect(parseBulkOperationCommit({ date: 'd', sha: 's', subject: 'chore: before OP4' })).toBeNull();
  });
});

describe('isBulkOperationLock', () => {
  it('should accept a lock record', () => {
    expect(isBulkOperationLock(lock)).toBe(true);
  });

  it.each([null, 'text', { ...lock, heartbeatAt: '1' }])('should reject %j', (value) => {
    expect(isBulkOperationLock(value)).toBe(false);
  });
});

describe('isBulkOperationLockStale', () => {
  it('should keep a fresh lock', () => {
    expect(isBulkOperationLockStale(lock, createContext())).toBe(false);
  });

  it('should drop a lock whose heartbeat is too old, whatever the host', () => {
    expect(isBulkOperationLockStale(lock, createContext({ host: 'host-b', now: NOW + BULK_OPERATION_LOCK_STALE_AFTER_IN_MILLISECONDS })))
      .toBe(true);
  });

  it('should not apply the fast paths to another host', () => {
    expect(isBulkOperationLockStale(lock, createContext({ bootedAt: NOW + 1, host: 'host-b', isProcessAlive: () => false }))).toBe(false);
  });

  it('should drop a lock written before the last boot', () => {
    expect(isBulkOperationLockStale(lock, createContext({ bootedAt: NOW + 1 }))).toBe(true);
  });

  it('should drop a lock whose process is gone', () => {
    expect(isBulkOperationLockStale(lock, createContext({ bootedAt: null, isProcessAlive: () => false }))).toBe(true);
  });

  it('should keep a lock whose process cannot be checked', () => {
    expect(isBulkOperationLockStale(lock, createContext({ isProcessAlive: () => null }))).toBe(false);
  });
});
