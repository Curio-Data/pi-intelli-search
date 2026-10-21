// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { PageTransport, PageTransportResponse } from "./execution-contracts.js";
import { pageTransportWorker } from "./page-transport-worker.js";

export interface ProcessPageTransportOptions {
  /** Captured by the adapter, not discovered from a workspace or host setting. */
  readonly executable: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** Validate before spawning, and repeat for redirect targets inside the child. */
export function validatePageTransportUrl(value: string): void {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value))
    throw new TypeError("Page URLs must be HTTP(S) without embedded credentials or whitespace");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Page URLs must be valid HTTP(S) URLs");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("Page URLs must be HTTP(S) without embedded credentials");
}

const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Page request aborted", "AbortError");
const requestFailure = () => new Error("Page transport request failed");

/**
 * One child per physical request chain. Construction starts no process, timer
 * or dependency load. The caller holds its fetch permit until body EOF/cancel.
 * Stream completion and transport rejection both follow the child's `close`
 * event, which follows process exit and stdio/IPC closure, not JS reader cancel.
 */
export function createProcessPageTransport(options: ProcessPageTransportOptions): PageTransport {
  if (typeof options.executable !== "string" || !options.executable)
    throw new TypeError("Page transport requires a Node.js executable");
  const executable = options.executable;
  // No implicit parent environment or debug arguments. The adapter selects the full
  // environment, including any deliberate certificate/proxy or loader policy.
  // Production-install probes supply an explicit ancestor-denying loader here.
  const environment = Object.freeze({ ...options.environment });
  const require = createRequire(import.meta.url);

  return async (url, request) => {
    if (request.signal.aborted) throw abortReason(request.signal);
    validatePageTransportUrl(url);
    if (!["GET", "HEAD"].includes(request.method))
      throw new TypeError("Page transport supports GET and HEAD only");
    if (typeof request.browser !== "string" || !request.browser)
      throw new TypeError("Page transport requires a browser profile");
    if (request.proxy !== undefined && typeof request.proxy !== "string")
      throw new TypeError("Page transport proxy must be a string");
    const headers = { ...request.headers };
    if (Object.values(headers).some((value) => typeof value !== "string"))
      throw new TypeError("Page transport headers must be strings");
    let moduleUrl: string;
    try {
      moduleUrl = pathToFileURL(require.resolve("wreq-js")).href;
    } catch {
      throw new Error("Page transport requires installed wreq-js native assets");
    }

    return new Promise<PageTransportResponse>((resolve, reject) => {
      const child = childProcess.spawn(
        executable,
        ["--input-type=module", "--eval", pageTransportWorker, moduleUrl],
        {
          env: environment,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          serialization: "advanced",
          windowsHide: true,
        },
      );
      let finished = false;
      let ended = false;
      let cancelled = false;
      let failure: Error | undefined;
      let response: PageTransportResponse | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let pendingPull: (() => void) | undefined;
      let resolveClosed!: () => void;
      const closed = new Promise<void>((done) => {
        resolveClosed = done;
      });
      const stop = (error: Error) => {
        if (finished) return;
        failure ??= error;
        // kill() is only the request to terminate. Nothing settles here.
        try {
          child.kill("SIGKILL");
        } catch {
          /* Still await actual close; a failed kill is not settlement. */
        }
      };
      const aborted = () => stop(abortReason(request.signal));
      const send = (message: object) => {
        if (finished || failure) return;
        try {
          child.send(message, (error) => {
            if (error && !finished) stop(requestFailure());
          });
        } catch {
          stop(requestFailure());
        }
      };
      const onError = () => stop(new Error("Unable to start the page transport Node.js process"));
      const onMessage = (message: unknown) => {
        if (finished || failure) return;
        if (!message || typeof message !== "object") return stop(requestFailure());
        const value = message as Record<string, unknown>;
        if (value.type === "headers" && !response) {
          try {
            if (
              !Number.isInteger(value.status) ||
              (value.status as number) < 100 ||
              (value.status as number) > 599 ||
              typeof value.url !== "string" ||
              typeof value.hasBody !== "boolean" ||
              !Array.isArray(value.headers)
            )
              return stop(requestFailure());
            validatePageTransportUrl(value.url);
            const responseHeaders = new Headers(value.headers as [string, string][]);
            const body = value.hasBody
              ? new ReadableStream<Uint8Array>(
                  {
                    start(streamController) {
                      controller = streamController;
                    },
                    pull() {
                      return new Promise<void>((done) => {
                        pendingPull = done;
                        send({ type: "read" });
                      });
                    },
                    async cancel() {
                      cancelled = true;
                      stop(new DOMException("Page body cancelled", "AbortError"));
                      await closed;
                    },
                  },
                  { highWaterMark: 0 },
                )
              : null;
            response = {
              status: value.status as number,
              url: value.url,
              headers: responseHeaders,
              body,
            };
            // A body-less response has no subsequent consumer to own closure.
            if (body) resolve(response);
          } catch {
            stop(requestFailure());
          }
        } else if (
          value.type === "chunk" &&
          response?.body &&
          pendingPull &&
          value.value instanceof Uint8Array &&
          value.value.byteLength > 0
        ) {
          const done = pendingPull;
          pendingPull = undefined;
          try {
            controller!.enqueue(value.value);
          } catch {
            stop(requestFailure());
          }
          done();
        } else if (value.type === "end" && response && !ended) {
          ended = true;
          // EOF is not delivered until close: the child still owns native state.
        } else if (value.type === "failure") {
          stop(
            value.code === "DEPENDENCY_UNAVAILABLE"
              ? new Error("Page transport requires Node.js and installed wreq-js native assets")
              : requestFailure(),
          );
        } else {
          stop(requestFailure());
        }
      };
      const onClose = (code: number | null) => {
        finished = true;
        request.signal.removeEventListener("abort", aborted);
        child.removeListener("message", onMessage);
        child.removeListener("error", onError);
        failure ??= code === 0 && ended && response ? undefined : requestFailure();
        if (failure) {
          reject(failure);
          if (!cancelled) {
            try {
              controller?.error(failure);
            } catch {
              /* Already cancelled. */
            }
          }
        } else if (response) {
          if (response.body) controller!.close();
          else resolve(response);
        }
        pendingPull?.();
        pendingPull = undefined;
        resolveClosed();
      };
      child.on("message", onMessage);
      child.once("error", onError);
      child.once("close", onClose);
      request.signal.addEventListener("abort", aborted, { once: true });
      if (request.signal.aborted) aborted();
      else
        send({
          type: "start",
          url,
          method: request.method,
          headers,
          browser: request.browser,
          ...(request.proxy === undefined ? {} : { proxy: request.proxy }),
        });
    });
  };
}
