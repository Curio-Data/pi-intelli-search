#!/usr/bin/env bash
#
# test/06_extract_limits.sh — E2E test for extractMaxChars and extractionMaxTokens
#
# Runs the same single-URL research twice, first with pinned default limits,
# then with aggressively low limits, and compares the extraction sizes.
#
# Each arm searches independently and both caps change together, so a size
# difference shows that the tight settings reached the live pipeline; it does
# not isolate either mechanism. The comparison records each arm's source
# hashes. Deterministic tests cover each cap separately. A comparison that
# cannot be made is reported as unproven and fails; it is never a pass.
#
# Usage:
#   ./test/06_extract_limits.sh                   # both arms, then compare
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
CACHE_NAME_DEFAULT=".e2e-extract-default"
CACHE_NAME_TIGHT=".e2e-extract-tight"
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
# Configuration unit: by default the research call is made exactly, through
# the host's registered-tool pipeline with no agent-loop model call
# (lib.sh, direct-tool.mjs). auto falls back to the agent loop only when the
# host lacks that API, and says so; direct refuses to fall back; agent keeps
# the natural-language prompt.
E2E_INVOCATION="${E2E_INVOCATION:-auto}"
e2e_init_log "extract-limits${ARM:+-$ARM}"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

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
    echo "⚠️  The arms read different source content: the size difference does not isolate the caps"
  fi
}

