// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Synthetic, coordinator-facing fixtures for the fixed-source research-handoff
// study (Track A). Everything here is deterministic and credential-free: no
// network, no paid calls. The runner and the coordinator's integration script
// build synthetic frozen corpora, delegates and host-context mocks from these
// helpers so every consumer shares one fixture shape.

import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleFrozenInputs } from "../../scripts/research-handoff/common-inputs.js";
import {
  studySettings,
  studyParams,
  BASELINE_COMMIT,
  PROTOCOL_REVISION,
} from "../../scripts/research-handoff/config.js";
import type { FrozenInputs, Journal, JournalEvent } from "../../scripts/research-handoff/contracts.js";
import type { FetchedPage, ResearchSettings } from "../../src/core/types.js";
import type { ModelCompletion, ResearchParams } from "../../src/core/contracts.js";
import type { fetchPages } from "../../src/core/fetch.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
} from "../../src/core/prompts.js";
import type { callLlm } from "../../src/llm.js";

/** Fixed capture metadata: determinism matters more than wall-clock realism here. */
export const SYNTHETIC_CAPTURE_META = {
  capturedAt: "2026-11-04T12:00:00.000Z",
  coreCommit: BASELINE_COMMIT,
  protocolRef: PROTOCOL_REVISION,
} as const;

/**
 * Six synthetic pages matching the study's six-source cap, alternating between
 * the two approved study domains. The bodies are deliberately placeholder
 * text: they contain no real setup instructions and no answer hints, so a
 * synthetic replay can never be mistaken for study evidence.
 */
export function syntheticPages(count = 6, opts: { duplicateContent?: boolean } = {}): FetchedPage[] {
  return Array.from({ length: count }, (_, i) => {
    const host = i % 2 === 0 ? "developers.cloudflare.com" : "pi.dev";
    const url = `https://${host}/synthetic-page-${i + 1}`;
    const content = opts.duplicateContent
      ? "SYNTHETIC_IDENTICAL_BODY: shared placeholder body used to exercise the repeated-identical-message multiset rule; no real setup instructions."
      : `SYNTHETIC_PAGE_${i + 1}: placeholder body for pipeline coverage only; it contains no real configuration, credentials or setup instructions.`.repeat(
            3,
          );
    return {
      url,
      title: `Synthetic Page ${i + 1}`,
      content,
      status: "success" as const,
      source: "markdown",
    };
  });
}

/** A synthetic search completion whose prose links select exactly `pages`, in order. */
export function syntheticSearchCompletion(pages: FetchedPage[]): ModelCompletion {
  return {
    text: pages.map((page) => `[${page.title}](${page.url})`).join(" "),
    citations: [],
  };
}

export interface BuildSyntheticCorpusArgs {
  settings?: Partial<ResearchSettings>;
  params?: ResearchParams;
  pages?: FetchedPage[];
  searchCompletion?: ModelCompletion;
}

export interface SyntheticCorpus {
  frozen: FrozenInputs;
  settings: ResearchSettings;
  params: ResearchParams;
  pages: FetchedPage[];
  completion: ModelCompletion;
}

export async function buildSyntheticCorpus(args: BuildSyntheticCorpusArgs = {}): Promise<SyntheticCorpus> {
  const settings: ResearchSettings = { ...studySettings(), ...args.settings };
  const params = args.params ?? studyParams();
  const pages = args.pages ?? syntheticPages();
  const completion = args.searchCompletion ?? syntheticSearchCompletion(pages);
  const frozen = await assembleFrozenInputs({
    params,
    settings,
    searchCompletion: completion,
    searchAttempts: 1,
    pages,
    meta: { ...SYNTHETIC_CAPTURE_META },
  });
  return { frozen, settings, params, pages, completion };
}

/** Write a frozen corpus to disk and return its path (outside any run workspace). */
export function writeFrozenFile(frozen: FrozenInputs): string {
  const dir = mkdtempSync(join(tmpdir(), "rh-frozen-"));
  const path = join(dir, "frozen-inputs.json");
  writeFileSync(path, JSON.stringify(frozen, null, 2));
  return path;
}

/** In-memory journal sink; the recorder owns persistence. */
export function arrayJournal(): { events: JournalEvent[]; journal: Journal } {
  const events: JournalEvent[] = [];
  return { events, journal: { record: (event) => { events.push(event); } } };
}

export interface SyntheticDelegateCall {
  systemPrompt: string;
  userMessage: string;
}

