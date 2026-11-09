#!/usr/bin/env bash
#
# test/04_migration.sh — E2E test for default migration on upgrade
#
# Simulates a user upgrading from 0.7.0. In 0.7.0, the
# default extract/collate model was minimax/MiniMax-M2.7 (direct
# provider). The current release migrates it to
# openrouter/minimax/minimax-m3 (default changed in 0.14.0).
#
# The test writes a 0.7.0 version marker and old-style settings,
# then runs the current extension. Verifies:
# - The pipeline works with the migrated model (search + extract + collate)
# - The run's recorded extract/collate models are the migrated defaults
# - Cache artifacts are created in this unit's own workspace
#
# The research runs in a private, empty workspace (E2E_WORKSPACE when the
# runner supplies one), never in the repository: the repository's .search/
# holds registered research that cache suggest would read and that a
# completed-sidecar scan could mistake for this run's evidence.
#
# Usage:
#   ./test/04_migration.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_VERSION="$(jq -r '.version' "$PROJECT_DIR/package.json")"

# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
# Read .env BEFORE output reaches the retained log: a malformed line must
# never be echoed into it (see test/e2e/env.sh). The file is parsed, never
# executed, and only the documented keys are read.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS
# Configuration unit: by default the research call is made exactly, through
# the host's registered-tool pipeline with no agent-loop model call
# (lib.sh, direct-tool.mjs). auto falls back to the agent loop only when the
# host lacks that API, and says so; direct refuses to fall back; agent keeps
# the natural-language prompt.
E2E_INVOCATION="${E2E_INVOCATION:-auto}"
e2e_init_log e2e-migration
e2e_attach_log
echo "📝 Log: $LOG_FILE"

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

e2e_setup_loop_model || exit 1

# ── Create isolated agent directory ────────────────────────────────
trap e2e_cleanup EXIT
e2e_private_dir ISOLATED_AGENT_DIR migration
e2e_unit_workspace E2E_CWD migration-cwd

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"

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
e2e_write_auth "$ISOLATED_AGENT_DIR"

# ── settings.json — old 0.7.0 defaults (flat keys, minimax direct) ──
# These are what a user who never customized would have after using 0.7.0.
# The flat intelli* keys are the scenario subject and stay verbatim; the
# loop model is scaffolding (split form per lib.sh).
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
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
echo "⚙️  Migration expected: → openrouter/minimax/minimax-m3"
echo ""

# ── models.json — vanilla/empty ────────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (simulated 0.7.0 upgrade)  ║"
echo "║  target: $TARGET_VERSION                             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Extension path ─────────────────────────────────────────────────
E2E_EXTENSION_PATH="${E2E_EXTENSION_PATH:-$PROJECT_DIR/dist/index.js}"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT="Use intelli_research with maxUrls=3 to research: what is the latest Bun version"
E2E_EXPECT_ARGS='{"maxUrls":3}'
E2E_RESEARCH_QUERY="what is the latest Bun version"
E2E_EXPECT_CACHE_DIR=".search"

if ! e2e_run_pi "$ISOLATED_AGENT_DIR" "$E2E_CWD" "$PROMPT"; then
  echo ""
  echo "❌ pi failed: ${E2E_LAST_VERDICT_REASON:-no completed research after retries}"
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

# 1. Migration must have happened: the marker matches package.json.
if [ -f "$ISOLATED_AGENT_DIR/.pi-intelli-search-version.json" ]; then
  MIGRATED_VERSION=$(jq -r '.version' "$ISOLATED_AGENT_DIR/.pi-intelli-search-version.json" 2>/dev/null || echo "unknown")
  if [ "$MIGRATED_VERSION" = "$TARGET_VERSION" ]; then
    echo "✅ Version marker migrated: 0.7.0 → $MIGRATED_VERSION"
  else
    echo "❌ Version marker not migrated (got: $MIGRATED_VERSION, expected: $TARGET_VERSION)"
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
CACHE_DIR="$E2E_CWD/.search"

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

# The entry bound to this run's own research call (lib.sh, e2e_run_pi).
LATEST_CACHE="$E2E_BOUND_ENTRY"
if [ -n "$LATEST_CACHE" ]; then
  echo "✅ Cache entry directory: $(basename "$LATEST_CACHE")"

  # The scenario subject: the 0.7.0 default extract/collate model was
  # migrated in memory to the current default for this run.
  e2e_assert_meta "extract model migrated" '.stages.extract.model' "openrouter/minimax/minimax-m3"
  e2e_assert_meta "collate model migrated" '.stages.collate.model' "openrouter/minimax/minimax-m3"
  e2e_assert_meta "search model" '.stages.search.model' "openrouter/perplexity/sonar"

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

echo "✅ E2E migration test passed — 0.7.0 upgrade works"
