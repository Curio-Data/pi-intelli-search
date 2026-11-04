// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Offline publication exporter for the Codemode study (research plan step 5,
// "Publication Package"). Input is one StudyDataset JSON file; output is a new
// shareable bundle directory. The exporter makes no model call, opens no
// session, reads no credential store and touches no network. Numerical outputs
// reuse the accepted analysis kernel (study-analysis.ts / statistics.ts)
// unchanged, so every published number regenerates from the sanitised dataset
// alone.
//
// r3 shareability design (after the second adversarial and prose reviews):
//  - The token scrubber recognises local-root segments, multi-segment absolute
//    paths outside a small API-route allowance, UNC, drive, ~name, $HOME,
//    percent-encoded and file: shapes; "=" is a delimiter so key=value paths
//    split; a ":" followed by a single-slash path is a path; after a redacted
//    path token, following slash-bearing tokens are redacted to the clause
//    end. Ordinary URLs without local-root segments survive; URLs carrying
//    local roots or userinfo are redacted. Identity and digest fields refuse
//    publication instead of being rewritten.
//  - Live operator identity (username, home, hostname) and an optional
//    extra deny list are applied at BUILD time only, with token boundaries for
//    the short values; VERIFY uses host-independent patterns only, so its
//    verdict is a function of the bundle, not the reproducer's machine. No
//    host-specific literals live in this source.
//  - Recursive key allowlists cover every object boundary in the dataset,
//    including effectiveSettings and the nested context-exposure records.
//  - Builds are atomic (sibling partial, removed on failure) and verify is
//    authoritative in both directions: the permitted file set is derived from
//    the fixed bundle files, the regenerable set, provenance source hashes and
//    the inputs manifest; the manifest's own shape, byte sizes and lockfile
//    host are checked; every listed content file is byte-checked.
//  - The documented reproduction sequence keeps the bundle immutable: the
//    loader is provisioned in the bundle's parent directory and all check
//    output is written outside the bundle.

import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir, hostname, userInfo } from "node:os";
import { promisify } from "node:util";
import { analyseStudy, reproduceAnalysis, type StudyAnalysisRun, type StudyDataset } from "./study-analysis.js";
import { sha256Bytes, sha256Text } from "./canonical.js";
import type { Json } from "./contracts.js";

export const PUBLICATION_SCHEMA_VERSION = 2;
export const PUBLICATION_EDITION = "publication-v1";
const EMPTY_SHA256 = ["e3b0c442", "98fc1c14", "9afbf4c8", "996fb924", "27ae41e4", "649b934c", "a495991b", "7852b855"].join("");

export class InvalidPublicationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPublicationInputError";
  }
}

/** A shareability failure carrying the matched literals, so callers can locate them in JSON. */
export class ShareabilityError extends Error {
  readonly matches: readonly string[];
  constructor(name: string, matches: readonly string[]) {
    const shortIdentity = matches.some((value) => typeof value === "string" && value.length > 0 && value.length <= 12 && !value.includes(" ") && /^[A-Za-z0-9._-]+$/.test(value));
    super(
      `Shareability check failed for ${name}: bundle contains ${matches.map((value) => JSON.stringify(value)).join(", ")}` +
        (shortIdentity
          ? ". A short identifier matched the build-side identity check (live username or hostname): adjust the input, or extend the deny list, then rebuild"
          : ""),
    );
    this.name = "ShareabilityError";
    this.matches = matches;
  }
}

// ---------------------------------------------------------------------------
// Private-string detection. Literals that scanners or recipients should never
// see in this source are assembled from parts.
// ---------------------------------------------------------------------------

const HOME_ROOT = ["", "home", ""].join("/");
const LOCAL_ROOTS = [HOME_ROOT, ["", "srv", ""].join("/"), ["", "Users", ""].join("/"), ["", "root", ""].join("/"), ["", "tmp", ""].join("/"), ["", "var", ""].join("/"), ["", "opt", ""].join("/"), ["", "mnt", ""].join("/"), ["", "media", ""].join("/"), ["", "run", ""].join("/"), ["", "etc", ""].join("/"), ["", "private", ""].join("/")];
/** A local-root path segment anywhere in a token marks the whole token. */
const ROOT_SEGMENT = /\/(?:home|srv|Users|root|tmp|var|opt|mnt|media|run|etc|private)\//;
const TILDE_SLASH = ["~", "/"].join("");
const FILE_URL = ["file", "://"].join("");
const PERCENT_SLASH = ["%", "2", "F"].join("");
const REDACTED_PATH = "<redacted-local-path>";
const REDACTED_UUID = "<redacted-session-id>";
const REDACTED_CREDENTIAL = "<redacted-credential>";

/** Delimiters that end a token. "=" splits key=value forms (including URL queries); "@" splits userinfo and @-prefixed paths. */
const TOKEN_DELIMITERS = new Set([" ", "\t", "\n", "\r", "(", ")", "[", "]", "{", "}", ",", ";", '"', "'", "`", "|", "<", ">", "=", "@"]);
/**
 * Clause boundaries stop path-continuation redaction. A period, "!" or "?"
 * cannot serve: it is not a delimiter, because splitting on it would break
 * every URL, filename and version number.
 */
const CLAUSE_BOUNDARIES = new Set([";", ",", "\n", "\r"]);

