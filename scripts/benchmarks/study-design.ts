// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ResearchSettings } from "../../src/core/types.js";
import { tuningDefaults } from "../../src/core/defaults.js";
import { parseExecutionSettings } from "../../src/core/execution-settings.js";
import type { SuggestionWorkflowOperation } from "./suggestion-replay.js";
import { sha256Canonical, asJson } from "./canonical.js";
import { singleResearchScript, breadthResearchScript, manualResearchScript, followupBaseScript, followupReadScript, type ScriptBudget } from "./study-workflows.js";

export const STUDY_PHASE_FORECAST = {
  development: { paidRuns: 6, expectedUsd: 0.2, conservativeUsd: 0.5 },
  pilot: { paidRuns: 32, expectedUsd: 1.28, conservativeUsd: 3.2 },
  "measured-series": { paidRuns: 60, expectedUsd: 2.4, conservativeUsd: 6 },
} as const;
export const STUDY_REMAINING_PLANNED_USD = 10.7; // Phase forecasts plus USD 1 retry/unknown reserve.

export type StudyWorkflow = "single" | "breadth" | "manual" | "followup";
export type StudyPartition = "development" | "pilot" | "measured-series" | "reserve";
export interface StudyTask {
  readonly id: string;
  readonly query: string;
  readonly workflow: StudyWorkflow;
  readonly partition: StudyPartition;
  readonly domains: readonly string[];
  readonly focusPrompt: string;
  readonly workflowQueries: readonly string[];
  readonly manualPlan?: { readonly searchQueries: readonly string[] };
  readonly followupPlan?: { readonly base: string; readonly followup: string };
}
export interface StudyPlan {
  readonly task: StudyTask;
  readonly workflow: readonly SuggestionWorkflowOperation[];
  readonly maxPages: number;
  readonly maxModelAttempts: number;
  readonly maxMainRequests: number;
  readonly maxToolCalls: number;
  readonly maxInputBytes: number;
  readonly maxOutputTokens: number;
  readonly maxQueryChars: number;
  readonly defaultPages: number;
  readonly timeoutMs: number;
  readonly abortGraceMs: number;
  readonly scriptBudget: ScriptBudget;
  readonly script: string;
  readonly followupScript: string | null;
  readonly scheduleSha256: string;
}

export function studyPipelineSettings(): ResearchSettings {
  return {
    ...tuningDefaults(),
    searchModel: { provider: "openrouter", model: "perplexity/sonar" },
    extractModel: { provider: "openrouter", model: "minimax/minimax-m3" },
    collateModel: { provider: "openrouter", model: "minimax/minimax-m3" },
    defaultUrls: 4, maxUrls: 12, extractMaxChars: 16_000,
    extractionMaxTokens: 3000, collationMaxTokens: 4000,
    cacheDir: ".search", disableLlmsFullDiscovery: true,
    llmRetryAttempts: 1, searchRetryAttempts: 1,
    execution: parseExecutionSettings({ fetchMaxChars: 16_000 }, "study.execution"),
  };
}

export async function readStudyDesign(root: string): Promise<{
  tasks: readonly StudyTask[]; methodSha256: string; corpusSha256: string; manifestSha256: string;
}> {
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString()) as { inputs: Array<{path: string; sha256: string}> };
  const seen = new Set<string>();
  for (const entry of manifest.inputs) {
    if (!/^[A-Za-z0-9_.-]+$/.test(entry.path) || seen.has(entry.path)) throw new Error("Invalid study manifest input");
    seen.add(entry.path);
    if (digest(await readFile(join(root, entry.path))) !== entry.sha256) throw new Error(`Study input changed: ${entry.path}`);
  }
  for (const name of ["PROTOCOL.md", "corpus.json", "calibration.json", "SPEND-BASELINE.json", "SCHEDULE.md"]) {
    if (!seen.has(name)) throw new Error(`Unbound study input: ${name}`);
  }
  const corpusBytes = await readFile(join(root, "corpus.json"));
  const corpus = JSON.parse(corpusBytes.toString()) as { queries: StudyTask[] };
  const ids = new Set<string>();
  for (const task of corpus.queries) {
    if (ids.has(task.id)) throw new Error("Duplicate study task");
    ids.add(task.id);
    createStudyPlan(task);
  }
  return { tasks: corpus.queries, methodSha256: digest(await readFile(join(root, "PROTOCOL.md"))), corpusSha256: digest(corpusBytes), manifestSha256: digest(manifestBytes) };
}

