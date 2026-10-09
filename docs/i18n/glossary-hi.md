# Hindi (`hi`) terminology glossary

The terminology, register and grammar conventions that `frontend/src/locales/hi/messages.po`
follows. Several entries are compromises explained here; read the relevant section
before changing one. Section numbers are stable.

---

## 1. Register: **आप**, with no exceptions

Every second-person form in the catalogue is आप, with आप verb agreement (imperatives in
-एँ: चुनें, रखें, डालें). `तुम` and `तू` are not used anywhere.

**The alternative** is तुम. A board game between friends is exactly the setting तुम exists
for, and a Hindi speaker playing with people they know would use it at the table.

**Why आप.** Modern Hindi software UI is overwhelmingly आप, and this text is software UI
before it is table talk: it includes error messages, a Terms page, a moderation flow and a
long rules manual. A register that reads warm in a trade prompt reads flippant in a ban
notice, and switching between them reads as a bug. आप is never wrong.

Changing it is a whole-catalogue rewrite, not a find-and-replace: verb agreement,
imperative endings and the possessive आपका/तुम्हारा all move together.

Tone, not pronoun, is softened where the English is curt: `error.FRAME_RATE_LIMITED` is
थोड़ा धीरे। rather than a bare धीरे।, and the chat placeholder uses नमस्ते rather than
the loan हाय.

---

## 2. Loanword register: how much English stays in Devanagari

Everyday computing and game nouns are kept as transliterated loans, and the domain
vocabulary is native Hindi:

| term | rendering | the alternative |
|---|---|---|
| card | कार्ड (loan) | पत्ता, पत्र |
| city | नगर (native) | शहर (also native, more colloquial) |
| knight | शूरवीर (native) | नाइट |
| table / seat group | टेबल (loan) | मेज़ |
| hex / tile | टाइल (loan) | षट्कोण, खंड |
| robber | डाकू (native) | लुटेरा |
| settlement | बस्ती (native) | गाँव |
| map | नक्शा | मानचित्र |
| bot | बॉट (loan) | स्वचालित खिलाड़ी |
| lobby, rating, ranked, pips | लॉबी, रेटिंग, रैंक्ड, पिप्स (loans) | |

A uniformly Sanskritic register (मानचित्र, पत्ता, मेज़, षट्कोण) is what a textbook or a
government form would use. The mixed register is what Hindi-speaking players actually read
on a screen: `नक्शा` is what the map builder's own audience calls a map; `मानचित्र` is
school geography. The rule applied throughout: native word where Hindi has a live
everyday one, loan where the concept arrived with the medium. That is why `कार्ड` is a
loan and `बस्ती` is not. Any change to this should be made as one decision across the
table, not per string.

---

## 3. Gendered verb agreement in the event log

Hindi perfectives agree with their subject's gender. `{player}` is a display name; its
referent's gender is unknowable at runtime, so there is no correct masculine-or-feminine
answer. Every log line uses one of three strategies, in order of preference:

1. **Object agreement.** Where the verb can agree with the *thing* instead of the player,
   it does: `{player} ने बस्ती बनाई` agrees with बस्ती (f.), not with the player. This
   covers most of the log. It is why `ले लिया` and `ले ली` appear on sibling lines: the
   objects differ in gender, so that inconsistency is correct.
2. **The honorific plural**, which is gender-neutral in Hindi: `{player} जीत गए`. Used
   where the verb must agree with the player. Some speakers read it as deferential
   rather than neutral; the alternatives are worse (a bare masculine misgenders roughly
   half the players, and recasting every line as a caption strips the log of its verbs).
3. **A colon recast**, where neither works: `गँवाया: {tally}`, `{player} की उपज: <0/>`.
   It reads as a caption rather than a sentence, which is the price.

`log.someone.subject` / `log.someone.object` exist so an inflecting language can write the
placeholder twice. Hindi uses कोई (direct) and किसी (oblique). किसी is ungrammatical
standing alone and only works because the frame supplies the postposition.

---

## 4. The oblique case

