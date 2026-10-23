// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// F7-1 qualification harness: actual native wrappers and the real Codemode
// bridge, recording and replaying multi-research blocks with the recorded
// suggestion read-view controller (scripts/benchmarks/suggestion-replay.ts)
// injected through the restricted native seam. Record and replay share one
// request preparation; the raw requests live in the integrity-pinned F7
// artefact, the transport fixtures hold the canonical F7 representation.
//
// Binding condition N1 (verbatim):
//
//   a transport-replay implementation must never invoke `options.fetch` or
//   any network primitive. It must replay citations only through recorded
//   `onProviderStreamEvent` chunks, or through a declared non-network tee
//   seam if floor-host replay is ever required.
//
// The suggestion library is a digest-pinned, coordinator-owned overlay. This
// file only wires it; it adds no library behaviour. Harness-side records
// (schedule manifest, block manifest, controller probe, host witnesses) are
// evidence, never a substitute for library validity.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import type { IndexCandidate } from "../../src/core/contracts.js";
import type { NativeSuggestionReadView } from "../../src/native-injection.js";
import { selectCandidates } from "../../src/core/run-index.js";
import { NAMESPACE_DIR } from "../../src/core/run-format.js";
import { resolveWorkspacePaths } from "../../src/core/paths.js";
import { asJson, sha256Canonical } from "../../scripts/benchmarks/canonical.js";
import { verifyFixtureFile, fixtureFileSha256 } from "../../scripts/benchmarks/replay-store.js";
import {
  createSuggestionTransportPreparation,
  createSuggestionViewRecorder,
  createSuggestionViewReplay,
  suggestionArtefactSha256,
  verifySuggestionArtefact,
  type SuggestionBaselineEntry,
  type SuggestionProjectionViewIdentity,
  type SuggestionViewArtefact,
  type SuggestionViewError,
  type SuggestionViewRecorder,
  type SuggestionFixtureFileRef,
  type SuggestionViewReplay,
  type SuggestionViewSession,
  type SuggestionWorkflowOperation,
} from "../../scripts/benchmarks/suggestion-replay.js";
import {
  REPO_ROOT,
  contentModelResolver,
  createRecording,
  createReplayBlock,
  syntheticPage,
  type FixtureFile,
  type Recording,
  type ReplayBlock,
  type StageReply,
  type StageScript,
  type SyntheticPage,
} from "./native-replay.js";

// ── Corpus pin ──────────────────────────────────────────────────────────────

export const CORPUS_PATH = "docs/benchmarks/corpus/codemode.json";
export const CORPUS_ITEM = "CM-D02";
export const PAGES_PER_QUERY = 4;

export interface CorpusShape {
  readonly item: string;
  readonly sha256: string;
  /** The item's top-level task query (used as the declared collate producer's query). */
  readonly query: string;
  readonly focusPrompt: string;
  readonly workflowQueries: readonly string[];
}

const fileSha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * The frozen development workflow shape: CM-D02's exact workflowQueries and
 * focusPrompt, with the corpus bytes checked against the accepted
 * specification digest. Pages are synthetic; no corpus domain is contacted.
 */
export async function loadCorpusShape(): Promise<CorpusShape> {
  const bytes = await readFile(join(REPO_ROOT, CORPUS_PATH));
  const acceptance = JSON.parse(
    await readFile(join(REPO_ROOT, "docs/plans/codemode/acceptance.json"), "utf8"),
  ) as { specificationFiles: Array<{ path: string; sha256: string }> };
  const pinned = acceptance.specificationFiles.find((file) => file.path === CORPUS_PATH)?.sha256;
  const actual = fileSha256(bytes);
  if (pinned !== actual) throw new Error(`${CORPUS_PATH} digest ${actual} differs from accepted ${pinned}`);
  const item = (
    JSON.parse(bytes.toString("utf8")) as {
      queries: Array<{ id: string; query: string; focusPrompt: string; workflowQueries: string[] }>;
    }
  ).queries.find((query) => query.id === CORPUS_ITEM);
  if (!item || item.workflowQueries.length !== 3)
    throw new Error(`${CORPUS_ITEM} must declare three workflowQueries`);
  return {
    item: CORPUS_ITEM,
    sha256: actual,
    query: item.query,
    focusPrompt: item.focusPrompt,
    workflowQueries: item.workflowQueries,
  };
}

