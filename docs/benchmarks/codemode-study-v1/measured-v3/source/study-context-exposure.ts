// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Offline measurement only. Never imports a provider or invokes a model, and
// reads retained run artefacts without writing to them.
//
// Implements the frozen `contextExposure` definition in
// docs/benchmarks/codemode-study-v1/MEASURED-SERIES.json: characters of
// retrieved page material in actual main-model requests. It is descriptive: not
// an endpoint and never an input to a claim assessment.
//
// The method, in order:
//  1. Page material comes from captured identities: intelli_fetch content, then
//     cached full pages. A source with neither takes another event's text for the
//     same URL (URL substitution, counted in diagnostics). A raw transport body is
//     not the text the tool returned, so a source resolved only that way makes the
//     record incomplete; the body still contributes to the observed lower bound.
//  2. Every text item of every actual request is assigned one channel.
//  3. Delivery gate: an item counts only against material whose retrieving call has
//     its output at or before that item in the request. The gate holds per URL, not
//     per retrieval: every call naming a URL can open that URL's material. Attaching
//     a later call cannot open it earlier than the call that retrieved it.
//  4. Each item is matched tolerantly against wire encoding and whitespace, and
//     every position of an item is counted at most once. Sending the same text in
//     another request, or twice in one request, counts again. Requests are cumulative,
//     so a per-run total grows with the number of requests.
//  5. Spans are measured in original page characters, so a JSON-escaped copy and a
//     plain copy of one page have the same size.
//  6. A span shorter than the ceiling and below the page share is a short exact
//     page-text run; any other span is a whole-page or long run. The record keeps the
//     compatibility names `quotation` and `wholePage` for these two classes. They name
//     sizes only: nothing judges whether an excerpt is justified, or whether it covers
//     a whole page. The limits were chosen post hoc. Every span is retained without
//     its text, so any other limits can be recomputed with `reclassifyExposure`.
//
// `issues` make a record incomplete, which nulls its totals while `observed` keeps the
// lower bound. `notices` and `diagnostics` keep the totals and make unknowns visible.
// A tool outside the measured catalogue is an issue: its output has no captured page
// identity, so a live run that uses one reports incomplete rather than a guess.
//
// Unicode forms are compared as they are, without normalisation. Text in a different
// form from its page still matches except next to each differing character, so it is
// partly undercounted, not missed. `nonNfc*` diagnostics show when this is possible.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const CONTEXT_EXPOSURE_METHOD = "raw-page-characters-v2";
/** Shorter exact runs are treated as coincidence, not as page material. */
export const MINIMUM_SPAN_CHARACTERS = 32;
/**
 * Post-hoc descriptive limits chosen after inspecting retained data. Recompute the
 * classification distribution with reclassifyExposure over the completed series before
 * stating any gap or sensitivity claim. Cite the dataset hash and measured spans rather
 * than embedding a snapshot here: the closest span can move as new runs arrive.
 */
export const QUOTATION_CEILING_CHARACTERS = 1024;
export const QUOTATION_PAGE_SHARE = 0.25;
export const CLASSIFICATION_PROVENANCE = "post-hoc-descriptive";
/** Page text in these places means the totals are wrong, so a complete record must hold none. */
const BLOCKING_GATE_REASONS = ["lostFromHistory", "neverDelivered"] as const;
const BLOCKING_ROLES = ["developer", "system", "instructions", "additionalTools"] as const;
/** The neutral definition of the two classes behind the compatibility field names. */
export const CLASS_DEFINITIONS = {
  quotation: "Short exact page-text run: shorter than the ceiling and below the page share. A size class only; no justification is judged and no quotation claim is made.",
  wholePage: "Whole-page or long run: any other exact run at or above the minimum. It may be a partial page, and retrieved pages can themselves be capped by the tool.",
} as const;

