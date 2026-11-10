#!/usr/bin/env bash
# Traced evidence runner for live-run investigations. Scenarios 13 and 14 are
# excluded because traced runs must not use maintainer login profiles.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/e2e/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS

ORIGINAL_HOME="$HOME"
if [[ -z "${OPENROUTER_API_KEY:-}" && -f "$ORIGINAL_HOME/.pi/agent/auth.json" ]]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$ORIGINAL_HOME/.pi/agent/auth.json" 2>/dev/null || true)"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY is required" >&2
  exit 1
fi
export OPENROUTER_API_KEY

for tool in curl jq node npm pi timeout; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool" >&2; exit 1; }
done
[[ -f "$PROJECT_DIR/dist/index.js" && -f "$PROJECT_DIR/packages/mcp/dist/cli.js" ]] || {
  echo "Run npm run build:all before the parallel harness (builds must not race live runs)" >&2
  exit 1
}

RUN_NAME="${E2E_RUN_NAME:-parallel-$(date -u +%Y%m%dT%H%M%SZ)}"
RUN_ROOT="${E2E_RUN_ROOT:-$PROJECT_DIR/.tmp/e2e-evidence}"
RUN_DIR="$RUN_ROOT/$RUN_NAME"
if [[ -e "$RUN_DIR" ]]; then
  echo "Refusing to overwrite existing run directory: $RUN_DIR" >&2
  exit 1
fi
mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"
SCRIPT_TIMEOUT="${E2E_SCRIPT_TIMEOUT_SECONDS:-1200}"
RUN_MODE="${E2E_RUN_MODE:-parallel}"
GAP="${E2E_GAP_SECONDS:-20}"
[[ "$SCRIPT_TIMEOUT" =~ ^[1-9][0-9]*$ && "$GAP" =~ ^[0-9]+$ ]] || {
  echo "Invalid E2E_SCRIPT_TIMEOUT_SECONDS or E2E_GAP_SECONDS" >&2
  exit 1
}
[[ "$RUN_MODE" == "parallel" || "$RUN_MODE" == "sequential" ]] || {
  echo "E2E_RUN_MODE must be parallel or sequential" >&2
  exit 1
}

capture_key_state() {
  local phase="$1"
  local raw="$RUN_DIR/key-state-$phase.raw.json" code
  code="$(curl -sS --max-time 30 \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    -o "$raw" -w '%{http_code}' https://openrouter.ai/api/v1/key)" || code="000"
  if [[ "$code" == "200" ]]; then
    jq --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg httpStatus "$code" '{
      observedAt: $observedAt,
      httpStatus: ($httpStatus | tonumber),
      data: (.data | {
        limit, limit_reset, limit_remaining, usage, usage_daily,
        is_free_tier, free_model_daily_requests, effective_budget
      })
    }' "$raw" > "$RUN_DIR/key-state-$phase.json"
  else
    jq -n --arg observedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg httpStatus "$code" \
      '{observedAt: $observedAt, httpStatus: $httpStatus, error: "key state unavailable"}' \
      > "$RUN_DIR/key-state-$phase.json"
  fi
}

SCRIPTS=(
  01_main.sh
  02_cap.sh
  03_model_override.sh
  04_migration.sh
  05_collation_limits.sh
  06_extract_limits.sh
  07_llms_full.sh
  08_websearch_tool.sh
  09_sonar_pro_search.sh
  10_config_recipes.sh
  11_mcp_stdio.sh
  12_plugin_bundles.sh
  15_pi_floor.sh
)

