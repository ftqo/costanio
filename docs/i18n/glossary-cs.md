# Czech (`cs`) terminology glossary

The terminology, register and grammar conventions that `frontend/src/locales/cs/messages.po`
follows. The catalogue is written against this document and is internally consistent with
it, so changing a term here means a find-and-replace over the `.po`. Translator comments in
the catalogue cite its sections by number (`§3.2`, `glossary §17.3`); section numbers are
stable and have gaps where nothing applies.

Three things make Czech expensive here, in order of what they cost:

1. **The plural categories are four, and the two extra arms are not the Polish ones.**
   §4 is the specification.
2. **Seven cases**, with the seventh (vocative) unreachable from any catalogue entry and
   wanted by at least two frames. §11.
3. **Animacy**, which Polish has as well but Czech spends differently: masculine animate
   accusative singular equals the genitive, and the nominative plural palatalises
   (`hráč` → `hráči`, `divák` → `diváci`, `barbar` → `barbaři`). §3, §4.6.

---

## 1. Register decisions

Global, and they hold across every string.

### Form of address: **2nd person singular, informal, pronoun dropped**

Address the player as `ty` throughout, and write the pronoun only where the sentence needs
the emphasis.

| Option | What it is | Why not |
|---|---|---|
| `ty` (2sg) | „Nemáš dost surovin.“ | **Chosen.** Czech game and hobby UIs are `ty` almost without exception, and the source's register is informal. |
| `vy` (2pl honorific) | „Nemáte dost surovin.“ | Belongs to banks, e-shops and the tax office. Against a source that says "Jump into a table!" it is stiff, and Czech `vy` also collides with the genuine plural: several strings address *the table* rather than *the reader*, and under a `vy` register those become indistinguishable. |
| Impersonal / infinitive | „Nedostatek surovin.“ | Fine for a *label*, cold for a *sentence*. Used narrowly, below. |

Consequences the catalogue holds to:

- **Drop the pronoun.** Czech marks person on the verb, so `Nemáš dost surovin` is the
  natural sentence and `Ty nemáš dost surovin` is emphatic. The English `you` is not
  emphasis; it is grammar. Written pronouns appear only where the sentence contrasts
  (`hrát můžeš dál, jen nemůžeš psát`).
- **Possessives:** `tvůj / tvoje / tvé`, and reflexive **`svůj`** wherever the possessor is
  the subject (`Rozšiř svou osadu`, never `Rozšiř tvou osadu`). This is required in Czech
  and its absence is the commonest sign of a translation.
- `ty`, `tvůj` stay lower case mid-sentence. Capitalised `Ty`/`Tvůj` is correspondence
  style and reads as a mailshot inside a game UI.
- **`prosím` is not inserted.** English politeness markers do not map; a Czech UI that says
  `prosím` on every button reads as a machine.

### The no-gender rule (see §5)

**No string may inflect a verb or an adjective for the gender of a person the app cannot
identify.** That covers the reader (`you`) and every other player (`{player}`, `{other}`,
`{who}`, `{host}`, `{owner}`, `{curName}`, `{prev}`, `{names}`).

Forbidden in those positions:

- past-tense l-participles (`postavil` / `postavila`),
- predicate adjectives and short forms (`připraven` / `připravena`, `přihlášen` /
  `přihlášena`),
- `sám` / `sama`, `jistý` / `jistá`, and the like.

Left available, all gender-free:

- present tense, any person (`stavíš`, `staví`, `staví` pl),
- the analytic future with an infinitive (`budeš stavět`),
- reflexive and periphrastic passives (`bylo postaveno`, `staví se`),
- infinitives, imperatives, and nominal phrases (`nedostatek surovin`, `konec hry`).

In error copy this means recasting the past and the conditional impersonally:
`V tomto tahu už proběhly dva nákupy za zlato`, not `Už jsi koupil…`; `aby bylo místo`, not
`aby udělal místo`; `V tomto tahu už byla karta zahrána`.

### Surface register

| Surface | Register | Example |
|---|---|---|
| Buttons, tabs, menu items | **Perfective imperative** (Czech UI convention; the infinitive reads as a German calque) | `Ukonči tah`, `Kup`, `Ulož`, `Zrušit`* , `Připoj se` |
| Column headers, stat labels, chips | **Bare noun, nominative** | `Osady`, `Body`, `Kola` |
| Errors, toasts, confirmations, empty states | **Full sentence, 2sg, final period** | `Nemáš dost surovin.` |
| Board prompts (running hints under the board) | **Imperative, no final period**, matching the source, which drops it | `klepni na políčko` |
| Event-log lines | **Narrative present, 3sg, no final period** (§5) | `Iris staví město` |
| Card rule text | **Terse 2sg imperative** | `Posuň zloděje a vezmi si náhodnou kartu` |
| Rules manual, Support page | **Full sentences, 2sg, plainer and longer** | |

\* `Zrušit` is the one intentional infinitive: Czech UI convention has settled on the
infinitive for *cancel/close* specifically (it is what Windows, macOS and Android all ship
in Czech), and an imperative `Zruš` reads as an instruction to destroy something.

The four Explorers ship-panel buttons also stay infinitive, because the manual quotes them
(`„Naložit“`).

### Punctuation and typography

- **Quotation marks: `„…“`**: opening low double (U+201E), closing **left** double
  (U+201C). Not `"…"`, not `“…”`, and specifically not Polish's `„…”`.
- **No em dash.** A Czech parenthetical takes a spaced **en dash** (` – `, the *pomlčka*),
  a comma, a colon, or parentheses. Where the English uses `:` or `.` the Czech keeps it;
  where the English restructured a dash away, the Czech does not put one back.
- **Decimal comma, space as the thousands separator** (`1 450`, `12,5`). Only relevant
  where a number is written into the message text rather than formatted by `Intl`.
- **Non-breaking space after one-letter prepositions and conjunctions** (`k`, `s`, `v`,
  `z`, `o`, `u`, `a`, `i`) is correct Czech typography and the catalogue **does not use
  it**: a U+00A0 inside a `.po` is invisible to a translator, nothing in the pipeline
  preserves it visibly, and it would have to be maintained by hand across every entry. A
  CSS-level fix is a possible follow-up (`text-wrap: pretty` would
  not solve it: it balances a block's last lines and has no notion of a Czech orphan
  preposition).
