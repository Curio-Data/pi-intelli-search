## Setup (One Time)

The plugin is a generated configuration bundle for _DeepSeek Harness_ (`dsh`), not an extension: one inserted bridge row starts the pinned `@curio-data/mcp-intelli-search` package through `npx` with `--host dsh`, and one registrar registers this skill. The first start needs network access to download the package. Later starts reuse the `npx` cache. [_Node.js_](https://nodejs.org/) 24.9 or later must be on `PATH`, the harness's own floor.

No path or credential exports are required. The server uses the harness working directory as its workspace and writes research cache below it. Start the harness from the project directory: a directory change later in the session does not move the cache. For a fixed project root, override `mcp-intelli-search` in the profile's `cordis.patch.yml` and set `cwd`. The patch replaces the whole configuration: copy the bundle row's other fields and update its pinned package version after each bundle upgrade. A home or filesystem-root working directory produces an actionable `WORKSPACE` tool error instead of an accidental shared cache. Without a per-user configuration file, DeepSeek Harness mode selects `perplexity/sonar` for search and `minimax/minimax-m3` for extraction and collation; the four tools start even when credentials are absent.

Credentials reach the server through the harness environment layer. Precedence: an `OPENROUTER_API_KEY` exported in the launching environment, then a `.env` file in the launch directory, then `$DSH_HOME/.env`. Accepted values are copied into the environment once at launch, so adding a key requires one harness restart. To use the key across launching shells, prepare the harness-home file before entering the key:

```bash
(umask 077; touch "${DSH_HOME:-$HOME/.dsh}/.env") && chmod 600 "${DSH_HOME:-$HOME/.dsh}/.env"
```

After the command succeeds, edit that file privately. Put `OPENROUTER_API_KEY=<key>` on its own line, replacing any previous definition. From the project directory, restart the same profile with `dsh --profile <name>`.

The bridge row forwards `process.env.OPENROUTER_API_KEY` to the server; an unset value stays unset and does not block startup. A key stored through the harness model-settings page does not provision this server: that credential is resolved through a service a child process cannot read, so the environment layer above is the supported route. As an alternative, `npx -y --package @curio-data/mcp-intelli-search mcp-intelli-search setup` reads a key from standard input and stores it in a user-only credential file beside the per-user configuration at `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search`, shared with the Codex host mode; a stored file is reread on each call, but a nonempty environment key takes precedence. Remove it from all three layers and restart to use the file. Edit that `config.json` to override models or tuning; custom models must pass catalogue validation for the required roles and be accessible to the configured account. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide.

This host names the MCP server `intelli`, so the four tools appear as `mcp__intelli__intelli_search`, `mcp__intelli__intelli_extract`, `mcp__intelli__intelli_collate` and `mcp__intelli__intelli_research`. A missing tool set means the bridge row did not start: the bundle sets `failOnStartupError: false`, so the harness keeps running and logs the failure rather than surfacing it. Report the missing tools and the startup log; do not substitute the harness's own web search and claim this server was used.

Research calls can take minutes. A slow call is not a hang: the bundle raises the bridge call limit to ten minutes (`toolCallTimeoutMs: 600000`). Server startup and tool discovery keep the separate 60-second protocol default, so a slow first `npx` download can still lose the tools on the first start.

A project skill with the same name outranks this registration; a user-level skill does not. Local overrides therefore work at the project level only.

### Verify Inference

Request a quick search with `mcp__intelli__intelli_search` and confirm an actual tool call and an answer with sources. A running harness and a registered tool list do not prove provider access. If the tools are absent, report that setup is incomplete; do not claim this server was used while answering through the harness's own search.

### Removal

```bash
dsh plugin --profile <name> remove @curio-data/dsh-intelli-search
```

Restart the same profile with `dsh --profile <name>` after removal, then confirm with `dsh --profile <name> --dump-config` that the two bundle rows are gone.

### Evidence Limits

Installation, exact tool registration, skill loading, workspace guards, credential-free startup and dummy credential delivery are verified against `dsh` `0.2.2-rc.1` and `0.2.2-rc.5` on Linux with the local bundle and no provider calls. The bundle declares `engines.dsh: >=0.2.2-rc.1 <0.3.0`; other versions in that range and credentialed research are unverified.
