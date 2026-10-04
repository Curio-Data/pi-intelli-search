## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

The launcher supplies:

- `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json` (the configuration file lives in the plugin data directory, which persists across plugin updates)
- `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (the project you opened, so the research cache lands in that project's `.search/`)
- `OPENROUTER_API_KEY` inherited from the environment Claude Code was started with

The plugin data directory resolves to `~/.claude/plugins/data/intelli-search-curio-data-plugins/`; the skill body already shows you the substituted absolute path wherever `${CLAUDE_PLUGIN_DATA}` appears.

Steps:

1. Export your [OpenRouter](https://openrouter.ai) key in your shell profile so the server process inherits it: `export OPENROUTER_API_KEY=sk-or-v1-...`. One key covers all three pipeline stages. Restart Claude Code after adding it.
2. Create the plugin data directory and write the configuration file:

   ```bash
   mkdir -p "${CLAUDE_PLUGIN_DATA}"
   ```

   Write `${CLAUDE_PLUGIN_DATA}/config.json`:

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
3. Restart Claude Code and verify with `claude mcp list`: the server `plugin:intelli-search:intelli_search` must show as connected.

The `CLAUDE_PROJECT_DIR` workspace expansion is verified on Claude Code v2.1.289 and listed in the plugins reference for MCP server `env` values, but it is not exported into the server process environment and older versions may not substitute it. On a version that leaves it unexpanded the server exits on startup with `workspace must be an explicit absolute directory` on standard error and the tools never appear; edit the installed plugin's `.mcp.json` and replace the `INTELLI_SEARCH_WORKSPACE` value with an absolute directory path in that case.