/** Every page position is indexed, so any match of at least this length holds an anchor. */
const ANCHOR_LENGTH = 16;
const MAX_ANCHOR_CANDIDATES = 64;
const SPAN_BUCKETS = [64, 128, 256, 512, 1024, 4096] as const;
const KNOWN_TOOLS = new Set(["codemode", "read", "intelli_fetch", "intelli_search", "intelli_extract", "intelli_collate", "intelli_research"]);
/** Source states that declare a retrieved page. A search candidate was never fetched. */
const RETRIEVED_STATES = new Set(["fetched", "used", "empty"]);
const SPILL_FILE = /(?:^|[\\/])pi-codemode-[0-9a-f]+\.txt$/;
const SPILL_NOTICE = /\[Full output: (.+?) \(read with offset\/limit\)\]/g;
const URL_TOKEN = /https?:\/\/[^\s"'<>)\]`]+/g;

export const EXPOSURE_CHANNELS = ["toolArguments", "toolResult", "scriptOutput", "error", "spillRead", "assistantText"] as const;
export type ExposureChannel = (typeof EXPOSURE_CHANNELS)[number];
export type ExposureMaterialOrigin = "fetch-content" | "cached-page" | "transport-fixture";
export type ExposureClass = "wholePage" | "quotation";

export interface ExposureMethod {
  readonly version: string;
  readonly minimumSpanCharacters: number;
  readonly quotationCeilingCharacters: number;
  readonly quotationPageShare: number;
  readonly classificationProvenance: string;
}
export type ExposureOptions = Partial<Pick<ExposureMethod, "minimumSpanCharacters" | "quotationCeilingCharacters" | "quotationPageShare">>;
export interface ExposureCharacters { readonly wholePage: number; readonly quotation: number; }
/** One counted run, without its text. `request` is the 1-based request position, `item` the 0-based input index, `source` an index into `sources`. `pageFrom` and `pageTo` are original page offsets. `itemFrom` and `itemTo` are offsets in the item's canonicalised text, not its wire text, and show that no item position is counted twice. */
export interface ExposureSpanRecord {
  readonly request: number;
  readonly item: number;
  readonly itemFrom: number;
  readonly itemTo: number;
  readonly channel: ExposureChannel;
  readonly source: number;
  readonly sourceSha256: string;
  readonly pageCharacters: number;
  readonly pageFrom: number;
  readonly pageTo: number;
  readonly characters: number;
  readonly class: ExposureClass;
}
/** Page material on the wire that the totals deliberately do not count, in page or item characters. */
export interface ExposureDiagnostics {
  /** Page text in an item that the delivery gate closed, by where the retrieving call was. */
  readonly gateSkipped: {
    readonly laterInRequest: number;
    readonly laterRequest: number;
    readonly lostFromHistory: number;
    readonly neverDelivered: number;
  };
  /** Page text in items that are not scanned for exposure. */
  readonly unscannedRole: { readonly user: number; readonly developer: number; readonly system: number; readonly instructions: number; readonly additionalTools: number };
  /** Item characters of matches dropped as a bare link target or as a user prompt echo. */
  readonly excluded: { readonly urlOnly: number; readonly promptEcho: number };
  /** Retrieved source entries resolved only through another event's text for the same URL. */
  readonly urlSubstitutedSources: number;
  readonly nonNfcMaterials: number;
  readonly nonNfcScannedItems: number;
}
export interface RunContextExposure {
  readonly schemaVersion: 1;
  readonly measure: "rawPageCharacters";
  readonly method: ExposureMethod;
  /** `complete` is the only state in which the three totals below are numbers. */
  readonly status: "complete" | "incomplete" | "unavailable";
  readonly rawPageCharacters: number | null;
  readonly wholePageCharacters: number | null;
  readonly quotationCharacters: number | null;
  /** What was matched regardless of status: a lower bound if incomplete, null if unavailable. */
  readonly observed: { readonly rawPageCharacters: number | null; readonly wholePageCharacters: number | null; readonly quotationCharacters: number | null };
  readonly requests: number;
  readonly channels: Readonly<Record<ExposureChannel, ExposureCharacters>>;
  readonly perRequest: readonly ({ readonly sequence: number } & ExposureCharacters)[];
  /** Page identities only. Page text never enters a shareable dataset. */
  readonly sources: readonly { readonly url: string; readonly sha256: string; readonly characters: number; readonly origin: ExposureMaterialOrigin; readonly exposed: ExposureCharacters }[];
  /** Every counted run, so other limits can be recomputed exactly with `reclassifyExposure`. */
  readonly spans: readonly ExposureSpanRecord[];
  /** Span counts by upper-exclusive length, for a quick look. Use `spans` to recompute anything. */
  readonly spanLengths: Readonly<Record<string, number>>;
  readonly diagnostics: ExposureDiagnostics;
  /** Encrypted reasoning items are not inspectable and are not counted. */
  readonly opaqueReasoningItems: number;
  /** Each one makes the record incomplete. */
  readonly issues: readonly string[];
  /** Visible unknowns that do not change the status. */
  readonly notices: readonly string[];
}

export interface ExposureRequest { readonly sequence: number; readonly payload: unknown; }
export interface ExposureMaterial { readonly url: string; readonly text: string; readonly origin: ExposureMaterialOrigin; readonly roots: readonly string[]; }
export interface ExposureInput {
  readonly requests: readonly ExposureRequest[];
  readonly toolEvents: readonly unknown[];
  /** Workspace-relative cached page text, for the fullPagePath of each research source. */
  readonly cachedFiles?: ReadonlyMap<string, string>;
  /** Successful transport bodies by URL, retained in capture and replay fixtures. */
  readonly fixtureBodies?: ReadonlyMap<string, readonly string[]>;
  /** Tool call identities in canonical messages. Their absence is an issue. */
  readonly canonicalCallIds?: ReadonlySet<string> | undefined;
  /** The observer's attestation. Anything other than true is an issue. */
  readonly observerComplete: boolean | undefined;
}

function resolveMethod(options: ExposureOptions = {}): ExposureMethod {
  const method: ExposureMethod = {
    version: CONTEXT_EXPOSURE_METHOD,
    minimumSpanCharacters: options.minimumSpanCharacters ?? MINIMUM_SPAN_CHARACTERS,
    quotationCeilingCharacters: options.quotationCeilingCharacters ?? QUOTATION_CEILING_CHARACTERS,
    quotationPageShare: options.quotationPageShare ?? QUOTATION_PAGE_SHARE,
    classificationProvenance: CLASSIFICATION_PROVENANCE,
  };
  const problem = methodProblem(method);
  if (problem) throw new RangeError(`Invalid exposure option: ${problem}`);
  return method;
}

function methodProblem(method: ExposureMethod): string | null {
  if (!Number.isInteger(method.minimumSpanCharacters) || method.minimumSpanCharacters < ANCHOR_LENGTH) return `minimumSpanCharacters must be an integer of at least ${ANCHOR_LENGTH}`;
  if (!Number.isInteger(method.quotationCeilingCharacters) || method.quotationCeilingCharacters < 1) return "quotationCeilingCharacters must be a positive integer";
  if (!Number.isFinite(method.quotationPageShare) || method.quotationPageShare <= 0 || method.quotationPageShare > 1) return "quotationPageShare must be above 0 and at most 1";
  return null;
}

export function classifySpan(characters: number, pageCharacters: number, limits: Pick<ExposureMethod, "quotationCeilingCharacters" | "quotationPageShare">): ExposureClass {
  return characters < limits.quotationCeilingCharacters && characters < pageCharacters * limits.quotationPageShare ? "quotation" : "wholePage";
}

/** Recompute the split under other limits from the retained spans alone. */
export function reclassifyExposure(record: Pick<RunContextExposure, "spans">, limits: Pick<ExposureMethod, "quotationCeilingCharacters" | "quotationPageShare">): ExposureCharacters {
  const totals = { wholePage: 0, quotation: 0 };
  for (const span of record.spans) totals[classifySpan(span.characters, span.pageCharacters, limits)] += span.characters;
  return totals;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** A tool call identity is `callId|itemId`, with `/n` appended for nested calls. */
const rootCallId = (toolCallId: string): string => toolCallId.split("|")[0].split("/")[0];

interface Canonical { readonly text: string; readonly start: Uint32Array; readonly end: Uint32Array; }

/**
 * Remove wire encoding and collapse whitespace, keeping each character's original
 * range. A backslash run of any depth collapses in one pass, so script output that
 * was JSON-encoded twice canonicalises like the page text it came from. The same
 * function is applied to both sides, which keeps a literal `\n` in a code sample
 * matchable even though it is treated as an escape.
 */
export function canonicalise(raw: string): Canonical {
  const chars: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const push = (char: string, from: number, to: number): void => {
    const space = /\s/.test(char);
    if (space && chars[chars.length - 1] === " ") { end[end.length - 1] = to; return; }
    chars.push(space ? " " : char);
    start.push(from);
    end.push(to);
  };
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== "\\") { push(raw[i], i, i + 1); i += 1; continue; }
    let j = i;
    while (raw[j] === "\\") j += 1;
    const next = raw[j];
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(j + 1, j + 5))) {
      push(String.fromCharCode(Number.parseInt(raw.slice(j + 1, j + 5), 16)), i, j + 5);
      i = j + 5;
    } else if (next === "n" || next === "r" || next === "t" || next === "f" || next === "b") {
      push(" ", i, j + 1);
      i = j + 1;
    } else if (next === undefined) {
      i = j;
    } else {
      push(next, i, j + 1);
      i = j + 1;
    }
  }
  return { text: chars.join(""), start: Uint32Array.from(start), end: Uint32Array.from(end) };
}

