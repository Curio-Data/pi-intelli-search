// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

export interface QueueLimits {
  readonly maxConcurrent: number;
  readonly maxQueued: number;
}

/** The approved initial posture: one full operation active per server. */
export const defaultQueueLimits: QueueLimits = Object.freeze({
  maxConcurrent: 1,
  maxQueued: 8,
});

export interface QueueFactories<Result> {
  readonly cancelled: () => Result;
  readonly busy: () => Result;
}

interface PendingEntry<Result> {
  readonly signal: AbortSignal;
  readonly start: () => Promise<Result>;
  readonly factories: QueueFactories<Result>;
  readonly settle: (result: Result) => void;
}

/**
 * Bounded first-in first-out scheduler for protocol requests. At most
 * `maxConcurrent` operations run at once; up to `maxQueued` further requests
 * wait. A queued request whose signal aborts settles as cancelled without
 * starting. Submissions beyond the bound settle as busy without queueing.
 */
export class OperationQueue<Result> {
  private active = 0;
  private closed = false;
  private readonly pending: Array<PendingEntry<Result>> = [];
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly limits: QueueLimits,
    private readonly fallback: QueueFactories<Result>,
    private readonly onEnqueue?: () => void,
  ) {}

  submit(
    start: () => Promise<Result>,
    signal: AbortSignal,
    factories: QueueFactories<Result> = this.fallback,
  ): Promise<Result> {
    if (this.closed || signal.aborted) return Promise.resolve(factories.cancelled());
    if (this.pending.length >= this.limits.maxQueued) return Promise.resolve(factories.busy());
    return new Promise<Result>((resolve) => {
      const entry: PendingEntry<Result> = {
        signal,
        start,
        factories,
        settle: resolve,
      };
      signal.addEventListener(
        "abort",
        () => {
          const index = this.pending.indexOf(entry);
          if (index >= 0) {
            this.pending.splice(index, 1);
            resolve(factories.cancelled());
          }
        },
        { once: true },
      );
      this.pending.push(entry);
      this.onEnqueue?.();
      this.drain();
    });
  }

  private drain(): void {
    while (!this.closed && this.active < this.limits.maxConcurrent && this.pending.length) {
      const entry = this.pending.shift() as PendingEntry<Result>;
      if (entry.signal.aborted) {
        entry.settle(entry.factories.cancelled());
        continue;
      }
      this.active++;
      // The handler contract never throws; a breach still settles instead of
      // stalling the queue, surfaced as a cancellation rather than a hang.
      const task: Promise<void> = entry.start().then(
        (result) => entry.settle(result),
        () => entry.settle(entry.factories.cancelled()),
      );
      const tracked = task.finally(() => {
        this.active--;
        this.running.delete(tracked);
        this.drain();
      });
      this.running.add(tracked);
    }
  }

  /** Settles queued work as cancelled and waits for active work to finish. */
  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.pending.splice(0)) entry.settle(entry.factories.cancelled());
    await Promise.allSettled([...this.running]);
  }
}
