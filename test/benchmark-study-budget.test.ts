// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModelFixtureRequest } from "../scripts/benchmarks/contracts.js";
import {
  attemptHoldUsd,
  createStudyLimits,
  formatNanoUsd,
  openStudySpendLedger,
  STUDY_ALLOWED_TOOLS,
  STUDY_SPEND_LEDGER_FILE,
  StudyBudgetError,
  summariseAttemptCharges,
  usdToNano,
  type StudyBudgetErrorCode,
  type StudyLimitOptions,
} from "../scripts/benchmarks/study-budget.js";
import { isRetryableMessage } from "../src/core/util.js";
import { studyActiveTools } from "../src/experimental/codemode-study.js";

const repository = fileURLToPath(new URL("../", import.meta.url));
const realBaseline = join(repository, "docs/benchmarks/codemode-study-v1/SPEND-BASELINE.json");
const moduleUrl = pathToFileURL(join(repository, "scripts/benchmarks/study-budget.ts")).href;

const refusedWith = (code: StudyBudgetErrorCode) => (error: unknown) => {
  assert.ok(error instanceof StudyBudgetError, String(error));
  assert.equal(error.code, code, error.message);
  return true;
};

function baselineJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "codemode-branch-openrouter-spend-baseline",
    revision: "test-baseline",
    knownCharges: [
      { id: "K1", reportedUsd: 0.25 },
      { id: "K2", reportedUsd: 0.75 },
    ],
    unknownExposure: [{ id: "U1", pendingHoldUsd: 1 }],
    totals: { knownReportedUsd: 1, pendingHoldsUsd: 1, conservativeExposureUsd: 2, ceilingUsd: 30 },
    ...overrides,
  });
}

let scratch: string;
let counter = 0;

/** A fresh ledger root and a USD 2 exposure baseline (known 1 plus hold 1). */
async function fixture(content = baselineJson()): Promise<{ root: string; baseline: string; file: string }> {
  counter += 1;
  const directory = join(scratch, `case-${counter}`);
  await mkdir(directory, { recursive: true });
  const baseline = join(directory, "baseline.json");
  await writeFile(baseline, content);
  const root = join(directory, "ledger");
  return { root, baseline, file: join(root, STUDY_SPEND_LEDGER_FILE) };
}

/** Runs a short module in a real separate process. */
async function runChild(body: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const source = `import * as budget from ${JSON.stringify(moduleUrl)};\n${body}`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "study-budget-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("exact USD arithmetic", () => {
  it("converts decimals exactly and rounds finer values up", () => {
    assert.equal(usdToNano(0.545984786), 545_984_786);
    assert.equal(usdToNano(30), 30_000_000_000);
    assert.equal(usdToNano(1e-7), 100);
    assert.equal(usdToNano(1.5e-10), 1);
    assert.equal(usdToNano(0.1234567891), 123_456_790);
    assert.equal(usdToNano(0), 0);
    assert.equal(formatNanoUsd(2_045_984_786), "2.045984786");
    assert.equal(formatNanoUsd(5), "0.000000005");
  });

  it("refuses negative, non-finite and non-numeric amounts", () => {
    for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY, "1" as unknown as number, 1e30])
      assert.throws(() => usdToNano(value), refusedWith("invalid-argument"));
  });

  it("derives holds and keeps a reported zero apart from a missing charge", () => {
    assert.equal(attemptHoldUsd(3), 1.5);
    assert.throws(() => attemptHoldUsd(0), refusedWith("invalid-argument"));
    assert.deepEqual(summariseAttemptCharges([0, 0.01, 0.02]), { reportedUsd: 0.03, unknownUsd: 0, missingCharges: 0 });
    assert.deepEqual(summariseAttemptCharges([0, undefined, null]), { reportedUsd: 0, unknownUsd: 1, missingCharges: 2 });
  });
});

