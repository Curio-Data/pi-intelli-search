#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
#
# Scenario 20: documented dsh/Codex setup pipeline, credential-free.
#
# Executes the documented standard-input credential setup route of
# @curio-data/mcp-intelli-search against the prebuilt local tarball
# (docs/plans/dsh-host/README-UNIFICATION.md, Track B proposal), with an
# invented dummy key, isolated HOME and npm cache, and per-section XDG
# directories, asserting:
#   - `Setup complete.` and the printed per-user configuration and
#     credential paths;
#   - the stored credential file (user-only 600) beside the created
#     default configuration document with the documented models;
#   - the environment-precedence warning when OPENROUTER_API_KEY is set,
#     without the value leaking anywhere;
#   - both documented --check-config success forms distinguished exactly
#     (built-in DeepSeek Harness defaults vs per-user file), plus the
#     empty-environment-value form;
#   - home and filesystem-root workspace rejection with the exact dsh
#     diagnostic;
#   - custom apiKeyFile preservation (key at the custom path, config.json
#     byte-identical, no default credential file);
#   - relative XDG_CONFIG_HOME falling back to $HOME/.config;
#   - redaction: the dummy never appears in any captured output or log.
#
# No dsh host, no pnpm and no provider call is involved, so this scenario
# has no skip conditions beyond the shared suite prerequisites (node,
# npm, npx, fd, rg; network access to the npm registry). Node.js >= 22
# (the standalone package floor) is required. This is the acceptance
# evidence for the "Runnable credential setup" requirement; the registry
# specification form of the same command is verified separately in the
# release host checks (Stage 6), not here.
#
# Environment: E2E_SKIP_BUILD=1 reuses the suite's prebuilt standalone
# artifact and packs with --ignore-scripts, as scenarios 12, 14 and 18 do.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-dsh-setup-pipeline-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

E2E_ROOT="$(mktemp -d "${TMPDIR:-$PROJECT_DIR/.tmp}/intelli-dsh-setup-XXXXXXXX")"
echo "📁 Scratch: $E2E_ROOT"

# ── Prerequisites ─────────────────────────────────────────────────

for tool in node npm npx fd rg jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool"
    exit 1
  fi
done
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+)\..*$/\1/')"
if [[ "${NODE_MAJOR:-0}" -lt 22 ]]; then
  echo "⚠️  SKIP: scenario 20 requires Node.js >= 22 (the standalone package floor); found $(node --version)."
  exit 77
fi

# ── Isolation ─────────────────────────────────────────────────────
# One isolated HOME and npm cache serve the whole run; every npx
# invocation shares the cache so the package is downloaded once.

export HOME="$E2E_ROOT/home"
export npm_config_cache="$E2E_ROOT/npm-cache"
mkdir -p "$HOME" "$npm_config_cache"

