// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Blinded quality-packet preparation and score ingestion. Judge sessions are
// external and independent; this module never invokes a model.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { asJson, canonicalJson, sha256Canonical, sha256Text } from "./canonical.js";
import type { StudyAnalysisRun } from "./study-analysis.js";
import type { StudyTask } from "./study-design.js";
import { assertRepositoryAdmissible, readRepositoryIdentity, writeNewJson } from "./study-host.js";
import { REPO_ROOT } from "./study-runner.js";

const QUALITY_DIRECTORY = "quality-v1";
const JUDGE_IDS = ["claude-opus-5-5[1m]", "openai-codex/gpt-6.1-sol"] as const;
const DESIGN_ROOT = join(REPO_ROOT, "docs/benchmarks/codemode-study-v1");

export interface QualityScore {
  readonly overall: number;
  readonly coverage: number;
  readonly provenance: number;
  readonly limitations: number;
  readonly usefulness: number;
  readonly rationale: string;
  readonly evidenceQuotes: readonly string[];
  readonly unmatchedEvidenceQuotes: readonly string[];
}

interface QualityEvidence {
  readonly kind: "page" | "extraction" | "search-summary" | "research-synthesis" | "collation-synthesis" | "read-report" | "source-record";
  readonly url: string | null;
  readonly title: string | null;
  readonly state: string | null;
  readonly truncated: boolean | null;
  readonly content: string;
}

interface QualityAssignment {
  readonly packetId: string;
  readonly population: "replay" | "live";
  readonly queryId: string;
  readonly workflow: StudyTask["workflow"];
  readonly repeat: number;
  readonly candidates: {
    readonly A: { readonly runId: string; readonly arm: "off" | "on" };
    readonly B: { readonly runId: string; readonly arm: "off" | "on" };
  };
}

interface CalibrationAssignment {
  readonly caseId: string;
  readonly candidates: { readonly A: "answerA" | "answerB"; readonly B: "answerA" | "answerB" };
}

interface Cell {
  readonly population: "replay" | "live";
  readonly queryId: string;
  readonly workflow: StudyTask["workflow"];
  readonly repeat: number;
  readonly off?: StudyAnalysisRun;
  readonly on?: StudyAnalysisRun;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Visible answer text with prompt boundaries preserved. */
export function visibleAnswerTurns(value: unknown): { turn: number; text: string }[] {
  if (!Array.isArray(value)) throw new Error("answers.json must contain an array");
  const texts: string[] = [];
  for (const message of value) {
    if (!isRecord(message) || message["role"] !== "assistant" || message["stopReason"] !== "stop" || !Array.isArray(message["content"])) continue;
    for (const part of message["content"]) {
      if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" && part["text"].trim() !== "") texts.push(part["text"].trim());
    }
  }
  return texts.map((text, index) => ({ turn: index + 1, text }));
}

export function visibleAnswer(value: unknown): string {
  return visibleAnswerTurns(value).map((turn) => turn.text).join("\n\n");
}

async function workspaceText(workspace: string, value: unknown): Promise<string | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value === "") throw new Error("Invalid empty source path in quality evidence");
  let relative = value;
  if (isAbsolute(relative)) {
    const marker = `${process.platform === "win32" ? "\\" : "/"}workspace${process.platform === "win32" ? "\\" : "/"}`;
    if (!relative.includes(marker)) throw new Error("Absolute source path is outside the retained run workspace");
    relative = relative.slice(relative.lastIndexOf(marker) + marker.length);
  }
  const parts = relative.split(/[\\/]/);
  if (parts.includes("..") || parts.includes("")) throw new Error("Unsafe source path in quality evidence");
  return readFile(join(workspace, ...parts), "utf8");
}

