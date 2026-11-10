#!/usr/bin/env bash
#
# scripts/benchmark-models.sh — A/B benchmark for extract/collate models
#
# Runs the identical intelli_research call (same query, focusPrompt,
# maxUrls) once per requested model, in an isolated agent dir + cwd per
# run, and prints a telemetry comparison table from each run's
# meta.json sidecar. Search stays on Perplexity Sonar; only the
# extract/collate models vary.
#
# Methodology and recorded results: docs/BENCHMARKS.md
#
# Usage:
#   scripts/benchmark-models.sh google/gemini-3.8-flash minimax/minimax-m3
#   scripts/benchmark-models.sh minimax/minimax-m2.7   # single model
#
# Environment:
#   OPENROUTER_API_KEY   Required (auto-detected from ~/.pi/agent/auth.json)
#   BENCH_QUERY          Override the pinned query (default: the 2026-09-07
#                        baseline query; changing it breaks comparability
#                        with the recorded results)
#   BENCH_FOCUS          Override the pinned focusPrompt (same caveat)
#   BENCH_MAX_URLS       Page budget per run (default: 8)
#   BENCH_GAP_SECONDS    Pause between runs (default: 20; operational
#                        pacing, not a measured provider limit)
#   BENCH_BASE_DIR       Artifact root (default: .tmp/bench-<stamp> in the
#                        repository, created owner-only). Keep it on encrypted
#                        storage: each run writes an owner-only auth.json with
#                        provider credentials into its agent dir.
#   BENCH_LOOP_MODEL     The only agent-loop model override (TEST_MODEL is
#                        ignored); must name an API-key login. Default:
#                        test/e2e/lib.sh's choice, qwen-token-plan/qwen3.8-max
#                        when its API key exists, else
#                        openrouter/google/gemini-3.8-flash
#
# The query, focusPrompt, and maxUrls defaults are pinned to the
# 2026-09-07 baseline so new model runs land in the same cache-slug
# series and stay comparable with docs/BENCHMARKS.md. The cache slug is
# a hash of the query, which is how parameter fidelity is verified:
# identical query string => identical slug.
#
# Costs real OpenRouter quota: each run is one Sonar search plus N
# extractions, one collation, and (when the cwd has a populated
# .search index) one cache-suggest call.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT="$PROJECT_DIR/dist/index.js"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <openrouter-model-id> [<openrouter-model-id> ...]" >&2
  echo "  e.g. $0 google/gemini-3.8-flash minimax/minimax-m3" >&2
  exit 1
fi

# ── Pinned benchmark stimulus (2026-09-07 baseline) ────────────────
QUERY='top 10 most popular Svelte components and packages Svelte UI component libraries 2026'
FOCUS='Focus on the most popular and widely-used Svelte component libraries and packages: UI kit libraries (e.g., shadcn-svelte, Skeleton, Flowbite, daisyUI), chart/animation utilities, and npm download statistics or GitHub stars indicating popularity. Include component libraries specifically built for Svelte 5 where relevant.'
QUERY="${BENCH_QUERY:-$QUERY}"
FOCUS="${BENCH_FOCUS:-$FOCUS}"
MAX_URLS="${BENCH_MAX_URLS:-8}"
GAP="${BENCH_GAP_SECONDS:-20}"

# ── Key detection (E2E pattern) ────────────────────────────────────
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
if [[ -z "$OPENROUTER_API_KEY" && -f "$HOME/.pi/agent/auth.json" ]]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // .openrouter.apiKey // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
fi
if [[ -z "$OPENROUTER_API_KEY" ]]; then
  echo "❌ No OpenRouter key found (set OPENROUTER_API_KEY or add one to ~/.pi/agent/auth.json)" >&2
  exit 1
fi

# ── Agent-loop model selection ─────────────────────────────────────
# The agent loop only composes the tool call (parameters are pinned in
# the prompt and verified via the cache slug), but two upstream traps
# make some loop models unusable in print mode once the extension has
# merged its models.json entries and refreshed the registry:
#
#  1. zai glm models need the zaiToolStream compat flag for native
#     tool-call streaming. The models.json round-trip and registry
#     refresh drop it, so glm emits tool calls as text
#     ("functions.<tool>:0{...}") and pi exits 0 without executing.
#  2. A models.json containing a providers block breaks slash-form
#     defaultModel resolution at startup (the loop call is routed to
#     an OpenRouter fallback), so settings use the split
#     defaultProvider + defaultModel form.
#
# Selection, the API-key-only refusal and the credential assembly are the
# E2E harness's own (test/e2e/lib.sh): a copied OAuth login (kimi-coding,
# openai-codex) refreshes and signs the operator out, and credentials go
# to jq on stdin, never on its command line. Pipeline stages (search,
# extract, collate) stay on OpenRouter in every run.
# shellcheck source=test/e2e/lib.sh
source "$PROJECT_DIR/test/e2e/lib.sh"
export OPENROUTER_API_KEY
# Only BENCH_LOOP_MODEL selects the loop: an exported TEST_MODEL must not
# change a pinned benchmark series.
unset TEST_MODEL
E2E_LOOP_MODEL_ID="${BENCH_LOOP_MODEL:-}"
e2e_setup_loop_model || exit 1
loop_provider="${E2E_LOOP_PROVIDER}"
loop_model="${E2E_LOOP_MODEL}"

