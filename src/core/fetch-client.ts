// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { lstat, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  Clock,
  FetchClient,
  FetchParams,
  FetchScope,
  OperationLease,
  PageTransport,
  SourceRecord,
} from "./contracts.js";
import { AdmissionError } from "./execution-coordinator.js";
import { validatePageTransportUrl } from "./page-transport.js";
import {
  cleanFetchedHtml,
  guessTitleFromMarkdown,
  sanitizeMarkdown,
  scoreContent,
} from "./fetch.js";

export type FetchDiagnosticCode =
  | "FETCH_TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "HTTP_STATUS"
  | "UNSUPPORTED_CONTENT"
  | "TRANSPORT_FAILED"
  | "INVALID_ALTERNATE"
  | "DISCOVERY_WRITE_FAILED";
class FetchFault extends Error {
  constructor(readonly code: FetchDiagnosticCode) {
    super(code);
  }
}
export interface FetchClientOptions {
  readonly operation: OperationLease;
  readonly clock: Clock;
  readonly transport: PageTransport;
  readonly browser: string;
  readonly proxy?: string;
  readonly timeoutMs: number;
  readonly concurrency: number;
  readonly maxResponseBytes: number;
  readonly docsMaxResponseBytes: number;
  readonly maxChars: number;
}
const aborted = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new AdmissionError("ABORTED", "Fetch cancelled");
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw aborted(signal);
};
const boundedInteger = (value: number, min: number, max: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new TypeError(`Invalid fetch ${name}`);
};

