#!/usr/bin/env bash
#
# test/e2e/env.sh — credential loading for the host-session scenarios
#
# Sourced by scenarios that read credentials from the gitignored .env. The
# file is parsed, never executed: sourcing it as shell code makes bash quote a
# malformed line (for example a token wrapped across two lines) into its
# error message, and a scenario that has already redirected output into
# .e2e-logs/ then writes that fragment of the secret to disk.
#
# Call these BEFORE redirecting output into a log file.

# e2e_require_private FILE: fail unless FILE (when present) is readable by its
# owner only.
e2e_require_private() {
  local file=$1 mode
  [[ -e "$file" ]] || return 0
  mode="$(stat -c %a "$file")"
  if [[ "${mode: -2}" != "00" ]]; then
    echo "❌ $file is mode $mode; credentials must be owner-only: chmod 600 $file" >&2
    return 1
  fi
}

# e2e_load_env FILE NAME...: export only the named keys from a dotenv file.
# A variable already set in the caller's environment wins. Lines must be
# NAME=VALUE on one line (optionally prefixed by `export`, value optionally
# wrapped in one pair of quotes); comments and blank lines are skipped. Any
# other line fails with its line number only, never its content.
e2e_load_env() {
  local file=$1 n=0 line key val wanted
  shift
  [[ -f "$file" ]] || return 0
  e2e_require_private "$file" || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "❌ $file line $n is not NAME=VALUE on one line (a wrapped paste?); fix it before running" >&2
      return 1
    fi
    key="${BASH_REMATCH[2]}"
    val="${BASH_REMATCH[3]}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    for wanted in "$@"; do
      if [[ "$key" == "$wanted" && -z "${!key:-}" ]]; then
        export "$key=$val"
      fi
    done
  done < "$file"
}
