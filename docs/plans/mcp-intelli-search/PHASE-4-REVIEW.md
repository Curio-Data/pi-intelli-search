# Phase 4 Peer Review

## Scope and Method

Two independent native reviewers, `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash`, each covered the **whole** uncommitted Phase 4 change on `plan/mcp-intelli-search` (base `1b09318`), working diff-first in the main checkout under read-only briefs. Both ran the deterministic gates themselves (build, both test suites, contract type check, `shellcheck`, the independent tarball install, the Phase 0 SDK probe) with scratch under `.tmp/agents/2026-10-04-p4-review/work/`; neither ran live scenarios, per brief. The orchestrator's gate and host-smoke logs under `.tmp/mcp-phase4/` and `.e2e-logs/` were available to both as corroborating evidence.

Initial verdicts: **PASS WITH NONBLOCKING NOTES** (both). Follow-up verdicts after the corrections below: recorded in [Follow-Up](#follow-up).

Reports: `.tmp/agents/2026-10-04-p4-review/reports/{qwen,deepseek}.md` (gitignored; the report file, not the pane, was the authority).

## Findings and Dispositions

### Corrected

| Finding | Reviewer | Disposition |
|---|---|---|
| Queue default concurrency 2 contradicts the approved plan ("initially one full operation active per server", `IMPLEMENTATION.md`) with no operator override | deepseek F1 | **Fixed.** `defaultQueueLimits.maxConcurrent` is now 1; the fixture child defaults to 1; `packages/mcp/README.md` and `PHASE-4.md` state the posture. Tunability stays an in-process `ServeOptions` seam, not CLI configuration, matching the explicit-configuration contract. |
| Stdout guard leaves the real `process.stdout` without an error listener: host-side stdout closure (EPIPE) crashes with an unhandled 'error' event instead of the SDK's graceful close | qwen R1 | **Fixed.** `installStdoutGuard()` sinks the real stream's `error` event; the wrapper still propagates the write error to the transport's own handler, taking the SDK close path. Covered by a new deterministic test and by an installed-artifact EPIPE assertion in `verify-mcp-install.mjs`. |
| EPIPE close path left the process alive (the SDK detaches its stdin consumer, pinning the event loop) | found while fixing R1 | **Fixed.** `close()` destroys the orphaned standard input after draining, so the process exits. Verified against both the source-run fixture and the built artifact. |
| Queued-cancellation test could pass without the server seeing the queued request | deepseek F2 | **Fixed.** `startServer` accepts an `onEnqueue` instrumentation hook; the fixture emits `FIXTURE_QUEUE_QUEUED` and the test waits for it before aborting. |
| Non-`StandaloneError` fallback echoed `error.message` to the client | deepseek F3 | **Fixed.** The fallback returns a fixed "Operation failed"; the raw message goes to standard error only. The path remains contractually unreachable (the runtime wraps every failure). |
| `close()` rejection paths unguarded | qwen R2 | **Fixed.** Queue drain and server close are individually best-effort; `notifyClosed()` always runs. |
| "Descriptions mirror the native `Pi` tools" overclaims | both (F4/D2) | **Fixed.** `packages/mcp/README.md` now states names and schemas mirror verbatim while descriptions adapt the native guidance (no protocol guidance channel exists). |
| "13-test protocol suite" miscount (12) | both (F5/D1) | **Fixed.** `PHASE-4.md` no longer duplicates a count (single-sourcing rule); it describes the coverage instead. |
| `--no-extensions` claim misleading: `pi --no-extensions mcp list` fails rather than "list still succeeds" | deepseek F6 | **Fixed.** `PHASE-4.md` now states the precise behaviour: a `pi -p --no-extensions` session has no `mcp__*` tools while a plain `pi mcp list` connects; the flagged subcommand fails because it belongs to the same integration. |
| Garbled "startup diagnostics and the SDK version are pinned in `package.json`" sentence | qwen D3 | **Fixed** in `packages/mcp/README.md`. |
| `npm audit` enumeration incomplete (omitted `defuddle`, `undici`, `ws`, `esbuild`) | qwen D4 | **Fixed** in `PHASE-4.md`, including the distinction that `defuddle` is a production dependency while the rest are development-tree. |
| Build script still prints "CLI and runtime" after gaining the server entry | deepseek F8 | **Fixed.** |
| Queue-level error results attributed to a pseudo-tool "operation" | qwen C1 | **Fixed.** Each submission carries per-tool cancelled/busy result factories; the queue keeps a fallback for shutdown-time submissions. |
| No unit tests for `OperationQueue`; two paths uncovered | qwen T1 | **Fixed.** `packages/mcp/test/queue.test.ts` pins ordering, the concurrency bound, overflow, abort-before-start, already-aborted submission, handler-contract breach and close-time draining. |
| Protocol suite asserts no full schema equality against the frozen contract | qwen T1.3 | **Fixed.** The listing test now deep-equals every served `inputSchema` against `test/fixtures/native-contract/tools.json` parameters. |

### Retracted or Weakened

- **Wrapper versus SDK backpressure** (qwen's initial suspicion): cleared by qwen's own code walk; the wrapper preserves drain semantics.
- **`structuredContent` without an output schema** (potential INTERNAL_ERROR): cleared against the installed SDK 2.3.0 source; flagged as a version-coupled assumption to recheck on SDK bumps.

### Later-Phase or Out-of-Scope (Recorded, Not Fixed Here)

- **Live credentials in `/tmp` during E2E** (deepseek F7, qwen O1): pre-existing suite-wide convention (`lib.sh` + every scenario), trap-cleaned `0700` directories, not introduced by this phase. Changing it means changing `lib.sh` for all scenarios; flagged for the owner rather than altered mid-phase.
- **`maxUrls` schema description says "default: 8" while the shared default is 10** (qwen O2): pre-existing stale text in the frozen native contract (`src/core/schemas.ts`); fixing requires a native-contract change with fixture regeneration, explicitly out of Phase 4 scope. Recorded so it is not lost.
- **Import-time framing test proves the mechanism, not the real deferred SDK import** (deepseek F9): the built CLI's guard-before-deferred-import ordering was verified in `dist/cli.js` by both reviewers; the noisy fixture covers the three write classes. Accepted as a documented coverage boundary.
- **Standard-error EPIPE exposure** (qwen, related note): pre-existing, same Node semantics, not introduced by this diff; no user-visible protocol impact.
- **Test workspace cleanup hygiene** (qwen T1.2): scratch accumulates under `TMPDIR`; consistent with existing suites.

## Verification of the Corrections

After the fixes, the orchestrator re-ran: `npm run build:all`, `npm run test:all` (native 444, standalone 41), the contract type check, frozen native fixtures (unchanged, not regenerated), isolated structural smoke, `./test/run-e2e-publish-local.sh`, `npm run test:mcp:install` (including the new EPIPE assertion, `epipeExit: 0`), and the live `./test/e2e/11_mcp_stdio.sh` host smoke (passed on the first attempt). The standalone total moved from 34 to 41 (six queue unit tests and the EPIPE protocol test); the badge follows the aggregate.

## Follow-Up

Both reviewers re-checked the corrected tree against their own findings and re-ran the deterministic gates.

- **qwen: FOLLOW-UP VERDICT: PASS.** All eight corrections verified as real and sufficient; the R1 verbatim crash repro against the rebuilt artifact now exits 0 with clean diagnostics. One residual minor note: the queued-cancellation marker wait could be satisfied by the first request's own enqueue marker.
- **deepseek: FOLLOW-UP VERDICT: FAIL**, solely on that same residual (F2): `includes("FIXTURE_QUEUE_QUEUED")` fires for the first request too, so the wait did not prove the queued request reached the server.
- **Correction:** the test now waits for the **second** `FIXTURE_QUEUE_QUEUED` marker, which can only fire once the second request has actually been pushed into the pending queue.
- **deepseek: FOLLOW-UP 2 VERDICT: PASS**, with a structural argument (single hook call site, exactly two submissions, the first operation still active) and three independent clean-iteration probes showing two markers and exactly one started completion. F2 closed; no other finding re-opened.

The tracked tree is the authority on the final state.

## Limits

Neither reviewer re-ran live scenarios; the single-host live certification remains `test/e2e/11_mcp_stdio.sh`. _Claude Code_/_Codex_ interoperability, multi-connection behaviour and hostile-workspace resistance remain Phase 5/6 scope. The review does not cover the pre-existing advisory list beyond confirming nothing was introduced or upgraded here.