- **Capitalisation.** Czech does not capitalise nouns, months, weekdays, nationalities or
  the interior words of a heading. Every English Title Case heading becomes sentence case:
  `Table settings` → `Nastavení stolu`, not `Nastavení Stolu`. The exceptions are proper
  names and the card titles (§8), which are names of objects and keep an initial capital.
- **Vocalised prepositions.** Czech vocalises a preposition before a like consonant:
  `ze zamíchaného balíčku`, never `z z-`.
- **`ě` is a letter, not `e` with a mark.** Relevant only to the font subset (§15).

---

## 2. Naming policy, and how to tell a coincidence from a leak

### 2.1 The rule

> Translate our English faithfully. Only the game title and the expansion names get our
> own words.

Our English already says `Master Merchant`, `Bishop`, `Warlord`, `Longest Road`,
`Year of Plenty`. Those are descriptive phrases. A Czech catalogue that avoids the obvious
Czech for `Bishop` in order to look different is less faithful than the source and buys
nothing.

The procedure: **translate our English word.** If the result matches a term Czech players
already use, that is a **coincidence** and it is correct. If a looser common alternative
exists, **keep the faithful one**.

### 2.2 Where the faithful word was chosen over a looser alternative

| Our English | Faithful Czech (ours) | Looser alternative | Why ours |
|---|---|---|---|
| Settlement | **osada** | vesnice | ours says *settlement*, not *village*. `osada` also gives a clean `Rozšiř osadu na město`, where `vesnice` → `město` reads as a village becoming a town. |
| Year of Plenty | **Rok hojnosti** | Vynález | ours says *Year of Plenty* |
| Brick | **cihla** | hlína | §3.2; `hlína` is our Clay terrain, so reusing it would collapse a terrain/resource split the source makes |
| Sheep | **ovce** | vlna | §3.2 |
| Wheat | **pšenice** | obilí | §3.2 |
| City wall | hradba | hradby | ours is singular, one per city |

Everything else in the core vocabulary (`město`, `cesta`, `rytíř`, `zloděj`, `karta rozvoje`,
`karta pokroku`, `Nejdelší cesta`, `Největší vojsko`, `vítězný bod`, `Monopol`, `Stavba cest`,
`ruda`, `dřevo`, `metropole`, `barbaři`, `přístav`) is simply the ordinary Czech word.

### 2.3 What diverges

| Ours | Czech | Note |
|---|---|---|
| the game's title | `Costanio` | The name as the catalogue writes it, occurrence for occurrence with the English; the domain `costan.io` is left alone. Not translated, not transliterated, and **not declined** anywhere, though Czech's instinct is to decline it (`Costania`, `Costaniu`): the app cannot apply that consistently, because the name also appears inside URLs and account labels. |
| `Islands` (expansion) | **`Ostrovy`** | The expansion name is our own; the Czech translates ours. |
| `Knights` (expansion) | **`Rytíři`** | Same. Ours is one noun and stays one. |
| `Fishermen` (scenario) | **`Rybáři`** | |
| `Caravans` (scenario) | **`Karavany`** | |
| `Harbormaster` (scenario) | **`Správce přístavu`** | also the 2-point card |
| `Rivers` (scenario) | **`Řeky`** | |
| `Raiders` (scenario) | **`Nájezdníci`** | |
| `Wagons` (scenario) | **`Vozy`** | |
| `Explorers` (scenario) | **`Objevitelé`** | |
| `Base` / `Base Game` | **`Základ`** / **`Základní hra`** | |
| `Scenarios` | **`Scénáře`** | |

---

## 3. Nouns: gender, animacy, case and plural pattern

Every countable game noun is listed with the five things the messages need: **gender**,
**animacy** where it is masculine, **nominative plural** (the `few` arm), **genitive
plural** (the `other` arm) and **genitive singular** (the `many` arm). Read §4 before
using them: **Czech's `other` is the genitive plural and its `many` is the fraction
arm**, which is the reverse of Polish.

Abbreviations: m-anim = masculine animate, m-inan = masculine inanimate, f = feminine,
n = neuter.

### 3.1 Core game nouns

| English | Czech | Gender | nom pl (`few`) | gen pl (`other`) | gen sg (`many`) |
|---|---|---|---|---|---|
| settlement | **osada** | f | osady | osad | osady |
| city | **město** | n | města | měst | města |
| road | **cesta** | f | cesty | cest | cesty |
| ship | **loď** | f | lodě | lodí | lodi |
| knight (piece) | **rytíř** | m-anim | rytíři | rytířů | rytíře |
| city wall | **hradba** | f | hradby | hradeb | hradby |
| hex / tile | **políčko** | n | políčka | políček | políčka |
| corner / junction / intersection | **křižovatka** | f | křižovatky | křižovatek | křižovatky |
| edge | **hrana** | f | hrany | hran | hrany |
| harbor / port | **přístav** | m-inan | přístavy | přístavů | přístavu |
| board | **hrací plán** | m-inan | plány | plánů | plánu |
| map | **mapa** | f | mapy | map | mapy |
| card | **karta** | f | karty | karet | karty |
| deck (pile) | **balíček** | m-inan | balíčky | balíčků | balíčku |
| die / dice | **kostka** | f | kostky | kostek | kostky |
| number token | **žeton** | m-inan | žetony | žetonů | žetonu |
| robber | **zloděj** | m-anim | zloději | zlodějů | zloděje |
| pirate | **pirát** | m-anim | piráti | pirátů | piráta |
| merchant (piece) | **kupec** | m-anim | kupci | kupců | kupce |
| barbarians | **barbaři** | m-anim, pl here | barbaři | barbarů | – |
| metropolis | **metropole** | f | metropole | metropolí | metropole |
| island | **ostrov** | m-inan | ostrovy | ostrovů | ostrova |
| caravan | **karavana** | f | karavany | karavan | karavany |
| fish | **ryba** | f | ryby | ryb | ryby |
| victory point | **vítězný bod** | m-inan | body | bodů | bodu |
| turn | **tah** | m-inan | tahy | tahů | tahu |
| round | **kolo** | n | kola | kol | kola |
| game (a match) | **hra** | f | hry | her | hry |
| table (a lobby/game) | **stůl** | m-inan | stoly | stolů | stolu |
| seat | **místo** | n | místa | míst | místa |
| player | **hráč** | m-anim | hráči | hráčů | hráče |
| opponent | **soupeř** | m-anim | soupeři | soupeřů | soupeře |
| spectator | **divák** | m-anim | diváci | diváků | diváka |
| bot | **bot** | m-anim | boti | botů | bota |
| host | **hostitel** | m-anim | hostitelé | hostitelů | hostitele |
| bank | **banka** | f | banky | bank | banky |
| supply (the stock) | **zásoba** | f | zásoby | zásob | zásoby |
| hand (of cards) | **ruka** | f | ruce | rukou | ruky |
| trade (an exchange) | **výměna** | f | výměny | výměn | výměny |
| trade offer | **nabídka** | f | nabídky | nabídek | nabídky |
| second (time) | **sekunda** | f | sekundy | sekund | sekundy |
| character (of text) | **znak** | m-inan | znaky | znaků | znaku |
| message | **zpráva** | f | zprávy | zpráv | zprávy |

