# Library Review Record

P1, P2 and P3 library implementations have been independently accepted and merged with their reviewed history preserved. These are library-landing decisions, not completed stage exits, integrated feature acceptance or release approval. The frozen P0-2 bundle is unchanged.

## Accepted Candidates

The coordinator's type-only seam base is `e1cfe62745631cabed26539c09225fae707fbd5d`. It passed independent review before the builder worktrees were created. Final technical reviews ran through [_Claude Code_](https://claude.com/product/claude-code) on `claude-opus-5-5[1m]`; native transcript provenance and the 1M footer were retained separately from the requested model arguments.

| Slice | Exact Accepted Commit | Final Report |
|---|---|---|
| P1 Coordinator and Ledger | `65347ced4312ac68b0ead0a4b43d257d29684cc0` | `p1-review-r3.md` |
| P2 Run Store and Index | `d5cbb0118690a67a0c9e9421dec0239105e7f402` | `p2-review-r4.md` |
| P3 Benchmark Libraries | `c4cb3d64947d8cc2aaaff5bb251004ad068857ff` | `p3-review-r4.md` |

Reports, earlier blocked candidates, builder dispositions and provenance are retained locally under `.tmp/agents/codemode-development/` in the coordinator worktree. They do not travel with the commit. SHA-256 digests of the final report files:

```text
4a9cea51a8db4bcc3d4cbe945ce991d0374d6d5d7f945dc609fbe87fd8b08abc  p1-review-r3.md
4e14d04230698bfae00181fa550ede0e658b88afbb37670261652d86e7e9cb97  p2-review-r4.md
6ee4bc4080647072e608f4e92efa20833af7c926ad6303d09f12fd2c0bba8f11  p3-review-r4.md
```

## Review Dispositions

- P1 settlement now checks for drained ownership and deregisters atomically. Abort cascades reject dead tickets before granting or advancing pacing. Provider observation callbacks cannot throw through stale or malformed updates. Known prompt totals are preserved without counting cache components twice.
- P2 validates journalled reservation and marker identities before allocation. Report and accounting publication retain their committed state after marker rename, with an out-of-band durability diagnostic if the following directory sync fails. Initialisation crash boundaries restart safely; missing run history fails closed instead of reissuing sequences. Verified readers reject pre-existing intermediate links. Invalid new entries do not suppress valid legacy candidates.
- P3 resolves all workflow nodes through one shared transport helper per seam. Fixture integrity covers response, error, usage and timing. Statistics distinguish incomplete populations from valid zero-valued difference endpoints. The parser separates assistant usage from canonical pipeline results, recognises native and whole Model Context Protocol (MCP) result envelopes, and preserves compact token and attempt missingness.

Quota-stopped K3, Qwen and GLM attempts remain preserved and are not counted as completed reports. Only eligible native-provider fallbacks were used. The coordinator completed the final P3 parser delta after the GLM quota stop; the independent reviewer accepted that exact commit afterwards. No paid pipeline or study run occurred.

## Integration Conditions

These conditions remain open and bind the next coordinator work:

1. Wire scoped `runModelWithPolicy()` admission and the ledger below native/MCP transports. Preserve the unscoped catalogue overload, disabled SDK retries, native standalone policy and UI-safe diagnostics. Do not claim real MCP/native usage parity from hand-built arithmetic fixtures; absent cache-write observations stay unknown until a supported interpretation is established.
2. Track a parent task spanning an operation's stage chain, or call `settle()` only after the final stage has started. Once an empty lease drains, later task registration correctly receives `CLOSED`. Preserve zero-overlap runtime generation replacement and authoritative service identity.
3. Complete P2's independent field-by-field wire-schema review before reader/writer integration. Carry report/accounting durability diagnostics into operation results, enforce owned staged-file containment and pass reservations through unchanged. `candidates()` cancellation must follow the common abort path.
4. Measure C28 growth: allocation validates history under the lock; journal records remain in memory; index parsing is whole-file; an oversized index withdraws new-format suggestions rather than deleting history. Preserve the whole-parent MCP scan and its fail-closed cap. Recovery guidance must name `RUNS_MISSING`, `RUNS_INVALID`, `JOURNAL_HISTORY_CONFLICT`, `INDEX_OVERSIZED` and explicit secondary-index rebuilding.
5. Complete installed run-store, native-floor and platform gates. Fresh native and standalone tarball gates passed for the existing entry points, but do not exercise the unactivated store through those adapters. No musl prebuild ships, so the lazy lock backend is unavailable on Alpine; this limitation must be declared or a build verified before R1. Process-death tests on local encrypted btrfs are not power-loss or cross-platform durability evidence.
6. Prove replay inside actual wrappers, scoped policy and the real Codemode bridge, with loader isolation and zero pipeline network. Replay never invokes `options.fetch`. Fix the workspace/cache-index state per block, derive nodes from real prompts without guessing ambiguous calls, and keep native wall-time replay separate from injected-clock core experiments.
7. At parser integration, handle shortened/colliding MCP tool names through the host's `details.tool` identity when their marker is lost. Before capture, check real main usage and whether the request observer also sees pipeline calls. Preserve failed observer writes and their recorded sequences.

P4 schemas/configuration/fetch/adapters, P4b behaviour documentation and P5 pipeline/deadline wiring are not implemented by these library merges. Paid tranches, human calibration, confirmatory design, live gates, final combined review and publication retain their separate approvals.