A Hindi noun before a postposition (को, से, में, पर, का/की/के) takes the oblique form,
which a frame holding a runtime value cannot produce: `सिक्का` → `सिक्के को`,
`कार्ड` → `कार्डों को`, `खिलाड़ी` → `खिलाड़ियों से`.

The per-item message families are therefore each **written whole in Hindi** rather than as
a shared frame plus a word:

- `card.holdNone.*`, `card.tradeTwoToOne.*`, `card.improveShort.*`, `card.allTheirs.*`:
  one full sentence per resource or commodity.
- `error.NO_PIECES.*`: one per piece, so बचा/बची splits correctly by gender (सड़क f.,
  बस्ती f. against नगर, जहाज़, शूरवीर m.).
- `harbor.receive.*`: one per resource, so ईंट/भेड़/लकड़ी take मिलती है and
  अयस्क/गेहूँ take मिलता है.

Do not merge these back into a single frame; that would silently break Hindi.

Where a frame still holds a runtime value in a governed position, the entry is recast to
avoid the postposition (a colon label, a copular sentence). Examples: `Trades {rate} with
the bank`, where `{rate}` arrives as a pre-built phrase ("2:1 wheat"); and
`log.robberBlocked`, where Hindi's verb-final order means the card chip and the trailing
`<1>on {num}</1>` cannot both sit beside the verb, so a comma introduces the trailing
phrase.

---

## 5. `पथ` for a city-improvement track

The Trade / Science / Politics tracks are `पथ`. `मार्ग` is the natural word, and it is
already spent: `सबसे लंबा व्यापार मार्ग` is Longest Trade Route, which appears on the same
screen as the Trade track in a Knights game. Two unrelated rules sharing one noun in that
context is worse than a second-choice word. The barbarian fleet's track is a third thing
again and is `रास्ता`.

---

## 6. The thirty card titles

These are baked into the shipped webfont subset (`notoserifdevanagari-titles.woff2`).
Changing one requires regenerating the font, or the card renders a tofu box:

```
uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py
```

| English | Hindi | note |
|---|---|---|
| Alchemist | रसायनज्ञ | |
| Bishop | धर्माध्यक्ष | the ecclesiastical office; बिशप is the loan |
| Commercial Harbor | वाणिज्यिक बंदरगाह | longest title |
| Constitution | संविधान | |
| Crane | क्रेन | the machine, not the bird |
| Deserter | भगोड़ा | |
| Diplomat | राजदूत | |
| Engineer | अभियंता | इंजीनियर is the loan |
| Intrigue | षड्यंत्र | |
| Inventor | आविष्कारक | |
| Irrigation | सिंचाई | |
| Knight | शूरवीर | same word as the expansion, as in English |
| Master Merchant | प्रधान व्यापारी | |
| Medicine | चिकित्सा | the practice, not the substance (दवा) |
| Merchant | व्यापारी | |
| Merchant Fleet | व्यापारी बेड़ा | |
| Mining | खनन | |
| Monopoly | एकाधिकार | |
| Printer | मुद्रक | the trade, not the device |
| Resource Monopoly | संसाधन एकाधिकार | |
| Road Building | सड़क निर्माण | |
| Saboteur | विध्वंसक | तोड़फोड़िया is closer but colloquial |
| Smith | लोहार | |
| Spy | जासूस | |
| Trade Monopoly | व्यापार एकाधिकार | |
| Victory Point | विजय अंक | |
| Warlord | सेनापति | सरदार is the warmer alternative |
| Wedding | विवाह | शादी is the everyday word |
| Year of Plenty | समृद्धि वर्ष | |

---

## 7. Punctuation: the danda `।`, and digits

A full Hindi sentence in prose (the rules manual, tooltips, log lines) ends in a danda. A
string ending in a Latin token, a number or a placeholder that reads as data ends in a full
stop. Short UI labels and buttons take no terminator, matching English. No string mixes
both. (Some modern Hindi software drops the danda for the full stop beside Latin numerals;
the catalogue takes the traditional line.)

