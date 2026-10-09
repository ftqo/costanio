# Message catalogues

One gettext `.po` file per locale. `@lingui/vite-plugin` compiles them on import,
so these files are the only catalogue artefact in the tree: nothing generated to
keep in sync, nothing to commit after a build. There is no `lingui compile` step
in `package.json` and `lib/i18n.ts` imports only `.po`; a compiled `messages.js`
in this tree is a mistake.

```
npm run i18n:extract        # rescan src/ and update every catalogue
```

Translators: start at `docs/i18n/CONTRIBUTING.md`, then the language's
`docs/i18n/glossary-<locale>.md`. This file is about the machinery.

Eighteen locales ship: `en` (the source), `zh-Hans`, `ja`, `de`, `es`, `fr`,
`pt-BR`, `it`, `nl`, `tr`, `uk`, `ru`, `pl`, `hu`, `cs`, `sv`, `hi`, `vi`.
`RELEASED_LOCALES` in `src/lib/i18n.ts` lists the ones offered in the picker
(`src/components/LanguagePicker.tsx`, in the site header and the lobby header);
today that is all of them.

## Checking a catalogue

`catalog.test.ts` and `src/lib/i18n.test.ts` are the guards that run in the
gate. One helper in `scripts/` also checks a catalogue; it is not part of the
build and nothing runs it for you:

- `scripts/po_verify.py <locale>` works on any locale: ids against `en`,
  placeholder/tag/ICU-argument agreement, plural arms against the categories
  that locale selects, no `msgstr` equal to its own `msgid`, and no blank entry
  carrying a plural. It keys lookups on `(msgctxt, msgid, obsolete)`, skips
  obsolete `#~` entries, and takes plural categories from `Intl.PluralRules` via
  node, with the same ceiling as `catalog.test.ts`. Keep it quiet on a clean
  tree.

## `en` is the source, and it can drift from the code

Every `msgstr` in `en/messages.po` should be the English written at the call
site. That is not automatic: `lingui extract` will not overwrite an existing
`msgstr` in the source locale without `--overwrite`, so a rewritten English
string leaves the old text in `en/messages.po` (which the app renders) with no
warning, and translators work from it.

Two things prevent it:

- `npm run i18n:extract` is `lingui extract --overwrite --clean`.
- `catalog.test.ts`'s `keeps en/messages.po saying exactly what the source code
  says` extracts into a temp directory and diffs every entry, catching a string
  edited with no extract run.

Re-run the extract after changing any user-facing string, then reconcile every
locale.

The extract is byte-for-byte reproducible on a clean tree. Lingui's
`orderBy: "message"` compares source text, then context, and stops, so entries
sharing both (the two "You don't hold that card." errors, the duplicated "Roll
the dice first." / "Move the robber first." / development-card lines) would come
out in worker-pool order. `lingui.config.ts` wraps the po formatter and re-sorts
with the message id as a final key.

A message missing from a translation falls back to English twice over: the
English catalogue is merged under every other locale at activation
(`src/lib/i18n.ts`), and the Lingui macro keeps the English source at the call
site as a default. A player never sees a message id.

## Comments in a catalogue

`#.` lines belong to the extractor: `lingui extract` regenerates them on every
run and deletes anything else there. A note for translators goes on a plain `#`
line, which survives.

That line goes before any `msgctxt` line, not between `msgctxt` and `msgid`.
Strict gettext (`msgfmt -c`) rejects the latter; `lingui compile` accepts it
silently.

## `lingui.config.ts` must list every locale

`lingui.config.ts` has its own `locales` list, separate from `LOCALES` in
`src/lib/i18n.ts`, because the app's bundle and the extractor's CLI cannot import
each other. A locale missing from the config's list does not error or warn:
`@lingui/vite-plugin` compiles its `.po` into a catalogue of English and serves
it under the locale's name.

`catalog.test.ts` asserts the two lists are identical (sorted), and
`i18n.test.ts` checks the third copy in `frontend/index.html`.

## Never interpolate a bare noun into a sentence, or put a count beside one

Both shapes are untranslatable and have to be fixed in the source.

**1. A bare noun in a frame.** `Take a {0}`, where `{0}` is a resource name. The
article, number and agreement follow from a noun that arrives at runtime, and
German and Spanish need different ones for different values (`kein Holz` but
`keinen Ziegel`; `un ladrillo` but `una oveja`).

**2. A count beside a noun.** `{n} {resource}`, `Costs {nextCost} {commodity}`,
`{left} {name} left in the bank`. German inflects the noun for the count (2
Ziegel, 2 Schafe), Spanish also agrees the article with its gender (2 ladrillos,
2 ovejas), the verb may agree too (`Queda # oveja`, `Quedan # ovejas`), and a
language with four plural categories needs four forms.

The fix for both is one message per card, with the noun written into the message
and the count as an ICU `plural` argument inside it, as `src/lib/cardPhrases.ts`
and `resource.count.*` in `src/lib/errorCopy.ts` do:

```ts
bankLeft.brick = (n) =>
  msg({
    id: "card.bankLeft.brick",
    message: plural(n, {
      one: "# brick left in the bank",
      other: "# bricks left in the bank",
    }),
  });
```

