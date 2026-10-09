# Contributing translations

Eighteen languages are live to players. English is the source; the other
seventeen are translations of it. This guide is for anyone who wants to improve
one: where the files are, what to read first, the conventions every catalogue
follows, and what to check before you open a pull request.

The catalogues live in `frontend/src/locales/<locale>/messages.po` (gettext,
managed with Lingui). `frontend/src/locales/README.md` holds the technical
conventions and pitfalls; `docs/i18n/glossary-<locale>.md` holds each language's
terminology, register and grammar decisions.

Fixing a single wrong string is a welcome contribution on its own. You do not
need to work through a whole language to open a pull request.

---

## Start with the glossary, not the catalogue

`docs/i18n/glossary-<locale>.md` records the choices the catalogue is built
on: the form of address, how each game term is rendered, how plurals and
grammatical case are handled, and which strings are left blank.
Read it before changing individual strings.

If you disagree with a terminology choice, change it everywhere at once. A
term usually appears in dozens of strings, so update the glossary and every
affected entry in the same pull request, and say in the description what you
changed and why. Hand-editing one occurrence leaves the catalogue inconsistent.

### Names: translate faithfully

Only two things get our own names: the game's title and the expansion titles
(Islands, Knights, and so on). Translate those from our
English like any other word.

Everything else (card names, resource names, building and piece names, mechanic
names such as Longest Road) is ordinary descriptive language. Translate our
English faithfully. If the natural word in your language for a card or a piece
is also the word other games use, that is correct. Do not substitute a less
natural noun to make it look different (a "village" for a settlement, a "path"
for a road); that makes the translation worse for no benefit.

### Punctuation

The English copy has a house rule of no em dashes in user-facing text. It is an
English style rule; follow your own language's typographic conventions, and
prefer whatever reads most naturally in short UI strings.

---

## Editing a catalogue

Each entry looks like this:

```
#. placeholder {0}: seatName(offer.by)
#: src/components/game/DrawOfferCard.tsx:52
msgctxt "the game ends level"
msgid "{0} offers a draw"
msgstr "{0} bietet ein Remis an"
```

- Change only `msgstr` (and its plural arms). `msgid`, `msgctxt`, the `#.`
  extracted comments and the `#:` references are generated from the source and
  must stay as they are.
- `msgctxt` names the sense when one English word covers two meanings ("draw"
  a card versus a drawn game). If a context reads ambiguously, that is a bug in
  the English source worth fixing in the same pull request.
- A blank `msgstr` falls back to the English at runtime. Some entries are blank
  on purpose because the only correct translation is a copy of the English
  (`{0}`, `Pips`, `2:1 {resource}`); the tests forbid a `msgstr` equal to its
  own `msgid`, so leave those empty.
- If you want to leave a note for the next translator, use a plain `#` comment
  line before any `msgctxt` line, never `#.`. The extractor regenerates `#.`
  lines on every run, and gettext rejects a comment between `msgctxt` and `msgid`.

### Length problems

Measure in the running app; do not count characters. Three facts about the
markup settle many apparent overflows:

- The post-game scoreboard wraps its labels in a `max-w-[150px]` block: it
  wraps and cannot clip.
- The victory-point columns sit inside `overflow-x-auto`, so they scroll rather
  than clip.
- `LocationDial` draws `seatLabel` only when the card art is missing, so its
  width matters only for a fallback most players never see.

Read the call site (the `#:` reference) before you measure, and measure before
you shorten.

### The rules manual

`routes/HowToPlay.tsx` contributes several hundred entries of connected prose.
Read it as prose, in order, in the app (the How to Play page), rather than
string by string: a terminology slip that is invisible in one string becomes
obvious when the same rule is stated twice in a chapter.

## When the English is wrong

If you find a problem in the English, verify it against `docs/rules/` and the
engine, then fix the English in your pull request. Do not translate around it.
Reading the rules manual as prose in another language has found rules stated
backwards, timers documented at the wrong value, and self-contradictory card text.

Changing an English string invalidates its translations. Most entries are keyed
by their English text, so `npm run i18n:extract` turns a rewritten string into a
new, blank entry in every locale. Entries with an explicit id (`error.*` and the
like) are different: the id does not change, so every locale keeps its old
translation under the new English and nothing marks it stale. When you rewrite
the English behind an explicit id, update or blank its translation in every
locale whose meaning moved. A stale translation is worse than a blank one,
because a blank falls back to the correct English and a stale one asserts
something that is no longer true.

---

## Checks before you open a pull request

From `frontend/`:

- `npm run i18n:extract` must be a byte-for-byte no-op afterwards. If it is
  not, the catalogue and the source have diverged.
- `npx vitest run src/locales src/lib/i18n.test.ts` runs the catalogue guards:
  placeholders, rich-text tags and ICU arguments match the English; every ICU
  plural carries every category the locale requires (Czech, Polish, Russian and
  Ukrainian each need more than English's two, with different rules for the
  `few` arm); no duplicate entries; no `msgstr` equal to its own message id; and
  every blank entry renders English.
- `npm run typecheck` and `npm test` for the full frontend suite (or
  `make gate-frontend` from the repo root). See the root `CONTRIBUTING.md` for
  the full gate.

From the repo root, optionally:

- `msgfmt -c -o /dev/null frontend/src/locales/<locale>/messages.po` (strict
  gettext syntax).
- `python3 scripts/po_verify.py <locale>` cross-checks the locale against
  English and reports missing or extra entries, placeholder and tag mismatches,
  missing plural arms and self-translations. Where a plural's `many` arm equals
  its `other` arm it prints a `NOTE` line to read, not a failure.

The automated checks look at structure, not at arm contents: a plural arm with
the wrong noun form passes every test, so read the arms.

---

## Merging

A `.po` is plain text, so git resolves it as plain text. When two branches each
translate the same entry, "keep both hunks" can leave the catalogue holding the
same `(msgctxt, msgid)` twice, once translated and once empty, with no conflict
marker. The compiler keeps one. The next `lingui extract` deduplicates and can
keep the empty one, losing the translation with no diff that looks like a
deletion.

Two safeguards:

- `catalog.test.ts` fails on any duplicate `(msgctxt, msgid)` in any
  catalogue, including `en`, so it fires at the first bad merge while both
  copies are still there to choose between.
- `scripts/i18n_lost_cells.py` reports entries that were non-empty at some
  past revision and are present but empty now. It is a worklist, not an
  assertion, since an entry is also correctly emptied when its English is
  rewritten. Run it after a wide merge and before regenerating the catalogues,
  which removes the evidence.

---

## Adding or releasing a language

`RELEASED_LOCALES` in `frontend/src/lib/i18n.ts` lists the languages players can
pick. A locale in `LOCALES` but not in `RELEASED_LOCALES` is in the bundle and
reachable with `?lang=<locale>`, but is not offered in the picker or inferred
from the browser, which is how a new language can be worked on before it ships.

To add a locale, add it to `LOCALES`, to `lingui.config.ts`, and to the
`var LOCALES` array in `frontend/index.html`. A locale missing from the second
silently compiles into English; one missing from the
third paints the first frame in the wrong language. `catalog.test.ts` and
`i18n.test.ts` assert all three agree. Add a `docs/i18n/glossary-<locale>.md`
alongside the catalogue.

---

## Reference

- `frontend/src/locales/README.md`: technical conventions and pitfalls.
- `docs/i18n/glossary-<locale>.md`: terminology, register and grammar.
- `docs/user-facing-text.md`: how user-facing text is produced and where.
- Root `CONTRIBUTING.md`: development setup and the full test gate.
