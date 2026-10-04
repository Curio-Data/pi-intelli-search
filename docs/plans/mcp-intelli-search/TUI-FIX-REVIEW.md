# TUI Fix Follow-Up Review

## Scope

Two independent native `Pi` reviewers, `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash`, reviewed `e9af554` and the post-Phase 5 handoff on 2026-10-04. Both initial verdicts were `PASS WITH NOTES`. Each ran the scoped core-policy, native-adapter, native-LLM and frozen-contract suites; neither owned the full-suite or live verification. Provider/model provenance was checked from the agent sessions rather than self-report.

Reports reside under `.tmp/agents/2026-10-04-tui-handoff/reports/` (gitignored). This record contains the durable dispositions; continuation does not require those files.

## Dispositions

| Finding | Disposition |
|---|---|
| Native retry silence was tested through a stubbed delegate, not through real `callLlm()` | Added behavioural tests for legacy and registry-facade dispatch, each with and without an explicit retry-notice callback. The tests force a retry, assert successful completion and callback delivery, and capture console methods to prove silence. |
| The older native fix on `main` could be accepted over the shared implementation during reconciliation | The current checkpoint names the affected source, test and metadata files; preserve the shared implementation, aggregate badge and migration history. Unpublished preparation metadata does not reserve a version on npm or authorise a release. |
| The installed published extension still contains the reported diagnostic | Recorded explicitly. Repository commits do not update the installed package. No global extension installation was changed; interim local use requires operator approval. |
| Native catch-and-continue error diagnostics still use `logErr` | Accepted scope boundary, now stated in the changelog and checkpoint. Do not claim complete console interception. Per-page extraction failures, staging failures, optional cache suggestions and telemetry failures remain native operation-log paths. |
| Retry progress is transient, can replace the extraction sub-progress bar, and is not durable retry telemetry | Recorded as an observability limitation. Do not restore console writes to preserve scrollback; a future change needs its own telemetry/progress design. |
| MCP research without a client progress token drops retry notices | Recorded. The policy's logger fallback still serves requests without a notice callback, such as catalogue preflight and standalone calls. |
| Comments described the old console logger and incorrectly attributed tool errors to `ctx.ui.notify` | Corrected: the native policy logger is silent; tool errors are thrown, while session-start notices use the UI notification API. Removed wording implying that the prepared native version had shipped. |
| A regex source audit is not an exhaustive terminal-write proof | Kept the audit as a guard for direct console calls in its named modules. Narrowed the claim and supplemented it with behavioural native retry tests. Aliased writes and unrelated module/error paths are not certified by that audit. |
| Newly linked checkpoint was not tracked while under review | Include it in the same commit as the entry-point links. No continuation relies on an untracked file after that commit. |
| Working-tree tests changed during the first review | The coordinator incorporated the first review's test recommendation while the second reviewer was still running. The second reviewer identified and re-tested the changed state. Final follow-up review uses the corrected tree held stable until both reports settle. |

The fresh-agent pass is separate from these code reviews. The original Phase 5 cold-start record predates the TUI port and must not be cited as covering it.

## Verification

On the corrected tree, the coordinator ran `npm run build:all`, `npm run test:all`, `node_modules/.bin/tsc -p test/tsconfig.native-contract.json`, `npm run check:plugins` and `./test/e2e/01_main.sh`. All passed. The frozen expected files were not regenerated; the README badge remains the canonical aggregate count.

No GitHub release, tag, publication, installed-extension replacement or Codex authentication action was performed for this follow-up. The owner retains the release hold and authentication recovery.

## Follow-Up

Qwen returned `FINAL VERDICT: PASS`; DeepSeek returned `FINAL VERDICT: PASS WITH NOTES`. Both re-ran the scoped tests on the corrected tree, and the tracked diff remained byte-identical throughout that round. No blocking finding remained. DeepSeek's final file-list note was incorporated by adding `src/tools/intelli-research.ts` to the reconciliation list. Both new checkpoint documents will be committed with their incoming links.

The separate [Phase 6 Entry Verification](HANDOVER-PHASE-6-ENTRY.md) subsequently returned `PASS WITH NOTES` with all entry checks green. It does not extend runtime certification to untested live hosts.
