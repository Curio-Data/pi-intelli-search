#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
#
# Credential-free verification of the documented DeepSeek Harness (dsh)
# setup, credential and configuration-check routes of
# @curio-data/mcp-intelli-search (docs/plans/dsh-host/README-UNIFICATION.md,
# Stage 1 Track B; reused by the Stage 4A and Stage 6 host checks).
#
# Every check runs with an invented dummy key (never a real credential,
# never printed), isolated HOME and npm cache, and per-section XDG
# directories under worktree scratch:
#   S1  isolation of HOME and npm cache under scratch;
#   S2  the documented standard-input setup pipeline through npx with a
#       non-exported key variable, asserting `Setup complete.`;
#   S3  credential file placement, user-only permissions and the created
#       default configuration document;
#   S4  environment precedence made explicit: a set OPENROUTER_API_KEY
#       yields the documented precedence warning without blocking setup
#       and without leaking into this helper's environment;
#   S5  both documented --check-config success forms, distinguished by
#       exact output, plus the empty-environment-value form;
#   S6  home and filesystem-root workspace rejection with the exact dsh
#       diagnostic;
#   S7  custom apiKeyFile preservation: the key is stored at the custom
#       path and the configuration file is left byte-identical;
#   S8  a relative XDG_CONFIG_HOME falls back to $HOME/.config;
#   S9  redaction: the dummy never appears in any captured output or log.
#
# No dsh host, no pnpm and no provider call is involved. Requires node,
# npm, npx, fd and rg on PATH plus network access to the npm registry for
# the package specification.
#
# Usage:
#   scripts/verify-dsh-setup.sh [--package <npm-spec-or-tarball>] [--keep]
#
# --package defaults to building and packing the local workspace tarball,
# the Stage 4A candidate substitution (record that substitution when it is
# used as pre-publication evidence). Pass the documented registry spec
# `@curio-data/mcp-intelli-search` to exercise the exact published command
# (Stage 6). Scratch lives under ${TMPDIR:-$PROJECT_DIR/.tmp} and is
# removed on success unless --keep is given.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGE_SPEC=""
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --package) PACKAGE_SPEC="${2:?--package requires a value}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,42s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

for tool in node npm npx fd rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool" >&2
    exit 1
  fi
done

SCRATCH="$(mktemp -d "${TMPDIR:-$PROJECT_DIR/.tmp}/dsh-verify-setup-XXXXXXXX")"
LOG_FILE="$SCRATCH/run.log"
echo "📁 Scratch: $SCRATCH"
exec > >(tee -a "$LOG_FILE") 2>&1

# One isolated HOME and npm cache serve the whole run; every npx
# invocation shares the cache so the package is downloaded once.
export HOME="$SCRATCH/home"
export npm_config_cache="$SCRATCH/npm-cache"
mkdir -p "$HOME" "$npm_config_cache"

# Drop inherited credential-shaped variables by name without reading their
# values; nothing in this helper may observe a real credential.
while IFS= read -r var; do
  case "${var^^}" in
    *API_KEY*|*TOKEN*|*SECRET*|*PASSWORD*)
      if ! unset "$var" 2>/dev/null; then
        echo '❌ Cannot isolate from inherited credentials; run in a clean environment.' >&2
        exit 1
      fi ;;
  esac
done < <(compgen -e)

cleanup() {
  local rc=$?
  # Invented dummy values never survive the run, even on failure.
  if [[ -d "$SCRATCH" ]]; then
    fd -t f 'openrouter.key|custom.key' "$SCRATCH" -x rm -f '{}' 2>/dev/null || true
  fi
  if [[ "$rc" -eq 0 && "$KEEP" -eq 0 ]]; then rm -rf "$SCRATCH"; fi
  exit "$rc"
}
trap cleanup EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "✅ $1"; }
bad() { FAIL=$((FAIL + 1)); echo "❌ $1"; }

# Invented values, never real credentials; never printed or logged.
DUMMY_KEY='intelli-trackb-invented-dummy-key'
DUMMY_ENV='intelli-trackb-invented-dummy-env'
BUILTIN_FORM='Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).'
FILE_FORM='Configuration is valid.'
DSH_WORKSPACE_DIAGNOSTIC='DeepSeek Harness working directory must be a project directory, not the home or filesystem root; start the harness from the project or set cwd on the bridge row'

