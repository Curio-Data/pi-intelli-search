// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import type { FullData } from "../src/core/contracts.js";
import { StandaloneError } from "../packages/mcp/src/errors.js";
import {
  nativeHarness,
  mcpHarness,
  startFixtureServer,
  pageRoute,
  links,
  stagingDirectories,
  liveTransportChildren,
} from "./helpers/research-qualification.js";

for (const adapter of ["pi", "mcp"] as const)
  for (const phase of ["staging", "report", "accounting"] as const) {
    test(`${adapter} abort after a real ${phase} write has started drains the outstanding filesystem work (T04/T06/T22)`, async () => {
      const controller = new AbortController();
      const open = fs.open;
      const writeFile = fs.writeFile;
      let abortAt: number | undefined;
      let writesStarted = 0;
      let writesSettled = 0;
      let pendingAtAbort = false;
      const observe = <T>(work: Promise<T>): Promise<T> => {
        writesStarted++;
        pendingAtAbort = true;
        // The original Node filesystem API was already invoked. No writer or
        // operation is replaced or delayed; kernel completion time is unknown.
        abortAt = performance.now();
        controller.abort();
        return work.finally(() => {
          writesSettled++;
        });
      };
      let server: Awaited<ReturnType<typeof startFixtureServer>> | undefined;
      let cleanup: (() => Promise<void>) | undefined;
      let cacheRoot: string | undefined;
      try {
        if (phase === "staging") {
          fs.writeFile = ((...args: Parameters<typeof writeFile>) => {
            const work = writeFile(...args);
            if (
              abortAt === undefined &&
              /[/\\]\.staging[/\\]pages-[^/\\]+[/\\]page-/.test(String(args[0]))
            )
              return observe(work);
            return work;
          }) as typeof writeFile;
        } else {
          fs.open = (async (...args: Parameters<typeof open>) => {
            const handle = await open(...args);
            const expected = phase === "report" ? "report.md" : "accounting.json";
            if (String(args[0]).endsWith(`/${expected}`)) {
              const write = handle.write.bind(handle);
              handle.write = ((...writeArgs: unknown[]) => {
                const work = Reflect.apply(write, handle, writeArgs) as Promise<unknown>;
                return abortAt === undefined ? observe(work) : work;
              }) as typeof handle.write;
            }
            return handle;
          }) as typeof open;
        }
        syncBuiltinESMExports();
        server = await startFixtureServer({ "/a": pageRoute("Alpha") });
        const url = `${server.origin}/a`;
        const script = async ({ role }: { role: "search" | "extract" | "collate" | "suggest" }) =>
          role === "search"
            ? links([url])
            : role === "extract"
              ? "Official docs\nFacts"
              : role === "collate"
                ? "Answer [S1]"
                : "[]";
        let run: () => Promise<FullData>;
        if (adapter === "pi") {
          const h = await nativeHarness({ script });
          cleanup = () => h.cleanup();
          cacheRoot = h.cacheRoot;
          run = async () => {
            const result = await h.research({ query: `write ${phase}` }, controller.signal);
            assert.equal(result.isError, true);
            return result.details!.intelli as FullData;
          };
        } else {
          const h = await mcpHarness({ script });
          cleanup = () => h.cleanup();
          cacheRoot = h.cacheRoot;
          run = async () => {
            try {
              await h.research({ query: `write ${phase}` }, controller.signal);
            } catch (error) {
              assert(error instanceof StandaloneError);
              assert.equal(error.code, "CANCELLED");
              assert(error.data);
              return error.data;
            }
            throw new Error("MCP must report cancellation");
          };
        }
        const data = await run();
        const abortToSettledMs = performance.now() - abortAt!;
        assert.notEqual(abortAt, undefined, "the selected real write was reached");
        assert(pendingAtAbort);
        assert.equal(writesStarted, writesSettled);
        assert.equal(data.outcome, "aborted");
        assert.equal(data.accounting.parentDelivery, "unknown");
        assert(abortToSettledMs < 5_000);
        assert.deepEqual(await stagingDirectories(cacheRoot), []);
        assert.deepEqual(await liveTransportChildren(), []);
        if (phase === "accounting") {
          assert.equal(data.cache.status, "committed", "report publication precedes this write");
          if (data.cache.status === "committed") assert.equal(data.cache.accountingPath, undefined);
        } else assert.notEqual(data.cache.status, "committed");
        const runs = join(cacheRoot, ".intelli-v1/runs");
        for (const name of await fs.readdir(runs)) {
          const files = await fs.readdir(join(runs, name));
          assert(!files.includes("accounting.committed.json"));
          if (phase !== "accounting") assert(!files.includes("committed.json"));
        }
      } finally {
        fs.open = open;
        fs.writeFile = writeFile;
        syncBuiltinESMExports();
        controller.abort();
        await cleanup?.();
        await server?.close();
      }
    });
  }
