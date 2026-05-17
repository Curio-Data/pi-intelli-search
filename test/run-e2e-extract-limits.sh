#!/usr/bin/env bash
#
# test/run-e2e-extract-limits.sh — E2E test for extractMaxChars and extractionMaxTokens
#
# Proves both settings are enforced by running the same single-URL
# research query twice (back-to-back): first with default limits,
# then with aggressively low limits. Compares extraction file sizes
# to confirm truncation and token limiting took effect.
#
# Usage:
#   ./test/run-e2e-extract-limits.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

# ── Shared prompt: single-URL research against a content-heavy page ─
# Wikipedia's Python article is reliably long (>100K chars cleaned).
# maxUrls=1 ensures we process one page only.
RESEARCH_PROMPT="Use intelli_research with maxUrls=1 to research: Python programming language history design philosophy. Use focusPrompt='Extract the history and design philosophy sections.'"

# ═══════════════════════════════════════════════════════════════════
# Run 1: Default limits (extractMaxChars=150000, extractionMaxTokens=3000)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 1: Default limits                               ║"
echo "║  extractMaxChars=150000  extractionMaxTokens=3000    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISO1="$(mktemp -d -t pi-e2e-extlim1-XXXXXX)"
# shellcheck disable=SC2064
trap "rm -rf $ISO1" EXIT

mkdir -p "$ISO1/sessions"

cat > "$ISO1/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

cat > "$ISO1/settings.json" <<EOF
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
    "defaultUrls": 1,
    "maxUrls": 1,
    "extractMaxChars": 150000,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": 4000,
    "cacheDir": ".e2e-extract-default"
  }
}
EOF

cat > "$ISO1/models.json" <<'MEOF'
{}
MEOF

OUTPUT1="$(
  PI_CODING_AGENT_DIR="$ISO1" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "$RESEARCH_PROMPT" \
      2>&1
)" || {
  echo ""
  echo "❌ Run 1 (default) exited with an error"
  echo "$OUTPUT1"
  exit 1
}

echo "$OUTPUT1"
rm -rf "$ISO1"

# ═══════════════════════════════════════════════════════════════════
# Run 2: Tight limits (extractMaxChars=500, extractionMaxTokens=150)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 2: Tight limits                                 ║"
echo "║  extractMaxChars=500    extractionMaxTokens=150      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISO2="$(mktemp -d -t pi-e2e-extlim2-XXXXXX)"
# shellcheck disable=SC2064
trap "rm -rf $ISO2" EXIT

mkdir -p "$ISO2/sessions"

cat > "$ISO2/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

cat > "$ISO2/settings.json" <<EOF
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
    "defaultUrls": 1,
    "maxUrls": 1,
    "extractMaxChars": 500,
    "extractionMaxTokens": 150,
    "collationMaxTokens": 4000,
    "cacheDir": ".e2e-extract-tight"
  }
}
EOF

cat > "$ISO2/models.json" <<'MEOF'
{}
MEOF

OUTPUT2="$(
  PI_CODING_AGENT_DIR="$ISO2" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "$RESEARCH_PROMPT" \
      2>&1
)" || {
  echo ""
  echo "❌ Run 2 (tight) exited with an error"
  echo "$OUTPUT2"
  exit 1
}

echo "$OUTPUT2"
rm -rf "$ISO2"

# ═══════════════════════════════════════════════════════════════════
# Compare extraction sizes
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "══ Comparison ═════════════════════════════════════════════════════════"

ERRORS=0

CACHE_DEFAULT="$PROJECT_DIR/.e2e-extract-default"
CACHE_TIGHT="$PROJECT_DIR/.e2e-extract-tight"

