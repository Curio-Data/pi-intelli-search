#!/usr/bin/env bash
#
# test/e2e/12_plugin_bundles.sh — Phase 5 host plugin verification.
#
# Evidence class: PRE-PUBLICATION. The committed plugin launchers pin an
# exact @curio-data/mcp-intelli-search registry version that is not yet
# published, so this scenario generates equivalent LOCAL-TARBALL launchers
# (scripts/generate-plugin-bundles.mjs --mode tarball) and installs the
# packed artifact into each plugin's vendor directory. Post-publication
# registry-pin verification is a separate release gate (Phase 6).
#
# What it proves:
#   1. The generator's tarball mode produces a self-contained tree with no
#      sibling checkout references.
#   2. The packed standalone artifact vendors into a plugin directory and
#      its CLI runs (--help, --version, --check-config) from that location.
#   3. Claude Code: strict validation of plugin and marketplace, marketplace
#      add from a local path, plugin install, a real server connection
#      through `claude mcp list` (proves launch, framing and the
#      ${CLAUDE_PLUGIN_DATA}/${CLAUDE_PROJECT_DIR} substitutions), and skill
#      discovery through `claude plugin details`.
#   4. Codex: marketplace add, catalog-path assertion, plugin install,
#      installed-cache layout, and skill discovery through
#      `codex debug prompt-input`.
#
# Requirements:
#   - claude and codex CLIs on PATH (absence skips the scenario with a
#     notice; host versions are pinned in docs/plans/mcp-intelli-search/PHASE-5.md).
#   - No credentials and no model requests: servers start without an API key
#     and no research operation is executed.
#
# Credentialed evidence is deliberately NOT part of this repeatable script.
# The qualified tool names on both hosts and the Codex session handshake were
# verified once with real host sessions on 2026-10-04 and are recorded in
# PHASE-5.md. Copying OAuth credential files into isolated homes breaks
# refresh-token rotation (the copy that refreshes becomes the only valid
# chain), so repeatable gates must stay credential-free.
#
# Isolation: CLAUDE_CONFIG_DIR and CODEX_HOME point at scratch directories;
# real host configurations are never touched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-plugin-bundles-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

E2E_ROOT="$(mktemp -d "${TMPDIR:-$PROJECT_DIR/.tmp}/intelli-plugin-e2e-XXXXXXXX")"
echo "📁 Scratch: $E2E_ROOT"

for tool in node npm jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "❌ required tool not on PATH: $tool"
    exit 1
  fi
done
if ! command -v claude >/dev/null 2>&1 || ! command -v codex >/dev/null 2>&1; then
  echo "⚠️  SKIP: scenario 12 requires both the claude and codex CLIs; one is absent."
  echo "   This is an environment limitation, not a failure of the artifacts."
  exit 0
fi

CLAUDE_HOME_DIR="$E2E_ROOT/claude-home"
CODEX_HOME_DIR="$E2E_ROOT/codex-home"
mkdir -p "$CLAUDE_HOME_DIR" "$CODEX_HOME_DIR"

cleanup() {
  local rc=$?
  # On success remove the whole scratch tree; on failure keep it for
  # debugging.
  if [[ "$rc" -eq 0 ]]; then rm -rf "$E2E_ROOT"; fi
  exit "$rc"
}
trap cleanup EXIT

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); echo "✅ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "❌ $1"; }
skip() { SKIP=$((SKIP + 1)); echo "⚠️  SKIP: $1"; }
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$label"; else bad "$label"; fi
}

# ── Step 1: build and pack the standalone artifact ────────────────

echo
echo "── Step 1: build and pack @curio-data/mcp-intelli-search"
(cd "$PROJECT_DIR" && npm run build:mcp >/dev/null 2>&1)
TARBALL_DIR="$E2E_ROOT/pack"
mkdir -p "$TARBALL_DIR"
TARBALL="$(cd "$PROJECT_DIR" && npm pack --workspace @curio-data/mcp-intelli-search --pack-destination "$TARBALL_DIR" 2>/dev/null | tail -1)"
TARBALL="$TARBALL_DIR/$(basename "$TARBALL")"
if [[ -f "$TARBALL" ]]; then ok "packed $(basename "$TARBALL")"; else bad "npm pack produced no tarball"; exit 1; fi

# ── Step 2: generate tarball-mode bundles and vendor the artifact ─

echo
echo "── Step 2: generate local-tarball bundles and vendor the artifact"
WORK="$E2E_ROOT/bundles"
node "$PROJECT_DIR/scripts/generate-plugin-bundles.mjs" \
  --mode tarball --output "$WORK" \
  --codex-vendor-dir "$WORK/plugins/codex/vendor" >/dev/null
ok "generator tarball mode completed"

if rg -q '\.\./\.\./src' "$WORK"; then bad "generated tree references sibling checkout source"; else ok "no sibling checkout references in generated tree"; fi

npm install --prefix "$WORK/plugins/claude-code/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
npm install --prefix "$WORK/plugins/codex/vendor" --omit=dev --ignore-scripts "$TARBALL" >/dev/null 2>&1
VENDORED_CLI="vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js"
check "claude plugin vendor install" test -f "$WORK/plugins/claude-code/$VENDORED_CLI"
check "codex plugin vendor install" test -f "$WORK/plugins/codex/$VENDORED_CLI"

# ── Step 3: vendored CLI runs from inside the plugin ──────────────

