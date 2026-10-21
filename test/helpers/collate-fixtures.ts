// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CollateParams, FullData } from "../../src/core/contracts.js";
import type { RunManifest } from "../../src/core/run-manifest-schema.js";
import {
  readNamespace,
  validateJournal,
  verifyCommittedRun,
  verifyAccounting,
} from "../../src/core/run-journal.js";

export function suppliedCollation(): CollateParams {
  return {
    query: "Supplied evidence",
    searchSummary: "SEARCH_SUMMARY_NOT_EVIDENCE",
    extractions: [
      {
        url: "failed",
        title: "Failed",
        extraction: "ignored",
        sourceType: "notes",
        status: "blocked",
      },
      {
        url: "notes/local",
        title: "Notes",
        extraction: "First fact.",
        sourceType: "notes",
        status: "success",
      },
      { url: "empty", title: "Empty", extraction: " \n ", sourceType: "notes", status: "success" },
      {
        url: "https://user:password@docs.example/page",
        title: "Docs",
        extraction: "Second fact.",
        sourceType: "docs",
        status: "success",
      },
    ],
    fullPages: [
      {
        url: "https://user:password@docs.example/page",
        title: "Docs",
        content: "RAW_SUPPLIED_PAGE",
      },
      { url: "orphan label", title: "Unpaired", content: "RAW_UNPAIRED_PAGE" },
      { url: "notes/local", title: "Notes", content: "RAW_NOTES_PAGE" },
      { url: "notes/local", title: "Extra", content: "RAW_DUPLICATE_PAGE" },
    ],
  };
}

/** Verify the journal/report first; accounting alone is not trusted provenance. */
export async function verifyCollateData(workspace: string, data: FullData) {
  assert.equal(data.cache.status, "committed", JSON.stringify(data.cache));
  if (data.cache.status !== "committed") throw new Error("Not committed");
  const runDir = dirname(resolve(workspace, data.cache.reportPath));
  const namespaceDir = dirname(dirname(runDir));
  const namespace = (await readNamespace(namespaceDir))!;
  const journal = await validateJournal(namespaceDir, namespace.namespaceId, "reader");
  const verified = await verifyCommittedRun(
    namespaceDir,
    namespace.namespaceId,
    data.cache.runId,
    journal.records.get(data.cache.runId),
  );
  assert(verified.ok, JSON.stringify(verified));
  assert.equal(verified.reservation.operationId, data.operationId);
  const manifest: RunManifest = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
  const accounting = await verifyAccounting(
    runDir,
    namespace.namespaceId,
    data.cache.runId,
    verified.manifestSha256,
  );
  if (data.cache.accountingPath) {
    assert(accounting);
    assert.deepEqual(accounting.attempts, data.attempts);
    // Publication precedes adapter delivery. The immutable local record cannot
    // claim that a later host result was delivered or foresee cancellation.
    assert.deepEqual(accounting.summary, { ...data.accounting, parentDelivery: "unknown" });
  } else assert.equal(accounting, undefined);
  return { runDir, manifest, verified, accounting };
}
