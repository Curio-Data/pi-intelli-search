#!/usr/bin/env bash
#
# test/e2e/14_codex_plugin.sh — credentialed Codex plugin run
#
# Installs the generated Codex plugin (local-tarball class) into a dedicated
# test profile and drives one real research call through `codex exec`.
# Scenario 12 proves installation and skill discovery credential-free; this
# scenario proves the installed plugin works in a real Codex session.
#
# Usage:
#   ./test/e2e/14_codex_plugin.sh
#
# One-time setup (operator): create the dedicated test login.
#   CODEX_HOME="$PWD/.e2e-auth/codex" codex login --device-auth
#
# Environment:
#   OPENROUTER_API_KEY   Required (auto-detected from ~/.pi/agent/auth.json).
#   E2E_CODEX_HOME       Dedicated profile (default: .e2e-auth/codex, gitignored).
#   E2E_TIMEOUT_SECONDS  Per-attempt timeout (default: 600).
#
# Credential safety. Codex has no long-lived refresh-free token for personal
# ChatGPT plans, so the scenario follows OpenAI's documented CI pattern: one
# dedicated login whose auth.json is used by exactly one consumer at a time
# and refreshed in place. It is a separate login, not a copy of ~/.codex, so
# it shares no refresh-token chain with the operator's own sessions (the
# Phase 5 incident). The script never reads or copies ~/.codex; it holds an
# exclusive lock on the profile and asserts ~/.codex/auth.json is untouched.
#
# Each run resets every entry of the profile except auth.json: Codex caches
# plugin installs by version, so a reused profile would run a stale bundle.
#
# Live quota is consumed: one maxUrls=1 research on OpenRouter and one short
# session on the ChatGPT plan. Run through ./test/run-e2e-all.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# The profile guards and hygiene checks rely on GNU stat, flock and the
# Linux layout; elsewhere they would pass vacuously.
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "⚠️  SKIP: scenario 14 is recorded for Linux hosts only."
  exit 0
fi

# Parse .env BEFORE any output reaches the log, reading only the key this
# scenario needs: other credentials kept there never reach the Codex agent.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY
unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-codex-plugin-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Two attempts plus build and pacing must fit the paced runner's per-script
# timeout (E2E_SCRIPT_TIMEOUT_SECONDS, default 1200).
E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-540}"
E2E_CODEX_HOME="${E2E_CODEX_HOME:-$PROJECT_DIR/.e2e-auth/codex}"

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
  [ -n "$OPENROUTER_API_KEY" ] && echo "🔑 Detected OPENROUTER_API_KEY from ~/.pi/agent/auth.json"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set."
  exit 1
fi
for tool in codex node npm jq rg flock; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool"
    exit 1
  fi
done

# The dedicated profile must exist, hold a login, resolve (symlinks
# included) to a directory inside this repository, and never be the
# operator's own profile: each run deletes everything in it but auth.json.
E2E_CODEX_HOME="$(cd "$E2E_CODEX_HOME" 2>/dev/null && pwd -P || true)"
if [[ -z "$E2E_CODEX_HOME" || ! -f "$E2E_CODEX_HOME/auth.json" ]]; then
  echo "❌ No dedicated Codex test login found."
  echo "   Create it once: CODEX_HOME=\"$PROJECT_DIR/.e2e-auth/codex\" codex login --device-auth"
  exit 1
fi
if [[ "$E2E_CODEX_HOME" == "$(cd "$HOME/.codex" 2>/dev/null && pwd -P || echo none)" ]]; then
  echo "❌ E2E_CODEX_HOME resolves to the operator's own ~/.codex; refusing."
  exit 1
fi
if [[ "$E2E_CODEX_HOME" != "$(cd "$PROJECT_DIR" && pwd -P)/"* ]]; then
  echo "❌ E2E_CODEX_HOME must resolve inside $PROJECT_DIR; refusing to reset $E2E_CODEX_HOME."
  exit 1
fi
chmod 700 "$E2E_CODEX_HOME"

# One consumer at a time: concurrent use of one auth.json is unsupported.
exec 9> "$E2E_CODEX_HOME/.e2e.lock"
if ! flock -n 9; then
  echo "❌ Another run holds the dedicated Codex profile."
  exit 1
fi

export CODEX_HOME="$E2E_CODEX_HOME"
OPERATOR_AUTH="$HOME/.codex/auth.json"
OPERATOR_MTIME="$(stat -c %Y "$OPERATOR_AUTH" 2>/dev/null || echo absent)"

mkdir -p "$PROJECT_DIR/.tmp"
E2E_ROOT="$(mktemp -d "$PROJECT_DIR/.tmp/intelli-codex-e2e-XXXXXXXX")"
WORKSPACE="$E2E_ROOT/workspace"
mkdir -p "$WORKSPACE"
echo "📁 Scratch: $E2E_ROOT"
echo "🔐 Profile: $CODEX_HOME"

