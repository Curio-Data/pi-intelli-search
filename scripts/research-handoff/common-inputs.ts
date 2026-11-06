// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Fixed-source replay adapters for the research-handoff study (Track A).
// Implements the coordinator-owned contracts in ./contracts.ts against the
// unmodified baseline core. Fail-closed everywhere: any deviation between the
// live request stream and the frozen corpus throws before live work happens.
// The paid capture transport calls stay OUTSIDE this module; every function
// here is deterministic and unit-testable with synthetic inputs.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  DeepReadonly,
  ModelClient,
  ModelCompletion,
  ModelRequest,
  ResearchParams,
} from "../../src/core/contracts.js";
import type { FetchedPage, ModelConfig, ResearchSettings } from "../../src/core/types.js";
import type { fetchPages } from "../../src/core/fetch.js";
import type { ResearchDependencies } from "../../src/core/operations/research.js";
import { extractSourceUrls } from "../../src/core/util.js";
import { mergeCitations } from "../../src/core/annotations.js";
import { appendDomainFilter, buildExtractionMessage } from "../../src/core/messages.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "../../src/core/prompts.js";
import { tuningDefaults } from "../../src/core/defaults.js";
import { SCHEMA_VERSION, type FrozenInputs, type Journal, type JournalEvent } from "./contracts.js";
import { verifySourceDerivation, type SourceDerivation } from "./source-selection.js";

/** Search-stage request constant from the baseline core (research.ts). */
const SEARCH_MAX_TOKENS = 2000;

// ── Canonical identity ───────────────────────────────────────────────────────

/**
 * Recursively key-sorted JSON with normal omission of undefined object fields
 * and preserved array order (PROTOCOL.md, Canonical identity). Used ONLY for
 * the structured frozen-object digest; content and message identity hashes
 * (contentSha256, systemPromptSha256, userMessageSha256) hash the raw UTF-8
 * text bytes directly via sha256Hex, never a JSON serialisation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return value === undefined ? "null" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",") + "}";
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashKey(systemPromptSha256: string, userMessageSha256: string): string {
  return `${systemPromptSha256}:${userMessageSha256}`;
}

/** Undefined-tolerant deep equality: an absent key equals an undefined value. */
export function looseDeepEqual(a: unknown, b: unknown): boolean {
  return diffPaths(a, b).length === 0;
}

/** Key-path list of every difference between two values (absent === undefined). */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") {
    // Primitives (including undefined vs absent, handled by callers skipping
    // both-undefined keys): equal values produce no problem path.
    return Object.is(a, b) ? [] : [path || "<root>"];
  }
  // An array never equals a plain object: [] must not compare equal to {}
  // (review F15).
  if (Array.isArray(a) !== Array.isArray(b)) return [path || "<root>"];
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(aObj), ...Object.keys(bObj)])];
  const problems: string[] = [];
  for (const key of keys) {
    const av = aObj[key];
    const bv = bObj[key];
    if (av === undefined && bv === undefined) continue;
    problems.push(...diffPaths(av, bv, path ? `${path}.${key}` : key));
  }
  return problems;
}

// ── Frozen-input errors ──────────────────────────────────────────────────────

export type FrozenProblemKind = "structure" | "digest" | "settings" | "params";

export class FrozenIntegrityError extends Error {
  constructor(
    readonly kind: FrozenProblemKind,
    readonly problems: string[],
  ) {
    super(
      `frozen input ${kind} mismatch: ${problems.length} problem(s): ${problems
        .map((p) => JSON.stringify(p))
        .join("; ")}`,
    );
    this.name = "FrozenIntegrityError";
  }
}

// ── Latched input-control state (review F2) ──────────────────────────────

/**
 * Shared per-execution latch. The first input deviation sets `failed`; from
 * that moment every later model request is refused BEFORE any live
 * delegation, no matter how the baseline core would have classified the
 * error (per-page extraction failures and the cache-suggestion judge are
 * swallowed by research.ts and would otherwise let the run continue into
 * paid work and a normal-looking result).
 */
export interface InputControlLatch {
  failed: boolean;
  deviations: string[];
}

export function createInputControlLatch(): InputControlLatch {
  return { failed: false, deviations: [] };
}

/** Latch a deviation, journal it, and return the error to throw. */
function deviation(
  latch: InputControlLatch,
  journal: Journal,
  kind: string,
  stage: JournalEvent["stage"],
  data: Record<string, unknown>,
): FrozenIntegrityError {
  latch.failed = true;
  latch.deviations.push(kind);
  journal.record({ kind, stage, data });
  return new FrozenIntegrityError("structure", [`input deviation ${JSON.stringify(kind)} latched; later model work is refused`]);
}

