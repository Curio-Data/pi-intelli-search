#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
#
# Scenario 18: DeepSeek Harness (dsh) host verification, credential-free.
#
# Installs the generated local-tarball dsh bundle into an isolated dsh
# profile and proves, on the real pinned host, with no provider call:
#   - exact installation and both composed bundle rows (--dump-config);
#   - the four mcp__intelli__* tools and the bundled skill through a
#     scenario-owned inspector mounted in the profile user patch layer;
#   - dummy credential delivery through the harness environment layer,
#     by restating the bridge row with a wrapper command;
#   - the built-in dsh defaults plus the home and filesystem-root
#     workspace guards of --host dsh;
#   - package removal losing tools and skill, and reinstallation
#     restoring them, with the inspector mounted throughout.
#
# The headless host is expected to end with MISSING_CREDENTIAL for its own
# model after the inspection probe; no model turn and no provider request
# ever completes. The only key material is an invented dummy, never a real
# credential, and its value is never printed or logged.
#
# Requires: node, npm, jq, rg; pnpm on PATH (dsh plugin forwards to pnpm);
# dsh >= 0.2.2-rc.1 through DSH_BIN or PATH; Node.js >= 24.9.0 (the dsh
# floor). Skips with exit 77 naming the exact missing prerequisite.
#
# Environment: E2E_SKIP_BUILD=1 reuses the suite's prebuilt standalone
# artifact and packs with --ignore-scripts, as scenarios 12 and 14 do.
# Isolated pnpm recipe (plan § Environment and Isolation):
#   npm install --prefix .tmp/dsh/pnpm pnpm
#   export PATH="$PWD/.tmp/dsh/pnpm/node_modules/.bin:$PATH"
# The isolated host recipe installs @deepseek-ai/dsh@0.2.2-rc.1 under
# .tmp/dsh/prefix; export DSH_BIN accordingly before the suite runners.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-dsh-plugin-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

E2E_ROOT="$(mktemp -d "${TMPDIR:-$PROJECT_DIR/.tmp}/intelli-dsh-e2e-XXXXXXXX")"
echo "📁 Scratch: $E2E_ROOT"

# ── Prerequisites ─────────────────────────────────────────────────

for tool in node npm jq rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool"
    exit 1
  fi
done

DSH_BIN="${DSH_BIN:-$(command -v dsh 2>/dev/null || true)}"
if [[ -z "$DSH_BIN" || -z "$(command -v "$DSH_BIN" 2>/dev/null || true)" ]]; then
  echo "⚠️  SKIP: scenario 18 requires the dsh host."
  echo "   Prerequisite: install the pinned host into worktree scratch with"
  echo "   DSH_HOME=... npm install --prefix .tmp/dsh/prefix @deepseek-ai/dsh@0.2.2-rc.1"
  echo "   then export DSH_BIN=\"\$PWD/.tmp/dsh/prefix/node_modules/.bin/dsh\"."
  exit 77
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "⚠️  SKIP: scenario 18 requires pnpm on PATH (dsh plugin forwards to pnpm)."
  echo "   Prerequisite: npm install --prefix .tmp/dsh/pnpm pnpm"
  echo "   then export PATH=\"\$PWD/.tmp/dsh/pnpm/node_modules/.bin:\$PATH\"."
  exit 77
fi

NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+)\..*$/\1/')"
NODE_MINOR="$(node --version | sed -E 's/^v[0-9]+\.([0-9]+).*$/\1/')"
if [[ "${NODE_MAJOR:-0}" -lt 24 || ( "$NODE_MAJOR" -eq 24 && "${NODE_MINOR:-0}" -lt 9 ) ]]; then
  echo "⚠️  SKIP: scenario 18 requires Node.js >= 24.9.0 (the dsh engine floor); found $(node --version)."
  echo "   Prerequisite: fnm use 24.19.0 (or another Node >= 24.9.0)."
  exit 77
fi

