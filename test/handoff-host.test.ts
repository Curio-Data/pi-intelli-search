// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Actual-host synthetic tests (Track B): both arms execute through the pinned
// Pi 1.5.0 SDK with the REAL openai-responses provider serialisation (a
// scripted fetch supplies the SSE), the REAL baseline research pipeline via
// Track A's registration with a frozen synthetic corpus, and, for the
// candidate arm, the REAL Codemode sandbox. Negative routes cover dispatch
// caps, retry attempts, fetch throws, containment and isolation. No network,
// no credentials: TMPDIR is redirected into task-owned scratch by the runner.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadPinnedHost,
  type SyntheticFetchOutcome,
  createStudySession,
  createRecorder,
  allowedToolsForArm,
  containedReadTool,
  mainModelIdFor,
  combineFinalRetainedContext,
  SYNTHETIC_MODEL_ID,
  type StudySession,
  type SyntheticScript,
  type HostHandle,
} from "../scripts/research-handoff/host.js";
import { RunRecorder } from "../scripts/research-handoff/recorder.js";
import { createBenchmarkResearchExtension } from "../scripts/research-handoff/registration.js";
import { DurableJournal } from "../scripts/research-handoff/storage.js";
import { taskPrompt } from "../scripts/research-handoff/config.js";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../src/core/prompts.js";
import type { Arm } from "../scripts/research-handoff/contracts.js";
import {
  buildSyntheticCorpus,
  writeFrozenFile,
  syntheticCallLlmDelegate,
  isolateAgentEnv,
  singleCacheDir,
  type SyntheticDelegateCall,
} from "./helpers/handoff-fixtures.js";

interface Harness {
  host: HostHandle;
  workspace: string;
  agentEnv: { restore(): void; agentDir: string };
  frozenPath: string;
  delegateCalls: SyntheticDelegateCall[];
  recorder: RunRecorder;
  durableDir: string;
}

const HOST_CACHE: { handle?: HostHandle } = {};

async function pinnedHost(): Promise<HostHandle> {
  HOST_CACHE.handle ??= await loadPinnedHost();
  return HOST_CACHE.handle;
}

async function setup(
  arm: Arm,
  script: SyntheticScript,
  appendSystemPrompt?: string[],
): Promise<{ harness: Harness; session: StudySession }> {
  const host = await pinnedHost();
  const corpus = await buildSyntheticCorpus();
  const frozenPath = writeFrozenFile(corpus.frozen);
  const agentEnv = isolateAgentEnv(corpus.settings);
  const workspace = mkdtempSync(join(tmpdir(), "rh-ws-"));
  writeFileSync(join(workspace, "note.txt"), "workspace note for contained read\n");
  const delegateCalls: SyntheticDelegateCall[] = [];
  const delegate = syntheticCallLlmDelegate({ frozen: corpus.frozen, calls: delegateCalls });
  const durableDir = mkdtempSync(join(tmpdir(), "rh-durable-"));
  const recorder = createRecorder(
    `rh-${arm}-synthetic`,
    arm,
    allowedToolsForArm(arm),
    mainModelIdFor(true),
    new DurableJournal(durableDir, `rh-${arm}-synthetic`),
  );
  const session = await createStudySession(host, {
    runId: `rh-${arm}-synthetic`,
    arm,
    phase: "synthetic",
    workspaceDir: workspace,
    agentDir: agentEnv.agentDir,
    credentials: { kind: "inmemory", credentials: {} },
    research: { extension: createBenchmarkResearchExtension, frozenPath, expectedDigest: corpus.frozen.digest, callLlmDelegate: delegate },
    syntheticScript: script,
    ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
  }, recorder);
  return { harness: { host, workspace, agentEnv, frozenPath, delegateCalls, recorder, durableDir }, session };
}

