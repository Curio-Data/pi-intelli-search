#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=test/e2e/batch.sh
source "$(dirname "${BASH_SOURCE[0]}")/batch.sh"
e2e_native_batch independent
