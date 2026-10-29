/**
 * @file
 *
 * A realm-wide progress signal for bulk operations.
 *
 * A bulk operation wrapped in git commits holds a lease lock whose heartbeat must be refreshed by the operation's
 * own progress, never by a free-running timer, so a hung operation goes stale like a crashed one. Rather than
 * threading a callback through every plugin's call chain, the wrapper subscribes here while it runs, and
 * {@link loop} reports after every item it processes. Code that drives a bulk operation without `loop()` calls
 * {@link reportBulkOperationProgress} itself.
 *
 * The listener set lives in the shared-state bag under a versioned key, so a `loop()` bundled by one plugin's copy
 * of this library reaches a listener registered by another's. Its shape is a cross-copy wire format: a `Set` of
 * plain functions, read structurally.
 */

import { getObsidianLibState } from './obsidian-lib-state.ts';

/**
 * A listener notified whenever a bulk operation makes progress.
 */
export type BulkOperationProgressListener = () => void;

const BULK_OPERATION_PROGRESS_STATE_KEY = 'bulkOperationProgressV1';

/**
 * Subscribes to bulk-operation progress.
 *
 * @param listener - The listener to notify on every progress report.
 * @returns A function that unsubscribes the listener.
 */
export function registerBulkOperationProgressListener(listener: BulkOperationProgressListener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reports that a bulk operation has made progress, such as finishing one item.
 *
 * A listener that throws is skipped, so a progress report can never fail the operation reporting it.
 */
export function reportBulkOperationProgress(): void {
  for (const listener of getListeners()) {
    try {
      listener();
    } catch (error) {
      console.error('Bulk operation progress listener failed', error);
    }
  }
}

function getListeners(): Set<BulkOperationProgressListener> {
  return getObsidianLibState(BULK_OPERATION_PROGRESS_STATE_KEY, new Set<BulkOperationProgressListener>()).value;
}
