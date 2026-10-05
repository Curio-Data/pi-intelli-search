# Phase 6 Peer Review

## Scope and Method

Two independent native reviewers, `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash`, each covered the **whole** committed Phase 6 change on `plan/mcp-intelli-search` (commits `ff020fb` through `6057ae3`, reviewed at HEAD `6057ae3`), working diff-first in the main checkout under read-only briefs with distinct lenses. qwen took the release-wiring lens (release workflow, CI, version reconciliation, release-flow tracing); deepseek took the documentation-fidelity lens (every user-facing command, version, path and claim against the tree and the recorded evidence, plus style rules 1-11). qwen re-ran the deterministic gates (`build:all`, `test:all`, `check:plugins`, contract type check); deepseek ran the lint-level checks (`check:plugins`, em-dash lint, `claude plugin validate --strict` on plugin and marketplace); scratch under `.tmp/agents/2026-10-04-p6-review/work/`. Neither ran e2e scripts, created tags, or contacted npm for writes; both verified external-format claims against live read-only sources and the installed npm/CLI source, with claim-basis tags on every claim. Model provenance was confirmed from the session transcripts (`agent-provenance`), not the agents' self-reports.

Reports: `.tmp/agents/2026-10-04-p6-review/reports/{qwen,deepseek}.md` (gitignored; the report file, not the pane, was the authority). The orchestrator verified every finding against the tree before applying corrections (`96b463a`).

## Findings and Dispositions

### Corrected

| Finding | Reviewer | Disposition |
|---|---|---|
| **`npm stage publish` throws on a prerelease version without an explicit dist-tag**, breaking the first MCP release (`0.2.0-alpha.0`) at the final step and the repository's own documented pre-release pipeline test | qwen F1 (HIGH) | **Fixed.** The select step derives `dist_tag` from the version's first prerelease identifier (`0.2.0-alpha.0` -> `alpha`), else `latest`; the stage step passes `--tag "$DIST_TAG"` via env. Verified against npm 11.17.0 source (`StagePublish extends Publish`; the guard requires the default tag) and by simulation across six tag shapes. AGENTS.md's pipeline-test section reconciled. |
| The MCP trusted-publisher binding may be impossible to create as documented: npm lists _package must exist_ as a trust-configuration prerequisite, and a never-published package has no package page | qwen F2 | **Documented.** AGENTS.md records the bootstrap prerequisite, the staged-endpoint/`createStagedPackage` route, the candidate flows and the owner-verification step before the first `mcp-v*` release. The npmjs.com UI question is assigned to the maintainer; it cannot be settled from the repository. |
| README presented all three installation routes as usable with no publication-status caveat; a native release could ship a README advertising routes that 404 | qwen F3, deepseek F5 | **Fixed.** `Use With Other Hosts` carries a **Publication Status** notice (routes cannot resolve the pinned version until first publication; local-tarball path named); the MCP release checklist now removes both not-published notices at first release. |
| `@modelcontextprotocol/server` attributed as MIT; the SDK is Apache-2.0 (MIT transition), and the "all dependencies are MIT or ISC" compliance claim was stale (pi-ai was already Apache-2.0) | deepseek F1 | **Fixed.** COMPONENTS.md states Apache-2.0 with the transition note; the compliance line reads MIT/ISC/Apache-2.0; root NOTICE gained the SDK entry, which the build copies into the MCP tarball. Verified against installed packages and live registry metadata. |
| Route A called its unpinned `npx` example "pinned" | deepseek F2, qwen F3 sub-nit | **Fixed.** The wording explains how to pin (`@<version>`) and that the plugin routes pin; the example stays unpinned by design (single-sourcing rule). |
| GitHub expressions interpolated directly into `run:` shell text in the verify step | qwen F4 | **Fixed.** Verify and stage steps use `env:` indirection (`TAG_VERSION`, `PKG_DIR`, `DIST_TAG`); a regex scan finds zero remaining `${{ }}` in any `run:` block. |
| Stale closure lines: `packages/mcp/README.md` called release automation later work; `IMPLEMENTATION.md` called Phase 6 the next step | deepseek F3, F4 | **Fixed.** Both name the shipped state and what remains gated. |
| First-stage provenance auto-signing likely skipped for a brand-new package (visibility lookup has nothing to inspect) | qwen F5 | **Documented** in the AGENTS.md release bullet. |
| Host-local `dist/.tmp` tsbuildinfo debris packed into the native tarball on this machine | qwen F6 | **Fixed.** `files` gained `!dist/.tmp`; debris deleted; exclusion proven empirically (a planted probe file does not pack). |
| README re-linked OpenRouter without italics, against the first-mention rule | deepseek F6 | **Fixed.** Plain reference. |
| Workflow version skew (CI v4/Node 22 vs release v6/Node 24) undocumented | qwen F7 | **Documented as deliberate** (ci.yml comment: Node 22 proves the engines floor, release stages on Node 24). |
| Handoff entry checks named a `phase6` scratch path for the release-preparation reader | deepseek beyond-task 1 | **Fixed.** `.tmp/mcp-release`. |