describe("programme spend baseline", () => {
  it("starts from the real baseline's known charges plus unknown holds, with no reset", async () => {
    const { root } = await fixture();
    const ledger = await openStudySpendLedger(root, realBaseline);
    const snapshot = await ledger.snapshot();
    const baseline = JSON.parse(await readFile(realBaseline, "utf8"));
    assert.equal(snapshot.baselineKnownNanoUsd, usdToNano(baseline.totals.knownReportedUsd));
    assert.equal(snapshot.baselineUnknownHoldNanoUsd, usdToNano(baseline.totals.pendingHoldsUsd));
    assert.equal(snapshot.exposureNanoUsd, usdToNano(baseline.totals.conservativeExposureUsd));
    assert.equal(snapshot.remainingNanoUsd, usdToNano(baseline.totals.remainingUnderCeilingConservativeUsd));
    assert.equal(snapshot.baselineSha256, createHash("sha256").update(await readFile(realBaseline)).digest("hex"));
  });

  it("refuses a baseline whose totals disagree with its rows or whose ceiling moved", async () => {
    const cases = [
      baselineJson({ totals: { knownReportedUsd: 0.5, pendingHoldsUsd: 1, conservativeExposureUsd: 1.5, ceilingUsd: 30 } }),
      baselineJson({ totals: { knownReportedUsd: 1, pendingHoldsUsd: 0, conservativeExposureUsd: 1, ceilingUsd: 30 } }),
      baselineJson({ totals: { knownReportedUsd: 1, pendingHoldsUsd: 1, conservativeExposureUsd: 2, ceilingUsd: 31 } }),
      baselineJson({ knownCharges: [{ id: "K1", reportedUsd: 0.5 }, { id: "K1", reportedUsd: 0.5 }] }),
      baselineJson({ kind: "something-else" }),
      "{not json",
    ];
    for (const content of cases) {
      const { root, baseline } = await fixture(content);
      await assert.rejects(openStudySpendLedger(root, baseline), refusedWith("baseline-invalid"));
    }
  });

  it("binds to the baseline hash on reopen and on every later operation", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await writeFile(baseline, baselineJson({ revision: "edited" }));
    await assert.rejects(ledger.reserve("run-1", 0.5, 0), refusedWith("baseline-changed"));
    await assert.rejects(openStudySpendLedger(root, baseline), refusedWith("baseline-changed"));
  });

  it("keeps the cumulative total across handles and refuses a silently missing ledger", async () => {
    const { root, baseline } = await fixture();
    const first = await openStudySpendLedger(root, baseline);
    await first.reserve("series-a-1", 1, 0);
    await first.settle("series-a-1", { reportedUsd: 0.125, unknownUsd: 0, note: "series a" });
    const second = await openStudySpendLedger(root, baseline, { mustExist: true });
    const reservation = await second.reserve("series-b-1", 0.5, 0);
    assert.equal(reservation.snapshot.studyReportedNanoUsd, 125_000_000);
    assert.equal(reservation.snapshot.exposureNanoUsd, 2_625_000_000);

    const other = await fixture();
    await assert.rejects(openStudySpendLedger(other.root, other.baseline, { mustExist: true }), refusedWith("ledger-missing"));
    await assert.rejects(stat(other.root), { code: "ENOENT" });
  });
});

describe("reservation admission", () => {
  it("admits exactly at the ceiling and refuses one nanodollar above without writing", async () => {
    const { root, baseline, file } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    const before = await readFile(file, "utf8");
    await assert.rejects(ledger.reserve("run-over", 1, 27.000000001), refusedWith("ceiling-exceeded"));
    assert.equal(await readFile(file, "utf8"), before);
    const admitted = await ledger.reserve("run-exact", 1, 27);
    assert.equal(admitted.snapshot.exposureNanoUsd, 3_000_000_000);
    // Remaining planned cost is an admission input, not a durable hold.
    assert.equal(admitted.snapshot.remainingNanoUsd, 27_000_000_000);
  });

  it("counts other active reservations and retained unknown holds durably", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-a", 14, 0);
    const reopened = await openStudySpendLedger(root, baseline);
    await assert.rejects(reopened.reserve("run-b", 14.5, 0), refusedWith("ceiling-exceeded"));
    assert.equal((await reopened.reserve("run-b", 14, 0)).snapshot.remainingNanoUsd, 0);
    assert.deepEqual((await reopened.snapshot()).activeRuns, ["run-a", "run-b"]);
  });

  it("refuses duplicate runs even after settlement, and malformed reservations", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 0.5, 0);
    await assert.rejects(ledger.reserve("run-1", 0.5, 0), refusedWith("duplicate-run"));
    await ledger.settle("run-1", { reportedUsd: 0, unknownUsd: 0, note: "no attempt started" });
    await assert.rejects(ledger.reserve("run-1", 0.5, 0), refusedWith("duplicate-run"));
    await assert.rejects(ledger.reserve("run-2", 0, 0), refusedWith("invalid-argument"));
    await assert.rejects(ledger.reserve("run-2", 0.75, 0), refusedWith("invalid-argument"));
    await assert.rejects(ledger.reserve("../escape", 0.5, 0), refusedWith("invalid-argument"));
    await assert.rejects(ledger.reserve("run-2", 0.5, -1), refusedWith("invalid-argument"));
  });
});

