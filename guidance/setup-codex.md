## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

[_Codex_](https://developers.openai.com/codex/plugins) starts plugin MCP servers with a filtered environment: arbitrary parent variables are not inherited and plugin MCP configuration performs no placeholder expansion (verified on the command-line interface (CLI) version 0.144.5). The plugin therefore declares `env_vars` so Codex forwards three named variables from the shell that launches `codex`:

- `OPENROUTER_API_KEY`: the [OpenRouter](https://openrouter.ai) application programming interface (API) key. One key covers all three pipeline stages.
- `INTELLI_SEARCH_CONFIG`: absolute path of the configuration file.
- `INTELLI_SEARCH_WORKSPACE`: absolute path of the workspace; the default research cache is its `.search/` subdirectory.

Supply the key at launch from a secret manager, or enter it at a hidden [_Bash_](https://www.gnu.org/software/bash/) prompt. Do not store a literal key in a shell profile or command history:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
export INTELLI_SEARCH_CONFIG="$HOME/.config/mcp-intelli-search/config.json"
export INTELLI_SEARCH_WORKSPACE="$PWD"
```

The snippet exports the launch directory as the workspace. For a stable per-project cache regardless of launch directory, set `INTELLI_SEARCH_WORKSPACE` to the project directory through `direnv` or another per-directory mechanism.

Create the parent directory and workspace, then save the following JavaScript Object Notation (JSON) configuration to `$INTELLI_SEARCH_CONFIG`:

```bash
mkdir -p "$(dirname "$INTELLI_SEARCH_CONFIG")" "$INTELLI_SEARCH_WORKSPACE"
```

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

These are explicit selections, not inherited defaults. Select OpenRouter models that pass catalogue validation for the required roles and are accessible to the configured account. Search requires `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search`, or a chat model with advertised tool support and an enabled `searchWebSearch` block. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide.

If either path selection (`INTELLI_SEARCH_CONFIG` or `INTELLI_SEARCH_WORKSPACE`) is missing, the server exits on startup with `Explicit --config and --workspace are required` on standard error and the tools never appear. Supply both paths and restart _Codex_. A missing or invalid selected configuration file does not stop connection. Each tool call reports a `CONFIGURATION` error naming the file; repair it and call again. The server rereads it until it loads successfully, then keeps it until restart.

A missing `OPENROUTER_API_KEY` is different: credentials are validated when an operation runs, not at server startup. Export the key and restart the host so the server receives the updated environment. Host forwarding behaviour is recorded for Codex CLI 0.144.5 in the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins).

### Verify Inference

Start Codex from the configured shell and request a quick search with the exposed `intelli_search` tool. Confirm an actual MCP tool call and an answer with sources. `codex mcp list` only lists configuration and does not prove server startup or provider access. If these tools are unavailable, report that setup is incomplete; do not claim to have used this server while answering through built-in web search.

### Unattended Runs

Interactive sessions ask before each research tool call. Non-interactive `codex exec` cannot ask, so it cancels the call and reports `user cancelled MCP tool call`. To run the tools unattended, pre-approve them in `${CODEX_HOME:-$HOME/.codex}/config.toml`:

```toml
[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
```

Recorded on Codex CLI 0.144.5.
