import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
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
