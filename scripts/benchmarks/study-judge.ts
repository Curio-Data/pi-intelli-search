// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// One isolated, coordinator-owned judge process per packet. No judge receives
// filesystem tools or writes to the series. Every launch attempt is retained.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sha256Text } from "./canonical.js";
import { assertRepositoryAdmissible, readCredentialFileState, readRepositoryIdentity, writeNewJson } from "./study-host.js";
import { validateJudgeProvenance, validateQualityScore } from "./study-quality.js";
import { REPO_ROOT } from "./study-runner.js";

const JUDGE_IDS = [null, "claude-opus-5-5[1m]", "openai-codex/gpt-6.1-sol"] as const;
const ISOLATION_ROOT = process.env.STUDY_JUDGE_ISOLATION_ROOT ?? "/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/judge-isolated";
const MAX_OUTPUT = 32 * 1024 * 1024;
const TIMEOUT_MS = 600_000;
const execFileAsync = promisify(execFile);
const NEUTRAL_SYSTEM_PROMPT = "You are an independent answer-quality judge. Use only the supplied packet and return only the requested JSON.";

interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly error: string | null;
}

async function runProcess(command: string, args: readonly string[], cwd: string, input: string): Promise<ProcessResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env: judgeEnvironment(cwd), stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let processError: string | null = null;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, TIMEOUT_MS);
    const hardTimer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, TIMEOUT_MS + 30_000);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { processError = "Judge output exceeded the retained-byte limit"; child.kill("SIGTERM"); return; }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => { processError = error.message; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(hardTimer);
      resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), code, signal, timedOut, error: processError });
    });
    child.stdin.on("error", (error) => { processError = error.message; });
    child.stdin.end(input);
  });
}

