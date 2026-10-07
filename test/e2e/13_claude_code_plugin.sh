#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
#
# Credentialed Claude Code plugin and unforced routing evaluation.
# Installs the local-tarball plugin into an isolated profile, supplies its
# sensitive key option, and runs four fresh sessions. Scenario 12 separately
# covers credential-free installation. No prompt names the desired operation;
# both search and research remain available in every session.
#
# Usage: ./test/e2e/13_claude_code_plugin.sh
# Environment:
#   OPENROUTER_API_KEY       Required; .env or native auth.json fallback.
#   CLAUDE_CODE_OAUTH_TOKEN  Required static token from claude setup-token.
#   E2E_CLAUDE_MODEL         Session model (default: sonnet).
#   E2E_TIMEOUT_SECONDS      Factual-session timeout (default: 180).
#   E2E_RESEARCH_TIMEOUT_SECONDS  Deep-analysis timeout (default: 540).
#   E2E_RUN_GAP_SECONDS      Gap between sessions (default: 20).
#   E2E_KEEP_ARTIFACTS       Set to 1 to retain successful traces; plugin
#                            credential file is always removed.
#
# Never copy login credentials: a copied refresh-token chain can invalidate
# the operator's login. The static token is never stored or refreshed.
# Live quota: three searches and deep research capped at three pages per
# call, plus four Claude sessions. Deep analysis may need follow-up calls.
# Run through ./test/run-e2e-all.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [[ "$(uname -s)" != Linux ]]; then
  echo "SKIP: scenario 13 is recorded for Linux hosts only."
  exit 77
fi

# Parse only the named keys before logging. Never execute .env.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY CLAUDE_CODE_OAUTH_TOKEN
LOG_DIR="$PROJECT_DIR/.e2e-logs"
LOG_FILE="$LOG_DIR/e2e-claude-code-plugin-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Log: $LOG_FILE"

# Deep analysis can need multiple operations; give it a longer deadline.
# The paced runner also enforces its own overall per-script timeout.
E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-180}"
E2E_RESEARCH_TIMEOUT_SECONDS="${E2E_RESEARCH_TIMEOUT_SECONDS:-540}"
E2E_RUN_GAP_SECONDS="${E2E_RUN_GAP_SECONDS:-20}"
E2E_KEEP_ARTIFACTS="${E2E_KEEP_ARTIFACTS:-0}"
E2E_CLAUDE_MODEL="${E2E_CLAUDE_MODEL:-sonnet}"
[[ "$E2E_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ && "$E2E_RESEARCH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ && "$E2E_RUN_GAP_SECONDS" =~ ^[0-9]+$ ]] || {
  echo "Invalid session timeout or gap" >&2
  exit 1
}
if [[ -z "${OPENROUTER_API_KEY:-}" && -f "$HOME/.pi/agent/auth.json" ]]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json")"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" || -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
  echo "OPENROUTER_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are required."
  echo "Create the static token with 'claude setup-token' outside an agent session."
  exit 1
fi
# printf builds the option JSON without placing the secret in process argv.
[[ "$OPENROUTER_API_KEY" =~ ^[A-Za-z0-9_-]+$ ]] || {
  echo "OPENROUTER_API_KEY contains unexpected characters."
  exit 1
}
for tool in claude node npm jq rg; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool"; exit 1; }
done
OPTION_KEY="$OPENROUTER_API_KEY"
unset OPENROUTER_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
export CLAUDE_CODE_OAUTH_TOKEN

