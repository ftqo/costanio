# Dutch (`nl`) terminology glossary

The terminology, register and grammar conventions the Dutch catalogue
(`frontend/src/locales/nl/messages.po`) follows. A term chosen here recurs in hundreds of
strings, so changing one is a catalogue-wide edit: read the relevant section before adding
or rewording an entry.

**Sources:** `frontend/src/locales/en/messages.po` (the English is the source of truth),
`docs/rules/`, `art/cards/cards.json`, `frontend/src/locales/README.md`,
`docs/i18n/CONTRIBUTING.md`.
**Companions:** `glossary-de.md` (nearest relative), `glossary-it.md`, `glossary-es.md`,
`glossary-zh-Hans.md`, `glossary-ja.md`. This document follows their structure so they can
be read against each other.

Section numbers are stable and are cited from translator comments in the catalogue; gaps
in the numbering are intentional.

---

## 1. Register and global decisions

### Formality: `je`, everywhere, no exceptions

The English source is chatty and informal throughout, and `u` against that source produces a
register clash on every screen. Dutch consumer software and Dutch board-game rules have both
settled on `je`, and Microsoft's Dutch style guide documents the same industry-wide movement
away from `u`. Flemish players skew somewhat more `u`-tolerant, but `je` is correct for both
markets. The catalogue contains no `u` or `uw` used as a pronoun.

Dutch printed rules often switch to third-person `hij` for the active player in procedural
passages ("de speler … hij mag"), reserving `je` for direct address. This catalogue does
**not** do that: our English addresses the reader as "you" throughout, including in
procedure, so the Dutch holds `je` there too.

The legal surfaces follow the same register. Only the page *titles* of Terms and Privacy are
in this catalogue today; when that copy is localized it stays `je`.

### Surface register

| Surface | Register | Example |
|---|---|---|
| Board action pills | Bare stem imperative | `Bouw`, `Gooi`, `Sla over` |
| Dialog buttons | Stem imperative or noun | `Annuleer`, `Bevestig`, `Instellingen` |
| Prompts | `je` imperative | `Tik op een veld om te plaatsen` |
| Errors | Impersonal or 2sg | `Daar kun je niet bouwen`, `Je hebt niet genoeg grondstoffen` |
| Event log | 3rd person, present | `{player} bouwt een weg` |
| Rules manual | `je`, explanatory present | `Elke beurt gooi je twee dobbelstenen` |
| Toasts | Short, 2sg | `Beurt overgeslagen` |

**Buttons: bare-stem imperative, except where the verb takes an object or a separable
particle, which Dutch writes as an infinitive.** `Bouw`, `Accepteer`, `Weiger`, `Annuleer`,
`Bevorder`, `Activeer`, `Verplaats`, `Neem plaats`, `Sla op`, `Laad opnieuw`, `Verstuur`.
The imperative matches the `je` register and is a syllable shorter, which this layout needs.
The infinitive labels are the object/particle cases (`Bot toevoegen`, `Speler verwijderen`,
`Bericht melden`, `Havens wissen`, `Kaartcode kopiëren`, `Opnieuw proberen`, `Verlaten &
toekijken`, `Intrekken`, `Ongedaan maken`) and nav items or headings used as nouns
(`Spelen`, `Toekijken`, `Afleggen` as a panel heading). `Clear` and `Reset` are `Wis`.

The same English word can take both forms on different surfaces, and that is correct:
`Discard` is `Afleggen` as a tray heading and stat label, and `Leg af` on the button.

**Separable verbs split in sentences and stay attached in labels.** `Je legt twee kaarten
af` in prose, `Leg af` on the button.

### Capitalization

Dutch uses **sentence case**, not English title case: `Einde beurt`, not `Einde Beurt`.
Headings that the UI shows in capitals get them from a CSS `uppercase` class, so the msgstr
is sentence case (`Hoofdstukken`, `Problemen`, `Deel een code`, `Tegels`, `Jouw kaarten`).
The exceptions:

- **The 30 card titles** (§8) are single capitalized words or capitalized compounds:
  `Wegenbouw`, `Meesterkoopman`, `Jaar van Overvloed`. Dutch compounds mean most titles are
  one word, which sidesteps the title-case question.
- **The awards** (`Langste weg`, `Grootste leger`) capitalize only the first word.
- **The improvement tracks** (`Handel`, `Politiek`, `Wetenschap`) are capitalized as named
  tracks; the ordinary nouns are not.
- **Nationality adjectives are lowercase** (`nederlands`), language and country *nouns* are
  capitalized (`Nederlands`, `Nederland`).

### Punctuation

- **No em dash (U+2014).** Dutch prefers a comma, colon or parentheses for the same job.
- **Quotes:** where the rules manual quotes a phrase, single quotes `'…'`; where a UI label
  quotes user data, the straight double quotes of the source stay.
- **The apostrophe in plurals** (`scenario's`, `foto's`) is required Dutch orthography after
  a bare vowel, not an English possessive.
- **No space before `?` `!` `:` `;`.**
- **Label and value.** Where a runtime noun cannot be grammatically integrated, it goes after
  a colon as a label (`Eén minder bieden: {name}`, `Stemmen: {total}`). This is the house
  pattern for runtime values that would otherwise need agreement.

### Plurals

Dutch has the same two ICU plural categories as English, `one` and `other`, so every
`{n, plural, one {…} other {…}}` keeps both arms and both are used.

- **The plural is `-en` or `-s`**: `wegen`, `steden`, `schepen`, `ridders`, `havens`,
  `velden`.