describe("settlement", () => {
  it("releases only the unused part of a reservation and appends without rewriting", async () => {
    const { root, baseline, file } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 1.5, 0);
    const earlier = await readFile(file, "utf8");
    const settled = await ledger.settle("run-1", { reportedUsd: 0.0123456789, unknownUsd: 0, note: "three attempts reported" });
    assert.equal(settled.reportedNanoUsd, 12_345_679);
    assert.equal(settled.releasedNanoUsd, 1_487_654_321);
    assert.equal(settled.overrunNanoUsd, 0);
    assert.equal(settled.snapshot.exposureNanoUsd, 2_012_345_679);
    assert.deepEqual(settled.snapshot.activeRuns, []);
    assert.deepEqual(settled.snapshot.stopReasons, []);
    const later = await readFile(file, "utf8");
    assert.ok(later.startsWith(earlier));
    const row = JSON.parse(later.trimEnd().split("\n").at(-1) as string);
    assert.equal(row.reportedUsdRaw, 0.0123456789);
    assert.equal(row.kind, "settle");
  });

  it("retains USD 0.50 per missing charge and stops further paid batches, across reopen", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 1.5, 0);
    const charges = summariseAttemptCharges([0.02, undefined]);
    const settled = await ledger.settle("run-1", { ...charges, note: "attempt 2 reported no charge" });
    assert.equal(settled.unknownNanoUsd, 500_000_000);
    assert.equal(settled.releasedNanoUsd, 980_000_000);
    assert.equal(settled.snapshot.exposureNanoUsd, 2_520_000_000);
    assert.equal(settled.snapshot.studyUnknownHoldNanoUsd, 500_000_000);
    await assert.rejects(ledger.reserve("run-2", 0.5, 0), refusedWith("paid-stopped"));
    const reopened = await openStudySpendLedger(root, baseline);
    await assert.rejects(reopened.reserve("run-2", 0.5, 0), refusedWith("paid-stopped"));
    assert.equal((await reopened.snapshot()).stopReasons.length, 1);
  });

  it("records a charge above the hold truthfully, then stops", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 0.5, 0);
    const settled = await ledger.settle("run-1", { reportedUsd: 29, unknownUsd: 0, note: "provider reported more than the hold" });
    assert.equal(settled.overrunNanoUsd, 28_500_000_000);
    assert.equal(settled.snapshot.remainingNanoUsd, -1_000_000_000);
    await assert.rejects(ledger.reserve("run-2", 0.5, 0), refusedWith("paid-stopped"));
    assert.equal((await openStudySpendLedger(root, baseline)).path, ledger.path);
  });

  it("refuses duplicate settlement, an unknown run and an invalid settlement", async () => {
    const { root, baseline, file } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 1, 0);
    await assert.rejects(ledger.settle("run-1", { reportedUsd: 0, unknownUsd: 0.25, note: "x" }), refusedWith("invalid-argument"));
    await assert.rejects(ledger.settle("run-1", { reportedUsd: 0, unknownUsd: 0, note: "" }), refusedWith("invalid-argument"));
    await assert.rejects(ledger.settle("run-1", { reportedUsd: -1, unknownUsd: 0, note: "x" }), refusedWith("invalid-argument"));
    await assert.rejects(ledger.settle("nope", { reportedUsd: 0, unknownUsd: 0, note: "x" }), refusedWith("unknown-run"));
    await ledger.settle("run-1", { reportedUsd: 0.5, unknownUsd: 0, note: "first" });
    const settledOnce = await readFile(file, "utf8");
    await assert.rejects(ledger.settle("run-1", { reportedUsd: 0, unknownUsd: 0, note: "second" }), refusedWith("duplicate-settlement"));
    assert.equal(await readFile(file, "utf8"), settledOnce);
  });
});

