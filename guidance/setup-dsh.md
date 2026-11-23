## Setup (One Time)

The plugin is a generated configuration bundle for _DeepSeek Harness_ (`dsh`), not an extension: one inserted bridge row starts the pinned `@curio-data/mcp-intelli-search@{{MCP_VERSION}}` package through `npx` with `--host dsh`, and one registrar registers this skill. The bundle installs into one harness profile, the name given to `--profile`, and only that profile loads it. The first start needs network access to download the package; later starts reuse the `npx` cache. [_Node.js_](https://nodejs.org/) 24.9 or later must be on `PATH` with `node` and `npx`, the harness's own floor. For the `dsh plugin` commands, put `pnpm` on `PATH` unless the launcher supplies its own package manager. The `pnpmCommand` setting applies only to the in-harness plugin manager.

No path or credential exports are required. The server uses the harness working directory as its workspace and writes research cache below it. Start the harness from the project directory: a directory change later in the session does not move the cache. For a fixed project root, override the row with id `mcp-intelli-search` in the profile's `cordis.patch.yml` under `$DSH_HOME/profiles/` and set `cwd`. The override replaces that row's entire `config`. Copy its other `config` fields from the profile's `--dump-config` output, for example `dsh --profile web --dump-config` with the profile in use substituted for `web`, and update the pinned package version after each bundle update. A home or filesystem-root working directory produces an actionable `WORKSPACE` tool error instead of an accidental shared cache. Without a per-user configuration file, DeepSeek Harness mode selects `perplexity/sonar` for search and `minimax/minimax-m3` for extraction and collation; the four tools start even when credentials are absent.

Credentials reach the server through the harness environment layer or a credential file. Environment precedence: an `OPENROUTER_API_KEY` exported in the launching environment, then a `.env` file in the launch directory, then `$DSH_HOME/.env`. The harness reads these once at launch, so a changed key requires one restart of the profile. To use the key across launching shells, prepare the harness-home file before entering the key:

```bash
(umask 077; touch "${DSH_HOME:-$HOME/.dsh}/.env") && chmod 600 "${DSH_HOME:-$HOME/.dsh}/.env"
```

After the command succeeds, the user opens the file in an editor so the key stays out of shell history, and puts `OPENROUTER_API_KEY=` followed by the key on its own line, replacing any previous definition. From the project directory, restart the same profile.

The bridge row forwards `process.env.OPENROUTER_API_KEY` to the server; the server treats an empty value as absent and starts without a key. A key stored through the harness model-settings page does not provision this server: that credential is resolved through a service a child process cannot read. As the alternative, the server's `setup` command reads a key from standard input, never from a terminal, and stores it in a user-only credential file beside the per-user configuration at `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search`, shared with the Codex host mode. Ask the user to run this pipeline in their own _Bash_ shell; never ask for the key in the conversation or place it in arguments, files or logs:

```bash
(
  set +x
  set +a
  unset key || exit 1
  IFS= read -r -s -p 'OpenRouter API key: ' key || exit 1
  printf '\n'
  printf '%s\n' "$key" | \
    npx -y --package @curio-data/mcp-intelli-search@{{MCP_VERSION}} \
    mcp-intelli-search setup
)
```

The subshell passes the key to setup on standard input, not in the environment, and leaves the calling shell's variables unchanged. Setup must print `Setup complete.`; otherwise setup is incomplete. It honours an existing custom `apiKeyFile` path and leaves that configuration unchanged. Only an absolute `XDG_CONFIG_HOME` is honoured, and setup must run with the same value as the harness. A stored file is reread on each call, but a nonempty environment key takes precedence: remove `OPENROUTER_API_KEY` from all three environment layers and restart to use the file. Edit that `config.json` to override models or tuning; custom models must pass catalogue validation for the required roles and be accessible to the configured account. A per-user file created after the harness started, or edited after it loaded, takes effect only after a restart; an invalid file is reread on each call until it loads. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v{{MCP_VERSION}}/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v{{MCP_VERSION}}/packages/mcp/README.md#tuning) in the standalone guide.

To validate the configuration without a key or a model call, run from the project directory:

```bash
npx -y --package @curio-data/mcp-intelli-search@{{MCP_VERSION}} \
  mcp-intelli-search --host dsh --check-config
```

It prints `Configuration is valid.` for a loaded per-user file, or `Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).` when none exists. It rejects a home or filesystem-root directory like the server does.

This host names the MCP server `intelli`, so the four tools appear as `mcp__intelli__intelli_search`, `mcp__intelli__intelli_extract`, `mcp__intelli__intelli_collate` and `mcp__intelli__intelli_research`. A missing tool set means the bridge row did not start: the bundle sets `failOnStartupError: false`, so the harness keeps running and logs the failure rather than surfacing it. Report the missing tools and the startup log; do not substitute the harness's own web search and claim this server was used.

Research calls can take minutes. A slow call is not a hang: the bundle raises the bridge call limit to ten minutes (`toolCallTimeoutMs: 600000`), and the server applies its own model-call timeouts and retries during the call. With the defaults, they can outlast the bridge limit, so keep `maxUrls` small (3 for targeted research) and batches short. Server startup and tool discovery use a separate request timeout (60 seconds on `{{DSH_REFERENCE_VERSION}}`), so a slow first `npx` download can still lose the tools on the first start.

On `{{DSH_REFERENCE_VERSION}}`, a project skill with the same name outranks this registration; a user-level skill does not. Local overrides therefore work at the project level only.

### Verify Inference

Request a quick search with `mcp__intelli__intelli_search` and confirm an actual tool call and an answer with sources. A running harness and a registered tool list do not prove provider access, and a quick search does not prove the research pipeline. If the tools are absent, report that setup is incomplete; do not claim this server was used while answering through the harness's own search.

### Removal

```bash
profile=web
dsh plugin --profile "$profile" remove @curio-data/dsh-intelli-search
dsh --profile "$profile" --dump-config
```

Set `profile` to the profile in use. Restart that profile after removal; the dump must no longer list the two bundle rows. Removal leaves the per-user configuration, stored key, `.env` entries and each project's `.search/` cache in place.

### Evidence Limits

Installation, exact tool registration, skill loading, workspace guards, credential-free startup and dummy credential delivery are verified against `dsh` {{DSH_TESTED_VERSIONS}} on Linux with the local bundle and no provider calls. Installation by name of the public 0.25.0 packages, with removal and reinstallation, passed separately on `0.2.2-rc.1` without a model call. The bundle declares `engines.dsh: {{DSH_ENGINES_RANGE}}`; the whole range has not been tested. A separate credentialed local-bundle run verified search, research and credential-file fallback on `0.2.2-rc.1` only.