// ── Schedule manifest ───────────────────────────────────────────────────────

export interface F7ScheduleManifest {
  readonly version: "f7-qualification-schedule/1";
  readonly amendment: "F7-1";
  readonly corpusItem: string;
  readonly corpusSha256: string;
  readonly block: string;
  readonly kind: "serial" | "parallel";
  readonly initialState: "empty" | "seeded";
  /**
   * Groups execute serially; operations inside one group are started
   * concurrently and are genuinely overlapping. Group membership is frozen;
   * intra-group start order is a recorded run variable (see startOrder).
   */
  readonly groups: readonly (readonly string[])[];
  /** Every report producer, with an explicit kind (research reads; collate never reads). */
  readonly operations: readonly (SuggestionWorkflowOperation & { readonly kind: "research" | "collate" })[];
  readonly arguments: { readonly maxUrls: number; readonly focusPrompt: string };
}

export function scheduleSha256(schedule: F7ScheduleManifest): string {
  return sha256Canonical(schedule);
}

export function workflowOf(schedule: F7ScheduleManifest): readonly SuggestionWorkflowOperation[] {
  return schedule.operations.map((op) => ({ ...op }));
}

export function defineSchedule(input: {
  readonly corpus: CorpusShape;
  readonly block: string;
  readonly initialState: F7ScheduleManifest["initialState"];
  /**
   * Each group lists [node, workflow query index] for research, or
   * [node, "collate"] for a direct collation of the item's task query;
   * groups run serially.
   */
  readonly groups: ReadonlyArray<ReadonlyArray<readonly [string, number | "collate"]>>;
}): F7ScheduleManifest {
  const seen = new Map<string, number>();
  const operations: F7ScheduleManifest["operations"][number][] = [];
  for (const group of input.groups)
    for (const [node, index] of group) {
      const query = index === "collate" ? input.corpus.query : input.corpus.workflowQueries[index];
      if (query === undefined) throw new Error(`workflow query ${index} is not declared`);
      const occurrence = (seen.get(query) ?? 0) + 1;
      seen.set(query, occurrence);
      operations.push({ node, query, occurrence, kind: index === "collate" ? "collate" : "research" });
    }
  return {
    version: "f7-qualification-schedule/1",
    amendment: "F7-1",
    corpusItem: input.corpus.item,
    corpusSha256: input.corpus.sha256,
    block: input.block,
    kind: input.groups.some((group) => group.length > 1) ? "parallel" : "serial",
    initialState: input.initialState,
    groups: input.groups.map((group) => group.map(([node]) => node)),
    operations,
    arguments: { maxUrls: PAGES_PER_QUERY, focusPrompt: input.corpus.focusPrompt },
  };
}

/** Intra-group start order per group (node lists); defaults to declared order. */
export type StartOrder = readonly (readonly string[])[];

/**
 * The forced Codemode script for a schedule. A one-member group awaits one
 * research; a larger group starts every member before awaiting any.
 */
export function codemodeScript(
  schedule: F7ScheduleManifest,
  options: { readonly timeoutMs?: number; readonly startOrder?: StartOrder } = {},
): { readonly script: string; readonly sha256: string; readonly startOrder: StartOrder } {
  const startOrder = options.startOrder ?? schedule.groups;
  if (
    startOrder.length !== schedule.groups.length ||
    startOrder.some(
      (group, index) =>
        group.length !== schedule.groups[index]!.length ||
        [...group].sort().join("\u0000") !== [...schedule.groups[index]!].sort().join("\u0000"),
    )
  )
    throw new Error("startOrder must permute each frozen group without changing membership");
  const byNode = new Map(schedule.operations.map((op) => [op.node, op]));
  const call = (node: string) => {
    const op = byNode.get(node)!;
    return op.kind === "collate"
      ? `tools.intelli_collate(${JSON.stringify({ query: op.query, extractions: collateExtractions(op.query) })})`
      : `tools.intelli_research(${JSON.stringify({
          query: op.query,
          maxUrls: schedule.arguments.maxUrls,
          focusPrompt: schedule.arguments.focusPrompt,
        })})`;
  };
  const lines = [`// @options: {"timeout_ms": ${options.timeoutMs ?? 120000}}`, "const out = [];"];
  for (const group of startOrder)
    lines.push(
      group.length === 1
        ? `out.push(await ${call(group[0]!)});`
        : `out.push(...(await Promise.all([${group.map(call).join(", ")}])));`,
    );
  lines.push(
    'return JSON.stringify(out.map((text) => ({ chars: text.length, related: text.includes("Related cached") })));',
  );
  const script = lines.join("\n");
  return { script, sha256: fileSha256(script), startOrder };
}