**Western digits 0-9 throughout**, never Devanagari digits. The board draws Western number
chips, `Intl` formats every number, and a mixed catalogue is worse than either convention.

No em dashes. Nukta is encoded as base + U+093C, NFC stable, which is what the font subset
is built from.

---

## 8. `वस्तु` for commodity, and the three-way English vocabulary it cannot carry

English distinguishes **good** (the cover term), **resource** and **commodity**. Hindi has
two natural words: resource = संसाधन, commodity = वस्तु, and the cover term "good"
borrows वस्तु as well, so the Knights strings read as a resource/commodity pair rather than
as a cover term plus a member. `माल` was the alternative and carries commercial-shipping
register (it is used for Wagons cargo, §16).

The store's "item" then needed a third word and took **सामान**, so that the shop and the
commodity supply do not share a noun on the same screen. आइटम is the loan alternative.

---

## 9. Terrain names are kept distinct from resource names

`errorCopy.ts` and `progressCards.ts` name hexes rather than resources. So:
खेत (Field) against गेहूँ (wheat), मिट्टी (Clay) against ईंट (brick), जंगल (Forest)
against लकड़ी (wood), पहाड़ (Mountain) against अयस्क (ore), kept apart even inside one
sentence that uses both. `पहाड़ी` is reserved for the obsolete "hill" rows.

Other terrains: चरागाह (Pasture), रेगिस्तान (Desert), सोना (Gold), समुद्र (Sea),
झील (Lake), कोहरा (Fog), दलदल (Swamp), भूमि (Land).

---

## 10. Plurals: two arms, and Hindi's `one` selects at zero

Hindi selects `one` and `other`. `one` covers 0 as well as 1, unlike English. Every
plural-bearing entry is translated, never blank: a blank falls back to the English two-arm
entry, whose `one` arm is written for English's rule, and Hindi selecting it at n = 0
renders "0 card left".

The `one` arms are written to read correctly at zero. The main technique is an invariant
predicate: `बैंक में # ईंट शेष` rather than any finite बचा/बची/बचे, because शेष is inert in
gender and number and correct at both 0 and 1.

Where the noun is invariant (कार्ड, संसाधन) and number has to be marked on the verb inside
the arms, the argument is a pick cap that is never 0 today; a source change that admits 0
needs those arms rewritten.

`log.gaveCountTo`, `log.lostCards` and `log.tookCountFrom` wrap only the count in
`<0>…</0>`, so the Hindi verb sits outside the tag and cannot agree in number. Log lines
whose verb sits outside the counted span follow the same convention.

---

## 11. `शूरवीर` for both the Knights expansion and the knight piece

This mirrors the English: our English calls the expansion Knights and the piece a knight,
and only the expansion name is our own. Disambiguation
comes from context in both languages. `नाइट` for the piece would have split the two.

The other expansion names: Islands = द्वीप, Scenarios = परिदृश्य, Fishermen = मछुआरे,
Caravans = कारवाँ, Base Game = मूल खेल. The five later scenarios are in §16.

The knight's number: स्तर where the English says *level*, शक्ति where it says *strength*,
following the English per string. "Tier" is श्रेणी, because स्तर is spoken for.

---

## 12. Board geometry: `संधि-बिंदु` for a junction

The board vocabulary is टाइल (hex), किनारा (edge), संधि-बिंदु (junction, intersection).
`संधि-बिंदु` is a coinage: Hindi has no established word for a board-graph vertex. The
hyphen is U+002D, not U+2011. `कोना` is used only where the English says *corner*.

**आकार / आकृति / तट**, which the map builder forced apart: Hindi आकार covers both *shape*
and *size*, and the two are separate controls, so shape = आकृति, size = आकार. `Shores`
then could not be किनारे without colliding with किनारा for *edge*, and is तट.

---

## 13. `Fair` is two settings under one English word

Board number placement `Fair` = **संतुलित** (balanced: number spacing, pip totals). Dice
distribution `Fair` = **निष्पक्ष** (unbiased). Hindi has no word covering both.

