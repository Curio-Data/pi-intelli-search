# MCP Implementation Handoff

## Direction

Extend `intelli-search` from one repository and one shared research engine. Preserve the native `@curio-data/pi-intelli-search` package and add `@curio-data/mcp-intelli-search`, a standalone Model Context Protocol (MCP) server. Provide thin [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) plugin bundles around that server.

The owner approved the architecture and specified the MCP package name on 2026-10-03. The planning branch is `plan/mcp-intelli-search`. Phase 0 records dependency evidence and deterministic native compatibility fixtures. Phase 1 introduces host-neutral contracts, a native model adapter and explicit cache paths. Phase 2 moves operations, shared helpers and model policy into the core, with workspace-local documentation staging and injected telemetry identity. Phase 3 adds the standalone runtime and independently installable package, with strict configuration, explicit workspace ownership and an OpenRouter transport. Protocol serving, plugins and publication remain unimplemented. Phase 4, MCP Protocol, is the next implementation step.

## Reading Order

1. Read root [`AGENTS.md`](../../../AGENTS.md), including compatibility, testing, documentation and release rules.
2. Read [Research and Decisions](RESEARCH.md) for the approved direction, inspected source revision, official references and evidence limitations.
3. Read [Phase 0 Results](PHASE-0.md) and the [fixture guide](../../../test/fixtures/native-contract/README.md) for verified interfaces, baseline contracts and test commands.
4. Read [Phase 1 Results](PHASE-1.md) and [Phase 1 Peer Review](PHASE-1-REVIEW.md) for implemented interfaces, the cache-path correction, independent findings and current verification.
5. Read [Phase 2 Results](PHASE-2.md) and [Phase 2 Peer Review](PHASE-2-REVIEW.md) for the implemented operations, shared policy, review corrections, staging, telemetry identity and verification limits.
6. Read [Phase 3 Results](PHASE-3.md), [Phase 3 Peer Review](PHASE-3-REVIEW.md) and the [standalone configuration guide](../../../packages/mcp/README.md) for runtime entrypoints, provider evidence, strict validation and installation verification.
7. Read [Implementation Plan](IMPLEMENTATION.md) for the target layout, compatibility contract, dependency boundaries, phased work and acceptance matrix.
8. Start at Phase 4. Check the current working tree and run the native fixture suite before editing; do not regenerate its expected files to hide a regression.

The reviewed Phase 2 implementation is the historical `86b1e4e` checkpoint. Phase 3 continues from `0c26972` and is committed as `59a3fa4` on `plan/mcp-intelli-search`. Subsequent handoff-documentation commits remain on that branch; use its current tip rather than resetting to a historical checkpoint.

Both independent Phase 3 reviewers returned final `PASS` verdicts after corrections and frozen-tree follow-up. [Phase 3 Peer Review](PHASE-3-REVIEW.md) records findings, evidence and limits.

The handoff is self-contained in tracked documentation. The optional `.search/` cache and `.tmp/` verification logs are gitignored and are not required to understand or implement the plan.

## Fixed Requirements

- Use exactly `@curio-data/mcp-intelli-search` for the new npm package.
- Keep the existing native `Pi` package name, entry points, installation route and supported baseline.
- Share pipeline implementation, not host credential stores or mutable execution contexts.
- Keep standalone dependencies out of the native extension's runtime boundary and host libraries out of the MCP package.
- Start with local standard input/output (stdio) transport, explicit provider configuration and explicit workspace ownership.
- Preserve existing research semantics, cache formats and local-only telemetry.
- Treat plugin catalogs as distribution metadata, not separate implementations.
- Require explicit approval before any release or staged npm publication. Plan approval is not publication approval.

## Handover Verification

Before Phase 1, a fresh `Pi` session using native `zai/glm-5.3` reviewed the Phase 0 handoff without prior conversation, memory or research-cache access. Its verdict was PASS WITH NONBLOCKING NOTES; both entry checks passed. The documentation notes have been incorporated. See [Cold-Start Handover Review](HANDOVER-GLM.md) for scope, provenance, changes and limitations. This historical review does not cover the Phase 1 implementation; its evidence is recorded in [Phase 1 Results](PHASE-1.md#verification).

The subsequent [Phase 1 Peer Review](PHASE-1-REVIEW.md) used two independent native reviewers, `zai/glm-5.3` and `deepseek/deepseek-flash`. Neither found a blocker. The custom-cache instruction defect was fixed, contract comments were clarified, and both reviewers checked the follow-up changes. The review record distinguishes corrected findings, a retracted false positive and later-phase work. These reviews do not cover Phase 2. The subsequent [Phase 2 Peer Review](PHASE-2-REVIEW.md) used independent native `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash` reviewers. Both final verdicts were `PASS` after corrections and follow-up checks.

A subsequent fresh native `zai/glm-5.3` agent verified the committed Phase 2 handoff without earlier conversation, memory or research-cache access. It reconstructed Phase 3 and passed every documented entry check. [Phase 2 Cold-Start Handover](HANDOVER-PHASE-2.md) records its initial `PASS WITH NONBLOCKING NOTES` verdict, evidence limits, documentation clarifications and subsequent documentation-only `PASS`.

A fresh native `zai/glm-5.3` session subsequently verified the committed Phase 3 handoff without prior conversation, memory or research-cache access. It reconstructed Phase 4 and passed every documented entry check after `npm ci`. [Phase 3 Cold-Start Handover](HANDOVER-PHASE-3.md) records its initial `PASS`, the documentation-only clarifications and follow-up `PASS`.

## Fresh-Agent Entry Checks

Resume from `plan/mcp-intelli-search`, not `main`. Fetch `origin` and inspect the working tree before switching branches or pulling. Preserve unrelated changes; do not reset or overwrite them. With a clean checkout, use `git switch plan/mcp-intelli-search` and `git pull --ff-only origin plan/mcp-intelli-search`.

Run `npm ci` if dependencies are absent, differ from the committed lockfile or their provenance is uncertain. `npm ls --depth=0` detects missing or invalid top-level dependencies but does not establish exact lockfile equivalence; use a clean install when in doubt. Then run these checks from the repository root:

```bash
mkdir -p .tmp/mcp-phase4
export TMPDIR="$PWD/.tmp/mcp-phase4"
npm run build:all
npm run test:mcp
node --import tsx --test test/native-contract.test.ts
node --import tsx --test test/core-*.test.ts \
  test/native-model-client.test.ts test/workspace-paths.test.ts
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
```

Read the documents in the order above before editing. The entry checks are deterministic and require no provider credentials. The complete change gates, including isolated structural smoke and live verification, are in the [implementation plan](IMPLEMENTATION.md#verification-commands). Do not infer that optional local logs, cached research or prior conversation are needed to continue.

## Next-Agent Brief

> Continue at Phase 4 of `docs/plans/mcp-intelli-search/IMPLEMENTATION.md`. Read `PHASE-3.md` and `packages/mcp/README.md` for the standalone runtime, strict configuration, provider policy and filesystem limits. Implement actual stdio MCP registration, result/progress mapping, bounded queueing, cancellation and shutdown. Use safe runtime error categories and retain `--check-config`. Prove import-time and direct stdout framing: the existing async console guard only covers operation-time console output. Recheck the split SDK and Phase 0 probe before adding protocol dependencies. Preserve the native package and frozen fixtures, and retain both independent installation gates. Plugins remain Phase 5. Do not publish, modify real host credentials or silently switch inference providers.

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
