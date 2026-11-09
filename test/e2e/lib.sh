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
# model when the operator holds an api_key entry for it. Pipeline
# stages stay on OpenRouter in every scenario; the loop model only
# composes the tool call. See docs/BENCHMARKS.md, Confounds And
# Limitations, for the full diagnosis.
#
# Verdict: neither the exit code nor "some completed sidecar under the
# working directory" proves that this attempt did the research. Print mode
# can exit 0 without executing the tool, and since `Pi` 1.2.0 it exits 1
# after a completed research when the summary is truncated. A sidecar found
# by scanning can belong to another scenario, an earlier attempt or an
# archive. e2e_run_pi therefore binds each attempt to its own research call
# through scenario-verdict.mjs: exactly one call, the prompted arguments,
# and the fresh completed sidecar at the cache path that call returned,
# directly inside the unit's expected cache root.
#
# Unit interface (all optional; standalone defaults are unchanged):
#   E2E_WORKSPACE      Working directory owned by this unit. Must be empty.
#                      Kept after the run; the caller owns it.
#   E2E_LOG_ROOT       Directory for the scenario log (default .e2e-logs).
#   E2E_TRACE_DIR      Directory for per-attempt event, stderr and verdict
#                      files (default: beside the log file).
#   E2E_EXTENSION_PATH Native extension entry (default dist/index.js).
#   E2E_TRACE_EXTENSION_PATH  Optional tracer extension.
#
# Requires: OPENROUTER_API_KEY, jq, node.

E2E_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_VERDICT_HELPER="${E2E_LIB_DIR}/scenario-verdict.mjs"
E2E_DIRECT_DRIVER="${E2E_LIB_DIR}/direct-tool.mjs"
E2E_CLEANUP_PATHS=()

# e2e_init_log <name> — choose this scenario's log and attempt directory. Sets
# LOG_DIR, LOG_FILE and E2E_ATTEMPT_DIR; call e2e_attach_log next.
#
# E2E_LOG_FILE names the log outright: the parallel runner sets it to the
# `scenario.log` its supervisor already captures. Otherwise a new log is
# created exclusively under E2E_LOG_ROOT (default .e2e-logs).
e2e_init_log() {
  local name=$1
  if [[ -n "${E2E_LOG_FILE:-}" ]]; then
    LOG_FILE="$E2E_LOG_FILE"
    LOG_DIR="$(dirname "$LOG_FILE")"
    mkdir -p "$LOG_DIR"
    [[ -e "$LOG_FILE" ]] || : >>"$LOG_FILE"
  else
    LOG_DIR="${E2E_LOG_ROOT:-${PROJECT_DIR}/.e2e-logs}"
    mkdir -p "$LOG_DIR"
    # Exclusive creation; --suffix keeps the X run at the end of the template.
    LOG_FILE="$(mktemp --suffix=.log "${LOG_DIR}/${name}-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  fi
  E2E_ATTEMPT_DIR="${E2E_TRACE_DIR:-${LOG_FILE%.log}-attempts}"
}

# e2e_stdout_is_log — true when this shell's stdout already writes LOG_FILE
# (the supervisor's capture), compared by device and inode.
e2e_stdout_is_log() {
  local out
  out="$(stat -L -c '%d:%i' /dev/stdout 2>/dev/null)" || return 1
  [[ -n "$out" && "$out" == "$(stat -L -c '%d:%i' "$LOG_FILE" 2>/dev/null)" ]]
}

# e2e_attach_log — send this scenario's output to LOG_FILE.
#   Supervised (E2E_SUPERVISED=1): no process-substitution descendant may
#   outlive the script. When stdout already is the log (the supervisor's
#   captured scenario.log) nothing changes, so the supervisor's file stays the
#   one complete record; otherwise output is appended to the log.
#   Standalone: output is tee'd, so it reaches both the console and the log.
e2e_attach_log() {
  if [[ "${E2E_SUPERVISED:-0}" == "1" ]]; then
    if ! e2e_stdout_is_log; then
      exec >>"$LOG_FILE" 2>&1
    fi
  else
    exec > >(tee -a "$LOG_FILE") 2>&1
  fi
}

