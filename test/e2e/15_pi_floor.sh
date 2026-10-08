#!/usr/bin/env bash
#
# test/e2e/15_pi_floor.sh — Peer-floor compatibility scenario.
#
# Installs the pinned minimum supported Pi version (default 0.86.0, the
# registry-facade boundary that the peer range requires) into an isolated
# scratch directory and runs one real intelli_research through that OLD
# binary with the current build of the extension. This is the only scenario
# that exercises the peer floor rather than the operator's current host.
#
# What it proves, beyond the standard completed-outcome checks of 01_main:
#   1. The extension loads and registers tools on the floor host.
#   2. The LLM dispatch reaches the registry facade on Pi 0.86 (the legacy
#      provider path was removed in 0.17.0; there is no fallback).
#   3. Citation harvesting still works there: Pi 0.86 ships a pi-ai that
#      predates the onProviderStreamEvent stream option, so annotations must
#      arrive through the fetch-tee fallback channel. The assertion on
#      stages.search.annotationsHarvested is the dual-channel regression
#      guard: if that fallback rots, this scenario fails while every current
#      host keeps passing.
#
# Usage:
#   ./test/e2e/15_pi_floor.sh
#
# Environment:
#   OPENROUTER_API_KEY  Required (auto-detected from ~/.pi/agent/auth.json).
#   PI_FLOOR_VERSION    Pinned floor host to install (default: 0.86.0).
#                       Bump it here when the peer range floor moves.
#
# Network: npm registry access (installing the pinned host) plus live
# OpenRouter calls. The pinned install is cached under .tmp/ and reused.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PI_FLOOR_VERSION="${PI_FLOOR_VERSION:-0.86.0}"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-pi-floor-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

# Read .env if it exists (gitignored): parsed, never executed, and only the
# documented keys (see test/e2e/env.sh). Other credentials kept there stay out.
# shellcheck source=test/e2e/env.sh
source "$SCRIPT_DIR/env.sh"
e2e_load_env "$PROJECT_DIR/.env" OPENROUTER_API_KEY \
  E2E_TIMEOUT_SECONDS E2E_RUN_GAP_SECONDS E2E_GAP_SECONDS E2E_SCRIPT_TIMEOUT_SECONDS

# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib.sh"

E2E_TIMEOUT_SECONDS="${E2E_TIMEOUT_SECONDS:-600}"

# ── Prerequisites ──────────────────────────────────────────────────
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  if [ -f "$HOME/.pi/agent/auth.json" ]; then
    OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
  fi
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set (export it or configure ~/.pi/agent/auth.json)."
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ Current pi is not installed (needed by lib.sh helpers)"
  exit 1
fi

# ── Install the pinned floor host ──────────────────────────────────
# Cached under the repository's gitignored .tmp/ (never /tmp: the install is
# registry data, but the habit keeps every scenario uniform). Reused when the
# marker version matches.
FLOOR_ROOT="$PROJECT_DIR/.tmp/pi-floor/$PI_FLOOR_VERSION"
FLOOR_BIN="$FLOOR_ROOT/node_modules/.bin/pi"
if [ ! -x "$FLOOR_BIN" ] || ! "$FLOOR_BIN" --version 2>/dev/null | grep -q "$PI_FLOOR_VERSION"; then
  echo "⬇️  Installing @earendil-works/pi-coding-agent@$PI_FLOOR_VERSION into $FLOOR_ROOT"
  rm -rf "$FLOOR_ROOT"
  mkdir -p "$FLOOR_ROOT"
  npm --prefix "$FLOOR_ROOT" install --no-audit --no-fund \
    "@earendil-works/pi-coding-agent@$PI_FLOOR_VERSION" >/dev/null
fi

ACTUAL_VERSION="$("$FLOOR_BIN" --version 2>/dev/null || true)"
if ! printf '%s' "$ACTUAL_VERSION" | grep -q "$PI_FLOOR_VERSION"; then
  echo "❌ Pinned pi reports version '$ACTUAL_VERSION' (expected $PI_FLOOR_VERSION)"
  exit 1
fi
echo "✅ Floor host installed: pi $ACTUAL_VERSION at $FLOOR_BIN"

# Build the flag set the floor host actually supports, so the scenario does
# not break on a floor bump that renames or removes a flag.
FLOOR_FLAGS=(--no-extensions)
FLOOR_HELP="$("$FLOOR_BIN" --help 2>&1 || true)"
for flag in --no-skills --no-prompt-templates --no-context-files --no-session; do
  if printf '%s' "$FLOOR_HELP" | grep -q -- "$flag"; then
    FLOOR_FLAGS+=("$flag")
  else
    echo "   ℹ️  floor host lacks $flag; omitting"
  fi
done

# ── Isolated agent environment ─────────────────────────────────────
ISOLATED_AGENT_DIR="$(mktemp -d -t pi-e2e-floor-agent-XXXXXX)"
E2E_CWD="$(mktemp -d -t pi-e2e-floor-cwd-XXXXXX)"
trap 'rm -rf "$ISOLATED_AGENT_DIR" "$E2E_CWD"' EXIT
echo "🔒 Isolated agent dir: $ISOLATED_AGENT_DIR"
echo "📂 Isolated working directory: $E2E_CWD"
mkdir -p "$ISOLATED_AGENT_DIR/sessions"

# The floor host predates current catalogs, so pin a loop model that existed
# at 0.86.0 and routes through the single OpenRouter key: MiniMax M3, which is
# also the pipeline default. e2e_setup_loop_model with this override keeps the
# auth merge identical to every other scenario.
# shellcheck disable=SC2034  # consumed by e2e_setup_loop_model in lib.sh
E2E_LOOP_MODEL_ID="openrouter/minimax/minimax-m3"
e2e_setup_loop_model || exit 1
e2e_write_auth "$ISOLATED_AGENT_DIR"