interface IndexedMaterial extends ExposureMaterial { readonly key: number; readonly sha256: string; readonly canonical: Canonical; readonly anchors: Map<string, number[]>; }

function indexMaterial(material: ExposureMaterial, key: number): IndexedMaterial {
  const canonical = canonicalise(material.text);
  const anchors = new Map<string, number[]>();
  for (let at = 0; at + ANCHOR_LENGTH <= canonical.text.length; at += 1) {
    const anchor = canonical.text.slice(at, at + ANCHOR_LENGTH);
    const list = anchors.get(anchor);
    if (!list) anchors.set(anchor, [at]);
    else if (list.length < MAX_ANCHOR_CANDIDATES) list.push(at);
  }
  return { ...material, key, sha256: sha256(material.text), canonical, anchors };
}

/** `from` and `to` are canonical offsets in the item; `pageFrom` and `pageTo` are original page offsets. */
export interface ExposureSpan { readonly material: number; readonly characters: number; readonly from: number; readonly to: number; readonly pageFrom: number; readonly pageTo: number; }
export interface ExposureMatch { readonly spans: ExposureSpan[]; readonly urlOnly: number; readonly promptEcho: number; readonly covered: Uint8Array; }

const countSet = (flags: Uint8Array, except: Uint8Array): number => {
  let count = 0;
  for (let index = 0; index < flags.length; index += 1) if (flags[index] && !except[index]) count += 1;
  return count;
};

/**
 * Longest-first cover of one text item. All maximal matches are found, then taken
 * longest first, so a short phrase that recurs elsewhere in a page cannot split the
 * long run containing it. Each item position belongs to at most one span: identical
 * pages cannot both claim one copy, while a second copy in the item is a second span.
 * Ties take the earliest position, then the earliest material. Positions in `blocked`
 * are already accounted for and stay out of this cover.
 */
export function matchSpans(text: string, materials: readonly IndexedMaterial[], excluded: string, minimum = MINIMUM_SPAN_CHARACTERS, blocked?: Uint8Array): ExposureMatch {
  const blob = canonicalise(text).text;
  const matches: { material: IndexedMaterial; from: number; to: number; pageFrom: number }[] = [];
  const activeUntil = new Map<string, number>();
  for (let at = 0; at + ANCHOR_LENGTH <= blob.length; at += 1) {
    const anchor = blob.slice(at, at + ANCHOR_LENGTH);
    for (const material of materials) {
      for (const offset of material.anchors.get(anchor) ?? []) {
        // One alignment of item and page is one match, however many anchors it holds.
        const alignment = `${material.key}:${offset - at}`;
        if ((activeUntil.get(alignment) ?? 0) > at) continue;
        const page = material.canonical.text;
        let back = 0;
        while (at - back > 0 && offset - back > 0 && blob[at - back - 1] === page[offset - back - 1]) back += 1;
        let forward = ANCHOR_LENGTH;
        while (at + forward < blob.length && offset + forward < page.length && blob[at + forward] === page[offset + forward]) forward += 1;
        activeUntil.set(alignment, at + forward);
        if (back + forward >= minimum) matches.push({ material, from: at - back, to: at + forward, pageFrom: offset - back });
      }
    }
  }
  matches.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from || a.material.key - b.material.key || a.pageFrom - b.pageFrom);
  const urlRanges = [...blob.matchAll(URL_TOKEN)].map((match) => [match.index, match.index + match[0].length] as const);
  const covered = blocked ? Uint8Array.from(blocked) : new Uint8Array(blob.length);
  const droppedUrl = new Uint8Array(blob.length);
  const droppedEcho = new Uint8Array(blob.length);
  const spans: ExposureSpan[] = [];
  for (const { material, from, to, pageFrom } of matches) {
    // A longer match may already hold part of this one; the rest can still qualify.
    let start = from;
    while (start < to) {
      if (covered[start]) { start += 1; continue; }
      let end = start;
      while (end < to && !covered[end]) end += 1;
      // A shared link target is an identity, not page prose. URLs inside a qualifying
      // span remain page text; they just cannot make a span qualify on their own.
      const urlCharacters = urlRanges.reduce((sum, [low, high]) => sum + Math.max(0, Math.min(end, high) - Math.max(start, low)), 0);
      if (end - start - urlCharacters < minimum) droppedUrl.fill(1, start, end);
      else if (excluded.includes(blob.slice(start, end))) droppedEcho.fill(1, start, end);
      else {
        covered.fill(1, start, end);
        const first = material.canonical.start[pageFrom + (start - from)];
        const last = material.canonical.end[pageFrom + (end - from) - 1];
        spans.push({ material: material.key, characters: last - first, from: start, to: end, pageFrom: first, pageTo: last });
      }
      start = end;
    }
  }
  return { spans: spans.sort((a, b) => a.from - b.from), urlOnly: countSet(droppedUrl, covered), promptEcho: countSet(droppedEcho, covered), covered };
}

interface ToolCall { path?: string; readonly nestedPaths: string[]; isError: boolean; }

