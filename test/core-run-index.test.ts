// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// T26/T27 library proofs: baseline suggestion characterisation, the
// date/query compatibility key, verified new readers, the read-only legacy
// bridge, the stable two-list merge and corrupt-index preservation.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Diagnostic } from "../src/core/execution-contracts.js";
import {
  judgeCandidates,
  makeCachePath,
  parseJudgeResponse,
  readIndex,
  updateIndex,
} from "../src/core/cache.js";
import { createRunStore } from "../src/core/run-store.js";
import {
  CANDIDATE_WINDOW,
  INDEX_FILE,
  IndexSchema,
  MARKER_FILE,
  NAMESPACE_DIR,
  RUNS_DIR,
  compatibilityKeyFor,
  isValid,
} from "../src/core/run-format.js";
import { formatCandidatesForJudge, parseCandidateResponse } from "../src/core/run-index.js";
import { artifactsFor, scratchRoot, storeOptions } from "./helpers/run-store-fixtures.js";

const never = new AbortController().signal;

async function commitRun(root: string, query: string, startedUtc: string, index = true) {
  const store = createRunStore(storeOptions(root));
  const allocation = await store.allocate({
    operationId: `op ${query}`,
    query,
    startedUtc,
    signal: never,
  });
  assert.equal(allocation.status, "allocated");
  if (allocation.status !== "allocated") throw new Error("unreachable");
  const result = await store.commit(allocation.reservation, artifactsFor(query), never);
  assert.equal(result.status, "committed");
  if (result.status !== "committed") throw new Error("unreachable");
  if (index) assert.equal(await store.updateIndex(result.run, query, never), "updated");
  return result.run;
}

async function legacyEntry(
  root: string,
  slug: string,
  query: string,
  timestamp: string,
  report = "# legacy\n",
) {
  await mkdir(join(root, slug), { recursive: true });
  await writeFile(join(root, slug, "report.md"), report);
  return { slug, query, timestamp };
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) await walk(path);
      else if (name.isFile()) {
        const info = await stat(path);
        out.set(
          relative(root, path),
          `${createHash("sha256")
            .update(await readFile(path))
            .digest("hex")}:${info.mtimeMs}`,
        );
      } else out.set(relative(root, path), "link");
    }
  }
  await walk(root);
  return out;
}

describe("C26 baseline characterisation (existing src/core/cache.ts)", () => {
  it("slug is date plus query identity; same-slug updates deduplicate; the window is the last 20 excluding current", async () => {
    const root = await scratchRoot("baseline");
    const a = makeCachePath("Rust async runtimes", root, root);
    assert.equal(makeCachePath("Rust async runtimes", root, root), a, "same date/query, same slug");
    assert.notEqual(
      makeCachePath("Rust async runtime", root, root),
      a,
      "short hash separates distinct queries",
    );
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(a.split("/").pop()!.startsWith(`${today}-rust-async-runtimes-`));
    for (let i = 0; i < 25; i++) await updateIndex(root, `slug-${i}`, `query ${i}`);
    await updateIndex(root, "slug-3", "query 3 again");
    const index = await readIndex(root);
    assert.equal(index.searches.length, 25, "re-research replaces rather than duplicates");
    assert.equal(
      index.searches.at(-1)?.slug,
      "slug-3",
      "refreshed entry moves to the newest position",
    );
    const window = judgeCandidates(index, "slug-3");
    assert.equal(window.length, 20);
    assert.ok(!window.some((e) => e.slug === "slug-3"), "current slug excluded");
    assert.deepEqual(
      window.map((e) => e.slug),
      Array.from({ length: 20 }, (_, i) => `slug-${i + 5}`),
      "oldest-first last-20 window",
    );
    const parsed = parseJudgeResponse(
      '[{"index":1,"relevance":"r"},{"index":21}]',
      index,
      "slug-3",
    );
    assert.deepEqual(
      parsed.map((p) => p.entry.slug),
      ["slug-5"],
    );
  });
});

