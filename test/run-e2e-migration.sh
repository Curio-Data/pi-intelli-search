#!/usr/bin/env bash
#
# test/run-e2e-migration.sh — E2E test for default migration on upgrade
#
# Simulates a user upgrading from 0.7.0. In 0.7.0, the
# default extract/collate model was minimax/MiniMax-M2.7 (direct
# provider). In 0.10.0, it is openrouter/minimax/minimax-m2.7.
#
# The test writes a 0.7.0 version marker and old-style settings,
# then runs the current extension. Verifies:
# - The pipeline works with the migrated model (search + extract + collate)
# - Cache artifacts are created
#
# Usage:
#   ./test/run-e2e-migration.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-migration-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

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

# ── Create isolated agent directory ────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-migration-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"

mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# ── Simulate a 0.7.0 install ───────────────────────────────────────
# Write `.pi-intelli-search-version.json` claiming version 0.7.0.
# This is what the extension writes on first session_start and reads
# back on the next session_start to detect upgrades.
mkdir -p "$ISOLATED_AGENT_DIR"
cat > "$ISOLATED_AGENT_DIR/.pi-intelli-search-version.json" <<EOF
{"version":"0.7.0","settingsFormat":"flat"}
EOF

echo "📄 Wrote 0.7.0 version marker"

# ── auth.json ───────────────────────────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

# ── settings.json — old 0.7.0 defaults (flat keys, minimax direct) ──
# These are what a user who never customized would have after using 0.7.0.
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultModel": "openrouter/perplexity/sonar",
  "intelliSearchModel": {
    "provider": "openrouter",
    "model": "perplexity/sonar"
  },
  "intelliExtractModel": {
    "provider": "minimax",
    "model": "MiniMax-M2.7"
  },
  "intelliCollateModel": {
    "provider": "minimax",
    "model": "MiniMax-M2.7"
  }
}
EOF

echo "📄 Wrote 0.7.0-style settings (flat keys + minimax direct)"
echo "⚙️  Extract/Collate: minimax/MiniMax-M2.7 (old default)"
echo "⚙️  Migration expected: → openrouter/minimax/minimax-m2.7"
echo ""

# ── models.json — vanilla/empty ────────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (simulated 0.7.0→0.10.0   ║"
echo "║  migration)                                         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Extension path ─────────────────────────────────────────────────
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT="Use intelli_research with maxUrls=3 to research: what is the latest Bun version"

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

# 1. Migration must have happened — the version file should now say 0.8.0
if [ -f "$ISOLATED_AGENT_DIR/.pi-intelli-search-version.json" ]; then
  MIGRATED_VERSION=$(jq -r '.version' "$ISOLATED_AGENT_DIR/.pi-intelli-search-version.json" 2>/dev/null || echo "unknown")
  if [ "$MIGRATED_VERSION" = "0.10.0" ]; then
    echo "✅ Version marker migrated: 0.7.0 → $MIGRATED_VERSION"
  else
    echo "❌ Version marker not migrated (got: $MIGRATED_VERSION, expected: 0.10.0)"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "❌ Version marker file missing after session_start"
  ERRORS=$((ERRORS + 1))
fi

# 2. Pipeline must have run — search results present
if echo "$OUTPUT" | grep -qi "intelli_search\|intelli_research\|search result\|cached .*search\|research found\|search/.*report"; then
  echo "✅ intelli_research was invoked (search results present in output)"
else
  echo "⚠️  No explicit intelli_research mention in output (cache artifacts will confirm pipeline)"
fi

if echo "$OUTPUT" | grep -qi "Sources\|sources\|http"; then
  echo "✅ Source URLs / references found"
else
  echo "⚠️  No source references found (may be expected for some queries)"
fi

# 3. Cache artifacts must exist — proves pipeline ran end-to-end
CACHE_DIR="$PROJECT_DIR/.search"

if [ -d "$CACHE_DIR" ]; then
  echo "✅ .search/ cache directory exists"
else
  echo "❌ .search/ cache directory not found at $CACHE_DIR"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "$CACHE_DIR/.index.json" ]; then
  echo "✅ .search/.index.json exists"
else
  echo "❌ .search/.index.json not found"
  ERRORS=$((ERRORS + 1))
fi

LATEST_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d -not -name '.search' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
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
    echo "⚠️  extractions/ not found"
  fi
else
  echo "❌ No cache entry subdirectory found under .search/"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E migration test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E migration test passed — 0.7.0→0.10.0 upgrade works"
