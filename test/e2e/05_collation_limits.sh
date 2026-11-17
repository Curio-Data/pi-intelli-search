#!/usr/bin/env bash
#
# test/e2e/05_collation_limits.sh: E2E test for collationMaxTokens
#
# Proves collationMaxTokens is enforced by running the same single-URL
# research query twice at once, each in its own agent directory and working
# directory: one with the default 4000 tokens, one with a tight 200-token
# limit. Compares report sizes to confirm the output was clamped.
#
# Usage:
#   ./test/e2e/05_collation_limits.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-collation-limits-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Load .env if it exists
# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RETRY_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS
# A non-reasoning collation model makes the 200-token comparison measure
# visible output rather than a reasoning budget. Empty summaries remain failures.
COLLATE_MODEL="openai/gpt-4.1-mini"

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

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
e2e_setup_loop_model || exit 1

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

# ── Shared prompt ───────────────────────────────────────────────────
# A small-but-redundant query against content-rich pages gives the collation
# model enough material that a 200-token limit will visibly truncate. Restrict
# to one official documentation source to limit live-provider load and avoid
# unrelated, low-quality search results.
RESEARCH_PROMPT='Use intelli_research with maxUrls=1 and domains=["docs.python.org"] to research: Python data model reference. Use focusPrompt="Extract the data-model details and canonical API terminology."'

# Both arms run at once. Each has its own agent directory and working
# directory, so neither can count the other's sidecar or cache entry.
# extractMaxChars stays well below the page length in both arms: this scenario
# tests collation, and a shorter extraction input only shortens the wait.
ISO1="$(mktemp -d -t pi-e2e-collim1-XXXXXX)"
ISO2="$(mktemp -d -t pi-e2e-collim2-XXXXXX)"
CWD1="$(mktemp -d -t pi-e2e-collim1-cwd-XXXXXX)"
CWD2="$(mktemp -d -t pi-e2e-collim2-cwd-XXXXXX)"
CACHE_DEFAULT="$CWD1/.e2e-collate-default"
CACHE_TIGHT="$CWD2/.e2e-collate-tight"
# shellcheck disable=SC2064
trap "rm -rf $ISO1 $ISO2 $CWD1 $CWD2" EXIT

# write_arm <agent_dir> <collationMaxTokens> <cacheDir>
write_arm() {
  mkdir -p "$1/sessions"
  e2e_write_auth "$1"
  cat > "$1/settings.json" <<SEOF
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
      "model": "minimax/minimax-m2.7"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "$COLLATE_MODEL"
    },
    "defaultUrls": 1,
    "maxUrls": 1,
    "searchRetryAttempts": 4,
    "extractMaxChars": 40000,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": $2,
    "cacheDir": "$3"
  }
}
SEOF
  echo '{}' > "$1/models.json"
}
write_arm "$ISO1" 4000 .e2e-collate-default
write_arm "$ISO2" 200 .e2e-collate-tight

echo ""
echo "▶ RUN 1 (collationMaxTokens=4000) and RUN 2 (collationMaxTokens=200) start together"
e2e_run_pi_bg "$CWD1/output.txt" "$ISO1" "$CWD1" "$RESEARCH_PROMPT"; PID1=$E2E_BG_PID
e2e_run_pi_bg "$CWD2/output.txt" "$ISO2" "$CWD2" "$RESEARCH_PROMPT"; PID2=$E2E_BG_PID
e2e_wait_bg "$PID1" "$CWD1/output.txt" && ST1=0 || ST1=$?
OUTPUT1="$E2E_LAST_OUTPUT"
e2e_wait_bg "$PID2" "$CWD2/output.txt" && ST2=0 || ST2=$?
OUTPUT2="$E2E_LAST_OUTPUT"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 1: Default collation (4000 tokens)               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "$OUTPUT1"
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  RUN 2: Tight collation (200 tokens)                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "$OUTPUT2"
if [ "$ST1" -ne 0 ] || [ "$ST2" -ne 0 ]; then
  [ "$ST1" -ne 0 ] && echo "❌ Run 1 (default) failed (no cache sidecar after retries)"
  [ "$ST2" -ne 0 ] && echo "❌ Run 2 (tight) failed (no cache sidecar after retries)"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════
# Compare report sizes
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "══ Comparison ═════════════════════════════════════════════════════════"

ERRORS=0

ENTRY_DEFAULT=$(e2e_completed_cache_entry "$CACHE_DEFAULT")
ENTRY_TIGHT=$(e2e_completed_cache_entry "$CACHE_TIGHT")

# A missing cache entry usually means the search stage returned a degraded 200
# (a valid reply with no markdown links), so the pipeline returned early without
# writing a cache. Distinguish that from a genuine collation bug. The agent
# paraphrases the tool's wording, so match the underlying signal loosely
# (this branch only runs when a cache entry is already missing).
DEGRADED_RE="degraded|parseable links|no usable links|no markdown links|returned no links|without markdown links"

if [ -z "$ENTRY_DEFAULT" ]; then
  if echo "${OUTPUT1:-}" | grep -qiE "$DEGRADED_RE"; then
    echo "❌ Default run degraded; verification is incomplete"
    ERRORS=$((ERRORS + 1))
  else
    echo "❌ No cache entry found in .e2e-collate-default/"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ -z "$ENTRY_TIGHT" ]; then
  if echo "${OUTPUT2:-}" | grep -qiE "$DEGRADED_RE"; then
    echo "❌ Tight run degraded; verification is incomplete"
    ERRORS=$((ERRORS + 1))
  else
    echo "❌ No cache entry found in .e2e-collate-tight/"
    ERRORS=$((ERRORS + 1))
  fi
fi

if [ -n "$ENTRY_DEFAULT" ] && [ -n "$ENTRY_TIGHT" ]; then
  REPORT_DEFAULT="$ENTRY_DEFAULT/report.md"
  REPORT_TIGHT="$ENTRY_TIGHT/report.md"

  if [ -f "$REPORT_DEFAULT" ] && [ -f "$REPORT_TIGHT" ]; then
    SIZE_DEFAULT=$(wc -c < "$REPORT_DEFAULT" || echo "0")
    SIZE_TIGHT=$(wc -c < "$REPORT_TIGHT" || echo "0")
    CHARS_DEFAULT=$(wc -m < "$REPORT_DEFAULT" || echo "0")
    CHARS_TIGHT=$(wc -m < "$REPORT_TIGHT" || echo "0")

    jq -e --arg m "openrouter/$COLLATE_MODEL" '.outcome == "completed" and .stages.collate.model == $m and .stages.collate.summaryChars > 0' "$ENTRY_DEFAULT/meta.json" >/dev/null
    jq -e --arg m "openrouter/$COLLATE_MODEL" '.outcome == "completed" and .stages.collate.model == $m and .stages.collate.summaryChars > 0' "$ENTRY_TIGHT/meta.json" >/dev/null
    echo "✅ Both runs used $COLLATE_MODEL and produced visible synthesis"
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

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E collation-limits test FAILED ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E collation-limits test PASSED — collationMaxTokens is enforced"
