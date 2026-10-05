# Phase 3 Peer Review

## Outcome

Two independent reviewers assessed the complete Phase 3 working tree relative to `0c26972`. Both final verdicts were `PASS` after implementation corrections, documentation clarifications and frozen-tree follow-up checks. No actionable Phase 3 finding remains open. Phase 4 remains the next implementation step; this review does not authorise publication.

## Provenance

The review ran through [_Herdr_](https://herdr.dev/) on 2026-10-03. Each reviewer received the entire phase, including new untracked files, and worked read-only in a separate repository tab. Neither read the other's report. Session transcripts, reports and scratch remained under `.tmp/agents/2026-10-03-phase3-review/` on the encrypted repository mount.

| Reviewer | Requested and Session-Verified Native Model | Initial Verdict | Final Verdict |
|---|---|---|---|
| `p3-review-qwen` | `qwen-token-plan/qwen3.8-max` | Pass With Blockers | Pass |
| `p3-review-flash` | `deepseek/deepseek-flash` | Pass With Nonblocking Findings | Pass |

Roster verification confirmed both exact identifiers. Session provenance confirmed no model substitution or mid-review change. Herdr client and server both reported `0.9.0`, compatible endpoints and current integrations/detection manifests. Both launches exceeded Herdr's startup wait while the agents were already working; the coordinator verified their live panes and registered names against those existing processes rather than spawning duplicates.

Qwen owned the full deterministic suites and both type checks. Flash used isolated probes and official documentation. The coordinator owned build, smoke, independent installation and live gates.

## Findings and Dispositions

| Finding | Verification and Resolution |
|---|---|
| Reasoning Sent to Non-Reasoning Models | The live catalogue and native transport supported the concern. The adapter now sends reasoning only when advertised. A new regression failed before the change and passed afterwards. |
| Choice-Level Provider Errors Lose Retry Classification | Official documentation shows `choices[].error` inside successful responses. A shared safe classifier now handles top-level and choice-level errors, preferring known error types over status codes. Tests exercise transient and permanent cases, contradictory type/status pairs and citation isolation. |
| In-Flight Budget `402` Ignores Retry-After | A valid header now makes this response transient. Ordinary credit exhaustion and invalid headers remain permanent. Tests assert exact attempt counts and delay. |
| Dependency Console Output Reaches Stdout | Standalone execution now uses an async-scoped console guard. A test drives the installed Defuddle conversion-failure handler, first proving page content leaks outside the guard, then proving suppression inside it. Overlap, exception restoration and unrelated output are tested. Native console behaviour is unchanged. |
| Error Flattening Obscures Protocol Mapping | `StandaloneError` supplies safe categories and cancellation identity without retaining raw causes. Shared-operation wrapping is documented; Phase 4 need not parse diagnostic prose. |
| No Successful Configuration-Check Exit | `--check-config` now validates without credentials or serving and distinguishes success from failure. The unavailable server path still exits with an explicit error. |
| Credential Error Misstates Environment Lifetime | The message and guide now require the environment before runtime construction and a restart after credential changes. |
| Host-Neutral Guidance Coverage Is Incomplete | Tests now exercise research and related-cache suggestions as well as collation, asserting no literal `read` command remains in generated guidance. |
| Navigation, Scratch and Path Hygiene | Updated the source map, anchored test scratch to its module rather than working directory, removed fixed path separators and replaced phase-label assertions with behavioural checks. |
| Aggregate Badge Scope Is Unclear | The badge identifies `test:all`; the development guide distinguishes native-only and aggregate commands. |
| Sonar Combined With an Explicit Search Tool | Documented the capability rejection. The adapter does not silently remove a configured tool. |
| Cache Scan Cost and Cap | Documented full-scan frequency, the bounded cap and operator recovery. Scan latency remains a Phase 4 consideration; containment was not weakened. |
| Extraction Details Are Not Collation Inputs | Documented the explicit item mapping, including title/status and omission of `currentness`. Protocol and plugin guidance must preserve it. |
| Domain Mutual Exclusion Allegedly Lacks Documentation | Rejected and retracted. The official Markdown explicitly documents the restriction for Firecrawl and Perplexity; the latter also describes allowed-domain precedence. Standalone rejection deliberately avoids silently discarding an exclusion. |
| Catalogue `supported_efforts` Allegedly Does Not Exist | Qwen retracted the concern after checking the reasoning guide, which documents the field even though the model endpoint's schema page omits it. The handoff now identifies that source explicitly. |

The cached second research preflight and standalone-specific numeric bounds remain deliberate, not defects. Native frozen fixtures were never regenerated.

## Review Process Correction

The coordinator began integrating Flash's completed findings while Qwen's first review was still in progress. Qwen identified the moving tree and re-ran its checks. Those intermediate results are not the final evidence. After the subsequent corrections, the coordinator froze source and tests until both reviewers completed their follow-ups. Both final verdicts cover that frozen state.

Future same-tree review pools should finish both initial reviews before integration, then use a separate frozen follow-up pass. A completed peer report is not evidence that the other reviewer has finished reading the same source.

## Final Verification

The coordinator ran all gates sequentially after the source corrections. Logs are under `.tmp/mcp-phase3/`; reviewer-owned follow-up logs are under their respective scratch directories. Test totals remain single-sourced in the root README badge.

| Check | Result |
|---|---|
| `npm run build:all` | Passed |
| `npm run test:all` | Passed; independently repeated by Qwen |
| Standalone and Native Contract Type Checks | Passed; independently repeated by Qwen |
| Frozen Native Fixtures | Passed unchanged |
| `npm run test:smoke` | Passed with isolated agent directory |
| `npm run test:mcp:install` | Passed: installed executable, all operations, both native fetch paths, telemetry identity and denied ancestor resolution |
| `./test/run-e2e-publish-local.sh` | Passed with fresh host peers and installed native identity |
| `./test/e2e/01_main.sh` | Passed with completed report, source, extraction, index and all local telemetry stages |
| Shell Validation, Formatting and Diff Checks | Passed |

Flash independently reproduced the real dependency stdout leak and guard, overlapping scope restoration, provider classification, in-flight-budget retry and safe runtime categories. Its follow-up did not run shared gates. Qwen ran the deterministic suites and type checks but did not build, install or make live inference calls. Coordinator installation and live results are separate evidence, not attributed to either reviewer.

## Remaining Boundaries

- Import-time output and direct stdout writes are outside the console guard. Phase 4 must prove actual protocol framing, including dependency startup and failure paths.
- The Defuddle failure regression uses private dependency paths and deliberately fails if that behaviour changes; review it on dependency upgrades.
- Cache-scan latency has not been benchmarked against a large populated cache.
- Unknown provider error types fall back to numeric status, then a permanent error. No raw error text is used to infer retryability.
- Provider cost-component detail, the runtime/version/platform matrix, live standalone inference, protocol clients and plugins remain unverified or later work.
- A public release, staged publication and the full paced release suite are not part of this checkpoint.

Continue from [Phase 3 Results](PHASE-3.md) and the [handoff](README.md). The fresh-agent handoff check is a separate post-commit verification, not a claim established by these peer reviews.