# Drop inherited credential-shaped variables by name without reading
# their values; nothing in this scenario may observe a real credential.
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
  # The invented dummy never survives the run, even on failure; scratch
  # is retained on failure for debugging only.
  if [[ -d "$E2E_ROOT" ]]; then
    fd -t f 'openrouter.key|custom.key' "$E2E_ROOT" -x rm -f '{}' 2>/dev/null || true
  fi
  if [[ "$rc" -eq 0 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); echo "✅ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "❌ $1"; }

# An invented value, never a real credential; never printed or logged.
DUMMY_KEY="intelli-s20-invented-dummy-key"
DUMMY_ENV="intelli-s20-invented-dummy-env"
BUILTIN_FORM='Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).'
FILE_FORM='Configuration is valid.'
DSH_WORKSPACE_DIAGNOSTIC='DeepSeek Harness working directory must be a project directory, not the home or filesystem root; start the harness from the project or set cwd on the bridge row'

for isolated_var in HOME npm_config_cache; do
  case "${!isolated_var}" in
    "$E2E_ROOT"/*) ;;
    *)
      echo "❌ isolation broken: $isolated_var=${!isolated_var} is not under $E2E_ROOT"
      exit 1
      ;;
  esac
done
ok "HOME and npm cache isolated under scratch"

# ── Step 1: build and pack the standalone tarball ────────────────

echo
echo "── Step 1: pack the standalone tarball"
if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then
  ok "using prebuilt standalone artifact"
else
  (cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
fi
PACK_ARGS=()
if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then PACK_ARGS=(--ignore-scripts); fi
TARBALL="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$E2E_ROOT" "${PACK_ARGS[@]}" 2>/dev/null | tail -1)"
TARBALL="$E2E_ROOT/$(basename "$TARBALL")"
if [[ -f "$TARBALL" ]]; then
  ok "packed $(basename "$TARBALL")"
else
  bad "npm pack produced no tarball"
fi
PACKAGE_SPEC="$TARBALL"

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

PROJECT="$E2E_ROOT/project"
XDG_MAIN="$E2E_ROOT/xdg-main"
mkdir -p "$PROJECT" "$XDG_MAIN"

# ── Step 2: documented setup pipeline ─────────────────────────────

echo
echo "── Step 2: documented standard-input setup pipeline"
if setup_pipeline "$XDG_MAIN" "$PROJECT" "$E2E_ROOT/s2-setup.out" "$E2E_ROOT/s2-setup.err"; then
  ok "setup pipeline exited 0"
else
  bad "setup pipeline exited nonzero"
fi
if rg -qF 'Setup complete.' "$E2E_ROOT/s2-setup.out"; then
  ok "setup printed Setup complete."
else
  bad "Setup complete. missing from setup output"
fi
if rg -qF "Credential: $XDG_MAIN/mcp-intelli-search/openrouter.key" "$E2E_ROOT/s2-setup.out" \
  && rg -qF "Configuration: $XDG_MAIN/mcp-intelli-search/config.json" "$E2E_ROOT/s2-setup.out"; then
  ok "setup named the per-user configuration and credential paths"
else
  bad "setup did not name the expected XDG paths"
fi

# ── Step 3: stored credential and default document ────────────────

echo
echo "── Step 3: stored credential and default configuration"
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
if [[ -f "$CONFIG" ]] && jq -e --arg cred "$CREDENTIAL" \
    '.providers.openrouter.apiKeyFile == $cred
     and .models.search.model == "perplexity/sonar"
     and .models.extract.model == "minimax/minimax-m3"
     and .models.collate.model == "minimax/minimax-m3"' \
    "$CONFIG" >/dev/null 2>&1; then
  ok "default document selects the documented models and the credential path"
else
  bad "default document shape"
fi

# ── Step 4: environment precedence ────────────────────────────────

echo
echo "── Step 4: environment precedence made explicit"
if (cd "$PROJECT" && printf '%s\n' "$DUMMY_KEY" | XDG_CONFIG_HOME="$XDG_MAIN" \
      OPENROUTER_API_KEY="$DUMMY_ENV" \
      timeout 300 npx -y --package "$PACKAGE_SPEC" mcp-intelli-search setup \
      >"$E2E_ROOT/s4-setup.out" 2>"$E2E_ROOT/s4-setup.err"); then
  ok "setup with a set environment key exited 0"
else
  bad "setup with a set environment key exited nonzero"
fi
if rg -qF 'OPENROUTER_API_KEY is set and takes precedence over the stored credential' "$E2E_ROOT/s4-setup.err"; then
  ok "setup printed the documented precedence warning on stderr"
else
  bad "precedence warning missing from setup stderr"
fi
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  ok "scenario environment did not gain OPENROUTER_API_KEY"
else
  bad "OPENROUTER_API_KEY leaked into the scenario environment"
fi

# ── Step 5: both --check-config success forms ─────────────────────

echo
echo "── Step 5: both documented --check-config success forms"
XDG_FRESH="$E2E_ROOT/xdg-fresh"
mkdir -p "$XDG_FRESH"
if run_cli "$XDG_FRESH" "$PROJECT" "$E2E_ROOT/s5-builtin.out" "$E2E_ROOT/s5-builtin.err" --host dsh --check-config; then
  if [[ "$(cat "$E2E_ROOT/s5-builtin.out")" == "$BUILTIN_FORM" ]]; then
    ok "no per-user file: built-in dsh defaults form, exactly"
  else
    bad "no per-user file: unexpected output"
  fi
else
  bad "--check-config failed with no per-user file"
fi
if run_cli "$XDG_MAIN" "$PROJECT" "$E2E_ROOT/s5-file.out" "$E2E_ROOT/s5-file.err" --host dsh --check-config; then
  if [[ "$(cat "$E2E_ROOT/s5-file.out")" == "$FILE_FORM" ]]; then
    ok "per-user file present: plain validity form, exactly"
  else
    bad "per-user file present: unexpected output"
  fi
else
  bad "--check-config failed with the per-user file"
fi
if OPENROUTER_API_KEY='' run_cli "$XDG_MAIN" "$PROJECT" "$E2E_ROOT/s5-empty.out" "$E2E_ROOT/s5-empty.err" --host dsh --check-config; then
  if [[ "$(cat "$E2E_ROOT/s5-empty.out")" == "$FILE_FORM" ]]; then
    ok "empty environment value treated as absent (file form)"
  else
    bad "empty environment value: unexpected output"
  fi
else
  bad "--check-config rejected the empty environment value"
fi

# ── Step 6: home and filesystem-root rejection ────────────────────

echo
echo "── Step 6: home and filesystem-root workspace rejection"
if run_cli "$XDG_MAIN" "$HOME" "$E2E_ROOT/s6-home.out" "$E2E_ROOT/s6-home.err" --host dsh --check-config; then
  bad "home directory: --check-config unexpectedly succeeded"
else
  if rg -qF "$DSH_WORKSPACE_DIAGNOSTIC" "$E2E_ROOT/s6-home.err" "$E2E_ROOT/s6-home.out"; then
    ok "home directory refused with the dsh workspace diagnostic"
  else
    bad "home directory: wrong diagnostic"
  fi
fi
if run_cli "$XDG_MAIN" / "$E2E_ROOT/s6-root.out" "$E2E_ROOT/s6-root.err" --host dsh --check-config; then
  bad "filesystem root: --check-config unexpectedly succeeded"
else
  if rg -qF "$DSH_WORKSPACE_DIAGNOSTIC" "$E2E_ROOT/s6-root.err" "$E2E_ROOT/s6-root.out"; then
    ok "filesystem root refused with the dsh workspace diagnostic"
  else
    bad "filesystem root: wrong diagnostic"
  fi
fi

# ── Step 7: custom apiKeyFile preservation ────────────────────────

echo
echo "── Step 7: custom apiKeyFile preservation"
XDG_CUSTOM="$E2E_ROOT/xdg-custom"
CUSTOM_KEY_FILE="$E2E_ROOT/custom-cred/custom.key"
mkdir -p "$XDG_CUSTOM/mcp-intelli-search" "$E2E_ROOT/custom-cred"
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
cp "$XDG_CUSTOM/mcp-intelli-search/config.json" "$E2E_ROOT/s7-config-before.json"
if setup_pipeline "$XDG_CUSTOM" "$PROJECT" "$E2E_ROOT/s7-setup.out" "$E2E_ROOT/s7-setup.err"; then
  ok "setup with a custom credential path exited 0"
else
  bad "setup with a custom credential path exited nonzero"
fi
if rg -qF "Credential: $CUSTOM_KEY_FILE" "$E2E_ROOT/s7-setup.out"; then
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
if cmp -s "$E2E_ROOT/s7-config-before.json" "$XDG_CUSTOM/mcp-intelli-search/config.json"; then
  ok "configuration file left byte-identical"
else
  bad "configuration file was rewritten"
fi
if [[ ! -e "$XDG_CUSTOM/mcp-intelli-search/openrouter.key" ]]; then
  ok "no default credential file created beside a custom selection"
else
  bad "default openrouter.key created despite the custom selection"
fi

# ── Step 8: relative XDG falls back to $HOME/.config ──────────────

echo
echo "── Step 8: relative XDG_CONFIG_HOME falls back to \$HOME/.config"
if setup_pipeline s20-relative-xdg "$PROJECT" "$E2E_ROOT/s8-setup.out" "$E2E_ROOT/s8-setup.err"; then
  ok "setup with a relative XDG_CONFIG_HOME exited 0"
else
  bad "setup with a relative XDG_CONFIG_HOME exited nonzero"
fi
if rg -qF "Credential: $HOME/.config/mcp-intelli-search/openrouter.key" "$E2E_ROOT/s8-setup.out"; then
  ok "relative XDG_CONFIG_HOME fell back to \$HOME/.config"
else
  bad "relative XDG_CONFIG_HOME did not fall back to the home default"
fi
if [[ ! -e "$PROJECT/s20-relative-xdg" ]]; then
  ok "no directory created from the relative value"
else
  bad "relative XDG value materialised a directory"
fi

# ── Step 9: redaction ─────────────────────────────────────────────

echo
echo "── Step 9: redaction"
LEAK=0
while IFS= read -r captured; do
  if rg -qF "$DUMMY_KEY" "$captured" || rg -qF "$DUMMY_ENV" "$captured"; then
    bad "dummy value leaked into $captured"
    LEAK=1
  fi
done < <(fd -e out -e err -e log . "$E2E_ROOT" -E "$LOG_FILE")
if rg -qF "$DUMMY_KEY" "$LOG_FILE" 2>/dev/null || rg -qF "$DUMMY_ENV" "$LOG_FILE" 2>/dev/null; then
  bad "dummy value leaked into the scenario log"
  LEAK=1
fi
if [[ "$LEAK" -eq 0 ]]; then
  ok "no dummy value in any captured output or log"
fi

# ── Summary ───────────────────────────────────────────────────────

echo
echo "═════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed, $SKIP skipped"
echo "  node $(node --version) / npm $(npm --version) / tarball $(basename "$TARBALL")"
echo "═════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