/** Fixed caller-supplied extractions for a declared collate producer. */
export function collateExtractions(query: string) {
  return [1, 2].map((n) => ({
    url: `https://collate.example.test/doc/${n}`,
    title: `Collate source ${n}`,
    extraction: `Supplied evidence ${n} for: ${query}`,
    sourceType: "official-docs",
    status: "success",
  }));
}

// ── Synthetic pages and stage script ────────────────────────────────────────

export const hostOf = (queryIndex: number) => `q${queryIndex + 1}.example.test`;

/** Four synthetic pages per workflow query, on a distinct host per query. */
export function f7Pages(corpus: CorpusShape): Map<string, SyntheticPage> {
  const pages = new Map<string, SyntheticPage>();
  corpus.workflowQueries.forEach((query, index) => {
    for (let page = 1; page <= PAGES_PER_QUERY; page++)
      pages.set(
        `https://${hostOf(index)}/doc/p${page}`,
        syntheticPage(`Q${index + 1}P${page}`, `Angle ${index + 1} fact ${page} for: ${query}`),
      );
  });
  return pages;
}

const usage = (prompt: number, completion: number) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
});

export interface StageControls {
  /** Hold a research's collate response (recording only) until the promise settles. */
  readonly holdCollate?: (query: string) => Promise<unknown> | undefined;
  /** Observes each suggest request's current query. */
  readonly onSuggest?: (query: string) => void;
  /**
   * Replaces the reply for one stage call (for example a scripted 429 on a
   * first attempt). `n` counts calls per role, as the stage fixture does.
   */
  readonly override?: (call: { readonly role: string; readonly user: string; readonly n: number }) => StageReply | undefined;
}

/** Deterministic loopback stage replies keyed by exact workflow query text. */
export function f7StageScript(corpus: CorpusShape, controls: StageControls = {}): StageScript {
  const queryIn = (text: string) => {
    const hits = corpus.workflowQueries.filter((query) => text.includes(query));
    if (hits.length !== 1) throw new Error(`stage request names ${hits.length} workflow queries`);
    return hits[0]!;
  };
  return ({ role, user, n }): StageReply => {
    const replaced = controls.override?.({ role, user, n });
    if (replaced) return replaced;
    switch (role) {
      case "search": {
        const index = corpus.workflowQueries.indexOf(queryIn(user));
        const links = Array.from(
          { length: PAGES_PER_QUERY },
          (_, page) => `[Doc ${page + 1}](https://${hostOf(index)}/doc/p${page + 1})`,
        );
        return { text: `Sources: ${links.join(", ")}.`, usage: usage(60, 14) };
      }
      case "extract": {
        const marker = /PAGE-MARKER:([A-Za-z0-9-]+)/.exec(user)?.[1] ?? "unknown";
        return { text: `Official docs, current.\nEvidence ${marker}.`, usage: usage(200, 18) };
      }
      case "collate": {
        if (user.includes(JSON.stringify(corpus.query)) && !corpus.workflowQueries.some((q) => user.includes(q)))
          return { text: "Direct collation synthesis [S1].", usage: usage(110, 12) };
        const query = queryIn(user);
        const index = corpus.workflowQueries.indexOf(query);
        const hold = controls.holdCollate?.(query);
        return {
          text: `Angle ${index + 1} synthesis [S1].`,
          usage: usage(150, 16),
          ...(hold ? { after: hold } : {}),
        };
      }
      case "suggest": {
        const current = /^Current query: "([^"]*)"/.exec(user)?.[1] ?? "";
        controls.onSuggest?.(current);
        return {
          text: '[{"index":1,"relevance":"adjacent angle of the same workflow"}]',
          usage: usage(80, 12),
        };
      }
    }
  };
}