describe("crash and corruption", () => {
  it("retains a reservation when its process is killed before settlement", async () => {
    const { root, baseline } = await fixture();
    const child = await runChild(`
      const ledger = await budget.openStudySpendLedger(${JSON.stringify(root)}, ${JSON.stringify(baseline)});
      await ledger.reserve("crashed-run", 2, 0);
      process.kill(process.pid, "SIGKILL");
    `);
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const ledger = await openStudySpendLedger(root, baseline, { mustExist: true });
    const snapshot = await ledger.snapshot();
    assert.deepEqual(snapshot.activeRuns, ["crashed-run"]);
    assert.equal(snapshot.activeReservationNanoUsd, 2_000_000_000);
    assert.equal(snapshot.exposureNanoUsd, 4_000_000_000);
    await assert.rejects(ledger.reserve("next", 26.5, 0), refusedWith("ceiling-exceeded"));
    // Resolving it later retains the full hold as unknown and stops paid batches.
    const settled = await ledger.settle("crashed-run", { reportedUsd: 0, unknownUsd: 2, note: "process killed; attempts unknown" });
    assert.equal(settled.snapshot.exposureNanoUsd, 4_000_000_000);
    assert.equal(settled.snapshot.stopReasons.length, 1);
  });

  /** A settled ledger with three rows, returning its lines for tampering. */
  async function writtenLedger() {
    const paths = await fixture();
    const ledger = await openStudySpendLedger(paths.root, paths.baseline);
    await ledger.reserve("run-1", 1, 0);
    await ledger.settle("run-1", { reportedUsd: 0.5, unknownUsd: 0, note: "done" });
    const lines = (await readFile(paths.file, "utf8")).trimEnd().split("\n");
    assert.equal(lines.length, 3);
    return { ...paths, ledger, lines };
  }

  const rechain = (rows: Record<string, unknown>[]): string => {
    let previous: string | null = null;
    return rows
      .map((row, seq) => {
        const line: string = JSON.stringify({ ...row, seq, prevSha256: previous });
        previous = createHash("sha256").update(line).digest("hex");
        return `${line}\n`;
      })
      .join("");
  };

  it("refuses garbage, a torn tail, blank rows, removal and edits, and writes nothing", async () => {
    const tamper: ((lines: readonly string[]) => string)[] = [
      (l) => `${l.join("\n")}\nnot json\n`,
      (l) => `${l.join("\n")}\n{"schemaVersion":1,"kind":"res`,
      (l) => `${l.join("\n")}\n\n`,
      (l) => `${l[0]}\n${l[2]}\n`,
      (l) => `${l[1]}\n${l[2]}\n`,
      (l) => `${l.join("\n").replace('"reportedNanoUsd":500000000', '"reportedNanoUsd":1')}\n`,
      (l) => `${l[0]}\n${l[1].replace('"reserveNanoUsd":1000000000', '"reserveNanoUsd":500000000')}\n${l[2]}\n`,
      (l) => `${l[0]}\n${l[1]} \n${l[2]}\n`,
      () => "",
    ];
    for (const change of tamper) {
      const { root, baseline, file, ledger, lines } = await writtenLedger();
      const content = change(lines);
      await writeFile(file, content);
      await assert.rejects(ledger.reserve("next", 0.5, 0), refusedWith("ledger-corrupt"), content);
      await assert.rejects(ledger.snapshot(), refusedWith("ledger-corrupt"));
      await assert.rejects(openStudySpendLedger(root, baseline), refusedWith("ledger-corrupt"));
      assert.equal(await readFile(file, "utf8"), content);
    }
  });

  it("refuses correctly chained rows that break the accounting", async () => {
    const parsed = (lines: readonly string[]): Record<string, unknown>[] => lines.map((line) => JSON.parse(line));
    const tamper: ((rows: Record<string, unknown>[]) => Record<string, unknown>[])[] = [
      // Duplicate settlement and duplicate reservation.
      (r) => [...r, r[2]],
      (r) => [r[0], r[1], r[1], r[2]],
      // Settlement with no reservation, or a lowered total.
      (r) => [r[0], r[2]],
      (r) => [r[0], r[1], { ...r[2], reportedNanoUsd: 1, reportedUsdRaw: 0.000000001 }],
      (r) => [r[0], r[1], { ...r[2], releasedNanoUsd: 1 }],
      // A lower baseline or a raised ceiling in the genesis row.
      (r) => [{ ...r[0], ceilingNanoUsd: 31_000_000_000 }, ...r.slice(1)],
      // Admission arithmetic that could not have passed.
      (r) => [r[0], { ...r[1], remainingPlannedNanoUsd: 29_000_000_000 }, r[2]],
      (r) => [r[0], { ...r[1], extra: true }, r[2]],
    ];
    for (const change of tamper) {
      const { ledger, file, lines } = await writtenLedger();
      await writeFile(file, rechain(change(parsed(lines))));
      await assert.rejects(ledger.snapshot(), refusedWith("ledger-corrupt"));
    }
    const { root, ledger, file, lines, baseline } = await writtenLedger();
    const rows = parsed(lines);
    // A rechained genesis edit that keeps the hash still cannot lower the start.
    const lowered = [{ ...rows[0], baselineKnownNanoUsd: 0 }, rows[1], rows[2]];
    await writeFile(file, rechain(lowered));
    await assert.rejects(ledger.snapshot(), refusedWith("ledger-corrupt"));
    await assert.rejects(openStudySpendLedger(root, baseline), refusedWith("ledger-corrupt"));
  });
});

