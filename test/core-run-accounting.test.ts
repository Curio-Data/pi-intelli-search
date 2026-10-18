// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import {
  AccountingSummarySchema,
  AttemptRecordSchema,
  CostObservationSchema,
  TokenObservationSchema,
  UsageObservationSchema,
} from "../src/core/accounting-schema.js";
import { accountingBodyError } from "../src/core/accounting-validation.js";
import type {
  AccountingSummary,
  AttemptRecord,
  CostObservation,
  TokenObservation,
  UsageObservation,
} from "../src/core/execution-contracts.js";
import {
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
  MARKER_FILE,
  NAMESPACE_DIR,
  encodeRecord,
  sha256,
  type AccountingMarker,
} from "../src/core/run-format.js";
import {
  readNamespace,
  validateJournal,
  verifyAccounting,
  verifyCommittedRun,
} from "../src/core/run-journal.js";
import { createRunStore } from "../src/core/run-store.js";
import { createAttemptLedger, TOKEN_FIELDS } from "../src/core/usage.js";
import { artifactsFor, scratchRoot, storeOptions } from "./helpers/run-store-fixtures.js";

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// These are actual CI compile-time proofs, not runtime casts of the declarations.
const parity: [
  Equal<Static<typeof TokenObservationSchema>, TokenObservation>,
  Equal<Static<typeof CostObservationSchema>, CostObservation>,
  Equal<Static<typeof UsageObservationSchema>, UsageObservation>,
  Equal<Static<typeof AttemptRecordSchema>, AttemptRecord>,
  Equal<Static<typeof AccountingSummarySchema>, AccountingSummary>,
] = [true, true, true, true, true];

const signal = new AbortController().signal;
function body() {
  const ledger = createAttemptLedger();
  const base = {
    operationId: "op",
    callId: "c1",
    attempt: 1,
    role: "extract" as const,
    pageId: "S1",
    model: { provider: "fixture", model: "m" },
  };
  ledger.start(base, 1, 0);
  ledger.observe(base, {
    source: "provider-response",
    costBasis: "reported",
    cost: { total: 0.01 },
    tokens: { inputTotal: 10, inputUncached: 7, cacheRead: 2, cacheWrite: 1, outputTotal: 3 },
  });
  // Cumulative updates are replacements, not another attempt or incremental sum.
  ledger.observe(base, {
    source: "provider-response",
    costBasis: "reported",
    cost: { total: 0.02 },
    tokens: { inputTotal: 12, inputUncached: 9, outputTotal: 4 },
  });
  ledger.finish(base, "failed", 3);
  const retry = { ...base, attempt: 2 };
  ledger.start(retry, 5, 1);
  ledger.observe(retry, {
    source: "sdk-normalized",
    costBasis: "catalogue",
    cost: { total: 0.03 },
    tokens: { inputTotal: 12, outputTotal: 0, reasoning: 0 },
  });
  ledger.finish(retry, "succeeded", 6);
  const unknown = { ...base, callId: "c2", role: "collate" as const, pageId: undefined };
  ledger.start(unknown, 7, 0);
  ledger.finish(unknown, "aborted", 8);
  // JSON boundary omits optional undefined fields, as the durable writer does.
  return JSON.parse(
    JSON.stringify({ attempts: ledger.records(), summary: ledger.summary("unknown") }),
  ) as {
    attempts: AttemptRecord[];
    summary: AccountingSummary;
  };
}

async function published(label: string) {
  const root = await scratchRoot(`accounting-${label}`);
  const diagnostics: { code: string; message: string }[] = [];
  const store = createRunStore(storeOptions(root, { diagnostics }));
  const allocated = await store.allocate({
    operationId: "op",
    query: label,
    startedUtc: "2026-10-18T12:00:00Z",
    signal,
  });
  assert.equal(allocated.status, "allocated");
  if (allocated.status !== "allocated") throw new Error("not allocated");
  const committed = await store.commit(allocated.reservation, artifactsFor(label), signal);
  assert.equal(committed.status, "committed");
  if (committed.status !== "committed") throw new Error("not committed");
  const run = committed.run;
  const read = () =>
    verifyAccounting(
      run.reservation.physicalPath,
      run.reservation.namespaceId,
      run.reservation.runId,
      run.manifestSha256,
    );
  return { root, store, run, read, diagnostics };
}

it("shared accounting schemas match the frozen result types and preserve missingness/cost provenance", () => {
  assert.ok(parity.every(Boolean));
  const { attempts, summary } = body();
  assert.equal(accountingBodyError(attempts, summary, "op"), undefined);
  assert.equal(summary.tokens.inputTotal, 24);
  assert.equal(summary.reportedCost.total, 0.02);
  assert.equal(summary.estimatedCost.total, 0.03);
  assert.equal(summary.observedAttempts, 2);
  assert.equal(summary.missingAttempts, 1);
  assert.equal(summary.costComplete, false);
  assert.deepEqual(summary.missingTokenFields, TOKEN_FIELDS);
  assert.equal(
    accountingBodyError(
      attempts,
      { ...summary, missingTokenFields: [...TOKEN_FIELDS].reverse() },
      "op",
    ),
    undefined,
  );
  const empty = createAttemptLedger();
  assert.equal(accountingBodyError([], empty.summary()), undefined);
  assert.equal(
    empty.summary().costComplete,
    true,
    "zero-attempt completeness is vacuous, not fabricated usage",
  );
});