// ── Capture assembly (pure; paid capture calls happen in the runner) ────────

export interface AssembleFrozenInputsArgs {
  params: ResearchParams;
  /** Fully resolved settings used for the capture (whole object, frozen verbatim). */
  settings: ResearchSettings;
  /** The ONE fresh live search completion, pre stripTrailingSourcesSection. */
  searchCompletion: ModelCompletion;
  /** Live attempts the capture took (search retry loop), for cost accounting. */
  searchAttempts: number;
  /** Result of the ONE live fetchPages call for the selected URLs, in order. */
  pages: FetchedPage[];
  meta: FrozenInputs["meta"];
  /** rh-v6 only: pages are the derivation's selected pages, not the discovery list. */
  sourceDerivation?: SourceDerivation;
}

function effectiveMaxUrls(params: ResearchParams, settings: DeepReadonly<ResearchSettings>): number {
  return Math.min(params.maxUrls ?? settings.defaultUrls, settings.maxUrls);
}

export async function assembleFrozenInputs(args: AssembleFrozenInputsArgs): Promise<FrozenInputs> {
  const { params, settings, searchCompletion, searchAttempts, pages, meta, sourceDerivation } = args;
  const cap = effectiveMaxUrls(params, settings);
  const selectedSources = mergeCitations(extractSourceUrls(searchCompletion.text), {
    citations: searchCompletion.citations,
  }).slice(0, cap);
  if (selectedSources.length === 0) {
    throw new FrozenIntegrityError("structure", [
      "capture produced zero selected sources; it cannot serve a fixed-source replay",
    ]);
  }
  // Historical captures align pages with the discovery list; an rh-v6 capture
  // aligns them with its separately recorded derived inventory.
  const aligned = sourceDerivation ? sourceDerivation.selected : selectedSources;
  const alignedName = sourceDerivation ? "sourceDerivation.selected" : "selectedSources";
  const urlProblems = pages
    .map((page, i) => ({ page, i }))
    .filter(({ page, i }) => aligned[i] === undefined || page.url !== aligned[i].url)
    .map(({ page, i }) => `pages[${i}] url ${JSON.stringify(page.url)} does not align with ${alignedName}[${i}]`);
  if (pages.length !== aligned.length || urlProblems.length > 0 || (sourceDerivation && pages.length === 0)) {
    throw new FrozenIntegrityError("structure", [
      `pages length ${pages.length} vs ${alignedName} length ${aligned.length}`,
      ...urlProblems,
    ]);
  }
  const frozenPages = pages.map((page) => ({
    page,
    contentSha256: sha256Hex(page.content),
  }));
  const extractionInputs = pages
    .filter((page) => page.status === "success")
    .map((page) => ({
      url: page.url,
      systemPromptSha256: sha256Hex(EXTRACTION_SYSTEM_PROMPT),
      userMessageSha256: sha256Hex(
        buildExtractionMessage(page.content, params.query, params.focusPrompt, settings.extractMaxChars),
      ),
    }));
  const core: Omit<FrozenInputs, "digest"> = {
    schemaVersion: SCHEMA_VERSION,
    capture: {
      params,
      searchModel: settings.searchModel,
      systemPrompt: SEARCH_SYSTEM_PROMPT,
      userMessage: appendDomainFilter(params.query, params.domains),
      maxTokens: SEARCH_MAX_TOKENS,
      completion: searchCompletion,
      effectiveMaxUrls: cap,
      selectedSources,
      captureAttempts: searchAttempts,
    },
    pages: frozenPages,
    extractionInputs,
    settings: settings as DeepReadonly<ResearchSettings>,
    meta,
    ...(sourceDerivation ? { sourceDerivation } : {}),
  };
  return { ...core, digest: computeFrozenDigest(core) };
}

export function computeFrozenDigest(core: Omit<FrozenInputs, "digest">): string {
  return sha256Hex(canonicalJson(core));
}

// ── Structural verification (full manifest, not just the digest) ────────────

const SETTINGS_REFERENCE_KEYS = [...Object.keys(tuningDefaults()), "searchModel", "extractModel", "collateModel"];

function isPlainString(v: unknown): v is string {
  return typeof v === "string";
}

