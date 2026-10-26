## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx` with `--host codex`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [_Node.js_](https://nodejs.org/) 22 or later must be on `PATH`.

No path or credential exports are required. The server uses the [_Codex_](https://developers.openai.com/codex/plugins) working root as its workspace and writes research cache below it. Launch Codex from the project folder or use its `--cd` option. Without a configuration file, Codex mode selects `perplexity/sonar` for search and `minimax/minimax-m3` for extraction and collation. Its four tools start even when credentials are absent.

From the project folder in [_Bash_](https://www.gnu.org/software/bash/), store the [OpenRouter](https://openrouter.ai) application programming interface (API) key through the setup command. Enter it at a hidden prompt and pipe it through standard input. Do not put the key in process arguments, shell history or configuration JSON. Use setup from the plugin's 0.19 release line:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
printf '%s\n' "$OPENROUTER_API_KEY" | \
  npx -y --package @curio-data/mcp-intelli-search@0.19 \
  mcp-intelli-search setup
unset OPENROUTER_API_KEY
```

Setup creates `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/config.json` when absent and stores the key separately as `openrouter.key` with user-only permissions. Existing model and tuning selections are preserved. Setup adds a missing `apiKeyFile` selection and honours an existing custom credential path.

The next tool call reads a new or replacement key without a restart when the loaded configuration selects that path. Restart after changing loaded configuration. An `OPENROUTER_API_KEY` exported before _Codex_ launches remains an alternative and takes precedence over the file; the plugin forwards that variable and `XDG_CONFIG_HOME`. Confirm that setup prints `Setup complete.` before starting or using _Codex_. Codex mode ignores legacy `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` exports; explicit command-line selections remain available. A home or filesystem-root working directory produces an actionable `WORKSPACE` tool error instead of an accidental shared cache; restart _Codex_ from the project or with `--cd <project>`.

Edit the per-user `config.json` to override models or tuning. Custom models must pass catalogue validation for the required roles and be accessible to the configured account. Search requires a supported Sonar model or a tool-capable chat model with `searchWebSearch` enabled. This is the same explicit JSON format used by generic registration, with `providers.openrouter.apiKeyFile` set to the credential path. Configuration changes require a restart. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide.

The `/mcp` status `Auth: Unsupported` is expected for this stdio server. It means that the OAuth authorization framework is not used; it does not describe the OpenRouter credential. The status `failed (0 tools)` means that startup or initialisation failed, not that the key is missing. A missing key instead produces an actionable `CONFIGURATION` tool result naming `mcp-intelli-search setup`.

### Verify Inference

Start _Codex_ normally and request a quick search with the exposed `intelli_search` tool. Confirm an actual MCP tool call and an answer with sources. `codex mcp list` only lists configuration and does not prove server startup or provider access. If these tools are unavailable, report that setup is incomplete; do not claim to have used this server while answering through built-in web search.

### Unattended Runs

Interactive sessions ask before each research tool call. Non-interactive `codex exec` cannot ask, so it cancels the call and reports `user cancelled MCP tool call`. To run the tools unattended, pre-approve them in `${CODEX_HOME:-$HOME/.codex}/config.toml`:

```toml
[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
```

See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the host versions and evidence classes.
