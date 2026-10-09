# German (`de`) terminology glossary

The terminology, register and grammar conventions that
`frontend/src/locales/de/messages.po` follows. The catalogue is written against this
document and is internally consistent with it, so changing a term here means a
find-and-replace over the `.po`.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/base.md`,
`docs/rules/islands.md`, `docs/rules/knights.md`, `docs/rules/scenarios.md`,
`art/cards/cards.json`.

German carries two structural risks for this interface:

1. **Length.** German runs 10–35 % longer than English on average and up to roughly double
   on short UI labels. The interface is dense with buttons, pills, fixed-width chrome and
   stat tables tuned against English. §12 covers it.
2. **Naming.** §2 is written around a single rule: translate our English faithfully; only
   the game title and the expansion names get our own words.

---

## 1. Register decisions

These hold across every string. Mixing them is the most visible sign of an assembled
translation.

### Formality: **du**, everywhere, no exceptions

**Decision: `du` / `dein` / `dir` throughout, including error messages and the rules
manual.**

German-language game UIs of this kind are near-universally `du`: it is the convention for
multiplayer games, for the board-game hobby, and for anything with a chat box in it. The
English source is chatty and informal ("Say hi to your table…", "Jump into a table!",
"Nobody is ahead of you"), and `Sie` against that source produces a register clash on every
screen.

Register in German is carried by verb inflection and imperatives, not only by a pronoun
(`du kannst` / `Sie können`, `Bewege den Räuber` / `Bewegen Sie den Räuber`), so a change of
register would be a full retranslation, not a find-and-replace. Every `Sie`/`Ihnen` in a
`msgstr` is a third-person pronoun ("Bots … *Sie* nutzen die Bank"); there is no formal
address and no `Ihr`-possessive anywhere.

The Terms and Privacy pages are not extracted (they stay English by decision); only their
footer links and browser titles are translatable, and those follow the chrome.

Consequences the catalogue holds to:
- Possessives are `dein/deine/deinen`, never `Ihr`.
- Imperatives are the `du`-imperative with no pronoun: `Würfle`, `Wähle eine Karte`,
  `Klicke auf ein Feld`. Never `Würfeln Sie`.
- `du`/`dein` stay lower-case mid-sentence. Post-1996 German does not capitalise them, and
  capitalising them in a game UI reads as dated.

### Surface register

| Surface | Register | Example |
|---|---|---|
| Buttons, menu items, tab labels, column headers | **Bare noun, or bare infinitive for an action** | `Bauen`, `Kaufen`, `Handeln`, `Zuschauen`, `Zug beenden` |
| System messages: errors, toasts, confirmations, empty states | **Full sentence, `du`, final period** | `Du hast nicht genug Rohstoffe.` |
| Board prompts (the lower-case running hints under the board) | **Imperative, `du`, no final period**, matching the source, which drops it | `tippe auf ein Feld` |
| Event log lines | **Plain declarative** | `Iris hat eine Stadt gebaut` |
| Card rule text | **Terse imperative** | `Bewege den Räuber und stiehl eine Karte` |
| Rules manual | **Full sentences, `du`, longer and plainer** | |

**Infinitive vs. imperative on buttons.** German UI convention is the bare infinitive
(`Speichern`, `Abbrechen`), not the imperative (`Speichere`, `Brich ab`). The catalogue
uses the infinitive on every button and the imperative only in running prompts and card
text.

### Capitalisation

Nouns are capitalised. This is the easiest thing to get wrong inside interpolated
sentences, where the source's lower-case mid-sentence words tempt a translator into
leaving them lower-case.

- Every noun is capitalised **including inside plural arms**:
  `{n, plural, one {# Karte} other {# Karten}}`, never `{# karte}`.
- Nominalised infinitives are nouns: `beim Bauen`, `zum Handeln`.
- Adjectives and the pronouns `du`, `dein`, `dich`, `dir` stay lower-case.
- **The source's lower-case labels.** The English lower-cases some short
  labels for typographic effect (`barbarians`, `tiles`, `resource`, `event die`, `gives`,
  `wants`, `nothing`, `in game`, `brick`). German cannot follow this where the word is a
  noun: `Barbaren`, `Felder`, `Rohstoff`, `Ereigniswürfel`. Verbs and adjectives in the
  same set (`fair`, `on`, `off`, `online`, `offline`, `random`, `shuffled`) stay lower-case,
  so the German set reads half lower-case. There is no correct alternative: a CSS
  `text-transform: lowercase` would produce `barbaren`, `felder`, which is wrong German.
  The nine `resource, standalone label` entries (`wood`, `brick`, `sheep`, …) follow the
  same rule.
- Panel headings are written in normal case; where the design shows capitals, CSS draws
  them. No `msgstr` is written in ALL CAPS.

### Punctuation

- The catalogue contains no em dash. The German parenthetical dash is the spaced en dash ` – `,
  and the catalogue prefers commas, colons and parentheses to any dash at all.
- German quotation marks are `„…“`, used where the source quotes a user-supplied name
  (`„{0}“`). No `msgstr` uses straight quotes.
- The interpunct `·` separator is kept as-is; it is typographic furniture, not language.
- `…` is kept and spaced as in the source.
- `ß` is used per standard orthography (`Straße`, `größte`, `schließen`). **Uppercased `ß`
  is conventionally `SS`**, which matters because card titles are set uppercase:
  `STRASSENBAU` is the correct uppercase form of `Straßenbau`, and CSS
  `text-transform: uppercase` produces exactly that, but the title is then 11 characters
  rather than 10. See §8.
- **Interpolated resource names take a colon.** Where an English label folds a
  `{name}` resource into a verb phrase (`Bid one less {name}`), the German keeps the button
  phrase and appends the name after a colon (`Eins weniger bieten: {name}`). `{name}`
  arrives capitalised and in its citation form (`msgctxt "resource"`), which cannot take an
  article or case ending; the colon is the label/value separator the house style allows.

### Plurals

German has **two ICU plural categories, `one` and `other`**, exactly matching English.
Every `plural` message keeps both arms with both filled in. German pluralises nouns where
English sometimes does not (`# sheep` → `# Schaf` / `# Schafe`), so several messages that
are a no-op split in English are a real one in German.

| id | `one` | `other` |
|---|---|---|
| `resource.count.wood` | `# Holz` | `# Holz` (mass noun) |
| `resource.count.brick` | `# Ziegel` | `# Ziegel` (plural = singular) |
| `resource.count.sheep` | `# Schaf` | `# Schafe` |
| `resource.count.wheat` | `# Weizen` | `# Weizen` (mass noun) |
| `resource.count.ore` | `# Erz` | `# Erz` (mass noun) |
| `resource.count.gold` | `# Gold` | `# Gold` (mass noun) |

The per-card count messages in `frontend/src/lib/cardPhrases.ts` (`card.<phrase>.<card>`)
carry the count inside the message, so German writes both arms over a noun it can see:

| id | `one` | `other` |
|---|---|---|
| `card.bankLeft.sheep` | `# Schaf in der Bank übrig` | `# Schafe in der Bank übrig` |
| `card.bankLeft.brick` | `# Ziegel in der Bank übrig` | `# Ziegel in der Bank übrig` |
| `card.improveCost.coin` | `Kostet # Münze` | `Kostet # Münzen` |
| `card.supplyLeft.cloth` | `# Tuch im Vorrat übrig` | `# Tuch im Vorrat übrig` |

`Schaf`/`Schafe` and `Münze`/`Münzen` inflect; `Holz`, `Weizen`, `Erz`, `Ziegel`, `Tuch`
and `Papier` do not. The same invariance applies to `Ritter` and `Würfel`, so several
messages have two arms whose text is byte-identical. **That is correct, not a copy-paste
slip.** Negated forms are written per noun for the same reason: *kein Holz*, *keine
Ziegel*, *keinen Weizen*.

Price and trade tallies are not prose: they render as `Holz ×2` (`goodCount()` in
`frontend/src/lib/cardFace.ts`), a multiplier suffix that needs no agreement.

### Gender, for anyone editing the catalogue later

An inconsistent article is the most likely edit regression.

**der** Weg, der Rohstoff, der Räuber, der Pirat, der Ritter, der Handel, der Zug, der
Hafen, der Stapel, der Vorrat, der Würfel, der Platz, der Zuschauer, der Siegpunkt, der
Tisch, der Ertrag, der See (lake), der Wurf, der Plünderer.
**die** Straße, die Siedlung, die Stadt, die Karte, die Bank, die Ware, die Runde, die
Kante, die Kreuzung, die Insel, die Armee, die Metropole, die Stadtmauer, die Wüste, die
Rangliste, die Revanche, die Stärke, die See (open sea), die Partie, die Burg.
**das** Feld, das Schiff, das Erz, das Holz, das Schaf, das Gold, das Spiel, das Remis,
das Ziel, das Gebäude.

---

## 2. Terminology policy

### 2.0 Ordinary nouns stay ordinary

Substituting invented alternatives for ordinary German nouns (`Weg` for `Straße`, `Dorf`
for `Siedlung`, `Bandit` for `Räuber`, `Aktionskarte` for `Entwicklungskarte`) or for
faithful card titles (`Kriegsherr` for `Feldherr`, `Meisterhändler` for `Handelsmeister`,
`Warenmonopol` for `Handelsmonopol`) is wrong, and none of them is used. Our own English
card names (`art/cards/cards.json`: Master Merchant, Warlord, Bishop, Constitution,
Deserter, Diplomat, Intrigue, Saboteur, Crane, Engineer, Inventor, Irrigation, Medicine,
Mining, Printer, Smith, Road Building, Year of Plenty) are descriptive phrases, so the
faithful German for them is simply the correct German.

### 2.1 The policy

> Translate our English faithfully. Only the game title and the expansion names get our
> own words.

Its consequences:

1. **The product title and the expansion titles are the only divergences.** The
   product is `Costanio`, which is not translated (§11). Our expansions are named "Islands"
   and "Knights" in English, so the German translates *those*: `Inseln` and `Ritter`.
2. **Everything else is translated on its merits.** The test for every term is: *what is
   the faithful German for the English word we actually use?* If the answer is a familiar
   board-game word, keep it.
3. **Card names are descriptive phrases, not marks.** Translate them like any other text.
4. **Follow our English, not habit.** Where the German a player might expect translates a
   different English phrase from ours, follow ours: `brick` is `Ziegel`, `sheep` is
   `Schaf`, `wheat` is `Weizen`, `Largest Army` is `Größte Armee`, `Longest Road` is
   `Längste Straße`.

A German board gamer will find most of this vocabulary familiar. That is the correct
outcome.

### 2.2 The divergences, in full

| English | **Ours** | Why |
|---|---|---|
| Islands (expansion) | **Inseln** | Expansion title. The faithful rendering of *our* expansion name, "Islands" |
| Knights (expansion) | **Ritter** | Expansion title. The faithful rendering of *our* expansion name, "Knights" |

The product name `Costanio` is not translated at all (§11), which covers the game title.
The scenario names (Rivers, Raiders, Wagons, Explorers, Harbormaster, Fishermen, Caravans)
are translated faithfully from our English (§6).

#### Terms where our English decides the word

| English | **Ours** | Why |
|---|---|---|
| Largest Army | **Größte Armee** | Our English says "army" |
| Longest Road | **Längste Straße** | Our English says "road", not "trade road" |
| longest trade route (Islands) | **Längste Handelsroute** | Our English says "trade route", and the route counts ships |
| Year of Plenty | **Erntejahr** | The compact faithful rendering; the literal `Jahr des Überflusses` is 20 characters and cannot be a card title. See §8 |
| pirate | **Pirat** | Our English says "pirate" |
| brick (resource) | **Ziegel** | Our English says "brick" and calls the *terrain* "Clay", which is `Lehm`. Keeping both preserves a distinction the source makes |
| sheep | **Schaf** | Our English says "sheep", not "wool" |
| wheat | **Weizen** | Our English says "wheat", not "grain" |
| strength 1 / 2 / 3 knight | **Ritter der Stärke 1 / 2 / 3** | Our English says "Strength 1 knights" |
| Merchant Guild (Trade 5) | **Handelsgilde** | Faithful rendering of "Merchant Guild" |
| Warlord | **Feldherr** | The card activates all your knights, which is a commander's act |
| Master Merchant | **Handelsmeister** | The idiomatic German compound |
| Trade Monopoly | **Handelsmonopol** | `Handel` is the faithful rendering of "Trade" |
| commodity | **Ware** | A length decision: `Ware` is 4 characters against 11 and pairs cleanly with `Rohstoff`. `Handelsware` is used where the fuller form is needed |

### 2.3 Ordinary German terms, kept on their merits

These are the faithful German for our English. A familiar board-game word here is correct,
not a leak.

`Siedlung` · `Straße` · `Stadt` · `Räuber` · `Rohstoff` · `Hafen` · `Ritter` · `Siegpunkt`
· `Stadtmauer` · `Barbaren` · `Metropole` · `Würfel` · `Handel` / `Politik` /
`Wissenschaft` · `Papier` / `Tuch` / `Münze` · `Holz` / `Erz` / `Lehm` (terrain) ·
`Entwicklungskarte` · `Fortschrittskarte` · `Stadtausbau` · `Ereigniswürfel` · `Aquädukt`
· `Festung` · `Goldfeld` · `Schiff` · `Insel` · `Zahlenchip` · and the card titles
`Ritter`, `Monopol`, `Straßenbau`, `Bischof`, `Verfassung`, `Deserteur`, `Diplomat`,
`Intrige`, `Saboteur`, `Spion`, `Hochzeit`, `Händler`, `Handelshafen`, `Handelsflotte`,
`Rohstoffmonopol`, `Feldherr`, `Handelsmeister`, `Alchemist`, `Kran`, `Ingenieur`,
`Erfinder`, `Bewässerung`, `Medizin`, `Bergbau`, `Schmied`.

`Verfassung` (Constitution), `Straßenbau` (Road Building) and `Rohstoffmonopol` (Resource
Monopoly) are the faithful German; alternatives such as `Urkunde` or `Wegebau` translate
something our English does not say. `Rohstoffmonopol` is written unhyphenated.

**`Weg` is correct where it appears.** It translates the English *path* or *way*
(`A path may not reuse the same road twice`, `your single longest path`, `Ways to
support`), never *road*, and never a board edge (that is `Kante`). `Straße` is the only
rendering of *road*. Likewise `Aktionskarte` translates our own English *action card* (the
non-knight, non-VP development cards) and is faithful.

---

## 3. Core game nouns

| English | `de` | Gender | Rationale |
|---|---|---|---|
| road | Straße | die | Ordinary German. 6 characters |
| settlement | Siedlung | die | Ordinary German. 8 characters, against English's 10 |
| city | Stadt | die | |
| building (cover term for settlement + city) | Gebäude | das | The rules docs use "building" as a cover term constantly |
| hex / tile (board space) | Feld | das | The German board-game standard for a space. 4 characters. Collides with `field` as a terrain type; that terrain is `Ackerland`, never `Feld` |
| tile (physical component, map builder) | Plättchen | das | |
| vertex / intersection / junction | Kreuzung | die | Unified. `Knoten` reads as a maths term. `Ecke` is used only where the English itself says "corner" |
| edge (incl. "path" as a shared board edge) | Kante | die | The placement rule, `Seekante`, `Küstenkante`, `Zielkante`, the map builder and board errors all use it |
| port / harbor | Hafen | der | English uses both "port" and "harbor"; unified |
| generic port (3:1) | Standardhafen | der | The catalogue often writes the ratio instead |
| specific port (2:1) | Spezialhafen | der | Same |
| robber | Räuber | der | Ordinary German |
| longest road | Längste Straße | | Faithful for "Longest Road" |
| longest route / longest trade route | Längste Handelsroute | | Islands merges roads and ships into one route |
| largest army | Größte Armee | | Faithful for "Largest Army" |
| victory point (VP) | Siegpunkt | der | Abbreviated **SP** (the initialism of `Siegpunkt`) in tight HUD space, and for the manual's `pt`/`pts` scoring lines; same width as `VP`. Spelled out in prose and in the VP-rate lines (`je 1 Siegpunkt`) |
| development card | Entwicklungskarte | die | 17 characters; `Karten` where the context is unambiguous |
| progress card | Fortschrittskarte | die | 17 characters |
| action card | Aktionskarte | die | Our own English term; see §2.3 |
| resource | Rohstoff | der | `Ressource` is management-speak, `Gut` too abstract, `Material` wrong |
| commodity | Ware | die | Pairs with `Rohstoff` (§2.2) |
| bank | Bank | die | |
| supply (shared stock of pieces) | Vorrat | der | The rules distinguish bank (resource cards) from supply (pieces); German keeps the split |
| hand | Hand / Handkarten | die | `Handkarten` for "the cards you hold", `Hand` for the hand as a place |
| hand limit | Kartenlimit | das | `Handkartenlimit` (15) is more precise and does not fit |
| deck | Stapel | der | The face-down draw pile |
| trade (noun / verb) | Handel / handeln | der | |
| turn (one player's turn) | Zug | der | The German board-game word. 3 characters |
| round (a circuit of players) | Runde | die | |
| dice / die | Würfel | der | Same word singular and plural |
| roll (verb / result) | würfeln / Wurf | der | |
| number token | Zahlenchip | der | `Zahlenplättchen` (15) does not fit |
| red number (6 and 8) | rote Zahl | die | |
| distance rule | Abstandsregel | die | |
| setup (initial placement) | Aufbau | der | "Your two setup placements" is `Deine beiden Setzungen im Aufbau`, not `Startsiedlungen`: in a Knights game the second placement is a city |
| base game | Grundspiel | das | `Grundregeln` for "base rules". The short `Base` chips are `Basis`, the abbreviation, as the English keeps a short `Base` beside `Base Game` |
| production (resource yield) | Ertrag | der | `Ernte` is warmer but implies farming only |
| discard (verb / noun) | abwerfen / Abwurf | der | |
| steal | stehlen | | `klauen` suits the `du` register but reads as childish in a system message |
| be owed (a resource) | zustehen / Anspruch | | Not `auf etwas aus sein`, which means *to be after* it |

### Terrain

The `terrain.*` ids carry the *display* name of a terrain type, which is not always the
resource it makes.

| id | English | `de` | Note |
|---|---|---|---|
| `terrain.wood` | Forest | Wald | |
| `terrain.brick` | Clay | Lehm | The terrain is clay; the *resource* is `Ziegel` |
| `terrain.sheep` | Pasture | Weide | |
| `terrain.wheat` | Field | Ackerland | **Not `Feld`**, which is taken by "hex". The most important single collision in the catalogue |
| `terrain.ore` | Mountain | Gebirge | `Berg` is one mountain; a hex is a range |
| `terrain.none` | Desert | Wüste | |
| `terrain.gold` | Gold | Gold | |
| `terrain.sea` | Sea | Wasser | The map-builder brush paints `Wasser`, which covers lakes too. `Meer` is the open sea |
| `terrain.lake` | Lake | See | *der* See. `die See` means the sea; the article matters |
| `terrain.fog` | Fog | Nebel | |
| `terrain.land` | Land | Land | |
| `terrain.border` | Border | Rand | `Grenze` is a political border; this is the edge of the board |

Bare hex labels interpolated into sentences (`neben {a}`, `Plünderer nach {name}
versetzen`) are bare nouns without an article: `Wüste`, `See`, `Goldfeld`.

---

## 4. Resources and commodities

From `frontend/src/lib/eventlog.ts`: resources are `wood, brick, sheep, wheat, ore` (plus
`gold`); commodities are `cloth, paper, coin`.

| English | `de` | Chars | Rationale |
|---|---|---|---|
| wood | Holz | 4 | |
| brick | Ziegel | 6 | Faithful for "brick"; keeps the Clay/Brick split the source makes |
| sheep | Schaf | 5 | Faithful for "sheep". Plural `Schafe` |
| wheat | Weizen | 6 | Faithful for "wheat" |
| ore | Erz | 3 | |
| gold | Gold | 4 | |
| cloth | Tuch | 4 | `Stoff` means fabric-as-material |
| paper | Papier | 6 | |
| coin | Münze | 5 | |

**`frontend/src/lib/chatTokens.ts`** (the chat resource-icon matcher) recognises typed
English slang only; it has no German vocabulary. It is a chat-input feature, invisible to
the catalogue. Adding German words would need a fold for `ß`/`SS` and umlauts beyond the
locale-invariant `toLowerCase()` it uses (`STRASSE`, `strasse`, `Straße` are one token to a
player).

---

## 5. Islands expansion

| English | `de` | Rationale |
|---|---|---|
| Islands (the expansion) | Inseln | Faithful rendering of our own expansion name (§2.2) |
| ship | Schiff | |
| sea edge | Seekante | Transparent coinage |
| coastal edge | Küstenkante | Same |
| ship route / network | Seeroute | |
| open ship (movable end) | offenes Schiff | The concept has no compact German noun |
| pirate | Pirat | Faithful for "pirate" |
| chase (the pirate) | vertreiben | Same verb as for the robber. Short label `Vertreiben` |
| gold hex | Goldfeld | |
| island bonus | Inselbonus | Awarded for the first building on a new island; manual prose and the table setting. `Inselbonus-SP` for the VP label |
| island discovery | Inselentdeckung | 15 characters |

---

## 6. Scenario expansions

| English | `de` | Rationale |
|---|---|---|
| Fishermen | Fischer | |
| fishing ground | Fischgrund (pl. Fischgründe) | Singular on a hover card that labels one hex |
| fish tile | Fischplättchen | `Fisch` alone where space is tight |
| the old boot | alter Stiefel | Literal, and it is meant to be undignified |
| Caravans | Karawanen | |
| camel | Kamel | |
| oasis | Oase | |
| caravan route | Karawanenroute | |
| voting round (camel placement bid) | Abstimmung | The mechanic is a bid counted as votes |
| Bid nothing | Nichts bieten | Bidding nothing is an answer, not a skip; not `Diese Runde aussetzen` |
| Votes: {total} | Stimmen: {total} | Label and value, which keeps number agreement off `{total}` |
| path (shared board edge) | Kante | An edge can carry a camel and no road at all, so not `Straßenabschnitt` or `Weg` |
| a road credit | ein Guthaben für eine Straße | The spend buys the credit; the road is placed later |
| bid timeout | `wird für dich nichts geboten` | On timeout the seat is recorded as bidding nothing, not as sitting the round out |
| Rivers / Raiders / Wagons / Explorers / Harbormaster | Flüsse / Plünderer / Wagen / Entdecker / Hafenmeister | Faithful renderings of our own English titles |
| raider | Plünderer | Never `Räuber`, which is the robber. Plural-invariant |
| rider | Reiter | The English pun on "one letter apart" (raider/rider) cannot survive in German |
| castle (Raiders, Wagons) | Burg | |
| Muster / Swift Rider / Treason / Intrigue | Aufgebot / Schneller Reiter / Verrat / Intrige | |
| prisoner | Gefangener | |
| conquered | erobert | |
| path (edge a rider or wagon uses) | Kante | As for camels |
| place in reach (rider) | erreichbare Kante | A rider ends on a path, so the count names paths |
| bridge / bridge site | Brücke / Brückenstelle | |
| swamp | Sumpf | |
| watercourse (Rivers) | Flusslauf | |
| coins (Rivers) | Münzen | Same word as the Knights coin commodity; the English shares it too |
| Wealthiest / Poorest Settler | Reichster / Ärmster Siedler | Compound `Ärmster-Siedler-Plättchen` for the tile |
| wealth tiles | Reichtumsplättchen | |
| harbour points | Hafenpunkte | |
| harbour settlement | Hafensiedlung | |
| wagon | Wagen | |
| plaza | Marktplatz | Bare `Platz` is the seat |
| trade hex | Handelsfeld | |
| quarry / glassworks | Steinbruch / Glashütte | |
| marble / glass / sand / tools | Marmor / Glas / Sand / Werkzeug | |
| cargo / load | Fracht / Ladung | `Ladung` also on the Wagons scoreboard |
| toll | Wegzoll | |
| ford | Furt | |
| Swift Journey | Schnelle Reise | |
| crew / settler | Mannschaft / Siedler | |
| fish haul / spice sack | Fischladung / Gewürzsack | |
| shoal | Schwarm (Fischschwarm) | |
| pirate lair | Piratennest | |
| the Council | der Rat | |
| hold (of a ship) | Laderaum | |
| Swift Voyage / Pirate Bonus / Fast Gold | Schnelle Fahrt / Piratenbonus / Schnellgold | |
| consolation gold (Explorers) | Trostgold | Coinage |
| mission marker | Missionsmarker | |
| track space (lair track, Knights track) | Schritt | `Feld` is the hex |

---

## 7. Knights expansion

| English | `de` | Rationale |
|---|---|---|
| Knights (the expansion) | Ritter | Faithful rendering of our own expansion name (§2.2) |
| knight (piece) | Ritter | |
| strength 1 / 2 / 3 knight | Ritter der Stärke 1 / 2 / 3 | Follows the English "Strength 1 knights". One label serves both the status panel and the scoreboard; if a column is tight, `Stärke 1` (under a knight icon) is the shortening, not a second entry |
| strength | Stärke | |
| activate | aktivieren | |
| active / inactive | aktiv / inaktiv | |
| promote | befördern | The exact word for a rank increase |
| move | bewegen | |
| displace (an enemy knight) | verdrängen | |
| chase the robber | den Räuber vertreiben | Button shortens to `Vertreiben` |
| build (a knight) | bauen | A knight is built, never "bought" (`kaufen`) |
| progress card | Fortschrittskarte | 17 characters, in ~40 strings; §12 |
| city improvement / track | Stadtausbau | |
| Trade / Politics / Science | Handel / Politik / Wissenschaft | `Wissenschaft` (12) is a fit risk in the three-column improvement panel |
| level (of a track) | Stufe | Over `Level` (loanword) and `Ebene` (wrong sense) |
| track and deck compounds | `Politik-Stapel`, `Handels-Metropole`, `Wissenschafts-Karte`, `Politik-Stufe 3`, `{metro}-Metropole` | See below |
| metropolis | Metropole | `Großstadt` is a demographic term; `Hauptstadt` means capital |
| city wall | Stadtmauer | Button shortens to `Mauer` |
| event die | Ereigniswürfel | 14 characters |
| barbarians | Barbaren | |
| barbarian fleet | Barbarenflotte | Short form `Flotte` |
| barbarian track | Leiste | An improvement track is `Bahn`: two different objects, two words |
| barbarian attack / raid | Barbarenangriff / Überfall | |
| defender of the realm | Verteidiger des Reiches | Literal and correct. 23 characters. `Verteidiger-Marker` for the token, tagged as a whole compound |
| pillage / downgrade a city | eine Stadt niederbrennen | What the player sees; `herabstufen` is bloodless, and `plündern` would collide with `Plünderer` (Raiders). "Razed" is `zerstört` |
| Merchant Guild (Trade 5) | Handelsgilde | §2.2 |
| Fortress (Politics 5) | Festung | |
| Aqueduct (Science 5) | Aquädukt | |
| merchant (token) | Händler | `Händler-Marker` for the token |

**Track and deck compounds take a hyphen.** German closes such compounds, and the hyphen is
the standard way to do it when the first element is a label-like proper noun:
`Politik-Stapel`, `Handels-Metropole`, `Wissenschafts-Metropole`, `Wissenschafts-Karte`,
`Wissenschafts-Ereignis`, `Politik-Stufe 3`, `Handels-Ausbau`. `Wissenschaft` and `Handel`
take the linking `-s-` (`Wissenschafts-`, `Handels-`); `Politik-` does not. One string
(`{metro}-Metropole`) interpolates the track name, so it needs a separator regardless. The
same pattern governs the post-game level rows and the manual: never the closed
`Wissenschaftsstufe`, the inverted `Stufe Handel` or the loose `Politik Stufe 3`. The
three tracks always move together. The alternative, closing all of them
(`Handelsmetropole`, `Politikstapel`), would require splitting the interpolated message into
three per-track messages.

---

## 8. The card titles

From `art/cards/cards.json`. These composite over the card art at runtime, so they are
display type at large size *and* at a ~56×80 px hand thumbnail. **Length is the whole risk
in German.** English fits ~13 uppercase characters before the shrink loop bites.

Rule of thumb: prefer under 13 characters, accept up to 16 with a two-line wrap.
**Uppercased length is what counts**, so `ß` counts double (`Straßenbau` is 10 characters
and `STRASSENBAU` is 11).

### Development deck (base game)

| id | English | `de` | Chars (upper) | Rationale |
|---|---|---|---|---|
| `knight` | Knight | Ritter | 6 | |
| `victory_point` | Victory Point | Siegpunkt | 9 | Literal |
| `road_building` | Road Building | Straßenbau | 11 upper | Literal. `Wegebau` would require `Weg` for "road" throughout (§2.0) |
| `year_of_plenty` | Year of Plenty | Erntejahr | 9 | "Harvest year". Compact and evocative. `Reiche Ernte` (12) is warmer; the literal `Jahr des Überflusses` (20) does not fit |
| `monopoly` | Monopoly | Monopol | 7 | |

### Trade deck

| id | English | `de` | Chars | Rationale |
|---|---|---|---|---|
| `commercial_harbor` | Commercial Harbor | Handelshafen | 12 | Transparent compound |
| `master_merchant` | Master Merchant | Handelsmeister | 14 | The idiomatic compound. Over the one-line budget; `Kaufmann` (8) would lose "master" |
| `merchant` | Merchant | Händler | 7 | |
| `merchant_fleet` | Merchant Fleet | Handelsflotte | 13 | At the edge of the budget |
| `resource_monopoly` | Resource Monopoly | Rohstoffmonopol | 15 | Over budget, and no shorter form exists |
| `trade_monopoly` | Trade Monopoly | Handelsmonopol | 14 | Faithful for "Trade Monopoly". Over the one-line budget |

`Rohstoffmonopol` and `Handelsmonopol` differ only in their first element, as the English
("Resource Monopoly" / "Trade Monopoly") does; the card art carries the distinction.

### Politics deck

| id | English | `de` | Chars | Rationale |
|---|---|---|---|---|
| `bishop` | Bishop | Bischof | 7 | |
| `constitution` | Constitution | Verfassung | 10 | Faithful. `Urkunde` (7) matches the art (a sealed charter) but translates a word our English does not use |
| `deserter` | Deserter | Deserteur | 9 | |
| `diplomat` | Diplomat | Diplomat | 8 | |
| `intrigue` | Intrigue | Intrige | 7 | |
| `saboteur` | Saboteur | Saboteur | 8 | |
| `spy` | Spy | Spion | 5 | |
| `warlord` | Warlord | Feldherr | 8 | The German commander word, and it fits the card's effect. `Kriegsherr` is the word-for-word rendering and the colder one |
| `wedding` | Wedding | Hochzeit | 8 | |

### Science deck

| id | English | `de` | Chars | Rationale |
|---|---|---|---|---|
| `alchemist` | Alchemist | Alchemist | 9 | |
| `crane` | Crane | Kran | 4 | |
| `engineer` | Engineer | Ingenieur | 9 | |
| `inventor` | Inventor | Erfinder | 8 | |
| `irrigation` | Irrigation | Bewässerung | 11 | |
| `medicine` | Medicine | Medizin | 7 | `Heilkunst` (9) has period flavour but reads as fantasy |
| `mining` | Mining | Bergbau | 7 | |
| `printer` | Printer | Druckerei | 9 | "Print shop". `Druckerpresse` (13) names the machine; `Drucker` (7) is a modern office printer and must not be used |
| `road_building_sci` | Road Building | Straßenbau | 11 upper | **Must be byte-identical to `road_building`**; the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Schmied | 7 | Faithful for "Smith" |

### Card-title length

- **Over the ~13-character one-line budget:** `Rohstoffmonopol` (15), `Handelsmeister`
  (14), `Handelsmonopol` (14), `Handelsflotte` (13, at the edge), `STRASSENBAU` (11
  uppercased, one longer than lower-case).
- **`ß` and umlauts.** `Straßenbau` is the only title with `ß`. `Bewässerung` and `Händler`
  carry umlauts. The card font subset must include `ä ö ü ß`.

---

## 9. UI and system vocabulary

| English | `de` | Rationale |
|---|---|---|
| lobby | Lobby | Established loanword in German game UIs |
| game | Spiel | |
| match (a played game) | Partie | Kept distinct from `Spiel` (game) and `Tisch` (table): `Partiedetails`, `Partieverlauf` |
| match history | Partieverlauf | |
| table (a room of players) | Tisch | The board-game word, and short |
| spectate / watch | zuschauen | Unified |
| spectator | Zuschauer | |
| invite | einladen / Einladung | |
| invite code | Einladungscode | 14 characters |
| seat (noun / verb) | Platz / Platz nehmen | 5 characters against `Sitzplatz`'s 9 |
| host | Host | **Loanword everywhere, including the rules manual.** `Gastgeber` is 9 characters against 4 in table cards, buttons and headers, German game UIs use `Host` routinely, and the manual names the role the lobby shows (`Was der Host wählt`) |
| ready (player) | bereit | The source also uses "Ready" for a *connection* state; those carry a `msgctxt` and are `Verbunden` |
| disconnect | Verbindung getrennt | Long; used only in prose |
| connection lost | Verbindung verloren | Banner heading; `Neu laden` for Reload |
| reconnect | neu verbinden | |
| ban | Sperre / gesperrt | Neutral-formal, right for a punitive action |
| report (a message) | melden | Not `berichten` |
| mute | stummschalten | |
| supporter | Unterstützer | 12 characters |
| cosmetic (item) | Kosmetik | The category |
| decoration (name cosmetic) | Dekoration | One word in every place it appears (errors, lobby label, appearance heading). `Deko` is the colloquial short form if a label clips |
| guest | Gast | |
| leave (a table) | verlassen | |
| rematch | Revanche | 8 characters, exact, and the natural word for "let's play again". `Rückspiel` is sports-specific |
| surrender | aufgeben | |
| draw (a drawn game) | Remis | 5 characters, exact, unambiguous. `Unentschieden` (13) is the everyday word but also means "undecided". Used in the `log.draw*` lines, `log.gameDrawn`, the `error.DRAW_*` messages, `Remis-Angebot` and the offer/accept buttons |
| draw (take a card) | ziehen | No collision with `Remis` |
| win / loss (result labels) | Sieg / Niederlage | `Niederlage` is 10 against `Loss`'s 4; §12 |
| withdraw (an answer) | zurückziehen | |
| counter-offer | Gegenangebot | |
| bot | Bot | |
| ranked | Rangliste / gewertet | Noun and adjective forms. `Ranglistenspiel` (15) does not fit |
| casual (unranked) | Ungewertet | Opposite of `Gewertet` |
| leaderboard | Rangliste | |
| rating | Wertung | Also renders *scoring* (Caravans panel head, `Erkundungswertung`); the two senses never share a surface |
| store | Shop | 4 characters. `Laden` is a physical shop |
| Pips (currency) | Pips | Not translated. Product name |
| settings | Einstellungen | 13 characters, a nav item and a heading |
| appearance | Darstellung | |
| theme | Design | `Thema` means a topic |
| light / dark | Hell / Dunkel | |
| sound / music / volume | Ton / Musik / Lautstärke | |
| language | Sprache | |
| map builder | Karteneditor | `Karte` is overloaded (playing card / map); the compound disambiguates |
| map | Karte | Context disambiguates, as it does in English |
| replay | Replay | Established loanword |
| profile | Profil | |
| tab (a How To Play chapter tab) | Tab | `Reiter` would collide with the Raiders rider |
| turn timer | Zugzeit / Zeitlimit pro Zug | `Zugzeit` on the settings row and lobby label; `Zeitlimit pro Zug` in lobby prose |
| turn-timer presets | Entspannt / Normal / Blitz | `Normal` and `Blitz` are left blank (identical in German) |
| board number placement: Fair | Ausgewogen | Here "fair" means evenly spaced, not unbiased; the other `fair` labels stay `fair` |
| Clear (filters) / Clear (a staged pick) | Zurücksetzen / Leeren | Two different actions in the English; `Reset` is also `Zurücksetzen` |
| Blue-weak / Red-weak (colour-blind modes) | Blauschwäche / Rotschwäche | Tritan and protan in `lib/colorblind.ts` |
| refloors your remaining time | erneuert deine Restzeit | A non-separable verb, so the whole phrase stays inside the `<0>` span the English draws; separable `zurücksetzen` would split across it |

---

## 10. Interface actions

Buttons and menu items. Register: bare infinitive, capitalised (nominalised in this
position), no pronoun.

| English | `de` (button) | Chars (en → de) |
|---|---|---|
| Build | Bauen | 5 → 5 |
| Buy | Kaufen | 3 → 6 |
| Play (a card) | Ausspielen | 4 → 10 |
| Discard | Abwerfen | 7 → 8 |
| Steal | Stehlen | 5 → 7 |
| Move | Bewegen | 4 → 7 |
| Place | Setzen | 5 → 6 |
| End turn | Zug beenden | 8 → 11 |
| Roll | Würfeln | 4 → 7 |
| Offer | Anbieten | 5 → 8 |
| Accept | Annehmen | 6 → 8 |
| Decline / Reject | Ablehnen | 7 → 8 |
| Counter (a trade) | Gegenangebot | 7 → 12 |
| Cancel | Abbrechen | 6 → 9 |
| Confirm | Bestätigen | 7 → 10 |
| Save | Speichern | 4 → 9 |
| Delete | Löschen | 6 → 7 |
| Reset | Zurücksetzen | 5 → 12 |
| Retry / Try again | Erneut versuchen | 9 → 16 |
| Close / Dismiss | Schließen | 5 → 9 |
| Copy link | Link kopieren | 9 → 13 |
| Load more | Mehr laden | 9 → 10 |
| Upgrade to city | Zur Stadt ausbauen | 15 → 18 |
| Activate | Aktivieren | 8 → 10 |
| Promote | Befördern | 7 → 9 |
| Chase robber | Räuber vertreiben | 12 → 17 |
| Equip / Unequip | Anlegen / Ablegen | 5 → 7 |
| Log in / Log out | Anmelden / Abmelden | 6 → 8 |
| Zoom in / Zoom out | Vergrößern / Verkleinern | 7 → 11 |

Every one of these grows. Mean growth across the button set is about +55 %, and the worst
cases (`Buy` → `Kaufen`, `Reset` → `Zurücksetzen`, `Retry` → `Erneut versuchen`) more than
double.

---

## 11. Terms deliberately not translated

- **Player display names, chat bodies, user-saved map names.** User content
  (`docs/user-facing-text.md`, category (c)).
- **Bot display names** (`Bot William`, …). Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values** (`brick`, `paused-error`,
  `trading_house`). Machine tokens.
- **The `debug` field on error frames.** English by contract, never localized.
- **Cosmetic colour names** (`Midnight`, `Periwinkle`, ~64 of them). Brand flavour.
- **`Pips`**, the currency, and **`Costanio`**, the product, including every page title of
  the form `X | Costanio`.
- **Map preset names.** Coined proper names stay (`Archipelago`, `China`, `Japan`,
  `Shores`); geographical names take their German exonym (`UK & Ireland` → `GB & Irland`,
  `United States` → `USA`); the size qualifier translates (`Shores (Small)` →
  `Shores (Klein)`, `Small`/`Medium`/`Large` → `Klein`/`Mittel`/`Groß`), because it is a
  qualifier and not part of the name.

### Deliberate blanks

An empty `msgstr` falls back to the English at runtime. Entries whose only correct German
**is** the English are left blank, because filling them would make `msgstr == msgid`,
which `catalog.test.ts` forbids. The kinds:

- **Pure placeholder frames, no words at all**: `{0}`, `{label}, {total}`,
  `{label}: {n}`, `{name}: {instruction}`, `{ratio}:1 {resource}`, `{staked} → {got}`,
  `2:1 {resource}`, `log.produced` (`{player} <0/>`).
- **Product and platform names**: `Pips`, `Booster`, `Bot`, `Host: {host}`,
  `Lobby | Costanio`.
- **Words German spells identically**: `Host`, `Bank`, `Lobby`, `Land`, `Gold`, `Name`,
  `Details`, `System`, `Budget`, `Route`, `Replays`, `Mission {0}`.
- **Loanword adjectives German uses as-is**: `fair`, `Fair`, `online`, `offline` (but see
  `Ausgewogen`, §9).
- **Card titles identical in both languages**: `Alchemist`, `Diplomat`, `Saboteur`.
- **Map preset proper names**: `Archipelago`, `China`, `Japan`.
- **Turn-timer preset names**: `Blitz` and `Normal` (`msgctxt "turn timer preset"`).

No blank entry carries an ICU plural: a plural-bearing message is always written out, so
both arms exist. `Metro` (the metropolis column) is **not** left blank, because in German
`Metro` names the underground railway first.

---

## 12. Length and overflow

Across the catalogue the German is about **1.2× the English** at the median and mean. The
risk is the tail: short English strings (14 characters or fewer) that grow by 6 or more,
because those live in fixed-width chrome.

### Strings that grow most

| English | German | Growth |
|---|---|---|
| `Reconnecting…` | `Verbindung wird wiederhergestellt…` | +21 |
| `Tap to rejoin` | `Tippen, um erneut beizutreten` | +16 |
| `Dev cards held` | `Gehaltene Entwicklungskarten` | +14 |
| `Save failed` | `Speichern fehlgeschlagen` | +13 |
| `Merging…` | `Wird zusammengeführt…` | +13 |
| `Rejoin` (from a bot) | `Platz zurücknehmen` | +12 |
| `Retry` / `Try again` | `Erneut versuchen` | +11 / +7 |
| `Reset view` | `Ansicht zurücksetzen` | +10 |
| `Detailed stats` | `Detaillierte Statistiken` | +10 |
| `Event log` | `Ereignisprotokoll` | +8 |
| `Reset` | `Zurücksetzen` | +7 |
| `Small caught` / `Large caught` | `Kleine` / `Große Fische gefangen` | +10 / +9 |

### Where the UI is tight

| Where | English | German |
|---|---|---|
| Connection status pill | `Reconnecting…` | `Verbindung wird wiederhergestellt…`: one line on desktop, wraps to two lines on a phone without clipping. `Verbindung…` is the shortening if one line is required |
| Board action pill | `Chase robber` / `Upgrade to city` | `Räuber vertreiben` / `Zur Stadt ausbauen` |
| Result label on a match row | `Loss` | `Niederlage` |
| Piece-supply rail | `City walls` | `Stadtmauern`, in a rail tuned to `Settlements` |
| Improvement panel | `Science` | `Wissenschaft`, in a three-column panel |
| Trade panel headers | `You give` / `You get` | `Du gibst` / `Du bekommst` |
| Hand shelf, card-type labels | `Progress cards` / `Development cards` | `Fortschrittskarten` / `Entwicklungskarten` |
| Scoreboard and status panel | `Strength 1/2/3 knights` | `Ritter der Stärke 1/2/3`, one label for both surfaces (§7) |
| Card titles | | §8 |

The post-game scoreboard sizes its cells to their content: column heads render whole, and
long stat-row labels (`Gehaltene Entwicklungskarten`, `Länge der längsten Handelsroute`,
`Fortschrittskarten gespielt`) wrap to two lines rather than clip. The lobby setting labels
(`SIEGPUNKTZIEL`, `ZEITLIMIT PRO ZUG`) and `Sitzreihenfolge` beside `Zufällig` fit at
desktop and phone widths.

Also tight: `Kaufen` (Buy), `Gegenangebot` (Counter), `Zug beenden` (End turn),
`Einstellungen` (Settings), `Verteidiger des Reiches`, `Barbarenangriff`,
`Ereigniswürfel`, `Einladungscode`, `Karawanenroute`, `Inselentdeckung`.

### Shortenings the catalogue uses

- `Siegpunkt` → `SP` in tight HUD space (§3).
- `Gastgeber` → `Host` everywhere (§9).
- `Unentschieden` → `Remis` everywhere (§9).
- `Zeitlimit pro Zug` → `Zugzeit` on the settings row and lobby label.
- `Fortschrittskarte` → `Karte` where the deck is already named in the same sentence.
- `Stadtmauer` → `Mauer`, `Barbarenflotte` → `Flotte`, `den Räuber vertreiben` →
  `Vertreiben` on buttons and short labels.

---

## Checks

`scripts/po_verify.py de` checks the catalogue mechanically against `en` (ids,
placeholders, tags and ICU arguments, plural arms, no `msgstr` equal to its `msgid`, no
blank entry whose English carries a plural).
