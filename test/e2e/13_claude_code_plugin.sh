#!/usr/bin/env bash
#
# test/e2e/13_claude_code_plugin.sh — credentialed Claude Code plugin run
#
# Installs the generated Claude Code plugin (local-tarball class) into an
# isolated CLAUDE_CONFIG_DIR, supplies the OpenRouter key through the
# plugin's sensitive userConfig option, and drives one real research call
# through `claude -p`. Scenario 12 proves installation and key delivery
# credential-free; this scenario proves the installed plugin works for a
# real Claude Code session end to end.
#
# Usage:
#   ./test/e2e/13_claude_code_plugin.sh
#
# Environment:
#   OPENROUTER_API_KEY       Required (auto-detected from ~/.pi/agent/auth.json).
#   CLAUDE_CODE_OAUTH_TOKEN  Required: a long-lived token from
#                            `claude setup-token`, kept in the gitignored .env.
#   E2E_CLAUDE_MODEL         Session model (default: sonnet).
#   E2E_TIMEOUT_SECONDS      Per-attempt timeout (default: 600).
#
# Credential safety. The session authenticates only with
# CLAUDE_CODE_OAUTH_TOKEN, a static token that Claude Code neither stores nor
# refreshes. No credential file is copied from the operator's profile, so no
# refresh-token chain can fork (the Phase 5 incident). ANTHROPIC_API_KEY and
# ANTHROPIC_AUTH_TOKEN are unset because they take precedence over the token.
# The script asserts that the isolated profile never receives a login
# credential and that the operator's own credential file is untouched.
#
# Live quota is consumed: one maxUrls=1 research on OpenRouter and one short
# session on the Claude subscription. Run through ./test/run-e2e-all.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-claude-code-plugin-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Load .env if it exists (gitignored)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-600}"
E2E_CLAUDE_MODEL="${E2E_CLAUDE_MODEL:-sonnet}"

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
  [ -n "$OPENROUTER_API_KEY" ] && echo "🔑 Detected OPENROUTER_API_KEY from ~/.pi/agent/auth.json"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set."
  exit 1
fi
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "❌ CLAUDE_CODE_OAUTH_TOKEN is not set."
  echo "   Run 'claude setup-token' once and add CLAUDE_CODE_OAUTH_TOKEN=<token> to $PROJECT_DIR/.env"
  exit 1
fi
for tool in claude node npm jq rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool"
    exit 1
  fi
done

# The session key travels only through the plugin option, never the
# environment, so the run also proves the option route.
OPTION_KEY="$OPENROUTER_API_KEY"
unset OPENROUTER_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export CLAUDE_CODE_OAUTH_TOKEN

mkdir -p "$PROJECT_DIR/.tmp"
E2E_ROOT="$(mktemp -d "$PROJECT_DIR/.tmp/intelli-claude-e2e-XXXXXXXX")"
CLAUDE_HOME_DIR="$E2E_ROOT/claude-home"
WORKSPACE="$E2E_ROOT/workspace"
mkdir -p "$CLAUDE_HOME_DIR" "$WORKSPACE"
echo "📁 Scratch: $E2E_ROOT"

OPERATOR_CREDENTIALS="$HOME/.claude/.credentials.json"
OPERATOR_MTIME="$(stat -c %Y "$OPERATOR_CREDENTIALS" 2>/dev/null || echo absent)"

