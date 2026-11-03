// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Deterministic checks of the study host runner. Sessions are real AgentSessions
// and the Codex parser is the selected host's own; only its injected fetch is
// scripted, so no credential or network is reached. NATIVE_REPLAY_PI_HOST selects
// an installed host; the default is the repository's development peer.

import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  isolateProcess,
  installNetworkGuard,
  selectHost,
  REPO_ROOT,
} from "./helpers/native-replay.js";
import { asJson, sha256Canonical, sha256Text } from "../scripts/benchmarks/canonical.js";
import {
  StudyRefusalError,
  assertRepositoryAdmissible,
  createStudyRecorder,
  importStudyHost,
  installModuleLoadRecorder,
  openStudySession,
  projectRawUsage,
  projectResponseHeaders,
  rawUsageLeafPaths,
  readCredentialFileState,
  readRepositoryIdentity,
  reportLoadedDependencies,
  resolveManagedHostRoot,
  resolveStudyHostSelection,
  runBoundedPrompt,
  saveRunObservations,
  scanRunForCredentials,
  selectStudyHost,
  writeNewJson,
  writeRunManifest,
  type StudyExtensionFactory,
  type StudyHostSelection,
} from "../scripts/benchmarks/study-host.js";
import {
  METADATA_USER_PROMPT,
  metadataSystemPrompt,
} from "../scripts/benchmarks/study-metadata.js";

const isolation = await isolateProcess("study-host");
const guard = installNetworkGuard();
const moduleRecorder = installModuleLoadRecorder();
const selected = await selectHost();
const selection: StudyHostSelection = await selectStudyHost({
  root: selected.root,
  source: "explicit-root",
  expectedVersion: null,
});
const host = await importStudyHost(selection);
const workspace = join(isolation.root, "workspace");
await mkdir(workspace);
await writeFile(join(isolation.agentDir, "auth.json"), "{}");
await writeFile(join(isolation.agentDir, "models.json"), "{}");
after(async () => {
  moduleRecorder.stop();
  guard.restore();
  await rm(isolation.root, { recursive: true, force: true });
});

const PROVIDER = "fixture-codex";
const MODEL = { provider: PROVIDER, id: "codex-main" };
const FIXTURE_API = "fixture-codex-api";

/** Unsigned token of the shape the Codex provider parses for an account id. Not a credential. */
const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const FIXTURE_TOKEN = `${encode({ alg: "none" })}.${encode({
  "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" },
})}.fixture`;

interface CodexScript {
  readonly status?: number;
  readonly errorBody?: string;
  readonly terminalType?: string;
  readonly usage?: Record<string, unknown>;
  /** The request never answers until its signal aborts. */
  readonly hang?: boolean;
  /** Fetch itself fails. */
  readonly fetchError?: string;
}

const sse = (events: readonly Record<string, unknown>[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

function codexBody(id: string, script: CodexScript): string {
  const message = { type: "message", id: "msg_1", role: "assistant", status: "completed" };
  return sse([
    { type: "response.created", response: { id, status: "in_progress" } },
    {
      type: "response.output_item.added",
      item: { ...message, status: "in_progress", content: [] },
    },
    { type: "response.content_part.added", part: { type: "output_text", text: "" } },
    { type: "response.output_text.delta", delta: "OK" },
    {
      type: "response.output_item.done",
      item: { ...message, content: [{ type: "output_text", text: "OK" }] },
    },
    {
      type: script.terminalType ?? "response.completed",
      response: {
        id,
        status: "completed",
        model: "fixture-routed-model",
        service_tier: "default",
        ...(script.usage ? { usage: script.usage } : {}),
      },
    },
  ]);
}

/** A provider running the host's own Codex stream over a scripted fetch. */
async function codexFixture(script: CodexScript) {
  const codex = (await import(
    pathToFileURL(join(dirname(selection.root), "pi-ai/dist/api/openai-codex-responses.js")).href
  )) as { streamSimple: (model: unknown, context: unknown, options?: unknown) => unknown };
  let calls = 0;
  const scriptedFetch = async (
    _input: unknown,
    init?: { signal?: AbortSignal },
  ): Promise<Response> => {
    calls += 1;
    if (script.fetchError) throw new Error(script.fetchError);
    if (script.hang)
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Request was aborted")), {
          once: true,
        });
      });
    if (script.status && script.status !== 200)
      return new Response(script.errorBody ?? "", {
        status: script.status,
        headers: { "retry-after": "7" },
      });
    return new Response(codexBody(`resp_fixture_${calls}`, script), {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-codex-primary-used-percent": "12",
        "set-cookie": "session=fixture-secret-cookie",
      },
    });
  };
  const factory = (pi: { registerProvider: (name: string, config: unknown) => void }): void => {
    pi.registerProvider(PROVIDER, {
      baseUrl: "http://main.fixture.invalid/backend",
      apiKey: FIXTURE_TOKEN,
      api: FIXTURE_API,
      models: [
        {
          id: MODEL.id,
          name: "Fixture Codex Main",
          api: FIXTURE_API,
          reasoning: true,
          input: ["text"],
          cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
          contextWindow: 100_000,
          maxTokens: 1_000,
        },
      ],
      streamSimple: (
        model: Record<string, unknown>,
        context: unknown,
        options: Record<string, unknown>,
      ) =>
        codex.streamSimple({ ...model, api: "openai-codex-responses" }, context, {
          ...options,
          transport: "sse",
          fetch: scriptedFetch,
        }),
    });
  };
  return { factory: factory as unknown as StudyExtensionFactory, calls: () => calls };
}

