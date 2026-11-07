// SPDX-License-Identifier: Apache-2.0
// RCCA regression (rcca-extract): F3/F5. Drives the real MCP runtime + core research pipeline with a
// scripted OpenRouter transport (no network) and observes per-page status, recorded reasons,
// MCP tool result mapping (successResult), report.md and meta.json. Observations are printed as
// "OBS {json}" and appended to $RCCA_OBS so both trees can be compared.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, identity } from "../../../packages/mcp/src/runtime.js";
import { successResult } from "../../../packages/mcp/src/server.js";
import { fixture, json, fakeTransport, document } from "../../../packages/mcp/test/helpers.js";
import { parseConfig } from "../../../packages/mcp/src/config.js";
import { COLLATION_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, CACHE_SUGGEST_PROMPT } from "../../../src/core/prompts.js";

type Msg = Record<string, unknown>;
interface Reply { message?: Msg; finish?: string; usage?: Record<string, unknown>; extra?: Record<string, unknown>; status?: number; hang?: boolean }
const ok = (content: string, finish = "stop", usage?: Record<string, unknown>): Reply => ({ message: { content }, finish, usage });
const mk = (n: string, content: string, status = "success", error?: string) => ({ url: `https://docs.example/${n}`, title: n.toUpperCase(), content, status, source: "defuddle", ...(error ? { error } : {}) });
const SYNTH = "Synthesised facts about the topic [S1].";
const EXTRACT = "Official documentation, current.\nFacts [S1]";
const cap = { prompt_tokens: 900, completion_tokens: 3000, total_tokens: 3900, completion_tokens_details: { reasoning_tokens: 3000 } };

