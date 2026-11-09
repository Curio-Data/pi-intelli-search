// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chmod, mkdtemp, mkdir, writeFile, rm, readFile, readdir, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { bindAttempt, argumentMismatches, resultCachePath } from "./e2e/scenario-verdict.mjs";
import { directArguments, resolveSdkFromHostBin } from "./e2e/direct-tool.mjs";

const LIB = resolve("test/e2e/lib.sh");
const VERDICT = resolve("test/e2e/scenario-verdict.mjs");
const COMPLETED = { outcome: "completed", stages: { fetch: { requested: 1, succeeded: 1 }, extract: { succeeded: 1 }, collate: { summaryChars: 120 } } };

type Json = Record<string, unknown>;

async function scratch(t: { after: (fn: () => Promise<void>) => void }, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function entry(cacheRoot: string, slug: string, meta: Json | undefined, mtimeSec?: number): Promise<string> {
  const dir = join(cacheRoot, slug);
  await mkdir(join(dir, "extractions"), { recursive: true });
  await mkdir(join(dir, "sources"), { recursive: true });
  await writeFile(join(dir, "report.md"), "summary");
  await writeFile(join(dir, "extractions/01.md"), "extraction");
  if (meta) {
    await writeFile(join(dir, "meta.json"), JSON.stringify(meta));
    if (mtimeSec !== undefined) await utimes(join(dir, "meta.json"), mtimeSec, mtimeSec);
  }
  return dir;
}

function start(id: string, args: Json, toolName = "intelli_research"): Json {
  return { type: "tool_execution_start", toolCallId: id, toolName, args };
}

function end(id: string, cachePath: string, toolName = "intelli_research", asText = false): Json {
  const text = cachePath ? `Report\n\n---\n**Cache**: \`${cachePath}/\`\n` : "degraded";
  return {
    type: "tool_execution_end",
    toolCallId: id,
    toolName,
    isError: false,
    result: { content: [{ type: "text", text }], ...(asText ? {} : { details: { cachePath } }) },
  };
}

const lines = (...events: Json[]) => `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

describe("scenario verdict binding", () => {
  it("binds the single call to the fresh completed sidecar it returned", async (t) => {
    const ws = await scratch(t, "verdict-pass-");
    const root = join(ws, ".search");
    const sinceMs = Date.now() - 5_000;
    const bound = await entry(root, "2026-11-09-node-abc", COMPLETED);
    const verdict = bindAttempt({
      traceText: lines(start("c1", { query: "q", maxUrls: 2, domains: ["nodejs.org"] }), end("c1", ".search/2026-11-09-node-abc")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs,
      expect: { maxUrls: 2, domains: ["nodejs.org"] },
    });
    assert.equal(verdict.status, "pass", verdict.reason);
    assert.equal(verdict.entryRelative, ".search/2026-11-09-node-abc");
    assert.ok(verdict.entry?.endsWith("2026-11-09-node-abc"));
    assert.ok(existsSync(bound));
  });

  it("rejects a foreign completed sidecar outside the unit cache root", async (t) => {
    const parent = await scratch(t, "verdict-foreign-");
    const ws = join(parent, "unit-a");
    const sibling = join(parent, "unit-b");
    await mkdir(ws);
    await entry(join(sibling, ".search"), "foreign", COMPLETED);
    // A sibling unit's sidecar is reachable only through a traversing path.
    const verdict = bindAttempt({
      traceText: lines(start("c1", {}), end("c1", "../unit-b/.search/foreign")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0,
    });
    assert.equal(verdict.status, "product-fail");
    // A completed sidecar elsewhere in the workspace never satisfies a call
    // that returned no cache path.
    await entry(join(ws, ".other-cache"), "stray", COMPLETED);
    const degraded = bindAttempt({
      traceText: lines(start("c1", {}), end("c1", "")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0,
    });
    assert.equal(degraded.status, "retry");
  });

  it("rejects several research calls instead of choosing one", async (t) => {
    const ws = await scratch(t, "verdict-multi-");
    await entry(join(ws, ".search"), "a", COMPLETED);
    await entry(join(ws, ".search"), "b", COMPLETED);
    const verdict = bindAttempt({
      traceText: lines(start("c1", { maxUrls: 5 }), end("c1", ".search/a"), start("c2", { maxUrls: 2 }), end("c2", ".search/b")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0, expect: { maxUrls: 2 },
    });
    assert.equal(verdict.status, "oracle-fail");
    assert.match(verdict.reason, /2 intelli_research calls/);
    assert.equal(verdict.calls?.length, 2);
  });

  it("rejects wrong, missing and unexpected arguments named by the prompt", () => {
    assert.deepEqual(argumentMismatches({ maxUrls: 2, domains: ["nodejs.org"] }, { maxUrls: 2, domains: ["nodejs.org"] }), []);
    assert.equal(argumentMismatches({ maxUrls: 3 }, { maxUrls: 2 }).length, 1);
    assert.equal(argumentMismatches({}, { maxUrls: 2 }).length, 1, "missing argument");
    assert.equal(argumentMismatches({ maxUrls: "2" }, { maxUrls: 2 }).length, 1, "string is not a number");
    assert.equal(argumentMismatches({ domains: "nodejs.org" }, { domains: ["nodejs.org"] }).length, 1);
    assert.equal(argumentMismatches({ maxUrls: 8 }, { maxUrls: null }).length, 1, "omission required");
    assert.deepEqual(argumentMismatches({ maxUrls: null }, { maxUrls: null }), [], "host-normalised null is omission");
    assert.deepEqual(argumentMismatches({ focusPrompt: "x", query: "q" }, { maxUrls: null }), [], "unnamed arguments are free");
  });

  it("treats wrong arguments as an agent failure even when the research completed", async (t) => {
    const ws = await scratch(t, "verdict-args-");
    await entry(join(ws, ".search"), "a", COMPLETED);
    const verdict = bindAttempt({
      traceText: lines(start("c1", { maxUrls: 2 }), end("c1", ".search/a")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0, expect: { maxUrls: null },
    });
    assert.equal(verdict.status, "oracle-fail");
    assert.deepEqual(verdict.argumentMismatches, [{ argument: "maxUrls", expected: "omitted", actual: 2 }]);
  });

  it("does not accept a completed numbered archive when the bound entry is degraded", async (t) => {
    const ws = await scratch(t, "verdict-archive-");
    const root = join(ws, ".search");
    await entry(root, "slug", { outcome: "extraction-failed", stages: { fetch: { succeeded: 0 }, collate: { summaryChars: 0 } } });
    await entry(root, "slug.1", COMPLETED);
    const verdict = bindAttempt({
      traceText: lines(start("c1", {}), end("c1", ".search/slug")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0,
    });
    assert.equal(verdict.status, "retry");
    assert.match(verdict.reason, /extraction-failed/);
  });

  it("rejects a stale sidecar from before the attempt", async (t) => {
    const ws = await scratch(t, "verdict-stale-");
    await entry(join(ws, ".search"), "old", COMPLETED, 1_000_000);
    const verdict = bindAttempt({
      traceText: lines(start("c1", {}), end("c1", ".search/old")),
      workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: Date.now(),
    });
    assert.equal(verdict.status, "retry");
    assert.match(verdict.reason, /stale/);
  });

  it("retries when no call ran or the call never returned, and counts malformed lines", async (t) => {
    const ws = await scratch(t, "verdict-nocall-");
    const none = bindAttempt({ traceText: "not json\n{\"type\":\"agent_end\"}\n", workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0 });
    assert.equal(none.status, "retry");
    assert.equal(none.malformedLines, 1);
    const open = bindAttempt({ traceText: lines(start("c1", {})), workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs: 0 });
    assert.equal(open.status, "retry");
    assert.match(open.reason, /did not return/);
  });

  it("binds an MCP result through its absolute text cache path", async (t) => {
    const ws = await scratch(t, "verdict-mcp-");
    const bound = await entry(join(ws, ".search"), "mcp-entry", COMPLETED);
    const tool = "mcp__intelli_search__intelli_research";
    assert.equal(resultCachePath(end("x", bound, tool, true).result as Json), bound);
    const verdict = bindAttempt({
      traceText: lines(start("c1", { query: "q" }, tool), end("c1", bound, tool, true)),
      workspace: ws, cacheRoot: ".search", tool, sinceMs: 0, expect: { query: "q" },
    });
    assert.equal(verdict.status, "pass", verdict.reason);
    // A native call in the same stream is a different tool and is ignored.
    const other = bindAttempt({
      traceText: lines(start("c1", {}), end("c1", ".search/mcp-entry")),
      workspace: ws, cacheRoot: ".search", tool, sinceMs: 0,
    });
    assert.equal(other.status, "retry");
  });

  it("workspace-only binding accepts exactly one fresh completed entry", async (t) => {
    const ws = await scratch(t, "verdict-notrace-");
    const root = join(ws, ".search");
    await entry(root, "old", COMPLETED, 1_000_000);
    await entry(root, "fresh", COMPLETED);
    const sinceMs = Date.now() - 5_000;
    const one = bindAttempt({ workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs, noTrace: true });
    assert.equal(one.status, "pass");
    assert.equal(one.binding, "workspace-only");
    await entry(root, "fresh-2", COMPLETED);
    const two = bindAttempt({ workspace: ws, cacheRoot: ".search", tool: "intelli_research", sinceMs, noTrace: true });
    assert.equal(two.status, "oracle-fail");
  });

  it("refuses an expected cache root outside the workspace as a harness error", async (t) => {
    const ws = await scratch(t, "verdict-root-");
    const run = spawnSync(process.execPath, [VERDICT, "bind", "--trace", "/dev/null", "--workspace", ws, "--cache-root", "../elsewhere", "--tool", "intelli_research", "--since-ms", "0"], { encoding: "utf8" });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /not inside the unit workspace/);
  });
});

it("the live page-budget assertion rejects missing, degraded and wrong-budget evidence", async (t) => {
  const root = await scratch(t, "e2e-assertions-");
  const cacheEntry = await entry(join(root, "cache"), "entry", undefined);
  const trace = join(root, "trace.jsonl");
  const metadata = { outcome: "completed", stages: { fetch: { requested: 3, succeeded: 2 }, extract: { succeeded: 2 }, collate: { summaryChars: 200 } } };
  const save = () => writeFile(join(cacheEntry, "meta.json"), JSON.stringify(metadata));
  await save();
  await writeFile(trace, JSON.stringify({ type: "tool_execution_start", toolName: "intelli_research", args: { query: "fixture" } }));
  const check = (scenario = "default") => spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_verify_page_budget "$2" "$3" "$4"', "fixture", LIB, cacheEntry, trace, scenario], { encoding: "utf8" });
  assert.equal(check().status, 0);
  assert.notEqual(check("cap").status, 0);
  // The event contains raw provider arguments: the host strips optional nulls
  // before execution. Null must exercise defaults, not bypass an explicit cap.
  const event = { type: "tool_execution_start", toolName: "intelli_research", args: { query: "fixture", maxUrls: null as number | string | boolean | null } };
  for (const [value, defaultPasses, capPasses] of [
    [null, true, false],
    [3, false, false],
    [12, false, true],
    [0, false, false],
    ["3", false, false],
    [false, false, false],
  ] as const) {
    event.args.maxUrls = value;
    await writeFile(trace, JSON.stringify(event));
    assert.equal(check().status === 0, defaultPasses, `default: maxUrls=${JSON.stringify(value)}`);
    assert.equal(check("cap").status === 0, capPasses, `cap: maxUrls=${JSON.stringify(value)}`);
  }
  event.args.maxUrls = null;
  await writeFile(trace, `${JSON.stringify(event)}\n${JSON.stringify(event)}`);
  assert.notEqual(check().status, 0, "multiple research calls must not pass");
  // A non-JSON line in the attempt stream must not break the parse.
  await writeFile(trace, `warning: noise\n${JSON.stringify(event)}\n`);
  assert.equal(check().status, 0, "noise lines are tolerated");
  await writeFile(trace, JSON.stringify({ type: "agent_end" }));
  assert.notEqual(check().status, 0, "missing research call must not pass");
  await writeFile(trace, JSON.stringify(event));
  metadata.stages.fetch.requested = 4;
  await save();
  assert.notEqual(check().status, 0);
  metadata.stages.fetch.requested = 3;
  metadata.outcome = "extraction-failed";
  await save();
  assert.notEqual(check().status, 0);
  metadata.outcome = "completed";
  await save();
  await rm(join(cacheEntry, "extractions"), { recursive: true });
  assert.notEqual(check().status, 0);
  assert.notEqual(spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_verify_page_budget "" "$2" default', "fixture", LIB, trace]).status, 0, "no bound entry must not pass");
});

it("live scenarios never select a cache entry by modification time, name order or index order", async () => {
  const dir = resolve("test/e2e");
  // 13 and 14 are credentialed sessions outside the live acceptance lane;
  // their own session timeouts are reported, not changed, by this work.
  const scripts = (await readdir(dir)).filter((name) => /^\d\d_.*\.sh$/.test(name) && !/^1[34]_/.test(name));
  for (const script of scripts) {
    const source = await readFile(join(dir, script), "utf8");
    assert.doesNotMatch(source, /-printf '%T@/, `${script}: modification-time selection`);
    assert.doesNotMatch(source, /sort -r \| head/, `${script}: reverse name selection`);
    assert.doesNotMatch(source, /e2e_completed_cache_entry/, `${script}: index-order selection`);
    assert.doesNotMatch(source, /-name '20\*' \| head/, `${script}: first-match selection`);
    assert.doesNotMatch(source, /timeout --foreground/, `${script}: --foreground leaves children running`);
    assert.doesNotMatch(source, /"\$PROJECT_DIR" "\$(PROMPT|RESEARCH_PROMPT)"|e2e_run_pi "[^"]*" "\$PROJECT_DIR"/, `${script}: research in the shared checkout`);
  }
  const lib = await readFile(LIB, "utf8");
  assert.doesNotMatch(lib, /timeout --foreground/);
  assert.doesNotMatch(await readFile(resolve("test/run-e2e-all.sh"), "utf8"), /timeout --foreground/, "run-e2e-all.sh: --foreground leaves children running");
});

it("no attempt transcript passes through a shell variable", async () => {
  const lib = await readFile(LIB, "utf8");
  // No command substitution may read an attempt's raw event stream or stderr.
  for (const line of lib.split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes("$(")) continue;
    assert.doesNotMatch(line, /"\$\{?(trace|err)\}?"/, `lib.sh reads a raw attempt file into a variable: ${line.trim()}`);
  }
  // The display variable is only ever empty or the bounded tail of the
  // display file.
  const assignments = [...lib.matchAll(/^\s*E2E_LAST_OUTPUT=(.*)$/gm)].map((m) => m[1]);
  assert.ok(assignments.includes('"$(e2e_display_tail "$display")"'), "the bounded tail is assigned");
  for (const rhs of assignments) assert.ok(rhs === '"$(e2e_display_tail "$display")"' || rhs === '""', `unexpected E2E_LAST_OUTPUT source: ${rhs}`);
  for (const script of (await readdir(resolve("test/e2e"))).filter((n) => /^\d\d_.*\.sh$/.test(n))) {
    const source = await readFile(resolve("test/e2e", script), "utf8");
    assert.doesNotMatch(source, /\$\(\s*cat\s+"?\$\{?E2E_LAST_TRACE_FILE/, `${script}: raw trace read into a variable`);
  }
});

// Every prompted argument must equal its oracle: maxUrls, domains, focusPrompt
// and query. A one-character drift would cost a paid attempt and report an
// oracle failure with no product defect behind it.
function checkPromptOracle(where: string, prompt: string, expect: Json) {
  const max = prompt.match(/maxUrls[= ](\d+)/)?.[1];
  const omitted = /Do not pass maxUrls|Omit maxUrls/.test(prompt);
  if (max) assert.equal(expect.maxUrls, Number(max), `${where}: maxUrls`);
  if (omitted) assert.equal(expect.maxUrls, null, `${where}: omitted maxUrls`);
  assert.ok(max || omitted, `${where}: prompt states its page budget`);
  const domain = prompt.match(/domains[= ]\[\\?"([^"\\]+)\\?"\]/)?.[1];
  if (domain && !domain.startsWith("$")) assert.deepEqual(expect.domains, [domain], `${where}: domains`);
  if (!domain) assert.equal(expect.domains, undefined, `${where}: oracle names domains the prompt does not`);
  for (const [key, pattern] of [["focusPrompt", /focusPrompt[= ]"([^"]*)"/], ["query", /\bquery "([^"]*)"/]] as const) {
    const prompted = prompt.match(pattern)?.[1];
    if (prompted !== undefined) assert.equal(expect[key], prompted, `${where}: ${key}`);
    else assert.equal(expect[key], undefined, `${where}: oracle names ${key} the prompt does not`);
  }
}

// Prompt and oracle assignments in source order, tolerating indentation (02's
// case branches) and the RESEARCH_PROMPT name (05, 06).
function promptPairs(source: string): [string, Json][] {
  const prompts = [...source.matchAll(/^[ \t]*(?:RESEARCH_)?PROMPT=(['"])(.*)\1[ \t]*$/gm)].map((m) => m[2]);
  const expects = [...source.matchAll(/^[ \t]*E2E_EXPECT_ARGS='(.*)'[ \t]*$/gm)].map((m) => JSON.parse(m[1]) as Json);
  assert.equal(prompts.length, expects.length, "one oracle per prompt");
  return prompts.map((prompt, i) => [prompt, expects[i]]);
}

it("prompts and their argument oracles agree", async () => {
  const dir = resolve("test/e2e");
  const expected: Record<string, number> = {
    "01_main.sh": 1, "02_cap.sh": 2, "03_model_override.sh": 1, "04_migration.sh": 1,
    "05_collation_limits.sh": 1, "06_extract_limits.sh": 1, "08_websearch_tool.sh": 1,
    "09_sonar_pro_search.sh": 1, "11_mcp_stdio.sh": 1, "15_pi_floor.sh": 1,
  };
  for (const [script, count] of Object.entries(expected)) {
    const pairs = promptPairs(await readFile(join(dir, script), "utf8"));
    assert.equal(pairs.length, count, `${script}: prompt/oracle pairs`);
    pairs.forEach(([prompt, expect], i) => checkPromptOracle(`${script}#${i + 1}`, prompt, expect));
  }
  const recipes = await readFile(join(dir, "10_config_recipes.sh"), "utf8");
  const vars = Object.fromEntries([...recipes.matchAll(/^(\w+_ARGS)='(.*)'$/gm)].map((m) => [m[1], JSON.parse(m[2])]));
  const calls = [...recipes.matchAll(/run_recipe (r\d+) (\S+) "\$(\w+)" "([^"]*)" "(.*)"; then$/gm)];
  assert.deepEqual(calls.map((m) => m[1]), ["r1", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
  for (const [, recipe, , variable, query, rawPrompt] of calls) {
    const prompt = rawPrompt.replace(/\\"/g, '"');
    checkPromptOracle(`10 ${recipe}`, prompt, vars[variable]);
    // The direct invocation's query is the prompt's research subject.
    assert.ok(prompt.includes(`to research: ${query}.`), `10 ${recipe}: query "${query}" is not the prompt's subject`);
  }
});

it("direct-mode research queries match their prompts, and evidence classes are fixed", async () => {
  const dir = resolve("test/e2e");
  for (const script of ["02_cap.sh", "03_model_override.sh", "04_migration.sh", "05_collation_limits.sh",
    "06_extract_limits.sh", "07_llms_full.sh", "08_websearch_tool.sh", "09_sonar_pro_search.sh"]) {
    const source = await readFile(join(dir, script), "utf8");
    const prompts = [...source.matchAll(/^[ \t]*(?:RESEARCH_)?PROMPT=(['"])(.*)\1[ \t]*$/gm)].map((m) => m[2]);
    const queries = [...source.matchAll(/^[ \t]*E2E_RESEARCH_QUERY="(.*)"[ \t]*$/gm)].map((m) => m[1]);
    if (script === "07_llms_full.sh") {
      // 07's prompt is built at run time around the probed host.
      assert.match(source, /to research: getting started guide"/);
      assert.deepEqual(queries, ["getting started guide"]);
    } else {
      assert.equal(queries.length, prompts.length, `${script}: one query per prompt`);
      prompts.forEach((prompt, i) => assert.ok(prompt.includes(queries[i]), `${script}: query "${queries[i]}" absent from its prompt`));
    }
    assert.match(source, /^E2E_INVOCATION="\$\{E2E_INVOCATION:-auto\}"$/m, `${script}: configuration unit defaults to direct (auto)`);
  }
  for (const script of ["10_config_recipes.sh", "11_mcp_stdio.sh"]) {
    assert.match(await readFile(join(dir, script), "utf8"), /^E2E_INVOCATION="\$\{E2E_INVOCATION:-auto\}"$/m, script);
  }
  // 11's oracle already names the query; direct mode sends exactly it.
  assert.match(await readFile(join(dir, "11_mcp_stdio.sh"), "utf8"), /^E2E_EXPECT_ARGS='\{"query":/m);
  for (const script of ["01_main.sh", "15_pi_floor.sh"]) {
    const source = await readFile(join(dir, script), "utf8");
    assert.match(source, /^E2E_INVOCATION=agent$/m, `${script}: routing evidence keeps the agent loop`);
    assert.doesNotMatch(source, /E2E_RESEARCH_QUERY/, `${script}: no direct query`);
  }
});

it("the prompt/oracle check catches drift in each argument", () => {
  const prompt = 'Call the tool with query "the q", maxUrls 1, domains ["a.org"] and focusPrompt "the focus".';
  const good = { query: "the q", maxUrls: 1, domains: ["a.org"], focusPrompt: "the focus" };
  checkPromptOracle("good", prompt, good);
  for (const drift of [{ query: "the q." }, { maxUrls: 2 }, { domains: ["b.org"] }, { focusPrompt: "the focus." }, { focusPrompt: undefined }]) {
    assert.throws(() => checkPromptOracle("drift", prompt, { ...good, ...drift }), JSON.stringify(drift));
  }
  assert.throws(() => checkPromptOracle("extra", "Use maxUrls=1", { maxUrls: 1, focusPrompt: "unprompted" }));
  const indented = "  PROMPT='Use maxUrls=1 with focusPrompt=\"x\"'\n  E2E_EXPECT_ARGS='{\"maxUrls\":1,\"focusPrompt\":\"x\"}'\n";
  assert.equal(promptPairs(indented).length, 1, "indented assignments are found");
});

it("E2E auth assembly sends credentials over stdin, not jq arguments", () => {
  const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_LOOP_MODEL_ID=openrouter/fixture; OPENROUTER_API_KEY=fixture-secret; e2e_setup_loop_model >/dev/null; printf "%s" "$E2E_AUTH_JSON"', "fixture", LIB], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { openrouter: { type: "api_key", key: "fixture-secret" } });
});

describe("loop credentials", () => {
  const setup = (auth: string, env: Record<string, string> = {}) =>
    spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_setup_loop_model >/dev/null; printf "%s|%s" "$E2E_LOOP_PROVIDER/$E2E_LOOP_MODEL" "$E2E_AUTH_JSON"', "fixture", LIB], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", OPENROUTER_API_KEY: "or-fixture", E2E_OPERATOR_AUTH_JSON: auth, ...env },
    });

  it("rejects a non-api_key loop entry without printing its values", async (t) => {
    const dir = await scratch(t, "e2e-auth-");
    const auth = join(dir, "auth.json");
    await writeFile(auth, JSON.stringify({ "kimi-coding": { type: "oauth", access: "ACCESS-SECRET", refresh: "REFRESH-SECRET", expires: 1 } }));
    const run = setup(auth, { E2E_LOOP_MODEL_ID: "kimi-coding/k3" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /type 'oauth'/);
    assert.doesNotMatch(run.stderr + run.stdout, /SECRET/);
  });

  it("does not select an OAuth default loop provider and copies api_key entries only", async (t) => {
    const dir = await scratch(t, "e2e-auth-");
    const auth = join(dir, "auth.json");
    await writeFile(auth, JSON.stringify({ "kimi-coding": { type: "oauth", refresh: "REFRESH-SECRET" } }));
    const oauth = setup(auth);
    assert.equal(oauth.status, 0, oauth.stderr);
    const [model, json] = oauth.stdout.split("|");
    assert.equal(model, "openrouter/google/gemini-3.8-flash");
    assert.deepEqual(Object.keys(JSON.parse(json)), ["openrouter"]);
    assert.doesNotMatch(oauth.stderr + oauth.stdout, /SECRET/);

    await writeFile(auth, JSON.stringify({ "kimi-coding": { type: "api_key", key: "kimi-fixture" } }));
    const key = setup(auth);
    assert.equal(key.status, 0, key.stderr);
    assert.equal(key.stdout.split("|")[0], "kimi-coding/k3");
    assert.deepEqual(JSON.parse(key.stdout.split("|")[1])["kimi-coding"], { type: "api_key", key: "kimi-fixture" });
  });

  it("honours TEST_MODEL for every scenario that uses the helper", async (t) => {
    const dir = await scratch(t, "e2e-auth-");
    const run = setup(join(dir, "absent.json"), { TEST_MODEL: "openrouter/fixture/loop" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.split("|")[0], "openrouter/fixture/loop");
  });
});

describe("e2e_run_pi with a fake host", () => {
  // The fake host writes one JSON event stream per invocation from a scripted
  // plan: each line of plan.txt describes one attempt.
  const FAKE = `#!/usr/bin/env bash
set -euo pipefail
plan="$FAKE_PLAN"
n=$(( $(cat "$FAKE_STATE" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$FAKE_STATE"
step="$(sed -n "\${n}p" "$plan")"
emit_call() { # id maxUrls slug
  printf '{"type":"tool_execution_start","toolCallId":"%s","toolName":"intelli_research","args":{"query":"q","maxUrls":%s}}\\n' "$1" "$2"
  if [[ -n "$3" ]]; then
    mkdir -p ".search/$3"
    printf '%s' '{"outcome":"completed","stages":{"fetch":{"succeeded":1},"collate":{"summaryChars":9}}}' > ".search/$3/meta.json"
  fi
  printf '{"type":"tool_execution_end","toolCallId":"%s","toolName":"intelli_research","isError":false,"result":{"content":[{"type":"text","text":"done"}],"details":{"cachePath":"%s"}}}\\n' "$1" "\${3:+.search/$3}"
}
case "$step" in
  none) echo '{"type":"agent_end"}' ;;
  pass) emit_call c1 2 entry ;;
  wrong) emit_call c1 7 entry ;;
  twice) emit_call c1 2 entry; emit_call c2 2 entry2 ;;
  pass-exit1) emit_call c1 2 entry; exit 1 ;;
  hang) ( sleep 300 & echo $! > "$FAKE_STATE.grandchild"; wait ) & sleep 300 ;;
  huge)
    pad="$(head -c 300000 /dev/zero | tr '\\0' x)"
    printf '{"type":"message_update","raw":"SENTINEL-RAW-%s"}\\n' "$pad"
    printf '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"VISIBLE-ANSWER"}]}}\\n'
    emit_call c1 2 entry ;;
  plain-huge)
    echo "PLAIN-HEAD"; head -c 300000 /dev/zero | tr '\\0' y; echo; echo "PLAIN-TAIL"
    mkdir -p .search/entry
    printf '%s' '{"outcome":"completed","stages":{"fetch":{"succeeded":1},"collate":{"summaryChars":9}}}' > .search/entry/meta.json ;;
esac
`;

  async function harness(t: { after: (fn: () => Promise<void>) => void }, plan: string[]) {
    const dir = await scratch(t, "e2e-fake-pi-");
    const bin = join(dir, "fake-pi");
    await writeFile(bin, FAKE);
    await chmod(bin, 0o755);
    await writeFile(join(dir, "plan.txt"), `${plan.join("\n")}\n`);
    for (const sub of ["agent", "ws", "attempts"]) await mkdir(join(dir, sub));
    return dir;
  }

  const run = (dir: string, extra = "", timeout = 60) => spawnSync("bash", ["-c", `set -euo pipefail; source "$1"; ${extra}
E2E_PI_BIN="$2/fake-pi"; E2E_EXTENSION_PATH=""; E2E_ATTEMPT_DIR="$2/attempts"; E2E_RETRY_SLEEP_SECONDS=0; E2E_KILL_AFTER_SECONDS=1
E2E_EXPECT_ARGS='{"maxUrls":2}'
rc=0; e2e_run_pi "$2/agent" "$2/ws" "prompt" ${timeout} || rc=$?
printf 'RC=%s ENTRY=%s\\n' "$rc" "$E2E_BOUND_ENTRY"
printf 'LEN=%s DISPLAY=%s\\n' "\${#E2E_LAST_OUTPUT}" "\${E2E_LAST_OUTPUT_FILE:-}"
case "$E2E_LAST_OUTPUT" in *SENTINEL-RAW*) echo "RAW-IN-VARIABLE" ;; esac`, "fixture", LIB, dir], {
    encoding: "utf8",
    env: { ...process.env, FAKE_PLAN: join(dir, "plan.txt"), FAKE_STATE: join(dir, "state") },
  });

  it("retries an attempt without research, keeps every attempt file and binds the next", async (t) => {
    const dir = await harness(t, ["none", "pass"]);
    const out = run(dir);
    assert.match(out.stdout, /RC=0 ENTRY=.*\/ws\/\.search\/entry/, out.stderr);
    const files = (await readdir(join(dir, "attempts"))).sort();
    assert.deepEqual(files, [
      "001-attempt-1.display.txt", "001-attempt-1.jsonl", "001-attempt-1.stderr", "001-attempt-1.verdict.json",
      "002-attempt-2.display.txt", "002-attempt-2.jsonl", "002-attempt-2.stderr", "002-attempt-2.verdict.json",
    ]);
    assert.equal(JSON.parse(await readFile(join(dir, "attempts/001-attempt-1.verdict.json"), "utf8")).status, "retry");
  });

  it("does not retry after wrong arguments or several calls", async (t) => {
    for (const step of ["wrong", "twice"]) {
      const dir = await harness(t, [step, "pass"]);
      const out = run(dir);
      assert.match(out.stdout, /RC=2 ENTRY=$/m, `${step}: ${out.stderr}`);
      assert.equal(await readFile(join(dir, "state"), "utf8"), "1\n", `${step}: one paid attempt only`);
    }
  });

  it("keeps the exit-0 gate without repeating completed research", async (t) => {
    const dir = await harness(t, ["pass-exit1", "pass"]);
    const gated = run(dir, "E2E_REQUIRE_EXIT_ZERO=1");
    assert.match(gated.stdout, /RC=1 /, gated.stderr);
    assert.equal(await readFile(join(dir, "state"), "utf8"), "1\n");
    const dir2 = await harness(t, ["pass-exit1"]);
    const accepted = run(dir2);
    assert.match(accepted.stdout, /RC=0 /, accepted.stderr);
  });

  it("refuses to overwrite earlier attempt evidence", async (t) => {
    const dir = await harness(t, ["pass"]);
    await writeFile(join(dir, "attempts/001-attempt-1.jsonl"), "earlier");
    const out = run(dir);
    assert.match(out.stdout, /RC=3 /, out.stderr);
    assert.equal(await readFile(join(dir, "attempts/001-attempt-1.jsonl"), "utf8"), "earlier");
  });

  it("the display is converted file to file and bounded, on the JSON and floor paths", async (t) => {
    const dir = await harness(t, ["huge"]);
    const out = run(dir, "E2E_DISPLAY_MAX_BYTES=2000");
    assert.match(out.stdout, /RC=0 /, out.stderr);
    assert.doesNotMatch(out.stdout, /RAW-IN-VARIABLE/, "a raw event reached the display variable");
    const display = out.stdout.match(/DISPLAY=(\S+)/)?.[1] ?? "";
    assert.match(display, /001-attempt-1\.display\.txt$/);
    assert.match(await readFile(display, "utf8"), /VISIBLE-ANSWER/);
    assert.match(await readFile(join(dir, "attempts/001-attempt-1.jsonl"), "utf8"), /SENTINEL-RAW/, "the raw stream stays in its file");

    // Floor host without --mode json: plain text, workspace-only binding.
    const floor = await harness(t, ["plain-huge"]);
    const plain = run(floor, "E2E_DISPLAY_MAX_BYTES=2000; E2E_JSON_MODE=0");
    assert.match(plain.stdout, /RC=0 /, plain.stderr);
    const len = Number(plain.stdout.match(/LEN=(\d+)/)?.[1]);
    assert.ok(len > 0 && len < 2300, `display variable is bounded (${len})`);
    const floorDisplay = plain.stdout.match(/DISPLAY=(\S+)/)?.[1] ?? "";
    const text = await readFile(floorDisplay, "utf8");
    assert.match(text, /^PLAIN-HEAD/);
    assert.match(text, /PLAIN-TAIL/);
    assert.equal(JSON.parse(await readFile(join(floor, "attempts/001-attempt-1.verdict.json"), "utf8")).binding, "workspace-only");
  });

  it("a timed-out attempt leaves no descendant running", async (t) => {
    const dir = await harness(t, ["hang", "none", "none"]);
    const out = run(dir, "", 1);
    assert.match(out.stdout, /RC=1 /, out.stderr);
    const pid = Number(await readFile(join(dir, "state.grandchild"), "utf8"));
    await new Promise((r) => setTimeout(r, 500));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) process.kill(pid, "SIGKILL");
    assert.equal(alive, false, "grandchild survived the attempt timeout");
  });
});

describe("scenario decomposition", () => {
  const script = (name: string, env: Record<string, string>) =>
    spawnSync("bash", [resolve("test/e2e", name)], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", TMPDIR: tmpdir(), ...env },
    });

  it("scenario 10 has exactly the eight README recipe units", async () => {
    const source = await readFile(resolve("test/e2e/10_config_recipes.sh"), "utf8");
    assert.match(source, /^RECIPES=\(r1 r4 r5 r6 r7 r8 r9 r10\)$/m);
    const defined = [...source.matchAll(/^recipe_(r\d+)\(\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(defined, ["r1", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
    assert.doesNotMatch(source, /recipe_r2|recipe_r3/);
  });

  it("a unit workspace requires exactly one named case", async (t) => {
    const ws = await scratch(t, "e2e-case-");
    const logs = await scratch(t, "e2e-case-logs-");
    for (const [name, variable, bad] of [
      ["10_config_recipes.sh", "E2E_RECIPE", "r2"],
      ["02_cap.sh", "E2E_CAP_CASE", "both"],
      ["05_collation_limits.sh", "E2E_LIMIT_ARM", "loose"],
      ["06_extract_limits.sh", "E2E_LIMIT_ARM", "loose"],
    ] as const) {
      const missing = script(name, { E2E_WORKSPACE: ws, E2E_LOG_ROOT: logs });
      assert.notEqual(missing.status, 0, `${name}: no case`);
      assert.match(missing.stderr, new RegExp(`${variable} is not`), name);
      const invalid = script(name, { E2E_WORKSPACE: ws, E2E_LOG_ROOT: logs, [variable]: bad });
      assert.notEqual(invalid.status, 0, `${name}: invalid case`);
      assert.match(invalid.stderr, /is not one of/, name);
    }
    assert.deepEqual(await readdir(logs), [], "rejected before any log or provider call");
  });

  async function arm(t: { after: (fn: () => Promise<void>) => void }, cacheName: string, report: string, extraction: string, source = "https://docs.python.org/3/reference/datamodel.html\nbody") {
    const ws = await scratch(t, "e2e-arm-");
    const bound = await entry(join(ws, cacheName), "2026-11-09-python-data-model-abc", COMPLETED);
    await writeFile(join(bound, "report.md"), report);
    await writeFile(join(bound, "extractions/01.md"), extraction);
    await writeFile(join(bound, "sources/01-page.md"), source);
    // A higher-sorting completed archive must never be read by the comparison.
    const archive = await entry(join(ws, cacheName), "2026-11-09-python-data-model-abc.1", COMPLETED);
    await writeFile(join(archive, "report.md"), "x".repeat(10));
    await writeFile(join(archive, "extractions/01.md"), "x".repeat(10));
    await mkdir(join(ws, ".e2e-unit"));
    await writeFile(join(ws, ".e2e-unit/arm.json"), JSON.stringify({ status: "pass", entryRelative: `${cacheName}/2026-11-09-python-data-model-abc` }));
    return ws;
  }

  it("the offline comparison arms read each arm's bound entry", async (t) => {
    const logs = await scratch(t, "e2e-compare-logs-");
    const compare = (name: string, d: string, tt: string) => script(name, {
      E2E_LIMIT_ARM: "compare", E2E_COMPARE_DEFAULT_WORKSPACE: d, E2E_COMPARE_TIGHT_WORKSPACE: tt, E2E_LOG_ROOT: logs,
    });
    const d5 = await arm(t, ".e2e-collate-default", "r".repeat(3000), "e".repeat(2000));
    const t5 = await arm(t, ".e2e-collate-tight", "r".repeat(400), "e".repeat(2000));
    const ok5 = compare("05_collation_limits.sh", d5, t5);
    assert.equal(ok5.status, 0, ok5.stdout + ok5.stderr);
    assert.match(ok5.stdout, /identical source content/);
    const bad5 = compare("05_collation_limits.sh", t5, d5);
    assert.notEqual(bad5.status, 0, "tight larger than default must fail");

    const d6 = await arm(t, ".e2e-extract-default", "r".repeat(3000), "e".repeat(3000));
    const t6 = await arm(t, ".e2e-extract-tight", "r".repeat(3000), "e".repeat(300), "https://docs.python.org/3/other.html\nother");
    const ok6 = compare("06_extract_limits.sh", d6, t6);
    assert.equal(ok6.status, 0, ok6.stdout + ok6.stderr);
    assert.match(ok6.stdout, /different source content/);
    await rm(join(t6, ".e2e-unit/arm.json"));
    const missing = compare("06_extract_limits.sh", d6, t6);
    assert.notEqual(missing.status, 0, "an arm without a passing receipt is unproven");
    await writeFile(join(t6, ".e2e-unit/arm.json"), JSON.stringify({ status: "pass", entryRelative: ".e2e-extract-tight/2026-11-09-python-data-model-abc" }));
    await rm(join(t6, ".e2e-extract-tight/2026-11-09-python-data-model-abc/extractions/01.md"));
    const unproven = compare("06_extract_limits.sh", d6, t6);
    assert.notEqual(unproven.status, 0, "a missing extraction is unproven, not a pass");
    assert.match(unproven.stdout, /UNPROVEN/);
  });
});

describe("review corrections, round 2", () => {
  it("07 names the llms-full files that were created when the expected one is missing", async (t) => {
    const ws = await scratch(t, "e2e-llmsfull-");
    const bound = await entry(join(ws, ".e2e-llmsfull"), "slug", COMPLETED);
    const check = (host: string, probed: string) => spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; ERRORS=0; e2e_check_llms_full "$2" "$3" "$4"; echo "ERRORS=$ERRORS"', "fixture", LIB, bound, host, probed], { encoding: "utf8" });
    await writeFile(join(bound, "sources/llms-full-redirected.example.md"), "x".repeat(2000));
    const redirected = check("docs.example.com", "https://docs.example.com/llms-full.txt");
    assert.match(redirected.stdout, /ERRORS=1/);
    assert.match(redirected.stdout, /created instead: llms-full-redirected\.example\.md \(2000 bytes\)/);
    assert.match(redirected.stdout, /redirected/);
    await writeFile(join(bound, "sources/llms-full-docs.example.com.md"), "y".repeat(600));
    const ok = check("docs.example.com", "https://docs.example.com/llms-full.txt");
    assert.match(ok.stdout, /ERRORS=0/, ok.stdout);
    assert.match(ok.stdout, /all llms-full files: llms-full-docs\.example\.com\.md \(600 bytes\), llms-full-redirected\.example\.md \(2000 bytes\)/);
    await writeFile(join(bound, "sources/llms-full-docs.example.com.md"), "small");
    assert.match(check("docs.example.com", "https://docs.example.com/llms-full.txt").stdout, /only 5 bytes[\s\S]*ERRORS=1/);
    const unprobed = check("docs.example.com", "");
    assert.match(unprobed.stdout, /no candidate site served/);
    assert.match(unprobed.stdout, /ERRORS=2/, "unprobed and small both count");
    const empty = await entry(join(ws, ".e2e-llmsfull"), "empty", COMPLETED);
    assert.match(spawnSync("bash", ["-c", 'source "$1"; ERRORS=0; e2e_check_llms_full "$2" h https://h/llms-full.txt', "fixture", LIB, empty], { encoding: "utf8" }).stdout, /created instead: none/);
  });

  it("R8 labels its cacheDir check by what it reads", async () => {
    const source = await readFile(resolve("test/e2e/10_config_recipes.sh"), "utf8");
    const r8 = source.slice(source.indexOf("recipe_r8() {"), source.indexOf("recipe_r9() {"));
    for (const line of r8.split("\n").filter((l) => /assert_eq "[^"]*cacheDir/.test(l))) {
      assert.doesNotMatch(line, /\.outcome/, `cacheDir label on an outcome read: ${line.trim()}`);
    }
    assert.match(r8, /assert_eq "project cacheDir applied[^"]*" \\\n\s*"\$\(basename "\$\(dirname "\$E2E_BOUND_ENTRY"\)"\)" "\.search-client-x"/);
  });

  it("every script reads .env before opening its retained log", async () => {
    const dir = resolve("test/e2e");
    for (const script of (await readdir(dir)).filter((n) => /^\d\d_.*\.sh$/.test(n))) {
      const lines = (await readFile(join(dir, script), "utf8")).split("\n");
      const load = lines.findIndex((l) => /^\s*e2e_load_env /.test(l));
      const log = lines.findIndex((l) => /^\s*e2e_attach_log/.test(l));
      if (load < 0 || /^(?:13|14)_/.test(script)) continue;
      assert.ok(log >= 0 && load < log, `${script}: e2e_load_env (line ${load + 1}) after e2e_attach_log (line ${log + 1})`);
    }
  });

  it("log files are created exclusively with a portable --suffix template", async (t) => {
    const logs = await scratch(t, "e2e-logname-");
    const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_LOG_ROOT="$2"; e2e_init_log e2e-x; a="$LOG_FILE"; e2e_init_log e2e-x; printf "%s\\n%s\\n" "$a" "$LOG_FILE"', "fixture", LIB, logs], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const [a, b] = run.stdout.trim().split("\n");
    assert.notEqual(a, b);
    for (const file of [a, b]) assert.match(file, /\/e2e-x-\d{8}-\d{6}-[A-Za-z0-9]{6}\.log$/);
    assert.deepEqual((await readdir(logs)).length, 2);
    for (const file of [LIB, resolve("test/e2e/12_plugin_bundles.sh")]) {
      const source = await readFile(file, "utf8");
      assert.doesNotMatch(source, /mktemp "[^"]*XXXXXX\.log"/, `${file}: X run must end the template`);
      assert.match(source, /mktemp --suffix=\.log /);
      if (file.endsWith("12_plugin_bundles.sh")) {
        assert.ok(source.indexOf('source "$SCRIPT_DIR/lib.sh"') < source.indexOf("e2e_attach_log"), "12: log helper must be sourced before use");
      }
    }
  });

  it("supervised logging writes directly without a tee descendant", async (t) => {
    const logs = await scratch(t, "e2e-supervised-log-");
    const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_SUPERVISED=1 E2E_LOG_ROOT="$2"; e2e_init_log e2e-x; e2e_attach_log; printf "supervised-log-ok\n"', "fixture", LIB, logs], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "");
    const file = (await readdir(logs))[0];
    assert.equal(await readFile(join(logs, file), "utf8"), "supervised-log-ok\n");
  });

  it("12's key probe reads only its own servers' environments", async (t) => {
    const mine = await scratch(t, "e2e-own-root-");
    const other = await scratch(t, "e2e-other-root-");
    const procs: ReturnType<typeof import("node:child_process").spawn>[] = [];
    const { spawn } = await import("node:child_process");
    t.after(() => { for (const p of procs) p.kill("SIGKILL"); });
    for (const [root, key] of [[mine, "key-mine"], [other, "key-other"]] as const) {
      const cli = join(root, "vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js");
      await mkdir(join(cli, ".."), { recursive: true });
      await writeFile(cli, "setInterval(() => {}, 1000);\n");
      // The other unit's server claims this unit's workspace: only the
      // command-line scope may exclude it.
      procs.push(spawn(process.execPath, [cli], { stdio: "ignore", env: { PATH: process.env.PATH ?? "", INTELLI_SEARCH_WORKSPACE: join(mine, "claude-workspace"), OPENROUTER_API_KEY: key } }));
    }
    await new Promise((r) => setTimeout(r, 400));
    const run = spawnSync("bash", ["-c", 'source "$1"; e2e_scoped_server_env "$2" "$2/claude-workspace"', "fixture", LIB, mine], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "OPENROUTER_API_KEY=key-mine\nSERVER_SEEN\n");
    const source = await readFile(resolve("test/e2e/12_plugin_bundles.sh"), "utf8");
    assert.doesNotMatch(source, /\/proc\/\$pid\/environ/, "12 must use the scoped probe");
    assert.match(source, /e2e_scoped_server_env "\$E2E_ROOT" "\$E2E_ROOT\/claude-workspace"/);
  });

  describe("sequential runner settlement", () => {
    const RUNNER = resolve("test/run-e2e-all.sh");
    const HARNESS = `set -uo pipefail
SCRIPT_TIMEOUT=$1; KILL_AFTER=1
eval "$(sed -n '/^CHILD=""$/,/^trap .stop_running 143. TERM$/p' "$2")"
rc=0; run_script "$3" || rc=$?
echo "RC=$rc"`;
    async function fakeScript(t: { after: (fn: () => Promise<void>) => void }) {
      const dir = await scratch(t, "e2e-seq-");
      const script = join(dir, "scenario.sh");
      await writeFile(script, `#!/usr/bin/env bash\n( sleep 300 & echo $! > "${dir}/grandchild.pid"; wait ) &\nsleep 300\n`);
      await chmod(script, 0o755);
      return { dir, script };
    }
    const gone = async (dir: string) => {
      await new Promise((r) => setTimeout(r, 500));
      const pid = Number(await readFile(join(dir, "grandchild.pid"), "utf8"));
      try { process.kill(pid, 0); process.kill(pid, "SIGKILL"); return false; } catch { return true; }
    };

    it("an expired script leaves no descendant running", async (t) => {
      const { dir, script } = await fakeScript(t);
      const run = spawnSync("bash", ["-c", HARNESS, "harness", "1", RUNNER, script], { encoding: "utf8", timeout: 30_000 });
      assert.match(run.stdout, /RC=(124|137)/, run.stderr);
      assert.ok(await gone(dir), "grandchild survived the script deadline");
    });

    it("Ctrl-C stops the running script's whole process group", async (t) => {
      const { dir, script } = await fakeScript(t);
      const { spawn } = await import("node:child_process");
      const child = spawn("bash", ["-c", HARNESS, "harness", "100", RUNNER, script], { stdio: "ignore" });
      const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
      for (let i = 0; i < 50 && !existsSync(join(dir, "grandchild.pid")); i += 1) await new Promise((r) => setTimeout(r, 100));
      child.kill("SIGINT");
      assert.equal(await exited, 130);
      assert.ok(await gone(dir), "grandchild survived Ctrl-C");
    });
  });
});

describe("direct registered-tool invocation (direct-tool.mjs)", () => {
  // The repository's own dev copy of the host SDK, so the fixtures never
  // depend on the operator's installed Pi.
  const SDK = resolve("node_modules/@earendil-works/pi-coding-agent");
  const DRIVER = resolve("test/e2e/direct-tool.mjs");
  // A fixture extension standing in for intelli_research: it records exactly
  // what the host passed and behaves according to the query.
  const FIXTURE = `import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
export default function (pi) {
  pi.on("session_start", (_e, ctx) => {
    writeFileSync(join(ctx.cwd, "session-start.json"), JSON.stringify({ trusted: ctx.isProjectTrusted() }));
  });
  pi.registerTool({
    name: "intelli_research", label: "fixture", description: "fixture research",
    parameters: Type.Object({ query: Type.String(), maxUrls: Type.Optional(Type.Number()),
      domains: Type.Optional(Type.Array(Type.String())), focusPrompt: Type.Optional(Type.String()) }),
    async execute(_id, params, signal, onUpdate, ctx) {
      writeFileSync(join(ctx.cwd, "received.json"), JSON.stringify(params));
      if (params.query === "loop") {
        pi.sendUserMessage("start an agent turn");
        await new Promise((r) => setTimeout(r, 500));
        return { content: [{ type: "text", text: "loop" }], details: {} };
      }
      if (params.query === "wait-abort") {
        writeFileSync(join(ctx.cwd, "started"), "");
        await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
        writeFileSync(join(ctx.cwd, "aborted"), "");
        return { content: [{ type: "text", text: "aborted" }], details: {} };
      }
      onUpdate?.({ content: [{ type: "text", text: "progress" }], details: {} });
      const slug = "2026-11-09-fixture";
      mkdirSync(join(ctx.cwd, ".search", slug), { recursive: true });
      writeFileSync(join(ctx.cwd, ".search", slug, "meta.json"), JSON.stringify({ outcome: "completed",
        stages: { fetch: { succeeded: 1 }, collate: { summaryChars: 5 } } }));
      return { content: [{ type: "text", text: "done\\n**Cache**: \`.search/" + slug + "/\`" }], details: { cachePath: ".search/" + slug } };
    },
  });
}
`;
  // A local fake loop provider on an unroutable loopback port: even a failed
  // guard could not reach a real endpoint.
  const MODELS = { providers: { e2efake: { baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "dummy",
    models: [{ id: "fake-model", name: "fake", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } };

  async function setup(t: { after: (fn: () => Promise<void>) => void }) {
    const root = await scratch(t, "e2e-direct-");
    for (const sub of ["agent", "ws", "home", "attempts"]) await mkdir(join(root, sub));
    await writeFile(join(root, "fixture-ext.mjs"), FIXTURE);
    await writeFile(join(root, "agent/settings.json"), JSON.stringify({ defaultProvider: "e2efake", defaultModel: "fake-model" }));
    await writeFile(join(root, "agent/models.json"), JSON.stringify(MODELS));
    return root;
  }
  const env = (root: string) => ({ PATH: process.env.PATH ?? "", HOME: join(root, "home"), PI_OFFLINE: "1", PI_CODING_AGENT_DIR: join(root, "agent") });
  const driverArgs = (root: string, args: Json, extra: string[] = [], tool = "intelli_research") => [DRIVER, "--sdk", SDK,
    "--agent-dir", join(root, "agent"), "--cwd", join(root, "ws"), "--tool", tool, "--args", JSON.stringify(args),
    "--extension", join(root, "fixture-ext.mjs"), "--no-extensions", ...extra];
  const records = (stdout: string) => stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Json);

  it("sends exactly the oracle's arguments, null omissions dropped, and the verdict binds the call", async (t) => {
    const root = await setup(t);
    const since = Date.now();
    const run = spawnSync(process.execPath, driverArgs(root, { query: "q", maxUrls: 2, domains: ["a.org"], focusPrompt: null }, ["--tools", "intelli_research"]),
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(root, "ws/received.json"), "utf8")), { query: "q", maxUrls: 2, domains: ["a.org"] });
    const events = records(run.stdout);
    const starts = events.filter((e) => e.type === "tool_execution_start");
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].args, { query: "q", maxUrls: 2, domains: ["a.org"] });
    assert.ok(events.some((e) => e.type === "tool_execution_update"), "progress updates are streamed");
    assert.deepEqual(events.at(-1), { type: "e2e_direct_settled", agentLoopModelCalls: 0, agentLoopEvents: 0, exitCode: 0 });
    assert.equal(events[0].type, "e2e_direct_driver");
    assert.ok(existsSync(join(root, "ws/session-start.json")), "session_start reached the extension");
    const verdict = bindAttempt({ traceText: run.stdout, workspace: join(root, "ws"), cacheRoot: ".search", tool: "intelli_research",
      sinceMs: since, expect: { query: "q", maxUrls: 2, domains: ["a.org"], focusPrompt: null } });
    assert.equal(verdict.status, "pass", verdict.reason);
  });

  it("refuses an agent-loop model call and exits 71", async (t) => {
    const root = await setup(t);
    const run = spawnSync(process.execPath, driverArgs(root, { query: "loop" }), { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 71, run.stderr);
    const settled = records(run.stdout).at(-1) as Json;
    assert.equal(settled.type, "e2e_direct_settled");
    assert.ok(Number(settled.agentLoopModelCalls) >= 1, "the refused call is counted");
    assert.equal(settled.exitCode, 71);
  });

  it("resolves project trust as the host does and hands the extension the same decision", async (t) => {
    for (const trusted of [true, false]) {
      const root = await setup(t);
      await mkdir(join(root, "ws/.pi"));
      await writeFile(join(root, "ws/.pi/settings.json"), JSON.stringify({ "pi-intelli-search": { cacheDir: ".search-client-x" } }));
      if (trusted) await writeFile(join(root, "agent/trust.json"), JSON.stringify({ [join(root, "ws")]: true }));
      const run = spawnSync(process.execPath, driverArgs(root, { query: "q" }), { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
      assert.equal(run.status, 0, run.stderr);
      const header = records(run.stdout)[0];
      const seen = JSON.parse(await readFile(join(root, "ws/session-start.json"), "utf8"));
      assert.equal(seen.trusted, header.projectTrusted, `driver and extension agree (trust.json: ${trusted})`);
      if (trusted) assert.equal(seen.trusted, true);
    }
  });

  it("reports an unavailable host explicitly (69) and an uncallable tool as a harness error (72)", async (t) => {
    const root = await setup(t);
    const fake = join(root, "fake-sdk");
    await mkdir(join(fake, "dist"), { recursive: true });
    await writeFile(join(fake, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.0.0", type: "module" }));
    await writeFile(join(fake, "dist/index.js"), "export const VERSION = '0.0.0';\n");
    const args = driverArgs(root, { query: "q" });
    args[2] = fake;
    const missing = spawnSync(process.execPath, args, { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(missing.status, 69, missing.stderr);
    assert.match(records(missing.stdout).at(-1)?.reason as string, /lacks createAgentSession/);
    args[2] = join(root, "nowhere");
    assert.equal(spawnSync(process.execPath, args, { cwd: join(root, "ws"), encoding: "utf8", env: env(root) }).status, 69);
    const notCallable = spawnSync(process.execPath, driverArgs(root, { query: "q" }, ["--tool-wait-ms", "300"], "intelli_missing"),
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(notCallable.status, 72, notCallable.stderr);
    assert.ok(records(notCallable.stdout).some((e) => e.type === "e2e_direct_not_callable"));
  });

  it("an MCP call goes through the host's MCP client to the stdio server with the exact arguments", async (t) => {
    const root = await setup(t);
    // A minimal stdio MCP server: initialize, tools/list, tools/call. It logs
    // the arguments it receives.
    const server = `import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "intelli_research", description: "fixture", inputSchema: { type: "object", properties: { query: { type: "string" }, maxUrls: { type: "number" } }, required: ["query"] } }] } });
  else if (msg.method === "tools/call") { appendFileSync(process.argv[2], JSON.stringify(msg.params.arguments) + "\\n"); send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "fixture result" }] } }); }
  else if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
`;
    await writeFile(join(root, "server.mjs"), server);
    await writeFile(join(root, "agent/mcp.json"), JSON.stringify({ mcpServers: { "intelli-search": {
      command: process.execPath, args: [join(root, "server.mjs"), join(root, "calls.jsonl")], exposure: "direct" } } }));
    const tool = "mcp__intelli_search__intelli_research";
    const run = spawnSync(process.execPath, [DRIVER, "--sdk", SDK, "--agent-dir", join(root, "agent"), "--cwd", join(root, "ws"),
      "--tool", tool, "--args", JSON.stringify({ query: "q", maxUrls: 1, focusPrompt: null }), "--tools", tool, "--tool-wait-ms", "15000"],
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr);
    const events = records(run.stdout);
    assert.deepEqual(events[0].builtinExtensions && (events[0].builtinExtensions as string[]).includes("mcp"), true, "the MCP client is loaded");
    assert.ok(events.some((e) => e.type === "tool_execution_end" && e.toolName === tool && e.isError === false));
    assert.deepEqual((await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l)), [{ query: "q", maxUrls: 1 }]);
    assert.deepEqual(events.at(-1), { type: "e2e_direct_settled", agentLoopModelCalls: 0, agentLoopEvents: 0, exitCode: 0 });
  });

  it("SIGTERM aborts the running call and exits 143 after shutdown", async (t) => {
    const root = await setup(t);
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, driverArgs(root, { query: "wait-abort" }), { cwd: join(root, "ws"), env: env(root), stdio: "ignore" });
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    for (let i = 0; i < 300 && !existsSync(join(root, "ws/started")); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.ok(existsSync(join(root, "ws/started")), "the call started");
    child.kill("SIGTERM");
    assert.equal(await exited, 143);
    assert.ok(existsSync(join(root, "ws/aborted")), "the tool saw the abort signal");
  });

  it("locates the host SDK from an npm bin link or the managed launcher, and drops null arguments", async (t) => {
    const root = await scratch(t, "e2e-sdk-resolve-");
    const pkg = join(root, "install/node_modules/@earendil-works/pi-coding-agent");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9" }));
    await writeFile(join(pkg, "dist/cli.js"), "#!/usr/bin/env node\n");
    await mkdir(join(root, "install/node_modules/.bin"));
    const { symlink } = await import("node:fs/promises");
    await symlink("../@earendil-works/pi-coding-agent/dist/cli.js", join(root, "install/node_modules/.bin/pi"));
    assert.equal(resolveSdkFromHostBin(join(root, "install/node_modules/.bin/pi")), pkg);

    const agent = join(root, "agent");
    const managed = join(agent, "install/releases/9.9.9/node_modules/@earendil-works/pi-coding-agent");
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9" }));
    await writeFile(join(agent, "install/current-version"), "9.9.9\n");
    await mkdir(join(agent, "bin"));
    await writeFile(join(agent, "bin/pi"), "#!/bin/sh\npi_current_file=$pi_agent_dir/install/current-version\n");
    assert.equal(resolveSdkFromHostBin(join(agent, "bin/pi")), managed);
    await writeFile(join(agent, "install/current-version"), "../../etc\n");
    assert.equal(resolveSdkFromHostBin(join(agent, "bin/pi")), undefined, "an unsafe version name is refused");
    await writeFile(join(root, "other"), "#!/bin/sh\necho hi\n");
    assert.equal(resolveSdkFromHostBin(join(root, "other")), undefined);

    assert.deepEqual(directArguments({ query: "q", maxUrls: null, domains: ["a"], focusPrompt: undefined }), { query: "q", domains: ["a"] });
  });

  it("lib.sh plans direct arguments and the oracle from E2E_EXPECT_ARGS and the query", () => {
    const plan = (expect: string, query: string) => spawnSync("bash", ["-c", 'source "$1"; e2e_direct_plan "$2" "$3"', "fixture", LIB, expect, query], { encoding: "utf8" });
    const two = plan('{"maxUrls":null,"focusPrompt":"f"}', "the q").stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(two, [{ focusPrompt: "f", query: "the q" }, { maxUrls: null, focusPrompt: "f", query: "the q" }]);
    const own = plan('{"query":"oracle q","maxUrls":1}', "ignored").stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(own[0], { query: "oracle q", maxUrls: 1 }, "an oracle query wins");
    assert.notEqual(plan('{"maxUrls":1}', "").status, 0, "no query, no plan");
  });

  describe("e2e_run_pi invocation modes", () => {
    // A fake agent-loop host: one correct research call, as print mode would log it.
    const FAKE_PI = `#!/usr/bin/env bash
echo invoked >> "$FAKE_STATE"
mkdir -p .search/agent-entry
printf '%s' '{"outcome":"completed","stages":{"fetch":{"succeeded":1},"collate":{"summaryChars":9}}}' > .search/agent-entry/meta.json
printf '{"type":"tool_execution_start","toolCallId":"a1","toolName":"intelli_research","args":{"query":"agent words","maxUrls":2}}\\n'
printf '{"type":"tool_execution_end","toolCallId":"a1","toolName":"intelli_research","isError":false,"result":{"content":[{"type":"text","text":"done"}],"details":{"cachePath":".search/agent-entry"}}}\\n'
`;
    const runLib = async (root: string, settings: string) => {
      await writeFile(join(root, "fake-pi"), FAKE_PI);
      await chmod(join(root, "fake-pi"), 0o755);
      return spawnSync("bash", ["-c", `set -euo pipefail; source "$1"; ${settings}
E2E_PI_BIN="$2/fake-pi"; E2E_EXTENSION_PATH="$2/fixture-ext.mjs"; E2E_ATTEMPT_DIR="$2/attempts"; E2E_RETRY_SLEEP_SECONDS=0
E2E_EXPECT_ARGS='{"maxUrls":2,"focusPrompt":null}'
rc=0; e2e_run_pi "$2/agent" "$2/ws" "prompt" 60 || rc=$?
printf 'RC=%s INVOCATION=%s ENTRY=%s FALLBACK=%s\\n' "$rc" "\${E2E_LAST_INVOCATION:-}" "$E2E_BOUND_ENTRY" "\${E2E_INVOCATION_FALLBACK:-}"`, "fixture", LIB, root],
      { encoding: "utf8", env: { ...env(root), FAKE_STATE: join(root, "fake-state") }, timeout: 120_000 });
    };

    it("direct mode binds an exact call and records the evidence class", async (t) => {
      const root = await setup(t);
      const out = await runLib(root, `E2E_INVOCATION=direct; E2E_PI_SDK="${SDK}"; E2E_RESEARCH_QUERY="the q"`);
      assert.match(out.stdout, /RC=0 INVOCATION=direct ENTRY=.*\/ws\/\.search\/2026-11-09-fixture FALLBACK=$/m, out.stderr);
      assert.ok(!existsSync(join(root, "fake-state")), "the agent-loop host was never started");
      assert.deepEqual(JSON.parse(await readFile(join(root, "ws/received.json"), "utf8")), { maxUrls: 2, query: "the q" });
      const verdict = JSON.parse(await readFile(join(root, "attempts/001-attempt-1.verdict.json"), "utf8"));
      assert.equal(verdict.invocation, "direct");
      assert.equal(verdict.status, "pass");
    });

    it("auto falls back to the agent loop only with a written report; direct refuses", async (t) => {
      const root = await setup(t);
      const fake = join(root, "fake-sdk");
      await mkdir(join(fake, "dist"), { recursive: true });
      await writeFile(join(fake, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.0.0", type: "module" }));
      await writeFile(join(fake, "dist/index.js"), "export {};\n");
      const auto = await runLib(root, `E2E_INVOCATION=auto; E2E_PI_SDK="${fake}"; E2E_RESEARCH_QUERY="the q"`);
      assert.match(auto.stdout, /RC=0 INVOCATION=agent-loop ENTRY=.*agent-entry FALLBACK=.*invocation-fallback\.json$/m, auto.stderr);
      assert.match(auto.stderr, /DIRECT INVOCATION UNAVAILABLE/);
      const report = JSON.parse(await readFile(join(root, "attempts/invocation-fallback.json"), "utf8"));
      assert.equal(report.requested, "auto");
      assert.equal(report.used, "agent-loop");
      assert.match(report.reason, /lacks createAgentSession/);
      const verdict = JSON.parse(await readFile(join(root, "attempts/002-attempt-1.verdict.json"), "utf8"));
      assert.equal(verdict.invocation, "agent-loop");
      assert.match(verdict.invocationFallback, /invocation-fallback\.json$/);
      assert.equal(verdict.status, "pass", "the agent-loop oracle is the original one, without the direct query");

      const strict = await setup(t);
      const refused = await runLib(strict, `E2E_INVOCATION=direct; E2E_PI_SDK="${fake}"; E2E_RESEARCH_QUERY="the q"`);
      assert.match(refused.stdout, /RC=3 /, refused.stderr);
      assert.match(refused.stderr, /No weaker oracle is substituted/);
      assert.ok(!existsSync(join(strict, "fake-state")), "no agent-loop fallback under direct");
      assert.equal(JSON.parse(await readFile(join(strict, "attempts/invocation-fallback.json"), "utf8")).used, "none");
    });

    it("direct mode without a query is a harness error before any host starts", async (t) => {
      const root = await setup(t);
      const out = await runLib(root, `E2E_INVOCATION=direct; E2E_PI_SDK="${SDK}"`);
      assert.match(out.stdout, /RC=3 /);
      assert.match(out.stderr, /needs E2E_RESEARCH_QUERY/);
      assert.deepEqual(await readdir(join(root, "attempts")), []);
    });
  });

  it("the parallel runner requests strict direct mode for configuration units only", async () => {
    // The runner's modules ship without declarations; load them untyped.
    const runnerModule: string = "./e2e/parallel-runner.mjs";
    const manifestModule: string = "./e2e/parallel-manifest.mjs";
    const { workerEnvironment } = await import(runnerModule);
    const { createManifest } = await import(manifestModule);
    const paths = Object.fromEntries(["root", "home", "tmp", "workspace", "logs", "traces", "agent", "npm-cache",
      "xdg-cache", "xdg-config", "xdg-data", "xdg-state", "xdg-runtime"].map((k) => [k, `/units/x/${k}`]));
    const artifacts = { paths: { currentBin: "/f/bin/pi", floorBin: "/fl/bin/pi", extension: "/f/e.js", floorExtension: "/fl/e.js",
      mcpCli: "/f/m.js", mcpTarball: "/f/m.tgz", traceExtension: "/f/t.mjs", traceFetch: "/f/f.mjs" } };
    const base = { PATH: "/usr/bin", HOME: "/operator", OPENROUTER_API_KEY: "dummy-fixture" };
    const byUnit: Record<string, string | undefined> = {};
    for (const unit of createManifest().units.filter((u: { kind: string }) => u.kind === "provider")) {
      byUnit[unit.id] = workerEnvironment(unit, paths, new Map(), artifacts, base).E2E_INVOCATION;
    }
    for (const [id, invocation] of Object.entries(byUnit)) {
      const expected = /^(01|15)_/.test(id) ? undefined : "direct";
      assert.equal(invocation, expected, id);
    }
    assert.ok(Object.keys(byUnit).length >= 20, "provider units were enumerated");
  });
});
