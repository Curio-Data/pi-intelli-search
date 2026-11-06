// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// rh-v6 continuation: protocol agreement, owner direction, source policy
// (aliases, exact hosts, relevance, bounds), derived frozen-input validation,
// identity and root refusal, and credential-free full-path and actual-host
// cases. No test dispatches live work, fetches a page or reads credentials.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RH6_PILOT, RH6_PROTOCOL_PATH, RH6_PROTOCOL_REVISION, RH6_SCOPE, RH6_OWNER_DIRECTION_PATH, RH6_OWNER_DIRECTION_SHA256, RH6_SERIES_ROOT,
  RH6_BUDGET, rh6Params, rh6Settings, syntheticContinuationInputs, SYNTHETIC_CONTINUATION_DISCOVERY, syntheticSiteFetch,
} from "../scripts/research-handoff/pilot-continuation.js";
import {
  RH6_SOURCE_POLICY, canonicalKey, fetchUrl, hostAllowed, linkBaseUrl, extractLinks, taskTerms, termsMatch, deriveSelection, verifySourceDerivation,
  type SourcePolicy,
} from "../scripts/research-handoff/source-selection.js";
import { PILOT_PROTOCOL_PATH, PILOT_SERIES_ROOT, PILOT_PARAGRAPHS, RH5_PILOT, pilotParams, pilotSettings, pilotTaskPrompt, pilotRunId } from "../scripts/research-handoff/pilot-config.js";
import { verifyOwnerDecision, verifyPilotImplementation, verifyStageReceipt } from "../scripts/research-handoff/pilot-authority.js";
import {
  pilotObserve, pilotAdmit, pilotCapture, pilotQualify, pilotRun, pilotGate, pilotSettle, runPilotSyntheticSeries, runPilotWorker, syntheticRegistry,
  pilotCorpusReviewInputs, assertPilotRates, pilotDownstreamLimits,
} from "../scripts/research-handoff/pilot.js";
import { SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID } from "../scripts/research-handoff/host.js";
import { assembleFrozenInputs, computeFrozenDigest, createFrozenFetchPages, createInputControlLatch, loadFrozenInputs, verifyFrozenInputs } from "../scripts/research-handoff/common-inputs.js";
import { syntheticInputs } from "../scripts/research-handoff/fixtures.js";
import { assertLiveEvidenceRoot, executeWorker, REPO_ROOT, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { digestFile, digestObject, digestText, sourceIdentity, unavailableRecord, writeNewJson } from "../scripts/research-handoff/storage.js";
import { PILOT_RUBRICS, PILOT_TOPICS } from "../scripts/research-handoff/pilot-config.js";
import type { FrozenInputs, JournalEvent, RunRecord } from "../scripts/research-handoff/contracts.js";
import type { FetchedPage } from "../src/core/types.js";

const SITE = "https://developers.cloudflare.com/synthetic-handoff";
const PI = "https://pi.dev/docs/synthetic-handoff";
const jsonBlockAfter = (text: string, marker: string) => {
  const block = new RegExp(`${marker}[\\s\\S]*?\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(text);
  assert.ok(block, `JSON block after ${marker}`);
  return JSON.parse(block[1]);
};
const redigest = (frozen: FrozenInputs): FrozenInputs => { const { digest: _d, ...core } = frozen; return { ...core, digest: computeFrozenDigest(core) } as FrozenInputs; };

test("rh-v6 constants transcribe the continuation protocol: revision, direction, root, parameters, settings, policy and copied rubric", async () => {
  const text = await readFile(RH6_PROTOCOL_PATH, "utf8");
  assert.match(text, new RegExp(`Revision: \`${RH6_PROTOCOL_REVISION}\``));
  assert.ok(text.includes(RH6_OWNER_DIRECTION_SHA256));
  assert.ok(text.includes("evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot"));
  assert.equal(await digestFile(RH6_OWNER_DIRECTION_PATH), RH6_OWNER_DIRECTION_SHA256);
  assert.deepEqual(jsonBlockAfter(text, "only `maxUrls` changes"), rh6Params());
  assert.deepEqual(Object.keys(rh6Params()), ["query", "focusPrompt", "domains", "maxUrls"]);
  assert.equal(digestObject(jsonBlockAfter(text, "The complete resolved research settings are frozen")), digestObject(JSON.parse(JSON.stringify(rh6Settings()))));
  assert.deepEqual(jsonBlockAfter(text, "## Source Selection Policy"), RH6_SOURCE_POLICY);
  // Only the cap differs from rh-v5; task text and route paragraphs are unchanged.
  assert.deepEqual({ ...rh6Settings(), maxUrls: 6 }, pilotSettings());
  assert.deepEqual({ ...rh6Params(), maxUrls: 6 }, pilotParams());
  assert.equal(pilotTaskPrompt("candidate", rh6Params(), "paid").split("Research parameters:")[0], pilotTaskPrompt("candidate", pilotParams(), "paid").split("Research parameters:")[0]);
  for (const paragraph of Object.values(PILOT_PARAGRAPHS)) assert.ok((await readFile(PILOT_PROTOCOL_PATH, "utf8")).includes(paragraph));
  // The rubric, corpus-acceptance and answer-assessment paragraphs are byte-identical copies.
  const v5 = (await readFile(PILOT_PROTOCOL_PATH, "utf8")).split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0].trim().split("\n\n");
  for (const paragraph of v5.slice(1, 6)) assert.ok(text.includes(paragraph), paragraph.slice(0, 60));
  // The bounded-input and no-other-grades rules, and the full record/answer/corpus/rubric identity and blinding rules, also bind rh-v6.
  const v6 = text.split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0];
  assert.ok(v6.includes("Give reviewers bounded inputs: this rubric and task, the frozen captured sources, applicability metadata and, for answer assessment, the de-identified answer and its evidence-access record."));
  assert.ok(v6.includes("Do not provide full conversation history, the raw search text or another reviewer's grades."));
  const identity = v5[6].slice(v5[6].indexOf("Record identity uses"));
  assert.ok(identity.length > 400 && v6.includes(identity), "identity and blinding rules copied in full");
  assert.ok(v6.includes("with the credential-free `rh6-review-inputs` command") && !v6.includes("`pilot-review-inputs`"));
  // The owner directed completion; numbers are coordinator restrictions within the original USD 10 ceiling.
  assert.match(text, /coordinator-selected restrictions within that direction/);
  assert.match(text, /retained cumulatively across both series; it is not a fresh grant/);
  assert.equal(RH6_BUDGET.captureNanoUsd + RH6_BUDGET.qualificationNanoUsd + RH6_BUDGET.baselinePilotNanoUsd + RH6_BUDGET.candidatePilotNanoUsd, RH6_BUDGET.totalNanoUsd);
  assert.notEqual(resolveRoot(RH6_SERIES_ROOT), resolveRoot(PILOT_SERIES_ROOT));
});
const resolveRoot = (path: string) => path.replace(/\/+$/, "");

