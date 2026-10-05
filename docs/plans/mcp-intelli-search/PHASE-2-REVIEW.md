# Phase 2 Peer Review

## Outcome

Two independent reviewers assessed the complete Phase 2 working tree relative to `c60c056`. Both initially returned `PASS WITH NONBLOCKING NOTES`. Confirmed findings were corrected or explicitly assigned to the standalone adapter phase. Both final verdicts were `PASS`; no actionable Phase 2 finding remains open.

The coordinator reproduced the staging and console failures with regression tests before fixing them, then ran the complete native verification set. Frozen fixture files, package metadata, dependency lockfiles and native defaults remain unchanged.

## Provenance

The review ran through [_Herdr_](https://herdr.dev/) on 2026-10-03. Each reviewer worked read-only in its own tab in the repository workspace. Both received the entire phase, including untracked new files, rather than separate slices. Neither was briefed with the other's findings. Reviewer session files, reports and scratch stayed under `.tmp/agents/2026-10-03-phase2-review/` on the encrypted repository mount.

| Reviewer | Requested and Verified Native Model | Initial Verdict | Final Verdict |
|---|---|---|---|
| `p2-review-qwen` | `qwen-token-plan/qwen3.8-max` | Pass With Nonblocking Notes | Pass |
| `p2-review-flash` | `deepseek/deepseek-flash` | Pass With Nonblocking Notes | Pass |

The roster check verified both exact identifiers before launch. Session provenance confirmed the same provider/model throughout each review and follow-up, with no fallback or model change. Herdr client and server both reported `0.9.0`; endpoint, integration and detection-manifest checks were clean.

Qwen owned the full deterministic suite and contract type check during review. DeepSeek used targeted checks and isolated probes. The coordinator owned build, structural smoke, fresh-tarball installation and live verification. Qwen assessed the main corrections; DeepSeek additionally checked the final cleanup-failure seam, regression test and checkpoint wording. This consolidated record was written by the coordinator after collecting those reports.

## Findings and Dispositions

| Finding | Coordinator Verification | Disposition |
|---|---|---|
| Optional Staging Setup Can Lose Completed Research | A regular file at the staging-root path made the new regression fail after collation, before report creation. | Fixed. Setup errors produce a diagnostic and skip optional downloads while preserving the completed report and index. Cancellation still propagates. |
| Cleanup Failure Can Replace a Result | The cleanup call was unguarded; DeepSeek also reproduced a filesystem permission failure. | Fixed. Cleanup errors are diagnostic-only. A per-run removal seam tests the failure deterministically without depending on host permissions. |
| Interleaved Console Suppression Leaks a Patch | Four new tests failed before the fix, covering overlapping success/failure, identical-tag isolation and detached async work. | Fixed with async-local scopes and one reference-counted dispatcher in `src/core/console.ts`. The final active scope restores console methods. Existing utility tests and the reviewer's original leak probe pass. |
| Core Diagnostics Bypass the Injected Logger | Fetch comparison printed a native-prefixed debug line; the core also exported the native `logErr()` helper. | Removed the fetch debug line and moved the prefix helper to native `src/util.ts`. Structured fetch-winner telemetry remains. |
| Retry/Timeout Scope Is Overstated | The three native one-shot operations omit retry/timeout options, as they did before Phase 2. The README called the settings universal. | Corrected README, architecture and agent guidance. Native behaviour remains unchanged. Phase 3 must apply explicit configured defaults in its adapter for all four operations, using the shared policy once. |
| Disabled-Feature Test Conflates Two Switches | Both telemetry and discovery were disabled in the original test. | Added independent cases with each feature enabled while the other is disabled. |
| Source and Test Navigation Is Stale | Forwarding files were described as implementations; new tests and moved headers were missing or mislabelled. | Corrected source/test trees, module headers and architecture pointers. |
| Failed Cleanup Leaves Staging Behind | Non-fatal removal failure can leave a directory that subsequent runs do not revisit. | Documented manual recovery after all research processes using the cache have stopped. No unsafe automatic sweep was introduced. |
| Worker Draining Assumes Abort-Aware Work | The shared pool waits for active workers before reporting failure. Current fetch/model workers receive cancellation. | Retained deliberately for cleanup safety. Standalone adapters must honour signals and bound model work. |

## Verification

The coordinator ran the following checks after the code corrections. Logs are under the review run's `verification/` directory; they are optional supporting evidence, not handoff dependencies. The test total is single-sourced in the root README badge.

| Check | Result |
|---|---|
| New Staging and Console Regressions Before Fix | Failed on the expected defects |
| `npm run build` | Passed |
| `npm test` | Passed, including unchanged native fixtures and the new regression coverage |
| `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` | Passed |
| `npm run test:smoke` | Passed with isolated `PI_CODING_AGENT_DIR` |
| `./test/run-e2e-publish-local.sh` | Passed; fresh `pi-ai` `1.0.1`, native tool registration and installed-manifest identity |
| `./test/e2e/01_main.sh` | Passed; completed report, index, sources, extraction and all telemetry stage buckets |
| `shellcheck` on Primary Live, Shared Harness, Fresh-Install and Aggregation Scripts | Passed |
| Frozen Fixtures and Package-Metadata Diff Guard | Unchanged |
| Formatting, Markdown Links and Diff Checks | Passed |

The observed runtime was [_Node.js_](https://nodejs.org/) `v24.19.0` with `Pi` `1.0.1`. The live scenario used its existing isolated harness, native `kimi-coding/k3` agent loop and configured [_OpenRouter_](https://openrouter.ai) pipeline models. No host credential or settings file was modified.

## Boundaries

The full paced release suite, real minimum-host installation matrix, standalone Model Context Protocol (MCP) artifact, protocol and plugins remain later gates. No release or staged publication occurred. Review approval does not authorise publication.

The handoff starts at [Phase 3](IMPLEMENTATION.md#phase-3-standalone-runtime-and-package), not protocol registration. The native one-shot policy asymmetry and standalone filesystem containment requirement are explicit. The core still temporarily intercepts dependency console methods during active suppression scopes; it does not claim to be free of all process-global side effects.
