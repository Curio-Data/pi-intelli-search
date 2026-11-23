#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
#
# Credential-free verification of the documented DeepSeek Harness (dsh)
# profile, installation, configuration-check, tool and skill discovery,
# and removal/reinstallation routes of @curio-data/dsh-intelli-search
# (docs/plans/dsh-host/README-UNIFICATION.md, Stage 1 Track B; reused by
# the Stage 4A host checks).
#
# Exercises, against the real pinned dsh host, with an invented dummy key
# (never a real credential, never printed) and fully isolated HOME,
# DSH_HOME, DSH_AGENTS_HOME, XDG and npm/pnpm state under worktree
# scratch:
#   L1  prerequisites: node >= 24.9 (the dsh floor), npm, jq, fd, rg and
#       the repository semver CLI;
#   L2  host provisioning: DSH_BIN from the caller or an isolated pinned
#       host installed into scratch; pnpm from PATH or installed into
#       scratch (plan § Environment and Isolation);
#   L3  full isolation of HOME, DSH_HOME, DSH_AGENTS_HOME, XDG and npm
#       cache under scratch;
#   L4  local-tarball bundle preparation: build, pack, generator tarball
#       mode and vendor install (skipped with --bundle);
#   L5  profile creation from the headless template (a provisioning step,
#       not a user-documented route) and profile selection via --profile;
#   L6  documented installation: dsh plugin --profile <name> add <bundle>;
#   L7  documented verification: dsh --profile <name> --dump-config shows
#       exactly one bridge row and one skill row, environment expression
#       verbatim;
#   L8  documented credential-free configuration check from the project
#       directory through the bundle's pinned server (--check-config
#       built-in dsh-defaults form);
#   L9  four tools and skill registration without any credential, through
#       the scenario-18 inspector mounted in the profile user patch layer,
#       with the headless model turn stopping at MISSING_CREDENTIAL;
#   L10 launched-server environment: a custom absolute XDG_CONFIG_HOME at
#       launch and a dummy key from the harness-home .env layer both reach
#       the MCP child (scripts/dsh-server-env-observer.mjs marker), with
#       tools and skill still registered;
#   L11 documented removal by package name and reinstallation, with the
#       composed rows disappearing and returning;
#   L12 redaction: the dummy never appears in any captured output or log.
#
# The exact documented registry command (`dsh plugin --profile <name> add
# @curio-data/dsh-intelli-search`) is exercised only in Stage 6; this
# helper substitutes the generated local-tarball bundle directory and
# records that substitution. No provider call is made and no full-pipeline
# inference is claimed.
#
# Usage:
#   scripts/verify-dsh-lifecycle.sh [--bundle <dir>] [--dsh-version <ver>]
#                                   [--profile <name>] [--keep]
#
# DSH_BIN selects an already-isolated host binary (for example a second
# rc.5 prefix with its own DSH_BIN). Scratch lives under
# ${TMPDIR:-$PROJECT_DIR/.tmp} and is removed on success unless --keep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUNDLE_DIR=""
DSH_VERSION="0.2.2-rc.1"
PROFILE_NAME="intelli-trackb"
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE_DIR="${2:?--bundle requires a directory}"; shift 2 ;;
    --dsh-version) DSH_VERSION="${2:?--dsh-version requires a version}"; shift 2 ;;
    --profile) PROFILE_NAME="${2:?--profile requires a name}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,50s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
if [[ -n "$BUNDLE_DIR" && ! -d "$BUNDLE_DIR" ]]; then
  echo "❌ --bundle is not a directory: $BUNDLE_DIR" >&2
  exit 2
fi

for tool in node npm jq fd rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool" >&2
    exit 1
  fi
done
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+)\..*$/\1/')"
NODE_MINOR="$(node --version | sed -E 's/^v[0-9]+\.([0-9]+).*$/\1/')"
if [[ "${NODE_MAJOR:-0}" -lt 24 || ( "$NODE_MAJOR" -eq 24 && "${NODE_MINOR:-0}" -lt 9 ) ]]; then
  echo "❌ This helper requires Node.js >= 24.9.0 (the dsh engine floor); found $(node --version)." >&2
  exit 1
