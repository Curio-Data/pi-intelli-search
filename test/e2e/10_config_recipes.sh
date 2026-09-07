#!/usr/bin/env bash
#
# test/e2e/10_config_recipes.sh — E2E test for the README Configuration Recipes
#
# Runs each recipe's settings block (as documented) in its own isolated
# agent dir + working dir, and asserts the effective behaviour from the
# telemetry sidecar. Maximum isolation per scenario: fresh PI_CODING_AGENT_DIR
# (own auth.json, settings.json, models.json, trust.json) and fresh cwd, so
# no cross-contamination between configurations is possible.
#
# Coverage map (README Configuration Recipes):
#   Recipe 1 (zero config)        -> scenario R1  (true zero: NO pi-intelli-search key)
#   Recipe 2 (web tool + nano)    -> covered by e2e/08_websearch_tool.sh
#   Recipe 3 (sonar-pro-search)   -> covered by e2e/09_sonar_pro_search.sh
#   Recipe 4 (pin eight pages)    -> scenario R4
#   Recipe 5 (economy extract)    -> scenario R5
#   Recipe 6 (stronger collation) -> scenario R6
#   Recipe 7 (free-tier resilience) -> scenario R7
#   Recipe 8 (per-project override) -> scenario R8 (first E2E coverage of
#                                      project-level settings via pre-seeded trust.json)
#
# A single automatic retry per scenario guards the known transient pi
# agent-loop failure mode (the post-tool model hop has no retry wrapper);
# a scenario only fails when the retry also errors.
#
# Usage:
#   ./test/e2e/10_config_recipes.sh
#
# Environment:
#   OPENROUTER_API_KEY   Required. Get one from https://openrouter.ai

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOG_DIR="$PROJECT_DIR/.e2e-logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/e2e-config-recipes-${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "📝 Log: $LOG_FILE"

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
  echo "❌ OPENROUTER_API_KEY is not set (export it, add it to .env, or ~/.pi/agent/auth.json)."
  exit 1
fi

if ! command -v pi &>/dev/null; then
  echo "❌ pi is not installed"
  exit 1
fi

E2E_EXTENSION_PATH="$PROJECT_DIR/dist/index.js"
ERRORS=0

# ── Helpers ─────────────────────────────────────────────────────────

# make_env <name> — create isolated agent dir + cwd; echoes "AGENT CWD".
make_env() {
  local agent cwd
  agent="$(mktemp -d -t "recipe-$1-agent-XXXXXX")"
  cwd="$(mktemp -d -t "recipe-$1-cwd-XXXXXX")"
  mkdir -p "$agent/sessions"
  printf '{"openrouter":{"type":"api_key","key":"%s"}}' "$OPENROUTER_API_KEY" > "$agent/auth.json"
  echo '{}' > "$agent/models.json"
  echo "$agent $cwd"
}

# run_pi <agent> <cwd> <prompt> — runs pi once with a single
# retry on failure; returns non-zero when both attempts fail.
run_pi() {
  local agent="$1" cwd="$2" prompt="$3" attempt out ec
  for attempt in 1 2; do
    out="$(
      cd "$cwd"
      PI_CODING_AGENT_DIR="$agent" \
        timeout --foreground "${E2E_TIMEOUT_SECONDS:-360}s" pi \
          --no-extensions --no-skills --no-prompt-templates \
          --no-context-files --no-session \
          -e "$E2E_EXTENSION_PATH" \
          -p "$prompt" 2>&1
    )" && ec=0 || ec=$?
    if [ "$ec" -eq 0 ]; then
      LAST_OUTPUT="$out"
      return 0
    fi
    echo "   ⚠️  pi attempt $attempt failed (exit $ec); retrying after 30s"
    sleep 30
  done
  LAST_OUTPUT="$out"
  return 1
}

# meta_value <cache_dir> <jq_path>
meta_value() {
  local latest
  latest="$(find "$1" -maxdepth 1 -mindepth 1 -type d -not -name '.index.json' 2>/dev/null | sort -r | head -1)"
  [ -n "$latest" ] || { echo ""; return 1; }
  [ -f "$latest/meta.json" ] || { echo ""; return 1; }
  jq -r "$2 // empty" "$latest/meta.json" 2>/dev/null
}

