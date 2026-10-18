// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Read-only before_provider_request observer (C30). The observer records
// sanitised actual main payloads and tool declarations; it never returns a
// payload replacement and never receives authentication headers (the host
// event carries the request body only). Captures are buffered and flushed to
// an NDJSON file; `complete` is true exactly when every captured record is
// durably flushed.

import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, sha256Canonical, sha256Text } from "./canonical.js";
import type { Json, RequestCapture, RequestObserver } from "./contracts.js";

const SENSITIVE_KEYS = new Set(["authorization", "api_key", "apikey", "x-api-key", "cookie"]);
const BASE64_MIN_LENGTH = 256;

export class ObserverSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObserverSequenceError";
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeBase64(text: string): boolean {
  return text.length >= BASE64_MIN_LENGTH && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
}

/**
 * Sanitises a provider request payload for observation: drops sensitive
 * header-like keys anywhere in the object, replaces inline base64/image data
 * with bounded byte-size markers, and leaves every other value exact.
 * Sanitisation is read-only evidence preparation; it never produces a payload
 * replacement for dispatch.
 */
export function sanitiseProviderPayload(payload: unknown, path = "$"): Json {
  if (payload === null || typeof payload === "string" || typeof payload === "boolean") return payload as Json;
  if (typeof payload === "number") {
    if (!Number.isFinite(payload)) return null;
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item, index) => sanitiseProviderPayload(item, `${path}[${index}]`));
  }
  if (!isJsonObject(payload)) return null;
  const out: Record<string, Json> = {};
  for (const key of Object.keys(payload).sort()) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = { redacted: "sensitive-key" };
      continue;
    }
    const value = payload[key];
    if (typeof value === "string" && looksLikeBase64(value)) {
      out[key] = { redacted: "inline-bytes", bytes: value.length };
      continue;
    }
    out[key] = sanitiseProviderPayload(value, `${path}.${key}`);
  }
  return out as Json;
}

/**
 * sha256 of the canonical sanitised tool declarations carried by a provider
 * payload. Payloads without a tools array hash the canonical empty array so
 * captures remain comparable across arms.
 */
export function toolCatalogueSha256(sanitisedPayload: Json): string {
  const tools = isJsonObject(sanitisedPayload) ? sanitisedPayload["tools"] : undefined;
  return sha256Canonical(tools ?? []);
}

/** sha256 of the canonical sanitised payload itself. */
export function payloadSha256(sanitisedPayload: Json): string {
  return sha256Canonical(sanitisedPayload);
}

export interface RequestObserverOptions {
  /** NDJSON capture file; created (with parents) on first flush. */
  readonly outPath: string;
  /** Correlation id for the assistant message this request belongs to. */
  readonly assistantRequestId?: string;
}

export interface FileRequestObserver extends RequestObserver {
  readonly outPath: string;
  readonly captured: number;
}

/**
 * Creates a read-only file observer. `capture` validates strictly increasing
 * sequence numbers from 1 and buffers the record; `flush` appends buffered
 * lines and fsyncs. `complete` is true exactly when the buffer is empty after
 * a successful flush of everything captured so far.
 */
export function createRequestObserver(options: RequestObserverOptions): FileRequestObserver {
  const buffer: RequestCapture[] = [];
  let nextSequence = 1;
  let flushed = 0;
  let captured = 0;
  let complete = true; // nothing captured yet: everything captured is flushed
  const observer: FileRequestObserver = {
    outPath: options.outPath,
    get captured() {
      return captured;
    },
    get complete() {
      return complete;
    },
    capture(record) {
      if (record.sequence !== nextSequence) {
        throw new ObserverSequenceError(
          `Capture sequence ${record.sequence} violates the expected strictly-increasing sequence ${nextSequence}`,
        );
      }
      if (typeof record.assistantRequestId !== "string" || record.assistantRequestId === "") {
        throw new ObserverSequenceError("Capture.assistantRequestId must be a nonempty correlation id");
      }
      if (!/^[0-9a-f]{64}$/.test(record.payloadSha256) || !/^[0-9a-f]{64}$/.test(record.toolCatalogueSha256)) {
        throw new ObserverSequenceError("Capture hashes must be lowercase sha256 hex digests");
      }
      nextSequence += 1;
      captured += 1;
      complete = false;
      buffer.push(record);
    },
    async flush() {
      if (buffer.length === 0) {
        complete = flushed === captured;
        return;
      }
      await mkdir(dirname(options.outPath), { recursive: true });
      const handle = await open(options.outPath, "a");
      try {
        const chunk = buffer.map((record) => canonicalJson(record)).join("\n");
        await handle.appendFile(chunk.endsWith("\n") ? chunk : `${chunk}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      flushed += buffer.length;
      buffer.length = 0;
      complete = flushed === captured;
    },
  };
  return observer;
}

/**
 * Convenience capture from a host `before_provider_request` payload: sanitise,
 * hash, correlate and buffer in one step. This is the read-only path the
 * coordinator wires to the native event; it returns void and never mutates
 * the payload.
 */
export function captureProviderPayload(
  observer: FileRequestObserver,
  payload: unknown,
  assistantRequestId: string,
): RequestCapture {
  const sanitised = sanitiseProviderPayload(payload);
  const record: RequestCapture = {
    sequence: observer.captured + 1,
    assistantRequestId,
    payload: sanitised,
    payloadSha256: payloadSha256(sanitised),
    toolCatalogueSha256: toolCatalogueSha256(sanitised),
  };
  observer.capture(record);
  return record;
}

/** sha256 helper used by capture-file integrity checks. */
export function captureLineSha256(line: string): string {
  return sha256Text(line);
}