/** Join start and end events by call identity, keeping nested reads with their script. */
function correlateEvents(events: readonly unknown[]): { calls: Map<string, ToolCall>; spillPaths: Set<string>; issues: Set<string> } {
  const calls = new Map<string, ToolCall>();
  const spillPaths = new Set<string>();
  const issues = new Set<string>();
  const started = new Map<string, string>();
  const ended = new Set<string>();
  for (const event of events) {
    if (!isRecord(event) || typeof event["toolCallId"] !== "string" || typeof event["toolName"] !== "string") continue;
    const id = event["toolCallId"];
    const name = event["toolName"];
    const root = rootCallId(id);
    const nested = id.includes("/") || typeof event["parentToolCallId"] === "string";
    if (!KNOWN_TOOLS.has(name)) issues.add(`Tool ${name} is outside the measured catalogue; its page material has no captured identity`);
    if (!calls.has(root)) calls.set(root, { nestedPaths: [], isError: false });
    const call = calls.get(root)!;
    if (event["type"] === "tool_execution_start") {
      started.set(id, name);
      const args = event["args"];
      if (name === "read" && isRecord(args) && typeof args["path"] === "string") {
        if (nested) call.nestedPaths.push(args["path"]);
        else call.path = args["path"];
      }
    }
    if (event["type"] === "tool_execution_end") {
      ended.add(id);
      if (!nested) call.isError = event["isError"] === true;
      const details = isRecord(event["result"]) ? event["result"]["details"] : undefined;
      if (isRecord(details) && typeof details["fullOutputPath"] === "string") spillPaths.add(details["fullOutputPath"]);
    }
  }
  for (const [id, name] of started) if (name.startsWith("intelli_") && !ended.has(id)) issues.add(`Retrieval call ${id} has no recorded end, so its page material is unknown`);
  return { calls, spillPaths, issues };
}

function intelliResult(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  const details = result["details"];
  if (isRecord(details) && isRecord(details["intelli"])) return details["intelli"];
  return isRecord(result["structuredContent"]) ? result["structuredContent"] : null;
}

/**
 * Gather page text from captured identities. Every retrieved source must resolve to
 * the text the tool returned; one that cannot is an issue, never an unseen zero. A
 * raw transport body still contributes to the observed lower bound, but it holds
 * markup the tool removed, so it cannot show that nothing was exposed.
 */
export function collectPageMaterial(input: Pick<ExposureInput, "toolEvents" | "cachedFiles" | "fixtureBodies">): { materials: ExposureMaterial[]; issues: string[]; urlSubstitutedSources: number } {
  const found = new Map<string, { url: string; text: string; origin: ExposureMaterialOrigin; roots: Set<string> }>();
  const add = (url: string, text: string, origin: ExposureMaterialOrigin, root: string): void => {
    const key = `${url}\0${sha256(text)}`;
    const entry = found.get(key);
    if (entry) entry.roots.add(root);
    else found.set(key, { url, text, origin, roots: new Set([root]) });
  };
  const required = new Map<string, Set<string>>();
  const textless = new Map<string, number>();
  for (const event of input.toolEvents) {
    if (!isRecord(event) || event["type"] !== "tool_execution_end" || typeof event["toolCallId"] !== "string") continue;
    const root = rootCallId(event["toolCallId"]);
    const sources = intelliResult(event["result"])?.["sources"];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (!isRecord(source) || typeof source["url"] !== "string" || typeof source["state"] !== "string" || !RETRIEVED_STATES.has(source["state"])) continue;
      const url = source["url"];
      if (!required.has(url)) required.set(url, new Set());
      required.get(url)!.add(root);
      const content = typeof source["content"] === "string" && source["content"].length > 0 ? source["content"] : undefined;
      const cached = typeof source["fullPagePath"] === "string" ? input.cachedFiles?.get(source["fullPagePath"]) : undefined;
      if (content) add(url, content, "fetch-content", root);
      if (cached) add(url, cached, "cached-page", root);
      if (!content && !cached) textless.set(url, (textless.get(url) ?? 0) + 1);
    }
  }
  const issues: string[] = [];
  let urlSubstitutedSources = 0;
  for (const [url, roots] of [...required].sort(([a], [b]) => compare(a, b))) {
    const known = [...found.values()].filter((entry) => entry.url === url && entry.origin !== "transport-fixture");
    if (known.length > 0) {
      urlSubstitutedSources += textless.get(url) ?? 0;
      for (const entry of known) for (const root of roots) entry.roots.add(root);
      continue;
    }
    const bodies = (input.fixtureBodies?.get(url) ?? []).filter((body) => body.length > 0);
    if (bodies.length === 0) { issues.push(`Retrieved source ${url} has no captured page text`); continue; }
    issues.push(`Retrieved source ${url} resolves only to a raw transport body, not the text the tool returned`);
    for (const body of bodies) for (const root of roots) add(url, body, "transport-fixture", root);
  }
  const ordered = [...found.values()].sort((a, b) => compare(a.url, b.url) || compare(sha256(a.text), sha256(b.text)));
  return { materials: ordered.map((entry) => ({ url: entry.url, text: entry.text, origin: entry.origin, roots: [...entry.roots].sort() })), issues, urlSubstitutedSources };
}

const emptyChannels = (): Record<ExposureChannel, { wholePage: number; quotation: number }> =>
  Object.fromEntries(EXPOSURE_CHANNELS.map((channel) => [channel, { wholePage: 0, quotation: 0 }])) as Record<ExposureChannel, { wholePage: number; quotation: number }>;

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map((part) => (isRecord(part) && typeof part["text"] === "string" ? part["text"] : null));
    return parts.every((part) => part !== null) ? parts.join("\n") : null;
  }
  return null;
}

const emptyDiagnostics = (): ExposureDiagnostics => ({
  gateSkipped: { laterInRequest: 0, laterRequest: 0, lostFromHistory: 0, neverDelivered: 0 },
  unscannedRole: { user: 0, developer: 0, system: 0, instructions: 0, additionalTools: 0 },
  excluded: { urlOnly: 0, promptEcho: 0 },
  urlSubstitutedSources: 0, nonNfcMaterials: 0, nonNfcScannedItems: 0,
});

