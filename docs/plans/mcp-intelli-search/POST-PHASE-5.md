# Post-Phase 5 Checkpoint

## Direction and Release Hold

Phase 6, Documentation, Integration and Release Readiness, remains the next implementation phase. The owner deferred a separate release for the terminal user interface (TUI) fix and directed that it ship with this branch. Do not create a release, tag, staged publication or registry publication without renewed explicit approval. Phase 6 development can proceed without publishing.

The native preparation commit `b0f49aa` is already on `main` and carries unreleased version metadata. Its commit subject, `Release v0.14.1`, is not evidence of publication: inspection on 2026-10-04 found no corresponding tag or GitHub release. The branch `plan/mcp-intelli-search` still uses its existing native package version and carries the equivalent shared-engine fix at `e9af554`. Do not revert shared history or automatically cherry-pick the native preparation commit across the refactored source. Reconcile native version metadata, default history, lockfile and changelog deliberately during Phase 6 release preparation, then regenerate plugin pins only if the MCP package version changes.

Reconciliation touches `src/llm.ts`, `src/settings.ts`, `src/fetch.ts`, `src/tools/intelli-research.ts`, `test/llm.test.ts`, `package.json`, `package-lock.json`, `README.md` and `CHANGELOG.md`. Preserve the branch's shared policy and forwarding modules instead of accepting the older inline implementations. Keep the README badge's `test:all` scope, not `main`'s native-only badge. Keep the deferred fix under `Unreleased`; do not inherit a dated release heading or release link as proof that publication occurred. Retain direct native retry tests alongside core and adapter tests.

The prior hold on merging the plugin catalogs into `main` remains: their registry pin must resolve before they are offered as an installation route. Treat that as a distribution constraint, not permission to publish. Phase 6 must reconcile release-workflow ordering with this constraint; do not work around it by publishing automatically.

[_Codex_](https://developers.openai.com/codex/plugins) authentication recovery belongs to the operator. No credential file may be copied into a disposable profile, inspected for this handoff or tested by launching another authenticated Codex session. Authentication recovery is not a prerequisite for documentation, continuous integration (CI) work or deterministic tests. Record any blocked live host verification separately.

## TUI Diagnostic Fix

The observed line, `[pi-intelli-search fetch] <url>: defuddle=<n> markdown=<n> → picked <variant>`, came from this extension's own `console.error` call. The numbers are heuristic content-quality scores from `scoreContent()`, not byte counts. Direct console writes bypass the TUI renderer; the report after upgrading to `Pi` 1.0 does not establish that an upstream regression began in that release. The community search did not identify a matching confirmed upstream issue.

The installed native package is not replaced by repository commits. While publication is on hold, an installation that still loads the published pre-fix package retains the original diagnostic line. Local testing of a fixed build is a separate operator-approved action; do not silently replace the installed extension or enable duplicate native/MCP tool sets.

The shared-core extraction had already removed the routine fetch-comparison print. Local `meta.json` telemetry retains aggregate fetch-variant winners; it does not retain the printed per-page scores. Commit `e9af554` also routes retry notices through `ModelRequest.onRetryNotice`:

- Research supplies a stage-specific callback for search, extraction, collation and cache suggestions.
- The native model client forwards that callback or supplies a no-op. Native `callLlm()` uses a silent policy logger, including direct calls without a notice callback.
- The shared policy retains its logger fallback for callers without a notice callback. In the standalone Model Context Protocol (MCP) adapter, research notices use progress when available; without a client progress token they are discarded. Catalogue preflight and standalone calls without a notice callback still use the stderr logger.

This is a fix for routine fetch and retry output, not a blanket interception of every console write. Native operation error diagnostics still use `logErr` through the operation logger, and dependency suppression is a separate mechanism. Preserve this scope when writing release notes. Retry progress is transient, not durable retry telemetry. During extraction it can temporarily replace the per-page sub-progress display until the next settled-page update. These are remaining observability limitations, not reasons to restore raw terminal writes.

## Verification and Review

The prior Phase 5 peer review and cold-start handover predate `e9af554`; they are not reviews of this follow-up. [TUI Fix Follow-Up Review](TUI-FIX-REVIEW.md) records the dedicated reviews and corrective verification. The subsequent [Phase 6 Entry Verification](HANDOVER-PHASE-6-ENTRY.md) returned `PASS WITH NOTES`: every documented entry check passed, and the remaining notes concern committing the linked documents, dependency provenance and the distinction between entry checks and full change gates.

The deterministic regression coverage includes shared-policy notice routing and logger fallback, native callback forwarding/defaults, direct `callLlm()` retries on both native dispatch paths with and without callbacks, and a source audit of direct console calls in its named pipeline modules. Frozen native fixtures must remain unchanged. The fresh-agent entry checks are maintained in the [handoff](README.md#fresh-agent-entry-checks).

## Phase 6 Boundaries

Continue with the existing [Phase 6 checklist](IMPLEMENTATION.md#phase-6-documentation-integration-and-release-readiness): distinct installation routes, architecture and component documentation, CI gates, compatibility evidence and release-workflow preparation. Preserve both independent tarball-install gates and the generated-plugin drift check. The MCP package remains unpublished, so local-tarball installation evidence and future registry-pin verification remain separate.

Do not claim a live research run in [_Claude Code_](https://code.claude.com/docs/en/plugins) or Codex from marketplace installation, skill discovery or a protocol handshake alone. The repeatable plugin scenario is credential-free. Earlier one-time Codex tool-catalog evidence used codemode; full research and browser-interface verification remain unproven. Do not rerun credentialed host checks until a safe procedure and explicit authority are established.
