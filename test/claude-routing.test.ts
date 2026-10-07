// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
// @ts-expect-error plain Node helper shared with the live shell scenario
import { verifyClaudeRouting } from "./helpers/claude-routing.mjs";

const prefix = "mcp__plugin_intelli-search_intelli_search__";
const skill = "intelli-search:intelli-search";
interface FixtureBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}
interface FixtureEvent {
  type: string;
  subtype?: string;
  tools?: string[];
  slash_commands?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  message?: { model?: string; content: FixtureBlock[] };
  is_error?: boolean;
  permission_denials?: unknown[];
  duration_ms?: number;
}
function fixture(operation = "intelli_search", withSkill = true): FixtureEvent[] {
  const answer = operation === "intelli_search"
    ? "A grounded fixture answer. ".repeat(8) + "\n### Sources (1)\nhttps://example.com"
    : "A detailed fixture comparison. ".repeat(8) + "\n**Cache**: fixture\n**Report**: fixture/report.md";
  return [
    { type: "system", subtype: "init", tools: [prefix + "intelli_search", prefix + "intelli_research"],
      slash_commands: withSkill ? [skill] : [],
      mcp_servers: [{ name: "plugin:intelli-search:intelli_search", status: "connected" }] },
    ...(withSkill ? [
      { type: "assistant", message: { model: "fixture", content: [{ type: "tool_use", id: "skill", name: "Skill", input: { skill } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "skill", content: "Launching skill" }] } },
    ] : []),
    { type: "assistant", message: { model: "fixture", content: [{ type: "tool_use", id: "operation", name: prefix + operation,
      input: { query: "fixture", focusPrompt: "Preserve differences", maxUrls: 3 } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "operation", content: JSON.stringify({ text: answer }) }] } },
    { type: "result", subtype: "success", is_error: false, permission_denials: [], duration_ms: 20 },
  ];
}

it("the live telemetry filter rejects missing, nonnumeric and out-of-budget counts", () => {
  // Exercise the actual jq predicate used by the shell gate, not a second copy.
  const script = readFileSync(new URL("./e2e/13_claude_code_plugin.sh", import.meta.url), "utf8");
  const filter = script.match(/^\s+'(\.adapter == "mcp"[^'\n]+)'/m)?.[1];
  assert.ok(filter, "locate the live telemetry predicate");
  const meta = { adapter: "mcp", extensionVersion: "fixture", outcome: "completed",
    stages: { fetch: { requested: 3 }, extract: { succeeded: 2 } } };
  const check = (value: unknown) => spawnSync("jq", ["-e", "--arg", "v", "fixture", filter], {
    input: JSON.stringify(value), encoding: "utf8",
  });
  assert.equal(check(meta).status, 0);
  for (const requested of [undefined, null, "3", 0, -1, 4]) {
    assert.equal(check({ ...meta, stages: { ...meta.stages, fetch: { requested } } }).status, 1);
  }
  for (const succeeded of [undefined, null, "2", 0]) {
    assert.equal(check({ ...meta, stages: { ...meta.stages, extract: { succeeded } } }).status, 1);
  }
});

