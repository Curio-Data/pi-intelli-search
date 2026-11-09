#!/usr/bin/env bash
#
# test/05_collation_limits.sh — E2E test for collationMaxTokens
#
# Runs the same single-URL research twice, once with the default 4000
# collation tokens and once with a tight 200-token limit, then compares the
# report sizes to confirm the output was clamped.
#
# Each arm searches independently, so the two arms can read different
# pages. The comparison records each arm's source hashes: a size difference
# from different content does not by itself isolate the cap. Deterministic
# tests cover the mechanism; this scenario proves the live wiring.
#
# Usage:
#   ./test/05_collation_limits.sh                 # both arms, then compare
#   E2E_LIMIT_ARM=default|tight E2E_WORKSPACE=... # one live arm
#   E2E_LIMIT_ARM=compare \
#     E2E_COMPARE_DEFAULT_WORKSPACE=... E2E_COMPARE_TIGHT_WORKSPACE=...
#                                                 # offline comparison only
#
# Environment:
#   OPENROUTER_API_KEY   Required for the live arms. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_NAME_DEFAULT=".e2e-collate-default"
CACHE_NAME_TIGHT=".e2e-collate-tight"
# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
e2e_require_one_case E2E_LIMIT_ARM default tight compare
ARM="${E2E_LIMIT_ARM:-}"

# Read .env BEFORE output reaches the retained log: a malformed line must
# never be echoed into it (see test/e2e/env.sh). The file is parsed, never
# executed, and only the documented keys are read.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS
e2e_init_log "e2e-collation-limits${ARM:+-$ARM}"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# A non-reasoning collation model makes the 200-token comparison measure
# visible output rather than a reasoning budget. Empty summaries remain failures.
COLLATE_MODEL="openai/gpt-4.1-mini"

# compare_arms <default_workspace> <tight_workspace> — offline: no provider
# call, no credentials. Reads each arm's receipt to find the entry that arm's
# own research call produced; never selects by index or directory order.
compare_arms() {
  local ws_default=$1 ws_tight=$2 entry_default entry_tight
  echo ""
  echo "══ Comparison ═════════════════════════════════════════════════════════"
  ERRORS=0
  entry_default="$(arm_entry "$ws_default" default)" || ERRORS=$((ERRORS + 1))
  entry_tight="$(arm_entry "$ws_tight" tight)" || ERRORS=$((ERRORS + 1))

  if [ -n "$entry_default" ] && [ -n "$entry_tight" ]; then
    local report_default="$entry_default/report.md" report_tight="$entry_tight/report.md"
    if [ -f "$report_default" ] && [ -f "$report_tight" ]; then
      local size_default size_tight chars_tight
      size_default=$(wc -c < "$report_default")
      size_tight=$(wc -c < "$report_tight")
      chars_tight=$(wc -m < "$report_tight")
      echo "📄 Default report: ${size_default} bytes (collationMaxTokens=4000)"
      echo "📄 Tight report:   ${size_tight} bytes, ${chars_tight} chars (collationMaxTokens=200)"
      report_sources "$entry_default" "$entry_tight"

      if [ "$size_tight" -lt "$size_default" ]; then
        echo "✅ Tight report is smaller than default (collationMaxTokens enforced)"
      else
        echo "❌ Tight report is NOT smaller (${size_tight} >= ${size_default})"
        ERRORS=$((ERRORS + 1))
      fi

      # With 200 tokens (≈800 chars at 4 chars/token), the report should be short
      if [ "$chars_tight" -le 1000 ]; then
        echo "✅ Tight report ≤1000 chars (collationMaxTokens=200 enforced)"
      else
        echo "⚠️  Tight report is ${chars_tight} chars (>1000, may still be correct depending on model)"
      fi

      echo ""
      echo "── Default report (first 300 chars) ──"
      head -c 300 "$report_default" 2>/dev/null || echo "(empty)"
      echo ""
      echo "── Tight report (first 300 chars) ──"
      head -c 300 "$report_tight" 2>/dev/null || echo "(empty)"
      echo ""
    else
      echo "❌ Missing report.md in one or both bound entries"
      ERRORS=$((ERRORS + 1))
    fi
  fi

  echo ""
  if [ "$ERRORS" -gt 0 ]; then
    echo "❌ E2E collation-limits comparison FAILED ($ERRORS error(s))"
    return 1
  fi
  echo "✅ E2E collation-limits comparison PASSED (live wiring of collationMaxTokens)"
}

# arm_entry <workspace> <label> — the entry bound by that arm's verdict.
arm_entry() {
  local ws=$1 label=$2 receipt rel
  receipt="$ws/.e2e-unit/arm.json"
  if [ ! -f "$receipt" ] || ! jq -e '.status == "pass"' "$receipt" >/dev/null 2>&1; then
    echo "❌ $label arm has no passing receipt at $receipt" >&2
    return 1
  fi
  rel="$(jq -r '.entryRelative' "$receipt")"
  if [ ! -f "$ws/$rel/meta.json" ]; then
    echo "❌ $label arm entry is missing: $ws/$rel" >&2
    return 1
  fi
  printf '%s\n' "$ws/$rel"
}