// ── Baseline: the real verified reader on the pinned initial state ──────────

/**
 * Calls the production `selectCandidates()` (the function RunStore.candidates
 * delegates to) on the initial tree with a compatibility key that excludes
 * nothing. It reads only; callers digest the tree before and after.
 */
export async function readBaseline(
  workspace: string,
  cacheDir = ".search",
): Promise<{ readonly displayRoot: string; readonly baseline: readonly SuggestionBaselineEntry[]; readonly diagnostics: readonly string[] }> {
  const paths = resolveWorkspacePaths(workspace, cacheDir);
  const diagnostics: string[] = [];
  const rows = await selectCandidates({
    cacheRoot: paths.cacheRoot,
    displayRoot: paths.cacheDisplayRoot,
    namespaceDir: join(paths.cacheRoot, NAMESPACE_DIR),
    currentKey: "f7-baseline-excludes-no-key",
    signal: new AbortController().signal,
    onDiagnostic: (diagnostic) => diagnostics.push(`${diagnostic.code}: ${diagnostic.message}`),
  });
  return {
    displayRoot: paths.cacheDisplayRoot,
    baseline: rows.map((row) => ({
      query: row.query,
      reportPath: row.reportPath,
      namespace: row.namespace,
      startedUtc: row.startedUtc,
      compatibilityKey: row.compatibilityKey,
      ...(row.admissionSequence !== undefined ? { admissionSequence: row.admissionSequence } : {}),
    })),
    diagnostics,
  };
}

// ── Controller probe ────────────────────────────────────────────────────────

export type ProbeEvent =
  | { readonly seq: number; readonly kind: "allocated"; readonly operationId: string; readonly query: string; readonly runId: string; readonly displayPath: string; readonly sequence: number }
  | { readonly seq: number; readonly kind: "indexed"; readonly operationId: string; readonly runId: string }
  | { readonly seq: number; readonly kind: "unavailable"; readonly operationId: string; readonly query: string; readonly phase: string }
  | { readonly seq: number; readonly kind: "candidates-enter"; readonly operationId: string; readonly query: string }
  | { readonly seq: number; readonly kind: "read"; readonly operationId: string; readonly rows: readonly string[] }
  | { readonly seq: number; readonly kind: "candidates-exit"; readonly operationId: string; readonly selected: readonly string[] | null; readonly error: string | null }
  | { readonly seq: number; readonly kind: "notification-threw"; readonly operationId: string; readonly notification: string; readonly error: string };

type ProbeEventInput = ProbeEvent extends infer E ? (E extends ProbeEvent ? Omit<E, "seq"> : never) : never;

export interface ControllerProbe {
  /** Plain object handed to createNativeExtension (captured at factory time). */
  readonly controller: NativeSuggestionReadView;
  readonly log: ProbeEvent[];
  inFlight(): { readonly callbacks: number; readonly reads: number };
}

export interface ProbeHooks {
  /** Runs synchronously when a candidate read starts (for example to schedule an abort). */
  readonly onCandidatesEnter?: (input: { readonly operationId: string; readonly query: string }) => void;
  /** Throws a plain error from a notification AFTER delegating (containment proof). */
  readonly throwAfter?: (notification: "allocated" | "indexed" | "unavailable") => boolean;
}

/**
 * Observation wrapper around a library controller. It delegates every call
 * unchanged and returns the library's exact results, including the exact
 * reader array references, so the native membership check still applies to
 * the real reader output. It records order, in-flight counts and any
 * exception a notification propagated to the native adapter.
 */
