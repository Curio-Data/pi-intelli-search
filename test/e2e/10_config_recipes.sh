#!/usr/bin/env bash
#
# test/e2e/10_config_recipes.sh: live E2E test for the highest-risk README
# Configuration Recipes
#
# Every recipe's settings resolution, and the page-count and extract-input
# caps, are proven deterministically in test/config-recipes.test.ts, which
# reads each block from README.md. This scenario keeps the recipes whose risk
# only a real provider or a real Pi host can expose, and runs them
# concurrently, each in its own isolated agent dir + cwd:
#
#   R5  (economy extract/collate)  -> non-default models (Gemini 3.7 Flash)
#                                     complete extraction and collation
#   R6  (stronger collation)       -> a second provider family (GPT-5 mini)
#                                     completes collation; extract stays default
#   R8  (per-project override)     -> the real Pi host honours pre-seeded
#                                     trust.json, applying the project search
#                                     model and cacheDir
#   R10 (bounded time and spend)   -> real pages and real model output under
#                                     the 0.21.0 caps: no budget retries, and
#                                     the 150,000-character cap binds when a
#                                     fetched page exceeds it
#
# Recipe 1 has no settings block; test/config-recipes.test.ts proves that the
# loader then applies every default, and 01_main.sh runs the default models
# live through an explicit block. Recipes 2 and 3 run in 08_websearch_tool.sh
# and 09_sonar_pro_search.sh. Recipes 4, 7 and 9 change only page counts,
# pacing and the collation budget, which the deterministic test covers; R9's
# collate model is R5's.
#
# Settings blocks are read from README.md at run time, so this scenario
# exercises the documented text. Up to three attempts per recipe guard the
# known transient pi agent-loop failure mode; a recipe fails only when every
# attempt leaves no completed sidecar.
#
# Usage:
#   ./test/e2e/10_config_recipes.sh
#
# Environment:
#   OPENROUTER_API_KEY            Required. Get one from https://openrouter.ai
#   E2E_RECIPE_TIMEOUT_SECONDS    Per pi attempt, up to three per recipe (default: 600)

# Each recipe counts its own ERRORS inside its subshell by design.
# shellcheck disable=SC2030,SC2031
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-config-recipes-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS \
  E2E_RECIPE_TIMEOUT_SECONDS

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  if [ -f "$HOME/.pi/agent/auth.json" ]; then
    OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
    if [ -n "$OPENROUTER_API_KEY" ]; then
      echo "🔑 Detected OPENROUTER_API_KEY from ~/.pi/agent/auth.json"
    fi
  fi
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set (export it, add it to .env, or ~/.pi/agent/auth.json)."
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
e2e_setup_loop_model || exit 1

# shellcheck disable=SC2034  # consumed by e2e_run_pi in lib.sh
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
# ── Helpers ─────────────────────────────────────────────────────────

# make_env <name> — create isolated agent dir + cwd; echoes "AGENT CWD".
make_env() {
  local agent cwd
  agent="$(mktemp -d -t "recipe-$1-agent-XXXXXX")"
  cwd="$(mktemp -d -t "recipe-$1-cwd-XXXXXX")"
  mkdir -p "$agent/sessions"
  e2e_write_auth "$agent"
  echo '{}' > "$agent/models.json"
  echo "$agent $cwd"
}

# run_pi <agent> <cwd> <prompt> — thin wrapper over lib.sh's e2e_run_pi
# (retry on non-zero exit AND on exit-0 runs with no fresh cache
# sidecar: the print-mode tool-call leak; see docs/BENCHMARKS.md), with the
# per-recipe timeout.
# Sets LAST_OUTPUT for compatibility with the scenario error paths.
run_pi() {
  if e2e_run_pi "$1" "$2" "$3" "$RECIPE_TIMEOUT"; then
    LAST_OUTPUT="$E2E_LAST_OUTPUT"
    return 0
  fi
  LAST_OUTPUT="$E2E_LAST_OUTPUT"
  return 1
}

# meta_value <cache_dir> <jq_path>
meta_value() {
  local latest
  latest="$(e2e_completed_cache_entry "$1")"
  [ -n "$latest" ] || { echo ""; return 1; }
  [ -f "$latest/meta.json" ] || { echo ""; return 1; }
  jq -r "$2 // empty" "$latest/meta.json" 2>/dev/null
}

