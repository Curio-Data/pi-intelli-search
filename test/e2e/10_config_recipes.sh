#!/usr/bin/env bash
#
# test/e2e/10_config_recipes.sh — E2E test for the README Configuration Recipes
#
# Runs each recipe's settings block (as documented) in its own isolated
# agent dir + working dir, and asserts the effective behaviour from the
# telemetry sidecar. Maximum isolation per scenario: fresh PI_CODING_AGENT_DIR
# (own auth.json, settings.json, models.json, trust.json) and fresh cwd, so
# no cross-contamination between configurations is possible.
#
# Coverage map (README Configuration Recipes):
#   Recipe 1 (zero config)        -> scenario R1  (true zero: NO pi-intelli-search key)
#   Recipe 2 (web tool + nano)    -> covered by e2e/08_websearch_tool.sh
#   Recipe 3 (sonar-pro-search)   -> covered by e2e/09_sonar_pro_search.sh
#   Recipe 4 (pin eight pages)    -> scenario R4
#   Recipe 5 (economy extract)    -> scenario R5
#   Recipe 6 (stronger collation) -> scenario R6
#   Recipe 7 (free-tier resilience) -> scenario R7
#   Recipe 8 (per-project override) -> scenario R8 (first E2E coverage of
#                                      project-level settings via pre-seeded trust.json)
#   Recipe 9 (large-context collation) -> scenario R9 (collate-model override
#                                      and a completed run; telemetry records
#                                      the input budget only when it trims, so
#                                      the 600,000 value is covered by unit tests)
#   Recipe 10 (bounded time and spend) -> scenario R10 (completed run with no
#                                      budget retries and extract input within
#                                      the 150,000-character cap when a fetched
#                                      page exceeds it; collationMaxTokens is not
#                                      recorded in telemetry)
#
# Each recipe makes its research call by direct invocation by default (lib.sh,
# direct-tool.mjs), so no agent-loop model is involved; the prompt is used only
# when the host lacks direct invocation and the run falls back to the agent
# loop, with a fallback report. Up to three attempts per recipe retry a
# research call that completed no useful work (a transient provider or
# transport failure, or a degraded search). Every assertion reads the sidecar
# bound to the recipe's own research call (lib.sh): exactly one call, with the
# arguments the oracle names. An attempt that completed research is never
# repeated, and wrong arguments or several calls are never retried.
#
# Evidence classes differ by recipe: R9's input budget and R10's collation
# token cap are not recorded in telemetry, and R10's input cap binds only when
# a fetched page exceeds it. The summary states what each recipe proved.
#
# Usage:
#   ./test/e2e/10_config_recipes.sh                 # all eight recipes in turn
#   E2E_RECIPE=r1|r4|r5|r6|r7|r8|r9|r10 ./test/e2e/10_config_recipes.sh
#                                                   # one recipe (required with
#                                                   # E2E_WORKSPACE)
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

RECIPES=(r1 r4 r5 r6 r7 r8 r9 r10)
# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
e2e_require_one_case E2E_RECIPE "${RECIPES[@]}"
if [[ -n "${E2E_RECIPE:-}" ]]; then RECIPES=("$E2E_RECIPE"); fi
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
e2e_init_log "e2e-config-recipes${E2E_RECIPE:+-$E2E_RECIPE}"
e2e_attach_log
echo "📝 Log: $LOG_FILE"

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

e2e_setup_loop_model || exit 1

# shellcheck disable=SC2034  # consumed by e2e_run_pi in lib.sh
E2E_EXTENSION_PATH="${E2E_EXTENSION_PATH:-$PROJECT_DIR/dist/index.js}"
ERRORS=0
trap e2e_cleanup EXIT

# ── Helpers ─────────────────────────────────────────────────────────

AGENT=""
CWD=""
NOTES=()

# make_env <name> — isolated agent dir and working dir for one recipe; sets
# AGENT and CWD. The working dir is E2E_WORKSPACE in single-recipe mode.
make_env() {
  e2e_private_dir AGENT "recipe-$1-agent"
  e2e_unit_workspace CWD "recipe-$1-cwd"
  mkdir -p "$AGENT/sessions"
  e2e_write_auth "$AGENT"
  echo '{}' > "$AGENT/models.json"
}