export function probeController(inner: NativeSuggestionReadView, hooks: ProbeHooks = {}): ControllerProbe {
  const log: ProbeEvent[] = [];
  let callbacks = 0;
  let reads = 0;
  const push = (event: ProbeEventInput) => log.push({ seq: log.length + 1, ...event } as ProbeEvent);
  const notification = <K extends "allocated" | "indexed" | "unavailable">(
    name: K,
    record: (input: Parameters<NativeSuggestionReadView[K]>[0]) => void,
  ) =>
    (input: Parameters<NativeSuggestionReadView[K]>[0]) => {
      callbacks++;
      try {
        record(input);
        try {
          (inner[name] as (value: typeof input) => void)(input);
        } catch (error) {
          push({ kind: "notification-threw", operationId: input.operationId, notification: name, error: String(error) });
          throw error;
        }
        if (hooks.throwAfter?.(name)) {
          const error = new Error(`probe: injected ${name} notification exception`);
          push({ kind: "notification-threw", operationId: input.operationId, notification: name, error: String(error) });
          throw error;
        }
      } finally {
        callbacks--;
      }
    };
  const controller: NativeSuggestionReadView = {
    allocated: notification("allocated", (input) =>
      push({
        kind: "allocated",
        operationId: input.operationId,
        query: input.query,
        runId: input.reservation.runId,
        displayPath: input.reservation.displayPath,
        sequence: input.reservation.sequence,
      }),
    ),
    indexed: notification("indexed", (input) =>
      push({ kind: "indexed", operationId: input.operationId, runId: input.run.reservation.runId }),
    ),
    unavailable: notification("unavailable", (input) =>
      push({ kind: "unavailable", operationId: input.operationId, query: input.query, phase: input.phase }),
    ),
    async candidates(input) {
      callbacks++;
      push({ kind: "candidates-enter", operationId: input.operationId, query: input.query });
      hooks.onCandidatesEnter?.({ operationId: input.operationId, query: input.query });
      try {
        const selected = await inner.candidates({
          ...input,
          readVerified: async () => {
            reads++;
            try {
              const rows = await input.readVerified();
              push({ kind: "read", operationId: input.operationId, rows: rows.map((row) => row.reportPath) });
              return rows;
            } finally {
              reads--;
            }
          },
        });
        push({
          kind: "candidates-exit",
          operationId: input.operationId,
          selected: selected.map((row: IndexCandidate) => row.reportPath),
          error: null,
        });
        return selected;
      } catch (error) {
        push({ kind: "candidates-exit", operationId: input.operationId, selected: null, error: String(error) });
        throw error;
      } finally {
        callbacks--;
      }
    },
  };
  return { controller, log, inFlight: () => ({ callbacks, reads }) };
}

/** Maps a report path to its logical producer node (block-local) or `baseline`. */
export function originLabeller(probe: ControllerProbe, artefactOrWorkflow: {
  readonly workflow: readonly SuggestionWorkflowOperation[];
}): (reportPath: string) => string {
  return (reportPath) => {
    const allocations = probe.log.filter(
      (event): event is Extract<ProbeEvent, { kind: "allocated" }> => event.kind === "allocated",
    );
    const owner = allocations.find((event) => reportPath.includes(`/${event.runId}/`));
    if (!owner) return "baseline";
    // Serial repeats share a query: bind by allocation rank within the query.
    const sameQuery = allocations.filter((event) => event.query === owner.query);
    const rank = sameQuery.indexOf(owner) + 1;
    return (
      artefactOrWorkflow.workflow.find((op) => op.query === owner.query && op.occurrence === rank)?.node ??
      `unknown:${owner.runId}`
    );
  };
}

// ── Host settled witnesses ──────────────────────────────────────────────────

export interface HostWitnessRecord {
  readonly toolCallId: string;
  readonly query: string | null;
  readonly operationId: string | null;
  readonly isError: boolean;
  readonly cache: unknown;
  readonly toolName: string;
  /** Witnesses reported to the library, in order. */
  readonly reported: readonly ("failed-before-allocation" | "commit-succeeded" | "settled")[];
  readonly probeSeqAtEnd: number;
  readonly error: string | null;
}