**`políčko` and `pole`, which are the same word twice.** Czech `pole` (n) is both *a field*
and *a board square*. Our English uses `Field` for a terrain and `tile` for a board cell,
so this catalogue splits them: the **terrain** is `pole`, the **tile** is `políčko` (the
diminutive, which is what Czech board gaming says anyway). Do not collapse them; the map
builder has strings where both appear in one sentence. For the same reason `políčko` is
never used for a fish tile (§19: `rybí žeton`).

### 3.2 Resources and commodities

House rule: **translate our English word**. Our English separates the *terrain* from the
*resource* it pays, and Czech maps that split exactly:

| Terrain (our English) | Czech | Resource (our English) | Czech |
|---|---|---|---|
| Forest | les | Wood | **dřevo** |
| Clay | hlína | Brick | **cihla** |
| Pasture | pastvina | Sheep | **ovce** |
| Field | pole | Wheat | **pšenice** |
| Mountain | hory | Ore | **ruda** |
| Desert | poušť | – | – |
| Gold | zlato | Gold | **zlato** |
| Sea | moře | – | – |
| Lake | jezero | Fish | **ryba** |

| Resource | Czech | Gender | nom pl (`few`) | gen pl (`other`) | gen sg (`many`) |
|---|---|---|---|---|---|
| wood | **dřevo** | n | dřeva ‡ | dřev ‡ | dřeva |
| brick | **cihla** | f | cihly | cihel | cihly |
| sheep | **ovce** | f | ovce | ovcí | ovce |
| wheat | **pšenice** | f | pšenice ‡ | pšenic ‡ | pšenice |
| ore | **ruda** | f | rudy | rud | rudy |
| gold | **zlato** | n | zlata ‡ | zlat ‡ | zlata |
| cloth | **látka** | f | látky | látek | látky |
| paper | **papír** | m-inan | papíry ‡ | papírů ‡ | papíru |
| coin | **mince** | f | mince | mincí | mince |
| resource (generic) | **surovina** | f | suroviny | surovin | suroviny |
| commodity (generic) | **komodita** | f | komodity | komodit | komodity |

‡ **Mass nouns counted as cards.** `dřevo`, `pšenice`, `zlato` and `papír` are mass nouns
in ordinary Czech: *dvě dřeva* is as odd as *two woods*. In this game they are **cards**,
and Czech game-speak counts cards freely (`dvě cihly`, `tři dřeva`). The catalogue counts
them, because `2 karty dřeva` is longer, is not what a player says at a table, and would
collide with the messages that already say `karta`. This applies most to
`resource.count.*` and `card.bankLeft.*`, which should be read together. Gold's `other`
arm is the genitive plural `# zlat` everywhere, matching `resource.count.gold`.

**commodity = `komodita`, not `zboží`.** `zboží` is the ordinary Czech, but it is a neuter
mass noun with no count plural (`2 zboží` is not Czech), and the catalogue counts
commodities in many places (`2 komodity`, `5 komodit`). `komodita` is a live Czech word, it
counts cleanly, and it keeps the resource/commodity contrast the source draws. It is
faintly technical for a medieval setting; the alternative would be `{n} karty zboží`
throughout.

**cloth = `látka`, not `sukno`.** `sukno` is the better period word, but it is neuter and
its counted forms (`2 sukna`, `5 suken`) read oddly to a modern ear. Where cloth is a cost
the frame is instrumental: `platí se látkou` / `platí se mincí` / `platí se papírem`, one
frame for all three city-improvement headings.

The two standalone-label sets (`msgctxt "resource, standalone label"`,
`msgctxt "commodity, standalone label"`) are the **same words, lower case, nominative**.

### 3.3 The three improvement tracks

| Our English | Czech | Gender | nom | acc | gen |
|---|---|---|---|---|---|
| Trade | **Obchod** | m-inan | Obchod | Obchod | Obchodu |
| Politics | **Politika** | f | Politika | Politiku | Politiky |
| Science | **Věda** | f | Věda | Vědu | Vědy |

These three are the worst case trap in the catalogue: they appear as a bare label
(nominative), as the object of `Upgrade {track}` (accusative), and inside
`The {track} deck is empty` and `{metro} Metropolis` (genitive). The source splits all
three frames per track, so the Czech writes the case each frame governs (§11.1–11.5). The
track names keep their capital inside a sentence (`Balíček Obchodu`, `metropole Obchodu`,
`vylepšuje Obchod`): they are names.

---

## 4. Plural categories: the specification

Czech CLDR has four categories, and **the two that English does not supply are not the same
two Polish needs.**

| Category | CLDR rule | Selects for | Czech form after the numeral | Example |
|---|---|---|---|---|
| `one` | `i = 1 and v = 0` | exactly 1 | nominative singular | `1 karta` |
| `few` | `i = 2..4 and v = 0` | 2, 3, 4, **and nothing else** | nominative plural | `3 karty` |
| `many` | `v != 0` | **fractions only** (1,5; 0,5; 2,5) | **genitive singular** | `1,5 karty` |
| `other` | everything else | **0, 5, 6, … 22, 23, …** | **genitive plural** | `5 karet`, `0 karet`, `22 karet` |

### 4.1 Czech versus Polish

