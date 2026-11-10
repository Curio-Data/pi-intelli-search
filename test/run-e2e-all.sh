#!/usr/bin/env bash
#
# test/run-e2e-all.sh: E2E suite runner
#
# Builds both packages once, then runs every live E2E script. By default all
# scripts start at once, each with its own TMPDIR and log; the summary prints
# each script's outcome and the tail of every failing log. Set
# E2E_RUN_MODE=sequential to run them one at a time with a gap instead, for
# example to read one scenario's output as it happens.
#
# Concurrency evidence: on 2026-11-09 three all-at-once passes and one paced
# sequential pass of scenarios 01 to 12 and 15 (run-e2e-parallel.sh) ended no
# extension or agent-loop call in an error stop reason and recorded no
# Retry-After header. Most agent-loop calls used kimi-coding/k3, not
# OpenRouter. Failures and slow runs came from agent argument errors, repeated
# research, slow successful calls, timeouts, semantic collation rejection and
# harness races; the single build below removes the build race. Upstream
# providers can still return 429, and an account can meet OpenRouter's 402
# in-flight spending limit; the extension's own retry policy honours
# Retry-After. Parallel is the default by owner decision (2026-11-10).
# That evidence predates the current agent-loop default: neither the
# qwen-token-plan loop nor an OpenRouter loop sharing the pipeline key has
# been measured under parallel load; use E2E_RUN_MODE=sequential if either
# meets rate limits.
#
# Usage:
#   ./test/run-e2e-all.sh
#
# Environment:
#   OPENROUTER_API_KEY          Required (auto-detected from ~/.pi/agent/auth.json).
#   E2E_RUN_MODE                parallel (default) or sequential.
#   E2E_GAP_SECONDS             Sequential mode only: gap between scripts (default: 20).
#   E2E_SCRIPT_TIMEOUT_SECONDS  Limit for each script except 10_config_recipes.sh (default: 1200).
#   E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS
#                               Limit for 10_config_recipes.sh, whose recipes can
#                               each take three attempts (default: 2400).
#   E2E_RECIPE_TIMEOUT_SECONDS  Scenario 10 only: limit per pi attempt (default: 600).
#   E2E_SKIP_BUILD              1 to use existing builds instead of building first.
#
# Excludes run-e2e-publish.sh (release-only; validates the npm package).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/e2e/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS \
  E2E_RECIPE_TIMEOUT_SECONDS E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS E2E_RUN_MODE
