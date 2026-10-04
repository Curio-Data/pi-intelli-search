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

Then write the configuration file:

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

These are explicit selections, not defaults you must keep. Any chat model on OpenRouter works for `extract` and `collate`; `search` needs `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search` (or an explicitly configured `searchWebSearch` block; see the package documentation).

If a variable is missing, the server exits on startup with `Explicit --config and --workspace are required` on standard error and the tools never appear; fix the environment and restart Codex. A config file that does not exist produces `Cannot read configuration: provide an explicit readable JSON file`.