describe("C26 compatibility key", () => {
  it("is the exact query plus UTC date as a full digest, independent of display label, domains and focus", () => {
    const key = compatibilityKeyFor("Same Query", "2026-10-18");
    assert.match(key, /^sha256:[0-9a-f]{64}$/);
    assert.equal(compatibilityKeyFor("Same Query", "2026-10-18"), key);
    assert.notEqual(
      compatibilityKeyFor("same query", "2026-10-18"),
      key,
      "exact text, no case folding",
    );
    assert.notEqual(compatibilityKeyFor("Same Query", "2026-10-19"), key);
    assert.equal(compatibilityKeyFor.length, 2, "no domain/focus inputs");
  });
});

describe("C27 verified new readers", () => {
  it("never suggests uncommitted, tampered or mismatched runs and falls back to the next verified admission", async () => {
    const root = await scratchRoot("readers");
    const diagnostics: Diagnostic[] = [];
    const older = await commitRun(root, "topic", "2026-10-18T10:00:00.000Z");
    const newer = await commitRun(root, "topic", "2026-10-18T11:00:00.000Z");
    const store = createRunStore(storeOptions(root, { diagnostics }));
    let candidates = await store.candidates(undefined, "other", never);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].admissionSequence, newer.reservation.sequence);
    await writeFile(join(newer.reservation.physicalPath, "report.md"), "# tampered\n");
    candidates = await store.candidates(undefined, "other", never);
    assert.equal(
      candidates[0].admissionSequence,
      older.reservation.sequence,
      "highest verified admission",
    );
    assert.ok(
      diagnostics.some(
        (d) => d.code === "RUN_REJECTED" && d.message.includes("report.md size or hash differs"),
      ),
    );
    // An uncommitted directory is never mistaken for a report, even if indexed by hand.
    const pending = createRunStore(storeOptions(root));
    const allocation = await pending.allocate({
      operationId: "p",
      query: "pending",
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(allocation.status, "allocated");
    if (allocation.status !== "allocated") return;
    await writeFile(join(allocation.reservation.physicalPath, "report.md"), "# looks complete\n");
    const indexPath = join(root, NAMESPACE_DIR, INDEX_FILE);
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.entries.push({
      runId: allocation.reservation.runId,
      sequence: allocation.reservation.sequence,
      compatibilityKey: allocation.reservation.compatibilityKey,
      query: "pending",
      startedUtc: allocation.reservation.startedUtc,
      manifestSha256: "0".repeat(64),
    });
    await writeFile(indexPath, JSON.stringify(index));
    candidates = await store.candidates(undefined, "other", never);
    assert.ok(!candidates.some((c) => c.query === "pending"));
    // A symlinked artefact is rejected.
    const { rename } = await import("node:fs/promises");
    await rename(join(older.reservation.physicalPath, "sources", "S1.md"), join(root, "moved"));
    await symlink(join(root, "moved"), join(older.reservation.physicalPath, "sources", "S1.md"));
    candidates = await store.candidates(undefined, "other", never);
    assert.ok(!candidates.some((c) => c.query === "topic"));
  });

  it("corrupt secondary input is preserved: readers rebuild in memory, writers copy before rewriting", async () => {
    const root = await scratchRoot("corrupt-index");
    await commitRun(root, "first", "2026-10-18T10:00:00.000Z");
    const indexPath = join(root, NAMESPACE_DIR, INDEX_FILE);
    await writeFile(indexPath, "{not json");
    const diagnostics: Diagnostic[] = [];
    const reader = createRunStore(storeOptions(root, { diagnostics }));
    const candidates = await reader.candidates(undefined, "other", never);
    assert.deepEqual(
      candidates.map((c) => c.query),
      ["first"],
    );
    assert.equal(await readFile(indexPath, "utf8"), "{not json", "readers never repair");
    assert.ok(diagnostics.some((d) => d.code === "INDEX_CORRUPT"));
    await commitRun(root, "second", "2026-10-18T11:00:00.000Z");
    const names = await readdir(join(root, NAMESPACE_DIR));
    const preserved = names.filter((n) => n.startsWith("index.corrupt-"));
    assert.equal(preserved.length, 1);
    assert.equal(await readFile(join(root, NAMESPACE_DIR, preserved[0]), "utf8"), "{not json");
    const rebuilt = JSON.parse(await readFile(indexPath, "utf8"));
    assert.ok(isValid(IndexSchema, rebuilt));
    assert.deepEqual(
      rebuilt.entries.map((e: { query: string }) => e.query),
      ["first", "second"],
    );
  });

  it("stores every committed run (no new cap) while the candidate window stays 20", async () => {
    const root = await scratchRoot("no-cap");
    for (let i = 0; i < CANDIDATE_WINDOW + 3; i++)
      await commitRun(root, `q${i}`, `2026-10-18T10:${String(i).padStart(2, "0")}:00.000Z`);
    const index = JSON.parse(await readFile(join(root, NAMESPACE_DIR, INDEX_FILE), "utf8"));
    assert.equal(index.entries.length, CANDIDATE_WINDOW + 3);
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "other",
      never,
    );
    assert.equal(candidates.length, CANDIDATE_WINDOW);
    assert.equal(candidates[0].query, `q${CANDIDATE_WINDOW + 2}`);
  });
});

