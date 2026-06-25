// test/telemetry.test.ts — Unit tests for the local telemetry sidecar.
//
// Verifies the schema shape, the atomic write (no stray .tmp on success),
// the schemaVersion/extensionVersion separation, and the fail-safe version
// read. Follows the filesystem-isolation pattern from AGENTS.md Principle 1.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TelemetryBuilder,
  writeTelemetry,
  SCHEMA_VERSION,
  _resetVersionCacheForTests,
} from "../src/telemetry.js";
import type { TelemetryMeta } from "../src/telemetry.js";

// Build a fully-populated payload for round-trip assertions.
function buildSampleMeta(version: string): TelemetryMeta {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: version,
    query: "test query",
    timestamp: "2026-06-25T12:00:00.000Z",
    durationMs: 1234,
    stages: {
      search: { model: "openrouter/perplexity/sonar", linksReturned: 5, retryFired: false, attempts: 1 },
      fetch: { requested: 5, succeeded: 4, failed: 1, winners: { defuddle: 3, markdown: 1 } },
      extract: { model: "openrouter/minimax/minimax-m2.7", succeeded: 4, failed: 0, totalInputChars: 200_000, totalOutputChars: 16_000 },
      collate: { model: "openrouter/minimax/minimax-m2.7", summaryChars: 4_000 },
      cacheSuggest: { ran: true, surfaced: 2, slugs: ["2026-05-01-foo-abc123", "2026-05-02-bar-def456"] },
    },
  };
}

describe("SCHEMA_VERSION", () => {
  it("is 1 (the initial payload shape version)", () => {
    assert.strictEqual(SCHEMA_VERSION, 1);
  });
});

describe("writeTelemetry", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-intelli-tel-"));
  });

  it("writes meta.json with the expected top-level keys", async () => {
    const meta = buildSampleMeta("0.11.0");
    await writeTelemetry(dir, meta);
    const written = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8")) as TelemetryMeta;

    // Top-level contract: schemaVersion decoupled from extensionVersion.
    assert.strictEqual(written.schemaVersion, 1);
    assert.strictEqual(written.extensionVersion, "0.11.0");
    assert.strictEqual(written.query, "test query");
    assert.strictEqual(typeof written.durationMs, "number");
    assert.strictEqual(typeof written.timestamp, "string");
    // All five stage buckets present.
    for (const stage of ["search", "fetch", "extract", "collate", "cacheSuggest"]) {
      assert.ok(stage in written.stages, `stage ${stage} missing`);
    }
  });

  it("preserves fetch winner tallies and cache-suggest slugs", async () => {
    const meta = buildSampleMeta("0.11.0");
    await writeTelemetry(dir, meta);
    const written = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8")) as TelemetryMeta;

    assert.deepStrictEqual(written.stages.fetch.winners, { defuddle: 3, markdown: 1 });
    assert.deepStrictEqual(written.stages.cacheSuggest.slugs, [
      "2026-05-01-foo-abc123",
      "2026-05-02-bar-def456",
    ]);
    assert.strictEqual(written.stages.cacheSuggest.surfaced, 2);
    assert.strictEqual(written.stages.search.retryFired, false);
  });

  it("leaves no stray .tmp file after a successful atomic write", async () => {
    const meta = buildSampleMeta("0.11.0");
    await writeTelemetry(dir, meta);
    const entries = await readdir(dir);
    const tmps = entries.filter((e) => e.endsWith(".tmp"));
    assert.deepStrictEqual(tmps, [], `stray temp files: ${tmps.join(", ")}`);
    assert.ok(entries.includes("meta.json"), "meta.json not present");
  });

  it("overwrites a prior meta.json in place (refresh semantics)", async () => {
    await writeTelemetry(dir, buildSampleMeta("0.10.0"));
    await writeTelemetry(dir, buildSampleMeta("0.11.0"));
    const written = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8")) as TelemetryMeta;
    assert.strictEqual(written.extensionVersion, "0.11.0");
  });
});

describe("TelemetryBuilder", () => {
  it("finalize() stamps a non-negative durationMs", async () => {
    _resetVersionCacheForTests();
    const builder = await TelemetryBuilder.create("q");
    const meta = builder.finalize();
    assert.ok(meta.durationMs >= 0);
    assert.strictEqual(meta.schemaVersion, 1);
  });

  it("recordSearch/fetch/extract/collate/cacheSuggest populate their slices", async () => {
    _resetVersionCacheForTests();
    const builder = await TelemetryBuilder.create("q");
    builder.recordSearch({ model: "p/m", linksReturned: 3, retryFired: true, attempts: 2 });
    builder.recordFetch({ requested: 3, succeeded: 2, failed: 1, winners: { defuddle: 2 } });
    builder.recordExtract({ model: "p/m", succeeded: 2, failed: 0, totalInputChars: 10, totalOutputChars: 5 });
    builder.recordCollate({ model: "p/m", summaryChars: 100 });
    builder.recordCacheSuggest({ ran: false, surfaced: 0, slugs: [] });
    const meta = builder.finalize();

    assert.strictEqual(meta.stages.search.retryFired, true);
    assert.strictEqual(meta.stages.search.attempts, 2);
    assert.deepStrictEqual(meta.stages.fetch.winners, { defuddle: 2 });
    assert.strictEqual(meta.stages.extract.totalOutputChars, 5);
    assert.strictEqual(meta.stages.collate.summaryChars, 100);
    assert.strictEqual(meta.stages.cacheSuggest.ran, false);
  });

  it("reads extensionVersion from package.json (falls back to 'unknown' on failure)", async () => {
    _resetVersionCacheForTests();
    // From src/test context, package.json resolves to repo root via ../ from
    // dist or src. Accept either a real semver string or the "unknown" fallback;
    // both prove the read path does not throw.
    const builder = await TelemetryBuilder.create("q");
    const meta = builder.finalize();
    assert.ok(
      meta.extensionVersion.length > 0,
      "extensionVersion must be a non-empty string",
    );
    assert.notStrictEqual(meta.extensionVersion, "");
  });
});
