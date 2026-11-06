// SPDX-License-Identifier: Apache-2.0
// RCCA probe (rcca-collate): drives the real MCP runtime + core research pipeline with a
// scripted OpenRouter transport. No network. Observations are printed as "OBS {json}" lines
// and also appended to $RCCA_OBS (a scratch file) so both trees can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, identity } from "../../../packages/mcp/src/runtime.js";
import { fixture, json, fakeTransport, logger } from "../../../packages/mcp/test/helpers.js";
import {
  COLLATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "../../../src/core/prompts.js";

type Msg = Record<string, unknown>;
interface Reply {
  message?: Msg; // choice.message
  finish?: string; // choice.finish_reason
  usage?: Record<string, unknown>;
  extra?: Record<string, unknown>; // top-level (e.g. provider)
  status?: number;
}
const ok = (content: string, finish = "stop", usage?: Record<string, unknown>): Reply => ({
  message: { content },
  finish,
  usage,
});
const pages = [
  { url: "https://docs.example/a", title: "A", content: "## A\nAlpha facts", status: "success", source: "markdown" },
  { url: "https://docs.example/b", title: "B", content: "## B\nBeta facts", status: "success", source: "markdown" },
];
const SEARCH = `Answer [A](${pages[0].url}) and [B](${pages[1].url}).`;
const EXTRACT = "Official documentation, current.\nFacts [S1]";
const SYNTH = "Synthesised facts about the topic [S1].";

function body(r: Reply) {
  return json(
    {
      ...(r.extra ?? {}),
      choices: [{ message: r.message ?? { content: "" }, finish_reason: r.finish ?? "stop" }],
      usage: r.usage,
    },
    r.status ?? 200,
  );
}
async function tree(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tree(p, root)));
    else out.push(p.slice(root.length + 1));
  }
  return out.sort();
}
interface Script {
  search?: Reply;
  extract?: Reply | ((n: number) => Reply);
  collate?: Reply | ((n: number) => Reply);
  judge?: Reply | ((n: number) => Reply);
}
async function scenario(name: string, script: Script, opts: { prior?: boolean } = {}) {
  const f = await fixture();
  const calls: Record<string, number> = { search: 0, extract: 0, collate: 0, judge: 0 };
  const logs: string[] = [];
  const rt = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger: { error: (m) => logs.push(m), warn: (m) => logs.push(m) },
    fetch: fakeTransport((req) => {
      const sys = (req.messages as Array<{ content: string }>)[0].content;
      const pick = <T>(v: T | ((n: number) => T) | undefined, n: number, d: T): T =>
        typeof v === "function" ? (v as (n: number) => T)(n) : (v ?? d);
      if (sys === COLLATION_SYSTEM_PROMPT)
        return body(pick(script.collate, ++calls.collate, ok(SYNTH)));
      if (sys === EXTRACTION_SYSTEM_PROMPT)
        return body(pick(script.extract, ++calls.extract, ok(EXTRACT)));
      if (sys === CACHE_SUGGEST_PROMPT)
        return body(pick(script.judge, ++calls.judge, ok("[]")));
      return body(script.search ?? ok(SEARCH));
    }),
    researchDependencies: {
      fetchPages: async () => pages as never,
      downloadLlmsFullToCache: async () => null,
    },
  });
  try {
    if (opts.prior) {
      // A first, healthy run so the cache index holds another entry and the judge is issued.
      const saved = { ...script };
      script.collate = undefined; script.extract = undefined; script.judge = undefined;
      await rt.execute("intelli_research", { query: "prior unrelated topic", maxUrls: 2 });
      Object.assign(script, saved);
      for (const k of Object.keys(calls)) calls[k] = 0;
      logs.length = 0;
    }
    let result: Awaited<ReturnType<typeof rt.execute>> | undefined;
    let error: { code?: string; message: string } | undefined;
    const t0 = Date.now();
    try {
      result = await rt.execute("intelli_research", { query: `probe ${name}`, maxUrls: 2 });
    } catch (e) {
      error = { code: (e as { code?: string }).code, message: (e as Error).message };
    }
    const cache = join(f.dir, ".search");
    const files = await tree(cache);
    const slug = files.find((x) => x.endsWith("/meta.json") && x.includes(`-probe-${name}-`));
    const meta = slug ? JSON.parse(await readFile(join(cache, slug), "utf8")) : undefined;
    const reportFile = files.find((x) => x.endsWith("/report.md") && x.includes(`-probe-${name}-`));
    const report = reportFile ? await readFile(join(cache, reportFile), "utf8") : undefined;
    const staging = await tree(join(cache, ".staging"));
    const obs = {
      version: identity.version,
      scenario: name,
      error,
      outcome: result?.outcome,
      details: result?.details,
      textTail: result?.text.slice(-300),
      textHasWarning: result ? /truncat|cut off|⚠/i.test(result.text) : undefined,
      calls,
      files: files.filter((x) => !x.startsWith(".staging")),
      staging,
      meta: meta && {
        outcome: meta.outcome,
        stages: meta.stages,
      },
      reportHasWarning: report ? /truncat|cut off|⚠/i.test(report) : undefined,
      logs: logs.filter((l) => !/retrying in/.test(l)).slice(0, 6).map((l) => l.slice(0, 160)),
      allLogs: logs.map((l) => l.slice(0, 160)),
      retryNotices: logs.filter((l) => /retrying in/.test(l)).length,
      ms: Date.now() - t0,
    };
    const line = "OBS " + JSON.stringify(obs);
    console.log(line);
    if (process.env.RCCA_OBS) appendFileSync(process.env.RCCA_OBS, line + "\n");
    return obs;
  } finally {
    await f.cleanup();
  }
}

