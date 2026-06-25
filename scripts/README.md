# scripts/

Helper scripts for analysing how the `pi-intelli-search` extension is used on
this host. These are developer/operator tools, not part of the published npm
package.

## analyze-sessions.sh

Evaluates extension effectiveness by parsing local `Pi` session logs and the
`intelli-search` cache. No API keys required. No network access. Deterministic.

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

### What it reports

| Section | Metric |
|---|---|
| 1 | Total tool calls by name, across all sessions |
| 2 | `intelli_*` breakdown and share of all tool calls |
| 3 | Per-project `intelli_*` usage (rolls up nested subagent sessions) |
| 4 | Adoption over time: monthly `intelli_*` vs legacy `web_*` calls |
| 5 | Follow-up research sessions (2+ `intelli_research` calls) |
| 6 | Adoption rate: sessions using any `intelli_*` tool |
| 7 | Cache re-reads: tool calls referencing a `.search/` path |
| 8 | `.search/` cache sizes per project (from `.index.json`) |
| 9 | Telemetry sidecars (`meta.json`, v0.11.0+): per-stage success rates, fetch-variant winners (summed across sidecars), search-retry firings, cache-suggest hits |

### Environment

- `SEARCH_ROOTS` (optional): space-separated roots to scan for `.search/`
  caches. Defaults to `$HOME /srv /home`.

### Provenance

The headline numbers were produced with an early version of this script.
Re-running it reproduces those numbers (within the limits of session-log
inference, since live sessions keep appending).