/**
 * Deterministic downstream transport for parity and adapter tests: the search
 * role replays the capture text; extract and collate return fixed synthetic
 * completions. `calls` records every invocation so tests can assert zero
 * live delegation on fail-closed paths.
 */
export function syntheticCallLlmDelegate(args: {
  frozen: FrozenInputs;
  calls?: SyntheticDelegateCall[];
}): typeof callLlm {
  return (async (_ctx, _config, systemPrompt, userMessage) => {
    args.calls?.push({ systemPrompt, userMessage });
    if (systemPrompt === SEARCH_SYSTEM_PROMPT) return args.frozen.capture.completion.text;
    if (systemPrompt === EXTRACTION_SYSTEM_PROMPT) {
      return "official docs, current\nSynthetic extraction of the supplied placeholder page: no real setup instructions.";
    }
    if (systemPrompt === COLLATION_SYSTEM_PROMPT) {
      // Cite only an evidence URL: the baseline's provenance validation
      // rejects any prose URL absent from the supplied extractions.
      const evidence = args.frozen.extractionInputs[0] ?? args.frozen.capture.selectedSources[0];
      return `Synthetic synthesis covering the supplied sources ([evidence](${evidence.url})).`;
    }
    throw new Error(`synthetic delegate: unexpected system prompt (length ${systemPrompt.length})`);
  }) as typeof callLlm;
}

/** Mock ExtensionContext for native-context assembly without a host session. */
export function mockExtensionContext(args: { cwd: string; settings?: ResearchSettings }) {
  const known = new Set<string>();
  for (const config of [args.settings?.searchModel, args.settings?.extractModel, args.settings?.collateModel]) {
    if (config) known.add(`${config.provider}/${config.model}`);
  }
  return {
    cwd: args.cwd,
    isProjectTrusted: () => false,
    modelRegistry: {
      find: (provider: string, model: string) =>
        known.has(`${provider}/${model}`) ? { id: model, provider } : undefined,
    },
    // The native wrapper dereferences ctx.ui for the working indicator; an
    // empty object keeps both arms on the same code path.
    ui: {} as { setWorkingIndicator?(opts?: { frames?: string[]; intervalMs?: number }): void },
  };
}

/**
 * Point PI_CODING_AGENT_DIR at an isolated agent directory whose settings.json
 * carries the full nested study settings, and restore the previous value.
 * Use a fresh directory per test: the settings cache is keyed by agent dir,
 * project dir and trust state.
 */
export function isolateAgentEnv(settings: ResearchSettings): { restore(): void; agentDir: string } {
  const agentDir = mkdtempSync(join(tmpdir(), "rh-agent-"));
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ "pi-intelli-search": settings }, null, 2),
  );
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return {
    restore() {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    },
    agentDir,
  };
}

/**
 * Fetch options shaped exactly as runFetchStage passes them: the settings
 * fingerprint string cast the same way the baseline casts it to the
 * wreq-js BrowserProfile type.
 */
export function fetchOpts(
  settings: ResearchSettings,
  overrides: Record<string, unknown> = {},
): Parameters<typeof fetchPages>[2] {
  return {
    timeoutMs: settings.fetchTimeoutMs,
    browser: settings.browserFingerprint as unknown as NonNullable<
      Parameters<typeof fetchPages>[2]
    >["browser"],
    concurrency: settings.fetchConcurrency,
    ...overrides,
  };
}

/**
 * The only two normalisations the native-parity test is allowed to apply
 * (PROTOCOL forbids arbitrary normalisation; these are documented and narrow):
 * 1. `> Searched: <ISO-8601>` header line in report.md — wall-clock timestamp
 *    written by writeCacheFiles' writeReportFile, which takes no clock
 *    injection.
 * 2. The UTC-date prefix inside `.search/<YYYY-MM-DD>-<slug>` cache directory
 *    names — makeCachePath derives it from the current date, guarding a
 *    cross-midnight test execution.
 */
export function normaliseForParity(text: string): string {
  return text
    .replace(/^> Searched: .*$/gm, "> Searched: <normalised>")
    .replace(/\.search\/\d{4}-\d{2}-\d{2}-/g, ".search/<date>-");
}

/** Locate the single run cache directory under a workspace's `.search` root. */
export function singleCacheDir(workspace: string): string {
  const root = join(workspace, ".search");
  const entries = readdirSync(root).filter((name) => !name.startsWith("."));
  if (entries.length !== 1) {
    throw new Error(`expected exactly one cache directory under ${root}, found ${entries.length}`);
  }
  return join(root, entries[0]);
}
