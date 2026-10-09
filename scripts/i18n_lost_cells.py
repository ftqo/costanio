#!/usr/bin/env python3
"""Find translations that were finished once and are empty now.

  scripts/i18n_lost_cells.py                 # every merge parent reachable from HEAD
  scripts/i18n_lost_cells.py --all           # every version of every catalogue, ever
  scripts/i18n_lost_cells.py REF [REF ...]   # named revisions only

Reports each (locale, msgctxt, msgid) that is non-empty at some revision and
present but empty at HEAD, with the text and the revisions it came from. An
empty msgstr falls back to English, so the loss does not show up in tests.

This is a script rather than a test because:

  1. It reads git history, not the tree, so its result depends on the clone
     (a shallow clone or a tarball has no history).
  2. "Non-empty then empty" is also the correct outcome when the English
     changed and the old translation was dropped as stale. A person has to
     decide which, so the output is a worklist.
  3. `--all` reads every catalogue blob in history, which takes about a minute.

Run it after a wide merge and before regenerating the catalogues: regenerating
removes the duplicate entry a bad merge leaves behind, and with it the last
copy of the lost text.
"""
import collections
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCALES_DIR = os.path.join("frontend", "src", "locales")


def git(*args, **kw):
    return subprocess.run(
        ["git", "-C", REPO, *args], capture_output=True, text=True, **kw
    )


def unescape(s):
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\", "r": "\r"}.get(s[i + 1], s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def live_entries(src):
    """(msgctxt, msgid) -> msgstr for the live entries of a .po.

    Skips the `#~` obsolete block and the header (whose msgid is empty).
    Continuation lines are joined. Duplicate keys keep the LAST, which is what
    the catalogue compiler does.
    """
    out = {}
    ctxt = mid = mstr = None
    field = None

    def flush():
        nonlocal ctxt, mid, mstr, field
        if mid:
            out[(ctxt or "", mid)] = mstr or ""
        ctxt = mid = mstr = None
        field = None

    for line in src.split("\n"):
        if line.startswith("#~"):
            continue
        if line.startswith("#") or not line.strip():
            flush()
            continue
        for name, pat in (("ctxt", "msgctxt"), ("id", "msgid"), ("str", "msgstr")):
            m = re.match(rf'^{pat} "(.*)"$', line)
            if m:
                if name != "str" and mid and (name == "id" or field == "str"):
                    flush()
                v = unescape(m.group(1))
                if name == "ctxt":
                    ctxt = v
                elif name == "id":
                    mid = v
                else:
                    mstr = v
                field = name
                break
        else:
            m = re.match(r'^"(.*)"$', line)
            if m and field:
                v = unescape(m.group(1))
                if field == "ctxt":
                    ctxt = (ctxt or "") + v
                elif field == "id":
                    mid = (mid or "") + v
                else:
                    mstr = (mstr or "") + v
    flush()
    return out


def locales():
    return sorted(
        d
        for d in os.listdir(os.path.join(REPO, LOCALES_DIR))
        if os.path.isfile(os.path.join(REPO, LOCALES_DIR, d, "messages.po"))
    )


def revisions(argv):
    if argv and argv[0] != "--all":
        return argv, "the revisions named"
    if argv and argv[0] == "--all":
        revs = git("log", "--all", "--format=%H", "--", LOCALES_DIR).stdout.split()
        return revs, f"every one of {len(revs)} catalogue-touching commits, all branches"
    # Default: the parents of every merge reachable from HEAD. A merge is where
    # this bug is made, and a parent is the last place the losing copy existed.
    merges = git("log", "--merges", "--format=%H %P", "HEAD", "--", LOCALES_DIR).stdout
    revs, seen = [], set()
    for line in merges.strip().split("\n"):
        for h in line.split()[1:]:
            if h not in seen:
                seen.add(h)
                revs.append(h)
    return revs, f"{len(revs)} parents of the merges reachable from HEAD"


def main(argv):
    locs = locales()
    head = {
        l: live_entries(open(os.path.join(REPO, LOCALES_DIR, l, "messages.po"), encoding="utf-8").read())
        for l in locs
    }
    # Only entries that still exist at HEAD and are empty can have been lost.
    # A key that is simply gone means the English changed, which is churn.
    empty = {l: {k for k, v in head[l].items() if not v} for l in locs}
    revs, what = revisions(argv)
    print(f"scanning {what}", file=sys.stderr)

    # One `git cat-file --batch-check` for every (rev, locale), then read each
    # distinct blob once. Most revisions leave most catalogues untouched, so
    # this is roughly an order of magnitude fewer reads than the naive loop.
    pairs = [(r, l) for r in revs for l in locs]
    spec = "\n".join(f"{r}:{LOCALES_DIR}/{l}/messages.po" for r, l in pairs) + "\n"
    check = subprocess.run(
        ["git", "-C", REPO, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
        input=spec, capture_output=True, text=True,
    )
    blobs = collections.defaultdict(set)
    for (rev, loc), line in zip(pairs, check.stdout.split("\n")):
        parts = line.split()
        if len(parts) == 2 and parts[1] == "blob":
            blobs[parts[0]].add(loc)

    lost = collections.defaultdict(lambda: collections.defaultdict(set))
    for oid, locs_here in blobs.items():
        src = subprocess.run(
            ["git", "-C", REPO, "cat-file", "blob", oid], capture_output=True, text=True
        ).stdout
        past = live_entries(src)
        for loc in locs_here:
            for key in empty[loc]:
                if past.get(key):
                    lost[loc][key].add(past[key])

    total = 0
    for loc in sorted(lost):
        print(f"\n=== {loc}: {len(lost[loc])} translated-then-emptied")
        for (ctxt, mid) in sorted(lost[loc]):
            total += 1
            label = f"{ctxt}|{mid}" if ctxt else mid
            print(f"  {label[:100]}")
            for text in sorted(lost[loc][(ctxt, mid)]):
                print(f"      {text[:160]}")
    print(f"\n{total} cell(s) empty at HEAD that were translated at some scanned revision.")
    if total:
        print(
            "Each is either a merge loss (recover the text) or an English rewrite "
            "(retranslate, or leave empty to fall back to English).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