# ── Isolation ─────────────────────────────────────────────────────
# HOME must be isolated for the whole run: dsh plugin forwards to pnpm,
# and pnpm derives its store from HOME/XDG_DATA_HOME, so every plugin
# operation in this scenario must see the same scratch paths or the store
# moves between operations and the removal step fails. The scratch home
# and the profile share one filesystem, which also keeps the pnpm store
# inside scratch instead of at the volume root.

export HOME="$E2E_ROOT/home"
export DSH_HOME="$E2E_ROOT/dsh-home"
export DSH_AGENTS_HOME="$E2E_ROOT/dsh-agents-home"
export XDG_CONFIG_HOME="$E2E_ROOT/xdg-config"
export XDG_DATA_HOME="$E2E_ROOT/xdg-data"
export npm_config_cache="$E2E_ROOT/npm-cache"
mkdir -p "$HOME" "$DSH_HOME" "$DSH_AGENTS_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$npm_config_cache"

# Drop inherited credential-shaped variables by name without reading their
# values. Each headless process must report a final missing-credential error.
while IFS= read -r var; do
  case "${var^^}" in
    *API_KEY*|*TOKEN*|*SECRET*|*PASSWORD*)
      if ! unset "$var" 2>/dev/null; then
        echo '❌ Cannot isolate the host from inherited credentials; run in a clean environment.' >&2
        exit 1
      fi ;;
  esac
done < <(compgen -e)

