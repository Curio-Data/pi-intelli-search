# Model Benchmarks

This document records the extract/collate model benchmark for `intelli-search`: the methodology, the harness, the measured results, and the decisions taken from them. It exists so that future model comparisons are reproducible and comparable with the numbers already recorded here.

Benchmark numbers are canonical to this file. When a new model is benchmarked, append its runs here rather than editing historical rows.

## Purpose

The extract and collate stages dominate per-session cost and determine report quality. Choosing a model trades off extraction verbosity, collation epistemics (does the report state its ranking methodology, caveat low-evidence claims, flag compatibility warnings?), latency, and price. The benchmark runs the identical research request through competing models and records what changes.

## Methodology

### Harness

Run [`scripts/benchmark-models.sh`](../scripts/benchmark-models.sh) from the repo root:

```bash
npm run build
scripts/benchmark-models.sh google/gemini-3.8-flash minimax/minimax-m3
```

Per model, the harness:

1. Creates a fresh isolated agent directory and working directory (the `Pi` settings cache is per-process and only invalidated on `session_start`, so a benchmark cannot override models mid-session; every run gets a fresh process).
2. Writes `settings.json` with search pinned to [_Perplexity Sonar_](https://docs.perplexity.ai) and the benchmarked model as both `extractModel` and `collateModel`. `defaultUrls` and `maxUrls` are pinned to the same value so a missing `maxUrls` in the tool call clamps identically.
3. Starts headless `pi` with `PI_CODING_AGENT_DIR` pointed at the isolated directory, loading `dist/index.js`, with the tool-call parameters pinned verbatim in the prompt.
4. Prints the run's telemetry row from the `meta.json` sidecar (duration, links, fetch outcomes, extraction chars in/out, collation chars).

The agent-loop model is pinned per sitting (default: `kimi-coding/k3` when its key exists, overridable via `BENCH_LOOP_MODEL`); only the pipeline's extract/collate models vary. The 2026-09-07 baseline series ran with `google/gemini-3.8-flash` as the loop model.

### Fixed Stimulus

The default query, focusPrompt, and `maxUrls` equal the 2026-09-07 baseline, pinned in the script. Changing them (via `BENCH_QUERY`, `BENCH_FOCUS`, `BENCH_MAX_URLS`) starts a new comparison series; note that in the results table when you do.

### Parameter Fidelity

The headless agent, not the harness, composes the tool call. Two checks verify fidelity:

- **Query:** the cache directory slug is derived from the query hash. An identical query string produces an identical slug; all baseline runs share the slug `2026-09-07-top-10-most-popular-svelte-42d696`, and `query.txt` must equal the pinned query.
- **focusPrompt:** not cryptographically verifiable from artifacts. The prompt pins it verbatim and every extraction's content should reflect its terms (popularity metrics, star counts, Svelte 5 relevance). Treat focus fidelity as strong-but-inferred.

### Confounds And Limitations

- **Search nondeterminism dominates.** The search stage is a live Sonar call; identical queries return different link sets run to run. Corpus quality differences are entangled with model differences. Only pages fetched by two runs can be compared as pure model effects (compare the same-numbered extraction files across cache directories).
- **The agent loop is a variable, not just the pipeline.** Print-mode runs can leak the tool call into the answer text as `functions.intelli_research:0{...}` instead of a native tool-call block; `Pi` treats it as prose, exits 0, and the pipeline never runs. Root cause (fully diagnosed on 2026-09-07 evening, after the baseline series): `Pi` refreshes remote model catalogs from pi.dev every 4 hours and on extension-triggered registry refreshes. zai glm models require the `zaiToolStream` compat flag for native tool-call streaming; on the catalog-restore and `models.json` round-trip paths that flag is lost, so glm-5.3 emits tool calls as text and the headless loop exits without executing them. A models.json restore (257K bytes of catalog cache) reproduces this without the extension loaded. `kimi-coding/k3` is immune because its tool calls need no special compat flags. A second trap: a `models.json` containing a providers block breaks slash-form `defaultModel` resolution at `Pi` startup, routing the loop call to an OpenRouter fallback model. Harness mitigations: the loop model defaults to `kimi-coding/k3` when its key exists, the generated `settings.json` uses the split `defaultProvider` + `defaultModel` form, any exit-0 run that produced no cache entry is retried, and the E2E config-recipes runner applies the same retry. Verify parameter fidelity through the cache slug, never through the loop's self-report.
- **Adjacency converges.** Back-to-back runs share more links than runs hours apart; Sonar's index drifts on an hours scale. Interleave models (A, B, A, B) rather than blocking them when comparing more than two.
- **One query, one sitting.** Results are for the Svelte UI libraries query; other domains may rank differently.
- **Cache suggest only runs when the working directory has a populated `.search` index.** Fresh benchmark cwds have none, so that stage stays cold in all benchmark runs.
- **Live quota:** each run costs real OpenRouter credit (see the cost table in [README](../README.md)).

## Recorded Results

Baseline series, 2026-09-07. Extension build 0.13.0. Search: Sonar. Agent loop: `google/gemini-3.8-flash`. Runs 2A/1B/2B/3C were headless via the harness's predecessor; run 1A was a direct in-session tool call with exactly controlled parameters.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 1A | gemini-3.8-flash | 42.8s | 7/1 | 73.0K | 21.5K | 3.1K | 8.0K |
| 2A | gemini-3.8-flash | 49.4s | 7/1 | 141.1K | 28.0K | 4.0K | 8.4K |
| 1B | minimax-m3 | 52.2s | 6/2 | 92.1K | 28.1K | 4.7K | 9.3K |
| 2B | minimax-m3 | 59.3s | 7/1 | 104.4K | 37.4K | 5.3K | 10.2K |
| 3C | minimax-m2.7 | 68.1s | 7/1 | 95.0K | 18.6K | 2.7K | 4.8K |

OpenRouter pricing on 2026-09-07: minimax-m2.7 and minimax-m3 are identically priced at $0.30/M input and $1.20/M output; gemini-3.8-flash is cheaper per token. Latency showed no consistent model ordering across this series (42.8s to 68.1s spread; the slowest single run was m2.7).

### Harness Verification Series

2026-09-07 evening, extension build 0.14.0, after the print-mode tool-call leak was root-caused and the harness fixed (see Confounds And Limitations). Loop model: `kimi-coding/k3`.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 4B | minimax-m3 | 58.1s | 7/1 | 55.2K | 28.2K | 4.0K | 7.3K |

Run 4B's cache slug matched the baseline series exactly, and the report opened by stating its ranking methodology and the primacy of GitHub stars, matching the recorded m3 epistemic signature. Per-page extraction output (4.0K over 7 pages) sits just under the recorded m3 band (4.7K to 5.3K) on a smaller corpus (55.2K input versus 92K to 104K baseline).

### Late Series

2026-09-07 late evening, extension build 0.14.0, loop model `kimi-coding/k3`, after an OpenRouter credit top-up. Runs interleaved m3, gemini, m3, gemini. One print-mode leak retry fired (5B, attempt 1) and recovered on attempt 2: the first live proof of the harness retry guard.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 5B | minimax-m3 | 63.4s | 7/1 | 139.3K | 40.1K | 5.7K | 10.9K |
| 3A | gemini-3.8-flash | 41.2s | 7/1 | 139.6K | 22.9K | 3.3K | 7.8K |
| 6B | minimax-m3 | 49.1s | 7/1 | 139.6K | 34.6K | 4.9K | 7.5K |
| 4A | gemini-3.8-flash | 34.8s | 7/1 | 55.2K | 20.5K | 2.9K | 6.2K |

Late-series findings:

1. **Verbosity and epistemics reproduce on a converged corpus.** Runs 5B, 3A and 6B fetched the same seven sources (139.3K to 139.6K input). On that identical corpus m3 wrote 5.7K and 4.9K per page against gemini's 3.3K, and only the m3 reports opened by stating their evidence base ("across five independent sources..."). The same-URL extraction of dev.to measures the pure model effect directly: 6.7K (m3) versus 4.2K (gemini).
2. **Latency tracks extract verbosity.** gemini completed in 41.2s and 34.8s against m3's 63.4s and 49.1s, consistent with m3 writing 1.5 to 1.7 times gemini's extract output.
3. **The head of the ranking stays invariant; the number one slot moves only on the small corpus.** shadcn-svelte ranked first in 5B, 3A and 6B (the converged corpus) and second in 4A, whose 55.2K input matched the prior evening's 4B fetch exactly. 4A alone promoted daisyUI (framework-agnostic, 40,000+ stars) to first. Skeleton UI held the top three in all four runs.
4. **The recorded decision holds.** Two more runs per model reproduce every property that motivated the v0.14.0 default switch to m3 (methodology-first collation, transparent low-evidence handling, approximately 1M context) and its accepted cost (1.5 to 1.7 times gemini's extract tokens and correspondingly longer runs).

### Findings

1. **The head of the ranking is invariant.** shadcn-svelte at #1 and Skeleton UI at #2 in all five runs, across three models and five corpora. Flowbite Svelte held top-5 in all five runs.
2. **Ranks 3 to 10 are corpus-driven.** The two runs with the most-converged corpora (2A and 2B: different models, adjacent in time, four shared sources) produced identical top-10 lists in identical order. Same-model runs with divergent corpora swapped up to three tail entries.
3. **Sonar returned a stable core of three URLs across all runs** (adminlte.io, a persistently 404ing annauniversityplus.com page, and an unrelated portfolio page that every run correctly identified and discarded). The remaining five slots churned run to run.
4. **Epistemic style is a model property and is repeatable.** minimax-m3 opened both of its reports by stating its ranking methodology and the absence of authoritative npm statistics (2/2), surfaced low-star libraries (Kampsy-ui at 260 stars) transparently, and flagged Svelte 5 compatibility warnings. gemini-3.8-flash (0/2) and minimax-m2.7 (0/1) stated no methodology and silently dropped or omitted low-data entries.
5. **Verbosity is a model property and is repeatable.** Per-page extraction output: m2.7 ≈2.7K chars, gemini-3.8-flash ≈3.1K to 4.0K, m3 ≈4.7K to 5.3K. m3 writes roughly twice m2.7's extraction output at the same per-token price.

### Decision Recorded

v0.14.0 changed the default extract/collate model from `openrouter/minimax/minimax-m2.7` to `openrouter/minimax/minimax-m3`. Rationale: identical per-token pricing, an approximately 1M context window, and the strongest collation epistemics measured (stated methodology, caveated claims, compatibility flags). Accepted cost: approximately twice the extract-stage output tokens, lifting a 10-page session from ≈$0.06 to ≈$0.09. Users who prefer the leaner extractions can pin `minimax/minimax-m2.7` explicitly; upgrading users on the old default are migrated automatically (see the `DEFAULT_HISTORY` mechanism in `src/settings.ts`).

## Running And Extending

To benchmark new models:

```bash
npm run build
scripts/benchmark-models.sh <openrouter/model-id> [<openrouter/model-id> ...]
```

Protocol:

1. Include at least one already-recorded model in the same sitting (a repeatability anchor and a drift check against the recorded rows).
2. Interleave models rather than running them in blocks, so Sonar index drift lands evenly.
3. Two runs per model minimum; the recorded deltas that matter (verbosity, epistemic style, head-of-list stability) reproduce on the second run, while corpus-driven tail churn does not.
4. Append rows and findings to this file. Record the extension version and date; keep historical rows untouched.
5. For pure model effects, compare the same extraction file across runs that fetched the same URL (for example the dev.to roundups and adminlte.io appear in most baseline runs).

Artifacts land under `/tmp/intelli-bench-<stamp>/<label>/cwd/.search/<slug>/` with the full `report.md`, `meta.json`, per-page `extractions/`, and raw `sources/`. Copy anything worth keeping out of `/tmp` before it is reaped.