function resultText(result: Record<string, unknown>): string {
  if (!Array.isArray(result["content"])) return "";
  return result["content"].flatMap((part) => isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" ? [part["text"]] : []).join("\n");
}

/** Captured evidence, including absence, truncation and derived-material labels. */
export async function qualityEvidence(eventsValue: unknown, workspace: string): Promise<QualityEvidence[]> {
  if (!Array.isArray(eventsValue)) throw new Error("tool-events.json must contain an array");
  const evidence: QualityEvidence[] = [];
  const add = (item: QualityEvidence): void => {
    if (item.kind === "source-record" || item.content.trim() !== "") evidence.push({ ...item, content: item.content.trim() });
  };
  for (const event of eventsValue) {
    if (!isRecord(event) || event["type"] !== "tool_execution_end" || !isRecord(event["result"])) continue;
    const result = event["result"];
    if (result["isError"] === true) add({ kind: "source-record", url: null, title: "Failed operation", state: "failed", truncated: null, content: "" });
    const details = isRecord(result["details"]) ? result["details"] : {};
    const intelli = isRecord(details["intelli"]) ? details["intelli"] : {};
    if (event["toolName"] === "read") add({ kind: "read-report", url: null, title: null, state: "read", truncated: null, content: resultText(result) });
    if (["intelli_search", "intelli_research", "intelli_collate"].includes(String(event["toolName"])) && typeof intelli["summary"] === "string") {
      const kind = event["toolName"] === "intelli_search" ? "search-summary" : event["toolName"] === "intelli_research" ? "research-synthesis" : "collation-synthesis";
      add({ kind, url: null, title: typeof details["query"] === "string" ? details["query"] : null, state: "derived", truncated: null, content: intelli["summary"] });
    }
    if (!Array.isArray(intelli["sources"])) continue;
    for (const sourceValue of intelli["sources"]) {
      if (!isRecord(sourceValue)) continue;
      const url = typeof sourceValue["url"] === "string" ? sourceValue["url"] : null;
      const title = typeof sourceValue["title"] === "string" ? sourceValue["title"] : null;
      const state = typeof sourceValue["state"] === "string" ? sourceValue["state"] : null;
      const truncated = typeof sourceValue["truncated"] === "boolean" ? sourceValue["truncated"] : null;
      let hasContent = false;
      if (typeof sourceValue["content"] === "string") { add({ kind: "page", url, title, state, truncated, content: sourceValue["content"] }); hasContent = true; }
      if (typeof sourceValue["extraction"] === "string") { add({ kind: "extraction", url, title, state, truncated, content: sourceValue["extraction"] }); hasContent = true; }
      const page = await workspaceText(workspace, sourceValue["fullPagePath"]);
      if (page !== null) { add({ kind: "page", url, title, state, truncated, content: page }); hasContent = true; }
      const extraction = await workspaceText(workspace, sourceValue["extractionPath"]);
      if (extraction !== null) { add({ kind: "extraction", url, title, state, truncated, content: extraction }); hasContent = true; }
      if (!hasContent) add({ kind: "source-record", url, title, state, truncated, content: "" });
    }
  }
  const unique = new Map<string, QualityEvidence>();
  for (const item of evidence) {
    const key = sha256Canonical(asJson(item));
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => canonicalJson(asJson(a)).localeCompare(canonicalJson(asJson(b))));
}

function expectedCells(tasks: readonly StudyTask[], partition: "development" | "pilot" | "measured-series"): Cell[] {
  const cells: Cell[] = [];
  for (const task of tasks.filter((item) => item.partition === partition).sort((a, b) => a.id.localeCompare(b.id))) {
    const populations: ("replay" | "live")[] = partition === "development" ? ["replay", ...(task.id === "CS-DEV-01" ? ["live" as const] : [])] : partition === "pilot" ? ["live"] : ["replay", "live"];
    const repeats = partition === "development" ? [1] : [1, 2];
    for (const population of populations) for (const repeat of repeats) cells.push({ population, queryId: task.id, workflow: task.workflow, repeat });
  }
  return cells;
}

function offFirst(cell: Cell, seed: string, taskIndex: number, repeatIndex: number): boolean {
  const start = Number.parseInt(sha256Canonical(asJson({ seed, population: cell.population, workflow: cell.workflow })).slice(0, 8), 16) % 2;
  return (start + taskIndex + repeatIndex) % 2 === 0;
}

function neutralTask(task: StudyTask) {
  const constraints = {
    sourceDomains: task.domains,
    extractionFocus: task.focusPrompt,
    maximumWordsPerAnswer: 500,
    attemptedPageAllowance: task.workflow === "breadth" ? 12 : 4,
    maximumCharactersPerFetchedPage: 16000,
    citeSourcesForMaterialClaims: true,
    stateGapsAndUncertainty: true,
    evidenceTimingAssessed: false,
    liveFollowupRequiresReportRead: false,
  };
  if (task.workflow === "followup") return {
    workflow: task.workflow,
    constraints,
    turns: [
      { turn: 1, question: task.followupPlan!.base },
      { turn: 2, question: task.followupPlan!.followup, evidenceRule: "Use the saved base-research report. No additional pages are allowed. State if that evidence is insufficient." },
    ],
  };
  return { workflow: task.workflow, constraints, turns: [{ turn: 1, question: task.query }] };
}

/** Writes one immutable, self-contained blinded packet for every available pair. */
export async function prepareQualityPackets(seriesRoot: string, partition: "development" | "pilot" | "measured-series", options: { allowDirtyReason?: string } = {}) {
  const finalOutput = join(seriesRoot, QUALITY_DIRECTORY);
  if (await stat(finalOutput).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("Quality packet directory already exists; use a new reviewed attempt instead of adding packets");
  const preparer = await readRepositoryIdentity(REPO_ROOT, ["scripts/benchmarks/study-quality.ts", "docs/benchmarks/codemode-study-v1/judge-prompt.json"]);
  assertRepositoryAdmissible(preparer, options.allowDirtyReason ?? null);
  const series = await readJson(join(seriesRoot, "series.json")) as { candidateCommit: string; design: { tasks: StudyTask[]; corpusSha256: string } };
  const observationsText = await readFile(join(seriesRoot, "observations.ndjson"), "utf8");
  const runs = observationsText.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StudyAnalysisRun);
  const corpusText = await readFile(join(DESIGN_ROOT, "corpus.json"), "utf8");
  if (sha256Text(corpusText) !== series.design.corpusSha256) throw new Error("Current corpus differs from the series corpus");
  const corpus = JSON.parse(corpusText) as { standardRubric: unknown };
  const judgingSha256 = sha256Text(await readFile(join(DESIGN_ROOT, "JUDGING.md"), "utf8"));
  const judgePromptBytes = await readFile(join(DESIGN_ROOT, "judge-prompt.json"), "utf8");
  const judgePrompt = JSON.parse(judgePromptBytes) as unknown;
  const seed = randomBytes(32).toString("hex");
  const tasks = new Map(series.design.tasks.map((task) => [task.id, task]));
  const cells = expectedCells(series.design.tasks, partition);
  const missing: { population: string; queryId: string; repeat: number; missingArms: string[] }[] = [];
  const complete: { cell: Cell; off: StudyAnalysisRun; on: StudyAnalysisRun; taskIndex: number; repeatIndex: number }[] = [];
  const grouped = new Map<string, Cell[]>();
  for (const cell of cells) {
    const original = runs.filter((run) => run.population === cell.population && run.queryId === cell.queryId && run.repeat === cell.repeat && run.partition === partition && run.arm !== "only" && !run.rerunOf && run.purpose !== "fixture-capture" && run.purpose !== "synthetic-driver-integration");
    const off = original.find((run) => run.arm === "off");
    const on = original.find((run) => run.arm === "on");
    const missingArms = [...(!off ? ["off"] : []), ...(!on ? ["on"] : [])];
    if (missingArms.length > 0 || original.length !== 2) {
      missing.push({ population: cell.population, queryId: cell.queryId, repeat: cell.repeat, missingArms: original.length > 2 ? [...new Set([...missingArms, "duplicate-or-extra-cell"])] : missingArms });
      continue;
    }
    const key = `${cell.population}/${cell.workflow}`;
    const group = grouped.get(key) ?? [];
    group.push(cell);
    grouped.set(key, group);
    complete.push({ cell, off: off!, on: on!, taskIndex: 0, repeatIndex: cell.repeat - 1 });
  }
  for (const group of grouped.values()) {
    const queries = [...new Set(group.map((cell) => cell.queryId))].sort();
    for (const item of complete) {
      if (group.includes(item.cell)) item.taskIndex = queries.indexOf(item.cell.queryId);
    }
  }
  const assignments: QualityAssignment[] = [];
  const packets: { id: string; value: unknown }[] = [];
  for (const item of complete.sort((a, b) => `${a.cell.population}/${a.cell.workflow}/${a.cell.queryId}/${a.cell.repeat}`.localeCompare(`${b.cell.population}/${b.cell.workflow}/${b.cell.queryId}/${b.cell.repeat}`))) {
    const { cell, off, on } = item;
    const task = tasks.get(cell.queryId)!;
    const id = `Q-${sha256Canonical(asJson({ seed, population: cell.population, queryId: cell.queryId, repeat: cell.repeat })).slice(0, 20)}`;
    const candidates = offFirst(cell, seed, item.taskIndex, item.repeatIndex)
      ? [{ label: "A" as const, run: off }, { label: "B" as const, run: on }]
      : [{ label: "A" as const, run: on }, { label: "B" as const, run: off }];
    const packetCandidates = [];
    for (const candidate of candidates) {
      const runRoot = join(seriesRoot, candidate.run.runId);
      packetCandidates.push({
        label: candidate.label,
        answers: visibleAnswerTurns(await readJson(join(runRoot, "answers.json"))),
        evidence: await qualityEvidence(await readJson(join(runRoot, "tool-events.json")), `${runRoot}-workspace`),
      });
    }
    packets.push({ id, value: {
      schemaVersion: 1,
      kind: "blinded-quality-packet",
      packetId: id,
      task: neutralTask(task),
      rubric: corpus.standardRubric,
      judgePrompt,
      candidates: packetCandidates,
    } });
    assignments.push({
      packetId: id, population: cell.population, queryId: cell.queryId, workflow: cell.workflow, repeat: cell.repeat,
      candidates: {
        A: { runId: candidates[0].run.runId, arm: candidates[0].run.arm as "off" | "on" },
        B: { runId: candidates[1].run.runId, arm: candidates[1].run.arm as "off" | "on" },
      },
    });
  }
  const output = join(seriesRoot, `.${QUALITY_DIRECTORY}.staging-${randomBytes(6).toString("hex")}`);
  const assignmentValue = { schemaVersion: 1, private: true, seed, assignments, missing };
  const assignmentText = jsonBytes(assignmentValue);
  const manifest = {
    schemaVersion: 1,
    kind: "codemode-quality-packet-manifest",
    partition,
    sourceCommit: series.candidateCommit,
    preparer: { commit: preparer.commit, dirty: preparer.dirty, dirtyReason: options.allowDirtyReason ?? null },
    judgingSha256,
    packetCount: packets.length,
    missing,
    corpusSha256: series.design.corpusSha256,
    rubricSha256: sha256Canonical(asJson(corpus.standardRubric)),
    judgePromptSha256: sha256Text(judgePromptBytes),
    observationsSha256: sha256Text(observationsText),
    assignmentsSha256: sha256Text(assignmentText),
    packets: packets.map((packet) => ({ packetId: packet.id, sha256: sha256Text(jsonBytes(packet.value)) })),
    judgeIds: JUDGE_IDS,
  };
  await mkdir(join(output, "packets"), { recursive: true });
  for (const packet of packets) await writeNewJson(join(output, "packets", `${packet.id}.json`), packet.value);
  await writeNewJson(join(output, "assignments.json"), assignmentValue);
  await writeNewJson(join(output, "manifest.json"), manifest);
  await rename(output, finalOutput);
  return { output: finalOutput, packetCount: packets.length, missing, manifest };
}

function normalisedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function candidateText(value: unknown): string {
  if (!isRecord(value)) return "";
  const answers = Array.isArray(value["answers"]) ? value["answers"].flatMap((answer) => isRecord(answer) && typeof answer["text"] === "string" ? [answer["text"]] : []) : [];
  const evidence = Array.isArray(value["evidence"]) ? value["evidence"].flatMap((item) => isRecord(item) && typeof item["content"] === "string" ? [item["content"]] : []) : [];
  return normalisedText([...answers, ...evidence].join("\n"));
}

export function validateQualityScore(value: unknown, candidate: unknown): QualityScore {
  if (!isRecord(value)) throw new Error("Quality score must be an object");
  const allowed = new Set(["overall", "coverage", "provenance", "limitations", "usefulness", "rationale", "evidenceQuotes"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Unknown quality-score field");
  if (typeof value["rationale"] !== "string" || value["rationale"].trim() === "" || !Array.isArray(value["evidenceQuotes"])) throw new Error("Quality score requires a rationale and evidenceQuotes array");
  const score: Record<string, unknown> = {};
  for (const key of ["overall", "coverage", "provenance", "limitations", "usefulness"]) {
    const number = value[key];
    if (!Number.isInteger(number) || (number as number) < 0 || (number as number) > 4) throw new Error(`Invalid quality score: ${key}`);
    score[key] = number;
  }
  const critical = Math.min(score["coverage"] as number, score["provenance"] as number, score["limitations"] as number);
  if ((critical === 0 && score["overall"] !== 0) || (score["overall"] as number) > critical + 1) throw new Error("Overall score violates the critical-criterion rule");
  const text = candidateText(candidate);
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const quote of value["evidenceQuotes"]) {
    if (typeof quote !== "string" || quote.trim() === "") { unmatched.push(String(quote)); continue; }
    (text.includes(normalisedText(quote)) ? matched : unmatched).push(quote);
  }
  return { ...(score as unknown as QualityScore), rationale: value["rationale"].trim(), evidenceQuotes: matched, unmatchedEvidenceQuotes: unmatched };
}

export function validateJudgeProvenance(judgeId: string, value: unknown): void {
  if (!isRecord(value)) throw new Error("Judge provenance is required");
  const reported = Array.isArray(value["reportedModels"]) ? value["reportedModels"] : [];
  const expected = judgeId === "claude-opus-5-5[1m]" ? "claude-opus-5-5" : judgeId;
  if (reported.length !== 1 || reported[0] !== expected) throw new Error(`Reported judge model differs from ${expected}`);
  if (judgeId === "claude-opus-5-5[1m]") {
    const contexts = isRecord(value["contextWindows"]) ? value["contextWindows"] : {};
    if (contexts[expected] !== 1_000_000) throw new Error("Claude judge did not report a 1,000,000-token context window");
  }
  for (const key of ["sourceCommit", "packetSha256", "harnessVersion"]) if (typeof value[key] !== "string" || value[key].trim() === "") throw new Error(`Judge provenance is missing ${key}`);
  if (!Number.isInteger(value["attemptNumber"]) || (value["attemptNumber"] as number) < 1 || (value["attemptNumber"] as number) > 2) throw new Error("Judge attemptNumber exceeds the two-attempt limit");
}

async function judgeFiles(root: string, idKey = "packetId"): Promise<Map<string, { value: unknown; fileName: string; sha256: string }>> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = new Map<string, { value: unknown; fileName: string; sha256: string }>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const text = await readFile(join(root, entry.name), "utf8");
    const value = JSON.parse(text) as unknown;
    const identity = isRecord(value) ? value[idKey] : undefined;
    if (typeof identity !== "string" || files.has(identity) || entry.name !== `${identity}.json`) throw new Error(`Invalid, duplicate or misnamed judge packet in ${root}`);
    files.set(identity, { value, fileName: entry.name, sha256: sha256Text(text) });
  }
  return files;
}