const UUID_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Credential prefixes assembled so no scanner-bait literal sits in this source. */
const OR_KEY_PREFIX = ["sk", "or", "v1"].join("-");
const SK_PREFIX = ["sk", "-"].join("");
const GITHUB_TOKEN = ["gh", "p_"].join("");
const GITHUB_OAUTH = ["gh", "o_"].join("");
const GITHUB_APP = ["github", "_pat_"].join("");
const GOOGLE_KEY = ["AI", "za"].join("");
const HF_TOKEN = ["hf", "_"].join("");
const GITLAB_PAT = ["gl", "pat-"].join("");
const NPM_TOKEN = ["npm", "_"].join("");
const AMAZON_KEY = ["AK", "IA"].join("");
/** Build-time operator identity, resolved lazily so verify never calls it (a UID with no passwd entry is tolerated). */
export interface BuildIdentity {
  readonly user: string | null;
  readonly home: string | null;
  readonly hostname: string | null;
}
function resolveBuildIdentity(): BuildIdentity {
  let user: string | null = null;
  try {
    user = userInfo().username;
  } catch {
    user = null;
  }
  let home: string | null = null;
  try {
    home = homedir();
  } catch {
    home = null;
  }
  let host: string | null = null;
  try {
    host = hostname();
  } catch {
    host = null;
  }
  return { user, home, hostname: host };
}
/** Loopback, RFC 1918, CGNAT and tailnet hosts in URL authority position: host-independent private infrastructure. */
const PRIVATE_URL_HOST = /[a-z][a-z0-9+.-]*:\/\/([^/@\s]+@)?(localhost(?=[:/?#]|$)|((127|10)\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[?::1\]?(?=[:/]|$))|[A-Za-z0-9.-]+\.ts\.net(?=[:/]|$))/i;
/** URL userinfo (scheme://user:secret@) marks the whole token as a credential. */
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i;
const CREDENTIAL_GLOBAL = new RegExp(
  [
    `(?<![A-Za-z0-9_-])(?:${OR_KEY_PREFIX}|${SK_PREFIX}|${GITHUB_TOKEN}|${GITHUB_OAUTH}|${GITHUB_APP}|xox[baprs]-|${GOOGLE_KEY}|${HF_TOKEN}|${AMAZON_KEY}|${GITLAB_PAT}|${NPM_TOKEN})(?![A-Za-z0-9_-]*\\()[A-Za-z0-9_-]{12,}`,
    `(?<![A-Za-z0-9_-])authorization\\s*[:=]\\s*(?:(?:Bearer|Basic|Token)\\s+)?\\S{4,}`,
    `[?&](?:token|sig|api[_-]?key|apikey|client_secret|access[_-]?token|password|secret)=[^&\\s'"',;]{4,}`,
    `(?<![A-Za-z0-9])["']?(?:password|passwd|secret|api[_-]?key|x-api-key|access[_-]?token|private[_-]?key|aws_secret_access_key|client_secret|refresh_token)["']?\\s*[:=]\\s*["']?[^\\s"',;{}]{4,}`,
    `(?<![A-Za-z0-9])["']?(?:token|sig|cookie)["']?\\s*[:=](?!:)\\s*["']?[A-Za-z0-9_+/=.~%:-]{8,}`,
    `-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\\s\\S]*?(?:-----END (?:[A-Z ]+ )?PRIVATE KEY-----|$)`,
    `eyJ[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`,
  ].join("|"),
  "gi",
);
/** Case-sensitive header secrets: the English word "basic" is not one. No inline regex modifiers (Node 22 compatibility). */
const CREDENTIAL_SENSITIVE = /(?:Bearer|Basic)\s(?<![A-Za-z])[A-Za-z0-9+/_=.-]{16,}/g;
const PEM_PRIVATE_HEADER = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;
const DRIVE_TOKEN = /^[A-Za-z]:[\\/][^\s]*$/;

function isPathToken(token: string): boolean {
  if (token.length === 0) return false;
  const lower = token.toLowerCase();
  if (lower.startsWith(FILE_URL)) return true;
  if (lower.includes(PERCENT_SLASH.toLowerCase())) return true;
  if (token.startsWith(TILDE_SLASH) || /^~[A-Za-z0-9_.-]+\//.test(token)) return true;
  if (token.startsWith("$HOME") || token.startsWith("${HOME}")) return true;
  if (token.startsWith("\\\\")) return true;
  if (DRIVE_TOKEN.test(token)) return true;
  if (token.startsWith("/") && token.length > 1) {
    // Extensionless API routes such as /v1/chat/completions are ordinary web
    // vocabulary, not local paths; a route ending in a file extension is not.
    if (/^\/(?:v\d+|api)(?:\/|$)/.test(token) && !/\.[A-Za-z0-9]+$/.test(token)) return false;
    // A single leading segment (/div, /x) is too weak a signal; a second
    // slash marks an absolute path.
    return token.slice(1).includes("/");
  }
  // A local-root segment anywhere in the token (relative paths, schemeless
  // URLs, doc links) marks the whole token.
  return ROOT_SEGMENT.test(token);
}

/** Splits on delimiters, keeping both tokens and delimiters in order. */
function splitTokens(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of text) {
    if (TOKEN_DELIMITERS.has(char)) {
      if (current !== "") parts.push(current);
      parts.push(char);
      current = "";
    } else current += char;
  }
  if (current !== "") parts.push(current);
  return parts;
}

export interface ScrubReport {
  readonly localPaths: number;
  readonly sessionIds: number;
  readonly credentials: number;
  readonly locations: readonly string[];
}

class Scrubber {
  readonly locations: string[] = [];
  localPaths = 0;
  sessionIds = 0;
  credentials = 0;

  text(value: string): string {
    // URL userinfo is a credential wherever it appears; redact it at string
    // level because the tokeniser splits on the "@" separator.
    let userinfoCount = 0;
    let working = value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, (_match, scheme: string) => {
      userinfoCount += 1;
      return `${scheme}${REDACTED_CREDENTIAL}@`;
    });
    if (userinfoCount > 0) this.credentials += userinfoCount;
    const parts = splitTokens(working);
    let redacting = false;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!;
      if (part.length === 0) continue;
      if (TOKEN_DELIMITERS.has(part)) {
        if (CLAUSE_BOUNDARIES.has(part)) redacting = false;
        continue;
      }
      if (URL_USERINFO.test(part) || PRIVATE_URL_HOST.test(part)) {
        // A URL with credentials in the userinfo or a private, loopback or
        // tailnet host is infrastructure identity: redact the whole token.
        parts[i] = REDACTED_CREDENTIAL;
        this.credentials += 1;
        redacting = false;
        continue;
      }
      if (isPathToken(part)) {
        parts[i] = REDACTED_PATH;
        this.localPaths += 1;
        redacting = true;
        continue;
      }
      if (redacting) {
        // A path token has been seen in this clause: every following token is
        // at risk until the clause ends, because a path broken by spaces or
        // parentheses must not leak its tail. This over-redacts trailing
        // prose, deliberately, in preference to leaking a suffix.
        parts[i] = REDACTED_PATH;
        this.localPaths += 1;
        continue;
      }
    }
    let out = parts.join("");
    // A colon followed by a single-slash path (stat:/data/x, file:/data/x)
    // without being a URL scheme separator.
    out = out.replace(/:(\/(?!\/)[^\s,;"'`|<>)]*)/g, (_match, path: string) => {
      this.localPaths += 1;
      return `:${REDACTED_PATH}`;
    });
    const uuidMatches = out.match(UUID_GLOBAL);
    if (uuidMatches !== null) {
      this.sessionIds += uuidMatches.length;
      out = out.replace(UUID_GLOBAL, REDACTED_UUID);
    }
    CREDENTIAL_GLOBAL.lastIndex = 0;
    const credentialMatches = out.match(CREDENTIAL_GLOBAL);
    if (credentialMatches !== null) {
      this.credentials += credentialMatches.length;
      out = out.replace(CREDENTIAL_GLOBAL, REDACTED_CREDENTIAL);
    }
    CREDENTIAL_SENSITIVE.lastIndex = 0;
    const sensitiveMatches = out.match(CREDENTIAL_SENSITIVE);
    if (sensitiveMatches !== null) {
      this.credentials += sensitiveMatches.length;
      out = out.replace(CREDENTIAL_SENSITIVE, REDACTED_CREDENTIAL);
    }
    if (PEM_PRIVATE_HEADER.test(out) && !out.includes(REDACTED_CREDENTIAL)) {
      this.credentials += 1;
      out = out.replace(PEM_PRIVATE_HEADER, REDACTED_CREDENTIAL);
    }
    return out;
  }

  note(pointer: string): void {
    if (!this.locations.includes(pointer)) this.locations.push(pointer);
  }

  get report(): ScrubReport {
    return { localPaths: this.localPaths, sessionIds: this.sessionIds, credentials: this.credentials, locations: [...this.locations].sort() };
  }
}

/** A share-mode byte check. "build" adds live operator identity; "verify" is host-independent. */
export type ShareabilityMode = "build" | "verify";

const MARKER_FOLLOWED_BY_PATH = /<redacted-local-path>[A-Za-z0-9_.\\/|-]/;
const PERCENT_ENCODED_PATH = new RegExp(`(?:^|[^0-9A-Za-z])${PERCENT_SLASH}|(?:^|[^0-9A-Za-z])${PERCENT_SLASH.toLowerCase()}`);
const ANY_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DRIVE_LOOKBEHIND = /(?<![A-Za-z])[A-Za-z]:[\\/]/;
const TILDE_PATH = new RegExp(`${TILDE_SLASH}`);
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

async function extraDenyList(): Promise<string[]> {
  const file = process.env.PUBLICATION_DENY_FILE;
  if (file === undefined || file === "") return [];
  let text: string;
  try {
    text = await readFile(resolve(file), "utf8");
  } catch (error) {
    // Fail closed: a configured deny list that cannot be read must not
    // silently become an empty one.
    throw new Error(`PUBLICATION_DENY_FILE is set but ${file} cannot be read (${(error as NodeJS.ErrnoException).code ?? "error"}); refusing to build with an unapplied deny list`);
  }
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}

/** Byte check over one text payload. Any hit fails the publication. */
export function assertShareableText(name: string, text: string, mode: ShareabilityMode = "verify", denyList: readonly string[] = []): void {
  const forbidden: string[] = [];
  for (const literal of LOCAL_ROOTS) if (text.includes(literal)) forbidden.push(literal);
  if (text.includes(FILE_URL)) forbidden.push(FILE_URL);
  // Tilde and percent-encoded heuristics legitimately fire inside public
  // URLs, so they are checked outside URL tokens only.
  const outsideUrls = text.replace(/https?:\/\/[^\s"'<>)\]`]+/g, "");
  if (TILDE_PATH.test(outsideUrls)) forbidden.push(TILDE_SLASH);
  if (PERCENT_ENCODED_PATH.test(outsideUrls)) forbidden.push(PERCENT_SLASH);
  if (ANY_UUID.test(text)) forbidden.push("a UUID-shaped identifier");
  CREDENTIAL_GLOBAL.lastIndex = 0;
  if (CREDENTIAL_GLOBAL.test(text) || JWT_SHAPE.test(text) || PEM_PRIVATE_HEADER.test(text)) forbidden.push("a credential-shaped string");
  if (DRIVE_LOOKBEHIND.test(text)) forbidden.push("a Windows drive path");
  if (MARKER_FOLLOWED_BY_PATH.test(text)) forbidden.push("a redaction marker followed by path text");
  if (PRIVATE_URL_HOST.test(text)) forbidden.push("a private, loopback or tailnet host in a URL");
  CREDENTIAL_SENSITIVE.lastIndex = 0;
  if (CREDENTIAL_SENSITIVE.test(text)) forbidden.push("a credential-shaped string");
  if (mode === "build") {
    // Live identity, build-side only. Long distinctive values are matched as
    // substrings; short values (username, hostname) only at token boundaries
    // so ordinary words in evidence do not collide. A UID without a passwd
    // entry yields null and skips that check rather than crashing.
    const identity = resolveBuildIdentity();
    if (identity.home !== null && identity.home !== "" && text.includes(identity.home)) forbidden.push(identity.home);
    for (const literal of [identity.user, identity.hostname]) {
      if (literal === null || literal === "") continue;
      const bounded = new RegExp(`(?<![A-Za-z0-9])${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`);
      if (bounded.test(text)) forbidden.push(literal);
    }
    for (const literal of denyList) if (literal !== "" && text.includes(literal)) forbidden.push(literal);
  }
  CREDENTIAL_GLOBAL.lastIndex = 0;
  if (forbidden.length > 0) throw new ShareabilityError(name, [...new Set(forbidden)]);
}

/** Locates the first JSON pointer whose string contains one of the matched literals. */
export function locatePrivatePointers(value: unknown, matches: readonly string[], pointer = ""): string[] {
  const found: string[] = [];
  if (typeof value === "string") {
    for (const match of matches) if (value.includes(match)) found.push(pointer);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => found.push(...locatePrivatePointers(item, matches, `${pointer}/${index}`)));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (matches.some((match) => key.includes(match))) found.push(`${pointer}/${key}(key)`);
      found.push(...locatePrivatePointers(item, matches, `${pointer}/${key}`));
    }
  }
  return [...new Set(found)].sort();
}

// ---------------------------------------------------------------------------
// Recursive schema allowlists
// ---------------------------------------------------------------------------

const RUN_KEYS = new Set(["runId", "queryId", "experiment", "arm", "repeat", "seed", "order", "methodSha256", "corpusSha256", "fixtureSha256", "candidateCommit", "lockfileSha256", "host", "effectiveSettings", "toolCatalogueSha256", "promptSha256", "status", "replayValidity", "observerComplete", "mainUsage", "pipelineUsage", "reportedPipelineUsd", "estimatedPipelineUsd", "subscriptionQuota", "artifacts", "error", "rerunOf", "rerunReason", "population", "toolCatalogueObserved", "rerunSeries", "purpose", "partition", "workflow", "mainUsageComplete", "mainInputTotalComplete", "returnedMs", "answerDelivered", "validTaskOutcome", "qualityJudge1", "qualityJudge2", "contextExposure"]);
const DATASET_KEYS = new Set(["schemaVersion", "design", "runs", "quality", "metadataCorrections"]);
const DESIGN_KEYS = new Set(["methodSha256", "corpusSha256", "candidateCommit", "analysisPartition", "populations", "bootstrapSeed", "bootstrapDraws", "confidence", "qualityLossMargin", "humanCalibrationApproved", "humanCalibrationReason", "calibrationBindingSha256"]);
const POPULATION_KEYS = new Set(["queryIds", "repeats", "replayPrimaryQueryIds", "manualReplayQueryIds"]);
const QUALITY_KEYS = new Set(["manifestSha256", "judges", "records", "disagreements", "calibration"]);
const RECORD_KEYS = new Set(["runId", "packetId", "label", "judgeId", "model", "session", "fileSha256", "provenance", "score"]);
const PROVENANCE_KEYS = new Set(["session", "judgeId", "packetId", "calibration", "dryRun", "attemptNumber", "globalClaudeMdSha256", "command", "executable", "args", "cwdIsolated", "toolsDisabled", "environmentKeys", "harnessVersion", "sourceCommit", "packetSha256", "startedAt", "endedAt", "code", "signal", "timedOut", "stdoutSha256", "stderrSha256", "reportedModels", "contextWindows", "provider", "costBasis"]);
const SCORE_KEYS = new Set(["overall", "coverage", "provenance", "limitations", "usefulness", "rationale", "evidenceQuotes", "unmatchedEvidenceQuotes"]);
const DISAGREEMENT_KEYS = new Set(["packetId", "queryId", "population", "repeat", "label", "runId", "arm", "overallDifference", "criterionDifferences"]);
const CALIBRATION_KEYS = new Set(["caseId", "humanVerdict", "judges", "judgesDisagree", "preference", "originalPreference", "rationale", "evidenceQuotes", "unmatchedEvidenceQuotes", "agreesWithHuman", "runId", "judgeId", "model", "session", "fileSha256", "provenance"]);
const CORRECTION_KEYS = new Set(["runId", "field", "recorded", "derived", "sourceFileSha256"]);
const EXPOSURE_KEYS = new Set(["schemaVersion", "measure", "method", "status", "rawPageCharacters", "wholePageCharacters", "quotationCharacters", "observed", "requests", "channels", "perRequest", "sources", "spans", "spanLengths", "diagnostics", "opaqueReasoningItems", "issues", "notices"]);
const EXPOSURE_METHOD_KEYS = new Set(["version", "minimumSpanCharacters", "quotationCeilingCharacters", "quotationPageShare", "classificationProvenance"]);
const EXPOSURE_CHARACTERS_KEYS = new Set(["wholePage", "quotation"]);
const EXPOSURE_CHANNELS = new Set(["toolArguments", "toolResult", "scriptOutput", "error", "spillRead", "assistantText"]);
const EXPOSURE_SOURCE_KEYS = new Set(["url", "sha256", "characters", "origin", "exposed"]);
const EXPOSURE_SPAN_KEYS = new Set(["request", "item", "itemFrom", "itemTo", "channel", "source", "sourceSha256", "pageCharacters", "pageFrom", "pageTo", "characters", "class"]);
const EXPOSURE_DIAGNOSTICS_KEYS = new Set(["gateSkipped", "unscannedRole", "excluded", "urlSubstitutedSources", "nonNfcMaterials", "nonNfcScannedItems"]);
const MAIN_USAGE_KEYS = new Set(["inputTotal", "inputUncached", "outputTotal", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]);
const PIPELINE_TOKEN_KEYS = new Set([...MAIN_USAGE_KEYS, "cacheWrite1h"]);
const PIPELINE_USAGE_KEYS = new Set(["attempts", "costComplete", "estimatedCost", "missingAttempts", "missingTokenFields", "observedAttempts", "parentDelivery", "reportedCost", "tokens"]);
const SETTINGS_KEYS = new Set(["browserFingerprint", "cacheDir", "collateModel", "collationMaxTokens", "defaultUrls", "disableLlmsFullDiscovery", "disableTelemetry", "execution", "extractMaxChars", "extractModel", "extractionConcurrency", "extractionMaxTokens", "fetchConcurrency", "fetchTimeoutMs", "llmRetryAttempts", "llmTimeoutMs", "maxUrls", "minRequestIntervalMs", "retryBaseDelayMs", "retryMaxDelayMs", "searchModel", "searchRetryAttempts", "searchWebSearch"]);
const SETTINGS_EXECUTION_KEYS = new Set(["aggregateFetchConcurrency", "criticalReserve", "deadline", "docsMaxResponseBytes", "fetchMaxChars", "fetchMaxResponseBytes", "lateDrainMs", "modelConcurrency", "pageExecution"]);
const SETTINGS_MODEL_KEYS = new Set(["provider", "model", "api", "baseUrl"]);
const INPUT_ROLES = new Set(["corpus", "protocol", "design-manifest", "environment", "answers", "other"]);

/** Allowed keys for a normalised JSON path with array indices as "*", or null when unconstrained. */
function allowedKeysAt(path: string): Set<string> | null {
  const table: Record<string, Set<string>> = {
    "": DATASET_KEYS,
    "/design": DESIGN_KEYS,
    "/design/populations/*": POPULATION_KEYS,
    "/design/populations/replay": POPULATION_KEYS,
    "/design/populations/live": POPULATION_KEYS,
    "/runs/*": RUN_KEYS,
    "/runs/*/host": new Set(["version", "source", "root", "launcher"]),
    "/runs/*/artifacts/*": new Set(["path", "sha256"]),
    "/runs/*/mainUsage": MAIN_USAGE_KEYS,
    "/runs/*/pipelineUsage": PIPELINE_USAGE_KEYS,
    "/runs/*/pipelineUsage/tokens": PIPELINE_TOKEN_KEYS,
    "/runs/*/effectiveSettings": SETTINGS_KEYS,
    "/runs/*/effectiveSettings/execution": SETTINGS_EXECUTION_KEYS,
    "/runs/*/effectiveSettings/execution/deadline": new Set(["enabled"]),
    "/runs/*/effectiveSettings/searchWebSearch": new Set(["enabled", "engine", "maxResults", "reasoning"]),
    "/runs/*/effectiveSettings/searchModel": SETTINGS_MODEL_KEYS,
    "/runs/*/effectiveSettings/extractModel": SETTINGS_MODEL_KEYS,
    "/runs/*/effectiveSettings/collateModel": SETTINGS_MODEL_KEYS,
    "/runs/*/contextExposure": EXPOSURE_KEYS,
    "/runs/*/contextExposure/method": EXPOSURE_METHOD_KEYS,
    "/runs/*/contextExposure/observed": new Set(["rawPageCharacters", "wholePageCharacters", "quotationCharacters"]),
    "/runs/*/contextExposure/channels": EXPOSURE_CHANNELS,
    "/runs/*/contextExposure/channels/*": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/toolArguments": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/toolResult": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/scriptOutput": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/error": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/spillRead": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/channels/assistantText": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/perRequest/*": new Set(["sequence", ...EXPOSURE_CHARACTERS_KEYS]),
    "/runs/*/contextExposure/sources/*": EXPOSURE_SOURCE_KEYS,
    "/runs/*/contextExposure/sources/*/exposed": EXPOSURE_CHARACTERS_KEYS,
    "/runs/*/contextExposure/spans/*": EXPOSURE_SPAN_KEYS,
    "/runs/*/contextExposure/diagnostics": EXPOSURE_DIAGNOSTICS_KEYS,
    "/runs/*/contextExposure/diagnostics/gateSkipped": new Set(["laterInRequest", "laterRequest", "lostFromHistory", "neverDelivered"]),
    "/runs/*/contextExposure/diagnostics/unscannedRole": new Set(["user", "developer", "system", "instructions", "additionalTools"]),
    "/runs/*/contextExposure/diagnostics/excluded": new Set(["urlOnly", "promptEcho"]),
    "/quality": QUALITY_KEYS,
    "/quality/records/*": RECORD_KEYS,
    "/quality/records/*/provenance": PROVENANCE_KEYS,
    "/quality/records/*/score": SCORE_KEYS,
    "/quality/disagreements/*": DISAGREEMENT_KEYS,
    "/quality/disagreements/*/criterionDifferences": new Set(["coverage", "provenance", "limitations", "usefulness"]),
    "/quality/calibration/*": CALIBRATION_KEYS,
    "/quality/calibration/*/judges/*": CALIBRATION_KEYS,
    "/quality/calibration/*/judges/*/provenance": PROVENANCE_KEYS,
    "/metadataCorrections/*": CORRECTION_KEYS,
  };
  return table[path] ?? null;
}

function normalisePointer(pointer: string): string {
  return pointer.split("/").map((segment) => (/^[0-9]+$/.test(segment) ? "*" : segment)).join("/");
}

/**
 * Dynamic-key maps: the only object boundaries without a key allowlist. Their
 * keys are data (population names, bucket labels, model names), and their
 * values recurse into their own constraints; an object value under a scalar
 * dynamic map still fails, because scalar dynamic maps reject nested objects.
 */
const DYNAMIC_KEYS = new Set(["/runs/*/subscriptionQuota", "/design/populations", "/runs/*/contextExposure/spanLengths", "/quality/records/*/provenance/contextWindows", "/quality/calibration/*/judges/*/provenance/contextWindows", "/runs/*/subscriptionQuota/*"]);
/** Dynamic maps whose values must be scalars (a nested object cannot be a bucket label, a context-window size or a quota-header value). */
const DYNAMIC_SCALAR_KEYS = new Set(["/runs/*/contextExposure/spanLengths", "/quality/records/*/provenance/contextWindows", "/quality/calibration/*/judges/*/provenance/contextWindows", "/runs/*/pipelineUsage/estimatedCost", "/runs/*/pipelineUsage/reportedCost"]);
/** Paths whose values must be scalar: an object in place of a string is a shape mismatch. */
const SCALAR_VALUE_KEYS = new Set(["/quality/judges/*", "/quality/records/*/score/rationale", "/quality/records/*/score/evidenceQuotes/*", "/quality/records/*/score/unmatchedEvidenceQuotes/*", "/quality/calibration/*/judges/*/rationale", "/quality/calibration/*/judges/*/evidenceQuotes/*", "/quality/calibration/*/judges/*/unmatchedEvidenceQuotes/*", "/metadataCorrections/*/recorded", "/metadataCorrections/*/derived"]);

function assertRecursiveAllowlist(value: unknown, pointer: string): void {
  const normalised = normalisePointer(pointer);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRecursiveAllowlist(item, `${pointer}/${index}`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (SCALAR_VALUE_KEYS.has(normalised))
    throw new InvalidPublicationInputError(`Object at ${pointer}: the schema expects a scalar value there, and an object in its place is a shape mismatch`);
  if (DYNAMIC_SCALAR_KEYS.has(normalised))
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      if (typeof item === "object" && item !== null)
        throw new InvalidPublicationInputError(`Nested object at ${pointer}/${key === "" ? "(empty key)" : "(dynamic key)"}: this dynamic-key map accepts scalar values only`);
  const allowed = allowedKeysAt(normalised);
  if (allowed === null && !DYNAMIC_KEYS.has(normalised) && !DYNAMIC_SCALAR_KEYS.has(normalised))
    throw new InvalidPublicationInputError(`Object at ${pointer}: the publication schema allowlist is closed by default and has no entry for this path. Extend the exporter deliberately; unknown objects are never published unseen`);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (allowed !== null && !allowed.has(key))
      throw new InvalidPublicationInputError(`Unknown field "${key}" at ${pointer}/${key}: the publication schema allowlist does not cover it. Extend the exporter deliberately; unknown fields are never published unseen.`);
    assertRecursiveAllowlist((value as Record<string, unknown>)[key], `${pointer}/${key}`);
  }
}

/** Object keys never published, wherever they appear (exact match or sensitive-name pattern). */
const DROPPED_EXACT = new Set(["session", "executable", "args", "launcher", "root", "auth", "apiKey", "apikey", "token", "password", "cookie", "cookies", "authorization", "accessToken", "access_token", "sessionId", "session_id", "hostname", "cwd", "quotaHeaders"]);
const DROPPED_PATTERN = /^(?:x-codex-|x-oai-|x-ratelimit-|openai-)/i;

function dropKey(key: string): boolean {
  const normalised = key.replace(/[_\-\s]/g, "").toLowerCase();
  return DROPPED_EXACT.has(key) || DROPPED_EXACT.has(normalised) || DROPPED_PATTERN.test(key);
}

/** Identity and digest fields are refused rather than silently rewritten. */
function isRefuseRewriteKey(key: string): boolean {
  return ["runId", "queryId", "packetId", "caseId", "judgeId", "model", "id", "label", "arm", "field", "command", "version", "provider", "role"].includes(key) || /sha256$/i.test(key);
}

// ---------------------------------------------------------------------------
// Dataset sanitisation
// ---------------------------------------------------------------------------

export interface PrivateArtifactBinding {
  readonly runId: string;
  readonly privateManifestSha256: string | null;
  /** Null when the retained snapshot digest was the digest of empty input. */
  readonly privateWorkspaceSha256: string | null;
  readonly other: readonly { readonly sha256: string }[];
}

export interface SanitisedDataset {
  readonly dataset: StudyDataset;
  readonly scrub: ScrubReport;
  readonly droppedKeys: Readonly<Record<string, number>>;
  readonly privateArtifacts: readonly PrivateArtifactBinding[];
  readonly degenerateWorkspaceDigests: number;
  readonly removedArtefactPaths: number;
}

const QUOTA_OMISSION: Json = { omitted: "Private account/quota details" };

type RunLike = StudyAnalysisRun & { readonly [extra: string]: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function dropPrivateKeys(value: unknown, counts: Record<string, number>): unknown {
  if (Array.isArray(value)) return value.map((item) => dropPrivateKeys(item, counts));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (dropKey(key)) {
        counts[key] = (counts[key] ?? 0) + 1;
        continue;
      }
      out[key] = dropPrivateKeys(item, counts);
    }
    return out;
  }
  return value;
}

/** Scrubs identity/refuse fields by refusing, everything else by replacement, including object keys. */
function scrubWithRefusal(value: unknown, scrubber: Scrubber, pointer: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => scrubWithRefusal(item, scrubber, `${pointer}/${index}`));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    let index = 0;
    for (const [rawKey, item] of Object.entries(value as Record<string, unknown>)) {
      const keyIndex = index;
      index += 1;
      const key = scrubber.text(rawKey);
      if (key !== rawKey) {
        // Never place the raw (private) key text in the published pointer.
        scrubber.note(`${pointer}/key-${keyIndex}(redacted-key)`);
      }
      if (key in out)
        throw new InvalidPublicationInputError(`Redacted object keys collide at ${pointer}/key-${keyIndex}: two keys scrub to the same marker, which would silently drop a value. Fix the input or extend the exporter`);
      const child = `${pointer}/${key}`;
      if (typeof item === "string" && isRefuseRewriteKey(key)) {
        const candidate = scrubber.text(item);
        if (candidate !== item)
          throw new InvalidPublicationInputError(`Refusing to publish identity field ${child}: its value matches a private pattern. Fix the input or extend the exporter deliberately; identity fields are never rewritten.`);
        out[key] = item;
        continue;
      }
      out[key] = scrubWithRefusal(item, scrubber, child);
    }
    return out;
  }
  if (typeof value === "string") {
    const out = scrubber.text(value);
    if (out !== value) scrubber.note(pointer);
    return out;
  }
  return value;
}