**In Polish, `many` is the 5+ arm and `other` is the fraction arm. In Czech it is the
other way round.** Czech `few` is also narrower: it is 2–4 and stops there, where Polish
`few` comes back round at 22, 23, 24. So:

| n | Polish arm | Czech arm |
|---|---|---|
| 3 | `few` | `few` |
| 5 | `many` | `other` |
| 22 | `few` | `other` |
| 1,5 | `other` | `many` |

Copying a Polish entry's arms into this file produces text that is wrong at 5 and at 22,
which is most of the numbers this app displays. Write every plural from the table above,
never from `pl/messages.po`.

### 4.2 `other` also covers zero

`0 karet`, not `0 karty`. English hides this because its zero takes the plural. Several
messages here can legitimately be zero (`# left in the deck`, `# open table right now`), so
this is not theoretical.

### 4.3 What it looks like in the file

```
msgid  "{0, plural, one {# card} other {# cards}}"
msgstr "{0, plural, one {# karta} few {# karty} many {# karty} other {# karet}}"
```

Two arms in, four arms out. The `#` stays `#`, the argument name stays `0`, no arm is
dropped, and `many` is **not** a copy of `other`.

### 4.4 Where `many` is unreachable, it is still written

Every count this app formats today is an integer, so the `many` arm never fires. It is
filled anyway, with the genitive singular, because an ICU message missing a category is a
runtime error in some implementations and a silent English fallback in others, and
because `catalog.test.ts` takes its required set of categories from `Intl.PluralRules`,
which lists `many` for `cs`. Nothing in the repo can catch a wrong `many`:
`Intl.PluralRules("cs")` never selects it for an integer.

### 4.5 The `#` is a formatted number, and Czech formats it with a space

`Intl.NumberFormat("cs")` renders 1 450 with a **narrow no-break space** as the group
separator. Nothing in the catalogue has to do anything about this; in a screenshot it is
not a typo.

### 4.6 Animacy in the arms

Masculine animate nouns take a palatalised nominative plural in the `few` arm (`2 hráči`,
`3 rytíři`, `4 diváci`, `2 boti`) and the ordinary genitive plural in `other`: `5 hráčů`,
`6 rytířů`. Czech has **no** virile complication of the Polish kind here: `2 hráči` is
simply correct and needs no genitive fudge.

`bot` is treated as **animate** (`2 boti`, `5 botů`). It is a machine, and a case could be
made for inanimate `2 boty`, except that `boty` is *shoes*, which settles it.

---

## 5. The event log, and the verb-gender problem

### 5.1 The problem

Most event-log entries have the shape `{player} <past-tense verb>`:

```
{player} built a settlement <0/>
{player} took the Longest Road
{player} discarded <0/>
```

Czech past tense is an l-participle and agrees with the subject's **gender**: *postavil*
(m), *postavila* (f), *postavilo* (n). A display name carries no gender and the app has no
gender field, so there is no correct Czech past tense for these lines. Defaulting to
masculine is wrong for half the players, on every line, all game.

### 5.2 The decision: narrative present

**Every event-log line is written in the present tense, 3rd person singular**, which is
gender-free in Czech:

| English | Czech |
|---|---|
| `{player} built a settlement <0/>` | `{player} staví osadu <0/>` |
| `{player} rolled <0/> <1>{total}</1> <2/>` | `{player} hází <0/> <1>{total}</1> <2/>` |
| `{player} took the Longest Road` | `{player} přebírá Nejdelší cestu` |
| `{player} lost a city to the barbarians.` | `{player} ztrácí město ve prospěch barbarů.` |

This is not a workaround dressed as a style: the narrative present (*praesens historicum*)
is the ordinary register for Czech play-by-play and match commentary, and a running game
log is exactly that. The alternatives are all worse: a masculine default; a `postavil(a)`
bracket form, which reads as a form; or a nominalisation (`{player}: postavena osada`),
which is a different register again.

### 5.3 Where the present will not stretch

Lines that describe a state that has already resolved take a **reflexive or periphrastic
passive**, which is also gender-free:

| English | Czech | Note |
|---|---|---|
| `{player} couldn't take a resource (Aqueduct: bank empty)` | `{player}: surovina se nedala vzít (Akvadukt: prázdná banka)` | |
| `{player} had no city left to give the barbarians` | `{player}: pro barbary nezbylo žádné město` | `nezbylo` agrees with `město` (n), not with the player |
| `{player} ended the game against the bots, in the lead` | `{player} končí hru proti botům ve vedení` | present holds |

### 5.4 The same rule outside the log

`You have already promoted a knight this turn.` is 2nd-person past and gendered
(*povýšil jsi* / *povýšila jsi*). Every one of these is restructured. In order of
preference:

1. **Present tense**: `You've already rolled this turn.` → `V tomto tahu už máš hod za
   sebou.`
2. **Reflexive passive**: `You have already promoted a knight this turn.` → `V tomto tahu
   se už jeden rytíř povyšoval.`
3. **Rule statement**: → `Za tah smíš povýšit jen jednoho rytíře.` A small meaning shift:
   it states the rule rather than what you did.

This applies to 2sg past participles in the rules manual as well (`nezahrál`, `jsi byl`,
`jsi zahrál` and the like are all gendered by the reader).

---

## 6. Aspect (the other verb decision)

Czech verbs come in perfective/imperfective pairs and the choice is meaning, not style.

- **Buttons and single commands: perfective**: `Postav`, `Kup`, `Ulož`, `Ukonči tah`,
  `Vyber kartu`, `Hoď`.
- **Ongoing or repeatable modes: imperfective**: `Stavěj` as a mode toggle, `Obchoduj` for
  the trading step, `Sleduj` for spectating.
- **Prohibitions: imperfective.** This is a hard rule in Czech: `Tady stavět nemůžeš`,
  never `Tady nemůžeš postavit`. The catalogue holds it in every `You can't…` error.
- **Event log: imperfective present**, per §5.

---

## 7. UI and system vocabulary