run_scenario() {
  local script="$1"
  local name="${script%.sh}"
  local dir="$RUN_DIR/$name"
  local started ended status duration outcome
  local loop_model="${TEST_MODEL:-}"
  mkdir -p "$dir/tmp" "$dir/home" "$dir/npm-cache" "$dir/xdg-cache" "$dir/xdg-config" "$dir/pi-traces"
  chmod 700 "$dir" "$dir/home"
  : > "$dir/http.jsonl"
  : > "$dir/extension.jsonl"
  chmod 600 "$dir/http.jsonl" "$dir/extension.jsonl"

  if [[ -z "$loop_model" ]]; then
    loop_model="openrouter/google/gemini-3.8-flash"
    if [[ -f "$ORIGINAL_HOME/.pi/agent/auth.json" ]] \
      && jq -e '."qwen-token-plan".type == "api_key"' "$ORIGINAL_HOME/.pi/agent/auth.json" >/dev/null 2>&1; then
      loop_model="qwen-token-plan/qwen3.8-max"
    fi
  fi
  if [[ "$script" == "15_pi_floor.sh" ]]; then loop_model="openrouter/minimax/minimax-m3"; fi

  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  SECONDS=0
  (
    export HOME="$dir/home"
    export TMPDIR="$dir/tmp"
    export XDG_CACHE_HOME="$dir/xdg-cache"
    export XDG_CONFIG_HOME="$dir/xdg-config"
    export npm_config_cache="$dir/npm-cache"
    export E2E_OPERATOR_AUTH_JSON="$ORIGINAL_HOME/.pi/agent/auth.json"
    export E2E_TRACE_DIR="$dir/pi-traces"
    export E2E_TRACE_EXTENSION_PATH="$SCRIPT_DIR/e2e/trace-extension.mjs"
    export E2E_COMPACT_JSON_OUTPUT=1
    export E2E_SKIP_BUILD=1
    export PI_INTELLI_E2E_SCENARIO="$name"
    export PI_INTELLI_E2E_LOOP_MODEL="$loop_model"
    export PI_INTELLI_E2E_HTTP_TRACE="$dir/http.jsonl"
    export PI_INTELLI_E2E_EXTENSION_TRACE="$dir/extension.jsonl"
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$SCRIPT_DIR/e2e/trace-fetch.mjs"
    timeout --foreground "${SCRIPT_TIMEOUT}s" "$SCRIPT_DIR/e2e/$script"
  ) > "$dir/scenario.log" 2>&1 && status=0 || status=$?
  duration="$SECONDS"
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  outcome="failed"
  if [[ "$status" -eq 0 ]]; then outcome="passed"; fi
  if [[ "$status" -eq 77 ]]; then outcome="skipped"; fi
  if [[ "$status" -eq 124 ]]; then outcome="timeout"; fi
  jq -n --arg scenario "$script" --arg started "$started" --arg ended "$ended" \
    --arg outcome "$outcome" --argjson exitCode "$status" --argjson durationSeconds "$duration" \
    '{scenario: $scenario, started: $started, ended: $ended, durationSeconds: $durationSeconds, exitCode: $exitCode, outcome: $outcome}' \
    > "$dir/result.json"
  printf '%-32s exit=%-3s duration=%ss outcome=%s\n' "$script" "$status" "$duration" "$outcome"
  return "$status"
}

capture_key_state start
printf '%s run: %s\n' "${RUN_MODE^}" "$RUN_DIR"
date -u +'%Y-%m-%dT%H:%M:%SZ'

suite_failed=0
if [[ "$RUN_MODE" == "parallel" ]]; then
  printf 'Starting %d scenarios at once; per-script timeout: %ss\n' "${#SCRIPTS[@]}" "$SCRIPT_TIMEOUT"
  pids=()
  for script in "${SCRIPTS[@]}"; do
    run_scenario "$script" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || suite_failed=1
  done
else
  printf 'Running %d scenarios sequentially; gap: %ss; per-script timeout: %ss\n' \
    "${#SCRIPTS[@]}" "$GAP" "$SCRIPT_TIMEOUT"
  for index in "${!SCRIPTS[@]}"; do
    run_scenario "${SCRIPTS[$index]}" || suite_failed=1
    if [[ "$index" -lt "$(( ${#SCRIPTS[@]} - 1 ))" && "$GAP" -gt 0 ]]; then
      sleep "$GAP"
    fi
  done
fi
capture_key_state end
jq -s '{scenarios: .}' "$RUN_DIR"/*/result.json > "$RUN_DIR/results.json"
printf 'Run complete: %s\n' "$RUN_DIR/results.json"
date -u +'%Y-%m-%dT%H:%M:%SZ'
exit "$suite_failed"
