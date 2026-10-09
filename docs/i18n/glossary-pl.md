# Polish (`pl`) terminology glossary

The terminology, register and grammar conventions the Polish catalogue
(`frontend/src/locales/pl/messages.po`) follows. The catalogue is written against this
document and is consistent with it, so changing a term here means changing every entry
that uses it.

Polish breaks three assumptions that two-form, caseless locales let a translator keep:

1. **Four plural categories.** Every message with a count needs `one`, `few`, `many` and
   `other`. §4 is the specification, including the rule most often got wrong (`other` is
   the *fraction* arm and takes the genitive singular, not a copy of `few`).
2. **Case.** A noun dropped into a sentence frame needs the case the frame governs. §11
   describes how the catalogue keeps placeholders out of governed positions.
3. **Verb gender.** Polish inflects the past tense and the predicate adjective for the
   subject's gender, and a display name carries none. §5 is the decision that makes the
   event log translatable.

---

## 1. Register decisions

Global, and they hold across every string.

### Form of address: **2nd person singular, informal, pronoun dropped**

**Address the player as `ty` throughout, and write the pronoun only where the sentence
needs the emphasis.**

| Option | What it is | Why not |
|---|---|---|
| `ty` (2sg) | "Nie masz dość surowców." | **Chosen.** |
| `Pan` / `Pani` (3sg honorific) | "Nie ma Pan dość surowców." | Belongs to banks, offices and airlines. Against a source that says "Jump into a table!" it is absurd, and it forces a gender choice (`Pan`/`Pani`) the app cannot make. |
| Impersonal / infinitive | "Brak surowców." | Fine for a *label*, cold for a *sentence*. Used narrowly, see below. |

Polish game and hobby UIs are `ty` almost without exception, and the chat box settles it:
a product with players talking to each other in a chat room cannot address them as `Pan`.

Consequences:

- **Drop the pronoun.** Polish marks person on the verb, so `Nie masz dość surowców` is
  the natural sentence and `Ty nie masz dość surowców` is emphatic ("*you* don't"). Written
  pronouns appear only where the sentence contrasts ("możesz grać dalej, tylko nie możesz
  pisać").
- **Possessives:** `twój / twoja / twoje / swój`. Reflexive `swój` wherever the possessor
  is the subject (`Ulepsz swoją osadę`, not `Ulepsz twoją osadę`). This is not optional in
  Polish and is the commonest tell of a translation.
- `ty`, `twój` stay lower-case mid-sentence. Capitalised `Ty`/`Twój` is correspondence
  style and reads as a mailshot inside a game UI.
- Hints shown on every player's seat card (not just the reader's) carry no 2sg.

### The no-gender rule (see §5)

**No string may inflect a verb or an adjective for the gender of a person the app cannot
identify.** That covers the reader (`you`) and every other player (`{player}`, `{other}`,
`{who}`, `{host}`, `{owner}`, `{curName}`).

This forbids, in those positions:

- past-tense verbs (`zbudował` / `zbudowała`),
- predicate adjectives and participles (`gotowy` / `gotowa`, `zalogowany` / `zalogowana`),
- `sam` / `sama`, `pewien` / `pewna`, and the like.

and it leaves these, all of which are gender-free:

- present tense, any person (`budujesz`, `buduje`, `budują`),
- future compound with the infinitive (`będziesz budować`, **not** `będziesz budował`),
- the impersonal `-no` / `-to` past (`zbudowano`, `wzięto`),
- infinitives, imperatives, and nominal phrases (`brak surowców`, `koniec gry`),

The rule does **not** reach the common noun `gracz`; see §5.5.

### Surface register

| Surface | Register | Example |
|---|---|---|
| Buttons, tabs, menu items | **Perfective imperative** (Polish UI convention; the infinitive is a Germanic calque) | `Zakończ turę`, `Kup`, `Zapisz`, `Anuluj`, `Dołącz` |
| Column headers, stat labels, chips | **Bare noun, nominative** | `Osady`, `Punkty`, `Rundy` |
| Errors, toasts, confirmations, empty states | **Full sentence, 2sg, final period** | `Nie masz dość surowców.` |
| Board prompts (running hints under the board) | **Imperative, no final period**, matching the source; `wskaż` for board taps | `wskaż pole` |
| Event log lines | **Narrative present, 3sg, no final period** (§5) | `Iris buduje miasto` |
| Card rule text | **Terse 2sg imperative** | `Przesuń złodzieja i weź losową kartę` |
| Rules manual, Support page | **Full sentences, 2sg, plainer and longer** | |

### Punctuation and typography

- **Quotation marks: `„…”`** (opening low, closing high). Not `"…"`, not `«…»`.
- **No em dash.** Polish sets a parenthetical with a **spaced en dash** (` – `, the
  *półpauza*), a comma, a colon, or parentheses. Where the English source uses `:` or `.`
  the Polish keeps it; where the English has restructured a dash away, the Polish does not
  put one back.
- **Decimal comma, space as the thousands separator** (`1 450`, `12,5`). Only relevant
  where a number is written into the message text rather than formatted by `Intl`.
- **Non-breaking space after one-letter words** (`w`, `z`, `i`, `o`, `a`, `u`) is correct
  Polish typography, but the catalogue does **not** use it: a non-breaking space inside a
  `.po` is invisible to an editor and would have to be maintained by hand across every
  entry. If it is ever done, it belongs at the CSS level; nothing in the app attempts it
  today.
- **Capitalisation.** Polish does not capitalise nouns, months, weekdays, nationalities,
  or the interior words of a heading. Every English Title Case heading becomes sentence
  case: `Table settings` → `Ustawienia stołu`, not `Ustawienia Stołu`. Headings the app
  draws in capitals get their caps from CSS, so the msgstr is sentence case (`Rozdziały`,
  `Rozmiar`, `Surowiec`). The exceptions are proper names and the card titles (§8), which
  keep an initial capital.

---