function messageTurn(text: string, tokens = { input: 900, output: 120 }): SyntheticFetchOutcome[] {
  return [{
    kind: "response" as const,
    status: 200,
    turn: {
      items: [{ type: "message" as const, text }],
      usage: { input_tokens: tokens.input, output_tokens: tokens.output, cached_tokens: 0, reasoning_tokens: 5 },
    },
  }];
}

function researchCallTurn(args: unknown): SyntheticFetchOutcome[] {
  return [{
    kind: "response" as const,
    status: 200,
    turn: {
      items: [{ type: "function_call" as const, name: "intelli_research", args }],
      usage: { input_tokens: 1200, output_tokens: 80, cached_tokens: 400, reasoning_tokens: 12 },
    },
  }];
}

test("loadPinnedHost asserts the pinned 1.5.0 identity and peer package roots", async () => {
  const host = await pinnedHost();
  assert.equal(host.identity.version, "1.5.0");
  assert.ok(host.identity.path.includes("releases/1.5.0"), host.identity.path);
  for (const [peer, info] of Object.entries(host.identity.dependencies)) {
    assert.ok(peer.startsWith("@earendil-works/"), peer);
    assert.ok(info.path.endsWith(peer.split("/").slice(1).join("/")), `${peer} root is the package root: ${info.path}`);
    assert.match(info.version, /^1\.5\./, `${peer} version`);
    assert.ok(!info.path.includes("/dist"), `${peer} root must not be a dist directory`);
  }
  assert.equal(typeof host.codexStats.get, "function");
  assert.equal(typeof host.markRuntimeStreamFunction, "function");
});