cleanup() {
  local rc=$?
  if [[ "$rc" -eq 0 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT

ERRORS=0
ok()  { echo "✅ $1"; }
bad() { ERRORS=$((ERRORS + 1)); echo "❌ $1"; }

# ── Reset the profile, keeping only the login ──────────────────────
find "$CODEX_HOME" -mindepth 1 -maxdepth 1 ! -name auth.json ! -name .e2e.lock -exec rm -rf {} +
ok "profile reset (auth.json kept)"

echo
echo "── Pre-flight: codex-cli $(codex --version 2>/dev/null | awk '{print $2}')"
if codex login status >/dev/null 2>&1; then
  ok "dedicated profile is logged in"
else
  echo "❌ dedicated profile is not logged in; rerun the one-time login"
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
npm install --prefix "$WORK/plugins/codex/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
codex plugin marketplace add "$WORK" >/dev/null 2>&1
ADD_OUT="$(codex plugin add intelli-search --marketplace curio-data-plugins --json 2>/dev/null || true)"
if printf '%s\n' "$ADD_OUT" | awk '/^\{/,0' | jq -e '.pluginId == "intelli-search@curio-data-plugins"' >/dev/null 2>&1; then
  ok "plugin installed from $(basename "$TARBALL")"
else
  echo "❌ plugin add failed"
  echo "$ADD_OUT"
  exit 1
fi

# Codex forwards only the env_vars the plugin names, as the skill instructs.
CONFIG_JSON="$E2E_ROOT/config.json"
cat > "$CONFIG_JSON" <<'EOF'
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
# Unattended runs must pre-approve the plugin's tools: in `codex exec`, a
# tool that would prompt is cancelled ("user cancelled MCP tool call").
cat >> "$CODEX_HOME/config.toml" <<'EOF'

[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
EOF
ok "plugin tools pre-approved for unattended exec"

export OPENROUTER_API_KEY
export INTELLI_SEARCH_CONFIG="$CONFIG_JSON"
export INTELLI_SEARCH_WORKSPACE="$WORKSPACE"
ok "forwarded variables exported as the skill instructs"

# ── Live session ───────────────────────────────────────────────────
TOOL="mcp__intelli_search__intelli_research"
PROMPT="Call the tool $TOOL with query \"the current TypeScript release\", maxUrls 1, domains [\"typescriptlang.org\"] and focusPrompt \"the official release announcement, version number and release date\". Then answer with the version and the source URL."

echo
echo "── codex exec"
EVENTS="$E2E_ROOT/events.jsonl"
RAN=0
# completed_sidecar: true once this run has a completed research, so a retry
# never spends a second live research after the first one finished.
completed_sidecar() {
  find "$WORKSPACE/.search" -maxdepth 2 -name meta.json \
    -exec jq -c 'select(.outcome == "completed")' {} + 2>/dev/null | rg -q .
}
for ATTEMPT in 1 2; do
  (cd "$WORKSPACE" && timeout --foreground "${E2E_TIMEOUT_SECONDS}s" codex exec \
      --json --ephemeral --skip-git-repo-check --strict-config \
      --sandbox read-only \
      -c approval_policy='"never"' \
      "$PROMPT" < /dev/null > "$EVENTS" 2> "$E2E_ROOT/stderr.txt") || true
  if jq -e 'select(.type == "turn.completed")' "$EVENTS" >/dev/null 2>&1; then
    RAN=1
    break
  fi
  if completed_sidecar || [[ "$ATTEMPT" -eq 2 ]]; then break; fi
  echo "   ⚠️  attempt ${ATTEMPT}/2 did not complete a turn; retrying after 30s"
  sleep 30
done
if [[ "$RAN" -ne 1 ]]; then
  echo "❌ codex exec did not complete a turn"
  jq -c 'select(.type == "turn.failed" or .type == "error")' "$EVENTS" 2>/dev/null | tail -5 || true
  tail -20 "$E2E_ROOT/stderr.txt" || true
  exit 1
fi

# ── Verification ───────────────────────────────────────────────────
echo
echo "── Verification"
CALL="$(jq -c 'select(.type == "item.completed" and .item.type == "mcp_tool_call" and .item.server == "intelli_search" and .item.tool == "intelli_research") | .item' "$EVENTS" | head -n 1)"
if [[ -z "$CALL" ]]; then
  bad "no completed intelli_research mcp_tool_call in the event stream"
elif jq -e '.status == "completed" and .error == null' <<<"$CALL" >/dev/null; then
  ok "model called intelli_research and the call completed"
else
  bad "intelli_research call failed: $(jq -c '{status, error}' <<<"$CALL")"
fi

CACHE_DIR="$(find "$WORKSPACE/.search" -maxdepth 1 -mindepth 1 -type d -name '20*' 2>/dev/null | head -n 1 || true)"
if [ -n "$CACHE_DIR" ] && [ -f "$CACHE_DIR/report.md" ] && [ -f "$CACHE_DIR/meta.json" ]; then
  ok "cache written in the forwarded workspace: ${CACHE_DIR#"$E2E_ROOT"/}"
else
  bad "missing cache artifacts under the workspace's .search/"
fi
if [ -n "$CACHE_DIR" ] && [ -f "$CACHE_DIR/meta.json" ]; then
  if jq -e '.adapter == "mcp" and .outcome == "completed"' "$CACHE_DIR/meta.json" >/dev/null 2>&1; then
    ok "telemetry records the mcp adapter and a completed outcome"
  else
    bad "telemetry lacks the mcp adapter or a completed outcome"
  fi
fi

# ── Credential hygiene ─────────────────────────────────────────────
if [[ "$(stat -c %Y "$OPERATOR_AUTH" 2>/dev/null || echo absent)" == "$OPERATOR_MTIME" ]]; then
  ok "operator ~/.codex/auth.json untouched"
else
  bad "operator ~/.codex/auth.json changed during the run"
fi

echo
if [[ "$ERRORS" -eq 0 ]]; then
  echo "🎉 CODEX PLUGIN SESSION PASSED"
else
  echo "❌ CODEX PLUGIN SESSION FAILED ($ERRORS check(s))"
  exit 1
fi