- **Mass nouns do not inflect**: `# hout`, `# tarwe`, `# erts`, `# papier` in both arms.
  Identical arms on a mass noun are correct.
- **`schaap` → `schapen`** and **`stad` → `steden`** are the irregulars to watch.
- **All plurals take `de`**, whatever the singular's article: `het schaap` but `de schapen`.
  A string that pluralizes a resource switches article in the `other` arm.
- **`alle` cannot govern a singular.** An English `all {n} cards` with a `one` arm must not
  become `alle 1 kaart`; write the `one` arm without the numeral (`je kaart`). ICU permits an
  arm without `#`.

---

## 2. Naming policy: the rule, and how it applies in Dutch

### 2.0 The rule in force

> **Translate our English faithfully. Only the game title and the expansion names diverge.**

Our own English card names are descriptive phrases, so a Dutch translation that dodges the
natural Dutch for them is *less faithful than the source*, for no benefit.

- **Translate straight, even where the result is familiar board-game Dutch:** all card
  titles, resource names, mechanic names, settlement, road, city, port, robber, development
  card, progress card.
- **Diverges:** the game's title (`Costanio`, untranslated), and the expansion
  names, which are *ours* translated: **Eilanden**, **Ridders**, **Scenario's**, and the
  scenario names of §6.

### 2.1 Translate our words, not the words a player might expect

Some Dutch board-game vocabulary a player may know translates *different concepts* from our
English. Follow our English:

| Our English | Faithful Dutch (**ours**) | Not this | What that word actually means |
|---|---|---|---|
| settlement | **nederzetting** | dorp | *village* |
| road | **weg** | straat | *street* |
| robber | **rover** | struikrover | *highwayman* |
| Year of Plenty | **Jaar van Overvloed** | Uitvinding | *Invention* |
| Largest Army | **Grootste leger** | Grootste riddermacht | *greatest knight-might* |
| Longest Road | **Langste weg** | Langste handelsroute | *longest trade route* |

`nederzetting` is the Dutch for "settlement", `weg` for "road", `rover` for "robber". Each is
the plainest available word and is what a translator working from our English produces
without effort. `dorp` is 8 characters shorter than `nederzetting`, but the policy rules out
substituting a different ordinary noun for the faithful one.

### 2.2 The choices that are not the most obvious rendering, and why each survives

| Term | Our `nl` | Why |
|---|---|---|
| Islands (expansion) | **Eilanden** | Our expansion is named "Islands"; we translate ours |
| Knights (expansion) | **Ridders** | Same |
| Scenarios (module) | **Scenario's** | Same |
| the game | **Costanio** | Untranslated proper noun |
| settlement / road / robber | **nederzetting** / **weg** / **rover** | Faithful; §2.1 |
| pirate | **piraat** | Faithful. `zeerover` is "sea-robber" and would collide with our `rover` |
| sheep | **schaap** | Our English says "Sheep", not "Wool", so `schaap` and not `wol` |
| wheat | **tarwe** | Our English says "Wheat", not "Grain", so `tarwe` and not `graan` |
| brick / clay | **baksteen** / **klei** | Our English separates the `Brick` resource from the `Clay` terrain; Dutch maps that split exactly |
| progress card | **voortgangskaart** | Distinct from `ontwikkelingskaart`, because this game has both decks in the same UI |
| victory point | **overwinningspunt** | Faithful. `zegepunt` is shorter but is not the faithful word |
| hex (board space) | **veld** | See §3.1 |
| intersection | **kruispunt** | Our English says "intersection", not "three-way" (`driesprong`) or "corner" (`hoek`) |
| edge | **zijde** | Our English says "edge" |
| city improvement | **stadsverbetering** | Our English says "improvement" |
| event die | **gebeurtenisdobbelsteen** | Faithful, and 22 characters (§12). `symbooldobbelsteen` is not shorter and means something our English does not say |
| defender of the realm | **Verdediger van het rijk** | Faithful |
| Road Building (card) | **Wegenbouw** | Follows our `weg` |

**Ordinary words, not leaks.** `stad`, `ridder`, `haven`, `eiland`, `schip`, `barbaren`,
`metropool`, `stadsmuur`, `monopolie`, `bisschop`, `diplomaat`, `spion`, `intrige`,
`ingenieur`, `uitvinder`, `irrigatie`, `mijnbouw`, `papier`, `munt`, `aquaduct`,
`overwinningspunt`, `ontwikkelingskaart`, `bos`, `weide`, `woestijn`, `hout`, `erts` are the
ordinary Dutch words for the ordinary English words our source uses.

---

## 3. Core game nouns

**The article column matters most in this table.** Dutch gender is not
derivable from the noun, and it drives every article, demonstrative, relative pronoun and
attributive `-e` (`het kleine schip` but `de kleine stad`).