let runCounter = 0;

async function recordedRun(script: CodexScript, timeoutMs = 20_000) {
  runCounter += 1;
  const runId = `fixture-run-${runCounter}`;
  const runDir = join(isolation.root, runId);
  await mkdir(runDir);
  const fixture = await codexFixture(script);
  const recorder = createStudyRecorder({ runId, runDir, maxRequests: 1 });
  const handle = await openStudySession({
    host,
    workspace,
    model: MODEL,
    thinkingLevel: "off",
    systemPrompt: metadataSystemPrompt(),
    transport: "sse",
    requestTimeoutMs: timeoutMs,
    tools: [],
    extensionFactories: [fixture.factory, recorder.factory],
  });
  try {
    guard.setPhase(runId, []);
    recorder.attachSession(handle.session);
    const prompt = await runBoundedPrompt(handle.session, METADATA_USER_PROMPT, {
      timeoutMs,
      abortGraceMs: 5_000,
    });
    const assessment = await saveRunObservations({ runDir, recorder, requestLimit: 1 });
    assert.deepEqual(guard.violations(runId), [], "the scripted run reaches no network primitive");
    return { runDir, recorder, handle, prompt, assessment, calls: fixture.calls() };
  } finally {
    handle.dispose();
    guard.setPhase("setup", []);
  }
}

const COMPLETE_USAGE = {
  input_tokens: 2000,
  output_tokens: 20,
  total_tokens: 2020,
  input_tokens_details: { cached_tokens: 500, cache_write_tokens: 100 },
  output_tokens_details: { reasoning_tokens: 7 },
};