# assert_eq <label> <actual> <expected>
assert_eq() {
  if [ "$2" = "$3" ]; then
    echo "   ✅ $1 = $3"
  else
    echo "   ❌ $1: got '$2', expected '$3'"
    ERRORS=$((ERRORS + 1))
  fi
}

# assert_le <label> <actual> <max>
assert_le() {
  if [ "$2" -le "$3" ]; then
    echo "   ✅ $1 = $2 (≤ $3)"
  else
    echo "   ❌ $1: got $2, expected ≤ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

# assert_ge for numeric floors
assert_ge() {
  if [ "$2" -ge "$3" ]; then
    echo "   ✅ $1 = $2 (≥ $3)"
  else
    echo "   ❌ $1: got $2, expected ≥ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

RECIPE_TIMEOUT="${E2E_RECIPE_TIMEOUT_SECONDS:-600}"
TRACE_ROOT="${E2E_TRACE_DIR:-}"
RESULTS="$(mktemp -d -t recipe-results-XXXXXX)"
PROMPT_SQLITE='Use intelli_research with maxUrls=2 and domains=["sqlite.org"] to research: SQLite WAL mode trade-offs.'

# recipe_settings <n>: the recipe's settings block from README.md.
recipe_settings() {
  # The single-quoted argument is JavaScript source, not shell expansion.
  # shellcheck disable=SC2016
  node -e '
    const text = require("node:fs").readFileSync(process.argv[1], "utf8");
    const sections = text.split(/^### Recipe (\d+): .*$/m);
    const index = sections.indexOf(process.argv[2]);
    const block = index > 0 && sections[index + 1].split(/^##? /m)[0].match(/^```jsonc\n([\s\S]*?)^```$/m);
    if (!block) { console.error(`README recipe ${process.argv[2]} has no settings block`); process.exit(1); }
    process.stdout.write(JSON.stringify(JSON.parse(block[1])));
  ' "$PROJECT_DIR/README.md" "$1"
}

# write_global <agent> [recipe json]: the loop model plus an optional recipe.
write_global() {
  jq -n --arg p "$E2E_LOOP_PROVIDER" --arg m "$E2E_LOOP_MODEL" --argjson r "${2:-{\}}" \
    '{defaultProvider: $p, defaultModel: $m} + $r' > "$1/settings.json"
}

# Each recipe runs in a background subshell: its own ERRORS count, exit
# status and output file. Per-recipe trace directories keep attempt files
# from colliding when tracing is enabled.
run_recipe() { # run_recipe <name> <function>
  (
    if [[ -n "$TRACE_ROOT" ]]; then E2E_TRACE_DIR="$TRACE_ROOT/$1"; fi
    ERRORS=0
    "$2"
    exit "$ERRORS"
  ) > "$RESULTS/$1.log" 2>&1 &
  echo "$!" > "$RESULTS/$1.pid"
}

recipe_r5() {
  echo "═══ R5: economy extract/collate (google/gemini-3.7-flash) ═══"
  read -r AGENT CWD <<<"$(make_env r5)"
  write_global "$AGENT" "$(recipe_settings 5)"
  if run_pi "$AGENT" "$CWD" "$PROMPT_SQLITE"; then
    assert_eq "extract model overridden" "$(meta_value "$CWD/.search" '.stages.extract.model')" "openrouter/google/gemini-3.7-flash"
    assert_eq "collate model overridden" "$(meta_value "$CWD/.search" '.stages.collate.model')" "openrouter/google/gemini-3.7-flash"
    assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
  else
    echo "   ❌ pi failed all attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
  fi
  rm -rf "$AGENT" "$CWD"
}

recipe_r6() {
  echo "═══ R6: stronger collation (collateModel only; extract stays default) ═══"
  read -r AGENT CWD <<<"$(make_env r6)"
  write_global "$AGENT" "$(recipe_settings 6)"
  if run_pi "$AGENT" "$CWD" "$PROMPT_SQLITE"; then
    assert_eq "collate model overridden" "$(meta_value "$CWD/.search" '.stages.collate.model')" "openrouter/openai/gpt-5-mini"
    assert_eq "extract model still default" "$(meta_value "$CWD/.search" '.stages.extract.model')" "openrouter/minimax/minimax-m3"
    assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
  else
    echo "   ❌ pi failed all attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
  fi
  rm -rf "$AGENT" "$CWD"
}

recipe_r8() {
  echo "═══ R8: per-project override (project .pi/settings.json via trust) ═══"
  read -r AGENT CWD <<<"$(make_env r8)"
  # Global settings carry NO pi-intelli-search block: the project file is the
  # only configuration source. Trust is pre-seeded the way /trust persists it.
  write_global "$AGENT"
  printf '{ "%s": true }\n' "$CWD" > "$AGENT/trust.json"
  mkdir -p "$CWD/.pi"
  recipe_settings 8 > "$CWD/.pi/settings.json"
  if run_pi "$AGENT" "$CWD" "$PROMPT_SQLITE"; then
    assert_eq "project search model applied" "$(meta_value "$CWD/.search-client-x" '.stages.search.model')" "openrouter/perplexity/sonar-pro-search"
    assert_eq "project cacheDir applied" "$(meta_value "$CWD/.search-client-x" '.outcome')" "completed"
    if [ -d "$CWD/.search" ]; then
      echo "   ❌ default .search/ used alongside project cacheDir (override ignored)"
      ERRORS=$((ERRORS + 1))
    else
      echo "   ✅ default .search/ untouched (cacheDir override won)"
    fi
  else
    echo "   ❌ pi failed all attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
  fi
  rm -rf "$AGENT" "$CWD"
}

recipe_r10() {
  echo "═══ R10: bounded time and spend (0.21.0 values: outputBudgetRetries=0, extractMaxChars=150000, collationMaxTokens=4000) ═══"
  read -r AGENT CWD <<<"$(make_env r10)"
  write_global "$AGENT" "$(recipe_settings 10)"
  # The Node.js fs API reference exceeds 150,000 characters after cleaning
  # when it is fetched; the check below reports whether the cap bound.
  if run_pi "$AGENT" "$CWD" 'Use intelli_research with maxUrls=2 and domains=["nodejs.org"] to research: the Node.js fs promises API methods and their options.'; then
    assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
    assert_eq "no extraction budget retries" "$(meta_value "$CWD/.search" '.stages.extract.budgetRetries // 0')" "0"
    assert_eq "no collation budget retry" "$(meta_value "$CWD/.search" '.stages.collate.budgetRetried // "false" | tostring')" "false"
    assert_ge "extractions succeeded" "$(meta_value "$CWD/.search" '.stages.extract.succeeded // 0')" 1
    # totalInputCharsApprox sums min(page chars, extractMaxChars) over fetched
    # pages. Saved sources hold each full page plus a short header, so at the
    # recipe's cap the sum cannot exceed the sum of min(source chars, 150000);
    # at the 400,000 default any page above ≈150,000 characters breaks it.
    local latest longest=0 bound=0 f n
    latest="$(e2e_completed_cache_entry "$CWD/.search")"
    for f in "$latest"/sources/[0-9]*; do
      [ -f "$f" ] || continue
      n="$(LC_ALL=C.UTF-8 wc -m <"$f")"
      [ "$n" -gt "$longest" ] && longest="$n"
      bound=$((bound + (n < 150000 ? n : 150000)))
    done
    if [ "$longest" -gt 150000 ]; then
      assert_le "extract input within the 150,000-character cap per page" \
        "$(meta_value "$CWD/.search" '.stages.extract.totalInputCharsApprox // 999999999')" "$bound"
    else
      echo "   ℹ️  cap not proven: longest saved source is $longest characters"
    fi
  else
    echo "   ❌ pi failed all attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
  fi
  rm -rf "$AGENT" "$CWD"
}

RECIPES=(r5 r6 r8 r10)
echo ""
echo "🚀 Running ${#RECIPES[@]} recipes concurrently (per-invocation timeout ${RECIPE_TIMEOUT}s)"
for name in "${RECIPES[@]}"; do run_recipe "$name" "recipe_$name"; done

FAILED=0
for name in "${RECIPES[@]}"; do
  wait "$(cat "$RESULTS/$name.pid")" && status=0 || status=$?
  echo ""
  cat "$RESULTS/$name.log"
  if [ "$status" -ne 0 ]; then FAILED=$((FAILED + 1)); fi
done
rm -rf "$RESULTS"

# ── Result ─────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "❌ E2E config-recipes test failed ($FAILED of ${#RECIPES[@]} recipes)"
  exit 1
fi
echo "✅ E2E config-recipes test passed: recipes 5, 6, 8 and 10 proven live in isolation"
