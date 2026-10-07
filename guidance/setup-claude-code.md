## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

The launcher supplies:

- `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json` (the configuration file lives in the plugin data directory, which persists across plugin updates)
- `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (the opened project, whose default research cache is `.search/`)
- `OPENROUTER_API_KEY` from the plugin's required `openrouter_api_key` option, which _Claude Code_ keeps in its credential store

The plugin data directory is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/intelli-search-curio-data-plugins/`. The host substitutes `${CLAUDE_PLUGIN_DATA}` in the loaded skill; that variable is not automatically exported in an ordinary shell. Run `/intelli-search:intelli-search` for the substituted view.

Steps:

1. Set the [OpenRouter](https://openrouter.ai) application programming interface (API) key in the plugin's required `openrouter_api_key` option. Installing does not ask for it: _Claude Code_ reports that the server needs configuration and does not start it until the option is set. One key covers all three pipeline stages. An exported `OPENROUTER_API_KEY` is not used: the plugin option always supplies the variable. Set the option either way:

   - **Session Setup:** run `/plugin`, select `intelli-search` in the Installed tab and choose Configure.
   - **Shell Setup:** pipe the value in, so the key never appears in a process list. Enter it hidden first, and clear the temporary variable afterwards:

     ```bash
     read -r -s -p 'OpenRouter API key: ' KEY
     printf '\n'
     printf '{"openrouter_api_key":"%s"}' "$KEY" \
       | claude plugin configure intelli-search@curio-data-plugins --values-stdin
     unset KEY
     ```

     `printf` here is the shell builtin, which starts no process; keep it rather than `jq --arg` or `echo` through another program. Do not use `claude plugin install --config openrouter_api_key=...`: it places the key on the command line. The command reports `Restart Claude Code to apply it`: sessions already open keep the options they loaded, so restart them.

   The shell route needs `claude plugin configure --values-stdin`, which the _Claude Code_ documentation lists from 2.1.285; the plugin is verified on 2.1.289.
2. Create the plugin data directory and write the configuration file. The data directory is the expanded form of `${CLAUDE_PLUGIN_DATA}`, which is not automatically exported in an ordinary shell:

   ```bash
   PLUGIN_DATA="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/intelli-search-curio-data-plugins"
   mkdir -p "$PLUGIN_DATA"
   ```

   Write the following JavaScript Object Notation (JSON) configuration to `$PLUGIN_DATA/config.json`:

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
3. Restart _Claude Code_ and verify with `claude mcp list`: the server `plugin:intelli-search:intelli_search` must show as connected. If it is absent, check the key option. Then request a quick search through the server and confirm a model-visible answer with sources; connection alone does not verify inference.

An explicitly selected missing or invalid `config.json` no longer prevents the server from connecting. Tool calls name the file defect without billing inference; repair the file and call again. The server rereads the file on each call until it loads, then keeps it until restart. Credentials are always captured at startup, so changing the key still requires a restart.

For a failed connection, inspect the host's MCP diagnostics. On Linux with Claude Code 2.1.289, logs were under `~/.cache/claude-cli-nodejs/<project>/mcp-logs-plugin-intelli-search-intelli-search/`. A cached startup failure from an older server may survive a repair: try `/mcp` reconnect and restart the session. The recorded failure cache expired after approximately 15 minutes; reconnect clearing that cache is not established.

Uninstalling the plugin removes the contents of its data directory, including `config.json`; keep a copy before uninstalling if reinstallation is planned. If _Claude Code_ reports that it could not clear the plugin's stored options, remove the `pluginSecrets` entry for `intelli-search@curio-data-plugins` from its credential store, and rotate the key if uninstalling to retire it.

### Authentication Failure

A `401` from an operation means the server received a key OpenRouter rejects. Replace the stored option in a session through `/plugin` → Installed → `intelli-search` → Configure, then reconnect the server with `/mcp`. If replacing it from a shell instead, restart the session: an open session keeps the options it loaded. Exporting a different `OPENROUTER_API_KEY` has no effect on this plugin.

### Workspace Expansion Failure

If standard error reports `workspace must be an explicit absolute directory` because the host left `CLAUDE_PROJECT_DIR` unexpanded, edit the installed plugin's `.mcp.json`, replace `INTELLI_SEARCH_WORKSPACE` with a literal absolute directory path, and restart the host.

Workspace expansion is recorded on _Claude Code_ v2.1.289 only; other versions are unverified. Host substitution does not export `CLAUDE_PROJECT_DIR` into the server process environment. See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the recorded check.