/** The unavailable record. Absence of evidence is never reported as zero exposure. */
export function unavailableExposure(issue: string, options?: ExposureOptions): RunContextExposure {
  return {
    schemaVersion: 1, measure: "rawPageCharacters",
    method: resolveMethod(options),
    status: "unavailable", rawPageCharacters: null, wholePageCharacters: null, quotationCharacters: null,
    observed: { rawPageCharacters: null, wholePageCharacters: null, quotationCharacters: null },
    requests: 0, channels: emptyChannels(), perRequest: [], sources: [], spans: [], spanLengths: {}, diagnostics: emptyDiagnostics(), opaqueReasoningItems: 0, issues: [issue], notices: [],
  };
}

const spanBucket = (length: number): string => {
  const bucket = SPAN_BUCKETS.find((limit) => length < limit);
  return bucket === undefined ? `${SPAN_BUCKETS[SPAN_BUCKETS.length - 1]}+` : `<${bucket}`;
};

const OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);
const inputItems = (request: ExposureRequest): unknown[] | null => {
  const items = isRecord(request.payload) ? request.payload["input"] : undefined;
  return Array.isArray(items) ? items : null;
};

/** The history a later request must still carry. Reasoning and the catalogue may change between turns. */
const historyKeys = (items: readonly unknown[]): string[] =>
  items.filter((item) => !(isRecord(item) && (item["type"] === "reasoning" || item["type"] === "additional_tools"))).map((item) => JSON.stringify(item));

function carriesHistory(previous: readonly string[], next: readonly string[]): boolean {
  let at = 0;
  for (const key of next) if (at < previous.length && key === previous[at]) at += 1;
  return at === previous.length;
}

