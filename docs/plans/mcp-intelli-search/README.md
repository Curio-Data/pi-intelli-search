# MCP Implementation Handoff

## Direction

Extend `intelli-search` from one repository and one shared research engine. Preserve the native `@curio-data/pi-intelli-search` package and add `@curio-data/mcp-intelli-search`, a standalone Model Context Protocol (MCP) server. Provide thin [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) plugin bundles around that server.

The owner approved the architecture and specified the MCP package name on 2026-10-03. The planning branch is `plan/mcp-intelli-search`. Phase 0 records dependency evidence and deterministic native compatibility fixtures. Phase 1 introduces host-neutral contracts, a native model adapter and explicit cache paths. Phase 2 moves operations, shared helpers and model policy into the core, with workspace-local documentation staging and injected telemetry identity. Phase 3 adds the standalone runtime and independently installable package, with strict configuration, explicit workspace ownership and an OpenRouter transport. Phase 4 adds protocol serving over standard input/output (stdio) through the official split server package, with bounded queueing, progress, cancellation, shutdown and clean framing. Phase 5 adds the generated host plugin bundles, repository marketplaces and shared guidance. Phase 6 adds the three installation routes, the compatibility matrix with real baseline load checks, extended CI and two-package release wiring, and reconciles the native version metadata with `main`'s unreleased 0.14.1. Publication remains unimplemented and is the only remaining work: it is gated on explicit owner approval, a trusted-publisher binding for the MCP package, the full paced live suite and separate review of the release workflow.

## Current Checkpoint

Read [Phase 6 Results](PHASE-6.md) and [Phase 6 Peer Review](PHASE-6-REVIEW.md) before continuing. They record the documentation, CI, compatibility and release-wiring work at `ff020fb` and `fe74ca0`, the verification including real load checks on `Pi` 0.81.1 and 0.86.0, the independent two-reviewer pass and its corrections at `96b463a` (including the prerelease dist-tag fix), the open gates and the ordered publication-preparation steps. The earlier [Post-Phase 5 Checkpoint](POST-PHASE-5.md) records the TUI diagnostic fix at `e9af554`, the owner's explicit release hold, the remaining console-diagnostic scope and the rule against further credential-copy tests; its release hold and credential rules remain in force. This handoff does not authorise publication.

## Reading Order

1. Read root [`AGENTS.md`](../../../AGENTS.md), including compatibility, testing, documentation and release rules.
2. Read [Research and Decisions](RESEARCH.md) for the approved direction, inspected source revision, official references and evidence limitations.
3. Read [Phase 0 Results](PHASE-0.md) and the [fixture guide](../../../test/fixtures/native-contract/README.md) for verified interfaces, baseline contracts and test commands.
4. Read [Phase 1 Results](PHASE-1.md) and [Phase 1 Peer Review](PHASE-1-REVIEW.md) for implemented interfaces, the cache-path correction, independent findings and current verification.
5. Read [Phase 2 Results](PHASE-2.md) and [Phase 2 Peer Review](PHASE-2-REVIEW.md) for the implemented operations, shared policy, review corrections, staging, telemetry identity and verification limits.
6. Read [Phase 3 Results](PHASE-3.md), [Phase 3 Peer Review](PHASE-3-REVIEW.md) and the [standalone configuration guide](../../../packages/mcp/README.md) for runtime entrypoints, provider evidence, strict validation and installation verification.
7. Read [Phase 4 Results](PHASE-4.md) and [Phase 4 Peer Review](PHASE-4-REVIEW.md) for protocol serving, queueing, framing, host-interoperability findings, independent findings, follow-up verdicts and verification limits.
8. Read [Phase 5 Results](PHASE-5.md) and [Phase 5 Peer Review](PHASE-5-REVIEW.md) for the generated plugin bundles, empirical host behavior, launcher design, evidence classes, the credential-rotation incident, independent findings, follow-up verdicts and verification limits.
9. Read [Post-Phase 5 Checkpoint](POST-PHASE-5.md) for the release hold and credential rules, then [Phase 6 Results](PHASE-6.md) and [Phase 6 Peer Review](PHASE-6-REVIEW.md) for the documentation, CI, compatibility and release-wiring work, the reviewed corrections, the verification and the open publication gates, then [Implementation Plan](IMPLEMENTATION.md) for the target layout, compatibility contract, build and dependency boundaries, phased work and acceptance matrix.
10. The next work is publication preparation, not a new implementation phase. Check the current working tree and run the native fixture suite before editing; do not regenerate its expected files to hide a regression.

The reviewed Phase 2 implementation is the historical `86b1e4e` checkpoint. Phase 3 continues from `0c26972` and is committed as `59a3fa4` on `plan/mcp-intelli-search`. Phase 4 continues from `1b09318` and Phase 5 from `67be4e4`; use the branch tip rather than resetting to a historical checkpoint.