### Dismissed With Reasons (reviewer accepted)

- **Troubleshooting table quotes leading substrings of the real stderr messages** (deepseek beyond-task 3): deliberate, keeps symptoms greppable; substrings confirmed against `cli.ts`/`config.ts`.
- **Route A `env` example omits `OPENROUTER_API_KEY`** (deepseek beyond-task 4): deliberate; committing keys to host config files is the failure mode the prose steers around, and Route C documents the forwarded-by-name pattern for filtered environments.

### Recorded, Not Fixed Here

- **Numeric first prerelease identifier** (qwen follow-up residual): `mcp-v1.0.0-0.1` would derive `dist_tag=0`, which npm rejects as a SemVer-range tag name at staging. No documented procedure produces such versions; the failure is late but safe and self-explanatory.
- **Whether a staging-only trusted publisher may set a non-`latest` dist-tag at stage time**: unverified until the first live `mcp-v*-alpha*` run; recorded in AGENTS.md.
- **Release workflow execution**: still unexercised evidence by design; the first real tag is itself the test, watched per PHASE-6.md continuation.

### Orchestrator Verification of the Findings

Every corrected finding was independently confirmed before amendment: the npm prerelease guard read in the installed npm 11.17.0 source; the SDK license read from installed packages (`Apache-2.0`, transition LICENSE) and live registry metadata; the select-step logic simulated across stable, prerelease, numeric-prerelease, malformed and double-prefix tags; the documentation claims re-grepped against the tree. The version-reconciliation instruction table in qwen's report (Section 2, all seven POST-PHASE-5 instructions **Honoured**, all Observed) was spot-checked against `git show b0f49aa` and the branch tree.

## Verification of the Corrections

After the fixes (`96b463a`), the orchestrator re-ran: `npm run build:all`, `npm run test:all` (467 native + 41 MCP, 0 fail), `npm run check:plugins`, the contract type check, `npm pack --dry-run` (170 files, zero tsbuildinfo), the tracked-markdown em-dash scan (clean) and a YAML parse of both workflows. The select-step bash was re-simulated after amendment.

## Follow-Up

Both reviewers re-checked the corrected tree against their own findings and re-ran their gates.

- **qwen: FOLLOW-UP: PASS.** Every finding confirmed resolved or correctly documented; the dist-tag derivation re-simulated against npm's guard semantics; the `!dist/.tmp` negation proven with a planted probe file; zero remaining `${{ }}` interpolations in `run:` blocks. One residual noted (numeric prerelease identifiers, above).
- **deepseek: FOLLOW-UP: PASS.** All six findings and one beyond-task item confirmed resolved with `path:line` citations; both dismissals accepted with the owners' reasons; the correction commit's new mechanics (dist-tag, env indirection, files negation) spot-checked for regressions.

The tracked tree is the authority on the final state.
