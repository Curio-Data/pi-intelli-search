<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. Edit the root README.md, then run npm run generate:readmes. -->

# mcp-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/mcp-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/mcp-intelli-search)
[![npm downloads](https://img.shields.io/npm/dt/@curio-data/mcp-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/mcp-intelli-search)
[![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](https://nodejs.org/)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](https://github.com/Curio-Data/pi-intelli-search/blob/main/LICENSE)
![tests](https://img.shields.io/badge/test%3Aall-594%20passing-brightgreen)

Intelligent web research for coding agents: search, extract, collate, and cache grounded web context in one tool call.

<p align="center">
  <img src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/01.png" alt="PI-Intelli Search: a five-stage research pipeline diagram arranged in a clockwise cycle. The five labelled stages, each enclosed in a laurel-wreath medallion, are Search (top, depicted as a magnifying glass over an open book), Fetch (right, a hand retrieving a document from shelves), Extract (bottom-right, a distillation apparatus), Collate (bottom-left, stacked books and filing boxes), and Cache &amp; Suggest (left, a treasure chest with an envelope). Copper-coloured arrows connect the stages in sequence. The background is decorated with pen-and-ink botanical and scholarly motifs including quill pens, ink bottles, scrolls, globes, hourglasses, and open books." width="800" />
</p>

**Features:**

- 🔍 **Search:** a search-grounded model, [_Perplexity Sonar_](https://docs.perplexity.ai) via [_OpenRouter_](https://openrouter.ai) by default. One application programming interface (API) key, no $50 minimum. Chat models with tool support also work through the web search server tool; see [native search settings](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#openrouter-web-search-server-tool) or [Model Context Protocol (MCP) tuning](#tuning).
- 🔗 **Harvest:** provider-supplied citation links recovered from the response, alongside links in the answer. Recognised `url_citation` annotations are merged with text links before pages are selected; recovery is best-effort, not a complete record of sources consulted.
- 🌐 **Fetch:** Dual-fetch each page (Hypertext Markup Language (HTML) → [_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), compare quality, pick the cleaner version.
- 📄 **Extract:** Per-page large language model (LLM) extraction guided by a _focused prompt_. Compresses ≈50K to ≈3-5K chars of query-relevant content.
- 🔗 **Collate:** Cross-source deduplication, inconsistency detection, and synthesis into a focused ≈5K-character summary.
- 💾 **Cache:** Persistent `.search/` cache with automatic cache suggest. Related previous searches surfaced on each query.
- 🎯 **Configurable:** Select models independently for search, extract and collate. The native extension uses registered, authenticated `Pi` models (capability and context limits apply); the MCP server uses explicitly selected OpenRouter models.
- 💰 **Cost:** see the [default research-run estimate](#cost).

`@curio-data/mcp-intelli-search` serves four research tools over the Model Context Protocol (MCP), using standard input/output (stdio). [Install with Claude Code](#claude-code) using the complete example below, or use [_Codex_](https://developers.openai.com/codex/mcp) or another MCP-compatible host.

For [`Pi`](https://github.com/earendil-works/pi), the sibling `@curio-data/pi-intelli-search` package registers the same engine natively through `Pi` settings and authentication. See [native installation](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#pi-native-extension).

The shared pipeline searches via a search-grounded model ([_Perplexity Sonar_](https://docs.perplexity.ai), the native default) and merges prose links with harvested citations before selecting pages. It fetches pages through a dual-fetch comparison ([_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), then extracts query-relevant content per page with a dedicated large language model (LLM) guided by a _focused prompt_. Collation deduplicates findings, flags inconsistencies, and synthesises a concise summary. Reports, extractions and fetched content are cached for offline reuse in `.search/` by default. Cache suggest surfaces related previous searches on each query.

## Two Packages, One Engine

Choose the installation route for the host:

| Route | Host | What to Install |
|---|---|---|
| Native `Pi` Extension | `Pi` | `@curio-data/pi-intelli-search` |
| Direct MCP Registration | Any MCP-compatible host | `@curio-data/mcp-intelli-search` |
| Host Plugin | Claude Code or Codex | Repository marketplace launching the pinned MCP package |

The install branches: [`Pi` Native Extension](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#pi-native-extension) and [MCP Server](#mcp-server), with host instructions for [Claude Code](#claude-code), [Codex](#codex) and any [Generic MCP Host](#generic-mcp-host).

The native extension uses `Pi` settings and authentication. The MCP server requires explicit configuration, a per-folder workspace and an environment-supplied inference key; it does not read `Pi` settings or credentials.

## Contents

<!-- TOC:START -->

- [Two Packages, One Engine](#two-packages-one-engine)
- [Install](#install)
  - [MCP Server](#mcp-server)
    - [MCP Prerequisites](#mcp-prerequisites)
    - [Claude Code](#claude-code)
    - [Claude Code Plugin](#claude-code-plugin)
    - [Codex](#codex)
    - [Generic MCP Host](#generic-mcp-host)
- [Tools](#tools)
  - [Evidence and Provenance](#evidence-and-provenance)
- [Usage Examples](#usage-examples)
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
- [Sponsor](#sponsor)
- [Licence](#licence)
- [Use of Large Language Models](#use-of-large-language-models)

<!-- TOC:END -->

<a id="use-with-other-hosts"></a>
## Install

### MCP Server

`@curio-data/mcp-intelli-search` serves the four research tools over stdio. The Claude Code example below covers configuration, credentials, registration and verification in one sequence. Host plugins and generic registration follow as alternatives; install only one route in a host to avoid duplicate tool sets.

#### MCP Prerequisites

- [_Node.js_](https://nodejs.org/) 22 or later, with `node` and `npx` on `PATH`.
- [_Claude Code_](https://code.claude.com/docs/en/overview) installed for the example below.
- An [OpenRouter API key](https://openrouter.ai/keys) with credit for inference. One key covers all three model roles; charges are separate from the host subscription.
- An existing project folder for the research cache. The server and host must be able to read the same filesystem.

The server requires an explicit JavaScript Object Notation (JSON) configuration and absolute workspace path. It reads no host credential stores, `Pi` settings or discovered project configuration. Native fetch assets are verified on _Linux_ x86-64; _macOS_ and _Windows_ are not verified. See [Compatibility](#mcp-server-compatibility) for the recorded scope.

#### Claude Code

Run the following steps from the project folder in a [_Bash_](https://www.gnu.org/software/bash/) shell. Direct registration is private to the operator and active only in that folder.

##### Create the Configuration

Save this as `.intelli-search.json` in the project folder:

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

These are explicit model selections, not inherited defaults. The configuration contains the credential variable's name, not the key itself. The cache lands in the project folder's `.search/` directory.

##### Supply the API Key

Enter the key at the hidden prompt, rather than writing it into shell history or a configuration file:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
```

The export lasts for this shell session. Launch Claude Code from this shell so its server inherits the key. Repeat this step in a new shell, or use a secret manager to supply the variable. Restart Claude Code after changing the key; the server snapshots credentials at startup.

##### Register the Server

```bash
claude mcp add intelli_search --scope local \
  -e "INTELLI_SEARCH_CONFIG=$PWD/.intelli-search.json" \
  -e "INTELLI_SEARCH_WORKSPACE=$PWD" \
  -- npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search
```

`npx` downloads the package on first use; no separate package installation is required. Append `@<version>` to the package name to pin a release. The command records absolute paths for this folder. Replace `--scope local` with `--scope project` only to share registration through `.mcp.json`; project-scoped servers require approval, and those paths must exist on each operator's machine. Never put the API key in that file.

##### Verify the Connection

Validate the configuration and workspace:

```bash
npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search \
  --config "$PWD/.intelli-search.json" \
  --workspace "$PWD" \
  --check-config
```

A successful check prints `Configuration is valid.` and exits with status `0`. This check requires no credentials and performs no inference; it does not test model access.

Check the registered server, then start a session from the same shell:

```bash
claude mcp list
claude
```

Confirm `intelli_search` shows as connected. In the session, run `/mcp` to inspect its four tools: `intelli_search`, `intelli_extract`, `intelli_collate` and `intelli_research`. To test inference, ask: “Use intelli_search to find the current TypeScript release and cite the official source.” This call incurs OpenRouter charges. A successful answer with sources verifies inference separately from the connection check.

##### Customise the Server

Change the model selections in `.intelli-search.json`, or add an optional `tuning` object alongside `providers` and `models`. For example, `"tuning": { "defaultUrls": 6, "maxUrls": 6 }` limits research to six pages. Restart the host after changes. See [Configuration](#configuration) and [Tuning](#tuning) for the full reference.

<a id="route-b-claude-code-plugin"></a>
#### Claude Code Plugin

The [Claude Code plugin](https://code.claude.com/docs/en/plugins) bundles the server registration and an agent-facing research skill. Use it instead of direct registration:

```bash
claude plugin marketplace add Curio-Data/pi-intelli-search
claude plugin install intelli-search@curio-data-plugins
```

Set the required `openrouter_api_key` option through `/plugin` → Installed → `intelli-search` → Configure. Claude Code stores it in its credential store and withholds the server until it is set. Unlike direct registration, this plugin ignores an exported `OPENROUTER_API_KEY`: the plugin option supplies that variable.

Create the plugin data directory:

```bash
mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/intelli-search-curio-data-plugins"
```

Save the same [minimal configuration](#create-the-configuration) as `config.json` in that directory. It persists across plugin updates but is removed on uninstall. The launcher uses the opened project as its workspace, so each project's cache stays in its own `.search/` directory.

Restart Claude Code, then run `claude mcp list` and confirm `plugin:intelli-search:intelli_search` shows as connected. The launcher downloads a pinned package through `npx` on first start. Run `/intelli-search:intelli-search` for the skill with this host's paths substituted. Do not use `claude plugin install --config openrouter_api_key=...`: that exposes the key in process arguments. Then request a quick search through the server and confirm a model-visible answer with sources; connection alone does not verify inference. The installed `intelli-search` skill includes shell-based credential setup and troubleshooting; the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) records tested host versions.

<a id="route-c-codex-plugin"></a>
#### Codex

The [Codex plugin](https://developers.openai.com/codex/plugins) installs from the same repository marketplace:

```bash
codex plugin marketplace add Curio-Data/pi-intelli-search
codex plugin add intelli-search --marketplace curio-data-plugins
```

Save the [minimal configuration](#create-the-configuration) as `.intelli-search.json` in the project folder and [supply the API key](#supply-the-api-key). From that folder, export the paths before launching Codex:

```bash
export INTELLI_SEARCH_CONFIG="$PWD/.intelli-search.json"
export INTELLI_SEARCH_WORKSPACE="$PWD"
codex
```

In the session, ask: “Use intelli_search to find the current TypeScript release and cite the official source.” Confirm a successful MCP tool call and an answer with sources. `codex mcp list` alone does not start the server or prove inference. If the tools are unavailable, the setup is incomplete: an answer from the host's own web search does not show that this server ran.

Codex filters the server environment; the plugin forwards `OPENROUTER_API_KEY`, `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` explicitly. Set all three before each launch. The installed `intelli-search` skill covers persistent configuration and unattended tool approval; see the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for verified host behaviour.

<a id="route-a-direct-mcp-configuration"></a>
#### Generic MCP Host

Any stdio host, including [_Open Code_](https://opencode.ai/docs/mcp-servers/), can register the server directly. Save the [minimal configuration](#create-the-configuration) to a readable file and adapt this registration JSON to the host's format:

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

Replace both paths with existing absolute paths. Supply `OPENROUTER_API_KEY` through the host's secret mechanism or inherited environment, not committed configuration. Run the [configuration check](#verify-the-connection) with those paths, then confirm the host connects and lists the four tools. The host reads cached pages with its own file-reading capability.

MCP hosts qualify tool names; use the names exposed by the host. The native `Pi` extension and the MCP server are independent installations; enabling both in one agent gives duplicate tool sets, which is not a supported configuration.

## Tools

Both packages expose these four operations. Start with `intelli_search` for factual questions, latest versions and release dates; use `intelli_research` for multi-page comparisons, detailed analysis or an evidence gap that search leaves unresolved. The names below are native `Pi` tool names and MCP server tool names; MCP hosts add their own callable-name prefixes. Use the names exposed by the host.

| Tool               | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `intelli_search`   | Search the web and return a concise answer with a source list (top `defaultUrls`).                   |
| `intelli_extract`  | Extract query-relevant content from a web page, preserving code and technical detail verbatim.      |
| `intelli_collate`  | Deduplicate and synthesise multiple extractions into a summary. Writes cache.                       |
| `intelli_research` | Search, fetch, extract, collate and cache multi-page research in one call.                        |

### Evidence and Provenance

Research collation receives only successful, non-empty page extractions, not the search model's summary. Code generates the Source Assessment inventory and cache-file references from the run's evidence manifest. Synthesis uses source IDs such as `[S1]`; unknown IDs, prose URLs absent from the supplied extractions and model-generated numbered cache references fail validation before a report is committed. Cross-links present in extracted text remain content, not additional fetched pages. Fenced, indented and inline code examples remain code, not evidence declarations. These checks establish reference consistency, not factual accuracy.

Manual `intelli_collate` labels its evidence as caller-supplied extractions; it does not claim the server fetched those pages. Empty or duplicate source evidence is rejected. The optional `searchSummary` input remains accepted for compatibility but does not supply synthesis evidence. Per-source relevance and contribution ratings are no longer model-generated. Read exact cache paths from the inventory; `Not cached` means no full-page file was supplied.

<a id="quick-start"></a>
## Usage Examples

These examples describe tool calls for the agent, not shell commands. MCP hosts add their own tool-name prefixes.

### Quick Search

```text
intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research

Always provide a `focusPrompt`. The extraction LLM works best with specific guidance.

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

`domains` guides source selection, it is not a security boundary: the query gains a `site:` expression, and with the web search tool enabled the same domains are also combined with `searchWebSearch.allowedDomains` and sent as an engine filter. The lists are combined, not intersected, and returned uniform resource locators (URLs) are not checked against a local hostname allowlist before fetching. Engine support for allow and exclude lists differs; see [native searchWebSearch keys](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#searchwebsearch-keys) or [MCP tuning](#tuning).

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

The illustration shows the native pipeline with the model configuration at its creation, including MiniMax M2.7 and `Pi` authentication; it does not show the current defaults or standalone authentication. All model assignments are configurable through [native model settings](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#model-configuration) or [MCP configuration](#configuration); alternative search configurations use the same five-stage pipeline.

The search stage merges text links with harvested citation annotations before selecting pages (see [Source Harvesting from Citations](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#source-harvesting-from-citations)). Each page is dual-fetched (HTML via Defuddle versus Markdown endpoint) and scored for quality. Per-page extraction (guided by `focusPrompt`) compresses ≈50K chars to ≈3-5K of query-relevant content before collation, keeping the total context manageable (≈30-50K for 10 pages).

Completed runs and the degraded exits recorded in `outcome` (`no-links`, `fetch-failed`, `extraction-failed`) attempt to write a local-only `meta.json` telemetry sidecar into the cache directory (see [Cache Structure](#cache-structure)). Set `"disableTelemetry": true` in the native `pi-intelli-search` namespace or the MCP `tuning` object to suppress it.

See [docs/ARCHITECTURE.md](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

The estimate below uses the native default models and tuning, also selected in the minimal MCP configuration example. It is a planning estimate based on the recorded September 2026 price basis, not a live tariff check. Both packages incur inference charges on the configured provider account; MCP does not use host subscriptions or credentials.

Per research run with the default 10 pages: ≈$0.09

| Step                                | Calls                 | Cost      |
| ---------------------------------- | --------------------- | --------- |
| Search (Sonar)                      | 1                     | ≈$0.007   |
| Fetch (Defuddle + Markdown)         | 10 (≤4 concurrent) pairs | $0.00  |
| Extract (M3 via OpenRouter)         | 10 (≤4 concurrent)    | ≈$0.07    |
| Collate (M3 via OpenRouter)         | 1                     | ≈$0.01    |
| Cache Suggest (M3 via OpenRouter)   | 1                     | ≈$0.0002  |

Since v0.13.0 the search stage adds recovered provider citation URLs to prose links, increasing the candidate source set; `maxUrls` still caps page selection. The ≈$0.09 figure is the planning estimate for a full 10-page research run with the v0.14.0 default models (M3 and M2.7 had equal per-token prices in the recorded benchmark; M3 wrote ≈2× the extraction characters, with the cost estimate separately projecting greater token usage); lower `defaultUrls` to hold earlier spend. Changing the search model or engine also changes the search step's cost; configure it through [native model settings](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#choosing-an-alternative-search-configuration) or [MCP configuration](#configuration). The extract and collate rows scale with the selected models.

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

The [installation example](#verify-the-connection) shows the configuration check, host connection check and first inference call in sequence. These establish different things:

| Check | What It Establishes |
|---|---|
| `mcp-intelli-search --check-config` with explicit configuration and workspace | Configuration and workspace are valid. Requires no credentials and performs no inference. |
| Host connection and tool listing | The server starts and completes the MCP connection. Does not establish provider access. |
| A successful `intelli_search` call with sources | Search inference works with the selected model and credential. Incurs provider charges; does not exercise the full research pipeline. |

Use the same configuration and workspace as the registered server. If a project-scoped Claude Code server shows pending approval, open the host in that folder and approve it before checking again.

### Serving the Protocol

An invocation without `--check-config` validates the explicit workspace, then serves the four canonical tools (`intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`) over stdio until the input stream closes. An explicitly selected missing, unreadable or invalid configuration file does not prevent connection: each tool call returns an actionable `CONFIGURATION` error, and the server rereads the file on each call until it loads. Repair the file and call again. Once loaded, configuration remains fixed until restart. Missing launcher arguments and invalid workspaces still fail at startup; `--check-config` remains strict. Serving performs no inference at startup; credentials are only required when an operation runs.

- **Registration and Schemas.** Tool names and JSON input schemas mirror the native `Pi` tools verbatim; descriptions adapt the native guidance for protocol clients (host-neutral cache wording, embedded `focusPrompt` and breadth guidance), because the protocol offers no separate guidance channel. Invalid tool arguments are reported as tool errors (`isError` results), matching the software development kit (SDK) distinction between malformed protocol requests and invalid arguments.
- **Results.** Successful calls return the complete operation text both as text content and as `structuredContent.text`, alongside `outcome` and `details`. Hosts that prefer the structured representation receive the same answer, sources and cache suggestions. The duplication is intentional for host compatibility; a host that forwards both representations can consume extra context. Degraded research (`no-links`, `fetch-failed`, `extraction-failed`) remains a normal result. Execution failures return `isError` results tagged with the safe `StandaloneError` category rather than raw provider causes.
- **Queueing.** One operation runs at a time and up to eight further requests queue; requests beyond the bound settle immediately with a busy tool error. A queued request whose client cancels settles without starting its operation.
- **Progress and Cancellation.** When the client supplies a progress token, stage progress is forwarded as `notifications/progress` (percentage of one hundred). Client cancellation aborts the running operation through the shared model policy and stage boundaries.
- **Shutdown.** Closing standard input aborts in-flight and queued work, closes the transport and exits. `SIGINT` and `SIGTERM` trigger the same drain with a bounded hard-exit backstop. No unanswered request or runaway child work remains.
- **Framing.** Standard output carries protocol messages only. Before the server module loads, a guard diverts `process.stdout.write` (including console output, import-time writes and direct dependency writes) to standard error; the transport writes frames through the original stream, so the SDK's own output is never corrupted. Adapter diagnostics use standard error.
- **Annotations.** `intelli_search` and `intelli_extract` are marked read-only; `intelli_collate` and `intelli_research` write cache files and carry `destructiveHint: true` because repeating a query replaces the canonical cache folder's contents (attempting to archive the previous set to a numbered sibling; archive failure falls back to in-place replacement). No tool claims idempotence. Operations use external services; inference and search charges apply to the configured provider account. Invalid calls and startup validation do not perform inference.

Startup diagnostics go to standard error. The SDK version range is declared in `package.json` (the lockfile pins the verified release); the protocol implementation is the official split server package verified in the repository handoff.

### Configuration

Select the configuration with `--config FILE` or `INTELLI_SEARCH_CONFIG`. Select the workspace with `--workspace ABSOLUTE_DIRECTORY` or `INTELLI_SEARCH_WORKSPACE`. Command-line values take precedence. Relative workspace paths are rejected; existing workspace symlinks are canonicalised.

The [minimal configuration](#create-the-configuration) explicitly selects OpenRouter for every role; add an optional `tuning` object (for example `"cacheDir": ".search"`) beside `providers` and `models`. These are example selections, not standalone defaults.

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

**Output Budget:** Empty output after token-budget exhaustion is an error, not a successful extraction. Empty collation is likewise rejected before a completed report is written. When these diagnostics occur, increase `collationMaxTokens`, lower reasoning effort, or choose a model with a smaller reasoning budget.

### Direct Engine Verification

From the repository root:

```bash
npm run build:all
npm run test:all
npm run test:mcp:install
```

The installation gate packs the artefact, installs production dependencies into an isolated directory and denies all ancestor dependency resolution in both module systems. It runs the installed executable's `--help` and `--version`, all four operations with synthetic inference, and actual page fetching against a loopback fixture through the installed native fetch assets. A raw protocol exchange against the installed server verifies initialisation, tool listing, invalid-argument rejection without inference and clean shutdown, and asserts that standard output carries only protocol frames. The deterministic installation gate uses no provider credentials and does not establish live MCP interoperability.

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

`mcp-intelli-search --help` and `--version` need no configuration. `--check-config` validates explicit configuration and workspace syntax without credentials or inference, returning exit status 0 for valid configuration and 1 for invalid input. Neither starts a protocol connection. `loadConfig()` throws an exported `ConfigurationError` for file defects, with a `reason` of `missing`, `unreadable`, `invalid-json` or `invalid`; workspace failures remain separate. JSON syntax diagnostics include a location without echoing file contents. The runtime entrypoint is experimental and has no published TypeScript declaration contract. Execution failures expose a safe `StandaloneError.code`: `INVALID_ARGUMENTS`, `CONFIGURATION`, `WORKSPACE`, `PROVIDER`, `OPERATION` or `CANCELLED`. Cancellation uses the `AbortError` name. Raw provider causes are deliberately not retained. Some shared operations wrap provider exceptions, which become `OPERATION` errors; protocol mapping must not depend on exact diagnostic strings.

### Filesystem and Privacy Boundaries

All cache paths returned by the standalone adapter are absolute and anchored to the selected workspace. Cache and staging content stay beneath the configured cache directory. Existing symlinks, dangling links and hardlinked files in cache ancestors or artefact subtrees are rejected before an operation; checks repeat after model preflight. Special filesystem entries and an oversized safety scan are rejected. The full scan runs at runtime construction and twice per operation, so its cost grows with cache size; queued requests wait behind that scan. At 100,000 inspected entries, select a smaller cache directory or archive old entries after stopping all processes using that cache. Same-query runs on the same Coordinated Universal Time (UTC) date refresh one cache directory. A completed refresh attempts to archive the prior artefacts to a numbered sibling; archive failure is logged and can lead to in-place replacement. A degraded repeat preserves prior successful output. Another UTC date produces a different directory.

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
| `workspace must be an explicit absolute directory` | The workspace selection is relative or a host placeholder was not expanded. Use a literal absolute path; on hosts with placeholder expansion, verify the expansion on the installed host version. |
| `Configuration file not found`, `not readable`, `empty` or `not valid JSON` | The selected file is missing or defective. The error names its absolute path; JSON syntax errors include a location without showing file contents. `--check-config` reports the error and exits 1. While serving, repair the file and call again. |
| Configuration rejected with an unknown-key or range error | The loader is strict: unknown keys, invalid types and out-of-range values fail validation. Correct the configuration and call again if it has not yet loaded. The [Tuning](#tuning) table lists accepted keys and ranges. |
| Tools never appear in the host | Check absent launcher arguments, an unusable workspace or an unsafe cache. Read the host's MCP server logs for the standard-error diagnostic. Claude Code can cache a startup failure from an older server: try `/mcp` reconnect, then restart ([evidence and limits](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#claude-code-evidence-and-limits)). A connected server still needs a successful tool call to verify inference. |
| `CONFIGURATION` persists after the file is repaired | A file that has not yet loaded is reread on the next call; once loaded, configuration changes require a restart. |
| Diagnostic names a missing credential environment variable | Supply the named variable through the host's supported credential mechanism and restart. The server snapshots credentials at startup. |
| Catalogue preflight names a model role or capability | Correct the model identifier or required capabilities using [Configuration](#configuration). Read the diagnostic; catalogue lookup failures are not proof of invalid credentials. Restart after changing loaded model selections. |
| `PROVIDER` reports authentication, access, credit or transport failure | Follow the specific diagnostic: check credentials, model access, account credit or connectivity. Restart after changing credentials. The category alone does not identify a rejected key. |
| Repeated `429` retries | Tune pacing to observed account/provider limits. For an observed limit of approximately 0.33 requests per second, try `minRequestIntervalMs: 3000` and `extractionConcurrency: 2`; adjust retry attempts as needed. Raise `llmTimeoutMs` only when its model-call timer expires. |
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

Each research run writes a cache entry named `<date>-<slug>-<hash>`. The `<hash>` is six hexadecimal characters from a Secure Hash Algorithm 1 (SHA-1) hash of the full query. It distinguishes queries sharing a readable stem and reduces collision risk; it does not guarantee unique names. Concurrent writers use short cache locks, and index updates are atomic. Cache readers do not take those locks: a multi-file refresh is not a whole-directory atomic snapshot.

Refresh behaviour:

- A completed same-day refresh attempts to archive the previous report, extractions, numbered sources and telemetry sidecar to a numbered sibling folder (`<slug>.1`, then `.2` and so on) before writing the new set.
- Archive failure is logged and the completed run can replace canonical files in place; interrupted rotation can leave a partial archive.
- Supplementary `llms-full-*` documentation downloads stay with the live folder and are not archived.
- A degraded repeat preserves the earlier successful report, extractions, sources and index entry untouched and records only the failed attempt in `meta.json`.
- The numbered siblings are a same-day safety net, not a versioned archive: copy a report elsewhere if it must be retained long-term.

**Local Telemetry (`meta.json`):** Unless disabled, completed runs and the degraded exits recorded in `outcome` attempt a best-effort sidecar write. Cancellation and thrown failures do not all produce a sidecar. It records the full research query and per-stage outcomes: pages fetched and failed, fetch-variant winners (Defuddle versus Markdown), search retries, cache-suggest hits and latency. `stages.search.annotationsHarvested` counts recovered `url_citation` entries and can be `0` when none are recovered. Historical records or an unreached stage can omit it. It is not a subset of `linksReturned`: harvested citations are merged with prose links before the `maxUrls` clamp, so a run can harvest twenty and report ten links. The sidecar adds no network transmission or credential/account-identifier fields, but the query and metadata can contain personal or confidential information. Ordinary research requests still go to configured external services. The bundled [`scripts/analyze-sessions.sh`](https://github.com/Curio-Data/pi-intelli-search/blob/main/scripts/README.md) can aggregate these sidecars to report per-stage success rates.

To suppress the sidecar in the MCP server, set `"disableTelemetry": true` inside the configuration's [`tuning` object](#tuning).

## Compatibility

### MCP Server Compatibility

- Direct stdio registration serves MCP-compatible hosts; repository plugin routes serve Claude Code and Codex. Recorded live research clients include `Pi` and both plugin hosts.
- The runtime must satisfy the Node.js `engines` range in the [standalone manifest](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/package.json). The server uses the [`@modelcontextprotocol/server` SDK](https://github.com/modelcontextprotocol/typescript-sdk), with its dependency range declared in that manifest and the verified release pinned in [package-lock.json](https://github.com/Curio-Data/pi-intelli-search/blob/main/package-lock.json).
- Standalone fetch assets are verified on _Linux_ x86-64 only; _macOS_ and _Windows_ are not verified.
- Full research through local-tarball plugins and registry-pin installation checks are separate evidence classes. The compatibility matrix records which checks have run for each artefact; publication alone does not establish host compatibility.

For the standalone MCP server and host plugins, including exact tested versions of _Claude Code_, _Codex_, Node.js and the MCP SDK, see [docs/COMPATIBILITY.md](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md).

## Documentation

- [Comparison](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPARISON.md): How `intelli-search` compares to other `Pi` search extensions and to host-native web search.
- [Changelog](https://github.com/Curio-Data/pi-intelli-search/blob/main/CHANGELOG.md): Release history.
- [Architecture](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/ARCHITECTURE.md): Detailed design decisions and pipeline internals.
- [Compatibility](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md): Tested host versions and artefacts for the native extension, MCP server and plugins.
- [Components](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPONENTS.md): Third-party dependencies and licence attribution.
- [Claude Code skill](https://github.com/Curio-Data/pi-intelli-search/blob/main/plugins/claude-code/skills/intelli-search/SKILL.md) and [Codex skill](https://github.com/Curio-Data/pi-intelli-search/blob/main/plugins/codex/skills/intelli-search/SKILL.md): Host-specific setup and agent-facing usage instructions.
- [Contributor guide](https://github.com/Curio-Data/pi-intelli-search/blob/main/AGENTS.md): Coding conventions and project structure.

## Downloads

Weekly npm downloads for both packages, stacked by package and refreshed every Monday by a scheduled GitHub Action. The native extension is the lower segment of each bar and the MCP server is the upper segment. The chart is rendered with [rough.js](https://roughjs.com) from daily caches in `data/downloads.json` and `data/downloads-mcp.json` (see `scripts/plot-downloads.mts`); the caches are append-only with a short trailing re-fetch window so npm's revisions of recent days are picked up. Only complete Monday-to-Sunday weeks are drawn, so a package's segment appears from the first refresh after its first complete week.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/downloads-dark.svg">
    <img alt="Stacked weekly npm downloads for @curio-data/pi-intelli-search and @curio-data/mcp-intelli-search" src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/downloads-light.svg" width="800" />
  </picture>
</p>

## Sponsor

<img src="https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/docs/images/sponsor.png" alt="Banner image for &quot;Curio Data Pro.&quot; A cartoon robot detective in a deerstalker hat and brown cape peers through binoculars on the left, beside a bordered logo reading &quot;CURIO DATA PRO&quot; in dark red serif type. The background is a stylised steampunk harbour scene featuring a docked submarine, a steam locomotive pulling into a quayside station, gas street lamps, industrial cranes, and brick warehouses under a hazy sky." width="800" />

**[Curio Data Pro Ltd](https://blog.curiodata.pro/)** sponsors this project. _Curio Data Pro_ is a data consultancy serving _Rail_, _Naval Design_, _Aviation_, and _Offshore Energy_, combining 20+ years of _Chartered Engineer_ experience with _Data Science_ and _DevOps_ capabilities.

[Blog](https://blog.curiodata.pro/) | [LinkedIn](https://www.linkedin.com/company/curio-data-pro-ltd/)

<a id="license"></a>
## Licence

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
- **_Claude_ Opus 5.0/5.5:** Primary model for MCP variant.
