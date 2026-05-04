#!/usr/bin/env bash
#
# test/run-e2e-publish.sh — E2E test: install from npm and validate the published package
#
# Installs @curio-data/pi-intelli-search from npm into a temp directory,
# then runs structural validation (smoke test) against the installed
# dist/index.js to verify the published package works correctly.
#
# This test does NOT require API keys — it validates structure, not LLM calls.
#
# Usage:
#   ./test/run-e2e-publish.sh              # latest published version
#   ./test/run-e2e-publish.sh 0.3.1        # specific version
#
# Environment:
#   NPM_TOKEN   Optional. npm auth token for private packages (not needed for public).
#

set -euo pipefail

VERSION="${1:-latest}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  E2E Publish Test — npm install + smoke validation  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── Create isolated temp directory ─────────────────────────────────
# Avoid /tmp which may be mounted noexec — native .node modules need exec.
# Use TMPDIR if set, otherwise fall back to $HOME.
E2E_TMPDIR="${TMPDIR:-$HOME}"
TEST_DIR="$(mktemp -d -p "$E2E_TMPDIR" pi-e2e-publish-XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT

echo "📁 Test directory: $TEST_DIR"

# ── Create a minimal package.json for the test ─────────────────────
cat > "$TEST_DIR/package.json" <<'EOF'
{
  "type": "module",
  "private": true
}
EOF

# ── Install the published package ──────────────────────────────────
PKG_SPEC="@curio-data/pi-intelli-search"
if [ "$VERSION" != "latest" ]; then
  PKG_SPEC="@curio-data/pi-intelli-search@${VERSION}"
fi

echo ""
echo "📦 Installing $PKG_SPEC ..."
echo ""

cd "$TEST_DIR"
npm install "$PKG_SPEC" 2>&1

# ── Locate the installed extension entry point ─────────────────────
INSTALLED_INDEX="$TEST_DIR/node_modules/@curio-data/pi-intelli-search/dist/index.js"
INSTALLED_PROVIDERS="$TEST_DIR/node_modules/@curio-data/pi-intelli-search/dist/providers.js"

if [ ! -f "$INSTALLED_INDEX" ]; then
  echo "❌ dist/index.js not found in installed package"
  echo "   Looking at: $INSTALLED_INDEX"
  ls -la "$TEST_DIR/node_modules/@curio-data/pi-intelli-search/" 2>/dev/null || true
  exit 1
fi

echo "✅ Package installed: $INSTALLED_INDEX"
echo ""

# ── Get installed version from package.json ─────────────────────────
INSTALLED_VERSION=$(jq -r '.version' "$TEST_DIR/node_modules/@curio-data/pi-intelli-search/package.json" 2>/dev/null || echo "unknown")
echo "📋 Installed version: $INSTALLED_VERSION"

# ── Verify expected files are present ──────────────────────────────
echo ""
echo "── File verification ──────────────────────────────────────────────"

ERRORS=0

EXPECTED_FILES=(
  "dist/index.js"
  "dist/providers.js"
  "dist/cache.js"
  "dist/fetch.js"
  "dist/llm.js"
  "dist/prompts.js"
  "dist/settings.js"
  "dist/types.js"
  "dist/util.js"
  "dist/tools/intelli-research.js"
  "dist/tools/intelli-search.js"
  "dist/tools/intelli-extract.js"
  "dist/tools/intelli-collate.js"
  "src/index.ts"
  "skills/intelli-search/SKILL.md"
  "LICENSE"
  "NOTICE"
  "README.md"
)

PKG_ROOT="$TEST_DIR/node_modules/@curio-data/pi-intelli-search"

for file in "${EXPECTED_FILES[@]}"; do
  if [ -f "$PKG_ROOT/$file" ]; then
    echo "  ✓ $file"
  else
    echo "  ❌ $file — MISSING"
    ERRORS=$((ERRORS + 1))
  fi
done

# ── Verify no extraneous files ─────────────────────────────────────
echo ""
echo "── Package cleanliness ────────────────────────────────────────────"

if [ -d "$PKG_ROOT/test" ]; then
  echo "  ⚠️  test/ directory included in package (should be excluded)"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✓ test/ not included"
fi

if [ -d "$PKG_ROOT/.github" ]; then
  echo "  ⚠️  .github/ directory included in package (should be excluded)"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✓ .github/ not included"