# run_recipe <name> <cache_dir> <expected_args_json> <query> <prompt> — one
# research bound to its own call: exact (direct) by default, or the prompt
# through the agent loop. Returns nonzero when no bound completed research.
run_recipe() {
  E2E_ATTEMPT_PREFIX="$1-"
  E2E_EXPECT_CACHE_DIR="$2"
  E2E_EXPECT_ARGS="$3"
  E2E_RESEARCH_QUERY="$4"
  if e2e_run_pi "$AGENT" "$CWD" "$5"; then
    return 0
  fi
  echo "   ❌ $1: ${E2E_LAST_VERDICT_REASON:-no completed research after retries} (verdict: ${E2E_LAST_VERDICT_FILE:-none})"
  ERRORS=$((ERRORS + 1))
  printf '%s\n' "$E2E_LAST_OUTPUT" | tail -5
  return 1
}

# meta_value <jq_path> — value from the bound sidecar.
meta_value() {
  e2e_meta "$1"
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
  if [ "$2" -le "$3" ] 2>/dev/null; then
    echo "   ✅ $1 = $2 (≤ $3)"
  else
    echo "   ❌ $1: got '$2', expected ≤ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

# assert_ge for numeric floors
assert_ge() {
  if [ "$2" -ge "$3" ] 2>/dev/null; then
    echo "   ✅ $1 = $2 (≥ $3)"
  else
    echo "   ❌ $1: got '$2', expected ≥ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

GAP="${E2E_RUN_GAP_SECONDS:-20}"
NODE_ARGS='{"maxUrls":2,"domains":["nodejs.org"]}'
NODE_DEFAULT_ARGS='{"maxUrls":null,"domains":["nodejs.org"]}'
SQLITE_ARGS='{"maxUrls":2,"domains":["sqlite.org"]}'

# ── R1: Zero configuration ─────────────────────────────────────────
recipe_r1() {
  echo ""
  echo "═══ R1: zero configuration (no pi-intelli-search key at all) ═══"
  make_env r1
  cat > "$AGENT/settings.json" <<EOF
{"defaultProvider": "$E2E_LOOP_PROVIDER", "defaultModel": "$E2E_LOOP_MODEL"}
EOF
  if run_recipe r1 .search "$NODE_ARGS" "the current Node.js LTS schedule" "Use intelli_research with maxUrls=2 and domains=[\"nodejs.org\"] to research: the current Node.js LTS schedule."; then
    assert_eq "search model defaulted" "$(meta_value '.stages.search.model')" "openrouter/perplexity/sonar"
    assert_eq "extract model defaulted" "$(meta_value '.stages.extract.model')" "openrouter/minimax/minimax-m3"
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
    assert_ge "sources fetched" "$(meta_value '.stages.fetch.succeeded // 0')" 1
  fi
}

# ── R4: Pin eight pages ────────────────────────────────────────────
recipe_r4() {
  echo ""
  echo "═══ R4: pin eight pages (partial block: defaultUrls/maxUrls only) ═══"
  make_env r4
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "defaultUrls": 8,
    "maxUrls": 16
  }
}
EOF
  # No maxUrls in the call (checked on the raw arguments): the agent fallback
  # (defaultUrls=8) must apply, and the models must still default.
  if run_recipe r4 .search "$NODE_DEFAULT_ARGS" "the current Node.js LTS schedule" "Use intelli_research and domains=[\"nodejs.org\"] to research: the current Node.js LTS schedule. Do not pass maxUrls; let the default apply."; then
    assert_eq "search model still defaulted" "$(meta_value '.stages.search.model')" "openrouter/perplexity/sonar"
    assert_le "pages requested (defaultUrls cap)" "$(meta_value '.stages.fetch.requested // 999')" 8
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
  fi
}

