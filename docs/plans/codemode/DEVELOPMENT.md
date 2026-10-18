# Codemode Development

The owner authorised development after P0 acceptance. The coordinator committed the type-only P0-2 seams, then merged independently accepted P1 coordinator/accounting, P2 persistence/index and P3 benchmark libraries. [Library Review Record](LIBRARY-REVIEWS.md) identifies the exact accepted commits, resolved findings and binding integration conditions. The libraries are not wired into existing operations; native factory and pipeline behaviour remain unchanged.

## Central Seams

`src/core/contracts.ts` exports the new types from `src/core/execution-contracts.ts`. Existing operation contexts and function signatures remain unchanged until coordinator integration. `src/native-injection.ts` holds native-only factory and transport types; it is not exported from the shared core. Factory and policy types describe future implementations without declaring nonexistent runtime exports. The legacy mutable `ModelConfig` export remains compatible with existing callers; new coordinated identities and policy requests wrap it in `Readonly`.

`test/codemode-seams.test.ts` checks mutual assignability against the frozen core/native declarations, plus top-level property names, optionality and readonly modifiers, with the explicit legacy `ModelConfig` exception. This is not a general recursive schema-identity proof. Its compile-only consumer rejects duplicate context authorities, mutable coordinated model identities, incomplete enabled deadlines and whole-operation substitutes in transport-replay mode. The frozen specification and its acceptance record are unchanged.

## Verification

The strict accepted-plan gate, `build:all`, `test:all`, native-contract and library type checks, generated-document drift checks and low-severity dependency audit passed on the combined library tree. Final logs are retained locally under `.tmp/codemode-development/final-gates/` in the coordinator worktree; earlier combined and seam-only runs remain under `combined-gates/` and `gates/` in the same parent directory. Native and standalone fresh-tarball install gates also passed. Native plain-node registration resolved `pi-ai` 1.3.0; the standalone gate exercised isolated native fetch assets and protocol framing with injected models. These prove the existing entry points install and load, not that the unactivated run store works through either adapter. These artefacts are not part of the commit and do not travel to builder worktrees. No live research end-to-end or paid measurement was run.

## Next Stage

The library candidates branched from seam commit `e1cfe62745631cabed26539c09225fae707fbd5d` and passed the strict accepted-plan gate before edits. Their final reviewed histories are merged without rewriting the P0 specification commit. Library landing does not pass the full T09–T32 rows: adapter and real-host portions remain open.

Next is coordinator-owned P4: integrate the scoped policy and runtime lifetimes, full results/progress, validated configuration, bounded fetch, native/MCP adapters and protocol admission. P2's field-by-field wire-schema review precedes persistence integration. Actual native transport injection and wrapper/bridge replay still require proof. P5 alone wires streaming/deadline/snapshot/drain into research; no library merge activates it. Keep P4b archive/guidance changes behind proved replacement behaviour, as the contract requires. [BUILDER-HANDOFF.md](BUILDER-HANDOFF.md) carries the binding review conditions.

Exact paid tranches, live quota-consuming gates and publication remain unapproved. R1, the shared dual-package minor, and R2, the native-only patch, retain the boundaries in [C01](CONTRACT.md#c01-release-boundaries). No research-history policy work is included.
