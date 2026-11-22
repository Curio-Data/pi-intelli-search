# Scripts

Developer and operator tools for `intelli-search`: download charts, local usage analysis and generated host plugins. These scripts are not part of the published npm package.

## `plot-downloads.mts`

Renders the weekly npm download chart in `README.md` as a hand-drawn-style stacked Scalable Vector Graphics (SVG) image in light and dark themes, using [_rough.js_](https://roughjs.com). Each bar stacks the native extension's weekly downloads (lower segment) with the MCP server's (upper segment). Explicit seeds make rendering byte-identical for unchanged data and rendering inputs.

Run directly with [_Node.js_](https://nodejs.org/) 22.18 or later; type stripping requires no build step:

```bash
node scripts/plot-downloads.mts              # fetch new data, render SVGs
node scripts/plot-downloads.mts --offline    # render from cache, no network
npm run chart                                # same as the first command
```

### Inputs and Outputs

| Path | Role |
|---|---|
| `data/downloads.json` | Daily download cache, native package (committed) |
| `data/downloads-mcp.json` | Daily download cache, MCP package (committed) |
| `docs/images/downloads-light.svg` | Light-theme chart (committed) |
| `docs/images/downloads-dark.svg` | Dark-theme chart (committed) |

The script fetches the gap between the cache and the last complete day from the npm downloads application programming interface (API), so accumulated history does not require a query beyond the 18-month ceiling. The final three cached days are re-fetched on every run and overwrite their cached values, because npm computes a day's downloads shortly after UTC midnight and can revise recent days; without the trailing window a provisional value would be frozen by the cache. A weekly [_GitHub_](https://github.com) Action (`.github/workflows/downloads-chart.yml`) runs every Monday and commits only when the rendered output changes. Only complete Monday-to-Sunday weeks are drawn.

On 2026-10-13 the live API returned 612 downloads for the MCP package over 2026-10-05 through 2026-10-11. The operator reported approximately 300 on the `npmjs.com` package page; its reporting window and refresh basis were not captured, so these figures do not establish a difference in counting rules. The live service and committed caches also have distinct refresh times: caches can lag until the next refresh.

[npm's counting documentation](https://blog.npmjs.org/post/92574016600/numeric-precision-matters-how-npm-download-counts-work.html) describes the totals as naïve by design: every served package tarball counts, including automation and mirrors. Verification runs that fetch a published tarball from the registry (registry-pin plugin checks, registry installation gates) count toward release-week totals; local-tarball gates do not, because no registry tarball is served. Interpret bars as relative uptake, not unique-user counts.

### Deterministic Rendering

Every rough.js call passes an explicit integer `seed`. Unseeded calls redraw the scribble on every run, changing SVG files in Git even when the numbers are unchanged and defeating the workflow's commit-if-changed guard.

## `analyze-sessions.sh`

Parses local `Pi` host-session logs and the research cache. It requires no API keys or network access and computes results from the selected local inputs.

### Usage

```bash
scripts/analyze-sessions.sh                    # default (~/.pi/agent/sessions)
scripts/analyze-sessions.sh /path/to/sessions  # explicit session dir
PI_SESSIONS_DIR=/path scripts/analyze-sessions.sh
```

### Requirements

- `jq` (required)
- `fd` (preferred; falls back to `find`)
- `rg` is not required by this script

### Reported Metrics

| Section | Metric |
|---|---|
| 1 | Total tool calls by name, across selected host sessions |
| 2 | `intelli_*` breakdown and share of all tool calls |
| 3 | Per-project `intelli_*` usage (rolls up nested subagent sessions) |
| 4 | Adoption over time: monthly `intelli_*` and legacy `web_*` calls |
| 5 | Follow-up host sessions (2+ `intelli_research` calls) |
| 6 | Adoption rate: host sessions using any `intelli_*` tool |
| 7 | Cache re-reads: tool calls referencing a `.search/` path |
| 8 | Research-cache sizes per project (from `.index.json`) |
| 9 | Telemetry sidecars (`meta.json`): run outcomes, fetch and extraction totals, extraction-budget diagnostics, available extraction routes, degraded cache judges, fetch-variant winners, search retries and cache-suggest hits |
| 10 | Batch records (`batch-meta.json`): mode, size, outcomes, durations, page overlap and expansion merge statistics |

Section 10 groups expansion records by merge outcome. For attempted merges it gives the number of recorded observations and mean duration (milliseconds) and input size (characters); output size (characters of the accepted summary) is given for completed merges only, because a rejected or failed merge records `0` there whatever its candidates contained. Skipped merges have their own outcome count; they and records with no merge data do not contribute timing or size observations. A recorded zero counts; a missing field does not. Page overlap counts one record per entry position, and a file found under two overlapping search roots is read once.

Section 9 adds `truncatedExtractions`, `budgetExhaustedFailures` and `otherFailures` by summing the corresponding extraction fields across parsed sidecars. These count extractions, not runs. `runsRecordingProvider` counts sidecars with `stages.extract.provider`; `providers` groups those sidecars by their recorded extraction route, not by individual model call. Cache-judge degradation counts sidecars whose `stages.cacheSuggest.degraded` is `true`. Synthesis truncation and synthesis routes are not aggregated.

The script substitutes zero for absent numeric diagnostic fields. Older records, unreached stages and unavailable usage therefore contribute no recorded events, not proof that no failure or truncation occurred. Route labels are optional and cannot attribute every failed page to a provider. Interpret these totals over the selected sidecars, including numbered archives and failed-attempt sidecars under `attempts/`, rather than as an incidence rate for all research calls. Up to 0.22.0 a failed repeat overwrote the preserved report's sidecar; later versions keep both, so totals that span that change count different sets of records. See [Telemetry Sidecar](../docs/ARCHITECTURE.md#telemetry-sidecar) for field definitions.

### Environment

- `SEARCH_ROOTS` (optional): space-separated roots to scan for `.search/` caches. Defaults to `$HOME /srv /home`.

### Provenance

An early version of this script produced the historical headline numbers. A new run recomputes metrics over the selected logs and cache; mutable inputs and session-log inference limits prevent a claim of exact historical reproduction without a frozen input population.

## `generate-plugin-bundles.mjs`

Generates the [_Claude Code_](https://code.claude.com/docs/en/plugins), [_Codex_](https://developers.openai.com/codex/plugins) and [_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) bundles (`plugins/`) plus both repository marketplace catalogues (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) from `guidance/`, the templates in `scripts/templates/dsh/` and the version in `packages/mcp/package.json`. The dsh bundle is a publishable npm package (`plugins/dsh`, `@curio-data/dsh-intelli-search`) rather than a marketplace entry: dsh installs it directly by package name. Run the generator after a Model Context Protocol (MCP) package version change or guidance edit; never hand-edit generated files.

```bash
npm run generate:plugins   # rewrite the committed tree (registry launchers)
npm run check:plugins      # drift gate: committed tree must match generation
```

Pre-publication install tests use tarball mode. Generated launchers run a vendored installation of the packed tarball rather than the registry pin:

```bash
node scripts/generate-plugin-bundles.mjs --mode tarball \
  --output /path/to/scratch --codex-vendor-dir /path/to/scratch/plugins/codex/vendor
```

Codex and dsh perform no path expansion in plugin MCP configuration, so tarball mode embeds absolute vendor directories at generation time: Codex's from `--codex-vendor-dir`, and dsh's derived from `--output` as `/path/to/scratch/plugins/dsh/vendor` (install the packed tarball there before installing the bundle). Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` at launch.

The generated dsh payload is `package.json` (manifest version 1, exact MCP version pin, Node.js `>=24.9.0` floor, declared `engines.dsh` range; see [Compatibility](../docs/COMPATIBILITY.md#deepseek-harness-evidence-and-limits) for tested versions), `cordis.patch.yml` (bridge row with `serverName: intelli`, ten-minute call limit and the environment-layer key expression, plus the skill-registrar row), `index.js` (the registrar), `skills/intelli-search/SKILL.md`, `locale/en.json` and `locale/zh.json`, `icon.svg`, `README.md` and `LICENSE`. A tarball-mode manifest additionally lists `vendor/**` so a local installation retains the vendored server; the registry manifest omits it.

This command generates bundles only; it does not build, pack, vendor-install or install them into a host.

The tested full installation flow is [`test/e2e/12_plugin_bundles.sh`](../test/e2e/12_plugin_bundles.sh): build and pack the MCP workspace, generate local bundles, install the tarball into both vendor directories, then install the marketplaces into isolated host profiles and check connection and skill discovery. It uses dummy credentials, not a copied operator credential store. Set `TMPDIR` beneath the repository's gitignored `.tmp/` on encrypted hosts before running it. Credentialed research is a separate check in scenarios 13 and 14; see [Compatibility](../docs/COMPATIBILITY.md#host-plugins) for evidence classes and limits.

The dsh host flow is [`test/e2e/18_dsh_plugin.sh`](../test/e2e/18_dsh_plugin.sh): it is credential-free, making no provider call, and verifies the local-tarball bundle on an isolated dsh host through installation, exact tool registration, skill loading, dummy credential delivery, both workspace guards, and removal plus reinstallation. It requires a host within the bundle's declared range and an isolated pnpm, prepared as described in [Environment and Isolation](../docs/plans/dsh-host/PLAN.md#environment-and-isolation), with `DSH_BIN` and the pnpm `PATH` exported before either suite runner starts; both runners fail the suite when it skips.

[`test/e2e/19_dsh_credentialed.sh`](../test/e2e/19_dsh_credentialed.sh) is an opt-in live check, not part of either suite runner. Obtain approval for two searches and one three-page research request before each run. With Node.js 24.9 or later (tested on 24.19.0) and isolated pnpm on `PATH`, set `DSH_BIN` to the isolated `0.2.2-rc.1` host and run `S19_APPROVED=yes ./test/e2e/19_dsh_credentialed.sh`. It reads only `DEEPSEEK_API_KEY` (host model) and `OPENROUTER_API_KEY` (pipeline) from the private `.env` at the root of the tree containing the script. It ignores inherited values of both variables. Each fresh headless session gets one permitted operation. The script checks both credential routes and the completed report under the isolated launch project. It stops on failure without a paid retry. Evidence promotion is manual. Keep raw sessions private in repository scratch. The main checkout's `evidence/2026-11-22-dsh-host/verification-receipt.md` names the retained files. Scan the selected summaries, sidecar and inventory for both actual keys without printing them, then copy only those files and verify their SHA-256 checksums.

## `generate-tlds.mjs`

Refreshes the ASCII delegated top-level domain set in `src/core/tlds.ts`, which the research search stage uses to reject filenames and identifiers that look like protocol-less domains. The script reads a downloaded copy of the [_Internet Assigned Numbers Authority_ (IANA)](https://www.iana.org/domains/root) root zone list and makes no network request:

```bash
curl -sS -o .tmp/tlds.txt https://data.iana.org/TLD/tlds-alpha-by-domain.txt
node scripts/generate-tlds.mjs .tmp/tlds.txt          # rewrite the set
node scripts/generate-tlds.mjs --check .tmp/tlds.txt  # exit 1 on drift
```

It rewrites only the version line and the delegated-TLD literal. The `FILE_EXTENSION_TLDS` policy in the same file is maintained by hand and must stay a subset of the delegated set, which `test/util.test.ts` checks. Run the check before a release.

## `spike-super-collation.mjs`

Phase 0 spike for the batch research proposal (`docs/proposals/BATCH-RESEARCH.md`). It reads two or more cached research folders, renumbers each report's `[S<n>]` source identifiers into one series deduplicated by URL, and sends the summaries to the collation model in one call. It writes `input.json`, `output.md` and `metrics.json` (size, usage, duration, route and a citation audit) to the output directory. It makes one live OpenRouter call per run and is never run by the test suite.

```bash
node scripts/spike-super-collation.mjs --out evidence/agents/<run>/run-1 \
  .search/<folder-a> .search/<folder-b> .search/<folder-c>
```

`--model` (default `minimax/minimax-m3`) and `--max-tokens` (default 16000) override the call. The key comes from `OPENROUTER_API_KEY` or the `openrouter` entry of `auth.json` in `PI_CODING_AGENT_DIR` (default `~/.pi/agent/`), and is never printed. Reports written before source identifiers were introduced have no source table and are rejected. The citation audit is a historical heuristic: it counts standalone `[S<n>]` groups only, and the renumbering also rewrites a bare `S<n>` such as "Amazon S3" when that identifier exists. The shipped merge uses the stricter rules in `src/core/operations/batch-merge.ts`.

## Live E2E Runs

[`test/run-e2e-all.sh`](../test/run-e2e-all.sh) runs the live suite. Unless `E2E_SKIP_BUILD=1`, it builds both packages once. In the default parallel mode it starts every scenario at once, each with its own `TMPDIR` and log under `$TMPDIR/run-<timestamp>-<pid>/`, and the summary prints each scenario's outcome and the last lines of every failing log. Sequential mode runs one scenario at a time in the shared `TMPDIR` and streams its output to the terminal, writing no suite log. `TMPDIR` defaults to the repository's `.tmp/e2e/` when unset or empty; on an encrypted host, leave it unset or point it under the repository's `.tmp/`.

```bash
./test/run-e2e-all.sh                          # parallel (default)
E2E_RUN_MODE=sequential ./test/run-e2e-all.sh  # one at a time, E2E_GAP_SECONDS apart
```

| Variable | Default | Effect |
|---|---|---|
| `E2E_RUN_MODE` | `parallel` | `sequential` runs the scripts one at a time and streams their output |
| `E2E_GAP_SECONDS` | `20` | Gap between scripts in sequential mode |
| `E2E_SCRIPT_TIMEOUT_SECONDS` | `1200` | Limit for each script except `10_config_recipes.sh`; exit `124` is reported as a timeout. In parallel mode the timeout also stops the script's `pi`, `claude` and `codex` processes |
| `E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS` | `2400` | Limit for `10_config_recipes.sh`, with the same timeout handling as `E2E_SCRIPT_TIMEOUT_SECONDS` |
| `E2E_SKIP_BUILD` | unset | `1` uses existing builds; the runner sets it for every scenario after its own build |
| `E2E_RECIPE_TIMEOUT_SECONDS` | `600` | Limit for each attempt in `10_config_recipes.sh`, through `pi` or the direct tool driver; a recipe makes up to three attempts |
| `E2E_RETRY_GAP_SECONDS` | `5` | Pause before a scenario retries an attempt that left no completed sidecar (scenarios 01 to 11 and 15) or no completed turn (scenario 14) |

Scenario 10 has its own limit because one recipe that needs all three 600-second attempts, with the 5-second `E2E_RETRY_GAP_SECONDS` pause between attempts, runs for ≈1,810 seconds; the recipes run concurrently, so that is also the scenario's longest expected run. The 2026-11-09 evidence (`evidence/agents/2026-11-09-post-release/`) recommends 2,400 seconds. The other scripts keep 1,200 seconds so that a hung scenario fails promptly. When scenario 10 reports `TIMED OUT`, raise `E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS` or lower `E2E_RECIPE_TIMEOUT_SECONDS`. The traced runner below applies the same two limits.

Use sequential mode where an account meets OpenRouter's 402 in-flight spending limit, or to watch one scenario's output as it runs. It serialises scenario scripts only. Within a script, scenario 10 still runs its five recipes concurrently, scenarios 02, 05 and 06 run their two cases or arms concurrently, and scenario 13 runs its four sessions concurrently. A scenario run by hand alongside others needs `E2E_SKIP_BUILD=1` after a single `npm run build:all`, or scenarios 11 to 14 rebuild the standalone bundle while another loads it.

### Traced Evidence Runs

[`test/run-e2e-parallel.sh`](../test/run-e2e-parallel.sh) runs scenarios 01 to 12 and 15 to 17 with tracing, for investigating what limits or breaks live runs. Run `npm run build:all` first. Each scenario gets an isolated `HOME`, XDG directories, npm cache and trace directory under `.tmp/e2e-evidence/<run>/`, and the run records the key's account state (limit, usage, free-tier flag) at start and end without the key itself.

```bash
npm run build:all
./test/run-e2e-parallel.sh
E2E_RUN_MODE=sequential ./test/run-e2e-parallel.sh
node test/e2e/analyze-evidence.mjs .tmp/e2e-evidence/<run>
```

A harness-only `Pi` extension (`test/e2e/trace-extension.mjs`) records each extension model call by stage, with its HTTP status, selected rate-limit headers, stop reason and latency, and each agent-loop response separately. A global fetch tracer (`test/e2e/trace-fetch.mjs`) covers the standalone MCP transport; native `pi-ai` calls do not pass through global `fetch`. The analyser writes `analysis.json` into the run directory with status counts, stop reasons, retry notices and research arguments, and copies no prompts, completions or credentials. It reads every `.jsonl` file under each scenario's `pi-traces/` directory, including the per-recipe subdirectories that scenario 10 writes.

On native paths `pi-ai` reports a response status only after a request succeeds, so a 429 or 402 appears as an error stop reason, not in the status counts. Read both before concluding that no rate limit occurred. Promote any run cited as evidence from `.tmp/` into `evidence/` first. Inspect the files before copying them: raw `pi-traces/` files hold conversation and tool-result content, and an interrupted scenario can leave a test profile holding an API key under its temporary directory. Exclude credential files from the copy, and record which files were retained so that a citation does not imply the whole run directory was kept.

## Claude Tool Routing

[`test/e2e/13_claude_code_plugin.sh`](../test/e2e/13_claude_code_plugin.sh) evaluates tool selection in four fresh Claude Code sessions against the generated local-tarball plugin. It distinguishes installation and skill discovery from successful skill invocation before an operation. Both search and research remain available. Prompts refer to the installed web research plugin without naming either operation; only the explicit-loading case names the skill.

| Case | Question | Skill State | Expected Operation |
|---|---|---|---|
| `descriptions-only` | Latest Model Release | Disabled with `--disable-slash-commands` | Search without skill guidance |
| `factual-auto` | Latest Model Release | Available, no explicit loading request | Skill invocation, then search |
| `factual-explicit` | Latest Package Release | Explicit loading request | Skill invocation, then search |
| `comparison-auto` | Detailed Comparison | Available, no explicit loading request | Skill invocation, then research with an extraction focus and page budget |

The factual cases allow at most two search calls and reject other plugin operations. The comparison case allows one or more research calls. The automated checks do not establish whether a follow-up query is narrower or addresses missing evidence; inspect the retained transcript to assess that distinction. The checks require successful model-visible answers, sources for search, and completed workspace artefacts for research. The sessions remove `Bash` from the tool set and pre-approve `Read`, `Glob` and `Grep` for local cache inspection. This isolates routing from `Bash` permissions and blocks direct `Bash`-based web substitution, but does not represent a host with an unrestricted shell. Other host tools remain exposed; the verifier does not exclude every indirect command or delegation route. Direct built-in web calls and all permission denials remain failures. Each result records the actual model, operation count, skill discovery and invocation, use of `ToolSearch`, and session duration. These are behavioural observations, not guarantees across models or host versions. The explicit-loading case does not measure automatic skill selection.

Run with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` and an OpenRouter key, using the credential setup documented in the repository agent guide. The script parses the gitignored `.env`; it never copies the operator's login credentials. On Linux it requires [_bubblewrap_](https://github.com/containers/bubblewrap) (`bwrap`) with working user namespaces. Each Claude invocation has access to the prepared scratch tree, system files and the selected executables, not the operator's home. A probe checks that boundary before the first authenticated call. Select a model and retain traces with:

```bash
E2E_CLAUDE_MODEL='claude-opus-5-5[1m]' \
E2E_KEEP_ARTIFACTS=1 \
  ./test/e2e/13_claude_code_plugin.sh
```

This consumes live provider quota. The four sessions run at once in the shared isolated profile, each in its own workspace, and are verified afterwards in a fixed order. Factual sessions have an `E2E_TIMEOUT_SECONDS` deadline (default `180`); deep analysis has a separate `E2E_RESEARCH_TIMEOUT_SECONDS` deadline (default `540`) to allow follow-up research. Pass the research deadline through the caller's environment; the scripts do not load it from `.env`. Because the sessions run together, the scenario is bounded by the longest deadline (`540` seconds by default) plus build and installation, within the suite runner's `1200`-second per-script limit. Increase `E2E_SCRIPT_TIMEOUT_SECONDS` when raising the research deadline or allowing more installation time. Retained runs live under `.tmp/intelli-claude-e2e-*`; the plugin credential file is removed even on failure. The launcher uses an absolute vendored entrypoint, avoiding local workspace binary resolution through `npx`. Do not treat an interactive session opened in this development repository as evidence of the published package without checking its running entrypoint.

The server sends routing and skill-loading guidance in its MCP `instructions` field as well as its tool descriptions. Claude Code [documents server instructions as context used for tool discovery](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search). With tool search enabled, names and server instructions load at session start; full definitions, including descriptions, load on demand. The `descriptions-only` case disables skills, not tool search, and does not isolate the influence of descriptions from server instructions. These instructions guide the model; they do not enforce skill loading. Deterministic protocol tests check that the server transmits them, while the live scenario checks the model's actions. The routing change leaves native `Pi` tool descriptions unchanged. The subsequent shared provenance correction changes the collation prompt, report prose and `searchSummary` description; callable parameters remain unchanged. A routing review recorded reviewer dispositions, the failed permission check, the corrected live run and a deferred source-provenance finding.

## Codex Credential Recovery

[`test/e2e/14_codex_plugin.sh`](../test/e2e/14_codex_plugin.sh) installs the generated local-tarball Codex plugin into a dedicated profile. Its first real session has no configuration, workspace or credential exports and must reach the search tool's missing-credential guidance. The script then runs the vendored `setup` command with the OpenRouter key on standard input, unsets those variables and completes research through a second real session launched with `codex exec --cd` from a different directory and a non-default `XDG_CONFIG_HOME`. It also checks that the cache lands in the selected working root and that the recorded modification time of the operator's Codex login file is unchanged.
