// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const prefix = "mcp__plugin_intelli-search_intelli_search__";
const skillName = "intelli-search:intelli-search";

/** Checks recorded host behaviour, not the model's account of what it did. */
export function verifyClaudeRouting(events, operation, skillMode) {
  assert.ok(["intelli_search", "intelli_research"].includes(operation));
  assert.ok(["required", "disabled"].includes(skillMode));
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  assert.ok(init?.mcp_servers?.some((server) =>
    server.name === "plugin:intelli-search:intelli_search" && server.status === "connected"),
  "plugin server must be connected");
  for (const name of ["intelli_search", "intelli_research"]) {
    assert.ok(init.tools?.includes(prefix + name), `both routing options must be exposed: ${name}`);
  }
  const discovered = (init.slash_commands ?? []).includes(skillName);
  assert.equal(discovered, skillMode === "required", "skill discovery must match the scenario");

  const blocks = events.flatMap((event, index) =>
    ["assistant", "user"].includes(event.type) && Array.isArray(event.message?.content)
      ? event.message.content.map((block) => ({ ...block, index })) : []);
  const calls = blocks.filter((block) => block.type === "tool_use");
  assert.ok(!calls.some((call) => ["WebSearch", "WebFetch"].includes(call.name)),
    "no built-in web substitution in an intelli-search evaluation");
  const operations = calls.filter((call) => call.name.startsWith(prefix));
  if (operation === "intelli_search") {
    assert.ok(operations.length >= 1 && operations.length <= 2,
      "one factual lookup with at most one narrower follow-up");
  } else {
    assert.ok(operations.length > 0, "deep analysis must call the research tool");
  }
  const call = operations[0];
  for (const operationCall of operations) {
    assert.equal(operationCall.name, prefix + operation, "unforced operation choice");
    verifyOperation(blocks, operationCall, operation);
  }

  const skill = calls.find((item) => item.name === "Skill" && item.input?.skill === skillName);
  if (skillMode === "required") {
    assert.ok(skill && skill.index < call.index, "skill invoked before the operation");
    const loaded = blocks.find((block) => block.type === "tool_result" && block.tool_use_id === skill.id);
    assert.ok(loaded && !loaded.is_error && loaded.index < call.index, "skill invocation succeeded before the operation");
  } else {
    assert.equal(skill, undefined, "descriptions-only scenario must not invoke the skill");
  }
  const final = events.findLast((event) => event.type === "result");
  assert.ok(final && !final.is_error && final.subtype === "success", "session ended successfully");
  assert.equal(final.permission_denials?.length ?? 0, 0, "no denied calls concealed by a later success");
  return {
    operation, operationCalls: operations.length, skillDiscovered: discovered, skillInvoked: Boolean(skill),
    toolSearchUsed: calls.some((item) => item.name === "ToolSearch"),
    models: [...new Set(events.filter((event) => event.type === "assistant").map((event) => event.message.model))],
    durationMs: final.duration_ms,
  };
}

function verifyOperation(blocks, call, operation) {
  const result = blocks.find((block) => block.type === "tool_result" && block.tool_use_id === call.id);
  assert.ok(result && !result.is_error, "operation returned a successful tool result");
  const raw = typeof result.content === "string" ? result.content :
    (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = raw; }
  if (payload && typeof payload === "object" && "outcome" in payload) {
    assert.equal(payload.outcome, "completed", "operation did not degrade");
  }
  const text = typeof payload === "string" ? payload : payload.text;
  assert.ok(typeof text === "string" && text.length > 100, "model-visible answer, not metadata alone");
  if (operation === "intelli_search") {
    assert.match(text, /### Sources \([1-9]\d*\)/, "search answer has sources");
  } else {
    assert.ok(call.input?.focusPrompt?.trim(), "research has an extraction focus");
    assert.ok(Number.isFinite(call.input?.maxUrls) && call.input.maxUrls > 0, "research chooses a breadth");
    assert.match(text, /\*\*Cache\*\*:/);
    assert.match(text, /\*\*Report\*\*:/);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, operation, skillMode] = process.argv.slice(2);
  const events = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  console.log(JSON.stringify(verifyClaudeRouting(events, operation, skillMode)));
}
