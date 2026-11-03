// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeCommand, parseClaudeJudgeOutput, parsePiJudgeOutput } from "../scripts/benchmarks/study-judge.js";

test("judge commands pin models and disable tools and project context", () => {
  const claude = judgeCommand(1, "Q-one", "session-one", false);
  assert.equal(claude.command, "claude");
  assert(claude.args.includes("claude-opus-5-5[1m]"));
  assert(claude.args.includes("--no-session-persistence"));
  assert.equal(claude.args[claude.args.indexOf("--effort") + 1], "low");
  assert.equal(claude.args[claude.args.indexOf("--setting-sources") + 1], "");
  assert.equal(claude.args[claude.args.indexOf("--tools") + 1], "");
  const pi = judgeCommand(2, "Q-one", "session-two", false);
  assert.equal(pi.command, "pi");
  assert(pi.args.includes("gpt-6.1-sol"));
  for (const flag of ["--no-tools", "--no-extensions", "--no-skills", "--no-context-files", "--no-session", "--no-mcp"]) assert(pi.args.includes(flag));
  assert.equal(pi.args[pi.args.indexOf("--thinking") + 1], "low");
});

test("judge output parsers retain structured output and reported models", () => {
  const score = { packetId: "Q-one", A: {}, B: {} };
  const claude = parseClaudeJudgeOutput(JSON.stringify({ structured_output: score, modelUsage: { "claude-opus-5-5": {} }, is_error: false }));
  assert.deepEqual(claude.value, score);
  assert.deepEqual(claude.reportedModels, ["claude-opus-5-5"]);
  const event = { type: "message_end", message: { role: "assistant", provider: "openai-codex", model: "gpt-6.1-sol", content: [{ type: "text", text: JSON.stringify(score) }] } };
  const pi = parsePiJudgeOutput(`${JSON.stringify(event)}\n`);
  assert.deepEqual(pi.value, score);
  assert.deepEqual(pi.reportedModels, ["openai-codex/gpt-6.1-sol"]);
});
