#!/usr/bin/env bash
# Verify requested-page limits and the omitted-maxUrls default through real tools.
#
# Cases: cap (maxUrls=12 requested, clamped to the configured cap of 3) and
# default (maxUrls omitted, configured defaultUrls of 3 applies). Standalone,
# both run in turn. E2E_CAP_CASE=cap|default runs one case, which is required
# when E2E_WORKSPACE names a unit workspace.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY TEST_MODEL E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS
export TMPDIR="${TMPDIR:-$PROJECT_DIR/.tmp/e2e}"
mkdir -p "$TMPDIR"
# shellcheck source=test/e2e/lib.sh
source "$SCRIPT_DIR/lib.sh"
e2e_require_one_case E2E_CAP_CASE cap default
# Configuration unit: by default the research call is made exactly, through
# the host's registered-tool pipeline with no agent-loop model call
# (lib.sh, direct-tool.mjs). auto falls back to the agent loop only when the
# host lacks that API, and says so; direct refuses to fall back; agent keeps
# the natural-language prompt.
E2E_INVOCATION="${E2E_INVOCATION:-auto}"
e2e_init_log e2e-cap
e2e_attach_log
echo "📝 Log: $LOG_FILE"
if [[ -z "${OPENROUTER_API_KEY:-}" && -f "$HOME/.pi/agent/auth.json" ]]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json")"
fi
e2e_setup_loop_model
# shellcheck disable=SC2034
E2E_EXTENSION_PATH="${E2E_EXTENSION_PATH:-$PROJECT_DIR/dist/index.js}"
trap e2e_cleanup EXIT

CASES=(cap default)
AGENT=""
WORKSPACE=""
if [[ -n "${E2E_CAP_CASE:-}" ]]; then CASES=("$E2E_CAP_CASE"); fi

for scenario in "${CASES[@]}"; do
  e2e_private_dir AGENT "cap-${scenario}-agent"
  e2e_unit_workspace WORKSPACE "cap-${scenario}"
  mkdir -p "$AGENT/sessions"
  e2e_write_auth "$AGENT"
  if [[ "$scenario" == cap ]]; then
    DEFAULT=8; CAP=3
    PROMPT='Call intelli_research exactly once with maxUrls=12 and focusPrompt="Official release version and date": what is the latest Node.js LTS version?'
    E2E_EXPECT_ARGS='{"maxUrls":12,"focusPrompt":"Official release version and date"}'
    E2E_RESEARCH_QUERY="what is the latest Node.js LTS version?"
  else
    DEFAULT=3; CAP=6
    PROMPT='Call intelli_research exactly once to find the current TypeScript version, with focusPrompt="Official version and date". Omit maxUrls entirely: this test verifies the configured default. Do not set it even if the skill normally recommends a value.'
    E2E_EXPECT_ARGS='{"maxUrls":null,"focusPrompt":"Official version and date"}'
    E2E_RESEARCH_QUERY="the current TypeScript version"
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
  E2E_EXPECT_CACHE_DIR=".search"
  E2E_ATTEMPT_PREFIX="${scenario}-"
  if ! e2e_run_pi "$AGENT" "$WORKSPACE" "$PROMPT"; then
    echo "❌ $scenario: ${E2E_LAST_VERDICT_REASON:-no completed research after retries} (verdict: ${E2E_LAST_VERDICT_FILE:-none})"
    exit 1
  fi
  e2e_verify_page_budget "$E2E_BOUND_ENTRY" "$E2E_LAST_TRACE_FILE" "$scenario"
  echo "✅ $scenario: completed research, positive artefacts, correct tool arguments and requested-page budget"
  if [[ "$scenario" == cap && "${#CASES[@]}" -gt 1 ]]; then sleep "${E2E_RUN_GAP_SECONDS:-30}"; fi
done
if [[ "${#CASES[@]}" -gt 1 ]]; then
  echo "✅ E2E cap test PASSED"
else
  echo "✅ E2E cap test PASSED (case: ${CASES[0]})"
fi
