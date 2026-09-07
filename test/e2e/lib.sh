#!/usr/bin/env bash
#
# test/e2e/lib.sh — shared helpers for E2E scenario scripts.
#
# shellcheck disable=SC2034  # E2E_* variables are cross-script globals
# Loop model: headless `pi -p` runs break when the agent-loop model
# needs special compat flags that the catalog/models.json round-trip
# drops (zai glm models emit tool calls as text and pi exits 0
# without executing them; a models.json providers block also breaks
# slash-form defaultModel resolution at startup). kimi-coding/k3
# needs no special flags and is immune, so it is the preferred loop
# model. Pipeline stages stay on OpenRouter in every scenario; the
# loop model only composes the tool call. See docs/BENCHMARKS.md,
# Confounds And Limitations, for the full diagnosis.
#
# Retry: exit 0 is not proof the pipeline ran (the print-mode
# tool-call leak), so e2e_run_pi retries any attempt that did not
# write a fresh .search meta.json sidecar.
#
# Requires: OPENROUTER_API_KEY, jq, E2E_EXTENSION_PATH (set by the
# caller before e2e_run_pi).

# e2e_setup_loop_model — sets E2E_LOOP_PROVIDER, E2E_LOOP_MODEL, and
# E2E_AUTH_JSON (the OpenRouter key plus the loop provider's auth
# entry). Set E2E_LOOP_MODEL_ID (form provider/model) before calling
# to override the loop model; settings.json should then use the split
# "defaultProvider"/"defaultModel" form with these variables.
e2e_setup_loop_model() {
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "e2e_setup_loop_model: OPENROUTER_API_KEY is not set" >&2
    return 1
  fi
  local loop_model_id="${E2E_LOOP_MODEL_ID:-}"
  if [[ -z "${loop_model_id}" ]]; then
    loop_model_id="openrouter/google/gemini-3.8-flash"
    if [[ -f "${HOME}/.pi/agent/auth.json" ]] \
       && jq -e 'has("kimi-coding")' "${HOME}/.pi/agent/auth.json" >/dev/null 2>&1; then
      loop_model_id="kimi-coding/k3"
    fi
  fi
  E2E_LOOP_PROVIDER="${loop_model_id%%/*}"
  E2E_LOOP_MODEL="${loop_model_id#*/}"
  E2E_AUTH_JSON="$(jq -cn --arg k "${OPENROUTER_API_KEY}" '{openrouter:{type:"api_key",key:$k}}')"
  if [[ "${E2E_LOOP_PROVIDER}" != "openrouter" ]]; then
    local loop_entry
    if [[ ! -f "${HOME}/.pi/agent/auth.json" ]] \
       || ! loop_entry="$(jq --arg p "${E2E_LOOP_PROVIDER}" '.[$p] // empty' "${HOME}/.pi/agent/auth.json" 2>/dev/null)" \
       || [[ -z "${loop_entry}" || "${loop_entry}" == "null" ]]; then
      echo "e2e_setup_loop_model: E2E_LOOP_MODEL_ID=${loop_model_id} but no ${E2E_LOOP_PROVIDER} key in ~/.pi/agent/auth.json" >&2
      return 1
    fi
    E2E_AUTH_JSON="$(jq -cn --argjson a "${E2E_AUTH_JSON}" --argjson b "${loop_entry}" --arg p "${E2E_LOOP_PROVIDER}" '$a + {($p): $b}')"
  fi
  echo "▶ Agent-loop model: ${E2E_LOOP_PROVIDER}/${E2E_LOOP_MODEL} (pipeline stages: OpenRouter)"
}

# e2e_write_auth <agent_dir> — write the merged auth.json.
e2e_write_auth() {
  printf '%s' "${E2E_AUTH_JSON}" > "$1/auth.json"
}

# e2e_run_pi <agent_dir> <cwd> <prompt> [timeout_s]
# Runs headless pi with the standard E2E flags, retrying (up to 3
# attempts, 30s apart) while no fresh .search meta.json sidecar
# appears. Freshness is judged against a reference file created before
# the first attempt, so back-to-back scenarios sharing a cwd only
# count their own run. Sets E2E_LAST_OUTPUT to the last attempt's
# output. Returns 0 only when a new sidecar was written.
e2e_run_pi() {
  local agent="$1" cwd="$2" prompt="$3" tmo="${4:-${E2E_TIMEOUT_SECONDS:-360}}"
  local attempt out ec ran ref
  ref="$(mktemp)"
  for attempt in 1 2 3; do
    out="$(
      cd "$cwd"
      PI_CODING_AGENT_DIR="$agent" \
        timeout --foreground "${tmo}s" pi \
          --no-extensions --no-skills --no-prompt-templates \
          --no-context-files --no-session \
          -e "${E2E_EXTENSION_PATH}" \
          -p "${prompt}" 2>&1
    )" && ec=0 || ec=$?
    ran=0
    if [[ "${ec}" -eq 0 ]]; then
      # Exit 0 is not proof the pipeline ran: probe for a fresh sidecar.
      if find "${cwd}" -maxdepth 4 -name meta.json -newer "${ref}" -print -quit 2>/dev/null | grep -q .; then
        ran=1
      fi
    fi
    if [[ "${ran}" -eq 1 ]]; then
      rm -f "${ref}"
      E2E_LAST_OUTPUT="${out}"
      return 0
    fi
    echo "   ⚠️  pi attempt ${attempt}/3 failed (exit ${ec}, cache written: ${ran}); retrying after 30s" >&2
    sleep 30
  done
  rm -f "${ref}"
  E2E_LAST_OUTPUT="${out}"
  return 1
}
