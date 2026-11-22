#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
# Opt-in only; never add to the automatic suite. No paid reruns on failure.
set -euo pipefail
set +x
[[ ${S19_APPROVED:-} == yes ]] || { echo 'Separate owner approval and S19_APPROVED=yes required.' >&2; exit 1; }
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd -P)
# shellcheck source=test/e2e/env.sh
source "$root/test/e2e/env.sh"
: "${DSH_BIN:?Set DSH_BIN to the isolated rc.1 host}"
dsh=$(realpath "$DSH_BIN")
mkdir -p "$root/.tmp"
r=$(mktemp -d "$root/.tmp/dsh-live-XXXXXXXX")
printf 'Private run directory: %s\n' "$r"
export TMPDIR="$r/tmp" HOME="$r/home" DSH_HOME="$r/dsh" DSH_AGENTS_HOME="$r/agents" XDG_CONFIG_HOME="$r/config" XDG_DATA_HOME="$r/data" npm_config_cache="$r/npm-cache"
mkdir -p "$TMPDIR" "$HOME" "$DSH_HOME" "$DSH_AGENTS_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$r/project"
unset DEEPSEEK_API_KEY OPENROUTER_API_KEY
cd "$r/project"
[[ $("$dsh" --version) == 0.2.2-rc.1 ]]
printf 'dsh=%s node=%s pnpm=%s mcp=%s\n' "$("$dsh" --version)" "$(node -v)" "$(pnpm -v)" "$(jq -r .version "$root/packages/mcp/package.json")"
(cd "$root" && npm run build:mcp && npm pack --workspace @curio-data/mcp-intelli-search --ignore-scripts --pack-destination "$r") > "$r/build.log" 2>&1
node "$root/scripts/generate-plugin-bundles.mjs" --mode tarball --output "$r/bundles" --codex-vendor-dir "$r/bundles/plugins/codex/vendor" >/dev/null
bundle="$r/bundles/plugins/dsh"
npm install --prefix "$bundle/vendor" --omit=dev --ignore-scripts "$r"/*.tgz > "$r/install.log" 2>&1
cli="$bundle/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js"
profile=s19
"$dsh" --profile "$profile" --from-default-profile headless --dump-config >/dev/null
"$dsh" plugin --profile "$profile" add "$bundle" > "$r/plugin.log" 2>&1
printf '\n- insert:\n    - id: intelli-live-guard\n      name: "%s"\n' "$root/test/e2e/dsh/live-guard.mjs" > "$DSH_HOME/profiles/$profile/cordis.patch.yml"
"$dsh" --profile "$profile" --dump-config > "$r/profile.yml"
rg -q '^- id: intelli-live-guard$' "$r/profile.yml"
rg -q '^- id: mcp-intelli-search$' "$r/profile.yml"
e2e_load_env "$root/.env" DEEPSEEK_API_KEY OPENROUTER_API_KEY
: "${DEEPSEEK_API_KEY:?Missing DeepSeek credential}" "${OPENROUTER_API_KEY:?Missing OpenRouter credential}"
key=$OPENROUTER_API_KEY; unset OPENROUTER_API_KEY
# Both files are created by this run for the credential cases only.
trap 'rm -f -- "$DSH_HOME/.env" "$XDG_CONFIG_HOME/mcp-intelli-search/openrouter.key"' EXIT
printf 'OPENROUTER_API_KEY=%s\n' "$key" > "$DSH_HOME/.env"
run_case() {
  local label=$1 tool="mcp__intelli__intelli_$2" prompt=$3 status=0
  S19_TOOL="$tool" S19_WITNESS="$r/$label.admitted" timeout -k 10 720 "$dsh" --profile "$profile" --permission-mode workspace-write --approval-policy never --json "Call $tool exactly once. $prompt Do not call any other tool or retry. Give a brief answer with source URLs; if the call fails, report the failure and stop." </dev/null > "$r/$label.jsonl" 2> "$r/$label.err" || status=$?
  printf '%s host exit=%s\n' "$label" "$status"
  [[ $status == 0 && -f "$r/$label.admitted" ]] || return 1
  jq -es --arg tool "$tool" '
    [ .[] | select(.type=="tool_call") ] as $calls |
    [ .[] | select(.type=="tool_result") ] as $results |
    last as $end | ($calls|length)==1 and ($results|length)==1 and $calls[0].tool==$tool and $results[0].callId==$calls[0].callId and $results[0].status=="completed" and ($results[0].result|test("https?://")) and $end.type=="final" and $end.reason.kind=="completed" and ($end.text|test("https?://"))' "$r/$label.jsonl" >/dev/null
}
search='Search for what Node.js AsyncLocalStorage.getStore() returns outside a context; restrict domains to ["nodejs.org"].'
run_case env-search search "$search"
run_case research research 'Research how Node.js AsyncLocalStorage.run, getStore and enterWith differ. Use query (not queries), maxUrls: 3, domains: ["nodejs.org"] and a focusPrompt requesting official API semantics and examples.'
shopt -s nullglob
metas=(.search/*/meta.json); [[ ${#metas[@]} == 1 ]]
meta=${metas[0]}; report=${meta%/*}/report.md
jq -e '.adapter=="mcp" and .outcome=="completed" and (.stages.fetch.requested>0 and .stages.fetch.requested<=3) and .stages.extract.succeeded>0 and .stages.collate.summaryChars>0' "$meta" >/dev/null
rg -q '\[S1\]' "$report"
if jq -e '.stages.extract.succeeded==3' "$meta" >/dev/null; then rg -q '\[S2\]' "$report" && rg -q '\[S3\]' "$report" || exit 1; fi
printf '%s\n' "$key" | node "$cli" setup > "$r/setup.log" 2>&1
unset key
printf 'OPENROUTER_API_KEY=\n' > "$DSH_HOME/.env"
[[ $(stat -c %a "$XDG_CONFIG_HOME/mcp-intelli-search/openrouter.key") == 600 ]]
run_case file-search search "$search"
printf 'PASS: three isolated headless cases; cache in launch workspace.\n'
