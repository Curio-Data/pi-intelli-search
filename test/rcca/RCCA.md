# RCCA: MCP Research Failures (2026-11-06)

Root cause and corrective action analysis of the failure report raised against
`@curio-data/mcp-intelli-search` 0.19.0, re-checked against 0.21.0 (HEAD `d2ec506`).
The agent briefs, reports, the input report and the raw live-call log are retained
locally under `evidence/agents/2026-11-06-rcca-mcp-research/` (gitignored, with a
`live-raw/SHA256SUMS` manifest).

## Probes

The files below drive the real MCP runtime, OpenRouter adapter, retry policy,
research pipeline, cache, telemetry and MCP result mapping with a scripted HTTP
transport. They make no network calls. Each assertion holds on both 0.19.0 and
0.21.0; version differences are printed as `OBS {json}` lines and appended to the
file named by `RCCA_OBS` when it is set.

| File | Findings |
|---|---|
| `rcca-collate/probe.test.ts` | F1, F2, F4, F5: collate empty output, truncation, lost artefacts, result mapping |
| `rcca-extract/probe.test.ts` | F3, F5: per-page extraction failure, reason recording, counters |
| `rcca-fetch/urls.probe.test.ts` | F6: bogus hosts from the prose domain pass |
| `rcca-fetch/gate.probe.test.ts` | F6: content-type gate (PDF rejection by design) |
| `rcca-fetch/falsepos.probe.test.ts` | F6: false-positive host shapes |

`npm test` does not collect them (`scripts/run-tests.mjs` reads only top-level
`test/`). Run them directly:

```bash
node --import tsx --test test/rcca/*/*.test.ts
```

## Root Cause

MiniMax M3 counts hidden reasoning against `max_completion_tokens`. Several
_OpenRouter_ serving routes (AtlasCloud, Novita, GMICloud, StreamLake, MiniMax)
ignore `reasoning.effort: low` and reason until the cap, returning
`content: null` or text cut off mid-sentence, both with `finish_reason: length`.
Per-call routing makes the failure intermittent and clustered. Observed in 73 live
calls with the route pinned: at the 0.19.0 extraction cap of 3000 tokens, 8 of 31
calls returned nothing and 9 were truncated; at the 0.21.0 cap of 8000, 31 of 31
completed.

The pipeline then mishandles the outcome:

- 0.19.0 checked for a non-string `content` before the length limit, giving the
  generic "OpenRouter returned no text completion" (F1).
- Collation has no error handling and the error is not retried, so one empty
  collate response fails the run and writes no cache artefacts or `meta.json` (F2).
- Text cut off at the cap is accepted as a completed result (F4).

## Status at 0.21.0

| Finding | Status |
|---|---|
| F1 hard provider failure | Clearer message; still fatal. Reproduced live at the 4000-token collate cap |
| F2 artefacts discarded | Present |
| F3 extraction failures | Reasons recorded; failures largely gone at the 8000-token cap |
| F4 truncated summaries | Warned only when usage reaches the cap; `finish_reason` ignored |
| F5 reporting gaps | `extractionFailed` added; soft failures keep `isError: false`; no per-URL fetch reasons |
| F6 bogus hosts | Present: the prose domain pass linkifies any dotted token, ahead of real citations |
| F7 serial calls | Consistent with the host's read-only rule; research is correctly not read-only |

## Retained Scratch

The reference worktree `ref-mcp-v0.19.0` (detached at `mcp-v0.19.0`, with its own
`node_modules` and untracked 0.19.0 probe copies) is kept until the corrective
actions are merged. Remove it then with `git worktree remove` from the main checkout,
together with `.tmp/agents/2026-11-06-rcca-mcp-research/`.