/** One captured operation. No timers, network or files are created by construction. */
export function createFetchClient(options: FetchClientOptions): FetchClient {
  const o = Object.freeze({ ...options });
  boundedInteger(o.concurrency, 1, 512, "fetchConcurrency");
  boundedInteger(o.timeoutMs, 1, 600_000, "fetchTimeoutMs");
  boundedInteger(o.maxResponseBytes, 65_536, 16_777_216, "byte limit");
  boundedInteger(o.docsMaxResponseBytes, 65_536, 33_554_432, "documentation byte limit");
  boundedInteger(o.maxChars, 1, 500_000, "character limit");
  let active = 0;
  const waiting: Array<{ start: () => void; signal: AbortSignal; cancel: () => void }> = [];
  const pump = () => {
    while (active < o.concurrency && waiting.length) {
      const next = waiting.shift()!;
      next.signal.removeEventListener("abort", next.cancel);
      next.start();
    }
  };
  const logical = <T>(signal: AbortSignal, body: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const start = () => {
        if (signal.aborted) {
          reject(aborted(signal));
          return;
        }
        active++;
        void (async () => {
          try {
            return await body();
          } finally {
            active--;
            pump();
          }
        })().then(resolve, reject);
      };
      if (signal.aborted) {
        reject(aborted(signal));
        return;
      }
      if (active < o.concurrency) {
        start();
        return;
      }
      if (waiting.length >= 512) {
        reject(new AdmissionError("BUSY", "Fetch logical queue full"));
        return;
      }
      const item = {
        start,
        signal,
        cancel: () => {
          const at = waiting.indexOf(item);
          if (at >= 0) waiting.splice(at, 1);
          signal.removeEventListener("abort", item.cancel);
          reject(aborted(signal));
        },
      };
      waiting.push(item);
      signal.addEventListener("abort", item.cancel, { once: true });
    });
  const own = <T>(operation: OperationLease, body: () => Promise<T>): Promise<T> => {
    if (operation !== o.operation)
      throw new TypeError("Fetch client requires its authoritative operation");
    // Register before admitting any asynchronous work, including logical waits.
    let start!: () => void;
    const task = new Promise<T>((resolve, reject) => {
      start = () => {
        void Promise.resolve()
          .then(() => {
            check(operation.signal);
            return body();
          })
          .then(resolve, reject);
      };
    });
    operation.track(task);
    start();
    return task;
  };

  /** A physical permit covers headers, redirects, incremental read and cancel/close. */
  const read = async (
    url: string,
    accept: string,
    limit: number,
    scope: FetchScope | undefined,
    transferred: (bytes: number) => void,
    timeoutMs = o.timeoutMs,
    accepts: (contentType: string) => boolean = () => true,
  ) => {
    validatePageTransportUrl(url);
    const permit = await o.operation.acquireFetch(scope);
    const timeout = new AbortController();
    const signal = AbortSignal.any([permit.signal, timeout.signal]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation: Promise<void> | undefined;
    const cancel = () => {
      if (reader && !cancellation) cancellation = reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    let clearTimer = () => {};
    try {
      clearTimer = o.clock.schedule(timeoutMs, () =>
        timeout.abort(new FetchFault("FETCH_TIMEOUT")),
      );
      check(signal);
      const response = await o.transport(url, {
        method: "GET",
        headers: { Accept: accept },
        browser: o.browser,
        ...(o.proxy === undefined ? {} : { proxy: o.proxy }),
        signal,
      });
      if (response.body) reader = response.body.getReader();
      check(signal);
      validatePageTransportUrl(response.url);
      if (response.status < 200 || response.status >= 300) throw new FetchFault("HTTP_STATUS");
      const contentType = response.headers.get("content-type") ?? "";
      if (!accepts(contentType)) throw new FetchFault("UNSUPPORTED_CONTENT");
      const length = response.headers.get("content-length");
      const encoding = response.headers.get("content-encoding");
      if (
        (!encoding || encoding === "identity") &&
        length &&
        /^\d+$/.test(length) &&
        Number(length) > limit
      )
        throw new FetchFault("RESPONSE_TOO_LARGE");
      let bytes = 0;
      const text: string[] = [];
      const decoder = new TextDecoder();
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          check(signal);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          transferred(chunk.value.byteLength);
          if (bytes > limit) throw new FetchFault("RESPONSE_TOO_LARGE");
          text.push(decoder.decode(chunk.value, { stream: true }));
        }
      text.push(decoder.decode());
      check(signal);
      return {
        text: text.join(""),
        contentType: response.headers.get("content-type") ?? "",
        url: response.url,
        signal: permit.signal,
      };
    } catch (error) {
      if (permit.signal.aborted) throw aborted(permit.signal);
      if (timeout.signal.aborted) throw new FetchFault("FETCH_TIMEOUT");
      if (error instanceof FetchFault) throw error;
      throw new FetchFault("TRANSPORT_FAILED");
    } finally {
      // A pending read may resolve early on cancel. Await the independent cancel
      // promise too: the accepted transport resolves it only after child close.
      cancel();
      await cancellation;
      reader?.releaseLock();
      clearTimer();
      signal.removeEventListener("abort", cancel);
      permit.release();
    }
  };
  const signalOf = (scope?: FetchScope) =>
    scope?.signal ? AbortSignal.any([o.operation.signal, scope.signal]) : o.operation.signal;
  const markdown = (text: string) => {
    const content = sanitizeMarkdown(text);
    return { title: guessTitleFromMarkdown(content), content, sourceType: "markdown" };
  };
  const fetch = async (params: FetchParams, operation: OperationLease, scope?: FetchScope) => {
    validatePageTransportUrl(params.url);
    if (params.maxChars !== undefined)
      boundedInteger(params.maxChars, 1, Number.MAX_SAFE_INTEGER, "maxChars");
    const maxChars = Math.min(params.maxChars ?? o.maxChars, o.maxChars);
    const url = params.url;
    scope = scope ? { ...scope } : undefined;
    return own(operation, () =>
      logical(signalOf(scope), async () => {
        let transferredBytes = 0;
        const pageSignals: AbortSignal[] = [];
        const physical = async (
          target: string,
          accept: string,
          accepts: (type: string) => boolean = () => true,
        ) => {
          const result = await read(
            target,
            accept,
            o.maxResponseBytes,
            scope,
            (bytes) => {
              transferredBytes += bytes;
            },
            o.timeoutMs,
            accepts,
          );
          pageSignals.push(result.signal);
          return result;
        };
        const html = async () => {
          const response = await physical(url, "text/html", isHtml);
          if (!/text\/html|application\/xhtml/i.test(response.contentType))
            throw new FetchFault("UNSUPPORTED_CONTENT");
          const page = await cleanFetchedHtml(response.url, response.text, Number.MAX_SAFE_INTEGER);
          return {
            title: page.title,
            content: page.content,
            sourceType: page.source ?? "defuddle",
          };
        };
        const variantFaults: FetchFault[] = [];
        const variant = async () => {
          try {
            const accepted = await physical(url, "text/markdown", isMarkdown);
            if (/text\/markdown/i.test(accepted.contentType)) return markdown(accepted.text);
          } catch (error) {
            if (!(error instanceof FetchFault)) throw error;
            variantFaults.push(error);
            // A refused Accept variant does not withdraw a valid alternate link.
          }
          const probe = await physical(url, "text/html", isHtml);
          if (!/text\/html|application\/xhtml/i.test(probe.contentType))
            throw new FetchFault("UNSUPPORTED_CONTENT");
          // Parse only an already bounded body; use the same alternate-link path.
          const { parseHTML } = await import("linkedom");
          const { document } = parseHTML(probe.text);
          const href = document
            .querySelector('link[rel="alternate"][type="text/markdown"][href]')
            ?.getAttribute("href");
          if (!href) throw new FetchFault("UNSUPPORTED_CONTENT");
          let target: string;
          try {
            target = new URL(href, probe.url).href;
            validatePageTransportUrl(target);
          } catch {
            throw new FetchFault("INVALID_ALTERNATE");
          }
          return markdown((await physical(target, "text/markdown")).text);
        };
        const results = await Promise.allSettled([html(), variant()]);
        check(signalOf(scope));
        for (const signal of pageSignals) check(signal);
        const cutoff = results.find(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof AdmissionError &&
            r.reason.code === "PAGE_CUTOFF",
        );
        if (cutoff?.status === "rejected") throw cutoff.reason;
        const successes = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const page = successes.sort((a, b) => scoreContent(b.content) - scoreContent(a.content))[0];
        if (!page) {
          const reasons = [
            ...variantFaults,
            ...results.flatMap((r) => (r.status === "rejected" ? [r.reason] : [])),
          ];
          const admission = reasons.find((e) => e instanceof AdmissionError);
          if (admission) throw admission;
          const priority: FetchDiagnosticCode[] = [
            "RESPONSE_TOO_LARGE",
            "FETCH_TIMEOUT",
            "HTTP_STATUS",
            "INVALID_ALTERNATE",
            "UNSUPPORTED_CONTENT",
            "TRANSPORT_FAILED",
          ];
          const diagnostic =
            priority.find((code) =>
              reasons.some((e) => e instanceof FetchFault && e.code === code),
            ) ?? "TRANSPORT_FAILED";
          return {
            page: {
              id: scope?.pageId ?? "S1",
              url,
              title: "",
              state: "fetch-failed" as const,
              diagnostic,
            },
            transferredBytes,
          };
        }
        let content = page.content.slice(0, maxChars);
        if (/[\uD800-\uDBFF]$/.test(content) && page.content.length > content.length)
          content = content.slice(0, -1);
        return {
          page: {
            id: scope?.pageId ?? "S1",
            url,
            title: page.title,
            state: content.trim() ? ("fetched" as const) : ("empty" as const),
            sourceType: page.sourceType,
            content,
            truncated: page.content.length > maxChars,
          },
          transferredBytes,
        };
      }),
    );
  };
  return Object.freeze({
    fetch,
    async discover(
      urls: readonly string[],
      stagingRoot: string,
      operation: OperationLease,
      discoverySignal: AbortSignal,
    ) {
      // Validate the entire population before a first transport or file write.
      for (const url of urls) validatePageTransportUrl(url);
      if (!isAbsolute(stagingRoot))
        throw new TypeError("Discovery requires an absolute owned staging root");
      const targets = [...new Set(urls.map(documentationUrl))];
      return own(operation, async () => {
        const signal = AbortSignal.any([operation.signal, discoverySignal]);
        const records: SourceRecord[] = [];
        await Promise.allSettled(
          targets.map((url, i) =>
            logical(signal, async () => {
              let directory: string | undefined;
              try {
                const response = await read(
                  url,
                  "text/plain",
                  o.docsMaxResponseBytes,
                  { signal },
                  () => {},
                  Math.min(o.timeoutMs, 10_000),
                );
                check(signal);
                if (!response.text.trim()) return;
                const stat = await lstat(stagingRoot);
                if (!stat.isDirectory() || stat.isSymbolicLink())
                  throw new FetchFault("DISCOVERY_WRITE_FAILED");
                directory = await mkdtemp(join(stagingRoot, "docs-"));
                await mkdir(join(directory, "sources"), { mode: 0o700 });
                const path = join(directory, "sources", "llms-full.md");
                await writeFile(path, response.text, { flag: "wx", mode: 0o600 });
                check(signal);
                records.push({
                  id: `D${i + 1}`,
                  url,
                  title: new URL(url).hostname,
                  state: "fetched",
                  sourceType: "llms-full",
                  fullPagePath: path,
                });
                directory = undefined;
              } finally {
                if (directory) await rm(directory, { recursive: true, force: true });
              }
            }),
          ),
        );
        check(operation.signal);
        return records.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
      });
    },
  });
}

const isHtml = (type: string) => /text\/html|application\/xhtml/i.test(type);
const isMarkdown = (type: string) => /text\/markdown/i.test(type);

function documentationUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "developers.cloudflare.com") {
    const product = url.pathname.match(/^\/([^/]+)\//)?.[1];
    if (product) return `https://${url.hostname}/${product}/llms-full.txt`;
  }
  if (url.hostname === "nextjs.org") return "https://nextjs.org/docs/llms-full.txt";
  return `https://${url.hostname}/llms-full.txt`;
}
