#!/usr/bin/env bash
set -euo pipefail

# Lint Go + frontend, one command for both.
#
#   ./scripts/lint.sh              report on what this branch changed (no writes)
#   ./scripts/lint.sh --fix        the same scope, but apply every autofix
#   ./scripts/lint.sh --all        report on the whole tree
#   ./scripts/lint.sh --fix --all  apply every autofix to the whole tree
#   ./scripts/lint.sh --staged     report on what is in the index (the git hook)
#   ./scripts/lint.sh --since REF  report on what changed since REF
#
# Read-only by default. --fix announces itself, lists the files it touched, and
# always re-checks afterwards; the re-check decides the exit code, since an
# autofix replayed from a stale cache can corrupt a file.
#
# Scope defaults to changed files so the hook stays fast. Run --all before
# calling anything finished: scoped runs can miss `unused` findings whose last
# caller was deleted outside the scope.
#
# costan-lint-staged-capable: do not remove. The git hooks live in the shared
# .git/hooks and run against whichever worktree is committing; they grep for
# this marker to decide whether this copy understands --staged, and skip
# rather than pass it to an older copy.

FIX=0
SCOPE=branch
SINCE=""

while [ $# -gt 0 ]; do
    case "$1" in
    --fix) FIX=1 ;;
    --all) SCOPE=all ;;
    --staged) SCOPE=staged ;;
    --branch) SCOPE=branch ;;
    --since)
        SCOPE=since
        SINCE="${2:?--since needs a ref}"
        shift
        ;;
    --check) ;; # no-op: checking is the default
    -h | --help)
        sed -n '4,22p' "$0" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
    *)
        echo "lint.sh: unknown argument $1 (try --help)" >&2
        exit 2
        ;;
    esac
    shift
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# golangci-lint's default cache is shared by every checkout and keys findings by
# absolute path, so a removed git worktree leaves findings behind that later runs
# report against files that no longer exist. Keep one cache per checkout.
if [ -z "${GOLANGCI_LINT_CACHE:-}" ]; then
    GOLANGCI_LINT_CACHE="$(git rev-parse --absolute-git-dir)/golangci-lint-cache"
    export GOLANGCI_LINT_CACHE
fi

# ---------------------------------------------------------------- file scoping

# changed_files prints the paths in scope, one per line, relative to the root.
changed_files() {
    case "$SCOPE" in
    all) git ls-files ;;
    staged) git diff --cached --name-only --diff-filter=ACMR ;;
    since) git diff --name-only --diff-filter=ACMR "$SINCE" ;;
    branch)
        # This branch's work: everything since it left main, plus anything
        # uncommitted.
        base="$(git merge-base HEAD main 2>/dev/null || echo HEAD)"
        {
            git diff --name-only --diff-filter=ACMR "$base"
            git diff --name-only --diff-filter=ACMR --cached
            git ls-files --others --exclude-standard
        }
        ;;
    esac | sort -u
}

FILES="$(changed_files || true)"
filter() { printf '%s\n' "$FILES" | grep -E "$1" || true; }

GO_FILES="$(filter '\.go$')"
FE_FILES="$(filter '^frontend/.*\.(ts|tsx|css|js|json)$')"
ASSET_FILES="$(filter '^frontend/public/assets/')"

if [ "$SCOPE" = all ]; then
    # Whole-tree mode lints packages directly: one pass, and whole-program
    # linters like `unused` see the whole program.
    GO_SCOPE="./..."
else
    # golangci-lint takes package directories. Map each changed .go file to its
    # package; skip the Go half entirely when nothing Go moved.
    GO_SCOPE="$(printf '%s\n' "$GO_FILES" | grep '\.go$' | xargs -n1 dirname 2>/dev/null | sort -u | sed 's|^|./|' | tr '\n' ' ' || true)"
fi

FAILED=0
step() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
fail() { FAILED=1; }

if [ "$FIX" = 1 ]; then
    printf '\n*** --fix: this rewrites files in place. ***\n'
    case "$SCOPE" in
    all) note "scope: the whole tree" ;;
    staged) note "scope: the files staged in the index" ;;
    since) note "scope: files changed since $SINCE" ;;
    branch) note "scope: this branch's changes vs main, plus uncommitted work" ;;
    esac
    BEFORE="$(git status --porcelain=v1 || true)"
fi

# --------------------------------------------------------------------------- Go

