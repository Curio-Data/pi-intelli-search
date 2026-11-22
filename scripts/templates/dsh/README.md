# Intelli Search for DeepSeek Harness

[_DeepSeek Harness_](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) host bundle for [`@curio-data/mcp-intelli-search`](https://www.npmjs.com/package/@curio-data/mcp-intelli-search): intelligent web research with a five-stage pipeline (search, fetch, per-page extraction, collation, cache suggestions), cited answers and a local `.search/` cache of every run.

The bundle adds two entries to a harness profile. One starts the standalone MCP server through `npx` with `--host dsh`; the other registers the shared `intelli-search` skill. The generator pins the server version in the launcher. Search and research run in that server, not in the bundle.

## Requirements

- `dsh` within the declared `engines.dsh` range `>=0.2.2-rc.1 <0.3.0` (see Evidence and Limits below)
- [_Node.js_](https://nodejs.org/) 24.9 or later on `PATH` (the harness's own floor; the first start downloads the MCP package through `npx`)
- For installation and removal, `pnpm` on `PATH` or an explicit `pnpmCommand`. A launcher-provided package manager takes precedence.
- An [_OpenRouter_](https://openrouter.ai) API key for the search, extract and collate stages

## Installation

Installation by name requires both this package and its matching MCP server on npm. Install into the profile used to start the harness (`tui` in this example):

```bash
dsh plugin --profile tui add @curio-data/dsh-intelli-search
```

Start the same profile from the project directory with `dsh --profile tui`.

## Credentials

The server receives its key through the harness environment layer. Precedence: an `OPENROUTER_API_KEY` exported in the launching environment, then a `.env` file in the launch directory, then `$DSH_HOME/.env`. Accepted values are copied into the environment once at launch, so restart that profile after changing a key. To use the key across launching shells, prepare the harness-home file before entering the key:

```bash
(umask 077; touch "${DSH_HOME:-$HOME/.dsh}/.env") && chmod 600 "${DSH_HOME:-$HOME/.dsh}/.env"
```

After the command succeeds, open the file in an editor so the key stays out of shell history. Put `OPENROUTER_API_KEY=<key>` on its own line, replacing any previous definition.

The bridge row forwards `process.env.OPENROUTER_API_KEY` to the server; the server treats an empty value as absent and starts without a key. A key stored through the harness model-settings page does not provision this server: that credential is resolved through a service a child process cannot read.

Alternatively, `npx -y --package @curio-data/mcp-intelli-search mcp-intelli-search setup` reads a key from standard input and stores it in a user-only credential file beside the per-user configuration at `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search` (shared with the Codex host mode). A stored file is reread on each call; a nonempty environment key takes precedence. Remove `OPENROUTER_API_KEY` from all three environment layers and restart to use the file.

## Workspace and Cache

The server uses the harness working directory as its workspace and writes the research cache (`.search/` by default) below it. Start the harness from the project directory: a directory change later in the session does not move the cache. For a fixed project root, override the row with id `mcp-intelli-search` in `$DSH_HOME/profiles/<name>/cordis.patch.yml` and set `cwd`. The override replaces that row's entire `config`. Copy its other `config` fields from the bundle and update the pinned package version after each bundle upgrade. A home or filesystem-root working directory is rejected with an actionable `WORKSPACE` error instead of creating an accidental shared cache.

## Tools and Timeouts

The harness names the MCP server `intelli`, so the four tools appear as:

- `mcp__intelli__intelli_search`
- `mcp__intelli__intelli_extract`
- `mcp__intelli__intelli_collate`
- `mcp__intelli__intelli_research`

Start with `intelli_search` for quick facts; `intelli_research` runs the full pipeline over multiple pages. Research calls can take minutes: the bundle raises the bridge call limit to ten minutes (`toolCallTimeoutMs: 600000`). Server startup and tool discovery use a separate request timeout (60 seconds on `0.2.2-rc.1`), so a slow first `npx` download can still lose the tools on a first start; a later start reuses the `npx` cache.

A missing tool set means the bridge row did not start. The bundle sets `failOnStartupError: false`, so the harness keeps running and logs the failure rather than surfacing it: report the missing tools together with the startup log instead of substituting the harness's own web search.

On `0.2.2-rc.1`, a project skill with the same name outranks the bundle's skill registration; a user-level skill does not.

## Verification

After restarting with a key in place, request a quick search with `mcp__intelli__intelli_search` and confirm an actual tool call and an answer with sources. A running harness and a registered tool list do not prove provider access. `dsh --profile <name> --dump-config` shows the composed bundle rows, with `!!js` expressions verbatim, and is the first check when tools are missing.

## Removal

```bash
dsh plugin --profile <name> remove @curio-data/dsh-intelli-search
```

Restart the same profile with `dsh --profile <name>`, then confirm with `dsh --profile <name> --dump-config` that the two bundle rows are gone.

## Evidence and Limits

Installation, exact tool registration, skill loading, workspace guards, credential-free startup and dummy credential delivery are verified against `dsh` `0.2.2-rc.1` and `0.2.2-rc.5` on Linux with the local bundle and no provider calls. Credentialed local-bundle search, research and credential-file fallback were verified separately on `0.2.2-rc.1` only. The whole declared range and registry-pin installation have not been tested.

## Licence

Apache-2.0. Copyright 2026 Ashraf Miah, Curio Data Pro Ltd. See `LICENSE`. This package bundles no third-party code, so it carries no `NOTICE`. The MCP server it launches through `npx`, `@curio-data/mcp-intelli-search`, ships its own `LICENSE` and `NOTICE`.