| English | Czech | Notes |
|---|---|---|
| lobby | **předsíň** | Not `lobby` (a hotel foyer, and unassimilated beside `žebříček`, `časomíra`, `fronta`, `prohlížeč`). `čekárna` was the other candidate and reads as a doctor's waiting room. |
| table (browser) | **stůl** / **stoly** | matches the source's "table" |
| join | **připoj se** | |
| leave | **opusť** | `Opusť stůl` |
| spectate / watch | **sleduj** | imperfective, it is ongoing |
| host (noun) | **hostitel** | |
| host (verb) | **založ stůl** | |
| seat (noun) | **místo** | `volné místo` = open seat |
| ready | **připraveno** / **připraveni** | never `připraven`/`připravena`; §1, §5. The two `Ready`s (a socket being up, and a player's badge) are rendered differently. |
| settings | **nastavení** | |
| ruleset | **sada pravidel** | |
| scenario | **scénář** | |
| expansion | **rozšíření** | |
| rematch | **odveta** | |
| draw (a tied game) | **remíza** | |
| draw (take a card) | **líznout si** / **lízni si** | the Czech card-playing verb; distinct from `remíza`. Never `táhnout`, which means pull or move. |
| play (a card) | **zahraj** | `zahraj kartu` |
| play (a game) | **hraj** | |
| discard | **odhoď** | |
| steal | **ukradni** / **vezmi si** | `ukrást` where it is theft (robber, Bishop), `vzít si` where the source says "take" |
| upgrade (settlement → city) | **rozšiř** | `Rozšiř osadu na město`. Distinct from the two below. |
| improve (a city track, the wagon) | **vylepši** | `Vylepši Vědu` |
| promote (a knight) | **povyš** | |
| activate (a knight) | **aktivuj** | |
| chase away the robber (knight action) | **Pronásleduj zloděje** | short form `Pronásleduj`; the manual uses the button's word |
| ranked | **hodnocená** (hra) | |
| casual | **přátelská** (hra) | |
| queue | **fronta** | |
| leaderboard | **žebříček** | |
| rating / ELO | **ELO** | kept as `ELO` in the column header |
| store | **Obchod** | shares its word with the Trade track (§3.3). `Krámek` was the alternative and is too cute. |
| decoration (cosmetic) | **ozdoba** | over `dekorace`, which reads as stage scenery |
| supporter | **podporovatel** | masculine agent noun. Czech has no short gender-neutral singular here, and `podporující osoba` will not fit a name decoration. |
| VP (the abbreviation) | **VB** | `vítězné body`. Two characters, same width as the English. |
| Pips (the currency) | **Pips** | product name, untranslated, undeclined |
| Booster | **Booster** | Discord's own label, untranslated |
| replay | **záznam** | |
| turn timer | **časomíra** | presets are feminine adjectives agreeing with it (`Blesková`) |
| auto-play | **automatický tah** | long; §12 |
| invite code / link | **kód pozvánky** / **odkaz pozvánky** | |
| private / public (table) | **soukromý** / **veřejný** | agrees with `stůl` (m-inan), safe |
| chat ban | **zákaz chatu** | |
| report (a message) | **nahlas** | |
| map builder | **editor map** | |
| brush / tool | **štětec** / **nástroj** | the water brush is `Voda`, declined in sentences that name it |
| paint (map builder) | **vybarvit** | one verb family for the one action, not `malovat`/`kreslit`/`natřít` |
| tile fill | **výplň** | |
| balanced (board) | **vyvážený** | agrees with `plán` (m-inan) |
| fair dice (lobby setting) | **Spravedlivé** | the manual uses the setting's word; the chapter title `Kostky a férovost` renders "fairness", not the mode name |
| browser (web) | **prohlížeč** | |
| board | **hrací plán** | the Czech board-gaming standard; shortened to `plán` only in tight labels where the surface is already about the board, since bare `plán` is also *a plan*. Not `deska`, `mapa`, `herní plán`. |
| turn steps | **Hod**, **Sběr**, **Obchod**, **Stavba** | all four are nouns |
| map names | translated | `Souostroví`, `Pobřeží (velké)`, `Čína`, … |

Recurring game terms:

| English | Czech | Notes |
|---|---|---|
| improvement track | **obor vylepšení**, **obor** | `obor` is a *discipline*, which is what the manual calls Trade/Politics/Science. Not `dráha vylepšení`, `linie vylepšení`, `disciplína`. The barbarian **track** is a different word, `dráha`. |
| event die | **kostka událostí** | `událostní kostka` is shorter but reads as a coinage. |
| route (a chain of roads and ships) | **trasa** | Not `cesta`, which is the road *piece*. The split is what makes `Nejdelší cesta` (base) and `Nejdelší obchodní trasa` (Islands) tellable apart, as the English has two names for the one award, and it keeps Caravans sentences true (a camel stands on an edge, `hrana`, beside a road). |
| piece (a playing piece) | **figurka** | `dílek` only for the Explorers cargo pieces, large and small |
| camel | **velbloud** | Caravans |
| fishing ground | **rybářský revír** | not `loviště` |
| land (generic terrain) | **souš** | Against `země`, which is also *country*, *ground* and *soil*. |
| land robber | **pozemní zloděj** (settings) / **zloděj na souši** (the pirate paragraph) | `pozemní zloděj` names a kind; the pirate paragraph contrasts it with `pirát` in the same clause |
| Defender token | **žeton Obránce** | the head noun `žeton` stays with the title |
| commodity cost heading | **platí se látkou / mincí / papírem** | §3.2 |
| development card deck | **Balíček karet rozvoje** | one name for the one pile |
| wagon trip | **jízda** | `cesta` is the road piece |
| movement points | **body pohybu** | |

---

## 8. The thirty card titles

Source: `art/cards/cards.json` and the `development card` / `progress card` contexts. Every
title is a noun or noun phrase in the **nominative**, initial capital only. They are drawn
in caps by CSS, in a subset face (§15).

### Development deck

| Our English | Czech | Gender | Rationale |
|---|---|---|---|
| Knight | **Rytíř** | m-anim | The ordinary word. |
| Victory Point | **Vítězný bod** | m-inan | Coincidence. |
| Road Building | **Stavba cest** | f | Verbal noun + genitive plural, which is how Czech names an activity. Coincidence. |
| Year of Plenty | **Rok hojnosti** | m-inan | Faithful: ours says "Year of Plenty", not *Invention* (`Vynález`). |
| Monopoly | **Monopol** | m-inan | Coincidence. |

### Trade deck

| Our English | Czech | Gender | Rationale |
|---|---|---|---|
| Commercial Harbor | **Obchodní přístav** | m-inan | |
| Master Merchant | **Mistr kupec** | m-anim | Czech apposition with `mistr` is idiomatic and productive (`mistr kuchař`, `mistr houslař`). `Velkokupec` is one word and means a *wholesaler*, which is a different claim. |
| Merchant | **Kupec** | m-anim | Also the name of the *piece*; the same word, as in the source. |
| Merchant Fleet | **Kupecká flotila** | f | `Obchodní flotila` is what a shipping line would say; `kupecká` matches `Mistr kupec`. |
| Resource Monopoly | **Surovinový monopol** | m-inan | Adjective rather than `Monopol na suroviny`: shorter and parallel with the next. |
| Trade Monopoly | **Obchodní monopol** | m-inan | Ours says *Trade*, so the Czech says *obchodní*. `Komoditní monopol` describes what the card **does**, which is a change to the source, not a translation of it. |

### Politics deck

| Our English | Czech | Gender | Rationale |
|---|---|---|---|
| Bishop | **Biskup** | m-anim | Coincidence. |
| Constitution | **Ústava** | f | Coincidence. |
| Deserter | **Dezertér** | m-anim | |
| Diplomat | **Diplomat** | m-anim | Spelled identically, so the entry is blank (§17.3). |
| Intrigue | **Intrika** | f | The abstract noun, matching ours; not `Intrikán` (the person). |
| Saboteur | **Sabotér** | m-anim | |
| Spy | **Špeh** | m-anim | `Vyzvědač` is the fuller word and four characters longer. |
| Warlord | **Vojevůdce** | m-anim | Ours is one word and so is this. `Válečník` is a *warrior*, not a warlord. |
| Wedding | **Svatba** | f | Czech `svatba` covers both the ceremony and the feast. |

### Science deck

| Our English | Czech | Gender | Rationale |
|---|---|---|---|
| Alchemist | **Alchymista** | m-anim | |
| Crane | **Jeřáb** | m-inan | Singular; the art is one treadwheel crane. `Jeřáb` is also a bird and a tree, and Czech lives with that. `Zvedák` is a car jack. |
| Engineer | **Inženýr** | m-anim | |
| Inventor | **Vynálezce** | m-anim | Ours is the **person**, and `Vynálezce` is unambiguous; not `Vynález` (*invention*). |
| Irrigation | **Zavlažování** | n | Verbal noun. |
| Medicine | **Medicína** | f | The discipline, not `Lék` (a drug). Ours is the discipline. |
| Mining | **Hornictví** | n | |
| Printer | **Tiskárna** | f | The *shop*, which is `Tiskárna`'s older and primary sense; the art is a press bed and a hung sheet. Not `Tiskař` (the man), not `Knihtiskárna`. |
| Road Building (Science) | **Stavba cest** | f | Same title as the development card, as in the source. |
| Smith | **Kovář** | m-anim | |

---

## 9. Interface actions (the button vocabulary)

Held uniform across the catalogue. Perfective imperative unless marked.

| English | Czech | Note |
|---|---|---|
| Roll | **Hoď** | |
| End turn | **Ukonči tah** | short form `Ukonči` for the narrow pill |
| Build | **Postav** / **Stavěj** (mode) | §6 |
| Buy | **Kup** | |
| Trade | **Vyměň** / **Obchoduj** (the step) | |
| Offer | **Nabídni** | |
| Accept | **Přijmi** | |
| Decline / Reject | **Odmítni** | |
| Counter-offer | **Protinabídka** (noun) | |
| Withdraw | **Stáhni** | |
| Cancel | **Zrušit** | the one intentional infinitive, §1 |
| Confirm | **Potvrď** | |
| Save | **Ulož** | |
| Delete | **Smaž** | |
| Clear | **Vyčisti** | |
| Undo | **Zpět** | |
| Close | **Zavřít** | infinitive, with Cancel |
| Back | **Zpět** | |
| Copy | **Kopírovat** | infinitive by Czech UI convention |
| Paste / Load | **Vlož** / **Načti** | |
| Send | **Odešli** | |
| Start | **Začni** | |
| Surrender | **Vzdej se** | |
| Equip | **Nasaď** | |
| Unlink | **Odpoj** | |
| Sign in | **Přihlas se** | |
| Sign out | **Odhlas se** | |

---

## 11. Case traps

Czech has seven cases and a display name arrives with none of them. This section records
what the source provides and what the Czech works around.

### 11.1–11.5 The per-value message families

The per-value message tables `src/locales/README.md` describes (`short.needOneMore.*`,
`error.NO_PIECES.*`, `board.metropolis.*`, `track.deckEmpty.*`, `track.draw.*`,
`harbor.receive.*`, `mapIssue.*`) let the Czech write the case each frame governs directly,
so none of them is a workaround:

- `short.needOneMore.wood` → `Potřebuješ ještě 1 dřevo.` (accusative, which for neuter
  equals the nominative, but `…1 cihlu.` and `…1 ovci.` show the frame really does govern)
- `error.NO_PIECES.road` → `Už nemáš žádné cesty.` (`nemáš` + genitive/accusative plural);
  each piece is its own sentence (`… žádné osady.`, `… žádná města.`, `… žádné lodě.`,
  `… žádné rytíře.`)
- `harbor.receive.brick` → `Obchodní přístav: odevzdej komoditu (dostaneš cihlu)`
  (accusative)
- `track.deckEmpty.science` → `Balíček Vědy je prázdný.` (genitive)
- `board.metropolis.science` → `Metropole Vědy` (genitive)
- the deck labels are split per deck (`Politics deck`, `Science deck`, `Trade deck`), so
  the Czech writes `Balíček Politiky` / `Balíček Vědy` / `Balíček Obchodu`.

**These families must never be merged back into a shared frame plus a word.**

### 11.6 The shapes that are already case-proof

`{name} has to be played before you roll.` (subject position, nominative), `Rozšíření:
{name}`, `{ratio}:1 {resource}`, `{track}: úroveň {lvl} z 5`, `{label}: {n}`, and every
`goodCount()` tally. The colon and the `×n` suffix cannot be governed, which is why
`src/locales/README.md` recommends them. A count before a noun the ICU message cannot
inflect is likewise a colon frame or a tally (`dřevo ×{woodCost}`).

The same applies to a resource name interpolated as `{name}`, which arrives capitalised and
in its nominative citation form (`Ovce`, `Pšenice`): it goes after a colon
(`O jednu míň: {name}`), not inside the verb phrase.

### 11.7 Display names in a governed position

`"{name}" will be removed from your library.` needs something to agree with, so the Czech
inserts the head noun: `Mapa „{name}“ bude odstraněna z tvé knihovny.` The colon form
covers the rest: `Tura: {curName}` → `Na tahu: {curName}`, `Stůl: {host}`, and the joined
name lists in trade offers (`Všichni odmítli`, `Odmítli: {declinedNames}`, `Čeká se na: {waitingNames}…`).

### 11.9 The vocative, which nothing can reach

Czech has a seventh case used **only** for addressing someone by name. Two surfaces want
it (the "your turn" nudge and the post-game "you won" line) and neither can have it,
because a vocative is not derivable from a nominative display name by rule (`Petr` →
`Petře`, `Jana` → `Jano`, `Nguyen` → nothing). Both are written to avoid addressing the
player by name at all. There is no per-string fix: it is a property of display names.

### 11.10 A blank is not free when the entry carries a plural

An empty `msgstr` falls back to the **English** catalogue, which has two arms. Czech then
selects a category (`few` at 3, `other` at 5) that the English entry does not define, and
ICU renders whatever its fallback rule reaches for. **No entry carrying an ICU plural is
left blank in this catalogue**, including the obsolete ones.

---

## 12. Length and overflow

Czech runs **roughly 10 % longer than English** on running text, shorter than Polish and
much shorter than German, because Czech drops the pronoun and the copula. The tail is
worse than the average, though: no compound splitting, and long inflected endings.

| Surface | English | Czech | Verdict |
|---|---|---|---|
| Improvement column | `Science` (7) | `Věda` (4) | fits |
| Improvement column | `Politics` (8) | `Politika` (8) | fits |
| Turn pill | `End turn` (8) | `Ukonči tah` (10) | tight; short form `Ukonči` (6) provided |
| Board action | `Promote` (7) | `Povyš` (5) | fits |
| Board action | `Activate` (8) | `Aktivuj` (7) | fits |
| Board action | `Move knight` (11) | `Přesuň rytíře` (13) | tight |
| Lobby filter | `Open seats` (10) | `Volná místa` (11) | fits |
| Button | `Leave & spectate` (16) | `Odejdi a sleduj` (15) | fits |
| Scoreboard column | `Longest Road` (12) | `Nejdelší cesta` (14) | **overflow risk** |
| Scoreboard column | `Largest Army` (12) | `Největší vojsko` (15) | **overflow risk** |
| Scoreboard column | `Defender of the Realm` (21) | `Obránce říše` (12) | shorter, fits |
| Stat tile | `Games played` (12) | `Odehrané hry` (12) | fits |
| Dev-deck header | `Copies` (6) | `Kusů` (4) | fits |
| Settings row | `Discard limit` (13) | `Limit karet v ruce` (18) | **overflow risk** |
| Empty state | `No open tables` (14) | `Žádné volné stoly` (17) | tight |
| Card title | `Master Merchant` (15) | `Mistr kupec` (11) | fits |
| Card title | `Commercial Harbor` (17) | `Obchodní přístav` (16) | fits, and both wrap |
| Toast | `Waiting for players to discard.` (31) | `Čeká se, až hráči odhodí karty.` (31) | fits |
| Knight legend | `Strength 1 knights` (18) | `Rytíři síly 1` (13) | fits |

The worst word in the catalogue is **`Nejdelší cesta`** in a scoreboard column sized for
`Longest Road`. There is no shorter faithful Czech: `Cesta` alone loses the superlative
that *is* the award. Measure length in the running app; character counts only say where to
look.

---

## 13. The rules manual

`routes/HowToPlay.tsx` contributes about 500 entries of connected prose across five tabs
and some sixty chapter anchors. Rules-manual entries carry a `# CHAPTER: <anchor>` comment
naming the `id:` of the chapter they render in, derived from the entry's own
`#: src/routes/HowToPlay.tsx:NNNN` line, so one chapter can be selected and read as prose:

```
grep -A4 '^# CHAPTER: ck-barbarians' frontend/src/locales/cs/messages.po
```

Read it **in order**, chapter by chapter, and against the UI strings it quotes: a rules
paragraph that is individually plausible and collectively incoherent is the failure mode,
and no per-string check finds it. Wherever the manual names a button, a setting or a
chapter, it uses the exact Czech that element carries (`Pronásleduj zloděje`,
`Spravedlivé`, `Kostky a férovost`, `Cíl hry`, `Tvůj tah`, `Základní hra`).

---

## 14. Checks

`scripts/po_verify.py cs` checks ids, ordering, parameters and tags against `en`. Beyond
that, the catalogue holds to: every ICU plural carries `one`, `few`, `many` and `other`;
`many` differs from `other` except where §16 says why not; no `msgstr` equals its own
`msgid` (those are the blanks in §17.3); and `npm run i18n:extract` is a no-op.

---

## 15. The card-title font

Card titles are drawn in `frontend/public/fonts/gelasio-titles.woff2`, which is subset to
exactly the characters the thirty card titles use across all catalogues.
`frontend/scripts/gen-title-fonts.py` walks every `messages.po` to derive that set. Czech
titles need letters no other locale's titles do (`č ď ě ň ř š ť ž ů ý` and their
capitals), so **renaming a card title, or changing a letter in one, means re-running the
generator**, never hand-subsetting:

