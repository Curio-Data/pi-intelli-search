// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspacePaths } from "../src/core/paths.js";
import type { OperationContext } from "../src/core/contracts.js";
import { SEARCH_SYSTEM_PROMPT } from "../src/core/prompts.js";
import { studyParams, studySettings } from "../scripts/research-handoff/config.js";
import { captureCommonInputs } from "../scripts/research-handoff/capture.js";
import type { JournalEvent } from "../scripts/research-handoff/contracts.js";

test("handoff common capture uses baseline search retry/selection and stops before extraction", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-capture-"));
  try {
    let calls = 0, fetchCalls = 0;
    const events: JournalEvent[] = [];
    const context: OperationContext = {
      settings: { ...studySettings(), retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
      paths: resolveWorkspacePaths(root, ".search"),
      identity: { name: "synthetic-handoff", version: "0", adapter: "pi" },
      logger: { error() {}, warn() {} },
      models: {
        preflight: async () => [],
        complete: async request => {
          assert.equal(request.systemPrompt, SEARCH_SYSTEM_PROMPT);
          calls++;
          return { text: calls === 1 ? "No links yet." : "[First](https://capture.invalid/one)",
            citations: calls === 1 ? [] : [{ url: "https://capture.invalid/two", title: "Second" }] };
        },
      },
    };
    const frozen = await captureCommonInputs({ params: studyParams(), context,
      journal: { record: event => { events.push(event); } },
      meta: { capturedAt: "2026-11-04T00:00:00Z", coreCommit: "new-synthetic", protocolRef: "synthetic-only" },
      fetchPages: async urls => {
        fetchCalls++;
        assert.deepEqual(urls, ["https://capture.invalid/one", "https://capture.invalid/two"]);
        return urls.map(url => ({ url, title: url, content: "Fresh synthetic source", status: "success" }));
      },
    });
    assert.equal(calls, 2); assert.equal(fetchCalls, 1);
    assert.equal(frozen.capture.captureAttempts, 2);
    assert.equal(frozen.pages.length, 2);
    assert.equal(events.filter(e => e.kind === "capture-search-completion").length, 2);
    assert.equal(events.filter(e => e.kind === "capture-pages").length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
