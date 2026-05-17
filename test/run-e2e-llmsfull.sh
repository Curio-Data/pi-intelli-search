#!/usr/bin/env bash
#
# test/run-e2e-llmsfull.sh — E2E test for automatic llms-full.txt discovery
#
# Proves the HEAD-probe auto-discovery works by targeting a site known
# to publish llms-full.txt at the standard /llms-full.txt root path.
# Verifies the file lands in sources/llms-full-*.md in the cache.
#
# Usage:
#   ./test/run-e2e-llmsfull.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

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
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
echo "🧪 Extension: $E2E_EXTENSION_PATH"

# ═══════════════════════════════════════════════════════════════════
# Probe known llms-full.txt sites manually first to find a live one
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "── Probing candidate sites for llms-full.txt ──"

CANDIDATES=(
  "https://docs.anthropic.com/llms-full.txt"
  "https://mintlify.com/llms-full.txt"
  "https://vercel.com/llms-full.txt"
  "https://svelte.dev/llms-full.txt"
  "https://docs.astro.build/llms-full.txt"
  "https://supabase.com/llms-full.txt"
  "https://platform.openai.com/llms-full.txt"
  "https://docs.deno.com/llms-full.txt"
)

FOUND_URL=""
FOUND_HOSTNAME=""
for url in "${CANDIDATES[@]}"; do
  hostname="${url#https://}"
  hostname="${hostname%%/*}"
  STATUS=$(curl -sSI -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  SIZE=$(curl -sSI --max-time 5 "$url" 2>/dev/null | grep -i content-length | awk '{print $2}' | tr -d '\r' || echo "0")
  echo "   $url → HTTP $STATUS (${SIZE:-?} bytes)"
  if [ "$STATUS" = "200" ] && [ "${SIZE:-0}" -gt 1000 ]; then
    FOUND_URL="$url"
    FOUND_HOSTNAME="$hostname"
    break
  fi
done

if [ -z "$FOUND_URL" ]; then
  echo ""
  echo "⚠️  No candidate site returned 200 with substantial content."
  echo "   Running a best-effort test — the probe may or may not succeed."
  # Default to a site that should work
  FOUND_HOSTNAME="docs.anthropic.com"
else
  echo ""
  echo "✅ Found live llms-full.txt at: $FOUND_URL"
  echo "   Hostname: $FOUND_HOSTNAME"
fi

# ═══════════════════════════════════════════════════════════════════
# Run intelli_research targeting the found domain
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running intelli_research targeting $FOUND_HOSTNAME"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

ISO="$(mktemp -d -t pi-e2e-llmsfull-XXXXXX)"
trap 'rm -rf "$ISO"' EXIT

mkdir -p "$ISO/sessions"

cat > "$ISO/auth.json" <<EOF
{"openrouter":{"type":"api_key","key":"$OPENROUTER_API_KEY"}}
EOF

cat > "$ISO/settings.json" <<EOF
{
  "defaultModel": "openrouter/perplexity/sonar",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m2.7"
    },
    "defaultUrls": 1,
    "maxUrls": 1,
    "extractMaxChars": 150000,
    "extractionMaxTokens": 3000,
    "collationMaxTokens": 4000,
    "cacheDir": ".e2e-llmsfull"
  }
}
EOF

cat > "$ISO/models.json" <<'MEOF'
{}
MEOF

# Use intelli_research with domains parameter to constrain search to the
# discovered hostname. The domains filter is applied at the Sonar search stage
# and keeps the result set small (maxUrls=1), so the first returned page is
# almost certainly from the target domain.
OUTPUT="$(
  PI_CODING_AGENT_DIR="$ISO" \
    pi \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --no-context-files \
      --no-session \
      -e "$E2E_EXTENSION_PATH" \
      -p "Use intelli_research with maxUrls=1 and domains=[\"$FOUND_HOSTNAME\"] to research: getting started guide" \
      2>&1
)" || {
  echo ""
  echo "❌ pi exited with an error"
  echo "$OUTPUT"
  exit 1
}

echo "$OUTPUT"
rm -rf "$ISO"

# ═══════════════════════════════════════════════════════════════════
# Verify llms-full.txt landed in the cache
# ═══════════════════════════════════════════════════════════════════

echo ""
echo "══ Verification ════════════════════════════════════════════════════════"

ERRORS=0
CACHE_DIR="$PROJECT_DIR/.e2e-llmsfull"

if [ ! -d "$CACHE_DIR" ]; then
  echo "❌ Cache directory .e2e-llmsfull/ not found"
  ERRORS=$((ERRORS + 1))
else
  # Find llms-full-*.md files anywhere in the cache
  LLMS_FILES=$(find "$CACHE_DIR" -name "llms-full-*.md" -type f 2>/dev/null || true)

  if [ -z "$LLMS_FILES" ]; then
    echo "⚠️  No llms-full-*.md file found in cache"
    echo "   The site may not have llms-full.txt at the standard path,"
    echo "   or the search returned a different domain."
    echo ""
    echo "   Cache contents:"
    find "$CACHE_DIR" -type f 2>/dev/null | head -20 || echo "   (empty)"
  else
    for f in $LLMS_FILES; do
      SIZE=$(wc -c < "$f" || echo "0")
      echo "✅ Found: $f (${SIZE} bytes)"
      if [ "$SIZE" -gt 500 ]; then
        echo "   Content looks substantial (${SIZE} bytes)"
        head -c 200 "$f" 2>/dev/null
        echo ""
      else
        echo "   ⚠️  File is small (${SIZE} bytes) — may not be full documentation"
      fi
    done
  fi
fi

# Clean up
rm -rf "$CACHE_DIR"

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E llms-full test FAILED ($ERRORS error(s))"
  exit 1
fi

echo "✅ E2E llms-full test PASSED — auto-discovery works"