# e2e_private_dir <var> <label> — a private temporary directory removed by
# e2e_cleanup. Assigns the path to <var> (never use command substitution:
# the cleanup list must be updated in this shell).
e2e_private_dir() {
  local __var=$1 label=$2 dir
  dir="$(mktemp -d -t "pi-e2e-${label}-XXXXXX")"
  E2E_CLEANUP_PATHS+=("$dir")
  printf -v "$__var" '%s' "$dir"
}

# e2e_unit_workspace <var> <label> — the unit's working directory. With
# E2E_WORKSPACE set it must be empty (a stale sidecar there would be read as
# this unit's evidence) and is kept for the caller; otherwise a private
# temporary directory is created and removed on exit.
e2e_unit_workspace() {
  local __var=$1 label=$2 dir
  if [[ -n "${E2E_WORKSPACE:-}" ]]; then
    mkdir -p "$E2E_WORKSPACE"
    if [[ -n "$(find "$E2E_WORKSPACE" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      echo "❌ E2E_WORKSPACE is not empty: $E2E_WORKSPACE" >&2
      return 1
    fi
    dir="$(cd "$E2E_WORKSPACE" && pwd -P)"
    printf -v "$__var" '%s' "$dir"
  else
    e2e_private_dir "$__var" "$label"
  fi
}

# e2e_cleanup — remove only the private directories this shell created.
e2e_cleanup() {
  local path
  for path in "${E2E_CLEANUP_PATHS[@]}"; do
    [[ -n "$path" ]] && rm -rf -- "$path"
  done
}

# e2e_require_one_case <variable> <value...> — with E2E_WORKSPACE set, a
# decomposed scenario must run exactly one named case, or several cases would
# share one workspace.
e2e_require_one_case() {
  local name=$1 value="${!1:-}" allowed
  shift
  if [[ -z "$value" ]]; then
    if [[ -n "${E2E_WORKSPACE:-}" ]]; then
      echo "❌ E2E_WORKSPACE is set but $name is not: one unit workspace cannot hold several cases" >&2
      return 1
    fi
    return 0
  fi
  for allowed in "$@"; do
    [[ "$value" == "$allowed" ]] && return 0
  done
  echo "❌ $name=$value is not one of: $*" >&2
  return 1
}

# e2e_meta <jq_path> — read a value from the sidecar bound by the last
# successful e2e_run_pi (empty when absent).
e2e_meta() {
  [[ -n "${E2E_BOUND_ENTRY:-}" && -f "${E2E_BOUND_ENTRY}/meta.json" ]] || { echo ""; return 1; }
  jq -r "$1 // empty" "${E2E_BOUND_ENTRY}/meta.json" 2>/dev/null
}

# e2e_assert_meta <label> <jq_path> <expected> — exact effective value in the
# bound sidecar; increments ERRORS on mismatch.
e2e_assert_meta() {
  local label=$1 path=$2 expected=$3 actual
  actual="$(e2e_meta "$path" || true)"
  if [[ "$actual" == "$expected" ]]; then
    echo "   ✅ $label = $expected"
  else
    echo "   ❌ $label: got '${actual:-<missing>}', expected '$expected'"
    ERRORS=$((ERRORS + 1))
  fi
}

# e2e_scoped_server_env <root> <workspace> — scenario 12's key-delivery probe.
# For each running mcp-intelli-search CLI, read /proc/<pid>/cmdline first and
# skip the process unless it runs a file under <root> (as given or as its
# physical path). Only then read its environment; when INTELLI_SEARCH_WORKSPACE
# equals <workspace>, print its OPENROUTER_API_KEY line (if any) and
# SERVER_SEEN. Other units' and sessions' environments are never opened.
e2e_scoped_server_env() {
  local root=$1 workspace=$2 root_real pid cmdline env_lines
  root_real="$(cd "$root" 2>/dev/null && pwd -P || printf '%s' "$root")"
  for pid in $(pgrep -f "[m]cp-intelli-search/dist/cli.js" || true); do
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    [[ "$cmdline" == *"$root/"* || "$cmdline" == *"$root_real/"* ]] || continue
    env_lines="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null || true)"
    if grep -qxF "INTELLI_SEARCH_WORKSPACE=$workspace" <<<"$env_lines"; then
      grep '^OPENROUTER_API_KEY=' <<<"$env_lines" || true
      echo "SERVER_SEEN"
    fi
  done
}

# e2e_llms_full_created <entry> — the llms-full downloads an entry holds, as
# "name (bytes)" joined by ", "; empty when none.
e2e_llms_full_created() {
  find "$1/sources" -maxdepth 1 -type f -name 'llms-full-*.md' -printf '%f (%s bytes)\n' 2>/dev/null \
    | sort | paste -sd ',' - | sed 's/,/, /g'
}

# e2e_check_llms_full <bound_entry> <target_host> <probed_url> — scenario 07's
# oracle. The download is named after the host the pipeline probed
# (src/core/fetch.ts), so it must be sources/llms-full-<target_host>.md and
# hold more than 500 bytes. Every failure line names the llms-full files that
# were created, so a redirect or a different search host reads as such rather
# than as a broken pipeline. Increments ERRORS per failure.
e2e_check_llms_full() {
  local entry=$1 host=$2 probed=$3 target size created
  target="$entry/sources/llms-full-${host}.md"
  created="$(e2e_llms_full_created "$entry")"
  if [[ -z "$probed" ]]; then
    echo "❌ UNPROVEN: no candidate site served llms-full.txt during the probe, so discovery cannot be attributed to a known target (created: ${created:-none})"
    ERRORS=$((ERRORS + 1))
  fi
  if [[ -f "$target" ]]; then
    size="$(wc -c <"$target")"
    if [[ "$size" -gt 500 ]]; then
      echo "✅ Found: sources/$(basename "$target") (${size} bytes) in the bound entry (all llms-full files: ${created})"
      head -c 200 "$target" 2>/dev/null
      echo ""
    else
      echo "❌ sources/$(basename "$target") is only ${size} bytes: not substantial documentation (all llms-full files: ${created})"
      ERRORS=$((ERRORS + 1))
    fi
  else
    echo "❌ UNPROVEN: expected sources/llms-full-${host}.md in bound entry $(basename "$entry"); created instead: ${created:-none}"
    if [[ -n "$created" ]]; then
      echo "   A download under another host name usually means the target redirected or the search returned pages from another host; probed: ${probed:-none}"
    fi
    ERRORS=$((ERRORS + 1))
  fi
}

# Fail closed: the cap case must actually request 12; the default case must
# supply no page override. Pi normalises optional nulls to omission, but
# tool_execution_start records the raw arguments. Extractions alone cannot
# prove the number of fetched URLs.
# e2e_verify_page_budget <bound_entry> <attempt_trace> <cap|default>
e2e_verify_page_budget() {
  local entry=$1 trace=$2 scenario=$3 count
  jq -Rse --arg mode "$scenario" '
    [split("\n")[] | fromjson? | select(.type == "tool_execution_start" and .toolName == "intelli_research") | .args] as $calls |
    ($calls | length) == 1 and
    (if $mode == "cap" then $calls[0].maxUrls == 12 else $calls[0].maxUrls == null end)
  ' "$trace" >/dev/null || { echo "❌ incorrect/missing research arguments"; return 1; }
  [[ -n "$entry" && -s "$entry/report.md" && -d "$entry/extractions" && -d "$entry/sources" ]] || {
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
# entry). E2E_LOOP_MODEL_ID, then TEST_MODEL (form provider/model),
# override the loop model; settings.json should then use the split
# "defaultProvider"/"defaultModel" form with these variables.
#
# Only api_key entries are copied into a test profile. An OAuth entry carries
# a refresh-token chain; every isolated profile that refreshes it forks the
# chain and can invalidate the operator's own login. The check reads the
# entry's type and never prints a credential value.
e2e_setup_loop_model() {
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "e2e_setup_loop_model: OPENROUTER_API_KEY is not set" >&2
    return 1
  fi
  local loop_model_id="${E2E_LOOP_MODEL_ID:-${TEST_MODEL:-}}"
  local operator_auth="${E2E_OPERATOR_AUTH_JSON:-${HOME}/.pi/agent/auth.json}"
  local entry_type
  if [[ -z "${loop_model_id}" ]]; then
    loop_model_id="openrouter/google/gemini-3.8-flash"
    if [[ -f "${operator_auth}" ]]; then
      entry_type="$(jq -r '.["kimi-coding"].type? // empty' "${operator_auth}" 2>/dev/null || true)"
      if [[ "${entry_type}" == "api_key" ]]; then
        loop_model_id="kimi-coding/k3"
      elif [[ -n "${entry_type}" ]]; then
        echo "ℹ️  kimi-coding entry has type '${entry_type}', not api_key; using ${loop_model_id} for the agent loop" >&2
      fi
    fi
  fi
  E2E_LOOP_PROVIDER="${loop_model_id%%/*}"
  E2E_LOOP_MODEL="${loop_model_id#*/}"
  E2E_AUTH_JSON="$(printf '%s' "${OPENROUTER_API_KEY}" | jq -Rs '{openrouter:{type:"api_key",key:.}}')"
  if [[ "${E2E_LOOP_PROVIDER}" != "openrouter" ]]; then
    local loop_entry
    if [[ ! -f "${operator_auth}" ]] \
       || ! loop_entry="$(jq -c --arg p "${E2E_LOOP_PROVIDER}" '.[$p] // empty' "${operator_auth}" 2>/dev/null)" \
       || [[ -z "${loop_entry}" || "${loop_entry}" == "null" ]]; then
      echo "e2e_setup_loop_model: loop model ${loop_model_id} but no ${E2E_LOOP_PROVIDER} entry in the operator auth file" >&2
      return 1
    fi
    entry_type="$(jq -r '.type? // "missing"' <<<"${loop_entry}" 2>/dev/null || echo "unreadable")"
    if [[ "${entry_type}" != "api_key" ]]; then
      echo "e2e_setup_loop_model: the ${E2E_LOOP_PROVIDER} entry has type '${entry_type}'; only api_key entries are copied into test profiles" >&2
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

# e2e_display_file <trace> <stderr> <display> — write the human display for
# one attempt from its files, file to file. JSON events become tool and
# assistant text; non-JSON lines (a host without --mode json) pass through as
# text; stderr is appended. No transcript passes through a shell variable.
e2e_display_file() {
  local trace=$1 err=$2 display=$3
  e2e_compact_json_output <"$trace" >"$display"
  if [[ -s "$err" ]]; then
    { printf '%s\n' "--- stderr ---"; cat "$err"; } >>"$display"
  fi
}

# e2e_display_tail <display> — the bounded display text scenarios echo and
# grep: at most E2E_DISPLAY_MAX_BYTES (default 262144) from the end of the
# display file, with a pointer to the full file when it was cut.
e2e_display_tail() {
  local display=$1 max="${E2E_DISPLAY_MAX_BYTES:-262144}" size
  size="$(wc -c <"$display")"
  if [[ "$size" -gt "$max" ]]; then
    printf '[display truncated to the last %s of %s bytes; full display: %s]\n' "$max" "$size" "$display"
  fi
  tail -c "$max" "$display"
}

# Convert machine JSON events to multiline tool and assistant text for scenario
# logs. The raw events remain in the attempt files; compact output avoids
# enormous single-line transcript events overflowing tee and terminal pipelines.
e2e_compact_json_output() {
  jq -R -r '
    (fromjson? // {type: "raw", raw: .}) as $event |
    if $event.type == "raw" then
      $event.raw
    elif $event.type == "tool_execution_end" then
      $event.result.content[]? | select(.type == "text") | .text
    elif $event.type == "tool_execution_update" then
      $event.partialResult.content[]? | select(.type == "text") | .text
    elif ($event.type | tostring | startswith("e2e_direct_")) then
      "[direct] " + ($event | del(.args) | tojson)
    elif $event.type == "message_end" and $event.message.role == "assistant" then
      ($event.message.content[]? | select(.type == "text") | .text),
      ($event.message.errorMessage // empty)
    else empty end
  ' 2>/dev/null
}

# e2e_direct_plan <expect_json> <query> — print two JSON lines: the exact
# arguments a direct invocation sends (the oracle's named values, null
# omissions dropped, plus the query) and the oracle that judges it (the same
# values, with the query and the null omissions kept). Fails without a query.
e2e_direct_plan() {
  local expect=$1 query=$2
  jq -cn --argjson e "$expect" --arg q "$query" '
    (if ($e | has("query")) then $e else $e + {query: $q} end) as $oracle |
    if ($oracle.query // "") == "" then error("no research query for direct invocation") else . end |
    ($oracle | with_entries(select(.value != null))), $oracle'
}

# e2e_invocation_fallback <attempt_dir> <requested> <driver_output> — record
# that direct invocation was unavailable, in invocation-fallback.json beside
# the attempts, and set E2E_INVOCATION_FALLBACK to its path. Only the driver's
# e2e_direct_unavailable record is read; no transcript enters a variable.
e2e_invocation_fallback() {
  local dir=$1 requested=$2 reasons=$3 report
  report="${dir}/${E2E_ATTEMPT_PREFIX:-}invocation-fallback.json"
  jq -n --arg requested "$requested" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --slurpfile records "$reasons" \
    '{requested: $requested, used: (if $requested == "direct" then "none" else "agent-loop" end),
      reason: ([$records[] | select(.type == "e2e_direct_unavailable") | .reason] | first // "unknown"),
      evidenceClass: "natural-language routing, not exact invocation", at: $at}' > "$report" 2>/dev/null \
    || printf '{"requested":"%s","reason":"unreadable driver output"}\n' "$requested" > "$report"
  E2E_INVOCATION_FALLBACK="$report"
}

# e2e_run_pi <agent_dir> <cwd> <prompt> [timeout_s]
#
# Runs headless pi up to three times (30 s apart). Each attempt streams its
# events and stderr straight to its own files under E2E_ATTEMPT_DIR (never
# overwritten, never buffered in a shell variable), then is judged by
# scenario-verdict.mjs. Retries happen only when the attempt completed no
# useful research; once research completed, or the agent misbehaved, no
# further paid attempt is started.
#
# Inputs set by the caller before the call:
#   E2E_EXPECT_ARGS        JSON object of prompted arguments (null = omitted)
#   E2E_EXPECT_CACHE_DIR   Cache directory relative to the verdict workspace
#                          (default .search)
#   E2E_VERDICT_WORKSPACE  Workspace the research writes into (default cwd)
#   E2E_RESEARCH_TOOL      Tool name (default intelli_research)
#   E2E_PI_BIN, E2E_PI_FLAGS (array)  Host binary and flags (default the
#                          current `pi` with the native isolation flags)
#   E2E_JSON_MODE          1 (default) for --mode json and call binding; 0 for
#                          hosts without it (workspace-only binding)
#   E2E_REQUIRE_EXIT_ZERO  1 to keep an exit-0 gate (floor host)
#   E2E_ATTEMPT_PREFIX     Optional attempt file prefix
#   E2E_INVOCATION         agent (default): the prompt runs through the agent
#                          loop (routing evidence). direct: exactly one
#                          registered-tool call through direct-tool.mjs, no
#                          agent-loop model call; fails if the host cannot.
#                          auto: direct when the host supports it, otherwise the
#                          agent loop, with invocation-fallback.json written
#                          and the downgrade printed.
#   E2E_RESEARCH_QUERY     The query for direct invocation (unless
#                          E2E_EXPECT_ARGS names one). Direct mode judges the
#                          call against the oracle plus this query.
#   E2E_PI_SDK             Optional coding-agent package for the driver
#                          (default: resolved from the host binary)
#
# Outputs: E2E_BOUND_ENTRY, E2E_LAST_OUTPUT (bounded display text, never the
# raw transcript), E2E_LAST_OUTPUT_FILE (full display), E2E_LAST_EXIT_CODE,
# E2E_LAST_TIMED_OUT, E2E_LAST_TRACE_FILE, E2E_LAST_VERDICT_FILE,
# E2E_LAST_VERDICT_STATUS, E2E_LAST_VERDICT_REASON.
#
# E2E_RETRY_SLEEP_SECONDS (default 30) spaces retries; E2E_KILL_AFTER_SECONDS
# (default 15) is the grace period before KILL after the attempt timeout.
#
# Outputs also E2E_LAST_INVOCATION (direct or agent-loop) and, after a
# fallback, E2E_INVOCATION_FALLBACK (the report path).
#
# Returns 0 pass, 1 no completed research (or exit-0 gate), 2 oracle or
# product failure (not retried), 3 harness error (including direct mode
# requested but unavailable, or a driver failure).
e2e_run_pi() {
  local agent="$1" cwd="$2" prompt="$3" tmo="${4:-${E2E_TIMEOUT_SECONDS:-360}}"
  local attempt ec vrc since base trace err verdict_file display
  local expect="${E2E_EXPECT_ARGS:-}"
  local invocation="${E2E_INVOCATION:-agent}" mode direct_args="" direct_oracle="" plan host_path sdk_args=() direct_flags=()
  local host_bin="${E2E_PI_BIN:-pi}"
  local tool="${E2E_RESEARCH_TOOL:-intelli_research}"
  local verdict_ws="${E2E_VERDICT_WORKSPACE:-$cwd}"
  local cache_dir="${E2E_EXPECT_CACHE_DIR:-.search}"
  local attempt_dir="${E2E_ATTEMPT_DIR:-${E2E_TRACE_DIR:-}}"
  local host_flags=() extension_args=() trace_extension_args=() mode_args=() verdict_args=() tool_args=() path_prefix=""
  # Outputs exist from the start, so a caller under set -u can read them after
  # any early return.
  E2E_BOUND_ENTRY=""
  E2E_LAST_VERDICT_STATUS=""
  E2E_LAST_VERDICT_REASON=""
  E2E_LAST_VERDICT_FILE=""
  E2E_LAST_INVOCATION=""
  E2E_INVOCATION_FALLBACK=""
  E2E_LAST_OUTPUT=""
  if [[ -z "$attempt_dir" ]]; then
    echo "e2e_run_pi: no attempt directory (call e2e_init_log or set E2E_TRACE_DIR)" >&2
    return 3
  fi
  if declare -p E2E_PI_FLAGS >/dev/null 2>&1; then
    host_flags=("${E2E_PI_FLAGS[@]}")
  else
    host_flags=(--no-extensions --no-skills --no-prompt-templates --no-context-files --no-session)
  fi
  if [[ -n "${E2E_EXTENSION_PATH:-}" ]]; then extension_args=(-e "${E2E_EXTENSION_PATH}"); fi
  if [[ -n "${E2E_TRACE_EXTENSION_PATH:-}" ]]; then
    trace_extension_args=(-e "${E2E_TRACE_EXTENSION_PATH}")
  fi
  if [[ -n "${E2E_TOOL_ALLOWLIST:-}" ]]; then tool_args=(--tools "${E2E_TOOL_ALLOWLIST}"); fi
  if [[ "${E2E_JSON_MODE:-1}" == "1" ]]; then
    mode_args=(--mode json)
    verdict_args=(--trace)
  else
    verdict_args=(--no-trace --trace)
  fi
  if [[ "$host_bin" == /* ]]; then path_prefix="$(dirname "$host_bin"):"; fi
  if [[ -z "$expect" ]]; then expect='{}'; fi
  case "$invocation" in
    agent) mode=agent ;;
    direct|auto)
      mode=direct
      if ! plan="$(e2e_direct_plan "$expect" "${E2E_RESEARCH_QUERY:-}" 2>&1)"; then
        echo "e2e_run_pi: E2E_INVOCATION=$invocation needs E2E_RESEARCH_QUERY or a query in E2E_EXPECT_ARGS ($plan)" >&2
        return 3
      fi
      direct_args="$(sed -n 1p <<<"$plan")"
      direct_oracle="$(sed -n 2p <<<"$plan")"
      if [[ -n "${E2E_PI_SDK:-}" ]]; then
        sdk_args=(--sdk "$(cd "$E2E_PI_SDK" 2>/dev/null && pwd || printf '%s' "$E2E_PI_SDK")")
      elif host_path="$(command -v "$host_bin" 2>/dev/null)"; then
        sdk_args=(--host-bin "$host_path")
      else
        sdk_args=(--host-bin "$host_bin")
      fi
      [[ -n "${E2E_EXTENSION_PATH:-}" ]] && direct_flags+=(--extension "${E2E_EXTENSION_PATH}")
      [[ -n "${E2E_TRACE_EXTENSION_PATH:-}" ]] && direct_flags+=(--extension "${E2E_TRACE_EXTENSION_PATH}")
      if [[ " ${host_flags[*]} " == *" --no-extensions "* ]]; then direct_flags+=(--no-extensions); fi
      [[ -n "${E2E_TOOL_ALLOWLIST:-}" ]] && direct_flags+=(--tools "${E2E_TOOL_ALLOWLIST}")
      ;;
    *)
      echo "e2e_run_pi: E2E_INVOCATION must be agent, direct or auto (got '$invocation')" >&2
      return 3
      ;;
  esac
  mkdir -p "$attempt_dir"
  attempt=1
  while [[ "$attempt" -le 3 ]]; do
    E2E_TRACE_SEQUENCE=$(( ${E2E_TRACE_SEQUENCE:-0} + 1 ))
    printf -v base '%s/%s%03d-attempt-%d' "$attempt_dir" "${E2E_ATTEMPT_PREFIX:-}" \
      "${E2E_TRACE_SEQUENCE}" "${attempt}"
    trace="${base}.jsonl"
    err="${base}.stderr"
    verdict_file="${base}.verdict.json"
    display="${base}.display.txt"
    if [[ -e "$trace" || -e "$err" || -e "$verdict_file" || -e "$display" ]]; then
      echo "e2e_run_pi: attempt files already exist at ${base}.*; refusing to overwrite evidence" >&2
      return 3
    fi
    since="$(date +%s%3N)"
    # No --foreground: timeout signals the whole process group, so an expired
    # attempt cannot leave pi or its children making paid calls. stdin is
    # /dev/null so the host never waits on, or is stopped by, a terminal.
    if [[ "$mode" == direct ]]; then
      # Exactly one registered-tool call, no agent-loop model call. The tool
      # wait stays inside the attempt deadline.
      (
        cd "$cwd"
        PATH="${path_prefix}${PATH}" \
        PI_CODING_AGENT_DIR="$agent" \
          timeout --kill-after="${E2E_KILL_AFTER_SECONDS:-15}s" "${tmo}s" node "$E2E_DIRECT_DRIVER" \
            "${sdk_args[@]}" --agent-dir "$agent" --cwd "$cwd" --tool "$tool" --args "$direct_args" \
            "${direct_flags[@]}" --tool-wait-ms "${E2E_DIRECT_TOOL_WAIT_MS:-60000}" \
            </dev/null >"$trace" 2>"$err"
      ) && ec=0 || ec=$?
      if [[ "$ec" -eq 69 ]]; then
        e2e_invocation_fallback "$attempt_dir" "$invocation" "$trace"
        printf '{"status":"direct-unavailable","reason":"see %s"}\n' "$E2E_INVOCATION_FALLBACK" >"$verdict_file"
        if [[ "$invocation" == direct ]]; then
          echo "   ❌ E2E_INVOCATION=direct but direct invocation is unavailable on this host; see ${E2E_INVOCATION_FALLBACK}. No weaker oracle is substituted." >&2
          return 3
        fi
        echo "   ⚠️  DIRECT INVOCATION UNAVAILABLE: falling back to the agent loop. This run is natural-language routing evidence, not exact invocation; see ${E2E_INVOCATION_FALLBACK}" >&2
        mode=agent
        continue
      fi
      if [[ "$ec" -eq 70 || "$ec" -eq 71 || "$ec" -eq 72 ]]; then
        e2e_display_file "$trace" "$err" "$display"
        E2E_LAST_OUTPUT_FILE="${display}"
        E2E_LAST_OUTPUT="$(e2e_display_tail "$display")"
        E2E_LAST_TRACE_FILE="${trace}"
        E2E_LAST_INVOCATION=direct
        printf '{"status":"harness-error","reason":"direct driver exit %s"}\n' "$ec" >"$verdict_file"
        E2E_LAST_VERDICT_FILE="${verdict_file}"
        E2E_LAST_VERDICT_REASON="direct driver exit ${ec} (70 error, 71 agent-loop call refused, 72 tool not callable)"
        echo "   ❌ attempt ${attempt}: ${E2E_LAST_VERDICT_REASON}; see ${err}" >&2
        return 3
      fi
    else
      (
        cd "$cwd"
        PATH="${path_prefix}${PATH}" \
        PI_CODING_AGENT_DIR="$agent" \
          timeout --kill-after="${E2E_KILL_AFTER_SECONDS:-15}s" "${tmo}s" "$host_bin" \
            "${host_flags[@]}" "${extension_args[@]}" "${trace_extension_args[@]}" "${mode_args[@]}" "${tool_args[@]}" \
            -p "${prompt}" </dev/null >"$trace" 2>"$err"
      ) && ec=0 || ec=$?
    fi
    E2E_LAST_INVOCATION="$mode"
    [[ "$mode" == agent ]] && E2E_LAST_INVOCATION="agent-loop"
    E2E_LAST_EXIT_CODE="${ec}"
    E2E_LAST_TIMED_OUT=0
    if [[ "${ec}" -eq 124 || "${ec}" -eq 137 ]]; then E2E_LAST_TIMED_OUT=1; fi
    E2E_LAST_TRACE_FILE="${trace}"
    E2E_LAST_VERDICT_FILE="${verdict_file}"
    # The same file-to-file conversion on every path, the floor included; the
    # raw event stream stays in its attempt file.
    e2e_display_file "$trace" "$err" "$display"
    E2E_LAST_OUTPUT_FILE="${display}"
    E2E_LAST_OUTPUT="$(e2e_display_tail "$display")"
    local oracle="$expect" judged_args=("${verdict_args[@]}")
    if [[ "$mode" == direct ]]; then oracle="$direct_oracle"; judged_args=(--trace); fi
    node "$E2E_VERDICT_HELPER" bind "${judged_args[@]}" "$trace" \
      --workspace "$verdict_ws" --cache-root "$cache_dir" --tool "$tool" \
      --since-ms "$since" --expect "$oracle" --invocation "$E2E_LAST_INVOCATION" \
      ${E2E_INVOCATION_FALLBACK:+--fallback-report "$E2E_INVOCATION_FALLBACK"} >"$verdict_file" && vrc=0 || vrc=$?
    E2E_LAST_VERDICT_STATUS="$(jq -r '.status // empty' "$verdict_file" 2>/dev/null || true)"
    E2E_LAST_VERDICT_REASON="$(jq -r '.reason // empty' "$verdict_file" 2>/dev/null || true)"
    case "${vrc}" in
      0)
        E2E_BOUND_ENTRY="$(jq -r '.entry' "$verdict_file")"
        if [[ "${E2E_REQUIRE_EXIT_ZERO:-0}" == "1" && "${ec}" -ne 0 ]]; then
          echo "   ❌ attempt ${attempt} completed research but the host exited ${ec}; this host keeps its exit-0 gate, and completed research is not repeated" >&2
          return 1
        fi
        if [[ "${ec}" -eq 124 || "${ec}" -eq 137 ]]; then
          echo "   ⚠️  pi attempt ${attempt} TIMED OUT after ${tmo}s but its research call completed; research accepted, agent-loop timeout recorded" >&2
        elif [[ "${ec}" -ne 0 ]]; then
          if grep -q "Response was truncated" "$trace" "$err" 2>/dev/null; then
            echo "   ℹ️  pi attempt ${attempt} exited ${ec} after print-mode truncation; its research call completed; accepted" >&2
          else
            echo "   ℹ️  pi attempt ${attempt} exited ${ec}; its research call completed; research accepted, nonzero agent-loop exit recorded" >&2
          fi
        fi
        echo "   🔗 bound research: ${E2E_BOUND_ENTRY} (attempt ${attempt}, ${E2E_LAST_INVOCATION} invocation, ${verdict_file})" >&2
        return 0
        ;;
      3)
        if [[ "${ec}" -eq 124 || "${ec}" -eq 137 ]]; then
          echo "   ⚠️  pi attempt ${attempt}/3 TIMED OUT after ${tmo}s: ${E2E_LAST_VERDICT_REASON}" >&2
        else
          echo "   ⚠️  pi attempt ${attempt}/3 (exit ${ec}): ${E2E_LAST_VERDICT_REASON}" >&2
        fi
        ;;
      4|5)
        echo "   ❌ attempt ${attempt} ${E2E_LAST_VERDICT_STATUS}: ${E2E_LAST_VERDICT_REASON} (see ${verdict_file}); no retry" >&2
        return 2
        ;;
      *)
        echo "   ❌ attempt ${attempt}: verdict helper failed (exit ${vrc}); see ${verdict_file}" >&2
        return 3
        ;;
    esac
    if [[ "${attempt}" -lt 3 ]]; then
      echo "   ⏳ retrying after ${E2E_RETRY_SLEEP_SECONDS:-30}s" >&2
      sleep "${E2E_RETRY_SLEEP_SECONDS:-30}"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}