type Body = ReturnType<typeof body>;
const invalid: readonly [string, (value: Body) => unknown][] = [
  ["unknown attempt field", (b) => ({ ...b, attempts: [{ ...b.attempts[0], extra: 1 }] })],
  [
    "unknown model field",
    (b) => ({
      ...b,
      attempts: [{ ...b.attempts[0], model: { ...b.attempts[0].model, key: "secret" } }],
    }),
  ],
  ["unknown token field", (b) => ({ ...b, summary: { ...b.summary, tokens: { mystery: 0 } } })],
  [
    "unknown cost field",
    (b) => ({ ...b, summary: { ...b.summary, reportedCost: { mystery: 0 } } }),
  ],
  [
    "unknown observation field",
    (b) => ({
      ...b,
      attempts: [{ ...b.attempts[0], observation: { ...b.attempts[0].observation, extra: 1 } }],
    }),
  ],
  ["unknown summary field", (b) => ({ ...b, summary: { ...b.summary, extra: 1 } })],
  [
    "missing state",
    (b) => {
      const { state: _state, ...incomplete } = b.attempts[0];
      return { ...b, attempts: [incomplete] };
    },
  ],
  ["nonterminal state", (b) => ({ ...b, attempts: [{ ...b.attempts[0], state: "running" }] })],
  ["negative queue", (b) => ({ ...b, attempts: [{ ...b.attempts[0], queueMs: -1 }] })],
  [
    "unsafe attempt",
    (b) => ({ ...b, attempts: [{ ...b.attempts[0], attempt: Number.MAX_SAFE_INTEGER + 1 }] }),
  ],
  ["zero attempt", (b) => ({ ...b, attempts: [{ ...b.attempts[0], attempt: 0 }] })],
  ["fractional count", (b) => ({ ...b, summary: { ...b.summary, attempts: 1.5 } })],
  ["negative tokens", (b) => ({ ...b, summary: { ...b.summary, tokens: { outputTotal: -1 } } })],
  ["invalid role", (b) => ({ ...b, attempts: [{ ...b.attempts[0], role: "fetch" }] })],
  [
    "invalid cost basis",
    (b) => ({
      ...b,
      attempts: [
        { ...b.attempts[0], observation: { ...b.attempts[0].observation, costBasis: "free" } },
      ],
    }),
  ],
  [
    "invalid source",
    (b) => ({
      ...b,
      attempts: [
        { ...b.attempts[0], observation: { ...b.attempts[0].observation, source: "guess" } },
      ],
    }),
  ],
  [
    "invalid parent delivery",
    (b) => ({ ...b, summary: { ...b.summary, parentDelivery: "assumed" } }),
  ],
  [
    "unknown mask field",
    (b) => ({ ...b, summary: { ...b.summary, missingTokenFields: ["unknown"] } }),
  ],
  [
    "duplicate mask field",
    (b) => ({ ...b, summary: { ...b.summary, missingTokenFields: ["inputTotal", "inputTotal"] } }),
  ],
  ["incorrect mask", (b) => ({ ...b, summary: { ...b.summary, missingTokenFields: [] } })],
  [
    "invented known zero",
    (b) => ({ ...b, summary: { ...b.summary, tokens: { ...b.summary.tokens, totalTokens: 0 } } }),
  ],
  ["false cost completeness", (b) => ({ ...b, summary: { ...b.summary, costComplete: true } })],
  [
    "wrong observed count",
    (b) => ({ ...b, summary: { ...b.summary, observedAttempts: 3, missingAttempts: 0 } }),
  ],
  [
    "mixed cost bases",
    (b) => ({ ...b, summary: { ...b.summary, reportedCost: { total: 0.05 }, estimatedCost: {} } }),
  ],
  [
    "incremental instead of cumulative",
    (b) => ({ ...b, summary: { ...b.summary, reportedCost: { total: 0.03 } } }),
  ],
  ["duplicate identity", (b) => ({ ...b, attempts: [...b.attempts, b.attempts[0]] })],
  [
    "wrong owner",
    (b) => ({ ...b, attempts: b.attempts.map((r) => ({ ...r, operationId: "other" })) }),
  ],
  [
    "mixed owners",
    (b) => ({ ...b, attempts: b.attempts.map((r, i) => (i ? r : { ...r, operationId: "other" })) }),
  ],
  ["control identifier", (b) => ({ ...b, attempts: [{ ...b.attempts[0], callId: "a\nb" }] })],
  [
    "encoded identifier ceiling",
    (b) => ({ ...b, attempts: [{ ...b.attempts[0], callId: "日".repeat(43) }] }),
  ],
  ["time reversal", (b) => ({ ...b, attempts: [{ ...b.attempts[0], settledAtMs: 0 }] })],
];