| English | `nl` | Article | Plural | Chars | Note |
|---|---|---|---|---|---|
| road | weg | **de** | wegen | 3 | Faithful |
| settlement | nederzetting | **de** | nederzettingen | 12 | Faithful; §2.1. Compounds: `beginnederzetting`, `kustnederzetting`, `havennederzetting` |
| city | stad | **de** | steden | 4 | Irregular plural |
| building (cover term) | bouwwerk | **het** | bouwwerken | 8 | Covers road, settlement, city and ship; `gebouw` would exclude roads |
| game pieces | stukken | **de** (pl.) | | 7 | The general word; `speelstukset` for a store set |
| ship | schip | **het** | schepen | 5 | Irregular plural |
| city wall | stadsmuur | **de** | stadsmuren | 9 | |
| knight (piece) | ridder | **de** | ridders | 6 | |
| hex (board space) | veld | **het** | velden | 4 | §3.1. Terrain compounds: `bosveld`, `weideveld`, `bergveld`, `akkerveld`, `goudveld`, `zeeveld`, `landveld`, `waterveld` |
| tile (map builder, drawn tile) | tegel | **de** | tegels | 5 | §3.1 |
| hexagon (geometry) | zeshoek | **de** | zeshoeken | 7 | Only where the shape is the point |
| vertex / intersection | kruispunt | **het** | kruispunten | 9 | English uses both words; unified. `hoek` only where the English says "corner" |
| edge / path (between vertices) | zijde | **de** | zijden | 5 | Kept apart from `rand`, the map border, and from `pad`. Compounds: `zeezijde`, `kustzijde`, `landzijde`, `doelzijde` |
| border (of the map) | rand | **de** | randen | 4 | |
| spot (placeable position) | plek | **de** | plekken | 4 | Also the seat at a table (§9) |
| port / harbor | haven | **de** | havens | 5 | English uses both; unified |
| generic port (3:1) | algemene haven | **de** | | 14 | Ratio label `3:1 algemeen` |
| specific port (2:1) | speciale haven | **de** | | 14 | |
| robber | rover | **de** | rovers | 5 | Faithful; §2.1. The robber on land is `de rover op het land`, never `landrover` |
| pirate | piraat | **de** | piraten | 6 | §2.2 |
| merchant (piece) | koopman | **de** | kooplieden | 7 | Irregular plural |
| longest road | Langste weg | **de** | | 11 | |
| longest route / trade route | Langste handelsroute | **de** | | 20 | Islands award; covers roads *and* ships. A generic "longest route" in running text is lowercase `langste route` |
| largest army | Grootste leger | **het** | | 14 | |
| victory point (VP) | overwinningspunt (**OP**) | **het** | ‑punten | 16 / 2 | Point values are written `+1 OP`, never `pt` |
| development card | ontwikkelingskaart | **de** | ‑kaarten | 18 | |
| progress card | voortgangskaart | **de** | ‑kaarten | 15 | §2.2 |
| resource | grondstof | **de** | grondstoffen | 9 | |
| commodity | handelswaar | **de** | handelswaren | 11 | |
| bank | bank | **de** | | 4 | |
| supply | voorraad | **de** | voorraden | 8 | The source distinguishes "bank" and "supply"; preserved |
| trade (player to player) | ruil / ruilen | **de** | ruilen | 4 | §11 |
| trade (with the bank, harbour or supply) | wisselen | | | 8 | §11 |
| trade offer | aanbod | **het** | | 6 | `Jouw aanbod`. Not `bod`, which is the Caravans bid; `tegenbod` is the counter-offer |
| turn | beurt | **de** | beurten | 5 | |
| round | ronde | **de** | ronden | 5 | |
| die / dice | dobbelsteen / dobbelstenen | **de** | | 11 / 13 | |
| dice roll (the act) | worp | **de** | worpen | 4 | Button copy: `Gooi` |
| number token | nummerfiche | **het** | ‑fiches | 11 | Short form `nummer`. `het fiche` is the Netherlands-Dutch form for a gaming counter (Belgian usage may say `de fiche`) |
| token (generic, scenario chip) | fiche | **het** | fiches | 5 | Compounds written solid: `Verdedigerfiche`, `Koopmansfiche` (linking `-s`, as `Koopmansgilde`) |
| hand | hand | **de** | handen | 4 | |
| hand limit | handlimiet | **de** | | 10 | |
| discard limit | afleglimiet | **de** | | 11 | |
| deck | stapel | **de** | stapels | 6 | Named decks: `Stapel Handel`, `Stapel Politiek`, `Stapel Wetenschap` |
| setup (initial placement) | beginopstelling | **de** | | 15 | Kept apart from `spelconfiguratie` |
| game setup (configuration) | spelconfiguratie | **de** | | 16 | |
| production | opbrengst | **de** | opbrengsten | 9 | `productie` is the industrial sense; `opbrengst` is a yield |
| discard (v / n) | afleggen / aflegstapel | **de** | | 8 / 12 | Separable verb: `Je legt af` |
| board (the playing board) | speelbord | **het** | | 9 | Running manual prose may use the bare `bord` where the compound is heavy; cross-references quote the heading exactly (`Het speelbord opzetten`) |
| scoreboard (in game) | scorebord | **het** | | 9 | Kept distinct from `ranglijst`, the site leaderboard |
| pips | **Pips** | | | 4 | Untranslated; also the store currency, §15 |
| land mix | landverdeling | **de** | | 13 | |
| swap (tokens) | verwisselen | | | 11 | Matches the event log |

### 3.1 `veld` and `tegel`

**`veld` is the word for a board hex**, in prose, prompts, errors and every terrain compound.
It is what the board-size table's column header (`Velden`) says, and in Dutch board-game
usage `tegel` names the cardboard piece rather than the terrain printed on it.

**`tegel` is reserved for** the map builder's painted tile (its panels already say `Tegels`)
and the Fishermen fish tile (`vistegel`), which a player physically draws. Do not mix the
two words for the same hex within a string or paragraph, and when rewording a string that
still says `tegel` for a board hex, move it to `veld`. The article moves with the word
(`het veld`, `de tegel`), so every article, demonstrative and relative pronoun in the
sentence moves too: this is never a find-and-replace.

A hex label that fills a slot such as `naast {a}` carries its article: `de woestijn`,
`het meer`, `het goudveld`.

### 3.2 The gender-neutral possessive

English `their` over a runtime player name has no neutral Dutch equivalent. In order of
preference:

