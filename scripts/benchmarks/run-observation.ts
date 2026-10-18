// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Append-only run observation manifests (C29/C30). Observations are immutable
// once appended: failed, aborted, not-started and rerun records are retained,
// never overwritten or quietly relabelled. Single benchmark writer per block
// is assumed (runs are sequential per series); the writer appends one
// canonical JSON line per observation and fsyncs before returning.

import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256Text } from "./canonical.js";
import type { Json, RunObservation } from "./contracts.js";

export const OBSERVATIONS_FILENAME = "observations.ndjson";

export class InvalidRunObservationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRunObservationError";
  }
}

function requireString(record: RunObservation, field: keyof RunObservation): string {
  const value = record[field];
  if (typeof value !== "string" || value === "") {
    throw new InvalidRunObservationError(`RunObservation.${String(field)} must be a nonempty string`);
  }
  return value;
}

function requireHash(record: RunObservation, field: keyof RunObservation): void {
  const value = requireString(record, field);
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new InvalidRunObservationError(`RunObservation.${String(field)} must be a lowercase sha256 hex digest`);
  }
}

/**
 * Fail-closed shape validation. Unknown fields are preserved (the manifest is
 * append-only evidence, not a schema filter); required identity, provenance
 * and outcome fields must be present and well-formed so a malformed record is
 * rejected before it can masquerade as evidence.
 */
export function validateRunObservation(record: RunObservation): void {
  requireString(record, "runId");
  requireString(record, "queryId");
  requireString(record, "arm");
  requireString(record, "candidateCommit");
  requireHash(record, "methodSha256");
  requireHash(record, "corpusSha256");
  if (record.fixtureSha256 !== null) requireHash(record, "fixtureSha256");
  requireHash(record, "lockfileSha256");
  requireHash(record, "toolCatalogueSha256");
  requireHash(record, "promptSha256");
  if (!["deadline", "query-expansion", "codemode"].includes(record.experiment)) {
    throw new InvalidRunObservationError(`RunObservation.experiment "${record.experiment}" is not a known experiment`);
  }
  if (!["completed", "failed", "aborted", "not-started"].includes(record.status)) {
    throw new InvalidRunObservationError(`RunObservation.status "${record.status}" is not a known status`);
  }
  if (!["valid", "miss", "not-replay"].includes(record.replayValidity)) {
    throw new InvalidRunObservationError(`RunObservation.replayValidity "${record.replayValidity}" is unknown`);
  }
  if (!Number.isInteger(record.repeat) || record.repeat < 1) {
    throw new InvalidRunObservationError("RunObservation.repeat must be a positive integer");
  }
  if (!Number.isInteger(record.order) || record.order < 1) {
    throw new InvalidRunObservationError("RunObservation.order must be a positive integer");
  }
  if (!Number.isInteger(record.seed) || record.seed < 0) {
    throw new InvalidRunObservationError("RunObservation.seed must be a nonnegative integer");
  }
  if (typeof record.effectiveSettings !== "object" || record.effectiveSettings === null) {
    throw new InvalidRunObservationError("RunObservation.effectiveSettings must be a JSON object");
  }
  if (typeof record.subscriptionQuota !== "object" || record.subscriptionQuota === null) {
    throw new InvalidRunObservationError("RunObservation.subscriptionQuota must be a JSON object");
  }
  if (!Array.isArray(record.artifacts)) {
    throw new InvalidRunObservationError("RunObservation.artifacts must be an array");
  }
  for (const [index, artifact] of record.artifacts.entries()) {
    if (typeof artifact?.path !== "string" || artifact.path === "") {
      throw new InvalidRunObservationError(`RunObservation.artifacts[${index}].path must be a nonempty string`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(artifact.sha256))) {
      throw new InvalidRunObservationError(`RunObservation.artifacts[${index}].sha256 must be a sha256 hex digest`);
    }
  }
}

/**
 * Appends one immutable observation to `<root>/observations.ndjson` and
 * returns the file path plus the sha256 of the appended line. The file is
 * created (with parent directories) if absent; existing content is never
 * rewritten, truncated or reordered. The write is a single append of one
 * complete line followed by fsync.
 */
export async function appendRunObservation(
  root: string,
  record: RunObservation,
): Promise<{ readonly path: string; readonly sha256: string }> {
  validateRunObservation(record);
  await mkdir(root, { recursive: true });
  const path = join(root, OBSERVATIONS_FILENAME);
  const line = `${canonicalJson(record as unknown as Json)}\n`;
  const handle = await open(path, "a");
  try {
    await handle.appendFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { path, sha256: sha256Text(line) };
}
