<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. Edit the root README.md, then run npm run generate:readmes and npm run generate:plugins. -->

# Intelli Search for DeepSeek Harness

`@curio-data/dsh-intelli-search` adds cited web search and multi-page research to a [_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) profile. It is a configuration bundle, not an extension. One bridge row starts the standalone Model Context Protocol (MCP) server [`@curio-data/mcp-intelli-search`](https://www.npmjs.com/package/@curio-data/mcp-intelli-search), version `0.25.0`, through `npx` with `--host dsh`; one registrar registers the `intelli-search` skill with the harness. Search, page fetching, extraction and collation run in that server, which saves each research report with its sources in the project's `.search/` directory. Inference uses an [_OpenRouter_](https://openrouter.ai) account; [_Node.js_](https://nodejs.org/) runs the server.

The harness names the server `intelli`, so the four tools appear as:

| Tool | Use |
|---|---|
| `mcp__intelli__intelli_search` | Quick search: one concise answer with numbered sources, for facts, current versions and release dates. No page fetching or extraction |
| `mcp__intelli__intelli_research` | Research: search, fetch up to `maxUrls` pages, extract each page, collate a cited report and cache it. Accepts a batch of questions known at launch, with `batchMode: "independent"` for a separate answer per question or `"expansion"` for one merged report |
| `mcp__intelli__intelli_extract` | Extract query-relevant content from one page |
| `mcp__intelli__intelli_collate` | Deduplicate and synthesise extractions into a cached report |

Start with a quick search; use research for comparisons, detailed analysis or a gap a search answer leaves. Each research call costs more and takes longer than a search.

## Contents

<!-- TOC:START -->

- [Prerequisites](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#prerequisites)
- [Installation](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#installation)
- [Upgrade, Restart and Removal](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#upgrade-restart-and-removal)
- [Credentials](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#credentials)
- [Workspace](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#workspace)
- [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#configuration)
- [Verification](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#verification)
- [Timeouts](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#timeouts)
- [Troubleshooting](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#troubleshooting)
- [Charges, Cache and Privacy](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#charges-cache-and-privacy)
- [Evidence and Limits](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#evidence-and-limits)
- [Further Documentation](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#further-documentation)
- [Licence](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/README.md#licence)

<!-- TOC:END -->

<a id="requirements"></a>
## Prerequisites

- `dsh` within the bundle's declared range, `>=0.2.2-rc.1 <0.3.0`. The range is a compatibility declaration; the evidence section names the versions tested.
- Node.js 24.9 or later, the harness's own floor, with `node` and `npx` on `PATH`. The bridge row starts the server through `npx`.
- `pnpm` on `PATH`, or the plugin manager's `pnpmCommand` setting, to install and remove the bundle.
- Network access on the first start, when `npx` downloads the MCP server package. Later starts reuse the `npx` cache.
- An OpenRouter API key on an account with credit. Every search and research call bills that account, separately from any harness subscription.
- Linux for verified operation. The server's native fetch assets are verified on Linux x86-64 only, and every recorded check of this bundle ran on Linux; _macOS_ and _Windows_ are not verified.

## Installation

The bundle installs into one harness profile, and only that profile loads it. Install it into the profile the harness is started with, the name given to `--profile`. The examples set `profile=web`, one of the profiles the harness ships; change that value to the profile in use. A misspelt profile name leaves the tools absent from the profile in use.

```bash
profile=web
dsh plugin --profile "$profile" add @curio-data/dsh-intelli-search
```

In the Web interface, the harness documents an equivalent route: open **Plugins**, select **Add plugin** and enter `@curio-data/dsh-intelli-search`, the text that follows `add` in the command. This project's checks use the command line only.

After installation, start the profile from the project directory, or restart it if it is running:

```bash
profile=web
dsh --profile "$profile"
```

<a id="removal"></a>
## Upgrade, Restart and Removal

The plugin manager records the installed bundle version exactly, and each bundle version launches one exact MCP server version, so neither changes until the bundle is updated. To update, use the bundle's **Versions** and **Update** controls on the Web **Plugins** page, then restart the profile. That route follows the harness's own documentation and has not been exercised in this project's checks; no command-line update route has been verified. A row override that sets `cwd` (see the workspace instructions) keeps launching the server version written in it until the override is edited.

Restart the profile from the project directory after installing, updating or removing the bundle, after changing a key in an environment layer and after editing a configuration file the server has already loaded. The harness composes bundle rows and reads environment files at launch, and the server keeps a loaded configuration for its lifetime.

To remove the bundle and confirm that both of its rows are gone from the composed profile:

```bash
profile=web
dsh plugin --profile "$profile" remove @curio-data/dsh-intelli-search
dsh --profile "$profile" --dump-config
```

The dump no longer lists the rows `mcp-intelli-search` and `intelli-search-skill`. Restart the profile to stop a server that is still running. Removal deletes no data: the per-user configuration and stored key under `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/`, any `OPENROUTER_API_KEY` line in a `.env` file, each project's `.search/` cache and the `npx` cache remain until deleted separately. The per-user directory is shared with the Codex launcher. Delete any `mcp-intelli-search` override from the profile's `cordis.patch.yml` as well.

## Credentials

The server reads its OpenRouter key from the `OPENROUTER_API_KEY` environment variable or from a credential file. A nonempty environment value takes precedence over the file. Without either, the four tools still start and each call returns an actionable `CONFIGURATION` error. A key saved on the harness model-settings page does not reach this server: the harness resolves that credential through a service a child process cannot read.

**Environment Route.** The bridge row forwards `OPENROUTER_API_KEY` from the harness environment layer, which takes the first value it finds in the environment that launches the harness, then a `.env` file in the launch directory, then `$DSH_HOME/.env`. The harness reads these once at launch, so restart the profile after changing a key. An empty value counts as absent. To keep the key in the harness-home file, create the file with user-only permissions before entering the key:

```bash
(umask 077; touch "${DSH_HOME:-$HOME/.dsh}/.env") && chmod 600 "${DSH_HOME:-$HOME/.dsh}/.env"
```

After the command succeeds, open the file in an editor, so the key stays out of shell history, and put `OPENROUTER_API_KEY=` followed by the key on its own line, replacing any earlier definition.

**Credential-File Route.** The server's `setup` command reads the key from standard input and stores it in a user-only file. It refuses a terminal as its input, so run it through this pipeline from a _Bash_ shell:

```bash
read -r -s -p 'OpenRouter API key: ' key
printf '\n'
printf '%s\n' "$key" | \
  npx -y --package @curio-data/mcp-intelli-search@0.25.0 \
  mcp-intelli-search setup
unset key
```

The prompt hides the key as it is typed and stores it in `key`, an ordinary shell variable that is not exported, so no other process receives it and an existing `OPENROUTER_API_KEY` is left unchanged; `unset key` then discards it. Confirm that setup prints `Setup complete.` followed by the configuration and credential paths. If `OPENROUTER_API_KEY` is set in that shell, setup also warns that the environment value takes precedence over the stored key.

Setup creates `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/config.json` with the default models when it is absent, adds a missing `apiKeyFile` selection to an existing file and keeps existing model and tuning selections. It writes the key to `openrouter.key` beside that file. When the file already names a custom `apiKeyFile`, setup writes the key to that path and leaves the configuration file unchanged. Only an absolute `XDG_CONFIG_HOME` is honoured; an unset or relative value means `$HOME/.config`. Run setup with the same `XDG_CONFIG_HOME` as the harness, so both use one directory.

The server rereads the credential file on every call, so a new or replaced key takes effect on the next call without a restart. The file must be a regular file, owned by the current user, with no group or other access; setup creates it that way. To use the file while a key is also set in an environment layer, remove `OPENROUTER_API_KEY` from all three layers and restart the profile.

<a id="workspace-and-cache"></a>
## Workspace

The server uses the harness working directory as its workspace and writes the research cache, `.search/` by default, below it. Start the harness from the project directory: changing directory later in the session does not move the cache. A home or filesystem-root working directory is rejected, by each tool call with an actionable `WORKSPACE` error and by the configuration check, instead of creating one cache shared across projects. The four tools still appear.

For a fixed project root, override the row with id `mcp-intelli-search` in the profile's `cordis.patch.yml` under `$DSH_HOME/profiles/`, and set `cwd` to the absolute project path. Every session of that profile then caches in that directory, wherever the harness starts. The override replaces the row's entire `config`: copy its other `config` fields from the `--dump-config` output, keep the `OPENROUTER_API_KEY` expression exactly as shown there, and update the pinned server version after each bundle update. The home and filesystem-root rejection still applies to the `cwd` value.

## Configuration

With no per-user configuration file, the server uses built-in defaults: OpenRouter for every role, `perplexity/sonar` for search, `minimax/minimax-m3` for extraction and collation, and the shared tuning defaults, including ten pages per research call (`defaultUrls`) and a cap of 20 (`maxUrls`). The defaults need no file.

The per-user file is `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/config.json`, shared with the Codex launcher. It is strict: only `providers`, `models` and an optional `tuning` object are accepted, all three model roles are required, and unknown keys, wrong types and out-of-range values are rejected rather than ignored. `defaultUrls` must not exceed `maxUrls`, and search needs a Sonar model unless the `searchWebSearch` tool is enabled. A file without `apiKeyFile` still uses the default credential path, which the launcher supplies. Custom models must appear in OpenRouter's catalogue with the capabilities their role needs, and be available to the account.

This complete file selects the default models explicitly and changes only the page budget: research reads five pages unless a call sets `maxUrls`, and no call reads more than eight. [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#tuning) in the standalone server guide list every key and its accepted values.

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
    "defaultUrls": 5,
    "maxUrls": 8
  }
}
```

Validate the file with the configuration check before restarting. The server reads the file when it starts:

- With no file at start-up, the built-in defaults stay in force until the profile restarts. Restart after creating the file.
- A file that exists but fails validation does not stop the server. Each tool call returns a `CONFIGURATION` error naming the file and reads it again, until a call finds it valid. A file selected with `--config` in a row override behaves the same way while it is missing.
- Once a file loads, its selections stay fixed until the profile restarts. Restart after every later edit.

## Verification

**Configuration Check.** From the project directory, run the server's configuration check. It reads the per-user file, or the built-in defaults when there is none, and applies the server's home and filesystem-root rejection. It needs no key and makes no model call. Its first run also downloads the server into the `npx` cache.

```bash
npx -y --package @curio-data/mcp-intelli-search@0.25.0 \
  mcp-intelli-search --host dsh --check-config
```

A valid configuration prints one of two lines and exits with status `0`:

- `Configuration is valid.` when the per-user file loads.
- `Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).` when there is no per-user file.

Any other output is a diagnostic, with exit status `1`. The check does not test the key, account credit or model access.

**Bundle Rows.** The composed profile must list both bundle rows, `mcp-intelli-search` and `intelli-search-skill`:

```bash
profile=web
dsh --profile "$profile" --dump-config
```

**Inference Check (Billed).** Start the profile from the project directory with a key in place and ask: “Use mcp__intelli__intelli_search to find the current TypeScript release and cite the official source.” A completed tool call and an answer with sources show that the key, the search model and the bridge work. A tool list alone does not show provider access, and a quick search does not exercise page fetching, extraction or collation. To check the full pipeline, request research with a small page budget, for example: “Use mcp__intelli__intelli_research with maxUrls 3 to compare the two most recent Node.js long-term support releases.” A completed call returns a report and writes it under `.search/`; it costs more than a search.

<a id="tools-and-timeouts"></a>
## Timeouts

Two clocks limit a research call. The bundle raises the bridge's limit for one tool call to ten minutes (`toolCallTimeoutMs: 600000`); when it expires, the call fails in the harness. Inside the server, each model call has its own timeout, `llmTimeoutMs` (120 seconds by default). `llmRetryAttempts` (three attempts by default) repeats a timed-out or transient failure, and `outputBudgetRetries` (two by default) repeats an empty output-capped extraction, or any output-capped synthesis, at a doubled cap, with a timeout that grows with the cap up to four times `llmTimeoutMs`. With the defaults, one page's budget attempts alone can take up to 14 minutes, so a research call can outlast the bridge limit. Raising `llmTimeoutMs` lengthens calls; it never extends the bridge limit.

Server startup and tool discovery use a separate bridge request timeout, 60 seconds on `0.2.2-rc.1`. A slow first `npx` download can exceed it and leave the profile without the four tools on its first start.

To keep a call within ten minutes:

- Ask for fewer pages, for example `maxUrls` 3 in the request, or set lower `defaultUrls` and `maxUrls` in the per-user configuration.
- Put fewer questions in one batch, or fewer pages in each entry: a batch is one tool call, so all its entries share the limit.
- Set `outputBudgetRetries` to `0`, and lower `llmRetryAttempts`, when the limit is reached repeatedly.
- Use a quick search when a cited answer is enough.

A longer bridge limit needs a row override setting `toolCallTimeoutMs`, with the same version upkeep as a `cwd` override.

## Troubleshooting

| Symptom | Cause | Remedy |
|---|---|---|
| The four `mcp__intelli__*` tools are absent | The bridge row did not start. The bundle sets `failOnStartupError: false`, so the harness logs the failure and keeps running. Common causes: the bundle is in another profile; `node` or `npx` is missing or older than the floor; no network on the first start; or the first download outlasted the 60-second discovery timeout | Confirm both bundle rows with `--dump-config` for the profile in use. Run the configuration check from the project directory, which also fills the `npx` cache, then restart the profile. If the tools are still absent, read the harness log for the `mcp-intelli-search` row |
| `WORKSPACE` error naming the home or filesystem root | The harness started in the home directory or `/` | Restart the profile from the project directory, or set `cwd` in a row override |
| `CONFIGURATION` error naming `config.json` | The per-user file is invalid JSON or fails validation | Run the configuration check, correct the file and call again; the server reads it again on each call until it loads |
| Edits to `config.json` have no effect | The file had already loaded, or it was created after the profile started | Restart the profile |
| `CONFIGURATION` error for a missing key | No nonempty `OPENROUTER_API_KEY` reached the server and no credential file exists | Supply the key through either route; restart after an environment change |
| `CONFIGURATION` error about the credential file | The file is linked, owned by another user, or readable by group or others | Run setup again, or restrict the file to its owner with `chmod 600` |
| Setup stops with `Setup requires the key on standard input` | Setup was run with the terminal as input | Use the setup pipeline |
| A stored key is not used | A nonempty environment key takes precedence, or setup and the harness used different `XDG_CONFIG_HOME` values | Remove `OPENROUTER_API_KEY` from all three environment layers and restart, or run setup again with the harness's `XDG_CONFIG_HOME` |
| A research call fails after ten minutes | The bridge limit expired | Reduce the work as described under timeouts |
| `PROVIDER` error | Authentication, model access, account credit or connectivity failed; the category alone does not identify a rejected key | Check the account and its model access. Replace a stored key with setup, which applies on the next call, or an environment key, which needs a restart |
| Preflight names a model role or capability | A configured model is not in OpenRouter's catalogue or lacks a capability its role needs | Correct the model in `config.json` and restart |
| Repeated `429` retries | Provider rate limits | Set `minRequestIntervalMs` to `3000` and `extractionConcurrency` to `2` in `tuning`, then restart |
| The `intelli-search` skill differs in one project | On `0.2.2-rc.1`, a project skill with the same name outranks the bundle's registration; a user-level skill does not | Rename or remove the project skill |

The [standalone server's troubleshooting reference](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#timeouts-and-troubleshooting) gives the full list of diagnostics.

## Charges, Cache and Privacy

**Charges.** Every search and research call bills the configured OpenRouter account. The planning estimate for one ten-page research run with the default models is ≈$0.09, at the recorded September 2026 prices; it is not a live tariff. Fewer pages cost less. Each batch entry is a separate run, and retries add calls. See [Cost](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#cost).

**Cache.** Each research query writes one folder in the project's cache, named by the Coordinated Universal Time (UTC) date, a stem of the query and a short hash:

```text
.search/
├── 2026-11-23-node-lts-releases-3f7a2c/
│   ├── report.md        # Synthesis and source inventory
│   ├── query.txt        # The query as sent
│   ├── meta.json        # Local telemetry sidecar
│   ├── extractions/     # One extraction per page
│   └── sources/         # Full fetched page content
├── 2026-11-23-batch-node-lts-releases-9c1e04/
│   └── manifest.json    # Batch queries, outcomes and member folders
└── .index.json          # Index of cached reports
```

A completed repeat of the same query on the same UTC date archives the earlier folder to a numbered sibling, `.1` then `.2`, as a same-day safety net rather than a versioned archive. See [Cache Structure](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#cache-structure).

**Privacy.** The cache keeps full copies of fetched pages, the query and each report in the project directory, readable by anything that can read the project; exclude `.search/` from version control when its content must not be shared. Queries and page content go to OpenRouter and the selected model providers. The server fetches pages from the machine it runs on, and fetched addresses are not restricted to public ones. See [Filesystem and Privacy Boundaries](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#filesystem-and-privacy-boundaries).

**Telemetry and Cache.** `meta.json` is local telemetry, which the server never transmits: it records the query, per-stage outcomes and timings and, for batch entries, the fetched URLs. Setting `"disableTelemetry": true` in `tuning` stops `meta.json` and `batch-meta.json`; reports, extractions, sources, batch manifests and the index are still written, because they are the cache itself.

## Evidence and Limits

Every check below ran on Linux in an isolated profile created from the harness's headless template. Each is a separate class of evidence; none stands in for another.

- **Local bundle, credential-free:** a locally generated bundle installed, composed both rows, registered the four tools and the skill, rejected home and filesystem-root workspaces, delivered a dummy key, and was removed and reinstalled on `dsh` `0.2.2-rc.1` and `0.2.2-rc.5`, without a provider call.
- **Pre-bootstrap launcher:** before the bundle was public, the packed 0.25.0 bundle started the public 0.25.0 MCP server on `0.2.2-rc.1`, discovered the four tools, loaded the skill and passed the configuration check.
- **Public installation by name:** the public 0.25.0 bundle installed by name on `0.2.2-rc.1`, with four tools, the skill, the configuration check, removal and reinstallation, and no model call.
- **Credentialed research:** with a local bundle on `0.2.2-rc.1` only, a quick search, a three-page research call and the credential-file route completed through real OpenRouter calls.

Other versions in the declared range `>=0.2.2-rc.1 <0.3.0`, the shipped `web` profile, the Web **Add plugin**, **Versions** and **Update** routes, and macOS and Windows hosts are untested. The [compatibility record](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#deepseek-harness-evidence-and-limits) gives dates and details, including [public installation by name](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#public-dsh-profile-installation-2026-11-22).

## Further Documentation

- [Usage examples](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#usage-examples), including planned batch research, and the [tool reference](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#tools).
- [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#tuning) for every key, model constraint and accepted range.
- [Timeouts and Troubleshooting](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#timeouts-and-troubleshooting) for every diagnostic.
- [Cost](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#cost), [Cache Structure](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#cache-structure) and [Filesystem and Privacy Boundaries](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/packages/mcp/README.md#filesystem-and-privacy-boundaries).
- [Compatibility record](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#deepseek-harness-evidence-and-limits) and [Changelog](https://github.com/Curio-Data/pi-intelli-search/blob/main/CHANGELOG.md).
- [Installed skill](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/plugins/dsh/skills/intelli-search/SKILL.md), the agent-facing guidance this bundle registers.

## Licence

Apache-2.0. Copyright 2026 Ashraf Miah, Curio Data Pro Ltd. See the bundle's [LICENSE](https://github.com/Curio-Data/pi-intelli-search/blob/main/plugins/dsh/LICENSE). The bundle contains no third-party code, so it carries no `NOTICE`. The MCP server it launches through `npx`, `@curio-data/mcp-intelli-search`, is a separate package with its own [LICENSE](https://github.com/Curio-Data/pi-intelli-search/blob/main/LICENSE) and a [NOTICE](https://github.com/Curio-Data/pi-intelli-search/blob/main/NOTICE) for the third-party software it includes or uses.
