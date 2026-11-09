#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
# Preparation and supervision live in Node. In particular, do not wrap this
# process in timeout --foreground: it must settle its owned process groups.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/e2e/parallel-runner.mjs" "$@"
