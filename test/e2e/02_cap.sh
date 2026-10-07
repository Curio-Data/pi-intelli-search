#!/usr/bin/env bash
# Verify requested-page limits and the omitted-maxUrls default through real tools.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS
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
for scenario in cap default; do
  AGENT="$ROOT/$scenario/agent"
  WORKSPACE="$ROOT/$scenario/workspace"
  mkdir -p "$AGENT/sessions" "$WORKSPACE"
  e2e_write_auth "$AGENT"
  if [[ "$scenario" == cap ]]; then
    DEFAULT=8; CAP=3
    PROMPT='Call intelli_research exactly once with maxUrls=12 and focusPrompt="Official release version and date": what is the latest Node.js LTS version?'
  else
    DEFAULT=3; CAP=6
    PROMPT='Call intelli_research exactly once to find the current TypeScript version, with focusPrompt="Official version and date". Omit maxUrls entirely: this test verifies the configured default. Do not set it even if the skill normally recommends a value.'
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
  # shellcheck disable=SC2034
  E2E_TRACE_FILE="$ROOT/$scenario/trace.jsonl"
  e2e_run_pi "$AGENT" "$WORKSPACE" "$PROMPT"
  e2e_verify_page_budget "$WORKSPACE/.search" "$E2E_TRACE_FILE" "$scenario"
  echo "✅ $scenario: completed research, positive artefacts, correct tool arguments and requested-page budget"
  if [[ "$scenario" == cap ]]; then sleep "${E2E_RUN_GAP_SECONDS:-30}"; fi
done
echo "✅ E2E cap test PASSED"