/**
 * Correlates the real host's tool_execution_start/end events for nested and
 * direct report producers (intelli_research, intelli_collate) to the exact
 * query and native operation id. Each end event is the actual host settled
 * witness: `failed-before-allocation` when the operation never touched the
 * store, otherwise `commit-succeeded` (index failure after commit) and then
 * `settled`. Nothing else (reads, preparation, indexing, the settle-time
 * `operation` phase) is ever reported as settlement.
 */
export function createHostWitnessBinder(session: SuggestionViewSession, probe: ControllerProbe) {
  const queries = new Map<string, string | null>();
  const records: HostWitnessRecord[] = [];
  const onToolEvent = (event: Record<string, unknown>) => {
    if (event.toolName !== "intelli_research" && event.toolName !== "intelli_collate") return;
    const toolCallId = String(event.toolCallId);
    if (event.type === "tool_execution_start") {
      const query = (event.args as { query?: unknown } | undefined)?.query;
      queries.set(toolCallId, typeof query === "string" ? query : null);
      return;
    }
    if (event.type !== "tool_execution_end") return;
    const query = queries.get(toolCallId) ?? null;
    const data = ((event.result as { details?: { intelli?: Record<string, unknown> } } | undefined)?.details
      ?.intelli ?? {}) as { operationId?: unknown; cache?: { status?: unknown; index?: unknown } };
    const operationId = typeof data.operationId === "string" ? data.operationId : null;
    const touched = operationId !== null &&
      probe.log.some((entry) => "operationId" in entry && entry.operationId === operationId &&
        (entry.kind === "allocated" || entry.kind === "unavailable"));
    const reported: Array<"failed-before-allocation" | "commit-succeeded" | "settled"> = !touched
      ? ["failed-before-allocation"]
      : data.cache?.status === "committed" && data.cache?.index === "unavailable"
        ? ["commit-succeeded", "settled"]
        : ["settled"];
    let error: string | null = null;
    if (query !== null)
      for (const outcome of reported)
        try {
          session.reportHostWitness({
            query,
            ...(touched && operationId ? { operationId } : {}),
            outcome,
          });
        } catch (caught) {
          error ??= String(caught);
        }
    records.push({
      toolName: String(event.toolName),
      toolCallId,
      query,
      operationId,
      isError: event.isError === true,
      cache: data.cache ?? null,
      reported,
      probeSeqAtEnd: probe.log.length,
      error,
    });
  };
  return { onToolEvent, records };
}

// ── Block files and manifest ────────────────────────────────────────────────

export interface F7BlockManifest {
  readonly version: "f7-qualification-block/1";
  readonly schedule: F7ScheduleManifest;
  readonly scheduleSha256: string;
  readonly record: { readonly scriptSha256: string; readonly startOrder: StartOrder };
  readonly initialTreeDigest: string;
  readonly files: Readonly<Record<"model" | "fetch" | "suggestion", { readonly name: string; readonly bytesSha256: string }>>;
  /** Verified canonical digests (fixtureFileSha256 / suggestionArtefactSha256). */
  readonly canonical: Readonly<Record<"model" | "fetch" | "suggestion", string>>;
  readonly overlay: Readonly<Record<string, string>>;
}

export const OVERLAY_FILES = [
  "scripts/benchmarks/suggestion-replay.ts",
  "scripts/benchmarks/transport-replay.ts",
] as const;

export async function overlayDigests(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of OVERLAY_FILES) out[path] = fileSha256(await readFile(join(REPO_ROOT, path)));
  return out;
}

/**
 * Writes the final fixture files and artefact, then a harness manifest that
 * binds schedule, initial tree, final file bytes and overlay digests. The
 * artefact itself carries the schedule digest and the record-once final
 * fixture binding; the manifest is an independent byte-level cross-check.
 */
