#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
# Linux-only scenario 13 launcher. No host home, repository or user runtime
# directory is mounted. The caller prepares one private scratch tree.
set -euo pipefail
root=$(realpath -e -- "$1")
shift
[[ -d $root/claude-home && -d $root/tmp && -d $root/home && $root != / ]]
node_prefix=$(dirname "$(dirname "$(realpath -e "$(command -v node)")")")
claude_bin=$(realpath -e "$(command -v claude)")
bwrap_bin=$(command -v bwrap)
resolver=$(realpath -e /etc/resolv.conf)
dns=()
if [[ $resolver != /etc/* ]]; then dns=(--ro-bind "$resolver" "$resolver"); fi
cwd=$PWD
case "$cwd/" in "$root/"*) ;; *) cwd=$root ;; esac
# Do not pass arbitrary host credentials, agent sockets or host-specific
# plugin overrides. Avoid placing the permitted static token in any argv.
while read -r name; do
  case "$name" in CLAUDE_CODE_OAUTH_TOKEN|PATH) ;; *) export -n "${name?}" ;; esac
done < <(compgen -e)
export PATH=/tools:/opt/node/bin:/usr/bin:/bin HOME="$root/home" TMPDIR="$root/tmp"
export CLAUDE_CONFIG_DIR="$root/claude-home" LANG=C.UTF-8
cmd=(/tools/claude "$@")
if [[ ${1:-} == --isolation-probe ]]; then
  # A caller-supplied non-secret sentinel path tests the mount boundary.
  # shellcheck disable=SC2016 # expanded by the isolated shell
  cmd=(/bin/bash -euc '[[ -f "$HOME/inside" && ! -e "$1" && ! -e "$2" ]]; printf ok > "$TMPDIR/probe-result"' probe "$2" "$3")
fi
exec "$bwrap_bin" --die-with-parent --unshare-pid --unshare-ipc --unshare-uts \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc "${dns[@]}" --dev /dev --proc /proc --tmpfs /tmp \
  --dir /tools --ro-bind "$claude_bin" /tools/claude --ro-bind "$node_prefix" /opt/node \
  --bind "$root" "$root" --chdir "$cwd" -- "${cmd[@]}"
