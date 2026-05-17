#!/usr/bin/env bash
#
# test/run-e2e-collation-limits.sh — E2E test for collationMaxTokens
#
# Proves collationMaxTokens is enforced by running the same single-URL
# research query twice (back-to-back): first with the default 4000
# tokens, then with a tight 200-token limit. Compares report sizes to
# confirm the output was clamped.
#
# Usage:
#   ./test/run-e2e-collation-limits.sh
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

# ── Shared prompt ───────────────────────────────────────────────────
# A single-URL query against a content-rich page gives the collation
# model enough material that a 200-token limit will visibly truncate.
RESEARCH_PROMPT="Use intelli_research with maxUrls=1 to research: Python programming language history design philosophy. Use focusPrompt='Extract the history and design philosophy sections.'"

# ═══════════════════════════════════════════════════════════════════
# Run 1: Default collation limit (4000 tokens)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 1: Default collation (4000 tokens)               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISO1="$(mktemp -d -t pi-e2e-collim1-XXXXXX)"
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
    "cacheDir": ".e2e-collate-default"
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
# Run 2: Tight collation limit (200 tokens)
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 2: Tight collation (200 tokens)                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISO2="$(mktemp -d -t pi-e2e-collim2-XXXXXX)"
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
    "extractMaxChars": 150000,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": 200,
    "cacheDir": ".e2e-collate-tight"
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
# Compare report sizes
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "══ Comparison ═════════════════════════════════════════════════════════"

ERRORS=0

CACHE_DEFAULT="$PROJECT_DIR/.e2e-collate-default"
CACHE_TIGHT="$PROJECT_DIR/.e2e-collate-tight"

ENTRY_DEFAULT=$(find "$CACHE_DEFAULT" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' 2>/dev/null | sort -r | head -1)
ENTRY_TIGHT=$(find "$CACHE_TIGHT" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' 2>/dev/null | sort -r | head -1)

if [ -z "$ENTRY_DEFAULT" ]; then
  echo "❌ No cache entry found in .e2e-collate-default/"
  ERRORS=$((ERRORS + 1))
fi

if [ -z "$ENTRY_TIGHT" ]; then
  echo "❌ No cache entry found in .e2e-collate-tight/"
  ERRORS=$((ERRORS + 1))
fi

if [ -n "$ENTRY_DEFAULT" ] && [ -n "$ENTRY_TIGHT" ]; then
  REPORT_DEFAULT="$ENTRY_DEFAULT/report.md"
  REPORT_TIGHT="$ENTRY_TIGHT/report.md"

  if [ -f "$REPORT_DEFAULT" ] && [ -f "$REPORT_TIGHT" ]; then
    SIZE_DEFAULT=$(wc -c < "$REPORT_DEFAULT" || echo "0")
    SIZE_TIGHT=$(wc -c < "$REPORT_TIGHT" || echo "0")
    CHARS_DEFAULT=$(wc -m < "$REPORT_DEFAULT" || echo "0")
    CHARS_TIGHT=$(wc -m < "$REPORT_TIGHT" || echo "0")

    echo "📄 Default report: ${SIZE_DEFAULT} bytes, ${CHARS_DEFAULT} chars (collationMaxTokens=4000)"
    echo "📄 Tight report:   ${SIZE_TIGHT} bytes, ${CHARS_TIGHT} chars (collationMaxTokens=200)"

    if [ "$SIZE_TIGHT" -lt "$SIZE_DEFAULT" ]; then
      echo "✅ Tight report is smaller than default (collationMaxTokens enforced)"
    else
      echo "❌ Tight report is NOT smaller (${SIZE_TIGHT} >= ${SIZE_DEFAULT})"
      ERRORS=$((ERRORS + 1))
    fi

    # With 200 tokens (~800 chars at 4 chars/token), the report should be short
    if [ "$CHARS_TIGHT" -le 1000 ]; then
      echo "✅ Tight report ≤1000 chars (collationMaxTokens=200 enforced)"
    else
      echo "⚠️  Tight report is ${CHARS_TIGHT} chars (>1000, may still be correct depending on model)"
    fi

    # Extraction files should be similar sizes (extraction settings unchanged)
    EXTRACT_DIR_DEFAULT="$ENTRY_DEFAULT/extractions"
    EXTRACT_DIR_TIGHT="$ENTRY_TIGHT/extractions"
    if [ -d "$EXTRACT_DIR_DEFAULT" ] && [ -d "$EXTRACT_DIR_TIGHT" ]; then
      FILE_DEFAULT=$(find "$EXTRACT_DIR_DEFAULT" -type f | head -1)
      FILE_TIGHT=$(find "$EXTRACT_DIR_TIGHT" -type f | head -1)
      if [ -n "$FILE_DEFAULT" ] && [ -n "$FILE_TIGHT" ]; then
        SIZE_EXT_DEFAULT=$(wc -c < "$FILE_DEFAULT" || echo "0")
        SIZE_EXT_TIGHT=$(wc -c < "$FILE_TIGHT" || echo "0")
        DIFF=$((SIZE_EXT_DEFAULT - SIZE_EXT_TIGHT))
        # Allow some variance (±30%) since LLM output is non-deterministic
        if [ "$DIFF" -lt 0 ]; then DIFF=$(( -DIFF )); fi
        THRESHOLD=$(( SIZE_EXT_DEFAULT * 30 / 100 ))
        if [ "$DIFF" -le "$THRESHOLD" ]; then
          echo "✅ Extraction sizes are similar (extraction settings unchanged, as expected)"
        else
          echo "⚠️  Extraction sizes differ noticeably (${SIZE_EXT_DEFAULT} vs ${SIZE_EXT_TIGHT})"
        fi
      fi
    fi

    # Show report previews
    echo ""
    echo "── Default report (first 300 chars) ──"
    head -c 300 "$REPORT_DEFAULT" 2>/dev/null || echo "(empty)"
    echo ""
    echo "── Tight report (first 300 chars) ──"
    head -c 300 "$REPORT_TIGHT" 2>/dev/null || echo "(empty)"
    echo ""

  else
    echo "❌ Missing report.md in one or both caches"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Clean up
rm -rf "$CACHE_DEFAULT" "$CACHE_TIGHT"

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E collation-limits test FAILED ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E collation-limits test PASSED — collationMaxTokens is enforced"
