<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. Edit the root README.md, then run npm run generate:readmes. -->

# mcp-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/mcp-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/mcp-intelli-search)
[![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](https://github.com/Curio-Data/pi-intelli-search/blob/main/LICENSE)
![tests](https://img.shields.io/badge/test%3Aall-530%20passing-brightgreen)

Intelligent web research for coding agents: search, extract, collate, and cache grounded web context in one tool call. This repository provides two first-class packages from one research engine:

- `@curio-data/pi-intelli-search`: a [`Pi`](https://github.com/earendil-works/pi) extension that registers the four research tools natively, using `Pi` settings, authentication and the model registry.
- `@curio-data/mcp-intelli-search`: a standalone Model Context Protocol (MCP) server over standard input/output (stdio) for MCP-compatible hosts, including [_Claude Code_](https://code.claude.com/docs/en/mcp) and [_Codex_](https://developers.openai.com/codex/mcp).

Both packages run the same five-stage pipeline with the same cache format. [Install](#install) covers both the [`Pi` native extension](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#pi-native-extension) and the [MCP server](#mcp-server), including direct MCP registration and host plugins.

The shared pipeline searches via a search-grounded model ([_Perplexity Sonar_](https://docs.perplexity.ai), the native default) and merges prose links with harvested citations before selecting pages. It fetches pages through a dual-fetch comparison ([_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), then extracts query-relevant content per page with a dedicated large language model (LLM) guided by a _focused prompt_. Collation deduplicates findings, flags inconsistencies, and synthesises a concise summary. Everything is cached in `.search/` for offline reuse. Cache suggest surfaces related previous searches on each query.

## Two Packages, One Engine

Choose the installation route for the host:

| Route | Host | What to Install |
|---|---|---|
| Native `Pi` Extension | `Pi` | `@curio-data/pi-intelli-search` |
| Direct MCP Registration | Any MCP-compatible host | `@curio-data/mcp-intelli-search` |
| Host Plugin | Claude Code or Codex | Repository marketplace launching the pinned MCP package |

The install branches: [`Pi` Native Extension](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#pi-native-extension) and [MCP Server](#mcp-server), with host instructions for [Claude Code](#claude-code), [Codex](#codex) and any [Generic MCP Host](#generic-mcp-host).

The native extension uses `Pi` settings and authentication. The MCP server requires explicit configuration, a per-folder workspace and an environment-supplied inference key; it does not read `Pi` settings or credentials. Its first registry publication is pending: use the [source-checkout launcher](#claude-code) until publication. The registry and plugin launchers below are post-publication routes.

## Contents

<!-- TOC:START -->

- [Two Packages, One Engine](#two-packages-one-engine)
- [Install](#install)
  - [MCP Server](#mcp-server)
    - [Claude Code](#claude-code)
    - [Codex](#codex)
    - [Generic MCP Host](#generic-mcp-host)
- [Tools](#tools)
- [Quick Start](#quick-start)
  - [Quick Search](#quick-search)
  - [Deep Research](#deep-research)
  - [Targeted Research With Domain Guidance](#targeted-research-with-domain-guidance)
  - [Comparing Options](#comparing-options)
- [Pipeline](#pipeline)
- [Cost](#cost)
- [MCP Server Reference](#mcp-server-reference)
  - [Requirements](#requirements)
  - [Verification](#verification)
  - [Serving the Protocol](#serving-the-protocol)
  - [Configuration](#configuration)
    - [Tuning](#tuning)
  - [Direct Engine Verification](#direct-engine-verification)
  - [Filesystem and Privacy Boundaries](#filesystem-and-privacy-boundaries)
  - [Timeouts and Troubleshooting](#timeouts-and-troubleshooting)
- [Cache Structure](#cache-structure)
- [Compatibility](#compatibility)
  - [MCP Server Compatibility](#mcp-server-compatibility)
- [Documentation](#documentation)
- [Downloads](#downloads)
  - [MCP Server Downloads](#mcp-server-downloads)
- [Sponsor](#sponsor)
- [License](#license)
- [Use of Large Language Models](#use-of-large-language-models)

<!-- TOC:END -->

<p align="center">
  <img src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/01.png" alt="PI-Intelli Search: a five-stage research pipeline diagram arranged in a clockwise cycle. The five labelled stages, each enclosed in a laurel-wreath medallion, are Search (top, depicted as a magnifying glass over an open book), Fetch (right, a hand retrieving a document from shelves), Extract (bottom-right, a distillation apparatus), Collate (bottom-left, stacked books and filing boxes), and Cache &amp; Suggest (left, a treasure chest with an envelope). Copper-coloured arrows connect the stages in sequence. The background is decorated with pen-and-ink botanical and scholarly motifs including quill pens, ink bottles, scrolls, globes, hourglasses, and open books." width="800" />
</p>

**Features:**

- 🔍 **Search:** a search-grounded model, [_Perplexity Sonar_](https://docs.perplexity.ai) via [_OpenRouter_](https://openrouter.ai) by default. One application programming interface (API) key, no $50 minimum. Any OpenRouter chat model works too via the [web search server tool](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#openrouter-web-search-server-tool).
- 🔗 **Harvest:** every source the search model cited, not only the links it wrote into the answer. Machine-readable `url_citation` annotations are merged with text links before pages are selected.
- 🌐 **Fetch:** Dual-fetch each page (Hypertext Markup Language (HTML) → Defuddle versus Markdown endpoint), compare quality, pick the cleaner version.
- 📄 **Extract:** Per-page LLM extraction guided by a _focused prompt_. Compresses ≈50K to ≈3-5K chars of query-relevant content.
- 🔗 **Collate:** Cross-source deduplication, inconsistency detection, and synthesis into a focused ≈5K summary.
- 💾 **Cache:** Persistent `.search/` cache with automatic cache suggest. Related previous searches surfaced on each query.
- 🎯 **Configurable:** Select models independently for search, extract and collate. The native extension uses any model `Pi` supports; the MCP server uses explicitly selected OpenRouter models.
- 💰 **Cost:** see the [default research-run estimate](#cost).

<a id="use-with-other-hosts"></a>
## Install

Choose a package by host: the [`Pi` native extension](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#pi-native-extension) for `Pi`, or the [MCP server](#mcp-server) for MCP-compatible hosts.

### MCP Server

`@curio-data/mcp-intelli-search` serves the four research tools over stdio for MCP-compatible hosts. Choose direct registration or a host plugin from the [installation routes](#two-packages-one-engine).

The standalone server shares one engine with the native extension: the same five-stage pipeline, the same cache formats and the same local-only telemetry. It requires [Node.js](https://nodejs.org/) 22 or later, an explicitly selected JavaScript Object Notation (JSON) configuration file, an explicitly selected absolute workspace directory, and an OpenRouter key supplied through an environment variable. Inference is billed separately to that OpenRouter account; no `Pi` subscription or credential store is involved. The server reads no host credential stores, no `Pi` settings and no discovered project configuration. The complete configuration, security and troubleshooting reference is the [MCP Server Reference](#mcp-server-reference).

**Publication Status:** the standalone package's first registry publication is pending. Until it lands, the `npx` and plugin launchers below are unavailable; use the pre-publication source-checkout launcher under [Claude Code](#claude-code). This notice is removed at first publication.

<a id="route-b-claude-code-plugin"></a>
#### Claude Code

**Plugin (Post-Publication):**

[_Claude Code_](https://code.claude.com/docs/en/plugins) installs the plugin from this repository's marketplace; the launcher runs the pinned MCP package through `npx`:

```bash
claude plugin marketplace add Curio-Data/pi-intelli-search
claude plugin install intelli-search@curio-data-plugins
```

One-time setup: set your OpenRouter key in the plugin's required option, and write the plugin's `config.json`. Installing does not ask for the key; _Claude Code_ withholds the server until it is set. Set it in a session through `/plugin` → Installed → `intelli-search` → Configure, or from a shell with `claude plugin configure intelli-search@curio-data-plugins --values-stdin`. The key is kept in _Claude Code_'s credential store, not your shell profile. The plugin's `intelli-search` skill shows both steps in full after installation. The plugin places the research cache in the opened project's `.search/`. Verify with `claude mcp list`: `plugin:intelli-search:intelli_search` must show as connected. The first server start downloads the pinned package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. Verified on Claude Code 2.1.289; the shell key route needs 2.1.285 or later. See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md).

**Direct Registration:**

Save the server's configuration (the `providers` and `models` example under [Generic MCP Host](#generic-mcp-host)) as `.intelli-search.json` in the target folder. Run registration from that folder. `local` is the default scope: private to the operator and active only in that folder. Add `--scope project` before `--` to write a shared `.mcp.json` into the folder; _Claude Code_ requires approval before connecting to project-scoped servers, and absolute paths in a shared file must be valid on each operator's machine.

**Post-Publication Launcher:**

```bash
claude mcp add intelli_search \
  -e "INTELLI_SEARCH_CONFIG=$PWD/.intelli-search.json" \
  -e "INTELLI_SEARCH_WORKSPACE=$PWD" \
  -- npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search
```

**Pre-Publication Source-Checkout Launcher:** run `npm run build:all` from this repository's root, then switch to the target folder and register the built server:

```bash
claude mcp add intelli_search \
  -e "INTELLI_SEARCH_CONFIG=$PWD/.intelli-search.json" \
  -e "INTELLI_SEARCH_WORKSPACE=$PWD" \
  -- node /absolute/path/to/pi-intelli-search/packages/mcp/dist/cli.js
```

Replace the checkout path with its actual absolute path. The configuration file can live at any readable absolute path, either per-folder or shared; replace the `INTELLI_SEARCH_CONFIG` value accordingly. Keep `INTELLI_SEARCH_WORKSPACE` per-folder so each folder has its own research cache. `OPENROUTER_API_KEY` must reach the server process environment, including when _Claude Code_ starts it.

Verify with `claude mcp list` from the target folder and confirm `intelli_search` is connected. Also run the chosen launcher with `--check-config` to validate configuration without credentials or inference; this does not test connectivity or model access. Both verification commands are shown in [Verification](#verification).

<a id="route-c-codex-plugin"></a>
#### Codex

**Plugin (Post-Publication):**

[_Codex_](https://developers.openai.com/codex/plugins) installs the same server from the same repository marketplace:

```bash
codex plugin marketplace add Curio-Data/pi-intelli-search
codex plugin add intelli-search --marketplace curio-data-plugins
```

Codex starts plugin servers with a filtered environment and no placeholder expansion, so export `OPENROUTER_API_KEY`, `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` before each `codex` launch; the plugin's `intelli-search` skill documents the fixed and per-project (`direnv`) patterns. Verified on Codex CLI 0.144.5; see the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md).

<a id="route-a-direct-mcp-configuration"></a>
#### Generic MCP Host

This route covers any stdio host, including [_Open Code_](https://opencode.ai/docs/mcp-servers/). Adapt the registration JSON to the host's configuration format.

Any host that speaks MCP over stdio can register the server directly. The executable is `mcp-intelli-search`; after publication, an `npx` launch needs no separate install step (append `@<version>` to the package name to pin an exact release; the plugin routes pin for you):

```json
{
  "mcpServers": {
    "intelli_search": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "@curio-data/mcp-intelli-search",
        "mcp-intelli-search"
      ],
      "env": {
        "INTELLI_SEARCH_CONFIG": "/absolute/config.json",
        "INTELLI_SEARCH_WORKSPACE": "/absolute/workspace"
      }
    }
  }
}
```

`OPENROUTER_API_KEY` must reach the server process environment (the server snapshots it at startup); use your host's secret mechanism or shell environment rather than committing it to a configuration file. A minimal explicit configuration selects OpenRouter for all three roles:

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
  }
}
```

These are explicit selections, not inherited defaults: the standalone package has no implicit provider or model choice. The research cache lands in `<workspace>/.search/`; the host reads cached pages with its own file-reading capability. Configuration and tuning details are canonical in [Configuration](#configuration).

Run the chosen launcher with `--check-config` to validate configuration and workspace without credentials or inference, then confirm the host connects and lists the four research tools. Configuration validation does not test connectivity or model access; use the [canonical verification commands](#verification).

On both plugin hosts the tools appear under host-qualified names (for example `mcp__intelli_search__intelli_research` on Codex). The installed `intelli-search` skill shows the exact names for its host. The native `Pi` extension and the MCP server are independent installations; enabling both in one agent gives duplicate tool sets, which is not a supported configuration.

## Tools

Both packages expose these four operations. The names below are native `Pi` tool names and MCP server tool names; MCP hosts add their own callable-name prefixes. Use the names exposed by the host.

| Tool               | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `intelli_search`   | Search the web and return a concise answer with a source list (top `defaultUrls`).                   |
| `intelli_extract`  | Extract query-relevant content from a web page, preserving code and technical detail verbatim.      |
| `intelli_collate`  | Deduplicate and synthesise multiple extractions into a summary. Writes cache.                       |
| `intelli_research` | Search, fetch, extract, collate, cache. The primary research tool. One call.                        |

## Quick Start

### Quick Search

```text
intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research

**Always provide a `focusPrompt`.** The extraction LLM works best with specific guidance.

```text
intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

### Targeted Research With Domain Guidance

```text
intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages.",
  maxUrls=3,
  domains=["developers.cloudflare.com"]
)
```

`domains` guides source selection, it is not a security boundary: the query gains a `site:` expression, and with the web search tool enabled the same domains are also combined with `searchWebSearch.allowedDomains` and sent as an engine filter. The lists are combined, not intersected, and returned URLs are not checked against a local hostname allowlist before fetching. Engine support for allow and exclude lists differs (see [searchWebSearch Keys](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#searchwebsearch-keys)).

### Comparing Options

```text
intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

## Pipeline

<p align="center">
  <img src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/07B.png" alt="Vintage engraving-style infographic titled &quot;INTELLI_RESEARCH: The Five-Stage Pipeline,&quot; showing five sequentially linked numbered stages triggered by intelli_research(query): (1) Search: web discovery via Perplexity Sonar, OpenRouter/pi-native auth; (2) Fetch: dual fetch and quality comparison using wreq-js + Defuddle against raw markdown; (3) Extract: per-page parallel LLM extraction, MiniMax M2.7, the native model configuration at the illustration's creation; (4) Collate: deduplication and persistent cache via MiniMax M2.7 (the native configuration at creation), flags conflicts; (5) Cache Suggest: additive stage, LLM judge surfaces related prior searches. Stages are connected by bold arrows; each is illustrated with a period-appropriate vignette (armillary sphere, scrolls, alchemical still, filing cabinet, owl with documents)." width="800" />
</p>

The illustration shows the native pipeline with the model configuration at its creation, including MiniMax M2.7 and `Pi` authentication; it does not show the current defaults or standalone authentication. All model assignments are configurable (see [Model Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#model-configuration)); alternative search configurations use the same five-stage pipeline.

The search stage merges text links with harvested citation annotations before selecting pages (see [Source Harvesting from Citations](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#source-harvesting-from-citations)). Each page is dual-fetched (HTML via Defuddle versus Markdown endpoint) and scored for quality. Per-page extraction (guided by `focusPrompt`) compresses ≈50K chars to ≈3-5K of query-relevant content before collation, keeping the total context manageable (≈30-50K for 10 pages).

At the end of each run the pipeline writes a local-only `meta.json` telemetry sidecar into the cache directory (see [Cache Structure](#cache-structure)). Set `disableTelemetry: true` to suppress it.

See [docs/ARCHITECTURE.md](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

The estimate below uses the native default models and tuning, also selected in the minimal MCP configuration example. It is a planning estimate based on the recorded September 2026 price basis, not a live tariff check. Both packages incur inference charges on the configured provider account; MCP does not use host subscriptions or credentials.

Per research session with the default 10 pages: **≈$0.09**

| Step                           | Calls            | Cost     |
| ------------------------------ | ---------------- | -------- |
| Search (_Sonar_)               | 1                | ≈$0.007  |
| Fetch (Defuddle + Markdown)    | 10 (≤4 concurrent) pairs | $0.00    |
| Extract (M3 via OpenRouter)         | 10 (≤4 concurrent) | ≈$0.07   |
| Collate (M3 via OpenRouter)         | 1                | ≈$0.01   |
| Cache suggest (M3 via OpenRouter)   | 1                | ≈$0.0002 |

Since v0.13.0 the search stage contributes every source the model cited, not only the ones it wrote into the prose, so sessions reach the `defaultUrls` page count more often than before. The ≈$0.09 figure is the planning estimate for a full 10-page research run with the v0.14.0 default models (M3 extracts cost the same per token as M2.7 but write ≈2× the output tokens); lower `defaultUrls` to hold earlier spend. Changing the search model or engine also changes the search step's cost (see [Choosing an Alternative Search Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#choosing-an-alternative-search-configuration)); the extract and collate rows scale with your chosen models.

## MCP Server Reference

This reference applies to `@curio-data/mcp-intelli-search` only. Installation routes are under [MCP Server](#mcp-server).

### Requirements

- [_Node.js_](https://nodejs.org/) satisfying the `engines` range in the [standalone manifest](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/package.json).
- An existing, explicitly selected absolute workspace directory.
- An explicitly selected JSON configuration file.
- A separately billed OpenRouter API key supplied through a named environment variable before constructing the runtime. Restart the runtime after changing credentials; it snapshots the environment.
- A platform supported by [_wreq-js_](https://github.com/sqdshguy/wreq-js), the browser-fingerprint fetch dependency. The installation gate exercises its native assets on the running platform; it does not establish support for other platforms.

The package neither reads host credential stores nor loads project configuration automatically. Native `Pi` settings, authentication, providers and defaults remain independent.

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

### Serving the Protocol

An invocation without `--check-config` validates the explicit configuration and workspace, then serves the four canonical tools (`intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`) over stdio until the input stream closes. Serving performs no inference at startup; credentials are only required when an operation runs.

- **Registration and Schemas.** Tool names and JSON input schemas mirror the native `Pi` tools verbatim; descriptions adapt the native guidance for protocol clients (host-neutral cache wording, embedded `focusPrompt` and breadth guidance), because the protocol offers no separate guidance channel. Invalid tool arguments are reported as tool errors (`isError` results), matching the SDK (software development kit) distinction between malformed protocol requests and invalid arguments.
- **Results.** Successful calls return the concise summary as text content plus structured content with `outcome` and `details`. Degraded research (`no-links`, `fetch-failed`, `extraction-failed`) remains a normal result. Execution failures return `isError` results tagged with the safe `StandaloneError` category rather than raw provider causes.
- **Queueing.** One operation runs at a time and up to eight further requests queue; requests beyond the bound settle immediately with a busy tool error. A queued request whose client cancels settles without starting its operation.
- **Progress and Cancellation.** When the client supplies a progress token, stage progress is forwarded as `notifications/progress` (percentage of one hundred). Client cancellation aborts the running operation through the shared model policy and stage boundaries.
- **Shutdown.** Closing standard input aborts in-flight and queued work, closes the transport and exits. `SIGINT` and `SIGTERM` trigger the same drain with a bounded hard-exit backstop. No unanswered request or runaway child work remains.
- **Framing.** Standard output carries protocol messages only. Before the server module loads, a guard diverts `process.stdout.write` (including console output, import-time writes and direct dependency writes) to standard error; the transport writes frames through the original stream, so the SDK's own output is never corrupted. Adapter diagnostics use standard error.
- **Annotations.** `intelli_search` and `intelli_extract` are marked read-only; `intelli_collate` and `intelli_research` write cache files and are not read-only. No tool claims idempotence. Operations use external services; inference and search charges apply to the configured provider account. Invalid calls and startup validation do not perform inference.

Startup diagnostics go to standard error. The SDK version range is declared in `package.json` (the lockfile pins the verified release); the protocol implementation is the official split server package verified in the repository handoff.

### Configuration

Select the configuration with `--config FILE` or `INTELLI_SEARCH_CONFIG`. Select the workspace with `--workspace ABSOLUTE_DIRECTORY` or `INTELLI_SEARCH_WORKSPACE`. Command-line values take precedence. Relative workspace paths are rejected; existing workspace symlinks are canonicalised.

The minimal example under [Generic MCP Host](#generic-mcp-host) explicitly selects OpenRouter for every role; add an optional `tuning` object (for example `"cacheDir": ".search"`) beside `providers` and `models`. These are example selections, not standalone defaults.

Only `providers`, `models` and optional `tuning` are accepted at the top level. All three model roles are required. The provider object accepts only `apiKeyEnv`, an environment-variable name rather than a key value. The initial provider scope is OpenRouter at its fixed `https://openrouter.ai/api/v1` endpoint; custom endpoints, proxy settings, provider fallback and dynamic router model identifiers are not accepted.

Configuration loading does not require working credentials. Each operation validates its required model roles against OpenRouter's model catalogue before inference. Full research validates all three roles first. Validation checks exact identifiers, text input/output, advertised reasoning efforts when supplied, and tool support for an enabled search tool. Catalogue lookup is bounded and cancellable. It establishes advertised capabilities, not account credit, per-key model access or future provider availability; inference errors remain possible.

Search requires either `perplexity/sonar`, `perplexity/sonar-pro`, `perplexity/sonar-pro-search`, or an explicitly enabled `searchWebSearch` block with a chat model. Enabling `searchWebSearch` also requires the selected model to advertise `tools` support. Combining that block with a Sonar model that does not advertise tool support fails preflight; the adapter does not silently drop the configured tool. Search tools are model-decided; a valid response can still contain no usable links.

#### Tuning

Unspecified tuning comes from the canonical [shared defaults](https://github.com/Curio-Data/pi-intelli-search/blob/main/src/core/defaults.ts), also used by the native adapter. The table gives each default and its effect alongside standalone validation ranges. No provider or model selection is inherited from that module. Unknown keys, invalid types and out-of-range values are rejected rather than silently clamped.

| Setting | Default and Effect | Accepted Values |
|---|---|---|
| `defaultUrls` | `10`: fallback page budget and one-shot search source-list cap | Integer from 1 to 100; must not exceed `maxUrls` |
| `maxUrls` | `20`: hard cap on research pages | Integer from 1 to 100 |
| `extractMaxChars` | `150000`: per-page extraction input character limit | Integer from 1 to 2,000,000 |
| `fetchTimeoutMs` | `20000`: page-fetch timeout in milliseconds | Integer from 1 to 600,000 |
| `llmTimeoutMs` | `90000`: application timeout per model call in milliseconds | Integer from 1 to 600,000 |
| `fetchConcurrency` | `4`: simultaneous page fetches | Integer from 1 to 32 |
| `extractionConcurrency` | `4`: simultaneous per-page extractions | Integer from 1 to 32 |
| `extractionMaxTokens` | `3000`: per-page output-token limit | Integer from 16 to 128,000 |
| `collationMaxTokens` | `4000`: synthesis output-token limit | Integer from 16 to 128,000 |
| `llmRetryAttempts` | `3`: model-call attempts, including the first | Integer from 1 to 10 |
| `searchRetryAttempts` | `2`: search attempts after a valid response with no usable links, including the first | Integer from 1 to 10 |
| `retryBaseDelayMs` | `1500`: base exponential-backoff delay in milliseconds | Integer from 0 to 120,000; must not exceed `retryMaxDelayMs` |
| `retryMaxDelayMs` | `20000`: maximum backoff and Retry-After delay in milliseconds | Integer from 0 to 120,000 |
| `minRequestIntervalMs` | `0`: extraction-call spacing in milliseconds; zero disables pacing | Integer from 0 to 120,000 |
| `cacheDir` | `.search`: workspace-relative cache directory | Nonempty relative directory, without absolute paths, backslashes or traversal components |
| `browserFingerprint` | `chrome_145`: browser signature for fetching | `chrome_145`, the verified shared profile |
| `disableTelemetry` | `false`: write the local `meta.json` sidecar; `true` suppresses it | Boolean |
| `disableLlmsFullDiscovery` | `false`: probe for supplementary documentation; `true` skips probes and downloads | Boolean |
| `searchWebSearch` | Disabled; engine `auto`, `maxResults: 8`, reasoning `minimal`. Enables the search server tool when configured | Validated block described below; replaces the entire shared default block |

`searchWebSearch` requires a boolean `enabled`. Optional fields are `engine` (`auto`, `native`, `exa`, `parallel`, `perplexity`, `firecrawl`), `maxResults` (1 to 25, capped at 20 for `perplexity`), `searchContextSize` (`low`, `medium`, `high`), `allowedDomains`, `excludedDomains`, and `reasoning` (`minimal`, `low`, `medium`, `high`). Domain lists contain hostnames, not URLs (uniform resource locators), and have at most 100 entries. The `perplexity` and `firecrawl` engines cannot combine nonempty allowed and excluded lists. Per-call domains also guide search; they are not a network allowlist for fetched pages.

**Retry Policy:** Every standalone model call, including one-shot search, extract and collate, receives configured retry and application-timeout defaults. The shared policy owns retries once; there is no underlying SDK retry loop. Retry-After delays are bounded by `retryMaxDelayMs`. Native one-shot policy remains unchanged.

**Provider Errors:** HTTP (Hypertext Transfer Protocol) errors and error-bearing successful responses, including `choices[].error`, preserve retry classification without exposing provider bodies or headers. The adapter treats a `402` with a valid Retry-After header as transient in-flight budget pressure. Ordinary credit exhaustion and permanent credential errors do not retry.

**Reasoning:** The adapter sends reasoning fields only when the catalogue advertises reasoning support; non-reasoning models receive neither effort nor exclusion fields.

**Output Budget:** Empty output after token-budget exhaustion is an error, not a successful extraction. Increase the output-token limit or lower reasoning effort when this diagnostic occurs.

### Direct Engine Verification

From the repository root:

```bash
npm run build:all
npm run test:all
npm run test:mcp:install
```

The installation gate packs the artifact, installs production dependencies into an isolated directory and denies all ancestor dependency resolution in both module systems. It runs the installed executable's `--help` and `--version`, all four operations with synthetic inference, and actual page fetching against a loopback fixture through the installed native fetch assets. A raw protocol exchange against the installed server verifies initialization, tool listing, invalid-argument rejection without inference and clean shutdown, and asserts that standard output carries only protocol frames. The deterministic installation gate uses no provider credentials and does not establish live MCP interoperability.

The recorded live scenario `test/e2e/11_mcp_stdio.sh` exercises a real research call through the MCP client of an isolated `Pi` profile. Its evidence is recorded separately in the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md), not supplied by the installation gate.

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

### Filesystem and Privacy Boundaries

All cache paths returned by the standalone adapter are absolute and anchored to the selected workspace. Cache and staging content stay beneath the configured cache directory. Existing symlinks, dangling links and hardlinked files in cache ancestors or artifact subtrees are rejected before an operation; checks repeat after model preflight. Special filesystem entries and an oversized safety scan are rejected. The full scan runs at runtime construction and twice per operation, so its cost grows with cache size; queued requests wait behind that scan. At 100,000 inspected entries, select a smaller cache directory or archive old entries after stopping all processes using that cache. Same-query runs on the same Coordinated Universal Time (UTC) date refresh one cache directory and do not promise separate histories; another UTC date produces a different directory.

These checks prevent pre-existing path escapes, not malicious concurrent filesystem replacement by another process with write access. Use a workspace controlled by the same trusted local operator. No operating-system sandbox or protection against hostile same-user mutation is claimed. Fetched URLs are not constrained to public addresses; the runtime is not a hosted service or an unrestricted remote execution endpoint.

The host must be able to read the returned paths. Summaries advise using the host's file-reading capability rather than requiring a tool named `read`. Cache formats and local telemetry retain the shared semantics; standalone telemetry adds package and adapter identity. Credentials are never inserted into prompts, cache metadata or generated launch configuration. Adapter diagnostics use standard error and omit raw provider errors, headers and transport exceptions. During operation execution, async-scoped interception replaces dependency stdout console output with a generic logger warning; a regression drives Defuddle's actual conversion-failure handler, which otherwise prints page content. While serving, the startup stdout guard also diverts import-time output and direct dependency writes to standard error; protocol tests assert clean framing with a deliberately noisy fixture.

### Timeouts and Troubleshooting

A full research call runs a search stage, up to `maxUrls` dual fetches, up to `maxUrls` extractions, a collation and an optional cache suggestion. Retries can add model calls. Progress notifications are not a guarantee against a host's total request deadline.

**Host Deadline:** If the host aborts a long tool call, reduce work with a lower per-call `maxUrls` (or lower `defaultUrls` and the configured cap), or adjust the host's own request deadline where supported. Changing `llmTimeoutMs` does not extend a host deadline.

**Model-Call Timeout:** Raise `llmTimeoutMs` only when the adapter's model-call timer expires and the host allows the longer duration. Client cancellation still aborts the running operation through the shared policy and stage boundaries; a cancelled queued request settles without starting.

Every startup failure is diagnostic-only and lands on standard error; standard output carries protocol frames only. The frequent cases:

| Symptom | Cause and Remedy |
|---|---|
| `Explicit --config and --workspace are required` | The server started without both selections. Supply `--config`/`--workspace` or the `INTELLI_SEARCH_CONFIG`/`INTELLI_SEARCH_WORKSPACE` environment variables, then restart the host. |
| `workspace must be an explicit absolute directory` | The workspace selection is relative or a host placeholder was not expanded. Use a literal absolute path; on hosts with placeholder expansion, verify the expansion on your host version. |
| `Cannot read configuration: provide an explicit readable JSON file` | The configuration path does not exist or is not readable. Create the file (the guides show a minimal valid document) and restart. |
| Configuration rejected with an unknown-key or range error | The loader is strict: unknown keys, invalid types and out-of-range values fail validation. Remove or correct the named key; the [Tuning](#tuning) table lists every accepted key and range. |
| Tools never appear in the host | The server exited during startup. Read the host's MCP server logs for the standard-error diagnostic; `mcp-intelli-search --check-config` reproduces configuration and workspace failures without a host. |
| Operations fail with `CONFIGURATION` or `PROVIDER` | The named credential environment variable is missing or the key was rejected. The server snapshots the environment at startup: restart it after changing credentials. Catalogue preflight failures name the offending model role. |
| Repeated 429 retries on a free-tier or shared key | Free-tier OpenRouter keys share a tight rate bucket. Set `minRequestIntervalMs` to approximately `3000`, lower `extractionConcurrency` to `2`, and raise `llmRetryAttempts`; raise `llmTimeoutMs` only when the model-call timer is expiring. |
| Cache paths unreadable from the host | The host must share the server's filesystem. Sandboxed or remote hosts cannot read local cache paths; run the server where the host can read the workspace. |

## Cache Structure

Both packages write this format. The native extension resolves the cache against the active `Pi` workspace; MCP resolves it against `INTELLI_SEARCH_WORKSPACE` or `--workspace` and keeps it beneath that workspace. See the MCP [filesystem boundaries](#filesystem-and-privacy-boundaries).

```text
.search/
├── 2026-04-19-d1-worker-api-3f7a2c/
│   ├── report.md               # Collated summary + source index
│   ├── query.txt               # Original search query
│   ├── meta.json               # Local-only telemetry sidecar (v0.11.0+)
│   ├── extractions/            # Per-page LLM extractions (≈3-5K each)
│   │   ├── 01-developers-cloudflare-com.md
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                # Full page content
│       ├── 01-developers-cloudflare-com.md
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md
└── .index.json                 # Index of all cached searches
```

Each cached session lives in a directory named `<date>-<slug>-<hash>`. The `<hash>` is a short Secure Hash Algorithm 1 (SHA-1) hash of the full query, appended so that distinct queries issued on the same day do not collide and overwrite each other. Concurrent runs stage their output before a short cache commit, so source files and the shared index remain intact.

**`meta.json` (local-only telemetry).** Each `intelli_research` run writes a `meta.json` sidecar recording per-stage outcomes: pages fetched and failed, fetch-variant winners (Defuddle versus Markdown), whether search-retry fired, cache-suggest hits, and per-stage latency. `stages.search.annotationsHarvested` counts `url_citation` entries recovered from the response body; it is absent on runs against models that emit none, and it is not a subset of `linksReturned`: harvested citations are merged with prose links before the `maxUrls` clamp, so a run can harvest twenty and report ten links. It is strictly local: no network call is added, no data leaves the host, and no account or identity is recorded. Set `disableTelemetry: true` in [Settings](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#settings) to suppress it. The bundled [`scripts/analyze-sessions.sh`](https://github.com/Curio-Data/pi-intelli-search/blob/main/scripts/README.md) can aggregate these sidecars to report per-stage success rates.

## Compatibility

### MCP Server Compatibility

- Direct stdio registration serves MCP-compatible hosts; repository plugin routes serve _Claude Code_ and _Codex_. `Pi` is the recorded live MCP research client.
- The runtime must satisfy the Node.js `engines` range in the [standalone manifest](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/package.json). The server uses the [`@modelcontextprotocol/server` SDK](https://github.com/modelcontextprotocol/typescript-sdk), with its dependency range declared in that manifest and the verified release pinned in [package-lock.json](https://github.com/Curio-Data/pi-intelli-search/blob/main/package-lock.json).
- Standalone fetch assets are verified on _Linux_ x86-64 only; _macOS_ and _Windows_ are not verified.
- Plugin installation and connection checks do not establish full research through either plugin. Registry-pin installation remains a separate post-publication gate.

For the standalone MCP server and host plugins, including exact tested versions of _Claude Code_, _Codex_, Node.js and the MCP SDK, see [docs/COMPATIBILITY.md](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md).

## Documentation

- [Comparison](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPARISON.md): How `intelli-search` compares to other `Pi` search extensions.
- [Changelog](https://github.com/Curio-Data/pi-intelli-search/blob/main/CHANGELOG.md): Release history.
- [Architecture](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/ARCHITECTURE.md): Detailed design decisions and pipeline internals.
- [Compatibility](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md): Tested host versions and artifacts for the native extension, MCP server and plugins.
- [Components](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPONENTS.md): Third-party dependencies and licence attribution.
- [Skill guide](https://github.com/Curio-Data/pi-intelli-search/blob/main/skills/intelli-search/SKILL.md): Agent-facing usage instructions.
- [Contributor guide](https://github.com/Curio-Data/pi-intelli-search/blob/main/AGENTS.md): Coding conventions and project structure.

## Downloads

### MCP Server Downloads

`@curio-data/mcp-intelli-search` is unpublished, so no public downloads chart exists. Missing metrics are not zero downloads.

## Sponsor

<img src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/sponsor.png" alt="Banner image for &quot;Curio Data Pro.&quot; A cartoon robot detective in a deerstalker hat and brown cape peers through binoculars on the left, beside a bordered logo reading &quot;CURIO DATA PRO&quot; in dark red serif type. The background is a stylised steampunk harbour scene featuring a docked submarine, a steam locomotive pulling into a quayside station, gas street lamps, industrial cranes, and brick warehouses under a hazy sky." width="800" />

**[Curio Data Pro Ltd](https://blog.curiodata.pro/)** sponsors this project. _Curio Data Pro_ is a data consultancy serving _Rail_, _Naval Design_, _Aviation_, and _Offshore Energy_, combining 20+ years of _Chartered Engineer_ experience with _Data Science_ and _DevOps_ capabilities.

[Blog](https://blog.curiodata.pro/) | [LinkedIn](https://www.linkedin.com/company/curio-data-pro-ltd/)

## License

Copyright 2026 Ashraf Miah, Curio Data Pro Ltd.

Licensed under the [Apache License, Version 2.0](https://github.com/Curio-Data/pi-intelli-search/blob/main/LICENSE).

## Use of Large Language Models

Large Language Models were used extensively during the development of this project:

- **`Pi` agent** (primary development environment).
- **_GLM_ 5.1/5.2/5.3:** Primary model family for code generation and architecture, across successive releases.
- **_Kimi_ K3:** Code generation, review, and vision-dependent verification.
- **_MiniMax_ M3:** Adversarial review and analysis.
- **_Qwen_ 3.8 Max:** Review and deep research.
- **_DeepSeek_ V4 Pro:** Research and data analysis.
- **_Qwen_ 3.6 Plus:** Secondary model for review and documentation.