Each card and arm is then one translatable unit, and a locale writes the arms
its own grammar has. The same split is used in `short.needOneMore.*`,
`error.NO_PIECES.*` (the piece is the subject there, so it governs the verb's
number in Spanish and takes a case in German, Russian and Polish),
`board.metropolis.*` (a compound with a runtime first half), `track.deckEmpty.*`,
`track.draw.*`, `harbor.receive.*`, and the `mapIssue.*` eligibility sentences.

**3. A list or a name in a governed position.** There is nothing finite to split
into, so move it where nothing governs it: after a colon, as a label.

- `You are short of: {resources}`, not `You need more {resources}.`
- `Tied for strongest defender, each drawing a progress card: {players}`. A
  joined name list cannot be a grammatical subject; English gets away with a
  fixed plural verb only because there are always two or more, and a language
  with a dual does not.
- `{track}: level {lvl} of 5. Upgrade.` Leading every arm, the track name is
  nominative in all of them.
- `Barbarians. Step {at} of {dist}.` No noun for the numbers to attach to.

Three smaller shapes:

- **A missing plural arm.** `Safe up to {limit} cards` with no singular renders
  `up to 1 cards`.
- **An article outside the message.** `{player} played a <0/>` puts the article
  in the catalogue and the noun in a `<0/>` the translator cannot see. Leave the
  article out.
- **A pronoun with no antecedent.** `Places one at random`, where "one" refers
  to something two columns away, forces the gender to be guessed. Name the noun.

Where the text is a tally rather than prose (a price line, a trade summary, a
chip label, a log run), use `goodCount()` in `src/lib/cardFace.ts`, which writes
`Wood ×2`. A multiplier suffix has no agreement to get wrong, needs no catalogue
entry, and matches the icon-plus-`×n` the log and trade chips already draw. Use a
per-card message only where the count is inside a sentence.

Fix the English while you are there: `Take a wood`, `You hold no brick` and
`1 wood left in the bank` are not good English either. Split mass from count
(`Take wood` but `Take a brick`; `# wood` but `# brick` / `# bricks`), which is
the distinction Spanish needs anyway.

Write case in CSS, not in the string. A heading in capitals in the source
(`CHAPTERS`) forces every locale to shout. Write it in normal case and add the
`uppercase` class, which the CJK rule in `index.css` opts out of. Never call
`.toLowerCase()` on a translated string: JavaScript's case methods are
locale-invariant, so it lowercases German nouns and cannot produce the Turkish
dotless `ı`. Use a separate message.

## Intentionally blank entries

Some entries are blank in most locales because the only correct translation is a
copy of the English (`{0}`, `Pips`, `Booster`, `2:1 {resource}`,
`{nextReward}. {nextCost}`): a bare placeholder, a product name, a platform's own
label, a ratio, two sentences joined by a period. An empty `msgstr` falls back to
exactly that string, and it keeps the "a translation is never its own message
id" guard meaningful. `i18n.test.ts` proves, for every locale, that every blank
renders English rather than an empty string.

## Plurals

Chinese, Japanese and Vietnamese have one plural category (`other`); the work
English does with inflection is done by measure words (二**块**砖). The messages
are ICU `plural` throughout, which is category-driven, so one-category locales
and the four-category ones (`cs`, `pl`, `ru`, `uk`) need no code change.

`catalog.test.ts`'s `gives every ICU plural all the categories its locale can
reach` enforces the categories (the placeholder guard compares argument names
only). The required set comes from `Intl.PluralRules`: the categories the locale
selects for counts under ten thousand, plus `other`, which ICU always requires.
That matters for Polish, whose integers select only `one`, `few` and `many`. The
ten-thousand ceiling keeps `many` out of the required set for `es`, `fr`, `pt-BR`
and `it`, where CLDR defines it for compact millions only.

It is a superset check: a locale may add an explicit `=0` arm or an extra
category. It checks that an arm exists, not what is in it: Czech `many` (the
fraction arm) is never selected by an integer, so it is not required, and an arm
copied from a sibling language passes. Read the arms.

## Punctuation

No catalogue may contain an em dash, in any locale (`catalog.test.ts` checks
every file). Use the locale's own punctuation instead: Chinese and Japanese use
full-width marks (`。`, `、`, `：`, `（）`), and other languages a comma, colon or
parentheses.

## The legal pages are not translated

`routes/Terms.tsx` and `routes/Privacy.tsx` stay in English. The footer links and
browser titles are localized, so a player finds the page in their language and
reads the authoritative English text. A translation would need its own legal
review.

Do not extract the bodies of those two files. `routes/Support.tsx` is ordinary
product copy and is translated.

## `lib/chatTokens.ts` holds no messages

Its tables (`RESOURCE_WORDS`, `COMMODITY_WORDS`, `SHORT_FORMS`, `NUMBER_WORDS`)
are input vocabulary: they are matched against what a player typed into chat,
and the parser returns either the sender's text or a `res`/`com` token the log
renderer draws as an icon and a count. Nothing in the file is displayed.

Putting the tables through gettext would turn a translated `msgstr` into a
matching rule, and an untranslated one would fall back to English and keep
matching. Recognising other languages' trade slang is a change to this file's
data, with its own tests.
