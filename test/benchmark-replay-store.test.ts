// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { requestSha256 } from "../scripts/benchmarks/canonical.js";
import {
  InvalidFixtureFileError,
  ReplayMissError,
  createFixtureRecorder,
  createReplayStore,
  fixtureFileSha256,
  loadFixtureFile,
  loadReplayStore,
  saveFixtureFile,
} from "../scripts/benchmarks/replay-store.js";
import type { FixtureFile } from "../scripts/benchmarks/replay-store.js";
import type { FixtureKey, FixtureRecord } from "../scripts/benchmarks/contracts.js";
import { removeDir, scratchDir } from "../scripts/benchmarks/testing.js";

const SCENARIO = "unit-store";

function key(node: string, hash: string, occurrence = 1): FixtureKey {
  return { boundary: "model", scenario: SCENARIO, operationNode: node, requestSha256: hash, occurrence };
}

function recordedStore() {
  const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
  const requestA = { query: "identical request" };
  const requestB = { query: "identical request" };
  const other = { query: "different request" };
  const first = recorder.record("node.search", requestA, { response: { text: "one" }, delayMs: 0 });
  const second = recorder.record("node.search", requestB, { response: { text: "two" }, delayMs: 0 });
  const third = recorder.record("node.search", { query: "identical request" }, { response: { text: "three" }, delayMs: 0 });
  const elsewhere = recorder.record("node.collate", other, { response: { text: "collated" }, delayMs: 0 });
  return { recorder, first, second, third, elsewhere, requestA, other };
}

describe("fixture recorder occurrence identity", () => {
  it("assigns ordered distinct occurrences to repeated identical calls", () => {
    const { first, second, third } = recordedStore();
    assert.equal(first.key.occurrence, 1);
    assert.equal(second.key.occurrence, 2);
    assert.equal(third.key.occurrence, 3);
    assert.equal(first.key.requestSha256, second.key.requestSha256);
  });

  it("keys by scenario and operation node so nodes never collide", () => {
    const { first, elsewhere } = recordedStore();
    assert.notEqual(first.key.operationNode, elsewhere.key.operationNode);
    assert.notEqual(first.key.requestSha256, elsewhere.key.requestSha256);
  });

  it("computes contentSha256 over the frozen response", () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    const record = recorder.record("n", { q: 1 }, { response: { text: "hello" }, delayMs: 0 });
    assert.match(record.contentSha256, /^[0-9a-f]{64}$/);
    // Same response bytes produce the same content digest; a different
    // response does not.
    const twin = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    const same = twin.record("n", { q: 1 }, { response: { text: "hello" }, delayMs: 0 });
    const changed = twin.record("n2", { q: 1 }, { response: { text: "hellp" }, delayMs: 0 });
    assert.equal(record.contentSha256, same.contentSha256);
    assert.notEqual(record.contentSha256, changed.contentSha256);
  });
});

describe("replay store lookup semantics", () => {
  it("serves each occurrence once in submission order", async () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const request = { query: "identical request" };
    const one = await store.lookup(key("node.search", requestSha256(request), 1), request);
    const two = await store.lookup(key("node.search", requestSha256(request), 2), request);
    assert.equal((one.response as { text: string }).text, "one");
    assert.equal((two.response as { text: string }).text, "two");
    assert.equal(store.consumed().length, 2);
    assert.equal(store.misses().length, 0);
    store.assertValid();
  });

  it("rejects reuse of an already-consumed occurrence", async () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const request = { query: "identical request" };
    await store.lookup(key("node.search", requestSha256(request), 1), request);
    await assert.rejects(
      () => store.lookup(key("node.search", requestSha256(request), 1), request),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "already-consumed",
    );
    assert.equal(store.misses().length, 1);
    assert.throws(() => store.assertValid(), ReplayMissError);
  });

  it("fails closed on an unrecorded occurrence (never live)", async () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const request = { query: "identical request" };
    await assert.rejects(
      () => store.lookup(key("node.search", requestSha256(request), 9), request),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "not-found",
    );
  });

  it("rejects a key whose hash disagrees with the presented request", async () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const request = { query: "different request" };
    const wrongHash = requestSha256({ query: "some other request entirely" });
    await assert.rejects(
      () => store.lookup(key("node.collate", wrongHash, 1), request),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "request-mismatch",
    );
  });

  it("rejects a colliding hash whose canonical bytes differ from the record", async () => {
    // Construct two distinct requests that normalise to the same hash only
    // through a declared binding; serve the recorded one, then present a
    // request with different undeclared bytes under the same key hash.
    const bindings = [{ name: "$runId", paths: ["metadata.runId"] }];
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO, bindings });
    const recorded = { metadata: { runId: "run-aaa", payload: "frozen" } };
    const record = recorder.record("node.bound", recorded, { response: { text: "ok" }, delayMs: 0 });
    const store = createReplayStore({ fixtures: recorder.records(), bindings, scenario: SCENARIO });
    const replayRequest = { metadata: { runId: "run-bbb", payload: "frozen" } };
    const served = await store.lookup(record.key, replayRequest);
    assert.equal((served.response as { text: string }).text, "ok");
    // Same declared binding, but different undeclared bytes presented under
    // the recorded key: the hash check fails closed before any comparison.
    const divergent = { metadata: { runId: "run-bbb", payload: "mutated" } };
    await assert.rejects(
      () => store.lookup(record.key, divergent),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "request-mismatch",
    );
    void record;
  });

  it("treats unconsumed fixtures as skipped, not misses", () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const unconsumed = store.unconsumed();
    assert.equal(unconsumed.length, recorder.records().length);
    assert.equal(store.misses().length, 0);
    store.assertValid();
  });
});