1. **Drop the possessive** when the possessor is the subject of the same sentence:
   `{player} activeert de ridders` says everything `their knights` says.
2. **Name the possessor** when it is an object and a name is available: `je ziet de hand
   van {0}`.
3. **`hun`** where the possessor is a runtime name in another clause and no rephrase is
   available (the `card.allTheirs.*` family: `Dat is al hun hout`; `Ruil met {0} op hun
   tegenbod`).

`diens` refers back to a *non-subject* antecedent only, so it is ungrammatical where the
possessor is the sentence's own subject. `de eigen` is grammatical but reads as legalese in
a live event-log line. `zijn` picks a gender over a name that may be anyone's.

### Terrain

| English | `nl` | Article |
|---|---|---|
| forest | bos | **het** |
| clay (the terrain) | klei | **de** |
| hill | heuvel | **de** |
| pasture | weide | **de** |
| field | akker | **de** |
| mountain | berg | **de** |
| desert | woestijn | **de** |
| sea | zee | **de** |
| gold | goud | **het** |
| lake | meer | **het** |
| fog | mist | **de** |
| land | land | **het** |
| swamp | moeras | **het** |

Where a progress card names a terrain hex, the compound is built on the terrain word, not the
resource: `bergveld`, `akkerveld` (not `ertsveld`, `tarweveld`).

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and Dutch
preserves the split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **bos** (het) | `Wood` → **hout** (het) |
| `Clay` → **klei** (de) | `Brick` → **baksteen** (de) |
| `Pasture` → **weide** (de) | `Sheep` → **schaap** (het) |
| `Field` → **akker** (de) | `Wheat` → **tarwe** (de) |
| `Mountain` → **berg** (de) | `Ore` → **erts** (het) |

| English | `nl` | Article | Mass / count | Plural | Chars |
|---|---|---|---|---|---|
| wood / lumber | hout | **het** | mass | | 4 |
| brick | baksteen | **de** | count | bakstenen | 8 |
| sheep | schaap | **het** | count | schapen | 6 |
| wheat | tarwe | **de** | mass | | 5 |
| ore | erts | **het** | mass | | 4 |
| gold | goud | **het** | mass | | 4 |
| cloth | doek | **het** | mass | doeken | 4 |
| paper | papier | **het** | mass | | 6 |
| coin | munt | **de** | count | munten | 4 |

Dutch has two genders, `de` and `het`, neither marked on the noun's own form; there are no
case endings and no gender agreement on the noun itself. What agrees is the definite
article, the demonstrative and the attributive adjective's `-e` (`een klein schaap` but
`een kleine munt`), which is why the article is recorded per noun.

`doek` is `het doek` as cloth the material (the commodity); `de doek` is a specific cloth
object (`de theedoek`). `munt` is both the Knights commodity and a coin as currency; the
store currency is `Pips` (§15), so the two never meet.

Resource names are passed into strings as the `msgctxt "resource"` entry (`Schaap`,
`Tarwe`): capitalised and in citation form. Dutch marks no case on the noun, so the
standalone-label form and the form used inside a sentence are the same word; only
capitalization differs.

---

## 5. Islands expansion

| English | `nl` | Article | Note |
|---|---|---|---|
| Islands (the expansion) | Eilanden | de | Our own expansion name, translated |
| ship | schip | **het** | |
| sea edge / coastal edge | zeezijde / kustzijde | **de** | |
| ship route | scheepsroute | **de** | |
| open ship (movable end) | schip aan het open uiteinde | | No compact Dutch noun; `open uiteinde` in prompts |
| pirate | piraat | **de** | §2.2 |
| gold hex | goudveld | **het** | A gold-hex payout is taken `van een goudveld`, never `voor goud` (reads as a price) |
| longest trade route | Langste handelsroute | **de** | The route counts roads *and* ships |
| island | eiland | **het** | |
| island discovery | Eilandontdekking | **de** | Scoreboard short form `Eilanden` |
| island bonus | eilandbonus | **de** | |
| landmass | landmassa | **de** | |

---

## 6. Scenario expansions

Registered under `module.tab` → **Scenario's**. Scenario names are faithful renderings of our
own English titles.