it("routing checks distinguish discovery, invocation and actual tool choice", () => {
  const script = readFileSync(new URL("./e2e/13_claude_code_plugin.sh", import.meta.url), "utf8");
  const prompts = [...script.matchAll(/^\s+PROMPT='([^']+)'/gm)].map((match) => match[1]);
  assert.equal(prompts.length, 4);
  assert.match(script, /--disallowedTools Bash/);
  assert.match(script, /--allowedTools "Skill,Read,Glob,Grep,/);
  for (const prompt of prompts) {
    assert.match(prompt, /Using the installed web research plugin/);
    assert.doesNotMatch(prompt, /intelli_search|intelli_research|Using intelli search/i);
  }
  assert.deepEqual(verifyClaudeRouting(fixture(), "intelli_search", "required"), {
    operation: "intelli_search", operationCalls: 1, skillDiscovered: true, skillInvoked: true,
    toolSearchUsed: false, models: ["fixture"], durationMs: 20,
  });
  assert.equal(verifyClaudeRouting(fixture("intelli_research"), "intelli_research", "required").operation, "intelli_research");
  assert.equal(verifyClaudeRouting(fixture("intelli_search", false), "intelli_search", "disabled").skillInvoked, false);
});

it("allows successful same-tool follow-ups but rejects errors and factual escalation", () => {
  for (const operation of ["intelli_search", "intelli_research"]) {
    const events = fixture(operation);
    const second = structuredClone(events.slice(3, 5));
    Object.assign(second[0].message!.content[0], { id: "follow-up" });
    Object.assign(second[1].message!.content[0], { tool_use_id: "follow-up" });
    events.splice(5, 0, ...second);
    assert.equal(verifyClaudeRouting(events, operation, "required").operationCalls, 2);
    Object.assign(second[1].message!.content[0], { is_error: true });
    assert.throws(() => verifyClaudeRouting(events, operation, "required"), /successful/);
    if (operation === "intelli_search") {
      Object.assign(second[1].message!.content[0], { is_error: false });
      Object.assign(second[0].message!.content[0], { name: prefix + "intelli_research" });
      assert.throws(() => verifyClaudeRouting(events, operation, "required"), /operation choice/);
    }
  }
});

it("rejects wrong routing, merely listed skills and loading after the operation", () => {
  assert.throws(() => verifyClaudeRouting(fixture("intelli_research"), "intelli_search", "required"), /operation choice/);
  const searchThenResearch = fixture();
  const research = fixture("intelli_research").slice(3, 5);
  Object.assign(research[0].message!.content[0], { id: "research" });
  Object.assign(research[1].message!.content[0], { tool_use_id: "research" });
  searchThenResearch.splice(5, 0, ...research);
  assert.throws(() => verifyClaudeRouting(searchThenResearch, "intelli_research", "required"), /operation choice/);
  const listedOnly = fixture();
  listedOnly.splice(1, 2);
  assert.throws(() => verifyClaudeRouting(listedOnly, "intelli_search", "required"), /skill invoked/);
  const late = fixture();
  const skillEvents = late.splice(1, 2);
  late.splice(3, 0, ...skillEvents);
  assert.throws(() => verifyClaudeRouting(late, "intelli_search", "required"), /skill invoked/);
});

it("rejects hidden routing options, errors, missing answers and speculative escalation", () => {
  const cases: Array<[string, (events: ReturnType<typeof fixture>) => void]> = [
    ["both routing options", (events) => { events[0].tools = [prefix + "intelli_search"]; }],
    ["connected", (events) => { events[0].mcp_servers![0].status = "failed"; }],
    ["no shell tool", (events) => { events[0].tools!.push("Bash"); }],
    ["no shell substitution", (events) => { events.splice(3, 0, { type: "assistant", message: { model: "fixture", content: [{ type: "tool_use", id: "shell", name: "Bash", input: { command: "curl https://example.com" } }] } }); }],
    ["skill discovery", (events) => { events[0].slash_commands = []; }],
    ["at most one", (events) => { events.splice(3, 0, events[3], events[3]); }],
    ["model-visible answer", (events) => { events[4].message!.content = [{ type: "tool_result", tool_use_id: "operation", content: "{}" }]; }],
    ["did not degrade", (events) => { events[4].message!.content = [{ type: "tool_result", tool_use_id: "operation", content: '{"outcome":"no-links","text":"degraded"}' }]; }],
    ["no built-in web", (events) => { events.splice(3, 0, { type: "assistant", message: { model: "fixture", content: [{ type: "tool_use", id: "web", name: "WebSearch", input: { query: "fixture" } }] } }); }],
    ["session ended", (events) => { events.pop(); }],
  ];
  for (const [message, mutate] of cases) {
    const events = fixture();
    mutate(events);
    assert.throws(() => verifyClaudeRouting(events, "intelli_search", "required"), new RegExp(message));
  }
  for (const id of ["skill", "operation"]) {
    const events = fixture();
    const result = events.find((event) => event.type === "user" && event.message?.content[0].tool_use_id === id)!;
    Object.assign(result.message!.content[0], { is_error: true });
    assert.throws(() => verifyClaudeRouting(events, "intelli_search", "required"), /succeeded|successful/);
  }
  const denied = fixture();
  Object.assign(denied.at(-1)!, { permission_denials: [{ tool_name: "WebSearch" }] });
  assert.throws(() => verifyClaudeRouting(denied, "intelli_search", "required"), /denied calls/);
});