for isolated_var in HOME DSH_HOME DSH_AGENTS_HOME XDG_CONFIG_HOME XDG_DATA_HOME npm_config_cache; do
  case "${!isolated_var}" in
    "$E2E_ROOT"/*) ;;
    *)
      echo "❌ isolation broken: $isolated_var=${!isolated_var} is not under $E2E_ROOT"
      exit 1
      ;;
  esac
done

cleanup() {
  local rc=$?
  # The invented dummy key and its stored copy never survive the run, even
  # on failure; everything else is retained for debugging on failure only.
  rm -f "$DSH_HOME/.env" "$XDG_CONFIG_HOME/mcp-intelli-search/openrouter.key"
  if [[ "$rc" -eq 0 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); echo "✅ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "❌ $1"; }
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi
}

count_re() { # count_re <pattern> <file>: rg -c that prints 0 when absent
  rg -c "$1" "$2" || echo 0
}
count_fixed() { # count_fixed <string> <file>: rg -c -F that prints 0 when absent
  rg -c -F "$1" "$2" || echo 0
}

PROFILE_NAME="intelli-s18"
WORKSPACE="$E2E_ROOT/workspace/project"
mkdir -p "$WORKSPACE"
INSPECTOR="$PROJECT_DIR/test/e2e/dsh/inspect.mjs"
CREDENTIAL_LAUNCHER="$PROJECT_DIR/test/e2e/dsh/credential-launcher.mjs"
USER_PATCH="$DSH_HOME/profiles/$PROFILE_NAME/cordis.patch.yml"
# An invented value, never a real credential; never printed.
DUMMY_VALUE="intelli-e2e-invented-dummy-key"

# Keep every dsh invocation outside the checkout's launch-directory .env.
cd "$WORKSPACE"
DSH_VERSION="$("$DSH_BIN" --version)"
echo "🔧 dsh $DSH_VERSION, node $(node --version), pnpm $(pnpm --version), npm $(npm --version)"
DSH_RANGE="$(jq -er '.engines.dsh' "$PROJECT_DIR/plugins/dsh/package.json")"
if [[ ! -x "$PROJECT_DIR/node_modules/.bin/semver" ]]; then
  echo '❌ Scenario 18 requires the semver CLI. Install repository dev dependencies with npm ci.' >&2
  exit 1
fi
if ! "$PROJECT_DIR/node_modules/.bin/semver" --include-prerelease -r "$DSH_RANGE" "$DSH_VERSION" >/dev/null; then
  echo "❌ dsh $DSH_VERSION is outside declared range $DSH_RANGE"
  exit 1
fi
ok "dsh $DSH_VERSION satisfies $DSH_RANGE"

# ── Step 1: build, pack and generate the local-tarball bundle ────

echo
echo "── Step 1: build and pack the local-tarball dsh bundle"
if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then
  ok "using prebuilt standalone artifact"
else
  (cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
fi
PACK_ARGS=()
if [[ "${E2E_SKIP_BUILD:-0}" == "1" ]]; then PACK_ARGS=(--ignore-scripts); fi
TARBALL="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$E2E_ROOT" "${PACK_ARGS[@]}" 2>/dev/null | tail -1)"
TARBALL="$E2E_ROOT/$(basename "$TARBALL")"
check "packed $(basename "$TARBALL")" test -f "$TARBALL"

BUNDLES="$E2E_ROOT/bundles"
node "$PROJECT_DIR/scripts/generate-plugin-bundles.mjs" \
  --mode tarball --output "$BUNDLES" \
  --codex-vendor-dir "$BUNDLES/plugins/codex/vendor" >/dev/null
ok "generator tarball mode completed"
DSH_BUNDLE="$BUNDLES/plugins/dsh"
VENDORED_CLI="$DSH_BUNDLE/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js"
npm install --prefix "$DSH_BUNDLE/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
check "dsh bundle vendor install" test -f "$VENDORED_CLI"
check "tracked plugins/dsh carries no vendor tree" test ! -d "$PROJECT_DIR/plugins/dsh/vendor"

# ── Step 2: profile creation and bundle installation ─────────────

echo
echo "── Step 2: install the bundle into an isolated profile"
cd "$WORKSPACE"
"$DSH_BIN" --profile "$PROFILE_NAME" --from-default-profile headless --dump-config \
  > "$E2E_ROOT/dump-create.yml" 2> "$E2E_ROOT/dump-create.err"
ok "profile created from the headless template"

"$DSH_BIN" plugin --profile "$PROFILE_NAME" add "$DSH_BUNDLE" > "$E2E_ROOT/plugin-add.log" 2>&1
ok "dsh plugin add (local tarball bundle)"

DUMP_BUNDLE="$E2E_ROOT/dump-bundle.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_BUNDLE" 2>/dev/null
BRIDGE_ROWS="$(count_re '^- id: mcp-intelli-search$' "$DUMP_BUNDLE")"
SKILL_ROWS="$(count_re '^- id: intelli-search-skill$' "$DUMP_BUNDLE")"
if [[ "$BRIDGE_ROWS" == "1" && "$SKILL_ROWS" == "1" ]]; then
  ok "both bundle rows composed"
else
  bad "bundle rows composed (bridge=$BRIDGE_ROWS skill=$SKILL_ROWS)"
fi
if rg -q "OPENROUTER_API_KEY: !!js process\\.env\\.OPENROUTER_API_KEY \\|\\| ''$" "$DUMP_BUNDLE"; then
  ok "environment expression composed verbatim"
else
  bad "environment expression missing from the composed row"
fi

# ── Step 3: workspace guards of --host dsh ────────────────────────

echo
echo "── Step 3: vendored CLI configuration checks and workspace guards"
cd "$WORKSPACE"
if node "$VENDORED_CLI" --host dsh --check-config > "$E2E_ROOT/check-project.out" 2>&1; then
  if rg -q 'Configuration is valid \(built-in DeepSeek Harness defaults; no per-user file found\)' "$E2E_ROOT/check-project.out"; then
    ok "project directory: built-in dsh defaults accepted"
  else
    bad "project directory: expected the built-in dsh-defaults message"
  fi
else
  bad "project directory: --check-config failed"
fi

cd "$HOME"
if node "$VENDORED_CLI" --host dsh --check-config > "$E2E_ROOT/check-home.out" 2>&1; then
  bad "home directory: --check-config unexpectedly succeeded"
else
  if rg -q 'DeepSeek Harness working directory must be a project directory, not the home or filesystem root' "$E2E_ROOT/check-home.out"; then
    ok "home directory refused with the dsh workspace diagnostic"
  else
    bad "home directory: wrong diagnostic"
  fi
fi

cd /
if node "$VENDORED_CLI" --host dsh --check-config > "$E2E_ROOT/check-root.out" 2>&1; then
  bad "filesystem root: --check-config unexpectedly succeeded"
else
  if rg -q 'DeepSeek Harness working directory must be a project directory, not the home or filesystem root' "$E2E_ROOT/check-root.out"; then
    ok "filesystem root refused with the dsh workspace diagnostic"
  else
    bad "filesystem root: wrong diagnostic"
  fi
fi
cd "$WORKSPACE"

# ── Step 4: inspector mount and no-key tool registration ─────────

echo
echo "── Step 4: four tools and skill registration without credentials"
cat > "$USER_PATCH" <<EOF
# Scenario 18 inspection layer. The inspector is a scenario-owned plugin
# mounted through this user patch layer, never part of the generated bundle.
- insert:
    - id: intelli-inspector
      name: '$INSPECTOR'
EOF
DUMP_INSPECTOR="$E2E_ROOT/dump-inspector.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_INSPECTOR" 2>/dev/null
if rg -q '^- id: intelli-inspector$' "$DUMP_INSPECTOR"; then
  ok "inspector row composed through the profile user layer"
else
  bad "inspector row missing from the composed profile"
fi

run_headless() { # run_headless <label> <inspect-out> <expect-tools yes|no>
  local label="$1" out="$2" expect="$3" rc=0
  DSH_INSPECT_OUT="$out" DSH_INSPECT_EXPECT_TOOLS="$expect" \
    timeout --foreground 150s "$DSH_BIN" --profile "$PROFILE_NAME" --json \
    'Reply without using any tools.' < /dev/null \
    > "$E2E_ROOT/headless-$label.jsonl" 2> "$E2E_ROOT/headless-$label.err" || rc=$?
  if [[ $rc != 1 ]] || ! jq -es 'last | .type == "final" and .reason.kind == "error" and .reason.error.code == "MISSING_CREDENTIAL"' "$E2E_ROOT/headless-$label.jsonl" >/dev/null; then
    echo "❌ $label: expected final MISSING_CREDENTIAL and exit 1, observed exit $rc"
    exit 1
  fi
  ok "$label: model turn stopped with MISSING_CREDENTIAL"
  test -s "$out"
}

INSPECT_NOKEY="$E2E_ROOT/inspect-nokey.json"
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
  ok "bundled skill registered and loadable without frontmatter"
else
  bad "bundled skill not correctly registered: $(jq -c '.skill, .skillLoaded' "$INSPECT_NOKEY")"
fi
for tool in intelli_search intelli_extract intelli_collate intelli_research; do
  if jq -e --arg t "mcp__intelli__$tool" '.intelliTools | index($t) != null' "$INSPECT_NOKEY" >/dev/null; then
    ok "tool registered: mcp__intelli__$tool"
  else
    bad "tool missing: mcp__intelli__$tool"
  fi
done
SKILL_DIR="$(realpath "$DSH_HOME/profiles/$PROFILE_NAME/node_modules/@curio-data/dsh-intelli-search/skills/intelli-search")"
# shellcheck disable=SC2016 # $dir is a jq variable.
check "catalogued and loaded skill resolve inside the installed bundle" jq -e --arg dir "$SKILL_DIR" \
  'all(.skill, .skillLoaded; .path == ($dir + "/SKILL.md") and .resourceBase == {kind:"directory", path:$dir})' "$INSPECT_NOKEY"
if [[ "$(jq -r '.skill.source' "$INSPECT_NOKEY")" == "bundled" ]]; then
  ok "skill catalogue entry carries source bundled"
else
  bad "skill catalogue source"
fi

# ── Step 5: dummy credential delivery through the environment layer ──

echo
echo "── Step 5: dummy credential delivery (invented value, no provider call)"
printf 'OPENROUTER_API_KEY=%s\n' "$DUMMY_VALUE" > "$DSH_HOME/.env"
chmod 600 "$DSH_HOME/.env"
DUMMY_MARKER="$E2E_ROOT/dummy-marker.json"
cat > "$USER_PATCH" <<EOF
# Scenario 18 inspection layer plus the credential-delivery override.
# An id-targeted user patch replaces the whole config, so the bridge row is
# restated in full with the wrapper as its command.
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
      - '$CREDENTIAL_LAUNCHER'
      - '$DUMMY_MARKER'
      - '$VENDORED_CLI'
      - '--host'
      - 'dsh'
    env:
      OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''
    toolCallTimeoutMs: 600000
    failOnStartupError: false
EOF
DUMP_CRED="$E2E_ROOT/dump-credential.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_CRED" 2>/dev/null
CRED_BRIDGE_ROWS="$(count_re '^- id: mcp-intelli-search$' "$DUMP_CRED")"
CRED_SERVER_ROWS="$(count_re 'serverName: intelli$' "$DUMP_CRED")"
if [[ "$CRED_BRIDGE_ROWS" == "1" && "$CRED_SERVER_ROWS" == "1" ]]; then
  ok "exactly one composed bridge row after the override"
else
  bad "bridge row replacement semantics (rows=$CRED_BRIDGE_ROWS serverNames=$CRED_SERVER_ROWS)"
fi
if rg -qF "$CREDENTIAL_LAUNCHER" "$DUMP_CRED"; then
  ok "effective bridge command is the credential wrapper"
else
  bad "composed bridge command was not replaced"
fi

INSPECT_CRED="$E2E_ROOT/inspect-credential.json"
rm -f "$DUMMY_MARKER"
if run_headless credential "$INSPECT_CRED" yes; then
  ok "headless credential-delivery run reached the inspection probe"
else
  bad "headless credential-delivery run produced no inspection result"
fi
if [[ -f "$DUMMY_MARKER" && "$(jq -r '.arrived' "$DUMMY_MARKER")" == "true" ]]; then
  ok "dummy credential reached the MCP child through the environment layer"
else
  bad "dummy credential delivery"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_CRED")" == "true" && "$(jq -r '.skillOk' "$INSPECT_CRED")" == "true" ]]; then
  ok "tools and skill still registered with the wrapper in the launch chain"
else
  bad "registration lost with the wrapper launcher"
fi
if rg -qF "intelli-e2e-invented-dummy-key" "$LOG_FILE" 2>/dev/null; then
  bad "dummy value leaked into the scenario log"
else
  ok "dummy value never printed"
fi

# ── Step 6: stored dummy credential file and empty environment ────

echo
echo "── Step 6: credential-file fallback accepted by --check-config"
rm -f "$DSH_HOME/.env"
printf '%s\n' "$DUMMY_VALUE" | node "$VENDORED_CLI" setup > "$E2E_ROOT/setup.out" 2>&1
CREDENTIAL_FILE="$XDG_CONFIG_HOME/mcp-intelli-search/openrouter.key"
if [[ -f "$CREDENTIAL_FILE" ]]; then
  ok "setup stored the credential file beside the per-user configuration"
  PERMS="$(stat -c '%a' "$CREDENTIAL_FILE")"
  if [[ "$PERMS" == "600" ]]; then
    ok "stored credential file is user-only (600)"
  else
    bad "stored credential file permissions: $PERMS"
  fi
else
  bad "setup produced no credential file"
fi
cd "$WORKSPACE"
if OPENROUTER_API_KEY='' node "$VENDORED_CLI" --host dsh --check-config > "$E2E_ROOT/check-file.out" 2>&1; then
  if rg -q 'Configuration is valid' "$E2E_ROOT/check-file.out"; then
    ok "empty environment value accepted with the credential file selected"
  else
    bad "unexpected --check-config message with the credential file"
  fi
else
  bad "--check-config rejected the credential-file configuration"
fi

# ── Step 7: removal, absence and reinstallation ───────────────────

echo
echo "── Step 7: removal and reinstallation"
cat > "$USER_PATCH" <<EOF
# Scenario 18 inspection layer.
- insert:
    - id: intelli-inspector
      name: '$INSPECTOR'
EOF
DUMP_RESTORED="$E2E_ROOT/dump-restored.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_RESTORED" 2>/dev/null
RESTORED_BRIDGE="$(count_re '^- id: mcp-intelli-search$' "$DUMP_RESTORED")"
RESTORED_WRAPPER="$(count_fixed "$CREDENTIAL_LAUNCHER" "$DUMP_RESTORED")"
RESTORED_INSPECTOR="$(count_re '^- id: intelli-inspector$' "$DUMP_RESTORED")"
if [[ "$RESTORED_BRIDGE" == "1" && "$RESTORED_WRAPPER" == "0" && "$RESTORED_INSPECTOR" == "1" ]]; then
  ok "credential override removed; bundle bridge row and inspector remain"
else
  bad "user layer after override removal (bridge=$RESTORED_BRIDGE wrapper=$RESTORED_WRAPPER inspector=$RESTORED_INSPECTOR)"
fi

"$DSH_BIN" plugin --profile "$PROFILE_NAME" remove @curio-data/dsh-intelli-search \
  > "$E2E_ROOT/plugin-remove.log" 2>&1
ok "dsh plugin remove @curio-data/dsh-intelli-search"

DUMP_REMOVED="$E2E_ROOT/dump-removed.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_REMOVED" 2>/dev/null
REMOVED_BRIDGE="$(count_re '^- id: mcp-intelli-search$|^    - id: mcp-intelli-search$' "$DUMP_REMOVED")"
REMOVED_SKILL="$(count_re 'intelli-search-skill' "$DUMP_REMOVED")"
REMOVED_INSPECTOR="$(count_re '^- id: intelli-inspector$' "$DUMP_REMOVED")"
if [[ "$REMOVED_BRIDGE" -eq 0 && "$REMOVED_SKILL" -eq 0 && "$REMOVED_INSPECTOR" == "1" ]]; then
  ok "bundle rows gone after removal; inspector row remains"
else
  bad "composed rows after removal (bridge=$REMOVED_BRIDGE skill=$REMOVED_SKILL inspector=$REMOVED_INSPECTOR)"
fi
if jq -e --arg p "$DSH_BUNDLE" '.dependencies // {} | has("@curio-data/dsh-intelli-search") | not' \
  "$DSH_HOME/profiles/$PROFILE_NAME/package.json" >/dev/null; then
  ok "profile manifest no longer selects the bundle"
else
  bad "profile manifest still selects the bundle"
fi

INSPECT_ABSENT="$E2E_ROOT/inspect-absent.json"
if run_headless absent "$INSPECT_ABSENT" no; then
  ok "fresh host process after removal reached the inspection probe"
else
  bad "fresh host process produced no inspection result"
fi
if [[ "$(jq -r '.toolsOk' "$INSPECT_ABSENT")" == "true" && "$(jq -r '.skillOk' "$INSPECT_ABSENT")" == "true" ]]; then
  ok "bundle tools and skill absent after removal while the inspector stays mounted"
else
  bad "removal did not remove the bundle's tools and skill: $(jq -c '{intelliTools, skill}' "$INSPECT_ABSENT")"
fi

"$DSH_BIN" plugin --profile "$PROFILE_NAME" add "$DSH_BUNDLE" > "$E2E_ROOT/plugin-readd.log" 2>&1
ok "dsh plugin add (reinstall)"
DUMP_READDED="$E2E_ROOT/dump-readded.yml"
"$DSH_BIN" --profile "$PROFILE_NAME" --dump-config > "$DUMP_READDED" 2>/dev/null
READDED_BRIDGE="$(count_re '^- id: mcp-intelli-search$' "$DUMP_READDED")"
READDED_SKILL="$(count_re '^- id: intelli-search-skill$' "$DUMP_READDED")"
if [[ "$READDED_BRIDGE" == "1" && "$READDED_SKILL" == "1" ]]; then
  ok "both bundle rows composed again after reinstallation"
else
  bad "reinstallation rows (bridge=$READDED_BRIDGE skill=$READDED_SKILL)"
fi

INSPECT_BACK="$E2E_ROOT/inspect-back.json"
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

# ── Summary ───────────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed, $SKIP skipped"
echo "  dsh $DSH_VERSION / node $(node --version) / pnpm $(pnpm --version)"
echo "═══════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