# ── R5: Economy extract and collate ────────────────────────────────
recipe_r5() {
  echo ""
  echo "═══ R5: economy extract/collate (google/gemini-3.7-flash) ═══"
  make_env r5
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "extractModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    }
  }
}
EOF
  if run_recipe r5 .search "$SQLITE_ARGS" "SQLite WAL mode trade-offs" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
    assert_eq "extract model overridden" "$(meta_value '.stages.extract.model')" "openrouter/google/gemini-3.7-flash"
    assert_eq "collate model overridden" "$(meta_value '.stages.collate.model')" "openrouter/google/gemini-3.7-flash"
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
  fi
}

# ── R6: Stronger collation (collate-only override) ─────────────────
recipe_r6() {
  echo ""
  echo "═══ R6: stronger collation (collateModel only; extract stays default) ═══"
  make_env r6
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "collateModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-mini"
    }
  }
}
EOF
  if run_recipe r6 .search "$SQLITE_ARGS" "SQLite WAL mode trade-offs" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
    assert_eq "collate model overridden" "$(meta_value '.stages.collate.model')" "openrouter/openai/gpt-5-mini"
    assert_eq "extract model still default" "$(meta_value '.stages.extract.model')" "openrouter/minimax/minimax-m3"
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
  fi
}

# ── R7: Free-tier resilience ───────────────────────────────────────
recipe_r7() {
  echo ""
  echo "═══ R7: free-tier resilience keys ═══"
  make_env r7
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "defaultUrls": 5,
    "minRequestIntervalMs": 3000,
    "extractionConcurrency": 2,
    "llmRetryAttempts": 4,
    "llmTimeoutMs": 120000
  }
}
EOF
  if run_recipe r7 .search "$NODE_DEFAULT_ARGS" "the Node.js release schedule" "Use intelli_research and domains=[\"nodejs.org\"] to research: the Node.js release schedule. Do not pass maxUrls; let the default apply."; then
    assert_le "pages requested (defaultUrls=5)" "$(meta_value '.stages.fetch.requested // 999')" 5
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
    assert_ge "sources fetched" "$(meta_value '.stages.fetch.succeeded // 0')" 1
    NOTES+=("R7: the page default and completion are checked live; pacing, concurrency and retry values are not asserted")
  fi
}

# ── R8: Per-project override ───────────────────────────────────────
recipe_r8() {
  echo ""
  echo "═══ R8: per-project override (project .pi/settings.json via trust) ═══"
  make_env r8
  # Global settings carry NO pi-intelli-search block: the project file is the
  # only configuration source. Trust is pre-seeded the way /trust persists it.
  printf '{"defaultProvider": "%s", "defaultModel": "%s"}\n' "$E2E_LOOP_PROVIDER" "$E2E_LOOP_MODEL" > "$AGENT/settings.json"
  jq -n --arg cwd "$CWD" '{($cwd): true}' > "$AGENT/trust.json"
  mkdir -p "$CWD/.pi"
  cat > "$CWD/.pi/settings.json" <<'EOF'
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "cacheDir": ".search-client-x"
  }
}
EOF
  if run_recipe r8 .search-client-x "$SQLITE_ARGS" "SQLite WAL mode trade-offs" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
    assert_eq "project search model applied" "$(meta_value '.stages.search.model')" "openrouter/perplexity/sonar-pro-search"
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
    # The cacheDir override: the verdict bound this call's entry directly inside
    # the project's .search-client-x (run_recipe above), and the default root
    # stays absent (below). State both explicitly.
    assert_eq "project cacheDir applied (bound entry's cache root)" \
      "$(basename "$(dirname "$E2E_BOUND_ENTRY")")" ".search-client-x"
    if [ -d "$CWD/.search" ]; then
      echo "   ❌ default .search/ used alongside project cacheDir (override ignored)"
      ERRORS=$((ERRORS + 1))
    else
      echo "   ✅ default .search/ untouched (cacheDir override won)"
    fi
  fi
}