/** Pure measurement of one run. The same input always gives the same record. */
export function measureContextExposure(input: ExposureInput, options?: ExposureOptions): RunContextExposure {
  const method = resolveMethod(options);
  if (input.requests.length === 0) return unavailableExposure("No actual main-model requests are retained for this run", options);
  const issues = new Set<string>();
  const notices = new Set<string>();
  if (input.observerComplete !== true) issues.add(input.observerComplete === false ? "The request observer did not complete, so retained requests may be partial" : "No observer attestation was supplied, so retained requests may be partial");
  if (!input.canonicalCallIds) issues.add("Canonical messages are not retained, so tool outputs cannot be correlated with them");
  const sequences = input.requests.map((request) => request.sequence);
  if (sequences[0] !== 1) issues.add(`Actual request sequence starts at ${String(sequences[0])}, not 1, so earlier requests may be missing`);
  if (sequences.some((sequence, index) => index > 0 && sequence !== sequences[index - 1] + 1)) issues.add("Actual request sequence has gaps or is out of order");
  const events = correlateEvents(input.toolEvents);
  for (const issue of events.issues) issues.add(issue);
  const collected = collectPageMaterial(input);
  for (const issue of collected.issues) issues.add(issue);
  const materials = collected.materials.map(indexMaterial);

  // Where each call's output appears across the run, to explain a closed gate.
  const deliveredIn = new Map<string, number[]>();
  input.requests.forEach((request, index) => {
    for (const item of inputItems(request) ?? []) {
      if (!isRecord(item) || !OUTPUT_TYPES.has(String(item["type"])) || typeof item["call_id"] !== "string") continue;
      const list = deliveredIn.get(item["call_id"]) ?? [];
      if (list[list.length - 1] !== index) list.push(index);
      deliveredIn.set(item["call_id"], list);
    }
  });
  const gateReason = (material: IndexedMaterial, index: number): keyof ExposureDiagnostics["gateSkipped"] => {
    const seen = material.roots.flatMap((root) => deliveredIn.get(root) ?? []);
    if (seen.includes(index)) return "laterInRequest";
    if (seen.some((other) => other < index)) return "lostFromHistory";
    return seen.length > 0 ? "laterRequest" : "neverDelivered";
  };

  const channels = emptyChannels();
  const perRequest: { sequence: number; wholePage: number; quotation: number }[] = [];
  const exposed = materials.map(() => ({ wholePage: 0, quotation: 0 }));
  const spans: ExposureSpanRecord[] = [];
  const spanLengths: Record<string, number> = {};
  const diagnostics = emptyDiagnostics();
  const gateSkipped = { ...diagnostics.gateSkipped };
  const unscannedRole = { ...diagnostics.unscannedRole };
  const excludedCharacters = { ...diagnostics.excluded };
  let nonNfcScannedItems = 0;
  const spillPaths = new Set(events.spillPaths);
  let opaqueReasoningItems = 0;
  const memo = new Map<string, { counted: ExposureMatch; skipped: ExposureSpan[]; nonNfc: boolean }>();
  const shadowMemo = new Map<string, number>();
  const shadowScan = (text: string): number => {
    let characters = shadowMemo.get(text);
    if (characters === undefined) {
      characters = matchSpans(text, materials, "", method.minimumSpanCharacters).spans.reduce((sum, span) => sum + span.characters, 0);
      shadowMemo.set(text, characters);
    }
    return characters;
  };
  let previousHistory: string[] | null = null;

  input.requests.forEach((request, requestIndex) => {
    const totals = { sequence: request.sequence, wholePage: 0, quotation: 0 };
    perRequest.push(totals);
    const items = inputItems(request);
    if (!items) { issues.add(`Request ${request.sequence} has no input array, so its content was not measured`); return; }
    const history = historyKeys(items);
    if (previousHistory && !carriesHistory(previousHistory, history)) issues.add(`Request ${request.sequence} does not carry the whole history of the request before it, so repeated exposure may be undercounted`);
    previousHistory = history;
    if (isRecord(request.payload) && typeof request.payload["instructions"] === "string") unscannedRole.instructions += shadowScan(request.payload["instructions"]);
    const names = new Map<string, string>();
    const excluded = items.flatMap((item) => (isRecord(item) && item["role"] === "user" ? [canonicalise(textOf(item["content"]) ?? "").text] : [])).join("\n");
    const delivered = new Set<string>();
    items.forEach((item, itemIndex) => {
      if (!isRecord(item)) { issues.add(`Request ${request.sequence} has an unrecognised input item`); return; }
      const type = item["type"];
      const role = item["role"];
      if (type === "additional_tools") { unscannedRole.additionalTools += shadowScan(JSON.stringify(item)); return; }
      if (role === "developer" || role === "system" || role === "user") {
        const text = textOf(item["content"]);
        if (text === null) issues.add(`Request ${request.sequence} has ${role} content that is not text`);
        else unscannedRole[role] += shadowScan(text);
        return;
      }
      const scan: { channel: ExposureChannel; text: string }[] = [];
      if (type === "function_call" || type === "custom_tool_call") {
        if (typeof item["call_id"] === "string" && typeof item["name"] === "string") names.set(item["call_id"], item["name"]);
        const text = textOf(type === "function_call" ? item["arguments"] : item["input"]);
        if (text === null) issues.add(`Request ${request.sequence} has tool arguments that are not text`);
        else scan.push({ channel: "toolArguments", text });
      } else if (OUTPUT_TYPES.has(String(type))) {
        const callId = typeof item["call_id"] === "string" ? item["call_id"] : "";
        const text = textOf(item["output"]);
        const name = names.get(callId);
        const call = events.calls.get(callId);
        if (!call) issues.add(`Tool output ${callId || "without a call identity"} has no recorded tool event, so its source identity is unknown`);
        if (input.canonicalCallIds && !input.canonicalCallIds.has(callId)) issues.add(`Tool output ${callId || "without a call identity"} is absent from the canonical messages`);
        // Without its call item the output cannot be told apart as script or tool output.
        if (name === undefined) issues.add(`Tool output ${callId || "without a call identity"} in request ${request.sequence} has no call item before it, so its channel is unknown`);
        if (text === null) issues.add(`Request ${request.sequence} has a tool output that is not text`);
        else {
          for (const notice of text.matchAll(SPILL_NOTICE)) spillPaths.add(notice[1]);
          const isSpill = (path: string | undefined): boolean => path !== undefined && (spillPaths.has(path) || SPILL_FILE.test(path));
          const failed = call?.isError === true || (name === "codemode" && text.startsWith("Script failed"));
          const channel: ExposureChannel = isSpill(call?.path) || call?.nestedPaths.some(isSpill) ? "spillRead" : failed ? "error" : name === "codemode" ? "scriptOutput" : "toolResult";
          scan.push({ channel, text });
        }
        delivered.add(callId);
      } else if (type === "reasoning") {
        if (typeof item["encrypted_content"] === "string") opaqueReasoningItems += 1;
        const summary = textOf(item["summary"]);
        if (summary) scan.push({ channel: "assistantText", text: summary });
      } else if (role === "assistant") {
        const text = textOf(item["content"]);
        if (text === null) issues.add(`Request ${request.sequence} has assistant content that is not text`);
        else scan.push({ channel: "assistantText", text });
      } else {
        issues.add(`Request ${request.sequence} has unrecognised item type ${String(type)}`);
      }
      const eligible = materials.filter((material) => material.roots.some((root) => delivered.has(root)));
      const closed = materials.filter((material) => !eligible.includes(material));
      for (const { channel, text } of scan) {
        const key = `${eligible.map((material) => material.key).join(",")}\0${excluded}\0${text}`;
        let result = memo.get(key);
        if (!result) {
          const counted = matchSpans(text, eligible, excluded, method.minimumSpanCharacters);
          const skipped = closed.length > 0 ? matchSpans(text, closed, excluded, method.minimumSpanCharacters, counted.covered).spans : [];
          const canonical = canonicalise(text).text;
          result = { counted, skipped, nonNfc: canonical.normalize("NFC") !== canonical };
          memo.set(key, result);
        }
        excludedCharacters.urlOnly += result.counted.urlOnly;
        excludedCharacters.promptEcho += result.counted.promptEcho;
        if (result.nonNfc) nonNfcScannedItems += 1;
        for (const span of result.skipped) gateSkipped[gateReason(materials[span.material], requestIndex)] += span.characters;
        for (const span of result.counted.spans) {
          const material = materials[span.material];
          const kind = classifySpan(span.characters, material.text.length, method);
          totals[kind] += span.characters;
          channels[channel][kind] += span.characters;
          exposed[span.material][kind] += span.characters;
          spans.push({ request: requestIndex + 1, item: itemIndex, itemFrom: span.from, itemTo: span.to, channel, source: span.material, sourceSha256: material.sha256, pageCharacters: material.text.length, pageFrom: span.pageFrom, pageTo: span.pageTo, characters: span.characters, class: kind });
          const bucket = spanBucket(span.characters);
          spanLengths[bucket] = (spanLengths[bucket] ?? 0) + 1;
        }
      }
    });
  });
  const nonNfcMaterials = materials.filter((material) => material.canonical.text.normalize("NFC") !== material.canonical.text).length;
  if (gateSkipped.lostFromHistory > 0) issues.add(`${gateSkipped.lostFromHistory} page characters sit in requests that no longer carry the retrieving call's output`);
  if (gateSkipped.neverDelivered > 0) issues.add(`${gateSkipped.neverDelivered} page characters match material whose retrieving call reached no request`);
  for (const role of BLOCKING_ROLES) if (unscannedRole[role] > 0) issues.add(`${unscannedRole[role]} page characters sit in unscanned ${role} text`);
  if (gateSkipped.laterInRequest + gateSkipped.laterRequest > 0) notices.add(`${gateSkipped.laterInRequest + gateSkipped.laterRequest} page characters sit in items placed before their page was delivered, and are not counted`);
  if (unscannedRole.user > 0) notices.add(`${unscannedRole.user} page characters sit in user text, which is not scanned`);
  if (excludedCharacters.promptEcho > 0) notices.add(`${excludedCharacters.promptEcho} item characters were excluded as an echo of a user prompt`);
  if (collected.urlSubstitutedSources > 0) notices.add(`${collected.urlSubstitutedSources} retrieved source entries resolved through another event's text for the same URL`);
  if (nonNfcMaterials + nonNfcScannedItems > 0) notices.add(`${nonNfcMaterials} materials and ${nonNfcScannedItems} scanned items are not in Unicode NFC form, so text in a different form may be partly undercounted`);
  const wholePage = perRequest.reduce((sum, row) => sum + row.wholePage, 0);
  const quotation = perRequest.reduce((sum, row) => sum + row.quotation, 0);
  const complete = issues.size === 0;
  return {
    schemaVersion: 1, measure: "rawPageCharacters",
    method,
    status: complete ? "complete" : "incomplete",
    rawPageCharacters: complete ? wholePage + quotation : null,
    wholePageCharacters: complete ? wholePage : null,
    quotationCharacters: complete ? quotation : null,
    observed: { rawPageCharacters: wholePage + quotation, wholePageCharacters: wholePage, quotationCharacters: quotation },
    requests: input.requests.length, channels, perRequest,
    sources: materials.map((material, index) => ({ url: material.url, sha256: material.sha256, characters: material.text.length, origin: material.origin, exposed: exposed[index] })),
    spans, spanLengths,
    diagnostics: { gateSkipped, unscannedRole, excluded: excludedCharacters, urlSubstitutedSources: collected.urlSubstitutedSources, nonNfcMaterials, nonNfcScannedItems },
    opaqueReasoningItems, issues: [...issues].sort(), notices: [...notices].sort(),
  };
}