/**
 * Produces the shareable dataset. Run artefacts keep only sha256 digests (moved
 * to the provenance binding; a workspace digest of empty input is published as
 * null and counted); host keeps version and source; a nonempty quota block
 * becomes an omission marker; judge records lose session identifiers,
 * executable paths and argument vectors. Numeric metrics, completeness flags,
 * outcome values and digests are retained; free text and object keys pass the
 * token scrub, with every replacement's pointer recorded and identity fields
 * refused rather than rewritten.
 */
export function sanitiseStudyDataset(input: StudyDataset): SanitisedDataset {
  assertRecursiveAllowlist(input, "");
  const droppedKeyCounts: Record<string, number> = {};
  const scrubber = new Scrubber();
  const bindings: PrivateArtifactBinding[] = [];
  let degenerateWorkspaceDigests = 0;
  let removedArtefactPaths = 0;
  const runs = (input.runs as readonly RunLike[]).map((run) => {
    let manifestSha: string | null = null;
    let workspaceSha: string | null = null;
    const others: { sha256: string }[] = [];
    for (const artifact of run.artifacts) {
      removedArtefactPaths += 1;
      if (artifact.path.endsWith("manifest.json")) {
        if (manifestSha !== null) throw new InvalidPublicationInputError(`Duplicate run manifest artefact at ${run.runId}/artifacts: the private audit trail must bind each digest exactly once`);
        manifestSha = artifact.sha256;
      } else if (artifact.path.endsWith("-workspace")) {
        if (workspaceSha !== null) throw new InvalidPublicationInputError(`Duplicate workspace artefact at ${run.runId}/artifacts: the private audit trail must bind each digest exactly once`);
        workspaceSha = artifact.sha256 === EMPTY_SHA256 ? null : artifact.sha256;
        if (workspaceSha === null) degenerateWorkspaceDigests += 1;
      } else others.push({ sha256: artifact.sha256 });
    }
    bindings.push({ runId: run.runId, privateManifestSha256: manifestSha, privateWorkspaceSha256: workspaceSha, other: others });
    const host = asRecord(run.host) ?? {};
    const sanitisedHost: Record<string, unknown> = {};
    if (typeof host.version === "string") sanitisedHost.version = host.version;
    if (typeof host.source === "string") sanitisedHost.source = host.source;
    const quotaRecord = asRecord(run.subscriptionQuota);
    const quotaArray = Array.isArray(run.subscriptionQuota) ? (run.subscriptionQuota as unknown[]) : null;
    const quotaNonempty = (quotaRecord !== null && Object.keys(quotaRecord).length > 0) || (quotaArray !== null && quotaArray.length > 0);
    const quotaOut: Record<string, unknown> = quotaNonempty ? { ...(QUOTA_OMISSION as Record<string, unknown>) } : {};
    return { ...run, artifacts: [], host: sanitisedHost, subscriptionQuota: quotaOut } as Record<string, unknown>;
  });
  const working: Record<string, unknown> = { ...(input as unknown as Record<string, unknown>), runs };
  const keyed = dropPrivateKeys(working, droppedKeyCounts) as Record<string, unknown>;
  const scrubbed = scrubWithRefusal(keyed, scrubber, "") as StudyDataset;
  return { dataset: scrubbed, scrub: scrubber.report, droppedKeys: droppedKeyCounts, privateArtifacts: bindings, degenerateWorkspaceDigests, removedArtefactPaths };
}

// ---------------------------------------------------------------------------
// Fail-closed writes
// ---------------------------------------------------------------------------

async function writeNewFile(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeNewBytes(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const writeNewJson = (path: string, value: unknown): Promise<void> =>
  writeNewFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** Code-unit comparison: ordering never depends on the process locale. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function listFiles(root: string, prefix = "", seenEmpty = false): Promise<string[]> {
  const names: string[] = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => byCodeUnit(a.name, b.name))) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) names.push(...(await listFiles(root, name, true)));
    else if (entry.isFile()) names.push(name);
    else throw new Error(`Bundle files must be regular files, not links: ${name}`);
  }
  // An empty directory is invisible to a plain file listing; surface it with a
  // trailing separator so verification treats it as unlisted content.
  if (names.length === 0 && seenEmpty) return [`${prefix}${prefix.endsWith("/") ? "" : "/"}`];
  return names;
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