## 2. Naming policy

### 2.1 The rule

> **Translate our English faithfully. Only the game title and the expansion names diverge.**

Our English already says `Master Merchant`, `Bishop`, `Warlord`, `Longest Road`,
`Year of Plenty`. Those are descriptive phrases. A Polish catalogue that avoids the obvious
Polish for `Bishop` in order to look different is less faithful than the source, and
buys nothing.

So the procedure is: **translate our English word.**

- If the result matches a term Polish players already use, that is a coincidence and it
  is correct. `Bishop` → `Biskup` because `biskup` is what the word means.
- If a looser common alternative exists, **keep the faithful one.** `Year of Plenty` →
  `Rok obfitości`, not *Wynalazek* ("Invention"), which is not a translation of our English
  at all.

### 2.2 Where the faithful word was chosen over a looser alternative

| Our English | Faithful Polish (ours) | Looser alternative | Why ours |
|---|---|---|---|
| Longest Road | **Najdłuższa droga** | Najdłuższy szlak | ours says *road*, and `droga` is our word for it throughout |
| Year of Plenty | **Rok obfitości** | Wynalazek | ours says *Year of Plenty* |
| Brick | **cegła** | glina | §3.2; `glina` is our Clay terrain, so reusing it collapses a split the source makes |
| Sheep | **owca** | wełna | §3.2; our English and our art say *sheep* |
| Wheat | **pszenica** | zboże | §3.2 |
| City wall | mur miejski | mury miejskie | ours is singular per city |

Everything else in the core vocabulary (`osada`, `miasto`, `droga`, `rycerz`, `złodziej`,
`karta rozwoju`, `karta postępu`, `Największa armia`, `punkt zwycięstwa`, `Monopol`,
`Budowa dróg`, `metropolia`, `barbarzyńcy`, `towar`) is the ordinary Polish word.

Some renderings in circulation are not the ordinary Polish for the thing and are avoided:
`Drukarka` is a *printer peripheral*; `Dźwigi` pluralises a card title for no reason.

### 2.3 What diverges

| Ours | Polish | Note |
|---|---|---|
| the game's title | `costan` | Not translated, not transliterated, not declined. It is a product name. |
| `Islands` (expansion) | **`Wyspy`** | The expansion name is our own; the Polish translates ours. |
| `Knights` (expansion) | **`Rycerze`** | Same. Ours is one noun and stays one noun. |
| `Fishermen` (scenario) | **`Rybacy`** | |
| `Caravans` (scenario) | **`Karawany`** | |
| `Harbormaster` (scenario) | **`Kapitan portu`** | |
| `Rivers` (scenario) | **`Rzeki`** | |
| `Raiders` (scenario) | **`Najeźdźcy`** | |
| `Wagons` (scenario) | **`Wozy`** | |
| `Explorers` (scenario) | **`Odkrywcy`** | |
| `Base` / `Base Game` | **`Podstawa`** / **`Gra podstawowa`** | |

---

## 3. Nouns: gender, case and plural pattern

Every countable game noun is listed with the four things the messages need: **gender**,
**genitive singular** (the `other` plural arm and most negations), **nominative plural**
(the `few` arm), and **genitive plural** (the `many` arm). Read §4 before using them.

Abbreviations: m-inan = masculine inanimate, m-anim = masculine animate, m-pers =
masculine personal (the class that takes virile plurals), f = feminine, n = neuter.

### 3.1 Core game nouns

| English | Polish | Gender | gen sg (`other`) | nom pl (`few`) | gen pl (`many`) |
|---|---|---|---|---|---|
| settlement | **osada** | f | osady | osady | osad |
| city | **miasto** | n | miasta | miasta | miast |
| road | **droga** | f | drogi | drogi | dróg |
| ship | **statek** | m-inan | statku | statki | statków |
| knight (piece) | **rycerz** | m-pers | rycerza | rycerzy † | rycerzy |
| city wall | **mur** (miejski) | m-inan | muru | mury | murów |
| hex / tile | **pole** | n | pola | pola | pól |
| intersection | **skrzyżowanie** | n | skrzyżowania | skrzyżowania | skrzyżowań |
| corner (only where the English says *corner*) | **narożnik** | m-inan | narożnika | narożniki | narożników |
| edge (incl. *path* meaning a board edge) | **krawędź** | f | krawędzi | krawędzie | krawędzi |
| harbor / port | **port** | m-inan | portu | porty | portów |
| board | **plansza** | f | planszy | plansze | plansz |
| map | **mapa** | f | mapy | mapy | map |
| card | **karta** | f | karty | karty | kart |
| deck (pile of cards) | **talia** | f | talii | talie | talii |
| die / dice | **kostka** | f | kostki | kostki | kostek |
| number token | **żeton** (liczbowy) | m-inan | żetonu | żetony | żetonów |
| robber | **złodziej** | m-anim | złodzieja | złodzieje | złodziei |
| pirate | **pirat** | m-pers | pirata | piraci | piratów |
| merchant (the piece) | **kupiec** | m-pers | kupca | kupcy | kupców |
| barbarians | **barbarzyńcy** | m-pers, pl-only here | – | barbarzyńcy | barbarzyńców |
| metropolis | **metropolia** | f | metropolii | metropolie | metropolii |
| island | **wyspa** | f | wyspy | wyspy | wysp |
| camel / caravan | **karawana** | f | karawany | karawany | karawan |
| fish | **ryba** | f | ryby | ryby | ryb |
| victory point | **punkt zwycięstwa** | m-inan | punktu | punkty | punktów |
| turn | **tura** | f | tury | tury | tur |
| round | **runda** | f | rundy | rundy | rund |
| game (a match) | **gra** | f | gry | gry | gier |
| table (a lobby/game) | **stół** | m-inan | stołu | stoły | stołów |
| seat | **miejsce** | n | miejsca | miejsca | miejsc |
| player | **gracz** | m-pers | gracza | gracze † | graczy |
| opponent | **przeciwnik** | m-pers | przeciwnika | przeciwnicy † | przeciwników |
| spectator | **obserwator** | m-pers | obserwatora | obserwatorzy † | obserwatorów |
| bot | **bot** | m-anim | bota | boty | botów |
| host | **gospodarz** | m-pers | gospodarza | gospodarze † | gospodarzy |
| bank | **bank** | m-inan | banku | banki | banków |
| supply (the stock) | **zapas** | m-inan | zapasu | zapasy | zapasów |
| hand (of cards) | **ręka** | f | ręki | ręce | rąk |
| trade (an exchange) | **wymiana** | f | wymiany | wymiany | wymian |
| trade offer | **oferta** | f | oferty | oferty | ofert |
| second (time) | **sekunda** | f | sekundy | sekundy | sekund |
| character (of text) | **znak** | m-inan | znaku | znaki | znaków |
| message | **wiadomość** | f | wiadomości | wiadomości | wiadomości |

