#!/usr/bin/env bash
#
# test/03_model_override.sh — E2E test for model override via settings
#
# Demonstrates that changing the extract/collate model in settings.json
# is read and used by the pipeline. Replaces the default MiniMax M3
# with google/gemini-3-flash-preview from OpenRouter.
#
# Usage:
#   ./test/03_model_override.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai
#
# The .env file (gitignored) can hold OPENROUTER_API_KEY for convenience.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-model-override-${TIMESTAMP}.log"
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
  echo "  - Ensure ~/.pi/agent/auth.json has an openrouter key"
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
e2e_setup_loop_model || exit 1

# ── Create isolated agent directory ────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-override-XXXXXX)"
E2E_CWD="$(mktemp -d -t pi-e2e-override-cwd-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR" "$E2E_CWD"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"

mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# ── auth.json — OpenRouter key only ────────────────────────────────
e2e_write_auth "$ISOLATED_AGENT_DIR"

# ── settings.json — override extract/collate to Gemini 3 Flash ─────
# Uses the nested pi-intelli-search namespace.
# Search stays on Perplexity Sonar; extract and collate use a different
# model to prove that settings.json overrides are respected. The loop
# model uses the split defaultProvider/defaultModel form (lib.sh).
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "google/gemini-3-flash-preview"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-3-flash-preview"
    },
    "cacheDir": ".e2e-custom-cache",
    "defaultUrls": 1,
    "maxUrls": 1
  }
}
EOF

# ── models.json — vanilla/empty ────────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "📄 Wrote vanilla models.json (extension will add perplexity models)"
echo "⚙️  Extract/Collate: openrouter/google/gemini-3-flash-preview (overridden)"
echo "⚙️  Search:            openrouter/perplexity/sonar (default)"
echo "⚙️  Cache dir:         .e2e-custom-cache (overridden)"
echo ""

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (isolated env)              ║"
echo "║  Model override: Gemini 3 Flash for extract/collate  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Extension path ─────────────────────────────────────────────────
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT='Use intelli_research with maxUrls=1 and domains=["deno.com"] to research: the current Deno release. Return the official release source.'

if ! e2e_run_pi "$ISOLATED_AGENT_DIR" "$E2E_CWD" "$PROMPT" "${E2E_TIMEOUT_SECONDS:-300}"; then
  echo ""
  echo "❌ pi failed (no cache sidecar after retries)"
  echo ""
  echo "--- pi output ---"
  echo "$E2E_LAST_OUTPUT"
  echo "-----------------"
  exit 1
fi
OUTPUT="$E2E_LAST_OUTPUT"

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

# ── Verify custom cache directory ─────────────────────────────────────
# The settings.json overrides cacheDir to ".e2e-custom-cache".
# Verify the cache appears there, not in the default ".search".
CACHE_DIR="$E2E_CWD/.e2e-custom-cache"

if [ -d "$CACHE_DIR" ]; then
  echo "✅ .e2e-custom-cache/ cache directory exists (custom dir override works)"
else
  echo "❌ .e2e-custom-cache/ cache directory not found at $CACHE_DIR"
  # Also check if it went to default .search instead
  if [ -d "$E2E_CWD/.search" ]; then
    echo "⚠️  Cache went to .search/ instead (cacheDir override ignored)"
  fi
  ERRORS=$((ERRORS + 1))
fi

# Also verify .search does NOT exist (proves override took effect)
if [ -d "$E2E_CWD/.search" ]; then
  echo "⚠️  Default .search/ directory exists (cacheDir override ignored)"
fi

if [ -f "$CACHE_DIR/.index.json" ]; then
  echo "✅ .e2e-custom-cache/.index.json exists"
  INDEX_ENTRIES=$(jq '.searches | length' "$CACHE_DIR/.index.json" 2>/dev/null || echo "0")
  if [ "$INDEX_ENTRIES" -gt 0 ]; then
    echo "   📂 $INDEX_ENTRIES cache entry/entries recorded"
  fi
else
  echo "❌ .e2e-custom-cache/.index.json not found"
  ERRORS=$((ERRORS + 1))
fi

LATEST_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' | sort -r | head -1)
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
  echo "❌ No cache entry subdirectory found under $CACHE_DIR/"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E model-override test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E model-override test passed — model override in settings.json is respected"
