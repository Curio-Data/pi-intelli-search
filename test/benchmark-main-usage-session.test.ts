// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isolateProcess,
  installNetworkGuard,
  selectHost,
  importHost,
  createMainFixture,
  openSession,
  writeEvidence,
  type WireUsage,
} from "./helpers/native-replay.js";
import { asJson, sha256Canonical } from "../scripts/benchmarks/canonical.js";
import { parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";
import {
  createMainUsageEvidenceCollector,
  wireMainUsageEvidence,
  mainUsageEvidenceV2Json,
} from "../scripts/benchmarks/main-usage-evidence.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isolation = await isolateProcess("main-usage-session");
const guard = installNetworkGuard();
const selected = await selectHost();
const host = await importHost(selected);
const workspace = join(isolation.root, "workspace");
await mkdir(workspace);
await writeFile(join(isolation.agentDir, "auth.json"), "{}");
await writeFile(join(isolation.agentDir, "models.json"), "{}");
after(async () => {
  guard.restore();
  if (!process.env.NATIVE_MAIN_USAGE_KEEP)
    await rm(isolation.root, { recursive: true, force: true });
});

it("actual session hooks hash-match serialised canonical messages and retain field missingness (T31)", async () => {
  const cases: Array<{
    name: string;
    usage?: Record<string, unknown>;
    uncached: number | undefined;
  }> = [
    {
      name: "complete",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
      },
      uncached: 800,
    },
    {
      name: "unknown-cache-write",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_tokens_details: { cached_tokens: 200 },
      },
      uncached: undefined,
    },
    { name: "output-only", usage: { completion_tokens: 10 }, uncached: undefined },
    { name: "no-wire-usage", uncached: undefined },
    {
      name: "explicit-zero",
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
      uncached: 0,
    },
  ];
  const evidence = [];
  for (const scenario of cases) {
    const main = await createMainFixture(selected.root);
    const collector = createMainUsageEvidenceCollector();
    let unsubscriptions: readonly (() => void)[] = [];
    const observer = (pi: ExtensionAPI) => {
      unsubscriptions = wireMainUsageEvidence(pi, collector);
    };
    const handle = await openSession({
      host,
      workspace,
      agentDir: isolation.agentDir,
      main,
      nativeFactory: null,
      codemode: "off",
      tools: [],
      extraFactories: [observer as never],
    });
    try {
      main.setScript([
        {
          text: "Scripted qualification answer.",
          ...(scenario.usage ? { usage: scenario.usage as unknown as WireUsage } : {}),
        },
      ]);
      guard.setPhase(scenario.name, []);
      await handle.session.prompt("Synthetic usage qualification only.");
      const messages = handle.events.flatMap((event) =>
        record(event) &&
        event.type === "message_end" &&
        record(event.message) &&
        event.message.role === "assistant"
          ? [event]
          : [],
      );
      assert.equal(messages.length, 1);
      const message = (messages[0] as { message: unknown }).message;
      assert.equal(collector.records.length, 1);
      assert.equal(
        collector.diagnostics.correlated,
        1,
        "A non-zero real-session hash match is mandatory",
      );
      assert.equal(collector.records[0]!.messageSha256, sha256Canonical(asJson(message)));
      const serialised = JSON.parse(
        JSON.stringify([...handle.events, ...collector.records.map(mainUsageEvidenceV2Json)]),
      );
      const parsed = parseUsageEvents(serialised, "json");
      assert.equal(parsed.assistantMessages.length, 1);
      assert.equal(parsed.assistantMessages[0]!.usage?.inputUncached, scenario.uncached);
      if (!scenario.usage) {
        assert.equal(collector.records[0]!.usageObserved, false);
        assert.equal(parsed.assistantMessages[0]!.usage, null);
      } else {
        assert.equal(collector.records[0]!.usageObserved, true);
        if (scenario.name === "output-only") {
          assert.deepEqual(parsed.assistantMessages[0]!.usage, { outputTotal: 10 });
        }
      }
      assert.equal(main.fetchCalls(), 1);
      assert.equal(main.unguardedStreams(), 0);
      assert.deepEqual(guard.violations(), []);
      evidence.push({
        scenario: scenario.name,
        host: selected,
        records: collector.records,
        diagnostics: collector.diagnostics,
        parsed,
      });
    } finally {
      for (const unsubscribe of unsubscriptions) unsubscribe();
      handle.dispose();
      guard.setPhase("setup", []);
    }
  }
  await writeEvidence(isolation.root, "main-usage-session", evidence);
});