fi
if [[ ! -x "$PROJECT_DIR/node_modules/.bin/semver" ]]; then
  echo '❌ The semver CLI is required. Install repository dev dependencies with npm ci.' >&2
  exit 1
fi

SCRATCH="$(mktemp -d "${TMPDIR:-$PROJECT_DIR/.tmp}/dsh-verify-lifecycle-XXXXXXXX")"
LOG_FILE="$SCRATCH/run.log"
echo "📁 Scratch: $SCRATCH"
exec > >(tee -a "$LOG_FILE") 2>&1

# Isolation: HOME must cover the whole run because dsh plugin forwards to
# pnpm and pnpm derives its store from HOME/XDG_DATA_HOME. The scratch
# home and the profile share one filesystem, keeping the store in scratch.
export HOME="$SCRATCH/home"
export DSH_HOME="$SCRATCH/dsh-home"
export DSH_AGENTS_HOME="$SCRATCH/dsh-agents-home"
export XDG_CONFIG_HOME="$SCRATCH/xdg-config"
export XDG_DATA_HOME="$SCRATCH/xdg-data"
export npm_config_cache="$SCRATCH/npm-cache"
mkdir -p "$HOME" "$DSH_HOME" "$DSH_AGENTS_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$npm_config_cache"

# Drop inherited credential-shaped variables by name without reading their
# values; the headless host must end with MISSING_CREDENTIAL for its own
# model and nothing here may observe a real credential.
while IFS= read -r var; do
  case "${var^^}" in
    *API_KEY*|*TOKEN*|*SECRET*|*PASSWORD*)
      if ! unset "$var" 2>/dev/null; then
        echo '❌ Cannot isolate the host from inherited credentials; run in a clean environment.' >&2
        exit 1
      fi ;;
  esac
done < <(compgen -e)

cleanup() {
  local rc=$?
  # The invented dummy and its stored copy never survive the run, even on
  # failure; scratch is kept on failure for debugging only.
  rm -f "$DSH_HOME/.env"
  if [[ -d "$SCRATCH" ]]; then
    fd -t f 'openrouter.key' "$SCRATCH" -x rm -f '{}' 2>/dev/null || true
  fi
  if [[ "$rc" -eq 0 && "$KEEP" -eq 0 ]]; then rm -rf "$SCRATCH"; fi
  exit "$rc"
}
trap cleanup EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "✅ $1"; }
bad() { FAIL=$((FAIL + 1)); echo "❌ $1"; }

count_re() { # count_re <pattern> <file>: rg -c that prints 0 when absent
  rg -c "$1" "$2" || echo 0
}
count_fixed() { # count_fixed <string> <file>: rg -c -F that prints 0 when absent
  rg -c -F "$1" "$2" || echo 0
}

# An invented value, never a real credential; never printed.
DUMMY_VALUE="intelli-trackb-invented-dummy-key"
INSPECTOR="$PROJECT_DIR/test/e2e/dsh/inspect.mjs"
OBSERVER="$PROJECT_DIR/scripts/dsh-server-env-observer.mjs"
BUILTIN_FORM='Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).'