test("baseline nominal route: direct research call through the actual pinned host", async () => {
  const corpus = await buildSyntheticCorpus();
  const { harness, session } = await setup("baseline", [
    researchCallTurn(corpus.params),
    messageTurn("SKIP LOCKED selects free rows; advisory locks outlive transactions; LISTEN/NOTIFY only wakes workers. Report saved."),
  ]);
  try {
    assert.deepEqual([...session.activeTools()].sort(), ["intelli_research", "read"]);
    const systemPrompt = session.systemPrompt();
    assert.ok(systemPrompt.includes("intelli_research"), "research tool declared");
    // The host's built-in docs hint mentions codemode generically; what matters
    // is that no codemode TOOL DECLARATION or guidance reaches the baseline.
    assert.ok(!/^\s*- codemode:/m.test(systemPrompt), "no codemode declaration in baseline");
    assert.ok(!systemPrompt.includes("Use codemode to batch"), "no codemode guidance in baseline");
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "completed", JSON.stringify(observation.conformance.problems));
    assert.equal(observation.requests.length, 2, "initial + answer resumption");
    assert.equal(observation.requests[0].afterToolCall, false);
    assert.equal(observation.requests[1].afterToolCall, true);
    assert.equal(observation.requests[1].finalAnswerProducing, true);
    assert.ok(observation.finalAnswer.includes("SKIP LOCKED"));
    // Exact fetch-level observation on both logical requests.
    for (const request of observation.requests) {
      assert.equal(request.attempts.length, 1);
      const attempt = request.attempts[0];
      assert.equal(attempt.status, "completed");
      assert.equal(attempt.wireEncoding, "synthetic");
      assert.ok(attempt.usage && attempt.usage.input !== undefined, "raw provider usage harvested");
      const payload = attempt.payload as { model?: string; input?: unknown[] };
      assert.equal(payload?.model, SYNTHETIC_MODEL_ID);
      assert.ok(Array.isArray(payload?.input) && payload.input.length > 0, "full transmitted input recorded");
    }
    const first = observation.requests[0].attempts[0].usage ?? {};
    assert.equal(first.cacheRead, 400);
    assert.equal(first.reasoning, 12);
    // Full model-visible context preserved (peak/retained accounting input).
    const context = observation.requests[1].context as { messages: unknown[] };
    assert.ok(context.messages.length >= 3, "system + user + assistant + tool results retained");
    // Real research pipeline ran: tool call, evidence, delegate stages.
    const research = observation.toolCalls.find((call) => call.name === "intelli_research");
    assert.ok(research, "intelli_research recorded");
    assert.equal(research?.parentToolCallId, undefined);
    assert.ok(research?.resultText?.includes("Synthetic synthesis"), "unchanged-text result returned");
    const cacheDir = singleCacheDir(harness.workspace);
    assert.ok(existsSync(join(cacheDir, "report.md")), "real report persisted in the run workspace");
    assert.ok(observation.adapterEvents.some((event) => event.kind === "research-admitted"));
    const corpusBound = observation.adapterEvents.find((event) => event.kind === "observer/corpus-bound");
    assert.ok(corpusBound, "corpus binding journalled");
    assert.equal(corpusBound?.data.expectedDigest, corpusBound?.data.servedDigest, "served digest equals the accepted digest");
    // Search is replayed by the frozen client; only extraction and collation delegate.
    const extractions = harness.delegateCalls.filter((call) => call.systemPrompt === EXTRACTION_SYSTEM_PROMPT).length;
    const collations = harness.delegateCalls.filter((call) => call.systemPrompt === COLLATION_SYSTEM_PROMPT).length;
    assert.equal(extractions, 3, "three frozen pages extracted live");
    assert.equal(collations, 1, "one collation");
    assert.equal(observation.observerCoverage.verified, true, JSON.stringify(observation.observerCoverage.problems));
    assert.equal(observation.conformance.conforms, true, JSON.stringify(observation.conformance.problems));
    // Final exposure: complete transcript, not assistants only.
    const roles = observation.finalMessages.map((message) => (message as { role?: string }).role);
    assert.ok(roles.includes("user") && roles.includes("toolResult"), `finalMessages roles: ${roles.join(",")}`);
    // Durable journal retained the run synchronously.
    const durableFiles = readdirSync(harness.durableDir);
    assert.ok(durableFiles.length >= 1, "durable journal wrote files");
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("candidate nominal route: Codemode script through the REAL sandbox", async () => {
  const corpus = await buildSyntheticCorpus();
  const code = `const r = await tools.intelli_research(${JSON.stringify(corpus.params)}); return r;`;
  const { harness, session } = await setup("candidate", [
    [{
      kind: "response" as const,
      status: 200,
      turn: {
        items: [{ type: "function_call" as const, name: "codemode", args: { code } }],
        usage: { input_tokens: 1500, output_tokens: 200, cached_tokens: 0, reasoning_tokens: 20 },
      },
    }],
    messageTurn("One handoff: the script returned the research summary with evidence links."),
  ]);
  try {
    assert.ok(session.activeTools().includes("codemode"), `active: ${session.activeTools().join(",")}`);
    assert.ok(session.activeTools().includes("intelli_research"), "research callable from scripts");
    const candidatePrompt = session.systemPrompt();
    assert.ok(/^\s*- codemode:/m.test(candidatePrompt), "codemode declared in candidate");
    assert.ok(!/^\s*- intelli_research:/m.test(candidatePrompt), "research hidden from direct declaration (mode only)");
    assert.ok(!/^\s*- read:/m.test(candidatePrompt), "read hidden from direct declaration (mode only)");
    await session.prompt(taskPrompt("candidate"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "completed", JSON.stringify(observation.conformance.problems));
    assert.equal(observation.requests.length, 2, "codemode does not add main-model turns");
    const codemode = observation.toolCalls.find((call) => call.name === "codemode");
    assert.ok(codemode, "top-level codemode call recorded");
    assert.equal(codemode?.parentToolCallId, undefined);
    const nested = observation.toolCalls.find((call) => call.name === "intelli_research" && call.parentToolCallId);
    assert.ok(nested, "nested research call carries parentToolCallId (real sandbox execution)");
    assert.ok(codemode?.resultText?.includes("Script completed"), "actual Codemode envelope returned");
    assert.ok(nested?.resultText?.includes("Synthetic synthesis"), "nested call returned the research text");
    const cacheDir = singleCacheDir(harness.workspace);
    assert.ok(existsSync(join(cacheDir, "report.md")), "evidence written through the sandbox path");
    assert.equal(observation.conformance.conforms, true, JSON.stringify(observation.conformance.problems));
    assert.equal(observation.observerCoverage.verified, true, JSON.stringify(observation.observerCoverage.problems));
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("negative route: the fifth logical main request is refused before dispatch", async () => {
  const readTurn = (index: number) => [{
    kind: "response" as const,
    status: 200,
    turn: {
      items: [{ type: "function_call" as const, name: "read", args: { path: "note.txt" } }],
      usage: { input_tokens: 700 + index, output_tokens: 30, cached_tokens: 0, reasoning_tokens: 1 },
    },
  }];
  const { harness, session } = await setup("baseline", [
    readTurn(1), readTurn(2), readTurn(3), readTurn(4),
    messageTurn("never transmitted"),
  ]);
  try {
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "nonconforming");
    assert.equal(observation.requests.length, 4, "the fifth request was never dispatched");
    assert.ok(observation.conformance.problems.some((problem) => problem.includes("main-request cap")));
    assert.ok(observation.adapterEvents.some((event) => event.kind === "observer/main-request-blocked"));
    // Partial evidence retained: four complete requests with payloads and usage.
    assert.equal(observation.requests.filter((request) => request.attempts.length === 1).length, 4);
    assert.equal(observation.requests.some((request) => request.finalAnswerProducing), false);
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("negative route: HTTP retries are counted per physical fetch, then succeed", async () => {
  const { harness, session } = await setup("baseline", [
    [
      { kind: "response" as const, status: 429, turn: { items: [] } },
      { kind: "response" as const, status: 500, turn: { items: [] } },
      ...messageTurn("Recovered after two failed attempts."),
    ],
  ]);
  try {
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "completed", JSON.stringify(observation.error ?? observation.conformance.problems));
    const attempts = observation.requests[0].attempts;
    assert.equal(attempts.length, 3, "three physical attempts at the fetch boundary");
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["error", "error", "completed"]);
    assert.match(String(attempts[0].error), /http 429/);
    assert.match(String(attempts[1].error), /http 500/);
    assert.ok(attempts[2].usage?.input === 900, "usage from the successful attempt only");
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("negative route: a thrown fetch is counted per attempt even though it never produced a response", async () => {
  const { harness, session } = await setup("baseline", [
    [
      { kind: "throw" as const, message: "simulated socket failure before headers" },
      { kind: "throw" as const, message: "simulated socket failure before headers" },
      { kind: "throw" as const, message: "simulated socket failure before headers" },
    ],
  ]);
  try {
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "failed");
    const attempts = observation.requests[0].attempts;
    // The pinned SDK classifies a thrown fetch as a retryable connection
    // error, so the provider policy (maxRetries 2) retries it; every physical
    // call is counted at the fetch boundary even with no HTTP response.
    assert.equal(attempts.length, 3, "all three fetch-throw attempts are retained");
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["error", "error", "error"]);
    for (const attempt of attempts) assert.match(String(attempt.error), /simulated socket failure/);
    assert.ok(observation.error !== undefined);
    assert.equal(observation.requests.length, 1, "the failed logical request was not resumed");
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("negative route: synthetic sessions refuse real credential references", async () => {
  const host = await pinnedHost();
  const corpus = await buildSyntheticCorpus();
  const frozenPath = writeFrozenFile(corpus.frozen);
  const agentEnv = isolateAgentEnv(corpus.settings);
  const workspace = mkdtempSync(join(tmpdir(), "rh-ws-"));
  try {
    const recorder = createRecorder("rh-guard", "baseline", allowedToolsForArm("baseline"), mainModelIdFor(true));
    await assert.rejects(
      () => createStudySession(host, {
        runId: "rh-guard",
        arm: "baseline",
        phase: "synthetic",
        workspaceDir: workspace,
        agentDir: agentEnv.agentDir,
        credentials: { kind: "readonly-file", authPath: "/nonexistent/definitely-not-real.json" },
        research: { extension: createBenchmarkResearchExtension, frozenPath, expectedDigest: corpus.frozen.digest },
        syntheticScript: [messageTurn("never reached")],
      }, recorder),
      /must not reference real credential files/,
    );
  } finally {
    agentEnv.restore();
  }
});

test("negative route: PI_CODING_AGENT_DIR mismatch is recorded as nonconformance", async () => {
  const host = await pinnedHost();
  const corpus = await buildSyntheticCorpus();
  const frozenPath = writeFrozenFile(corpus.frozen);
  const agentEnv = isolateAgentEnv(corpus.settings); // correct dir, sets env
  const wrongDir = mkdtempSync(join(tmpdir(), "rh-wrong-agent-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = wrongDir; // mismatch BEFORE session creation
  const workspace = mkdtempSync(join(tmpdir(), "rh-ws-"));
  const recorder = createRecorder("rh-envmismatch", "baseline", allowedToolsForArm("baseline"), mainModelIdFor(true));
  const session = await createStudySession(host, {
    runId: "rh-envmismatch",
    arm: "baseline",
    phase: "synthetic",
    workspaceDir: workspace,
    agentDir: agentEnv.agentDir,
    credentials: { kind: "inmemory", credentials: {} },
    research: { extension: createBenchmarkResearchExtension, frozenPath, expectedDigest: corpus.frozen.digest },
    syntheticScript: [messageTurn("answer despite the mismatch")],
  }, recorder);
  try {
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.ok(
      observation.conformance.problems.some((problem) => problem.includes("PI_CODING_AGENT_DIR")),
      JSON.stringify(observation.conformance.problems),
    );
    assert.equal(session.recorder.outcome(), "nonconforming");
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    session.dispose();
    agentEnv.restore();
  }
});

test("F11 binding: a corpus whose digest is not the accepted digest cannot serve a session", async () => {
  const host = await pinnedHost();
  const corpus = await buildSyntheticCorpus();
  const frozenPath = writeFrozenFile(corpus.frozen);
  const agentEnv = isolateAgentEnv(corpus.settings);
  const workspace = mkdtempSync(join(tmpdir(), "rh-ws-"));
  try {
    const wrongDigest = "0".repeat(64);
    const recorder = createRecorder("rh-f11-wrong", "baseline", allowedToolsForArm("baseline"), mainModelIdFor(true));
    await assert.rejects(
      () => createStudySession(host, {
        runId: "rh-f11-wrong", arm: "baseline", phase: "synthetic",
        workspaceDir: workspace, agentDir: agentEnv.agentDir,
        credentials: { kind: "inmemory", credentials: {} },
        research: { extension: createBenchmarkResearchExtension, frozenPath, expectedDigest: wrongDigest },
        syntheticScript: [messageTurn("never reached")],
      }, recorder),
      /frozen corpus digest mismatch/,
    );
    // A tampered file that still DECLARES the accepted digest is also refused:
    // the digest is recomputed from the content, not trusted.
    const tampered = JSON.parse(JSON.stringify(corpus.frozen)) as { capture: { completion: { text: string } } };
    tampered.capture.completion.text = tampered.capture.completion.text + " TAMPERED";
    const tamperedPath = join(mkdtempSync(join(tmpdir(), "rh-tampered-")), "frozen-inputs.json");
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
    const recorder2 = createRecorder("rh-f11-tampered", "baseline", allowedToolsForArm("baseline"), mainModelIdFor(true));
    await assert.rejects(
      () => createStudySession(host, {
        runId: "rh-f11-tampered", arm: "baseline", phase: "synthetic",
        workspaceDir: workspace, agentDir: agentEnv.agentDir,
        credentials: { kind: "inmemory", credentials: {} },
        research: { extension: createBenchmarkResearchExtension, frozenPath: tamperedPath, expectedDigest: corpus.frozen.digest },
        syntheticScript: [messageTurn("never reached")],
      }, recorder2),
      /frozen corpus digest mismatch/,
    );
  } finally {
    agentEnv.restore();
  }
});

test("final retained context: system/declaration prefix present exactly once (sentinel-proven)", async () => {
  const corpus = await buildSyntheticCorpus();
  const SENTINEL = "RH-SYSTEM-SENTINEL-7f3a";
  const { harness, session } = await setup("baseline", [
    researchCallTurn(corpus.params),
    messageTurn("final answer with the prefix intact"),
  ], [SENTINEL]);
  try {
    await session.prompt(taskPrompt("baseline"));
    const captured = session.recorder.lastMainContextMessages();
    assert.ok(captured, "the last dispatched stream context was captured");
    const capturedLeading = captured[0] as { role?: string };
    assert.equal(capturedLeading.role, "system");
    const capturedText = JSON.stringify(captured[0]);
    assert.ok(capturedText.includes(SENTINEL), "sentinel reached the dispatched system prefix (sections)");
    assert.ok(capturedText.includes("intelli_research"), "tool declaration carried by the system prefix");
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "completed", JSON.stringify(observation.conformance.problems));
    const finalMessages = observation.finalMessages;
    const first = finalMessages[0] as { role?: string };
    assert.equal(first.role, "system", "the retained context starts with the system message");
    assert.ok(JSON.stringify(finalMessages[0]).includes(SENTINEL), "sentinel retained in the final context");
    const sentinelCount = finalMessages.filter((message) => JSON.stringify(message).includes(SENTINEL)).length;
    assert.equal(sentinelCount, 1, "the system/declaration prefix appears exactly once");
    const roles = finalMessages.map((message) => (message as { role?: string }).role);
    assert.ok(roles.includes("user") && roles.includes("assistant") && roles.includes("toolResult"), `roles: ${roles.join(",")}`);
    // The strongest boundary proof: the wire body of the last dispatched attempt
    // carries the same system/declaration prefix exactly once (input[0]).
    const lastAttempt = observation.requests.at(-1)?.attempts.at(-1);
    const wireInput0 = JSON.stringify((lastAttempt?.payload as { input?: unknown[] } | undefined)?.input?.[0]);
    assert.ok(wireInput0.includes(SENTINEL), "the transmitted body's leading input item carries the system prefix");
    const finalContextEvent = observation.adapterEvents.find((event) => event.kind === "observer/final-context");
    assert.ok(finalContextEvent, "combination journalled");
    assert.ok(["session-had-prefix", "prefix-prepended", "prefix-from-dispatched"].includes(String(finalContextEvent?.data.action)), `action: ${String(finalContextEvent?.data.action)}`);
    assert.equal(observation.observerCoverage.verified, true, JSON.stringify(observation.observerCoverage.problems));
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("combineFinalRetainedContext: prepends the captured prefix only when the settled transcript omits it", () => {
  const system = { role: "system", content: "sys with declarations", tools: [], timestamp: 1 };
  const user = { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 2 };
  const assistant = { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 3 };
  const prepended = combineFinalRetainedContext([system, user], [user, assistant]);
  assert.equal(prepended.action, "prefix-prepended");
  assert.deepEqual(prepended.messages[0], system);
  assert.equal(prepended.messages.length, 3);
  const had = combineFinalRetainedContext([system, user, assistant], [structuredClone(system), user, assistant]);
  assert.equal(had.action, "session-had-prefix");
  assert.equal(had.messages.length, 3);
  assert.equal(had.digests?.settledPrefixDigest, undefined);
  // Session carries a DIFFERENT complete prefix (for example a mid-run loadout
  // change): the DISPATCHED prefix leads, the settled tail is kept, both
  // digests are journalled. Nothing is estimated or relabelled.
  const different = { ...system, content: "changed" };
  const dispatched = combineFinalRetainedContext([system, user], [different, user]);
  assert.equal(dispatched.action, "prefix-from-dispatched");
  assert.deepEqual(dispatched.messages[0], system);
  assert.equal(dispatched.messages.length, 2);
  assert.ok(dispatched.digests?.settledPrefixDigest && dispatched.digests.capturedPrefixDigest);
  assert.notEqual(dispatched.digests?.settledPrefixDigest, dispatched.digests?.capturedPrefixDigest);
  const none = combineFinalRetainedContext(undefined, [user, assistant]);
  assert.equal(none.action, "no-captured-prefix");
  assert.deepEqual(none.messages, [user, assistant]);
  const nonLeading = combineFinalRetainedContext([user], [user]);
  assert.equal(nonLeading.action, "no-captured-prefix");
});

test("protocol isolation gate: candidate sandbox callable set excludes built-ins; session read rejects outside sentinel", async () => {
  const corpus = await buildSyntheticCorpus();
  const outsideDir = mkdtempSync(join(tmpdir(), "rh-outside-"));
  const sentinelPath = join(outsideDir, "sentinel.txt");
  writeFileSync(sentinelPath, "OUTSIDE-SENTINEL-harmless-content");
  const code = [
    "const names = ALL_TOOLS.map((t) => t.name).sort();",
    "const attempt = await Promise.allSettled([tools.read({ path: " + JSON.stringify(sentinelPath) + " })]);",
    "const rejected = attempt[0].status === \"rejected\" ? String(attempt[0].reason).slice(0, 160) : \"LEAKED\";",
    "return JSON.stringify({ names, readStatus: attempt[0].status, reason: rejected });",
  ].join("\n");
  const { harness, session } = await setup("candidate", [
    [{
      kind: "response" as const,
      status: 200,
      turn: {
        items: [{ type: "function_call" as const, name: "codemode", args: { code } }],
        usage: { input_tokens: 1500, output_tokens: 200 },
      },
    }],
    messageTurn("Isolation verified from the sandbox report."),
  ]);
  try {
    await session.prompt(taskPrompt("candidate"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "nonconforming", JSON.stringify(observation.conformance.problems));
    assert.deepEqual([...session.activeTools()].sort(), ["codemode", "intelli_research", "read"]);
    const codemode = observation.toolCalls.find((call) => call.name === "codemode");
    assert.ok(codemode?.resultText?.includes("Script completed"), "sandbox ran the probe script");
    const envelope = codemode?.resultText ?? "";
    const reportMatch = envelope.match(/\{[\s\S]*\"names\"[\s\S]*?\}/);
    const report = JSON.parse(reportMatch ? reportMatch[0] : "{}") as {
      names: string[]; readStatus: string; reason: string;
    };
    assert.ok(report.names.includes("intelli_research"), `names: ${report.names.join(",")}`);
    assert.ok(report.names.includes("read"), `names: ${report.names.join(",")}`);
    for (const banned of ["bash", "edit", "write", "grep", "find", "ls", "powershell"]) {
      assert.ok(!report.names.includes(banned), `ALL_TOOLS exposed ${banned}`);
    }
    assert.equal(report.readStatus, "rejected");
    assert.match(report.reason, /escapes|outside the run workspace/);
    assert.ok(!envelope.includes("OUTSIDE-SENTINEL-harmless-content"), "sentinel content leaked");
    assert.equal(observation.conformance.conforms, false);
    assert.match(observation.conformance.problems.join(" "), /evidence read/);
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("protocol isolation gate: baseline session read rejects the outside sentinel directly", async () => {
  const corpus = await buildSyntheticCorpus();
  const outsideDir = mkdtempSync(join(tmpdir(), "rh-outside-"));
  const sentinelPath = join(outsideDir, "sentinel.txt");
  writeFileSync(sentinelPath, "OUTSIDE-SENTINEL-harmless-content");
  const { harness, session } = await setup("baseline", [
    [{
      kind: "response" as const,
      status: 200,
      turn: {
        items: [{ type: "function_call" as const, name: "read", args: { path: sentinelPath } }],
        usage: { input_tokens: 700, output_tokens: 40 },
      },
    }],
    messageTurn("The read was refused as expected."),
  ]);
  try {
    await session.prompt(taskPrompt("baseline"));
    const observation = session.observation();
    assert.equal(session.recorder.outcome(), "nonconforming", JSON.stringify(observation.conformance.problems));
    const read = observation.toolCalls.find((call) => call.name === "read");
    assert.ok(read, "the session executed the model-issued read call");
    assert.equal(read?.isError, true, "the session-selected read refused the outside path");
    assert.ok(!JSON.stringify(read ?? {}).includes("OUTSIDE-SENTINEL-harmless-content"), "sentinel content leaked");
  } finally {
    session.dispose();
    harness.agentEnv.restore();
  }
});

test("contained read: no absolute or symlink escape out of the workspace", async () => {
  const host = await pinnedHost();
  const root = mkdtempSync(join(tmpdir(), "rh-read-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "inside.txt"), "inside");
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "outside secret");
  symlinkSync(outside, join(workspace, "link.txt"));
  const tool = containedReadTool(host.sdk, workspace) as unknown as {
    name: string;
    execute(toolCallId: string, params: { path: string }): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
  };
  assert.equal(tool.name, "read");
  const inside = await tool.execute("t1", { path: "inside.txt" });
  assert.equal(inside.content[0].text, "inside");
  const absoluteInside = await tool.execute("t2", { path: join(workspace, "inside.txt") });
  assert.ok(absoluteInside.content[0].text.includes("inside"), "absolute paths inside the workspace are fine");
  for (const escape of ["../outside.txt", join(root, "outside.txt"), "link.txt"]) {
    const result = await tool.execute(`t-${escape}`, { path: escape }).catch((error: Error) => ({ content: [], error: error.message }));
    const rejected = "error" in result || (result as { isError?: boolean }).isError === true;
    assert.ok(rejected, `escape rejected: ${escape}`);
    const text = JSON.stringify(result);
    assert.ok(!text.includes("outside secret"), `no content leaked for ${escape}`);
  }
});

test("resource isolation: ancestor AGENTS.md instructions never reach the system prompt", async () => {
  const host = await pinnedHost();
  const corpus = await buildSyntheticCorpus();
  const frozenPath = writeFrozenFile(corpus.frozen);
  const agentEnv = isolateAgentEnv(corpus.settings);
  const parent = mkdtempSync(join(tmpdir(), "rh-parent-"));
  const workspace = join(parent, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(parent, "AGENTS.md"), "SECRET-ANCESTOR-INSTRUCTION: must never leak");
  writeFileSync(join(workspace, "AGENTS.md"), "SECRET-WORKSPACE-INSTRUCTION: must never leak");
  const recorder = createRecorder("rh-isolation", "baseline", allowedToolsForArm("baseline"), mainModelIdFor(true));
  const session = await createStudySession(host, {
    runId: "rh-isolation",
    arm: "baseline",
    phase: "synthetic",
    workspaceDir: workspace,
    agentDir: agentEnv.agentDir,
    credentials: { kind: "inmemory", credentials: {} },
    research: { extension: createBenchmarkResearchExtension, frozenPath, expectedDigest: corpus.frozen.digest },
    syntheticScript: [messageTurn("isolated answer")],
  }, recorder);
  try {
    const systemPrompt = session.systemPrompt();
    assert.ok(!systemPrompt.includes("SECRET-ANCESTOR-INSTRUCTION"), "ancestor instructions leaked");
    assert.ok(!systemPrompt.includes("SECRET-WORKSPACE-INSTRUCTION"), "workspace instructions leaked");
    assert.ok(!systemPrompt.includes("SECRET-WORKSPACE-INSTRUCTION"));
  } finally {
    session.dispose();
    agentEnv.restore();
  }
});
