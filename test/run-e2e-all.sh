#!/usr/bin/env bash
#
# test/run-e2e-all.sh — Sequential E2E runner
#
# Runs every live E2E script ONE AT A TIME with a spacing gap between them.
# Running the scripts concurrently (or back-to-back with no gap) bursts dozens
# of LLM calls at a single OpenRouter key and trips provider rate limits, which
# surfaces as degraded/failed runs. This runner serialises them and paces the
# bucket so the suite is a reliable signal.
#
# Usage:
#   ./test/run-e2e-all.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required (auto-detected from ~/.pi/agent/auth.json).
#   E2E_GAP_SECONDS      Gap between scripts (default: 20). OpenRouter's free
#                        bucket refills at ~0.33 req/s, so a ~20s gap lets it
#                        recover between scripts. Set 0 on paid/high-limit keys.
#
# Excludes run-e2e-publish.sh (release-only; validates the npm package).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GAP="${E2E_GAP_SECONDS:-20}"

# Load .env if present (gitignored)
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

# Auto-detect the key so failures are about rate limits, not setup.
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -f "$HOME/.pi/agent/auth.json" ]; then
  OPENROUTER_API_KEY="$(jq -r '.openrouter.key // empty' "$HOME/.pi/agent/auth.json" 2>/dev/null || true)"
fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "❌ OPENROUTER_API_KEY is not set (export it, add to .env, or ~/.pi/agent/auth.json)."
  exit 1
fi
export OPENROUTER_API_KEY

# Order: cheapest/most-fundamental first, broadest last.
SCRIPTS=(
  run-e2e.sh
  run-e2e-cap.sh
  run-e2e-model-override.sh
  run-e2e-migration.sh
  run-e2e-collation-limits.sh
  run-e2e-extract-limits.sh
  run-e2e-llmsfull.sh
)

echo "🧪 Sequential E2E run — ${#SCRIPTS[@]} scripts, ${GAP}s gap between each"
echo ""

PASSED=()
FAILED=()

for i in "${!SCRIPTS[@]}"; do
  script="${SCRIPTS[$i]}"
  echo "════════════════════════════════════════════════════════════════"
  echo "▶  [$((i + 1))/${#SCRIPTS[@]}] $script"
  echo "════════════════════════════════════════════════════════════════"

  # Don't let one failure abort the suite — collect results and report at the end.
  if "$SCRIPT_DIR/$script"; then
    echo "✅ $script PASSED"
    PASSED+=("$script")
  else
    echo "❌ $script FAILED (exit $?)"
    FAILED+=("$script")
  fi

  # Space out all but the last script to let the rate-limit bucket recover.
  if [ "$i" -lt "$((${#SCRIPTS[@]} - 1))" ] && [ "$GAP" -gt 0 ]; then
    echo "⏳ Sleeping ${GAP}s before next script..."
    sleep "$GAP"
  fi
  echo ""
done

echo "════════════════════════════════════════════════════════════════"
echo "Summary: ${#PASSED[@]} passed, ${#FAILED[@]} failed"
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '   ❌ %s\n' "${FAILED[@]}"
  exit 1
fi
echo "✅ All E2E scripts passed"
