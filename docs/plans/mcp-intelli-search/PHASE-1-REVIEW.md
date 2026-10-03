# Phase 1 Peer Review

## Outcome

Two independent reviews of Phase 1 found no blockers. Both initially returned `PASS WITH NONBLOCKING NOTES`. The confirmed custom-cache instruction bug is fixed, contract documentation is clarified, and the follow-up checks pass. Phase 2 remains the next implementation step; this review does not expand the completed scope.

The review used [_Herdr_](https://herdr.dev/) on 2026-10-03. Both reviewers examined the entire `036e1c0` checkpoint relative to `d975f19`, rather than separate slices. They worked read-only in separate tabs, without reading each other's reports or changing tracked files. The coordinator verified their findings and implemented the corrections.

## Reviewer Provenance

| Reviewer | Requested and Verified Native Model | Initial Verdict | Follow-Up Verdict |
|---|---|---|---|
| `p1-review-glm` | `zai/glm-5.3` | Pass With Nonblocking Notes | Pass; no remaining actionable issue |
| `p1-review-flash` | `deepseek/deepseek-flash` | Pass With Nonblocking Notes | Pass With Nonblocking Notes; original cleanup finding retracted |

The roster check verified both exact identifiers before launch. Session provenance confirmed the requested providers and models throughout the reviews and follow-ups, with no model change or fallback. Herdr client and server both reported `0.9.0`, compatible endpoints and current integrations/detection manifests. Reviewer sessions, scratch and reports were confined to `.tmp/agents/2026-10-03-phase1-review/` on the encrypted repository mount. Both reviewer tabs were closed after their completed reports were collected.

GLM owned the deterministic suite and contract type check during review. DeepSeek ran isolated probes rather than competing for those gates. The coordinator subsequently ran the complete verification set below. The reviewers' follow-ups assessed the source, test and contract-documentation corrections; this consolidated record was written afterwards by the coordinator.

## Findings and Dispositions

| Finding | Coordinator Verification | Disposition |
|---|---|---|
| Custom Cache Reading Instruction | `formatCacheSuggestions()` used `.search/` even when its directory label named a custom root. A new regression test failed before the fix. | Fixed by interpolating the configured display root. Tests cover nested relative, absolute and parent-relative roots. Default fixture text is unchanged. |
| Absolute Workspace Precondition | Both path functions reject a relative workspace root. Their comments did not fully state the caller's obligation. | Documented the absolute-root requirement and the reason for rejecting implicit process-relative resolution. No behaviour change. |
| Cache Containment Assumption | Native absolute or parent-relative settings can place cache and staging roots outside the workspace. | Documented this on `WorkspacePaths` and `resolveWorkspacePaths()`. Standalone containment validation remains later work. |
| Repeated Cache-Root Resolution | Native callers pass an already-resolved cache root to `makeCachePath()`, which also supports relative configuration. | Documented both accepted forms and absolute-path precedence. No runtime defect was demonstrated; signature simplification is not required for this checkpoint. |
| Fetch Alias Compatibility | The annotation wrapper's host-neutral fetch alias also needs checking when host peers change. | Added its structural compatibility to the peer-bump checklist in `AGENTS.md`. |
| Shell Validation Evidence | The earlier shell check ran, but its invocation had no dedicated retained log. Absence of that log did not prove the check was skipped. | Re-ran the exact command and retained its invocation and successful result in `verification/shellcheck.log`. |
| Alleged Cleanup Scope Error | In `test/core-boundary.test.ts`, `temp` is initialised before entering `try`. A failed `mkdtemp()` cannot enter that `finally`. | Rejected as a false positive; DeepSeek independently rechecked and retracted the finding. No code change. |

The custom-cache instruction correction is recorded under `Fixed` in the root changelog. No native fixture JSON, package metadata, dependency lockfile or model default changed.

## Remaining Notes

These observations do not block Phase 2:

- Frozen tool descriptions and guidance still name the default `.search/` directory. Runtime results name the configured path. Changing those static strings requires a separate, explained native-contract change; the fixtures were not regenerated for this review.
- The relative-root error remains `Workspace root must be absolute`. It identifies the violated precondition; adding function names is optional diagnostic wording, not a correctness fix.
- A trailing slash in a configured display root can produce a doubled separator in the suggestion instruction and its pre-existing directory label. Both reference the same path. Normalising configured display text is not required for the correction and was not introduced here.
- Documentation-download staging, shared retry-policy extraction and injected telemetry identity remain explicitly scoped Phase 2 work. Their deferral is not evidence that ordinary temporary staging is safe for confidential workloads.
- The recorded runtime is [_Node.js_](https://nodejs.org/) `v24.19.0` with `Pi` `1.0.0`. The continuous-integration Node.js `22` environment and real minimum-host installation matrix were not exercised in this review. Do not infer those results from deterministic dispatch tests.

## Verification

All results below were observed by the coordinator after the code corrections. Logs are under `.tmp/agents/2026-10-03-phase1-review/verification/`; the fresh-agent handoff does not depend on those gitignored files. The test total remains single-sourced in the README badge.

| Command or Check | Result |
|---|---|
| New Custom-Cache Regression Before Fix | Failed on the hardcoded `.search/` instruction, as expected |
| `npm run build` | Passed |
| `npm test` | Passed; includes unchanged native fixtures, core isolation and the new regression |
| `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` | Passed |
| `npm run test:smoke` | Passed with isolated `PI_CODING_AGENT_DIR` |
| `./test/e2e/01_main.sh` | Passed with completed report, index, sources, extraction and all telemetry stage buckets |
| `./test/run-e2e-publish-local.sh` | Passed; native tarball registered all tools under plain Node.js with freshly resolved `pi-ai` `1.0.1` |
| `shellcheck test/e2e/01_main.sh test/e2e/lib.sh test/run-e2e-publish-local.sh` | Passed with no findings |
| Fixture and Package-Metadata Diff Guard | Unchanged |

Temporary files for all coordinator gates were redirected into the repository. No release or staged publication occurred. The full paced release suite, standalone Model Context Protocol (MCP) runtime, protocol and plugin surfaces remain untested because they are outside this phase.

## Continuation

Use the [handoff reading order](README.md#reading-order), [Phase 1 Results](PHASE-1.md) and [Phase 2 plan](IMPLEMENTATION.md#phase-2-shared-operations-and-native-adapter). The next agent should preserve the verified physical/display path split and native model dispatch while moving operations behind the shared contracts. The reports and local session transcripts are supporting evidence, not additional implementation requirements.