mkdir -p "$PROJECT_DIR/.tmp"
E2E_ROOT="$(mktemp -d "$PROJECT_DIR/.tmp/intelli-claude-e2e-XXXXXXXX")"
CLAUDE_HOME_DIR="$E2E_ROOT/claude-home"
WORKSPACE="$E2E_ROOT/workspace"
mkdir -p "$CLAUDE_HOME_DIR" "$WORKSPACE" "$E2E_ROOT/tmp"
export TMPDIR="$E2E_ROOT/tmp"
echo "Scratch: $E2E_ROOT"
OPERATOR_CREDENTIALS="$HOME/.claude/.credentials.json"
OPERATOR_MTIME="$(stat -c %Y "$OPERATOR_CREDENTIALS" 2>/dev/null || echo absent)"
cleanup() {
  local rc=$?
  # The plugin secret is removed on success and failure, including retained runs.
  rm -f "$CLAUDE_HOME_DIR/.credentials.json"
  if [[ "$rc" -eq 0 && "$E2E_KEEP_ARTIFACTS" != 1 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ERRORS=0
ok() { echo "PASS: $1"; }
bad() { ERRORS=$((ERRORS + 1)); echo "FAIL: $1"; }
export CLAUDE_CONFIG_DIR="$CLAUDE_HOME_DIR"

echo "Claude $(claude --version), requested model: $E2E_CLAUDE_MODEL"
AUTH_STATUS="$(claude auth status 2>/dev/null || true)"
if ! jq -e '.authMethod == "oauth_token"' <<<"$AUTH_STATUS" >/dev/null; then
  echo "Isolated profile is not authenticating with the static OAuth token."
  exit 1
fi
ok "isolated profile authenticates with CLAUDE_CODE_OAUTH_TOKEN"

(cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
mkdir -p "$E2E_ROOT/pack"
TARBALL="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$E2E_ROOT/pack" 2>/dev/null | tail -1)"
TARBALL="$E2E_ROOT/pack/$(basename "$TARBALL")"
WORK="$E2E_ROOT/bundles"
node "$PROJECT_DIR/scripts/generate-plugin-bundles.mjs" \
  --mode tarball --output "$WORK" \
  --codex-vendor-dir "$WORK/plugins/codex/vendor" >/dev/null
npm install --prefix "$WORK/plugins/claude-code/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
claude plugin marketplace add "$WORK" >/dev/null 2>&1
if ! claude plugin install intelli-search@curio-data-plugins > "$E2E_ROOT/plugin-install.log" 2>&1; then
  echo "Plugin install failed; inspect $E2E_ROOT/plugin-install.log"
  exit 1
fi
ok "plugin installed from $(basename "$TARBALL")"
if ! printf '{"openrouter_api_key":"%s"}' "$OPTION_KEY" \
    | claude plugin configure intelli-search@curio-data-plugins --values-stdin >/dev/null 2>&1; then
  echo "Plugin key configuration failed."
  exit 1
fi
unset OPTION_KEY
if ! jq -e '.pluginSecrets["intelli-search@curio-data-plugins"].openrouter_api_key | length > 0' \
    "$CLAUDE_HOME_DIR/.credentials.json" >/dev/null 2>&1; then
  echo "Plugin key did not reach the isolated credential store."
  exit 1
fi
PLUGIN_DATA="$CLAUDE_HOME_DIR/plugins/data/intelli-search-curio-data-plugins"
mkdir -p "$PLUGIN_DATA"
cat > "$PLUGIN_DATA/config.json" <<'EOF'
{
  "providers": {
    "openrouter": {
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  },
  "models": {
    "search": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extract": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collate": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  },
  "tuning": {
    "defaultUrls": 3,
    "maxUrls": 3
  }
}
EOF
ok "key option and bounded research configuration set"

# Each case gets an empty workspace and fresh session. Disabling skills in
# the first case exercises server instructions and descriptions on their own.
# Pre-allow every plugin tool (and Skill), not only the expected winner.
PREFIX="mcp__plugin_intelli-search_intelli_search__"
for CASE in descriptions-only factual-auto factual-explicit comparison-auto; do
  EXPECTED=intelli_search
  SKILL_MODE=required
  CASE_TIMEOUT="$E2E_TIMEOUT_SECONDS"
  FLAGS=()
  case "$CASE" in
    descriptions-only)
      PROMPT='Using intelli search, what is the latest Nano Banana model release?'
      SKILL_MODE=disabled
      FLAGS+=(--disable-slash-commands)
      ;;
    factual-auto)
      PROMPT='Using intelli search, what is the latest Nano Banana model release?'
      ;;
    factual-explicit)
      PROMPT='First load the intelli-search:intelli-search skill. Using intelli search, what is the latest stable TypeScript release?'
      ;;
    comparison-auto)
      PROMPT='Using intelli search, compare SQLite WAL and rollback journal modes for a small multi-user application. Analyse reader/writer concurrency, checkpointing and filesystem constraints using multiple official documentation pages, and explain the tradeoffs.'
      EXPECTED=intelli_research
      CASE_TIMEOUT="$E2E_RESEARCH_TIMEOUT_SECONDS"
      ;;
  esac
  CASE_WORKSPACE="$WORKSPACE/$CASE"
  mkdir -p "$CASE_WORKSPACE"
  STREAM="$E2E_ROOT/$CASE.jsonl"
  echo "Case: $CASE"
  # No automatic retries: a failed routing decision must remain a failure.
  if ! (cd "$CASE_WORKSPACE" && timeout --foreground "${CASE_TIMEOUT}s" \
      claude -p "$PROMPT" --model "$E2E_CLAUDE_MODEL" \
      --output-format stream-json --verbose --no-session-persistence \
      --allowedTools "Skill,${PREFIX}intelli_search,${PREFIX}intelli_research,${PREFIX}intelli_extract,${PREFIX}intelli_collate" \
      "${FLAGS[@]}" > "$STREAM" 2> "$E2E_ROOT/$CASE.stderr"); then
    bad "$CASE: session process failed or timed out"
  fi
  if node "$PROJECT_DIR/test/helpers/claude-routing.mjs" "$STREAM" "$EXPECTED" "$SKILL_MODE"; then
    ok "$CASE: discovery, invocation, routing and model-visible result"
  else
    bad "$CASE: transcript verification"
  fi
  if [[ "$EXPECTED" == intelli_research ]]; then
    # Deep analysis may follow up on a real evidence gap. Check every sidecar.
    META_FILES=()
    if [[ -d "$CASE_WORKSPACE/.search" ]]; then
      mapfile -t META_FILES < <(find "$CASE_WORKSPACE/.search" -mindepth 2 -maxdepth 2 -name meta.json)
    fi
    VERSION="$(jq -r .version "$PROJECT_DIR/packages/mcp/package.json")"
    if [[ "${#META_FILES[@]}" -eq 0 ]]; then bad "$CASE: no research sidecar"; fi
    for META in "${META_FILES[@]}"; do
      if jq -e --arg v "$VERSION" \
          '.adapter == "mcp" and .extensionVersion == $v and .outcome == "completed" and (.stages.fetch.requested | type == "number") and .stages.fetch.requested > 0 and .stages.fetch.requested <= 3 and (.stages.extract.succeeded | type == "number") and .stages.extract.succeeded > 0' \
          "$META" >/dev/null && [[ -s "${META%/meta.json}/report.md" ]]; then
        ok "$CASE: completed research, current package and configured page cap"
      else
        bad "$CASE: invalid research artefacts"
      fi
    done
  elif [[ -d "$CASE_WORKSPACE/.search" ]]; then
    bad "$CASE: quick lookup unexpectedly created a research cache"
  fi
  if [[ "$CASE" != comparison-auto ]]; then sleep "$E2E_RUN_GAP_SECONDS"; fi
done

# The credential file exists because key configuration was asserted above.
if jq -e 'has("claudeAiOauth")' "$CLAUDE_HOME_DIR/.credentials.json" >/dev/null; then
  bad "isolated profile received a login credential"
else
  ok "isolated profile holds no login credential"
fi
if [[ "$(stat -c %Y "$OPERATOR_CREDENTIALS" 2>/dev/null || echo absent)" == "$OPERATOR_MTIME" ]]; then
  ok "operator credential file untouched"
else
  bad "operator credential file changed during the run"
fi
if [[ "$ERRORS" -ne 0 ]]; then
  echo "CLAUDE CODE PLUGIN SESSION FAILED ($ERRORS checks)"
  exit 1
fi
echo "CLAUDE CODE PLUGIN SESSION PASSED"
