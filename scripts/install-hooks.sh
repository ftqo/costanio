#!/usr/bin/env bash
set -euo pipefail

# Install the repo's lint hooks into this clone (and every worktree of it).
#
# Idempotent and never fatal: the nix flake's shellHook runs it on every shell
# entry.
#
# It copies rather than setting core.hooksPath: Git LFS owns
# pre-push/post-merge/post-checkout/post-commit in .git/hooks, and repointing
# hooksPath would stop those running (and stop board art being pushed).
# pre-commit and pre-merge-commit are not used by LFS.
#
# An existing hook we did not write is left alone and reported.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --git-path resolves correctly from inside a linked worktree, where .git is a
# file and the real hooks directory belongs to the main checkout.
HOOKS="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS"

MARK="# costan-lint-hook"

for name in pre-commit pre-merge-commit; do
    src="$ROOT/scripts/hooks/$name"
    dst="$HOOKS/$name"
    if [ -e "$dst" ] && ! grep -q "$MARK" "$dst" 2>/dev/null; then
        echo "install-hooks: $name already exists and is not ours; leaving it alone" >&2
        continue
    fi
    { echo "#!/usr/bin/env bash"; echo "$MARK -- generated from scripts/hooks/$name, do not edit here"; tail -n +2 "$src"; } >"$dst"
    chmod +x "$dst"
done

if [ "${1:-}" = "--verbose" ]; then
    echo "install-hooks: pre-commit + pre-merge-commit installed in $HOOKS"
fi
