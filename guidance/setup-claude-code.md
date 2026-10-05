## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

The launcher supplies:

- `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json` (the configuration file lives in the plugin data directory, which persists across plugin updates)
- `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (the project you opened, so the research cache lands in that project's `.search/`)
- `OPENROUTER_API_KEY` from the plugin's required `openrouter_api_key` option, which _Claude Code_ keeps in its credential store

The plugin data directory resolves to `~/.claude/plugins/data/intelli-search-curio-data-plugins/`; the skill body already shows you the substituted absolute path wherever `${CLAUDE_PLUGIN_DATA}` appears.

Steps:

1. Enter your [OpenRouter](https://openrouter.ai) key when _Claude Code_ asks for the plugin's options, or later through `/plugin` → `intelli-search` → configure. One key covers all three pipeline stages. The server does not start until the option is set. An exported `OPENROUTER_API_KEY` is not used: the plugin option always supplies the variable. To set the key from a shell without placing it on a command line, pipe it in:

   ```bash
   printf '{"openrouter_api_key":"%s"}' "$KEY" \
     | claude plugin configure intelli-search@curio-data-plugins --values-stdin
   ```
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

   These are explicit selections, not defaults you must keep. Any chat model on OpenRouter works for `extract` and `collate`; `search` needs `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search` (or an explicitly configured `searchWebSearch` block; see [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide).
3. Restart Claude Code and verify with `claude mcp list`: the server `plugin:intelli-search:intelli_search` must show as connected. If it is absent from the list, the key option is not set.

Uninstalling the plugin deletes its data directory, including `config.json`. Keep a copy if you plan to reinstall.

### Authentication Failure

A `401` from an operation means the server received a key OpenRouter rejects. Replace the stored option through `/plugin` → `intelli-search` → configure, then reconnect the server with `/mcp`. Exporting a different `OPENROUTER_API_KEY` has no effect on this plugin.

### Workspace Expansion Failure

If standard error reports `workspace must be an explicit absolute directory` because the host left `CLAUDE_PROJECT_DIR` unexpanded, edit the installed plugin's `.mcp.json`, replace `INTELLI_SEARCH_WORKSPACE` with a literal absolute directory path, and restart the host.

Workspace expansion is recorded on _Claude Code_ v2.1.289 only; other versions are unverified. Host substitution does not export `CLAUDE_PROJECT_DIR` into the server process environment. See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the recorded check.