function isModelConfig(v: unknown): boolean {
  return (
    typeof v === "object" && v !== null && isPlainString((v as ModelConfig).provider) && isPlainString((v as ModelConfig).model)
  );
}

export function verifyFrozenInputs(frozen: FrozenInputs): void {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);

  if (frozen.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion ${String(frozen.schemaVersion)} !== ${SCHEMA_VERSION}`);
  const capture = frozen.capture;
  if (typeof capture !== "object" || capture === null) {
    throw new FrozenIntegrityError("structure", ["capture missing"]);
  }
  if (!isPlainString(capture.params?.query) || capture.params.query.length === 0) fail("capture.params.query missing");
  if (!isModelConfig(capture.searchModel)) fail("capture.searchModel must be { provider, model } strings");
  if (capture.systemPrompt !== SEARCH_SYSTEM_PROMPT) {
    fail("capture.systemPrompt does not equal the live SEARCH_SYSTEM_PROMPT (baseline drift)");
  }
  if (!isPlainString(capture.userMessage)) fail("capture.userMessage missing");
  if (capture.maxTokens !== SEARCH_MAX_TOKENS) fail(`capture.maxTokens ${String(capture.maxTokens)} !== ${SEARCH_MAX_TOKENS}`);
  if (!isPlainString(capture.completion?.text) || capture.completion.text.length === 0) {
    fail("capture.completion.text missing");
  }
  if (!Array.isArray(capture.completion?.citations)) {
    fail("capture.completion.citations must be an array");
  } else {
    for (const [i, citation] of capture.completion.citations.entries()) {
      if (typeof citation !== "object" || citation === null || !isPlainString(citation.url)) {
        fail(`capture.completion.citations[${i}] must be an object with a string url`);
      }
    }
  }
  if (capture.params?.domains !== undefined) {
    if (!Array.isArray(capture.params.domains) || !capture.params.domains.every((d) => isPlainString(d))) {
      fail("capture.params.domains must be an array of strings");
    }
  }
  // Search request and model consistency (review F15): the captured request
  // identity must be derivable from the frozen params and settings.
  if (isPlainString(capture.userMessage) && isPlainString(capture.params?.query)) {
    const expectedUserMessage = appendDomainFilter(capture.params.query, capture.params.domains);
    if (capture.userMessage !== expectedUserMessage) {
      fail("capture.userMessage does not equal appendDomainFilter(params.query, params.domains)");
    }
  }
  if (isModelConfig(capture.searchModel) && isModelConfig((frozen.settings as ResearchSettings).searchModel)) {
    if (
      capture.searchModel.provider !== (frozen.settings as ResearchSettings).searchModel.provider ||
      capture.searchModel.model !== (frozen.settings as ResearchSettings).searchModel.model
    ) {
      fail("capture.searchModel does not match settings.searchModel");
    }
  }
  if (!Array.isArray(capture.selectedSources) || capture.selectedSources.length === 0) {
    fail("capture.selectedSources must be a non-empty array");
  } else {
    const urls = new Set<string>();
    for (const [i, source] of capture.selectedSources.entries()) {
      if (!isPlainString(source?.url)) fail(`selectedSources[${i}].url missing`);
      else if (urls.has(source.url)) fail(`selectedSources[${i}].url ${source.url} duplicates an earlier entry`);
      else urls.add(source.url);
    }
  }

  // Whole-settings completeness and shape.
  const settings = frozen.settings as unknown;
  if (typeof settings !== "object" || settings === null) {
    fail("settings missing");
  } else {
    const present = new Set(Object.keys(settings as object));
    for (const key of SETTINGS_REFERENCE_KEYS) {
      const referenceValue = (tuningDefaults() as Record<string, unknown>)[key];
      if (referenceValue === undefined) continue; // absent equals undefined (httpProxy)
      if (!present.has(key)) fail(`settings.${key} missing from the frozen settings object`);
    }
    for (const key of present) {
      if (!SETTINGS_REFERENCE_KEYS.includes(key)) fail(`settings has unexpected key "${key}"`);
    }
    const settingsObj = settings as Record<string, unknown>;
    for (const key of ["searchModel", "extractModel", "collateModel"]) {
      if (!isModelConfig(settingsObj[key])) fail(`settings.${key} must be { provider, model } strings`);
    }
  }

  // Page alignment with the selected sources. An rh-v6 corpus aligns its pages
  // with the derived inventory instead; the raw discovery list keeps its
  // historical recomputation check below either way.
  const derivation = frozen.sourceDerivation;
  if (derivation !== undefined && (typeof derivation !== "object" || derivation === null || !Array.isArray(derivation.selected))) {
    throw new FrozenIntegrityError("structure", ["sourceDerivation must be an object with a selected array"]);
  }
  const sources = derivation ? derivation.selected : capture.selectedSources ?? [];
  const sourcesName = derivation ? "sourceDerivation.selected" : "selectedSources";
  if (Array.isArray(frozen.pages)) {
    if (frozen.pages.length !== sources.length) {
      fail(`pages length ${frozen.pages.length} !== ${sourcesName} length ${sources.length}`);
    }
    for (const [i, entry] of frozen.pages.entries()) {
      const page = entry?.page;
      if (typeof page !== "object" || page === null) {
        fail(`pages[${i}].page missing`);
        continue;
      }
      if (sources[i] && page.url !== sources[i].url) {
        fail(`pages[${i}].page.url ${JSON.stringify(page.url)} does not align with ${sourcesName}[${i}]`);
      }
      if (derivation && page.status !== "success") fail(`pages[${i}] is a derived selected page without a successful capture`);
      if (page.status !== "success" && page.status !== "error") fail(`pages[${i}].page.status must be success|error`);
      if (!isPlainString(page.content)) fail(`pages[${i}].page.content must be a string`);
      if (isPlainString(page.content) && entry.contentSha256 !== sha256Hex(page.content)) {
        fail(`pages[${i}].contentSha256 does not match the recorded page content`);
      }
    }
  } else {
    fail("pages must be an array");
  }

  // Extraction inputs: exactly the success pages, in selected order, hashes
  // recomputed against the live prompt and the frozen settings.
  const successPages = Array.isArray(frozen.pages)
    ? frozen.pages.map((entry) => entry.page).filter((page) => page?.status === "success")
    : [];
  if (Array.isArray(frozen.extractionInputs)) {
    if (frozen.extractionInputs.length !== successPages.length) {
      fail(`extractionInputs length ${frozen.extractionInputs.length} !== success page count ${successPages.length}`);
    }
    for (const [i, input] of frozen.extractionInputs.entries()) {
      const page = successPages[i];
      if (!page) continue;
      if (input?.url !== page.url) fail(`extractionInputs[${i}].url does not align with success page ${i}`);
      if (input?.systemPromptSha256 !== sha256Hex(EXTRACTION_SYSTEM_PROMPT)) {
        fail(`extractionInputs[${i}].systemPromptSha256 does not equal the live EXTRACTION_SYSTEM_PROMPT hash`);
      }
      const expected = sha256Hex(
        buildExtractionMessage(
          page.content,
          capture.params.query,
          capture.params.focusPrompt,
          (frozen.settings as ResearchSettings).extractMaxChars,
        ),
      );
      if (input?.userMessageSha256 !== expected) {
        fail(`extractionInputs[${i}].userMessageSha256 does not match the recomputed extraction message`);
      }
    }
  } else {
    fail("extractionInputs must be an array");
  }

  // Selection cap consistency.
  const cap = effectiveMaxUrls(capture.params, frozen.settings);
  if (capture.effectiveMaxUrls !== cap) {
    fail(`capture.effectiveMaxUrls ${String(capture.effectiveMaxUrls)} !== recomputed ${cap}`);
  }

  // Recompute the baseline selection from the captured completion (review
  // F15): a reordered or otherwise inconsistent corpus that was re-digested
  // is rejected at load time, before admission, instead of surfacing later
  // at the fetch boundary.
  if (isPlainString(capture.completion?.text) && Array.isArray(capture.selectedSources) && Array.isArray(capture.completion.citations)) {
    const recomputed = mergeCitations(extractSourceUrls(capture.completion.text), {
      citations: capture.completion.citations,
    }).slice(0, cap);
    if (JSON.stringify(recomputed) !== JSON.stringify(capture.selectedSources)) {
      fail("capture.selectedSources does not equal the recomputed baseline citation merge and cap");
    }
  }

  // Derived inventory: re-derive it from the raw discovery list and the
  // recorded fetch log under the registered frozen policy.
  if (derivation && Array.isArray(frozen.pages) && Array.isArray(capture.selectedSources)) {
    for (const problem of verifySourceDerivation(frozen)) fail(problem);
  }

  // Meta identity.
  for (const key of ["capturedAt", "coreCommit", "protocolRef"] as const) {
    if (!isPlainString(frozen.meta?.[key]) || frozen.meta[key].length === 0) fail(`meta.${key} missing`);
  }

  // Digest binds everything above.
  const { digest, ...core } = frozen;
  if (!isPlainString(digest) || digest.length !== 64) fail("digest must be a sha256 hex string");
  else if (computeFrozenDigest(core) !== digest) fail("digest does not match the canonical serialisation");

  if (problems.length > 0) throw new FrozenIntegrityError("structure", problems);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

export interface LoadFrozenInputsArgs {
  path: string;
}

export async function loadFrozenInputs(args: LoadFrozenInputsArgs): Promise<FrozenInputs> {
  const raw = await readFile(args.path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FrozenIntegrityError("structure", [`frozen inputs file is not valid JSON: ${String(error)}`]);
  }
  const frozen = parsed as FrozenInputs;
  verifyFrozenInputs(frozen);
  return deepFreeze(structuredClone(frozen));
}

// ── Replay-time assertions ───────────────────────────────────────────────────

export interface AssertSettingsMatchFrozenArgs {
  frozen: FrozenInputs;
  settings: DeepReadonly<ResearchSettings>;
}

/** Whole-settings equality, including retry delays, timeout and throttle. */
export function assertSettingsMatchFrozen(args: AssertSettingsMatchFrozenArgs): void {
  const problems = diffPaths(args.frozen.settings, args.settings, "settings");
  if (problems.length > 0) throw new FrozenIntegrityError("settings", problems);
}

export interface AssertParamsMatchFrozenArgs {
  frozen: FrozenInputs;
  params: ResearchParams;
}

export function assertParamsMatchFrozen(args: AssertParamsMatchFrozenArgs): void {
  const frozen = args.frozen.capture.params;
  const actual = args.params;
  const problems: string[] = [];
  if (actual.query !== frozen.query) problems.push(`query: expected ${JSON.stringify(frozen.query)}, got ${JSON.stringify(actual.query)}`);
  const expectedDomains = frozen.domains ?? [];
  const actualDomains = actual.domains ?? [];
  if (JSON.stringify(actualDomains) !== JSON.stringify(expectedDomains)) {
    problems.push(`domains: expected ${JSON.stringify(expectedDomains)}, got ${JSON.stringify(actualDomains)}`);
  }
  if (actual.focusPrompt !== frozen.focusPrompt) {
    problems.push(`focusPrompt: expected ${JSON.stringify(frozen.focusPrompt)}, got ${JSON.stringify(actual.focusPrompt)}`);
  }
  if (actual.maxUrls !== frozen.maxUrls) {
    problems.push(`maxUrls: expected ${JSON.stringify(frozen.maxUrls)}, got ${JSON.stringify(actual.maxUrls)}`);
  }
  if (problems.length > 0) throw new FrozenIntegrityError("params", problems);
}

// ── Replay adapters ──────────────────────────────────────────────────────────

type ModelRole = "search" | "extract" | "collate" | "cache" | "unknown";

function classifyRole(systemPrompt: string): ModelRole {
  switch (systemPrompt) {
    case SEARCH_SYSTEM_PROMPT:
      return "search";
    case EXTRACTION_SYSTEM_PROMPT:
      return "extract";
    case COLLATION_SYSTEM_PROMPT:
      return "collate";
    case CACHE_SUGGEST_PROMPT:
      return "cache";
    default:
      return "unknown";
  }
}

function modelId(config: ModelConfig): string {
  return `${config.provider}/${config.model}`;
}

export interface CreateFrozenModelClientArgs {
  /** The real native client: live extraction and collation delegate here. */
  delegate: ModelClient;
  frozen: FrozenInputs;
  journal: Journal;
  /** Shared per-execution latch; see createInputControlLatch(). */
  latch: InputControlLatch;
}

/** Usage values carried by adapter events are SDK-normalised estimates. */
export const USAGE_ESTIMATE_KIND = "sdk-normalised-estimate" as const;

/**
 * Model-client decorator around the native client. The search stage replays
 * the frozen completion (one shot); extraction requests are verified against
 * the remaining expected multiset BEFORE any live delegation; collation is
 * journaled and delegated; cache suggestion and unknown stages are rejected.
 * The first deviation latches input control: every later request is refused
 * before delegation, so the baseline core cannot swallow the failure and
 * continue into paid work (review F2).
 */
export function createFrozenModelClient(args: CreateFrozenModelClientArgs): ModelClient {
  const { delegate, frozen, journal, latch } = args;
  const capture = frozen.capture;
  let searchReplays = 0;
  const remaining = new Map<string, number>();
  for (const input of frozen.extractionInputs) {
    const key = hashKey(input.systemPromptSha256, input.userMessageSha256);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return {
    preflight(bindings) {
      return delegate.preflight(bindings);
    },
    async complete(request: ModelRequest): Promise<ModelCompletion> {
      const role = classifyRole(request.systemPrompt);
      const systemPromptSha256 = sha256Hex(request.systemPrompt);
      const userMessageSha256 = sha256Hex(request.userMessage);

      // Latched refusal: after the first input deviation, no later model
      // request reaches the live delegate, whatever the core does with the
      // thrown error.
      if (latch.failed) {
        journal.record({
          kind: "input-control-latched",
          stage: role === "unknown" ? undefined : (role as JournalEvent["stage"]),
          data: { refusedRole: role, deviations: [...latch.deviations] },
        });
        throw new FrozenIntegrityError("structure", [
          `input control already latched by ${JSON.stringify(latch.deviations)}; refusing ${JSON.stringify(role)} request before delegation`,
        ]);
      }

      if (role === "search") {
        const problems: string[] = [];
        if (modelId(request.model) !== modelId(capture.searchModel)) {
          problems.push(`model: expected ${modelId(capture.searchModel)}, got ${modelId(request.model)}`);
        }
        if (request.systemPrompt !== capture.systemPrompt) problems.push("systemPrompt differs from the captured search prompt");
        if (request.userMessage !== capture.userMessage) problems.push("userMessage differs from the captured search message");
        if (request.maxTokens !== capture.maxTokens) {
          problems.push(`maxTokens: expected ${capture.maxTokens}, got ${String(request.maxTokens)}`);
        }
        if (request.collectCitations !== true) problems.push("collectCitations must be true for the search stage");
        if (request.payloadPatch !== undefined) problems.push("payloadPatch must be absent (searchWebSearch is disabled in the study settings)");
        if (request.reasoning !== undefined) problems.push("reasoning must be absent for the default search stage");
        if (problems.length > 0) {
          throw deviation(latch, journal, "search-mismatch", "search", { problems });
        }
        searchReplays += 1;
        if (searchReplays > 1) {
          throw deviation(latch, journal, "search-replay-exhausted", "search", {
            problems: ["the frozen search completion was replayed more than once"],
          });
        }
        journal.record({
          kind: "search-replayed",
          stage: "search",
          data: {
            replayed: true,
            newCharge: false,
            newProviderAttempt: false,
            // SDK-normalised estimate including catalogue-derived cost; this
            // is setup provenance, never a reported provider charge (F15).
            capturedUsageEstimate: capture.completion.usage ?? null,
            capturedUsageKind: USAGE_ESTIMATE_KIND,
          },
        });
        return structuredClone(capture.completion);
      }

      if (role === "extract") {
        journal.record({
          kind: "model-request",
          stage: "extract",
          data: { role, model: modelId(request.model), systemPromptSha256, userMessageSha256, maxTokens: request.maxTokens ?? null },
        });
        const key = hashKey(systemPromptSha256, userMessageSha256);
        const left = remaining.get(key) ?? 0;
        if (left <= 0) {
          throw deviation(latch, journal, "extract-hash-mismatch", "extract", {
            systemPromptSha256,
            userMessageSha256,
            reason: "hash is not in the expected remaining multiset",
          });
        }
        remaining.set(key, left - 1);
        journal.record({ kind: "extract-consumed", stage: "extract", data: { systemPromptSha256, userMessageSha256, remainingAfter: left - 1 } });
        const completion = await delegate.complete(request);
        journal.record({
          kind: "model-completion",
          stage: "extract",
          data: {
            role,
            usageEstimate: completion.usage ?? null,
            usageKind: USAGE_ESTIMATE_KIND,
            routeProvider: completion.routeProvider ?? null,
            // Completion text retained for downstream variation analysis (F9).
            text: completion.text,
            textSha256: sha256Hex(completion.text),
          },
        });
        return completion;
      }

      if (role === "collate") {
        journal.record({
          kind: "model-request",
          stage: "collate",
          data: { role, model: modelId(request.model), systemPromptSha256, userMessageSha256, maxTokens: request.maxTokens ?? null },
        });
        const completion = await delegate.complete(request);
        journal.record({
          kind: "model-completion",
          stage: "collate",
          data: {
            role,
            usageEstimate: completion.usage ?? null,
            usageKind: USAGE_ESTIMATE_KIND,
            routeProvider: completion.routeProvider ?? null,
            text: completion.text,
            textSha256: sha256Hex(completion.text),
          },
        });
        return completion;
      }

      if (role === "cache") {
        throw deviation(latch, journal, "cache-suggest-rejected", "cache", {
          reason: "cache suggestion inference is outside the fixed-source protocol",
        });
      }

      throw deviation(latch, journal, "stage-unclassified", undefined, { systemPromptSha256 });
    },
  };
}

export interface CreateFrozenFetchPagesArgs {
  frozen: FrozenInputs;
  journal: Journal;
  /** Shared per-execution latch; see createInputControlLatch(). */
  latch: InputControlLatch;
}

export function createFrozenFetchPages(args: CreateFrozenFetchPagesArgs): typeof fetchPages {
  const { frozen, journal, latch } = args;
  const expectedUrls = frozen.capture.selectedSources.map((source) => source.url);
  const settings = frozen.settings as ResearchSettings;
  const expectedOpts = {
    timeoutMs: settings.fetchTimeoutMs,
    browser: settings.browserFingerprint,
    concurrency: settings.fetchConcurrency,
    proxy: settings.httpProxy,
  };
  let served = false;
  return async (urls: string[], signal?: AbortSignal, opts?: Parameters<typeof fetchPages>[2]) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const actualUrls = Array.isArray(urls) ? urls : [];
    if (JSON.stringify(actualUrls) !== JSON.stringify(expectedUrls)) {
      throw deviation(latch, journal, "fetch-mismatch", "fetch", { expected: expectedUrls, actual: actualUrls });
    }
    if (!looseDeepEqual(opts ?? {}, expectedOpts)) {
      throw deviation(latch, journal, "fetch-options-mismatch", "fetch", { expected: expectedOpts, actual: opts ?? null });
    }
    // One fetch per execution: the baseline core calls fetchPages once, so a
    // second serving is unexpected evidence (review F15) and latches.
    if (served) {
      throw deviation(latch, journal, "fetch-repeated", "fetch", {
        reason: "the frozen page set was requested more than once",
      });
    }
    served = true;
    const pages = structuredClone(frozen.pages.map((entry) => entry.page));
    journal.record({
      kind: "fetch-served",
      stage: "fetch",
      data: {
        urls: expectedUrls,
        statuses: pages.map((page) => page.status),
        // rh-v6: the core requested the raw discovery list; the frozen derived inventory is served.
        ...(frozen.sourceDerivation ? { derivedInventory: true, servedUrls: pages.map((page) => page.url) } : {}),
      },
    });
    return pages;
  };
}

export interface CreateForbidLlmsFullArgs {
  journal: Journal;
  /** Shared per-execution latch; see createInputControlLatch(). */
  latch: InputControlLatch;
}

/** Documentation discovery is structurally forbidden in fixed-source replay. */
export function createForbidLlmsFull(args: CreateForbidLlmsFullArgs): ResearchDependencies["downloadLlmsFullToCache"] {
  return async () => {
    // The baseline swallows per-download failures, so the latch is what
    // actually stops later live work (review F2).
    throw deviation(args.latch, args.journal, "llms-full-forbidden", undefined, {
      reason: "documentation discovery is forbidden in fixed-source replay",
    });
  };
}

// ── Final integrity assertion (runner-callable after settlement) ────────────

export interface SettleInputIntegrityArgs {
  frozen: FrozenInputs;
  events: ReadonlyArray<JournalEvent>;
}

export interface InputIntegrity {
  /** True iff no input deviation occurred and no unexpected input was consumed. */
  matched: boolean;
  /** Input-control problems (deviations, unexpected consumed inputs). */
  problems: string[];
  /** True iff the expected execution ran to a completed outcome (F4). */
  complete: boolean;
  /** Execution-completeness problems; ordinary pipeline failures land here, never in `problems`. */
  completenessProblems: string[];
}

const BAD_EVENT_KINDS = new Set([
  "search-mismatch",
  "search-replay-exhausted",
  "extract-hash-mismatch",
  "fetch-mismatch",
  "fetch-options-mismatch",
  "fetch-repeated",
  "cache-suggest-rejected",
  "stage-unclassified",
  "llms-full-forbidden",
  "settings-mismatch",
  "params-mismatch",
  "frozen-inputs-invalid",
  "corpus-digest-mismatch",
]);

/**
 * Pure final assertion over the recorded adapter events. The runner calls
 * this after the run settles; it never performs I/O.
 *
 * Source equality and execution completeness are separate (review F4):
 * - `matched` is false only on actual input deviations (deviation events,
 *   or a consumed input outside the expected multiset). A provider failure,
 *   a degraded outcome or a run that never reached the tool does not make
 *   inputs "changed".
 * - `complete` is true only when the expected execution happened: every
 *   expected extraction input consumed exactly once, exactly one search
 *   replay, one fetch served, and a research-result event with outcome
 *   "completed". Missing execution lands in `completenessProblems`.
 */
export function settleInputIntegrity(args: SettleInputIntegrityArgs): InputIntegrity {
  const problems: string[] = [];
  const completenessProblems: string[] = [];
  const events = args.events;
  const expected = new Map<string, { count: number; first: string }>();
  for (const input of args.frozen.extractionInputs) {
    const key = hashKey(input.systemPromptSha256, input.userMessageSha256);
    const entry = expected.get(key);
    if (entry) entry.count += 1;
    else expected.set(key, { count: 1, first: input.userMessageSha256.slice(0, 16) });
  }
  const consumed = new Map<string, number>();
  let searchReplays = 0;
  let fetches = 0;
  let resultOutcome: string | undefined;
  for (const event of events) {
    if (event.kind === "extract-consumed") {
      const key = hashKey(String(event.data.systemPromptSha256), String(event.data.userMessageSha256));
      consumed.set(key, (consumed.get(key) ?? 0) + 1);
    } else if (event.kind === "search-replayed") {
      searchReplays += 1;
    } else if (event.kind === "fetch-served") {
      fetches += 1;
    } else if (event.kind === "research-result") {
      resultOutcome = String(event.data.outcome);
    } else if (BAD_EVENT_KINDS.has(event.kind)) {
      problems.push(`deviation event ${JSON.stringify(event.kind)} recorded`);
    }
  }
  // Input equality: any consumed input outside the expected multiset is a
  // source mismatch even without a deviation event (defence in depth; the
  // adapter already refuses unknown hashes). Expected-but-unconsumed inputs
  // are an execution gap, not a mismatch.
  for (const [key, got] of consumed) {
    const want = expected.get(key);
    if (!want) {
      problems.push(`unexpected extraction input ${key.split(":")[1].slice(0, 16)} consumed`);
    } else if (got > want.count) {
      problems.push(`extraction input ${want.first} consumed ${got} time(s), expected ${want.count}`);
    }
  }
  // Execution completeness.
  for (const [key, want] of expected) {
    const got = consumed.get(key) ?? 0;
    if (got < want.count) {
      completenessProblems.push(
        `extraction input ${want.first} consumed ${got} time(s), expected ${want.count}`,
      );
    }
  }
  if (searchReplays === 0) completenessProblems.push("the frozen search completion was never replayed");
  else if (searchReplays > 1) completenessProblems.push(`the frozen search completion was replayed ${searchReplays} times`);
  if (fetches === 0) completenessProblems.push("the frozen page set was never served");
  if (resultOutcome === undefined) {
    completenessProblems.push("no research-result event was recorded");
  } else if (resultOutcome !== "completed") {
    completenessProblems.push(`research outcome was ${JSON.stringify(resultOutcome)}, not "completed"`);
  }
  return {
    matched: problems.length === 0,
    problems,
    complete: completenessProblems.length === 0,
    completenessProblems,
  };
}

// ── Corpus acceptance (review F10) ──────────────────────────────────────────

export interface AssertCorpusAcceptableArgs {
  frozen: FrozenInputs;
  /** Minimum readable (status "success") selected pages; protocol floor is 2. */
  minReadable?: number;
}

/**
 * Mechanical corpus-acceptance floor from the Protocol (at least two
 * readable selected pages). Called by the CAPTURE/RUNNER side only: generic
 * replay and parity fixtures deliberately keep negative all-error corpora
 * valid, so this check must not run inside loadFrozenInputs or the adapters.
 */
export function assertCorpusAcceptable(args: AssertCorpusAcceptableArgs): void {
  const minReadable = args.minReadable ?? 2;
  const readable = args.frozen.pages.filter((entry) => entry.page.status === "success").length;
  if (readable < minReadable) {
    throw new FrozenIntegrityError("structure", [
      `corpus acceptance requires at least ${minReadable} readable selected pages; this corpus has ${readable}`,
    ]);
  }
}
