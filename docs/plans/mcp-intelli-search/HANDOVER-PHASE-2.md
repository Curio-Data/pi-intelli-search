# Phase 2 Cold-Start Handover

## Outcome

A fresh native `zai/glm-5.3` agent reconstructed the checkpoint and next implementation phase from tracked documentation, then passed every documented entry check at `86b1e4e`. Its verdict was `PASS WITH NONBLOCKING NOTES`: the handoff was usable without previous conversation, memory or research-cache access. The minor documentation notes are resolved below. The same agent then reviewed only the documentation clarifications and returned `PASS`, with no remaining findings and no additional test run.

This check verifies handoff sufficiency and deterministic entry checks. It is not another full code review, live-provider test or standalone package test. The implementation review is recorded separately in [Phase 2 Peer Review](PHASE-2-REVIEW.md).

## Isolation and Provenance

The check ran on 2026-10-03 in a fresh interactive `Pi` session through [_Herdr_](https://herdr.dev/). The exact requested and session-verified model was `zai/glm-5.3`, with no model change or fallback.

Extension and skill discovery were disabled. Only the explicit Herdr lifecycle extension was loaded, and the tool allowlist was `read,bash,write`. Session inspection confirmed that only those tools were called. No memory or session-search tools were available. The agent started from the [handoff entry point](README.md), read tracked documentation and inspected manifest metadata and file existence; it did not read implementation source, private research caches or raw earlier review reports. Compiler and test subprocesses naturally read the source they execute.

Sessions, report and logs stayed under `.tmp/agents/2026-10-03-phase2-handoff/` on the encrypted repository mount. Those files are supporting evidence, not continuation requirements. The checkout was clean before and after the agent's checks, and the local and remote planning-branch tips both matched the reviewed checkpoint.

## Observed Entry Checks

| Check | Result |
|---|---|
| `npm run build` | Passed |
| `node --import tsx --test test/native-contract.test.ts` | Passed; frozen fixtures unchanged |
| `node --import tsx --test test/core-*.test.ts test/native-model-client.test.ts test/workspace-paths.test.ts` | Passed |
| `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` | Passed |
| Working Tree and Fixture Diff After Checks | Clean |

The agent used its own repository-local `TMPDIR` and log directory instead of the example `.tmp/mcp-phase3/`. No live call or installation was performed. Its `npm ls --depth=0` check found no missing or invalid top-level dependencies; that is not proof of exact lockfile equivalence or a substitute for `npm ci` when dependency provenance is uncertain.

## Reconstructed Continuation

The agent correctly identified Phase 3, Standalone Runtime and Package, as next. It recovered the required `@curio-data/mcp-intelli-search` name, shared-engine boundary, explicit workspace and provider configuration, environment-referenced credentials, separate package dependencies, one retry-policy owner, adapter-level retry/timeout defaults and independent packed-artifact verification.

It distinguished those tasks from later protocol registration, queueing, host plugins, minimum-host verification and release readiness. It also recovered the prohibition on treating architecture approval as publication approval. No gitignored artifact was needed to establish the next step.

## Notes and Dispositions

| Note | Disposition |
|---|---|
| Proposed `src/core/defaults.ts` Does Not Exist | The plan now states that it is a Phase 3 extraction target; current tuning defaults remain in native settings. Shared tuning must not introduce implicit standalone provider/model selections. |
| Audited Version and Observed Runtime Differ | No contradiction: the existing compatibility audit names `Pi` `1.0.0`, while Phase 2 and its reviews ran on `Pi` `1.0.1`. Neither changes the declared peer baseline. These evidence scopes remain separate. |
| Entry Point Omits an Immutable Code Checkpoint | The handoff now identifies `86b1e4e` as the reviewed Phase 2 implementation, while directing continuation from the planning branch tip, including subsequent documentation commits. |
| Dependency Drift Check Is Underspecified | The handoff now recommends `npm ci` when provenance is uncertain and states the limits of `npm ls --depth=0`. |

## Boundaries

The fresh agent did not rerun the full unit suite, structural smoke, fresh-tarball install or live scenario; the coordinator's final runs are recorded in [Phase 2 Peer Review](PHASE-2-REVIEW.md#verification). No current registry or provider-wire research was performed. Phase 3 must recheck those external interfaces before adding its runtime dependencies.

Start subsequent implementation at [Phase 3](IMPLEMENTATION.md#phase-3-standalone-runtime-and-package) using the [handoff reading order](README.md#reading-order). No release or staged publication was created by this work.