| English | `nl` | Article | Note |
|---|---|---|---|
| Fishermen | Vissers | | |
| fishing ground | visgrond | **de** | Singular on a hover card: `Visgrond` |
| fish tile | vistegel | **de** | |
| fish (as a spendable currency) | vis | **de** | |
| the old boot | Oude laars | **de** | Meant to be undignified, which is the point of the token |
| Caravans | Karavanen | | |
| camel | kameel | **de** | |
| oasis | oase | **de** | |
| caravan route | karavaanroute | **de** | |
| caravan point | karavaanpunt | **het** | |
| camel junction | kamelenkruispunt | **het** | 16, unbreakable |
| bid (v / n) | bieden / bod | **het** | `Niets bieden` for bidding nothing: it is an answer, not a skipped round |
| vote (Caravans) | stemming / stemmen | **de** | `Stemmen: {total}`, label and value |
| a road credit | een tegoed voor een weg | | The spend buys the credit; the road is a later move |
| Rivers | Rivieren | | |
| Raiders | Plunderaars | | |
| Wagons | Wagens | | |
| Explorers | Ontdekkers | | |
| Harbormaster | Havenmeester | | |
| raider | plunderaar | **de** | Never `rover`, which is the robber |
| rider | ruiter | **de** | |
| castle | burcht | **de** | Raiders and Wagons alike |
| Muster / Swift Rider / Treason / Intrigue | Oproep / Snelle ruiter / Verraad / Intrige | | |
| prisoner | gevangene | **de** | |
| place in reach (rider) | bereikbare zijde | **de** | A rider ends on a path, so the count names paths |
| bridge / bridge site | brug / brugplaats | **de** | |
| watercourse | waterloop | **de** | |
| coins (Rivers) | munten | **de** | Same word as the Knights commodity, as in the English |
| Wealthiest / Poorest Settler | Rijkste / Armste kolonist | **de** | `Armste kolonist-tegel` for the tile |
| wealth tiles | rijkdomstegels | **de** | |
| harbour points | havenpunten | **de** | |
| wagon | wagen | **de** | Upgrading a wagon is `opwaarderen`; a settlement is `uitbouwen` (§11) |
| load / cargo | lading | **de** | |
| plaza | plein | **het** | `plek` is the seat |
| trade hex | handelsveld | **het** | |
| quarry / glassworks | steengroeve / glasblazerij | **de** | |
| marble / glass / sand / tools | marmer / glas / zand / gereedschap | | |
| toll | tol | **de** | |
| ford | voorde | **de** | |
| Swift Journey | Snelle reis | **de** | |
| settler / crew | kolonist / bemanning | **de** | |
| fish haul / spice sack | visvangst / specerijenzak | **de** | |
| shoal | school (visschool) | **de** | |
| pirate lair | piratennest | **het** | |
| the Council | de Raad | | |
| harbour settlement | havennederzetting | **de** | |
| hold | ruim | **het** | |
| Swift Voyage / Pirate Bonus / Fast Gold | Snelle vaart / Piratenbonus / Snel goud | | |
| consolation gold (Explorers) | troostgoud | **het** | |
| exploration point | verkenningspunt | **het** | |
| movement spaces (Explorers) | stappen | | `plaatsen` is the cargo slot |
| mission marker | missiemarkering | **de** | |
| "on its own" (a scenario played alone) | op zichzelf | | `alleen` reads as "only" |

---

## 7. Knights expansion

| English | `nl` | Article | Note |
|---|---|---|---|
| Knights (the expansion) | Ridders | | Our own expansion name, translated |
| knight (piece) | ridder | **de** | |
| knight tiers | **ridder met kracht 1 / 2 / 3** | | Numbered throughout, as in the English. Labels: `Ridders van kracht 1/2/3`; build row `Bouw ridder kracht 1`; error `Ridders met kracht 3 hebben Politiek niveau 3 nodig.` |
| strength | kracht | **de** | |
| activate | activeren; actief / inactief | | |
| promote | bevorderen | | §11 |
| displace | verdringen | | |
| chase the robber | de rover verjagen | | Board action `Verjaag` |
| progress card | voortgangskaart | **de** | §2.2 |
| city improvement | stadsverbetering | **de** | 16, unbreakable |
| improvement track | verbeteringsspoor | **het** | `het spoor` (`de spoor` is a spur). Used only where the source needs the abstraction |
| advance a track (verb) | verbeteren | | §11. `vorderen` cannot take the track as an object (`vorder Handel` is ungrammatical) |
| Trade / Politics / Science | Handel / Politiek / Wetenschap | | Named tracks, capitalized. Cost labels: `Handel · kost doek`, `Politiek · kost munten`, `Wetenschap · kost papier` |
| commodity | handelswaar | **de** | |
| metropolis | metropool | **de** | |
| event die | gebeurtenisdobbelsteen | **de** | 22, unbreakable; §12 |
| barbarians / barbarian fleet | barbaren / barbarenvloot | **de** | |
| barbarian attack | barbareninval | **de** | The source uses "attack", "invasion" and "landfall"; unified except where the source contrasts them |
| barbarian distance | barbarenafstand | **de** | |
| pillage / raze a city | plunderen | | `degraderen` is mechanically accurate and bloodless; the source is not. "destroyed" is `verwoest` |
| defender of the realm | Verdediger van het rijk | **de** | Token: `Verdedigerfiche` |
| Merchant Guild | Koopmansgilde | **het** | `het gilde`. Wire name `trading_house` must not change |
| Fortress / Aqueduct | Vesting / Aquaduct | **de** / **het** | |

---

## 8. The 30 card titles

These composite over the card art at runtime, as display type at large size *and* at a small
hand thumbnail. Compounding turns many two-word English titles into one short Dutch word
(`Road Building` → `Wegenbouw`, `Commercial Harbor` → `Handelshaven`).

**Soft hyphens are data, not noise.** The runtime title layer (`lib/cardTitle.ts`,
`components/asset/CardTitlePlate.tsx`, tested by `lib/cardTitle.test.ts`) fits long titles
by breaking at authored U+00AD soft hyphens. Dutch carries six:
`Grondstoffen­monopolie`, `Handels­haven`, `Handels­monopolie`, `Koopmans­vloot`,
`Meester­koopman`, `Overwinnings­punt`. **Do not strip them; if a title is rewritten, put the
seam back in the new word.**

### Development deck

| id | English | `nl` | Chars | Note |
|---|---|---|---|---|
| `knight` | Knight | Ridder | 6 | |
| `victory_point` | Victory Point | Overwinningspunt | 16 | Soft hyphen |
| `road_building` | Road Building | Wegenbouw | 9 | Follows our `weg` |
| `year_of_plenty` | Year of Plenty | Jaar van Overvloed | 18 | §2.1 |
| `monopoly` | Monopoly | Monopolie | 9 | |

### Trade deck

