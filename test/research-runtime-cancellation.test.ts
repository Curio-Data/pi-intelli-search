// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FullData, Progress } from "../src/core/contracts.js";
import { StandaloneError } from "../packages/mcp/src/errors.js";
import {
  nativeHarness,
  mcpHarness,
  deferred,
  startFixtureServer,
  pageRoute,
  slowBodyRoute,
  untilAborted,
  links,
  liveTransportChildren,
  stagingDirectories,
} from "./helpers/research-qualification.js";

for (const adapter of ["pi", "mcp"] as const)
  test(`${adapter} abort while queued for model capacity retains only dispatched attempts (T06/T12)`, async () => {
    const server = await startFixtureServer({ "/a": pageRoute("Alpha") });
    const controllers = [new AbortController(), new AbortController()];
    const firstExtraction = deferred();
    const secondSubmitted = deferred();
    const url = `${server.origin}/a`;
    let extracts = 0;
    let submitted = 0;
    let cleanup: (() => Promise<void>) | undefined;
    let cacheRoot = "";
    let pending: Promise<FullData>[] = [];
    const script = async ({
      role,
      signal,
    }: {
      role: "search" | "extract" | "collate" | "suggest";
      signal?: AbortSignal;
    }) => {
      if (role === "search") return links([url]);
      if (role === "extract") {
        extracts++;
        firstExtraction.resolve();
        return untilAborted(signal);
      }
      return role === "collate" ? "Answer [S1]" : "[]";
    };
    const progress = (event: Progress) => {
      if (event.workStage === "extract" && /^Extracting S/.test(event.message) && ++submitted === 2)
        secondSubmitted.resolve();
    };
    try {
      if (adapter === "pi") {
        const h = await nativeHarness({
          script,
          settings: { execution: { modelConcurrency: 2 } },
          onUpdate: (event) => progress((event as { details: Progress }).details),
        });
        cleanup = () => h.cleanup();
        cacheRoot = h.cacheRoot;
        const run = async (i: number) =>
          (await h.research({ query: `queued ${i}` }, controllers[i].signal)).details!
            .intelli as FullData;
        pending = [run(0)];
        await firstExtraction.promise;
        pending.push(run(1));
      } else {
        const h = await mcpHarness({ script, tuning: { execution: { modelConcurrency: 2 } } });
        cleanup = () => h.cleanup();
        cacheRoot = h.cacheRoot;
        const run = async (i: number) => {
          try {
            await h.runtime.execute(
              "intelli_research",
              { query: `queued ${i}` },
              { signal: controllers[i].signal, onProgress: progress },
            );
          } catch (error) {
            assert(error instanceof StandaloneError);
            assert.equal(error.code, "CANCELLED");
            assert(error.data);
            return error.data;
          }
          throw new Error("Expected cancellation");
        };
        pending = [run(0)];
        await firstExtraction.promise;
        pending.push(run(1));
      }
      await secondSubmitted.promise;
      // The witnessed submission is followed only by already-resolved fixture
      // authentication before queue entry, so drain that finite microtask chain.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(extracts, 1);
      const started = performance.now();
      controllers[1].abort();
      const data = await pending[1];
      assert(performance.now() - started < 5_000);
      assert.equal(data.outcome, "aborted");
      assert.equal(data.accounting.parentDelivery, "unknown");
      assert.deepEqual(
        data.attempts.map((attempt) => attempt.role),
        ["search"],
      );
      assert.equal(extracts, 1, "the queued extraction never dispatched");
    } finally {
      controllers.forEach((controller) => controller.abort());
      await Promise.allSettled(pending);
      if (cacheRoot) assert.deepEqual(await stagingDirectories(cacheRoot), []);
      await cleanup?.();
      await server.close();
    }
  });

test("native generation replacement drains real page children before enabling the successor (T06/T10)", async () => {
  const entered = deferred();
  const server = await startFixtureServer({
    "/slow": slowBodyRoute(() => entered.resolve()),
    "/fast": pageRoute("Fast"),
  });
  let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
  let old: Promise<unknown> | undefined;
  try {
    h = await nativeHarness({
      script: async ({ role, user }) =>
        role === "search"
          ? links([`${server.origin}/${user.includes("old query") ? "slow" : "fast"}`])
          : role === "extract"
            ? "Official docs\nFacts"
            : role === "collate"
              ? "Answer [S1]"
              : "[]",
    });
    old = h.research({ query: "old query" });
    await entered.promise;
    const oldChildren = await liveTransportChildren();
    assert(oldChildren.length > 0, "a real old-generation page child is active");
    const next = {
      ...h.context,
      sessionManager: { getSessionId: () => "successor" },
    } as unknown as ExtensionContext;
    const started = performance.now();
    await h.runtime.start(next);
    assert(performance.now() - started < 5_000);
    const stillLive = await liveTransportChildren();
    assert(!oldChildren.some((pid) => stillLive.includes(pid)));
    const oldData = ((await old) as { details: { intelli: FullData } }).details.intelli;
    assert.equal(oldData.outcome, "aborted");
    const fresh = await h.runtime.execute(
      "intelli_research",
      { query: "new query" },
      undefined,
      undefined,
      next,
    );
    const data = fresh.details!.intelli as FullData;
    assert.equal(data.outcome, "completed");
    assert.notEqual(data.operationId, oldData.operationId);
    assert.deepEqual(await liveTransportChildren(), []);
  } finally {
    await old;
    await h?.cleanup();
    await server.close();
  }
});
