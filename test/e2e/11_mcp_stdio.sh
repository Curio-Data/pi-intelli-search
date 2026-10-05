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

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-mcp-stdio-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS

E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-600}"

# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"
# shellcheck disable=SC2034  # consumed by e2e_setup_loop_model in lib.sh
E2E_LOOP_MODEL_ID="${TEST_MODEL:-}"

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
echo "🔨 Building @curio-data/mcp-intelli-search"
npm run build:mcp --prefix "$PROJECT_DIR" >/dev/null 2>&1 || {
  echo "❌ npm run build:mcp failed"
  exit 1
}
MCP_CLI="$PROJECT_DIR/packages/mcp/dist/cli.js"
if [ ! -f "$MCP_CLI" ]; then
  echo "❌ Missing built server: $MCP_CLI"
  exit 1
fi

# ── Create isolated agent directory and workspace ──────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-mcp-agent-XXXXXX)"
E2E_CWD="$(mktemp -d -t pi-e2e-mcp-cwd-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR" "$E2E_CWD"' EXIT
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
if PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" pi mcp list; then
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

run_pi() {
  (
    cd "$E2E_CWD"
    # MCP support lives in pi's built-in extensions; --no-extensions would
    # disconnect the servers. The isolated profile installs no other
    # extensions, so the session still loads nothing but the MCP client.
    PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" \
      timeout --foreground "${E2E_TIMEOUT_SECONDS}s" pi \
        --no-skills --no-prompt-templates \
        --no-context-files --no-session \
        -p "$PROMPT" 2>&1
  )
}

OUTPUT=""
RAN=0
REF="$(mktemp)"
for ATTEMPT in 1 2 3; do
  if OUTPUT="$(run_pi)"; then
    if find "$WORKSPACE" -maxdepth 4 -name meta.json -newer "$REF" -print -quit 2>/dev/null | grep -q .; then
      RAN=1
      break
    fi
  fi
  echo "   ⚠️  pi attempt ${ATTEMPT}/3 did not produce a fresh sidecar; retrying after 30s" >&2
  sleep 30
done
rm -f "$REF"

if [[ "$RAN" -ne 1 ]]; then
  echo "❌ pi failed (no cache sidecar after retries)"
  echo "--- pi output ---"
  echo "$OUTPUT"
  echo "-----------------"
  exit 1
fi

echo "$OUTPUT"
echo ""
echo "── Verification ──────────────────────────────────────────────────"

ERRORS=0

if echo "$OUTPUT" | grep -qi "intelli_search\|intelli_research\|mcp__intelli"; then
  echo "✅ MCP tools were used by the host"
else
  echo "⚠️  No explicit MCP tool mention in output (cache artifacts are authoritative)"
fi

CACHE_DIR="$(find "$WORKSPACE/.search" -maxdepth 1 -mindepth 1 -type d -name '20*' | head -n 1 || true)"
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