describe("concurrent writers", () => {
  it("never over-admits across real processes", async () => {
    const { root, baseline, file } = await fixture();
    await openStudySpendLedger(root, baseline);
    // Exposure 2: five USD 5 reservations reach 27, a sixth would pass 30.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runChild(`
          const ledger = await budget.openStudySpendLedger(${JSON.stringify(root)}, ${JSON.stringify(baseline)}, { lockTimeoutMs: 60000 });
          try {
            await ledger.reserve("worker-${index}", 5, 0);
            console.log("admitted");
          } catch (error) {
            console.log(error.code);
          }
        `),
      ),
    );
    const outcomes = results.map((result) => {
      assert.equal(result.code, 0, result.stderr);
      return result.stdout.trim();
    });
    assert.equal(outcomes.filter((outcome) => outcome === "admitted").length, 5, outcomes.join());
    assert.equal(outcomes.filter((outcome) => outcome === "ceiling-exceeded").length, 3, outcomes.join());
    const ledger = await openStudySpendLedger(root, baseline, { mustExist: true });
    const snapshot = await ledger.snapshot();
    assert.equal(snapshot.activeReservationNanoUsd, 25_000_000_000);
    assert.equal(snapshot.rowCount, 6);
    assert.equal((await readFile(file, "utf8")).trimEnd().split("\n").length, 6);
  });

  it("serialises overlapping calls in one process and settles a run once", async () => {
    const { root, baseline } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline);
    await ledger.reserve("run-1", 1, 0);
    const settled = await Promise.allSettled(
      [0, 1, 2].map((n) => ledger.settle("run-1", { reportedUsd: 0.25, unknownUsd: 0, note: `try ${n}` })),
    );
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await ledger.snapshot()).studyReportedNanoUsd, 250_000_000);
  });

  it("refuses with an actionable message when a crash left the lock behind", async () => {
    const { root, baseline, file } = await fixture();
    const ledger = await openStudySpendLedger(root, baseline, { lockTimeoutMs: 30 });
    await writeFile(`${file}.lock`, "pid 999999 2026-11-02T00:00:00.000Z\n");
    const before = await readFile(file, "utf8");
    await assert.rejects(ledger.reserve("run-1", 0.5, 0), (error: unknown) => {
      refusedWith("ledger-locked")(error);
      assert.match((error as Error).message, /pid 999999/);
      assert.match((error as Error).message, /remove the file by hand/);
      return true;
    });
    assert.equal(await readFile(file, "utf8"), before);
    await rm(`${file}.lock`);
    await ledger.reserve("run-1", 0.5, 0);
    await assert.rejects(stat(`${file}.lock`), { code: "ENOENT" });
  });
});

const LIMITS: StudyLimitOptions = {
  maxMainRequests: 2,
  maxModelAttempts: 3,
  maxToolCalls: 6,
  maxPages: 5,
  maxInputBytes: 100,
  maxOutputTokens: 2000,
  maxQueryChars: 20,
};

function modelRequest(overrides: Partial<ModelFixtureRequest> = {}): ModelFixtureRequest {
  return {
    model: { provider: "openrouter", model: "minimax/minimax-m3" },
    role: "extract",
    systemPrompt: "sys",
    userMessage: "user",
    maxTokens: 500,
    reasoning: "low",
    effectivePayloadPatch: null,
    ...overrides,
  };
}

describe("per-run tool admission", () => {
  it("covers exactly the study catalogue of every arm", () => {
    const catalogue = new Set(["off", "on", "only"].flatMap((arm) => studyActiveTools(arm as "off")));
    assert.deepEqual([...STUDY_ALLOWED_TOOLS].sort(), [...catalogue].sort());
  });

  it("refuses unlisted tools and invalid limits", () => {
    const limits = createStudyLimits(LIMITS);
    for (const name of ["bash", "web_search", "intelli_researchx", "__proto__"])
      assert.throws(() => limits.admitTool(name, {}), refusedWith("tool-not-allowed"));
    assert.throws(() => limits.admitTool("read", null), refusedWith("invalid-argument"));
    assert.throws(() => createStudyLimits({ ...LIMITS, maxPages: -1 }), refusedWith("invalid-argument"));
    assert.throws(() => createStudyLimits({ ...LIMITS, maxInputBytes: 0 }), refusedWith("invalid-argument"));
    assert.throws(() => createStudyLimits({ ...LIMITS, maxToolCalls: Number.POSITIVE_INFINITY }), refusedWith("invalid-argument"));
    assert.equal(limits.usage().toolCalls, 0);
    assert.equal(limits.usage().refusals, 5);
  });

  it("requires explicit maxUrls unless the caller supplied an unforced default", () => {
    const prescribed = createStudyLimits(LIMITS);
    assert.throws(() => prescribed.admitTool("intelli_research", { query: "q" }), refusedWith("limit-exceeded"));
    for (const maxUrls of [0, 2.5, "3", null])
      assert.throws(() => prescribed.admitTool("intelli_research", { query: "q", maxUrls }), refusedWith("limit-exceeded"));
    assert.equal(prescribed.usage().pagesReserved, 0);
    prescribed.admitTool("intelli_research", { query: "q", maxUrls: 4 });
    assert.equal(prescribed.usage().pagesReserved, 4);

    const unforced = createStudyLimits({ ...LIMITS, omittedMaxUrlsPages: 3 });
    unforced.admitTool("intelli_research", { query: "q" });
    assert.equal(unforced.usage().pagesReserved, 3);
    const nullDefault = createStudyLimits({ ...LIMITS, omittedMaxUrlsPages: 3 });
    const nullArgs = Object.freeze({ query: "q", maxUrls: null });
    nullDefault.admitTool("intelli_research", nullArgs);
    assert.equal(nullDefault.usage().pagesReserved, 3);
    assert.equal(nullArgs.maxUrls, null);
    assert.throws(() => unforced.admitTool("intelli_research", { query: "q" }), refusedWith("limit-exhausted"));
  });

  it("charges pages only to research and fetch, and a refused call consumes nothing", () => {
    const limits = createStudyLimits(LIMITS);
    limits.admitTool("intelli_extract", { url: "https://a.example", title: "t", content: "c", query: "q" });
    limits.admitTool("intelli_search", { query: "q" });
    limits.admitTool("intelli_fetch", { url: "https://a.example" });
    assert.equal(limits.usage().pagesReserved, 1);
    assert.throws(() => limits.admitTool("intelli_research", { query: "q", maxUrls: 5 }), refusedWith("limit-exhausted"));
    assert.deepEqual(
      { calls: limits.usage().toolCalls, pages: limits.usage().pagesReserved, refusals: limits.usage().refusals },
      { calls: 3, pages: 1, refusals: 1 },
    );
    limits.admitTool("intelli_research", { query: "q", maxUrls: 4 });
    assert.throws(() => limits.admitTool("intelli_fetch", { url: "https://b.example" }), refusedWith("limit-exhausted"));
    assert.equal(limits.usage().pagesReserved, 5);
  });

  it("bounds query length on every query tool and requires the query", () => {
    const limits = createStudyLimits(LIMITS);
    limits.admitTool("intelli_search", { query: "x".repeat(20) });
    assert.throws(() => limits.admitTool("intelli_search", { query: "x".repeat(21) }), refusedWith("limit-exceeded"));
    assert.throws(() => limits.admitTool("intelli_research", { query: "x".repeat(21), maxUrls: 1 }), refusedWith("limit-exceeded"));
    assert.throws(() => limits.admitTool("intelli_research", { maxUrls: 1 }), refusedWith("invalid-argument"));
    assert.equal(limits.usage().pagesReserved, 0);
  });

  it("exhausts the page and call budgets through nested script calls", () => {
    const limits = createStudyLimits(LIMITS);
    // The hosted shape: the codemode call and each nested call fire the tool_call hook.
    const hook = (toolName: string, input: Record<string, unknown>) => {
      try {
        limits.admitTool(toolName, input);
        return undefined;
      } catch (error) {
        return { block: true, reason: (error as Error).message };
      }
    };
    assert.equal(hook("codemode", { code: "..." }), undefined);
    assert.equal(hook("read", { path: "report.md" }), undefined);
    const nested = Array.from({ length: 6 }, (_, n) => hook("intelli_fetch", { url: `https://a.example/${n}` }));
    assert.equal(nested.filter((result) => result === undefined).length, 4);
    assert.match(nested[4]?.reason ?? "", /tool calls are used/);
    const usage = limits.usage();
    assert.equal(usage.toolCalls, 6);
    assert.equal(usage.pagesReserved, 4);
    assert.deepEqual(usage.toolCallsByName, { codemode: 1, read: 1, intelli_fetch: 4 });

    const pagesFirst = createStudyLimits({ ...LIMITS, maxToolCalls: 20, maxPages: 2 });
    pagesFirst.admitTool("codemode", { code: "..." });
    pagesFirst.admitTool("intelli_fetch", { url: "https://a.example" });
    pagesFirst.admitTool("intelli_fetch", { url: "https://b.example" });
    assert.throws(() => pagesFirst.admitTool("intelli_fetch", { url: "https://c.example" }), refusedWith("limit-exhausted"));
    assert.throws(() => pagesFirst.admitTool("intelli_research", { query: "q", maxUrls: 1 }), refusedWith("limit-exhausted"));
  });

  it("blocks new calls when stopped, keeps the first reason and leaves inputs untouched", () => {
    const limits = createStudyLimits(LIMITS);
    const args = Object.freeze({ query: "q", maxUrls: 2, domains: Object.freeze(["a.example"]) });
    limits.admitTool("intelli_research", args);
    limits.stop("unknown charge");
    limits.stop("later reason");
    const before = limits.usage();
    assert.equal(before.stopReason, "unknown charge");
    assert.throws(() => limits.admitTool("intelli_research", args), refusedWith("run-stopped"));
    assert.throws(() => limits.admitModel(modelRequest()), refusedWith("run-stopped"));
    assert.throws(() => limits.admitMainRequest(), refusedWith("run-stopped"));
    assert.deepEqual(args, { query: "q", maxUrls: 2, domains: ["a.example"] });
    assert.equal(limits.usage().pagesReserved, before.pagesReserved);
  });
});