/** The first way a record contradicts its own contract, or null. Used by the analysis to fail closed. */
export function exposureRecordProblem(value: unknown): string | null {
  if (!isRecord(value)) return "not an object";
  const record = value as unknown as RunContextExposure;
  if (record.schemaVersion !== 1 || record.measure !== "rawPageCharacters") return "unknown schema or measure";
  if (!isRecord(record.method) || record.method.version !== CONTEXT_EXPOSURE_METHOD) return `method version must be ${CONTEXT_EXPOSURE_METHOD}`;
  if (record.method.classificationProvenance !== CLASSIFICATION_PROVENANCE) return "unknown classification provenance";
  const badMethod = methodProblem(record.method);
  if (badMethod) return `invalid method: ${badMethod}`;
  // A stored class only proves its own span. Other limits are reached through reclassifyExposure.
  const studyMethod = resolveMethod();
  const methodKeys = Object.keys(studyMethod) as (keyof ExposureMethod)[];
  if (Object.keys(record.method).length !== methodKeys.length || methodKeys.some((key) => record.method[key] !== studyMethod[key])) return "method parameters differ from the study method; use reclassifyExposure for other limits";
  if (!["complete", "incomplete", "unavailable"].includes(record.status)) return "unknown status";
  const count = (item: unknown): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0;
  if (!Array.isArray(record.issues) || !Array.isArray(record.notices) || !Array.isArray(record.perRequest) || !Array.isArray(record.sources) || !Array.isArray(record.spans) || !isRecord(record.channels) || !isRecord(record.observed) || !isRecord(record.diagnostics) || !isRecord(record.spanLengths)) return "missing record structure";
  if (![...record.issues, ...record.notices].every((text) => typeof text === "string")) return "issues and notices must be text";
  if (!count(record.requests) || !count(record.opaqueReasoningItems)) return "invalid request or reasoning count";
  const diagnostics = record.diagnostics;
  if (!isRecord(diagnostics.gateSkipped) || !isRecord(diagnostics.unscannedRole) || !isRecord(diagnostics.excluded)) return "missing diagnostics";
  const diagnosticCounts = [...Object.values(diagnostics.gateSkipped), ...Object.values(diagnostics.unscannedRole), ...Object.values(diagnostics.excluded), diagnostics.urlSubstitutedSources, diagnostics.nonNfcMaterials, diagnostics.nonNfcScannedItems];
  if (diagnosticCounts.length !== 4 + 5 + 2 + 3 || !diagnosticCounts.every(count)) return "invalid diagnostics";
  const totals = [record.rawPageCharacters, record.wholePageCharacters, record.quotationCharacters];
  const observed = [record.observed.rawPageCharacters, record.observed.wholePageCharacters, record.observed.quotationCharacters];
  if (record.status === "unavailable") {
    if (totals.some((item) => item !== null) || observed.some((item) => item !== null)) return "an unavailable record may report neither totals nor observed characters";
    if (record.requests !== 0 || record.perRequest.length !== 0 || record.spans.length !== 0 || record.sources.length !== 0) return "an unavailable record may hold no measurements";
    if (record.issues.length === 0) return "an unavailable record must state why";
    return null;
  }
  if (!observed.every(count)) return "a measured record needs observed characters";
  const [rawObserved, wholeObserved, shortObserved] = observed as number[];
  if (rawObserved !== wholeObserved + shortObserved) return "whole-page and quotation characters do not partition the observed total";
  if (record.status === "complete") {
    if (record.issues.length !== 0) return "a complete record may have no issues";
    if (record.rawPageCharacters !== rawObserved || record.wholePageCharacters !== wholeObserved || record.quotationCharacters !== shortObserved) return "complete totals differ from observed characters";
    if (record.sources.some((source) => source.origin === "transport-fixture")) return "a complete record may not rest on a raw transport body";
    for (const reason of BLOCKING_GATE_REASONS) if (diagnostics.gateSkipped[reason] !== 0) return `a complete record may hold no page characters in gateSkipped.${reason}`;
    for (const role of BLOCKING_ROLES) if (diagnostics.unscannedRole[role] !== 0) return `a complete record may hold no page characters in unscannedRole.${role}`;
  } else {
    if (totals.some((item) => item !== null)) return "only a complete record may report totals";
    if (record.issues.length === 0) return "an incomplete record must state why";
  }
  const sum = (rows: readonly ExposureCharacters[]): ExposureCharacters => ({ wholePage: rows.reduce((total, row) => total + row.wholePage, 0), quotation: rows.reduce((total, row) => total + row.quotation, 0) });
  const reconciles = (label: string, rows: readonly ExposureCharacters[]): string | null => {
    if (!rows.every((row) => isRecord(row) && count(row.wholePage) && count(row.quotation))) return `invalid ${label} characters`;
    const total = sum(rows);
    return total.wholePage === wholeObserved && total.quotation === shortObserved ? null : `${label} do not reconcile with observed characters`;
  };
  if (Object.keys(record.channels).sort().join() !== [...EXPOSURE_CHANNELS].sort().join()) return "unknown channels";
  if (record.perRequest.length !== record.requests) return "perRequest does not match the request count";
  if (record.status === "complete" && !record.perRequest.every((row, index) => row.sequence === index + 1)) return "a complete record's requests must run from 1";
  const breakdowns: [string, readonly ExposureCharacters[]][] = [["channels", Object.values(record.channels)], ["perRequest", record.perRequest], ["sources", record.sources.map((source) => source.exposed)]];
  for (const [label, rows] of breakdowns) {
    const problem = reconciles(label, rows);
    if (problem) return problem;
  }
  const fromSpans = { wholePage: 0, quotation: 0 };
  const bySource = record.sources.map(() => ({ wholePage: 0, quotation: 0 }));
  const byChannel = Object.fromEntries(EXPOSURE_CHANNELS.map((channel) => [channel, { wholePage: 0, quotation: 0 }])) as Record<string, { wholePage: number; quotation: number }>;
  const byRequest = record.perRequest.map(() => ({ wholePage: 0, quotation: 0 }));
  const spans: readonly ExposureSpanRecord[] = record.spans;
  const itemRanges = new Map<string, ExposureSpanRecord[]>();
  for (const span of spans) {
    const source = record.sources[span.source];
    if (!source || span.sourceSha256 !== source.sha256 || span.pageCharacters !== source.characters) return "a span does not match its source";
    if (!count(span.characters) || !count(span.pageFrom) || span.pageTo !== span.pageFrom + span.characters || span.pageTo > span.pageCharacters) return "a span has invalid offsets";
    // Each canonical position is at least one page character, and a counted run reaches the minimum.
    if (!count(span.item) || !count(span.itemFrom) || !count(span.itemTo) || span.itemTo - span.itemFrom < record.method.minimumSpanCharacters || span.itemTo - span.itemFrom > span.characters) return "a span has an invalid item range";
    const itemKey = `${span.request}:${span.item}`;
    itemRanges.set(itemKey, [...(itemRanges.get(itemKey) ?? []), span]);
    if (!byChannel[span.channel]) return "a span has an unknown channel";
    if (span.class !== classifySpan(span.characters, span.pageCharacters, record.method)) return "a span's class contradicts the record's method";
    fromSpans[span.class] += span.characters;
    bySource[span.source][span.class] += span.characters;
    byChannel[span.channel][span.class] += span.characters;
    const row = byRequest[span.request - 1];
    if (!row) return "a span names a request outside the record";
    row[span.class] += span.characters;
  }
  for (const ranges of itemRanges.values()) {
    const ordered = [...ranges].sort((a, b) => a.itemFrom - b.itemFrom);
    if (ordered.some((span, index) => index > 0 && span.itemFrom < ordered[index - 1].itemTo)) return "spans overlap within one request item";
  }
  if (fromSpans.wholePage !== wholeObserved || fromSpans.quotation !== shortObserved) return "spans do not reconcile with observed characters";
  const same = (a: ExposureCharacters, b: ExposureCharacters): boolean => a.wholePage === b.wholePage && a.quotation === b.quotation;
  if (!record.sources.every((source, index) => same(source.exposed, bySource[index]))) return "spans do not reconcile with sources";
  if (!EXPOSURE_CHANNELS.every((channel) => same(record.channels[channel], byChannel[channel]))) return "spans do not reconcile with channels";
  if (!record.perRequest.every((row, index) => same(row, byRequest[index]))) return "spans do not reconcile with perRequest";
  if (Object.values(record.spanLengths).reduce((total: number, item) => total + Number(item), 0) !== record.spans.length) return "spanLengths do not reconcile with spans";
  return null;
}

