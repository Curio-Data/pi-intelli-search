#!/usr/bin/env bash
#
# test/run-e2e-publish-local.sh — install-fresh smoke test from the local tarball
#
# Packs the working tree into a tarball (npm pack), installs it into a clean
# temp directory (so peer dependencies resolve to their current latest, not the
# dev-pinned versions), and runs a structural smoke import under plain node.
#
# This is the gate that catches peer-dependency drift that tsc/ty/LSP/unit
# tests cannot see: those resolve the pinned dev dependency, but a fresh
# `npm install` resolves the latest. If an upstream peer dep removes a runtime
# export between the dev pin and current latest, only this test catches it.
#
# No API keys required. No network beyond npm resolution.
#
# Usage: ./test/run-e2e-publish-local.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Avoid /tmp which may be mounted noexec for native .node modules.
E2E_TMPDIR="${TMPDIR:-$HOME}"
TEST_DIR="$(mktemp -d -p "$E2E_TMPDIR" pi-e2e-publish-local-XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT

echo "📁 Test directory: $TEST_DIR"

# ── Build and pack ─────────────────────────────────────────────────
cd "$PROJECT_DIR"
echo "🔨 Building..."
npm run build >/dev/null

echo "📦 Packing local tarball..."
TARBALL="$(npm pack --pack-destination "$TEST_DIR" 2>/dev/null | tail -1)"
# npm pack prints the bare filename when --pack-destination is set; resolve it.
TARBALL_PATH="$TEST_DIR/$(basename "$TARBALL")"
if [ ! -f "$TARBALL_PATH" ]; then
  # Some npm versions print the full path; honour that.
  TARBALL_PATH="$TARBALL"
fi
[ -f "$TARBALL_PATH" ] || { echo "❌ tarball not found at $TARBALL_PATH"; exit 1; }
echo "   $(basename "$TARBALL_PATH")"

# ── Install into a clean dir (peer deps resolve to latest) ─────────
cd "$TEST_DIR"
echo '{"type":"module","private":true}' > package.json
echo "📥 Installing local tarball into clean dir (resolves peer deps to latest)..."
npm install "$TARBALL_PATH" 2>&1 | tail -3

PKG_ROOT="$TEST_DIR/node_modules/@curio-data/pi-intelli-search"
INSTALLED_INDEX="$PKG_ROOT/dist/index.js"
[ -f "$INSTALLED_INDEX" ] || { echo "❌ dist/index.js not found in installed package"; exit 1; }

INSTALLED_VERSION=$(jq -r '.version' "$PKG_ROOT/package.json")
RESOLVED_PI_AI=$(jq -r '.version' "$TEST_DIR/node_modules/@earendil-works/pi-ai/package.json")
echo "📋 Installed: @curio-data/pi-intelli-search@$INSTALLED_VERSION (resolved pi-ai@$RESOLVED_PI_AI)"

# ── Smoke import under plain node ──────────────────────────────────
echo ""
echo "── Smoke import (plain node, no pi host aliasing) ────────────────"
SMOKE_FILE="$TEST_DIR/_smoke.mjs"
cat > "$SMOKE_FILE" <<SMOKE_EOF
import mod from '$INSTALLED_INDEX';

const factory = typeof mod === 'function' ? mod : mod.default;
const recordedTools = [];
const recordedEvents = [];
const mockPi = {
  registerTool(tool) { recordedTools.push(tool); },
  on(event) { recordedEvents.push(event); },
};
factory(mockPi);

const expectedTools = ['intelli_search', 'intelli_extract', 'intelli_collate', 'intelli_research'];
const errors = [];
if (typeof factory !== 'function') errors.push('factory is not a function');
for (const name of expectedTools) {
  if (!recordedTools.some((t) => t.name === name)) errors.push('tool not registered: ' + name);
}
if (!recordedEvents.includes('session_start')) errors.push('session_start not subscribed');

if (errors.length > 0) {
  for (const e of errors) console.log('❌ ' + e);
  process.exit(1);
}
console.log('✅ Default export is a function');
console.log('✅ All 4 tools registered: ' + expectedTools.join(', '));
console.log('✅ session_start subscribed');
console.log('✅ Module loads under plain node with peer-dep drift (pi-ai@$RESOLVED_PI_AI)');
SMOKE_EOF

if ! node "$SMOKE_FILE"; then
  echo ""
  echo "❌ Local publish smoke test failed"
  exit 1
fi

echo ""
echo "✅ Local publish smoke test passed — package is loadable with peer deps resolved to latest"
