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
| 9 | Telemetry sidecars (`meta.json`, v0.11.0+): per-stage success rates, fetch-variant winners summed across sidecars, search retries and cache-suggest hits |

### Environment

- `SEARCH_ROOTS` (optional): space-separated roots to scan for `.search/` caches. Defaults to `$HOME /srv /home`.

### Provenance

An early version of this script produced the historical headline numbers. A new run recomputes metrics over the selected logs and cache; mutable inputs and session-log inference limits prevent a claim of exact historical reproduction without a frozen input population.

## `generate-plugin-bundles.mjs`

Generates the [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) bundles (`plugins/`) and both repository marketplace catalogues (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) from `guidance/` and the version in `packages/mcp/package.json`. Run it after a Model Context Protocol (MCP) package version change or guidance edit; never hand-edit generated files.

```bash
npm run generate:plugins   # rewrite the committed tree (registry launchers)
npm run check:plugins      # drift gate: committed tree must match generation
```

Pre-publication install tests use tarball mode. Generated launchers run a vendored installation of the packed tarball rather than the registry pin:

```bash
node scripts/generate-plugin-bundles.mjs --mode tarball \
  --output /path/to/scratch --codex-vendor-dir /path/to/scratch/plugins/codex/vendor
```

This command generates bundles only; it does not build, pack, vendor-install or install them into a host. Codex performs no path expansion in plugin MCP configuration, so tarball mode requires the absolute vendor directory at generation time. Claude Code resolves `${CLAUDE_PLUGIN_ROOT}` at launch.

The tested full installation flow is [`test/e2e/12_plugin_bundles.sh`](../test/e2e/12_plugin_bundles.sh): build and pack the MCP workspace, generate local bundles, install the tarball into both vendor directories, then install the marketplaces into isolated host profiles and check connection and skill discovery. It uses dummy credentials, not a copied operator credential store. Set `TMPDIR` beneath the repository's gitignored `.tmp/` on encrypted hosts before running it. Credentialed research is a separate check in scenarios 13 and 14; see [Compatibility](../docs/COMPATIBILITY.md#host-plugins) for evidence classes and limits.

## Claude Tool Routing

[`test/e2e/13_claude_code_plugin.sh`](../test/e2e/13_claude_code_plugin.sh) evaluates tool selection in four fresh Claude Code sessions against the generated local-tarball plugin. It distinguishes installation and skill discovery from successful skill invocation before an operation. Both search and research remain available. Prompts refer to the installed web research plugin without naming either operation; only the explicit-loading case names the skill.

| Case | Question | Skill State | Expected Operation |
|---|---|---|---|
| `descriptions-only` | Latest Model Release | Disabled with `--disable-slash-commands` | Search without skill guidance |
| `factual-auto` | Latest Model Release | Available, no explicit loading request | Skill invocation, then search |
| `factual-explicit` | Latest Package Release | Explicit loading request | Skill invocation, then search |
| `comparison-auto` | Detailed Comparison | Available, no explicit loading request | Skill invocation, then research with an extraction focus and page budget |

The factual cases allow at most two search calls and reject other plugin operations. The comparison case allows one or more research calls. The automated checks do not establish whether a follow-up query is narrower or addresses missing evidence; inspect the retained transcript to assess that distinction. The checks require successful model-visible answers, sources for search, and completed workspace artefacts for research. The sessions remove `Bash` from the tool set and pre-approve `Read`, `Glob` and `Grep` for local cache inspection. This isolates routing from `Bash` permissions and blocks direct `Bash`-based web substitution, but does not represent a host with an unrestricted shell. Other host tools remain exposed; the verifier does not exclude every indirect command or delegation route. Direct built-in web calls and all permission denials remain failures. Each result records the actual model, operation count, skill discovery and invocation, use of `ToolSearch`, and session duration. These are behavioural observations, not guarantees across models or host versions. The explicit-loading case does not measure automatic skill selection.

Run with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` and an OpenRouter key, using the credential setup documented in the repository agent guide. The script parses the gitignored `.env`; it never copies the operator's login credentials. Select a model and retain traces with:

```bash
E2E_CLAUDE_MODEL='claude-opus-5-5[1m]' \
E2E_KEEP_ARTIFACTS=1 \
  ./test/e2e/13_claude_code_plugin.sh
```

This consumes live provider quota and spaces the sessions by `E2E_RUN_GAP_SECONDS` (default `20`). Factual sessions have an `E2E_TIMEOUT_SECONDS` deadline (default `180`); deep analysis has a separate `E2E_RESEARCH_TIMEOUT_SECONDS` deadline (default `540`) to allow follow-up research. Pass the research deadline through the caller's environment; the scripts do not load it from `.env`. The default session deadlines and gaps total `1140` seconds before build and installation, close to the paced runner's `1200`-second per-script limit. Increase `E2E_SCRIPT_TIMEOUT_SECONDS` when increasing session deadlines or allowing more installation time. Retained runs live under `.tmp/intelli-claude-e2e-*`; the plugin credential file is removed even on failure. The launcher uses an absolute vendored entrypoint, avoiding local workspace binary resolution through `npx`. Do not treat an interactive session opened in this development repository as evidence of the published package without checking its running entrypoint.

The server sends routing and skill-loading guidance in its MCP `instructions` field as well as its tool descriptions. Claude Code [documents server instructions as context used for tool discovery](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search). With tool search enabled, names and server instructions load at session start; full definitions, including descriptions, load on demand. The `descriptions-only` case disables skills, not tool search, and does not isolate the influence of descriptions from server instructions. These instructions guide the model; they do not enforce skill loading. Deterministic protocol tests check that the server transmits them, while the live scenario checks the model's actions. The routing change leaves native `Pi` tool descriptions unchanged. The subsequent shared provenance correction changes the collation prompt, report prose and `searchSummary` description; callable parameters remain unchanged. The host-only routing review evidence (`evidence/2026-10-07-mcp-routing-review.md`) records reviewer dispositions, the failed permission check, the corrected live run and a deferred source-provenance finding.
