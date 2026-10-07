<!-- packages:mcp hidden
# mcp-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/mcp-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/mcp-intelli-search)
[![npm downloads](https://img.shields.io/npm/dt/@curio-data/mcp-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/mcp-intelli-search)
[![node](https://img.shields.io/badge/node-%E2%89%A522-blue)](https://nodejs.org/)
-->
<!-- packages:pi -->
# pi-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![npm downloads](https://img.shields.io/npm/dt/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![pi compatible](https://img.shields.io/badge/pi-%E2%89%A50.81.1-blueviolet)](https://github.com/earendil-works/pi)
<!-- /packages -->
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)
![tests](https://img.shields.io/badge/test%3Aall-580%20passing-brightgreen)

Intelligent web research for coding agents: search, extract, collate, and cache grounded web context in one tool call.

<p align="center">
  <img src="docs/images/01.png" alt="PI-Intelli Search: a five-stage research pipeline diagram arranged in a clockwise cycle. The five labelled stages, each enclosed in a laurel-wreath medallion, are Search (top, depicted as a magnifying glass over an open book), Fetch (right, a hand retrieving a document from shelves), Extract (bottom-right, a distillation apparatus), Collate (bottom-left, stacked books and filing boxes), and Cache &amp; Suggest (left, a treasure chest with an envelope). Copper-coloured arrows connect the stages in sequence. The background is decorated with pen-and-ink botanical and scholarly motifs including quill pens, ink bottles, scrolls, globes, hourglasses, and open books." width="800" />
</p>

**Features:**

- 🔍 **Search:** a search-grounded model, [_Perplexity Sonar_](https://docs.perplexity.ai) via [_OpenRouter_](https://openrouter.ai) by default. One application programming interface (API) key, no $50 minimum. Chat models with tool support also work through the web search server tool; see [native search settings](#openrouter-web-search-server-tool) or [Model Context Protocol (MCP) tuning](#tuning).
- 🔗 **Harvest:** provider-supplied citation links recovered from the response, alongside links in the answer. Recognised `url_citation` annotations are merged with text links before pages are selected; recovery is best-effort, not a complete record of sources consulted.
- 🌐 **Fetch:** Dual-fetch each page (Hypertext Markup Language (HTML) → [_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), compare quality, pick the cleaner version.
- 📄 **Extract:** Per-page large language model (LLM) extraction guided by a _focused prompt_. Compresses ≈50K to ≈3-5K chars of query-relevant content.
- 🔗 **Collate:** Cross-source deduplication, inconsistency detection, and synthesis into a focused ≈5K-character summary.
- 💾 **Cache:** Persistent `.search/` cache with automatic cache suggest. Related previous searches surfaced on each query.
- 🎯 **Configurable:** Select models independently for search, extract and collate. The native extension uses any model `Pi` supports; the MCP server uses explicitly selected OpenRouter models.
- 💰 **Cost:** see the [default research-run estimate](#cost).

<!-- packages:none -->
This repository provides two first-class packages from one research engine:

- `@curio-data/pi-intelli-search`: a [`Pi`](https://github.com/earendil-works/pi) extension that registers the four research tools natively, using `Pi` settings, authentication and the model registry.
- `@curio-data/mcp-intelli-search`: a standalone Model Context Protocol (MCP) server over standard input/output (stdio) for MCP-compatible hosts, including [_Claude Code_](https://code.claude.com/docs/en/mcp) and [_Codex_](https://developers.openai.com/codex/mcp).

Both packages run the same five-stage pipeline with the same cache format. [Install](#install) covers both the [`Pi` native extension](#pi-native-extension) and the [MCP server](#mcp-server), including direct MCP registration and host plugins.
<!-- /packages -->
<!-- packages:pi hidden
`@curio-data/pi-intelli-search` registers four research tools natively in [`Pi`](https://github.com/earendil-works/pi), using its settings, authentication and model registry. [Install the extension](#pi-native-extension) to get started.

For other coding agents, the sibling `@curio-data/mcp-intelli-search` package serves the same engine and cache format through the Model Context Protocol (MCP). See [MCP installation](#mcp-server).
-->
<!-- packages:mcp hidden
`@curio-data/mcp-intelli-search` serves four research tools over the Model Context Protocol (MCP), using standard input/output (stdio). [Install with Claude Code](#claude-code) using the complete example below, or use [_Codex_](https://developers.openai.com/codex/mcp) or another MCP-compatible host.

For [`Pi`](https://github.com/earendil-works/pi), the sibling `@curio-data/pi-intelli-search` package registers the same engine natively through `Pi` settings and authentication. See [native installation](#pi-native-extension).
-->

The shared pipeline searches via a search-grounded model ([_Perplexity Sonar_](https://docs.perplexity.ai), the native default) and merges prose links with harvested citations before selecting pages. It fetches pages through a dual-fetch comparison ([_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), then extracts query-relevant content per page with a dedicated large language model (LLM) guided by a _focused prompt_. Collation deduplicates findings, flags inconsistencies, and synthesises a concise summary. Reports, extractions and fetched content are cached for offline reuse in `.search/` by default. Cache suggest surfaces related previous searches on each query.

## Two Packages, One Engine

Choose the installation route for the host:

| Route | Host | What to Install |
|---|---|---|
| Native `Pi` Extension | `Pi` | `@curio-data/pi-intelli-search` |
| Direct MCP Registration | Any MCP-compatible host | `@curio-data/mcp-intelli-search` |
| Host Plugin | Claude Code or Codex | Repository marketplace launching the pinned MCP package |

The install branches: [`Pi` Native Extension](#pi-native-extension) and [MCP Server](#mcp-server), with host instructions for [Claude Code](#claude-code), [Codex](#codex) and any [Generic MCP Host](#generic-mcp-host).

The native extension uses `Pi` settings and authentication. The MCP server requires explicit configuration, a per-folder workspace and an environment-supplied inference key; it does not read `Pi` settings or credentials.

## Contents

<!-- TOC:START -->

- [Two Packages, One Engine](#two-packages-one-engine)
- [Install](#install)
  - [`Pi` Native Extension](#pi-native-extension)
    - [Prerequisites](#prerequisites)
    - [Install the Extension](#install-the-extension)
    - [Verify Installation](#verify-installation)
    - [Customise (Optional)](#customise-optional)
  - [MCP Server](#mcp-server)
    - [MCP Prerequisites](#mcp-prerequisites)
    - [Claude Code](#claude-code)
    - [Claude Code Plugin](#claude-code-plugin)
    - [Codex](#codex)
    - [Generic MCP Host](#generic-mcp-host)
- [Tools](#tools)
- [Usage Examples](#usage-examples)
  - [Quick Search](#quick-search)
  - [Deep Research](#deep-research)
  - [Targeted Research With Domain Guidance](#targeted-research-with-domain-guidance)
  - [Comparing Options](#comparing-options)
- [Launch Blog Post](#launch-blog-post)
- [What It Adds Over Other Extensions](#what-it-adds-over-other-extensions)
- [Configuration Recipes](#configuration-recipes)
  - [Recipe 1: Zero Configuration](#recipe-1-zero-configuration)
  - [Recipe 2: Web Search Tool + Nano](#recipe-2-web-search-tool--nano)
  - [Recipe 3: Sonar Pro Search](#recipe-3-sonar-pro-search)
  - [Recipe 4: Pin Eight Pages](#recipe-4-pin-eight-pages)
  - [Recipe 5: Economy Extract and Collate](#recipe-5-economy-extract-and-collate)
  - [Recipe 6: Stronger Collation](#recipe-6-stronger-collation)
  - [Recipe 7: Free-Tier Resilience](#recipe-7-free-tier-resilience)
  - [Recipe 8: Per-Project Override](#recipe-8-per-project-override)
- [Model Configuration](#model-configuration)
  - [OpenRouter Routing for Sonar](#openrouter-routing-for-sonar)
  - [Source Harvesting from Citations](#source-harvesting-from-citations)
  - [OpenRouter Web Search Server Tool](#openrouter-web-search-server-tool)
    - [searchWebSearch Keys](#searchwebsearch-keys)
  - [Choosing an Alternative Search Configuration](#choosing-an-alternative-search-configuration)
  - [Swapping the Extract and Collate Model](#swapping-the-extract-and-collate-model)
  - [Model Selection Guidance](#model-selection-guidance)
  - [Required API Keys](#required-api-keys)
- [Pipeline](#pipeline)
- [Cost](#cost)
- [Settings](#settings)
  - [Settings Reference](#settings-reference)
  - [Automatic llms-full.txt Discovery](#automatic-llms-fulltxt-discovery)
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
  - [`Pi` Extension Compatibility](#pi-extension-compatibility)
  - [MCP Server Compatibility](#mcp-server-compatibility)
- [Development](#development)
- [Documentation](#documentation)
- [Downloads](#downloads)
- [Provenance](#provenance)
- [Sponsor](#sponsor)
- [Licence](#licence)
- [Use of Large Language Models](#use-of-large-language-models)

<!-- TOC:END -->

<a id="use-with-other-hosts"></a>
## Install

<!-- packages:none -->
Choose a package by host: the [`Pi` native extension](#pi-native-extension) for `Pi`, or the [MCP server](#mcp-server) for MCP-compatible hosts.
<!-- /packages -->

<!-- packages:pi -->
### `Pi` Native Extension

#### Prerequisites

Install `Pi` and obtain an [OpenRouter](https://openrouter.ai) account. One key covers search, extraction and collation with the default models. Other providers are supported for extraction and collation; see [Model Configuration](#model-configuration).

1. **Sign In With Open Authorization (OAuth) (Recommended):** run `/login openrouter` in `Pi`. On `Pi` 0.82.0 and later this performs OpenRouter OAuth Proof Key for Code Exchange (PKCE) sign-in and stores a user-controlled key automatically. No manual key paste is required.
2. **Or add a key manually:** create one at [openrouter.ai/keys](https://openrouter.ai/keys), then edit `~/.pi/agent/auth.json`:

```json
{
  "openrouter": {
    "type": "api_key",
    "key": "sk-or-v1-..."
  }
}
```

#### Install the Extension

From `npm` (recommended):

```bash
pi install npm:@curio-data/pi-intelli-search
```

From _GitHub_:

```bash
pi install git:github.com/Curio-Data/pi-intelli-search
```

Local development:

```bash
pi install /path/to/pi-intelli-search
```

On first load, `Pi` shows `Added models:` followed by any missing models: on a fresh install these are `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search`. An upgrade lists only models not already registered. A missing OpenRouter key produces a warning notification.

#### Verify Installation

Start `Pi` and type `/model`. Confirm that `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search` appear in the model list. If they are missing after a manual edit, reopen `/model`: since `Pi` 0.82.0 the picker reloads `models.json` on open. Restart `Pi` only if they are still absent. Registration does not select a pipeline model; `searchModel` in settings does that.

#### Customise (Optional)

No configuration is needed to get started. The defaults use OpenRouter for all stages. To limit research to six pages, add this block to `~/.pi/agent/settings.json` or, for a trusted project, `<project>/.pi/settings.json`:

```json
{
  "pi-intelli-search": {
    "defaultUrls": 6,
    "maxUrls": 6
  }
}
```

See [Model Configuration](#model-configuration) for model selection, [Configuration Recipes](#configuration-recipes) for complete examples, and [Settings](#settings) for defaults and the full reference.
<!-- /packages -->

<!-- packages:mcp -->
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

Restart Claude Code, then run `claude mcp list` and confirm `plugin:intelli-search:intelli_search` shows as connected. The launcher downloads a pinned package through `npx` on first start. Run `/intelli-search:intelli-search` for the host-expanded setup skill. Do not use `claude plugin install --config openrouter_api_key=...`: that exposes the key in process arguments. The installed `intelli-search` skill includes shell-based credential setup and troubleshooting; the [compatibility matrix](docs/COMPATIBILITY.md#host-plugins) records tested host versions.

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

In the session, ask: “Use intelli_search to find the current TypeScript release and cite the official source.” Confirm a successful MCP tool call and an answer with sources. `codex mcp list` alone does not start the server or prove inference. If the tools are unavailable, report the setup failure rather than claim that built-in search used this server.

Codex filters the server environment; the plugin forwards `OPENROUTER_API_KEY`, `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` explicitly. Set all three before each launch. The installed `intelli-search` skill covers persistent configuration and unattended tool approval; see the [compatibility matrix](docs/COMPATIBILITY.md#host-plugins) for verified host behaviour.

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
<!-- /packages -->

## Tools

Both packages expose these four operations. The names below are native `Pi` tool names and MCP server tool names; MCP hosts add their own callable-name prefixes. Use the names exposed by the host.

| Tool               | Description                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `intelli_search`   | Search the web and return a concise answer with a source list (top `defaultUrls`).                   |
| `intelli_extract`  | Extract query-relevant content from a web page, preserving code and technical detail verbatim.      |
| `intelli_collate`  | Deduplicate and synthesise multiple extractions into a summary. Writes cache.                       |
| `intelli_research` | Search, fetch, extract, collate, cache. The primary research tool. One call.                        |

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

`domains` guides source selection, it is not a security boundary: the query gains a `site:` expression, and with the web search tool enabled the same domains are also combined with `searchWebSearch.allowedDomains` and sent as an engine filter. The lists are combined, not intersected, and returned uniform resource locators (URLs) are not checked against a local hostname allowlist before fetching. Engine support for allow and exclude lists differs; see [native searchWebSearch keys](#searchwebsearch-keys) or [MCP tuning](#tuning).

### Comparing Options

```text
intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

<!-- packages:pi -->
## Launch Blog Post

<p align="center">
  <a href="https://blog.curiodata.pro/posts/22-pi-intelli-search/">
    <img src="docs/images/blog-banner.png" alt="Vintage engraving-style banner for pi-intelli-search. A large magnifying glass dominates the centre, revealing a mechanical Pi symbol constructed from metal plates, rivets, and gears. The title &quot;pi-intelli-search&quot; appears in copper serif lettering at the top. Surrounding the magnifying glass are pen-and-ink scholarly motifs in laurel-wreath medallions: open books, quill pens and ink bottles, hourglasses, armillary spheres, distillation apparatus, and filing boxes. A GitHub logo and the repository URL sit on a ribbon at the bottom." width="800" />
  </a>
</p>

Read the launch post, [_pi-intelli-search: LLM-Native Web Research for the Pi Coding Agent_](https://blog.curiodata.pro/posts/22-pi-intelli-search/), for the design story behind the pipeline: why the pipeline extracts query-relevant content before collation, how collation keeps the agent context clean, and the launch-era estimate of ≈$0.05 per session. The [Cost](#cost) section holds the current default estimate.

## What It Adds Over Other Extensions

<p align="center">
  <img src="docs/images/06.png" alt="Pipeline comparison infographic titled &quot;PI-INTELLI-SEARCH&quot; contrasting two approaches in a vintage engraving style. The top row shows the Intelli-Search purpose-built research pipeline: seven sequential stages: Search (Perplexity Sonar, single unified key), Dual Fetch (defuddle &amp; markdown), Quality Compare (pick the best), LLM Extract Per Page (MiniMax M2.7, focused &amp; targeted), LLM Collate (MiniMax M2.7, dedupe/highlight/source, flags conflicts), Persistent Cache (expand on demand), and Cache Suggest (LLM-judged relevance, additive, feeds back). The bottom row shows generic fetch/search extensions: Search (additional keys), Single Fetch (simple, provider-dependent), Raw Page Content (unstructured, ≈50K chars/page), No Cache (in-memory at best). Footer summary: &quot;Intelli-Search: deduped, cited, focused, ≈$0.05/session, reusable&quot; vs. &quot;Other extensions: raw pages, must synthesise, no reuse.&quot;" width="800" />
</p>

*The comparison illustration shows the default configuration and cost at its creation; search is configurable (see [Model Configuration](#model-configuration)).*

Four capabilities distinguish `intelli-search` within the seven-extension [May 2026 comparison](docs/COMPARISON.md#scope):

1. **Dual-fetch quality comparison.** Every page is fetched twice in parallel (Defuddle versus Markdown endpoint), scored, and the better version wins. Server-rendered Markdown is not guaranteed to be cleaner than HTML; the comparison catches this automatically.
2. **Per-page LLM extraction guided by `focusPrompt`.** Each page is compressed to ≈3-5K chars of query-relevant content before entering the agent's context. Extraction quality scales with the chosen model.
3. **LLM collation with deduplication.** A collation model synthesises across sources, flags conflicting claims, and preserves source attribution. The agent does not spend reasoning tokens on mechanical synthesis.
4. **Persistent cache with cache suggest.** Full pages and extractions are kept in `.search/` and indexed. An LLM judge surfaces related previous searches after each live query. Manually reusing a cached report can avoid a subsequent research call; cache suggest does not skip the current search.

The collation prompt targets a concise ≈5K-character summary; actual length depends on the selected model and output budget. The full page content stays in the cache, accessible via native `Pi` tools like `read` or `grep` for deeper inspection. Among the seven extensions in the May 2026 comparison, only `intelli-search` combines per-page extraction and a persistent structured cache.

For the detailed feature-by-feature comparison against six other `Pi` search extensions, see [docs/COMPARISON.md](docs/COMPARISON.md).


## Configuration Recipes

These recipes configure the native `Pi` extension. For MCP configuration, select models under `models` and tuning under `tuning` in the [standalone configuration file](#configuration); do not copy the native settings wrapper.

Each recipe is a complete `~/.pi/agent/settings.json`. Copy it whole, or merge the `pi-intelli-search` block into an existing file. Project-level overrides go in `<project>/.pi/settings.json` (applies only after `Pi` approves the project; the global file always applies).

Two loader rules to keep in mind:

- A configured object replaces its default wholesale. The `searchWebSearch` block and the model blocks have no per-key merge: supply every required key.
- Nested `pi-intelli-search` keys always win over the deprecated flat `intelli*` keys.

| Purpose | Recipe |
|---|---|
| Works immediately, nothing to write | [Zero Configuration](#recipe-1-zero-configuration) |
| A chat model plus the web search server tool | [Web Search Tool + Nano](#recipe-2-web-search-tool--nano) |
| Sonar Pro Search via a model swap | [Sonar Pro Search](#recipe-3-sonar-pro-search) |
| The pre-0.13 page count | [Pin Eight Pages](#recipe-4-pin-eight-pages) |
| Cheaper extraction and collation | [Economy Extract and Collate](#recipe-5-economy-extract-and-collate) |
| Better final summaries | [Stronger Collation](#recipe-6-stronger-collation) |
| A free-tier or shared OpenRouter key | [Free-Tier Resilience](#recipe-7-free-tier-resilience) |
| A different search model for one repo only | [Per-Project Override](#recipe-8-per-project-override) |

Every recipe is exercised end-to-end in its own isolated environment by [`test/e2e/10_config_recipes.sh`](test/e2e/10_config_recipes.sh); recipes 2 and 3 by `08_websearch_tool.sh` and `09_sonar_pro_search.sh`.

### Recipe 1: Zero Configuration

Write nothing. The defaults provide Sonar search with citation harvesting, MiniMax M3 extraction and collation, up to 10 pages per research run, and the `.search/` cache. Every other recipe below changes exactly one concern from this baseline.

### Recipe 2: Web Search Tool + Nano

An OpenRouter chat model with server-tool support can use live search through `openrouter:web_search`; search does not require a search-native model family. The September 2026 probe estimate for this pairing is ≈$0.008 per search, not a lowest-cost ranking. In that configuration, `reasoning: "minimal"` leaves more of the completion budget available for answer text; unconstrained reasoning can consume it.

```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-nano"
    },
    "searchWebSearch": {
      "enabled": true,
      "engine": "exa",
      "maxResults": 8,
      "reasoning": "minimal"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  }
}
```

### Recipe 3: Sonar Pro Search

Agentic multi-step search on the Perplexity stack, reached through a settings-only model swap. The recorded estimate is ≈$0.05 per search ($18 per 1,000 requests plus tokens); it is not a comparative quality measurement. `searchWebSearch` is disabled explicitly so this recipe also applies after previously enabling the tool.

```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "searchWebSearch": {
      "enabled": false
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  }
}
```

### Recipe 4: Pin Eight Pages

v0.13.0 raised `defaultUrls` to 10 and `maxUrls` to 20 because citation harvesting fills the URL list. To retain the earlier page-count settings, pin both values. This recipe previously recorded ≈$0.004 per extracted page without specifying an input/output budget. That unscoped figure is historical, not the default M3 estimate in [Cost](#cost).

```jsonc
{
  "pi-intelli-search": {
    "defaultUrls": 8,
    "maxUrls": 16
  }
}
```

### Recipe 5: Economy Extract and Collate

A full 10-page research run makes 10 extraction calls and one collation call, so token rates dominate cost. Swap both stages to a cheaper OpenRouter model; search is untouched. Select a registered, authenticated model with sufficient text-processing capability and context for these stages.

```jsonc
{
  "pi-intelli-search": {
    "extractModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    }
  }
}
```

Convert `extractMaxChars` to an estimated input-token budget (150K chars is ≈37K tokens), then add prompt tokens and reserve `extractionMaxTokens` for output. Lower the character limit if that total exceeds the model's token window.

### Recipe 6: Stronger Collation

Keep extraction cheap and spend on the final synthesis, where cross-source reasoning and contradiction-flagging live. Only `collateModel` changes.

```jsonc
{
  "pi-intelli-search": {
    "collateModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-mini"
    }
  }
}
```

### Recipe 7: Free-Tier Resilience

For an observed account limit of approximately 0.33 requests per second, the default fan-out of up to 4 concurrent extractions can exceed the limit. Space the calls, lengthen the retries, and shrink the page count. This recipe is a response to observed limits, not a provider-wide quota claim about free-tier keys.

```jsonc
{
  "pi-intelli-search": {
    "defaultUrls": 5,
    "minRequestIntervalMs": 3000,
    "extractionConcurrency": 2,
    "llmRetryAttempts": 4,
    "llmTimeoutMs": 120000
  }
}
```

Choose pacing, concurrency and retry settings from observed account and provider rate limits, whether the key is paid, free-tier or shared. Leave the throttle off when the account handles the default fan-out without rate-limit failures.

### Recipe 8: Per-Project Override

A trusted project can override individual keys for one repository only. Put the override in `<project>/.pi/settings.json`; everything not listed keeps its global value.

```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "cacheDir": ".search-client-x"
  }
}
```

Use this to give a client project a dedicated cache directory and a stronger search model while every other project stays on the global defaults.

## Model Configuration

Both packages select models independently for search, extract and collate. The configuration below is for the native `Pi` extension; the MCP server requires explicit OpenRouter selections for all three roles in its [configuration file](#configuration), with no implicit model defaults.

Native defaults are chosen for cost-efficiency. Registered, authenticated models from built-in providers, [OpenRouter](https://openrouter.ai) or other extensions can replace them, subject to role suitability and context limits. Search needs grounding or supported web-search tools; registry access alone does not establish that capability.

| Stage   | Default                       | Config Key              |
| ------- | ----------------------------- | ----------------------- |
| Search  | `openrouter/perplexity/sonar` | `searchModel`           |
| Extract | `openrouter/minimax/minimax-m3` | `extractModel`      |
| Collate | `openrouter/minimax/minimax-m3` | `collateModel`      |

<a id="why-openrouter-for-sonar"></a>
### OpenRouter Routing for Sonar

[_Perplexity Sonar_](https://docs.perplexity.ai) is a search-grounded model, but it is not in `Pi`'s built-in model list. Rather than requiring a separate Perplexity API account (which requires a $50 minimum credit top-up), the extension routes _Sonar_ through [OpenRouter](https://openrouter.ai). _OpenRouter_ is a unified pay-as-you-go API with a lower minimum spend. One API key provides access to Sonar and other catalogue models, subject to account permissions. On first load, the extension patches `~/.pi/agent/models.json` to add _Sonar_ under the `openrouter` provider so `Pi` can discover it. This approach has several benefits:

- **Avoids the Perplexity API $50 minimum.** Routing through `OpenRouter` consolidates spend on a single account already used across the open-source coding-agent ecosystem, including `Pi`. No separate _Perplexity_ subscription is required.
- **One account, many models.** The same OpenRouter key covers Sonar and other accessible models selected for extraction or collation.
- **Non-Destructive Registration:** The patch merges new models by ID. It never replaces existing OpenRouter models.
- **Idempotence:** It is safe across extension reloads and updates.

The same single-key argument covers the alternative search configurations: the [web search server tool](#openrouter-web-search-server-tool) and [`perplexity/sonar-pro-search`](#choosing-an-alternative-search-configuration) both route through the same OpenRouter account.

### Source Harvesting from Citations

Search-grounded models can return machine-readable `url_citation` annotations identifying cited sources. The recovered set can exceed the prose links (recorded Sonar probe: 20 annotations against 3 prose links), but it does not establish every source consulted. `Pi`'s chat-completions adapter reassembles only text, thinking, and tool-call blocks, so those annotations never reach extension code on their own. The pipeline reads a tee of the raw response body, parses the citations out, and merges them with the text-scraped links before pages are selected for fetching.

Collection is attempted on every search call regardless of model and needs no configuration. Native calls await background citation reads for up to two seconds; collection failure leaves the text-link path intact without failing the search. Text links come first; annotation-only links follow; exact URL duplicates are removed. `intelli_research` applies its URL limit after merging, so not every discovered source is fetched. Harvesting is best-effort: a model that emits no annotations, or annotations the parser does not recognise, leaves the text-link path intact. `intelli_search` caps its rendered source list at `defaultUrls` (top 10 by default). The count is recorded in `meta.json` as `stages.search.annotationsHarvested`.

### OpenRouter Web Search Server Tool

The search stage normally relies on a search-native model (default: _Sonar_). The `searchWebSearch` setting decouples it: [OpenRouter](https://openrouter.ai)'s `openrouter:web_search` server tool gives the configured chat model access to live web search, so the pipeline is not tied to any search-native model family. The tool is beta upstream; the model decides whether and how many times to search, and search charges depend on the engine, the number of server-side searches, and token usage. `maxResults` limits results per search and `maxUrls` limits pages fetched; neither caps total search spend.

`searchWebSearch` requires `searchModel.provider` to be `openrouter`. The tool ID is OpenRouter-specific; on any other provider the setting is ignored without warning.

A probe-validated pairing (2026-09): `openai/gpt-5-nano` with engine `exa` and `reasoning: "minimal"`, at ≈$0.008 per search with 5-17 cited sources:

```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-nano"
    },
    "searchWebSearch": {
      "enabled": true,
      "engine": "exa",
      "maxResults": 8,
      "reasoning": "minimal"
    }
  }
}
```

#### searchWebSearch Keys

A supplied object replaces the entire default object; there is no per-key merge. A trusted project's object also replaces the global one. Omitting `reasoning` gives `low`, not `minimal`; omitting `maxResults` sends no result-count override and OpenRouter applies its own default (5).

| Key | Values | Notes |
|---|---|---|
| `enabled` | `true`, `false` | Off by default. Requires `searchModel.provider` to be `openrouter`. |
| `engine` | `auto`, `native`, `exa`, `parallel`, `perplexity`, `firecrawl` | `auto` (and unrecognised values) are omitted from the payload, leaving OpenRouter's default. |
| `maxResults` | 1-25 (1-20 on `perplexity`) | Rounded and clamped by the extension. Per engine search, not per research run. |
| `searchContextSize` | `low` (≈5K chars), `medium` (≈15K), `high` (≈30K) | Engine-specific budgets; some engines ignore it. |
| `allowedDomains` | array of domains | Combined (not intersected) with the per-call `domains` tool parameter. Cannot be combined with `excludedDomains` except on `exa`. |
| `excludedDomains` | array of domains | As above. |
| `reasoning` | `minimal`, `low`, `medium`, `high` | Falls back to `low` when omitted. Use `minimal` explicitly with GPT-5 family models to limit reasoning expenditure under the recorded tool configuration. |

The extension exposes a subset of the server tool's parameters. Upstream `mode`, `max_uses`, `max_total_results`, `max_characters`, and `user_location` are not settable through this block. The `firecrawl` engine additionally requires a separate [_Firecrawl_](https://www.firecrawl.dev/) account configured with OpenRouter (bring your own key, or BYOK); the other engines bill through OpenRouter credits.

### Choosing an Alternative Search Configuration

The default search model is `perplexity/sonar` (≈$0.007 per search). Two configurable alternatives use the same OpenRouter account:

| Option | Model | Setting | Cost per Search |
|---|---|---|---|
| Server tool | `openai/gpt-5-nano` + `engine: "exa"` | `searchWebSearch.enabled: true` | ≈$0.008 |
| Model swap | `perplexity/sonar-pro-search` | `searchModel` only | ≈$0.05 |
| Current default | `perplexity/sonar` | none | ≈$0.007 |

The model swap is settings-only:

```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "searchWebSearch": {
      "enabled": false
    }
  }
}
```

`perplexity/sonar-pro-search` bills $18 per 1,000 requests on top of $3/$15 per 1M tokens ([model card](https://openrouter.ai/perplexity/sonar-pro-search)). It buys agentic multi-step search; it is not the cheap option. Explicitly disabling `searchWebSearch` in the example makes it safe to apply after previously enabling the server tool: changing `searchModel` alone does not clear that separate setting.

### Swapping the Extract and Collate Model

[_MiniMax_](https://minimax.io) M3 (via OpenRouter) is the native default. In [baseline runs 1A, 2A, 1B, 2B and 3C](docs/BENCHMARKS.md#baseline-findings), its collations stated their ranking methodology, caveated low-evidence claims and flagged compatibility warnings. M3's recorded ≈1M-token window provides input headroom at the default character limit. M3 and M2.7 had equal per-token pricing in that benchmark, while M3 wrote ≈2× the extraction characters. The recorded default-switch estimate projected doubled extract-stage output-token cost, not whole-session cost; the character measurements alone do not establish a token ratio (see [Decision Recorded](docs/BENCHMARKS.md#decision-recorded)). Selecting `minimax/minimax-m2.7` requests leaner extractions, but values matching an upgrading version's historical default remain eligible for model migration. Other registered, authenticated text models can also be selected, subject to capability and context limits. Override in `~/.pi/agent/settings.json` or `.pi/settings.json`:

**Option A: Use a `Pi` Built-In Provider** (auth via `/login`):

```jsonc
{
  "pi-intelli-search": {
    "extractModel": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "collateModel": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    }
  }
}
```

**Option B: Use Another OpenRouter Model** (same key, no extra setup):

```jsonc
{
  "pi-intelli-search": {
    "extractModel": {
      "provider": "openrouter",
      "model": "google/gemini-2.0-flash-001"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-2.0-flash-001"
    }
  }
}
```

**Option C: Use a Model Provided by Another Extension** (for example, Z.Ai or local models):

```jsonc
{
  "pi-intelli-search": {
    "extractModel": {
      "provider": "zai",
      "model": "glm-5.1"
    },
    "collateModel": {
      "provider": "zai",
      "model": "glm-5.1"
    }
  }
}
```

The model must be registered in `Pi`'s model registry, have authentication configured and support the required text operation within its context and output limits. Run `/login` to set up built-in providers, or follow the extension's own setup for extension-provided models.

### Model Selection Guidance

For extraction and collation, the ideal model has:

- **Low Cost per Token:** Up to 10 extractions, 1 collation and 1 cache suggestion per default research run, before retries.
- **Good Instruction Following:** Must adhere to extraction prompts precisely.
- **Sufficient Context:** Cleaned pages can be ≈50K chars (truncated to `extractMaxChars`).

Models known to work well for extraction and collation: _MiniMax_ M3 (default, ≈1M context, via OpenRouter), MiniMax M2.7 (leaner extractions in the recorded benchmark, via OpenRouter), _Qwen_ 3.5-Flash (≈1M context, ≈$0.26/M output), _DeepSeek_ V4 Flash (≈1M context, ≈$0.28/M output), _Gemini_ 2.0 Flash Lite (≈1M context, ≈$0.30/M output), _GPT-4.1_ Nano (≈1M context, ≈$0.40/M output).

### Required API Keys

With default settings, one key is required in `~/.pi/agent/auth.json`:

```json
{
  "openrouter": {
    "type": "api_key",
    "key": "sk-or-v1-..."
  }
}
```

A single [OpenRouter](https://openrouter.ai) key is the minimum required. It covers the default search model (Sonar) plus MiniMax M3 for extraction and collation with the default models. The extract and collate stages can use other registered, authenticated text models with suitable capabilities and context limits. Override `extractModel` or `collateModel` in settings to switch providers.

Run `/login openrouter` in `Pi` to authorise via OAuth (`Pi` 0.82.0 and later), or edit the file directly with a key from [openrouter.ai/keys](https://openrouter.ai/keys).
<!-- /packages -->

## Pipeline

<p align="center">
  <img src="docs/images/07B.png" alt="Vintage engraving-style infographic titled &quot;INTELLI_RESEARCH: The Five-Stage Pipeline,&quot; showing five sequentially linked numbered stages triggered by intelli_research(query): (1) Search: web discovery via Perplexity Sonar, OpenRouter/pi-native auth; (2) Fetch: dual fetch and quality comparison using wreq-js + Defuddle against raw markdown; (3) Extract: per-page parallel LLM extraction, MiniMax M2.7, the native model configuration at the illustration's creation; (4) Collate: deduplication and persistent cache via MiniMax M2.7 (the native configuration at creation), flags conflicts; (5) Cache Suggest: additive stage, LLM judge surfaces related prior searches. Stages are connected by bold arrows; each is illustrated with a period-appropriate vignette (armillary sphere, scrolls, alchemical still, filing cabinet, owl with documents)." width="800" />
</p>

The illustration shows the native pipeline with the model configuration at its creation, including MiniMax M2.7 and `Pi` authentication; it does not show the current defaults or standalone authentication. All model assignments are configurable through [native model settings](#model-configuration) or [MCP configuration](#configuration); alternative search configurations use the same five-stage pipeline.

The search stage merges text links with harvested citation annotations before selecting pages (see [Source Harvesting from Citations](#source-harvesting-from-citations)). Each page is dual-fetched (HTML via Defuddle versus Markdown endpoint) and scored for quality. Per-page extraction (guided by `focusPrompt`) compresses ≈50K chars to ≈3-5K of query-relevant content before collation, keeping the total context manageable (≈30-50K for 10 pages).

On completed and documented degraded research paths, the pipeline attempts to write a local-only `meta.json` telemetry sidecar into the cache directory (see [Cache Structure](#cache-structure)). Set `"disableTelemetry": true` in the native `pi-intelli-search` namespace or the MCP `tuning` object to suppress it.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

The estimate below uses the native default models and tuning, also selected in the minimal MCP configuration example. It is a planning estimate based on the recorded September 2026 price basis, not a live tariff check. Both packages incur inference charges on the configured provider account; MCP does not use host subscriptions or credentials.

Per research run with the default 10 pages: ≈$0.09

| Step                           | Calls            | Cost     |
| ------------------------------ | ---------------- | -------- |
| Search (Sonar)               | 1                | ≈$0.007  |
| Fetch (Defuddle + Markdown)    | 10 (≤4 concurrent) pairs | $0.00    |
| Extract (M3 via OpenRouter)         | 10 (≤4 concurrent) | ≈$0.07   |
| Collate (M3 via OpenRouter)         | 1                | ≈$0.01   |
| Cache Suggest (M3 via OpenRouter)   | 1                | ≈$0.0002 |

Since v0.13.0 the search stage adds recovered provider citation URLs to prose links, increasing the candidate source set; `maxUrls` still caps page selection. The ≈$0.09 figure is the planning estimate for a full 10-page research run with the v0.14.0 default models (M3 and M2.7 had equal per-token prices in the recorded benchmark; M3 wrote ≈2× the extraction characters, with the cost estimate separately projecting greater token usage); lower `defaultUrls` to hold earlier spend. Changing the search model or engine also changes the search step's cost; configure it through [native model settings](#choosing-an-alternative-search-configuration) or [MCP configuration](#configuration). The extract and collate rows scale with the selected models.

<!-- packages:pi -->
## Settings

This section describes native `Pi` settings. The MCP server reads only its explicitly selected file; its accepted keys, ranges and policy differences are documented in [Configuration](#configuration) and [Tuning](#tuning).

No configuration is required. To override defaults, use `~/.pi/agent/settings.json` or, for a trusted project, `<project>/.pi/settings.json` under the `pi-intelli-search` namespace. `Pi` ignores project-local settings until the project is approved; the global file always applies.

Explicit tuning values are preserved on upgrade. Explicit model selections remain eligible for match-based migration when their provider and model match the upgrading version's historical default. Migration changes effective settings in memory, not the file (see `migrateDefaults()` in `src/settings.ts`).

The example below shows the default models and common tuning settings. The [Settings Reference](#settings-reference) lists every accepted namespace key:

```jsonc
{
  "pi-intelli-search": {
    // Model assignments (see Model Configuration above)
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "searchWebSearch": {
      "enabled": false,
      "engine": "auto",
      "maxResults": 8,
      "reasoning": "minimal"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },

    // Pipeline tuning
    "defaultUrls": 10,
    "maxUrls": 20,
    "cacheDir": ".search",
    "extractMaxChars": 150000,
    "extractionConcurrency": 4,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": 4000,

    // Fetch behaviour
    "fetchTimeoutMs": 20000,
    "fetchConcurrency": 4,
    "browserFingerprint": "chrome_145"
  }
}
```

### Settings Reference

| Setting | Stage | Default | What It Does |
|---|---|---|---|
| `searchModel` | 1. Search | `openrouter/perplexity/sonar` | Model for the initial web search. Swap to a stronger model for deeper search results, or to a cheaper one to reduce the ≈$0.007 search cost. See [Model Configuration](#model-configuration). |
| `searchWebSearch` | 1. Search | see [reference](#openrouter-web-search-server-tool) | Attach OpenRouter's `openrouter:web_search` server tool to the search-stage call so a plain OpenRouter chat model gains access to live search. Off by default; requires `searchModel.provider` to be `openrouter`. Full key reference in [OpenRouter Web Search Server Tool](#openrouter-web-search-server-tool). |
| `extractModel` | 3. Extract | `openrouter/minimax/minimax-m3` | Model for per-page content extraction. Runs up to 10 times per default research run so low cost per token matters. Estimate tokens from `extractMaxChars`, add system and user prompt tokens, and reserve `extractionMaxTokens` for output. Compare that total with the model's token window and lower the character limit if needed. See [Model Configuration](#model-configuration). |
| `collateModel` | 4. Collate | `openrouter/minimax/minimax-m3` | Model for cross-source synthesis and deduplication. Sees all extractions at once so it needs enough context and instruction-following to flag contradictions. A model with ≥128K context handles 8 full extractions comfortably. See [Model Configuration](#model-configuration). |
| `defaultUrls` | 1 → 2 | `10` | Fallback when the agent does not pass `maxUrls` per call; also caps `intelli_search`'s rendered source list. Lower values reduce cost and latency but give less thorough results. The agent's [skill guide](skills/intelli-search/SKILL.md) recommends 3 (targeted), 10 (broad), or 16 (exhaustive). Raised from 8 in v0.13.0: citation harvesting fills the URL list, so the pipeline can use more sources than prose links alone provided. |
| `maxUrls` | 1 → 2 | `20` | Hard cap on URLs fetched. Lower caps mean faster responses and lower cost; higher caps allow more thorough research. Each extra successfully extracted page adds ≈$0.007 under the M3 output-volume estimate in [Cost](#cost). Requests above the cap are silently clamped. Raised from 16 in v0.13.0. |
| `cacheDir` | 4, 5 | `.search` | Directory where research runs are cached. Change this to keep project-specific research separate. Example: `".my-research-cache"`. |
| `extractMaxChars` | 3. Extract | `150000` | Maximum characters of page content fed to the extract LLM per page. Each 50K chars consumes ≈12K input tokens as a planning approximation; the model's tokenizer determines the actual count. Add prompt tokens and reserved output (`extractionMaxTokens`) before comparing with the token window. Lower this limit if that budget does not fit; raise it only with sufficient headroom. |
| `extractionConcurrency` | 3. Extract | `4` | Number of per-page extractions sent to the extract model simultaneously. Bounded so a wide result set does not fire many concurrent LLM calls and trigger rate limiting. Raise it (6-8) on generous rate limits for faster extraction; lower it (1-2) on tight limits. |
| `extractionMaxTokens` | 3. Extract | `3000` | Maximum output tokens for each per-page extraction. Higher values preserve more detail at higher cost. Lower this when using a model with a small context window so the output does not crowd out the input. The extract prompt targets 3,000-5,000 characters; 3,000 tokens covers this comfortably. |
| `collationMaxTokens` | 4. Collate | `4000` | Maximum output tokens for the final synthesis. Lower values force tighter deduplication. Lower this when using a collation model with a small context window (the output must fit alongside all extraction inputs). This bounds synthesis output, not the source and cache appendices added afterwards. |
| `fetchTimeoutMs` | 2. Fetch | `20000` | Per-page fetch timeout in milliseconds. Increase for sites known to be slow. Fetches run in parallel so this does not multiply by page count. |
| `fetchConcurrency` | 2. Fetch | `4` | Number of pages fetched simultaneously. Higher values (6-8) complete the fetch stage faster but may trigger rate limiting. Lower values (2) are gentler on target servers. |
| `browserFingerprint` | 2. Fetch | `chrome_145` | Transport Layer Security (TLS) fingerprint used by [_wreq-js_](https://github.com/sqdshguy/wreq-js) to impersonate a browser. Determines which Hypertext Transfer Protocol (HTTP) client signature the site sees. Available profiles include `chrome_*`, `firefox_*`, `safari_*`, `edge_*`, and `opera_*` across many versions. Change this if a site blocks the default fingerprint. |
| `llmTimeoutMs` | Research LLM | `90000` | Hard per-call timeout in milliseconds for each model request inside `intelli_research`. Bounds a stalled provider connection (common under rate limiting) so it becomes a retryable timeout instead of hanging on the software development kit (SDK)'s long default. Raise it for slow reasoning models on large inputs; lower it to fail faster. |
| `llmRetryAttempts` | Research LLM | `3` | Total attempts per LLM call including the first. Transient failures (HTTP 429, 5xx, timeouts) are retried with full-jitter exponential backoff that honours any Retry-After hint. Set to `1` to disable retry. |
| `retryBaseDelayMs` | Research LLM | `1500` | Base delay for retry backoff. Attempt N waits a random duration up to `min(retryMaxDelayMs, retryBaseDelayMs * 2^(N-1))`. |
| `retryMaxDelayMs` | Research LLM | `20000` | Upper bound on any single retry backoff, and the clamp applied to a Retry-After hint so a large hint cannot stall the pipeline. |
| `searchRetryAttempts` | 1. Search | `2` | Total attempts for the search stage when it returns a valid response with zero usable links (a degraded result), including the first. Independent of `llmRetryAttempts`, which covers transport errors. |
| `minRequestIntervalMs` | 3. Extract | `0` | Minimum gap in milliseconds between concurrent extract LLM calls. `0` disables the throttle. For an observed account limit of approximately 0.33 requests per second, use approximately `3000`. Adjust to observed limits rather than payment status. |
| `disableLlmsFullDiscovery` | Supplementary Fetch | `false` | Set `true` to skip automatic `llms-full.txt` probes and downloads. This does not disable page fetching or extraction. See [Automatic llms-full.txt Discovery](#automatic-llms-fulltxt-discovery). |
| `disableTelemetry` | All | `false` | When `false`, completed and documented degraded research paths attempt to write a local `meta.json` sidecar into the configured cache. It contains the full query and per-stage outcomes, which can include confidential information. The sidecar adds no network transmission or credential fields; ordinary research still sends requests to configured services. Set `true` to suppress it. |

`httpProxy` is a separate top-level `Pi` setting, not a `pi-intelli-search` namespace key; page fetching honours it too. Its default is unset.

The model retry and timeout settings apply inside `intelli_research`. The native standalone `intelli_search`, `intelli_extract` and `intelli_collate` tools retain one model attempt and no application-level timeout; they still accept cancellation. Provider connection limits are separate from the research pipeline's streaming-body timeout.

### Automatic llms-full.txt Discovery

Sites that follow the [`llms-full.txt` convention](https://llmstxt.org) publish a single Markdown file containing their complete documentation. During the fetch stage, every domain in the search results is probed at `https://domain/llms-full.txt`. If the file exists (HTTP 200), it is downloaded raw to `sources/llms-full-*.md` for offline search with `grep` or `read`.

These probes are supplementary: failures do not invalidate completed research. Each runs under a bounded timeout and honours cancellation. The pipeline awaits download completion and cleanup before returning, so this work can add latency; pressing Esc cancels it with the rest of the pipeline. Set `disableLlmsFullDiscovery: true` to skip the probes entirely.

A small built-in list handles sites with non-standard paths:

| Site | Path Pattern |
|------|-------------|
| Cloudflare Docs | `/product/llms-full.txt` |
| Next.js | `/docs/llms-full.txt` |
| Vite | `/llms-full.txt` (root) |

No configuration is needed. The probe and download are automatic.
<!-- /packages -->

<!-- packages:mcp -->
## MCP Server Reference

This reference applies to `@curio-data/mcp-intelli-search` only. Installation routes are under [MCP Server](#mcp-server).

### Requirements

- [_Node.js_](https://nodejs.org/) satisfying the `engines` range in the [standalone manifest](packages/mcp/package.json).
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

An invocation without `--check-config` validates the explicit workspace, then serves the four canonical tools (`intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`) over stdio until the input stream closes. An explicitly selected missing, unreadable or invalid configuration file does not prevent connection: each tool call returns an actionable `CONFIGURATION` error and rereads the file until it loads successfully. Repair the file and call again. Once loaded, configuration remains fixed until restart. Missing launcher arguments and invalid workspaces still fail at startup; `--check-config` remains strict. Serving performs no inference at startup; credentials are only required when an operation runs.

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

Unspecified tuning comes from the canonical [shared defaults](src/core/defaults.ts), also used by the native adapter. The table gives each default and its effect alongside standalone validation ranges. No provider or model selection is inherited from that module. Unknown keys, invalid types and out-of-range values are rejected rather than silently clamped.

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

**Output Budget:** Empty output after token-budget exhaustion is an error, not a successful extraction. Both adapters also reject empty collation before writing a completed report. Increase the output-token limit or lower reasoning effort when this diagnostic occurs.

### Direct Engine Verification

From the repository root:

```bash
npm run build:all
npm run test:all
npm run test:mcp:install
```

The installation gate packs the artefact, installs production dependencies into an isolated directory and denies all ancestor dependency resolution in both module systems. It runs the installed executable's `--help` and `--version`, all four operations with synthetic inference, and actual page fetching against a loopback fixture through the installed native fetch assets. A raw protocol exchange against the installed server verifies initialization, tool listing, invalid-argument rejection without inference and clean shutdown, and asserts that standard output carries only protocol frames. The deterministic installation gate uses no provider credentials and does not establish live MCP interoperability.

The recorded live scenario `test/e2e/11_mcp_stdio.sh` exercises a real research call through the MCP client of an isolated `Pi` profile. Its evidence is recorded separately in the [compatibility matrix](docs/COMPATIBILITY.md), not supplied by the installation gate.

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
| `Configuration file not found`, `not readable`, `empty` or `not valid JSON` | The selected file is missing or defective. The error names its absolute path; JSON syntax errors include a location without showing file contents. While serving, repair the file and call again. `--check-config` reports the error and exits 1. |
| Configuration rejected with an unknown-key or range error | The loader is strict: unknown keys, invalid types and out-of-range values fail validation. Correct the configuration and call again if it has not yet loaded. The [Tuning](#tuning) table lists accepted keys and ranges. |
| Tools never appear in the host | Check absent launcher arguments, an unusable workspace or an unsafe cache. Read the host's MCP server logs for the standard-error diagnostic. Claude Code can retain a failure from an older server: try `/mcp` reconnect, then restart; the recorded failure cache expired after approximately 15 minutes. A connected server still needs a successful tool call to verify inference. |
| `CONFIGURATION` names a missing or invalid file | Repair the selected file. If it has not yet loaded, call again; once loaded, configuration changes require a restart. |
| Diagnostic names a missing credential environment variable | Supply the named variable through the host's supported credential mechanism and restart. The server snapshots credentials at startup. |
| Catalogue preflight names a model role or capability | Correct the model identifier or required capabilities using [Configuration](#configuration). Read the diagnostic; catalogue lookup failures are not proof of invalid credentials. Restart after changing loaded model selections. |
| `PROVIDER` reports authentication, access, credit or transport failure | Follow the specific diagnostic: check credentials, model access, account credit or connectivity. Restart after changing credentials. The category alone does not identify a rejected key. |
| Repeated `429` retries | Tune pacing to observed account/provider limits. For an observed limit of approximately 0.33 requests per second, try `minRequestIntervalMs: 3000` and `extractionConcurrency: 2`; adjust retry attempts as needed. Raise `llmTimeoutMs` only when its model-call timer expires. |
| Cache paths unreadable from the host | The host must share the server's filesystem. Sandboxed or remote hosts cannot read local cache paths; run the server where the host can read the workspace. |
<!-- /packages -->

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

Each research run writes a cache entry named `<date>-<slug>-<hash>`. The `<hash>` is six hexadecimal characters from a Secure Hash Algorithm 1 (SHA-1) hash of the full query. It distinguishes queries sharing a readable stem and reduces collision risk; it does not guarantee unique names. Concurrent writers use short cache locks, and index updates are atomic. A completed same-day refresh attempts to archive the previous report, extractions, numbered sources and telemetry sidecar to a numbered sibling folder (`<slug>.1`, then `.2` and so on) before writing the new set. Archive failure is logged and the completed run can replace canonical files in place; interrupted rotation can leave a partial archive. Supplementary `llms-full-*` documentation downloads stay with the live folder. A degraded repeat preserves the earlier successful report, extractions, sources and index entry untouched and records only the failed attempt in `meta.json`. The numbered siblings are a same-day safety net, not a versioned archive: copy a report elsewhere if it must be retained long-term. Cache readers do not take those locks: a multi-file refresh is not a whole-directory atomic snapshot.

**Local Telemetry (`meta.json`):** Unless disabled, completed and documented degraded research paths attempt a best-effort sidecar write. Cancellation and thrown failures do not all produce a sidecar. It records the full research query and per-stage outcomes: pages fetched and failed, fetch-variant winners (Defuddle versus Markdown), search retries, cache-suggest hits and latency. `stages.search.annotationsHarvested` counts recovered `url_citation` entries and can be `0` when none are recovered. Historical records or an unreached stage can omit it. It is not a subset of `linksReturned`: harvested citations are merged with prose links before the `maxUrls` clamp, so a run can harvest twenty and report ten links. The sidecar adds no network transmission or credential/account-identifier fields, but the query and metadata can contain personal or confidential information. Ordinary research requests still go to configured external services. The bundled [`scripts/analyze-sessions.sh`](scripts/README.md) can aggregate these sidecars to report per-stage success rates.

<!-- packages:pi -->
To suppress the sidecar in the native extension, set `disableTelemetry: true` inside the `pi-intelli-search` namespace in [Settings](#settings).
<!-- /packages -->
<!-- packages:mcp -->
To suppress the sidecar in the MCP server, set `"disableTelemetry": true` inside the configuration's [`tuning` object](#tuning).
<!-- /packages -->

## Compatibility

<!-- packages:pi -->
### `Pi` Extension Compatibility

- **`Pi` >= 0.81.1:** Core functionality, trusted project settings, the configurable `CONFIG_DIR_NAME`, provider-based `pi-ai` calls, and sequential cache-writing tools. On `Pi` >= 0.86, LLM calls dispatch through the `ctx.modelRegistry.streamSimple()` facade so system prompts reach the model; `Pi` 0.81.1 through 0.85.x use the direct provider path. Compatibility audited and verified through `Pi` 1.0.0 (2026-10-02); the `fetch`/`onPayload` request hooks used by citation harvesting and the web search tool are verified against pi-ai 1.0.0.
- User interface (UI) notifications and status indicators are guarded with `ctx.hasUI`, so the tools behave cleanly in non-interactive modes (`pi -p`, `--mode json`, remote procedure call (RPC)).
- Page fetching honours the global `httpProxy` setting. The LLM stages already route through `Pi`'s managed HTTP clients, which apply `httpProxy` automatically.
- Retry and timeout are owned by the shared model policy, invoked by native `callLlm()`, independently of `Pi`'s `retry.provider.maxRetries`. Native calls force SDK `maxRetries: 0`. Configured backoff and application timeout apply inside `intelli_research`; the three standalone tools retain their one-attempt, no-application-timeout behaviour.
<!-- /packages -->

<!-- packages:mcp -->
### MCP Server Compatibility

- Direct stdio registration serves MCP-compatible hosts; repository plugin routes serve Claude Code and Codex. Recorded live research clients include `Pi` and both plugin hosts.
- The runtime must satisfy the Node.js `engines` range in the [standalone manifest](packages/mcp/package.json). The server uses the [`@modelcontextprotocol/server` SDK](https://github.com/modelcontextprotocol/typescript-sdk), with its dependency range declared in that manifest and the verified release pinned in [package-lock.json](package-lock.json).
- Standalone fetch assets are verified on _Linux_ x86-64 only; _macOS_ and _Windows_ are not verified.
- Full research through local-tarball plugins and registry-pin installation checks are separate evidence classes. The compatibility matrix records which checks have run for each artefact; publication alone does not establish host compatibility.

For the standalone MCP server and host plugins, including exact tested versions of _Claude Code_, _Codex_, Node.js and the MCP SDK, see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
<!-- /packages -->

<!-- packages:none -->
## Development

```bash
npm install
npm run build        # TypeScript -> dist/
npm test             # Native unit tests
npm run test:all     # Both packages; aggregate shown in the badge
npm run build:all    # Native build, standalone type check and bundles
npm run test:mcp:install # Independent standalone install/fetch gate
npm run test:smoke   # Smoke test

# Test in pi
pi -e ./dist/index.js

# Install as package
pi install /path/to/pi-intelli-search
```

**Host Plugins:** thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) live in `plugins/` at the repository root, with repository marketplace catalogues at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. The bundles are generated from the shared guidance source in `guidance/` and the version pinned in `packages/mcp/package.json`; run `npm run generate:plugins` after a version change and `npm run check:plugins` to detect drift. Launchers pin the exact package version through `npx`. For unreleased changes, build and pack the MCP workspace, generate with `--mode tarball --output DIR --codex-vendor-dir ABS`, install the tarball into the vendor directories, then install the generated marketplaces. The [script guide](scripts/README.md) documents generator arguments and links the tested full install flow in `test/e2e/12_plugin_bundles.sh`; `node scripts/generate-plugin-bundles.mjs --help` lists the arguments. Host setup, including each host's environment forwarding rules, is in the generated skills.

**Package READMEs:** this file is the only hand-edited README. `npm run generate:readmes` derives `packages/mcp/README.md` plus the root previews [`pi.README.md`](pi.README.md) and [`mcp.README.md`](mcp.README.md), and `npm run check:readmes` fails on drift or on any derived link that does not resolve. The native package ships the same derivation, written over this file by its `prepublishOnly` hook. Untagged content goes to both packages. Wrap package-specific sections in `<!-- packages:pi -->` or `<!-- packages:mcp -->` and `<!-- /packages -->`, and repository-only sections in `<!-- packages:none -->`. Content that only a package shows, such as its title and badges, goes in a hidden block opened by `<!-- packages:mcp hidden` and closed by a `-->` line. Each derived README regenerates its contents list, redirects links to sections it omits to this file on _GitHub_, and makes relative paths absolute. See [`scripts/generate-package-readmes.mjs`](scripts/generate-package-readmes.mjs).
<!-- /packages -->

## Documentation

- [Comparison](docs/COMPARISON.md): How `intelli-search` compares to other `Pi` search extensions and to host-native web search.
- [Changelog](CHANGELOG.md): Release history.
- [Architecture](docs/ARCHITECTURE.md): Detailed design decisions and pipeline internals.
- [Compatibility](docs/COMPATIBILITY.md): Tested host versions and artefacts for the native extension, MCP server and plugins.
- [Components](docs/COMPONENTS.md): Third-party dependencies and licence attribution.
<!-- packages:pi -->
- [Native skill guide](skills/intelli-search/SKILL.md): Agent-facing usage instructions for `Pi`.
<!-- /packages -->
<!-- packages:mcp -->
- [Claude Code skill](plugins/claude-code/skills/intelli-search/SKILL.md) and [Codex skill](plugins/codex/skills/intelli-search/SKILL.md): Host-specific setup and agent-facing usage instructions.
<!-- /packages -->
- [Contributor guide](AGENTS.md): Coding conventions and project structure.

## Downloads

Weekly npm downloads for both packages, stacked by package and refreshed every Monday by a scheduled GitHub Action. The native extension is the lower segment of each bar and the MCP server is the upper segment. The chart is rendered with [rough.js](https://roughjs.com) from append-only daily caches in `data/downloads.json` and `data/downloads-mcp.json` (see `scripts/plot-downloads.mts`).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/downloads-dark.svg">
    <img alt="Stacked weekly npm downloads for @curio-data/pi-intelli-search and @curio-data/mcp-intelli-search" src="docs/images/downloads-light.svg" width="800" />
  </picture>
</p>

<!-- packages:pi -->
## Provenance

Git history was rewritten in `v0.9.0` to normalise commit author and committer metadata on the path to a stable `v1` release. The `gitHead` Secure Hash Algorithm (SHA) identifiers recorded in `npm` Supply-chain Levels for Software Artifacts (SLSA) provenance attestations for versions 0.3.1 through 0.8.0 reference pre-rewrite commits that no longer resolve in this repository. Published tarballs and their tree-level contents are unchanged; only commit metadata was altered. From v0.9.0 onwards, attestations track the rewritten history. See the [Changelog](CHANGELOG.md) entry for v0.9.0 for the full account.
<!-- /packages -->

## Sponsor

<img src="docs/images/sponsor.png" alt="Banner image for &quot;Curio Data Pro.&quot; A cartoon robot detective in a deerstalker hat and brown cape peers through binoculars on the left, beside a bordered logo reading &quot;CURIO DATA PRO&quot; in dark red serif type. The background is a stylised steampunk harbour scene featuring a docked submarine, a steam locomotive pulling into a quayside station, gas street lamps, industrial cranes, and brick warehouses under a hazy sky." width="800" />

**[Curio Data Pro Ltd](https://blog.curiodata.pro/)** sponsors this project. _Curio Data Pro_ is a data consultancy serving _Rail_, _Naval Design_, _Aviation_, and _Offshore Energy_, combining 20+ years of _Chartered Engineer_ experience with _Data Science_ and _DevOps_ capabilities.

[Blog](https://blog.curiodata.pro/) | [LinkedIn](https://www.linkedin.com/company/curio-data-pro-ltd/)

<a id="license"></a>
## Licence

Copyright 2026 Ashraf Miah, Curio Data Pro Ltd.

Licensed under the [Apache License, Version 2.0](./LICENSE).

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