function body(r: Reply) {
  return json({ ...(r.extra ?? {}), choices: [{ message: r.message ?? { content: "" }, finish_reason: r.finish ?? "stop" }], usage: r.usage }, r.status ?? 200);
}
async function tree(dir: string, root = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tree(p, root))); else out.push(p.slice(root.length + 1));
  }
  return out.sort();
}
interface Script {
  pages: ReturnType<typeof mk>[];
  extract: (n: number, url: string, req: Record<string, unknown>) => Reply;
  collate?: Reply;
  tuning?: Record<string, unknown>;
}
async function scenario(name: string, script: Script, query = `probe ${name}`) {
  const f = await fixture();
  const config = script.tuning ? await parseConfig({ ...document(), tuning: { ...document().tuning, ...script.tuning } }, f.dir) : f.config;
  const calls = { extract: 0 };
  const extractReq: Array<{ max_completion_tokens: unknown; reasoning: unknown; userChars: number }> = [];
  const logs: string[] = [];
  const search = "Answer " + script.pages.map((p) => `[${p.title}](${p.url})`).join(" and ") + ".";
  const rt = await createRuntime(config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger: { error: (m) => logs.push(m), warn: (m) => logs.push(m) },
    fetch: fakeTransport(async (req, init) => {
      const msgs = req.messages as Array<{ content: string }>;
      const sys = msgs[0].content;
      if (sys === COLLATION_SYSTEM_PROMPT) return body(script.collate ?? ok(SYNTH));
      if (sys === CACHE_SUGGEST_PROMPT) return body(ok("[]"));
      if (sys === EXTRACTION_SYSTEM_PROMPT) {
        const n = ++calls.extract;
        extractReq.push({ max_completion_tokens: req.max_completion_tokens, reasoning: req.reasoning, userChars: msgs[1].content.length });
        const url = (msgs[1].content.match(/https:\/\/docs\.example\/\w+/) ?? [""])[0];
        const r = script.extract(n, url, req);
        if (r.hang) await new Promise((_, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
        return body(r);
      }
      return body(ok(search));
    }),
    researchDependencies: { fetchPages: async () => script.pages as never, downloadLlmsFullToCache: async () => null },
  });
  try {
    let result: Awaited<ReturnType<typeof rt.execute>> | undefined;
    let error: { code?: string; message: string } | undefined;
    const t0 = Date.now();
    try { result = await rt.execute("intelli_research", { query, maxUrls: script.pages.length }); }
    catch (e) { error = { code: (e as { code?: string }).code, message: (e as Error).message }; }
    const mcp = result ? successResult(result) : undefined;
    const cache = join(f.dir, ".search");
    const files = (await tree(cache)).filter((x) => !x.startsWith(".staging"));
    const metaFile = files.find((x) => x.endsWith("/meta.json"));
    const meta = metaFile ? JSON.parse(await readFile(join(cache, metaFile), "utf8")) : undefined;
    const reportFile = files.find((x) => x.endsWith("/report.md"));
    const report = reportFile ? await readFile(join(cache, reportFile), "utf8") : undefined;
    const obs = {
      version: identity.version, scenario: name, error, outcome: result?.outcome,
      mcpResult: mcp && { isError: (mcp as { isError?: boolean }).isError ?? false, structuredKeys: Object.keys(mcp.structuredContent ?? {}), detailsKeys: Object.keys((mcp.structuredContent as { details: object })?.details ?? {}) },
      details: result?.details,
      text: result?.text.slice(0, 2600),
      files, meta: meta && { outcome: meta.outcome, extract: meta.stages?.extract, fetch: meta.stages?.fetch, collate: meta.stages?.collate },
      reportFailedSection: report ? (report.match(/(Blocked\/Failed[\s\S]{0,600})/) ?? [""])[0] : undefined,
      reportHeader: report ? (report.match(/Sources:[^\n]*/) ?? [""])[0] : undefined,
      extractReq: extractReq.slice(0, 3), extractCalls: calls.extract,
      logs: logs.filter((l) => !/retrying in/.test(l)).map((l) => l.slice(0, 220)),
      retryNotices: logs.filter((l) => /retrying in/.test(l)).length,
      ms: Date.now() - t0,
    };
    const line = "OBS " + JSON.stringify(obs);
    console.log(line);
    if (process.env.RCCA_OBS) appendFileSync(process.env.RCCA_OBS, line + "\n");
    return obs;
  } finally { await f.cleanup(); }
}
const A = mk("a", "## A\nAlpha facts"), B = mk("b", "## B\nBeta facts");
const allFail = (r: Reply) => ({ pages: [A, B], extract: () => r });

// ---- response shapes that produce an empty extraction --------------------------------------
test("X1 extract: content null + length (reasoning exhausted cap) on every page", async () => {
  const o = await scenario("x1", allFail({ message: { content: null, reasoning: "thinking" }, finish: "length", usage: cap }));
  assert.equal(o.outcome, "extraction-failed");
  // Corrected: each page is retried once at a doubled cap before it fails.
  assert.equal(o.extractCalls, 4);
  assert.equal(o.meta?.extract.budgetRetries, 2);
  assert.equal(o.meta?.extract.failureReasons.budgetExhausted, 2);
});
test("X2 extract: content '' + length", async () => {
  const o = await scenario("x2", allFail(ok("", "length", cap)));
  assert.equal(o.outcome, "extraction-failed");
});
test("X3 extract: content null + stop", async () => {
  const o = await scenario("x3", allFail({ message: { content: null }, finish: "stop" }));
  assert.equal(o.outcome, "extraction-failed");
});
test("X4 extract: content '' + stop", async () => {
  const o = await scenario("x4", allFail(ok("", "stop")));
  assert.equal(o.outcome, "extraction-failed");
});
test("X5 extract: whitespace + stop", async () => {
  await scenario("x5", allFail(ok("  \n ", "stop")));
});
test("X6 extract: HTTP 500 persistent", async () => {
  await scenario("x6", allFail({ status: 500 }));
});
test("X7 extract: model call hangs (llmTimeoutMs elapses)", async () => {
  await scenario("x7", { pages: [A, B], extract: () => ({ hang: true }), tuning: { llmTimeoutMs: 150, llmRetryAttempts: 1 } });
});
test("X8 extract: nonempty cut at cap (length + usage at cap)", async () => {
  const o = await scenario("x8", allFail(ok("Official documentation, current.\nFacts cut mid-sen", "length", { prompt_tokens: 900, completion_tokens: 3000, total_tokens: 3900 })));
  // F4 corrected: finish_reason "length" flags truncation below the configured cap.
  assert.equal(o.meta?.extract.truncated, 2);
  assert.equal(o.extractCalls, 2, "nonempty extraction text is not retried");
});

// ---- F5: mixed outcomes and result fields ---------------------------------------------------
test("M1 mixed: page A ok, page B empty -> completed; failure visible only in report?", async () => {
  const o = await scenario("m1", { pages: [A, B], extract: (_n, _u, req) => (JSON.stringify(req.messages).includes("Beta facts") ? ok("", "stop") : ok(EXTRACT)) });
  assert.equal(o.outcome, "completed");
});
test("M2 mixed: A ok, B budget exhausted (null+length)", async () => {
  await scenario("m2", { pages: [A, B], extract: (_n, _u, req) => (JSON.stringify(req.messages).includes("Beta facts") ? { message: { content: null }, finish: "length", usage: cap } : ok(EXTRACT)) });
});
test("M3 call-9 shape: 3 pages, 1 fetch error, 2 fetched but both extractions fail -> text says fetch failure?", async () => {
  const C = mk("c", "", "error", "HTTP 404");
  const o = await scenario("m3", { pages: [A, B, C], extract: () => ok("", "stop") });
  assert.equal(o.outcome, "extraction-failed");
  // F5 corrected: the headline names both failure kinds. The 0.22.0 text
  // opened with the headline; the kept-pages report carries it in the
  // failure quote under the "## Extraction Failed" heading.
  assert.match(o.text ?? "", /1 page\(s\) failed to fetch and 2 extraction\(s\) failed/);
});
test("M4 all fetched, all extractions fail (5 pages) -> details", async () => {
  const pages = ["a", "b", "c", "d", "e"].map((n) => mk(n, `## ${n}\nfacts`));
  await scenario("m4", { pages, extract: () => ok("", "stop") });
});
test("M5 all fetch fail -> fetch-failed; meta has URLs?", async () => {
  const pages = [mk("a", "", "error", "HTTP 403"), mk("b", "", "error", "Not HTML: application/pdf")];
  const o = await scenario("m5", { pages, extract: () => ok(EXTRACT) });
  assert.equal(o.outcome, "fetch-failed");
  // F5 corrected: each failed URL is listed with its reason.
  assert.match(o.text ?? "", /docs\.example\/a: HTTP 403/);
  assert.match(o.text ?? "", /docs\.example\/b: Not HTML: application\/pdf/);
});

// ---- R5 corrected: every extraction fails keeps the fetched pages (owner decision 2026-11-07) ------
test("K1 all extractions fail -> fetched pages saved with a failure report that names each page and reason", async () => {
  const o = await scenario("k1", allFail(ok("", "stop")));
  assert.equal(o.outcome, "extraction-failed");
  assert.ok(typeof o.details?.cachePath === "string" && o.details.cachePath.length > 0,
    "details.cachePath names the saved folder");
  assert.ok(o.files.some((x) => x.endsWith("/report.md")), "failure report written");
  assert.equal(o.files.filter((x) => x.includes("/sources/")).length, 2, "every fetched page saved");
  assert.equal(o.files.filter((x) => x.includes("/extractions/")).length, 0,
    "a failed extraction writes no extraction file");
  assert.match(o.text ?? "", /## Extraction Failed/);
  assert.match(o.text ?? "", /2 extraction\(s\) failed/);
  assert.match(o.text ?? "", /full page saved: .*sources\/01-docs-example\.md/);
  assert.doesNotMatch(o.text ?? "", /intelli-search:extraction-failed/,
    "the failure-report marker is not shown to the calling agent");
  assert.match(o.reportFailedSection ?? "", /full page saved: sources\/01-docs-example\.md/);
  assert.match(o.reportFailedSection ?? "", /Extraction returned no visible text/);
  assert.equal(o.meta?.outcome, "extraction-failed");
  assert.equal(o.mcpResult?.isError, false, "degraded result is not a tool error");
});
test("K2 mixed: 1 fetch error, 2 fetched pages whose extractions fail -> fetched pages saved, fetch failure listed", async () => {
  const C = mk("c", "", "error", "HTTP 404");
  const o = await scenario("k2", { pages: [A, B, C], extract: () => ok("", "stop") });
  assert.equal(o.outcome, "extraction-failed");
  assert.ok(o.details?.cachePath, "the run commits its own artefact set");
  assert.equal(o.files.filter((x) => x.includes("/sources/")).length, 2,
    "only the pages that fetched are saved");
  assert.match(o.text ?? "", /docs\.example\/c: HTTP 404/, "the fetch failure is listed with its reason");
  assert.match(o.text ?? "", /full page saved: .*sources\/01-docs-example\.md/);
});

// ---- input size under shipped defaults ------------------------------------------------------
test("S1 size: 400k-char page, defaults: what is sent (input chars, max tokens, reasoning)?", async () => {
  const big = mk("big", "x".repeat(400_000));
  const o = await scenario("s1", { pages: [big, A], extract: () => ok(EXTRACT) });
  console.log("S1 sent", JSON.stringify(o.extractReq));
});
test("S2 size-sensitive stub: provider exhausts cap only when input is large (hypothesis model, NOT evidence of provider behaviour)", async () => {
  const big = mk("big", "x".repeat(400_000));
  const o = await scenario("s2", { pages: [big, A], extract: (_n, _u, req) => {
    const chars = (req.messages as Array<{ content: string }>)[1].content.length;
    return chars > 100_000 ? { message: { content: null }, finish: "length", usage: cap } : ok(EXTRACT);
  } });
  assert.equal(o.outcome, "completed");
});