test("rh-v6 owner direction binds scope, profile, counts, envelope, allocation, prior settlement and the new root", async () => {
  await assert.doesNotReject(verifyOwnerDecision(RH6_OWNER_DIRECTION_PATH, { definition: RH6_PILOT }));
  await assert.rejects(verifyOwnerDecision(RH6_OWNER_DIRECTION_PATH), /recorded digest/, "rh-v5 verifier never accepts the rh-v6 direction");
  const root = await mkdtemp(join(tmpdir(), "handoff-rh6-direction-"));
  try {
    const direction = JSON.parse(await readFile(RH6_OWNER_DIRECTION_PATH, "utf8"));
    const changes = [
      { scope: "research-handoff-pilot-rh-v5" }, { designatedSeriesRoot: PILOT_SERIES_ROOT },
      { profile: { ...direction.profile, maxUrls: 6 } }, { profile: { ...direction.profile, collationMaxTokens: 4000 } },
      { operationLimits: { ...direction.operationLimits, recaptures: 1 } }, { operationLimits: { ...direction.operationLimits, measuredSprintConversations: 20 } },
      { coordinatorAllocationNanoUsd: { ...direction.coordinatorAllocationNanoUsd, baselinePilot: 5_000_000_000 } },
      { maximumExperimentEnvelopeNanoUsd: 10_000_000_000 }, { priorReportedNanoUsd: 0 }, { approved: false },
    ];
    for (const [index, change] of changes.entries()) {
      const path = join(root, `changed-${index}.json`);
      await writeFile(path, JSON.stringify({ ...direction, designatedSeriesRoot: root, ...change }));
      await assert.rejects(verifyOwnerDecision(path, { definition: RH6_PILOT, designatedRoot: root, ownerDecisionSha256: await digestFile(path) }),
        /does not cover|does not match/, JSON.stringify(change));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rh-v6 canonical keys merge HTML and index.md aliases; hosts are exact; links are read in document order", () => {
  for (const alias of [`${SITE}/index.md`, `${SITE}/`, `${SITE}`, `${SITE}/index.html`, `http://DEVELOPERS.cloudflare.com./synthetic-handoff/#top`, `${SITE}/?ref=x`, `${SITE}//`]) {
    assert.equal(canonicalKey(alias), `${SITE}/`, alias);
  }
  assert.notEqual(canonicalKey(`${SITE}/page.md`), canonicalKey(`${SITE}/page/`), "only index files are aliases");
  assert.equal(canonicalKey("setup/", `${SITE}/index.md`), `${SITE}/setup/`);
  assert.equal(fetchUrl("setup/#step-2", `${SITE}/`), `${SITE}/setup/`);
  assert.equal(canonicalKey("mailto:a@b.invalid"), undefined);
  assert.equal(canonicalKey("https://user:pw@pi.dev/"), undefined);
  assert.equal(hostAllowed("https://pi.dev/docs/", ["pi.dev"]), true);
  assert.equal(hostAllowed("https://www.cloudflare.com/x/", ["developers.cloudflare.com"]), false);
  assert.equal(hostAllowed("https://docs.pi.dev/", ["pi.dev"]), false, "subdomains are not allowed");
  assert.equal(hostAllowed("https://cloudflare.com/", ["developers.cloudflare.com"]), false, "parent domains are not allowed");
  assert.deepEqual(extractLinks("x ![img](a.png) [One](one/) <https://pi.dev/two/> [skip](#frag) [m](mailto:z@z.invalid)\n[ref]: ../three/ \"t\"\n"),
    [{ href: "one/", anchor: "One" }, { href: "https://pi.dev/two/", anchor: "" }, { href: "../three/", anchor: "ref" }]);
  const terms = taskTerms(rh6Params(), RH6_SOURCE_POLICY);
  assert.ok(terms.includes("pi") && terms.includes("limitations") && !terms.includes("the") && !terms.includes("how"));
  assert.equal(termsMatch("limitations", "limits", RH6_SOURCE_POLICY), true);
  assert.equal(termsMatch("pi", "pipeline", RH6_SOURCE_POLICY), false, "short tokens match only exactly");
});

test("rh-v6 relative links resolve against the canonical directory form; the fetched URL and its query are never rewritten", () => {
  assert.equal(linkBaseUrl(`${SITE}/email-service`), `${SITE}/email-service/`);
  assert.equal(linkBaseUrl(`${SITE}/email-service?lang=en#top`), `${SITE}/email-service/?lang=en`);
  assert.equal(linkBaseUrl(`${SITE}/email-service/index.md`), `${SITE}/email-service/index.md`, "index files already resolve in their directory");
  assert.equal(linkBaseUrl(`${SITE}/page.html`), `${SITE}/page.html`);
  const params = rh6Params();
  const links = "[Setup guide](setup/) [Platform limits](/synthetic-handoff/platform/limits/) [Configuration](config/?tab=api#x)";
  const page = (url: string): FetchedPage => url.includes("email-service") && !url.endsWith("/setup/") && !url.includes("config")
    ? { url, title: "Seed", status: "success", source: "markdown", content: `# Seed
${links}` }
    : { url, title: url, status: "success", source: "markdown", content: `# ${url}
No links.` };
  for (const seed of [`${SITE}/email-service`, `${SITE}/email-service/index.md`, `${SITE}/email-service/`]) {
    const { derivation } = deriveSelection(RH6_SOURCE_POLICY, params, [seed], step => page(step.url));
    assert.equal(derivation.fetches[0].url, seed, "the seed is fetched exactly as discovered");
    assert.deepEqual(derivation.candidates.map(item => item.url).sort(), [
      `${SITE}/email-service/config/?tab=api`, `${SITE}/email-service/setup/`, `${SITE}/platform/limits/`].sort(), seed);
    assert.equal(derivation.candidates.find(item => item.url.includes("config"))?.key, `${SITE}/email-service/config/`, "the key drops the query");
    assert.ok(derivation.selected.some(item => item.url === `${SITE}/email-service/config/?tab=api`), "the fetched URL keeps its query");
  }
});

test("rh-v6 derivation records discovery decisions, follows relevant links by rank and never selects failed, duplicate or off-host pages", async () => {
  const frozen = await syntheticContinuationInputs("protocol-ref");
  const d = frozen.sourceDerivation!;
  assert.deepEqual(d.discovery.map(item => [item.url, item.decision]), [
    ["https://www.cloudflare.com/products/synthetic-handoff/", "host-not-allowed"], [`${SITE}/`, "seed"], [`${SITE}/index.md`, "duplicate-alias"],
    [`${PI}/`, "seed"], [`${SITE}/logo.png`, "non-document"]]);
  assert.deepEqual(d.selected.map(item => [item.url, item.depth]), [
    [`${SITE}/`, 0], [`${PI}/`, 0], [`${PI}/agent-tools/`, 1], [`${PI}/agent-tools/integration/`, 2], [`${PI}/services/`, 2],
    [`${SITE}/setup/`, 1], [`${SITE}/errors/`, 2], [`${SITE}/platform/limits/`, 1], [`${SITE}/maturity/`, 2],
    [`${PI}/prerequisites/`, 2], [`${SITE}/configuration/`, 2], [`${SITE}/code/`, 2]]);
  // "Agent integration" matches two task terms, so it outranks the one-term links; two-term pages then outrank the rest.
  assert.deepEqual(d.candidates.find(item => item.url === `${PI}/agent-tools/`)?.matchedTerms, ["agent", "integration"]);
  assert.equal(new Set(d.selected.map(item => item.contentSha256)).size, 12, "twelve distinct texts fill the cap");
  assert.equal(d.selected.length, RH6_SOURCE_POLICY.selectedLimit);
  assert.deepEqual(d.fetches.map(item => item.outcome), [...Array(9).fill("selected"), "fetch-error", "duplicate-content", ...Array(3).fill("selected")]);
  assert.deepEqual(d.fetches.filter(item => item.outcome !== "selected").map(item => [item.url, item.outcome]),
    [[`${PI}/broken/`, "fetch-error"], [`${PI}/mirror/`, "duplicate-content"]]);
  assert.equal(d.candidates.find(item => item.url === `${SITE}/limits-reference/`)?.status, "eligible-unfetched", "the cap, not the frontier, ends selection");
  assert.equal(d.candidates.find(item => item.url.endsWith("/blog/unrelated-news/"))?.status, "below-threshold");
  assert.ok(d.ignoredLinks.offHost >= 1 && d.ignoredLinks.known >= 1);
  assert.equal(d.stopReason, "selected-limit");
  assert.deepEqual(frozen.capture.selectedSources.map(item => item.url), d.discovery.map(item => item.url), "raw discovery list is preserved unmodified");
  assert.equal(frozen.capture.completion.text, SYNTHETIC_CONTINUATION_DISCOVERY);
  assert.deepEqual(frozen.capture.completion.citations, [], "no provider citation is forged");
  assert.ok(frozen.pages.every(entry => entry.page.status === "success"));
  assert.equal(frozen.extractionInputs.length, d.selected.length);
  assert.doesNotThrow(() => verifyFrozenInputs(frozen));
});

test("rh-v6 selection bounds: selected, fetch, depth, candidate and per-page limits are finite and recorded", () => {
  const params = rh6Params();
  // A synthetic site where every page links to ten new relevant pages.
  const fan: (url: string) => FetchedPage = url => ({ url, title: url, status: "success", source: "markdown",
    content: `# ${url}\n${Array.from({ length: 10 }, (_, i) => `[Setup limits ${i}](${url}n${i}/)`).join(" ")}` });
  const run = (policy: SourcePolicy) => deriveSelection(policy, params, [`${SITE}/`], step => fan(step.url)).derivation;
  const base = RH6_SOURCE_POLICY;
  assert.equal(run(base).selected.length, 12);
  assert.equal(run(base).stopReason, "selected-limit");
  assert.equal(run({ ...base, maxFetches: 5 }).fetches.length, 5);
  assert.equal(run({ ...base, maxFetches: 5 }).stopReason, "fetch-limit");
  assert.ok(run({ ...base, maxDepth: 1 }).selected.every(item => item.depth <= 1));
  assert.equal(run({ ...base, maxDepth: 0 }).selected.length, 1);
  assert.equal(run({ ...base, maxDepth: 0 }).stopReason, "frontier-exhausted");
  const capped = run({ ...base, maxCandidates: 3 });
  assert.equal(capped.candidates.length, 3);
  assert.ok(capped.ignoredLinks.candidateLimit > 0);
  assert.ok(run({ ...base, maxLinksPerPage: 2 }).ignoredLinks.perPageLimit > 0);
  const seeds = deriveSelection(base, params, Array.from({ length: 8 }, (_, i) => `${SITE}/s${i}/`), step => fan(step.url)).derivation;
  assert.equal(seeds.discovery.filter(item => item.decision === "seed").length, 6);
  assert.equal(seeds.discovery.filter(item => item.decision === "seed-limit").length, 2);
});

test("rh-v6 frozen validation re-derives the inventory and rejects forged, reordered, partial or unregistered derivations even when re-digested", async () => {
  const frozen = structuredClone(await syntheticContinuationInputs("protocol-ref"));
  const mutate = (change: (copy: FrozenInputs) => void) => { const copy = structuredClone(frozen); change(copy); return redigest(copy); };
  const cases: Array<[string, FrozenInputs]> = [
    ["forged selected url", mutate(copy => { copy.sourceDerivation!.selected[2].url = "https://developers.cloudflare.com/handpicked/"; copy.pages[2].page.url = "https://developers.cloudflare.com/handpicked/"; })],
    ["reordered pages", mutate(copy => { copy.pages.reverse(); copy.sourceDerivation!.selected.reverse(); })],
    ["changed page bytes", mutate(copy => { copy.pages[1].page.content += "\nedited"; copy.pages[1].contentSha256 = digestText(copy.pages[1].page.content); })],
    ["partial corpus", mutate(copy => { copy.pages[3].page.status = "error"; })],
    ["unregistered policy", mutate(copy => { copy.sourceDerivation!.policy = { ...copy.sourceDerivation!.policy, maxDepth: 5 }; })],
    ["superseded policy id", mutate(copy => { copy.sourceDerivation!.policy = { ...copy.sourceDerivation!.policy, id: "rh-v6-source-policy-1" }; })],
    ["off-host discovery admitted", mutate(copy => { copy.sourceDerivation!.discovery[0].decision = "seed"; })],
    ["forged citation", mutate(copy => { copy.capture.completion.citations = [{ url: `${SITE}/handpicked/` }] as never; })],
  ];
  for (const [label, copy] of cases) assert.throws(() => verifyFrozenInputs(copy), /frozen input structure mismatch/, label);
  // A historical corpus without a derivation keeps its original semantics and digest.
  const historical = await syntheticInputs("protocol-ref", pilotSettings());
  assert.equal(historical.sourceDerivation, undefined);
  assert.doesNotThrow(() => verifyFrozenInputs(historical));
  assert.equal(verifySourceDerivation(historical as never).length, 0);
  await assert.rejects(assembleFrozenInputs({ params: rh6Params(), settings: rh6Settings(), searchCompletion: frozen.capture.completion, searchAttempts: 1,
    pages: [], sourceDerivation: { ...frozen.sourceDerivation!, selected: [] }, meta: frozen.meta }), /pages length/);
});

test("rh-v6 replay serves the derived pages for the core's raw discovery request and latches any other request", async () => {
  const frozen = await syntheticContinuationInputs("protocol-ref");
  const events: JournalEvent[] = [];
  const latch = createInputControlLatch();
  const fetch = createFrozenFetchPages({ frozen, journal: { record: event => { events.push(event); } }, latch });
  const s = rh6Settings();
  const options = { timeoutMs: s.fetchTimeoutMs, browser: s.browserFingerprint, concurrency: s.fetchConcurrency, proxy: s.httpProxy } as never;
  const served = await fetch(frozen.capture.selectedSources.map(item => item.url), undefined, options);
  assert.deepEqual(served.map(page => page.url), frozen.sourceDerivation!.selected.map(item => item.url));
  assert.equal(events[0].data.derivedInventory, true);
  const other = createFrozenFetchPages({ frozen, journal: { record: () => {} }, latch: createInputControlLatch() });
  await assert.rejects(other(frozen.sourceDerivation!.selected.map(item => item.url), undefined, options), /latched/, "the derived list is not the core's request");
});

async function rh6AuthorityFixture() {
  const root = await mkdtemp(join(tmpdir(), "handoff-rh6-authority-"));
  const direction = JSON.parse(await readFile(RH6_OWNER_DIRECTION_PATH, "utf8"));
  const ownerPath = join(root, "owner-direction.json");
  await writeFile(ownerPath, JSON.stringify({ ...direction, designatedSeriesRoot: root }));
  const ownerSha = await digestFile(ownerPath);
  const technical = join(root, "technical.md"), prose = join(root, "prose.md");
  await writeFile(technical, "technical review\n"); await writeFile(prose, "prose review\n");
  const acceptance = {
    schemaVersion: 1, kind: "pilot-implementation-acceptance", acceptedBy: "coordinator", accepted: true,
    scope: RH6_SCOPE, protocolRevision: RH6_PROTOCOL_REVISION, seriesRoot: root,
    ownerDecisionPath: ownerPath, ownerDecisionSha256: ownerSha, codeSha256: (await sourceIdentity(REPO_ROOT)).digest,
    protocolSha256: await digestFile(RH6_PROTOCOL_PATH), technicalReviewPath: technical, technicalReviewSha256: await digestFile(technical),
    proseReviewPath: prose, proseReviewSha256: await digestFile(prose),
  };
  const acceptancePath = join(root, "implementation-acceptance.json");
  writeNewJson(acceptancePath, acceptance);
  const seams = { definition: RH6_PILOT, designatedRoot: root, ownerDecisionSha256: ownerSha, rootCheck: async () => {} };
  return { root, acceptance, acceptancePath, ownerPath, seams };
}

test("rh-v6 authority refuses rh-v5 receipts, the closed rh-v5 root, other roots and receipts bound to another acceptance", async () => {
  const { root, acceptance, acceptancePath, seams } = await rh6AuthorityFixture();
  try {
    const verified = await verifyPilotImplementation(acceptancePath, seams);
    assert.equal(verified.definition, RH6_PILOT);
    assert.equal(JSON.parse(await readFile(join(root, "pilot-root-binding.json"), "utf8")).scope, RH6_SCOPE);
    await assert.rejects(verifyPilotImplementation(acceptancePath, { ...seams, definition: RH5_PILOT }), /Not an accepted rh-v5-pilot-1/);
    const v5 = join(root, "v5-acceptance.json");
    writeNewJson(v5, { ...acceptance, scope: "research-handoff-pilot-rh-v5", protocolRevision: "rh-v5-pilot-1" });
    await assert.rejects(verifyPilotImplementation(v5, seams), /Not an accepted rh-v6-pilot-1/);
    const oldRoot = join(root, "old-root.json");
    writeNewJson(oldRoot, { ...acceptance, seriesRoot: PILOT_SERIES_ROOT });
    await assert.rejects(verifyPilotImplementation(oldRoot, { ...seams, designatedRoot: PILOT_SERIES_ROOT }), /closed rh-v5 root cannot be reopened/);
    await assert.rejects(verifyPilotImplementation(oldRoot, seams), /other than the designated/);
    await assert.rejects(verifyPilotImplementation(acceptancePath, { definition: RH6_PILOT }), /designated/, "production binds only the real rh-v6 root");
    const foreign = join(root, "foreign-receipt.json");
    writeNewJson(foreign, { kind: "pilot-financial-admission", accepted: true, seriesRoot: root, implementationAcceptanceSha256: "0".repeat(64), ownerDecisionSha256: acceptance.ownerDecisionSha256 });
    await assert.rejects(verifyStageReceipt(foreign, "pilot-financial-admission", verified), /bound to another identity/);
    await assert.rejects(assertLiveEvidenceRoot(RH6_SERIES_ROOT), /rh-v6 pilot root accepts only rh-v6/);
    assert.throws(() => assertPilotRates({ data: [] }, RH6_PILOT), /catalogue/);
    assert.equal(pilotDownstreamLimits(RH6_PILOT).maxTokens.extract, 16_000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rh-v6 and rh-v5 workers refuse each other's corpora before any host or credential use", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-rh6-identity-"));
  try {
    const code = (await sourceIdentity(REPO_ROOT)).digest;
    const plain = await syntheticInputs("protocol-ref", rh6Settings());
    const frozenPath = join(root, "plain.json");
    writeNewJson(frozenPath, plain);
    const manifest = { ...unavailableRecord("rh6-identity", "pilot-synthetic", "fixture").manifest, status: "scheduled" as const,
      codeSha256: code, protocolSha256: await digestFile(RH6_PROTOCOL_PATH), corpusSha256: plain.digest, settingsSha256: digestObject(rh6Settings()) };
    const cfg = { schemaVersion: 1, manifest, directory: root, workspace: root, agentDir: root, frozenPath,
      pilot: { revision: RH6_PROTOCOL_REVISION, budgetNanoUsd: 0, financialMode: "no-charges", scenario: "complete" } } as WorkerConfig;
    await assert.rejects(runPilotWorker(cfg), /source derivation differs/);
    const derived = await syntheticContinuationInputs("protocol-ref");
    const derivedPath = join(root, "derived.json");
    writeNewJson(derivedPath, derived);
    await assert.rejects(runPilotWorker({ ...cfg, frozenPath: derivedPath, manifest: { ...manifest, protocolSha256: await digestFile(PILOT_PROTOCOL_PATH),
      corpusSha256: derived.digest, settingsSha256: digestObject(pilotSettings()) }, pilot: { ...cfg.pilot!, revision: "rh-v5-pilot-1" } }), /identity changed|derivation differs/);
    await assert.rejects(runPilotWorker({ ...cfg, pilot: { ...cfg.pilot!, revision: "rh-v7" as never } }), /Invalid scheduled pilot worker/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rh-v6 actual-host synthetic cases replay the derived corpus: complete and recovery pass; truncation and budget refusal fail", { timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-rh6-synthetic-"));
  try {
    const result = await runPilotSyntheticSeries(join(root, "series"), ["complete", "recovery", "truncated", "budget-refused"], undefined, RH6_PILOT);
    assert.equal(result.passed, true, JSON.stringify(result.outcomes, null, 2));
    const outcome = JSON.parse(await readFile(join(root, "series", "series-outcome.json"), "utf8"));
    assert.equal(outcome.revision, RH6_PROTOCOL_REVISION);
    assert.equal(outcome.derivedSources.length, 12);
    for (const arm of ["baseline", "candidate"]) {
      const record = JSON.parse(await readFile(join(root, "series", "runs", `series-complete-${arm}`, "record.json"), "utf8")) as RunRecord;
      assert.equal(record.adapterEvents.filter(event => event.kind === "extract-consumed").length, 12, `${arm}: every derived page reached real downstream dispatch`);
      assert.equal(record.adapterEvents.filter(event => event.kind === "model-request" && event.stage === "extract").length, 12, `${arm}: twelve extraction requests`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function lockFor(dir: string, record: RunRecord, corpusSha256: string, rubricSha256: string): Promise<string> {
  const reviews = [];
  for (const reviewer of ["answer-reviewer-1", "answer-reviewer-2"]) {
    const path = join(dir, `${record.manifest.runId}-${reviewer}.json`);
    await writeFile(path, JSON.stringify({ reviewer, runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record), answerSha256: digestText(record.finalAnswer),
      corpusSha256, rubricSha256, lockedAt: "2026-11-06T16:00:00Z", materialUnsupportedClaim: false,
      grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic => [topic, { pass: true, reasons: "Fixture.", sourceRefs: ["page-1"] }]))])) }));
    reviews.push({ path, sha256: await digestFile(path) });
  }
  const lock = join(dir, `${record.manifest.runId}-lock.json`);
  await writeFile(lock, JSON.stringify({ schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: record.manifest.runId, reviews }));
  return lock;
}

test("rh-v6 full path integrates capture derivation, review bundle, qualification, both arms, gates and settlement without credentials or network", { timeout: 300_000 }, async () => {
  const { root, acceptance, acceptancePath, seams } = await rh6AuthorityFixture();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  const auth = join(root, "credential-reference-never-read");
  const dispatched: WorkerConfig[] = [];
  const synthetic = (scenario: "observer-complete" | "complete") => async (cfg: WorkerConfig) => {
    dispatched.push(structuredClone(cfg));
    const { acceptancePath: _a, authPath: _p, ...rest } = cfg;
    return executeWorker({ ...rest, manifest: { ...cfg.manifest, phase: "pilot-synthetic", mainModel: { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID } },
      pilot: { ...cfg.pilot!, scenario } });
  };
  const common = { ...seams, credentialCheck: async () => {}, wait: async () => {} };
  const bound = async (kind: string, extra: Record<string, unknown> = {}) => ({ kind, accepted: true, seriesRoot: root,
    implementationAcceptanceSha256: await digestFile(acceptancePath), ownerDecisionSha256: acceptance.ownerDecisionSha256, ...extra });
  try {
    const observed = await pilotObserve(acceptancePath, auth, { ...common, execute: synthetic("observer-complete") });
    assert.equal(observed.stopped, false, await readFile(observed.outcomePath, "utf8"));
    const diagnostic = join(root, "diagnostic-acceptance.json");
    writeNewJson(diagnostic, await bound("pilot-diagnostic-acceptance", { recoveryPurposeReviewed: true }));
    const catalogue = { data: [
      { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
      { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } }] };
    await pilotAdmit(acceptancePath, diagnostic, { ...common, fetchCatalogue: async () => catalogue });
    const admission = JSON.parse(await readFile(join(root, "financial-admission-receipt.json"), "utf8"));
    assert.equal(admission.envelopeNanoUsd, RH6_BUDGET.totalNanoUsd);
    assert.equal(admission.scope, RH6_SCOPE);
    const registry = syntheticRegistry("complete", SYNTHETIC_CONTINUATION_DISCOVERY);
    const requested: string[][] = [];
    const pages = async (urls: string[]) => { requested.push(urls); return urls.map(syntheticSiteFetch); };
    const frozenPath = await pilotCapture(acceptancePath, auth, { ...common, modelRegistry: registry, fetchPages: pages as never });
    assert.ok(requested.every(batch => batch.length === 1), "each policy step is one single-URL acquisition");
    assert.equal(requested.length, 14, "twelve selected plus the deliberate error and duplicate acquisitions");
    const frozen = await loadFrozenInputs({ path: frozenPath });
    assert.equal(frozen.sourceDerivation?.selected.length, 12);
    assert.equal(new Set(frozen.pages.map(entry => entry.contentSha256)).size, 12);
    assert.equal(digestObject(frozen.settings), digestObject(rh6Settings()));
    assert.deepEqual(frozen.capture.params, rh6Params());
    const events = (await readFile(join(root, "capture", "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as JournalEvent);
    assert.equal(events.filter(event => event.kind === "capture-selection-fetch").length, 14);
    const bundle = JSON.parse(await readFile(await pilotCorpusReviewInputs(frozenPath, join(root, "corpus-review"), RH6_PILOT), "utf8"));
    assert.equal(bundle.pages.length, 12);
    assert.ok(!JSON.stringify(bundle).includes(SYNTHETIC_CONTINUATION_DISCOVERY), "bundle omits the raw search text");
    assert.ok(bundle.derivation.fetches.every((item: Record<string, unknown>) => !("page" in item)));
    await assert.rejects(pilotCorpusReviewInputs(frozenPath, join(root, "corpus-review-v5"), RH5_PILOT), /source derivation differs/);
    const review = join(root, "corpus-review.md");
    await writeFile(review, "fixture corpus review\n");
    const corpus = join(root, "corpus-acceptance.json");
    writeNewJson(corpus, await bound("pilot-corpus-acceptance", { corpusSha256: frozen.digest, reviewer: "corpus-reviewer", reviewPath: review,
      reviewSha256: await digestFile(review), readableSelectedPages: 12 }));
    await pilotQualify(acceptancePath, auth, corpus, { ...common, modelRegistry: registry });
    const baseline = await pilotRun(acceptancePath, auth, "baseline", corpus, { ...common, execute: synthetic("complete") });
    assert.equal(baseline.passed, true);
    assert.equal(dispatched.at(-1)!.pilot!.budgetNanoUsd, RH6_BUDGET.baselinePilotNanoUsd);
    assert.equal(dispatched.at(-1)!.pilot!.revision, RH6_PROTOCOL_REVISION);
    const baseRecord = JSON.parse(await readFile(join(root, "runs", baseline.runId, "record.json"), "utf8")) as RunRecord;
    assert.equal(baseRecord.adapterEvents.filter(event => event.kind === "extract-consumed").length, 12);
    assert.equal((await pilotGate(acceptancePath, "baseline", await lockFor(root, baseRecord, frozen.digest, acceptance.protocolSha256), common)).passed, true);
    const ended = Date.parse(baseRecord.manifest.endedAt!);
    const candidate = await pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: () => ended + 31_000 });
    assert.equal(candidate.passed, true);
    const candRecord = JSON.parse(await readFile(join(root, "runs", candidate.runId, "record.json"), "utf8")) as RunRecord;
    const served = (record: RunRecord) => record.adapterEvents.find(event => event.kind === "fetch-served")?.data.servedUrls;
    assert.deepEqual(served(candRecord), served(baseRecord), "both arms replay identical derived sources");
    assert.equal((served(candRecord) as string[]).length, 12);
    assert.equal(candRecord.adapterEvents.filter(event => event.kind === "extract-consumed").length, 12);
    assert.equal(candRecord.manifest.corpusSha256, baseRecord.manifest.corpusSha256);
    assert.equal((await pilotGate(acceptancePath, "candidate", await lockFor(root, candRecord, frozen.digest, acceptance.protocolSha256), common)).passed, true);
    const settlement = JSON.parse(await readFile(await pilotSettle(acceptancePath, common), "utf8"));
    assert.equal(settlement.closed, true);
    assert.equal(settlement.unknownNanoUsd, 0);
    assert.equal(settlement.releasedNanoUsd, RH6_BUDGET.totalNanoUsd - settlement.reportedNanoUsd);
    assert.deepEqual(dispatched.map(cfg => cfg.manifest.runId), [pilotRunId(root, "observer", "baseline"), pilotRunId(root, "observer", "candidate"),
      pilotRunId(root, "pilot", "baseline"), pilotRunId(root, "pilot", "candidate")]);
    for (const later of [() => pilotObserve(acceptancePath, auth, common), () => pilotCapture(acceptancePath, auth, common),
      () => pilotRun(acceptancePath, auth, "candidate", corpus, common), () => pilotSettle(acceptancePath, common)]) {
      await assert.rejects(later(), /settled and closed/);
    }
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});