describe("C27 read-only legacy bridge and C26 merge", () => {
  async function legacyRoot(label: string) {
    const root = await scratchRoot(label);
    const entries = [
      await legacyEntry(root, "2026-10-17-alpha-aaaaaa", "alpha", "2026-10-17T09:00:00.000Z"),
      await legacyEntry(root, "2026-10-18-beta-bbbbbb", "beta", "2026-10-18T10:30:00.000Z"),
      await legacyEntry(root, "2026-10-18-gamma-cccccc", "gamma", "2026-10-18T10:30:00.000Z"),
      await legacyEntry(root, "2026-10-18-empty-dddddd", "empty", "2026-10-18T10:40:00.000Z", ""),
      {
        slug: "2026-10-18-missing-eeeeee",
        query: "missing",
        timestamp: "2026-10-18T10:41:00.000Z",
      },
      { slug: "../escape", query: "escape", timestamp: "2026-10-18T10:42:00.000Z" },
      { slug: "2026-10-18-badtime-ffffff", query: "badtime", timestamp: "yesterday" },
      { slug: "2026-10-18-beta-bbbbbb", query: "beta", timestamp: "2026-10-18T10:30:00.000Z" },
    ];
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere", "report.md"), "# linked\n");
    await symlink(join(root, "elsewhere"), join(root, "2026-10-18-linked-111111"));
    entries.push({
      slug: "2026-10-18-linked-111111",
      query: "linked",
      timestamp: "2026-10-18T10:43:00.000Z",
    });
    await writeFile(
      join(root, ".index.json"),
      JSON.stringify({ searches: entries }, null, 2) + "\n",
    );
    return root;
  }

  it("validates legacy entries without rewriting anything and invents no sequence", async () => {
    const root = await legacyRoot("legacy-readonly");
    const before = await snapshot(root);
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "current",
      never,
    );
    assert.deepEqual(
      candidates.map((c) => c.query),
      ["beta", "gamma", "alpha"],
      "timestamp desc, slug tie-break; invalid rejected",
    );
    assert.ok(
      candidates.every((c) => c.namespace === "legacy" && c.admissionSequence === undefined),
    );
    assert.equal(candidates[0].reportPath, join(".search", "2026-10-18-beta-bbbbbb", "report.md"));
    assert.equal(candidates[0].compatibilityKey, compatibilityKeyFor("beta", "2026-10-18"));
    assert.deepEqual(await snapshot(root), before, "no legacy file, index or directory changed");
    assert.ok(
      !(await readdir(root)).includes(NAMESPACE_DIR),
      "a reader does not create the new namespace",
    );
  });

  it("excludes the current key, prefers new over a legacy duplicate and head-merges with new winning ties", async () => {
    const root = await legacyRoot("legacy-merge");
    // New beta duplicates legacy beta's date/query key at the same instant.
    const betaNew = await commitRun(root, "beta", "2026-10-18T10:30:00.000Z");
    // Clock rollback: the later admission carries an earlier UTC start.
    const s2 = await commitRun(root, "delta", "2026-10-18T11:00:00.000Z");
    const s3 = await commitRun(root, "epsilon", "2026-10-18T10:00:00.000Z");
    const current = await createRunStore(storeOptions(root)).allocate({
      operationId: "cur",
      query: "alpha",
      startedUtc: "2026-10-17T23:00:00.000Z",
      signal: never,
    });
    assert.equal(current.status, "allocated");
    if (current.status !== "allocated") return;
    const store = createRunStore(storeOptions(root));
    const candidates = await store.candidates(current.reservation, "alpha", never);
    // New list (desc admission): epsilon(10:00), delta(11:00), beta(10:30).
    // Legacy list (desc time): gamma(10:30); beta dropped as a duplicate; alpha is current.
    // Head merge: epsilon 10:00 < gamma 10:30 -> gamma; then epsilon, delta, beta.
    assert.deepEqual(
      candidates.map((c) => `${c.namespace}:${c.query}`),
      ["legacy:gamma", "v1:epsilon", "v1:delta", "v1:beta"],
    );
    assert.deepEqual(
      candidates.filter((c) => c.namespace === "v1").map((c) => c.admissionSequence),
      [s3.reservation.sequence, s2.reservation.sequence, betaNew.reservation.sequence],
    );
    // Equal UTC heads prefer new: gamma (legacy) vs a new run at the same instant.
    const tie = await scratchRoot("legacy-tie");
    await legacyEntry(tie, "2026-10-18-gamma-cccccc", "gamma", "2026-10-18T10:30:00.000Z");
    await writeFile(
      join(tie, ".index.json"),
      JSON.stringify({
        searches: [
          {
            slug: "2026-10-18-gamma-cccccc",
            query: "gamma",
            timestamp: "2026-10-18T10:30:00.000Z",
          },
        ],
      }),
    );
    await commitRun(tie, "zeta", "2026-10-18T10:30:00.000Z");
    const tied = await createRunStore(storeOptions(tie)).candidates(undefined, "other", never);
    assert.deepEqual(
      tied.map((c) => c.namespace),
      ["v1", "legacy"],
    );
    // Without a reservation the current key uses the clock's UTC date.
    const clockStore = createRunStore(
      storeOptions(root, {
        clock: { ...storeOptions(root).clock, utcIso: () => "2026-10-18T15:00:00.000Z" },
      }),
    );
    const noCurrent = await clockStore.candidates(undefined, "gamma", never);
    assert.ok(!noCurrent.some((c) => c.query === "gamma"));
  });

  it("prompt and parser share one frozen candidate array", async () => {
    const root = await legacyRoot("legacy-shared");
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "current",
      never,
    );
    assert.ok(Object.isFrozen(candidates) && candidates.every((c) => Object.isFrozen(c)));
    const prompt = formatCandidatesForJudge(candidates);
    assert.match(prompt, /^1\. "beta" /m);
    assert.match(prompt, /^3\. "alpha" /m);
    const parsed = parseCandidateResponse(
      'noise [{"index":3,"relevance":"r"},{"index":1.5},{"index":9},{"index":0}]',
      candidates,
    );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].candidate, candidates[2]);
    assert.equal(formatCandidatesForJudge([]), "No previous searches.");
  });

  it("a corrupt legacy index yields no legacy candidates and is left untouched", async () => {
    const root = await scratchRoot("legacy-corrupt");
    await writeFile(join(root, ".index.json"), "{broken");
    const diagnostics: Diagnostic[] = [];
    const candidates = await createRunStore(storeOptions(root, { diagnostics })).candidates(
      undefined,
      "q",
      never,
    );
    assert.deepEqual(candidates, []);
    assert.equal(await readFile(join(root, ".index.json"), "utf8"), "{broken");
    assert.ok(diagnostics.some((d) => d.code === "LEGACY_INDEX_UNREADABLE"));
    await assert.rejects(stat(join(root, NAMESPACE_DIR, RUNS_DIR, MARKER_FILE)));
  });
});
