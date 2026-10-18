# Codemode Development

The owner authorised development after P0 acceptance. The coordinator has added type-only implementation seams for P0-2. No execution, accounting, persistence or native factory implementation is activated by this change.

## Central Seams

`src/core/contracts.ts` exports the new types from `src/core/execution-contracts.ts`. Existing operation contexts and function signatures remain unchanged until coordinator integration. `src/native-injection.ts` holds native-only factory and transport types; it is not exported from the shared core. Factory and policy types describe future implementations without declaring nonexistent runtime exports. The legacy mutable `ModelConfig` export remains compatible with existing callers; new coordinated identities and policy requests wrap it in `Readonly`.

`test/codemode-seams.test.ts` checks mutual assignability against the frozen core/native declarations, plus top-level property names, optionality and readonly modifiers, with the explicit legacy `ModelConfig` exception. This is not a general recursive schema-identity proof. Its compile-only consumer rejects duplicate context authorities, mutable coordinated model identities, incomplete enabled deadlines and whole-operation substitutes in transport-replay mode. The frozen specification and its acceptance record are unchanged.

## Verification

The strict accepted-plan gate, `build:all`, `test:all`, native-contract type check, generated-document drift checks and low-severity dependency audit passed. Logs are retained locally under `.tmp/codemode-development/gates/` in the coordinator worktree; they are not part of the commit and do not travel to builder worktrees. These checks establish baseline regressions and type compatibility, not future runtime acceptance. No live end-to-end or paid measurement was run.

## Library Entry

This descendant commits the required central seams. Library builders start from it or a later descendant carrying the same accepted bundle and must pass `npm run check:codemode-plan` there. P1 owns coordinator/accounting libraries; P2 owns run-store/index libraries and reviewed disk schemas; P3 owns recorder/replay/parser/statistics libraries. Central schemas, settings, adapters, injection wiring and research integration remain coordinator-owned. [BUILDER-HANDOFF.md](BUILDER-HANDOFF.md) carries the binding review conditions.

Exact paid tranches, live quota-consuming gates and publication remain unapproved. R1, the shared dual-package minor, and R2, the native-only patch, retain the boundaries in [C01](CONTRACT.md#c01-release-boundaries). No research-history policy work is included.