function judgeEnvironment(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME ?? homedir(), LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: cwd, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  };
  for (const key of ["SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "CLAUDE_CONFIG_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function scoreSchema(packetId: string) {
  const score = {
    type: "object", additionalProperties: false,
    required: ["overall", "coverage", "provenance", "limitations", "usefulness", "rationale", "evidenceQuotes"],
    properties: {
      overall: { type: "integer", minimum: 0, maximum: 4 }, coverage: { type: "integer", minimum: 0, maximum: 4 },
      provenance: { type: "integer", minimum: 0, maximum: 4 }, limitations: { type: "integer", minimum: 0, maximum: 4 },
      usefulness: { type: "integer", minimum: 0, maximum: 4 }, rationale: { type: "string", minLength: 1 },
      evidenceQuotes: { type: "array", items: { type: "string" } },
    },
  } as const;
  return { type: "object", additionalProperties: false, required: ["packetId", "A", "B"], properties: { packetId: { const: packetId }, A: score, B: score } };
}

function calibrationSchema(caseId: string) {
  return { type: "object", additionalProperties: false, required: ["caseId", "preference", "rationale", "evidenceQuotes"], properties: {
    caseId: { const: caseId }, preference: { enum: ["A", "B", "tie"] }, rationale: { type: "string", minLength: 1 },
    evidenceQuotes: { type: "array", items: { type: "string" } },
  } };
}

/** Command construction is exported for deterministic interface tests. */
export function judgeCommand(judge: 1 | 2, packetId: string, session: string, calibration: boolean) {
  if (judge === 2) return {
    command: "pi",
    args: ["--provider", "openai-codex", "--model", "gpt-6.1-sol", "--thinking", "low", "--system-prompt", NEUTRAL_SYSTEM_PROMPT, "--mode", "json", "--print", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp"],
  };
  return {
    command: "claude",
    args: ["--model", "claude-opus-5-5[1m]", "--effort", "low", "--setting-sources", "", "--system-prompt", NEUTRAL_SYSTEM_PROMPT, "--print", "--output-format", "json", "--json-schema", JSON.stringify(calibration ? calibrationSchema(packetId) : scoreSchema(packetId)), "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--session-id", session],
  };
}

/** Extracts terminal answer text and reported model identities from Pi JSON events. */
export function parsePiJudgeOutput(stdout: string): { value: unknown; reportedModels: string[] } {
  const messages: { text: string; provider: string; model: string }[] = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const event = JSON.parse(line) as { type?: string; message?: { role?: string; provider?: string; model?: string; content?: { type?: string; text?: string }[] } };
    if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
    const text = (event.message.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    if (text.trim()) messages.push({ text, provider: event.message.provider ?? "", model: event.message.model ?? "" });
  }
  const last = messages.at(-1);
  if (!last) throw new Error("Pi returned no terminal assistant message");
  return { value: JSON.parse(last.text), reportedModels: [...new Set(messages.map((message) => `${message.provider}/${message.model}`))] };
}

/** Extracts structured output and model usage from Claude Code's JSON result. */
export function parseClaudeJudgeOutput(stdout: string): { value: unknown; reportedModels: string[]; contextWindows: Record<string, number>; provider: string | null; costBasis: string | null } {
  const result = JSON.parse(stdout) as { structured_output?: unknown; result?: string; modelUsage?: Record<string, { contextWindow?: number; provider?: string; costBasis?: string }>; is_error?: boolean; subtype?: string };
  if (result.is_error) throw new Error(`Claude judge failed: ${result.subtype ?? "unknown"}`);
  const value = result.structured_output ?? JSON.parse(result.result ?? "null");
  const usage = Object.values(result.modelUsage ?? {})[0];
  return {
    value,
    reportedModels: Object.keys(result.modelUsage ?? {}),
    contextWindows: Object.fromEntries(Object.entries(result.modelUsage ?? {}).map(([model, detail]) => [model, detail.contextWindow ?? 0])),
    provider: usage?.provider ?? null,
    costBasis: usage?.costBasis ?? null,
  };
}

async function executeJudge(options: { judge: 1 | 2; packetPath: string; outputRoot: string; calibration: boolean; dryRun: boolean; sourceCommit: string }) {
  const judgeId = JUDGE_IDS[options.judge];
  if (!judgeId) throw new Error("Judge must be 1 or 2");
  const packetText = await readFile(options.packetPath, "utf8");
  const packetSha256 = sha256Text(packetText);
  const packet = JSON.parse(packetText) as { packetId?: string; caseId?: string; candidates?: { label: string }[] };
  const packetId = options.calibration ? packet.caseId : packet.packetId;
  if (!packetId || !/^[A-Za-z0-9-]+$/.test(packetId)) throw new Error("Invalid judge packet identity");
  const finalRoot = join(options.outputRoot, options.calibration ? "calibration" : "", `judge-${options.judge}`);
  const finalPath = join(finalRoot, `${packetId}.json`);
  if (await stat(finalPath).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("A final judge file already exists; refusing another scored session");
  const attemptParent = join(options.outputRoot, "attempts", `judge-${options.judge}`, packetId);
  const previousAttempts = await readdir(attemptParent, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const attemptNumber = previousAttempts.filter((entry) => entry.isDirectory()).length + 1;
  if (attemptNumber > 2) throw new Error("Two judge attempts are already retained; no third attempt is admitted");
  const session = randomUUID();
  const cwd = join(ISOLATION_ROOT, session);
  await mkdir(cwd, { recursive: true });
  const launch = judgeCommand(options.judge, packetId, session, options.calibration);
  const executable = await realpath((await execFileAsync("which", [launch.command])).stdout.trim());
  const harnessVersion = (await execFileAsync(launch.command, ["--version"], { cwd, env: judgeEnvironment(cwd) })).stdout.trim();
  const attempt = join(attemptParent, session);
  await mkdir(attempt, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await runProcess(launch.command, launch.args, cwd, packetText);
  const endedAt = new Date().toISOString();
  await writeNewJson(join(attempt, "stdout.json"), { raw: result.stdout });
  await writeNewJson(join(attempt, "stderr.json"), { raw: result.stderr });
  let value: unknown;
  let reportedModels: string[] = [];
  let contextWindows: Record<string, number> = {};
  let provider: string | null = null;
  let costBasis: string | null = null;
  let error: string | null = null;
  try {
    if (result.error || result.code !== 0 || result.timedOut) throw new Error(`Judge process failed: ${result.error ?? `code=${String(result.code)} signal=${String(result.signal)} timedOut=${result.timedOut}`}`);
    const parsed = options.judge === 1 ? parseClaudeJudgeOutput(result.stdout) : { ...parsePiJudgeOutput(result.stdout), contextWindows: {}, provider: "openai-codex", costBasis: "subscription" };
    value = parsed.value;
    reportedModels = parsed.reportedModels;
    contextWindows = parsed.contextWindows;
    provider = parsed.provider;
    costBasis = parsed.costBasis;
    if (!value || typeof value !== "object" || (value as Record<string, unknown>)[options.calibration ? "caseId" : "packetId"] !== packetId) throw new Error("Judge output identity differs from the packet");
  } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const globalClaudeMdSha256 = options.judge === 1 ? sha256Text(await readFile(join(homedir(), ".claude/CLAUDE.md"), "utf8").catch(() => "")) : null;
  const provenance = {
    session, judgeId, packetId, calibration: options.calibration, dryRun: options.dryRun, attemptNumber,
    globalClaudeMdSha256,
    command: launch.command, executable, harnessVersion, args: launch.args,
    cwdIsolated: true, toolsDisabled: true, environmentKeys: Object.keys(judgeEnvironment(cwd)).sort(),
    sourceCommit: options.sourceCommit, packetSha256,
    startedAt, endedAt, code: result.code, signal: result.signal, timedOut: result.timedOut,
    stdoutSha256: sha256Text(result.stdout), stderrSha256: sha256Text(result.stderr),
    reportedModels, contextWindows, provider, costBasis,
  };
  if (!error) {
    try {
      validateJudgeProvenance(judgeId, provenance);
      if (options.calibration) {
        if (!isScoreObject(value) || !["A", "B", "tie"].includes(String(value["preference"])) || typeof value["rationale"] !== "string" || !Array.isArray(value["evidenceQuotes"])) throw new Error("Invalid calibration output shape");
      } else {
        const candidates = new Map((packet.candidates ?? []).map((candidate) => [candidate.label, candidate]));
        for (const label of ["A", "B"]) validateQualityScore((value as Record<string, unknown>)[label], candidates.get(label));
      }
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  }
  await writeNewJson(join(attempt, "receipt.json"), { ...provenance, error });
  if (error) throw new Error(`${error}; retained attempt ${attempt}`);
  if (options.dryRun) return { attempt, reportedModels, value, provenance };
  const output = { ...(value as Record<string, unknown>), judgeId, model: judgeId, session, provenance };
  await mkdir(finalRoot, { recursive: true });
  await writeNewJson(finalPath, output);
  return { finalPath, attempt, reportedModels, provenance };
}

function isScoreObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runStudyJudge(options: { seriesRoot: string; judge: 1 | 2; packetId: string; calibration?: boolean }) {
  if (![1, 2].includes(options.judge)) throw new Error("Judge must be 1 or 2");
  const identity = await readRepositoryIdentity(REPO_ROOT, ["scripts/benchmarks/study-judge.ts", "scripts/benchmarks/study-quality.ts"]);
  assertRepositoryAdmissible(identity, null);
  const outputRoot = join(options.seriesRoot, "quality-v1");
  const packetPath = join(outputRoot, options.calibration ? "calibration" : "", "packets", `${options.packetId}.json`);
  const manifest = JSON.parse(await readFile(join(outputRoot, options.calibration ? "calibration" : "", "manifest.json"), "utf8")) as { packets: { packetId?: string; caseId?: string; sha256: string }[] };
  const packetText = await readFile(packetPath, "utf8");
  const expected = manifest.packets.find((packet) => (options.calibration ? packet.caseId : packet.packetId) === options.packetId);
  if (!expected || expected.sha256 !== sha256Text(packetText)) throw new Error("Packet differs from its frozen manifest; no judge session admitted");
  if (options.judge === 2) {
    const credentials = await readCredentialFileState(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"), "auth.json"), "openai-codex");
    if (credentials.providerEntryType !== "oauth") throw new Error("Pi judge requires the prescribed subscription login");
  }
  return executeJudge({ judge: options.judge, packetPath, outputRoot, calibration: options.calibration ?? false, dryRun: false, sourceCommit: identity.commit });
}

export async function runJudgeDryRun(judge: 1 | 2, outputRoot: string) {
  if (![1, 2].includes(judge)) throw new Error("Judge must be 1 or 2");
  const identity = await readRepositoryIdentity(REPO_ROOT, ["scripts/benchmarks/study-judge.ts", "scripts/benchmarks/study-quality.ts"]);
  const packetId = "Q-DRYRUN";
  const judgePrompt = JSON.parse(await readFile(join(REPO_ROOT, "docs/benchmarks/codemode-study-v1/judge-prompt.json"), "utf8"));
  const corpus = JSON.parse(await readFile(join(REPO_ROOT, "docs/benchmarks/codemode-study-v1/corpus.json"), "utf8")) as { standardRubric: unknown };
  const padding = "Supporting documentation for a bounded input-delivery check. ".repeat(2_600);
  const value = {
    schemaVersion: 1, kind: "blinded-quality-packet", packetId,
    task: { turns: [{ turn: 1, question: "What limit is documented?" }] }, judgePrompt, rubric: corpus.standardRubric,
    candidates: ["A", "B"].map((label) => ({ label, answers: [{ turn: 1, text: "The limit is seven." }], evidence: [{ kind: "page", content: `The documented limit is seven.\n\n${padding}` }] })),
  };
  await mkdir(outputRoot, { recursive: true });
  const packetPath = join(outputRoot, `${judge}-${packetId}-input.json`);
  await writeNewJson(packetPath, value);
  return executeJudge({ judge, packetPath, outputRoot, calibration: false, dryRun: true, sourceCommit: identity.commit });
}

export async function studyJudgeStatus(seriesRoot: string) {
  const root = join(seriesRoot, "quality-v1");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as { packets: { packetId: string }[] };
  const rows = [];
  for (const packet of manifest.packets) for (const judge of [1, 2]) {
    const finalPath = join(root, `judge-${judge}`, `${packet.packetId}.json`);
    const scored = await stat(finalPath).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    const attempts = await readdir(join(root, "attempts", `judge-${judge}`, packet.packetId), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    rows.push({ packetId: packet.packetId, judge, scored, attempts: attempts.filter((entry) => entry.isDirectory()).length });
  }
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args[0] === "dry-run" && args.length === 3) {
    console.log(JSON.stringify(await runJudgeDryRun(Number(args[1]) as 1 | 2, resolve(args[2])), null, 2));
  } else if (args[0] === "run" && (args.length === 4 || args.length === 5)) {
    console.log(JSON.stringify(await runStudyJudge({ seriesRoot: resolve(args[1]), judge: Number(args[2]) as 1 | 2, packetId: args[3], calibration: args.includes("--calibration") }), null, 2));
  } else if (args[0] === "status" && args.length === 2) {
    console.log(JSON.stringify(await studyJudgeStatus(resolve(args[1])), null, 2));
  } else {
    throw new Error("Usage: study-judge.ts dry-run JUDGE OUTPUT_ROOT | run SERIES_ROOT JUDGE PACKET_ID [--calibration] | status SERIES_ROOT");
  }
}