```
uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py
uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py --check
```

`uvx` (or any environment with `fontTools` and `brotli`) is required: the system `python3`
has neither. The Latin source (`art/cards/tools/fonts/Gelasio-Bold.ttf`) is vendored, so no
network is needed for the face Czech uses. What the run rewrites is committed:
`frontend/public/fonts/*.woff2` and `frontend/src/lib/titleMetrics.json`.

**`npx vitest run` will not catch a stale font.** `cardTitle.test.ts` shells out to the
generator's `--check` and swallows the failure when `python3` lacks the modules, so a green
run is not evidence about the fonts. Read the `--check` output.

If the step is skipped, titles carrying the missing letters drop to a fallback face or draw
tofu, and the layout is wrong too: `cardTitle.ts` falls back to a fabricated `0.6` em
advance for any character with no entry in `titleMetrics.json`.

`frontend/src/lib/cardTitle.ts` needs no Czech-specific code. `titleFace()` falls through
to `latn`, which is right for `cs`, and `titleCase()` uses `toLocaleUpperCase(locale)`:
Czech has no locale-specific case mapping, and `ď`→`Ď`, `ů`→`Ů`, `ř`→`Ř` are the ordinary
Unicode mappings.

## 16. Plural arms by noun

The check that matters is **`many` must differ from `other`**, because they are the two
arms an author copying Polish would swap, and a swap is invisible until a player sees
`5 karty`. Nouns where the four arms are visibly distinct, and which therefore show the
rule:

