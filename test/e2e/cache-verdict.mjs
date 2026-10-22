// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Credential-free live verdict. Use the product readers, never directory mtime
// or an optional sidecar alone as proof that a report was committed.
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  readJson,
  readNamespace,
  validateJournal,
  verifyCommittedRun,
} from "../../dist/core/run-journal.js";
import { readRunIndex } from "../../dist/core/run-index.js";

try {
  const [cacheArg, reference] = process.argv.slice(2);
  if (!cacheArg) throw new Error("Expected cache root and optional freshness reference");
  const cache = resolve(cacheArg);
  if (!(await lstat(cache)).isDirectory()) throw new Error("Cache root is not a real directory");
  const since = reference ? (await lstat(reference)).mtimeMs : -Infinity;
  const namespaceDir = join(cache, ".intelli-v1");
  if (!(await lstat(namespaceDir)).isDirectory())
    throw new Error("Namespace is not a real directory");
  const namespace = await readNamespace(namespaceDir);
  if (!namespace) throw new Error("Missing namespace identity");
  const journal = await validateJournal(namespaceDir, namespace.namespaceId, "reader");
  const index = await readRunIndex(namespaceDir, namespace.namespaceId);
  let selected;
  // Admission sequence, not filesystem mtime, determines ordering. Discovery
  // deliberately does not depend on the secondary index: its failure must not
  // cause another paid attempt after an otherwise successful committed run.
  for (const record of [...journal.records.values()].reverse()) {
    const runPath = join(namespaceDir, "runs", record.runId);
    try {
      const metaInfo = await lstat(join(runPath, "meta.json"));
      const markerInfo = await lstat(join(runPath, "committed.json"));
      if (
        !metaInfo.isFile() ||
        !markerInfo.isFile() ||
        metaInfo.mtimeMs <= since ||
        markerInfo.mtimeMs <= since
      )
        continue;
      const meta = (await readJson(join(runPath, "meta.json"))).value;
      if (
        meta.schemaVersion !== 1 ||
        meta.outcome !== "completed" ||
        !(meta.stages?.fetch?.succeeded > 0) ||
        !(meta.stages?.collate?.summaryChars > 0)
      )
        continue;
      const verified = await verifyCommittedRun(
        namespaceDir,
        namespace.namespaceId,
        record.runId,
        record,
      );
      if (!verified.ok) continue;
      const manifest = (await readJson(join(runPath, "run.json"))).value;
      if (manifest.operation !== "intelli_research") continue;
      const entry = index.index?.entries.find((entry) => entry.runId === record.runId);
      const marker = verified.marker;
      const indexVerified =
        index.status === "valid" &&
        !!entry &&
        entry.manifestSha256 === verified.manifestSha256 &&
        entry.sequence === marker.admissionSequence &&
        entry.compatibilityKey === marker.compatibilityKey &&
        entry.startedUtc === marker.startedUtc &&
        entry.query === marker.query;
      selected = {
        runPath,
        runId: record.runId,
        reportPath: join(runPath, "report.md"),
        indexPath: join(namespaceDir, "index.json"),
        indexVerified,
        extractionFiles: marker.files
          .filter((file) => file.kind === "extraction")
          .map((file) => file.relativePath),
        sourceFiles: marker.files
          .filter((file) => file.kind === "source")
          .map((file) => file.relativePath),
      };
      break;
    } catch {
      // An incomplete/orphan run cannot mask an earlier fresh valid commit.
    }
  }
  if (!selected) throw new Error("No fresh useful sidecar with a verified committed research run");
  process.stdout.write(`${JSON.stringify(selected)}\n`);
} catch (error) {
  process.stderr.write(`Cache verdict unavailable: ${error.message}\n`);
  process.exitCode = 1;
}
