// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Fixture stdio server spawned by server.test.ts. Not a test file.

import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { installStdoutGuard } from "../src/stdout-guard.js";
import type { FetchFunction } from "../../../src/core/annotations.js";
import { catalogue, document, json } from "./helpers.js";

const { values } = parseArgs({
  options: { config: { type: "string" }, workspace: { type: "string" } },
  strict: true,
});
if (!values.config || !values.workspace) {
  process.stderr.write("child-server: --config and --workspace are required\n");
  process.exit(2);
}

// Mirrors the CLI ordering: the guard precedes loading the server module.
installStdoutGuard();
if (process.env.FIXTURE_NOISE === "1") {
  process.stdout.write("NOISE_DIRECT_STDOUT\n");
  console.log("NOISE_CONSOLE_LOG");
  await import("./child-noise.js");
}

const stallMs = Number(process.env.FIXTURE_STALL_MS ?? 0);
const pageUrl = process.env.FIXTURE_PAGE_URL ?? "http://127.0.0.1:1/absent";
const models = document().models;
const transport: FetchFunction = async (url, init = {}) => {
  if (String(url) === "https://openrouter.ai/api/v1/models") return json(catalogue());
  if (String(url) !== "https://openrouter.ai/api/v1/chat/completions")
    throw new Error("Unexpected network access");
  const body = JSON.parse(String(init.body)) as { model: string };
  process.stderr.write(`FIXTURE_COMPLETION_STARTED ${body.model}\n`);
  if (stallMs > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, stallMs);
      init.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          process.stderr.write("FIXTURE_ABORT_OBSERVED\n");
          reject(new DOMException("The operation was aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
  const content =
    process.env.FIXTURE_NOLINKS === "1" && body.model === models.search.model
      ? "A grounded answer without any usable links."
      : body.model === models.search.model
        ? `[Fixture](${pageUrl})`
        : body.model === models.extract.model
          ? "Fixture extraction facts, preserved verbatim."
          : "Fixture collated summary.";
  return json({ choices: [{ message: { content }, finish_reason: "stop" }] });
};

const { startServer } = await import("../src/server.js");
const handle = await startServer(await loadConfig(values.config, values.workspace), {
  fetch: transport,
  env: { FIXTURE_KEY: "synthetic-protocol-credential" },
  queue: {
    maxConcurrent: Number(process.env.FIXTURE_MAX_CONCURRENT ?? 1),
    maxQueued: Number(process.env.FIXTURE_MAX_QUEUED ?? 8),
  },
  onEnqueue: () => process.stderr.write("FIXTURE_QUEUE_QUEUED\n"),
});
process.stderr.write("FIXTURE_SERVING\n");
if (process.env.FIXTURE_DEBUG_CLOSE === "1")
  void handle.closed.then(() => process.stderr.write("FIXTURE_CLOSED\n"));
