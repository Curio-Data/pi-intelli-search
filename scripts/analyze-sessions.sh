#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd.
#
# Analyzes local Pi session logs and intelli-search cache directories to
# evaluate how the pi-intelli-search extension is being used.
#
# Reads from:
#   ~/.pi/agent/sessions/**/*.jsonl   (Pi session transcripts)
#   <cwd>/.search/.index.json         (intelli-search cache index, per project)
#   <cwd>/.search/*/meta.json         (v0.11.0+ telemetry sidecars, optional)
#
# No API keys required. No network access. Deterministic.
#
# Usage:
#   scripts/analyze-sessions.sh                 # default session dir
#   scripts/analyze-sessions.sh /path/to/sessions
#   PI_SESSIONS_DIR=/path scripts/analyze-sessions.sh
#
# Requires: jq, fd (falls back to find), rg (falls back to grep)

set -euo pipefail

SESSIONS_DIR="${1:-${PI_SESSIONS_DIR:-$HOME/.pi/agent/sessions}}"

# Resolve a file-finder command. Prefer fd, fall back to find.
if command -v fd >/dev/null 2>&1; then
  FIND_CMD=(fd -t f -e jsonl . "$SESSIONS_DIR")
else
  FIND_CMD=(find "$SESSIONS_DIR" -type f -name '*.jsonl')
fi