if [[ ! -f "$EXT" ]]; then
  echo "❌ $EXT missing; run: npm run build" >&2
  exit 1
fi

command -v pi &>/dev/null || { echo "❌ pi is not installed" >&2; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BASE_DIR="${BENCH_BASE_DIR:-$PROJECT_DIR/.tmp/bench-${STAMP}}"
(umask 077; mkdir -p "$BASE_DIR")

run_one() {
  local model_id="$1"
  local label="$2"
  local agent_dir="${BASE_DIR}/${label}/agent"
  local cwd_dir="${BASE_DIR}/${label}/cwd"
  mkdir -p "${agent_dir}/sessions" "${cwd_dir}"

  e2e_write_auth "${agent_dir}"

  # Search pinned to Sonar in every run: only extract/collate vary.
  # defaultUrls/maxUrls pinned so a missing maxUrls in the tool call
  # clamps identically anyway. Split defaultProvider/defaultModel
  # form: a models.json providers block breaks slash-form resolution
  # at startup (see the loop-model note above).
  cat > "${agent_dir}/settings.json" <<EOF
{
  "defaultProvider": "${loop_provider}",
  "defaultModel": "${loop_model}",
  "pi-intelli-search": {
    "searchModel": { "provider": "openrouter", "model": "perplexity/sonar" },
    "extractModel": { "provider": "openrouter", "model": "${model_id}" },
    "collateModel": { "provider": "openrouter", "model": "${model_id}" },
    "defaultUrls": ${MAX_URLS},
    "maxUrls": ${MAX_URLS}
  }
}
EOF
  echo '{}' > "${agent_dir}/models.json"

  # The headless agent composes the tool call; pinning the strings in
  # the prompt keeps parameters verbatim. Fidelity is verified
  # afterwards via the cache slug and query.txt.
  local prompt
  prompt="Call the intelli_research tool exactly once with these parameters, verbatim: query: \"${QUERY}\", maxUrls: ${MAX_URLS}, focusPrompt: \"${FOCUS}\". Do not add, remove, or modify any parameter, do not pass domains. Use no other tools. When the tool result returns, reply with just: DONE."

  echo "▶ [${label}] extract/collate = openrouter/${model_id}"
  # Exit 0 is not proof the pipeline ran: the print-mode OpenRouter
  # loop can leak the tool call as prose (see docs/BENCHMARKS.md). A
  # run only counts when a cache directory exists; retry otherwise.
  local output cache_dir attempt
  cache_dir=""
  for attempt in 1 2 3; do
    output="$(
      cd "${cwd_dir}"
      PI_CODING_AGENT_DIR="${agent_dir}" \
        timeout --foreground 600s pi \
          --no-extensions \
          --no-skills \
          --no-prompt-templates \
          --no-context-files \
          --no-session \
          -e "$EXT" \
          -p "$prompt" \
          2>&1
    )" || true
    cache_dir="$(find "${cwd_dir}/.search" -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2>/dev/null | head -1 || true)"  # skip .staging
    if [[ -n "${cache_dir}" ]]; then
      break
    fi
    echo "⚠️  [${label}] attempt ${attempt}/3: no cache dir written (tool-call leak or failure)" >&2
    if [[ $attempt -lt 3 ]]; then
      sleep 30
    fi
  done
  if [[ -z "${cache_dir}" ]]; then
    echo "❌ [${label}] run failed; no cache dir written" >&2
    echo "${output}" | tail -15 >&2
    RESULTS+=("${label}|FAILED|FAILED|FAILED|FAILED|FAILED|FAILED|FAILED|FAILED")
    return 0
  fi

  # Fidelity check: slug is derived from the query hash.
  local slug query_file
  slug="$(basename "${cache_dir}")"
  query_file="$(cat "${cache_dir}/query.txt" 2>/dev/null || echo '')"
  if [[ "${query_file}" != "${QUERY}" ]]; then
    echo "⚠️  [${label}] query.txt mismatch; parameters were not passed verbatim" >&2
  fi

  jq -r --arg label "$label" --arg slug "$slug" '
    "[\($label)] slug=\($slug) dur=\(.durationMs)ms links=\(.stages.search.linksReturned) annots=\(.stages.search.annotationsHarvested) fetch_ok=\(.stages.fetch.succeeded) fetch_fail=\(.stages.fetch.failed) in=\(.stages.extract.totalInputCharsApprox) out=\(.stages.extract.totalOutputChars) collate=\(.stages.collate.summaryChars) extract_model=\(.stages.extract.model)"
  ' "${cache_dir}/meta.json"
}

declare -a RESULTS=()
declare -a LABELS=()
i=0
for model in "$@"; do
  i=$((i + 1))
  label="run${i}-$(echo "$model" | tr '/' '_')"
  LABELS+=("${label}")
  run_one "$model" "$label"
  RESULTS+=("ok")
  if [[ $i -lt $# && "${GAP}" -gt 0 ]]; then
    echo "… sleeping ${GAP}s (rate-limit pacing)" >&2
    sleep "${GAP}"
  fi
done

echo ""
echo "Artifacts: ${BASE_DIR}/<label>/cwd/.search/<slug>/{report.md,meta.json}"
echo "Record results and methodology in docs/BENCHMARKS.md."
