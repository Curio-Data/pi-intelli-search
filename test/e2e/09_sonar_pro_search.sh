#!/usr/bin/env bash
#
# test/e2e/09_sonar_pro_search.sh — E2E test for perplexity/sonar-pro-search
# as the search model (the post-Sonar-sunset drop-in option)
#
# Proves the full path: the extension's models.json merge registers
# perplexity/sonar-pro-search on first session_start in a VANILLA isolated
# agent dir, pre-flight validation resolves it, the live call succeeds, and
# the response yields links the pipeline can fetch. This is the
# configuration users adopt with a settings.json change only (no code
# change) after Perplexity sunsets Sonar Chat Completions on 2026-09-27.
#
# Usage:
#   ./test/e2e/09_sonar_pro_search.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai
#
# The .env file (gitignored) can hold OPENROUTER_API_KEY for convenience.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-sonar-pro-search-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Load .env if it exists (gitignored)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# ── Check prerequisites ────────────────────────────────────────────
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  if [ -f "$HOME/.pi/agent/auth.json" ]; then
    OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
    if [ -n "$OPENROUTER_API_KEY" ]; then
      echo "🔑 Detected OPENROUTER_API_KEY from ~/.pi/agent/auth.json"
    fi
  fi
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set."
  echo ""
  echo "  Get a key from https://openrouter.ai and either:"
  echo "  - export OPENROUTER_API_KEY=sk-or-v1-..."
  echo "  - Add it to .env (see .env.example)"
  echo "  - Ensure ~/.pi/agent/auth.json has an openrouter key"
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

# ── Create isolated agent directory ────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-sps-XXXXXX)"
E2E_CWD="$(mktemp -d -t pi-e2e-sps-cwd-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR" "$E2E_CWD"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"

mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# ── auth.json — OpenRouter key only ────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

# ── settings.json — search model swapped to sonar-pro-search ──────
# Everything else stays on defaults. This is exactly the settings.json
# change a user makes to adopt the post-sunset search model.
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultModel": "openrouter/minimax/minimax-m2.7",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "cacheDir": ".e2e-sps-cache",
    "defaultUrls": 2,
    "maxUrls": 2
  }
}
EOF

# ── models.json — vanilla/empty ────────────────────────────────────
# The extension MUST merge sonar-pro-search in on session_start; if the
# registration is broken, pre-flight validation fails with "Model not
# found" and this test fails loudly.
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "📄 Wrote vanilla models.json (extension must register sonar-pro-search)"
echo "⚙️  Search: openrouter/perplexity/sonar-pro-search (overridden)"
echo "⚙️  Cache dir: .e2e-sps-cache (overridden)"
echo ""

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (isolated env)                  ║"
echo "║  Search: perplexity/sonar-pro-search (agentic, slower)   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT='Use intelli_research with maxUrls=2 and domains=["sqlite.org"] to research: when SQLite WAL mode should be avoided. Return the official documentation source.'

OUTPUT="$(
  cd "$E2E_CWD"
  PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" \
    timeout --foreground "${E2E_TIMEOUT_SECONDS:-360}s" pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "$PROMPT" \
      2>&1
)" || {
  echo ""
  echo "❌ pi exited with an error"
  echo ""
  echo "--- pi output ---"
  echo "$OUTPUT"
  echo "-----------------"
  exit 1
}

# ── Verify output ──────────────────────────────────────────────────
echo "$OUTPUT"

echo ""
echo "── Verification ──────────────────────────────────────────────────────"

ERRORS=0

# ── The models.json merge actually registered the model ───────────
if jq -e '.providers.openrouter.models[]? | select(.id == "perplexity/sonar-pro-search")' \
  "$ISOLATED_AGENT_DIR/models.json" >/dev/null 2>&1; then
  echo "✅ perplexity/sonar-pro-search merged into isolated models.json"
else
  echo "❌ perplexity/sonar-pro-search missing from isolated models.json"
  ERRORS=$((ERRORS + 1))
fi

# ── Verify custom cache directory ─────────────────────────────────
CACHE_DIR="$E2E_CWD/.e2e-sps-cache"

if [ -d "$CACHE_DIR" ]; then
  echo "✅ .e2e-sps-cache/ cache directory exists"
else
  echo "❌ .e2e-sps-cache/ not found at $CACHE_DIR"
  ERRORS=$((ERRORS + 1))
fi

LATEST_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' | sort -r | head -1)
META_FILE="$LATEST_CACHE/meta.json"

if [ -n "$LATEST_CACHE" ] && [ -f "$META_FILE" ]; then
  echo "✅ Cache entry + meta.json: $(basename "$LATEST_CACHE")"
else
  echo "❌ No cache entry with meta.json under $CACHE_DIR/"
  ERRORS=$((ERRORS + 1))
fi

# ── meta.json: the search stage really used sonar-pro-search ─────
SEARCH_MODEL=$(jq -r '.stages.search.model // empty' "$META_FILE" 2>/dev/null)
if [ "$SEARCH_MODEL" = "openrouter/perplexity/sonar-pro-search" ]; then
  echo "✅ search stage used openrouter/perplexity/sonar-pro-search"
else
  echo "❌ search stage model is '$SEARCH_MODEL' (expected openrouter/perplexity/sonar-pro-search)"
  ERRORS=$((ERRORS + 1))
fi

LINKS=$(jq -r '.stages.search.linksReturned // 0' "$META_FILE" 2>/dev/null)
if [ "$LINKS" -ge 1 ]; then
  echo "✅ search returned $LINKS link(s)"
else
  echo "❌ search returned 0 links"
  ERRORS=$((ERRORS + 1))
fi

ANN=$(jq -r '.stages.search.annotationsHarvested // 0' "$META_FILE" 2>/dev/null)
echo "ℹ️  annotationsHarvested=$ANN"

OUTCOME=$(jq -r '.outcome // empty' "$META_FILE" 2>/dev/null)
if [ "$OUTCOME" = "completed" ]; then
  echo "✅ outcome is completed"
else
  echo "❌ outcome is '$OUTCOME' (expected completed)"
  ERRORS=$((ERRORS + 1))
fi

SOURCE_COUNT=$(find "$LATEST_CACHE/sources" -type f 2>/dev/null | wc -l)
if [ "$SOURCE_COUNT" -ge 1 ]; then
  echo "✅ sources/ has $SOURCE_COUNT file(s)"
else
  echo "❌ sources/ is empty — links never reached the fetch stage"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E sonar-pro-search test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E sonar-pro-search test passed — settings-only search model swap works end to end"
