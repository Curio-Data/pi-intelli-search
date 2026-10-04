# Phase 6 Results

## Outcome

Phase 6 implements Documentation, Integration and Release Readiness, short of publication. The root README documents the three installation routes (native `Pi` extension, direct MCP configuration, host plugins), [the compatibility matrix](../../../docs/COMPATIBILITY.md) records exact tested host versions and artifacts with explicit evidence classes, CI validates the generated plugin bundles, and the release workflow selects one package per release tag. The native version metadata is reconciled with `main`'s unreleased 0.14.1 without inheriting its dated changelog heading. No release, tag, staged publication or registry publication has occurred; the owner's release hold remains in force.

Publication is now the only remaining implementation-plan work, and it is gated on: explicit owner approval, a trusted-publisher binding for `@curio-data/mcp-intelli-search` (a maintainer action on `npmjs.com`), the full paced live suite, and separate review of the release-workflow change.

## Implementation

| Change | Detail |
|---|---|
| Native version reconciliation | `package.json` and `package-lock.json` bumped to 0.14.1; `DEFAULT_HISTORY` gained a `0.14.1` entry (defaults unchanged); the TUI fix stays under `Unreleased` in CHANGELOG.md with no dated heading or release link, per [Post-Phase 5 Checkpoint](POST-PHASE-5.md). The branch's shared-policy and forwarding modules were preserved; nothing was cherry-picked from `b0f49aa` |
| README installation routes | New [Use With Other Hosts](../../../README.md#use-with-other-hosts) section: route table, direct-MCP registration example (narrow JSON, key supplied through the environment), Claude Code and Codex plugin commands, cold-start and duplicate-tool-set cautions. The native route is unchanged and prominent |
| Compatibility matrix | New `docs/COMPATIBILITY.md`: five evidence classes (deterministic, live `Pi` native, live credential-free host, one-time recorded, local-tarball), native host versions, standalone runtime versions, plugin host versions, shared constraints |
| Baseline host load checks | Dependency-isolated installs of `@earendil-works/pi-coding-agent` 0.81.1 and 0.86.0 under `.tmp/mcp-phase6/hosts/` drove real `intelli_search` calls through the branch build: legacy provider dispatch on 0.81.1, registry-facade dispatch on 0.86.0. Tool execution confirmed via `--mode json` events |
| Architecture and components | `docs/ARCHITECTURE.md` gained protocol-serving and host-plugin sections and an extended tree; `docs/COMPONENTS.md` attributes `@modelcontextprotocol/server` 2.3.0 and drops the stale no-SDK checkpoint note |
| Standalone guide | `packages/mcp/README.md` gained client-timeout guidance and a troubleshooting table (startup diagnostics, strict-config failures, credential snapshotting, free-tier pacing, cache readability). The "not published" notice remains and is listed in the MCP release checklist for removal at first release |
| CI | `.github/workflows/ci.yml` runs `npm run check:plugins` and covers pushes to `plan/mcp-intelli-search`. The existing gates (build:all, test:all, contract type check, both tarball installs) were already present |
| Release workflow | `.github/workflows/release.yml` selects exactly one package by tag prefix (`vX.Y.Z` native, `mcp-vX.Y.Z` MCP; anything else fails), verifies the tag against the package manifest, requires `check:plugins` for MCP releases, and builds and tests both artifacts before `npm stage publish`. Committed separately (`fe74ca0`) for independent review |
| Release documentation | Root `AGENTS.md` documents the two-package release policy, the MCP release checklist (including plugin-catalog regeneration and the post-publication registry-pin gate) and the per-package trusted-publisher requirement |

## Verification

Verification ran on `plan/mcp-intelli-search` (`db0441d` entry, `ff020fb` and `fe74ca0` commits), using [_Node.js_](https://nodejs.org/) `v24.19.0`, Linux x86-64, `Pi` `1.0.2`, Claude Code `2.1.289` and Codex CLI `0.144.5`. Private logs and the isolated host installs reside under gitignored `.tmp/mcp-phase6/`; they are not required to continue.

| Gate | Result and Scope |
|---|---|
| Entry Checks | Passed before editing: `build:all`, `test:mcp` (41), `check:plugins`, frozen native-contract suite (12), core/adapter/workspace suites (56), contract type check |
| `npm test` | 467 passed, including the migration guard reading the live 0.14.1 version |
| `npm run test:smoke` | Passed |
| Post-change gates | `build:all`, `test:all` (467 + 41), `check:plugins`, contract type check, typographic em-dash scan: all clean |
| Baseline host load check | Passed: `Pi` 0.81.1 (legacy dispatch) and 0.86.0 (facade dispatch), dependency-isolated installs, real `intelli_search` executions confirmed by tool events |
| `test/e2e/01_main.sh` | Passed: full native pipeline, completed telemetry recording `extensionVersion` 0.14.1 |
| `test/e2e/11_mcp_stdio.sh` | Passed: real research through `Pi`'s native MCP client, `mcp` adapter identity in telemetry |
| `test/e2e/12_plugin_bundles.sh` | Passed: 20 checks, 0 failures, 0 skips, credential-free, with both host CLIs present |
| Workflow files | YAML parses; the release workflow has not executed (no release event). Its package-selection logic is unexercised evidence |
| Branch CI | First run surfaced a latent fixture-harness defect (below); the corrected run passed all gates on Node 22, including both tarball installs and the plugin drift check |

**CI-found harness defect.** The first branch CI run (Node 22) failed three subtests that pass on Node 24: Node 22 prints an `ExperimentalWarning` for `mock.timers` through `console.error` after the fixture capture mock is installed, polluting the `diagnostics` array the frozen fixtures compare. The fixtures themselves were correct; the harness now drops that specific warning (`8da3a9b`), keeping the comparison independent of the host Node.js version. The full native (467) and MCP (41) suites were verified on both Node 22.23.3 and Node 24.19.0 before the fix was pushed.

Codex authentication was repaired by the operator before this phase; no credential file was copied, inspected or used by any check. The credentialed one-time host observations from Phase 5 were not re-run, per the standing prohibition.

## Limitations

- The full paced live suite (`./test/run-e2e-all.sh`, all twelve scenarios) was not run this phase: scenarios 01, 11 and 12 ran green. The complete suite remains a pre-release gate and must pass before any tag.
- The release workflow's package-selection and version-verification steps have not executed; first use is itself evidence and should be watched.
- The `@curio-data/mcp-intelli-search` trusted-publisher binding does not exist yet and cannot be created from the repository. Without it the `mcp-v*` release path fails at the staging step.
- Post-publication registry-pin verification (plugins installing the published version through `npx`) remains an open gate, labelled separately from the local-tarball evidence class.
- No full research call has been driven through either host plugin; per-host live research in _Claude Code_ and _Codex_ remains open evidence in the acceptance matrix.
- The eventual native release version from this branch is the owner's decision at release time; the reconciled 0.14.1 metadata only matches `main`'s unreleased state and does not presuppose the next tag. The owner has indicated 0.20 is under consideration.
- The peer review found and fixed one release-time defect (the prerelease dist-tag guard) plus documentation and hygiene items; see [Phase 6 Peer Review](PHASE-6-REVIEW.md). Corrections are committed at `96b463a`. A cold-start handover remains to be scheduled before the branch is offered for merge.

## Continuation

Publication preparation, in order, each step requiring its own approval:

1. Owner reviews the release-workflow change (`fe74ca0`, amended by `96b463a`) and creates the `@curio-data/mcp-intelli-search` trusted-publisher binding on `npmjs.com` (`release.yml`, `npm stage publish` only), resolving the bootstrap prerequisite recorded in root `AGENTS.md` (the package must exist; the flow for a not-yet-existing package is owner-verified).
2. A cold-start handover of the corrected Phase 6 tree.
3. Full paced live suite `./test/run-e2e-all.sh` immediately before tagging.
4. On explicit approval, the MCP release checklist in root `AGENTS.md` (version bump decision, not-published notice removal, plugin-catalog regeneration, tag `mcp-vX.Y.Z`), then the post-publication registry-pin gate recorded in [the compatibility matrix](../../../docs/COMPATIBILITY.md).
5. Merge to `main` only after the MCP package resolves on the registry; the native release version and CHANGELOG heading are decided at that point.

The acceptance matrix in the [implementation plan](IMPLEMENTATION.md#acceptance-matrix) is satisfied except the cells listed as open in Limitations: Publication (approval, trusted publisher, both artifacts) and Live Behaviour in plugin hosts.