| noun | `one` | `few` | `many` | `other` |
|---|---|---|---|---|
| karta | 1 karta | 3 karty | 1,5 karty | 5 **karet** |
| bod | 1 bod | 3 body | 1,5 bodu | 5 **bodů** |
| hráč | 1 hráč | 3 hráči | 1,5 hráče | 5 **hráčů** |
| město | 1 město | 3 města | 1,5 města | 5 **měst** |
| loď | 1 loď | 3 lodě | 1,5 lodi | 5 **lodí** |
| kolo | 1 kolo | 3 kola | 1,5 kola | 5 **kol** |
| sekunda | 1 sekunda | 3 sekundy | 1,5 sekundy | 5 **sekund** |
| políčko | 1 políčko | 3 políčka | 1,5 políčka | 5 **políček** |
| stůl | 1 stůl | 3 stoly | 1,5 stolu | 5 **stolů** |
| znak | 1 znak | 3 znaky | 1,5 znaku | 5 **znaků** |

For feminine and neuter nouns `few` and `many` are homographs (`karty`/`karty`,
`města`/`města`) and only `other` distinguishes itself. For masculines all four differ.

Two entries have `many == other`, correctly:

- `log.islandChip` (`+# VB`), where the abbreviation does not inflect;
- `log.goldOwed` (`Zlato: {names} si musí vybrat suroviny`), where all four arms are
  identical and cannot be otherwise: Czech `musí` is the same in 3sg and 3pl and
  `{names}` is a formatted name list, so nothing in the sentence varies with the count.