# ── L1-L3: prerequisites, isolation, host provisioning ───────────
echo
echo "── L1-L3: prerequisites, isolation and host provisioning"
for isolated_var in HOME DSH_HOME DSH_AGENTS_HOME XDG_CONFIG_HOME XDG_DATA_HOME npm_config_cache; do
  case "${!isolated_var}" in
    "$SCRATCH"/*) ok "$isolated_var isolated under scratch" ;;
    *) bad "isolation broken: $isolated_var=${!isolated_var} is not under $SCRATCH" ;;
  esac
done

if [[ -z "${DSH_BIN:-}" ]]; then
  DSH_PREFIX="$SCRATCH/dsh-prefix"
  echo "ℹ️  Installing the pinned host @deepseek-ai/dsh@$DSH_VERSION into scratch (DSH_BIN unset)"
  DSH_HOME="$DSH_HOME" DSH_AGENTS_HOME="$DSH_AGENTS_HOME" npm_config_cache="$npm_config_cache" \
    npm install --prefix "$DSH_PREFIX" "@deepseek-ai/dsh@$DSH_VERSION" >/dev/null 2>&1
  DSH_BIN="$DSH_PREFIX/node_modules/.bin/dsh"
fi
if [[ ! -x "$DSH_BIN" ]] && ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  bad "DSH_BIN does not resolve to an executable: $DSH_BIN"
  echo "❌ Provide DSH_BIN or let the helper install the pinned host into scratch." >&2
  exit 1
fi
DSH_BIN="$(command -v "$DSH_BIN")"
if ! command -v pnpm >/dev/null 2>&1; then
  PNPM_PREFIX="$SCRATCH/pnpm"
  echo "ℹ️  Installing an isolated pnpm into scratch (pnpm absent from PATH)"
  npm_config_cache="$npm_config_cache" npm install --prefix "$PNPM_PREFIX" pnpm >/dev/null 2>&1
  export PATH="$PNPM_PREFIX/node_modules/.bin:$PATH"
fi

DSH_VERSION_ACTUAL="$("$DSH_BIN" --version)"
echo "🔧 dsh $DSH_VERSION_ACTUAL, node $(node --version), pnpm $(pnpm --version), npm $(npm --version)"
if [[ -z "$BUNDLE_DIR" ]]; then
  DSH_RANGE="$(jq -er '.engines.dsh' "$PROJECT_DIR/plugins/dsh/package.json")"
else
  DSH_RANGE="$(jq -er '.engines.dsh' "$BUNDLE_DIR/package.json")"
fi
if "$PROJECT_DIR/node_modules/.bin/semver" --include-prerelease -r "$DSH_RANGE" "$DSH_VERSION_ACTUAL" >/dev/null; then
  ok "dsh $DSH_VERSION_ACTUAL satisfies $DSH_RANGE"
else
  bad "dsh $DSH_VERSION_ACTUAL is outside declared range $DSH_RANGE"
fi

# ── L4: local-tarball bundle preparation ─────────────────────────
echo
echo "── L4: local-tarball bundle preparation"
if [[ -n "$BUNDLE_DIR" ]]; then
  DSH_BUNDLE="$BUNDLE_DIR"
  echo "ℹ️  Using the caller-provided bundle directory: $DSH_BUNDLE"
else
  (cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
  mkdir -p "$SCRATCH/pack"
  TARBALL_NAME="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$SCRATCH/pack" 2>/dev/null | tail -1)"
  TARBALL="$SCRATCH/pack/$TARBALL_NAME"
  if [[ -f "$TARBALL" ]]; then
    ok "packed $TARBALL_NAME"
  else
    bad "npm pack produced no tarball"
  fi
  BUNDLES="$SCRATCH/bundles"
  node "$PROJECT_DIR/scripts/generate-plugin-bundles.mjs" \
    --mode tarball --output "$BUNDLES" \
    --codex-vendor-dir "$BUNDLES/plugins/codex/vendor" >/dev/null
  DSH_BUNDLE="$BUNDLES/plugins/dsh"
  VENDORED_CLI="$DSH_BUNDLE/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js"
  npm install --prefix "$DSH_BUNDLE/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
  if [[ -f "$VENDORED_CLI" ]]; then
    ok "generated the local-tarball dsh bundle with a vendored server"
  else
    bad "dsh bundle vendor install"
  fi
fi
VENDORED_CLI="${VENDORED_CLI:-$DSH_BUNDLE/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js}"
if [[ -f "$VENDORED_CLI" ]]; then
  ok "bundle carries the pinned vendored server CLI"
else
  bad "no vendored server CLI under the bundle (--bundle expects a tarball-mode bundle)"
fi
if [[ ! -d "$PROJECT_DIR/plugins/dsh/vendor" ]]; then
  ok "tracked plugins/dsh carries no vendor tree"
else
  bad "tracked plugins/dsh unexpectedly contains a vendor tree"
fi

# ── L5: profile creation and selection ────────────────────────────
echo
echo "── L5: profile creation and selection"
WORKSPACE="$SCRATCH/workspace/project"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
"$DSH_BIN" --profile "$PROFILE_NAME" --from-default-profile headless --dump-config \
  > "$SCRATCH/dump-create.yml" 2> "$SCRATCH/dump-create.err"
if [[ -d "$DSH_HOME/profiles/$PROFILE_NAME" ]]; then
  ok "profile $PROFILE_NAME created under \$DSH_HOME/profiles (headless template)"
else
  bad "profile directory missing under \$DSH_HOME/profiles"
fi

# ── L6: documented installation ──────────────────────────────────
echo
echo "── L6: documented installation (local-tarball substitution)"
echo "ℹ️  Documented registry form: dsh plugin --profile $PROFILE_NAME add @curio-data/dsh-intelli-search"
if "$DSH_BIN" plugin --profile "$PROFILE_NAME" add "$DSH_BUNDLE" > "$SCRATCH/plugin-add.log" 2>&1; then
  ok "dsh plugin --profile $PROFILE_NAME add <bundle>"
else
  bad "dsh plugin add failed"
fi

# ── L7: documented dump-config verification ──────────────────────
echo
echo "── L7: documented --dump-config verification"
DUMP_BUNDLE="$SCRATCH/dump-bundle.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_BUNDLE" 2>/dev/null
BRIDGE_ROWS="$(count_re '^- id: mcp-intelli-search$' "$DUMP_BUNDLE")"
SKILL_ROWS="$(count_re '^- id: intelli-search-skill$' "$DUMP_BUNDLE")"
if [[ "$BRIDGE_ROWS" == "1" && "$SKILL_ROWS" == "1" ]]; then
  ok "both bundle rows composed exactly once"
else
  bad "bundle rows composed (bridge=$BRIDGE_ROWS skill=$SKILL_ROWS)"
fi
if rg -q "OPENROUTER_API_KEY: !!js process\\.env\\.OPENROUTER_API_KEY \\|\\| ''$" "$DUMP_BUNDLE"; then
  ok "environment expression composed verbatim"
else
  bad "environment expression missing from the composed row"
fi

# ── L8: documented credential-free configuration check ────────────
echo
echo "── L8: --check-config from the project directory (bundle's pinned server)"
cd "$WORKSPACE"
if node "$VENDORED_CLI" --host dsh --check-config > "$SCRATCH/check-project.out" 2>&1; then
  if [[ "$(cat "$SCRATCH/check-project.out")" == "$BUILTIN_FORM" ]]; then
    ok "project directory: built-in dsh defaults form, exactly"
  else
    bad "project directory: unexpected --check-config output"
  fi
else
  bad "project directory: --check-config failed"
fi

# ── L9: tools and skill discovery without credentials ─────────────
echo
echo "── L9: four tools and skill registration without credentials"
USER_PATCH="$DSH_HOME/profiles/$PROFILE_NAME/cordis.patch.yml"
cat > "$USER_PATCH" <<EOF
# Track B verification inspection layer. The inspector is the scenario-18
# plugin mounted through this user patch layer, never part of the bundle.
- insert:
    - id: intelli-inspector
      name: '$INSPECTOR'
EOF
run_headless() { # run_headless <label> <inspect-out> <expect-tools yes|no>
  local label="$1" out="$2" expect="$3" rc=0
  DSH_INSPECT_OUT="$out" DSH_INSPECT_EXPECT_TOOLS="$expect" \
    timeout --foreground 150s "$DSH_BIN" --profile "$PROFILE_NAME" --json \
    'Reply without using any tools.' < /dev/null \
    > "$SCRATCH/headless-$label.jsonl" 2> "$SCRATCH/headless-$label.err" || rc=$?
  if [[ $rc != 1 ]] || ! jq -es 'last | .type == "final" and .reason.kind == "error" and .reason.error.code == "MISSING_CREDENTIAL"' "$SCRATCH/headless-$label.jsonl" >/dev/null; then
    bad "$label: expected final MISSING_CREDENTIAL and exit 1, observed exit $rc"
    return 1
  fi
  ok "$label: model turn stopped with MISSING_CREDENTIAL (no provider call)"
  test -s "$out"
}
INSPECT_NOKEY="$SCRATCH/inspect-nokey.json"
if run_headless nokey "$INSPECT_NOKEY" yes; then
  ok "headless run reached the inspection probe"
else
  bad "headless run produced no inspection result"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_NOKEY")" == "true" ]]; then
  ok "all four mcp__intelli__* tools registered without any key"
else
  bad "tool registration incomplete: $(jq -c '{intelliTools, missing}' "$INSPECT_NOKEY")"
fi
if [[ "$(jq -r '.skillOk' "$INSPECT_NOKEY")" == "true" ]]; then
  ok "bundled skill registered and loadable without credentials"
else
  bad "bundled skill not correctly registered"
fi
for tool in intelli_search intelli_extract intelli_collate intelli_research; do
  if jq -e --arg t "mcp__intelli__$tool" '.intelliTools | index($t) != null' "$INSPECT_NOKEY" >/dev/null; then
    ok "tool registered: mcp__intelli__$tool"
  else
    bad "tool missing: mcp__intelli__$tool"
  fi
done

# ── L10: launched-server environment observation ─────────────────
echo
echo "── L10: custom XDG and dummy key reach the launched MCP child"
# Prepare the harness-home .env layer exactly as documented.
(umask 077; touch "$DSH_HOME/.env") && chmod 600 "$DSH_HOME/.env"
printf 'OPENROUTER_API_KEY=%s\n' "$DUMMY_VALUE" > "$DSH_HOME/.env"
XDG_LAUNCH="$SCRATCH/xdg-custom-launch"
mkdir -p "$XDG_LAUNCH"
cat > "$USER_PATCH" <<EOF
# Track B verification layer with the environment observer. An
# id-targeted user patch replaces the whole config, so the bridge row is
# restated in full with the observer as its command.
- insert:
    - id: intelli-inspector
      name: '$INSPECTOR'
- id: mcp-intelli-search
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: intelli
    transport: stdio
    command: node
    args:
      - '$OBSERVER'
      - '$SCRATCH/env-marker.json'
      - '$VENDORED_CLI'
      - '--host'
      - 'dsh'
    env:
      OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''
    toolCallTimeoutMs: 600000
    failOnStartupError: false
EOF
DUMP_OBSERVER="$SCRATCH/dump-observer.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_OBSERVER" 2>/dev/null
if rg -qF "$OBSERVER" "$DUMP_OBSERVER"; then
  ok "observer composed as the effective bridge command"
else
  bad "composed bridge command was not replaced"
fi
rm -f "$SCRATCH/env-marker.json"
INSPECT_ENV="$SCRATCH/inspect-env.json"
if XDG_CONFIG_HOME="$XDG_LAUNCH" run_headless env "$INSPECT_ENV" yes; then
  ok "observer headless run reached the inspection probe"
else
  bad "observer headless run produced no inspection result"
fi
if [[ -f "$SCRATCH/env-marker.json" ]] \
  && [[ "$(jq -r '.xdgConfigHome' "$SCRATCH/env-marker.json")" == "$XDG_LAUNCH" ]]; then
  ok "custom absolute XDG_CONFIG_HOME reached the launched MCP child"
else
  bad "launched MCP child did not see the custom XDG path"
fi
if [[ -f "$SCRATCH/env-marker.json" ]] \
  && [[ "$(jq -r '.keyArrived' "$SCRATCH/env-marker.json")" == "true" ]]; then
  ok "dummy credential from the \$DSH_HOME/.env layer reached the MCP child"
else
  bad "dummy credential delivery through the environment layer"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_ENV")" == "true" && "$(jq -r '.skillOk' "$INSPECT_ENV")" == "true" ]]; then
  ok "tools and skill still registered with the observer in the launch chain"
else
  bad "registration lost with the observer launcher"
fi
rm -f "$DSH_HOME/.env"

# ── L11: documented removal and reinstallation ────────────────────
echo
echo "── L11: documented removal and reinstallation"
cat > "$USER_PATCH" <<EOF
# Track B verification inspection layer.
- insert:
    - id: intelli-inspector
      name: '$INSPECTOR'
EOF
if "$DSH_BIN" plugin --profile "$PROFILE_NAME" remove @curio-data/dsh-intelli-search \
  > "$SCRATCH/plugin-remove.log" 2>&1; then
  ok "dsh plugin --profile $PROFILE_NAME remove @curio-data/dsh-intelli-search"
else
  bad "dsh plugin remove failed"
fi
DUMP_REMOVED="$SCRATCH/dump-removed.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_REMOVED" 2>/dev/null
REMOVED_BRIDGE="$(count_re '^- id: mcp-intelli-search$|^    - id: mcp-intelli-search$' "$DUMP_REMOVED")"
REMOVED_SKILL="$(count_re 'intelli-search-skill' "$DUMP_REMOVED")"
if [[ "$REMOVED_BRIDGE" -eq 0 && "$REMOVED_SKILL" -eq 0 ]]; then
  ok "both bundle rows gone after removal (documented confirmation)"
else
  bad "composed rows after removal (bridge=$REMOVED_BRIDGE skill=$REMOVED_SKILL)"
fi
if jq -e --arg p "$DSH_BUNDLE" '.dependencies // {} | has("@curio-data/dsh-intelli-search") | not' \
  "$DSH_HOME/profiles/$PROFILE_NAME/package.json" >/dev/null; then
  ok "profile manifest no longer selects the bundle"
else
  bad "profile manifest still selects the bundle"
fi
INSPECT_ABSENT="$SCRATCH/inspect-absent.json"
if run_headless absent "$INSPECT_ABSENT" no; then
  ok "fresh host process after removal reached the inspection probe"
else
  bad "fresh host process produced no inspection result"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_ABSENT")" == "true" && "$(jq -r '.skillOk' "$INSPECT_ABSENT")" == "true" ]]; then
  ok "bundle tools and skill absent after removal while the inspector stays mounted"
else
  bad "removal did not remove the bundle's tools and skill"
fi
if "$DSH_BIN" plugin --profile "$PROFILE_NAME" add "$DSH_BUNDLE" > "$SCRATCH/plugin-readd.log" 2>&1; then
  ok "reinstallation with the same documented command"
else
  bad "reinstallation failed"
fi
DUMP_READDED="$SCRATCH/dump-readded.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_READDED" 2>/dev/null
READDED_BRIDGE="$(count_re '^- id: mcp-intelli-search$' "$DUMP_READDED")"
READDED_SKILL="$(count_re '^- id: intelli-search-skill$' "$DUMP_READDED")"
if [[ "$READDED_BRIDGE" == "1" && "$READDED_SKILL" == "1" ]]; then
  ok "both bundle rows composed again after reinstallation"
else
  bad "reinstallation rows (bridge=$READDED_BRIDGE skill=$READDED_SKILL)"
fi
INSPECT_BACK="$SCRATCH/inspect-back.json"
if run_headless back "$INSPECT_BACK" yes; then
  ok "headless run after reinstallation reached the inspection probe"
else
  bad "headless run after reinstallation produced no inspection result"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_BACK")" == "true" && "$(jq -r '.skillOk' "$INSPECT_BACK")" == "true" ]]; then
  ok "tools and skill return after reinstallation"
else
  bad "reinstallation did not restore tools and skill"
fi

# ── L12: redaction ────────────────────────────────────────────────
echo
echo "── L12: redaction"
LEAK=0
while IFS= read -r captured; do
  if rg -qF "$DUMMY_VALUE" "$captured"; then
    bad "dummy value leaked into $captured"
    LEAK=1
  fi
done < <(fd -e out -e err -e log -e jsonl -e yml . "$SCRATCH")
if [[ "$LEAK" -eq 0 ]]; then
  ok "no dummy value in any captured output, dump or log"
fi

echo
echo "═════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "  dsh $DSH_VERSION_ACTUAL / node $(node --version) / pnpm $(pnpm --version)"
echo "═════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
