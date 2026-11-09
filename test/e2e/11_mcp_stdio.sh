#!/usr/bin/env bash
#
# test/e2e/11_mcp_stdio.sh — MCP stdio host smoke for the standalone package
#
# Verifies the built @curio-data/mcp-intelli-search executable as a Model
# Context Protocol server under pi's own native MCP client, in an isolated
# agent profile, WITHOUT loading the native pi-intelli-search extension.
# This exercises long-duration protocol calls, progress-tolerant request
# timeouts and graceful server shutdown through a real host.
#
# Usage:
#   ./test/e2e/11_mcp_stdio.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required for both the standalone pipeline stages
#                        (passed to the server through mcp.json env) and,
#                        when the loop model is OpenRouter, the agent loop.
#   TEST_MODEL           Override the headless agent-loop model.
#
# Live provider quota is consumed (one maxUrls=1 research). Keep pacing
# with other live scenarios; do not run it in a parallel burst.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
# Read .env BEFORE output reaches the retained log: a malformed line must
# never be echoed into it (see test/e2e/env.sh). The file is parsed, never
# executed, and only the documented keys are read.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS
# By default the MCP research call is made exactly through the host's own MCP
# client and the stdio server (lib.sh, direct-tool.mjs), with no agent-loop
# model call: the protocol path is qualified, only the model's choice of call
# is removed. auto falls back to the agent loop only when the
# host lacks that API, and says so; direct refuses to fall back; agent keeps
# the natural-language prompt.
E2E_INVOCATION="${E2E_INVOCATION:-auto}"
e2e_init_log e2e-mcp-stdio
e2e_attach_log
echo "📝 Log: $LOG_FILE"

E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-600}"

# TEST_MODEL overrides the loop model through e2e_setup_loop_model (lib.sh).

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  if [ -f "$HOME/.pi/agent/auth.json" ]; then
    OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
    if [ -n "$OPENROUTER_API_KEY" ]; then
      echo "🔑 Detected OPENROUTER_API_KEY from ~/.pi/agent/auth.json"
    fi
  fi
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set."
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

export OPENROUTER_API_KEY
e2e_setup_loop_model || exit 1

# ── Build the standalone artifact ──────────────────────────────────
# E2E_MCP_CLI names a prepared, frozen server entry and is never rebuilt.
if [[ -n "${E2E_MCP_CLI:-}" ]]; then
  echo "🔨 Using the prepared server: $E2E_MCP_CLI"
elif [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then
  echo "🔨 Using the prebuilt @curio-data/mcp-intelli-search artifact"
else
  echo "🔨 Building @curio-data/mcp-intelli-search"
  npm run build:mcp --prefix "$PROJECT_DIR" >/dev/null 2>&1 || {
    echo "❌ npm run build:mcp failed"
    exit 1
  }
fi
MCP_CLI="${E2E_MCP_CLI:-$PROJECT_DIR/packages/mcp/dist/cli.js}"
if [ ! -f "$MCP_CLI" ]; then
  echo "❌ Missing built server: $MCP_CLI"
  exit 1
fi

# ── Create isolated agent directory and workspace ──────────────────
trap e2e_cleanup EXIT
ISOLATED_AGENT_DIR=""
E2E_CWD=""
e2e_private_dir ISOLATED_AGENT_DIR mcp-agent
e2e_unit_workspace E2E_CWD mcp-cwd
WORKSPACE="$E2E_CWD/workspace"
mkdir -p "$ISOLATED_AGENT_DIR/sessions" "$WORKSPACE"

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"

e2e_write_auth "$ISOLATED_AGENT_DIR"

# settings.json: loop model only. No pi-intelli-search namespace and no
# extension; every research call must go through the MCP server.
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL"
}
EOF

cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

# Standalone server configuration: explicit workspace and provider.
cat > "$E2E_CWD/standalone-config.json" <<EOF
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
  },
  "tuning": {
    "cacheDir": ".search"
  }
}
EOF

# mcp.json: register the standalone server with pi's native MCP client.
cat > "$ISOLATED_AGENT_DIR/mcp.json" <<EOF
{
  "mcpServers": {
    "intelli-search": {
      "command": "node",
      "args": [
        "$MCP_CLI",
        "--config",
        "$E2E_CWD/standalone-config.json",
        "--workspace",
        "$WORKSPACE"
      ],
      "env": {
        "OPENROUTER_API_KEY": "\${OPENROUTER_API_KEY}"
      },
      "timeout": 600,
      "exposure": "direct",
      "description": "Standalone intelli-search research server (Phase 4 smoke)"
    }
  }
}
EOF

