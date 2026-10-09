#!/usr/bin/env python3
"""Fail when a test skips without being opted in.

A skipped test still prints "ok", so a helper that skips on some condition can
stop running for good without anyone noticing. Every skip fails this check
unless it is one of two things:

  * An opt-in skip, matched by `exempt` in the baseline. These name the
    environment variable that turns them on. Each pattern carries a `why`.
  * A skip the baseline budgets for its package, with a reason. A package
    with no entry is budgeted at zero.

Usage:

    scripts/skip-budget.py                     # run the tests, then check
    scripts/skip-budget.py ./engine/... ./bot  # only these packages
    scripts/skip-budget.py --json run.json     # check a `go test -json` run
    go test -json ./... | scripts/skip-budget.py --json -
    scripts/skip-budget.py --update            # record what is there today

`--json` reuses an existing `go test -json` run instead of running the tests again.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BASELINE = os.path.join(ROOT, "scripts", "skip-budget.json")


def baseline_label(path):
    """The baseline's path, relative to the repo when it lives there."""
    rel = os.path.relpath(os.path.abspath(path), ROOT)
    return path if rel.startswith("..") else rel


def load_baseline(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run_go_test(packages):
    cmd = ["go", "test", "-json", "-count=1"] + (packages or ["./..."])
    print("skip-budget: " + " ".join(cmd), file=sys.stderr)
    proc = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.PIPE, text=True, check=False)
    # A failing run means the census is partial.
    if proc.returncode != 0:
        print("skip-budget: WARNING: `go test` exited %d; some packages did not "
              "finish, so this census is incomplete." % proc.returncode, file=sys.stderr)
    return proc.stdout


def census(stream):
    """(package, test, reason) for every skip in a `go test -json` stream."""
    buffered = defaultdict(list)
    skips = []
    for line in stream.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        pkg, test, action = ev.get("Package", ""), ev.get("Test"), ev.get("Action")
        if action == "output":
            if test:
                buffered[(pkg, test)].append(ev.get("Output", ""))
            continue
        if action == "skip":
            # A package-level "skip" with no Test is "no test files"; that is a
            # build fact, not a skipped test.
            if not test:
                continue
            skips.append((pkg, test, reason_from(buffered.get((pkg, test), []))))
        if action in ("pass", "fail", "skip") and test:
            buffered.pop((pkg, test), None)
    return skips


def reason_from(lines):
    """The t.Skip message, out of the test's captured output.

    `go test -json` gives the whole output stream, framing included; the message
    is what is left once the `=== RUN` / `--- SKIP` / `=== NAME` markers are
    dropped. Everything left is joined, because a Skipf can be multi-line and
    the exempt patterns match against the lot.
    """
    kept = []
    for chunk in lines:
        for line in chunk.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith(("=== ", "--- ")):
                continue
            kept.append(stripped)
    return " ".join(kept)


def packages_seen(stream):
    out = set()
    for line in stream.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                pkg = json.loads(line).get("Package")
            except json.JSONDecodeError:
                continue
            if pkg:
                out.add(pkg)
    return out


def classify(skips, baseline):
    exempt = [(re.compile(e["pattern"]), e) for e in baseline.get("exempt", [])]
    counted = defaultdict(list)
    excused = defaultdict(list)
    for pkg, test, reason in skips:
        for rx, entry in exempt:
            if rx.search(reason):
                excused[pkg].append((test, entry["pattern"]))
                break
        else:
            counted[pkg].append((test, reason))
    return counted, excused


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packages", nargs="*", help="package patterns (default ./...)")
    ap.add_argument("--json", metavar="FILE",
                    help="read a `go test -json` stream instead of running one; - for stdin")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE)
    ap.add_argument("--update", action="store_true",
                    help="rewrite the baseline from this run (review the diff)")
    args = ap.parse_args()

    if args.json == "-":
        stream = sys.stdin.read()
    elif args.json:
        with open(args.json, encoding="utf-8") as f:
            stream = f.read()
    else:
        stream = run_go_test(args.packages)

    baseline = load_baseline(args.baseline)
    budgets = baseline.get("budgets", {})
    skips = census(stream)
    counted, excused = classify(skips, baseline)
    seen = packages_seen(stream)

    if args.update:
        new = {}
        for pkg in sorted(seen):
            n = len(counted.get(pkg, []))
            old = budgets.get(pkg)
            # A package with no skips and no entry stays absent (absent is zero).
            # An existing entry is kept even at zero, to keep its reason.
            if n == 0 and old is None:
                continue
            why = (old or {}).get("why", "TODO: say why these skips are acceptable")
            new[pkg] = {"max": n, "why": why}
        for pkg, entry in budgets.items():  # keep entries for packages this run did not cover
            if pkg not in seen:
                new[pkg] = entry
        baseline["budgets"] = dict(sorted(new.items()))
        with open(args.baseline, "w", encoding="utf-8") as f:
            json.dump(baseline, f, indent=2)
            f.write("\n")
        print("skip-budget: wrote %s; read the diff before committing it." % args.baseline)
        return 0

    total_excused = sum(len(v) for v in excused.values())
    failures = []
    for pkg in sorted(seen | set(counted)):
        n = len(counted.get(pkg, []))
        entry = budgets.get(pkg)
        allowed = 0 if entry is None else entry.get("max")
        if allowed is None:  # unmeasured: report, never fail
            if n:
                print("skip-budget: NOTE  %-45s %d unbudgeted skip(s) -- %s"
                      % (pkg, n, entry.get("why", "")))
                for test, reason in counted[pkg]:
                    print("                    %s: %s" % (test, reason.replace("\n", " ")[:140]))
            continue
        if n > allowed:
            failures.append((pkg, n, allowed))
            print("skip-budget: FAIL  %-45s %d skip(s), budget %d" % (pkg, n, allowed))
            for test, reason in counted[pkg]:
                print("                    %s: %s" % (test, reason.replace("\n", " ")[:140]))
        elif n < allowed:
            print("skip-budget: STALE %-45s %d skip(s), budget %d -- lower the budget "
                  "(scripts/skip-budget.py --update)" % (pkg, n, allowed))

    print("skip-budget: %d skip(s) total: %d opt-in, %d budgeted or unbudgeted."
          % (len(skips), total_excused, len(skips) - total_excused))
    if failures:
        print("\nFix the skipping test (build the state it needs instead of searching "
              "seeds), or budget it in %s with a reason."
              % baseline_label(args.baseline))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
