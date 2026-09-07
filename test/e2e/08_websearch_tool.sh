#!/usr/bin/env bash
#
# test/e2e/08_websearch_tool.sh — E2E test for the OpenRouter web search
# server tool (searchWebSearch settings block)
#
# Proves the full path that unit tests cannot: the searchWebSearch block
# is parsed from settings.json, buildSearchPayloadPatch runs, the patch
# survives pi-ai's adapter serialization via onPayload, OpenRouter accepts
# the injected openrouter:web_search server tool, and the response yields
# usable links (plus harvested annotations) for a NON-search-native model.
#
# Configuration under test:
#   searchModel:   openrouter/openai/gpt-5-nano  (plain chat model)
#   searchWebSearch: { enabled: true, engine: "exa", maxResults: 8,
#                      reasoning: "minimal" }
#   domains=["nodejs.org"] on the call, exercising the per-call domain
#   merge into the server tool's allowed_domains parameter.
#
# Usage:
#   ./test/e2e/08_websearch_tool.sh
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
LOG_FILE="$LOG_DIR/e2e-websearch-tool-${TIMESTAMP}.log"
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

# shellcheck source=/dev/null
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
e2e_setup_loop_model || exit 1

# ── Create isolated agent directory ────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-websearch-XXXXXX)"
E2E_CWD="$(mktemp -d -t pi-e2e-websearch-cwd-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR" "$E2E_CWD"' EXIT

echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"

mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# ── auth.json — merged by lib.sh (OpenRouter + loop provider) ─────
e2e_write_auth "$ISOLATED_AGENT_DIR"

# ── settings.json — web search server tool on a plain chat model ───
# gpt-5-nano has NO built-in search: any links returned must come from
# the injected openrouter:web_search server tool. reasoning "minimal"
# pins the GPT-5 reasoning budget (unconstrained it burns the whole
# completion budget before writing text; probe-validated 2026-09).
# The loop model is scaffolding (split form per lib.sh).
cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-nano"
    },
    "searchWebSearch": {
      "enabled": true,
      "engine": "exa",
      "maxResults": 8,
      "reasoning": "minimal"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "cacheDir": ".e2e-websearch-cache",
    "defaultUrls": 2,
    "maxUrls": 2
  }
}
EOF

# ── models.json — vanilla/empty ────────────────────────────────────
cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

echo "📄 Wrote vanilla models.json (gpt-5-nano is in Pi's built-in catalog)"
echo "⚙️  Search:   openrouter/openai/gpt-5-nano + openrouter:web_search (exa, minimal)"
echo "⚙️  Cache dir: .e2e-websearch-cache (overridden)"
echo ""

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Running pi — print mode (isolated env)                  ║"
echo "║  Search: gpt-5-nano + openrouter:web_search server tool  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

PROMPT='Use intelli_research with maxUrls=2 and domains=["nodejs.org"] to research: the current Node.js LTS schedule. Return the official schedule source.'

if ! e2e_run_pi "$ISOLATED_AGENT_DIR" "$E2E_CWD" "$PROMPT" "${E2E_TIMEOUT_SECONDS:-300}"; then
  echo ""
  echo "❌ pi failed (no cache sidecar after retries)"
  echo ""
  echo "--- pi output ---"
  echo "$E2E_LAST_OUTPUT"
  echo "-----------------"
  exit 1
fi
OUTPUT="$E2E_LAST_OUTPUT"

# ── Verify output ──────────────────────────────────────────────────
echo "$OUTPUT"

echo ""
echo "── Verification ──────────────────────────────────────────────────────"

ERRORS=0

# ── Verify custom cache directory ─────────────────────────────────
CACHE_DIR="$E2E_CWD/.e2e-websearch-cache"

if [ -d "$CACHE_DIR" ]; then
  echo "✅ .e2e-websearch-cache/ cache directory exists"
else
  echo "❌ .e2e-websearch-cache/ not found at $CACHE_DIR"
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

# ── meta.json: the server tool actually ran on the right model ────
SEARCH_MODEL=$(jq -r '.stages.search.model // empty' "$META_FILE" 2>/dev/null)
if [ "$SEARCH_MODEL" = "openrouter/openai/gpt-5-nano" ]; then
  echo "✅ search stage used openrouter/openai/gpt-5-nano"
else
  echo "❌ search stage model is '$SEARCH_MODEL' (expected openrouter/openai/gpt-5-nano)"
  ERRORS=$((ERRORS + 1))
fi

LINKS=$(jq -r '.stages.search.linksReturned // 0' "$META_FILE" 2>/dev/null)
if [ "$LINKS" -ge 1 ]; then
  echo "✅ search returned $LINKS link(s) — a non-search-native model produced links via the server tool"
else
  echo "❌ search returned 0 links (server tool path failed or was not injected)"
  ERRORS=$((ERRORS + 1))
fi

ANN=$(jq -r '.stages.search.annotationsHarvested // 0' "$META_FILE" 2>/dev/null)
if [ "$ANN" -ge 1 ]; then
  echo "✅ annotations harvested on the server-tool path: $ANN"
else
  echo "⚠️  annotationsHarvested=$ANN (tool path still worked; annotation count may vary by engine)"
fi

OUTCOME=$(jq -r '.outcome // empty' "$META_FILE" 2>/dev/null)
if [ "$OUTCOME" = "completed" ]; then
  echo "✅ outcome is completed"
else
  echo "❌ outcome is '$OUTCOME' (expected completed)"
  ERRORS=$((ERRORS + 1))
fi

SOURCE_COUNT=$(find "$LATEST_CACHE/sources" -type f 2>/dev/null | wc -l)
if [ "$SOURCE_COUNT" -ge 1 ]; then
  echo "✅ sources/ has $SOURCE_COUNT file(s) — links from the tool were fetched"
else
  echo "❌ sources/ is empty — tool-produced links never reached the fetch stage"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E websearch-tool test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E websearch-tool test passed — openrouter:web_search injection works end to end"
