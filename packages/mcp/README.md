# Standalone Research Runtime

`@curio-data/mcp-intelli-search` packages the shared `intelli-search` engine without a `Pi` installation. Phase 3 supplies direct execution of the four research operations, explicit configuration and an [_OpenRouter_](https://openrouter.ai) inference adapter. Model Context Protocol (MCP) registration and standard input/output transport arrive in Phase 4. This artifact is not yet an MCP server and is not published.

## Requirements

- [_Node.js_](https://nodejs.org/) satisfying the `engines` range in `package.json`.
- An existing, explicitly selected absolute workspace directory.
- An explicitly selected JSON (JavaScript Object Notation) configuration file.
- A separately billed OpenRouter API (application programming interface) key supplied through a named environment variable before constructing the runtime. Restart the runtime after changing credentials; it snapshots the environment.
- A platform supported by [`wreq-js`](https://github.com/sqdshguy/wreq-js), the browser-fingerprint fetch dependency. The installation gate exercises its native assets on the running platform; it does not establish support for other platforms.

The package neither reads host credential stores nor loads project configuration automatically. Native `Pi` settings, authentication, providers and defaults remain independent.

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

The installation gate packs the artifact, installs production dependencies into an isolated directory and denies all ancestor dependency resolution in both module systems. It runs the installed executable's `--help` and `--version`, all four operations with synthetic inference, and actual page fetching against a loopback fixture through the installed native fetch assets. It does not use provider credentials or claim live MCP interoperability.

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

`mcp-intelli-search --help` and `--version` need no configuration. `--check-config` validates explicit configuration and workspace syntax without credentials or inference, returning exit status 0 for valid configuration and 1 for invalid input. A CLI (command-line interface) invocation without these flags validates configuration then exits 1 with a Phase 4 availability message: server startup is not available. They do not start a protocol connection or perform inference. The runtime entrypoint is experimental and has no published TypeScript declaration contract. Execution failures expose a safe `StandaloneError.code`: `INVALID_ARGUMENTS`, `CONFIGURATION`, `WORKSPACE`, `PROVIDER`, `OPERATION` or `CANCELLED`. Cancellation uses the `AbortError` name. Raw provider causes are deliberately not retained. Some shared operations wrap provider exceptions, which become `OPERATION` errors; protocol mapping must not depend on exact diagnostic strings.

## Filesystem and Privacy Boundaries

All cache paths returned by the standalone adapter are absolute and anchored to the selected workspace. Cache and staging content stay beneath the configured cache directory. Existing symlinks, dangling links and hardlinked files in cache ancestors or artifact subtrees are rejected before an operation; checks repeat after model preflight. Special filesystem entries and an oversized safety scan are rejected. The full scan runs at runtime construction and twice per operation, so its cost grows with cache size. At 100,000 inspected entries, select a smaller cache directory or archive old entries after stopping all processes using that cache. Phase 4 must account for scan latency without weakening containment. Same-query refreshes share one cache directory and do not promise separate histories.

These checks prevent pre-existing path escapes, not malicious concurrent filesystem replacement by another process with write access. Use a workspace controlled by the same trusted local operator. No operating-system sandbox or protection against hostile same-user mutation is claimed. Fetched URLs are not constrained to public addresses; the runtime is not a hosted service or an unrestricted remote execution endpoint.

The host must be able to read the returned paths. Summaries advise using the host's file-reading capability rather than requiring a tool named `read`. Cache formats and local telemetry retain the shared semantics; standalone telemetry adds package and adapter identity. Credentials are never inserted into prompts, cache metadata or generated launch configuration. Adapter diagnostics use standard error and omit raw provider errors, headers and transport exceptions. During operation execution, async-scoped interception replaces dependency stdout console output with a generic logger warning; a regression drives Defuddle's actual conversion-failure handler, which otherwise prints page content. Unrelated and later console calls remain unchanged. Direct dependency writes to stdout and import-time output are not intercepted; Phase 4 must prove protocol framing and startup behaviour separately.

This checkpoint does not supply protocol queueing, shutdown handling, client progress notifications, plugin bundles, release automation or a live standalone provider certification. Those are later gates in the repository handoff.
