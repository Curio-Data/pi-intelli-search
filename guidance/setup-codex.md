## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

Codex starts plugin MCP servers with a filtered environment: arbitrary parent variables are not inherited and plugin MCP configuration performs no placeholder expansion (verified on Codex CLI 0.144.5). The plugin therefore declares `env_vars` so Codex forwards three named variables from the environment you start `codex` with:

- `OPENROUTER_API_KEY`: your [OpenRouter](https://openrouter.ai) key. One key covers all three pipeline stages.
- `INTELLI_SEARCH_CONFIG`: absolute path of the configuration file.
- `INTELLI_SEARCH_WORKSPACE`: absolute path of the workspace; the research cache lands in its `.search/` subdirectory.

Export them before starting Codex, for example in your shell profile:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export INTELLI_SEARCH_CONFIG="$HOME/.config/mcp-intelli-search/config.json"
export INTELLI_SEARCH_WORKSPACE="$HOME/.local/share/mcp-intelli-search/workspace"
```

For per-project caches, set `INTELLI_SEARCH_WORKSPACE` to the project directory before each `codex` launch (for example with `direnv`) instead of exporting a fixed path.

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

These are explicit selections, not defaults you must keep. Any chat model on OpenRouter works for `extract` and `collate`; `search` needs `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search` (or an explicitly configured `searchWebSearch` block; see [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide).

If either path selection (`INTELLI_SEARCH_CONFIG` or `INTELLI_SEARCH_WORKSPACE`) is missing, the server exits on startup with `Explicit --config and --workspace are required` on standard error and the tools never appear. Supply both paths and restart _Codex_. A configuration file that does not exist produces `Cannot read configuration: provide an explicit readable JSON file`.

A missing `OPENROUTER_API_KEY` is different: credentials are validated when an operation runs, not at server startup. Export the key and restart the host so the server receives the updated environment. Host forwarding behaviour is recorded for Codex CLI 0.144.5 in the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins).

### Unattended Runs

Interactive sessions ask before each research tool call. Non-interactive `codex exec` cannot ask, so it cancels the call and reports `user cancelled MCP tool call`. To run the tools unattended, pre-approve them in `~/.codex/config.toml`:

```toml
[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
```

Recorded on Codex CLI 0.144.5.