# assert_eq <label> <actual> <expected>
assert_eq() {
  if [ "$2" = "$3" ]; then
    echo "   ✅ $1 = $3"
  else
    echo "   ❌ $1: got '$2', expected '$3'"
    ERRORS=$((ERRORS + 1))
  fi
}

# assert_le <label> <actual> <max>
assert_le() {
  if [ "$2" -le "$3" ]; then
    echo "   ✅ $1 = $2 (≤ $3)"
  else
    echo "   ❌ $1: got $2, expected ≤ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

# assert_ge for numeric floors
assert_ge() {
  if [ "$2" -ge "$3" ]; then
    echo "   ✅ $1 = $2 (≥ $3)"
  else
    echo "   ❌ $1: got $2, expected ≥ $3"
    ERRORS=$((ERRORS + 1))
  fi
}

GAP="${E2E_RUN_GAP_SECONDS:-20}"

# ── R1: Zero configuration ─────────────────────────────────────────
echo ""
echo "═══ R1: zero configuration (no pi-intelli-search key at all) ═══"
read -r AGENT CWD <<<"$(make_env r1)"
cat > "$AGENT/settings.json" <<'EOF'
{"defaultModel": "openrouter/minimax/minimax-m2.7"}
EOF
sleep "$GAP"
if run_pi "$AGENT" "$CWD" "Use intelli_research with maxUrls=2 and domains=[\"nodejs.org\"] to research: the current Node.js LTS schedule."; then
  assert_eq "search model defaulted" "$(meta_value "$CWD/.search" '.stages.search.model')" "openrouter/perplexity/sonar"
  assert_eq "extract model defaulted" "$(meta_value "$CWD/.search" '.stages.extract.model')" "openrouter/minimax/minimax-m2.7"
  assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
  assert_ge "sources fetched" "$(meta_value "$CWD/.search" '.stages.fetch.succeeded // 0')" 1
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── R4: Pin eight pages ────────────────────────────────────────────
echo ""
echo "═══ R4: pin eight pages (partial block: defaultUrls/maxUrls only) ═══"
read -r AGENT CWD <<<"$(make_env r4)"
cat > "$AGENT/settings.json" <<'EOF'
{
  "defaultModel": "openrouter/minimax/minimax-m2.7",
  "pi-intelli-search": {
    "defaultUrls": 8,
    "maxUrls": 16
  }
}
EOF
sleep "$GAP"
# No maxUrls in the prompt: the agent fallback (defaultUrls=8) must apply,
# and the models must still default (partial block does not reset them).
if run_pi "$AGENT" "$CWD" "Use intelli_research and domains=[\"nodejs.org\"] to research: the current Node.js LTS schedule. Do not pass maxUrls; let the default apply."; then
  assert_eq "search model still defaulted" "$(meta_value "$CWD/.search" '.stages.search.model')" "openrouter/perplexity/sonar"
  assert_le "pages requested (defaultUrls cap)" "$(meta_value "$CWD/.search" '.stages.fetch.requested // 999')" 8
  assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── R5: Economy extract and collate ────────────────────────────────
echo ""
echo "═══ R5: economy extract/collate (google/gemini-3.7-flash) ═══"
read -r AGENT CWD <<<"$(make_env r5)"
cat > "$AGENT/settings.json" <<'EOF'
{
  "defaultModel": "openrouter/minimax/minimax-m2.7",
  "pi-intelli-search": {
    "extractModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    },
    "collateModel": {
      "provider": "openrouter",
      "model": "google/gemini-3.7-flash"
    }
  }
}
EOF
sleep "$GAP"
if run_pi "$AGENT" "$CWD" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
  assert_eq "extract model overridden" "$(meta_value "$CWD/.search" '.stages.extract.model')" "openrouter/google/gemini-3.7-flash"
  assert_eq "collate model overridden" "$(meta_value "$CWD/.search" '.stages.collate.model')" "openrouter/google/gemini-3.7-flash"
  assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── R6: Stronger collation (collate-only override) ─────────────────
echo ""
echo "═══ R6: stronger collation (collateModel only; extract stays default) ═══"
read -r AGENT CWD <<<"$(make_env r6)"
cat > "$AGENT/settings.json" <<'EOF'
{
  "defaultModel": "openrouter/minimax/minimax-m2.7",
  "pi-intelli-search": {
    "collateModel": {
      "provider": "openrouter",
      "model": "openai/gpt-5-mini"
    }
  }
}
EOF
sleep "$GAP"
if run_pi "$AGENT" "$CWD" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
  assert_eq "collate model overridden" "$(meta_value "$CWD/.search" '.stages.collate.model')" "openrouter/openai/gpt-5-mini"
  assert_eq "extract model still default" "$(meta_value "$CWD/.search" '.stages.extract.model')" "openrouter/minimax/minimax-m2.7"
  assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── R7: Free-tier resilience ───────────────────────────────────────
echo ""
echo "═══ R7: free-tier resilience keys ═══"
read -r AGENT CWD <<<"$(make_env r7)"
cat > "$AGENT/settings.json" <<'EOF'
{
  "defaultModel": "openrouter/minimax/minimax-m2.7",
  "pi-intelli-search": {
    "defaultUrls": 5,
    "minRequestIntervalMs": 3000,
    "extractionConcurrency": 2,
    "llmRetryAttempts": 4,
    "llmTimeoutMs": 120000
  }
}
EOF
sleep "$GAP"
if run_pi "$AGENT" "$CWD" "Use intelli_research and domains=[\"nodejs.org\"] to research: the Node.js release schedule. Do not pass maxUrls; let the default apply."; then
  assert_le "pages requested (defaultUrls=5)" "$(meta_value "$CWD/.search" '.stages.fetch.requested // 999')" 5
  assert_eq "outcome" "$(meta_value "$CWD/.search" '.outcome')" "completed"
  assert_ge "sources fetched" "$(meta_value "$CWD/.search" '.stages.fetch.succeeded // 0')" 1
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── R8: Per-project override ───────────────────────────────────────
echo ""
echo "═══ R8: per-project override (project .pi/settings.json via trust) ═══"
read -r AGENT CWD <<<"$(make_env r8)"
# Global settings carry NO pi-intelli-search block: the project file is the
# only configuration source. Trust is pre-seeded the way /trust persists it.
printf '{"defaultModel": "openrouter/minimax/minimax-m2.7"}\n' > "$AGENT/settings.json"
printf '{ "%s": true }\n' "$CWD" > "$AGENT/trust.json"
mkdir -p "$CWD/.pi"
cat > "$CWD/.pi/settings.json" <<'EOF'
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar-pro-search"
    },
    "cacheDir": ".search-client-x"
  }
}
EOF
sleep "$GAP"
if run_pi "$AGENT" "$CWD" "Use intelli_research with maxUrls=2 and domains=[\"sqlite.org\"] to research: SQLite WAL mode trade-offs."; then
  assert_eq "project search model applied" "$(meta_value "$CWD/.search-client-x" '.stages.search.model')" "openrouter/perplexity/sonar-pro-search"
  assert_eq "project cacheDir applied" "$(meta_value "$CWD/.search-client-x" '.outcome')" "completed"
  if [ -d "$CWD/.search" ]; then
    echo "   ❌ default .search/ used alongside project cacheDir (override ignored)"
    ERRORS=$((ERRORS + 1))
  else
    echo "   ✅ default .search/ untouched (cacheDir override won)"
  fi
else
  echo "   ❌ pi failed both attempts"; ERRORS=$((ERRORS + 1)); printf '%s\n' "$LAST_OUTPUT" | tail -5
fi
rm -rf "$AGENT" "$CWD"

# ── Result ─────────────────────────────────────────────────────────
echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ E2E config-recipes test failed ($ERRORS error(s))"
  exit 1
fi
echo "✅ E2E config-recipes test passed — every README recipe is proven live in isolation"
