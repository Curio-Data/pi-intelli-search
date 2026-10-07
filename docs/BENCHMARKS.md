# Model Benchmarks

This document records the extract/collate model benchmark for `intelli-search`: the methodology, the harness, the measured results, and the decisions taken from them. It exists so that future model comparisons are reproducible and comparable with the numbers already recorded here. The harness measures the native `Pi` adapter through a live agent loop, not Model Context Protocol (MCP) transport latency. Baseline run 1A was a direct native tool call rather than a headless loop run.

Benchmark numbers are canonical to this file. When a new model is benchmarked, append its runs here rather than editing historical rows.

## Purpose

The extract and collate stages dominate per-run cost and determine report quality. Choosing a model trades off extraction verbosity, collation evidence handling (stated ranking methodology, caveats for low-evidence claims and compatibility warnings), latency, and price. The benchmark runs the identical research request through competing models and records what changes.

## Methodology

### Harness

Before running, set `BENCH_BASE_DIR` to a directory on encrypted storage: the harness writes an `auth.json` containing provider credentials into each run's agent directory. Its default base is `/tmp/intelli-bench-<stamp>`, which is not suitable for confidential scratch.

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

The agent-loop model is pinned per benchmark series (default: `kimi-coding/k3` when its key exists, overridable via `BENCH_LOOP_MODEL`); only the pipeline's extract/collate models vary. The 2026-09-07 baseline series ran with `google/gemini-3.8-flash` as the loop model.

### Fixed Stimulus

The default query, `focusPrompt`, and `maxUrls` equal the 2026-09-07 baseline, pinned in the script. Changing them (via `BENCH_QUERY`, `BENCH_FOCUS`, `BENCH_MAX_URLS`) starts a new comparison series; record that change in the results table.

### Parameter Fidelity

The headless agent, not the harness, composes the tool call. Two checks verify fidelity:

- **Query:** the cache directory slug is derived from the query hash. An identical query string produces an identical slug; all baseline runs share the slug `2026-09-07-top-10-most-popular-svelte-42d696`, and `query.txt` must equal the pinned query.
- **`focusPrompt`:** not cryptographically verifiable from artefacts. The prompt pins it verbatim and every extraction's content should reflect its terms (popularity metrics, star counts, Svelte 5 relevance). Treat focus fidelity as strong-but-inferred.

### Confounds and Limitations

- **Search Nondeterminism:** The search stage is a live Sonar call; identical queries return different link sets run to run. Corpus quality differences are entangled with model differences. Match the full source URL (uniform resource locator) in the captured headers before comparing extractions, then verify identical captured input content before attributing differences solely to the model. Numbered files encode position and hostname, not the full URL (`src/core/cache.ts`). A shared URL alone supports a same-source comparison with remaining content confounds.
- **Agent-Loop Fidelity:** Verify query fidelity through the cache slug and `query.txt`, not the loop's self-report or exit status. During the 2026-09-07 series (extension builds 0.13.0 and 0.14.0), print-mode runs emitted `functions.intelli_research:0{...}` as prose instead of a native tool-call block, exited 0 and never ran the pipeline. The exact `Pi` version for that incident is not recorded here; this is a historical diagnosis, not a claim about current hosts.
  - **Recorded Streaming Diagnosis:** The incident record attributes the leak to loss of the `zaiToolStream` compatibility flag for zai glm models on catalogue restore and `models.json` round-trip paths. It records a 4-hour remote-catalogue refresh interval and extension-triggered refreshes, and a reproduction with a catalogue-cache restore (257K bytes) without the extension loaded. `kimi-coding/k3` avoided that observed flag-loss failure; this does not establish immunity to other loop failures.
  - **Recorded Startup Diagnosis:** A `models.json` providers block caused slash-form `defaultModel` resolution to select an OpenRouter fallback. The harness uses split `defaultProvider` and `defaultModel` settings, prefers `kimi-coding/k3` when its key exists, and retries exit-0 runs without a cache entry. The configuration-recipes runner also applies the retry guard.
- **Run Adjacency:** Back-to-back runs share more links than runs hours apart; Sonar's index drifts on an hours scale. Interleave models (A, B, A, B) rather than blocking them when comparing more than two.
- **Task Scope:** Results are for the Svelte user interface (UI) libraries query; other domains may rank differently.
- **Cache Suggest:** The judge runs only with a populated cache index. Fresh benchmark working directories have no prior entries, so the stage makes no judge call in these runs.
- **Live Quota:** Each run costs real OpenRouter credit (see the cost table in [README](../README.md)).

