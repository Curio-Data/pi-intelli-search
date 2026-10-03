// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withStandaloneStdout } from "../src/console.js";

// Drive the installed dependency's real failure handler, not a copied log statement.
test("Defuddle conversion failures cannot put fetched content on standalone stdout", async () => {
  const require = createRequire(import.meta.resolve("defuddle/node"));
  const markdown = require("./markdown.js") as {
    createMarkdownContent(content: string, url: string): string;
  };
  const turndown = require("turndown") as { prototype: { turndown(content: string): string } };
  const originalConvert = turndown.prototype.turndown;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout: unknown[][] = [];
  const warnings: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args);
  };
  console.error = () => {};
  turndown.prototype.turndown = () => {
    throw new Error("forced conversion failure");
  };
  try {
    markdown.createMarkdownContent("<p>PRIVATE-PAGE-SENTINEL</p>", "https://docs.example");
    assert(stdout.some((args) => args.join(" ").includes("PRIVATE-PAGE-SENTINEL")));
    stdout.length = 0;
    const result = await withStandaloneStdout(
      {
        error() {},
        warn: (message) => {
          warnings.push(message);
        },
      },
      async () =>
        markdown.createMarkdownContent("<p>PRIVATE-PAGE-SENTINEL</p>", "https://docs.example"),
    );
    assert.match(result, /Partial conversion completed with errors/);
    assert.deepEqual(stdout, []);
    assert.equal(warnings.length, 1);
    assert(!warnings.join().includes("PRIVATE-PAGE-SENTINEL"));
  } finally {
    turndown.prototype.turndown = originalConvert;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("stdout scopes overlap safely, restore on failure and pass unrelated output", async () => {
  const original = console.log;
  const lines: string[] = [];
  const logger = { error() {}, warn() {} };
  const capture = (...args: unknown[]) => {
    lines.push(String(args[0]));
  };
  console.log = capture;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const first = withStandaloneStdout(logger, async () => {
      console.log("hidden A");
      await barrier;
      console.log("hidden B");
    });
    await assert.rejects(
      withStandaloneStdout(logger, async () => {
        console.log("hidden C");
        throw new Error("failure");
      }),
      /failure/,
    );
    console.log("unrelated");
    release();
    await first;
    assert.equal(console.log, capture);
    console.log("after");
    assert.deepEqual(lines, ["unrelated", "after"]);
  } finally {
    release();
    console.log = original;
  }
});
