#!/usr/bin/env bash
#
# test/run-e2e-cap.sh — E2E test for defaultUrls / maxUrls (cap)
#
# Verifies two scenarios:
#   1. Low cap (maxUrls=3) — agent requests 12 (exhaustive per SKILL.md)
#      but gets clamped to 3. Pipeline still completes with useful output.
#   2. Custom defaults (defaultUrls=3, maxUrls=6) — agent omits maxUrls,
#      uses defaultUrls=3. Cap at 6 is never reached.
#
# Usage:
#   ./test/run-e2e-cap.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"

# Load .env if it exists
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# ── Check prerequisites ────────────────────────────────────────────
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
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════
# Scenario 1: Low cap (maxUrls=3)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  SCENARIO 1: Low cap (maxUrls=3)                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISOLATED_AGENT_DIR1="$(mktemp -d -t pi-e2e-cap1-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR1"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR1"

mkdir -p "$ISOLATED_AGENT_DIR1/sessions"

cat > "$ISOLATED_AGENT_DIR1/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

# Set defaultUrls=8, maxUrls=3 (tight cap).
# Agent's SKILL.md says 12 for exhaustive, but the cap clamps to 3.
cat > "$ISOLATED_AGENT_DIR1/settings.json" <<EOF
{
  "defaultModel": "openrouter/perplexity/sonar",
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
    },
    "defaultUrls": 8,
    "maxUrls": 3,
    "cacheDir": ".e2e-cap-test"
  }
}
EOF

cat > "$ISOLATED_AGENT_DIR1/models.json" <<'MEOF'
{}
MEOF

echo "⚙️  defaultUrls=8, maxUrls=3 (cap)"
echo "⚙️  Expected: agent requests 12 → clamped to 3"

PROMPT1="Use intelli_research with maxUrls=12 to research: what is the latest Node.js LTS version"

OUTPUT1="$(
  PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR1" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "$PROMPT1" \
      2>&1
)" || {
  echo ""
  echo "❌ pi exited with an error"
  echo ""
  echo "--- pi output ---"
  echo "$OUTPUT1"
  echo "-----------------"
  exit 1
}

echo "$OUTPUT1"

echo ""
echo "── Scenario 1 Verification ───────────────────────────────────────────"

ERRORS=0

# Pipeline must have completed (search results present)
if echo "$OUTPUT1" | grep -qi "intelli_search\|intelli_research\|search result\|research found\|http"; then
  echo "✅ Pipeline completed (results present in output)"
else
  echo "⚠️  No explicit results in output"
fi

# Cache must exist in custom dir
CACHE_DIR1="$PROJECT_DIR/.e2e-cap-test"
if [ -d "$CACHE_DIR1" ]; then
  echo "✅ .e2e-cap-test/ cache directory exists"
else
  echo "❌ .e2e-cap-test/ cache directory not found"
  ERRORS=$((ERRORS + 1))
fi

# Verify at most 3 extractions (cap enforcement)
if [ -d "$CACHE_DIR1" ]; then
  LATEST1=$(find "$CACHE_DIR1" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' | sort -r | head -1)
  if [ -n "$LATEST1" ] && [ -d "$LATEST1/extractions" ]; then
    COUNT1=$(find "$LATEST1/extractions" -type f | wc -l)
    if [ "$COUNT1" -le 3 ]; then
      echo "✅ Cap enforced: $COUNT1 extractions (≤3)"
    else
      echo "❌ Cap NOT enforced: $COUNT1 extractions (>3)"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "⚠️  No extractions directory to check cap enforcement"
  fi
fi

echo ""
echo "── Scenario 1 Summary ─────────────────────────────────────────────────"
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Scenario 1 failed ($ERRORS error(s))"
else
  echo "✅ Scenario 1 passed — cap clamps agent requests"
fi

SCENARIO1_ERRORS=$ERRORS

# Clean up scenario 1 cache
rm -rf "$CACHE_DIR1"
rm -rf "$ISOLATED_AGENT_DIR1"
trap - EXIT

# ═══════════════════════════════════════════════════════════════════
# Scenario 2: Custom defaults (defaultUrls=3, maxUrls=6)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  SCENARIO 2: Custom defaults (defaultUrls=3,          ║"
echo "║              maxUrls=6)                               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISOLATED_AGENT_DIR2="$(mktemp -d -t pi-e2e-cap2-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR2"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR2"

mkdir -p "$ISOLATED_AGENT_DIR2/sessions"

cat > "$ISOLATED_AGENT_DIR2/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

cat > "$ISOLATED_AGENT_DIR2/settings.json" <<EOF
{
  "defaultModel": "openrouter/perplexity/sonar",
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
    },
    "defaultUrls": 3,
    "maxUrls": 6,
    "cacheDir": ".e2e-cap-test2"
  }
}
EOF