if [ ! -d "$SESSIONS_DIR" ]; then
  echo "error: sessions dir not found: $SESSIONS_DIR" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (https://stedolan.github.io/jq/)" >&2
  exit 1
fi

# Collect all session files and per-section work files up front, with a
# single EXIT trap. Defining them here avoids set -u failures when an
# earlier section's trap references a file created in a later section.
SESSION_FILES=$(mktemp)
TOOLCALLS_CACHE=$(mktemp)
FOLLOW_TMP=$(mktemp)
IDX_TMP=$(mktemp)
PROJ_TMP=$(mktemp)
trap 'rm -f "$SESSION_FILES" "$TOOLCALLS_CACHE" "$FOLLOW_TMP" "$IDX_TMP" "$PROJ_TMP"' EXIT
"${FIND_CMD[@]}" > "$SESSION_FILES"

FILE_COUNT=$(wc -l < "$SESSION_FILES" | tr -d ' ')

hr() {
  # light horizontal rule
  printf '%s\n' "------------------------------------------------------------"
}

# Extract toolCall names from assistant messages across all sessions.
# Cached so multiple sections can reuse it.
while IFS= read -r f; do
  jq -rc 'select(.type=="message" and .message.role=="assistant")
          | .message.content[]?
          | select(.type=="toolCall")
          | .name' "$f" 2>/dev/null || true
done < "$SESSION_FILES" > "$TOOLCALLS_CACHE"

echo "============================================================"
echo "  intelli-search usage analysis"
echo "  sessions dir: $SESSIONS_DIR"
echo "  session files: $FILE_COUNT"
echo "============================================================"

# ---------------------------------------------------------------- 1
echo ""
echo "## 1. Total tool calls by name"
hr
sort "$TOOLCALLS_CACHE" | uniq -c | sort -rn | awk '{printf "%6d  %s\n", $1, $2}'

# ---------------------------------------------------------------- 2
echo ""
echo "## 2. intelli_* tool calls breakdown"
hr
grep '^intelli_' "$TOOLCALLS_CACHE" | sort | uniq -c | sort -rn \
  | awk '{printf "%6d  %s\n", $1, $2}'
intelli_total=$(grep -c '^intelli_' "$TOOLCALLS_CACHE" || true)
all_total=$(wc -l < "$TOOLCALLS_CACHE" | tr -d ' ')
if [ "$all_total" -gt 0 ]; then
  pct=$(awk -v a="$intelli_total" -v b="$all_total" 'BEGIN{printf "%.1f", a*100/b}')
  echo ""
  echo "intelli_* share of all tool calls: ${intelli_total}/${all_total} (${pct}%)"
fi

# ---------------------------------------------------------------- 3
echo ""
echo "## 3. Per-project intelli_* usage"
hr
# Aggregate by the top-level project directory under $SESSIONS_DIR,
# so nested subagent session files (e.g. <proj>/<id>/<hash>/run-N/)
# roll up into their parent project rather than appearing as 'run-N'.
while IFS= read -r f; do
  rel=${f#"$SESSIONS_DIR"/}
  proj=${rel%%/*}
  n=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall" and (.name|startswith("intelli_")))
              | .name' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && printf '%s %d\n' "$proj" "$n" >> "$PROJ_TMP"
done < "$SESSION_FILES"
awk '{c[$1]+=$2} END {for (p in c) printf "%6d  %s\n", c[p], p}' "$PROJ_TMP" | sort -rn

# ---------------------------------------------------------------- 4
echo ""
echo "## 4. Adoption over time (monthly)"
hr
printf '%s\n' "intelli_* calls by month:"
while IFS= read -r f; do
  m=$(basename "$f" | grep -oE '^[0-9]{4}-[0-9]{2}' || true)
  [ -z "$m" ] && continue
  n=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall" and (.name|startswith("intelli_")))
              | .name' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "$m $n"
done < "$SESSION_FILES" | awk '{c[$1]+=$2} END{for (m in c) printf "  %s  %d\n", m, c[m]}' | sort || true

printf '%s\n' "legacy web_* calls by month:"
while IFS= read -r f; do
  m=$(basename "$f" | grep -oE '^[0-9]{4}-[0-9]{2}' || true)
  [ -z "$m" ] && continue
  n=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall" and (.name|startswith("web_")))
              | .name' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && echo "$m $n"
done < "$SESSION_FILES" | awk '{c[$1]+=$2} END{for (m in c) printf "  %s  %d\n", m, c[m]}' | sort || true

# ---------------------------------------------------------------- 5
echo ""
echo "## 5. Follow-up research (sessions with 2+ intelli_research calls)"
hr
# Capture per-session counts first, then format. Keeping the count out of
# the pipeline subshell avoids losing it when we sort the output.
while IFS= read -r f; do
  n=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall" and .name=="intelli_research")
              | .name' "$f" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -ge 2 ]; then
    printf "%6d  %s\n" "$n" "$(basename "$f" | cut -c1-45)"
  fi
done < "$SESSION_FILES" | sort -rn | tee "$FOLLOW_TMP" || true
echo ""
echo "distinct follow-up sessions: $(wc -l < "$FOLLOW_TMP" | tr -d ' ')"

# ---------------------------------------------------------------- 6
echo ""
echo "## 6. Adoption: sessions using any intelli_* tool"
hr
used=0
while IFS= read -r f; do
  n=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall" and (.name|startswith("intelli_")))
              | .name' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && used=$((used+1))
done < "$SESSION_FILES"
if [ "$FILE_COUNT" -gt 0 ]; then
  pct=$(awk -v u="$used" -v t="$FILE_COUNT" 'BEGIN{printf "%.0f", u*100/t}')
else
  pct=0
fi
echo "sessions using intelli_*: ${used}/${FILE_COUNT} (${pct}%)"

# ---------------------------------------------------------------- 7
echo ""
echo "## 7. Cache re-reads (tool calls referencing a .search/ path)"
hr
echo "Counts toolCall argument payloads that mention '.search/'."
echo "This is the LLM manually consulting cached research, not a live search."
n=0
while IFS= read -r f; do
  c=$(jq -rc 'select(.type=="message" and .message.role=="assistant")
              | .message.content[]?
              | select(.type=="toolCall")
              | .arguments | tostring' "$f" 2>/dev/null \
      | grep -c '\.search/' || true)
  n=$((n+c))
done < "$SESSION_FILES"
echo "tool calls referencing .search/: $n"

# ---------------------------------------------------------------- 8
echo ""
echo "## 8. .search/ cache sizes (per project index)"
hr
echo "Scans common repo roots for .search/.index.json files."
# Roots to scan for .search/ caches. Honour the SEARCH_ROOTS env var
# (space-separated) or default to the common host locations.
if [ -n "${SEARCH_ROOTS:-}" ]; then
  # shellcheck disable=SC2206
  SEARCH_ROOTS=(${SEARCH_ROOTS})
else
  SEARCH_ROOTS=("$HOME" /srv /home)
fi
# Collect sizes first, then sort. This avoids a subshell losing the
# "found nothing" sentinel set inside a pipeline.
for root in "${SEARCH_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  if command -v fd >/dev/null 2>&1; then
    idx_files=$(fd -t f -H --no-ignore '.index.json' "$root" 2>/dev/null \
                | grep -E '/\.search/\.index\.json$' || true)
  else
    idx_files=$(find "$root" -type f -name '.index.json' -path '*/.search/*' 2>/dev/null || true)
  fi
  [ -z "$idx_files" ] && continue
  while IFS= read -r idx; do
    c=$(jq '.searches | length' "$idx" 2>/dev/null || echo 0)
    [ "$c" -gt 0 ] || continue
    printf "%6d  %s\n" "$c" "$(dirname "$idx")"
  done <<< "$idx_files"
done > "$IDX_TMP"
if [ -s "$IDX_TMP" ]; then
  sort -rn "$IDX_TMP"
else
  echo "(no .search/.index.json files found)"
fi

# ---------------------------------------------------------------- 9
echo ""
echo "## 9. Telemetry sidecars (meta.json, v0.11.0+)"
hr
echo "Aggregates per-stage outcomes from meta.json sidecars where present."
meta_count=0
meta_files=""
for root in "${SEARCH_ROOTS[@]}"; do
  [ -d "$root" ] || continue
  if command -v fd >/dev/null 2>&1; then
    found=$(fd -t f -H --no-ignore 'meta.json' "$root" 2>/dev/null \
            | grep -E '/\.search/.+/meta\.json$' || true)
  else
    found=$(find "$root" -type f -name 'meta.json' -path '*/.search/*' 2>/dev/null || true)
  fi
  if [ -n "$found" ]; then
    meta_files="${meta_files}${found}"$'\n'
  fi
done

if [ -z "$meta_files" ]; then
  echo "(no meta.json sidecars found; this section populates once v0.11.0+"
  echo " has run at least one intelli_research in a project)"
else
  # Combine all sidecars and summarize. tmp_meta is local to this branch;
  # extend the EXIT trap to clean it up too.
  tmp_meta=$(mktemp)
  trap 'rm -f "$SESSION_FILES" "$TOOLCALLS_CACHE" "$FOLLOW_TMP" "$IDX_TMP" "$PROJ_TMP" "$tmp_meta"' EXIT
  first=1
  while IFS= read -r m; do
    [ -z "$m" ] && continue
    meta_count=$((meta_count+1))
    if [ "$first" -eq 1 ]; then
      jq -c '.' "$m" > "$tmp_meta"
      first=0
    else
      jq -c '.' "$m" >> "$tmp_meta"
    fi
  done <<< "$meta_files"

  echo "sidecars found: $meta_count"
  echo ""
  echo "fetch outcomes (succeeded / failed):"
  jq -rs 'map(.stages.fetch // {})
          | {succeeded: (map(.succeeded // 0) | add),
              failed: (map(.failed // 0) | add)}' "$tmp_meta" 2>/dev/null
  echo ""
  echo "extract outcomes (succeeded / failed):"
  jq -rs 'map(.stages.extract // {})
          | {succeeded: (map(.succeeded // 0) | add),
              failed: (map(.failed // 0) | add)}' "$tmp_meta" 2>/dev/null
  echo ""
  echo "Defuddle vs Markdown fetch winners (summed across sidecars):"
  jq -rs 'map(.stages.fetch.winners // {})
          | reduce .[] as $obj ({};
              reduce ($obj | to_entries)[] as $e (.;
                .[$e.key] = ((.[$e.key] // 0) + $e.value)))
          | to_entries | map("\(.key): \(.value)")' "$tmp_meta" 2>/dev/null
  echo ""
  echo "search-retry firings:"
  jq -rs '[.[] | select(.stages.search.retryFired == true)] | length' "$tmp_meta" 2>/dev/null
  echo ""
  echo "cache-suggest entries surfaced (total):"
  jq -rs '[.[] | .stages.cacheSuggest.surfaced // 0] | add' "$tmp_meta" 2>/dev/null
fi

echo ""
echo "============================================================"
echo "  done"
echo "============================================================"