/** Verifies immutable inputs and applies complete per-packet judge files to exports. */
export async function applyQualityScores(seriesRoot: string, runs: readonly StudyAnalysisRun[]) {
  const output = join(seriesRoot, QUALITY_DIRECTORY);
  const manifestValue = await readJson(join(output, "manifest.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (manifestValue === null) return { runs: [...runs], judgeCounts: [0, 0] as const, judgeIds: JUDGE_IDS, records: [], disagreements: [], calibration: [] };
  if (!isRecord(manifestValue) || !Array.isArray(manifestValue["packets"]) || !Array.isArray(manifestValue["judgeIds"]) || canonicalJson(asJson(manifestValue["judgeIds"])) !== canonicalJson(asJson(JUDGE_IDS))) throw new Error("Invalid quality manifest");
  const observationsText = await readFile(join(seriesRoot, "observations.ndjson"), "utf8");
  if (sha256Text(observationsText) !== manifestValue["observationsSha256"]) throw new Error("Observations changed after quality packet preparation");
  const assignmentText = await readFile(join(output, "assignments.json"), "utf8");
  if (sha256Text(assignmentText) !== manifestValue["assignmentsSha256"]) throw new Error("Quality assignments changed after packet preparation");
  const assignments = (JSON.parse(assignmentText) as { assignments: QualityAssignment[] }).assignments;
  const packetTexts = new Map<string, string>();
  for (const entry of manifestValue["packets"]) {
    if (!isRecord(entry) || typeof entry["packetId"] !== "string" || typeof entry["sha256"] !== "string") throw new Error("Invalid packet manifest entry");
    const text = await readFile(join(output, "packets", `${entry["packetId"]}.json`), "utf8");
    if (sha256Text(text) !== entry["sha256"]) throw new Error(`Changed quality packet: ${entry["packetId"]}`);
    packetTexts.set(entry["packetId"], text);
  }
  if (packetTexts.size !== assignments.length || assignments.some((assignment) => !packetTexts.has(assignment.packetId))) throw new Error("Quality manifest and assignments differ");
  const byRun = new Map<string, QualityAssignment & { label: "A" | "B" }>();
  for (const assignment of assignments) for (const label of ["A", "B"] as const) {
    const candidate = assignment.candidates[label];
    if (!runs.some((run) => run.runId === candidate.runId)) throw new Error(`Quality assignment names an absent run: ${candidate.runId}`);
    byRun.set(candidate.runId, { ...assignment, label });
  }
  const scored = runs.map((run) => ({ ...run } as { -readonly [K in keyof StudyAnalysisRun]: StudyAnalysisRun[K] }));
  const judgeCounts: number[] = [];
  const records: { runId: string; packetId: string; label: "A" | "B"; judgeId: string; model: string; session: string; fileSha256: string; provenance: unknown; score: QualityScore }[] = [];
  for (const [index, judgeId] of JUDGE_IDS.entries()) {
    const judgeRoot = join(output, `judge-${index + 1}`);
    const files = await judgeFiles(judgeRoot);
    if (files.size === 0) {
      const present = await stat(judgeRoot).then((info) => info.isDirectory()).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
      if (present) throw new Error(`Judge-${index + 1} must score every packet exactly once`);
      judgeCounts.push(0);
      continue;
    }
    if (files.size !== assignments.length || assignments.some((assignment) => !files.has(assignment.packetId))) throw new Error(`Judge-${index + 1} must score every packet exactly once`);
    const sessions = new Set<string>();
    for (const assignment of assignments) {
      const file = files.get(assignment.packetId)!;
      const value = file.value;
      if (!isRecord(value) || value["judgeId"] !== judgeId || value["model"] !== judgeId || typeof value["session"] !== "string" || value["session"].trim() === "") throw new Error(`Invalid judge-${index + 1} identity or session for ${assignment.packetId}`);
      if (sessions.has(value["session"].trim())) throw new Error(`Judge-${index + 1} reused a session across packets`);
      sessions.add(value["session"].trim());
      if (Object.keys(value).some((key) => !["judgeId", "model", "session", "packetId", "A", "B", "provenance"].includes(key))) throw new Error(`Unknown judge-${index + 1} output field`);
      validateJudgeProvenance(judgeId, value["provenance"]);
      const packet = packetTexts.get(assignment.packetId)!;
      const packetValue = JSON.parse(packet) as { candidates: { label: string }[] };
      for (const label of ["A", "B"] as const) {
        const candidatePacket = packetValue.candidates.find((candidate) => candidate.label === label);
        let score: QualityScore;
        try { score = validateQualityScore(value[label], candidatePacket); }
        catch (error) { throw new Error(`${judgeId} ${assignment.packetId} ${label}: ${error instanceof Error ? error.message : String(error)}`); }
        const candidate = assignment.candidates[label];
        const run = scored.find((item) => item.runId === candidate.runId)!;
        if (index === 0) run.qualityJudge1 = score.overall;
        else run.qualityJudge2 = score.overall;
        records.push({ runId: candidate.runId, packetId: assignment.packetId, label, judgeId, model: judgeId, session: value["session"].trim(), fileSha256: file.sha256, provenance: value["provenance"] ?? null, score });
      }
    }
    judgeCounts.push(files.size * 2);
  }
  if (judgeCounts.every((count) => count > 0)) {
    for (const assignment of assignments) for (const label of ["A", "B"] as const) {
      const sessions = records.filter((record) => record.packetId === assignment.packetId && record.label === label).map((record) => record.session);
      if (new Set(sessions).size !== 2) throw new Error("Judges must use separate fresh sessions");
    }
  }
  const disagreements = assignments.flatMap((assignment) => {
    const rows = records.filter((record) => record.packetId === assignment.packetId);
    if (rows.length !== 4) return [];
    return (["A", "B"] as const).map((label) => {
      const pair = rows.filter((record) => record.label === label);
      return {
        packetId: assignment.packetId, queryId: assignment.queryId, population: assignment.population, repeat: assignment.repeat, label,
        runId: assignment.candidates[label].runId, arm: assignment.candidates[label].arm,
        overallDifference: pair[0].score.overall - pair[1].score.overall,
        criterionDifferences: Object.fromEntries(["coverage", "provenance", "limitations", "usefulness"].map((criterion) => [criterion, pair[0].score[criterion as keyof QualityScore] as number - (pair[1].score[criterion as keyof QualityScore] as number)])),
      };
    });
  });
  const calibration = await applyCalibrationScores(output);
  return { runs: scored, judgeCounts: judgeCounts as unknown as readonly [number, number], judgeIds: JUDGE_IDS, records, disagreements, calibration };
}

/** Prepares the four synthetic sanity checks without exposing the original A labels. */
export async function prepareCalibrationPackets(seriesRoot: string) {
  const output = join(seriesRoot, QUALITY_DIRECTORY);
  const finalRoot = join(output, "calibration");
  if (await stat(finalRoot).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("Calibration packet directory already exists");
  const assignmentValue = await readJson(join(output, "assignments.json")) as { seed: string };
  const calibrationText = await readFile(join(DESIGN_ROOT, "calibration.json"), "utf8");
  const calibration = JSON.parse(calibrationText) as { items: { id: string; question: string; syntheticSources: unknown; answerA: string; answerB: string }[] };
  const calibrationPromptText = await readFile(join(DESIGN_ROOT, "calibration-prompt.json"), "utf8");
  const judgePrompt = JSON.parse(calibrationPromptText) as unknown;
  const corpus = await readJson(join(DESIGN_ROOT, "corpus.json")) as { standardRubric: unknown };
  const assignments: CalibrationAssignment[] = [];
  const packets: { caseId: string; value: unknown }[] = [];
  const calibrationStart = Number.parseInt(sha256Canonical(asJson({ seed: assignmentValue.seed, calibration: "order" })).slice(0, 8), 16) % 2;
  for (const [index, item] of calibration.items.entries()) {
    const originalFirst = (calibrationStart + index) % 2 === 0;
    const candidates = originalFirst ? { A: "answerA", B: "answerB" } as const : { A: "answerB", B: "answerA" } as const;
    assignments.push({ caseId: item.id, candidates });
    packets.push({ caseId: item.id, value: {
      schemaVersion: 1,
      kind: "blinded-calibration-packet",
      caseId: item.id,
      question: item.question,
      sources: item.syntheticSources,
      rubric: corpus.standardRubric,
      judgePrompt,
      candidates: [{ label: "A", answer: item[candidates.A] }, { label: "B", answer: item[candidates.B] }],
      outputRule: "Return preference A, B or tie using the same evidence-backed quality criteria. Do not infer original labels.",
    } });
  }
  const root = join(output, `.calibration.staging-${randomBytes(6).toString("hex")}`);
  const assignmentOut = { schemaVersion: 1, private: true, assignments };
  const manifest = {
    schemaVersion: 1,
    kind: "codemode-judge-calibration-manifest",
    calibrationSha256: sha256Text(calibrationText),
    calibrationPromptSha256: sha256Text(calibrationPromptText),
    assignmentsSha256: sha256Text(jsonBytes(assignmentOut)),
    packets: packets.map((packet) => ({ caseId: packet.caseId, sha256: sha256Text(jsonBytes(packet.value)) })),
    limitation: "Four trivial synthetic sanity checks with uniform human A verdicts; not judge validation",
  };
  await mkdir(join(root, "packets"), { recursive: true });
  for (const packet of packets) await writeNewJson(join(root, "packets", `${packet.caseId}.json`), packet.value);
  await writeNewJson(join(root, "assignments.json"), assignmentOut);
  await writeNewJson(join(root, "manifest.json"), manifest);
  await rename(root, finalRoot);
  return { output: finalRoot, packetCount: packets.length };
}

async function applyCalibrationScores(output: string) {
  const root = join(output, "calibration");
  const manifestValue = await readJson(join(root, "manifest.json")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (manifestValue === null) return [];
  if (!isRecord(manifestValue) || !Array.isArray(manifestValue["packets"])) throw new Error("Invalid calibration manifest");
  const assignmentText = await readFile(join(root, "assignments.json"), "utf8");
  if (sha256Text(assignmentText) !== manifestValue["assignmentsSha256"]) throw new Error("Changed calibration assignments");
  const assignments = (JSON.parse(assignmentText) as { assignments: CalibrationAssignment[] }).assignments;
  const packetTexts = new Map<string, string>();
  for (const entry of manifestValue["packets"]) {
    if (!isRecord(entry) || typeof entry["caseId"] !== "string" || typeof entry["sha256"] !== "string") throw new Error("Invalid calibration packet entry");
    const text = await readFile(join(root, "packets", `${entry["caseId"]}.json`), "utf8");
    if (sha256Text(text) !== entry["sha256"]) throw new Error(`Changed calibration packet: ${entry["caseId"]}`);
    packetTexts.set(entry["caseId"], text);
  }
  const judgeResults: { caseId: string; judgeId: string; model: string; session: string; fileSha256: string; provenance: unknown; preference: "A" | "B" | "tie"; rationale: string; evidenceQuotes: string[]; unmatchedEvidenceQuotes: string[] }[] = [];
  for (const [index, judgeId] of JUDGE_IDS.entries()) {
    const files = await judgeFiles(join(root, `judge-${index + 1}`), "caseId");
    if (files.size === 0) continue;
    if (files.size !== assignments.length) throw new Error(`Calibration judge-${index + 1} must score every case`);
    const sessions = new Set<string>();
    for (const assignment of assignments) {
      const file = files.get(assignment.caseId)!;
      const value = file.value;
      if (!isRecord(value) || value["judgeId"] !== judgeId || value["model"] !== judgeId || typeof value["session"] !== "string" || value["session"].trim() === "" || !["A", "B", "tie"].includes(String(value["preference"])) || typeof value["rationale"] !== "string" || !Array.isArray(value["evidenceQuotes"])) throw new Error(`Invalid calibration result from judge-${index + 1} for ${assignment.caseId}`);
      if (sessions.has(value["session"].trim())) throw new Error(`Calibration judge-${index + 1} reused a session across cases`);
      sessions.add(value["session"].trim());
      validateJudgeProvenance(judgeId, value["provenance"]);
      const packet = packetTexts.get(assignment.caseId)!;
      const packetValue = JSON.parse(packet) as { sources?: { content?: string }[]; candidates?: { answer?: string }[] };
      const calibrationText = normalisedText([...(packetValue.sources ?? []).map((source) => source.content ?? ""), ...(packetValue.candidates ?? []).map((candidate) => candidate.answer ?? "")].join("\n"));
      const matched: string[] = [];
      const unmatched: string[] = [];
      for (const quote of value["evidenceQuotes"]) {
        if (typeof quote !== "string" || quote.trim() === "") { unmatched.push(String(quote)); continue; }
        (calibrationText.includes(normalisedText(quote)) ? matched : unmatched).push(quote);
      }
      judgeResults.push({ caseId: assignment.caseId, judgeId, model: judgeId, session: value["session"].trim(), fileSha256: file.sha256, provenance: value["provenance"] ?? null, preference: value["preference"] as "A" | "B" | "tie", rationale: value["rationale"], evidenceQuotes: matched, unmatchedEvidenceQuotes: unmatched });
    }
  }
  const decisionsValue = await readJson(join(REPO_ROOT, "evidence/benchmarks/codemode-study-v1/calibration/decisions.json")) as { decisions: { id: string; verdict: string }[] };
  return assignments.map((assignment) => {
    const rows = judgeResults.filter((row) => row.caseId === assignment.caseId);
    const original = (preference: "A" | "B" | "tie") => preference === "tie" ? "tie" : assignment.candidates[preference] === "answerA" ? "A" : "B";
    const human = decisionsValue.decisions.find((row) => row.id === assignment.caseId)?.verdict ?? null;
    return {
      caseId: assignment.caseId,
      humanVerdict: human,
      judges: rows.map((row) => ({ ...row, originalPreference: original(row.preference), agreesWithHuman: original(row.preference) === human })),
      judgesDisagree: rows.length === 2 && original(rows[0].preference) !== original(rows[1].preference),
    };
  });
}

/** Human sanity-check labels gate score visibility; they do not validate judges. */
export async function humanCalibrationApproved(path: string, corpusSha256: string, calibrationSha256: string): Promise<boolean> {
  const value = await readJson(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (value === null) return false;
  if (!isRecord(value) || !isRecord(value["reviewedInputs"]) || !Array.isArray(value["decisions"])) return false;
  const inputs = value["reviewedInputs"];
  if (inputs["corpusJsonSha256"] !== corpusSha256 || inputs["calibrationJsonSha256"] !== calibrationSha256) return false;
  const decisions = new Map<string, unknown>();
  for (const row of value["decisions"]) {
    if (!isRecord(row) || typeof row["id"] !== "string") return false;
    decisions.set(row["id"], row["verdict"]);
  }
  return ["CAL-01", "CAL-02", "CAL-03", "CAL-04"].every((id) => ["A", "B", "tie"].includes(String(decisions.get(id))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 4 && process.argv[2] === "prepare-calibration") {
    console.log(JSON.stringify(await prepareCalibrationPackets(resolve(process.argv[3])), null, 2));
  } else if (process.argv.length === 4 && process.argv[2] === "validate") {
    const seriesRoot = resolve(process.argv[3]);
    const text = await readFile(join(seriesRoot, "observations.ndjson"), "utf8");
    const runs = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as StudyAnalysisRun);
    const result = await applyQualityScores(seriesRoot, runs);
    console.log(JSON.stringify({ valid: true, judgeCounts: result.judgeCounts, disagreements: result.disagreements.length, calibrationCases: result.calibration.length }, null, 2));
  } else {
    if (process.argv.length !== 5 || process.argv[2] !== "prepare" || !["development", "pilot", "measured-series"].includes(process.argv[4])) {
      throw new Error("Usage: study-quality.ts prepare SERIES_ROOT development|pilot|measured-series OR prepare-calibration SERIES_ROOT");
    }
    const result = await prepareQualityPackets(resolve(process.argv[3]), process.argv[4] as "development" | "pilot" | "measured-series");
    console.log(JSON.stringify(result, null, 2));
  }
}
