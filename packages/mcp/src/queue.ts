// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { defaultAdmission, maximumPendingConfiguration, parseAdmission } from "./admission.js";
import type { ProtocolQueueSettings } from "../../../src/core/contracts.js";

export type QueueLimits = ProtocolQueueSettings;
export const defaultQueueLimits = defaultAdmission;

export interface QueueFactories<Result> {
  readonly cancelled: (settled?: Result) => Result;
  readonly busy: () => Result;
  readonly failed?: (error: unknown) => Result;
}

interface Entry<Result> {
  readonly controller: AbortController;
  readonly start: (signal: AbortSignal) => Promise<Result>;
  readonly factories: QueueFactories<Result>;
  readonly resolve: (result: Result) => void;
  readonly removeAbort: () => void;
}

/** FIFO protocol admission. Deferred configuration is bounded before inference. */
export class OperationQueue<Result> {
  private limits?: QueueLimits;
  private preparing?: Promise<void>;
  private closed = false;
  private readonly pending: Entry<Result>[] = [];
  private readonly active = new Map<Entry<Result>, Promise<void>>();
  private closing?: Promise<void>;

  constructor(
    private readonly source: QueueLimits | (() => Promise<QueueLimits>),
    private readonly fallback: QueueFactories<Result>,
    private readonly onEnqueue?: () => void,
  ) {
    if (typeof source !== "function") this.limits = parseAdmission(source);
  }

  submit(
    start: (signal: AbortSignal) => Promise<Result>,
    signal: AbortSignal,
    factories: QueueFactories<Result> = this.fallback,
  ): Promise<Result> {
    if (this.closed || signal.aborted) return Promise.resolve(factories.cancelled());
    if (this.limits) {
      // Available active capacity takes precedence, including maxQueued: 0.
      if (
        this.active.size >= this.limits.maxConcurrent &&
        this.pending.length >= this.limits.maxQueued
      )
        return Promise.resolve(factories.busy());
    } else if (this.pending.length >= maximumPendingConfiguration) {
      return Promise.resolve(factories.busy());
    }
    return new Promise<Result>((resolve) => {
      const controller = new AbortController();
      const abort = () => {
        controller.abort(signal.reason);
        const index = this.pending.indexOf(entry);
        if (index >= 0) {
          this.pending.splice(index, 1);
          this.finish(entry, factories.cancelled());
        }
      };
      const entry: Entry<Result> = {
        controller,
        start,
        factories,
        resolve,
        removeAbort: () => signal.removeEventListener("abort", abort),
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.push(entry);
      try {
        this.onEnqueue?.();
      } catch {
        /* Instrumentation cannot own admission. */
      }
      this.prepare();
      this.drain();
    });
  }

  private prepare(): void {
    if (this.limits || this.preparing || this.closed) return;
    this.preparing = Promise.resolve()
      .then(() => (this.source as () => Promise<QueueLimits>)())
      .then((limits) => {
        this.limits = parseAdmission(limits);
      })
      .catch((error: unknown) => {
        for (const entry of this.pending.splice(0))
          this.finish(entry, entry.factories.failed?.(error) ?? entry.factories.cancelled());
      })
      .finally(() => {
        this.preparing = undefined;
        this.drain();
        if (this.pending.length) this.prepare();
      });
  }

  private finish(entry: Entry<Result>, result: Result): void {
    entry.removeAbort();
    entry.resolve(result);
  }

  private drain(): void {
    if (this.closed || !this.limits) return;
    // Apply the resolved configuration to the entire bootstrap population
    // before starting any body. Keep the oldest active+queued admissions.
    const capacity = this.limits.maxConcurrent - this.active.size + this.limits.maxQueued;
    for (const entry of this.pending.splice(Math.max(0, capacity)))
      this.finish(entry, entry.factories.busy());
    while (!this.closed && this.active.size < this.limits.maxConcurrent && this.pending.length) {
      const entry = this.pending.shift()!;
      // Defer user code until the active ownership record is installed.
      const task = Promise.resolve().then(async () => {
        let result: Result;
        try {
          result = entry.controller.signal.aborted
            ? entry.factories.cancelled()
            : await entry.start(entry.controller.signal);
          if (entry.controller.signal.aborted) result = entry.factories.cancelled(result);
        } catch (error) {
          result = entry.controller.signal.aborted
            ? entry.factories.cancelled()
            : (entry.factories.failed?.(error) ?? entry.factories.cancelled());
        }
        this.active.delete(entry);
        this.drain();
        this.finish(entry, result);
      });
      this.active.set(entry, task);
    }
  }

  /** Abort admission/work synchronously, then await real preparation and bodies. */
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      for (const entry of this.pending.splice(0)) this.finish(entry, entry.factories.cancelled());
      for (const entry of this.active.keys()) entry.controller.abort();
      this.closing = (async () => {
        await this.preparing;
        await Promise.allSettled([...this.active.values()]);
      })();
    }
    return this.closing;
  }
}