fi

if [ -f "$PKG_ROOT/.env" ]; then
  echo "  ⚠️  .env included in package (should be excluded)"
  ERRORS=$((ERRORS + 1))
else
  echo "  ✓ .env not included"
fi

# ── Run smoke test against installed package ───────────────────────
echo ""
echo "── Smoke test (against installed dist/index.js) ──────────────────"

# Write a temporary smoke test file — inline --input-type=module can't resolve
# native .node modules (wreq-js) because it has no real __dirname for require().
SMOKE_FILE="$TEST_DIR/_smoke.mjs"
cat > "$SMOKE_FILE" <<SMOKE_EOF
import mod from '$INSTALLED_INDEX';

// When importing via file path, mod IS the default export (the factory function).
// When importing via package specifier, it wraps as { default: fn }.
const factory = typeof mod === 'function' ? mod : mod.default;

const errors = [];

// 1. Factory is a function
if (typeof factory !== 'function') {
  errors.push('factory is not a function (got: ' + typeof factory + ')');
}

// 2. Call factory with mock API
const recordedTools = [];
const recordedEvents = [];
const mockPi = {
  registerTool(tool) { recordedTools.push(tool); },
  on(event, handler) { recordedEvents.push(event); },
};
factory(mockPi);

// 3. All 4 tools registered
const expectedTools = ['intelli_search', 'intelli_extract', 'intelli_collate', 'intelli_research'];
for (const name of expectedTools) {
  if (!recordedTools.some(t => t.name === name)) {
    errors.push('tool not registered: ' + name);
  }
}

// 4. Each tool has required shape
for (const tool of recordedTools) {
  if (!tool.name) errors.push(tool.name + ': missing name');
  if (!tool.label) errors.push(tool.name + ': missing label');
  if (!tool.description) errors.push(tool.name + ': missing description');
  if (!tool.parameters) errors.push(tool.name + ': missing parameters');
  if (typeof tool.execute !== 'function') errors.push(tool.name + ': missing execute');
  if (typeof tool.promptSnippet !== 'string') errors.push(tool.name + ': missing promptSnippet');
}

// 5. Event subscriptions
if (!recordedEvents.includes('session_start')) {
  errors.push('session_start event not subscribed');
}

// 6. Providers module loads and is idempotent
const providers = await import('$INSTALLED_PROVIDERS');
if (typeof providers.ensureCustomModels !== 'function') {
  errors.push('ensureCustomModels not exported');
} else {
  const added = await providers.ensureCustomModels();
  if (!Array.isArray(added)) {
    errors.push('ensureCustomModels did not return an array');
  }
}

// Output results
if (errors.length > 0) {
  for (const e of errors) console.log('❌ ' + e);
  process.exit(1);
} else {
  console.log('✅ Default export is a function');
  console.log('✅ All 4 tools registered: ' + expectedTools.join(', '));
  console.log('✅ All tools have required shape');
  console.log('✅ Event subscriptions present');
  console.log('✅ Providers module loads correctly');
  console.log('✅ ensureCustomModels() is idempotent');
}
SMOKE_EOF

SMOKE_OUTPUT=$(node "$SMOKE_FILE" 2>&1) || {
  echo "$SMOKE_OUTPUT"
  echo ""
  echo "❌ Smoke test failed"
  exit 1
}

echo "$SMOKE_OUTPUT"

# ── Verify peer dependencies are NOT bundled ───────────────────────
echo ""
echo "── Peer dependency check ──────────────────────────────────────────"

PEER_DIRS=(
  "@mariozechner/pi-ai"
  "@mariozechner/pi-coding-agent"
  "typebox"
)

for peer in "${PEER_DIRS[@]}"; do
  if [ -d "$PKG_ROOT/node_modules/$peer" ]; then
    echo "  ⚠️  $peer is bundled (should be peer dependency only)"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ $peer not bundled (correct — peer dependency)"
  fi
done

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo "── Summary ────────────────────────────────────────────────────────"
echo "  Package:  @curio-data/pi-intelli-search@$INSTALLED_VERSION"
echo "  Files:    $(find "$PKG_ROOT" -type f | wc -l) total"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ E2E publish test failed ($ERRORS error(s))"
  exit 1
fi

echo ""
echo "✅ E2E publish test passed — published package is valid"