describe("fixture file verification", () => {
  async function tempCopy(file: FixtureFile): Promise<string> {
    const dir = await scratchDir("store");
    const path = join(dir, "fixtures.json");
    await writeFile(path, JSON.stringify(file), "utf8");
    return path;
  }

  it("round-trips through save and load", async () => {
    const dir = await scratchDir("store");
    try {
      const { recorder } = recordedStore();
      const path = join(dir, "roundtrip.json");
      await saveFixtureFile(path, recorder.toFile());
      const loaded = await loadFixtureFile(path);
      assert.equal(loaded.fixtures.length, recorder.records().length);
      const store = await loadReplayStore(path);
      const request = { query: "identical request" };
      const one = await store.lookup(key("node.search", requestSha256(request), 1), request);
      assert.equal((one.response as { text: string }).text, "one");
    } finally {
      await removeDir(dir);
    }
  });

  it("rejects a tampered content hash", async () => {
    const { recorder } = recordedStore();
    const file = recorder.toFile();
    const tampered: FixtureFile = {
      ...file,
      fixtures: file.fixtures.map((record, index) => (index === 0 ? { ...record, contentSha256: "f".repeat(64) } : record)),
    };
    const path = await tempCopy(tampered);
    await assert.rejects(() => loadFixtureFile(path), InvalidFixtureFileError);
  });

  it("rejects a tampered request hash", async () => {
    const { recorder } = recordedStore();
    const file = recorder.toFile();
    const tampered: FixtureFile = {
      ...file,
      fixtures: file.fixtures.map((record, index) =>
        index === 0 ? { ...record, key: { ...record.key, requestSha256: "e".repeat(64) } } : record,
      ),
    };
    const path = await tempCopy(tampered);
    await assert.rejects(() => loadFixtureFile(path), InvalidFixtureFileError);
  });

  it("rejects duplicate keys and scenario mismatch", async () => {
    const { recorder } = recordedStore();
    const dupFile: FixtureFile = { ...recorder.toFile(), fixtures: [...recorder.records(), recorder.records()[0]!] };
    const dupPath = await tempCopy(dupFile);
    await assert.rejects(() => loadFixtureFile(dupPath), InvalidFixtureFileError);

    const wrongScenario: FixtureFile = { ...recorder.toFile(), scenario: "other-scenario" };
    const wrongPath = await tempCopy(wrongScenario);
    await assert.rejects(() => loadFixtureFile(wrongPath), InvalidFixtureFileError);
  });

  it("rejects records without either response or error", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    recorder.record("n", { q: 1 }, { response: { text: "x" }, delayMs: 0 });
    const file = recorder.toFile();
    const broken: FixtureFile = {
      ...file,
      fixtures: [{ ...file.fixtures[0]!, response: undefined } as unknown as FixtureRecord],
    };
    const path = await tempCopy(broken);
    await assert.rejects(() => loadFixtureFile(path), InvalidFixtureFileError);
  });

  it("verifies the committed synthetic fixture files", async () => {
    const model = await loadFixtureFile("scripts/benchmarks/fixtures/synthetic-codemode-dev-model.json");
    const fetch = await loadFixtureFile("scripts/benchmarks/fixtures/synthetic-codemode-dev-fetch.json");
    assert.equal(model.scenario, "synthetic-codemode-dev");
    assert.equal(model.fixtures.length, 6);
    assert.equal(fetch.fixtures.length, 3);
    const raw = JSON.parse(await readFile("scripts/benchmarks/fixtures/synthetic-codemode-dev-model.json", "utf8"));
    assert.equal(raw.schemaVersion, 1);
  });

  it("rejects out-of-order occurrence consumption (L4)", async () => {
    const { recorder } = recordedStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const request = { query: "identical request" };
    await assert.rejects(
      () => store.lookup(key("node.search", requestSha256(request), 2), request),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "out-of-order",
    );
    // In-order service still works afterwards for occurrence 1.
    const first = await store.lookup(key("node.search", requestSha256(request), 1), request);
    assert.equal((first.response as { text: string }).text, "one");
    const second = await store.lookup(key("node.search", requestSha256(request), 2), request);
    assert.equal((second.response as { text: string }).text, "two");
  });

  it("rejects non-integer occurrences at load time (R4)", async () => {
    const { recorder } = recordedStore();
    const file = recorder.toFile();
    const broken: FixtureFile = {
      ...file,
      fixtures: [{ ...file.fixtures[0]!, key: { ...file.fixtures[0]!.key, occurrence: 1.5 } }],
    };
    const path = await tempCopy(broken);
    await assert.rejects(() => loadFixtureFile(path), InvalidFixtureFileError);
  });

  it("verifies the whole record payload: usage, error and delay tampering fail (R4)", async () => {
    const { recorder } = recordedStore();
    const file = recorder.toFile();
    // Tampered usage tokens without updating contentSha256.
    const usageTampered: FixtureFile = {
      ...file,
      fixtures: [{ ...file.fixtures[0]!, usage: { tokens: { inputTotal: 999999 }, source: "provider-response", costBasis: "reported" } }],
    };
    await assert.rejects(() => verifyOnly(usageTampered), InvalidFixtureFileError);
    // Tampered delay (timing drives replay).
    const delayTampered: FixtureFile = {
      ...file,
      fixtures: [{ ...file.fixtures[0]!, delayMs: 99999 }],
    };
    await assert.rejects(() => verifyOnly(delayTampered), InvalidFixtureFileError);
    // A retryable 429 rewritten as a non-finite error kind/message is caught by
    // the whole-record digest as soon as the error bytes change.
    const { recorder: errRecorder } = recordedStore();
    errRecorder.record("node.retry", { q: 1 }, { error: { kind: "rate-limit", message: "429 Too Many Requests" }, delayMs: 0 });
    const errFile = errRecorder.toFile();
    const errorTampered: FixtureFile = {
      ...errFile,
      fixtures: [{ ...errFile.fixtures[errFile.fixtures.length - 1]!, error: { kind: "bad-request", message: "400 permanent" } }],
    };
    await assert.rejects(() => verifyOnly(errorTampered), InvalidFixtureFileError);
  });

  it("rejects bindings that wildcard frozen request fields (L2)", async () => {
    const recorder = createFixtureRecorder({
      boundary: "model",
      scenario: SCENARIO,
      bindings: [{ name: "$prompt", paths: ["userMessage"] }],
    });
    recorder.record("n", { userMessage: "anything at all", maxTokens: 1 }, { response: { text: "x" }, delayMs: 0 });
    await assert.rejects(() => verifyOnly(recorder.toFile()), InvalidFixtureFileError);

    const fetchRecorder = createFixtureRecorder({
      boundary: "fetch",
      scenario: SCENARIO,
      bindings: [{ name: "$url", paths: ["url"] }],
    });
    fetchRecorder.record("n", { url: "https://example.com/x", method: "GET" }, { response: { status: 200 }, delayMs: 0 });
    await assert.rejects(() => verifyOnly(fetchRecorder.toFile()), InvalidFixtureFileError);
  });

  it("rejects a null binding entry with InvalidFixtureFileError, not a TypeError (review r2)", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    recorder.record("n", { generated: { id: "x-1" }, q: 1 }, { response: { text: "ok" }, delayMs: 0 });
    const file = recorder.toFile();
    const broken: FixtureFile = { ...file, bindings: [{ name: "$gen", paths: ["generated.id"] }, null as unknown as never] };
    const path = await tempCopy(broken);
    await assert.rejects(
      () => loadFixtureFile(path),
      (error: unknown) => error instanceof InvalidFixtureFileError,
    );
  });

  it("rejects structurally malformed files with InvalidFixtureFileError (R4)", async () => {
    const dir = await scratchDir("store");
    try {
      for (const [name, content] of [
        ["null.json", "null"],
        ["array.json", "[]"],
        ["string.json", "\"not a file\""],
        ["no-fixtures.json", JSON.stringify({ schemaVersion: 1, kind: "intelli-benchmark-fixtures", scenario: "s" })],
      ] as const) {
        const path = join(dir, name);
        await writeFile(path, content, "utf8");
        await assert.rejects(() => loadFixtureFile(path), InvalidFixtureFileError, name);
      }
    } finally {
      await removeDir(dir);
    }
  });

  it("exposes a verified whole-file canonical digest (R4)", () => {
    const { recorder } = recordedStore();
    const file = recorder.toFile();
    const digest = fixtureFileSha256(file);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(digest, fixtureFileSha256(file));
    // A semantically different but still-valid file (different recorded
    // delay) produces a different digest: fixtureSha256 pins content.
    const other = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    other.record("node.search", { query: "identical request" }, { response: { text: "one" }, delayMs: 7 });
    assert.notEqual(digest, fixtureFileSha256(other.toFile()));
    // An invalid file (tampered usage) has no digest: verification gates it.
    const tampered: FixtureFile = {
      ...file,
      fixtures: [{ ...file.fixtures[0]!, usage: { tokens: { inputTotal: 999999 }, source: "provider-response", costBasis: "reported" } }],
    };
    assert.throws(() => fixtureFileSha256(tampered), InvalidFixtureFileError);
  });
});

async function verifyOnly(file: FixtureFile): Promise<void> {
  // Loads through the same verification path without touching disk state.
  const dir = await scratchDir("store");
  try {
    const path = join(dir, "verify.json");
    await saveFixtureFile(path, file);
  } finally {
    await removeDir(dir);
  }
}