| id | English | `nl` | Chars | Note |
|---|---|---|---|---|
| `commercial_harbor` | Commercial Harbor | Handelshaven | 12 | |
| `master_merchant` | Master Merchant | Meesterkoopman | 14 | Follows our `koopman` |
| `merchant` | Merchant | Koopman | 7 | |
| `merchant_fleet` | Merchant Fleet | Koopmansvloot | 13 | Pairs with `Koopman`; `Handelsvloot` would pair with `Handelshaven` instead |
| `resource_monopoly` | Resource Monopoly | Grondstoffenmonopolie | 21 | The longest title; breaks at its soft hyphen |
| `trade_monopoly` | Trade Monopoly | Handelsmonopolie | 16 | Must stay visibly distinct from `resource_monopoly` at thumbnail size |

### Politics deck

| id | English | `nl` | Chars | Note |
|---|---|---|---|---|
| `bishop` | Bishop | Bisschop | 8 | |
| `constitution` | Constitution | Grondwet | 8 | The Dutch for a written constitution. `Constitutie` is a Latinate borrowing that reads as medical in ordinary Dutch |
| `deserter` | Deserter | Deserteur | 9 | |
| `diplomat` | Diplomat | Diplomaat | 9 | |
| `intrigue` | Intrigue | Intrige | 7 | |
| `saboteur` | Saboteur | Saboteur | 8 | Identical to the English; entry left blank (§15) |
| `spy` | Spy | Spion | 5 | |
| `warlord` | Warlord | Krijgsheer | 10 | The exact Dutch compound. `Veldheer` is a field marshal, a legitimate commander, and the weaker reading of our English |
| `wedding` | Wedding | Bruiloft | 8 | |

### Science deck

| id | English | `nl` | Chars | Note |
|---|---|---|---|---|
| `alchemist` | Alchemist | Alchemist | 9 | Identical to the English; entry left blank (§15). `Alchimist` is not used, so the entry stays a true blank |
| `crane` | Crane | Kraan | 5 | |
| `engineer` | Engineer | Ingenieur | 9 | |
| `inventor` | Inventor | Uitvinder | 9 | |
| `irrigation` | Irrigation | Irrigatie | 9 | |
| `medicine` | Medicine | Geneeskunde | 11 | The discipline. `Medicijn` is the substance, the wrong reading |
| `mining` | Mining | Mijnbouw | 8 | |
| `printer` | Printer | Drukker | 7 | The trade; the card art is a press and its operator. `Boekdrukkunst` is the discipline, not a person |
| `road_building_sci` | Road Building | Wegenbouw | 9 | **Must be byte-identical to `road_building`**: the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Smid | 4 | |

The `uppercase` + `letter-spacing` treatment is fine for Dutch, which has no accented
capitals in this set.

---

## 9. UI and system vocabulary

| English | `nl` | Article | Note |
|---|---|---|---|
| lobby | lobby | **de** | The established Dutch loan for this screen; `hal` is a physical hall |
| table (a game room) | tafel | **de** | The source's own metaphor |
| game (a match) | partij | **de** | `spel` is the game as a product; `partij` is one instance of play |
| match record | partijverslag | **het** | |
| ruleset / mode | modus | **de** | The source uses both interchangeably; Dutch unifies |
| spectate / spectator | toekijken / toeschouwer | **de** | |
| invite / invite code | uitnodiging / uitnodigingscode | **de** | `uitnodigingscode` is 16, unbreakable |
| seat / open seat | plek / vrije plek | **de** | `zitplaats` is a physical seat in a room. Seat colour: `Plekkleur`; in prose `de kleur van je plek` |
| host (noun) | organisator | **de** | `gastheer` is explicitly male |
| host (verb, "start a game") | maak | | `Maak een tafel` |
| ready (player) | klaar | | |
| ready (connection) | verbonden | | Two "Ready" strings with different `msgctxt`; two Dutch words |
| disconnect / reconnect | verbinding verbreken / opnieuw verbinden | | Connection lost: `Verbinding verbroken`; reload: `Laad opnieuw` |
| ban | schorsing | **de** | |
| report (a message) | melden | | |
| mute | dempen | | |
| supporter | donateur | **de** | `supporter` is a sports fan in Dutch; `donateur` says what the role is |
| cosmetic (item) | decoratie | **de** | The codebase calls them decorations |
| store item | artikel | **het** | |
| equipment slot | vak | **het** | Used across the store errors and `Pick a slot first.` |
| equipped | In gebruik | | Not `Uitgerust`, which also reads as "well-rested" |
| guest | gast | **de** | |
| leave / rematch / surrender | verlaten / revanche / opgeven | | |
| draw (a drawn game) | gelijkspel | **het** | Never confuse with "draw a card" (§11) |
| bot | bot | **de** | |
| ranked / casual | competitief / vrijblijvend | | `gerangschikt` describes a list, not a match |
| leaderboard | ranglijst | **de** | |
| rating / unrated | rating / Geen rating | **de** | The established term in online play; `waardering` is a review score. `Geen rating` labels a player in both call sites |
| store | winkel | **de** | |
| Pips (the currency) | Pips | | Untranslated; a product name |
| settings | Instellingen | | |
| theme / light / dark / system | thema / licht / donker / systeem | **het** | |
| map builder | kaarteneditor | **de** | `kaartenbouwer` is a calque |
| curated map | samengestelde kaart | **de** | |
| preset | voorinstelling | **de** | Board preset names are not in the catalogue; turn-timer presets are `Ontspannen` / `Normaal` / `Blitz` |
| brush / paint / randomize | kwast / tekenen / willekeurig maken | **de** | |
| turn timer / turn order | beurtklok / beurtvolgorde | **de** | |
| random seed | startwaarde | **de** | Consistent across the fairness paragraphs |
| replay | herhaling | **de** | |
| forfeit | opgave | **de** | |
| swatch (colour) | kleurstaal | **het** | |
| friendly robber | vriendelijke rover | **de** | Adjective takes `-e` after `de` |
| Save | Sla op | | All `Save` buttons |
| Reset view | Herstel weergave | | Both the board and the game control |
| Activity (Discord) | Activity | | Discord's own product name, untranslated |