echo
echo "── Step 3: vendored CLI smoke"
node "$WORK/plugins/claude-code/$VENDORED_CLI" --help >/dev/null
ok "vendored --help"
node "$WORK/plugins/claude-code/$VENDORED_CLI" --version >/dev/null
ok "vendored --version"

CONFIG_JSON="$E2E_ROOT/config.json"
cat > "$CONFIG_JSON" <<'EOF'
{
  "providers": {
    "openrouter": {
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  },
  "models": {
    "search": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extract": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collate": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  }
}
EOF
mkdir -p "$E2E_ROOT/workspace"
if node "$WORK/plugins/claude-code/$VENDORED_CLI" --config "$CONFIG_JSON" --workspace "$E2E_ROOT/workspace" --check-config >/dev/null 2>&1; then
  ok "vendored --check-config"
else
  bad "vendored --check-config"
fi

# ── Step 4: Claude Code validation and installation ───────────────

echo
echo "── Step 4: Claude Code (claude $(claude --version 2>/dev/null | awk '{print $1}'))"
check "claude plugin validate --strict" claude plugin validate "$WORK/plugins/claude-code" --strict
check "claude marketplace validate --strict" claude plugin validate "$WORK" --strict

export CLAUDE_CONFIG_DIR="$CLAUDE_HOME_DIR"
claude plugin marketplace add "$WORK" >/dev/null 2>&1
ok "marketplace add (local path)"
if claude plugin install intelli-search@curio-data-plugins >/dev/null 2>&1; then
  ok "plugin install intelli-search@curio-data-plugins"
else
  bad "plugin install"
fi

# The launcher resolves INTELLI_SEARCH_CONFIG to the plugin data directory.
PLUGIN_DATA="$CLAUDE_HOME_DIR/plugins/data/intelli-search-curio-data-plugins"
mkdir -p "$PLUGIN_DATA" "$E2E_ROOT/claude-workspace"
cp "$CONFIG_JSON" "$PLUGIN_DATA/config.json"

MCP_LIST="$(cd "$E2E_ROOT/claude-workspace" && claude mcp list 2>&1)"
if echo "$MCP_LIST" | rg -q "plugin:intelli-search:intelli_search.*Connected"; then
  ok "claude mcp list: plugin:intelli-search:intelli_search connected"
else
  bad "claude mcp list connection"
  echo "$MCP_LIST" | rg -i "intelli" || true
fi
if echo "$MCP_LIST" | rg -q "vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js"; then
  ok "launcher runs the vendored artifact"
else
  bad "launcher path is not the vendored artifact"
fi

# The plugin must surface its skill, not only its MCP server.
DETAILS_OUT="$(claude plugin details intelli-search 2>&1 || true)"
if echo "$DETAILS_OUT" | rg -q "Skills \(1\).*intelli-search"; then
  ok "claude discovers the plugin skill (component inventory)"
else
  bad "claude plugin skill discovery"
  echo "$DETAILS_OUT" | tail -8
fi

# Qualified tool names on this host were observed once with a credentialed
# session on 2026-10-04: mcp__plugin_intelli-search_intelli_search__<tool>.
# See PHASE-5.md; repeatable checks stay credential-free on purpose.

# ── Step 5: Codex installation and session handshake ──────────────

echo
echo "── Step 5: Codex (codex-cli $(codex --version 2>/dev/null | awk '{print $2}'))"
export CODEX_HOME="$CODEX_HOME_DIR"
codex plugin marketplace add "$WORK" >/dev/null 2>&1
ok "marketplace add (local path)"
# Codex must consume the .agents/plugins/ catalog (its entry carries the
# mandatory policy block); `codex plugin list` names the file it read.
if codex plugin list 2>&1 | rg -q '\.agents/plugins/marketplace\.json'; then
  ok "codex consumed .agents/plugins/marketplace.json"
else
  bad "codex marketplace consumption path not visible"
fi
ADD_OUT="$(codex plugin add intelli-search --marketplace curio-data-plugins --json 2>"$E2E_ROOT/codex-add.err")"
# Codex may print warnings ahead of the JSON body; parse from the first
# brace line onward so a warning prefix cannot red the gate.
if printf '%s\n' "$ADD_OUT" | awk '/^\{/,0' | jq -e '.pluginId == "intelli-search@curio-data-plugins"' >/dev/null 2>&1; then
  ok "plugin add intelli-search@curio-data-plugins"
else
  bad "plugin add"
  echo "$ADD_OUT"
  cat "$E2E_ROOT/codex-add.err"
fi
MCP_VERSION="$(jq -r .version "$PROJECT_DIR/packages/mcp/package.json")"
check "installed cache populated" test -f "$CODEX_HOME/plugins/cache/curio-data-plugins/intelli-search/$MCP_VERSION/.codex-plugin/plugin.json"

# The plugin skill must be listed in the model-visible prompt input as
# intelli-search:intelli-search (no credentials or model request needed).
if codex debug prompt-input "test" 2>/dev/null | rg -q 'intelli-search:intelli-search: Research the web'; then
  ok "codex discovers the plugin skill (prompt input listing)"
else
  bad "codex plugin skill discovery"
fi

# The credentialed Codex session handshake and qualified tool names
# (mcp__intelli_search__<tool>, normalized from the server key) were verified
# once on 2026-10-04; see PHASE-5.md. A repeatable session check would require
# copying the host's OAuth credentials, which breaks refresh-token rotation.

# ── Summary ───────────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════════"
echo "  $PASS passed, $FAIL failed, $SKIP skipped"
echo "═══════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]]