# compare_arms <default_workspace> <tight_workspace> — offline: no provider
# call and no credentials.
compare_arms() {
  local ws_default=$1 ws_tight=$2 entry_default entry_tight label entry
  echo ""
  echo "══ Comparison ═════════════════════════════════════════════════════════"
  ERRORS=0
  entry_default="$(arm_entry "$ws_default" default)" || ERRORS=$((ERRORS + 1))
  entry_tight="$(arm_entry "$ws_tight" tight)" || ERRORS=$((ERRORS + 1))

  # ── Diagnostic: source counts from each report ──
  for label in "Cap3000" "Tight"; do
    if [ "$label" = "Cap3000" ]; then entry="$entry_default"; else entry="$entry_tight"; fi
    if [ -n "$entry" ] && [ -f "$entry/report.md" ]; then
      local source_line blocked_line ext_count src_count
      source_line=$(grep "^> Sources:" "$entry/report.md" 2>/dev/null || echo "")
      # grep -c prints "0" AND exits 1 on no match; assign separately on failure.
      blocked_line=$(grep -c "^## Failed Sources" "$entry/report.md" 2>/dev/null) || blocked_line=0
      ext_count=$(find "$entry/extractions" -type f 2>/dev/null | wc -l)
      src_count=$(find "$entry/sources" -type f 2>/dev/null | wc -l)
      echo "🔍 $label: $source_line | extractions=$ext_count files | sources=$src_count files | has_blocked_section=$blocked_line"
    fi
  done
  echo ""

  if [ -n "$entry_default" ] && [ -n "$entry_tight" ]; then
    report_sources "$entry_default" "$entry_tight"
    local file_default file_tight
    file_default=$(find "$entry_default/extractions" -type f 2>/dev/null | sort | head -1)
    file_tight=$(find "$entry_tight/extractions" -type f 2>/dev/null | sort | head -1)
    if [ -z "$file_default" ] || [ -z "$file_tight" ]; then
      # A tight extractionMaxTokens can leave a reasoning extract model no
      # visible text, so the empty-extraction guard writes no file. That is
      # consistent with the limit but proves nothing about it.
      echo "❌ UNPROVEN: an arm wrote no extraction file (default: ${file_default:-none}, tight: ${file_tight:-none}); the sizes cannot be compared"
      ERRORS=$((ERRORS + 1))
    else
      local size_default size_tight chars_tight
      size_default=$(wc -c < "$file_default")
      size_tight=$(wc -c < "$file_tight")
      chars_tight=$(wc -m < "$file_tight")
      echo "📄 Cap3000 extraction: ${size_default} bytes"
      echo "📄 Tight extraction:   ${size_tight} bytes, ${chars_tight} chars"
      if [ "$size_tight" -lt "$size_default" ]; then
        echo "✅ Tight extraction is smaller than default (tight limits reached the pipeline)"
      else
        echo "❌ Tight extraction is NOT smaller (${size_tight} >= ${size_default})"
        ERRORS=$((ERRORS + 1))
      fi
      # Approximately 4 chars/token, so ≤4000 chars with 1000 output tokens.
      if [ "$chars_tight" -le 4000 ]; then
        echo "✅ Tight extraction ≤4000 chars (consistent with extractionMaxTokens=1000)"
      else
        echo "⚠️  Tight extraction is ${chars_tight} chars (>4000, may still be correct depending on model)"
      fi
      echo ""
      echo "── Cap3000 extraction (first 200 chars) ──"
      head -c 200 "$file_default" 2>/dev/null || echo "(empty)"
      echo ""
      echo "── Tight extraction (first 200 chars) ──"
      head -c 200 "$file_tight" 2>/dev/null || echo "(empty)"
      echo ""
      if grep -qi "truncat\|exceeded" "$file_tight" 2>/dev/null; then
        echo "✅ Tight extraction mentions truncation (extractMaxChars=500 marker)"
      else
        echo "⚠️  Tight extraction does not mention truncation (extract LLM may not echo the marker)"
      fi
    fi
  fi

  echo ""
  if [ "$ERRORS" -gt 0 ]; then
    echo "❌ E2E extract-limits comparison FAILED ($ERRORS error(s))"
    return 1
  fi
  echo "✅ E2E extract-limits comparison PASSED (tight extraction limits reached the live pipeline)"
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

# ── Shared prompt: small-but-redundant research against content-heavy pages ─
# The official Python documentation provides stable, content-rich input.
RESEARCH_PROMPT='Use intelli_research with maxUrls=1 and domains=["docs.python.org"] to research: Python data model reference. Use focusPrompt="Extract the data-model details and canonical API terminology."'
# shellcheck disable=SC2034  # consumed by e2e_run_pi in lib.sh
E2E_EXPECT_ARGS='{"maxUrls":1,"domains":["docs.python.org"],"focusPrompt":"Extract the data-model details and canonical API terminology."}'
E2E_RESEARCH_QUERY="Python data model reference"

# run_arm <default|tight> <workspace> — one live research. The default arm
# pins the legacy cap 3,000 (the 0.20.0+ default is 8,000); both arms pin
# their caps explicitly so the comparison stays deterministic in settings.
run_arm() {
  local arm=$1 ws=$2 agent="" max_chars max_tokens cache_name errors=0
  if [[ "$arm" == default ]]; then
    max_chars=150000; max_tokens=3000; cache_name="$CACHE_NAME_DEFAULT"
  else
    max_chars=500; max_tokens=1000; cache_name="$CACHE_NAME_TIGHT"
  fi
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  ARM: ${arm}  extractMaxChars=${max_chars}  extractionMaxTokens=${max_tokens}"
  echo "╚══════════════════════════════════════════════════════╝"
  echo ""
  e2e_private_dir agent "extlim-${arm}"
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
      "model": "minimax/minimax-m2.7"
    },
    "defaultUrls": 1,
    "maxUrls": 1,
    "searchRetryAttempts": 4,
    "extractMaxChars": $max_chars,
    "extractionMaxTokens": $max_tokens,
    "collationMaxTokens": 4000,
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
  ERRORS=0
  e2e_assert_meta "${arm}: extract model" '.stages.extract.model' "openrouter/minimax/minimax-m2.7"
  e2e_assert_meta "${arm}: outcome" '.outcome' "completed"
  errors=$ERRORS
  mkdir -p "$ws/.e2e-unit"
  jq --arg arm "$arm" --argjson errors "$errors" \
    '. + {arm: $arm, armErrors: $errors} | if $errors > 0 then .status = "arm-fail" else . end' \
    "$E2E_LAST_VERDICT_FILE" > "$ws/.e2e-unit/arm.json"
  [ "$errors" -eq 0 ]
}

if [[ -n "$ARM" ]]; then
  e2e_unit_workspace WS "extlim-${ARM}"
  run_arm "$ARM" "$WS"
  echo "✅ E2E extract-limits ${ARM} arm PASSED (comparison runs separately)"
  exit 0
fi

WS_DEFAULT=""
WS_TIGHT=""
e2e_private_dir WS_DEFAULT extlim-default-ws
e2e_private_dir WS_TIGHT extlim-tight-ws
run_arm default "$WS_DEFAULT"
echo "⏳ Sleeping ${RUN_GAP_SECONDS}s before the tight run..."
sleep "$RUN_GAP_SECONDS"
run_arm tight "$WS_TIGHT"
compare_arms "$WS_DEFAULT" "$WS_TIGHT"