export async function saveF7Block(input: {
  readonly dir: string;
  readonly schedule: F7ScheduleManifest;
  readonly record: F7BlockManifest["record"];
  readonly initialTreeDigest: string;
  readonly files: { readonly model: FixtureFile; readonly fetch: FixtureFile };
  readonly artefact: SuggestionViewArtefact;
}): Promise<F7BlockManifest> {
  await mkdir(input.dir, { recursive: true });
  const write = async (name: string, value: unknown) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(join(input.dir, name), text);
    return { name, bytesSha256: fileSha256(text) };
  };
  verifyFixtureFile(input.files.model);
  verifyFixtureFile(input.files.fetch);
  verifySuggestionArtefact(input.artefact);
  const manifest: F7BlockManifest = {
    version: "f7-qualification-block/1",
    schedule: input.schedule,
    scheduleSha256: scheduleSha256(input.schedule),
    record: input.record,
    initialTreeDigest: input.initialTreeDigest,
    files: {
      model: await write("model.json", input.files.model),
      fetch: await write("fetch.json", input.files.fetch),
      suggestion: await write("suggestion-view.json", input.artefact),
    },
    canonical: {
      model: fixtureFileSha256(input.files.model),
      fetch: fixtureFileSha256(input.files.fetch),
      suggestion: suggestionArtefactSha256(input.artefact),
    },
    overlay: await overlayDigests(),
  };
  await writeFile(join(input.dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Final transport fixture binding: whole-file digests of the verified fixture files. */
export function fixtureFileRefs(files: {
  readonly model: FixtureFile;
  readonly fetch: FixtureFile;
}): readonly SuggestionFixtureFileRef[] {
  return [
    { name: "model.json", sha256: fixtureFileSha256(files.model) },
    { name: "fetch.json", sha256: fixtureFileSha256(files.fetch) },
  ];
}

export interface LoadedF7Block {
  readonly manifest: F7BlockManifest;
  readonly files: { readonly model: FixtureFile; readonly fetch: FixtureFile };
  readonly artefact: SuggestionViewArtefact;
}

export class F7BlockIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "F7BlockIntegrityError";
  }
}

/**
 * Synchronous fail-closed load (usable from a host-loaded wrapper): every
 * file's bytes must match the manifest, the schedule digest must recompute,
 * and the fixture files and artefact must pass the library verifiers.
 */
export function loadF7BlockSync(dir: string): LoadedF7Block {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as F7BlockManifest;
  if (manifest.version !== "f7-qualification-block/1") throw new F7BlockIntegrityError("unknown block manifest");
  if (scheduleSha256(manifest.schedule) !== manifest.scheduleSha256)
    throw new F7BlockIntegrityError("schedule manifest digest mismatch");
  const read = (key: "model" | "fetch" | "suggestion") => {
    const text = readFileSync(join(dir, manifest.files[key].name), "utf8");
    if (fileSha256(text) !== manifest.files[key].bytesSha256)
      throw new F7BlockIntegrityError(`${manifest.files[key].name} bytes differ from the block manifest`);
    return JSON.parse(text) as unknown;
  };
  const model = read("model") as FixtureFile;
  const fetch = read("fetch") as FixtureFile;
  const artefact = read("suggestion") as SuggestionViewArtefact;
  verifyFixtureFile(model);
  verifyFixtureFile(fetch);
  if (fixtureFileSha256(model) !== manifest.canonical.model || fixtureFileSha256(fetch) !== manifest.canonical.fetch)
    throw new F7BlockIntegrityError("fixture canonical digest mismatch");
  if (suggestionArtefactSha256(artefact) !== manifest.canonical.suggestion)
    throw new F7BlockIntegrityError("suggestion artefact digest mismatch");
  const workflow = canonicalOf(artefact.workflow);
  if (workflow !== canonicalOf(workflowOf(manifest.schedule)))
    throw new F7BlockIntegrityError("artefact workflow differs from the frozen schedule");
  if (artefact.initialTreeDigest !== manifest.initialTreeDigest)
    throw new F7BlockIntegrityError("artefact initial tree digest differs from the block manifest");
  if (artefact.scheduleManifestSha256 !== manifest.scheduleSha256)
    throw new F7BlockIntegrityError("artefact schedule digest differs from the block manifest");
  if (canonicalOf([...artefact.fixtureFiles].sort((x, y) => x.name.localeCompare(y.name))) !==
      canonicalOf([...fixtureFileRefs({ model, fetch })].sort((x, y) => x.name.localeCompare(y.name))))
    throw new F7BlockIntegrityError("artefact final fixture binding differs from the actual fixture files");
  return { manifest, files: { model, fetch }, artefact };
}