export function createStudyPlan(task: StudyTask): StudyPlan {
  if (!/^[A-Za-z0-9_-]+$/.test(task.id) || !task.query.trim() || !task.focusPrompt.trim() || !["single", "breadth", "manual", "followup"].includes(task.workflow)) throw new Error("Invalid study task");
  const maxPages = task.workflow === "breadth" ? 12 : 4;
  const budget: ScriptBudget = { maxPages, maxChars: 16_000, timeoutMs: 300_000, maxOutputTokens: 4000 };
  const args = { query: task.query, focusPrompt: task.focusPrompt, domains: task.domains };
  let workflow: SuggestionWorkflowOperation[];
  let script: string;
  if (task.workflow === "breadth") {
    if (task.workflowQueries.length !== 3 || new Set(task.workflowQueries).size !== 3) throw new Error("Breadth requires three distinct declared angles");
    workflow = task.workflowQueries.map((query, i) => ({ node: `${task.id}.q${i + 1}`, query, occurrence: 1 }));
    script = breadthResearchScript(task.workflowQueries.map((query) => ({ ...args, query })), budget);
  } else if (task.workflow === "manual") {
    if (task.manualPlan?.searchQueries.length !== 2) throw new Error("Manual task requires two declared searches");
    workflow = [{ node: `${task.id}.collate`, query: task.query, occurrence: 1, kind: "collate" }];
    script = manualResearchScript(args, budget, task.manualPlan.searchQueries);
  } else {
    const query = task.workflow === "followup" ? task.followupPlan?.base : task.query;
    if (!query || (task.workflow === "followup" && !task.followupPlan?.followup)) throw new Error("Follow-up task requires both turns");
    workflow = [{ node: `${task.id}.base`, query, occurrence: 1 }];
    script = task.workflow === "followup" ? followupBaseScript({ ...args, query }, budget) : singleResearchScript(args, budget);
  }
  const schedule = { task, workflow, maxPages, schedule: task.workflow === "breadth" ? "three-parallel" : "serial", scriptBudget: budget };
  return {
    task, workflow, maxPages, scriptBudget: budget, script,
    followupScript: task.workflow === "followup" ? followupReadScript(budget) : null,
    maxModelAttempts: task.workflow === "breadth" ? 24 : 10,
    maxMainRequests: task.workflow === "manual" ? 18 : 8,
    maxToolCalls: task.workflow === "manual" ? 20 : 12,
    maxInputBytes: 128_000, maxOutputTokens: 4096, maxQueryChars: 2000, defaultPages: 4,
    timeoutMs: 300_000, abortGraceMs: 15_000,
    scheduleSha256: sha256Canonical(asJson(schedule)),
  };
}

export const STUDY_SYSTEM_PROMPT = "Answer the user's research task using the available research tools and captured source evidence. Cite sources for material factual claims. State gaps and uncertainty. Do not invent evidence. Keep the final answer within 500 words. Use no more than the task's attempted-page allowance. Use the given focus when extracting evidence. A script, if used, must have a finite timeout_ms no greater than 300000 and max_output_tokens no greater than 4000. Do not call classifier or image models. Do not read files outside the workspace. Stop after a failed operation if the remaining evidence cannot answer the task.";

export function studyPrompts(plan: StudyPlan, arm: "off" | "on" | "only", controlled: boolean): readonly string[] {
  const task = plan.task;
  const question = task.workflow === "followup" ? task.followupPlan!.base : task.query;
  const common = `Task: ${question}\nSource domains: ${task.domains.join(", ")}.\nExtraction focus: ${task.focusPrompt}\nAttempted-page allowance: ${plan.maxPages} total across the task. Each fetched page is limited to 16000 characters. Final answer: at most 500 words.`;
  let first = common;
  if (controlled && arm !== "off") first += `\nControlled workflow: execute this exact script once with codemode, then answer from its returned evidence. Do not alter arguments or make extra research calls.\n${plan.script}`;
  if (controlled && arm === "off") {
    const queryArgs = { query: question, domains: task.domains, focusPrompt: task.focusPrompt, maxUrls: 4 };
    if (task.workflow === "breadth") first += `\nControlled workflow: issue these three intelli_research calls together in one parallel batch, then synthesise their returned evidence. Do not alter arguments or make extra calls.\n${JSON.stringify(task.workflowQueries.map((query) => ({ ...queryArgs, query })))}`;
    else if (task.workflow === "manual") first += `\nControlled workflow: call intelli_search serially for each query in ${JSON.stringify(task.manualPlan!.searchQueries)} with domains ${JSON.stringify(task.domains)}. In that order combine their source URLs, remove duplicates and take the first four. For each URL serially call intelli_fetch with maxChars=16000; when completed and content is nonempty, pass the returned url, title and exact content to intelli_extract with query ${JSON.stringify(task.query)} and focusPrompt ${JSON.stringify(task.focusPrompt)}. Collect {url,title,extraction,sourceType,status} using extraction/sourceType from the first source record and status success only for a completed extraction, otherwise failed. Call intelli_collate once with query ${JSON.stringify(task.query)} and those extractions, then answer from its synthesis. No other pipeline calls.`;
    else first += `\nControlled workflow: call intelli_research exactly once with ${JSON.stringify(queryArgs)}, then answer from its returned evidence. Do not alter arguments or make extra research calls.`;
  }
  if (task.workflow !== "followup") return [first];
  let second = `Follow-up: ${task.followupPlan!.followup}\nUse the saved base-research report. No additional pages are allowed. State if that evidence is insufficient. Final answer: at most 500 words.`;
  if (controlled) second += arm === "off"
    ? "\nRead the committed reportPath from the preceding result using read. Do not invoke the research pipeline again."
    : `\nExecute this exact script once with codemode, then answer from the returned report.\n${plan.followupScript}`;
  return [first, second];
}