† See §4.5: for masculine-personal nouns the catalogue writes the **genitive** in the
`few` arm too (`2 graczy`, not `2 gracze`). Nominative plural is given here because it is
the citation form and because the noun appears bare in headers.

`krawędź` is the board edge everywhere; `ścieżka` and `trasa` are kept for a *chain of
roads* (`najdłuższa pojedyncza ścieżka`), so the two never collide. `w zapasie` is "in
supply".

### 3.2 Resources and commodities

**Translate our English word.** Our English separates the *terrain* from the *resource* it
pays, and Polish maps that split exactly:

| Terrain (our English) | Polish | Resource (our English) | Polish |
|---|---|---|---|
| Forest | las | Wood | **drewno** |
| Clay | glina | Brick | **cegła** |
| Pasture | pastwisko | Sheep | **owca** |
| Field | pole uprawne | Wheat | **pszenica** |
| Mountain | góry | Ore | **ruda** |
| Desert | pustynia | – | – |
| Gold | złoto | Gold | **złoto** |
| Sea | morze | – | – |

A hex named by its terrain mid-sentence is lower case: `pustynia`, `jezioro`, `złoże
złota`.

| Resource | Polish | Gender | gen sg (`other`) | nom pl (`few`) | gen pl (`many`) |
|---|---|---|---|---|---|
| wood | **drewno** | n | drewna | drewna | drewien ‡ |
| brick | **cegła** | f | cegły | cegły | cegieł |
| sheep | **owca** | f | owcy | owce | owiec |
| wheat | **pszenica** | f | pszenicy | pszenice ‡ | pszenic ‡ |
| ore | **ruda** | f | rudy | rudy | rud |
| gold | **złoto** | n | złota | – ‡ | – ‡ |
| cloth | **tkanina** | f | tkaniny | tkaniny | tkanin |
| paper | **papier** | m-inan | papieru | papiery ‡ | papierów ‡ |
| coin | **moneta** | f | monety | monety | monet |

‡ **Mass nouns counted as cards.** `drewno`, `pszenica`, `złoto` and `papier` are mass
nouns in ordinary Polish, but in this game they are **cards**, and Polish game-speak counts
cards freely (`dwie cegły`, `trzy drewna`). The catalogue counts them, because the
alternative (`2 karty drewna`) is longer, is not what a player says at the table, and would
collide with the messages that already say `karta`. Gold is `N złota`, never `N złotymi`
(which reads as the currency).

**cloth = `tkanina`, not `sukno`.** `sukno` is the better period word, but its genitive
plural `sukien` reads as *dresses*, and that is the `many` arm shown on every supply
readout.

The two standalone-label sets (`msgctxt "resource, standalone label"`,
`msgctxt "commodity, standalone label"`) are the **same words, lower case**, in the
nominative. `msgctxt "a resource, unnamed, standalone label"` is `surowiec` (nominative),
because it is an item in a colon list. `msgctxt "resource"` is capitalised (`Owca`,
`Pszenica`).

### 3.3 The three improvement tracks

| Our English | Polish | Gender | acc sg | gen sg |
|---|---|---|---|---|
| Trade | **Handel** | m-inan | handel | handlu |
| Politics | **Polityka** | f | politykę | polityki |
| Science | **Nauka** | f | naukę | nauki |

