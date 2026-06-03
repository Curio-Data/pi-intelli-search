#!/usr/bin/env bash
#
# test/run-e2e.sh — End-to-end test for pi-intelli-search
#
# Runs the extension inside an isolated pi agent environment to verify
# the install experience works in a fresh session with real LLM calls.
#
# This test uses the default models: Sonar for search, MiniMax M2.7
# via OpenRouter for extract and collate. All three stages route through
# OpenRouter, requiring only a single API key.
#
# Usage:
#   ./test/run-e2e.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai
#   TEST_MODEL           Override default model (default: openrouter/minimax/minimax-m2.7)
#
# The .env file (gitignored) can hold OPENROUTER_API_KEY for convenience.
#
# How it works:
#   PI_CODING_AGENT_DIR points pi at a fresh temp directory. The extension
#   respects this for both auth (via pi's native config loading) and
#   settings (getAgentDir() checks the env var). models.json is vanilla;
#   the extension injects perplexity/sonar models on session_start.
#
# Your real ~/.pi/agent/ config is never read, modified, or polluted
# (except auth.json which is read only to auto-detect OPENROUTER_API_KEY).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-main-${TIMESTAMP}.log"
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

# Use a cheap model by default. Override with TEST_MODEL if desired.
TEST_MODEL="${TEST_MODEL:-openrouter/minimax/minimax-m2.7}"

# ── Check prerequisites ────────────────────────────────────────────
# Auto-detect OPENROUTER_API_KEY from ~/.pi/agent/auth.json if not
# already in the environment. This lets the test run with zero manual
# setup when the user has already configured pi.
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
  echo ""
  echo "  Get a key from https://openrouter.ai and either:"
  echo "  - export OPENROUTER_API_KEY=sk-or-v1-..."
  echo "  - Add it to .env (see .env.example)"
  echo "  - Ensure ~/.pi/agent/auth.json has an openrouter key"
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

# ── auth.json — minimal isolated file
# Only OpenRouter is needed. All three pipeline stages route through
# OpenRouter, so a single API key covers everything.
cat > "$ISOLATED_AGENT_DIR/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

# ── settings.json — default model + intelli config (nested namespace) ─
# Uses nested pi-intelli-search namespace with bare keys.
# All three model roles route through OpenRouter.
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultModel": "$TEST_MODEL",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    }
  }
}
EOF

# ── models.json — vanilla/empty ────────────────────────────────────
# The extension's ensureCustomModels() will inject perplexity/sonar
# models on session_start, exactly like a real installation.
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "📄 Wrote vanilla models.json (extension will add perplexity models)"
echo "⚙️  Test model: $TEST_MODEL"
echo "⚙️  Extract/Collate: openrouter/minimax/minimax-m2.7 (default)"
echo ""

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (isolated env)              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT="Use intelli_research to research: latest TypeScript version"

OUTPUT="$(
  PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
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

if echo "$OUTPUT" | grep -qi "intelli_search\|intelli_research\|search result\|cached .*search\|research found\|Full cache\|search/.*report"; then
  echo "✅ intelli_research was invoked (search results present in output)"
else
  echo "⚠️  No explicit intelli_research mention in output (cache artifacts will confirm pipeline)"
fi

if echo "$OUTPUT" | grep -qi "Sources\|sources\|http"; then
  echo "✅ Source URLs / references found"
else
  echo "⚠️  No source references found (may be expected for some queries)"
fi

# ── Verify .search cache artifacts ──────────────────────────────────
# intelli_research writes .search/<date>-<slug>/ with report.md,
# query.txt, extractions/, sources/, and updates .search/.index.json.
CACHE_DIR="$PROJECT_DIR/.search"

if [ -d "$CACHE_DIR" ]; then
  echo "✅ .search/ cache directory exists"
else
  echo "❌ .search/ cache directory not found at $CACHE_DIR"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$CACHE_DIR/.index.json" ]; then
  echo "✅ .search/.index.json exists"
  INDEX_ENTRIES=$(jq 'if .entries then (.entries | length) else 0 end' "$CACHE_DIR/.index.json" 2>/dev/null || echo "0")
  if [ "$INDEX_ENTRIES" -gt 0 ]; then
    echo "   📂 $INDEX_ENTRIES cache entry/entries recorded"
  fi
else
  echo "❌ .search/.index.json not found"
  ERRORS=$((ERRORS + 1))
fi

# Find the latest cache subdirectory
LATEST_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d -not -name '.search' | sort -r | head -1)
if [ -n "$LATEST_CACHE" ]; then
  echo "✅ Cache entry directory: $(basename "$LATEST_CACHE")"

  if [ -f "$LATEST_CACHE/report.md" ]; then
    echo "✅ report.md exists ($(wc -c < "$LATEST_CACHE/report.md") bytes)"
  else
    echo "❌ report.md not found in cache entry"
    ERRORS=$((ERRORS + 1))
  fi

  if [ -f "$LATEST_CACHE/query.txt" ]; then
    echo "✅ query.txt exists"
  else
    echo "❌ query.txt not found in cache entry"
    ERRORS=$((ERRORS + 1))
  fi

  if [ -d "$LATEST_CACHE/extractions" ]; then
    EXTRACTION_COUNT=$(find "$LATEST_CACHE/extractions" -type f | wc -l)
    echo "✅ extractions/ exists ($EXTRACTION_COUNT file(s))"
  else
    echo "⚠️  extractions/ not found (may be empty for some queries)"
  fi

  if [ -d "$LATEST_CACHE/sources" ]; then
    SOURCE_COUNT=$(find "$LATEST_CACHE/sources" -type f | wc -l)
    echo "✅ sources/ exists ($SOURCE_COUNT file(s))"
  else
    echo "⚠️  sources/ not found (may be empty for some queries)"
  fi
else
  echo "❌ No cache entry subdirectory found under .search/"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E test passed — full pipeline works in isolated session"