if [ -n "${GO_SCOPE// /}" ]; then
    if [ "$FIX" = 1 ]; then
        step "Go: format + autofix"
        # golangci-lint caches findings with byte offsets into the file it read,
        # and replaying a stale finding over a changed tree can land an edit
        # mid-word or break a file's syntax. Drop the cache before writing.
        golangci-lint cache clean >/dev/null 2>&1 || true
        # shellcheck disable=SC2086 # GO_SCOPE is a list of packages
        golangci-lint fmt $GO_SCOPE
        # --fix exits non-zero when unfixable issues remain. That is the report
        # below's job, not a reason to stop before the frontend.
        # shellcheck disable=SC2086
        golangci-lint run --fix $GO_SCOPE || true
    fi
    step "Go: format check"
    # shellcheck disable=SC2086
    golangci-lint fmt --diff $GO_SCOPE || fail
    step "Go: lint"
    # shellcheck disable=SC2086
    golangci-lint run $GO_SCOPE || fail
else
    step "Go: nothing in scope"
fi

# --------------------------------------------------------------------- frontend

if [ -n "$FE_FILES" ]; then
    # eslint and prettier want paths relative to frontend/.
    FE_REL="$(printf '%s\n' "$FE_FILES" | sed 's|^frontend/||')"
    if [ "$SCOPE" = all ]; then
        ESLINT_ARGS=(.)
        PRETTIER_ARGS=("src/**/*.{ts,tsx,css}" "*.{ts,js,json}")
    else
        # read rather than mapfile: macOS ships bash 3.2.
        ESLINT_ARGS=()
        PRETTIER_ARGS=()
        while IFS= read -r f; do
            [ -n "$f" ] || continue
            PRETTIER_ARGS+=("$f")
            case "$f" in *.ts | *.tsx) ESLINT_ARGS+=("$f") ;; esac
        done <<<"$FE_REL"
    fi

    if [ "$FIX" = 1 ]; then
        step "Frontend: eslint --fix + prettier --write"
        if [ ${#ESLINT_ARGS[@]} -gt 0 ]; then
            # --prune-suppressions lowers the shadcn/lint budget
            # (frontend/eslint-suppressions.json) for files whose count went
            # down. A count that went up is a failure, reported below.
            (cd frontend && npx eslint --fix --prune-suppressions "${ESLINT_ARGS[@]}" || true)
        fi
        if [ ${#PRETTIER_ARGS[@]} -gt 0 ]; then
            (cd frontend && npx prettier --write --log-level warn "${PRETTIER_ARGS[@]}")
        fi
    fi
    step "Frontend: lint"
    if [ ${#ESLINT_ARGS[@]} -gt 0 ]; then
        # --max-warnings 0: rules the project ignores are "off" in
        # eslint.config.js with a reason, not left as warnings.
        #
        # The @shadcn/lint findings that existed at adoption are budgeted per
        # file in frontend/eslint-suppressions.json. ESLint fails a file both
        # over and under its count, so the budget only goes down. `--fix`
        # prunes.
        (cd frontend && npx eslint --max-warnings 0 "${ESLINT_ARGS[@]}") || fail
    else
        note "no .ts/.tsx in scope"
    fi
    step "Frontend: format check"
    if [ ${#PRETTIER_ARGS[@]} -gt 0 ]; then
        (cd frontend && npx prettier --check --log-level warn "${PRETTIER_ARGS[@]}") || fail
    fi
    # Types, about 6 seconds. Not scoped to changed files: a type error
    # often shows up in a file other than the one edited. vitest
    # transpiles without type-checking and eslint isn't type-aware here.
    #
    # No autofix exists, so this runs the same with --fix.
    if [ ${#ESLINT_ARGS[@]} -gt 0 ]; then
        step "Frontend: typecheck"
        (cd frontend && npm run --silent typecheck) || fail
    fi
else
    step "Frontend: nothing in scope"
fi

# ----------------------------------------------------------------------- assets

# Served binaries carry the name of whatever produced them unless it is
# stripped. Catch a newly added asset before it ships.
if [ "$SCOPE" = all ] || [ -n "$ASSET_FILES" ]; then
    if [ "$FIX" = 1 ]; then
        step "Assets: strip metadata"
        python3 scripts/strip-asset-metadata.py
    fi
    step "Assets: metadata check"
    python3 scripts/strip-asset-metadata.py --check || fail
fi

# ----------------------------------------------------------------------- report

if [ "$FIX" = 1 ]; then
    AFTER="$(git status --porcelain=v1 || true)"
    if [ "$BEFORE" != "$AFTER" ]; then
        step "--fix rewrote files. Everything now dirty:"
        git status --short
    else
        step "--fix wrote nothing."
    fi
fi

if [ "$FAILED" = 1 ]; then
    printf '\n==> FAILED.\n'
    if [ "$FIX" = 1 ]; then
        note "The issues above are the ones no autofixer can take."
        note "Fix them by hand, or change the rule and say why."
    else
        note "Autofix what is mechanical:  ./scripts/lint.sh --fix"
        note "Then re-run this to see what is left."
    fi
    exit 1
fi

printf '\n==> Clean.\n'