# ── R9: Large-context collation ────────────────────────────────────
recipe_r9() {
  echo ""
  echo "═══ R9: large-context collation (collateModel + collationInputBudgetTokens) ═══"
  make_env r9
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    },
    "collationInputBudgetTokens": 600000
  }
}
EOF
  if run_recipe r9 .search "$SQLITE_ARGS" "SQLite WAL mode trade-offs" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
    assert_eq "collate model overridden" "$(meta_value '.stages.collate.model')" "openrouter/google/gemini-3.7-flash"
    assert_eq "extract model still default" "$(meta_value '.stages.extract.model')" "openrouter/minimax/minimax-m3"
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
    NOTES+=("R9: the 600,000 input budget is covered by unit tests; telemetry records it only when it trims")
  fi
}

# ── R10: Bounded time and spend (0.21.0 values) ────────────────────
recipe_r10() {
  echo ""
  echo "═══ R10: bounded time and spend (0.21.0 values: outputBudgetRetries=0, extractMaxChars=150000, collationMaxTokens=4000) ═══"
  make_env r10
  cat > "$AGENT/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "outputBudgetRetries": 0,
    "extractMaxChars": 150000,
    "collationMaxTokens": 4000
  }
}
EOF
  # The Node.js fs API reference exceeds 150,000 characters after cleaning
  # when it is fetched; the check below reports whether the cap bound.
  if run_recipe r10 .search "$NODE_ARGS" "the Node.js fs promises API methods and their options" "Use intelli_research with maxUrls=2 and domains=[\"nodejs.org\"] to research: the Node.js fs promises API methods and their options."; then
    assert_eq "outcome" "$(meta_value '.outcome')" "completed"
    assert_eq "no extraction budget retries" "$(meta_value '.stages.extract.budgetRetries // 0')" "0"
    assert_eq "no collation budget retry" "$(meta_value '.stages.collate.budgetRetried // "false" | tostring')" "false"
    assert_ge "extractions succeeded" "$(meta_value '.stages.extract.succeeded // 0')" 1
    # totalInputCharsApprox sums min(page chars, extractMaxChars) over fetched
    # pages. Saved sources hold each full page plus a short header, so at the
    # recipe's cap the sum cannot exceed the sum of min(source chars, 150000);
    # at the 400,000 default any page above ≈150,000 characters breaks it.
    local longest=0 bound=0 n f
    for f in "$E2E_BOUND_ENTRY"/sources/[0-9]*; do
      [ -f "$f" ] || continue
      n="$(LC_ALL=C.UTF-8 wc -m <"$f")"
      [ "$n" -gt "$longest" ] && longest="$n"
      bound=$((bound + (n < 150000 ? n : 150000)))
    done
    if [ "$longest" -gt 150000 ]; then
      assert_le "extract input within the 150,000-character cap per page" \
        "$(meta_value '.stages.extract.totalInputCharsApprox // 999999999')" "$bound"
      NOTES+=("R10: the input cap bound live; collationMaxTokens is not recorded in telemetry")
    else
      echo "   ℹ️  cap not proven: longest saved source is $longest characters"
      NOTES+=("R10: the input cap was UNEXERCISED (longest source $longest characters); collationMaxTokens is not recorded in telemetry")
    fi
  fi
}

# ── Run ────────────────────────────────────────────────────────────
FIRST=1
for recipe in "${RECIPES[@]}"; do
  # Pacing between recipes applies only when several run in this process.
  if [[ "${#RECIPES[@]}" -gt 1 && "$FIRST" -eq 0 ]]; then sleep "$GAP"; fi
  FIRST=0
  "recipe_${recipe}"
  # Standalone mode removes each recipe's private roots as it goes; a
  # runner-owned E2E_WORKSPACE is kept for the caller.
  if [[ -z "${E2E_WORKSPACE:-}" ]]; then rm -rf -- "$AGENT" "$CWD"; fi
  rm -rf -- "$AGENT"
done

# ── Result ─────────────────────────────────────────────────────────
echo ""
for note in "${NOTES[@]}"; do echo "ℹ️  $note"; done
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E config-recipes test failed ($ERRORS error(s); recipes: ${RECIPES[*]})"
  exit 1
fi
echo "✅ E2E config-recipes test passed: recipes ${RECIPES[*]} met their live assertions (see the notes above for limits)"
