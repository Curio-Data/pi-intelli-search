// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Exact canonical serialisation and binding-map normalisation for benchmark
// fixture identity. C30: "Exact request hashing uses sorted-key serialisation
// without case-folding/string rewriting." Keys sort lexicographically by
// UTF-16 code unit, scalars serialise exactly as JSON.stringify produces
// them, and no string value is ever rewritten, folded or trimmed.

import { createHash } from "node:crypto";
import type { Json } from "./contracts.js";

/** Thrown when a value is not exact JSON or a binding path is malformed. */
export class CanonicalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalisationError";
  }
}

function isJsonObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical JSON: object keys sorted lexicographically (UTF-16 code units),
 * no insignificant whitespace, arrays keep order, string values untouched.
 * Rejects undefined, functions, symbols, bigints and other non-JSON values
 * instead of silently coercing them.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, []);
}

function serialize(value: unknown, path: readonly string[]): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalisationError(`Non-finite number at ${path.join(".") || "$"}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item, i) => serialize(item, [...path, String(i)])).join(",")}]`;
      if (!isJsonObject(value)) throw new CanonicalisationError(`Non-JSON object at ${path.join(".") || "$"}`);
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue; // optional field omitted, not null
        parts.push(`${JSON.stringify(key)}:${serialize(item, [...path, key])}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalisationError(`Non-JSON value of type ${typeof value} at ${path.join(".") || "$"}`);
  }
}

/** sha256 hex digest of the canonical serialisation of `value`. */
export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** sha256 hex digest of raw bytes. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** sha256 hex digest of a UTF-8 string. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Narrows a plain structural object to the Json wire type at API boundaries
 * (interfaces without index signatures are still exact JSON at runtime).
 * Throws if the value cannot be canonically serialised, so a non-JSON object
 * never silently enters fixture identity.
 */
export function asJson(value: unknown): Json {
  canonicalJson(value); // validation: throws on non-JSON content
  return value as Json;
}

/**
 * A declared generated-identity/path binding. Only the exact declared paths
 * are normalised (whole-field replacement with the binding placeholder);
 * arbitrary source/code strings are never rewritten (C30).
 */
export interface RequestBinding {
  /** Binding name, used as the placeholder token. Must be nonempty. */
  readonly name: string;
  /** Dot/numeric-index paths into the request JSON, e.g. ["metadata.runId", "messages.0.label"]. */
  readonly paths: readonly string[];
  /** Value observed at capture time at the first declared path, recorded for audit only. */
  readonly capturedValue?: Json;
}

/** Marker object substituted at declared binding paths before hashing. */
export interface BindingPlaceholder {
  readonly "$binding": string;
}

function setAtPath(root: Record<string, unknown>, path: readonly string[], value: unknown, binding: string): void {
  let node: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i]!;
    const next: unknown = Array.isArray(node)
      ? (node as unknown[])[Number(segment)]
      : (node as Record<string, unknown>)[segment];
    if (typeof next !== "object" || next === null) return; // path absent: nothing to replace
    node = next as Record<string, unknown> | unknown[];
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(node)) {
    const index = Number(last);
    if (Number.isInteger(index) && index >= 0 && index < (node as unknown[]).length) {
      (node as unknown[])[index] = value;
    }
  } else {
    const container = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(container, last)) container[last] = value;
    // Absent declared paths are left absent on both sides; a present/absent
    // divergence therefore changes the canonical bytes and fails closed.
  }
  void binding;
}

/**
 * Deep-copy `request` with every declared binding path replaced by its
 * placeholder marker. This is the only normalisation applied before hashing;
 * it is path-exact and never rewrites string contents.
 */
export function normaliseByBindings(request: Json, bindings: readonly RequestBinding[] = []): Json {
  const clone = structuredClone(request) as Record<string, unknown>;
  for (const binding of bindings) {
    if (!binding.name) throw new CanonicalisationError("Binding name must be nonempty");
    for (const rawPath of binding.paths) {
      const path = rawPath.split(".").map((segment) => segment.trim());
      if (path.length === 0 || path.some((segment) => segment === "")) {
        throw new CanonicalisationError(`Malformed binding path "${rawPath}" for binding "${binding.name}"`);
      }
      setAtPath(clone, path, { $binding: binding.name } satisfies BindingPlaceholder, binding.name);
    }
  }
  return clone as unknown as Json;
}

/** Canonical hash of a request after declared binding normalisation. */
export function requestSha256(request: Json, bindings: readonly RequestBinding[] = []): string {
  return sha256Canonical(normaliseByBindings(request, bindings));
}
