# MCP Implementation Handoff

## Direction

Extend `intelli-search` from one repository and one shared research engine. Preserve the native `@curio-data/pi-intelli-search` package and add `@curio-data/mcp-intelli-search`, a standalone Model Context Protocol (MCP) server. Provide thin [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) plugin bundles around that server.

The owner approved the architecture and specified the MCP package name on 2026-10-03. The planning branch is `plan/mcp-intelli-search`. This handoff contains research and an implementation specification only; no engine refactor, MCP runtime, plugin package or release has been created.

## Reading Order

1. Read root [`AGENTS.md`](../../../AGENTS.md), including compatibility, testing, documentation and release rules.
2. Read [Research and Decisions](RESEARCH.md) for the approved direction, inspected source revision, official references and evidence limitations.
3. Read [Implementation Plan](IMPLEMENTATION.md) for the target layout, compatibility contract, dependency boundaries, phased work and acceptance matrix.
4. Start at Phase 0 of the implementation plan. Check the current working tree and repeat the baseline on the implementation revision before moving code.

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

## Next-Agent Brief

> Implement the phased plan in `docs/plans/mcp-intelli-search/IMPLEMENTATION.md`. Begin with baseline and contract tests, then extract the shared engine while keeping the native extension usable. Add the independently installable `@curio-data/mcp-intelli-search` package only after native parity is proved. Add protocol and host-plugin packaging in later increments. Record actual artifact and host verification; do not treat documented capability as a passing test. Do not publish, modify real host credentials or silently switch inference providers.

## Planning Verification

The planning changes contain documentation only. The following checks exercised the existing implementation on the planning host, not the proposed MCP architecture.

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
