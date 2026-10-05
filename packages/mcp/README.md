# Standalone Research Runtime and MCP Server

`@curio-data/mcp-intelli-search` packages the shared `intelli-search` engine without a `Pi` installation. It serves the four research operations as a Model Context Protocol (MCP) server over standard input/output (stdio), with explicit configuration and an [_OpenRouter_](https://openrouter.ai) inference adapter. The runtime entrypoint also executes the operations directly for engine verification. This artifact is not published.

## Requirements

- [_Node.js_](https://nodejs.org/) satisfying the `engines` range in `package.json`.
- An existing, explicitly selected absolute workspace directory.
- An explicitly selected JSON (JavaScript Object Notation) configuration file.
- A separately billed OpenRouter API (application programming interface) key supplied through a named environment variable before constructing the runtime. Restart the runtime after changing credentials; it snapshots the environment.
- A platform supported by [`wreq-js`](https://github.com/sqdshguy/wreq-js), the browser-fingerprint fetch dependency. The installation gate exercises its native assets on the running platform; it does not establish support for other platforms.

The package neither reads host credential stores nor loads project configuration automatically. Native `Pi` settings, authentication, providers and defaults remain independent.

## Serving the Protocol

An invocation without `--check-config` validates the explicit configuration and workspace, then serves the four canonical tools (`intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`) over stdio until the input stream closes. Serving performs no inference at startup; credentials are only required when an operation runs.

- **Registration and Schemas.** Tool names and JSON (JavaScript Object Notation) input schemas mirror the native `Pi` tools verbatim; descriptions adapt the native guidance for protocol clients (host-neutral cache wording, embedded `focusPrompt` and breadth guidance), because the protocol offers no separate guidance channel. Invalid tool arguments are reported as tool errors (`isError` results), matching the SDK (software development kit) distinction between malformed protocol requests and invalid arguments.
- **Results.** Successful calls return the concise summary as text content plus structured content with `outcome` and `details`. Degraded research (`no-links`, `fetch-failed`, `extraction-failed`) remains a normal result. Execution failures return `isError` results tagged with the safe `StandaloneError` category rather than raw provider causes.
- **Queueing.** One operation runs at a time and up to eight further requests queue; requests beyond the bound settle immediately with a busy tool error. A queued request whose client cancels settles without starting its operation.
- **Progress and Cancellation.** When the client supplies a progress token, stage progress is forwarded as `notifications/progress` (percentage of one hundred). Client cancellation aborts the running operation through the shared model policy and stage boundaries.
- **Shutdown.** Closing standard input aborts in-flight and queued work, closes the transport and exits. `SIGINT` and `SIGTERM` trigger the same drain with a bounded hard-exit backstop. No unanswered request or runaway child work remains.
- **Framing.** Standard output carries protocol messages only. Before the server module loads, a guard diverts `process.stdout.write` (including console output, import-time writes and direct dependency writes) to standard error; the transport writes frames through the original stream, so the SDK's own output is never corrupted. Adapter diagnostics use standard error.
- **Annotations.** `intelli_search` and `intelli_extract` are marked read-only; `intelli_collate` and `intelli_research` write cache files and are not read-only. No tool claims idempotence. Every operation calls external services and incurs provider charges.

Startup diagnostics go to standard error. The SDK version range is declared in `package.json` (the lockfile pins the verified release); the protocol implementation is the official split server package verified in the repository handoff.

## Configuration

Select the configuration with `--config FILE` or `INTELLI_SEARCH_CONFIG`. Select the workspace with `--workspace ABSOLUTE_DIRECTORY` or `INTELLI_SEARCH_WORKSPACE`. Command-line values take precedence. Relative workspace paths are rejected; existing workspace symlinks are canonicalised.

The following example explicitly selects OpenRouter for every role. These are example selections, not standalone defaults:

```json
{
  "providers": {
    "openrouter": {
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  },
  "models": {
    "search": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extract": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collate": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  },
  "tuning": {
    "cacheDir": ".search"
  }
}
```

Only `providers`, `models` and optional `tuning` are accepted at the top level. All three model roles are required. The provider object accepts only `apiKeyEnv`, an environment-variable name rather than a key value. The initial provider scope is OpenRouter at its fixed `https://openrouter.ai/api/v1` endpoint; custom endpoints, proxy settings, provider fallback and dynamic router model identifiers are not accepted.

Configuration loading does not require working credentials. Each operation validates its required model roles against OpenRouter's model catalogue before inference. Full research validates all three roles first. Validation checks exact identifiers, text input/output, advertised reasoning efforts when supplied, and tool support for an enabled search tool. Catalogue lookup is bounded and cancellable. It establishes advertised capabilities, not account credit, per-key model access or future provider availability; inference errors remain possible.

Search requires either `perplexity/sonar`, `perplexity/sonar-pro`, `perplexity/sonar-pro-search`, or an explicitly enabled `searchWebSearch` block with a chat model. Enabling `searchWebSearch` also requires the selected model to advertise `tools` support. Combining that block with a Sonar model that does not advertise tool support fails preflight; the adapter does not silently drop the configured tool. Search tools are model-decided; a valid response can still contain no usable links.

### Tuning

Unspecified tuning comes from `src/core/defaults.ts` in the repository, also used by the native adapter. No provider or model selection is inherited from that module. Unknown keys, invalid types and out-of-range values are rejected rather than silently clamped.

| Setting | Accepted Values |
|---|---|
| `defaultUrls`, `maxUrls` | Integers from 1 to 100; `defaultUrls` must not exceed `maxUrls` |
| `extractMaxChars` | Integer from 1 to 2,000,000 |
| `fetchTimeoutMs`, `llmTimeoutMs` | Integers from 1 to 600,000 milliseconds |
| `fetchConcurrency`, `extractionConcurrency` | Integers from 1 to 32 |
| `extractionMaxTokens`, `collationMaxTokens` | Integers from 16 to 128,000 |
| `llmRetryAttempts`, `searchRetryAttempts` | Integers from 1 to 10, including the first attempt |
| `retryBaseDelayMs`, `retryMaxDelayMs`, `minRequestIntervalMs` | Integers from 0 to 120,000 milliseconds; base delay must not exceed maximum delay |
| `cacheDir` | Nonempty relative directory, without absolute paths, backslashes or traversal components |
| `browserFingerprint` | `chrome_145`, the verified shared profile |
| `disableTelemetry`, `disableLlmsFullDiscovery` | Booleans |
| `searchWebSearch` | Validated block described below; replaces the entire shared default block |

`searchWebSearch` requires a boolean `enabled`. Optional fields are `engine` (`auto`, `native`, `exa`, `parallel`, `perplexity`, `firecrawl`), `maxResults` (1 to 25, capped at 20 for `perplexity`), `searchContextSize` (`low`, `medium`, `high`), `allowedDomains`, `excludedDomains`, and `reasoning` (`minimal`, `low`, `medium`, `high`). Domain lists contain hostnames, not URLs (uniform resource locators), and have at most 100 entries. The `perplexity` and `firecrawl` engines cannot combine nonempty allowed and excluded lists. Per-call domains also guide search; they are not a network allowlist for fetched pages.

Every standalone model call, including one-shot search, extract and collate, receives configured retry and application-timeout defaults. The shared policy owns retries once; there is no underlying SDK (software development kit) retry loop. Retry-After delays are bounded by `retryMaxDelayMs`. Native one-shot policy remains unchanged. HTTP (Hypertext Transfer Protocol) errors and error-bearing successful responses, including `choices[].error`, preserve retry classification without exposing provider bodies or headers. A `402` with a valid Retry-After header is treated as transient in-flight budget pressure; an ordinary credit-exhaustion response remains permanent. Reasoning fields are sent only when the catalogue advertises reasoning support; non-reasoning models receive neither effort nor exclusion fields. Permanent credential errors do not retry. Empty output after token-budget exhaustion is actionable rather than a successful extraction.

## Direct Engine Verification

From the repository root:

```bash
npm run build:all
npm run test:all
npm run test:mcp:install
```

The installation gate packs the artifact, installs production dependencies into an isolated directory and denies all ancestor dependency resolution in both module systems. It runs the installed executable's `--help` and `--version`, all four operations with synthetic inference, and actual page fetching against a loopback fixture through the installed native fetch assets. A raw protocol exchange against the installed server verifies initialization, tool listing, invalid-argument rejection without inference and clean shutdown, and asserts that standard output carries only protocol frames. It does not use provider credentials or claim live MCP interoperability. The `test/e2e/11_mcp_stdio.sh` scenario exercises a real research call through the native MCP client of an isolated `Pi` profile and is proven runnable; see the repository handoff for its evidence.

The experimental runtime entrypoint supports direct engine verification after installation:

```javascript
import {
  createRuntime,
  loadConfig,
} from "@curio-data/mcp-intelli-search/runtime";

const config = await loadConfig(
  "/absolute/path/config.json",
  "/absolute/path/workspace",
);
const runtime = await createRuntime(config);
const result = await runtime.execute("intelli_research", {
  query: "Research question",
  focusPrompt: "Specific facts and signatures to retain",
  maxUrls: 3,
});
console.log(result.text);
```

This example incurs inference and search charges when run with a real credential. `execute()` also accepts `intelli_search`, `intelli_extract` and `intelli_collate`, with the canonical tool parameters. Its optional third argument supplies `signal` and `onProgress`. Results contain `text`, `details` and `outcome`; execution failures throw. Degraded research remains a result. Standalone validation rejects unknown argument keys, empty queries, nonpositive or fractional `maxUrls`, arrays exceeding 100 entries, strings exceeding 2,000,000 characters and unsupported extraction statuses. Native schemas are unchanged. For manual extraction followed by collation, construct each collation item from the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus an explicit `status` such as `success`. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

`mcp-intelli-search --help` and `--version` need no configuration. `--check-config` validates explicit configuration and workspace syntax without credentials or inference, returning exit status 0 for valid configuration and 1 for invalid input. Neither starts a protocol connection. The runtime entrypoint is experimental and has no published TypeScript declaration contract. Execution failures expose a safe `StandaloneError.code`: `INVALID_ARGUMENTS`, `CONFIGURATION`, `WORKSPACE`, `PROVIDER`, `OPERATION` or `CANCELLED`. Cancellation uses the `AbortError` name. Raw provider causes are deliberately not retained. Some shared operations wrap provider exceptions, which become `OPERATION` errors; protocol mapping must not depend on exact diagnostic strings.

## Filesystem and Privacy Boundaries

All cache paths returned by the standalone adapter are absolute and anchored to the selected workspace. Cache and staging content stay beneath the configured cache directory. Existing symlinks, dangling links and hardlinked files in cache ancestors or artifact subtrees are rejected before an operation; checks repeat after model preflight. Special filesystem entries and an oversized safety scan are rejected. The full scan runs at runtime construction and twice per operation, so its cost grows with cache size; queued requests wait behind that scan. At 100,000 inspected entries, select a smaller cache directory or archive old entries after stopping all processes using that cache. Same-query refreshes share one cache directory and do not promise separate histories.

These checks prevent pre-existing path escapes, not malicious concurrent filesystem replacement by another process with write access. Use a workspace controlled by the same trusted local operator. No operating-system sandbox or protection against hostile same-user mutation is claimed. Fetched URLs are not constrained to public addresses; the runtime is not a hosted service or an unrestricted remote execution endpoint.

The host must be able to read the returned paths. Summaries advise using the host's file-reading capability rather than requiring a tool named `read`. Cache formats and local telemetry retain the shared semantics; standalone telemetry adds package and adapter identity. Credentials are never inserted into prompts, cache metadata or generated launch configuration. Adapter diagnostics use standard error and omit raw provider errors, headers and transport exceptions. During operation execution, async-scoped interception replaces dependency stdout console output with a generic logger warning; a regression drives Defuddle's actual conversion-failure handler, which otherwise prints page content. While serving, the startup stdout guard also diverts import-time output and direct dependency writes to standard error; protocol tests assert clean framing with a deliberately noisy fixture.

## Timeouts and Troubleshooting

A full research call runs one search, up to `maxUrls` dual fetches, up to `maxUrls` extractions, one collation and one cache suggestion. With the shared defaults this completes in a few minutes. Progress notifications reset the idle timeout of clients that observe them, but they are not a guarantee against a host's total request deadline. If a host aborts long tool calls, lower `maxUrls` in the tuning block or per call, and raise `llmTimeoutMs` for slow reasoning models. Client cancellation is honoured: the running operation aborts through the shared policy and stage boundaries, and a queued request settles without starting.

Every startup failure is diagnostic-only and lands on standard error; standard output carries protocol frames only. The frequent cases:

| Symptom | Cause and Remedy |
|---|---|
| `Explicit --config and --workspace are required` | The server started without both selections. Supply `--config`/`--workspace` or the `INTELLI_SEARCH_CONFIG`/`INTELLI_SEARCH_WORKSPACE` environment variables, then restart the host. |
| `workspace must be an explicit absolute directory` | The workspace selection is relative or a host placeholder was not expanded. Use a literal absolute path; on hosts with placeholder expansion, verify the expansion on your host version. |
| `Cannot read configuration: provide an explicit readable JSON file` | The configuration path does not exist or is not readable. Create the file (the guides show a minimal valid document) and restart. |
| Configuration rejected with an unknown-key or range error | The loader is strict: unknown keys, invalid types and out-of-range values fail validation. Remove or correct the named key; the [Tuning](#tuning) table lists every accepted key and range. |
| Tools never appear in the host | The server exited during startup. Read the host's MCP server logs for the standard-error diagnostic; `mcp-intelli-search --check-config` reproduces configuration and workspace failures without a host. |
| Operations fail with `CONFIGURATION` or `PROVIDER` | The named credential environment variable is missing or the key was rejected. The server snapshots the environment at startup: restart it after changing credentials. Catalogue preflight failures name the offending model role. |
| Repeated 429 retries on a free-tier or shared key | Free-tier OpenRouter keys share a tight rate bucket. Set `minRequestIntervalMs` to approximately `3000`, lower `extractionConcurrency` to `2`, and raise `llmRetryAttempts` and `llmTimeoutMs`. |
| Cache paths unreadable from the host | The host must share the server's filesystem. Sandboxed or remote hosts cannot read local cache paths; run the server where the host can read the workspace. |

## Direct Registration

Register the server directly with any MCP-compatible host that launches stdio processes. The executable is `mcp-intelli-search`. The following folder-scoped commands use [_Claude Code_](https://code.claude.com/docs/en/mcp).

Save the example in [Configuration](#configuration) as `.intelli-search.json` in the target folder. The file can instead live at any readable absolute path, either per-folder or shared; replace `INTELLI_SEARCH_CONFIG` in the commands accordingly. Keep `INTELLI_SEARCH_WORKSPACE` per-folder and point it to an existing absolute directory so each folder has its own research cache. The server does not discover either path automatically.

Supply `OPENROUTER_API_KEY` through the server process environment before using the tools. For _Claude Code_, export it in the environment that launches the host, rather than putting the key in a committed file. The configuration names the variable, not the credential; restart the host after changing credentials.

Run registration from the target folder. `local` is the default scope: private to the operator and active only in that folder. Add `--scope project` before `--` to write a shared `.mcp.json` into the folder. Project-scoped servers require approval in _Claude Code_ before connection; absolute paths in a shared file must also be valid on each operator's machine.

### Post-Publication Launcher

The package's first registry publication is pending. Use this launcher only after publication; `npx` downloads the package without a separate install step:

```bash
claude mcp add intelli_search \
  -e "INTELLI_SEARCH_CONFIG=$PWD/.intelli-search.json" \
  -e "INTELLI_SEARCH_WORKSPACE=$PWD" \
  -- npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search
```

Append `@<version>` to the package name to pin a release.

### Pre-Publication Source-Checkout Launcher

From the repository root, install dependencies if needed with `npm install`, then build:

```bash
npm run build:all
```

Switch to the target folder and register the built server. Replace the checkout path with its actual absolute path:

```bash
claude mcp add intelli_search \
  -e "INTELLI_SEARCH_CONFIG=$PWD/.intelli-search.json" \
  -e "INTELLI_SEARCH_WORKSPACE=$PWD" \
  -- node /absolute/path/to/pi-intelli-search/packages/mcp/dist/cli.js
```

### Verification

From the target folder, check the registered server:

```bash
claude mcp list
```

Confirm `intelli_search` shows as connected. If a project-scoped server shows pending approval, open _Claude Code_ in that folder and approve it before checking again.

Validate the configuration separately without credentials or inference. After publication, use:

```bash
INTELLI_SEARCH_CONFIG="$PWD/.intelli-search.json" \
INTELLI_SEARCH_WORKSPACE="$PWD" \
npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search --check-config
```

For the source-checkout launcher, use:

```bash
node /absolute/path/to/pi-intelli-search/packages/mcp/dist/cli.js \
  --config "$PWD/.intelli-search.json" \
  --workspace "$PWD" \
  --check-config
```

Use the same configuration path as the registered server if it is shared or stored elsewhere. A successful check prints `Configuration is valid.` and exits with status `0`. It validates configuration and workspace, not host connectivity, credentials or model access. `claude mcp list` checks the host connection; successful inference requires the separate provider key.

## Host Plugins

Thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) live in `plugins/` at the repository root, with repository marketplace catalogs at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. The bundles are generated from the shared guidance source in `guidance/` and the version pinned in this package's manifest; run `npm run generate:plugins` after a version change and `npm run check:plugins` to detect drift. Launchers pin the exact package version through `npx`; until the package is published, `scripts/generate-plugin-bundles.mjs --mode tarball` generates equivalent local-tarball launchers for installation tests. Host setup, including each host's environment forwarding rules, is in the generated skills.

This checkpoint ships release wiring (the `mcp-v*` tag route in `.github/workflows/release.yml`, pending owner review and the package's trusted-publisher binding) but no live standalone provider certification beyond the single-host `Pi` smoke. Certification and publication remain gates in the repository handoff.
