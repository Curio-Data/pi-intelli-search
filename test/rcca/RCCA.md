# RCCA: MCP Research Failures (2026-11-06)

Root cause and corrective action analysis of the failure report raised against
`@curio-data/mcp-intelli-search` 0.19.0, re-checked against 0.21.0 (HEAD `d2ec506`).
The agent briefs, reports, the input report and the raw live-call log are retained
locally under `evidence/agents/2026-11-06-rcca-mcp-research/` (gitignored, with a
`live-raw/SHA256SUMS` manifest).

## Regression Tests

The files below drive the real MCP runtime, OpenRouter adapter, retry policy,
research pipeline, cache, telemetry and MCP result mapping with a scripted HTTP
transport. They make no network calls. They began as probes whose assertions held
on both 0.19.0 and 0.21.0; with the corrective actions they assert the corrected
behaviour. At commit `4eadcc3` they failed 25 of 54 against the 0.21.0 source and all
passed against 0.22.0.
Observations are printed as `OBS {json}` lines and appended to the file named by
`RCCA_OBS` when it is set.

| File | Findings |
|---|---|
| `rcca-collate/probe.test.ts` | F1, F2, F4, F5: collate empty output, truncation, lost artefacts, result mapping |
| `rcca-extract/probe.test.ts` | F3, F5: per-page extraction failure, reason recording, counters |
| `rcca-fetch/urls.probe.test.ts` | F6: bogus hosts from the prose domain pass |
| `rcca-fetch/gate.probe.test.ts` | F6: content-type gate (PDF rejection by design) |
| `rcca-fetch/falsepos.probe.test.ts` | F6: false-positive host shapes |

The standalone suite collects them through
`packages/mcp/test/rcca-regressions.test.ts`, so `npm run test:all` runs them.
Run them alone with:

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

## Corrective Actions (0.22.0)

| Finding | Action |
|---|---|
| F1, F3 | Research retries an extraction or synthesis that stops at its output cap, doubling the cap each time up to 128,000 tokens; `outputBudgetRetries` sets the number of retries (default 2, 0 disables). A completed synthesis is preferred to a truncated one, then the longest truncated synthesis that passes provenance. Each attempt's timeout scales with its cap, at most 4 × `llmTimeoutMs`. The shared policy no longer repeats an exhausted budget at the same cap. The default `collationMaxTokens` rises from 4,000 to 8,000 |
| F2 | A synthesis failure returns `collate-failed` and an extraction failure returns `extraction-failed`; both save the fetched pages, any extractions, a failure report naming each saved file and its failure reason, and `meta.json`. A same-day successful report for the query, including one a concurrent run commits, is preserved instead (decided under the cache lock). Failure reports carry a marker on line 1, the only position caller text cannot reach |
| F4 | Truncation also uses the provider finish reason, so it is flagged when usage is missing |
| F5 | The all-fetch-failed result lists failed URLs and reasons; the mixed headline names both counts |
| F6 | Protocol-less references must end in a delegated top-level domain (TLD), checked after IDN conversion. File-like references under a delegated TLD (`install.sh`, `manage.py/runserver`, `main.cc`, `libfoo.so`, `user.id`, `README.md`) are kept on purpose as inferred assets: labelled as inferred from text, ranked after citations, fetched through the shared media gate, and reported with their fetch outcome in the result, `report.md` and `details.inferredAssets`. Still rejected: names under a non-delegated final label (`app.ini`, `robots.txt`, `Node.js`), non-numeric ports (`example.com:abc`) and bare `gitea:3000`. Numeric ports, queries and fragments are kept. `notion.so`, `bun.sh`, `publico.pt/…`, `detik.id` and `vue.js.org` have keep rows in `test/util.test.ts`. `scripts/generate-tlds.mjs` refreshes the TLD set |
| Limits | Collation input is budgeted from actual extraction sizes (`collationInputBudgetTokens`, `collationSourceMaxTokens`); overflow is trimmed in a stated order and reported with the untrimmed `extractions/` file. `extractMaxChars` rises to 400,000 |

Not changed: `isError` stays `false` for degraded results, which carry their
`outcome`; PDF rejection remains by design; F7 needs no change.

## Retained Scratch

This section records the pre-merge retention plan. For the current state, see
[HANDOVER.md § State](HANDOVER.md#state).

The reference worktree `ref-mcp-v0.19.0` (detached at `mcp-v0.19.0`, with its own
`node_modules` and untracked 0.19.0 probe copies) is kept until the corrective
actions are merged. Its removal, and disposal of the run's scratch, needs the
owner's approval at that point; everything retained is under
`evidence/agents/2026-11-06-rcca-mcp-research/`, whose `CLEANUP.md` lists every
artefact the run created.

## Follow-Up

The items still open before merge, and the method for finishing them, are in
[FOLLOW-UP.md](FOLLOW-UP.md).
