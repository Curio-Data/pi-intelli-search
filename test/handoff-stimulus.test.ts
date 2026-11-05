// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v4 stimulus controls. The study question, its extraction focus and the
// six-source cap are fixed inputs, not implementation details: a drift here
// would silently change what the two arms are compared on. These tests pin the
// owner-approved text exactly and keep the synthetic fixtures neutral. The
// six-page assertions below cover test/helpers/handoff-fixtures.ts and the
// pinned-host tests. The separate driver-level observer corpus intentionally
// contains two pages because it qualifies main transport, not fan-out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUERY,
  FOCUS,
  PROTOCOL_REVISION,
  studyParams,
  studySettings,
  taskPrompt,
} from "../scripts/research-handoff/config.js";
import { buildSyntheticCorpus, syntheticPages } from "./helpers/handoff-fixtures.js";

// Verbatim from the owner receipt (evidence/agents/20261104T192721Z-research-handoff-m4/
// owner-cloudflare-question-amendment.json, approved 2026-11-05T08:03:02Z).
const APPROVED_QUERY =
  "When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?";
const APPROVED_FOCUS =
  "Identify the current supported end-to-end setup, prerequisites, configuration, code, agent integration points, limitations, and failure modes needed to answer the question. Preserve exact names, APIs, and version or maturity information found in the sources. Distinguish documented instructions from inference.";
const APPROVED_DOMAINS = ["developers.cloudflare.com", "pi.dev"];
const SOURCE_CAP = 6;

// The study asks a question; it must not leak a candidate answer. These are the
// product names and API shapes an answer would use, not the question itself.
const ANSWER_HINTS: RegExp[] = [
  /email routing/i,
  /send_email/i,
  /mailchannels/i,
  /durable object/i,
  /postgres/i,
  /database question/i,
  /advisory lock/i,
  /skip locked/i,
  /listen\/notify/i,
];

test("study stimulus is the owner-approved neutral Cloudflare question", () => {
  assert.equal(PROTOCOL_REVISION, "rh-v4");
  assert.equal(QUERY, APPROVED_QUERY);
  assert.equal(FOCUS, APPROVED_FOCUS);

  const params = studyParams();
  assert.equal(params.query, APPROVED_QUERY);
  assert.equal(params.focusPrompt, APPROVED_FOCUS);
  assert.deepEqual(params.domains, APPROVED_DOMAINS);
});

test("study configuration requests six sources at extraction concurrency two", () => {
  const settings = studySettings();
  assert.equal(settings.defaultUrls, SOURCE_CAP);
  assert.equal(settings.maxUrls, SOURCE_CAP);
  assert.equal(settings.extractionConcurrency, 2);
  assert.equal(studyParams().maxUrls, SOURCE_CAP);
  assert.equal(studyParams().maxUrls, settings.maxUrls);
});

test("both task prompts carry the approved stimulus and no answer hints", () => {
  for (const phase of ["diagnostic", "measured"] as const) {
    for (const arm of ["baseline", "candidate"] as const) {
      const prompt = taskPrompt(arm, studyParams(), phase);
      assert.ok(prompt.includes(APPROVED_QUERY), `${phase}/${arm}: prompt must name the approved question`);
      assert.ok(prompt.includes(APPROVED_FOCUS), `${phase}/${arm}: prompt must carry the approved focus`);
      for (const hint of ANSWER_HINTS) {
        assert.doesNotMatch(prompt, hint, `${phase}/${arm}: prompt must not hint at the answer (${hint})`);
      }
    }
  }
});

test("synthetic pages are neutral placeholders on the approved domains", () => {
  const pages = syntheticPages();
  assert.equal(pages.length, SOURCE_CAP);
  assert.deepEqual(
    [...new Set(pages.map((page) => new URL(page.url).hostname))].sort(),
    [...APPROVED_DOMAINS].sort(),
  );
  assert.equal(new Set(pages.map((page) => page.url)).size, pages.length, "page URLs must be unique");
  for (const page of pages) {
    assert.match(page.content, /^SYNTHETIC_/, `${page.url}: body must be visibly synthetic`);
    assert.match(page.content, /no real (?:configuration|setup instructions)/i);
    for (const hint of ANSWER_HINTS) {
      assert.doesNotMatch(page.content, hint, `${page.url}: fixture must not hint at the answer (${hint})`);
    }
  }

  const duplicate = syntheticPages(2, { duplicateContent: true });
  assert.equal(duplicate[0].content, duplicate[1].content);
  assert.match(duplicate[0].content, /^SYNTHETIC_IDENTICAL_BODY/);
});

test("the default synthetic corpus exercises the six-source cap", async () => {
  const { frozen, pages } = await buildSyntheticCorpus();
  assert.equal(pages.length, SOURCE_CAP);
  assert.equal(frozen.capture.effectiveMaxUrls, SOURCE_CAP);
  assert.equal(frozen.capture.selectedSources.length, SOURCE_CAP);
  assert.equal(frozen.extractionInputs.length, SOURCE_CAP);
  assert.equal(
    frozen.capture.userMessage,
    `${APPROVED_QUERY} site:developers.cloudflare.com OR site:pi.dev`,
  );
});