Similarly **`random`** splits: card text uses बिना देखे ("without looking"), because
यादृच्छिक reads as statistics copy on a card face; bot descriptions use बेतरतीब ढंग से.

---

## 14. Coined abbreviations and narrow slots

Devanagari runs longer than English for the same content and the matras add vertical
extent, so the tight slots are the scoreboard columns, the trade-panel captions and the
event log.

- **व्याप.** for the `Merch` column and **महा.** for `Metro`. Both are coinages; Hindi has
  no conventional clipping for व्यापारी or महानगर.
- **प्रारंभिक व्यवस्था** for "Setup" is four syllables against English's two and lands in
  `log.setupGrant` and two clock-table rows. The loan सेटअप and the bare तैयारी were both
  rejected; व्यवस्था carries "laying pieces out", which is what the phase is.
- **`Move ship`'s short label** has no honest shorter form and is identical to its long
  form.

Measure length in the running app; character counts only say where to look.

Entries that differ only in English capitalisation are identical in Hindi. Devanagari
is caseless, so `ore`/`Ore`, `paper`/`Paper`, `no timer`/`No timer`, all-caps headings and
the `harbor`/`harbour` spelling pair collapse to one Hindi string. That repetition is
correct. Same for `Metropolises` against `Metropolis`: महानगर is invariant in the direct
plural.

---

## 15. Typography

- **Card titles use a `deva` face**: Noto Serif Devanagari, SIL OFL 1.1, both axes pinned
  (`wght=700`, `wdth=100`), fetched into a gitignored cache and pinned by sha256 in
  `frontend/scripts/title-fonts.lock.json`. `frontend/src/lib/cardTitle.ts` routes `hi`
  to it.
- It is the one title face that keeps its GSUB and GPOS tables. Devanagari needs GSUB
  to build conjuncts and reorder the i-matra, and GPOS to place the vowel signs.
- **No uppercasing.** Devanagari is caseless; `titleUppercases("hi")` is false.
- **No tracking.** `TITLE.devaTracking` is 0, because letter-spacing opens a visible gap in
  the shirorekha. A `:root:lang(hi)` `letter-spacing: normal` override in `index.css`
  covers the `.uppercase` / `.capitalize` / `.tracking-*` utilities. It does not reset
  `text-transform`: on Devanagari the transform is a no-op, and it still applies to Latin
  runs.

**Title measurement.** `cardTitle.ts` measures a title by summing per-glyph advances. For
Devanagari that over-estimates (conjunct substitution only ever narrows glyphs; by up to
about a third, e.g. धर्माध्यक्ष), so the fitter can wrap or shrink a Devanagari title a
step early but cannot overflow or crop one. The current titles all fit on one line at full
scale with comfortable headroom, and a test asserts that. Keep card titles short: a
title much longer than वाणिज्यिक बंदरगाह would be set one shrink step small.

**Body text.** The brand faces are subset to latin and latin-ext and hold no Devanagari, so
`:root:lang(hi)` falls through to the system: Noto Sans Devanagari, Nirmala UI, Kohinoor
Devanagari, Devanagari Sangam MN.

---

## 16. Scenario expansions

