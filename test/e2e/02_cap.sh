#!/usr/bin/env bash
# Verify requested-page limits and the omitted-maxUrls default through real tools.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL E2E_TIMEOUT_SECONDS \
  E2E_RETRY_GAP_SECONDS
export TMPDIR="${TMPDIR:-$PROJECT_DIR/.tmp/e2e}"
mkdir -p "$TMPDIR" "$PROJECT_DIR/.e2e-logs"
LOG_FILE="$PROJECT_DIR/.e2e-logs/e2e-cap-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
if [[ -z "${OPENROUTER_API_KEY:-}" && -f "$HOME/.pi/agent/auth.json" ]]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json")"
fi
# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
e2e_setup_loop_model
# shellcheck disable=SC2034
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
ROOT="$(mktemp -d "$TMPDIR/cap-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
# run_case <scenario>: one isolated case with its own agent directory,
# workspace and trace. Both cases start together; each workspace is private,
# so neither can count the other's sidecar.
run_case() {
  local scenario="$1" AGENT WORKSPACE DEFAULT CAP ARGS
  AGENT="$ROOT/$scenario/agent"
  WORKSPACE="$ROOT/$scenario/workspace"
  mkdir -p "$AGENT/sessions" "$WORKSPACE"
  e2e_write_auth "$AGENT"
  if [[ "$scenario" == cap ]]; then
    DEFAULT=8; CAP=3
    ARGS='{"query":"What is the latest Node.js LTS version?","maxUrls":12,"focusPrompt":"Official release version and date"}'
  else
    DEFAULT=3; CAP=6
    ARGS='{"query":"What is the current TypeScript version?","focusPrompt":"Official version and date"}'
  fi
  jq -n --arg provider "$E2E_LOOP_PROVIDER" --arg model "$E2E_LOOP_MODEL" \
    --argjson default "$DEFAULT" --argjson cap "$CAP" '{
    defaultProvider: $provider, defaultModel: $model,
    "pi-intelli-search": {
      searchModel: {provider:"openrouter",model:"perplexity/sonar"},
      extractModel: {provider:"openrouter",model:"minimax/minimax-m3"},
      collateModel: {provider:"openrouter",model:"minimax/minimax-m3"},
      defaultUrls:$default, maxUrls:$cap, cacheDir:".search"
    }}' > "$AGENT/settings.json"
  printf '{}\n' > "$AGENT/models.json"
  E2E_TRACE_FILE="$ROOT/$scenario/trace.jsonl"
  # Measure the tool's cap/default, not whether an agent follows an exact-argument prompt.
  e2e_run_direct "$AGENT" "$WORKSPACE" intelli_research "$ARGS" || return 1
  printf '%s\n' "$E2E_LAST_OUTPUT" > "$E2E_TRACE_FILE"
  if [[ -n "${E2E_TRACE_DIR:-}" ]]; then
    mkdir -p "$E2E_TRACE_DIR"
    cp "$E2E_TRACE_FILE" "$E2E_TRACE_DIR/$scenario.jsonl"
  fi
  e2e_verify_page_budget "$WORKSPACE/.search" "$E2E_TRACE_FILE" "$scenario"
  echo "✅ $scenario: completed research, positive artefacts, correct tool arguments and requested-page budget"
}
run_case cap & CAP_PID=$!
run_case default & DEFAULT_PID=$!
FAILED=0
wait "$CAP_PID" || { echo "❌ cap case failed"; FAILED=1; }
wait "$DEFAULT_PID" || { echo "❌ default case failed"; FAILED=1; }
[[ "$FAILED" -eq 0 ]] || exit 1
echo "✅ E2E cap test PASSED"
