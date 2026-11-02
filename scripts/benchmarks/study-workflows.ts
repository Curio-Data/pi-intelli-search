// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

/** Prescribed controlled-workflow scripts, not the unforced live-task prompts. */
export interface StudyQuery {
  readonly query: string;
  readonly focusPrompt: string;
  readonly domains?: readonly string[];
}
export interface ScriptBudget {
  readonly maxPages: number;
  readonly maxChars: number;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}
function checkedBudget(budget: ScriptBudget): ScriptBudget {
  for (const [key, max] of [["maxPages", 16], ["maxChars", 100_000], ["timeoutMs", 600_000], ["maxOutputTokens", 65_536]] as const) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 1 || budget[key] > max)
      throw new TypeError(`Invalid study script budget: ${key}`);
  }
  return budget;
}
function checkedQuery(task: StudyQuery): void {
  if (!task.query.trim() || !task.focusPrompt.trim()) throw new TypeError("Study query and focus are required");
}
function header(budget: ScriptBudget): string {
  checkedBudget(budget);
  return `// @options: ${JSON.stringify({ timeout_ms: budget.timeoutMs, max_output_tokens: budget.maxOutputTokens })}`;
}
const projection = "({ outcome: r.outcome, summary: r.summary, sources: r.sources.map(({id,url,title,state}) => ({id,url,title,state})), counts: r.counts, cache: r.cache, related: r.related })";

/** First turn of the two-turn cache workflow; no raw pages are stored. */
export function followupBaseScript(task: StudyQuery, budget: ScriptBudget): string {
  checkedQuery(task);
  return [header(budget),
    `const r = await tools.intelli_research(${JSON.stringify({ ...task, maxUrls: budget.maxPages })});`,
    "store('study.baseReport', r.cache.status === 'committed' ? r.cache.reportPath : null);",
    `return ${projection};`,
  ].join("\n");
}

/** Second turn reads the committed report; it starts no new pipeline call. */
export function followupReadScript(budget: ScriptBudget): string {
  return [header(budget),
    "const path = load('study.baseReport');",
    "if (!path) throw new Error('Base research has no committed report');",
    "return await tools.read({path});",
  ].join("\n");
}

export function singleResearchScript(task: StudyQuery, budget: ScriptBudget): string {
  checkedQuery(task);
  return [header(budget),
    `const r = await tools.intelli_research(${JSON.stringify({ ...task, maxUrls: budget.maxPages })});`,
    `return ${projection};`,
  ].join("\n");
}

/** Same total page allowance, split explicitly over angles, never multiplied. */
export function breadthResearchScript(tasks: readonly StudyQuery[], budget: ScriptBudget): string {
  const first = header(budget);
  if (tasks.length < 2 || tasks.length > budget.maxPages) throw new TypeError("Breadth needs two or more angles within the page allowance");
  tasks.forEach(checkedQuery);
  const base = Math.floor(budget.maxPages / tasks.length);
  const requests = tasks.map((task, i) => ({ ...task, maxUrls: base + (i < budget.maxPages % tasks.length ? 1 : 0) }));
  return [first,
    `const requests = ${JSON.stringify(requests)};`,
    "const results = await Promise.allSettled(requests.map((args) => tools.intelli_research(args)));",
    `return results.map((result, i) => result.status === 'fulfilled' ? {query: requests[i].query, result: ((r) => ${projection})(result.value)} : {query: requests[i].query, error: String(result.reason)});`,
  ].join("\n");
}

/** Serial extraction is intentional; the off workflow uses the same schedule. */
export function manualResearchScript(task: StudyQuery, budget: ScriptBudget, searchQueries: readonly string[] = [task.query]): string {
  checkedQuery(task);
  if (searchQueries.length < 1 || searchQueries.length > 2 || searchQueries.some((q) => !q.trim())) throw new TypeError("Manual workflow needs one or two concrete search queries");
  return [header(budget),
    `const task = ${JSON.stringify(task)};`,
    `const searches = ${JSON.stringify(searchQueries)};`,
    "const found = [];",
    "for (const query of searches) found.push(await tools.intelli_search({query, ...(task.domains ? {domains: task.domains} : {})}));",
    `const urls = [...new Set(found.flatMap((r) => r.sources.map((s) => s.url)))].slice(0, ${budget.maxPages});`,
    "const extractions = []; const pages = [];",
    "for (const url of urls) {",
    "  try {",
    `    const fetched = await tools.intelli_fetch({url, maxChars: ${budget.maxChars}});`,
    "    const page = fetched.sources[0];",
    "    pages.push({url, outcome: fetched.outcome, state: page && page.state});",
    "    if (!page || !page.content || fetched.outcome !== 'completed') continue;",
    "    const extracted = await tools.intelli_extract({url: page.url, title: page.title, content: page.content, query: task.query, focusPrompt: task.focusPrompt});",
    "    const source = extracted.sources[0];",
    "    extractions.push({url: page.url, title: page.title, extraction: source && source.extraction || '', sourceType: source && source.sourceType || 'unknown', status: extracted.outcome === 'completed' ? 'success' : 'failed'});",
    "  } catch (error) { pages.push({url, error: String(error)}); }",
    "}",
    "if (!extractions.some((x) => x.status === 'success' && x.extraction.trim())) return {outcome: 'no-extractions', pages};",
    "const r = await tools.intelli_collate({query: task.query, extractions});",
    `return {pages, result: ${projection}};`,
  ].join("\n");
}
