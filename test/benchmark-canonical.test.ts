// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CanonicalisationError,
  canonicalJson,
  normaliseByBindings,
  requestSha256,
  sha256Canonical,
} from "../scripts/benchmarks/canonical.js";

describe("canonical JSON serialisation", () => {
  it("sorts object keys by UTF-16 code unit without case-folding", () => {
    assert.equal(canonicalJson({ b: 1, A: 2, a: 3 }), '{"A":2,"a":3,"b":1}');
  });

  it("preserves array order and nested key sorting", () => {
    assert.equal(
      canonicalJson({ z: [{ y: 2, x: 1 }], a: [] }),
      '{"a":[],"z":[{"x":1,"y":2}]}',
    );
  });

  it("never rewrites or trims string values", () => {
    assert.equal(canonicalJson({ text: "  Exact  CASE  stays  " }), '{"text":"  Exact  CASE  stays  "}');
  });

  it("rejects non-finite numbers and non-JSON values", () => {
    assert.throws(() => canonicalJson({ x: Number.NaN }), CanonicalisationError);
    assert.throws(() => canonicalJson(undefined), CanonicalisationError);
    assert.throws(() => canonicalJson(() => 1), CanonicalisationError);
  });

  it("omits undefined-valued properties but keeps explicit nulls", () => {
    assert.equal(canonicalJson({ a: undefined as unknown as null, b: 1 }), '{"b":1}');
    assert.equal(canonicalJson({ a: null, b: 1 }), '{"a":null,"b":1}');
  });

  it("hashes deterministically across key insertion order", () => {
    const a = requestSha256({ alpha: 1, beta: [true, null] });
    const b = requestSha256({ beta: [true, null], alpha: 1 });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("treats absent and null fields differently", () => {
    assert.notEqual(requestSha256({ a: null }), requestSha256({}));
  });
});

describe("declared binding-map normalisation", () => {
  it("replaces whole fields at declared paths only", () => {
    const request = {
      metadata: { runId: "run-abc-111", kind: "research" },
      prompt: "the run id run-abc-111 appears here too",
      "messages": [{ id: 7, label: "gen-xyz" }],
    };
    const normalised = normaliseByBindings(request, [
      { name: "$runId", paths: ["metadata.runId"] },
      { name: "$genLabel", paths: ["messages.0.label"] },
    ]) as { metadata: Record<string, unknown>; prompt: string; messages: Array<Record<string, unknown>> };
    assert.deepEqual(normalised.metadata.runId, { $binding: "$runId" });
    assert.deepEqual(normalised.messages[0]?.label, { $binding: "$genLabel" });
    assert.equal(normalised.metadata.kind, "research");
    // Arbitrary string contents are never rewritten (C30).
    assert.equal(normalised.prompt, "the run id run-abc-111 appears here too");
    assert.equal(normalised.messages[0]?.id, 7);
  });

  it("makes distinct generated values hash-equal at declared paths", () => {
    const bindings = [{ name: "$runId", paths: ["metadata.runId"] }];
    const first = requestSha256({ metadata: { runId: "run-abc-111" } }, bindings);
    const second = requestSha256({ metadata: { runId: "run-DEF-999" } }, bindings);
    assert.equal(first, second);
  });

  it("leaves undeclared value changes hash-different", () => {
    const first = requestSha256({ metadata: { runId: "run-abc-111", nonce: 1 } });
    const second = requestSha256({ metadata: { runId: "run-abc-111", nonce: 2 } });
    assert.notEqual(first, second);
  });

  it("fails closed when a declared path diverges between recording and replay", () => {
    const bindings = [{ name: "$runId", paths: ["metadata.runId"] }];
    const recorded = requestSha256({ metadata: { runId: "run-abc-111", extra: true } }, bindings);
    const replayed = requestSha256({ metadata: { runId: "run-abc-111" } }, bindings);
    assert.notEqual(recorded, replayed);
  });

  it("rejects malformed binding declarations", () => {
    assert.throws(() => normaliseByBindings({ a: 1 }, [{ name: "", paths: ["a"] }]), CanonicalisationError);
    assert.throws(() => normaliseByBindings({ a: 1 }, [{ name: "x", paths: ["a..b"] }]), CanonicalisationError);
  });

  it("supports array-index binding paths", () => {
    const normalised = normaliseByBindings(
      { calls: [{ id: "c1" }, { id: "c2" }] },
      [{ name: "$call", paths: ["calls.1.id"] }],
    ) as { calls: Array<{ id: unknown }> };
    assert.equal(normalised.calls[0]?.id, "c1");
    assert.deepEqual(normalised.calls[1]?.id, { $binding: "$call" });
  });

  it("content hashing covers response payloads exactly", () => {
    assert.equal(
      sha256Canonical(null),
      sha256Canonical(null),
    );
    assert.notEqual(sha256Canonical({ a: 1 }), sha256Canonical({ a: 2 }));
  });
});