cleanup() {
  local rc=$?
  # The isolated credential file holds the real OpenRouter key as a plugin
  # secret: remove it whatever the outcome, and the whole tree on success.
  rm -f "$CLAUDE_HOME_DIR/.credentials.json"
  if [[ "$rc" -eq 0 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT

ERRORS=0
ok()  { echo "✅ $1"; }
bad() { ERRORS=$((ERRORS + 1)); echo "❌ $1"; }

export CLAUDE_CONFIG_DIR="$CLAUDE_HOME_DIR"

# ── Pre-flight: the isolated profile authenticates with the token ──
echo
echo "── Pre-flight: claude $(claude --version 2>/dev/null | awk '{print $1}')"
AUTH_STATUS="$(claude auth status 2>/dev/null || true)"
if jq -e '.authMethod == "oauth_token"' <<<"$AUTH_STATUS" >/dev/null 2>&1; then
  ok "isolated profile authenticates with CLAUDE_CODE_OAUTH_TOKEN"
else
  echo "❌ unexpected auth status in the isolated profile:"
  jq -c '{authMethod, loggedIn, configDirectory}' <<<"$AUTH_STATUS" 2>/dev/null || echo "$AUTH_STATUS"
  exit 1
fi

# ── Build, pack and vendor the plugin (as scenario 12) ─────────────
echo
echo "── Build and install the local-tarball plugin"
(cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
mkdir -p "$E2E_ROOT/pack"
TARBALL="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$E2E_ROOT/pack" 2>/dev/null | tail -1)"
TARBALL="$E2E_ROOT/pack/$(basename "$TARBALL")"
WORK="$E2E_ROOT/bundles"
node "$PROJECT_DIR/scripts/generate-plugin-bundles.mjs" \
  --mode tarball --output "$WORK" \
  --codex-vendor-dir "$WORK/plugins/codex/vendor" >/dev/null
npm install --prefix "$WORK/plugins/claude-code/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
claude plugin marketplace add "$WORK" >/dev/null 2>&1
if ! claude plugin install intelli-search@curio-data-plugins >/dev/null 2>&1; then
  echo "❌ plugin install failed"
  exit 1
fi
ok "plugin installed from $(basename "$TARBALL")"

jq -cn --arg k "$OPTION_KEY" '{openrouter_api_key: $k}' \
  | claude plugin configure intelli-search@curio-data-plugins --values-stdin >/dev/null 2>&1
PLUGIN_DATA="$CLAUDE_HOME_DIR/plugins/data/intelli-search-curio-data-plugins"
mkdir -p "$PLUGIN_DATA"
cat > "$PLUGIN_DATA/config.json" <<'EOF'
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
EOF
ok "key option set and config.json written as the skill instructs"

# ── Live session ───────────────────────────────────────────────────
TOOL="mcp__plugin_intelli-search_intelli_search__intelli_research"
SERVER="plugin:intelli-search:intelli_search"
PROMPT="Call the tool $TOOL with query \"the current TypeScript release\", maxUrls 1, domains [\"typescriptlang.org\"] and focusPrompt \"the official release announcement, version number and release date\". Then answer with the version and the source URL."

echo
echo "── claude -p (model: $E2E_CLAUDE_MODEL)"
STREAM="$E2E_ROOT/stream.jsonl"
RAN=0
for ATTEMPT in 1 2; do
  (cd "$WORKSPACE" && timeout --foreground "${E2E_TIMEOUT_SECONDS}s" claude -p "$PROMPT" \
      --model "$E2E_CLAUDE_MODEL" \
      --output-format stream-json --verbose \
      --no-session-persistence \
      --allowedTools "$TOOL" \
      > "$STREAM" 2> "$E2E_ROOT/stderr.txt") || true
  if jq -e 'select(.type == "result")' "$STREAM" >/dev/null 2>&1; then
    RAN=1
    break
  fi
  echo "   ⚠️  attempt ${ATTEMPT}/2 produced no result event; retrying after 30s"
  sleep 30
done
if [[ "$RAN" -ne 1 ]]; then
  echo "❌ claude -p produced no result event"
  tail -20 "$E2E_ROOT/stderr.txt" || true
  exit 1
fi

# ── Verification ───────────────────────────────────────────────────
echo
echo "── Verification"
INIT="$(jq -c 'select(.type == "system" and .subtype == "init")' "$STREAM" | head -n 1)"
if jq -e --arg s "$SERVER" '.mcp_servers[] | select(.name == $s and .status == "connected")' <<<"$INIT" >/dev/null 2>&1; then
  ok "session init reports $SERVER connected"
else
  bad "session init does not report $SERVER connected"
  jq -c '{mcp_servers, plugins, plugin_errors, mcp_server_errors}' <<<"$INIT" 2>/dev/null || true
fi
if jq -e --arg t "$TOOL" '.tools | index($t)' <<<"$INIT" >/dev/null 2>&1; then
  ok "session exposes $TOOL"
else
  bad "session does not expose $TOOL"
fi

TOOL_USE_ID="$(jq -r --arg t "$TOOL" 'select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == $t) | .id' "$STREAM" | head -n 1)"
if [[ -n "$TOOL_USE_ID" ]]; then
  ok "model called $TOOL"
  if jq -e --arg id "$TOOL_USE_ID" 'select(.type == "user") | .message.content[]? | select(.type == "tool_result" and .tool_use_id == $id and (.is_error | not))' "$STREAM" >/dev/null 2>&1; then
    ok "tool result returned without error"
  else
    bad "tool result is an error or missing"
    jq -c --arg id "$TOOL_USE_ID" 'select(.type == "user") | .message.content[]? | select(.tool_use_id == $id)' "$STREAM" | cut -c1-400
  fi
else
  bad "model did not call $TOOL"
fi

CACHE_DIR="$(find "$WORKSPACE/.search" -maxdepth 1 -mindepth 1 -type d -name '20*' 2>/dev/null | head -n 1 || true)"
if [ -n "$CACHE_DIR" ] && [ -f "$CACHE_DIR/report.md" ] && [ -f "$CACHE_DIR/meta.json" ]; then
  ok "cache written in the project directory: ${CACHE_DIR#"$E2E_ROOT"/}"
else
  bad "missing cache artifacts under the project's .search/"
fi
if [ -n "$CACHE_DIR" ] && jq -e '.adapter == "mcp" and .outcome == "completed"' "$CACHE_DIR/meta.json" >/dev/null 2>&1; then
  ok "telemetry records the mcp adapter and a completed outcome"
else
  bad "telemetry lacks the mcp adapter or a completed outcome"
fi
if jq -e 'select(.type == "result") | select(.is_error | not)' "$STREAM" >/dev/null 2>&1; then
  ok "session ended without error"
else
  bad "session ended with an error"
fi

# ── Credential hygiene ─────────────────────────────────────────────
if jq -e 'has("claudeAiOauth")' "$CLAUDE_HOME_DIR/.credentials.json" >/dev/null 2>&1; then
  bad "isolated profile received a login credential"
else
  ok "isolated profile holds no login credential (token was never stored)"
fi
if [[ "$(stat -c %Y "$OPERATOR_CREDENTIALS" 2>/dev/null || echo absent)" == "$OPERATOR_MTIME" ]]; then
  ok "operator credential file untouched"
else
  bad "operator credential file changed during the run"
fi

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "🎉 CLAUDE CODE PLUGIN SESSION PASSED"
else
  echo "❌ CLAUDE CODE PLUGIN SESSION FAILED ($ERRORS check(s))"
  exit 1
fi