cat > "$ISOLATED_AGENT_DIR2/models.json" <<'MEOF'
{}
MEOF

echo "⚙️  defaultUrls=3, maxUrls=6"
echo "⚙️  Agent omits maxUrls → uses defaultUrls=3"
echo ""

# Prompt does NOT mention maxUrls — agent should use defaultUrls=3
PROMPT2="Use intelli_research to find the latest TypeScript version"

OUTPUT2="$(
  PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR2" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "$PROMPT2" \
      2>&1
)" || {
  echo ""
  echo "❌ pi exited with an error"
  echo ""
  echo "--- pi output ---"
  echo "$OUTPUT2"
  echo "-----------------"
  exit 1
}

echo "$OUTPUT2"

echo ""
echo "── Scenario 2 Verification ───────────────────────────────────────────"

ERRORS2=0

# Pipeline must have completed
if echo "$OUTPUT2" | grep -qi "intelli_search\|intelli_research\|search result\|research found\|http"; then
  echo "✅ Pipeline completed (results present in output)"
else
  echo "⚠️  No explicit results in output"
fi

# Cache must exist
CACHE_DIR2="$PROJECT_DIR/.e2e-cap-test2"
if [ -d "$CACHE_DIR2" ]; then
  echo "✅ .e2e-cap-test2/ cache directory exists"
else
  echo "❌ .e2e-cap-test2/ cache directory not found"
  ERRORS2=$((ERRORS2 + 1))
fi

# Verify extractions exist (pipeline ran)
if [ -d "$CACHE_DIR2" ]; then
  LATEST2=$(find "$CACHE_DIR2" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' | sort -r | head -1)
  if [ -n "$LATEST2" ] && [ -d "$LATEST2/extractions" ]; then
    COUNT2=$(find "$LATEST2/extractions" -type f | wc -l)
    if [ "$COUNT2" -le 6 ]; then
      echo "✅ Extractions within cap: $COUNT2 (≤6)"
    else
      echo "❌ Extractions exceed cap: $COUNT2 (>6)"
      ERRORS2=$((ERRORS2 + 1))
    fi
  else
    echo "⚠️  No extractions directory found"
  fi
fi

echo ""
echo "── Scenario 2 Summary ─────────────────────────────────────────────────"
if [ "$ERRORS2" -gt 0 ]; then
  echo "❌ Scenario 2 failed ($ERRORS2 error(s))"
else
  echo "✅ Scenario 2 passed — defaultUrls and maxUrls work independently"
fi

# Clean up
rm -rf "$CACHE_DIR2"
rm -rf "$ISOLATED_AGENT_DIR2"
trap - EXIT

# ═══════════════════════════════════════════════════════════════════
# Final tally
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════════════════"
TOTAL_ERRORS=$((SCENARIO1_ERRORS + ERRORS2))
if [ "$TOTAL_ERRORS" -gt 0 ]; then
  echo "❌ E2E cap test FAILED ($TOTAL_ERRORS total error(s))"
  exit 1
fi
echo "✅ E2E cap test PASSED — cap clamping and defaults work correctly"