/** Refuses a build target inside a raw study series (a directory holding observations.ndjson). */
export async function assertNotInsideRawSeries(outputDirectory: string): Promise<void> {
  let current = resolve(outputDirectory);
  for (;;) {
    if (await pathExists(join(current, "observations.ndjson")))
      throw new Error(`Refusing to build inside a raw study series: ${current} holds observations.ndjson. Raw series directories are append-only evidence; publish to a new directory outside them.`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Refuses a scratch directory placed inside the bundle it verifies. */
export function assertScratchOutsideBundle(bundleDirectory: string, outputDirectory: string): void {
  const bundle = resolve(bundleDirectory);
  const scratch = resolve(outputDirectory);
  if (scratch === bundle || scratch.startsWith(`${bundle}/`))
    throw new Error(`The verification scratch directory must be outside the bundle: ${outputDirectory} is inside ${bundleDirectory}. Verification output inside the bundle becomes an unlisted file and breaks later verification.`);
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Neutralises spreadsheet-formula prefixes in free text, including after leading whitespace; numbers never pass here. */
function csvFreeText(value: string): string {
  const trimmed = value.replace(/^[ \t]+/, "");
  const needsGuard = /^[=+@]/.test(trimmed) || /^-\D/.test(trimmed);
  return csvCell(needsGuard ? `'${value}` : value);
}

const csvRow = (cells: readonly (string | number | null | undefined | boolean)[]): string =>
  cells.map((cell) => csvCell(cell === null || cell === undefined ? "" : String(cell))).join(",");

// ---------------------------------------------------------------------------
// Analysis helpers
// ---------------------------------------------------------------------------

type Analysis = ReturnType<typeof analyseStudy>;
type Population = "replay" | "live";
const POPULATIONS: readonly Population[] = ["replay", "live"];
const POPULATION_LABEL: Readonly<Record<Population, string>> = { replay: "Controlled Replay", live: "Unforced Live" };

const isMeasuredSeries = (dataset: StudyDataset): boolean => (dataset.design.analysisPartition ?? "measured-series") === "measured-series";
const confidencePercent = (dataset: StudyDataset): string => `${dataset.design.confidence * 100}%`;
const formatProse = (value: number | null | undefined, digits = 3): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "unavailable";
const formatInterval = (lower: number | null | undefined, upper: number | null | undefined): string =>
  typeof lower === "number" && typeof upper === "number" ? `[${lower.toFixed(3)}, ${upper.toFixed(3)}]` : "unavailable";

/** The kernel's paired-sample validity predicate, mirrored for the runs table. */
export function analysisRunValid(run: StudyAnalysisRun, population: Population): boolean {
  return (
    (run.status === "completed" || (run.status === "failed" && run.validTaskOutcome === true)) &&
    run.observerComplete &&
    run.toolCatalogueObserved !== false &&
    (population === "replay" ? run.replayValidity === "valid" : run.replayValidity === "not-replay")
  );
}

function signedMargin(margin: number): string {
  return margin === 0 ? "0" : `-${margin}`;
}

type Metric = Analysis["populations"][Population]["metrics"]["mainInputUncached"];

function tokenClaimSentence(dataset: StudyDataset, population: Population, summary: Analysis["populations"][Population]): string {
  const metric = summary.metrics.mainInputUncached;
  const claims = summary.claimAssessment;
  const percent = confidencePercent(dataset);
  if (claims.tokenClaim === "unavailable") {
    if (!isMeasuredSeries(dataset))
      return `No primary uncached-input claim is available for the ${population} population: the analysis class is "${analysisClassOf(dataset)}". Retained complete-case estimates are diagnostic; missing evidence is not treated as zero.`;
    if (metric.missingQueries.length > 0 || metric.undefinedRatioQueries.length > 0)
      return `The ${population} primary uncached-input interval is unavailable (incomplete population or undefined ratio queries). No token claim is made, and missing evidence is not treated as zero.`;
    return `The ${population} primary uncached-input interval could not be computed (too few evaluable query clusters). No token claim is made.`;
  }
  switch (claims.tokenClaim) {
    case "saving":
      return `The ${population} primary interval supports an uncached-input saving: ratio ${formatProse(metric.ratio)}, ${percent} interval ${formatInterval(metric.interval.lower, metric.interval.upper)}, with the upper bound below 1.`;
    case "increased-input":
      return `The ${population} primary interval shows increased uncached input: ratio ${formatProse(metric.ratio)}, ${percent} interval ${formatInterval(metric.interval.lower, metric.interval.upper)}, with the lower bound above 1.`;
    case "no-demonstrated-effect":
      return `The ${population} primary uncached-input interval includes 1 (ratio ${formatProse(metric.ratio)}, ${percent} interval ${formatInterval(metric.interval.lower, metric.interval.upper)}). No uncached-input change is demonstrated by this interval. This is not proof of no effect and does not determine the result for total input.`;
    default:
      return `The ${population} primary uncached-input interval is below 1, but preserved quality is not established. No quality-gated saving claim is made for this dataset.`;
  }
}

function analysisClassOf(dataset: StudyDataset): string {
  return isMeasuredSeries(dataset) ? "measured-series" : `${dataset.design.analysisPartition ?? "measured-series"}: diagnostic only, not confirmatory`;
}

function qualityClaimSentence(dataset: StudyDataset, population: Population, summary: Analysis["populations"][Population]): string {
  const margin = summary.claimAssessment.qualityLossMargin;
  const rule = `the on-minus-off lower confidence bound above ${signedMargin(margin)} points`;
  if (!isMeasuredSeries(dataset) && summary.claimAssessment.qualityClaim === "insufficient-precision")
    return `No quality claim is available for the ${population} population: the analysis class is "${analysisClassOf(dataset)}". The prespecified preserved-quality rule (${rule}) is not claim evidence outside the measured series.`;
  switch (summary.claimAssessment.qualityClaim) {
    case "preserved":
      return `For the ${population} population, each judge's on-minus-off lower confidence bound is above ${signedMargin(margin)} points (margin ${margin}). This meets the prespecified preserved-quality rule; it does not establish identical quality.`;
    case "meaningful-loss":
      return `For the ${population} population, each judge's on-minus-off upper confidence bound is below ${signedMargin(margin)} points. This supports a meaningful quality loss under the prespecified rule; bounds, not point estimates, carry the claim.`;
    case "judge-conflict":
      return `For the ${population} population, the judges disagree about the quality rule (preserved requires ${rule}). The conflict is reported; the judges are not averaged and neither is selected.`;
    default:
      return `For the ${population} population, the primary quality bounds are unavailable or do not establish either preserved quality (requires ${rule}) or a loss beyond the margin. No quality conclusion is established; this does not demonstrate a small effect.`;
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function exposureField(run: RunLike, field: string): number | null {
  const exposure = asRecord(run.contextExposure);
  const value = exposure === null ? undefined : exposure[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function exposureStatus(run: RunLike): string {
  const exposure = asRecord(run.contextExposure);
  if (exposure === null) return "absent";
  return typeof exposure.status === "string" ? exposure.status : "unavailable";
}

function observedExposure(run: RunLike, field: string): number | null {
  const exposure = asRecord(run.contextExposure);
  const observed = exposure === null ? null : asRecord(exposure.observed);
  const value = observed === null ? undefined : observed[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function runsTable(dataset: StudyDataset): string {
  const header = [
    "run_id", "query_id", "population", "partition", "workflow", "arm", "repeat", "purpose", "status", "rerun_of",
    "analysis_valid", "replay_validity", "observer_complete", "tool_catalogue_observed", "main_usage_complete", "main_input_total_complete",
    "input_total", "input_uncached", "cache_read", "cache_write", "returned_ms", "reported_pipeline_usd", "estimated_pipeline_usd",
    "quality_judge_1", "quality_judge_2", "answer_delivered", "valid_task_outcome", "failed_run_valid_outcome",
    "exposure_status", "raw_page_characters", "whole_page_characters", "short_run_characters",
    "observed_raw_page_characters", "observed_whole_page_characters", "observed_short_run_characters", "error",
  ];
  const rows = dataset.runs.map((rawRun) => {
    const run = rawRun as RunLike;
    const population = run.population === "replay" ? "replay" : "live";
    const status = exposureStatus(run);
    const error = typeof run.error === "string" ? (run.error.length > 200 ? `${run.error.slice(0, 200)}…[truncated]` : run.error) : "";
    return [
      csvRow([run.runId, run.queryId, run.population, run.partition, run.workflow, run.arm, run.repeat,
        run.purpose ?? "comparative-task", run.status, run.rerunOf ?? "",
        analysisRunValid(rawRun, population), run.replayValidity, run.observerComplete,
        run.toolCatalogueObserved === undefined ? "" : run.toolCatalogueObserved, run.mainUsageComplete, run.mainInputTotalComplete]),
      csvRow([
        run.mainInputTotalComplete ? run.mainUsage?.inputTotal ?? null : null,
        run.mainUsageComplete ? run.mainUsage?.inputUncached ?? null : null,
        run.mainUsageComplete ? run.mainUsage?.cacheRead ?? null : null,
        run.mainUsageComplete ? run.mainUsage?.cacheWrite ?? null : null,
        population === "live" ? run.returnedMs : null,
        run.reportedPipelineUsd, run.estimatedPipelineUsd,
        dataset.design.humanCalibrationApproved ? run.qualityJudge1 : null,
        dataset.design.humanCalibrationApproved ? run.qualityJudge2 : null,
        run.answerDelivered, run.validTaskOutcome,
        run.status === "failed" ? run.validTaskOutcome : null,
      ]),
      csvRow([
        status,
        status === "complete" ? exposureField(run, "rawPageCharacters") : null,
        status === "complete" ? exposureField(run, "wholePageCharacters") : null,
        status === "complete" ? exposureField(run, "quotationCharacters") : null,
        status === "incomplete" ? observedExposure(run, "rawPageCharacters") : null,
        status === "incomplete" ? observedExposure(run, "wholePageCharacters") : null,
        status === "incomplete" ? observedExposure(run, "quotationCharacters") : null,
      ]),
      csvFreeText(error),
    ].join(",");
  });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

/** Full precision: claim columns are decided on unrounded values, so the table must carry them. */
function claimsTable(dataset: StudyDataset, analysis: Analysis): string {
  const header = ["population", "analysis_class", "primary_available", "total_primary_available", "token_claim", "fifty_percent_hypothesis", "quality_claim", "overall_saving_claim", "quality_loss_margin", "uncached_ratio", "uncached_lower", "uncached_upper", "total_ratio", "total_lower", "total_upper"];
  const full = (value: number | null | undefined): string => (typeof value === "number" && Number.isFinite(value) ? String(value) : "");
  const rows = POPULATIONS.map((population) => {
    const summary = analysis.populations[population];
    const claims = summary.claimAssessment;
    const uncached = summary.metrics.mainInputUncached;
    const total = summary.metrics.mainInputTotal;
    return csvRow([
      population, analysis.analysisClass, summary.metrics.mainInputUncached.primaryAvailable ? "true" : "false", summary.metrics.mainInputTotal.primaryAvailable ? "true" : "false",
      claims.tokenClaim, claims.fiftyPercentHypothesis, claims.qualityClaim, claims.overallSavingClaim,
      claims.qualityLossMargin,
      full(uncached.ratio), full(uncached.interval.lower), full(uncached.interval.upper),
      full(total.ratio), full(total.interval.lower), full(total.interval.upper),
    ]);
  });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

function outcomesTable(analysis: Analysis): string {
  const header = ["population", "expected_primary_runs", "observed_original_runs", "completed", "failed", "aborted", "not_started"];
  const rows = POPULATIONS.map((population) => {
    const summary = analysis.populations[population];
    return csvRow([population, summary.expectedRuns, summary.observedOriginalRuns, summary.outcomes.completed, summary.outcomes.failed, summary.outcomes.aborted, summary.outcomes["not-started"]]);
  });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

/** Originals only: the kernel's analysis selection (partition, off/on arms, no reruns, comparative purpose). */
function analysisOriginals(dataset: StudyDataset): readonly StudyAnalysisRun[] {
  const partition = dataset.design.analysisPartition ?? "measured-series";
  return dataset.runs.filter(
    (run) => run.partition === partition && (run.arm === "off" || run.arm === "on") && !run.rerunOf && run.purpose !== "fixture-capture" && run.purpose !== "synthetic-driver-integration",
  );
}

function judgesTable(dataset: StudyDataset): string | null {
  const quality = dataset.quality;
  if (!quality || (quality.records as unknown[]).length === 0) return null;
  const header = ["run_id", "query_id", "population", "partition", "arm", "packet_id", "judge_id", "label", "overall", "coverage", "criterion_provenance", "limitations", "usefulness"];
  const byRun = new Map(dataset.runs.map((run) => [run.runId, run]));
  const rows = [...(quality.records as unknown[])]
    .map((raw) => raw as { runId?: string; packetId?: string; judgeId?: string; label?: string; score?: { overall?: number; coverage?: number; provenance?: number; limitations?: number; usefulness?: number } })
    .sort((a, b) => byCodeUnit(a.runId ?? "", b.runId ?? "") || byCodeUnit(a.judgeId ?? "", b.judgeId ?? ""))
    .map((record) => {
      const run = byRun.get(record.runId ?? "");
      return csvRow([
        record.runId ?? "", run?.queryId ?? "", run?.population ?? "", run?.partition ?? "", run?.arm ?? "",
        record.packetId ?? "", record.judgeId ?? "", record.label ?? "",
        record.score?.overall ?? null, record.score?.coverage ?? null, record.score?.provenance ?? null,
        record.score?.limitations ?? null, record.score?.usefulness ?? null,
      ]);
    });
  return [csvRow(header), ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// SVG figures (deterministic, dependency-free)
// ---------------------------------------------------------------------------

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function svgText(x: number, y: number, text: string, options: { anchor?: string; size?: number; fill?: string; weight?: string; transform?: string } = {}): string {
  const attrs = [
    `x="${x.toFixed(1)}"`, `y="${y.toFixed(1)}"`, `font-size="${options.size ?? 12}"`, `text-anchor="${options.anchor ?? "start"}"`, `fill="${options.fill ?? "#111827"}"`,
    ...(options.weight ? [`font-weight="${options.weight}"`] : []), ...(options.transform ? [`transform="${options.transform}"`] : []),
  ];
  return `<text ${attrs.join(" ")}>${escapeXml(text)}</text>`;
}

function emptyFigure(title: string, message: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="440" viewBox="0 0 760 440" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="760" height="440" fill="#ffffff"/>`,
    svgText(24, 34, title, { size: 15, weight: "600" }),
    svgText(380, 220, message, { anchor: "middle", size: 14, fill: "#6b7280" }),
    `</svg>`,
    ``,
  ].join("\n");
}

/** Population completeness is a property of the paired population, not of the bounds. */
function figureAvailability(metric: Metric): string {
  return metric.primaryAvailable ? "Primary Population Complete" : "Diagnostic Only; Not Claim Evidence";
}

function pairedMeansFigure(dataset: StudyDataset, population: Population, metric: Metric, endpoint: "mainInputUncached" | "mainInputTotal"): string {
  const partition = dataset.design.analysisPartition ?? "measured-series";
  const endpointLabel = endpoint === "mainInputUncached" ? "uncached input tokens" : "total input tokens";
  const title = `${population}: ${partition} paired query means`;
  const subtitle = `${endpointLabel}, off vs on; ${figureAvailability(metric)}`;
  const pairs = [...metric.pairs].sort((a, b) => byCodeUnit(a.queryId, b.queryId));
  if (pairs.length === 0) return emptyFigure(`${title} (${subtitle})`, "No evaluable paired queries");
  const width = 760; const height = 440; const left = 70; const right = 24; const top = 70; const bottom = 90;
  const max = Math.max(...pairs.flatMap((pair) => [pair.controlMean, pair.treatmentMean]));
  const yMax = max > 0 ? max * 1.08 : 1;
  const x = (i: number): number => left + ((width - left - right) * (pairs.length === 1 ? 0.5 : i / (pairs.length - 1)));
  const y = (v: number): number => top + (height - top - bottom) * (1 - v / yMax);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    svgText(24, 34, title, { size: 15, weight: "600" }),
    svgText(24, 52, subtitle, { size: 12, fill: "#6b7280" }),
  ];
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (yMax * tick) / 4;
    const yy = y(value);
    parts.push(`<line x1="${left}" y1="${yy.toFixed(1)}" x2="${width - right}" y2="${yy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(svgText(left - 8, yy + 4, String(Math.round(value)), { anchor: "end", size: 11, fill: "#6b7280" }));
  }
  pairs.forEach((pair, i) => {
    const xx = x(i);
    parts.push(`<line x1="${xx.toFixed(1)}" y1="${y(pair.controlMean).toFixed(1)}" x2="${xx.toFixed(1)}" y2="${y(pair.treatmentMean).toFixed(1)}" stroke="#9ca3af" stroke-width="1.5"/>`);
    parts.push(`<circle cx="${xx.toFixed(1)}" cy="${y(pair.controlMean).toFixed(1)}" r="4" fill="#4b5563"/>`);
    parts.push(`<circle cx="${xx.toFixed(1)}" cy="${y(pair.treatmentMean).toFixed(1)}" r="4" fill="#2563eb"/>`);
    parts.push(svgText(xx, height - bottom + 34, pair.queryId, { anchor: "end", size: 10, fill: "#374151", transform: `rotate(-35 ${xx.toFixed(1)} ${height - bottom + 34})` }));
  });
  parts.push(svgText(16, height - 18, `query clusters: ${pairs.length}; missing queries: ${metric.missingQueries.length}; undefined ratio queries: ${metric.undefinedRatioQueries.length}`, { size: 11, fill: "#6b7280" }));
  parts.push(svgText(width - right - 210, 40, "● off (control)", { size: 11, fill: "#4b5563" }));
  parts.push(svgText(width - right - 100, 40, "● on (treatment)", { size: 11, fill: "#2563eb" }));
  parts.push(`</svg>`, ``);
  return parts.join("\n");
}

function intervalFigure(dataset: StudyDataset, population: Population, summary: Analysis["populations"][Population]): string {
  const partition = dataset.design.analysisPartition ?? "measured-series";
  const title = `${population}: ${partition} input-token ratios`;
  const rows: { label: string; metric: Metric }[] = [
    { label: "uncached input (primary)", metric: summary.metrics.mainInputUncached },
    { label: "total input (secondary)", metric: summary.metrics.mainInputTotal },
  ];
  if (rows.every((row) => row.metric.interval.lower === null && row.metric.interval.upper === null && row.metric.diagnosticInterval.lower === null && row.metric.diagnosticInterval.upper === null))
    return emptyFigure(title, "No interval is available for this population");
  const percent = confidencePercent(dataset);
  const subtitle = `on relative to off; ${percent} intervals; endpoint availability below`;
  const width = 760; const height = 300; const left = 210; const right = 40; const top = 70;
  const bounds = rows.flatMap((row) => [row.metric.interval.lower, row.metric.interval.upper, row.metric.diagnosticInterval.lower, row.metric.diagnosticInterval.upper].filter((v): v is number => v !== null));
  const lo = Math.min(0.4, ...bounds);
  const hi = Math.max(1.6, ...bounds);
  const x = (v: number): number => left + ((width - left - right) * (v - lo)) / (hi - lo);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    svgText(24, 34, title, { size: 15, weight: "600" }),
    svgText(24, 52, subtitle, { size: 12, fill: "#6b7280" }),
  ];
  parts.push(`<line x1="${x(1).toFixed(1)}" y1="${top - 16}" x2="${x(1).toFixed(1)}" y2="${height - 46}" stroke="#111827" stroke-width="1.5"/>`);
  parts.push(svgText(x(1) + 4, top - 20, "1.0", { size: 11, fill: "#111827" }));
  parts.push(`<line x1="${x(0.5).toFixed(1)}" y1="${top - 16}" x2="${x(0.5).toFixed(1)}" y2="${height - 46}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4 3"/>`);
  parts.push(svgText(x(0.5) + 4, top - 20, "0.5 hypothesis", { size: 11, fill: "#6b7280" }));
  rows.forEach((row, index) => {
    const cy = top + 40 + index * 90;
    parts.push(svgText(left - 10, cy + 4, row.label, { anchor: "end", size: 12 }));
    // Primary bounds carry the bar; when they are unavailable the complete-case
    // diagnostic bounds do, labelled as diagnostic.
    // The label follows the kernel's primary-availability flag, not bound
    // existence: a complete pilot has bounds that are not claim evidence.
    const hasPrimaryBounds = row.metric.interval.lower !== null && row.metric.interval.upper !== null;
    const hasDiagnosticBounds = row.metric.diagnosticInterval.lower !== null && row.metric.diagnosticInterval.upper !== null;
    const boundsNow = hasPrimaryBounds ? row.metric.interval : hasDiagnosticBounds ? row.metric.diagnosticInterval : null;
    if (boundsNow !== null && boundsNow.lower !== null && boundsNow.upper !== null) {
      const kind = row.metric.primaryAvailable && hasPrimaryBounds ? `${percent} primary interval` : `${percent} complete-case diagnostic interval`;
      parts.push(`<line x1="${x(boundsNow.lower).toFixed(1)}" y1="${cy}" x2="${x(boundsNow.upper).toFixed(1)}" y2="${cy}" stroke="#2563eb" stroke-width="3"/>`);
      parts.push(`<line x1="${x(boundsNow.lower).toFixed(1)}" y1="${cy - 7}" x2="${x(boundsNow.lower).toFixed(1)}" y2="${cy + 7}" stroke="#2563eb" stroke-width="2"/>`);
      parts.push(`<line x1="${x(boundsNow.upper).toFixed(1)}" y1="${cy - 7}" x2="${x(boundsNow.upper).toFixed(1)}" y2="${cy + 7}" stroke="#2563eb" stroke-width="2"/>`);
      if (row.metric.ratio !== null) parts.push(`<circle cx="${x(row.metric.ratio).toFixed(1)}" cy="${cy}" r="4.5" fill="#1d4ed8"/>`);
      parts.push(svgText(left, cy + 26, `ratio ${formatProse(row.metric.ratio)}; ${kind} ${formatInterval(boundsNow.lower, boundsNow.upper)}; ${figureAvailability(row.metric)}`, { size: 11, fill: "#374151" }));
    } else {
      // Absence must not reuse the interval stroke: no rule is drawn.
      parts.push(svgText(left, cy + 4, `Interval unavailable; paired queries: ${row.metric.pairs.length}; missing queries: ${row.metric.missingQueries.length}. No interval-based claim.`, { size: 11, fill: "#6b7280" }));
    }
  });
  for (let value = 0.5; value <= hi + 1e-9; value += 0.5) {
    if (value < lo) continue;
    parts.push(`<line x1="${x(value).toFixed(1)}" y1="${height - 46}" x2="${x(value).toFixed(1)}" y2="${height - 42}" stroke="#111827" stroke-width="1"/>`);
    parts.push(svgText(x(value), height - 26, value.toFixed(1), { anchor: "middle", size: 11, fill: "#374151" }));
  }
  parts.push(svgText((left + width - right) / 2, height - 8, "geometric mean of per-query on/off ratios (axis linear)", { anchor: "middle", size: 11, fill: "#6b7280" }));
  parts.push(`</svg>`, ``);
  return parts.join("\n");
}

/** Judge score distributions for analysis originals, one panel per population. */
function qualityFigure(dataset: StudyDataset): string {
  const partition = dataset.design.analysisPartition ?? "measured-series";
  const title = `Judge overall scores by arm and population (${partition}; originals; descriptive)`;
  const originals = analysisOriginals(dataset);
  const scored = dataset.design.humanCalibrationApproved
    ? originals.filter((run) => run.qualityJudge1 !== null || run.qualityJudge2 !== null)
    : [];
  if (scored.length === 0) return emptyFigure(title, "No judge scores pass this figure's approval and availability gates");
  const width = 760; const height = 460; const left = 56; const right = 20; const top = 92; const bottom = 116;
  const panelWidth = (width - left - right) / POPULATIONS.length;
  const groupsFor = (population: Population): { label: string; key: "qualityJudge1" | "qualityJudge2"; arm: "off" | "on"; values: number[] }[] =>
    (["qualityJudge1", "qualityJudge2"] as const).flatMap((key) =>
      (["off", "on"] as const).map((arm) => ({
        label: `${key === "qualityJudge1" ? "judge 1" : "judge 2"}, ${arm}`,
        key, arm,
        // The denominator counts exactly the values the bars can draw.
        values: scored.filter((run) => run.population === population && run.arm === arm && typeof run[key] === "number" && Number.isInteger(run[key]) && run[key]! >= 0 && run[key]! <= 4).map((run) => run[key] as number),
      })),
    );
  const allGroups = POPULATIONS.flatMap(groupsFor);
  const max = Math.max(1, ...allGroups.map((group) => group.values.length));
  const y = (v: number): number => top + (height - top - bottom) * (1 - v / max);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    svgText(24, 34, title, { size: 15, weight: "600" }),
    svgText(24, 52, "overall score 0 to 4; claims live in tables/claims.csv, not here", { size: 12, fill: "#6b7280" }),
  ];
  const tickStep = Math.max(1, Math.ceil(max / 8));
  for (let tick = 0; tick <= max; tick += tickStep) {
    const yy = y(tick);
    parts.push(`<line x1="${left}" y1="${yy.toFixed(1)}" x2="${width - right}" y2="${yy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(svgText(left - 8, yy + 4, String(tick), { anchor: "end", size: 11, fill: "#6b7280" }));
  }
  POPULATIONS.forEach((population, panelIndex) => {
    const panelLeft = left + panelIndex * panelWidth;
    const groups = groupsFor(population);
    const barWidth = (panelWidth - 40) / groups.length / 6;
    parts.push(svgText(panelLeft + panelWidth / 2, top - 16, POPULATION_LABEL[population], { anchor: "middle", size: 12, weight: "600" }));
    if (groups.every((group) => group.values.length === 0)) {
      parts.push(svgText(panelLeft + panelWidth / 2, (top + height - bottom) / 2, "No scored original runs in this export", { anchor: "middle", size: 12, fill: "#6b7280" }));
      return;
    }
    groups.forEach((group, groupIndex) => {
      const counts = new Map<number, number>([0, 1, 2, 3, 4].map((score) => [score, 0]));
      for (const value of group.values) counts.set(value, (counts.get(value) ?? 0) + 1);
      const groupCentre = panelLeft + 20 + (groupIndex + 0.5) * ((panelWidth - 40) / groups.length);
      for (let score = 0; score <= 4; score += 1) {
        const count = counts.get(score) ?? 0;
        if (count === 0) continue;
        const barX = groupCentre - (2.5 - score) * barWidth * 1.15;
        const topY = y(count);
        parts.push(`<rect x="${barX.toFixed(1)}" y="${topY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(y(0) - topY).toFixed(1)}" fill="${group.arm === "off" ? "#4b5563" : "#2563eb"}"/>`);
        parts.push(svgText(barX + barWidth / 2, topY - 4, String(count), { anchor: "middle", size: 9, fill: "#374151" }));
        parts.push(svgText(barX + barWidth / 2, y(0) + 14, String(score), { anchor: "middle", size: 10, fill: "#6b7280" }));
      }
      parts.push(svgText(groupCentre, height - bottom + 32, group.label, { anchor: "middle", size: 10, fill: "#111827" }));
      parts.push(svgText(groupCentre, height - bottom + 46, `n=${group.values.length}`, { anchor: "middle", size: 10, fill: "#6b7280" }));
    });
  });
  parts.push(svgText(16, height - 12, `scored analysis originals: ${scored.length}; n counts the integer 0 to 4 scores each group's bars draw`, { size: 11, fill: "#6b7280" }));
  parts.push(`</svg>`, ``);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Inputs manifest (optional publication inputs)
// ---------------------------------------------------------------------------

export interface PublicationInputs {
  readonly schemaVersion: 1;
  readonly metadata: { readonly mainModel?: { readonly provider: string; readonly id: string; readonly billing?: string } };
  readonly files: readonly { readonly name: string; readonly sha256: string; readonly role: "corpus" | "protocol" | "design-manifest" | "environment" | "answers" | "other" }[];
}

export interface LoadedInputs {
  readonly manifest: PublicationInputs;
  /** Bundle-relative manifest recorded inside the bundle, without private source paths. */
  readonly bundleManifest: Json;
  readonly mainModel: { readonly provider: string; readonly id: string; readonly billing?: string } | null;
}

const INPUT_METADATA_KEYS = new Set(["mainModel"]);

async function loadInputs(inputsPath: string, dataset: StudyDataset): Promise<LoadedInputs> {
  const bytes = await readFile(inputsPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new InvalidPublicationInputError(`Inputs manifest ${inputsPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = parsed as PublicationInputs;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new InvalidPublicationInputError("Inputs manifest must be schemaVersion 1 with a files array");
  const metadata = asRecord(manifest.metadata);
  if (metadata !== null)
    for (const key of Object.keys(metadata))
      if (!INPUT_METADATA_KEYS.has(key))
        throw new InvalidPublicationInputError(`Unknown inputs manifest metadata key "${key}"; only mainModel is accepted`);
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (isAbsolute(file.name) || file.name.split("/").includes("..")) throw new InvalidPublicationInputError(`Inputs manifest name must be bundle-relative: ${file.name}`);
    if (file.name.includes("/")) throw new InvalidPublicationInputError(`Inputs manifest names must be flat (no subdirectories): ${file.name}. Place each file directly beside the manifest`);
    if (file.name === "manifest.json") throw new InvalidPublicationInputError(`Inputs manifest name "manifest.json" is reserved for the manifest itself; choose another name`);
    if (seen.has(file.name)) throw new InvalidPublicationInputError(`Duplicate inputs manifest name: ${file.name}`);
    seen.add(file.name);
    if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new InvalidPublicationInputError(`Inputs manifest sha256 must be a 64-character hexadecimal digest for ${file.name}`);
    if (!INPUT_ROLES.has(file.role)) throw new InvalidPublicationInputError(`Inputs manifest role "${file.role}" for ${file.name} is not one of: ${[...INPUT_ROLES].join(", ")}`);
    const contentPath = join(dirname(inputsPath), file.name);
    let content: Buffer;
    try {
      content = await readFile(contentPath);
    } catch (error) {
      throw new InvalidPublicationInputError(`Inputs file ${file.name} was not found beside the manifest (${(error as NodeJS.ErrnoException).code ?? "error"}); place each declared file next to the inputs manifest`);
    }
    if (sha256Bytes(content) !== file.sha256)
      throw new InvalidPublicationInputError(`Inputs file ${file.name} does not match its declared sha256; the manifest and the file disagree`);
    if (file.role === "corpus" && sha256Bytes(content) !== dataset.design.corpusSha256)
      throw new InvalidPublicationInputError(`Inputs corpus ${file.name} does not match the dataset's frozen corpusSha256. The dataset binds the corpus revision used for measurement; supply that revision's file, not the current tree's`);
    // Byte check over a decoded string: invalid UTF-8 becomes replacement
    // characters, so ASCII-shaped patterns in binary inputs are still caught
    // while compressed content may hide patterns from it.
    assertShareableText(`inputs/${file.name}`, content.toString("utf8"), "build");
  }
  const mainModel = manifest.metadata?.mainModel ?? null;
  if (mainModel !== null) {
    for (const key of Object.keys(mainModel as unknown as Record<string, unknown>)) {
      if (!["provider", "id", "billing"].includes(key)) throw new InvalidPublicationInputError(`Inputs manifest metadata.mainModel key "${key}" is not one of provider, id, billing`);
    }
    if (typeof mainModel.provider !== "string" || typeof mainModel.id !== "string" || mainModel.provider === "" || mainModel.id === "")
      throw new InvalidPublicationInputError("Inputs manifest metadata.mainModel requires nonempty provider and id");
  }
  return {
    manifest,
    bundleManifest: {
      schemaVersion: 1,
      metadata: manifest.metadata ?? {},
      files: manifest.files.map((file) => ({ name: file.name, role: file.role, sha256: file.sha256 })).sort((a, b) => byCodeUnit(a.name, b.name)),
    },
    mainModel,
  };
}

// ---------------------------------------------------------------------------
// Derived JSON and markdown
// ---------------------------------------------------------------------------

function environmentRecord(dataset: StudyDataset, analysis: Analysis, inputs: LoadedInputs | null): Json {
  const hostKeys = new Set<string>();
  const hosts: { version: string; source?: string }[] = [];
  for (const run of dataset.runs) {
    const version = typeof run.host.version === "string" ? run.host.version : null;
    const source = typeof run.host.source === "string" ? run.host.source : undefined;
    if (version === null) continue;
    const key = `${version}|${source ?? ""}`;
    if (hostKeys.has(key)) continue;
    hostKeys.add(key);
    hosts.push(source === undefined ? { version } : { version, source });
  }
  const modelKeys = new Set<string>();
  const pipelineModels: { role: string; provider: string | null; model: string | null }[] = [];
  for (const run of dataset.runs) {
    const settings = run.effectiveSettings as Record<string, unknown> | null;
    if (!settings) continue;
    for (const role of ["searchModel", "extractModel", "collateModel"]) {
      const model = settings[role];
      if (typeof model === "object" && model !== null && !Array.isArray(model)) {
        const entry = model as Record<string, unknown>;
        const provider = typeof entry.provider === "string" ? entry.provider : null;
        const id = typeof entry.model === "string" ? entry.model : null;
        const key = `${role}:${provider ?? ""}:${id ?? ""}`;
        if (modelKeys.has(key)) continue;
        modelKeys.add(key);
        pipelineModels.push({ role: role.replace("Model", ""), provider, model: id });
      }
    }
  }
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    edition: PUBLICATION_EDITION,
    analysisClass: analysis.analysisClass,
    recordedExperimentalCommit: dataset.design.candidateCommit,
    lockfileSha256: [...new Set(dataset.runs.map((run) => run.lockfileSha256))].sort(),
    hosts,
    pipelineModels,
    judges: dataset.quality?.judges ?? [],
    mainModel: inputs?.mainModel ?? null,
    mainModelNote: inputs?.mainModel
      ? "Declared in the inputs manifest; not verified against run data."
      : "The frozen dataset schema does not carry the main-model identity. Supply it through the inputs manifest, or verify it against the pinned protocol in the retained repository.",
    analysisCommand: "node --import tsx source/study-analysis.ts dataset.json ../analysis-check",
  };
}

function omissionsRecord(dataset: StudyDataset, inputs: LoadedInputs | null): Json {
  const roles = new Set<string>((inputs?.manifest.files ?? []).map((file) => file.role));
  const hasRole = (role: string): boolean => roles.has(role);
  const omissions: string[] = [
    "Local host and executable paths",
    "Private account and quota headers (nonempty subscriptionQuota blocks are replaced by an omission marker)",
    "Judge session identifiers, judge executable paths and launch arguments",
    "Private run artefact locations: digests are retained in provenance.json",
    "Private raw sessions, request captures, workspace snapshots and replay fixtures",
    hasRole("corpus")
      ? "Corpus: supplied through the inputs manifest, hash-bound to the dataset's frozen corpusSha256"
      : "Corpus and task inputs: no corpus attachment supplied; the dataset's corpusSha256 identifies the required corpus bytes. Supply that revision rather than assuming the current tree's corpus matches",
    hasRole("protocol") ? "Protocol document: supplied through the inputs manifest" : "Protocol document: not supplied through the inputs manifest",
    hasRole("design-manifest") ? "Design manifest: supplied through the inputs manifest" : "Design manifest: not supplied through the inputs manifest",
    hasRole("environment") ? "Environment metadata attachment: supplied through the inputs manifest" : "Environment metadata attachment: not supplied through the inputs manifest",
    hasRole("other") ? "Additional attachments: an other-role input was supplied; inspect inputs/manifest.json" : "Additional attachments: none supplied beyond the named roles",
    hasRole("answers")
      ? "Full final answers: supplied as an attachment; judge passages in dataset.json may have been sanitised and do not substitute for them"
      : "Full final answers are not fields of StudyDataset and are not attached. Judge rationales and evidence quotes contain answer passages that may have been sanitised, not guaranteed verbatim transcripts; they do not substitute for full answers. Final answer assembly remains coordinator-owned",
    inputs?.mainModel
      ? "Main-model identity: declared in the inputs manifest (not verified against run data)"
      : "Main-model identity: not a field of the frozen dataset schema and not supplied by an inputs manifest",
  ];
  if (!dataset.quality || (dataset.quality.records as unknown[]).length === 0)
    omissions.push("Judge-record table: the dataset has no quality block or its quality-record list is empty");
  if (!dataset.design.humanCalibrationApproved)
    omissions.push(`Quality inference: human calibration approval is false (${dataset.design.humanCalibrationReason ?? "reason not recorded"}). Primary quality claims, the per-run summary score columns and the quality figure are withheld; supplied scores can remain in dataset.json and tables/judges.csv`);
  if (dataset.design.calibrationBindingSha256)
    omissions.push(`Calibration visibility: admitted through ${dataset.design.humanCalibrationReason} using corpus-revision-binding.json (sha256 ${dataset.design.calibrationBindingSha256}). The binding records a blob-level comparison showing unchanged rubric and in-scope task material and cites the owner-approved carry-over. It does not establish judge reliability or answer-quality preservation`);
  const statuses = new Set(dataset.runs.map((run) => exposureStatus(run as RunLike)));
  const records = [...statuses].filter((status) => status !== "absent");
  if (records.length === 0)
    omissions.push("Context-exposure records: no run carries a contextExposure object, so numeric exposure columns are empty and exposure_status is absent");
  else if (statuses.has("incomplete"))
    omissions.push("Context-exposure incomplete records: totals are withheld and only recorded observed lower bounds are published for those runs");
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    edition: PUBLICATION_EDITION,
    redactionPolicy: [
      { item: "Local-root, multi-segment absolute, UNC, drive-letter, tilde, $HOME, percent-encoded and file-URL path tokens", effect: "Replaced whole, including in additive fields, free text, URL paths and key=value forms; identity and digest fields refuse publication instead. Single-segment tokens and API routes such as /v1 are left alone" },
      { item: "Session identifiers", effect: "UUID-shaped identifiers are replaced globally in string values and dropped by key wherever they appear" },
      { item: "Credentials", effect: "Recognised credential shapes (token prefixes, authorization headers, key=value secrets, PEM private keys, JWTs) are replaced globally; this is a pattern check, not a guarantee that every private string is caught. Inspect the bundle before sharing" },
      { item: "Per-run quota headers", effect: "Nonempty blocks are replaced by an omission marker; plan identity and request identifiers stay private" },
      { item: "Judge launch details", effect: "Session ids, executable paths and argument vectors are removed; harness versions, packet and score hashes are retained" },
      { item: "Judge start and end times", effect: "Retained from the input dataset as judge provenance, not generated by the exporter. Other dated material can also remain in supplied inputs" },
      { item: "Operator identity", effect: "The live username, home directory, hostname and an optional build-time deny list are checked when the bundle is built; a configured deny file that cannot be read refuses the build rather than silently emptying the list. Verification applies host-independent patterns only, including recognised URL patterns for private, loopback and tailnet hosts" },
    ],
    omitted: omissions,
    effect:
      "The bundle regenerates the numerical analysis, claim states, completeness summaries and supplied quality-score records from dataset.json and, for input-dependent disclosures and environment fields, inputs/manifest.json when present, without model calls. It does not independently verify the observations against private requests, source-backed judging packets or captured pages. Sanitisation can leave redaction markers in settings and judge text; recorded scrub locations and aggregate dropped-key counts are in provenance.json. This record is a policy and omission list, not a field-by-field audit. Inspect the bundle before sharing.",
  };
}

function exposureSummary(dataset: StudyDataset): { statuses: Record<string, number>; totals: { raw: number; wholePage: number; shortRun: number; runs: number } | null } | null {
  const records = dataset.runs.map((run) => run as RunLike).filter((run) => asRecord(run.contextExposure) !== null);
  if (records.length === 0) return null;
  const statuses: Record<string, number> = {};
  let raw = 0; let wholePage = 0; let shortRun = 0; let runs = 0;
  for (const run of records) {
    const status = exposureStatus(run);
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (status === "complete") {
      raw += exposureField(run, "rawPageCharacters") ?? 0;
      wholePage += exposureField(run, "wholePageCharacters") ?? 0;
      shortRun += exposureField(run, "quotationCharacters") ?? 0;
      runs += 1;
    }
  }
  return { statuses, totals: runs > 0 ? { raw, wholePage, shortRun, runs } : null };
}

function reportMarkdown(dataset: StudyDataset, analysis: Analysis, inputs: LoadedInputs | null): string {
  const partition = dataset.design.analysisPartition ?? "measured-series";
  const percent = confidencePercent(dataset);
  const lines: string[] = [];
  const push = (text = "") => lines.push(text);
  push(`# Codemode Study Analysis Summary`);
  push();
  push(`Edition \`${PUBLICATION_EDITION}\`. Analysis class: ${analysis.analysisClass}. Recorded experimental commit: \`${dataset.design.candidateCommit}\`. This generated summary renders the analysis kernel's claim states; it does not establish that a declared measured-series dataset was independently collected, and it is not the final study report. The final report is authored from this bundle after independent review.`);
  push();
  push(`## Scope and Identity`);
  push();
  push(`| Field | Value |`);
  push(`|---|---|`);
  push(`| Dataset Schema | ${dataset.schemaVersion} |`);
  push(`| Analysis Partition | ${partition} |`);
  push(`| Method and Corpus Hashes | \`${dataset.design.methodSha256.slice(0, 16)}…\`, \`${dataset.design.corpusSha256.slice(0, 16)}…\` |`);
  push(`| Runs in Inventory | ${analysis.inventory.length} |`);
  push(`| Bootstrap | Seed ${dataset.design.bootstrapSeed}, ${dataset.design.bootstrapDraws} draws, confidence ${dataset.design.confidence} |`);
  push(`| Quality-Loss Margin | ${analysis.populations.replay.claimAssessment.qualityLossMargin} points |`);
  push(`| Human Calibration Approved | ${dataset.design.humanCalibrationApproved} |`);
  push(`| Human Calibration Basis | ${dataset.design.humanCalibrationReason ?? "not-recorded"}${dataset.design.calibrationBindingSha256 ? `, binding \`${dataset.design.calibrationBindingSha256}\`` : ""} |`);
  push();
  push(`## Environment and Models`);
  push();
  push(`Environment pins and model identities available in the dataset are in [environment.json](environment.json). Host versions observed across runs: ${[...new Set(dataset.runs.map((run) => run.host.version))].filter(Boolean).join(", ") || "none recorded"}. The main-model identity is ${inputs?.mainModel ? "declared in the inputs manifest (not verified against run data)" : "not a dataset field; see [omissions.json](omissions.json)"}.`);
  push();
  push(`## Population Inventory`);
  push();
  push(`| Population | Expected Primary Runs | Observed Original Runs | Completed | Failed | Aborted | Not Started |`);
  push(`|---|---:|---:|---:|---:|---:|---:|`);
  for (const population of POPULATIONS) {
    const summary = analysis.populations[population];
    push(`| ${population} | ${summary.expectedRuns} | ${summary.observedOriginalRuns} | ${summary.outcomes.completed} | ${summary.outcomes.failed} | ${summary.outcomes.aborted} | ${summary.outcomes["not-started"]} |`);
  }
  push();
  push(`Expected primary runs count off/on query-repeat cells in the primary analysis. Observed originals and outcome counts also include manual replay rows, which are excluded from the replay primary endpoint. Reruns, \`only\`-arm runs, fixture-capture rows and synthetic-driver-integration rows are excluded from these counts and remain in the full inventory. Do not divide these outcome counts by expected primary runs to estimate completion.`);
  push();
  push(`Failed, aborted, invalid and rerun runs are retained in [tables/runs.csv](tables/runs.csv); a technical rerun never replaces its original cell. The \`analysis_valid\` column there mirrors the kernel's paired-sample validity predicate.`);
  push();
  push(`## Token Endpoints`);
  push();
  push(`Ratios are geometric means of per-query on/off ratios after averaging evaluable paired repeats within each query. Differences are arithmetic means of per-query on-minus-off differences, in input tokens. Queries are the resampling units. The primary endpoint is the uncached-input ratio; the arithmetic difference is descriptive and can disagree in sign with the ratio. Displayed bounds are rounded for display; claim thresholds use the full-precision values in [derived/analysis.json](derived/analysis.json) and [tables/claims.csv](tables/claims.csv).`);
  push();
  for (const population of POPULATIONS) {
    const summary = analysis.populations[population];
    push(`### ${POPULATION_LABEL[population]}`);
    push();
    if (summary.observedOriginalRuns === 0) {
      push(`No observed original runs in this export for this population (expected primary runs: ${summary.expectedRuns}). No estimate and no claim is rendered.`);
      push();
      continue;
    }
    for (const [endpoint, label] of [["mainInputUncached", "Uncached Input (Primary)"], ["mainInputTotal", "Total Input (Secondary)"]] as const) {
      const metric = summary.metrics[endpoint];
      const hasPrimaryBounds = metric.interval.lower !== null && metric.interval.upper !== null;
      const hasDiagnosticBounds = metric.diagnosticInterval.lower !== null && metric.diagnosticInterval.upper !== null;
      const shown = hasPrimaryBounds ? metric.interval : hasDiagnosticBounds ? metric.diagnosticInterval : null;
      const shownBounds = shown !== null && shown.lower !== null && shown.upper !== null ? formatInterval(shown.lower, shown.upper) : null;
      const kind = metric.primaryAvailable && shownBounds !== null ? `${percent} primary interval` : shownBounds !== null ? `${percent} complete-case diagnostic interval` : `no ${percent} interval available`;
      push(`- ${label}: paired queries ${metric.pairs.length}, missing ${metric.missingQueries.length}, undefined ratio queries ${metric.undefinedRatioQueries.length}; ratio ${formatProse(metric.ratio)}, on-minus-off difference ${formatProse(metric.difference, 1)} input tokens; ${kind}${shownBounds !== null ? ` ${shownBounds}` : ""}; primary available: ${metric.primaryAvailable ? "yes" : "no"}.`);
    }
    push(`- Claim: ${tokenClaimSentence(dataset, population, summary)}`);
    if (summary.claimAssessment.fiftyPercentHypothesis === "supported")
      push(`- Historical 50% hypothesis: supported under the prespecified rule (primary ratio upper bound at most 0.5 with preserved quality).`);
    else push(`- Historical 50% hypothesis: not established for this dataset.`);
    if (summary.manualReplay && summary.manualReplay.outcomes.length > 0)
      push(`- Manual replay: ${summary.manualReplay.outcomes.length} observed rows across ${summary.manualReplay.queryIds.length} declared tasks; descriptive reliability evidence outside the primary analysis.`);
    if (population === "live")
      push(`- Live results describe the workflows actually chosen under the declared allowances, not equal realised pipeline work. Where the experimental branch-only fetch operation dominates, results do not establish an effect for full-pipeline research.`);
    push();
  }
  push(`Total input is reported alongside uncached input. An uncached-input change alone is not evidence of a total-context reduction. Replay-run pipeline cost is fixture reproduction and excluded from the analysed cost endpoint; [tables/runs.csv](tables/runs.csv) carries it per row as descriptive data. Returned-time estimates appear in [derived/effects.csv](derived/effects.csv); replay timing is never a live-latency measure.`);
  push();
  push(`Figures: Controlled replay: [uncached-input pairs](figures/replay-uncached-input-pairs.svg), [total-input pairs](figures/replay-total-input-pairs.svg), [input ratios](figures/replay-token-ratios.svg). Live tasks: [uncached-input pairs](figures/live-uncached-input-pairs.svg), [total-input pairs](figures/live-total-input-pairs.svg), [input ratios](figures/live-token-ratios.svg). Descriptive inventory only: [judge-score distribution](figures/quality-scores.svg).`);
  push();
  push(`## Answer Quality`);
  push();
  if (analysis.qualityAvailable && dataset.quality) {
    for (const population of POPULATIONS) {
      const summary = analysis.populations[population];
      push(`- ${qualityClaimSentence(dataset, population, summary)}`);
      const judgeBound = (judge: Metric, number: string): string => {
        const hasPrimaryBounds = judge.interval.lower !== null && judge.interval.upper !== null;
        const hasDiagnosticBounds = judge.diagnosticInterval.lower !== null && judge.diagnosticInterval.upper !== null;
        const shown = hasPrimaryBounds ? judge.interval : hasDiagnosticBounds ? judge.diagnosticInterval : null;
        const shownBounds = shown !== null && shown.lower !== null && shown.upper !== null ? formatInterval(shown.lower, shown.upper) : null;
        const kind = judge.primaryAvailable && shownBounds !== null ? `${percent} primary interval` : shownBounds !== null ? `${percent} complete-case diagnostic interval` : `no ${percent} interval available`;
        return `judge ${number} on-minus-off difference ${formatProse(judge.difference, 2)}, ${kind}${shownBounds !== null ? ` ${shownBounds}` : ""} (primary available: ${judge.primaryAvailable ? "yes" : "no"})`;
      };
      const j1 = summary.metrics.qualityJudge1;
      const j2 = summary.metrics.qualityJudge2;
      push(`- Judge bounds (${population}): ${judgeBound(j1, "1")}; ${judgeBound(j2, "2")}.`);
    }
    const agreement = analysis.qualityAgreement;
    if (agreement)
      push(`- Judge agreement: ${agreement.exactOverallAgreement} of ${agreement.comparedAnswers} answers scored exactly equal, ${agreement.withinOneOverallPoint} within one point, maximum difference ${agreement.maximumAbsoluteOverallDifference ?? "none"}. High within-one agreement is not proof of judge reliability.`);
    else push(`- Judge agreement statistics are not available for this dataset.`);
    push(`- Calibration labels are weak sanity checks, not judge validation; disagreements are retained, never adjudicated.`);
    if (inputs?.mainModel) {
      // Exact identity comparison after normalising the provider prefix and
      // case: a substring match is not model identity, and a declared (not
      // verified) identity can never waive the protocol limitation.
      const normalise = (value: string): string => value.toLowerCase().split("/").pop() ?? value;
      const declared = normalise(inputs.mainModel.id);
      const shares = (dataset.quality.judges ?? []).some((judge) => normalise(judge) === declared);
      push(shares
        ? `- A recorded judge identifier matches the declared main-model id (${inputs.mainModel.id}). The declaration is not verified against run data. Verify actual model provenance against the pinned protocol and retain the shared-model limitation where applicable; separate sessions do not remove it.`
        : `- No recorded judge identifier matches the declared main-model id (${inputs.mainModel.id}) exactly. This identifier comparison does not establish model independence or waive the protocol's shared-model limitation. Verify actual main and judge provenance against the pinned protocol before interpreting quality claims.`);
    } else {
      push(`- The study protocol prescribes one judge sharing the main model's identity; the dataset does not carry that identity, so verify the shared-model limitation against the pinned protocol.`);
    }
  } else if (!dataset.quality || (dataset.quality.records as unknown[]).length === 0) {
    push(`No quality claim is made: the quality block is absent or its record list is empty. The quality-gated saving claim is therefore not established.`);
  } else {
    push(`No quality claim is made: human calibration approval is false, so primary quality claims, the per-run summary score columns and the quality figure are withheld. Supplied score fields may remain in the bundle, but they do not establish preserved quality. The quality-gated saving claim is therefore not established.`);
  }
  const exposure = exposureSummary(dataset);
  if (exposure !== null) {
    push();
    push(`## Context Exposure (Descriptive)`);
    push();
    push(`Retrieved-page material reaching actual main-model requests, measured in characters. This is the frozen \`rawPageCharacters\` measure: descriptive context, not an endpoint and not claim evidence. Record statuses: ${Object.entries(exposure.statuses).sort((a, b) => byCodeUnit(a[0], b[0])).map(([status, count]) => `${status} ${count}`).join(", ")}. ${exposure.totals !== null ? `Totals over the ${exposure.totals.runs} complete record(s): raw page characters ${exposure.totals.raw}, whole-page-or-long characters ${exposure.totals.wholePage}, short-run characters ${exposure.totals.shortRun}.` : "No complete exposure records are available; complete-record totals are unavailable. Inspect the observed lower bounds in tables/runs.csv."} Short-run exposure means short exact page-text runs (dataset field \`quotationCharacters\`): a size class only; no justification is judged and no quotation claim is made. Incomplete records leave totals blank and publish recorded observed lower bounds only; an observed lower bound can legitimately be zero. Per-run values are in [tables/runs.csv](tables/runs.csv).`);
  }
  const corrections = (dataset as unknown as Record<string, unknown>).metadataCorrections;
  if (Array.isArray(corrections) && corrections.length > 0) {
    push();
    push(`## Metadata Corrections`);
    push();
    push(`${corrections.length} offline metadata correction record(s) from the input dataset are retained in dataset.json (\`metadataCorrections\`): derived fields recomputed from retained evidence, with original values and source-file hashes. Raw observations were not rewritten.`);
  }
  push();
  push(`## Omissions and Redactions`);
  push();
  push(`The redaction policy, known omissions and their stated reproducibility limits are in [omissions.json](omissions.json). Recorded scrub locations and aggregate dropped-key counts are in [provenance.json](provenance.json). These records are not a field-by-field redaction audit.`);
  push();
  push(`## Reproduction`);
  push();
  push("```bash");
  push(`# Run from a dedicated parent containing only the unpacked bundle, never an existing project:`);
  push(`# the copy commands replace parent manifests.`);
  push(`cp bundle/package.json bundle/package-lock.json . && npm ci`);
  push(`cd bundle`);
  push(`node --import tsx source/study-analysis.ts dataset.json ../analysis-check`);
  push(`node --import tsx source/study-publication.ts verify . ../verify-check`);
  push("```");
  push();
  push(`Use a dedicated parent directory containing only \`bundle/\`: the copy commands replace parent manifests, so preserve existing work and choose another parent if that condition is not met. With the loader provisioned, both verification commands are offline: no model call, credential or private session is involved. Compare the runtime and loader versions against \`buildRuntime\` in [provenance.json](provenance.json). Bundle verification does not certify script-free provisioning: provisioning and its dependency hooks remain separate from the offline analysis commands. The recorded pair identifies the build tooling, not a complete compatibility matrix; if loading fails, check runtime versions and loader provisioning against that record. See [README.md](README.md) for the bundle layout, the column dictionary and the provisioning separation.`);
  push();
  push(`## Non-Claims`);
  push();
  push(`> ${analysis.note}`);
  push();
  push(`Any \`only\`-arm runs remain in the inventory but are excluded from the off/on analysis.`);
  push();
  push(`Replay timing is not live latency; primary estimates and claims are computed separately for replay and live tasks. Claims apply only to this build, host and declared task population. The renderer labels development and pilot partitions diagnostic-only; measured-series claim states depend on the dataset's declared partition and analysis gates, and the exporter does not verify independent collection or final-publication readiness.`);
  push();
  return lines.join("\n");
}

function readmeMarkdown(): string {
  const lines: string[] = [];
  const push = (text = "") => lines.push(text);
  push(`# Codemode Study Publication Bundle`);
  push();
  push(`Offline numerical-analysis bundle generated by \`scripts/benchmarks/study-publication.ts\`. With the runtime and loader provisioned, regeneration makes no model call and does not read credentials or private sessions. Runtime dependencies are not bundled beyond the pinned manifest below; inspect [omissions.json](omissions.json) and the output before sharing.`);
  push();
  push(`## Layout`);
  push();
  push("```");
  push(`dataset.json           shareable sanitised dataset (frozen schema plus the declared additive fields)`);
  push(`derived/               analysis.json and effects.csv from the accepted analysis kernel`);
  push(`environment.json       environment pins and model identities available in the dataset or inputs manifest`);
  push(`omissions.json         redaction policy, known omissions and their stated reproducibility limits`);
  push(`provenance.json        input identity, build runtime, exporter commit and source hashes, scrub locations, private artefact digests`);
  push(`tables/                runs.csv, claims.csv, outcomes.csv and judges.csv (when scored records exist)`);
  push(`figures/               deterministic SVG figures, labelled with partition and availability`);
  push(`REPORT.md              generated claim-scoped analysis summary`);
  push(`inputs/                optional hash-checked publication inputs and their manifest`);
  push(`source/                analysis-kernel and exporter sources plus an ESM package.json marker`);
  push(`package.json, package-lock.json   pin the tsx loader for provisioning`);
  push(`MANIFEST.json          sha256 and size of every other file`);
  push("```");
  push();
  push(`## Provision Dependencies (Once)`);
  push();
  push(`Unpack the bundle inside a dedicated, empty reproduction directory containing no other project or files, and keep the bundle unchanged. The copy steps below replace manifests in the parent directory, so never run them inside an existing project; if the parent holds other work, preserve it and choose a new directory. Provision the pinned loader in that parent and write all reproduction output outside the bundle: dependencies or scratch files inside the bundle are unlisted files and make verification fail. With \`bundle/\` as the unpacked bundle directory, one level above it:`);
  push();
  push("```bash");
  push(`cp bundle/package.json bundle/package-lock.json .`);
  push(`npm ci        # may need network access or a populated npm cache; not part of offline regeneration`);
  push(`cd bundle`);
  push(`node --import tsx source/study-analysis.ts dataset.json ../analysis-check`);
  push(`node --import tsx source/study-publication.ts verify . ../verify-check`);
  push("```");
  push();
  push(`The loader resolves from the parent directory's \`node_modules\` (including its \`.bin\` symlinks), which sits outside the manifest-exact bundle. Both sibling check directories (\`analysis-check\`, \`verify-check\`) are disposable scratch and must be fresh for each run. Record the runtime and loader versions used for the independent reproduction and compare them against \`buildRuntime\` in \`provenance.json\` and the durable reproduction report. Bundle verification does not certify script-free provisioning: provisioning and its dependency hooks remain separate from the offline analysis commands. The recorded build runtime is not a compatibility floor.`);
  push();
  push(`## Integrity`);
  push();
  push(`\`MANIFEST.json\` records the SHA-256 digest and byte size of every other file. The bundled \`verify\` command checks the listed digests for \`dataset.json\`, \`source/\` and every other manifest entry, and cross-checks the recorded source hashes, input hashes and the manifest's own shape. Retain the manifest with the bundle; these checks establish consistency with that manifest and the invoked sources, not independent authenticity. Publish the digest of \`MANIFEST.json\` itself out of band alongside the bundle: that out-of-band digest is the external authenticity anchor.`);
  push();
  push(`## Column Dictionary (tables/runs.csv)`);
  push();
  push(`| Column | Meaning |`);
  push(`|---|---|`);
  push(`| \`analysis_valid\` | The kernel's paired-sample validity predicate: settled outcome, complete observation, observed catalogue, valid replay state |`);
  push(`| \`valid_task_outcome\` | Recorded flag: a failed run still counts as a settled task outcome (only meaningful for failed runs) |`);
  push(`| \`failed_run_valid_outcome\` | The same flag restricted to failed runs; empty for other statuses |`);
  push(`| \`input_uncached\`, \`input_total\` | Gated by \`main_usage_complete\` and \`main_input_total_complete\`; empty means unknown, never zero |`);
  push(`| \`cache_read\`, \`cache_write\` | Gated by \`main_usage_complete\`; empty means unknown, never zero |`);
  push(`| \`error\` | Free text, sanitised and truncated at 200 characters; a leading formula character (=, +, @ or a text-leading dash) is escaped with a prefixed apostrophe, so the cell can differ from the recorded error |`);
  push(`| \`exposure_status\` | \`complete\`, \`incomplete\`, \`unavailable\` or \`absent\` (no contextExposure record) |`);
  push(`| \`raw_page_characters\` | Complete-record total of retrieved-page characters in actual requests |`);
  push(`| \`whole_page_characters\` | Complete-record whole-page-or-long run characters |`);
  push(`| \`short_run_characters\` | Complete-record short exact page-text run characters (dataset field \`quotationCharacters\`); a size class, not a quotation judgement |`);
  push(`| \`observed_*_characters\` | Recorded lower bounds published for incomplete records; a recorded zero is a real zero, and empty means unavailable or absent |`);
  push(`| \`reported_pipeline_usd\` | Per-run provider-reported pipeline cost. Replay rows are fixture reproduction and excluded from the analysed cost endpoint |`);
  push();
  push(`## Limits`);
  push();
  push(`The bundle reproduces the numerical analysis and claim states. It does not carry private raw sessions, request captures, replay fixtures, judge packets or (unless supplied through the inputs manifest) task inputs, the corpus or the main-model identity; see \`omissions.json\` for every known omission and its stated effect. Full final answers are not assembled automatically; they can be attached through the inputs manifest. Judge rationales and evidence quotes contain answer passages that may have been sanitised, not guaranteed verbatim transcripts. Final answer assembly and source-backed checking remain coordinator-owned. A live rerun may produce different answers or search results; offline reproduction never promises identical remote-service outputs.`);
  push();
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Copied-source closure and loader pinning
// ---------------------------------------------------------------------------

/** Relative runtime import specifiers of one TypeScript source text (type-only imports excluded). */
export function relativeRuntimeImports(text: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:^|[;\n])\s*import\s+(?!type\b)(?:[^;'"]*?)from\s*["'](\.[^"']+)["']/g,
    /(?:^|[;\n])\s*import\s*["'](\.[^"']+)["']/g,
    /(?:^|[;\n])\s*export\s+(?!type\b)[^;'"]*?from\s*["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) specifiers.add(match[1]!);
  return [...specifiers];
}

/** Transitive closure of relative runtime imports for the copied source set, contained in the module directory. */
export async function publicationSourceClosure(moduleDirectory: string): Promise<readonly string[]> {
  const entryPoints = ["study-publication.ts", "study-analysis.ts", "study-context-exposure.ts"];
  const found = new Set<string>();
  const queue: string[] = [];
  for (const entry of entryPoints) {
    if (await pathExists(join(moduleDirectory, entry))) {
      found.add(entry);
      queue.push(entry);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const text = await readFile(join(moduleDirectory, current), "utf8");
    for (const specifier of relativeRuntimeImports(text)) {
      const resolved = resolve(moduleDirectory, dirname(current), specifier);
      if (!resolved.startsWith(`${resolve(moduleDirectory)}/`))
        throw new Error(`Runtime import "${specifier}" in ${current} resolves outside the source directory; the copied-source closure must stay contained`);
      const withoutExtension = specifier.replace(/\.(js|mjs|cjs)$/, "");
      let matched = false;
      for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.mts`, `${withoutExtension}.js`, specifier]) {
        const name = relative(moduleDirectory, resolve(moduleDirectory, dirname(current), candidate));
        if (name.startsWith("..") || isAbsolute(name)) throw new Error(`Runtime import "${specifier}" in ${current} escapes the source directory`);
        if (!(await pathExists(join(moduleDirectory, name)))) continue;
        matched = true;
        if (!found.has(name)) {
          found.add(name);
          queue.push(name);
        }
        break;
      }
      if (!matched) throw new Error(`Runtime import "${specifier}" in ${current} does not resolve to a copied source file; the closure would be incomplete`);
    }
  }
  return [...found].sort(byCodeUnit);
}

async function readInstalledTsxVersion(moduleDirectory: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await readFile(join(moduleDirectory, "../../node_modules/tsx/package.json"), "utf8")) as { version?: string };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

const NPM_REGISTRY = ["https:", "", "registry.npmjs.org"].join("/");

/** Builds a lockfileVersion-3 dependency lock for the pinned loader from the repository's lockfile. */
export async function buildLoaderLockfile(moduleDirectory: string): Promise<{ devDependencies: Record<string, string>; lockfile: Json }> {
  const tsxVersion = await readInstalledTsxVersion(moduleDirectory);
  if (tsxVersion === null) throw new Error("Cannot determine the installed tsx version; the loader pin cannot be recorded");
  const repoLock = JSON.parse(await readFile(join(moduleDirectory, "../../package-lock.json"), "utf8")) as {
    packages?: Record<string, { version?: string; resolved?: string; integrity?: string; dev?: boolean; optional?: boolean; hasInstallScript?: boolean; bin?: Record<string, string>; os?: string[]; cpu?: string[]; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
  };
  const packages = repoLock.packages ?? {};
  const included: Record<string, unknown> = {};
  const queue = ["node_modules/tsx"];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key];
    if (!entry || entry.version === undefined) throw new Error(`The repository lockfile has no entry for ${key}; the loader pin would be incomplete`);
    const deps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
    included[key] = {
      version: entry.version,
      ...(entry.resolved !== undefined ? { resolved: entry.resolved } : {}),
      ...(entry.integrity !== undefined ? { integrity: entry.integrity } : {}),
      dev: true,
      ...(entry.optional !== undefined ? { optional: entry.optional } : {}),
      ...(entry.hasInstallScript !== undefined ? { hasInstallScript: entry.hasInstallScript } : {}),
      ...(entry.bin !== undefined ? { bin: entry.bin } : {}),
      ...(entry.os !== undefined ? { os: entry.os } : {}),
      ...(entry.cpu !== undefined ? { cpu: entry.cpu } : {}),
      ...(Object.keys(deps).length > 0 ? { dependencies: entry.dependencies ?? {}, ...(entry.optionalDependencies !== undefined ? { optionalDependencies: entry.optionalDependencies } : {}) } : {}),
    };
    for (const depName of Object.keys(deps)) queue.push(`node_modules/${depName}`);
  }
  for (const [key, value] of Object.entries(included)) {
    const resolved = (value as { resolved?: string }).resolved;
    if (resolved !== undefined && !resolved.startsWith(NPM_REGISTRY))
      throw new Error(`Lockfile entry ${key} resolves from ${resolved}, not the public npm registry; the pin is not reproducible`);
  }
  const lockfile = {
    name: "codemode-study-publication-bundle",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "codemode-study-publication-bundle", version: "1.0.0", private: true, devDependencies: { tsx: tsxVersion } },
      ...included,
    },
  };
  return { devDependencies: { tsx: tsxVersion }, lockfile };
}

async function exporterState(moduleDirectory: string): Promise<{ commit: string | null; dirty: boolean | null }> {
  try {
    const stdout = await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: dirname(moduleDirectory) });
    const status = await promisify(execFile)("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: dirname(moduleDirectory) });
    return { commit: stdout.stdout.trim(), dirty: status.stdout.trim().length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

// ---------------------------------------------------------------------------
// Derived artefact generation (regenerable from dataset.json plus inputs manifest)
// ---------------------------------------------------------------------------

async function readBundleInputs(outRoot: string, inputsPath: string | null): Promise<LoadedInputs | null> {
  const manifestPath = inputsPath ?? join(outRoot, "inputs", "manifest.json");
  if (!(await pathExists(manifestPath))) return null;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { schemaVersion?: number; metadata?: PublicationInputs["metadata"]; files?: { name: string; role: PublicationInputs["files"][number]["role"]; sha256?: string }[] };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error(`Inputs manifest ${manifestPath} is not a bundle inputs manifest`);
  return {
    manifest: {
      schemaVersion: 1,
      metadata: manifest.metadata ?? {},
      files: (manifest.files ?? []).map((file) => ({ name: file.name, sha256: file.sha256 ?? "", role: file.role })),
    },
    bundleManifest: manifest as unknown as Json,
    mainModel: manifest.metadata?.mainModel ?? null,
  };
}

/** Writes every derived artefact that regenerates from the sanitised dataset (and inputs manifest) alone. */
async function generateDerivedFiles(datasetPath: string, outRoot: string, inputsManifestPath: string | null = null): Promise<void> {
  const bytes = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(bytes) as StudyDataset;
  const analysis = analyseStudy(dataset);
  const inputs = await readBundleInputs(outRoot, inputsManifestPath);
  await mkdir(join(outRoot, "derived"), { recursive: true });
  await mkdir(join(outRoot, "tables"), { recursive: true });
  await mkdir(join(outRoot, "figures"), { recursive: true });
  await reproduceAnalysis(datasetPath, join(outRoot, "derived"));
  await writeNewJson(join(outRoot, "environment.json"), environmentRecord(dataset, analysis, inputs));
  await writeNewJson(join(outRoot, "omissions.json"), omissionsRecord(dataset, inputs));
  await writeNewFile(join(outRoot, "tables", "runs.csv"), runsTable(dataset));
  await writeNewFile(join(outRoot, "tables", "claims.csv"), claimsTable(dataset, analysis));
  await writeNewFile(join(outRoot, "tables", "outcomes.csv"), outcomesTable(analysis));
  const judges = judgesTable(dataset);
  if (judges !== null) await writeNewFile(join(outRoot, "tables", "judges.csv"), judges);
  for (const population of POPULATIONS) {
    await writeNewFile(join(outRoot, "figures", `${population}-uncached-input-pairs.svg`), pairedMeansFigure(dataset, population, analysis.populations[population].metrics.mainInputUncached, "mainInputUncached"));
    await writeNewFile(join(outRoot, "figures", `${population}-total-input-pairs.svg`), pairedMeansFigure(dataset, population, analysis.populations[population].metrics.mainInputTotal, "mainInputTotal"));
    await writeNewFile(join(outRoot, "figures", `${population}-token-ratios.svg`), intervalFigure(dataset, population, analysis.populations[population]));
  }
  await writeNewFile(join(outRoot, "figures", "quality-scores.svg"), qualityFigure(dataset));
  await writeNewFile(join(outRoot, "REPORT.md"), reportMarkdown(dataset, analysis, inputs));
  await writeNewFile(join(outRoot, "README.md"), readmeMarkdown());
}

// ---------------------------------------------------------------------------
// Analysis equality across sanitisation
// ---------------------------------------------------------------------------

/**
 * Normalises an analysis result for comparison: dropped private keys are
 * removed from both sides and every string passes the same scrub, so numeric
 * fields compare strictly while echoed free text compares after equivalent
 * scrubbing. Returns the first differing pointer when values differ.
 */
function analysisDifference(before: unknown, after: unknown, scrubber: Scrubber): string | null {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (dropKey(key)) continue;
        out[key] = normalise(item);
      }
      return out;
    }
    return typeof value === "string" ? scrubber.text(value) : value;
  };
  const left = normalise(before);
  const right = normalise(after);
  const walk = (a: unknown, b: unknown, at: string): string | null => {
    if (typeof a === "string" || typeof b === "string") return a === b ? null : at;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return at;
      for (let i = 0; i < a.length; i += 1) {
        const difference = walk(a[i], b[i], `${at}/${i}`);
        if (difference !== null) return difference;
      }
      return null;
    }
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);
      if (aKeys.length !== bKeys.length) return at;
      for (const key of aKeys) {
        if (!(key in (b as Record<string, unknown>))) return `${at}/${key}`;
        const difference = walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}/${key}`);
        if (difference !== null) return difference;
      }
      return null;
    }
    return Object.is(a, b) ? null : at;
  };
  return walk(left, right, "");
}

// ---------------------------------------------------------------------------
// Build and verify
// ---------------------------------------------------------------------------

export interface BuildSummary {
  readonly outputDirectory: string;
  readonly inputDatasetSha256: string;
  readonly files: number;
  readonly redactionLocations: readonly string[];
}

/**
 * Builds a new shareable publication bundle. The output directory must not
 * exist, must not sit inside a raw study series, and is produced atomically:
 * everything is written to a sibling partial directory, checked, and renamed
 * only on success. A failed build leaves no target and no partial.
 */
export async function buildPublication(inputDatasetPath: string, outputDirectory: string, inputsManifestPath: string | null = null): Promise<BuildSummary> {
  if (await pathExists(outputDirectory)) throw new Error(`Output directory already exists: ${outputDirectory}. Publication bundles are immutable; write corrections to a new directory.`);
  await assertNotInsideRawSeries(outputDirectory);
  const partial = `${outputDirectory}.partial`;
  if (await pathExists(partial))
    throw new Error(`A partial build directory already exists: ${partial}. Choose another target unless this directory is confirmed to belong to an abandoned build from the current task; do not remove another run's files.`);
  const denyList = await extraDenyList();
  const inputBytes = await readFile(inputDatasetPath);
  const input = JSON.parse(inputBytes.toString("utf8")) as StudyDataset;
  const loadedInputs = inputsManifestPath !== null ? await loadInputs(inputsManifestPath, input) : null;
  const inputAnalysis = analyseStudy(input);
  const sanitised = sanitiseStudyDataset(input);
  // The sanitised dataset must leave the computed analysis unchanged: numbers
  // compare strictly, and echoed free text compares after the same scrub is
  // applied to both sides. The first differing pointer is reported.
  const difference = analysisDifference(inputAnalysis, analyseStudy(sanitised.dataset), new Scrubber());
  if (difference !== null)
    throw new Error(`Sanitisation changed the computed analysis result at ${difference === "" ? "(root)" : difference}. Publication refuses to proceed: fix the sanitiser or the input instead of publishing divergent numbers.`);
  const datasetText = `${JSON.stringify(sanitised.dataset, null, 2)}\n`;
  try {
    assertShareableText("dataset.json", datasetText, "build", denyList);
  } catch (error) {
    if (error instanceof ShareabilityError) {
      const pointers = locatePrivatePointers(sanitised.dataset, error.matches);
      throw new ShareabilityError(`dataset.json${pointers.length > 0 ? ` (first private match near ${pointers[0]})` : ""}`, error.matches);
    }
    throw error;
  }
  try {
    await mkdir(partial, { recursive: true });
    await writeNewFile(join(partial, "dataset.json"), datasetText);
    if (loadedInputs !== null) {
      await mkdir(join(partial, "inputs"), { recursive: true });
      for (const file of loadedInputs.manifest.files) await writeNewBytes(join(partial, "inputs", file.name), await readFile(join(dirname(inputsManifestPath!), file.name)));
      await writeNewJson(join(partial, "inputs", "manifest.json"), loadedInputs.bundleManifest);
    }
    await generateDerivedFiles(join(partial, "dataset.json"), partial, loadedInputs === null ? null : join(partial, "inputs", "manifest.json"));
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    const sources = await publicationSourceClosure(moduleDirectory);
    await mkdir(join(partial, "source"), { recursive: true });
    await writeNewJson(join(partial, "source", "package.json"), { type: "module", private: true });
    for (const name of sources) await writeNewFile(join(partial, "source", name), await readFile(join(moduleDirectory, name), "utf8"));
    const loader = await buildLoaderLockfile(moduleDirectory);
    await writeNewJson(join(partial, "package.json"), { name: "codemode-study-publication-bundle", version: "1.0.0", private: true, type: "module", devDependencies: loader.devDependencies });
    await writeNewJson(join(partial, "package-lock.json"), loader.lockfile);
    const exporter = await exporterState(moduleDirectory);
    const exporterCommitHash = exporter.commit;
    await writeNewJson(join(partial, "provenance.json"), {
      schemaVersion: PUBLICATION_SCHEMA_VERSION,
      edition: PUBLICATION_EDITION,
      inputDataset: { sha256: sha256Bytes(inputBytes), note: "The input filename is withheld; the digest identifies the input" },
      sanitisedDatasetSha256: sha256Text(datasetText),
      buildRuntime: {
        node: process.version,
        platform: process.platform,
        loader: `tsx@${loader.devDependencies.tsx}`,
        note: "Recorded at build time. Compare the runtime used for independent reproduction against these values.",
      },
      exporter: {
        commit: exporterCommitHash,
        dirty: exporter.dirty,
        comparedWithRecordedExperimentalCommit:
          exporterCommitHash === input.design.candidateCommit
            ? "identical"
            : `differs (exporter ${exporterCommitHash ?? "unknown"}, recorded experimental ${input.design.candidateCommit})`,
        sourceSha256: Object.fromEntries(await Promise.all(sources.map(async (name) => [name, sha256Bytes(await readFile(join(moduleDirectory, name)))]))),
      },
      redactions: {
        localPathsRedacted: sanitised.scrub.localPaths,
        sessionIdsRedacted: sanitised.scrub.sessionIds,
        credentialsRedacted: sanitised.scrub.credentials,
        jsonPointers: sanitised.scrub.locations,
        droppedKeys: sanitised.droppedKeys,
        removedArtefactPaths: sanitised.removedArtefactPaths,
        extraDenyListEntries: denyList.length,
      },
      degenerateWorkspaceDigests: sanitised.degenerateWorkspaceDigests,
      privateArtifacts: sanitised.privateArtifacts,
      ...(loadedInputs !== null ? { inputs: loadedInputs.bundleManifest } : {}),
    });
    const names = (await listFiles(partial)).filter((name) => name !== "MANIFEST.json");
    const files = [];
    for (const name of names) {
      const bytes = await readFile(join(partial, name));
      files.push({ path: name.split("\\").join("/"), sha256: sha256Bytes(bytes), bytes: bytes.byteLength });
    }
    await writeNewJson(join(partial, "MANIFEST.json"), { schemaVersion: PUBLICATION_SCHEMA_VERSION, edition: PUBLICATION_EDITION, generator: "scripts/benchmarks/study-publication.ts", files });
    for (const name of [...(await listFiles(partial))]) assertShareableText(name.split("\\").join("/"), (await readFile(join(partial, name))).toString("utf8"), "build", denyList);
    await rename(partial, outputDirectory);
    return { outputDirectory: outputDirectory, inputDatasetSha256: sha256Bytes(inputBytes), files: files.length, redactionLocations: sanitised.scrub.locations };
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

const REGENERABLE_PREFIXES = ["derived/", "tables/", "figures/", "environment.json", "omissions.json", "REPORT.md", "README.md"];
const FIXED_BUNDLE_FILES = ["dataset.json", "provenance.json", "package.json", "package-lock.json", "source/package.json"];
const MANIFEST_KEYS = new Set(["schemaVersion", "edition", "generator", "files"]);
const MANIFEST_ENTRY_KEYS = new Set(["path", "sha256", "bytes"]);

export interface VerifySummary {
  readonly integrityChecked: number;
  readonly regenerated: number;
}

/**
 * Verifies a bundle fail-closed and host-independently. The manifest's file
 * set must match the bundle on disk exactly and equal the permitted set (fixed
 * files, sources recorded in provenance, declared inputs, and exactly the
 * regenerable set); every listed file matches its digest and byte size and
 * passes the host-independent shareability check; the manifest itself is
 * shape- and byte-checked; recorded source hashes, input hashes and the
 * corpus binding are re-asserted; and every derived artefact regenerates
 * byte-identically.
 */
export async function verifyPublication(bundleDirectory: string, outputDirectory: string): Promise<VerifySummary> {
  if (await pathExists(outputDirectory)) throw new Error(`Verify output directory already exists: ${outputDirectory}. Use a fresh scratch directory outside the bundle.`);
  assertScratchOutsideBundle(bundleDirectory, outputDirectory);
  const manifestBytes = await readFile(join(bundleDirectory, "MANIFEST.json"));
  const manifestText = manifestBytes.toString("utf8");
  assertShareableText("MANIFEST.json", manifestText, "verify");
  const manifest = JSON.parse(manifestText) as { schemaVersion?: number; edition?: string; generator?: string; files?: { path: string; sha256: string; bytes?: number }[] };
  if (manifest.schemaVersion !== PUBLICATION_SCHEMA_VERSION || manifest.edition !== PUBLICATION_EDITION || !Array.isArray(manifest.files))
    throw new Error(`Not a ${PUBLICATION_EDITION} bundle manifest at schema version ${PUBLICATION_SCHEMA_VERSION}`);
  for (const key of Object.keys(manifest as unknown as Record<string, unknown>)) {
    if (!MANIFEST_KEYS.has(key)) throw new Error(`MANIFEST.json carries an unknown key "${key}"; only ${[...MANIFEST_KEYS].join(", ")} are permitted`);
  }
  if (manifest.generator !== "scripts/benchmarks/study-publication.ts") throw new Error(`MANIFEST.json generator must be the fixed exporter path, not ${JSON.stringify(manifest.generator)}`);
  const listed = new Map<string, { sha256: string; bytes?: number }>();
  for (const entry of manifest.files!) {
    for (const key of Object.keys(entry as unknown as Record<string, unknown>)) {
      if (!MANIFEST_ENTRY_KEYS.has(key)) throw new Error(`MANIFEST.json entry ${entry.path} carries an unknown key "${key}"; only ${[...MANIFEST_ENTRY_KEYS].join(", ")} are permitted`);
    }
    if (typeof entry.bytes !== "number") throw new Error(`MANIFEST.json entry ${entry.path} has no byte size; every entry must record one`);
    if (isAbsolute(entry.path) || entry.path.split("/").includes("..") || entry.path === "MANIFEST.json") throw new Error(`Invalid manifest path: ${entry.path}`);
    if (listed.has(entry.path)) throw new Error(`MANIFEST.json lists ${entry.path} more than once; duplicate entries inflate the counts and hide content`);
    const bytes = await readFile(join(bundleDirectory, entry.path));
    if (sha256Bytes(bytes) !== entry.sha256) throw new Error(`Bundle integrity failure: ${entry.path} does not match MANIFEST.json`);
    if (entry.bytes !== bytes.byteLength) throw new Error(`Bundle integrity failure: ${entry.path} is ${bytes.byteLength} bytes, the manifest records ${entry.bytes}`);
    listed.set(entry.path, entry);
  }
  const onDisk = (await listFiles(bundleDirectory)).map((name) => name.split("\\").join("/")).filter((name) => name !== "MANIFEST.json");
  const unlisted = onDisk.filter((name) => !listed.has(name));
  if (unlisted.length > 0) throw new Error(`Bundle contains files not listed in MANIFEST.json: ${unlisted.join(", ")}. An unlisted file cannot be verified or cleared for sharing.`);
  const missing = [...listed.keys()].filter((name) => !onDisk.includes(name));
  if (missing.length > 0) throw new Error(`MANIFEST.json lists files missing from the bundle: ${missing.join(", ")}`);
  for (const name of onDisk) assertShareableText(name, (await readFile(join(bundleDirectory, name))).toString("utf8"), "verify");

  const provenance = JSON.parse(await readFile(join(bundleDirectory, "provenance.json"), "utf8")) as {
    sanitisedDatasetSha256?: string;
    exporter?: { sourceSha256?: Record<string, string>; commit?: string | null };
    inputDataset?: unknown;
    buildRuntime?: Record<string, unknown>;
    inputs?: { metadata?: unknown; files?: { name: string; sha256: string; role: string }[] };
  };
  const provenanceKeys = new Set(["schemaVersion", "edition", "inputDataset", "sanitisedDatasetSha256", "buildRuntime", "exporter", "redactions", "degenerateWorkspaceDigests", "privateArtifacts", "inputs"]);
  for (const key of Object.keys(provenance as unknown as Record<string, unknown>)) {
    if (!provenanceKeys.has(key)) throw new Error(`provenance.json carries a key outside its recorded shape: "${key}"`);
  }
  const exporterRecord = provenance.exporter as Record<string, unknown> | undefined;
  if (exporterRecord !== undefined)
    for (const key of Object.keys(exporterRecord))
      if (!["commit", "dirty", "comparedWithRecordedExperimentalCommit", "sourceSha256"].includes(key)) throw new Error(`provenance.exporter carries an unknown key "${key}"`);
  const inputDatasetRecord = provenance.inputDataset as Record<string, unknown> | undefined;
  if (inputDatasetRecord !== undefined)
    for (const key of Object.keys(inputDatasetRecord))
      if (!["sha256", "note"].includes(key)) throw new Error(`provenance.inputDataset carries an unknown key "${key}"; the input filename is withheld`);
  const buildRuntime = provenance.buildRuntime as Record<string, unknown> | undefined;
  if (buildRuntime !== undefined)
    for (const key of Object.keys(buildRuntime))
      if (!["node", "platform", "loader", "note"].includes(key)) throw new Error(`provenance.buildRuntime carries an unknown key "${key}"`);
  const datasetBytes = await readFile(join(bundleDirectory, "dataset.json"));
  if (provenance.sanitisedDatasetSha256 !== sha256Text(datasetBytes.toString("utf8")))
    throw new Error(`provenance.sanitisedDatasetSha256 does not match dataset.json; the binding between them is broken`);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as StudyDataset;

  // Copied sources must be exactly the recorded set, with matching hashes.
  const recordedSources = new Set(Object.keys(provenance.exporter?.sourceSha256 ?? {}));
  if (recordedSources.size === 0) throw new Error(`provenance.exporter.sourceSha256 records no copied sources; the reproduction set is unbound`);
  const diskSources = onDisk.filter((name) => name.startsWith("source/") && name !== "source/package.json").map((name) => name.slice("source/".length));
  const unexpectedSources = diskSources.filter((name) => !recordedSources.has(name));
  if (unexpectedSources.length > 0) throw new Error(`Bundle source/ contains files not recorded in provenance.exporter.sourceSha256: ${unexpectedSources.join(", ")}`);
  const missingSources = [...recordedSources].filter((name) => !diskSources.includes(name));
  if (missingSources.length > 0) throw new Error(`provenance.exporter.sourceSha256 names sources missing from source/: ${missingSources.join(", ")}`);
  for (const [name, hash] of Object.entries(provenance.exporter!.sourceSha256 ?? {}))
    if (sha256Bytes(await readFile(join(bundleDirectory, "source", name))) !== hash) throw new Error(`Copied source ${name} does not match its recorded hash in provenance.exporter.sourceSha256`);

  // Inputs must still match their declared hashes, role bindings and the
  // provenance record of what was attached.
  const inputsManifestPath = join(bundleDirectory, "inputs", "manifest.json");
  const declaredInputs = new Set<string>(["inputs/manifest.json"]);
  const hasInputsManifest = await pathExists(inputsManifestPath);
  if (hasInputsManifest) {
    const inputsManifest = JSON.parse(await readFile(inputsManifestPath, "utf8")) as { files?: { name: string; sha256: string; role: string }[] };
    for (const file of inputsManifest.files ?? []) {
      declaredInputs.add(`inputs/${file.name}`);
      const content = await readFile(join(bundleDirectory, "inputs", file.name));
      if (sha256Bytes(content) !== file.sha256) throw new Error(`Inputs file ${file.name} does not match the sha256 declared in inputs/manifest.json`);
      if (file.role === "corpus" && sha256Bytes(content) !== dataset.design.corpusSha256) throw new Error(`Inputs corpus ${file.name} no longer matches the dataset's frozen corpusSha256`);
    }
    const recorded = [...(provenance.inputs?.files ?? [])].map((file) => `${file.name}|${file.sha256}|${file.role}`).sort().join(";");
    const present = [...(inputsManifest.files ?? [])].map((file) => `${file.name}|${file.sha256}|${file.role}`).sort().join(";");
    if (recorded !== present) throw new Error(`provenance.inputs does not match inputs/manifest.json; the attached-inputs records disagree`);
    const recordedMetadata = JSON.stringify((provenance.inputs as { metadata?: unknown } | undefined)?.metadata ?? {});
    const bundleInputs = JSON.parse(await readFile(inputsManifestPath, "utf8")) as { metadata?: unknown; files?: { name: string; sha256: string; role: string }[] };
    const presentMetadata = JSON.stringify(bundleInputs.metadata ?? {});
    if (recordedMetadata !== presentMetadata) throw new Error(`provenance.inputs metadata does not match inputs/manifest.json metadata; the attached-input records disagree on metadata`);
    for (const entry of bundleInputs.files ?? [])
      for (const key of Object.keys(entry as unknown as Record<string, unknown>))
        if (!["name", "role", "sha256"].includes(key)) throw new Error(`inputs/manifest.json file entry ${entry.name} carries an unknown key "${key}"`);
  } else if (provenance.inputs !== undefined) {
    throw new Error(`provenance.json records attached inputs but inputs/manifest.json is absent; the records disagree`);
  }
  const unexpectedInputs = onDisk.filter((name) => name.startsWith("inputs/") && !declaredInputs.has(name));
  if (unexpectedInputs.length > 0) throw new Error(`inputs/ contains files its manifest does not declare: ${unexpectedInputs.join(", ")}`);

  // The lockfile must pin the public registry exactly (host parsed, not
  // prefix-matched). Dependency lifecycle metadata is retained; provisioning
  // hooks are separate from offline analysis.
  const lock = JSON.parse(await readFile(join(bundleDirectory, "package-lock.json"), "utf8")) as { packages?: Record<string, { resolved?: string; integrity?: string; version?: string; hasInstallScript?: boolean; devDependencies?: Record<string, string> }> };
  const registryHost = new URL(NPM_REGISTRY).host;
  const ALLOWED_LOCK_PACKAGES = /^(?:node_modules\/)?(?:tsx|esbuild|@esbuild\/[A-Za-z0-9_-]+|fsevents)$/;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "") continue;
    if (!ALLOWED_LOCK_PACKAGES.test(key)) throw new Error(`package-lock.json entry ${key} is outside the loader closure (tsx, esbuild, @esbuild/* or fsevents); the pin must not carry other dependencies`);
    if (entry.hasInstallScript !== undefined && typeof entry.hasInstallScript !== "boolean") throw new Error(`package-lock.json entry ${key} has a non-boolean hasInstallScript value`);
    if (entry.resolved === undefined || entry.integrity === undefined) throw new Error(`package-lock.json entry ${key} lacks resolved or integrity; an entry without both pins nothing`);
    if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)) throw new Error(`package-lock.json entry ${key} carries a malformed integrity value; a well-formed sha512 digest is required (its truth is only checkable against the registry)`);
    if (!entry.resolved.startsWith("https://")) throw new Error(`package-lock.json entry ${key} resolves over ${entry.resolved.split(":")[0]}:, not https`);
    let host: string | null = null;
    try {
      host = new URL(entry.resolved).host;
    } catch {
      host = null;
    }
    if (host !== registryHost) throw new Error(`package-lock.json entry ${key} resolves from ${entry.resolved} (host ${host ?? "unparseable"}), not ${registryHost}`);
  }
  const tsxEntry = (lock.packages ?? {})["node_modules/tsx"];
  if (tsxEntry === undefined || tsxEntry.version === undefined) throw new Error(`package-lock.json has no node_modules/tsx entry; the loader pin is missing`);
  const lockRootEntry = (lock.packages ?? {})[""];
  const pinnedFromLock = lockRootEntry?.devDependencies?.tsx;
  if (typeof pinnedFromLock !== "string" || tsxEntry.version !== pinnedFromLock) throw new Error(`package-lock.json tsx entry version ${String(tsxEntry.version)} contradicts the lock root pin ${String(pinnedFromLock)}; the pin records disagree`);
  // The root package pin must agree with the lockfile and carry no scripts.
  const rootPackage = JSON.parse(await readFile(join(bundleDirectory, "package.json"), "utf8")) as Record<string, unknown>;
  for (const key of Object.keys(rootPackage)) {
    if (!["name", "version", "private", "type", "devDependencies"].includes(key)) throw new Error(`package.json carries a key beyond the fixed pin set: "${key}"; lifecycle scripts and extra fields are refused`);
  }
  const rootDevDeps = rootPackage.devDependencies as Record<string, string> | undefined;
  if (rootDevDeps === undefined || Object.keys(rootDevDeps).some((name) => name !== "tsx"))
    throw new Error(`package.json devDependencies must contain only the pinned tsx entry; found ${Object.keys(rootDevDeps ?? {}).join(", ") || "none"}`);
  const pinnedLoader = rootDevDeps.tsx;
  if (pinnedLoader !== pinnedFromLock)
    throw new Error(`package.json and package-lock.json disagree on the pinned tsx version (${String(pinnedLoader)}); the two pin records must match`);
  // The recorded loader identity must match the pin it documents.
  const recordedLoader = buildRuntime?.loader;
  const expectedLoader = `tsx@${(lock.packages ?? {})["node_modules/tsx"]?.version ?? "?"}`;
  if (recordedLoader !== undefined && recordedLoader !== expectedLoader)
    throw new Error(`provenance.buildRuntime.loader (${String(recordedLoader)}) contradicts the pinned tsx version (${expectedLoader}); the runtime record and the pin disagree`);
  // source/package.json must be the fixed ESM marker.
  const sourceMarker = JSON.parse(await readFile(join(bundleDirectory, "source", "package.json"), "utf8")) as unknown;
  if (JSON.stringify(sourceMarker) !== JSON.stringify({ type: "module", private: true }))
    throw new Error(`source/package.json must be exactly the ESM marker {"type":"module","private":true}; found ${JSON.stringify(sourceMarker)}`);

  // Regenerate and compare, then derive the permitted file set.
  await generateDerivedFiles(join(bundleDirectory, "dataset.json"), outputDirectory, await pathExists(inputsManifestPath) ? inputsManifestPath : null);
  const regenerable = manifest.files!.filter((file) => REGENERABLE_PREFIXES.some((prefix) => file.path === prefix || file.path.startsWith(prefix)));
  if (regenerable.length === 0) throw new Error(`The manifest lists no regenerable derived artefacts; the published tables, figures and reports cannot be reproduced from this manifest`);
  const scratchFiles = (await listFiles(outputDirectory)).map((name) => name.split("\\").join("/"));
  const unexpectedScratch = scratchFiles.filter((name) => !listed.has(name));
  if (unexpectedScratch.length > 0) throw new Error(`Regeneration produced files the manifest does not list: ${unexpectedScratch.join(", ")}`);
  for (const file of regenerable) {
    if (!(await pathExists(join(outputDirectory, file.path)))) throw new Error(`Listed derived artefact ${file.path} did not regenerate; the manifest and the generator disagree`);
    const bytes = await readFile(join(outputDirectory, file.path));
    assertShareableText(file.path, bytes.toString("utf8"), "verify");
    if (sha256Bytes(bytes) !== file.sha256) throw new Error(`Reproduction failure: ${file.path} regenerates differently from the published bytes`);
  }
  const permitted = new Set<string>([...FIXED_BUNDLE_FILES, ...[...recordedSources].map((name) => `source/${name}`), ...declaredInputs, ...scratchFiles]);
  const unexplained = [...listed.keys()].filter((name) => !permitted.has(name));
  if (unexplained.length > 0) throw new Error(`MANIFEST.json lists files outside the permitted set (fixed bundle files, recorded sources, declared inputs and the regenerable set): ${unexplained.join(", ")}`);
  return { integrityChecked: manifest.files!.length, regenerated: regenerable.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  process.stderr.write("Usage:\n  node --import tsx scripts/benchmarks/study-publication.ts build DATASET_JSON NEW_OUTPUT_DIRECTORY [--inputs INPUTS_MANIFEST_JSON]\n  node --import tsx scripts/benchmarks/study-publication.ts verify BUNDLE_DIRECTORY NEW_SCRATCH_DIRECTORY\n");
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--inputs" && argv[i + 1] !== undefined) {
      flags.set("inputs", argv[i + 1]!);
      i += 1;
    } else positional.push(argv[i]!);
  }
  if (command === "build" && positional.length === 2) {
    const summary = await buildPublication(resolve(positional[0]!), resolve(positional[1]!), flags.has("inputs") ? resolve(flags.get("inputs")!) : null);
    process.stdout.write(`Built ${summary.outputDirectory}: ${summary.files} files from dataset sha256 ${summary.inputDatasetSha256}; scrub locations: ${summary.redactionLocations.length}\n`);
  } else if (command === "verify" && positional.length === 2 && flags.size === 0) {
    const summary = await verifyPublication(resolve(positional[0]!), resolve(positional[1]!));
    process.stdout.write(`Verified bundle: ${summary.integrityChecked} files integrity-checked, ${summary.regenerated} derived artefacts reproduced byte-identically\n`);
  } else {
    usage();
  }
}
