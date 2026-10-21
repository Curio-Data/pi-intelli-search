// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { Clock } from "../../../src/core/contracts.js";

export interface Catalogue<T> {
  read(signal?: AbortSignal): Promise<T>;
  close(): Promise<void>;
}
interface Waiter<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly remove: () => void;
}
interface Flight<T> {
  readonly controller: AbortController;
  readonly waiters: Set<Waiter<T>>;
  readonly departures: Array<() => void>;
  done: Promise<void>;
  draining: boolean;
}
const aborted = () => new DOMException("Catalogue request cancelled", "AbortError");

/** Runtime-owned single-flight; last-waiter cancellation awaits physical loader drain. */
export function createCatalogue<T>(
  load: (signal: AbortSignal) => Promise<T>,
  clock: Clock,
  onWaiterJoined?: (activeWaiters: number) => void,
): Catalogue<T> {
  let cached: { value: T; at: number } | undefined;
  let flight: Flight<T> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const next = new Set<Waiter<T>>();
  const settle = (waiter: Waiter<T>, value: T | undefined, error?: unknown) => {
    waiter.remove();
    if (error !== undefined) waiter.reject(error);
    else waiter.resolve(value as T);
  };
  function start(): void {
    if (closed || flight || !next.size) return;
    const current: Flight<T> = {
      controller: new AbortController(),
      waiters: new Set(next),
      departures: [],
      done: Promise.resolve(),
      draining: false,
    };
    next.clear();
    flight = current;
    current.done = Promise.resolve()
      .then(() => load(current.controller.signal))
      .then(
        (value) => finish(current, value),
        (error: unknown) => finish(current, undefined, error),
      );
  }
  function finish(current: Flight<T>, value: T | undefined, error?: unknown): void {
    if (current.controller.signal.aborted || closed) error = aborted();
    if (error === undefined) cached = { value: value as T, at: clock.monotonicMs() };
    for (const waiter of current.waiters) settle(waiter, value, error);
    current.waiters.clear();
    for (const depart of current.departures) depart();
    flight = undefined;
    start();
  }
  return {
    read(signal) {
      if (closed || signal?.aborted) return Promise.reject(aborted());
      if (cached && clock.monotonicMs() - cached.at < 60_000) return Promise.resolve(cached.value);
      return new Promise<T>((resolve, reject) => {
        const abort = () => {
          waiter.remove();
          if (next.delete(waiter)) {
            reject(aborted());
            return;
          }
          const current = flight;
          if (!current?.waiters.delete(waiter)) return;
          if (current.waiters.size) reject(aborted());
          else {
            // Mark before abort: re-entrant/new reads belong to the next flight.
            current.draining = true;
            current.departures.push(() => reject(aborted()));
            current.controller.abort();
          }
        };
        const waiter: Waiter<T> = {
          resolve,
          reject,
          remove: () => signal?.removeEventListener("abort", abort),
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (flight && !flight.draining) flight.waiters.add(waiter);
        else {
          next.add(waiter);
          start();
        }
        if (flight && !flight.draining) {
          try {
            onWaiterJoined?.(flight.waiters.size);
          } catch {
            /* Read-only instrumentation. */
          }
        }
      });
    },
    close() {
      if (!closing) {
        closed = true;
        cached = undefined;
        for (const waiter of next) settle(waiter, undefined, aborted());
        next.clear();
        const current = flight;
        if (current) {
          current.draining = true;
          current.controller.abort();
        }
        closing = current?.done ?? Promise.resolve();
      }
      return closing;
    },
  };
}