echo "⚙️  Test loop model: $E2E_LOOP_PROVIDER/$E2E_LOOP_MODEL"
echo "🔌 MCP server: intelli-search (standalone dist, isolated profile)"
echo ""

# ── Validate the connection before spending inference quota ────────
echo "── pi mcp list ───────────────────────────────────────────────────"
if PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" timeout --kill-after=15s 120s "${E2E_PI_BIN:-pi}" mcp list </dev/null; then
  echo "✅ pi connected to the standalone server"
else
  echo "❌ pi could not connect to the standalone server"
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode via native MCP client       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

PROMPT='Call the tool mcp__intelli_search__intelli_research with query "the current TypeScript release", maxUrls 1, domains ["typescriptlang.org"] and focusPrompt "the official release announcement, version number and release date". Then answer with the version and the source URL.'

# MCP support lives in pi's built-in extensions; --no-extensions would
# disconnect the servers. The isolated profile installs no other extensions,
# so the session loads nothing but the MCP client and the optional tracer.
E2E_PI_FLAGS=(--no-skills --no-prompt-templates --no-context-files --no-session)
E2E_EXTENSION_PATH=""
E2E_RESEARCH_TOOL="mcp__intelli_search__intelli_research"
E2E_VERDICT_WORKSPACE="$WORKSPACE"
E2E_EXPECT_CACHE_DIR=".search"
E2E_EXPECT_ARGS='{"query":"the current TypeScript release","maxUrls":1,"domains":["typescriptlang.org"],"focusPrompt":"the official release announcement, version number and release date"}'

# The bound research is the verdict regardless of exit code: `Pi` 1.2.0
# print mode exits 1 when the agent-loop summary is truncated at the output
# token limit, even after a completed research.
if ! e2e_run_pi "$ISOLATED_AGENT_DIR" "$E2E_CWD" "$PROMPT" "$E2E_TIMEOUT_SECONDS"; then
  echo "❌ pi failed: ${E2E_LAST_VERDICT_REASON:-no completed research after retries}"
  echo "--- pi output ---"
  echo "$E2E_LAST_OUTPUT"
  echo "-----------------"
  exit 1
fi
OUTPUT="$E2E_LAST_OUTPUT"

echo "$OUTPUT"
echo ""
echo "── Verification ──────────────────────────────────────────────────"

ERRORS=0

if echo "$OUTPUT" | grep -qi "intelli_search\|intelli_research\|mcp__intelli"; then
  echo "✅ MCP tools were used by the host"
else
  echo "⚠️  No explicit MCP tool mention in output (cache artifacts are authoritative)"
fi

# The entry bound to this run's own MCP research call (lib.sh), never the
# first matching directory.
CACHE_DIR="$E2E_BOUND_ENTRY"
if [ -n "$CACHE_DIR" ] && [ -f "$CACHE_DIR/report.md" ] && [ -f "$CACHE_DIR/meta.json" ]; then
  echo "✅ Standalone cache written: $CACHE_DIR"
else
  echo "❌ Missing standalone cache artifacts under $WORKSPACE/.search"
  ERRORS=1
fi

if [ -n "$CACHE_DIR" ] && jq -e '.adapter == "mcp"' "$CACHE_DIR/meta.json" >/dev/null 2>&1; then
  echo "✅ Telemetry sidecar records the mcp adapter identity"
else
  echo "❌ Telemetry sidecar missing the mcp adapter identity"
  ERRORS=1
fi

if [ -n "$CACHE_DIR" ] && jq -e '.outcome == "completed"' "$CACHE_DIR/meta.json" >/dev/null 2>&1; then
  echo "✅ Research completed through the protocol connection"
else
  echo "❌ Research did not complete through the protocol connection"
  ERRORS=1
fi

if [ "$ERRORS" -eq 0 ]; then
  echo ""
  echo "🎉 MCP STDIO HOST SMOKE PASSED"
else
  echo ""
  echo "❌ MCP STDIO HOST SMOKE FAILED"
  exit 1
fi