it("records one actual request, raw usage and a hash-matched canonical message on a real session", async () => {
  const run = await recordedRun({ usage: COMPLETE_USAGE });
  assert.equal(run.prompt.settlement, "resolved");
  assert.equal(run.calls, 1);
  const { assessment } = run;
  assert.deepEqual(assessment.problems, []);
  assert.equal(assessment.evidenceConsistent, true);
  assert.equal(assessment.requestWindows, 1);
  assert.equal(assessment.actualRequestCaptures, 1);
  assert.equal(assessment.providerResponses, 1);
  assert.equal(assessment.assistantMessages, 1);
  const message = assessment.messages[0]!;
  assert.equal(message.responseId, "resp_fixture_1");
  assert.equal(message.rawEventType, "response.completed");
  assert.deepEqual(message.fieldsAbsentOnWire, []);
  assert.deepEqual(message.sdkPlaceholderZeros, []);
  assert.equal(message.collector?.usageObserved, true);
  assert.equal(message.parsedTokens?.inputUncached, 1400);
  assert.equal(message.uncachedInputEstablished, true);

  // Reproducible from the saved files alone.
  const canonicalLines = (await readFile(join(run.runDir, "canonical-messages.ndjson"), "utf8"))
    .trim()
    .split("\n");
  const assistant = canonicalLines
    .map((line) => JSON.parse(line))
    .find((item) => item.role === "assistant");
  assert.equal(sha256Canonical(asJson(assistant)), message.messageSha256);
  const evidence = JSON.parse(
    (await readFile(join(run.runDir, "main-usage-evidence.ndjson"), "utf8")).trim(),
  );
  assert.equal(evidence.messageSha256, message.messageSha256);
  const requests = (await readFile(join(run.runDir, "actual-requests.ndjson"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(requests.length, 1);
  const request = JSON.parse(requests[0]!);
  assert.ok(request.payload.instructions.startsWith(metadataSystemPrompt()));
  assert.equal(
    request.payload.instructions,
    run.handle.session.systemPrompt,
    "the saved request carries the effective prompt",
  );
  assert.equal(request.payload.tools, undefined, "a no-tool session declares no tools");
  assert.equal(request.toolCatalogueSha256, sha256Canonical([]));
  assert.ok(!JSON.stringify(request).includes(FIXTURE_TOKEN));
  const raw = JSON.parse((await readFile(join(run.runDir, "raw-usage.ndjson"), "utf8")).trim());
  assert.deepEqual(raw.usage, projectRawUsage(COMPLETE_USAGE));
  assert.equal(raw.responseMeta.model, "fixture-routed-model");
  const response = JSON.parse(
    (await readFile(join(run.runDir, "provider-responses.ndjson"), "utf8")).trim(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.visibleHeaders["x-codex-primary-used-percent"], "12");
  assert.equal(response.visibleHeaders["set-cookie"], undefined);
  assert.ok(response.headerNames.includes("set-cookie"));
  const shapes = JSON.parse(await readFile(join(run.runDir, "stream-event-shapes.json"), "utf8"));
  assert.deepEqual(shapes["response.completed"], ["response", "type"]);
  assert.deepEqual(run.handle.activeTools, []);
  assert.equal(run.handle.settings["transport"], "sse");
});

it("keeps a cache-write field absent from the wire unknown, not zero", async () => {
  const usage = {
    input_tokens: 2000,
    output_tokens: 20,
    total_tokens: 2020,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
  const { assessment } = await recordedRun({ usage });
  assert.deepEqual(assessment.problems, []);
  const message = assessment.messages[0]!;
  assert.deepEqual(message.fieldsAbsentOnWire, ["cacheWriteTokens"]);
  assert.deepEqual(message.sdkPlaceholderZeros, ["cacheWrite"]);
  assert.equal(message.wireFields?.cachedTokens, 0, "a wire zero stays a reported value");
  assert.equal(message.parsedTokens?.inputTotal, 2000);
  assert.equal(message.parsedTokens?.cacheWrite, undefined);
  assert.equal(message.parsedTokens?.inputUncached, undefined);
  assert.equal(message.uncachedInputEstablished, false);
});

it("metadata scratch is owned by the new run rather than a previous agent assignment", async () => {
  const { metadataScratchPath } = await import("../scripts/benchmarks/study-metadata.js");
  assert.equal(metadataScratchPath("/repo", "series-one", "run-one"), "/repo/.tmp/study/series-one/run-one");
  assert.notEqual(metadataScratchPath("/repo", "series-one", "run-one"), metadataScratchPath("/repo", "series-one", "run-two"));
  assert.throws(() => metadataScratchPath("/repo", "../other", "run-one"));
});

it("correlates raw response.done before host terminal-event normalisation", async () => {
  // pi-ai maps response.done after the raw hook; both raw and canonical
  // observations must agree without relying on that later normalisation.
  const { assessment, runDir } = await recordedRun({
    usage: COMPLETE_USAGE,
    terminalType: "response.done",
  });
  const message = assessment.messages[0]!;
  assert.equal(message.rawEventType, "response.done");
  assert.equal(message.wireFields?.inputTokens, 2000);
  assert.equal(message.collector?.usageObserved, true);
  assert.equal(assessment.evidenceConsistent, true);
  assert.deepEqual(assessment.problems, []);
  assert.equal(message.parsedTokens?.inputTotal, 2000);
  assert.ok(
    (await readFile(join(runDir, "raw-usage.ndjson"), "utf8")).includes('"input_tokens":2000'),
  );
});

it("reports no usage as missing and never as zero", async () => {
  const { assessment } = await recordedRun({});
  const message = assessment.messages[0]!;
  assert.equal(message.wireFields, null);
  assert.equal(message.fieldsAbsentOnWire.length, 6);
  assert.equal(message.parsedTokens, null);
  assert.ok(assessment.problems.includes("no-raw-usage-for-completed-response:resp_fixture_1"));
  assert.equal(assessment.evidenceConsistent, false);
});

it("preserves a provider failure once, without retrying", async () => {
  const run = await recordedRun({
    status: 429,
    errorBody: '{"error":{"code":"rate_limit_exceeded","message":"limit"}}',
  });
  assert.equal(run.calls, 1, "provider retries are disabled");
  const message = run.assessment.messages[0]!;
  assert.equal(message.stopReason, "error");
  assert.ok(message.errorMessage);
  assert.equal(message.parsedTokens, null);
  const response = JSON.parse(
    (await readFile(join(run.runDir, "provider-responses.ndjson"), "utf8")).trim(),
  );
  assert.equal(response.status, 429);
  assert.equal(response.visibleHeaders["retry-after"], "7");
  assert.ok(run.assessment.problems.every((problem) => !problem.startsWith("no-raw-usage")));
});

it("aborts an unanswered request at its deadline and retains the record", async () => {
  const run = await recordedRun({ hang: true }, 300);
  assert.equal(run.prompt.settlement, "timed-out");
  assert.ok(run.prompt.durationMs < 15_000);
  assert.equal(run.assessment.requestWindows, 1);
  assert.equal(run.assessment.messages[0]?.parsedTokens, null);
  assert.ok((await readFile(join(run.runDir, "actual-requests.ndjson"), "utf8")).length > 0);
});

it("reports a transport failure as an outcome with no usage", async () => {
  const run = await recordedRun({ fetchError: "fixture connection failure" });
  assert.equal(run.calls, 1);
  const message = run.assessment.messages[0]!;
  assert.equal(message.stopReason, "error");
  assert.match(message.errorMessage ?? "", /fixture connection failure/);
  assert.equal(message.parsedTokens, null);
});

it("signals a second request window as a limit breach and records it", async () => {
  const runDir = join(isolation.root, "limit-run");
  await mkdir(runDir);
  let signalled = 0;
  const recorder = createStudyRecorder({
    runId: "limit-run",
    runDir,
    maxRequests: 1,
    onLimitExceeded: () => {
      signalled += 1;
    },
  });
  const handlers = new Map<string, Array<(event: Record<string, unknown>) => unknown>>();
  (recorder.factory as unknown as (pi: unknown) => void)({
    on(name: string, handler: (event: Record<string, unknown>) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => {};
    },
  });
  for (const payload of [{ input: 1 }, { input: 2 }, { input: 3 }]) {
    for (const handler of handlers.get("before_provider_request") ?? []) {
      assert.equal(
        await handler({ type: "before_provider_request", payload }),
        undefined,
        "read-only",
      );
    }
  }
  assert.equal(recorder.limitExceeded, true);
  assert.equal(signalled, 1);
  const assessment = await saveRunObservations({ runDir, recorder, requestLimit: 1 });
  assert.ok(assessment.problems.includes("request-limit-exceeded:3>1"));
});

it("a malformed stream event neither throws into the provider nor invents usage", () => {
  const recorder = createStudyRecorder({
    runId: "malformed",
    runDir: isolation.root,
    maxRequests: 1,
  });
  const handlers: Array<(event: Record<string, unknown>) => unknown> = [];
  (recorder.factory as unknown as (pi: unknown) => void)({
    on(name: string, handler: (event: Record<string, unknown>) => unknown) {
      if (name === "provider_stream_event") handlers.push(handler);
      return () => {};
    },
  });
  for (const data of [
    null,
    "text",
    7,
    {},
    { type: "response.completed" },
    { usage: "not-an-object" },
  ]) {
    for (const handler of handlers)
      handler({
        type: "provider_stream_event",
        provider: "p",
        api: "openai-codex-responses",
        model: "m",
        data,
      });
  }
  assert.deepEqual(recorder.rawUsage, []);
  assert.deepEqual(recorder.hookErrors, []);
});

it("runBoundedPrompt refuses no deadline and reports an unsettled abort", async () => {
  const never = {
    prompt: () => new Promise<void>(() => {}),
    abort: () => new Promise<void>(() => {}),
  };
  await assert.rejects(
    runBoundedPrompt(never, "x", { timeoutMs: 0, abortGraceMs: 1 }),
    StudyRefusalError,
  );
  await assert.rejects(
    runBoundedPrompt(never, "x", { timeoutMs: Number.POSITIVE_INFINITY, abortGraceMs: 1 }),
    StudyRefusalError,
  );
  const unsettled = await runBoundedPrompt(never, "x", { timeoutMs: 5, abortGraceMs: 5 });
  assert.equal(unsettled.settlement, "abort-unsettled");
  const cancel = new AbortController();
  cancel.abort();
  const cancelled = await runBoundedPrompt(
    { prompt: () => new Promise<void>(() => {}), abort: async () => {} },
    "x",
    { timeoutMs: 5_000, abortGraceMs: 5, signal: cancel.signal },
  );
  assert.equal(
    cancelled.settlement,
    "abort-unsettled",
    "a prompt that never settles is not called cancelled",
  );
  let finish: () => void = () => {};
  const settled = await runBoundedPrompt(
    {
      prompt: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      abort: async () => finish(),
    },
    "x",
    { timeoutMs: 5, abortGraceMs: 1_000 },
  );
  assert.equal(settled.settlement, "timed-out");
});

it("refuses a wrong host, foreign package or missing model, with no fallback", async () => {
  await assert.rejects(
    selectStudyHost({
      root: selection.root,
      source: "explicit-root",
      expectedVersion: "0.0.0-not-installed",
    }),
    /not the pinned/,
  );
  await assert.rejects(
    selectStudyHost({
      root: join(REPO_ROOT, "docs"),
      source: "explicit-root",
      expectedVersion: null,
    }),
    StudyRefusalError,
  );
  await assert.rejects(
    openStudySession({
      host,
      workspace,
      model: { provider: "fixture-absent", id: "no-such-model" },
      thinkingLevel: "off",
      systemPrompt: "x",
      transport: "sse",
      requestTimeoutMs: 1_000,
      tools: [],
      extensionFactories: [],
    }),
    /not in the host registry/,
  );
  const agentDir = join(isolation.root, "managed");
  await mkdir(join(agentDir, "install"), { recursive: true });
  await writeFile(join(agentDir, "install/current-version"), "9.9.9\n");
  assert.equal(
    await resolveManagedHostRoot(agentDir),
    join(agentDir, "install/releases/9.9.9/node_modules/@earendil-works/pi-coding-agent"),
  );
  const explicit = await resolveStudyHostSelection({
    installedAgentDir: agentDir,
    explicitRoot: selection.root,
    expectedVersion: selection.version,
  });
  assert.equal(explicit.root, selection.root);
  assert.equal(explicit.source, "explicit-root");
  assert.equal(explicit.launcher, null);
  await assert.rejects(
    resolveStudyHostSelection({
      installedAgentDir: agentDir,
      explicitRoot: " ",
      expectedVersion: selection.version,
    }),
    /must not be empty/,
  );
  await writeFile(join(agentDir, "install/current-version"), "../escape\n");
  await assert.rejects(resolveManagedHostRoot(agentDir), StudyRefusalError);
});

it("witnesses the loaded host and flags Pi packages from elsewhere", async () => {
  const urls = moduleRecorder.urls();
  assert.ok(
    urls.some((url) => url.includes("/pi-coding-agent/dist/")),
    "the recorder saw the host load",
  );
  const report = await reportLoadedDependencies({
    urls,
    hostRoot: selection.root,
    repoRoot: REPO_ROOT,
  });
  const host = report.loaded.find((item) => item.name === "@earendil-works/pi-coding-agent");
  assert.equal(host?.version, selection.version);
  assert.equal(
    report.codexProviderLoaded,
    true,
    "the fixture exercises the host's own Codex module",
  );
  const foreign = await reportLoadedDependencies({
    urls: [
      ...urls,
      pathToFileURL("/elsewhere/node_modules/@earendil-works/pi-ai/dist/index.js").href,
    ],
    hostRoot: selection.root,
    repoRoot: REPO_ROOT,
  });
  assert.ok(foreign.outsideHostRelease.includes("/elsewhere/node_modules/@earendil-works/pi-ai"));
  assert.equal(foreign.developmentPeers.length, 4);
});

it("keeps only numbers from raw usage and only bounded headers", () => {
  const projected = projectRawUsage({
    input_tokens: 5,
    note: "unexpected text",
    list: [1, 2],
    details: { cached_tokens: 0, missing: null },
  });
  assert.deepEqual(projected, {
    details: { cached_tokens: 0, missing: null },
    input_tokens: 5,
    list: [1, 2],
    note: { length: 15, nonNumeric: "string" },
  });
  assert.deepEqual(rawUsageLeafPaths(projected).sort(), [
    "details.cached_tokens",
    "details.missing",
    "input_tokens",
    "list[*]",
    "note",
  ]);
  // The attribution shape observed on the pinned host: item ids are per-response.
  const attribution = projectRawUsage({
    attribution: {
      items: {
        msg_05a9628509afeb6e016ae8ac: {
          input_tokens: 12,
          content: [{ type: "input_text", input_tokens: 12 }],
        },
        msg_05a9628509afeb6e016ae8ad: { input_tokens: 2, content: [] },
      },
    },
  });
  assert.deepEqual(rawUsageLeafPaths(attribution).sort(), [
    "attribution.items.*.content[*].input_tokens",
    "attribution.items.*.content[*].type",
    "attribution.items.*.content[]",
    "attribution.items.*.input_tokens",
  ]);
  const headers = projectResponseHeaders({
    Authorization: "Bearer secret",
    "Set-Cookie": "a=b",
    "x-codex-plan-type": "pro",
    "x-codex-long": "x".repeat(500),
    "retry-after": "7",
    "x-codex-turn-state": "opaque",
  });
  assert.deepEqual(headers.visible, { "x-codex-plan-type": "pro", "retry-after": "7" });
  assert.ok(headers.names.includes("authorization"));
  assert.ok(!JSON.stringify(headers).includes("secret"));
});

it("refuses overwriting evidence and an undeclared dirty tree", async () => {
  const dir = join(isolation.root, "exclusive");
  await mkdir(dir);
  await writeNewJson(join(dir, "a.json"), { first: true });
  await assert.rejects(writeNewJson(join(dir, "a.json"), { second: true }), /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, "a.json"), "utf8")), { first: true });
  const manifest = await writeRunManifest(dir);
  const listed = JSON.parse(await readFile(manifest.path, "utf8"));
  assert.equal(listed.files.length, 1);
  assert.equal(listed.files[0].name, "a.json");
  assert.equal(listed.files[0].sha256, sha256Text(await readFile(join(dir, "a.json"), "utf8")));
  await assert.rejects(writeRunManifest(dir), /EEXIST/);

  const identity = await readRepositoryIdentity(REPO_ROOT, ["package.json", "no-such-file"]);
  assert.match(identity.commit, /^[0-9a-f]{40}$/);
  assert.equal(identity.sourceSha256["no-such-file"], null);
  const dirty = { ...identity, dirty: true, dirtyPaths: [" M x"] };
  assert.throws(() => assertRepositoryAdmissible(dirty, null), StudyRefusalError);
  assert.throws(() => assertRepositoryAdmissible(dirty, "  "), StudyRefusalError);
  assert.doesNotThrow(() => assertRepositoryAdmissible(dirty, "declared reason"));
  assert.doesNotThrow(() =>
    assertRepositoryAdmissible({ ...identity, dirty: false, dirtyPaths: [] }, null),
  );
});

it("detects credential values and token shapes without reporting a value", async () => {
  const dir = join(isolation.root, "scan");
  await mkdir(dir);
  const secret = "fixture-secret-credential-value-0123456789";
  const authPath = join(dir, "auth-source.json");
  await writeFile(
    authPath,
    JSON.stringify({ "openai-codex": { type: "oauth", access: secret, expires: 1 } }),
  );
  const state = await readCredentialFileState(authPath, "openai-codex");
  assert.equal(state.providerEntryType, "oauth");
  assert.ok(state.values.includes(secret));
  assert.equal((await readCredentialFileState(join(dir, "absent"), "openai-codex")).digest, null);
  await rm(authPath);
  const runDir = join(dir, "run");
  await mkdir(runDir);
  await writeFile(join(runDir, "clean.json"), "{}");
  await writeFile(join(runDir, "leak.json"), JSON.stringify({ value: secret }));
  await writeFile(
    join(runDir, "token.json"),
    JSON.stringify({ value: FIXTURE_TOKEN.replace(".fixture", ".signature-part-long-enough") }),
  );
  const scan = await scanRunForCredentials(runDir, state.values);
  assert.equal(scan.filesScanned, 3);
  assert.equal(scan.matchedFiles.includes("clean.json"), false);
  assert.equal(scan.matchedFiles.includes("leak.json"), true);
  assert.ok(!JSON.stringify(scan).includes(secret));
  assert.deepEqual(await readdir(runDir), ["clean.json", "leak.json", "token.json"]);
});