it("writer rejects invalid bodies before a file or marker and retains the useful report", async () => {
  for (const [label, mutate] of invalid) {
    const value = mutate(body()) as Body;
    const { store, run, read, diagnostics } = await published(label);
    const result = await store.recordAccounting(run, value.attempts, value.summary, signal);
    assert.equal(
      result.status === "unavailable" && result.diagnostic.code,
      "INVALID_ACCOUNTING",
      label,
    );
    assert.ok(
      diagnostics.some((d) => d.code === "INVALID_ACCOUNTING"),
      label,
    );
    assert.deepEqual(
      (await readdir(run.reservation.physicalPath)).filter((p) => p.startsWith("accounting")),
      [],
      label,
    );
    assert.ok((await readdir(run.reservation.physicalPath)).includes(MARKER_FILE), label);
    assert.equal(await read(), undefined, label);
    await store.settle();
  }
});

it("reader rejects hash-valid malformed and arithmetically inconsistent accounting", async () => {
  const { root, store, run, read } = await published("reader");
  const valid = body();
  assert.equal(
    (await store.recordAccounting(run, valid.attempts, valid.summary, signal)).status,
    "recorded",
  );
  const dir = run.reservation.physicalPath;
  const accounting = JSON.parse(await readFile(join(dir, ACCOUNTING_FILE), "utf8"));
  const marker: AccountingMarker = JSON.parse(
    await readFile(join(dir, ACCOUNTING_MARKER_FILE), "utf8"),
  );
  const original = await readFile(join(dir, MARKER_FILE));
  for (const [label, mutate] of invalid) {
    const changed = mutate(body()) as Body;
    const bytes = encodeRecord({
      ...accounting,
      attempts: changed.attempts,
      summary: changed.summary,
    });
    await writeFile(join(dir, ACCOUNTING_FILE), bytes);
    await writeFile(
      join(dir, ACCOUNTING_MARKER_FILE),
      encodeRecord({
        ...marker,
        file: { ...marker.file, bytes: bytes.byteLength, sha256: sha256(bytes) },
      }),
    );
    assert.equal(await read(), undefined, label);
    assert.deepEqual(
      await readFile(join(dir, ACCOUNTING_FILE)),
      bytes,
      "reader never repairs evidence",
    );
    assert.deepEqual(await readFile(join(dir, MARKER_FILE)), original, "report marker unchanged");
  }
  const namespaceDir = join(root, NAMESPACE_DIR);
  const ns = (await readNamespace(namespaceDir))!;
  const journal = await validateJournal(namespaceDir, ns.namespaceId, "writer");
  assert.equal(
    (
      await verifyCommittedRun(
        namespaceDir,
        ns.namespaceId,
        run.reservation.runId,
        journal.records.get(run.reservation.runId),
      )
    ).ok,
    true,
  );
  await store.settle();
});

it("finite fields and real ledger snapshots survive durable round-trip without filling missing observations", async () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const value = body();
    assert.equal(
      Value.Check(AttemptRecordSchema, { ...value.attempts[0], startedAtMs: bad }),
      false,
    );
    assert.equal(Value.Check(TokenObservationSchema, { inputTotal: bad }), false);
    assert.equal(Value.Check(CostObservationSchema, { total: bad }), false);
  }
  for (const state of ["succeeded", "failed", "aborted", "timed-out"] as const) {
    const { store, run, read } = await published(state);
    const ledger = createAttemptLedger();
    const identity = {
      operationId: "op",
      callId: "c",
      attempt: 1,
      role: "search" as const,
      model: { provider: "fixture", model: "m" },
    };
    ledger.start(identity, 0, 0);
    // Explicit zeros remain known. Unknown-basis cost stays on the attempt only.
    ledger.observe(identity, {
      source: "provider-response",
      costBasis: "unknown",
      cost: { total: 0.02 },
      tokens: { outputTotal: 0, reasoning: 0 },
    });
    ledger.finish(identity, state, 0);
    assert.equal(
      (
        await store.recordAccounting(
          run,
          ledger.records(),
          ledger.summary("unavailable-after-parent-cancel"),
          signal,
        )
      ).status,
      "recorded",
    );
    const verified = await read();
    assert.deepEqual(verified?.attempts, ledger.records());
    assert.deepEqual(verified?.summary, ledger.summary("unavailable-after-parent-cancel"));
    assert.equal(verified?.summary.tokens.inputTotal, undefined);
    assert.equal(verified?.summary.tokens.outputTotal, 0);
    assert.deepEqual(verified?.summary.reportedCost, {});
    await store.settle();
  }
});