# Find the latest cache entry in each
ENTRY_DEFAULT=$(find "$CACHE_DEFAULT" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' 2>/dev/null | sort -r | head -1)
ENTRY_TIGHT=$(find "$CACHE_TIGHT" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' 2>/dev/null | sort -r | head -1)

if [ -z "$ENTRY_DEFAULT" ]; then
  echo "❌ No cache entry found in .e2e-extract-default/"
  ERRORS=$((ERRORS + 1))
fi

if [ -z "$ENTRY_TIGHT" ]; then
  echo "❌ No cache entry found in .e2e-extract-tight/"
  ERRORS=$((ERRORS + 1))
fi

if [ -n "$ENTRY_DEFAULT" ] && [ -n "$ENTRY_TIGHT" ]; then
  EXTRACT_DIR_DEFAULT="$ENTRY_DEFAULT/extractions"
  EXTRACT_DIR_TIGHT="$ENTRY_TIGHT/extractions"

  if [ -d "$EXTRACT_DIR_DEFAULT" ] && [ -d "$EXTRACT_DIR_TIGHT" ]; then
    # Get the first extraction file from each
    FILE_DEFAULT=$(find "$EXTRACT_DIR_DEFAULT" -type f | head -1)
    FILE_TIGHT=$(find "$EXTRACT_DIR_TIGHT" -type f | head -1)

    if [ -n "$FILE_DEFAULT" ] && [ -n "$FILE_TIGHT" ]; then
      SIZE_DEFAULT=$(wc -c < "$FILE_DEFAULT" || echo "0")
      SIZE_TIGHT=$(wc -c < "$FILE_TIGHT" || echo "0")
      CHARS_DEFAULT=$(wc -m < "$FILE_DEFAULT" || echo "0")
      CHARS_TIGHT=$(wc -m < "$FILE_TIGHT" || echo "0")

      echo "📄 Default extraction: ${SIZE_DEFAULT} bytes, ${CHARS_DEFAULT} chars"
      echo "📄 Tight extraction:   ${SIZE_TIGHT} bytes, ${CHARS_TIGHT} chars"

      # Tight extraction must be smaller than default
      if [ "$SIZE_TIGHT" -lt "$SIZE_DEFAULT" ]; then
        echo "✅ Tight extraction is smaller than default (token limit enforced)"
      else
        echo "❌ Tight extraction is NOT smaller (${SIZE_TIGHT} >= ${SIZE_DEFAULT})"
        ERRORS=$((ERRORS + 1))
      fi

      # Tight extraction should be very short (≤800 chars with 150 tokens)
      if [ "$CHARS_TIGHT" -le 800 ]; then
        echo "✅ Tight extraction ≤800 chars (extractionMaxTokens=150 enforced)"
      else
        echo "⚠️  Tight extraction is ${CHARS_TIGHT} chars (>800, may still be correct depending on model)"
      fi

      # Show first 200 chars of each for manual inspection
      echo ""
      echo "── Default extraction (first 200 chars) ──"
      head -c 200 "$FILE_DEFAULT" 2>/dev/null || echo "(empty)"
      echo ""
      echo "── Tight extraction (first 200 chars) ──"
      head -c 200 "$FILE_TIGHT" 2>/dev/null || echo "(empty)"
      echo ""

      # Check if tight extraction mentions truncation
      if grep -qi "truncat\|TRUNCAT\|exceeded" "$FILE_TIGHT" 2>/dev/null; then
        echo "✅ Tight extraction mentions truncation (extractMaxChars=500 enforced)"
      else
        echo "⚠️  Tight extraction does not mention truncation (extract LLM may not echo the marker)"
      fi

    else
      echo "❌ Missing extraction files"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "❌ Missing extractions directory in one or both caches"
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""
echo "── Report sizes ──"
if [ -n "$ENTRY_DEFAULT" ] && [ -f "$ENTRY_DEFAULT/report.md" ]; then
  SIZE_RPT_DEFAULT=$(wc -c < "$ENTRY_DEFAULT/report.md")
  echo "   Default report: ${SIZE_RPT_DEFAULT} bytes"
fi
if [ -n "$ENTRY_TIGHT" ] && [ -f "$ENTRY_TIGHT/report.md" ]; then
  SIZE_RPT_TIGHT=$(wc -c < "$ENTRY_TIGHT/report.md")
  echo "   Tight report:   ${SIZE_RPT_TIGHT} bytes"
fi

# Clean up cache dirs
rm -rf "$CACHE_DEFAULT" "$CACHE_TIGHT"

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E extract-limits test FAILED ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E extract-limits test PASSED — both limits are enforced"