The ladder itself is a **`tor`** / **`tor ulepszeń`** (the English says *track* throughout,
including the Crane's `city-improvement track`); `dziedzina` is not used.

The track names appear as a bare label (nominative), as the object of `Upgrade`
(accusative) and as a possessor (genitive). The source writes one message per track for
each governed frame, and the Polish writes the case each frame needs:

| Frame | id | Polish |
|---|---|---|
| deck empty | `track.deckEmpty.science` | `Talia Nauki jest pusta.` (genitive) |
| draw a card | `track.draw.science` | `Dobierz kartę postępu Nauki (…)` (genitive) |
| metropolis name | `board.metropolis.science` | `Metropolia Nauki` (genitive) |
| metropolis earned | `track.metroEarned.science` | `Zdobyta metropolia Nauki. …` |
| deck aria label | `deck.aria.science` | `Talia Nauki` / `Talia Polityki` / `Talia Handlu` |

`{track}: level {lvl} of 5. Upgrade.` leads with the track name and is nominative:
`{track}: poziom {lvl} z 5. Ulepsz.`, with `Ulepsz kartą Dźwig.` for the Crane variant
(the card title stays nominative after `kartą`).

---

## 4. Plural categories: the specification

Polish CLDR has four categories. **All four are filled in every ICU `plural` message in
the catalogue, including the ones whose English source has only two.**

| Category | Selects for | Polish form after the numeral | Example |
|---|---|---|---|
| `one` | exactly 1 | nominative singular | `1 karta` |
| `few` | 2, 3, 4, 22, 23, 24, 32… (n%10 ∈ 2–4, n%100 ∉ 12–14) | nominative plural | `3 karty` |
| `many` | 0, 5–21, 25–31… everything else integral | **genitive plural** | `5 kart`, `0 kart`, `12 kart` |
| `other` | **fractions only** (1.5, 0.5, 2.5) | **genitive singular** | `1,5 karty` |

### 4.1 The `other` arm

`other` is not "the default" in Polish and it is not a copy of `few`. It is reached only
by a non-integer, and Polish puts a non-integer count in the **genitive singular**: *1,5
karty*, *2,5 punktu*. Writing `other` as a copy of `few` is invisible in this app (every
count it formats is an integer today) and is still wrong. Where a message's count cannot
be fractional, the arm is still filled, because an ICU message with a missing `other` is a
runtime error in some implementations and a silent English fallback in others.

### 4.2 `many` also covers zero

`0 kart`, not `0 karty`. English hides this because its zero takes the plural; Polish's
zero takes the genitive plural, which is the `many` arm. Several messages can legitimately
be zero (`# left in the deck`, `# open table right now`).

### 4.3 What this looks like in the file

```
msgid "{0, plural, one {# card} other {# cards}}"
msgstr "{0, plural, one {# karta} few {# karty} many {# kart} other {# karty}}"
```

Two arms in, four arms out. The `#` stays `#`, the argument name stays `0`, and no arm is
dropped. `frontend/src/locales/catalog.test.ts` fails on any ICU plural missing a category
its locale can reach.

### 4.4 `few` is the nominative plural

Polish `few` (2, 3, 4, 22, 23, 24 …) takes the **nominative plural**: *2 punkty*,
*2 statki*, *2 surowce*, *22 surowce*. It does **not** take the genitive singular, which
is the Russian rule (*2 punkta*), and it is not `many` repeated.

The error is invisible on most of the vocabulary: for feminine and neuter nouns the
nominative plural and the genitive singular are the same word (*karty*, *miasta*), so only
the **masculine** nouns show the difference: `punkt`, `statek`, `surowiec`, `stół`,
`port`, `papier`, `znak`, `gracz`.

`other`, by contrast, **is** the genitive singular: *1,5 punktu*, *2,5 statku*.

### 4.5 Masculine-personal nouns in `few`

Polish numerals 2–4 with **male persons** properly take a virile form: *dwaj gracze* or
*dwóch graczy*, not *dwa gracze*. With an Arabic digit in front, `2 graczy` is what gets
written in practice and `2 gracze` is also seen. **The catalogue writes the genitive in
the `few` arm for masculine-personal nouns** (`gracz`, `przeciwnik`, `obserwator`,
`gospodarz`, `pirat`, `kupiec`, `najeźdźca`, `jeździec`), so `few` and `many` are identical
there, uniformly.

`rycerz` is treated as **personal** too (`2 rycerzy`): in the messages it almost always
appears as the object of a verb (`aktywuje 2 rycerzy`), where the accusative equals the
genitive for this class anyway.

### 4.6 Identical arms that are correct

An identical arm pair is worth suspecting, because it is what a two-arm entry looks like
after somebody pads it out. In this catalogue the identical pairs all have a reason:

**`many == other`** happens only for invariant text or a mass noun with no usable genitive
plural, because Polish's `other` (genitive singular) and `many` (genitive plural) are
different words for every noun that has both:

| Entry | Both arms | Why identical |
|---|---|---|
| `resource.count.gold` | `# złota` | `złoto` has no usable genitive plural (*złót*), so the genitive singular serves both |
| `log.islandChip` | `+# PZ` | `PZ` is an abbreviation and does not inflect |
| `log.goldOwed` | `Złoto: {names} muszą wybrać surowce` | the count never appears in the arm text |

**`few == many`** happens for three reasons:

1. **Masculine-personal nouns** (§4.5): `# graczy`, `# rycerzy`, `# pierwszych posiadaczy
   towaru`.
2. **A governing preposition or verb that takes the genitive whatever the number**: the
   `do # znaków` limits, `Bezpiecznie do # kart`, `Potrzeba # tkanin / monet / papierów`.
   After `do` and `potrzeba` the noun is genitive plural because the preposition or verb
   put it there, not the numeral.
3. **Invariant text or a mass noun**, as in the table above.

### 4.7 Agreement beyond the noun

Some messages need a form change English does not have: the verb (`trwa # gra` / `trwają
# gry`), the participle (`wliczony` / `wliczone`, `kupiona` / `kupione`), or the object
case in the `one` arm alone (`Oddaj bankowi # cegłę` against `# cegły`).

Polish `wszystkie` cannot agree with a singular, so where the English says *all 1 card*
the `one` arm drops the quantifier (`Wybrano już 1 kartę`) and only the other three carry
it.

Movement is counted in `punkty ruchu` (`3 punkty ruchu`, never `3 ruchu`). A count before
a noun the ICU message cannot inflect becomes a colon frame (`Kup surowiec za monety:
{price}`).

---

## 5. The event log, and the verb-gender problem

### 5.1 The problem

Many catalogue entries have the shape `{player} <past-tense verb>`:

```
{player} built a settlement <0/>
{player} took the Longest Road
{player} discarded <0/>
```

Polish past tense agrees with the subject's **gender**: *zbudował* (m), *zbudowała* (f),
*zbudowało* (n). A display name carries no gender and the app has no gender field, so
there is no correct Polish past tense for these lines. Defaulting to masculine is wrong for
half the players, every line, all game. (German `hat gebaut` and Spanish `ha construido`
do not agree with the subject, so those locales do not meet this.)

### 5.2 The decision: narrative present

**Every event-log line is written in the present tense, 3rd person singular**, which is
gender-free in Polish:

| English | Polish |
|---|---|
| `{player} built a settlement <0/>` | `{player} buduje osadę <0/>` |
| `{player} rolled <0/> <1>{total}</1> <2/>` | `{player} rzuca <0/> <1>{total}</1> <2/>` |
| `{player} took the Longest Road` | `{player} przejmuje Najdłuższą drogę` |
| `{player} lost a city to the barbarians.` | `{player} traci miasto na rzecz barbarzyńców.` |

The narrative present (*praesens historicum*) is the ordinary register for Polish
play-by-play and match commentary, which is what a running game log is.

### 5.3 The present tense stretches to resolved states

Lines that describe something already resolved still take the narrative present, because
it is gender-free; do not recast them as `{player}: <impersonal clause>`, which breaks the
log's rhythm:

| English | Polish |
|---|---|
| `{player} couldn't take a resource (Aqueduct: bank empty)` | `{player} nie może wziąć surowca (Akwedukt: bank pusty)` |
| `{player} had no city left to give the barbarians` | `{player} nie ma już miasta dla barbarzyńców` |
| `{player} ended the game against the bots, in the lead` | `{player} kończy grę z botami, na prowadzeniu` |

Reach for the impersonal `-no`/`-to` only when the sentence has to be a past
tense (§5.4). Where a present-tense verb states the same fact, use it.

### 5.4 The same rule outside the log

`You have already promoted a knight this turn.` is 2nd-person past and gendered
(*awansowałeś* / *awansowałaś*). The catalogue restructures every one of these. The usual
moves, in order of preference:

1. **Present tense**, where a present verb states the same fact.
2. **Impersonal past**: `You have already promoted a knight this turn.` → `W tej turze
   awansowano już rycerza.` Also `W tej turze karta została już zagrana`, `W tej turze dwa
   zakupy za złoto już zostały wykonane`.
3. **Rule statement**: → `Na turę można awansować tylko jednego rycerza.` (a small
   meaning shift: it states the rule rather than what you did).

A phrase with no agreement at all works too: `error.PAUSED` says `Nie masz z tym nic
wspólnego.`

### 5.5 The rule does not reach the noun `gracz`

The no-gender rule bans a past tense whose subject is a **display name** (`{player}`,
`{host}`, `{owner}`). It does **not** ban a past tense whose subject is the common noun
`gracz`. There the verb agrees with the *noun*, which is masculine for every player alike,
and `gracz, który zbudował` is what Polish writes about a woman too, exactly as `każdy
gracz zbiera` is. Examples in the catalogue:

- `łącznie z graczem, który właśnie zbudował` (not an invented noun such as `autor`).
- `Gracz, który stawiał ostatni, stawia więc dwa razy z rzędu` (#base-setup).
- `przypada graczowi, który właśnie skończył turę`.
- The Caravans vote trigger, `po każdej turze, w której aktywny gracz zbudował osadę lub
  rozbudował ją`: the perfective past, because the trigger fires on a completed build.

### 5.6 Possessives become colon labels

A display name cannot be inflected into the genitive, so `{curName}'s turn` and
`{host}'s table` become colon labels: `Tura: {curName}`, `Stół: {host}`. Polish UIs use
exactly this shape for a name that cannot be inflected.

---

## 6. Aspect (the other verb decision)

Polish verbs come in perfective/imperfective pairs and the choice is meaning, not style:

- **Buttons and commands: perfective**, a single completed act. `Zbuduj`, `Kup`,
  `Zapisz`, `Zakończ turę`, `Wybierz kartę`, `Rzuć`.
- **Ongoing/repeatable modes: imperfective**: `Buduj` as a *mode toggle* (keep building),
  `Handluj` for the trading step, `Obserwuj` for spectating.
- **Prohibitions: imperfective**, which is a hard rule in Polish. `Nie możesz **budować**
  w tym miejscu`, never *nie możesz zbudować*. Held in every `You can't…` error.
- **Event log: imperfective present**, per §5.

---

## 7. UI and system vocabulary

| English | Polish | Notes |
|---|---|---|
| lobby | **poczekalnia** | Not `lobby` (a hotel foyer, and an unassimilated borrowing). Also in prose. |
| table (browser) | **stoły** | The lobby lists `stoły`, matching the source's "table". |
| join | **dołącz** | |
| leave | **opuść** | `Opuść stół` |
| spectate / watch | **obserwuj** | imperfective, it is ongoing |
| host (verb/noun) | **gospodarz** / **utwórz stół** | Long, see §12 |
| seat (noun) | **miejsce** | `wolne miejsce` = open seat |
| ready (player is ready) | **Gotowość** | The noun *readiness*; the adjective `gotowy`/`gotowa` is gendered. `Gotowe` (neuter) where the referent is a thing, e.g. the connection or a finished step. |
| settings | **ustawienia** | |
| ruleset | **zestaw zasad** | |
| scenario | **scenariusz** | |
| expansion | **dodatek** | |
| rematch | **rewanż** | |
| draw (a tied game) | **remis** | Distinct from `dobierz` (draw a card). The English overloads "draw"; Polish has never had one word for both. |
| draw (take a card) | **dobierz** | `dobierz kartę` |
| play (a card) | **zagraj** | `zagraj kartę` |
| play (a game) | **graj** / **rozegraj** | |
| discard | **odrzuć** | |
| steal | **ukradnij** / **zabierz** | `ukraść` where it is theft (robber, Bishop), `zabrać` where the source says "take" |
| displace | **wyprzeć** | |
| upgrade (settlement → city) | **rozbuduj** / **rozbudowa** | `Rozbuduj osadę na miasto`. Distinct from the two below. |
| improve (a city track) | **ulepsz** | `Ulepsz Naukę`. Only for the city tracks. |
| promote (a knight) | **awansuj** | |
| activate (a knight) | **aktywuj** | |
| strength N knights | **rycerze o sile N** | `Siła {level} z 3`, `Siła {next}` |
| public victory points | **jawne punkty zwycięstwa** | `w jawnych punktach zwycięstwa`; a hidden victory-point card does not count |
| ranked | **rankingowa** (gra) | |
| casual | **towarzyska** (gra) | |
| queue | **kolejka** | |
| leaderboard | **ranking** | |
| rating / ELO | **ranking** / **ELO** | Kept as `ELO` in the column header. |
| store | **sklep** | |
| supporter | **Wspierający** | Nominalised adjective, used as a role label in the class of `Moderator` and `Zwycięzca`, masculine by default in the singular. `osoba wspierająca` is twice as long and does not fit a name decoration. |
| VP (the abbreviation) | **PZ** | `punkty zwycięstwa`. Same width as the English. Does not inflect. |
| Pips (the currency) | **Pips** | A product name, untranslated and undeclined. |
| Booster | **Booster** | Discord's own label. Untranslated. |
| replay | **powtórka** | |
| turn timer | **licznik czasu** | |
| turn timer presets | **Spokojna** / **Normalna** / **Blitz** | Relaxed / Normal / Blitz; feminine to agree with the implied `tura`. `Blitz` stays English (see §17). |
| auto-play | **auto‑ruch** / **automatyczny ruch** | Long; §12 |
| invite code / link | **kod zaproszenia** / **link zaproszenia** | |
| private / public (table) | **prywatny** / **publiczny** | Agrees with `stół` (m). |
| chat ban | **blokada czatu** | |
| report (a message) | **zgłoś** | |
| map builder | **kreator map** | |
| brush / tool | **pędzel** / **narzędzie** | |
| tile fill | **wypełnienie** | |
| map builder panel headings | **Rozmiar** / **Surowiec** / **Numer** / **Port** | Size / Resource / Number / Port |
| balanced (board) | **zrównoważona** | agrees with `plansza` (f) |
| WebGL / browser | **przeglądarka** | |
| hand limit / discard limit | **Limit ręki** / **Limit kart na ręce** | |
| trade offer: everyone declined / declined / waiting for | **Wszyscy odmówili** / **Odmówili:** / **Czekamy na:** | Colon frames for the joined name lists |
| counter-offer sent | **Kontroferta wysłana.** | |
| connection lost (disconnect banner) | **Utracono połączenie** | |

`"{name}" will be removed from your library.` needs a head noun for `zostanie usunięta` to
agree with: `Mapa „{name}” zostanie usunięta z twojej biblioteki.`

---

## 8. The card titles

Our English translated faithfully (§2). Every title is a noun or noun phrase in the
**nominative**, initial capital only.

### Development deck

| Our English | Polish | Gender | Rationale |
|---|---|---|---|
| Knight | **Rycerz** | m | The ordinary word. |
| Victory Point | **Punkt zwycięstwa** | m | |
| Road Building | **Budowa dróg** | f | Verbal noun + genitive plural, which is how Polish names an activity. |
| Year of Plenty | **Rok obfitości** | m | Faithful: ours says "Year of Plenty", not *Invention* (`Wynalazek`). |
| Monopoly | **Monopol** | m | |

### Trade deck

| Our English | Polish | Gender | Rationale |
|---|---|---|---|
| Commercial Harbor | **Port handlowy** | m | |
| Master Merchant | **Mistrz kupiecki** | m | Singular, as ours is. `Kupiec mistrz` is not Polish; the adjective form is the only shape available. |
| Merchant | **Kupiec** | m | Also the name of the *piece*; the same word, as in the source. |
| Merchant Fleet | **Flota kupiecka** | f | Parallel with `Mistrz kupiecki`, and it leaves `handlowy` free for `Port handlowy`. |
| Resource Monopoly | **Monopol surowcowy** | m | Adjective, not `Monopol na surowce`: shorter and parallel with the next. |
| Trade Monopoly | **Monopol towarowy** | m | Ours contrasts *resource* with *commodity*; `surowcowy` / `towarowy` keeps exactly that contrast. |

### Politics deck

| Our English | Polish | Gender | Rationale |
|---|---|---|---|
| Bishop | **Biskup** | m | |
| Constitution | **Konstytucja** | f | |
| Deserter | **Dezerter** | m | |
| Diplomat | **Dyplomata** | m | Masculine noun with feminine declension. |
| Intrigue | **Intryga** | f | The abstract noun, matching ours; not `Intrygant` (the person). |
| Saboteur | **Sabotażysta** | m | |
| Spy | **Szpieg** | m | |
| Warlord | **Wódz** | m | Ours is one word. `Wódz wojenny` is two and pads it. |
| Wedding | **Wesele** | n | `Wesele` is the feast, `Ślub` is the ceremony. The art is a feast table with gifts, and the effect is receiving gifts. |

### Science deck

| Our English | Polish | Gender | Rationale |
|---|---|---|---|
| Alchemist | **Alchemik** | m | |
| Crane | **Dźwig** | m | Singular. The art is one treadwheel crane. |
| Engineer | **Inżynier** | m | |
| Inventor | **Wynalazca** | m | Ours is the **person**; not `Wynalazek` (*invention*). |
| Irrigation | **Nawadnianie** | n | Verbal noun. |
| Medicine | **Medycyna** | f | The discipline, not `Lekarstwo` (a drug). |
| Mining | **Górnictwo** | n | |
| Printer | **Drukarnia** | f | Not `Drukarka` (the peripheral) and not `Drukarz` (the man). The art is a press bed and a hung sheet: the *shop*. |
| Road Building (Science) | **Budowa dróg** | f | Same title as the development card, as in the source. |
| Smith | **Kowal** | m | |

When a card title is the subject of a placeholder frame, the frame leads with it and a
colon: `{name}: na planszy nie ma teraz legalnego celu.` The title stays nominative.

---

## 9. Interface actions (the button vocabulary)

Held uniform across the catalogue. Perfective imperative unless marked.

| English | Polish | Note |
|---|---|---|
| Roll | **Rzuć** | |
| End turn | **Zakończ turę** | |
| Build | **Zbuduj** / **Buduj** (mode) | §6 |
| Buy | **Kup** | |
| Trade | **Wymień** / **Handluj** (the step) | |
| Offer | **Zaproponuj** | |
| Accept | **Przyjmij** | |
| Decline / Reject | **Odrzuć** | |
| Counter-offer | **Kontroferta** (noun) / **Odpowiedz ofertą** | |
| Withdraw | **Wycofaj** | |
| Cancel | **Anuluj** | |
| Confirm | **Potwierdź** | |
| Save | **Zapisz** | |
| Delete | **Usuń** | |
| Clear | **Wyczyść** | |
| Undo | **Cofnij** | |
| Close | **Zamknij** | |
| Back | **Wstecz** | |
| Refresh | **Odśwież** | |
| Copy | **Kopiuj** | imperfective by convention in Polish UIs |
| Paste / Load | **Wklej** / **Wczytaj** | |
| Send | **Wyślij** | |
| Start | **Rozpocznij** | |
| Surrender | **Poddaj się** | |
| Equip | **Załóż** | |
| Unlink | **Odłącz** | |
| Sign in | **Zaloguj się** | |
| Sign out | **Wyloguj się** | |
| Bid one less / more {name} | **O jedną mniej: {name}** / **O jedną więcej: {name}** | `{name}` arrives capitalised and in its citation form (`Owca`), so it goes after a colon rather than into the verb phrase |

---

## 11. Case and placeholders

A placeholder in a governed position needs a case the catalogue cannot supply, so the
source avoids them. The patterns the Polish relies on:

### 11.1 Per-value messages instead of governed holes

Where a frame governs its noun, the source writes one message per value and the Polish
carries the case inside each:

- `short.needOneMore.*`: genitive, `Potrzebujesz jeszcze 1 drewna.`
- `You have no {piece} left.` is five whole sentences with the genitive plural: `Nie masz
  już dróg.`, `… osad.`, `… miast.`, `… statków.`, `… rycerzy.`
- `track.*`, `board.metropolis.*`, `deck.aria.*`: genitive (§3.3).
- `short.shortOf` is a colon form (`Brakuje ci: {resources}`), so its list items are
  **nominative**.

### 11.2 Colon frames are case-proof

`{name} has to be played before you roll.` (subject position, nominative),
`Expansion: {name}`, `event: {name}`, `{ratio}:1 {resource}`, `{track}: level {lvl} of 5`,
`{label}: {n}`, every `goodCount()` tally, and the map-issue messages (`Ta mapa używa
terenu z wyłączonego dodatku. Teren: {terrain}. Dodatek: {module}.`) are all safe: nothing
governs the noun, so it stays nominative.

### 11.3 Reachable terrain/expansion pairs

The reachable terrain-needs-expansion pairs are whole sentences: `Pola złota wymagają
włączonego dodatku Wyspy.`, `Pola jeziora wymagają włączonego scenariusza Rybacy.`

### 11.5 Commercial Harbor

`otrzymujesz` governs the **accusative**. The source has `harbor.receive.wood` …
`harbor.receive.ore` plus `harbor.receive.none`, so the Polish writes the accusative into
each: `Port handlowy: oddaj towar (otrzymujesz cegłę / owcę / pszenicę / rudę / drewno)`.

### 11.7 Inserted head nouns

Where a participle has to agree with something the English leaves implicit, the Polish
inserts the head noun: `Mapa „{name}” zostanie usunięta z twojej biblioteki.`

---

## 12. Length and overflow

Polish runs **roughly 15–25 % longer than English** on running text, less than German but
with a worse tail: few break opportunities inside a word, no compound-splitting convention,
and long inflected endings on already-long stems.

| Surface | English | Polish | Growth |
|---|---|---|---|
| Improvement panel column | `Science` (7) | `Nauka` (5) | fits |
| Improvement panel column | `Politics` (8) | `Polityka` (8) | fits |
| Turn pill | `End turn` (8) | `Zakończ turę` (12) | **tight**; `Zakończ` (7) is the short form |
| Board action | `Promote` (7) | `Awansuj` (7) | fits |
| Board action | `Activate` (8) | `Aktywuj` (7) | fits |
| Board action | `Move knight` (11) | `Przesuń rycerza` (15) | **tight**; `Rycerz` / `Statek` are the short forms |
| Lobby filter | `Open seats` (10) | `Wolne miejsca` (13) | **tight**; `Wolne` |
| Button | `Leave & spectate` (16) | `Opuść i obserwuj` (16) | fits |
| Scoreboard column | `Longest Road` (12) | `Najdłuższa droga` (16) | **overflow risk** |
| Scoreboard column | `Largest Army` (12) | `Największa armia` (16) | **overflow risk** |
| Scoreboard column | `Defender of the Realm` | `Obrońca królestwa` (17) | fits |
| Scoreboard / legend | `Strength 2 knights` | `Rycerze o sile 2` (16) | tight; `Rycerze siły 2` (14) is the terser label |
| Stat tile | `Games played` (12) | `Rozegrane gry` (13) | fits |
| Dev-deck table header | `Copies` | `Egzemplarze` (11) | **overflow risk** in a narrow numeric column |
| Settings row | `Discard limit` (13) | `Limit kart na ręce` (18) | **overflow risk**; `Limit ręki` matches the manual's `Limit ręki: 4.` |
| Empty state | `No open tables` (14) | `Brak otwartych stołów` (21) | tight |
| Card title | `Master Merchant` (15) | `Mistrz kupiecki` (15) | fits |
| Card title | `Commercial Harbor` (17) | `Port handlowy` (13) | fits |
| Toast | `Waiting for players to discard.` (31) | `Trwa odrzucanie kart przez graczy.` (34) | fits |

Other short forms: `Plansza dla daltonistów` for `Plansza przyjazna dla daltonistów`,
`Maks. poziom` for `Maksymalny poziom`, `Autom.` for `Automatycznie`.

The single worst word is **`Najdłuższa droga`** in a scoreboard column header sized for
`Longest Road`. There is no shorter faithful Polish: `Droga` alone loses the superlative
that *is* the award.

---

## 13. The rules manual

`routes/HowToPlay.tsx` contributes about a quarter of the catalogue: tabs, chapters and
paragraphs of connected rules prose. Polish translates it in full: a rules manual is the
one surface where an English fallback is least acceptable.

Conventions:

- **Every number in the English survives into the Polish.** Costs, trade rates, track
  lengths, hand limits, thresholds and board mixes must match digit for digit.
- **Read it as prose, in chapter order.** The failure mode is not a wrong term but a
  paragraph that is individually correct and collectively wrong: a pronoun that disagrees
  with its antecedent in the previous sentence (`but` is masculine: `go`, not `ją`), a
  containment the game does not have (development cards are a separate pool, not a subset
  of the hand: no `ile z nich`), or an order word that contradicts the sentence above
  (placement is `W kolejności tur`, not `W kolejności miejsc`).
- Terminology is bound to this document. Where the manual explains a distinction English
  makes with one word (`draw`, `play`, `upgrade` / `improve` / `promote`, `trade`), Polish
  has separate words (§7), and the manual is where a wrong one would be most confusing.
- `out-trade your rivals` is `handlować lepiej niż rywale`; `przehandlować` means to barter
  something away and does not take a person.
- The impersonal `widać` governs the accusative: `a rolę wspierającego … widać`.
- Turn timer presets in prose: `Spokojna 120 s, Normalna 60 s albo Blitz 30 s.`

---

## 14. Catalogue invariants

Each entry keeps, identical to `en`: the named-parameter set, ICU `plural` / `select`
argument names, rich-text tag sets (`<0>`, `<1/>`), explicit ids (`error.<CODE>`,
`log.*`, `card.*`, `track.*` …), and entry order. Every `plural` carries all four Polish
arms. No `msgstr` equals its `msgid`, and no `msgstr` contains an em dash.
`scripts/po_verify.py pl` checks the mechanical part.

---

## 17. Blank entries

An empty `msgstr` falls back to the English at runtime. A blank is used only where the
correct Polish is character-identical to the English, which `catalog.test.ts` would
otherwise reject as `msgstr == msgid`:

| Entry (msgid) | Why blank |
|---|---|
| `{0}` | a bare placeholder |
| `{label}, {total}`, `{label}: {n}`, `{staked} → {got}` | placeholders and punctuation |
| `{nextReward}. {nextCost}` | two sentences run together, punctuated the same way |
| `{name}: {instruction}` (progress card board prompt) | a name, a colon, an instruction |
| `{ratio}:1 {resource}`, `2:1 {resource}` | a ratio and a name |
| `{0} ({1} Pips)` | a name, a number and a product name |
| `Pips`, `Booster` | product names (ours, and Discord's) |
| `Bank`, `Bot`, `Port` (board piece and map builder heading), `System`, `Menu` | identical words in Polish |
| `online`, `offline` | the words Polish uses for these |
| `limit 2` … `limit 15` | a word Polish shares and a number |
| `log.produced` | a name and an icon slot |
| `Blitz` (`msgctxt "turn timer preset"`) | Polish uses the English word |

Two rules hold:

- **Every blank needs a comment saying why.** Without one, an intentional blank looks
  like an untranslated entry.
- **A blank on an ICU-plural entry is never safe.** The fallback is the English message,
  English has no `few` arm, so 2, 3 and 4 would render the `other` text.

---

## 18. Scenario expansions

Register follows §1, the log stays in the narrative present (§5), and the no-gender rule
holds in the error copy.

| English | `pl` | Note |
|---|---|---|
| Harbormaster | **Kapitan portu** | harbour points = `punkty portowe`; harbour settlement = `osada portowa` |
| Rivers | **Rzeki** | |
| coins | moneta / monety / monet | |
| bridge / bridge site | most / miejsce na most | `miejsce na most` also for a bridge *crossing* |
| swamp / ford | bagno / przejść w bród | |
| Wealthiest / Poorest Settler | „Najbogatszy osadnik” / „Najbiedniejszy osadnik” | |
| Raiders | **Najeźdźcy** | raider = `najeźdźca`, m-pers (few = genitive, §4.5) |
| rider | jeździec (jeźdźca, jeźdźców) | m-pers |
| a rider's push | wydłużenie ruchu | the verb is `popędzić` |
| castle / prisoner / conquered / landing | zamek / jeniec / zdobyty / lądowanie | |
| Muster / Swift Rider / Treason / Intrigue | „Zaciąg” / „Szybki jeździec” / „Zdrada” / „Intryga” | |
| movement points | punkty ruchu | `3 punkty ruchu` (§4.7) |
| Wagons | **Wozy** | wagon = `wóz` |
| plaza / spoke / trade hex | plac / szprycha / pole handlowe | |
| quarry / glassworks | kamieniołom / huta szkła | |
| marble / glass / tools / sand | marmur / szkło / narzędzia / piasek | |
| cargo / load (VP) / toll | ładunek / ładunek / myto | |
| Swift Journey | „Szybka podróż” | |
| barbarian place (Wagons) | między polami {a} i {b} / przy polu {a} / na wybrzeżu | Labels stay nominative, in apposition |
| Explorers | **Odkrywcy** | |
| home island / home waters | wyspa macierzysta / wody macierzyste | |
| settler / crew | osadnik / załoga | |
| fish haul / spice sack | połów / worek przypraw | |
| spice farm / spice village | plantacja przypraw / wioska przypraw | |
| Fast Gold / Pirate Bonus / Swift Voyage | „Szybkie złoto” / „Premia piracka” / „Szybki rejs” | |
| gold field (Explorers) | **złoże złota** | `pole` is already the hex |
| shoal / pirate lair / Council | ławica / kryjówka piratów / Rada | |
| hold / basin | ładownia / dok | |
| tribute | haracz | |
| fish tile | żeton ryb | |
| island bonus | punkty za wyspy | |