The handoff is self-contained in tracked documentation. The optional `.search/` cache and `.tmp/` verification logs are gitignored and are not required to understand or implement the plan.

## Fixed Requirements

- Use exactly `@curio-data/mcp-intelli-search` for the new npm package.
- Keep the existing native `Pi` package name, entry points, installation route and supported baseline.
- Share pipeline implementation, not host credential stores or mutable execution contexts.
- Keep standalone dependencies out of the native extension's runtime boundary and host libraries out of the MCP package.
- Start with local standard input/output (stdio) transport, explicit provider configuration and explicit workspace ownership.
- Preserve existing research semantics, cache formats and local-only telemetry.
- Treat plugin catalogs as distribution metadata, not separate implementations.
- Publication is on hold at the owner's request. The TUI fix is already on this branch (`e9af554`); do not create a separate native patch release or automatically cherry-pick `b0f49aa`. Require renewed explicit approval before any release or staged npm publication.
- Do not merge `plan/mcp-intelli-search` to `main` before `@curio-data/mcp-intelli-search` is published: the committed plugin catalogs pin a registry version that must resolve at install time.

## Handover Verification

Before Phase 1, a fresh `Pi` session using native `zai/glm-5.3` reviewed the Phase 0 handoff without prior conversation, memory or research-cache access. Its verdict was PASS WITH NONBLOCKING NOTES; both entry checks passed. The documentation notes have been incorporated. See [Cold-Start Handover Review](HANDOVER-GLM.md) for scope, provenance, changes and limitations. This historical review does not cover the Phase 1 implementation; its evidence is recorded in [Phase 1 Results](PHASE-1.md#verification).

The subsequent [Phase 1 Peer Review](PHASE-1-REVIEW.md) used two independent native reviewers, `zai/glm-5.3` and `deepseek/deepseek-flash`. Neither found a blocker. The custom-cache instruction defect was fixed, contract comments were clarified, and both reviewers checked the follow-up changes. The review record distinguishes corrected findings, a retracted false positive and later-phase work. These reviews do not cover Phase 2. The subsequent [Phase 2 Peer Review](PHASE-2-REVIEW.md) used independent native `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash` reviewers. Both final verdicts were `PASS` after corrections and follow-up checks. The [Phase 3 Peer Review](PHASE-3-REVIEW.md) and [Phase 4 Peer Review](PHASE-4-REVIEW.md) used the same two reviewers independently; each phase reached final `PASS` verdicts from both after corrections and follow-up checks on the corrected tree. The [Phase 5 Peer Review](PHASE-5-REVIEW.md) used the same reviewers again and reached final `FOLLOW-UP: PASS` verdicts from both after corrections; one finding was formally retracted as a false positive with corrected probe evidence.

A subsequent fresh native `zai/glm-5.3` agent verified the committed Phase 2 handoff without earlier conversation, memory or research-cache access. It reconstructed Phase 3 and passed every documented entry check. [Phase 2 Cold-Start Handover](HANDOVER-PHASE-2.md) records its initial `PASS WITH NONBLOCKING NOTES` verdict, evidence limits, documentation clarifications and subsequent documentation-only `PASS`.

A fresh native `zai/glm-5.3` session subsequently verified the committed Phase 3 handoff without prior conversation, memory or research-cache access. It reconstructed Phase 4 and passed every documented entry check after `npm ci`. [Phase 3 Cold-Start Handover](HANDOVER-PHASE-3.md) records its initial `PASS`, the documentation-only clarifications and follow-up `PASS`.

A fresh native `zai/glm-5.3` session likewise verified the committed Phase 4 handoff at `a1c67e2`. It reconstructed Phase 5 as the next step and passed every documented entry check without credentials. [Phase 4 Cold-Start Handover](HANDOVER-PHASE-4.md) records its initial `PASS WITH NONBLOCKING NOTES`, the three documentation corrections (stale plan pointers, an orphaned review record, an unrecorded schema caveat) and the documentation-only follow-up `PASS`.

A fresh native `zai/glm-5.3` session verified the Phase 5 handoff on the pre-commit working tree (base `67be4e4` plus the full Phase 5 change). It reconstructed Phase 6 as the next step, passed every documented entry check and independently verified the Phase 5 facts against the tree. [Phase 5 Cold-Start Handover](HANDOVER-PHASE-5.md) records its `PASS WITH NONBLOCKING NOTES` verdict and the two documentation corrections applied afterwards.

A further fresh native `zai/glm-5.3` session verified the corrected post-Phase 5 handoff, including the TUI port and release hold. [Phase 6 Entry Verification](HANDOVER-PHASE-6-ENTRY.md) records its `PASS WITH NOTES` verdict, successful entry checks and the limits of that read-only pass.

A fresh native `zai/glm-5.3` session then verified the committed Phase 6 tree at `a8484d3`, after the peer-review corrections. [Phase 6 Cold-Start Handover](HANDOVER-PHASE-6.md) records its `PASS WITH NONBLOCKING NOTES` verdict, the verbatim entry checks and eight tree facts verified, and the two note dispositions. This is the current cold-start evidence; it covers the Phase 6 handoff, not publication readiness.

## Fresh-Agent Entry Checks

Resume from `plan/mcp-intelli-search`, not `main`. Fetch `origin` and inspect the working tree before switching branches or pulling. Preserve unrelated changes; do not reset or overwrite them. With a clean checkout, use `git switch plan/mcp-intelli-search` and `git pull --ff-only origin plan/mcp-intelli-search`.

Run `npm ci` if dependencies are absent, differ from the committed lockfile or their provenance is uncertain. `npm ls --depth=0` detects missing or invalid top-level dependencies but does not establish exact lockfile equivalence; use a clean install when in doubt. Then run these checks from the repository root:

```bash
mkdir -p .tmp/mcp-release
export TMPDIR="$PWD/.tmp/mcp-release"
npm run build:all
npm run test:mcp
npm run check:plugins
node --import tsx --test test/native-contract.test.ts
node --import tsx --test test/core-*.test.ts \
  test/native-model-client.test.ts test/workspace-paths.test.ts
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
```

Read the documents in the order above before editing. The entry checks are deterministic and require no provider credentials. The complete change gates, including isolated structural smoke and live verification, are in the [implementation plan](IMPLEMENTATION.md#verification-commands). Do not infer that optional local logs, cached research or prior conversation are needed to continue.

## Next-Agent Brief

> Continue with publication preparation as ordered in [Phase 6 Results](PHASE-6.md#continuation). Publication is explicitly on hold; every step requires its own owner approval. The release workflow (`fe74ca0`, amended by reviewed corrections at `96b463a`) awaits separate owner review, and `@curio-data/mcp-intelli-search` needs its own trusted-publisher binding on `npmjs.com` (`release.yml`, `npm stage publish` only) before any `mcp-v*` tag; the native binding does not cover it, the package-must-exist bootstrap prerequisite is recorded in root `AGENTS.md`, and the agent cannot create it. The Phase 6 peer review is closed with two FOLLOW-UP: PASS verdicts; a cold-start handover of the corrected tree is the remaining review evidence. The full paced live suite `./test/run-e2e-all.sh` (including `11_mcp_stdio.sh` and `12_plugin_bundles.sh`) must pass immediately before any tag. Follow the MCP release checklist in root `AGENTS.md`: version decision in `packages/mcp/package.json`, lockfile sync, removal of the not-published notice, `npm run generate:plugins` plus `npm run check:plugins`, CHANGELOG entries with the `mcp-` prefix, and the post-publication registry-pin gate recorded separately from the local-tarball evidence class. Merge `plan/mcp-intelli-search` to `main` only after the MCP package resolves on the registry. Leave host credential handling to the operator and never copy OAuth credentials into disposable profiles. Do not publish, modify real host credentials or silently switch inference providers.

## Planning Verification

The initial planning commit contained documentation only. The following historical checks exercised the existing implementation on the planning host, not the proposed MCP architecture. Current checkpoint evidence is in [Phase 2 Results](PHASE-2.md#verification) and [Phase 2 Peer Review](PHASE-2-REVIEW.md#verification); the earlier [peer-review verification](PHASE-1-REVIEW.md#verification) covers Phase 1 only.

| Check | Result | Meaning |
|---|---|---|
| `npm run build` | Passed | Existing native source compiles. |
| `npm test` | Passed | Existing deterministic tests pass. |
| `npm run test:smoke` | Passed | Existing structural smoke checks pass. |
| `./test/run-e2e-publish-local.sh` | Passed | Packed native package installs into an isolated directory and registers its tools under plain Node.js with freshly resolved peers. |
| `./test/e2e/01_main.sh` | Passed | Existing native research completes in an isolated session, with report, sources, index and completed local telemetry. |
| Documentation Checks | Passed | Local links and anchors resolve; the required package name is used; no prohibited em dashes are present. |

Temporary files were redirected below `.tmp/mcp-planning/`. The fresh-install gate resolved `pi-ai` 1.0.1; the live agent host reported `Pi` 1.0.0. The full release suite, MCP protocol tests and Claude Code/Codex installation tests were not run: the latter artifacts do not exist yet.

Re-run all required checks after implementation. These baseline results are not acceptance evidence for future changes.
