#!/usr/bin/env python3
"""Check a translated catalogue against en/messages.po.

  scripts/po_verify.py LOCALE

Reports ids missing from or extra to the locale, placeholder / tag / ICU
argument disagreements, plural arms missing for a category the locale selects,
a msgstr equal to its own msgid, and a blank entry whose English carries a
plural. Not part of the build and not run by anything; run it after editing a
catalogue (see docs/i18n/CONTRIBUTING.md). Exits non-zero on any problem.
"""
import json
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EN = os.path.join(REPO, "frontend", "src", "locales", "en", "messages.po")
_STR = re.compile(r'"(?:[^"\\]|\\.)*"')


def field(block, name, obsolete=False):
    pre = r"#~ " if obsolete else ""
    m = re.search(r'^%s%s ((?:"(?:[^"\\]|\\.)*"\s*(?:\n%s)?)+)' % (pre, name, pre), block, re.M)
    if not m:
        return None
    return "".join(json.loads(s) for s in _STR.findall(m.group(1)))


_ARG = re.compile(r"\{\s*([A-Za-z0-9_]+)\s*(?=[},])(,\s*(?:plural|select|selectordinal)\s*,)?")


def _arg_names(s):
    """Argument names at any depth, walking select/plural arm bodies as text.

    A regex alone reads a one-word arm (`{cargo, select, 1 {marble} ...}`) as
    an argument named `marble`, so the Wagons cargo log lines could only pass
    in English. Mirrors `placeholders` in frontend/src/locales/catalog.test.ts.
    """
    out = []

    def walk(i, stop_at_close):
        while i < len(s):
            c = s[i]
            if c == "}" and stop_at_close:
                return i + 1
            if c != "{":
                i += 1
                continue
            m = _ARG.match(s, i)
            if not m:
                i += 1
                continue
            out.append(m.group(1))
            i = m.end()
            if not m.group(2):
                while i < len(s) and s[i] != "}":
                    i += 1
                i += 1
                continue
            while i < len(s):
                while i < len(s) and s[i].isspace():
                    i += 1
                if i < len(s) and s[i] == "}":
                    i += 1
                    break
                while i < len(s) and s[i] not in "{}":
                    i += 1
                if i < len(s) and s[i] == "{":
                    i = walk(i + 1, True)
        return i

    walk(0, False)
    return out


def blocks():
    raw = open(EN, encoding="utf-8").read().rstrip("\n").split("\n\n")
    out = []
    for i, b in enumerate(raw):
        obs = b.lstrip().startswith("#~") or "\n#~ msgid" in b
        obs = re.search(r"^#~ msgid ", b, re.M) is not None
        msgid = field(b, "msgid", obs)
        if msgid is None:
            out.append({"i": i, "raw": b, "header": True})
            continue
        if msgid == "" and i == 0:
            out.append({"i": i, "raw": b, "header": True})
            continue
        out.append({
            "i": i,
            "raw": b,
            "obsolete": obs,
            "ctx": field(b, "msgctxt", obs),
            "msgid": msgid,
            "en": field(b, "msgstr", obs),
            "src": [l[3:] for l in b.split("\n") if l.startswith("#: ")],
            "keyed": bool(re.search(r"js-lingui-explicit-id", b)),
        })
    return out


def plural_categories(locale):
    """The plural categories this locale selects, from CLDR via node.

    Mirrors `requiredPluralCategories` in frontend/src/locales/catalog.test.ts:
    the categories `Intl.PluralRules` selects over the integers below ten
    thousand (every count this app can display), plus `other`, which ICU
    requires as the fallback arm. Asking the platform beats a hand table: `few`
    means something different in Czech, Polish, Russian and Ukrainian. The
    ceiling keeps out the `many` that es, fr, it and pt-BR define only for
    compact millions. Falls back to the two-arm set if node is unavailable,
    which under-reports rather than inventing failures.
    """
    script = (
        "const r = new Intl.PluralRules(process.argv[1]);"
        "const s = new Set(['other']);"
        "for (let n = 0; n <= 10000; n++) s.add(r.select(n));"
        "const order = ['zero', 'one', 'two', 'few', 'many', 'other'];"
        "process.stdout.write(order.filter((c) => s.has(c)).join(','))"
    )
    try:
        out = subprocess.run(
            ["node", "-e", script, locale],
            capture_output=True, text=True, timeout=20, check=True).stdout
        cats = [c for c in out.strip().split(",") if c]
        return cats or ["one", "other"]
    except Exception:
        return ["one", "other"]


