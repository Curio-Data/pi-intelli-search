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
# write a fresh .search meta.json sidecar. Since `Pi` 1.2.0 the
# reverse also holds: a nonzero exit is not proof the pipeline
# failed, because print mode exits 1 when the agent-loop summary is
# truncated at the output token limit even though the research
# completed. The fresh completed sidecar is the verdict in both
# directions.
#
# Requires: OPENROUTER_API_KEY, jq, E2E_EXTENSION_PATH (set by the
# caller before e2e_run_pi).

# Select the completed canonical run through the cache index. Numbered archive
# siblings can sort ahead of the live run and may contain only a degraded remnant.
e2e_completed_cache_entry() {
  local cache=$1 slug
  [[ -r "$cache/.index.json" ]] || return 0
  while IFS= read -r slug; do
    [[ -n "$slug" ]] || continue
    if jq -e 'select(.outcome == "completed" and .stages.fetch.succeeded > 0 and .stages.collate.summaryChars > 0)' \
      "$cache/$slug/meta.json" >/dev/null 2>&1; then
      printf '%s\n' "$cache/$slug"
      return 0
    fi
  done < <(jq -r '.searches[]?.slug' "$cache/.index.json" 2>/dev/null)
}

# Fail closed: the cap scenario must actually request 12; the default scenario
# must supply no page override. Pi normalises optional nulls to omission, but
# tool_execution_start records the raw arguments. Extractions alone cannot
# prove the number of fetched URLs.
e2e_verify_page_budget() {
  local cache=$1 trace=$2 scenario=$3 slug entry count
  jq -se --arg mode "$scenario" '
    [.[] | select(.type == "tool_execution_start" and .toolName == "intelli_research") | .args] as $calls |
    ($calls | length) == 1 and
    (if $mode == "cap" then $calls[0].maxUrls == 12 else $calls[0].maxUrls == null end)
  ' "$trace" >/dev/null || { echo "❌ incorrect/missing research arguments"; return 1; }
  slug="$(jq -er '.searches | if length == 1 then .[0].slug else error("expected one cache entry") end' "$cache/.index.json")" || return 1
  entry="$cache/$slug"
  [[ -s "$entry/report.md" && -d "$entry/extractions" && -d "$entry/sources" ]] || {
    echo "❌ missing research artefacts"; return 1;
  }
  count="$(find "$entry/extractions" -type f -name '*.md' | wc -l)"
  [[ "$count" -gt 0 && "$count" -le 3 ]] || { echo "❌ invalid extraction count"; return 1; }
  jq -e '.outcome == "completed" and .stages.fetch.requested > 0 and
    .stages.fetch.requested <= 3 and .stages.fetch.succeeded > 0 and
    .stages.extract.succeeded > 0 and .stages.collate.summaryChars > 0' "$entry/meta.json" >/dev/null || {
    echo "❌ wrong requested-page budget or degraded research"; return 1;
  }
}

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
  local operator_auth="${E2E_OPERATOR_AUTH_JSON:-${HOME}/.pi/agent/auth.json}"
  if [[ -z "${loop_model_id}" ]]; then
    loop_model_id="openrouter/google/gemini-3.8-flash"
    if [[ -f "${operator_auth}" ]] \
       && jq -e 'has("kimi-coding")' "${operator_auth}" >/dev/null 2>&1; then
      loop_model_id="kimi-coding/k3"
    fi
  fi
  E2E_LOOP_PROVIDER="${loop_model_id%%/*}"
  E2E_LOOP_MODEL="${loop_model_id#*/}"
  E2E_AUTH_JSON="$(printf '%s' "${OPENROUTER_API_KEY}" | jq -Rs '{openrouter:{type:"api_key",key:.}}')"
  if [[ "${E2E_LOOP_PROVIDER}" != "openrouter" ]]; then
    local loop_entry
    if [[ ! -f "${operator_auth}" ]] \
       || ! loop_entry="$(jq --arg p "${E2E_LOOP_PROVIDER}" '.[$p] // empty' "${operator_auth}" 2>/dev/null)" \
       || [[ -z "${loop_entry}" || "${loop_entry}" == "null" ]]; then
      echo "e2e_setup_loop_model: E2E_LOOP_MODEL_ID=${loop_model_id} but no ${E2E_LOOP_PROVIDER} key in ~/.pi/agent/auth.json" >&2
      return 1
    fi
    E2E_AUTH_JSON="$(printf '%s\n%s\n' "${E2E_AUTH_JSON}" "${loop_entry}" | jq -sc --arg p "${E2E_LOOP_PROVIDER}" '.[0] + {($p): .[1]}')"
  fi
  echo "▶ Agent-loop model: ${E2E_LOOP_PROVIDER}/${E2E_LOOP_MODEL} (pipeline stages: OpenRouter)"
}

# e2e_write_auth <agent_dir> — write the merged auth.json.
e2e_write_auth() {
  (umask 077; printf '%s' "${E2E_AUTH_JSON}" > "$1/auth.json")
}