const canonicalOf = (value: unknown) => sha256Canonical(asJson(value));

// ── Record and replay drivers ───────────────────────────────────────────────

export interface F7RecordingDriver {
  readonly session: SuggestionViewRecorder;
  readonly probe: ControllerProbe;
  readonly recording: Recording;
  readonly faults: SuggestionViewError[];
  readonly witnesses: ReturnType<typeof createHostWitnessBinder>;
}

export function createF7Recording(input: {
  readonly scenario: string;
  readonly schedule: F7ScheduleManifest;
  readonly baseline: readonly SuggestionBaselineEntry[];
  readonly displayRoot: string;
  readonly initialTreeDigest: string;
  readonly pages: ReadonlyMap<string, SyntheticPage>;
}): F7RecordingDriver {
  const faults: SuggestionViewError[] = [];
  const session = createSuggestionViewRecorder({
    scenario: input.scenario,
    block: input.schedule.block,
    scheduleManifestSha256: scheduleSha256(input.schedule),
    workflow: workflowOf(input.schedule),
    baseline: input.baseline,
    displayRoot: input.displayRoot,
    initialTreeDigest: input.initialTreeDigest,
    onInvalid: (error) => {
      faults.push(error);
    },
  });
  const probe = probeController(session.controller);
  const prepare = createSuggestionTransportPreparation({ session, resolveNode: contentModelResolver });
  const recording = createRecording(input.scenario, input.pages, { prepare });
  return { session, probe, recording, faults, witnesses: createHostWitnessBinder(session, probe) };
}

export interface F7ReplayDriver {
  readonly session: SuggestionViewReplay;
  readonly probe: ControllerProbe;
  readonly block: ReplayBlock;
  readonly faults: SuggestionViewError[];
  readonly witnesses: ReturnType<typeof createHostWitnessBinder>;
  /** Installs the block-stop action; faults and fixture misses call it. */
  setStop(stop: () => void): void;
}

export function createF7Replay(input: {
  readonly loaded: LoadedF7Block;
  readonly budgetMs: number;
  readonly expectedInitialTreeDigest: string;
  readonly pageDelayMs?: (url: string) => number;
  readonly modelDelayMs?: (context: Context) => number;
  readonly probeHooks?: ProbeHooks;
  /** Negative proof only: derive suggestion nodes differently from recording. */
  readonly suggestNode?: (view: SuggestionProjectionViewIdentity) => string;
}): F7ReplayDriver {
  const faults: SuggestionViewError[] = [];
  let stop: () => void = () => {};
  const session = createSuggestionViewReplay({
    artefact: input.loaded.artefact,
    displayRoot: input.loaded.artefact.displayRoot,
    budgetMs: input.budgetMs,
    expectedInitialTreeDigest: input.expectedInitialTreeDigest,
    expectedScheduleManifestSha256: input.loaded.manifest.scheduleSha256,
    // The actual files this replay serves, digested from the loaded bytes.
    expectedFixtureFiles: fixtureFileRefs(input.loaded.files),
    onInvalid: (error) => {
      faults.push(error);
      stop();
    },
  });
  const probe = probeController(session.controller, input.probeHooks);
  const prepare = createSuggestionTransportPreparation({
    session,
    resolveNode: contentModelResolver,
    ...(input.suggestNode ? { suggestNode: input.suggestNode } : {}),
  });
  const block = createReplayBlock(input.loaded.files, {
    prepare,
    ...(input.pageDelayMs ? { pageDelayMs: input.pageDelayMs } : {}),
    ...(input.modelDelayMs ? { modelDelayMs: input.modelDelayMs } : {}),
  });
  block.onMiss(() => stop());
  return {
    session,
    probe,
    block,
    faults,
    witnesses: createHostWitnessBinder(session, probe),
    setStop(next) {
      stop = next;
    },
  };
}
