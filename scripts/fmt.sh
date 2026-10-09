#!/usr/bin/env bash
set -euo pipefail

# Format and autofix the whole repo in place: `lint.sh --fix --all`, kept
# under this name for convenience.

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lint.sh" --fix --all "$@"