const cap = { prompt_tokens: 900, completion_tokens: 4000, total_tokens: 4900, completion_tokens_details: { reasoning_tokens: 4000 } };
const hard = (o: Awaited<ReturnType<typeof scenario>>) => {
  assert.ok(o.error, "expected a thrown error");
  assert.equal(o.outcome, undefined);
  assert.deepEqual(o.files, [], "nothing written to the cache on a hard failure");
};

// ---- Collate-stage response shapes -------------------------------------------------------
test("C1 collate: content null + finish_reason length (reasoning exhausted the cap)", async () => {
  hard(await scenario("c1", { collate: { message: { content: null, reasoning: "thinking..." }, finish: "length", usage: cap } }));
});
test("C2 collate: content null + finish_reason stop", async () => {
  hard(await scenario("c2", { collate: { message: { content: null }, finish: "stop" } }));
});
test("C3 collate: content empty string + finish_reason stop", async () => {
  hard(await scenario("c3", { collate: ok("", "stop") }));
});
test("C4 collate: content empty string + finish_reason length", async () => {
  hard(await scenario("c4", { collate: ok("", "length", cap) }));
});
test("C5 collate: reasoning present, content null, stop", async () => {
  hard(await scenario("c5", { collate: { message: { content: null, reasoning: "long chain of thought", reasoning_details: [{ type: "reasoning.text", text: "x" }] }, finish: "stop", usage: cap } }));
});
test("C6 collate: reasoning present, content empty string, stop", async () => {
  hard(await scenario("c6", { collate: { message: { content: "", reasoning: "chain of thought" }, finish: "stop", usage: cap } }));
});
test("C9 collate: content key absent", async () => {
  hard(await scenario("c9", { collate: { message: { role: "assistant" }, finish: "stop" } }));
});
test("C10 collate: content is an array of parts", async () => {
  hard(await scenario("c10", { collate: { message: { content: [{ type: "text", text: "Synth" }] }, finish: "stop" } }));
});
test("C11 collate: whitespace-only content + stop", async () => {
  hard(await scenario("c11", { collate: ok("  \n ", "stop") }));
});
test("C12 collate: transient first call (null content) then healthy: is it retried?", async () => {
  const o = await scenario("c12", { collate: (n) => (n === 1 ? { message: { content: null }, finish: "stop" } : ok(SYNTH)) });
  console.log("C12 collate calls", o.calls.collate, "outcome", o.outcome, "error", o.error?.message);
});

// ---- F4: nonempty summary cut at the token cap ---------------------------------------------
const cut = "## Best match\n\nThe only implementation is community-maintained [S1]. Its `get-messages` tool handles both recent";
test("C7 collate: nonempty summary cut at cap, finish_reason length, usage at cap", async () => {
  const o = await scenario("c7", { collate: ok(cut, "length", { prompt_tokens: 900, completion_tokens: 4000, total_tokens: 4900 }) });
  assert.equal(o.outcome, "completed");
});
test("C8 collate: nonempty summary cut, finish_reason stop, no usage block", async () => {
  const o = await scenario("c8", { collate: ok(cut, "stop") });
  assert.equal(o.outcome, "completed");
});
test("C8b collate: nonempty cut, finish_reason length, usage absent", async () => {
  const o = await scenario("c8b", { collate: ok(cut, "length") });
  assert.equal(o.outcome, "completed");
});
test("C8c collate: nonempty cut, finish_reason stop, usage at cap", async () => {
  await scenario("c8c", { collate: ok(cut, "stop", { prompt_tokens: 900, completion_tokens: 4000, total_tokens: 4900 }) });
});

// ---- Extract-stage and cache-suggest shapes (F3 context, silent) ----------------------------
test("E1 extract: all pages content null -> degraded, silent", async () => {
  await scenario("e1", { extract: { message: { content: null }, finish: "stop" } });
});
test("E2 extract: one of two pages null, other fine", async () => {
  await scenario("e2", { extract: (n) => (n % 2 === 1 ? { message: { content: null }, finish: "stop" } : ok(EXTRACT)) });
});
test("E3 extract: all pages empty+length (reasoning exhausted)", async () => {
  await scenario("e3", { extract: ok("", "length", { prompt_tokens: 900, completion_tokens: 3000, total_tokens: 3900, completion_tokens_details: { reasoning_tokens: 3000 } }) });
});
test("J1 cache-suggest: judge returns content null -> swallowed?", async () => {
  const o = await scenario("j1", { judge: { message: { content: null }, finish: "stop" } }, { prior: true });
  console.log("J1 outcome", o.outcome, "error", o.error?.message);
});
test("J2 cache-suggest: judge empty string + length", async () => {
  const o = await scenario("j2", { judge: ok("", "length", { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 }) }, { prior: true });
  console.log("J2 outcome", o.outcome, "error", o.error?.message);
});
test("S1 search: content null -> hard failure at search stage", async () => {
  hard(await scenario("s1", { search: { message: { content: null }, finish: "stop" } }));
});
test("OK baseline: healthy run completes and writes meta.json", async () => {
  const o = await scenario("ok", {});
  assert.equal(o.outcome, "completed");
  assert.ok(o.files.some((x) => x.endsWith("meta.json")));
});
