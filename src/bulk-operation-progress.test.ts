import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  BULK_OPERATION_HOLD_INTERVAL_IN_MILLISECONDS,
  holdBulkOperationWhile,
  registerBulkOperationProgressListener,
  reportBulkOperationProgress
} from './bulk-operation-progress.ts';

describe('reportBulkOperationProgress', () => {
  it('should notify every registered listener until it unsubscribes', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unregister1 = registerBulkOperationProgressListener(listener1);
    const unregister2 = registerBulkOperationProgressListener(listener2);

    reportBulkOperationProgress();
    unregister1();
    reportBulkOperationProgress();
    unregister2();

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(2);
  });

  it('should keep going when a listener throws', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const listener = vi.fn();
    const unregisterFailing = registerBulkOperationProgressListener(() => {
      throw new Error('boom');
    });
    const unregister = registerBulkOperationProgressListener(listener);

    reportBulkOperationProgress();
    unregisterFailing();
    unregister();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Bulk operation progress listener failed', expect.any(Error));
  });

  it('should do nothing with no listener', () => {
    expect(() => {
      reportBulkOperationProgress();
    }).not.toThrow();
  });
});

describe('holdBulkOperationWhile', () => {
  it('should report progress on an interval while the promise is pending, and stop once it settles', async () => {
    vi.useFakeTimers();
    try {
      const listener = vi.fn();
      const unregister = registerBulkOperationProgressListener(listener);
      let resolve: (value: string) => void = vi.fn();
      const held = holdBulkOperationWhile(
        new Promise<string>((promiseResolve) => {
          resolve = promiseResolve;
        })
      );
      expect(listener).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(BULK_OPERATION_HOLD_INTERVAL_IN_MILLISECONDS * 3);
      expect(listener).toHaveBeenCalledTimes(4);

      resolve('answered');
      expect(await held).toBe('answered');
      expect(listener).toHaveBeenCalledTimes(5);

      await vi.advanceTimersByTimeAsync(BULK_OPERATION_HOLD_INTERVAL_IN_MILLISECONDS * 3);
      expect(listener).toHaveBeenCalledTimes(5);
      unregister();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should stop reporting when the promise rejects, and rethrow', async () => {
    vi.useFakeTimers();
    try {
      const listener = vi.fn();
      const unregister = registerBulkOperationProgressListener(listener);
      const error = new Error('closed');
      await expect(holdBulkOperationWhile(Promise.reject(error))).rejects.toBe(error);
      await vi.advanceTimersByTimeAsync(BULK_OPERATION_HOLD_INTERVAL_IN_MILLISECONDS * 3);
      expect(listener).toHaveBeenCalledTimes(2);
      unregister();
    } finally {
      vi.useRealTimers();
    }
  });
});