## Recorded Results

`Extract In`, `Extract Out`, `Per Page` and `Collate Out` are character counts, with `K` denoting thousands, not tokens. The harness prints `stages.extract.totalInputCharsApprox`, `totalOutputChars` and `stages.collate.summaryChars`. Input counts sum truncated page content and exclude prompt wrappers, so they are lower bounds on complete request input. The current harness does not compute `Per Page`; the historical averaging denominator is not recorded and cannot be verified from that script. Preserve those recorded averages without assuming that requested, fetched and successfully extracted page counts are interchangeable. For new runs, record the denominator explicitly; output characters per successful extraction is `totalOutputChars / stages.extract.succeeded`.

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

2026-09-07 evening, extension build 0.14.0, after the print-mode tool-call leak was root-caused and the harness fixed (see [Confounds and Limitations](#confounds-and-limitations)). Loop model: `kimi-coding/k3`.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 4B | minimax-m3 | 58.1s | 7/1 | 55.2K | 28.2K | 4.0K | 7.3K |

Run 4B's cache slug matched the baseline series exactly, and the report opened by stating its ranking methodology and the primacy of GitHub stars, matching the recorded m3 evidence-handling pattern. Per-page extraction output (4.0K over 7 pages) sits just under the recorded m3 band (4.7K to 5.3K) on a smaller corpus (55.2K input versus 92K to 104K baseline).

### Late Series

2026-09-07 late evening, extension build 0.14.0, loop model `kimi-coding/k3`, after an OpenRouter credit top-up. Runs interleaved m3, gemini, m3, gemini. One print-mode leak retry fired (5B, attempt 1) and recovered on attempt 2: the first live proof of the harness retry guard.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 5B | minimax-m3 | 63.4s | 7/1 | 139.3K | 40.1K | 5.7K | 10.9K |
| 3A | gemini-3.8-flash | 41.2s | 7/1 | 139.6K | 22.9K | 3.3K | 7.8K |
| 6B | minimax-m3 | 49.1s | 7/1 | 139.6K | 34.6K | 4.9K | 7.5K |
| 4A | gemini-3.8-flash | 34.8s | 7/1 | 55.2K | 20.5K | 2.9K | 6.2K |

Late-series findings:

1. **Verbosity and Evidence Handling on Shared Sources:** Runs 5B, 3A and 6B fetched the same seven sources (139.3K to 139.6K input). On that same-URL corpus, whose captured-content identity is not established here, m3 wrote 5.7K and 4.9K per page against gemini's 3.3K, and only the m3 reports opened by stating their evidence base ("across five independent sources..."). The same-URL extraction of dev.to records an output difference, not an isolated model effect without content verification: 6.7K (m3) versus 4.2K (gemini).
2. **Latency and Output Association:** gemini completed in 41.2s and 34.8s against m3's 63.4s and 49.1s, alongside m3 writing 1.5 to 1.7 times gemini's extraction characters. This series does not isolate verbosity as the cause of the latency difference.
3. **Leading Ranks:** shadcn-svelte ranked first in 5B, 3A and 6B (the converged corpus) and second in 4A, whose 55.2K input matched the prior evening's 4B fetch exactly. 4A alone promoted daisyUI (framework-agnostic, 40,000+ stars) to first. Skeleton UI held the top three in all four runs.
4. **Recorded Decision:** Two more runs per model support the v0.14.0 preference for m3's methodology-first collation and transparent low-evidence handling within this task. m3 wrote 1.5 to 1.7 times gemini's extraction characters and took longer in this series. The ≈1M-token window is an advertised figure; this series did not measure it.

### New-Model Series

2026-09-07 late night, extension build 0.14.0, loop model `kimi-coding/k3`. Interleaved order: m3 anchor, qwen, glm-flash, deepseek, qwen, glm-flash, deepseek. None of the requested `:nitro` routing variants are published on OpenRouter (verified against the models endpoint); the base ids were benchmarked.

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 7B | minimax-m3 (anchor) | 195.5s | 6/2 | 80.8K | 26.8K | 4.5K | 12.6K |
| 1Q | qwen3.6-35b-a3b | 83.6s | 7/1 | 86.5K | 22.9K | 3.3K | 5.8K |
| 1G | glm-5.3-flash | 78.1s | 7/1 | 55.2K | 19.3K | 2.8K | 7.4K |
| 1D | deepseek-v4-flash | 284.3s | 6/2 | 42.5K | 18.6K | 3.1K | 5.6K |
| 2Q | qwen3.6-35b-a3b | 89.6s | 7/1 | 131.3K | 18.8K | 2.7K | 0.9K |
| 2G | glm-5.3-flash | 103.8s | 7/1 | 55.2K | 18.3K | 2.6K | 5.8K |
| 2D | deepseek-v4-flash | 147.1s | 6/2 | 84.4K | 21.5K | 3.6K | 5.8K |

New-model findings:

1. **Extraction Volume:** All three models returned per-page character counts in gemini's band (2.6K to 3.6K), below m3's 4.5K to 5.7K. Pricing is also far below m3's $0.30/M input and $1.20/M output: glm-5.3-flash $0.10/M input and $0.25/M output, deepseek-v4-flash ≈$0.09/M and $0.18/M, qwen3.6-35b-a3b $0.10/M and $0.90/M.
2. **Collation Length and Completeness:** glm-5.3-flash returned 7.4K and 5.8K characters; deepseek-v4-flash returned 5.6K and 5.8K with less detail in the recorded assessment; qwen3.6-35b-a3b produced two different lengths: 5.8K in run 1Q, then 0.9K in 2Q with the fifth entry truncated mid-sentence (the Melt UI entry ends at its heading). Unreliable summary length is a disqualifying property for a default collate model.
3. **Evidence Handling:** glm-5.3-flash stated its evidence base and cited the cache path (the m3 signature, and the only new model to do so); qwen stated its popularity criteria both runs; deepseek produced a sources-cited ranking table but no stated methodology.
4. **Latency:** qwen completed in 83.6s to 89.6s and glm-5.3-flash in 78.1s to 103.8s; deepseek-v4-flash took 147.1s to 284.3s in this series. The m3 anchor itself ran 195.5s, ≈3× its late-series durations, so within-sitting comparisons only; provider routing variance dominates absolute latency.
5. **Later Runs:** The Queued-Model Series below ran later the same night (`openai/gpt-oss-120b`, `openai/gpt-5.6-luna-pro`); no `:nitro` variants are published, so base ids are used throughout.
6. **Default Recommendation:** glm-5.3-flash is the strongest budget candidate (m3-style evidence handling at ≈ a quarter of the per-token price with a 1.3M context), but m3 keeps the depth advantage and the recorded default.

### Queued-Model Series

2026-09-07 late night, extension build 0.14.0, loop model `kimi-coding/k3`. Interleaved order: m3 anchor, oss-120b, luna-pro, oss-120b, luna-pro. The two models deferred from the New-Model Series; base ids (no `:nitro` variants published).

| Run | Extract/Collate Model | Duration | Fetch Ok/Fail | Extract In | Extract Out | Per Page | Collate Out |
|-----|-----------------------|----------|---------------|------------|-------------|----------|-------------|
| 8B | minimax-m3 (anchor) | 52.5s | 6/2 | 79.4K | 25.5K | 4.3K | 7.4K |
| 1O | gpt-oss-120b | 118.0s | 6/2 | 79.4K | 30.6K | 5.1K | 9.1K |
| 1L | gpt-5.6-luna-pro | 67.4s | 6/2 | 79.4K | 31.6K | 5.3K | 7.3K |
| 2O | gpt-oss-120b | 237.7s | 7/1 | 113.5K | 29.8K | 4.3K | 9.0K |
| 2L | gpt-5.6-luna-pro | 63.7s | 5/3 | 77.9K | 26.8K | 5.4K | 7.4K |

Queued-model findings:

1. **Context Headroom:** The context window was not the binding constraint for gpt-oss-120b (131K). The per-page extract architecture keeps stage inputs small: the largest single page was 32K chars (≈8K tokens) and collation input stayed near 8K tokens, far below the 131K window. This series therefore provides no direct evidence for requiring more than 512K context under default settings; that preference rests on headroom (user-raised `extractMaxChars`, `maxUrls` toward 20 with verbose extractors, llms-full.txt-scale pages). Demonstrating a context ceiling requires a dedicated stress run.
2. **`gpt-oss-120b` Reliability:** Both reports opened by naming sources and a conflict-resolution policy, but the ranking table carried figures no source reports (13k stars and 150k weekly downloads for shadcn-svelte against the sourced ≈8.4k), and both runs produced near-empty extractions for at least one page (629, 951, and 1186 chars). Latency was second slowest measured (118.0s and 237.7s). Rejected on reliability and precision.
3. **`gpt-5.6-luna-pro` Assessment:** This was the strongest premium alternative in the recorded assessment of output consistency and evidence handling. Runs took 63.7s and 67.4s, with substantial and consistent per-page extraction (5.3K and 5.4K), consistent collation length (7.3K and 7.4K), priced at m3's level ($0.20/M input, $1.20/M output, 1.05M context). It opened with a cache-path source listing rather than a methodology statement, so m3 keeps the recorded evidence-handling advantage.
4. **Default Decision:** m3 remains extract/collate default.

<a id="findings"></a>
### Baseline Findings

These findings describe runs 1A, 2A, 1B, 2B and 3C only, not the later series.

1. **Leading Ranks:** shadcn-svelte at #1 and Skeleton UI at #2 in all five runs, across three models and five corpora. Flowbite Svelte held top-5 in all five runs.
2. **Corpus Association for Ranks 3 to 10:** The two runs with the most-converged corpora (2A and 2B: different models, adjacent in time, four shared sources) produced identical top-10 lists in identical order, while same-model runs with divergent corpora swapped up to three tail entries. Captured inputs were not matched across these runs, so this is an observed association rather than a controlled isolation of corpus effects.
3. **Shared Sources:** Sonar returned the same three URLs in every baseline run (`adminlte.io`, a persistently `404`-returning `annauniversityplus.com` page, and an unrelated portfolio page that every run correctly identified and discarded). The remaining five slots churned run to run.
4. **Evidence Handling Repeated in the Baseline:** minimax-m3 opened both of its reports by stating its ranking methodology and the absence of authoritative npm statistics (2/2), surfaced low-star libraries (Kampsy-ui at 260 stars) transparently, and flagged Svelte 5 compatibility warnings. gemini-3.8-flash (0/2) and minimax-m2.7 (0/1) stated no methodology and silently dropped or omitted low-data entries.
5. **Within-Benchmark Verbosity:** Per-page extraction output: m2.7 ≈2.7K chars, gemini-3.8-flash ≈3.1K to 4.0K, m3 ≈4.7K to 5.3K, with m3 writing ≈2× m2.7's extraction output at the same per-token price. Five runs establish repeatability within this benchmark, not a controlled model property.

### Decision Recorded

v0.14.0 changed the default extract/collate model from `openrouter/minimax/minimax-m2.7` to `openrouter/minimax/minimax-m3`. Rationale: identical per-token pricing, an ≈1M context window, and the strongest collation evidence handling measured in the baseline (stated methodology, caveated claims, compatibility flags). Recorded cost estimate: doubled extract-stage output-token usage, lifting a 10-page research run from ≈$0.06 to ≈$0.09. The tables measure ≈2× extraction characters, not tokens; they do not independently verify that token multiplier. Selecting `minimax/minimax-m2.7` requests leaner extractions, but an explicit selection matching the upgrading version's historical default remains eligible for match-based migration. Explicit selection is not a migration opt-out (see `DEFAULT_HISTORY` and `migrateDefaults()` in `src/settings.ts`).

## Running and Extending

To benchmark new models:

```bash
npm run build
scripts/benchmark-models.sh <openrouter/model-id> [<openrouter/model-id> ...]
```

Protocol:

1. Include at least one already-recorded model in the same sitting (a repeatability anchor and a drift check against the recorded rows).
2. Interleave models rather than running them in blocks, so Sonar index drift lands evenly.
3. Two runs per model minimum; the recorded deltas that matter (verbosity, evidence handling, head-of-list stability) reproduce on the second run, while corpus-driven tail churn does not.
4. Append rows and findings to this file. Record the extension version and date; keep historical rows untouched.
5. Match full source URLs across runs (for example the dev.to roundups and adminlte.io appear in most baseline runs). Verify identical captured input content before treating extraction differences as pure model effects; file numbers and hostnames alone do not establish a match.

Artefacts land under `<base>/<label>/cwd/.search/<slug>/` with the full `report.md`, `meta.json`, per-page `extractions/`, and raw `sources/`. Use the encrypted `BENCH_BASE_DIR` selected before running. Copy anything worth keeping out of the base directory before it is reaped.