# ── S1: isolation ─────────────────────────────────────────────────
echo
echo "── S1: isolation"
for isolated_var in HOME npm_config_cache; do
  case "${!isolated_var}" in
    "$SCRATCH"/*) ok "$isolated_var isolated under scratch" ;;
    *) bad "isolation broken: $isolated_var=${!isolated_var} is not under $SCRATCH" ;;
  esac
done
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  ok "no OPENROUTER_API_KEY in the helper environment"
else
  bad "OPENROUTER_API_KEY is set in the helper environment"
fi

# ── Package selection ─────────────────────────────────────────────
echo
echo "── Package specification"
if [[ -z "$PACKAGE_SPEC" ]]; then
  (cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
  mkdir -p "$SCRATCH/pack"
  TARBALL_NAME="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$SCRATCH/pack" 2>/dev/null | tail -1)"
  PACKAGE_SPEC="$SCRATCH/pack/$TARBALL_NAME"
  echo "ℹ️  Stage 4A substitution: local candidate tarball $PACKAGE_SPEC"
else
  echo "ℹ️  Explicit package specification: $PACKAGE_SPEC"
fi
if [[ -f "$PACKAGE_SPEC" ]]; then
  ok "package specification resolves to a tarball: $(basename "$PACKAGE_SPEC")"
else
  echo "ℹ️  package specification is not a local file; using it as an npm spec (registry access required)"
fi

# The documented standard-input setup pipeline: a non-exported shell
# variable feeds standard input; nothing is exported or echoed.
setup_pipeline() { # setup_pipeline <xdg> <cwd> <out> <err>
  local xdg="$1" dir="$2" out="$3" err="$4" key="$DUMMY_KEY"
  (cd "$dir" && printf '%s\n' "$key" | XDG_CONFIG_HOME="$xdg" \
      timeout 300 npx -y --package "$PACKAGE_SPEC" mcp-intelli-search setup >"$out" 2>"$err")
}

# Runs a CLI subcommand through npx in a subshell.
run_cli() { # run_cli <xdg> <cwd> <out> <err> [args...]
  local xdg="$1" dir="$2" out="$3" err="$4"
  shift 4
  (cd "$dir" && XDG_CONFIG_HOME="$xdg" timeout 300 npx -y --package "$PACKAGE_SPEC" \
      mcp-intelli-search "$@" >"$out" 2>"$err")
}

PROJECT="$SCRATCH/project"
XDG_MAIN="$SCRATCH/xdg-main"
mkdir -p "$PROJECT" "$XDG_MAIN"

# ── S2: documented setup pipeline ─────────────────────────────────
echo
echo "── S2: documented standard-input setup pipeline"
if setup_pipeline "$XDG_MAIN" "$PROJECT" "$SCRATCH/s2-setup.out" "$SCRATCH/s2-setup.err"; then
  ok "setup pipeline exited 0"
else
  bad "setup pipeline exited nonzero"
fi
if rg -qF 'Setup complete.' "$SCRATCH/s2-setup.out"; then
  ok "setup printed Setup complete."
else
  bad "Setup complete. missing from setup output"
fi
if rg -qF "Credential: $XDG_MAIN/mcp-intelli-search/openrouter.key" "$SCRATCH/s2-setup.out" \
  && rg -qF "Configuration: $XDG_MAIN/mcp-intelli-search/config.json" "$SCRATCH/s2-setup.out"; then
  ok "setup named the per-user configuration and credential paths"
else
  bad "setup did not name the expected XDG paths"
fi

# ── S3: credential file and default document ──────────────────────
echo
echo "── S3: stored credential and default configuration"
CREDENTIAL="$XDG_MAIN/mcp-intelli-search/openrouter.key"
CONFIG="$XDG_MAIN/mcp-intelli-search/config.json"
if [[ -f "$CREDENTIAL" ]]; then
  ok "credential file created beside the per-user configuration"
  PERMS="$(stat -c '%a' "$CREDENTIAL")"
  if [[ "$PERMS" == "600" ]]; then
    ok "credential file is user-only (600)"
  else
    bad "credential file permissions: $PERMS"
  fi
  if [[ "$(cat "$CREDENTIAL")" == "$DUMMY_KEY" ]]; then
    ok "credential file holds the dummy value exactly"
  else
    bad "credential file content mismatch"
  fi
else
  bad "credential file was not created"
fi
if [[ -f "$CONFIG" ]]; then
  ok "per-user configuration created"
  if jq -e --arg cred "$CREDENTIAL" \
    '.providers.openrouter.apiKeyFile == $cred
     and .models.search.model == "perplexity/sonar"
     and .models.extract.model == "minimax/minimax-m3"
     and .models.collate.model == "minimax/minimax-m3"' \
    "$CONFIG" >/dev/null 2>&1; then
    ok "default document selects the documented models and the credential path"
  else
    bad "default document shape"
  fi
else
  bad "per-user configuration was not created"
fi

# ── S4: environment precedence ────────────────────────────────────
echo
echo "── S4: environment precedence made explicit"
# Literal assignment prefixes keep the value out of the command name and
# out of this helper's exported environment.
if (cd "$PROJECT" && printf '%s\n' "$DUMMY_KEY" | XDG_CONFIG_HOME="$XDG_MAIN" \
      OPENROUTER_API_KEY="$DUMMY_ENV" \
      timeout 300 npx -y --package "$PACKAGE_SPEC" mcp-intelli-search setup \
      >"$SCRATCH/s4-setup.out" 2>"$SCRATCH/s4-setup.err"); then
  ok "setup with a set environment key exited 0"
else
  bad "setup with a set environment key exited nonzero"
fi
if rg -qF 'Setup complete.' "$SCRATCH/s4-setup.out"; then
  ok "setup still printed Setup complete."
else
  bad "Setup complete. missing with environment key set"
fi
if rg -qF 'OPENROUTER_API_KEY is set and takes precedence over the stored credential' "$SCRATCH/s4-setup.err"; then
  ok "setup printed the documented precedence warning on stderr"
else
  bad "precedence warning missing from setup stderr"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  ok "helper environment did not gain OPENROUTER_API_KEY (pipeline never exports)"
else
  bad "OPENROUTER_API_KEY leaked into the helper environment"
fi

# ── S5: both --check-config success forms ─────────────────────────
echo
echo "── S5: both documented --check-config success forms"
XDG_FRESH="$SCRATCH/xdg-fresh"
mkdir -p "$XDG_FRESH"
if run_cli "$XDG_FRESH" "$PROJECT" "$SCRATCH/s5-builtin.out" "$SCRATCH/s5-builtin.err" --host dsh --check-config; then
  if [[ "$(cat "$SCRATCH/s5-builtin.out")" == "$BUILTIN_FORM" ]]; then
    ok "no per-user file: built-in dsh defaults form, exactly"
  else
    bad "no per-user file: unexpected output: $(cat "$SCRATCH/s5-builtin.out")"
  fi
else
  bad "--check-config failed with no per-user file"
fi
if run_cli "$XDG_MAIN" "$PROJECT" "$SCRATCH/s5-file.out" "$SCRATCH/s5-file.err" --host dsh --check-config; then
  if [[ "$(cat "$SCRATCH/s5-file.out")" == "$FILE_FORM" ]]; then
    ok "per-user file present: plain validity form, exactly"
  else
    bad "per-user file present: unexpected output: $(cat "$SCRATCH/s5-file.out")"
  fi
else
  bad "--check-config failed with the per-user file"
fi
if OPENROUTER_API_KEY='' run_cli "$XDG_MAIN" "$PROJECT" "$SCRATCH/s5-empty.out" "$SCRATCH/s5-empty.err" --host dsh --check-config; then
  if [[ "$(cat "$SCRATCH/s5-empty.out")" == "$FILE_FORM" ]]; then
    ok "empty environment value treated as absent (file form)"
  else
    bad "empty environment value: unexpected output: $(cat "$SCRATCH/s5-empty.out")"
  fi
else
  bad "--check-config rejected the empty environment value"
fi

# ── S6: home and filesystem-root rejection ────────────────────────
echo
echo "── S6: home and filesystem-root workspace rejection"
if run_cli "$XDG_MAIN" "$HOME" "$SCRATCH/s6-home.out" "$SCRATCH/s6-home.err" --host dsh --check-config; then
  bad "home directory: --check-config unexpectedly succeeded"
else
  if rg -qF "$DSH_WORKSPACE_DIAGNOSTIC" "$SCRATCH/s6-home.err" "$SCRATCH/s6-home.out"; then
    ok "home directory refused with the dsh workspace diagnostic"
  else
    bad "home directory: wrong diagnostic"
  fi
fi
if run_cli "$XDG_MAIN" / "$SCRATCH/s6-root.out" "$SCRATCH/s6-root.err" --host dsh --check-config; then
  bad "filesystem root: --check-config unexpectedly succeeded"
else
  if rg -qF "$DSH_WORKSPACE_DIAGNOSTIC" "$SCRATCH/s6-root.err" "$SCRATCH/s6-root.out"; then
    ok "filesystem root refused with the dsh workspace diagnostic"
  else
    bad "filesystem root: wrong diagnostic"
  fi
fi

# ── S7: custom apiKeyFile preservation ────────────────────────────
echo
echo "── S7: custom apiKeyFile preservation"
XDG_CUSTOM="$SCRATCH/xdg-custom"
CUSTOM_KEY_FILE="$SCRATCH/custom-cred/custom.key"
mkdir -p "$XDG_CUSTOM/mcp-intelli-search" "$SCRATCH/custom-cred"
cat > "$XDG_CUSTOM/mcp-intelli-search/config.json" <<EOF
{
  "providers": {
    "openrouter": {
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "apiKeyFile": "$CUSTOM_KEY_FILE"
    }
  },
  "models": {
    "search": { "provider": "openrouter", "model": "perplexity/sonar" },
    "extract": { "provider": "openrouter", "model": "minimax/minimax-m3" },
    "collate": { "provider": "openrouter", "model": "minimax/minimax-m3" }
  }
}
EOF
cp "$XDG_CUSTOM/mcp-intelli-search/config.json" "$SCRATCH/s7-config-before.json"
if setup_pipeline "$XDG_CUSTOM" "$PROJECT" "$SCRATCH/s7-setup.out" "$SCRATCH/s7-setup.err"; then
  ok "setup with a custom credential path exited 0"
else
  bad "setup with a custom credential path exited nonzero"
fi
if rg -qF 'Setup complete.' "$SCRATCH/s7-setup.out" \
  && rg -qF "Credential: $CUSTOM_KEY_FILE" "$SCRATCH/s7-setup.out"; then
  ok "setup honoured the custom credential path"
else
  bad "setup did not name the custom credential path"
fi
if [[ -f "$CUSTOM_KEY_FILE" ]] && [[ "$(cat "$CUSTOM_KEY_FILE")" == "$DUMMY_KEY" ]] \
  && [[ "$(stat -c '%a' "$CUSTOM_KEY_FILE")" == "600" ]]; then
  ok "custom credential file holds the dummy with user-only permissions"
else
  bad "custom credential file missing or wrong"
fi
if cmp -s "$SCRATCH/s7-config-before.json" "$XDG_CUSTOM/mcp-intelli-search/config.json"; then
  ok "configuration file left byte-identical"
else
  bad "configuration file was rewritten"
fi
if [[ ! -e "$XDG_CUSTOM/mcp-intelli-search/openrouter.key" ]]; then
  ok "no default credential file created beside a custom selection"
else
  bad "default openrouter.key created despite the custom selection"
fi

# ── S8: relative XDG falls back to $HOME/.config ──────────────────
echo
echo "── S8: relative XDG_CONFIG_HOME falls back to \$HOME/.config"
if setup_pipeline dsh-verify-relative "$PROJECT" "$SCRATCH/s8-setup.out" "$SCRATCH/s8-setup.err"; then
  ok "setup with a relative XDG_CONFIG_HOME exited 0"
else
  bad "setup with a relative XDG_CONFIG_HOME exited nonzero"
fi
if rg -qF "Credential: $HOME/.config/mcp-intelli-search/openrouter.key" "$SCRATCH/s8-setup.out"; then
  ok "relative XDG_CONFIG_HOME fell back to \$HOME/.config"
else
  bad "relative XDG_CONFIG_HOME did not fall back to the home default"
fi
if [[ ! -e "$PROJECT/dsh-verify-relative" ]]; then
  ok "no directory created from the relative value"
else
  bad "relative XDG value materialised a directory"
fi

# ── S9: redaction ─────────────────────────────────────────────────
echo
echo "── S9: redaction"
LEAK=0
while IFS= read -r captured; do
  if rg -qF "$DUMMY_KEY" "$captured" || rg -qF "$DUMMY_ENV" "$captured"; then
    bad "dummy value leaked into $captured"
    LEAK=1
  fi
done < <(fd -e out -e err -e log . "$SCRATCH")
if [[ "$LEAK" -eq 0 ]]; then
  ok "no dummy value in any captured output or log"
fi

echo
echo "═════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "  node $(node --version) / npm $(npm --version) / package: $PACKAGE_SPEC"
echo "═════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
