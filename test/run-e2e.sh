#!/usr/bin/env bash
#
# test/run-e2e.sh — End-to-end test for pi-intelli-search
#
# Runs the extension inside an isolated pi agent environment to verify
# the install experience works in a fresh session with real LLM calls.
#
# Usage:
#   ./test/run-e2e.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai
#   TEST_MODEL           Override model (default: openrouter/minimax/minimax-m2.5)
#   MINIMAX_API_KEY      Optional. If set, also available to the isolated agent.
#
# The .env file (gitignored) can hold OPENROUTER_API_KEY for convenience.
#
# How it works:
#   PI_CODING_AGENT_DIR points pi at a fresh temp directory with only a
#   vanilla auth.json and empty models.json. The extension injects
#   perplexity/sonar models via ensureCustomModels() on session_start,
#   exactly like a real install.
#
# Your real ~/.pi/agent/ config is never read, modified, or polluted.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if it exists (gitignored)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# Use a cheap model by default. Override with TEST_MODEL if desired.
TEST_MODEL="${TEST_MODEL:-openrouter/minimax/minimax-m2.5}"

# ── Check prerequisites ────────────────────────────────────────────
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set."
  echo ""
  echo "  Get a key from https://openrouter.ai and either:"
  echo "  - export OPENROUTER_API_KEY=sk-or-v1-..."
  echo "  - Add it to .env (see .env.example)"
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

# ── Create isolated agent directory ────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-agent-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"

mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# ── auth.json — providers needed by the extension
# OpenRouter: required for intelli_search (perplexity/sonar)
# MiniMax: required for the default model (minimax/MiniMax-M2.5)
# No real ~/.pi/agent/ credentials are ever read or modified.
if [ -n "${MINIMAX_API_KEY:-}" ]; then
  cat > "$ISOLATED_AGENT_DIR/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"},"minimax":{"type":"api_key","key":"$MINIMAX_API_KEY"}}
EOF
else
  cat > "$ISOLATED_AGENT_DIR/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF
  echo "⚠️  MINIMAX_API_KEY not set — skipping MiniMax model"
fi

# ── settings.json — default model + intelli config ─────────────────
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultModel": "$TEST_MODEL",
  "intelliSearchModel": {
    "provider": "openrouter",
    "model": "perplexity/sonar"
  }
}
EOF

# ── models.json — vanilla/empty ────────────────────────────────────
# The extension's ensureCustomModels() will inject perplexity/sonar
# models on session_start, exactly like a real installation.
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "🔐 Wrote isolated auth.json (openrouter only)"
echo "📄 Wrote vanilla models.json (extension will add perplexity models)"
echo "⚙️  Test model: $TEST_MODEL"

# ── Extension path ─────────────────────────────────────────────────
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"
echo ""

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (isolated env)              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# --no-builtin-tools so only intelli_search is available, forcing
# the model to call it instead of answering from training data.
PROMPT="What happened in the news today? Use intelli_search to look it up."

OUTPUT="$(
  PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      --no-builtin-tools \
      -e "$E2E_EXTENSION_PATH" \
      -p "$PROMPT" \
      2>&1
)" || {
  echo ""
  echo "❌ pi exited with an error"
  echo ""
  echo "--- pi output ---"
  echo "$OUTPUT"
  echo "-----------------"
  exit 1
}

# ── Verify output ──────────────────────────────────────────────────
echo "$OUTPUT"

echo ""
echo "── Verification ──────────────────────────────────────────────────────"

ERRORS=0

if echo "$OUTPUT" | grep -qi "intelli_search"; then
  echo "✅ intelli_search tool was invoked"
else
  echo "❌ intelli_search tool was NOT found in output"
  ERRORS=$((ERRORS + 1))
fi

if echo "$OUTPUT" | grep -q "Search results"; then
  echo "✅ Search results were returned"
else
  echo "❌ No search results in output"
  ERRORS=$((ERRORS + 1))
fi

if echo "$OUTPUT" | grep -q "Sources"; then
  echo "✅ Source URLs were extracted"
else
  echo "⚠️  No source URLs found (may be expected for some queries)"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E test passed — full pipeline works in isolated session"