async function readOptional(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
}

/** Files below any `sources/` directory of the retained workspace snapshot. */
async function cachedSourceFiles(workspace: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(workspace, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    const relative = absolute.slice(workspace.length + 1);
    if (relative.split(/[\\/]/).includes("sources")) files.set(relative, await readFile(absolute, "utf8"));
  }
  return files;
}

async function fixtureBodies(runDir: string): Promise<Map<string, string[]>> {
  const bodies = new Map<string, string[]>();
  for (const name of ["replay-input.json", join("capture", "bundle.json")]) {
    const text = await readOptional(join(runDir, name));
    if (text === null) continue;
    const bundle = JSON.parse(text) as { fetch?: { fixtures?: { request?: { url?: unknown }; response?: { status?: unknown; bodyBase64?: unknown } }[] } };
    for (const fixture of bundle.fetch?.fixtures ?? []) {
      const url = fixture.request?.url;
      const body = fixture.response?.bodyBase64;
      if (typeof url !== "string" || typeof body !== "string" || fixture.response?.status !== 200 || body.length === 0) continue;
      bodies.set(url, [...(bodies.get(url) ?? []), Buffer.from(body, "base64").toString("utf8")]);
    }
  }
  return bodies;
}

/** Root call identities of the tool results in canonical messages. */
function canonicalToolCalls(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n").filter(Boolean)) {
    const record = JSON.parse(line) as { toolCallId?: unknown };
    if (typeof record.toolCallId === "string") ids.add(rootCallId(record.toolCallId));
  }
  return ids;
}

/**
 * Measure one retained run read-only. A missing or unreadable artefact gives an
 * unavailable record: exposure is additive and must never fail the analysis of the
 * existing endpoints, and it must never look like a measured zero.
 */
export async function readRunContextExposure(runDir: string, workspace: string, observerComplete: boolean | undefined, options?: ExposureOptions): Promise<RunContextExposure> {
  try {
    const requestText = await readOptional(join(runDir, "actual-requests.ndjson"));
    if (requestText === null) return unavailableExposure("actual-requests.ndjson is not retained for this run", options);
    const eventsText = await readOptional(join(runDir, "tool-events.json"));
    if (eventsText === null) return unavailableExposure("tool-events.json is not retained for this run", options);
    const requests = requestText.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ExposureRequest);
    const toolEvents = JSON.parse(eventsText) as unknown[];
    if (!Array.isArray(toolEvents)) return unavailableExposure("tool-events.json does not contain an array", options);
    const canonicalText = await readOptional(join(runDir, "canonical-messages.ndjson"));
    return measureContextExposure({
      requests, toolEvents, cachedFiles: await cachedSourceFiles(workspace), fixtureBodies: await fixtureBodies(runDir),
      canonicalCallIds: canonicalText === null ? undefined : canonicalToolCalls(canonicalText),
      observerComplete,
    }, options);
  } catch (error) {
    return unavailableExposure(`Exposure artefacts could not be read: ${error instanceof Error ? error.message : String(error)}`, options);
  }
}