# Convert machine JSON events to multiline tool and assistant text for scenario
# logs. The raw events remain in E2E_TRACE_DIR; compact output avoids enormous
# single-line transcript events overflowing tee and terminal pipelines.
e2e_compact_json_output() {
  jq -R -r '
    (fromjson? // {type: "raw", raw: .}) as $event |
    if $event.type == "raw" then
      $event.raw
    elif $event.type == "tool_execution_end" then
      $event.result.content[]? | select(.type == "text") | .text
    elif $event.type == "tool_execution_update" then
      $event.partialResult.content[]? | select(.type == "text") | .text
    elif $event.type == "message_end" and $event.message.role == "assistant" then
      ($event.message.content[]? | select(.type == "text") | .text),
      ($event.message.errorMessage // empty)
    else empty end
  ' 2>/dev/null
}

# e2e_run_pi <agent_dir> <cwd> <prompt> [timeout_s]
# Runs headless pi with the standard E2E flags, retrying (up to 3
# attempts, 30s apart) while no fresh .search meta.json sidecar
# appears. Freshness is judged against a reference file created before
# the first attempt, so back-to-back scenarios sharing a cwd only
# count their own run. Sets E2E_LAST_OUTPUT to the last attempt's
# output. Returns 0 only when a fresh completed sidecar records useful work.
e2e_run_pi() {
  local agent="$1" cwd="$2" prompt="$3" tmo="${4:-${E2E_TIMEOUT_SECONDS:-360}}"
  local attempt out ec ran ref trace_file compact
  local mode_args=()
  local trace_extension_args=()
  if [[ -n "${E2E_TRACE_FILE:-}" || -n "${E2E_TRACE_DIR:-}" ]]; then mode_args=(--mode json); fi
  if [[ -n "${E2E_TRACE_EXTENSION_PATH:-}" ]]; then
    trace_extension_args=(-e "${E2E_TRACE_EXTENSION_PATH}")
  fi
  ref="$(mktemp)"
  for attempt in 1 2 3; do
    trace_file="${E2E_TRACE_FILE:-}"
    if [[ -n "${E2E_TRACE_DIR:-}" && -z "${E2E_TRACE_FILE:-}" ]]; then
      mkdir -p "${E2E_TRACE_DIR}"
      E2E_TRACE_SEQUENCE=$(( ${E2E_TRACE_SEQUENCE:-0} + 1 ))
      printf -v trace_file '%s/%03d-attempt-%d.jsonl' \
        "${E2E_TRACE_DIR}" "${E2E_TRACE_SEQUENCE}" "${attempt}"
    fi
    out="$(
      cd "$cwd"
      PI_CODING_AGENT_DIR="$agent" \
        timeout --foreground "${tmo}s" pi \
          --no-extensions --no-skills --no-prompt-templates \
          --no-context-files --no-session \
          -e "${E2E_EXTENSION_PATH}" "${trace_extension_args[@]}" "${mode_args[@]}" \
          -p "${prompt}" 2>&1
    )" && ec=0 || ec=$?
    if [[ -n "${trace_file}" ]]; then
      printf '%s\n' "$out" > "${trace_file}"
      E2E_LAST_TRACE_FILE="${trace_file}"
    fi
    if [[ "${E2E_COMPACT_JSON_OUTPUT:-0}" == "1" && -n "${E2E_TRACE_DIR:-}" && -z "${E2E_TRACE_FILE:-}" ]]; then
      compact="$(printf '%s\n' "$out" | e2e_compact_json_output)"
      if [[ -n "${compact}" ]]; then out="${compact}"; fi
    fi
    ran=0
    # The fresh completed sidecar decides the research verdict, not the exit
    # code. Keep the process outcome visible: a completed research can still
    # be followed by an agent-loop timeout or print-mode truncation.
    if find "${cwd}" -maxdepth 4 -name meta.json -newer "${ref}" \
      -exec jq -e 'select(.outcome == "completed" and .stages.fetch.succeeded > 0 and .stages.collate.summaryChars > 0)' {} \; \
      -print -quit 2>/dev/null | grep -q '^/'; then
      ran=1
    fi
    E2E_LAST_EXIT_CODE="${ec}"
    E2E_LAST_TIMED_OUT=0
    if [[ "${ec}" -eq 124 ]]; then E2E_LAST_TIMED_OUT=1; fi
    if [[ "${ran}" -eq 1 ]]; then
      rm -f "${ref}"
      E2E_LAST_OUTPUT="${out}"
      if [[ "${ec}" -eq 124 ]]; then
        echo "   ⚠️  pi attempt ${attempt} TIMED OUT after ${tmo}s but wrote a fresh completed sidecar; research accepted, agent-loop timeout recorded" >&2
      elif [[ "${ec}" -ne 0 ]]; then
        if printf '%s' "${out}" | grep -q "Response was truncated"; then
          echo "   ℹ️  pi attempt ${attempt} exited ${ec} after print-mode truncation but wrote a fresh completed sidecar; accepted" >&2
        else
          echo "   ℹ️  pi attempt ${attempt} exited ${ec} but wrote a fresh completed sidecar; research accepted, nonzero agent-loop exit recorded" >&2
        fi
      fi
      return 0
    fi
    if [[ "${ec}" -eq 124 ]]; then
      echo "   ⚠️  pi attempt ${attempt}/3 TIMED OUT after ${tmo}s without a completed sidecar" >&2
    elif printf '%s' "${out}" | grep -q "Response was truncated"; then
      echo "   ⚠️  pi attempt ${attempt}/3 truncated without a completed sidecar" >&2
    else
      echo "   ⚠️  pi attempt ${attempt}/3 failed (exit ${ec}; no completed sidecar)" >&2
    fi
    if [[ "${attempt}" -lt 3 ]]; then
      echo "   ⏳ retrying after 30s" >&2
      sleep 30
    fi
  done
  rm -f "${ref}"
  E2E_LAST_OUTPUT="${out}"
  return 1
}
