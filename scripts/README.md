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
| `data/downloads.json` | Append-only daily download cache, native package (committed) |
| `data/downloads-mcp.json` | Append-only daily download cache, MCP package (committed) |
| `docs/images/downloads-light.svg` | Light-theme chart (committed) |
| `docs/images/downloads-dark.svg` | Dark-theme chart (committed) |

The script fetches only the gap between the cache and the last complete day from the npm downloads application programming interface (API), so accumulated history does not require a query beyond the 18-month ceiling. A weekly [_GitHub_](https://github.com) Action (`.github/workflows/downloads-chart.yml`) runs every Monday and commits only when the rendered output changes.

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