def cmd_verify(locale):
    path = os.path.join(REPO, "frontend", "src", "locales", locale, "messages.po")
    got = open(path, encoding="utf-8").read().rstrip("\n").split("\n\n")
    en = blocks()
    bad = 0

    # Key the target by (msgctxt, msgid, obsolete) rather than walking it in
    # lockstep with English: obsolete `#~` runs and multi-line entries mean block
    # counts don't line up. Look entries up by identity and report what is
    # missing.
    index = {}
    for blk in got:
        obs = re.search(r"^#~ msgid ", blk, re.M) is not None
        gid = field(blk, "msgid", obs)
        if gid is None or gid == "":
            continue  # header block carries msgid "" and has no counterpart
        index[(field(blk, "msgctxt", obs), gid, obs)] = blk

    cats = plural_categories(locale)

    def args(s):
        """Placeholders as a SET, tags and ICU arguments exactly.

        Mirrors `catalog.test.ts`. Placeholders compare as a set because a
        language with more plural arms repeats them (Czech's
        `card.improveShort.cloth` carries four `{held}` where English has two).
        Tags and ICU arguments stay exact: the code addresses both by name.

        `\\{name\\}` / `\\{name,` only: anchoring on the closing brace or the comma
        stops a plural arm body ("{Stavba cest: polož …}") being read as an
        argument named `Stavba`.
        """
        a = sorted(set(_arg_names(s or "")))
        t = sorted(re.findall(r"</?(\d+)\s*/?>", s or ""))
        icu = sorted(re.findall(r"\{\s*([A-Za-z0-9_]+)\s*,\s*(?:plural|select|selectordinal)",
                                s or ""))
        return a, t, icu

    seen = 0
    for b in en:
        if b.get("header"):
            continue
        obs = b["obsolete"]
        # Skip obsolete `#~` entries: gettext keeps them for recovery and nothing
        # renders them. They legitimately differ between catalogues, so checking
        # them would report noise on every clean tree.
        if obs:
            continue
        blk = index.get((b["ctx"], b["msgid"], obs))
        if blk is None:
            print("MISSING: %r (ctx=%r)" % (b["msgid"][:70], b["ctx"]))
            bad += 1
            continue
        seen += 1
        tr = field(blk, "msgstr", obs)
        if not tr:
            if re.search(r"\bplural\s*,", b["en"] or ""):
                print("BLANK-WITH-PLURAL (falls back to a two-arm English entry): %r"
                      % b["msgid"][:70])
                bad += 1
            continue
        if tr == b["msgid"] and not b["keyed"]:
            print("SELF: %r" % b["msgid"][:70]); bad += 1
        if tr == b["msgid"] and b["keyed"]:
            print("SELF(keyed id): %r" % b["msgid"][:70]); bad += 1
        ea, et, eicu = args(b["en"])
        ca, ct, cicu = args(tr)
        # plural category names are ICU keywords, not arguments
        kw = {"plural", "select", "selectordinal", "one", "few", "many", "other", "zero", "two", "offset"}
        ea = [x for x in ea if x not in kw]
        ca = [x for x in ca if x not in kw]
        if sorted(ea) != sorted(ca):
            print("ARGS %r\n  en=%s\n  %s=%s" % (b["msgid"][:60], ea, locale, ca)); bad += 1
        if et != ct:
            print("TAGS %r en=%s %s=%s" % (b["msgid"][:60], et, locale, ct)); bad += 1
        if eicu != cicu:
            print("ICU-ARGS %r en=%s %s=%s" % (b["msgid"][:60], eicu, locale, cicu)); bad += 1
        if re.search(r"\bplural\s*,", b["en"] or ""):
            # Only the categories this locale selects; demanding all four would
            # report a missing `few` for German and Swedish. `catalog.test.ts`
            # checks argument names but not arm contents, so this is the only
            # check on the arms.
            for cat in cats:
                if not re.search(r"[{\s]%s\s*\{" % cat, tr):
                    print("PLURAL missing %s (%s selects %s): %r"
                          % (cat, locale, "/".join(cats), b["msgid"][:60])); bad += 1
            arms = dict(re.findall(r"(zero|one|two|few|many|other)\s*\{([^{}]*)\}", tr))
            if arms.get("many") is not None and arms.get("many") == arms.get("other"):
                # Not a failure: a few entries have no noun for the numeral to inflect
                # (an abbreviation, an invariant verb, a formatted list), so the
                # fraction and 5+ arms match. Reported so each can be confirmed.
                print("NOTE many==other (confirm it has no inflecting noun): %r -> %r"
                      % (b["msgid"][:50], tr[:90]))
    # Live entries only, matching the loop above: `index` holds obsolete
    # blocks too.
    live_in_target = sum(1 for (_ctx, _mid, o) in index if not o)
    extra = live_in_target - seen
    if extra:
        print("EXTRA: %s has %d live entries not present in en" % (locale, extra)); bad += 1
    print("%d problems (%s: %d entries checked, plural categories %s)"
          % (bad, locale, seen, "/".join(cats)))
    return 1 if bad else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: scripts/po_verify.py LOCALE")
    sys.exit(cmd_verify(sys.argv[1]))