---

## 10. Interface actions

Buttons and menu items: **bare stem imperative** (with the §1 exceptions), sentence case, no
final period.

| English | `nl` | Note |
|---|---|---|
| Build | Bouw | |
| Build knight | Bouw ridder | |
| Build / Trade (HUD pill) | Bouwen / Ruilen | |
| Buy / Play (a card) | Koop / Speel | |
| Draw (a card) | Trek | Never `steel` (§11) |
| Discard | Leg af | Separable verb; the particle follows in a sentence |
| Dismiss (a toast) | Sluit | Not `leg af`: English uses one word for two actions and Dutch must not |
| Steal | Steel | |
| Move / Place / Pass | Verplaats / Plaats / Sla over | |
| Roll | Gooi | |
| Offer / Counter | Bied aan / Tegenbod | |
| Accept / Decline / Reject | Accepteer / Weiger | Two English words, one Dutch word; the `msgctxt` split is preserved in the ids |
| Withdraw (an offer) | Intrekken | |
| Cancel / Confirm / Undo | Annuleer / Bevestig / Ongedaan maken | There is no shorter Dutch for `Ongedaan maken` |
| Clear / Reset | Wis | |
| End turn | Einde beurt | The noun form; `Beurt beëindigen` is 16 |
| Start game | Start spel | |
| Upgrade (settlement → city) | Bouw uit | Distinct from `bevorder` and `verbeter` (§11) |
| Activate / Promote | Activeer / Bevorder | |
| Chase / Displace / Relocate | Verjaag / Verdring / Verplaats | `Verplaats` is both "Move" (the robber) and "Relocate"; the two never appear on the same surface |
| Remove / Remove player | Verwijder / Speler verwijderen | The second is a kick and says so |
| Equip / Unequip | Rust uit / Verwijder | The "this one is on" state is `In gebruik` |
| Link / Unlink / Merge | Koppel / Ontkoppel / Voeg samen | |
| Join / Watch / Send | Doe mee / Kijk toe / Verstuur | A bare `Kijk` is not idiomatic for spectating |
| Rejoin | Neem je plek terug | |
| Zoom in / out | Inzoomen / Uitzoomen | Infinitive, because the imperative `Zoom in` is identical to the English and would fail the msgid guard |
| Bid one less / more {name} | Eén minder bieden: {name} / Eén meer bieden: {name} | Label and value; `{name}` arrives in citation form |

---

## 11. Collisions English hides

| English word | Senses | Dutch | Note |
|---|---|---|---|
| **draw** | take a card / a level game / paint with a brush | **trekken** / **gelijkspel** / **tekenen** | Three unrelated words, each with a `msgctxt` |
| **steal** | take from a player | **stelen** | No collision with "draw" |
| **upgrade / promote / advance** | settlement→city / knight rank / improvement track | **uitbouwen** / **bevorderen** / **verbeteren** | Held rigidly. Not `vorderen`: it cannot take the track as an object. A wagon is `opwaarderen` |
| **discard / dismiss** | throw cards away / close a notification | **afleggen** / **sluiten** | |
| **trade** | player-to-player / with the bank, harbour or supply / the improvement track | **ruilen** / **wisselen** / **Handel** | Every heading, tab or step covering both play senses uses **Ruilen**. `Handel` already names the Knights track, deck (`Stapel Handel`), metropolis, event-die face and scoreboard column, so it is never the cover verb |
| **path** | a chain of roads / a board edge | **pad** (Longest Road) / **zijde** | The English renamed the Caravans `path` to `edge` to remove this collision; Dutch keeps it removed |
| **Verplaats** (reverse collision) | Dutch's own word covers *Move* and *Relocate* | Both `Verplaats`; they never co-occur | §10 |
| **rover / zeerover / plunderaar** | robber / pirate / raider | **rover** / **piraat** / **plunderaar** | `zeerover` for pirate would collide with our `rover` |
| **bod / aanbod** | Caravans bid / trade offer | **bod** / **aanbod** | Never use `bod` for a trade offer |
| **play** | play a card / play a game | `spelen` covers both and they never collide in practice | |
| **ready** | player is ready / connection is ready | `klaar` / `verbonden` | |

---

## 12. Length and overflow

Dutch runs roughly 10-20% longer than English, but the distribution is what matters: most
strings are fine and a handful are single compounds far past their slot. A compound cannot
break *inside itself*, which matters only in a fixed-width slot; in ordinary DOM text the
surrounding box wraps around it. Card titles break at authored soft hyphens (§8).