| English | Hindi | note |
|---|---|---|
| Rivers (expansion) | नदियाँ | plain plural; the river itself is नदी |
| Raiders (expansion), raider | हमलावर | the neutral enemy figure on a hex. लुटेरा was rejected: too close to डाकू (robber) |
| rider | घुड़सवार | the player's own figure on a path. Must never share a root with हमलावर, since the English pair is one letter apart |
| Wagons (expansion), wagon | छकड़े, छकड़ा | गाड़ी now reads as a car or train; बैलगाड़ी names the ox and is twice the width |
| Explorers (expansion) | खोजी | अन्वेषक is textbook register |
| Harbormaster (expansion and its card) | बंदरगाह प्रमुख | one name for both, as in English; the scoreboard column shortens to बंदरगाह |
| harbour points | बंदरगाह अंक | |
| path (a board edge, Raiders and Wagons) | किनारा | the established edge word. पथ is spent on the Knights improvement tracks and रास्ता on the barbarian fleet track |
| bridge, bridge site | पुल, पुल-जगह | bridge site is also the Rivers "crossing" |
| coin, coins | सिक्का, सिक्के | the existing commodity word, intentionally the same noun |
| Wealthiest / Poorest Settler | सबसे धनी / सबसे निर्धन प्रवासी | wealth tiles = धन टाइलें |
| settler (Explorers piece) | प्रवासी | same noun as the Rivers tiles, as in English. आबादकार is exact but rare |
| crew | दल | |
| fish haul, spice sack | मछली की खेप, मसाले की बोरी | |
| spice farm / spice village | मसाला बाग़ान / मसाला गाँव | two English words, kept as two |
| pirate lair, gold field, fish shoal | समुद्री डाकुओं का अड्डा, स्वर्ण क्षेत्र, मछलियों का झुंड | |
| harbour settlement | बंदरगाह बस्ती | a building, not a port, exactly as the English warns |
| the Council | परिषद | |
| Swift Voyage, Pirate Bonus, Fast Gold | तेज़ सफ़र, समुद्री डाकू बोनस, झटपट सोना | village names |
| movement point | चाल अंक | the Movement phase is चाल चरण |
| movement allowance | चाल की सीमा | `छूट` is a discount |
| tribute, toll | नज़राना, चुंगी | |
| castle | किला | both the Raiders centre hex and the Wagons trade hex |
| conquer (Raiders) | जीतना | not `कब्ज़ा करना` |
| quarry, glassworks, plaza, spoke | खदान, काँच कारख़ाना, चौक, तीली | Wagons; cargo = माल, the four cargoes काँच, औज़ार, संगमरमर, रेत |
| Wagons trade-hex fact lines | agree with the hex title | Quarry `खदान` is feminine (`लेती`/`लादती`) |
| a verb after `{cargo, select}` | inside each arm | `रेत` f., `औज़ार` pl. |
| cargo slot | खाना | |
| Muster, Swift Rider, Treason, Intrigue | भर्ती, तेज़ घुड़सवार, राजद्रोह, षड्यंत्र | Intrigue reuses the Knights card title |
| Swift Journey | तेज़ यात्रा | the Wagons card; kept apart from तेज़ सफ़र (the Explorers village) |
| prisoner | बंदी | |
| swamp | दलदल | |
| Explorers "attacker" at a lair | हमला करने वाला खिलाड़ी | never `हमलावर`, the raider |
| Defender of the Realm | राज्य का रक्षक | |
| friendly robber | मित्रवत डाकू | the setting's label |
| Generate, Preview (map builder) | जनरेट, पूर्वावलोकन | the loan for the button, the native noun for the view |

Further general terms:

| English | Hindi | note |
|---|---|---|
| deck | ढेर | not `गड्डी` |
| number chit | संख्या चिप | not `चिट` |
| fog | कोहरा | not `धुंध` |
| seed | बीज | the fairness-audit word; not `सीड` |
| production roll | उत्पादन रोल | |
| Move ship / move the robber (imperative) | ले जाएँ | log lines keep `खिसकाया` |

---

## 17. Deliberate blanks

Entries that are pure machinery are left blank and fall back to the English, which is the
right rendering and avoids a `msgstr` equal to its own `msgid`: `{0}`, `{label}, {total}`,
`{label}: {n}`, `{name}: {instruction}`, `{name} {level}/5`, `{ratio}:1 {resource}`,
`2:1 {resource}`, `r{0}`, the bare number `+2`, and the platform name
`cosmetic.decoration.kofi` (`Ko-fi`). No entry carrying an ICU plural is blank (§10).

A `{name}` that interpolates a resource (`msgctxt "resource"`, e.g. `भेड़` / `गेहूँ`)
arrives in its citation form, so it goes after a colon rather than inside the verb phrase:
`एक कम बोली: {name}`.
