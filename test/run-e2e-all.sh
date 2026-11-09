#!/usr/bin/env bash
#
# test/run-e2e-all.sh — Sequential E2E runner
#
# Runs every live E2E script ONE AT A TIME with a spacing gap between them.
# This is the sequential alternative for credentialed scenarios 13 and 14 and
# for deliberately paced runs. The gap is operational pacing, not a measured
# provider-bucket refill. Use run-e2e-parallel.sh for the isolated 25-unit lane.
#
# Usage:
#   ./test/run-e2e-all.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required (auto-detected from ~/.pi/agent/auth.json).
#   E2E_GAP_SECONDS      Gap between scripts (default: 20). Set 0 when pacing
#                        is not required; upstream 429/402 evidence is handled
#                        from recorded responses, not assumed from concurrency.
#   E2E_SCRIPT_TIMEOUT_SECONDS  Per-script deadline (default: 1200).
#   E2E_SCRIPT_KILL_AFTER_SECONDS  Grace before KILL after the deadline
#                        (default: 30).
#
# Each script runs under `timeout` WITHOUT --foreground: timeout leads its own
# process group and signals all of it, so an expired script cannot leave pi or
# its children making paid calls. Because that group is not the terminal's
# foreground group, Ctrl-C reaches only this runner; the trap below forwards
# it (and TERM) to the running script's group and waits for it to settle.
#
# Excludes run-e2e-publish.sh (release-only; validates the npm package).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present (gitignored)
# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/e2e/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS
GAP="${E2E_GAP_SECONDS:-20}"
SCRIPT_TIMEOUT="${E2E_SCRIPT_TIMEOUT_SECONDS:-1200}"
KILL_AFTER="${E2E_SCRIPT_KILL_AFTER_SECONDS:-30}"
export TMPDIR="${TMPDIR:-$PROJECT_DIR/.tmp/e2e}"
mkdir -p "$TMPDIR"
[[ "$GAP" =~ ^[0-9]+$ && "$SCRIPT_TIMEOUT" =~ ^[1-9][0-9]*$ && "$KILL_AFTER" =~ ^[1-9][0-9]*$ ]] || {
  echo "Invalid E2E gap or timeout" >&2
  exit 1
}

# Auto-detect the key so failures are about rate limits, not setup.
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set (export it, add to .env, or ~/.pi/agent/auth.json)."
  exit 1
fi
export OPENROUTER_API_KEY

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

echo "🧪 Sequential E2E run — ${#SCRIPTS[@]} scripts, ${GAP}s gap, ${SCRIPT_TIMEOUT}s timeout per script"
echo ""

PASSED=()
FAILED=()
SKIPPED=()
CHILD=""

# run_script <path> — run one script under a deadline in the background and
# wait for it, so the INT/TERM trap can run while it is in progress.
run_script() {
  timeout --kill-after="${KILL_AFTER}s" "${SCRIPT_TIMEOUT}s" "$1" </dev/null &
  CHILD=$!
  local rc=0
  wait "$CHILD" || rc=$?
  CHILD=""
  return "$rc"
}

# stop_running <exit_status> — forward the signal to the running script's
# timeout, which relays it to its whole process group, wait for it to settle,
# then stop the suite.
stop_running() {
  local status=$1
  if [[ -n "$CHILD" ]]; then
    echo ""
    echo "⏹  Interrupted: stopping the running script and its children..."
    kill -TERM "$CHILD" 2>/dev/null || true
    wait "$CHILD" 2>/dev/null || true
  fi
  exit "$status"
}
trap 'stop_running 130' INT
trap 'stop_running 143' TERM

for i in "${!SCRIPTS[@]}"; do
  script="${SCRIPTS[$i]}"
  echo "════════════════════════════════════════════════════════════════"
  echo "▶  [$((i + 1))/${#SCRIPTS[@]}] $script"
  echo "════════════════════════════════════════════════════════════════"

  # Don't let one failure abort the suite — collect results and report at the end.
  if run_script "$SCRIPT_DIR/$script"; then
    echo "✅ $script PASSED"
    PASSED+=("$script")
  else
    status=$?
    if [ "$status" -eq 77 ]; then
      echo "⚠️ $script SKIPPED (required release evidence is missing)"
      SKIPPED+=("$script")
    elif [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
      echo "❌ $script TIMED OUT after ${SCRIPT_TIMEOUT}s"
    else
      echo "❌ $script FAILED (exit $status)"
    fi
    if [ "$status" -ne 77 ]; then FAILED+=("$script"); fi
  fi

  # Space out all but the last script to let the rate-limit bucket recover.
  if [ "$i" -lt "$((${#SCRIPTS[@]} - 1))" ] && [ "$GAP" -gt 0 ]; then
    echo "⏳ Sleeping ${GAP}s before next script..."
    sleep "$GAP"
  fi
  echo ""
done

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
