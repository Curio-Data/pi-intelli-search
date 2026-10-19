// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Value } from "typebox/value";
import { isSafeRelativePath } from "./run-format.js";
import { RunManifestSchema } from "./run-manifest-schema.js";

/** Shared shape for pre-publication artefacts and verified marker entries. */
export interface ManifestFile {
  readonly relativePath: string;
  readonly kind: "report" | "query" | "manifest-data" | "source" | "extraction" | "late";
  readonly bytes?: number | Uint8Array;
}

function pageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Checks source state and file ownership, not claim-level grounding or provider
 * truth. Call after structural inventory validation; readers must also verify
 * the journal, reservation, marker and every file's bytes/hash.
 */
export function runManifestError(
  value: unknown,
  files: readonly ManifestFile[],
): string | undefined {
  if (!Value.Check(RunManifestSchema, value)) return "run.json schema mismatch";
  if (
    value.operation === "intelli_research" &&
    (!value.provenance.models.search || !value.provenance.models.extract)
  )
    return "research provenance must name search and extract models";
  const inventory = new Map(files.map((file) => [file.relativePath, file.kind]));
  if (inventory.size !== files.length) return "duplicate inventory path";
  const referenced = new Set<string>();
  const claim = (path: string, kind: ManifestFile["kind"]): string | undefined => {
    if (!isSafeRelativePath(path) || inventory.get(path) !== kind)
      return `run.json path ${JSON.stringify(path)} has no matching ${kind} artefact`;
    if (referenced.has(path)) return `run.json repeats path ${JSON.stringify(path)}`;
    referenced.add(path);
    return undefined;
  };
  const urls = new Set<string>();
  const used: string[] = [];
  for (const [index, source] of value.sources.entries()) {
    if (source.id !== `S${index + 1}`) return "source IDs must follow candidate order from S1";
    if (!pageUrl(source.url) || urls.has(source.url))
      return "source URLs must be unique credential-free HTTP(S) URLs";
    urls.add(source.url);
    if (source.input !== (value.operation === "intelli_research" ? "network" : "supplied"))
      return "source input disagrees with the operation";
    const extracted = source.state === "used" || source.state === "late";
    if (extracted !== (source.extractionPath !== undefined))
      return "only used and late sources must name an extraction";
    if (source.extractionPath !== undefined) {
      const error = claim(source.extractionPath, source.state === "late" ? "late" : "extraction");
      if (error) return error;
    }
    if (source.fullPagePath !== undefined) {
      if (source.state === "late" || source.state === "fetch-failed")
        return "late or failed fetches cannot retain raw pages";
      const error = claim(source.fullPagePath, "source");
      if (error) return error;
    }
    if (source.state === "used") used.push(source.id);
  }
  if (
    used.length !== value.evidenceSourceIds.length ||
    used.some((id, index) => id !== value.evidenceSourceIds[index])
  )
    return "evidence IDs must equal used sources in candidate order";
  const documentUrls = new Set<string>();
  for (const document of value.documents) {
    if (!pageUrl(document.url) || documentUrls.has(document.url))
      return "document URLs must be unique credential-free HTTP(S) URLs";
    documentUrls.add(document.url);
    const error = claim(document.relativePath, "source");
    if (error) return error;
  }
  for (const file of files) {
    if (["source", "extraction", "late"].includes(file.kind) && !referenced.has(file.relativePath))
      return `run.json omits artefact ${JSON.stringify(file.relativePath)}`;
    const size = typeof file.bytes === "number" ? file.bytes : file.bytes?.byteLength;
    if ((file.kind === "extraction" || file.kind === "late") && size === 0)
      return "successful extractions cannot be empty files";
  }
  return undefined;
}