MODE="${E2E_RUN_MODE:-parallel}"
GAP="${E2E_GAP_SECONDS:-20}"
SCRIPT_TIMEOUT="${E2E_SCRIPT_TIMEOUT_SECONDS:-1200}"
RECIPES_TIMEOUT="${E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS:-2400}"
export TMPDIR="${TMPDIR:-$PROJECT_DIR/.tmp/e2e}"
mkdir -p "$TMPDIR"
[[ "$GAP" =~ ^[0-9]+$ && "$SCRIPT_TIMEOUT" =~ ^[1-9][0-9]*$ && "$RECIPES_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid E2E_GAP_SECONDS, E2E_SCRIPT_TIMEOUT_SECONDS or E2E_RECIPES_SCRIPT_TIMEOUT_SECONDS" >&2
  exit 1
}
[[ "$MODE" == "parallel" || "$MODE" == "sequential" ]] || {
  echo "E2E_RUN_MODE must be parallel or sequential" >&2
  exit 1
}

# Auto-detect the key so failures are about the scenarios, not setup.
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set (export it, add to .env, or ~/.pi/agent/auth.json)."
  exit 1
fi
export OPENROUTER_API_KEY

# One build before any scenario starts. Scenarios then use the prebuilt
# artefacts and pack without lifecycle scripts, so none rebuilds a bundle
# another is loading.
if [[ "${E2E_SKIP_BUILD:-0}" != "1" ]]; then
  echo "🔨 npm run build:all"
  (cd "$PROJECT_DIR" && npm run build:all >/dev/null 2>&1) || {
    echo "❌ npm run build:all failed; run it directly to see the error" >&2
    exit 1
  }
fi
export E2E_SKIP_BUILD=1

# Order: cheapest/most-fundamental first, broadest last.
SCRIPTS=(
  e2e/01_main.sh
  e2e/02_cap.sh
  e2e/03_model_override.sh
  e2e/04_migration.sh
  e2e/05_collation_limits.sh
  e2e/06_extract_limits.sh
  e2e/07_llms_full.sh
  e2e/08_websearch_tool.sh
  e2e/09_sonar_pro_search.sh
  e2e/10_config_recipes.sh
  e2e/11_mcp_stdio.sh
  e2e/12_plugin_bundles.sh
  e2e/13_claude_code_plugin.sh
  e2e/14_codex_plugin.sh
  e2e/15_pi_floor.sh
)

PASSED=()
FAILED=()
SKIPPED=()

# timeout_for <script>: scenario 10 runs five recipes concurrently, each
# making up to three E2E_RECIPE_TIMEOUT_SECONDS attempts (≈1,860 s at the defaults);
# every other script keeps the shorter limit, so a hang still fails fast.
timeout_for() {
  if [[ "$1" == e2e/10_config_recipes.sh ]]; then echo "$RECIPES_TIMEOUT"; else echo "$SCRIPT_TIMEOUT"; fi
}

# record <script> <status> [log]: classify one finished script.
record() {
  local script="$1" status="$2" log="${3:-}"
  if [ "$status" -eq 0 ]; then
    echo "✅ $script PASSED"
    PASSED+=("$script")
    return
  fi
  if [ "$status" -eq 77 ]; then
    echo "⚠️ $script SKIPPED (required release evidence is missing)"
    SKIPPED+=("$script")
  elif [ "$status" -eq 124 ]; then
    echo "❌ $script TIMED OUT after $(timeout_for "$script")s"
  else
    echo "❌ $script FAILED (exit $status)"
  fi
  if [ "$status" -ne 77 ]; then FAILED+=("$script"); fi
  if [[ -n "$log" ]]; then
    echo "   Last lines of $log:"
    tail -20 "$log" | sed 's/^/   │ /'
  fi
}

if [[ "$MODE" == "parallel" ]]; then
  RUN_DIR="$TMPDIR/run-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$RUN_DIR"
  echo "🧪 Parallel E2E run: ${#SCRIPTS[@]} scripts at once, ${SCRIPT_TIMEOUT}s timeout per script (${RECIPES_TIMEOUT}s for scenario 10)"
  echo "   Logs: $RUN_DIR"
  echo ""
  PIDS=()
  for script in "${SCRIPTS[@]}"; do
    name="$(basename "$script" .sh)"
    mkdir -p "$RUN_DIR/$name.tmp"
    # No --foreground: no scenario here shares the terminal, so timeout
    # signals the scenario's whole process group and a timed-out scenario
    # leaves no pi, claude or codex child running.
    TMPDIR="$RUN_DIR/$name.tmp" \
      timeout "$(timeout_for "$script")s" "$SCRIPT_DIR/$script" \
      > "$RUN_DIR/$name.log" 2>&1 < /dev/null &
    PIDS+=("$!")
  done
  for i in "${!SCRIPTS[@]}"; do
    wait "${PIDS[$i]}" && status=0 || status=$?
    record "${SCRIPTS[$i]}" "$status" "$RUN_DIR/$(basename "${SCRIPTS[$i]}" .sh).log"
  done
else
  echo "🧪 Sequential E2E run: ${#SCRIPTS[@]} scripts, ${GAP}s gap, ${SCRIPT_TIMEOUT}s timeout per script (${RECIPES_TIMEOUT}s for scenario 10)"
  echo ""
  for i in "${!SCRIPTS[@]}"; do
    script="${SCRIPTS[$i]}"
    echo "════════════════════════════════════════════════════════════════"
    echo "▶  [$((i + 1))/${#SCRIPTS[@]}] $script"
    echo "════════════════════════════════════════════════════════════════"
    # Don't let one failure abort the suite; collect results and report at the end.
    timeout --foreground "$(timeout_for "$script")s" "$SCRIPT_DIR/$script" && status=0 || status=$?
    record "$script" "$status"
    if [ "$i" -lt "$((${#SCRIPTS[@]} - 1))" ] && [ "$GAP" -gt 0 ]; then
      echo "⏳ Sleeping ${GAP}s before next script..."
      sleep "$GAP"
    fi
    echo ""
  done
fi

echo "════════════════════════════════════════════════════════════════"
echo "Summary: ${#PASSED[@]} passed, ${#FAILED[@]} failed, ${#SKIPPED[@]} skipped"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  printf '   ⚠️ %s\n' "${SKIPPED[@]}"
  exit 1
fi
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '   ❌ %s\n' "${FAILED[@]}"
  exit 1
fi
echo "✅ All E2E scripts passed"