---

## 17. Deliberate blanks

### 17.3 Entries left blank on purpose

An empty `msgstr` falls back to the English catalogue at runtime. For the entries below
that English is also the correct Czech, and a `msgstr` equal to its own `msgid` is not
allowed, so blank is the right rendering. Each carries a `# NOTE: BLANK:` comment saying
why.

| Kind | Entries | Why |
|---|---|---|
| pure placeholders and punctuation | `{0}`, `{0} ({1} Pips)`, `{label}, {total}`, `{label}: {n}`, `{name}: {instruction}`, `{name} {level}/5`, `{nextReward}. {nextCost}`, `{ratio}:1 {resource}`, `2:1 {resource}`, `{resource} {num}`, `r{0}` | Czech punctuates and orders these exactly as English does |
| bare numbers and fixed labels | `+2`, `limit 2` … `limit 15`, `bonus`, `Beta`, `Menu` | identical in both languages |
| product and platform names | `Pips`, `Booster`, `cosmetic.decoration.kofi` (`Ko-fi`) | untranslated names |
| words Czech spells the same | `Bot`, `Diplomat` (the card title) | the Czech is the English |
| presence | `Online` / `Offline` | the Czech presence words are the English ones; `připojen` is a gendered short adjective, which §1 forbids for a person whose gender the app does not know |

Obsolete `#~` entries whose English was corrected are also left blank, so that a retired
claim is not carried into Czech. **No blank carries an ICU plural** (§11.10).

---

## 19. Scenario expansions

Register as §1, log in the narrative present (§5), plural arms per §4. Expansion names are
in §2.3.

| English | Czech | Note |
|---|---|---|
| harbour points | přístavní body | Harbormaster |
| coins | mince / mince / mincí | acc. sg. `minci` |
| bridge / bridge site | most / místo pro most | Rivers |
| swamp / ford | bažina / brod, brodit | |
| Wealthiest / Poorest Settler | „Nejbohatší osadník“ / „Nejchudší osadník“ | |
| raider | nájezdník | Raiders |
| rider | jezdec | |
| castle / prisoner / conquered / landing | hrad / zajatec / dobytý / vylodění | |
| Muster / Swift Rider / Treason / Intrigue | „Nábor“ / „Rychlý jezdec“ / „Zrada“ / „Intrika“ | |
| path (a board edge) | **hrana** | `trasa` stays the Longest Road chain |
| wagon | vůz | Wagons |
| plaza / spoke / trade hex | náměstí / paprsek / obchodní políčko | |
| quarry / glassworks | lom / sklárna | |
| marble / glass / tools / sand | mramor / sklo / nářadí / písek | |
| cargo / load / toll | náklad / náklad / mýtné | |
| Swift Journey | „Rychlá jízda“ | not `cesta`, which is the road |
| barbarian position (Wagons) | mezi políčky {a} a {b} / u políčka {a} / na pobřeží | labels stay nominative, in apposition |
| home island / home waters | domovský ostrov / domovské vody | Explorers |
| settler / crew | osadník / posádka | |
| fish haul / spice sack | úlovek / pytel koření | |
| spice farm / spice village | plantáž koření / vesnice koření | |
| Fast Gold / Pirate Bonus / Swift Voyage | „Rychlé zlato“ / „Pirátská prémie“ / „Rychlá plavba“ | |
| gold field (Explorers) | **zlatý důl** | `pole` is the Field terrain |
| shoal / pirate lair / Council | mělčina / pirátské doupě / Rada | |
| harbour settlement / hold / basin | přístavní osada / podpalubí / dok | |
| tribute | výpalné | |
| fish tile | rybí žeton | not `políčko`, which is a board hex |
| island bonus | body za ostrovy | |
| hex named by terrain: desert / lake / gold field | poušť / jezero / zlatý důl | lower case, mid-sentence |
| in supply | v zásobě | |
