// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Independent-process worker for P2 lock, allocation and crash-boundary
// proofs. Arguments arrive as one JSON object; results are JSON lines.

import { open } from "node:fs/promises";
import {
  cacheLockDir,
  indexLockDir,
  makeCachePath,
  updateIndex,
  withLock,
  writeCacheFiles,
  writeReportFile,
} from "../../src/core/cache.js";
import { join } from "node:path";
import { createRunStoreWithHooks, type FaultPoint } from "../../src/core/run-store.js";
import { acquireWriterLock, loadNativeLockBinding } from "../../src/core/run-lock.js";
import { NAMESPACE_DIR } from "../../src/core/run-format.js";
import { artifactsFor, realClock, storeOptions } from "./run-store-fixtures.js";

interface Args {
  readonly mode: "allocate" | "commit" | "hold-lock" | "critical" | "legacy";
  readonly cacheRoot: string;
  readonly count?: number;
  readonly crashAt?: FaultPoint;
  readonly query?: string;
  readonly holdMs?: number;
  readonly label?: string;
}

const args = JSON.parse(process.argv[2] ?? "{}") as Args;
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const signal = new AbortController().signal;

const hooks = {
  fault(point: FaultPoint) {
    emit({ fault: point });
    if (point === args.crashAt) process.kill(process.pid, "SIGKILL");
  },
};

if (args.mode === "allocate" || args.mode === "commit") {
  for (let i = 0; i < (args.count ?? 1); i++) {
    const store = createRunStoreWithHooks(
      storeOptions(args.cacheRoot, { onDiagnostic: (d) => emit({ diagnostic: d }) }),
      hooks,
    );
    const query = args.query ?? `${args.label ?? "worker"} query ${process.pid} ${i}`;
    const allocation = await store.allocate({
      operationId: `op-${process.pid}-${i}`,
      query,
      startedUtc: new Date().toISOString(),
      signal,
    });
    if (allocation.status !== "allocated") {
      emit({ allocation });
      continue;
    }
    emit({ granted: allocation.reservation.sequence, runId: allocation.reservation.runId });
    if (args.mode === "commit") {
      const result = await store.commit(allocation.reservation, artifactsFor(query), signal);
      emit({ commit: result.status, runId: allocation.reservation.runId });
      if (result.status === "committed")
        emit({ index: await store.updateIndex(result.run, query, signal) });
    }
    await store.settle();
  }
  emit({ done: true });
} else if (args.mode === "hold-lock") {
  const acquired = await acquireWriterLock({
    namespaceDir: join(args.cacheRoot, NAMESPACE_DIR),
    clock: realClock(),
    signal,
    loadBinding: loadNativeLockBinding,
  });
  emit({ acquired: acquired.status });
  await new Promise((resolve) => setTimeout(resolve, args.holdMs ?? 60_000));
  if (acquired.status === "acquired") await acquired.lock.release();
  emit({ released: true });
} else if (args.mode === "critical") {
  // Serialised append inside the lock: overlap would interleave start/end lines.
  const log = join(args.cacheRoot, "critical.log");
  for (let i = 0; i < (args.count ?? 1); i++) {
    for (;;) {
      const acquired = await acquireWriterLock({
        namespaceDir: join(args.cacheRoot, NAMESPACE_DIR),
        clock: realClock(),
        signal,
        loadBinding: loadNativeLockBinding,
      });
      if (acquired.status !== "acquired") continue;
      try {
        const handle = await open(log, "a");
        await handle.write(`start ${process.pid}\n`);
        await new Promise((resolve) => setTimeout(resolve, 2));
        await handle.write(`end ${process.pid}\n`);
        await handle.close();
      } finally {
        await acquired.lock.release();
      }
      break;
    }
  }
  emit({ done: true });
} else if (args.mode === "legacy") {
  // The unchanged baseline writer: per-path lock, staged files, report, index lock.
  for (let i = 0; i < (args.count ?? 1); i++) {
    const query = `${args.label ?? "legacy"} query ${process.pid} ${i}`;
    const cachePath = makeCachePath(query, args.cacheRoot, args.cacheRoot);
    await withLock(cacheLockDir(cachePath), async () => {
      await writeCacheFiles(cachePath, [], [], "summary", query);
      await writeReportFile(cachePath, query, "Legacy report body", [], []);
      await withLock(indexLockDir(args.cacheRoot), () =>
        updateIndex(args.cacheRoot, cachePath.split("/").pop() ?? "", query),
      );
    });
    emit({ legacy: cachePath });
  }
  emit({ done: true });
}
