#!/usr/bin/env bash
# Shared direct-call scenarios. One paid batch, no agent loop or outer retry.
set -euo pipefail

# e2e_batch MODE ADAPTER AGENT_DIR WORKSPACE PROJECT_DIR
# The workspace may hold a single-query run (scenario 11), but no prior batch.
e2e_batch() {
  local mode=$1 adapter=$2 agent=$3 ws=$4 project=$5 tool=intelli_research
  local second args events folder member id
  local flags=() folders=()
  if [[ $mode == expansion ]]; then
    second='{"query":"SQLite WAL checkpoints and readers","domains":["sqlite.org"],"focusPrompt":"Explain when checkpointing must wait for readers."}'
  else
    second='{"query":"Python pathlib PurePath and Path differences","domains":["docs.python.org"],"focusPrompt":"Distinguish filesystem operations from pure path operations."}'
  fi
  args=$(jq -nc --arg mode "$mode" --argjson second "$second" '{batchMode:$mode,maxUrls:1,queries:[{query:"SQLite write ahead logging and transactions",domains:["sqlite.org"],focusPrompt:"Describe reader and writer concurrency in WAL mode."},$second]}')
  if [[ $adapter == mcp ]]; then tool=mcp__intelli_search__intelli_research
  else flags=(--no-extensions --extension "$project/dist/index.js"); fi
  if [[ -n ${E2E_TRACE_EXTENSION_PATH:-} ]]; then flags+=(--extension "$E2E_TRACE_EXTENSION_PATH"); fi
  local trace_dir=${E2E_TRACE_DIR:-$ws}
  mkdir -p "$trace_dir"
  events=$(mktemp "$trace_dir/batch-$mode-XXXXXX.jsonl")
  echo "Calling $tool ($mode); events: $events"
  (cd "$ws" && PI_CODING_AGENT_DIR="$agent" timeout "${E2E_TIMEOUT_SECONDS:-600}s" node "$project/test/e2e/direct-tool.mjs" \
    --host-bin "$(command -v pi)" --agent-dir "$agent" --cwd "$ws" --tool "$tool" --args "$args" "${flags[@]}" </dev/null) >"$events"
  jq -se 'any(.[]; .type == "e2e_direct_result" and .isError == false)' "$events" >/dev/null
  folders=("$ws"/.search/*-batch-*/manifest.json)
  [[ ${#folders[@]} == 1 && -s ${folders[0]} ]]
  folder=${folders[0]%/*}
  jq -e --argjson args "$args" '.mode == $args.batchMode and [.entries[].query] == [$args.queries[].query] and all(.entries[]; .outcome == "completed")' "$folder/manifest.json" >/dev/null
  id=$(jq -er '.id' "$folder/manifest.json")
  jq -e --arg id "$id" --arg mode "$mode" --arg adapter "$adapter" '
    .kind == "batch" and .id == $id and .mode == $mode and (.adapter // "pi") == $adapter and
    .size == 2 and .outcome == "completed" and (if $mode == "expansion" then .merge.outcome == "completed" and .merge.entries == 2 else .merge == null end)' "$folder/batch-meta.json" >/dev/null
  while IFS= read -r member; do
    [[ $member == /* ]] || member="$ws/$member"
    [[ -s $member/report.md ]]
    jq -e --arg id "$id" '.batch.id == $id and .outcome == "completed" and (.stages.fetch.urls | length) == 1 and .stages.collate.summaryChars > 0' "$member/meta.json" >/dev/null
  done < <(jq -r '.entries[].cachePath' "$folder/manifest.json")
  if [[ $mode == expansion ]]; then
    grep -q '^## Per-Query Reports' "$folder/report.md"
  else
    [[ ! -e $folder/report.md ]]
  fi
  jq -se --arg marker "$(if [[ $mode == expansion ]]; then echo '## Per-Query Reports'; else echo '# Query 2 of 2:'; fi)" '
    any(.[] | select(.type == "tool_execution_end") | .result.content[]?; .text? | strings | contains($marker))' "$events" >/dev/null
  jq -r '"Passed \(.mode) batch: \(.size) completed entries, \(.durationMs) ms"' "$folder/batch-meta.json"
}

# Each native scenario starts from empty settings and a fresh cache. Only the
# pipeline key is exported; no operator profile is copied into the workspace.
e2e_native_batch() {
  local mode=$1 project root
  project=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  # shellcheck source=test/e2e/env.sh
  source "$project/test/e2e/env.sh"
  e2e_load_env "$project/.env" OPENROUTER_API_KEY E2E_TIMEOUT_SECONDS
  if [[ -z ${OPENROUTER_API_KEY:-} ]]; then OPENROUTER_API_KEY=$(jq -er '.openrouter.key | strings | select(length > 0)' "$HOME/.pi/agent/auth.json"); fi
  export OPENROUTER_API_KEY
  export TMPDIR=${TMPDIR:-$project/.tmp/e2e}
  mkdir -p "$TMPDIR"
  root=$(mktemp -d "$TMPDIR/batch-$mode-XXXXXX")
  mkdir -p "$root/agent" "$root/ws"
  e2e_batch "$mode" pi "$root/agent" "$root/ws" "$project"
}