describe("per-run model admission", () => {
  it("allows exactly the prescribed models", () => {
    const limits = createStudyLimits({ ...LIMITS, maxModelAttempts: 10 });
    limits.admitModel(modelRequest({ model: { provider: "openrouter", model: "perplexity/sonar" }, role: "search" }));
    limits.admitModel(modelRequest());
    for (const model of [
      { provider: "openrouter", model: "perplexity/sonar-pro" },
      { provider: "perplexity", model: "perplexity/sonar" },
      { provider: "openrouter", model: "minimax/minimax-m3:free" },
      { provider: "openai-codex", model: "gpt-6.1-sol" },
    ])
      assert.throws(() => limits.admitModel(modelRequest({ model })), refusedWith("model-not-allowed"));
    assert.equal(limits.usage().modelAttempts, 2);
  });

  it("counts every attempt, retries included, and refuses before dispatch at the cap", () => {
    const limits = createStudyLimits(LIMITS);
    const request = modelRequest();
    limits.admitModel(request);
    limits.admitModel(request);
    limits.admitModel(request);
    assert.throws(() => limits.admitModel(request), refusedWith("limit-exhausted"));
    assert.equal(limits.usage().modelAttempts, 3);
  });

  it("requires finite maxTokens within the bound", () => {
    const limits = createStudyLimits(LIMITS);
    for (const maxTokens of [null, 0, -1, 1.5, Number.POSITIVE_INFINITY, 2001])
      assert.throws(() => limits.admitModel(modelRequest({ maxTokens })), refusedWith("limit-exceeded"));
    limits.admitModel(modelRequest({ maxTokens: 2000 }));
    assert.equal(limits.usage().modelAttempts, 1);
  });

  it("measures input in UTF-8 bytes, including the payload patch", () => {
    const limits = createStudyLimits(LIMITS);
    limits.admitModel(modelRequest({ systemPrompt: "", userMessage: "x".repeat(100) }));
    assert.throws(() => limits.admitModel(modelRequest({ systemPrompt: "", userMessage: "é".repeat(51) })), refusedWith("limit-exceeded"));
    assert.throws(
      () => limits.admitModel(modelRequest({ systemPrompt: "", userMessage: "x".repeat(95), effectivePayloadPatch: { a: 1 } })),
      refusedWith("limit-exceeded"),
    );
    assert.equal(limits.usage().modelAttempts, 1);
  });

  it("words every refusal so the retry classifier cannot retry it", () => {
    const limits = createStudyLimits({ ...LIMITS, maxModelAttempts: 500, maxOutputTokens: 503, maxInputBytes: 429 });
    const messageOf = (attempt: () => void): string => {
      try {
        attempt();
      } catch (error) {
        return (error as Error).message;
      }
      return assert.fail("expected a refusal");
    };
    const messages = [
      messageOf(() => limits.admitModel(modelRequest({ maxTokens: 504 }))),
      messageOf(() => limits.admitModel(modelRequest({ userMessage: "x".repeat(500) }))),
      messageOf(() => limits.admitModel(modelRequest({ model: { provider: "openrouter", model: "other" } }))),
    ];
    for (let attempt = 0; attempt < 500; attempt += 1) limits.admitModel(modelRequest());
    messages.push(messageOf(() => limits.admitModel(modelRequest())));
    limits.stop("provider timeout 429");
    messages.push(messageOf(() => limits.admitModel(modelRequest())));
    assert.equal(limits.usage().stopReason, "provider timeout 429");
    for (const message of messages) assert.equal(isRetryableMessage(message), false, message);
  });

  it("bounds main-model requests separately", () => {
    const limits = createStudyLimits(LIMITS);
    limits.admitMainRequest();
    limits.admitMainRequest();
    assert.throws(() => limits.admitMainRequest(), refusedWith("limit-exhausted"));
    assert.equal(limits.usage().mainRequests, 2);
  });
});