cat > "$ISOLATED_AGENT_DIR/settings.json" <<EOF
{
  "defaultProvider": "$E2E_LOOP_PROVIDER",
  "defaultModel": "$E2E_LOOP_MODEL",
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extractModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "defaultUrls": 1,
    "maxUrls": 1
  }
}
EOF

cat > "$ISOLATED_AGENT_DIR/models.json" <<'MEOF'
{}
MEOF

# ── Run one real research through the floor host ───────────────────
# Local variant of e2e_run_pi: same retry/fresh-sidecar contract, but it
# invokes the pinned floor binary and the probed flag set. PATH is prepended
# inside the subshell so nothing else resolves the old binary.
E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
PROMPT='Use intelli_research with maxUrls=1 and domains=["typescriptlang.org"] to research: the current TypeScript release. Return the official release source.'

run_floor_pi() {
  local attempt out ec ran ref
  ref="$(mktemp)"
  for attempt in 1 2 3; do
    out="$(
      cd "$E2E_CWD"
      PATH="$FLOOR_ROOT/node_modules/.bin:$PATH" \
      PI_CODING_AGENT_DIR="$ISOLATED_AGENT_DIR" \
        timeout --foreground "${E2E_TIMEOUT_SECONDS}s" pi \
          "${FLOOR_FLAGS[@]}" \
          -e "${E2E_EXTENSION_PATH}" \
          -p "${PROMPT}" 2>&1
    )" && ec=0 || ec=$?
    ran=0
    if [ "${ec}" -eq 0 ]; then
      if find "${E2E_CWD}" -maxdepth 4 -name meta.json -newer "${ref}" \
        -exec jq -e 'select(.outcome == "completed" and .stages.fetch.succeeded > 0 and .stages.collate.summaryChars > 0)' {} \; \
        -print 2>/dev/null | grep -q '^/'; then
        ran=1
      fi
    fi
    if [ "${ran}" -eq 1 ]; then
      rm -f "${ref}"
      E2E_LAST_OUTPUT="${out}"
      return 0
    fi
    echo "   ⚠️  floor-pi attempt ${attempt}/3 failed (exit ${ec}, cache written: ${ran}); retrying after 30s" >&2
    sleep 30
  done
  rm -f "${ref}"
  E2E_LAST_OUTPUT="${out}"
  return 1
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Running pinned pi ${PI_FLOOR_VERSION} — print mode (isolated env)     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

if ! run_floor_pi; then
  echo ""
  echo "❌ Floor-host pi failed (no completed cache sidecar after retries)"
  echo ""
  echo "--- pi output ---"
  echo "${E2E_LAST_OUTPUT:-<none>}"
  echo "-----------------"
  exit 1
fi
echo "$E2E_LAST_OUTPUT"

# ── Verification ───────────────────────────────────────────────────
CACHE_DIR="$E2E_CWD/.search"
ERRORS=0

LATEST_CACHE=$(find "$CACHE_DIR" -maxdepth 1 -mindepth 1 -type d -not -name '.*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -z "$LATEST_CACHE" ] || [ ! -f "$LATEST_CACHE/meta.json" ]; then
  echo "❌ No cache entry with meta.json under $CACHE_DIR"
  exit 1
fi
echo "✅ Cache entry: $(basename "$LATEST_CACHE")"

META_OUTCOME="$(jq -r '.outcome // empty' "$LATEST_CACHE/meta.json")"
if [ "$META_OUTCOME" != "completed" ]; then
  echo "❌ outcome is '${META_OUTCOME:-missing}' (expected completed)"
  ERRORS=$((ERRORS + 1))
else
  echo "✅ outcome is completed on the floor host"
fi

LINKS="$(jq -r '.stages.search.linksReturned // 0' "$LATEST_CACHE/meta.json")"
if [ "$LINKS" -gt 0 ] 2>/dev/null; then
  echo "✅ search.linksReturned=$LINKS"
else
  echo "❌ search.linksReturned is 0"
  ERRORS=$((ERRORS + 1))
fi

# The dual-channel regression guard: the floor host's pi-ai predates
# onProviderStreamEvent, so every citation on this run must have come through
# the fetch-tee fallback in wrapFetchForAnnotations.
ANNOTATIONS="$(jq -r '.stages.search.annotationsHarvested // 0' "$LATEST_CACHE/meta.json")"
if [ "$ANNOTATIONS" -gt 0 ] 2>/dev/null; then
  echo "✅ search.annotationsHarvested=$ANNOTATIONS (fetch-tee fallback live on the floor host)"
else
  echo "❌ search.annotationsHarvested is 0: the fallback citation channel is broken on pre-1.0 hosts"
  ERRORS=$((ERRORS + 1))
fi

SUMMARY_CHARS="$(jq -r '.stages.collate.summaryChars // 0' "$LATEST_CACHE/meta.json")"
if [ "$SUMMARY_CHARS" -gt 0 ] 2>/dev/null; then
  echo "✅ collate.summaryChars=$SUMMARY_CHARS"
else
  echo "❌ collate.summaryChars is 0"
  ERRORS=$((ERRORS + 1))
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ Pi ${PI_FLOOR_VERSION} floor test failed ($ERRORS error(s))"
  exit 1
fi

echo "✅ Pi ${PI_FLOOR_VERSION} floor test passed — extension works on the peer floor, facade dispatch included, and the fallback citation channel is intact"