# report_sources <entry_default> <entry_tight> — record what each arm read.
report_sources() {
  local a b
  a="$(node "$E2E_VERDICT_HELPER" sources --entry "$1" | jq -c '[.[] | {url, sha256}]')"
  b="$(node "$E2E_VERDICT_HELPER" sources --entry "$2" | jq -c '[.[] | {url, sha256}]')"
  echo "🔍 Default arm sources: $a"
  echo "🔍 Tight arm sources:   $b"
  if [ "$a" = "$b" ]; then
    echo "✅ Both arms read identical source content"
  else
    echo "⚠️  The arms read different source content: the size difference does not isolate the cap"
  fi
}

if [[ "$ARM" == "compare" ]]; then
  : "${E2E_COMPARE_DEFAULT_WORKSPACE:?E2E_COMPARE_DEFAULT_WORKSPACE is required for E2E_LIMIT_ARM=compare}"
  : "${E2E_COMPARE_TIGHT_WORKSPACE:?E2E_COMPARE_TIGHT_WORKSPACE is required for E2E_LIMIT_ARM=compare}"
  compare_arms "$E2E_COMPARE_DEFAULT_WORKSPACE" "$E2E_COMPARE_TIGHT_WORKSPACE"
  exit $?
fi

RUN_GAP_SECONDS="${E2E_RUN_GAP_SECONDS:-30}"

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

if ! command -v "${E2E_PI_BIN:-pi}" &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

e2e_setup_loop_model || exit 1

E2E_EXTENSION_PATH="${E2E_EXTENSION_PATH:-$PROJECT_DIR/dist/index.js}"
echo "🧪 Extension: $E2E_EXTENSION_PATH"
trap e2e_cleanup EXIT

# ── Shared prompt ───────────────────────────────────────────────────
# A small-but-redundant query against content-rich pages gives the collation
# model enough material that a 200-token limit will visibly truncate. Restrict
# to one official documentation source to limit live-provider load and avoid
# unrelated, low-quality search results.
RESEARCH_PROMPT='Use intelli_research with maxUrls=1 and domains=["docs.python.org"] to research: Python data model reference. Use focusPrompt="Extract the data-model details and canonical API terminology."'
# shellcheck disable=SC2034  # consumed by e2e_run_pi in lib.sh
E2E_EXPECT_ARGS='{"maxUrls":1,"domains":["docs.python.org"],"focusPrompt":"Extract the data-model details and canonical API terminology."}'

# run_arm <default|tight> <workspace> — one live research with that arm's
# settings; writes the arm receipt into <workspace>/.e2e-unit/arm.json.
run_arm() {
  local arm=$1 ws=$2 agent="" tokens cache_name
  if [[ "$arm" == default ]]; then tokens=4000; cache_name="$CACHE_NAME_DEFAULT"; else tokens=200; cache_name="$CACHE_NAME_TIGHT"; fi
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  ARM: ${arm} collation (${tokens} tokens)"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  e2e_private_dir agent "collim-${arm}"
  mkdir -p "$agent/sessions"
  e2e_write_auth "$agent"
  cat > "$agent/settings.json" <<EOF
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
    "extractMaxChars": 150000,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": $tokens,
    "cacheDir": "$cache_name"
  }
}
EOF
  printf '{}\n' > "$agent/models.json"
  E2E_EXPECT_CACHE_DIR="$cache_name"
  E2E_ATTEMPT_PREFIX="${arm}-"
  if ! e2e_run_pi "$agent" "$ws" "$RESEARCH_PROMPT"; then
    echo "$E2E_LAST_OUTPUT"
    echo ""
    echo "❌ ${arm} arm failed: ${E2E_LAST_VERDICT_REASON:-no completed research after retries}"
    return 1
  fi
  echo "$E2E_LAST_OUTPUT"
  local errors=0
  ERRORS=0
  e2e_assert_meta "${arm}: collate model" '.stages.collate.model' "openrouter/$COLLATE_MODEL"
  e2e_assert_meta "${arm}: outcome" '.outcome' "completed"
  errors=$ERRORS
  if [ "$(e2e_meta '.stages.collate.summaryChars // 0')" -gt 0 ] 2>/dev/null; then
    echo "   ✅ ${arm}: visible synthesis"
  else
    echo "   ❌ ${arm}: empty collation summary"
    errors=$((errors + 1))
  fi
  mkdir -p "$ws/.e2e-unit"
  jq --arg arm "$arm" --argjson errors "$errors" \
    '. + {arm: $arm, armErrors: $errors} | if $errors > 0 then .status = "arm-fail" else . end' \
    "$E2E_LAST_VERDICT_FILE" > "$ws/.e2e-unit/arm.json"
  [ "$errors" -eq 0 ]
}

if [[ -n "$ARM" ]]; then
  e2e_unit_workspace WS "collim-${ARM}"
  run_arm "$ARM" "$WS"
  echo "✅ E2E collation-limits ${ARM} arm PASSED (comparison runs separately)"
  exit 0
fi

WS_DEFAULT=""
WS_TIGHT=""
e2e_private_dir WS_DEFAULT collim-default-ws
e2e_private_dir WS_TIGHT collim-tight-ws
run_arm default "$WS_DEFAULT"
echo "⏳ Sleeping ${RUN_GAP_SECONDS}s before the tight run..."
sleep "$RUN_GAP_SECONDS"
run_arm tight "$WS_TIGHT"
compare_arms "$WS_DEFAULT" "$WS_TIGHT"