| Surface | English | Dutch | Fallback if a slot is too narrow |
|---|---|---|---|
| board action pill | `Build settlement` | `Bouw nederzetting` | `Nederzetting` |
| turn pill | `End turn` | `Einde beurt` | `Klaar` |
| scoreboard column | `Settle` | `Nederz.` | |
| lobby setting | `Event die` | `Gebeurtenisdobbelsteen` | `Gebeurtenis`, with the die implied by the icon. No Dutch compound is shorter |
| lobby setting | `Setup` | `Beginopstelling` | `Opstelling` |
| lobby setting | `City improvement` | `Stadsverbetering` | tight, unbreakable |
| dev card label | `Development card` | `Ontwikkelingskaart` | widen the slot; `Ontw.kaart` is ugly |
| nav item | `Map builder` | `Kaarteneditor` | `Editor` |
| nav item | `How to play` | `Hoe je speelt` | |
| queue chip | `Ranked` | `Competitief` | `Comp.` |
| button | `Undo` | `Ongedaan maken` | none |
| button | `Randomize` | `Willekeurig maken` | `Willekeurig` |
| button | `Disconnect` | `Verbinding verbreken` | `Verbreken` |
| button | `Boost to unlock` | `Boost de server om te ontgrendelen` | no compact Dutch for Discord's "boost" |
| button | `Rejoin` | `Neem je plek terug` | `Terug` |
| status | `Defender of the realm` | `Verdediger van het rijk` | `Verdediger` |
| stat pill | `win rate` | `winpercentage` | `win%` |
| scenario | `Camel junction` | `Kamelenkruispunt` | unbreakable |
| scoreboard row, StatusPanel legend | `Strength 1/2/3 knights` | `Ridders van kracht 1/2/3` | `Ridders kracht {n}` |

Several of these fit in practice at desktop and phone widths; they are listed because they
are the ones to check first when a layout changes. The SeatRail draws only the first letter
of a track name, which gives H/P/W in Dutch, three distinct letters. Strings rendered only
as a `title`, `hint` or `aria-label` have no sized slot to overflow.

---

## 13. Agreement that survives interpolation

Dutch has little of this problem: no case, no noun inflection for gender, and adjectives take
at most a final `-e`. What remains:

| Message | Problem | Resolved as |
|---|---|---|
| `Equipped` | would agree with the unknown item noun | `In gebruik` (prepositional, agreement-free) |
| `Full` / `Private` / `Public` | attributive adjectives would take `-e` after `de tafel` | Predicative (`De tafel is vol`) or bare labels (`Vol`, `Privé`, `Openbaar`), which never inflect |
| `None` (no decoration) | would agree with `decoratie` | `Geen`, invariant before both genders |
| `Walled: holds 2 extra cards` | attributive with `stad` | `Ommuurd:` used predicatively |
| `Ready` (player) | none | `Klaar` is invariant |
| `Winner` | `winnaar` is masculine by default, `winnares` feminine | `Winnaar` as the unmarked form, standard modern Dutch usage |
| `{n, plural, one {# player} other {# players}}` | none | `# speler` / `# spelers` |

## 13b. One message per card

The source never interpolates a bare noun where Dutch would have to agree with it. Card
phrases are one message per card (`card.<phrase>.<card>`, `dev.notHeld.<card>`,
`harbor.receive.*`, `short.needOneMore.*`, `error.NO_PIECES.*`, `board.metropolis.*`,
`track.deckEmpty.*`, `track.draw.*`), with the noun written into the message and the count
carried as an ICU `plural` inside it:

| id | `one` | `other` |
|---|---|---|
| `card.bankLeft.sheep` | `Nog # schaap in de bank` | `Nog # schapen in de bank` |
| `card.bankLeft.wood` | `Nog # hout in de bank` | `Nog # hout in de bank` |
| `card.improveCost.coin` | `Kost # munt` | `Kost # munten` |
| `card.improveCost.paper` | `Kost # papier` | `Kost # papier` |

Identical arms on `hout`, `erts`, `tarwe` and `papier` are the mass-noun non-inflection of
§4. Where a runtime noun remains (`mapIssue.*`, `log.barb.tied`, `short.shortOf`), it sits
after a colon as a label, so nothing has to agree with it.

---

## 14. Checks

A Dutch entry must keep, relative to `en`: the multiset of `{name}` parameters, the JSX tag
multiset (`<0>`, `</0>`, `<1/>`), every ICU wrapper with its variable and both `one`/`other`
arms, keyed ids byte-for-byte, and entry order. No `msgstr` may equal its `msgid`
(`catalog.test.ts`), and no msgstr contains an em dash. A JSX tag wraps a whole Dutch
construction (the full compound, or a separable verb with its particle), never half of one.
`scripts/po_verify.py nl` checks the mechanical part.

---

## 15. Terms not translated

- **Player display names, chat bodies, user-saved map names.** User content.
- **Bot display names.** Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values.** Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names.** A separate exercise in Dutch colour naming.
- **`Pips`**, both the board-probability sense and the store currency.
- **`Costanio`**, in every page title, and the proper nouns in the disclaimer string.
- **Map names** (`China`, `Japan`, `Shores (Klein/Middelgroot/Groot)` keeps its proper noun).

**Blank entries.** An empty `msgstr` falls back to the English at runtime. It is used
where the Dutch is spelled exactly like the English, which keeps `catalog.test.ts`'s "a
translation is never its own msgid" guard meaningful. Dutch and English share a great deal
of borrowed and Germanic vocabulary, so this happens more often than in Romance languages.
The blanks are of these kinds:

- **Pure placeholder frames** (`{0}`, `{label}: {n}`, `{ratio}:1 {resource}`, `2:1
  {resource}`, `{resource} {num}`, `log.produced`).
- **Words identical in Dutch:** `Bank`, `Booster`, `Bot`, `Budget`, `Canvas`, `Details`,
  `Filters`, `Land`, `Lobby`, `Menu`, `Metro`, `offline`, `online`, `Pips`, `Privacy`,
  `Rating`, `Route`, `Volume`, `Water`, `Blitz`, `Auto`, `+2`, the map names, and the card
  titles `Alchemist` and `Saboteur`.

A blank must never carry an ICU plural: the English message would be used wholesale.
