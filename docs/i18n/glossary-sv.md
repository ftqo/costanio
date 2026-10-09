# Swedish (`sv`) terminology glossary

The terminology, register and grammar conventions that
`frontend/src/locales/sv/messages.po` follows. Terminology is the expensive decision: a
term chosen here recurs in hundreds of strings, so changing one means a find-and-replace
over the `.po`.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/`, `CONTRIBUTING.md`,
`frontend/src/locales/README.md`, `docs/i18n/CONTRIBUTING.md`.
**Companions:** `glossary-nl.md` (nearest relative: a two-gender language whose gender is
not derivable from the noun) and `glossary-de.md`. This document follows their structure so
they can be read against each other.

---

## 1. Register and global decisions

### Formality: `du`, everywhere, no exceptions

The *du-reformen* of the late 1960s removed the formal second person from ordinary Swedish
almost completely. Modern Swedish consumer software, board-game rules and support copy
address the reader as **du**. `ni` to a single reader survives in two narrow places, neither
of which is this product: some customer-facing service registers, where it reads as
deferential, and older usage, where it reads as condescending. Against a source this chatty
it would be a register clash on every screen.

Held in the legal surfaces too. Only the page *titles* of Terms and Privacy are in this
catalogue (the bodies stay in English by project decision); if that copy is ever localised
it must stay `du`.

### Surface register

| Surface | Register | Example |
|---|---|---|
| Board action pills | Bare imperative | `Bygg`, `Slå`, `Aktivera` |
| Dialog buttons | Imperative or noun | `Avbryt`, `Bekräfta`, `Inställningar` |
| Turn-step chips | Bare imperative | `Slå`, `Samla in`, `Bygg`, `Byt` |
| Prompts | `du` imperative | `Tryck på en landbricka för att flytta rövaren` |
| Errors | Impersonal or 2sg | `Du kan inte bygga där`, `Den platsen är redan tagen` |
| Event log | 3rd person, past | `{player} byggde en väg` |
| Rules manual | `du`, explanatory present | `Varje tur slår du de två produktionstärningarna` |
| Toasts | Short, past | `Tiden tog slut. …` |

**The event log is past tense, not present.** Swedish sports and game commentary uses the
past for a completed action, and the log is a record of what happened. English's `{player}
built a road` is ambiguous between the two; Swedish has to choose, and chose `byggde`.

**Buttons are bare imperatives.** `Bygg`, not `Bygga` and not `Byggnad`. Two exceptions are
forced: `Dra tillbaka` (Withdraw) and `Ta av` (Unequip) are particle verbs and cannot be
compressed.

### Capitalization

Swedish uses **sentence case**, like English's own house style here and unlike German.
`Avsluta turen`, not `Avsluta Turen`. The exceptions:

- **The card titles** (§8) are capitalised single words or compounds: `Vägbygge`,
  `Mästerköpman`, `Överflödsår`.
- **The awards** take the definite form *and* a capital on the first word only:
  `Längsta vägen`, `Största armén`, `Längsta handelsvägen`. Swedish award names are
  definite where English uses a bare superlative; this is the systematic difference from
  the source. Scenario titles and roles that work like awards are definite too
  (`Hamnmästaren`, `Rikaste nybyggaren`).
- **The improvement tracks** `Handel`, `Politik`, `Vetenskap` are capitalised as named
  tracks; the ordinary nouns are not (`handel` on the event die face).
- **Language and country nouns are capitalised** (`Svenska`, `Sverige`); nationality
  adjectives are not (`svensk`).

### Punctuation

- **No em dash.** Swedish prefers a comma, colon or parentheses for the same job.
- **Thousands are separated by a space, not a comma**: `10 000 Pips`, never `10,000`.
  Decimals take a comma: `4,99`.
- **Quotes:** Swedish prose uses `”…”` (the same mark on both sides) or `’…’`. Where the
  source quotes a phrase with straight double quotes the catalogue keeps them, so the
  rendering does not diverge from English.
- **Dice numbers are words or ordinal-suffixed digits, not bare digits.** `en sjua`,
  `2:or och 12:or`, `{a}:an`, `en 5:a`. This is required orthography, and the suffix depends
  on the final digit; over the range this game shows (2–12) every one takes `-an`, which is
  what makes `{a}:an` safe in `log.tokensSwappedNamed`. It would not be safe over a wider
  range.
- **Interpolated resource names take a colon.** Where an English label folds a `{name}`
  resource into a verb phrase (`Bid one less {name}`), the Swedish keeps the button phrase
  and appends the name after a colon (`Bjud en mindre: {name}`). `{name}` arrives
  capitalised and in its citation form (`msgctxt "resource"`), which cannot take a definite
  suffix or an article; the colon is the label/value separator the house style allows.
- **Manual scoring lines** write `p` for "pts" (`+1 p`).

### Plurals

Swedish has exactly the two CLDR categories English has, `one` and `other`, so every
`{n, plural, one {…} other {…}}` keeps both arms. Many are identical, and that is the
language rather than a copy-paste error:

- **Several core nouns do not inflect in the plural at all**: `kort`, `spel`, `får`, `mynt`,
  `spelare`, `segerpoäng`, `skepp`, `riddare`, `plundrare`, `ryttare`, `fiskevatten`. Where
  the two arms of a Swedish plural are byte-identical, that is correct.
- **Where something else in the sentence inflects, both arms differ**:
  `# kort spelbart nu` / `# kort spelbara nu` (the adjective agrees with number even though
  the noun does not), `# spelat spel` / `# spelade spel`, `# hamn placerad.` /
  `# hamnar placerade.`
- **Do not blank a plural-bearing entry.** A blank falls back to the English, which then
  selects an *English* arm for a Swedish count.

---

## 2. Terminology policy

### 2.0 The rule in force

> **Translate our English faithfully. Only the game title and the expansion names diverge.** (See `CONTRIBUTING.md` at the repo root.)

Our own English already uses ordinary descriptive card names, so a Swedish translation that
dodges a natural Swedish word would be *less faithful than the source*, for no benefit. Where
the faithful Swedish happens to match a term a player already knows, that is correct, not a
leak.

- **Translate straight:** all card titles, resource names, mechanic names, settlement, road,
  city, harbor, robber, development card, progress card.
- **Diverges:** the game's title (`Costanio`, untranslated), and the expansion
  names, which are *ours*: "Islands", "Knights" and "Scenarios" become **Öar**, **Riddare**,
  **Scenarier**.

Swedish players often code-switch to English board-game vocabulary, and where they use
Swedish they tend to use short native forms (`by`, `hus`, `rövaren`, `längsta vägen`). The
catalogue follows our English rather than that usage, row by row below.

### 2.1 Faithful words chosen over looser alternatives

| Our English | Faithful Swedish (**ours**) | Looser alternative | What the alternative means |
|---|---|---|---|
| settlement | **bosättning** | by | *village* |
| resource | **resurs** | råvara / råvarukort | *raw material* |
| pasture | **betesmark** | äng | *meadow* |
| Longest Road | **Längsta vägen** | Längsta handelsvägen | *longest trade route* |
| Largest Army | **Största armén** | Största riddarmakten | *greatest knightly power* |
| Year of Plenty | **Överflödsår** | Överskott | *surplus* |
| knight tiers | **styrka 1 / 2 / 3** | vanlig / stark / mäktig | named tiers; our English is numbered |
| number token | **sifferbricka** | siffermarkör | *number marker* |

- **settlement → `bosättning`.** Our English says *settlement* and `bosättning` is the
  Swedish for it. Swedish `bosättning` is also used as an umbrella term for a building of
  either kind, which is the job this catalogue gives `byggnad`, and it carries the senses
  *setting up house* (`bosättningslån`) and *settlements on occupied land*. Fallbacks, in
  order, would be `by`, `nybygge`, `boplats`; not `koloni`, not `samhälle`, and not the
  colloquial `hus`.
- **Year of Plenty → `Överflödsår`.** `överflöd` is the Swedish for *plenty*. The community
  word for this card, `Överskott` / `Överskottskort`, drops the year and means *surplus*.
- **Longest Road / Longest Trade Route.** Our English says `Longest Road` in the base game
  and `Longest Trade Route` in Islands, so Swedish keeps the split: `Längsta vägen` and
  `Längsta handelsvägen`.
- **number token → `sifferbricka`.** Both Swedish words are faithful to *number token*;
  `sifferbricka` is what Swedish-language rules sites write and it keeps the `bricka` family
  coherent (§3).
- **Card titles track our English exactly.** Where a Swedish title could name a *place or
  trade* instead of the *person or activity* our English names (Gruvdrift not Gruva,
  Boktryckare not Boktryckeri, Smed not Smedja, Kran not Byggkran), ours follows the English.
  `Desertör` is a deserter (not `Förrädare`, *traitor*); `Bevattning` is irrigation (not
  `Jordbruk`, *agriculture*); `Resursmonopol` follows from `resurs`.

### 2.2 The divergences that remain, and why each survives

| Term | Our `sv` | Why |
|---|---|---|
| Islands (expansion) | **Öar** | Our expansion is named "Islands". We translate ours |
| Knights (expansion) | **Riddare** | Same |
| Scenarios (module) | **Scenarier** | Same. `scenarion` is the other Swedish plural |
| the game | **Costanio** | Untranslated proper noun |
| settlement | **bosättning** | Faithful; §2.1 |
| road | **väg** | Faithful, and the ordinary word |
| robber | **rövare** | Faithful and the ordinary Swedish word |
| pirate | **pirat** | Faithful. `sjörövare` is "sea-robber" and would collide with our `rövare` |
| sheep | **får** | Our English says "Sheep", not "Wool", so `får` and not `ull` |
| wheat | **vete** | Our English says "Wheat", not "Grain", so `vete` and not `säd` |
| brick / clay | **tegel** / **lera** | Our English separates the `Brick` resource from the `Clay` terrain; Swedish maps the split exactly |
| progress card | **framstegskort** | Distinct from `utvecklingskort`: this game has both decks, in the same UI |
| victory point | **segerpoäng** | Faithful. Invariant in the plural |
| tile / hex | **bricka** | Faithful and short; §3 |
| event die | **händelsetärning** | Faithful. 15 characters, unbreakable |
| Defender of the Realm | **Rikets försvarare** | Faithful |

### 2.3 Coincidence, not leak

`stad`, `hamn`, `ö`, `skepp`, `riddare`, `barbarer`, `metropol`, `stadsmur`, `monopol`,
`biskop`, `diplomat`, `spion`, `intrig`, `ingenjör`, `uppfinnare`, `bevattning`,
`gruvdrift`, `papper`, `mynt`, `akvedukt`, `segerpoäng`, `skog`, `betesmark`, `öken`,
`trä`, `malm`, `väg`, `landbricka`, `tegel`, `vete`, `tyg`, `handelsvaror`,
`utvecklingskort`, `framstegskort`, `rövare` are the ordinary Swedish words for the
ordinary English words our source uses. For most of them there is no second option.

**Chosen on the merits alone**: the scenario vocabulary (§6), the map-builder vocabulary,
all of §9's UI and system vocabulary, and most Trade/Politics/Science card titles.

---

## 3. Core game nouns

**The gender column matters most in this table.** Swedish has two genders,
*common* (`en`) and *neuter* (`ett`); they are not derivable from the noun's form, and they
drive the indefinite article, the definite suffix, the adjective's agreement and every
`ingen`/`inget`/`inga`. A wrong gender is a visible error everywhere the noun appears.

| English | `sv` | Gender | Definite sg | Plural | Chars |
|---|---|---|---|---|---|
| road | väg | **en** | vägen | vägar | 3 |
| settlement | bosättning | **en** | bosättningen | bosättningar | 10 |
| city | stad | **en** | staden | städer | 4 |
| building (cover term) | byggnad | **en** | byggnaden | byggnader | 7 |
| ship | skepp | **ett** | skeppet | skepp | 5 |
| city wall | stadsmur | **en** | stadsmuren | stadsmurar | 8 |
| knight (piece) | riddare | **en** | riddaren | riddare | 7 |
| hex / tile | bricka | **en** | brickan | brickor | 6 |
| vertex / junction / intersection | korsning | **en** | korsningen | korsningar | 8 |
| corner (geometric) | hörn | **ett** | hörnet | hörn | 4 |
| edge (between vertices; also "path" as a shared board edge) | kant | **en** | kanten | kanter | 4 |
| border (of the map) | rand | **en** | randen | ränder | 4 |
| spot / seat / slot | plats | **en** | platsen | platser | 5 |
| port / harbor | hamn | **en** | hamnen | hamnar | 4 |
| dock (on a water hex) | kaj | **en** | kajen | kajer | 3 |
| generic port (3:1) | allmän hamn | **en** | | | 11 |
| specific port (2:1) | särskild hamn | **en** | | | 13 |
| robber | rövare | **en** | rövaren | rövare | 6 |
| pirate | pirat | **en** | piraten | pirater | 5 |
| merchant (piece) | köpman | **en** | köpmannen | köpmän | 6 |
| longest road | Längsta vägen | **en** | | | 13 |
| longest trade route | Längsta handelsvägen | **en** | | | 20 |
| longest route (generic) | längsta sträckan | **en** | | | 16 |
| largest army | Största armén | **en** | | | 13 |
| victory point (VP) | segerpoäng (**SP**) | **en** | segerpoängen | segerpoäng | 10 / 2 |
| development card | utvecklingskort | **ett** | utvecklingskortet | utvecklingskort | 15 |
| progress card | framstegskort | **ett** | framstegskortet | framstegskort | 13 |
| resource | resurs | **en** | resursen | resurser | 6 |
| commodity | handelsvara | **en** | handelsvaran | handelsvaror | 11 |
| bank | bank | **en** | banken | banker | 4 |
| supply | förråd | **ett** | förrådet | förråd | 6 |
| trade (n) | byte | **ett** | bytet | byten | 4 |
| turn | tur | **en** | turen | turer | 3 |
| round | runda | **en** | rundan | rundor | 5 |
| die / dice | tärning | **en** | tärningen | tärningar | 7 |
| number token | sifferbricka | **en** | sifferbrickan | sifferbrickor | 12 |
| hand | hand | **en** | handen | händer | 4 |
| hand limit | handgräns | **en** | handgränsen | | 9 |
| discard limit | kastgräns | **en** | kastgränsen | | 9 |
| deck | lek | **en** | leken | lekar | 3 |
| setup | uppställning | **en** | uppställningen | | 12 |
| discard (v) | kasta | – | | | 5 |
| board (the playing board) | spelplan | **en** | spelplanen | | 8 |
| scoreboard (in game) | poängtavla | **en** | poängtavlan | | 10 |
| leaderboard (the site) | topplista | **en** | topplistan | | 9 |
| pips (the currency) | **Pips** | – | | | 4 |

**`bricka` for both *hex* and *tile*.** English uses two words for what the engine treats as
one thing; Swedish unifies on **bricka** and qualifies it with a compound where it matters:
`landbricka`, `havsbricka`, `vattenbricka`, `ökenbricka`, `guldbricka`, `skogsbricka`,
`betesmarksbricka`, `fiskbricka`, `handelsbricka`. `ruta` is not an alternative: it is a
*square*, a cell on a grid, and this board is hexagonal. Every terrain and token compound is
built on `bricka`, so this is the costliest term in the catalogue to change.

**`korsning` for *intersection*, `hörn` for *corner*.** `hörn` is used only where the English
itself says "corner".

**`plats` for seat, spot and slot.** No alternative covers more than one of the source's
*seat*, *spot* and *slot*: `stol` is furniture, `ruta` is a square, `korsning` is already the
junction. The two errors a reader could conflate (`error.BAD_SEAT`, a lobby error, and
`error.OCCUPIED` / `error.VERTEX_TAKEN`, board errors) cannot arrive from the same action or
screen. `error.OCCUPIED` and `error.VERTEX_TAKEN` carry identical English on purpose
(`lib/errorCopy.ts`), so their Swedish stays identical too. The colour family is
`Platsfärg` / `Platsfärger` / `Platskosmetik`.

**`SP` for victory points.** `SP` is the abbreviation in the scoreboard column and in
`Ö-SP`, `Mål-SP` and `Bonus-SP för öar`; prose writes `poäng` or `segerpoäng`
(`10 poäng`, `först till 13 poäng`). The scoreboard column carries a `title` tooltip reading
`Slutliga segerpoäng`. Lowercase `sp` is never used (it is an established Swedish
abbreviation for *silverpoäng* in bridge), and `spelare` is written in full, as in the
ranked-queue rows' `4 spelare`.

### Terrain

| English | `sv` | Gender |
|---|---|---|
| forest | skog | **en** |
| clay (the terrain) | lera | **en** |
| pasture | betesmark | **en** |
| field | åker | **en** |
| mountain | berg | **ett** |
| desert | öken | **en** |
| sea | hav | **ett** |
| gold | guld | **ett** |
| lake | sjö | **en** |
| fog | dimma | **en** |
| land | land | **ett** |
| border | rand | **en** |

**`hav` and `sjö` are kept strictly apart**, as English keeps *sea* and *lake*. `Sea` is the
terrain ships sail on; `Lake` is the Fishermen terrain a drowned desert becomes.

Hex labels interpolated into sentences (`vid {a}`, `Flytta plundraren till {name}`) are
definite: `öknen`, `sjön`, `guldbrickan`.

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and Swedish
preserves the split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **skog** (en) | `Wood` → **trä** (ett) |
| `Clay` → **lera** (en) | `Brick` → **tegel** (ett) |
| `Pasture` → **betesmark** (en) | `Sheep` → **får** (ett) |
| `Field` → **åker** (en) | `Wheat` → **vete** (ett) |
| `Mountain` → **berg** (ett) | `Ore` → **malm** (en) |

| English | `sv` | Gender | Mass / count | Plural | Negation |
|---|---|---|---|---|---|
| wood | trä | **ett** | mass | – | inget trä |
| brick | tegel | **ett** | count-ish | tegel | inget tegel |
| sheep | får | **ett** | count | får | inga får |
| wheat | vete | **ett** | mass | – | inget vete |
| ore | malm | **en** | mass | – | ingen malm |
| gold | guld | **ett** | mass | – | inget guld |
| cloth | tyg | **ett** | mass | tyger | inget tyg |
| paper | papper | **ett** | mass | papper | inget papper |
| coin | mynt | **ett** | count | mynt | inga mynt |

**The negation column is why the per-card message families exist**, and it is the most
important table in this document. Swedish negates a noun with **three different
words** depending on gender and number: `inget` (neuter singular/mass), `ingen` (common
singular), `inga` (plural). `malm` is the only common-gender resource in the set, so
`ingen malm` where every other resource takes `inget` or `inga`.

A frame like `You hold no {resource}` therefore **cannot be filled correctly in Swedish for
all values**. `card.holdNone.*`, `card.victimHoldsNone.*`, `card.bankOut.*` and
`card.allTheirs.*` are split per card in the source, and that split is what makes those
sentences possible. Do not merge them. The same applies to the indefinite
article: `Ta ett tegel` and `Ta ett får` take `ett`, `Ta malm` and `Ta vete` take none, and
one frame cannot do both.

`card.allTheirs.*` needs a fourth distinction on top: `allt` (neuter), `all` (common),
`alla` (plural), so `allt deras tegel` / `all deras malm` / `alla deras mynt`.

`får` is both the verb (*get*) and the sheep, so `harbor.receive.sheep` reads `du får får`.
That is grammatical Swedish.

---

## 5. Islands expansion

| English | `sv` | Gender | Rationale |
|---|---|---|---|
| Islands (the expansion) | Öar | – | Our own expansion name, translated |
| ship | skepp | **ett** | |
| sea edge | havskant | **en** | Kept apart from `kustkant` |
| coastal edge | kustkant | **en** | |
| ship route | skeppsrutt | **en** | |
| open end (of a ship chain) | öppen ände | **en** | `väg med öppen ände` in prompts |
| pirate | pirat | **en** | §2.2 |
| gold hex | guldbricka | **en** | Also the Explorers gold field |
| longest trade route | Längsta handelsvägen | **en** | Counts roads and ships |
| island | ö | **en** | |
| island discovery | Öupptäckt | **en** | Two vowels meet; `Upptäckta öar` is the longer alternative |
| island bonus | öbonus (öbonusen) | **en** | Manual prose and the table setting. Scoreboard short form `Öpoäng` |
| landmass | landmassa | **en** | |

**`Öar-karta`, `Öar-spel`, `Öars skepp`.** The expansion name takes a hyphen in compounds
because the closed form `Ökarta` is unreadable (it looks like *desert map*, `öken`). A
hyphen before a proper-noun first element is correct Swedish and is used consistently.

---

## 6. Scenario expansions

Registered under `module.tab` → **Scenarier**. These scenarios have no established Swedish
vocabulary, so every word here is judged on its own merits.

| English | `sv` | Gender | Rationale |
|---|---|---|---|
| Fishermen | Fiskare | – | Invariant singular/plural, which suits a module name |
| fishing ground | fiskevatten | **ett** | Invariant plural; the singular hover-card label uses the same form |
| fish source | fiskkälla | **en** | Coined |
| fish tile | fiskbricka | **en** | Coined |
| the old boot | Den gamla stöveln | **en** | Meant to be undignified, which survives |
| Caravans | Karavaner | – | |
| camel | kamel | **en** | |
| oasis | oas | **en** | |
| caravan route | karavanrutt | **en** | `karavanväg` would collide with `väg` the piece |
| camel junction | kamelkorsning | **en** | 13, unbreakable |
| oasis corner | oashörn | **ett** | Coined |
| spoke (Caravans, Wagons) | eker (ekrar) | **en** | |
| path (shared board edge) | kant | **en** | An edge can carry a camel and no road, so not `vägsträcka` and not `stig`; matches `havskant`, `kustkant`, `målkanten`, `landkanter` |
| Bid nothing | Bjud ingenting | | Bidding nothing is an answer, not sitting the round out |
| Votes: {total} | Röster: {total} | | Label and value, which keeps agreement off `{total}` |
| a road credit | ett tillgodo på en väg | | The spend buys the credit; the road is placed afterwards as its own move |
| bid timeout | `bjuds ingenting åt dig` | | On timeout the seat is recorded as bidding nothing |
| table offer (bots do not make one) | bordsbud | **ett** | One word across the manual's two bot paragraphs |
| Rivers / Raiders / Wagons / Explorers / Harbormaster | Floder / Plundrare / Vagnar / Upptäckare / Hamnmästaren | | Faithful renderings of our own English titles; `Hamnmästaren` is definite like the award names |
| raider | plundrare | **en** | Never `rövare`, the robber. Plural-invariant |
| rider | ryttare | **en** | Plural-invariant. The English raider/rider pun ("one letter apart") cannot survive in Swedish |
| castle | borg | **en** | Raiders and Wagons alike |
| Muster / Swift Rider / Treason / Intrigue | Uppbåd / Snabb ryttare / Förräderi / Intrig | | |
| prisoner | fånge | **en** | |
| spoils (of a raid) | krigsbyte | **ett** | `byte` alone is a trade |
| place in reach (rider) | kant inom räckhåll | | A rider ends on a path, so the count names paths |
| river / bridge / bridge site | flod / bro / broplats | **en** | |
| watercourse (Rivers) | vattendrag | **ett** | |
| swamp | träsk | **ett** | |
| coins (Rivers) | mynt | **ett** | Same word as the Knights commodity, as in the English |
| Wealthiest / Poorest Settler | Rikaste / Fattigaste nybyggaren | **en** | Definite, like the award names |
| wealth tiles | rikedomsbrickor | **en** | |
| harbour points | hamnpoäng | **en** | |
| harbour settlement | hamnbosättning | **en** | |
| wagon | vagn | **en** | |
| plaza | torg | **ett** | |
| trade hex | handelsbricka | **en** | |
| quarry / glassworks | stenbrott / glasbruk | **ett** | Role names are definite in the wagon panel |
| marble / glass / sand / tools | marmor / glas / sand / verktyg | | |
| cargo / load | last | **en** | Also the Wagons scoreboard |
| toll | tull | **en** | |
| movement (points) | förflyttningspoäng | | A bare `2 extra förflyttning` is ungrammatical; chips keep `+2 förflyttning` |
| Swift Journey | Snabb resa | | |
| settler / crew | nybyggare / besättning | **en** | |
| fish haul / spice sack | fiskfångst / kryddsäck | **en** | |
| shoal | stim (fiskstim) | **ett** | |
| pirate lair | piratnäste | **ett** | |
| spice farm | kryddodling | **en** | |
| the Council | Rådet | | |
| hold (of a ship) | lastrum | **ett** | |
| Swift Voyage / Pirate Bonus / Fast Gold | Snabb seglats / Piratbonus / Snabbguld | | |
| consolation gold (Explorers) | tröstguld | **ett** | Coinage |
| mission marker | uppdragsmarkör | **en** | |
| spend (fish, gold) | spendera | | Matches the `Spendera fisk: {0}` buttons |

The Caravans geometry is exact: oasis exits leave from every other oasis corner
(`varannat av oasens hörn`), matching `engine/scenarios/caravans.go`.

---

## 7. Knights expansion

| English | `sv` | Gender | Rationale |
|---|---|---|---|
| Knights (the expansion) | Riddare | – | Our own expansion name, translated |
| knight (piece) | riddare | **en** | Same word; English has the same collision |
| knight tiers | **riddare med styrka 1 / 2 / 3** | | Numbered throughout, as the source is. Matches the sentence-level siblings (`error.MIGHTY_NEEDS_FORT`, `Båda dina riddare med styrka 1 …`). `Styrka 1-riddare` would be the only place in the catalogue that compounds the tier. The scoreboard label sits in a cell that wraps |
| strength | styrka | **en** | |
| activate | aktivera; aktiv / inaktiv | | |
| build (a knight) | bygga | | A knight is built, never "bought" (`köpa`) |
| promote | befordra | | |
| displace | tränga undan; undanträngd | | `bortträngd` and `förflyttad` are the alternatives |
| chase the robber | jaga rövaren | | Board label `Jaga rövaren` |
| progress card | framstegskort | **ett** | §2.2 |
| city improvement | stadsförbättring | **en** | 16, unbreakable |
| improvement track | förbättringsspår | **ett** | 16, unbreakable. Used only where the source needs the abstraction |
| advance a track (verb) | förbättra | | `avancera` reads as jargon |
| Trade / Politics / Science | Handel / Politik / Vetenskap | | Track names; closed compounds `Handelsleken`, `Handelsmetropolen`, `Handelsnivå` |
| commodity | handelsvara | **en** | |
| metropolis | metropol | **en** | Scoreboard short form `Metrop`, never `Metro`, which is the Swedish for a subway |
| event die | händelsetärning | **en** | 15, unbreakable |
| barbarians / barbarian fleet | barbarer / barbarflotta | | |
| barbarian attack | barbarattack; barbarräd; invasion | | The source contrasts attack, raid, invasion and landfall; Swedish keeps three of the four |
| barbarian distance | barbaravstånd | **ett** | |
| pillage / raze a city | skövla | | `degradera` is mechanically accurate and bloodless; the source is not bloodless |
| Defender of the Realm | Rikets försvarare | **en** | 17 |
| Merchant Guild | Köpmansgille | **ett** | Faithful to our English name. Wire name `trading_house` must not change |
| Fortress / Aqueduct | Fästning / Akvedukt | **en** / **en** | |
| Merchant token / Defender token | Köpmansbrickan / Försvararbricka | **en** | Closed compounds with the linking `-s-` agreeing with `Köpmansgille` |

**A card title used attributively takes a hyphen**: `Riddare-kort`, `Monopol-kort`,
`Överflödsår-kort`, `Vägbygge-kort`, `Köpman-kort`. A token is a closed compound
(`Köpmansbrickan`). The two patterns can meet in one sentence; that is correct.

---

## 8. The card titles

These composite over the card art at runtime, so they are display type at large size *and*
at a small hand thumbnail. The English fits roughly **13 uppercase characters** on one line
before the fitter takes a size step. Swedish compounds run long, and unlike English they
offer no space to break at.

**Twelve titles carry a soft hyphen (`U+00AD`) at the compound seam.** `lib/cardTitle.ts`
(`fitCardTitle`) treats it as a break opportunity, draws a hyphen when it uses it, and strips
it otherwise; `cardTitle.test.ts` fails a title that has no seam and shrinks below the
two-line step. Every seam sits on the compound joint, which is where Swedish *avstavning*
puts it (*sammansättningsprincipen*).

How the fitter treats them:

| Title | Renders as | Seam |
|---|---|---|
| `Handelshamn` | `HANDELS-` / `HAMN` | used; optional (0.940 scale unbroken) |
| `Mästerköpman` | `MÄSTER-` / `KÖPMAN` | used; optional (0.884 unbroken) |
| `Handelsflotta` | `HANDELS-` / `FLOTTA` | used; optional (0.884 unbroken) |
| `Resursmonopol` | `RESURS-` / `MONOPOL` | **required** (0.831 unbroken fails the 0.85 floor) |
| `Handelsmonopol` | `HANDELS-` / `MONOPOL` | **required** (0.781 unbroken fails) |
| `Bevattning`, `Gruvdrift`, `Boktryckare`, `Vägbygge` (×2), `Segerpoäng`, `Krigsherre`, `Överflödsår` | one line at full size | never drawn; kept as insurance against a change in the title, the budget or the face |

The optional seams are kept: the fitter's documented order is two lines, then shrink, and
the English cards set `COMMERCIAL HARBOR` over two lines too. If `Bevattning` ever did break,
`bevatt-ning` would be the better display break than the current `Be-vattning`.

**Changing a title or a seam** obliges a `frontend/scripts/gen-title-fonts.py` run and a
committed font and `titleMetrics.json` (§16).

### Development deck

| id | English | `sv` | Chars | Seam |
|---|---|---|---|---|
| `knight` | Knight | Riddare | 7 | |
| `victory_point` | Victory Point | Segerpoäng | 10 | `Seger-poäng` |
| `road_building` | Road Building | Vägbygge | 8 | `Väg-bygge` |
| `year_of_plenty` | Year of Plenty | Överflödsår | 11 | `Överflöds-år` |
| `monopoly` | Monopoly | Monopol | 7 | |

`Vägbygge` against `Vägbyggnad`: the first is the act, the second the structure. The card is
the act.

### Trade deck

| id | English | `sv` | Chars | Seam |
|---|---|---|---|---|
| `commercial_harbor` | Commercial Harbor | Handelshamn | 11 | `Handels-hamn` |
| `master_merchant` | Master Merchant | Mästerköpman | 12 | `Mäster-köpman` |
| `merchant` | Merchant | Köpman | 6 | |
| `merchant_fleet` | Merchant Fleet | Handelsflotta | 13 | `Handels-flotta` |
| `resource_monopoly` | Resource Monopoly | Resursmonopol | 13 | `Resurs-monopol` |
| `trade_monopoly` | Trade Monopoly | Handelsmonopol | 14 | `Handels-monopol` |

`Handelsflotta` pairs with `Handelshamn` (the `Handels-` axis) rather than with `Köpman`
(`Köpmansflotta`). `Resursmonopol` and `Handelsmonopol` differ only in their first element,
as the English does.

### Politics deck

| id | English | `sv` | Chars | Note |
|---|---|---|---|---|
| `bishop` | Bishop | Biskop | 6 | |
| `constitution` | Constitution | Grundlag | 8 | The Swedish for a written constitution. `Konstitution` reads as medical or academic |
| `deserter` | Deserter | Desertör | 8 | |
| `diplomat` | Diplomat | Diplomat | 8 | Identical to the English; the entry is left blank |
| `intrigue` | Intrigue | Intrig | 6 | |
| `saboteur` | Saboteur | Sabotör | 7 | |
| `spy` | Spy | Spion | 5 | |
| `warlord` | Warlord | Krigsherre | 10 | Seam `Krigs-herre`. The closer rendering of *warlord*, and the card's text is about coercion rather than generalship. `Fältherre` (a legitimate commander) is the alternative |
| `wedding` | Wedding | Bröllop | 7 | |

### Science deck

| id | English | `sv` | Chars | Note |
|---|---|---|---|---|
| `alchemist` | Alchemist | Alkemist | 8 | |
| `crane` | Crane | Kran | 4 | |
| `engineer` | Engineer | Ingenjör | 8 | |
| `inventor` | Inventor | Uppfinnare | 10 | |
| `irrigation` | Irrigation | Bevattning | 10 | Seam `Be-vattning` |
| `medicine` | Medicine | Medicin | 7 | The discipline. `Läkekonst` is the older, more period-appropriate word |
| `mining` | Mining | Gruvdrift | 9 | Seam `Gruv-drift` |
| `printer` | Printer | Boktryckare | 11 | Seam `Bok-tryckare`. The trade, not the machine (`Skrivare` is a computer printer) |
| `road_building_sci` | Road Building | Vägbygge | 8 | **Must be byte-identical to `road_building`**: the two share one render |
| `smith` | Smith | Smed | 4 | |

---

## 9. UI and system vocabulary

| English | `sv` | Gender | Rationale |
|---|---|---|---|
| lobby | lobby | **en** | The established Swedish loan for exactly this screen |
| table (a game room) | bord | **ett** | The source's own metaphor, and it survives translation intact |
| game (a match) | spel | **ett** | Invariant plural |
| ruleset | regeluppsättning | **en** | 16, unbreakable. Also in manual prose, not `reglerna` |
| spectate / spectator | titta på / åskådare | **en** | |
| invite / invite code | inbjudan / inbjudningskod | **en** | 14, unbreakable |
| seat | plats | **en** | §3 |
| host (noun) | värd | **en** | Gendered in the abstract (`värdinna` exists) but unmarked in modern use |
| host (verb) | vara värd för | | |
| ready (connection) | Ansluten | | The source has two "Ready" strings with different `msgctxt`; two different words in Swedish |
| ready (player) | Klar | | |
| ban | avstängning | **en** | |
| report (a message) | anmäla | | |
| supporter | understödjare | **en** | `supporter` is a sports fan in Swedish |
| forfeit | uppgivning | **en** | `walkover` is the sport loanword |
| cosmetic (item) | kosmetik / dekoration | **en** | |
| guest | gäst | **en** | |
| leave / rematch / surrender | lämna / returmatch / ge upp | | |
| draw (a drawn game) | remi | **en** | The board-game noun, used for offers and results alike (`Det blir remi`, `remianbud`). `oavgjort` is the general adverb (`Spelet slutade oavgjort`). Never confuse with `dra` (draw a card) or `rita` (draw with a brush) |
| bot | bot | **en** | Identical; blank |
| ranked | rankad / rankat | | Agrees; `Rankat` neuter for `ett spel` |
| casual (unranked) | Avslappnat | | Beside `Rankat` |
| rating | rating | **en** | Identical; blank. The established Swedish term in online play |
| leaderboard | topplista | **en** | |
| store | butik | **en** | |
| Pips (the currency) | Pips | | Untranslated product name |
| settings | Inställningar | | |
| theme / light / dark / system | tema / ljust / mörkt / system | **ett** | The three values are neuter, agreeing with `ett tema` |
| map builder | kartbyggare | **en** | |
| brush / paint / randomize | pensel / måla / slumpa | | |
| seed | frö | **ett** | |
| turn timer / turn order | turklocka / turordning | **en** | Compounding buys real brevity: 9 and 10 |
| replay | repris | **en** | |
| bid (v / n) | bjuda / bud | **ett** | `bud` also covers a trade *offer*, which English splits |
| swatch (colour) | ruta | **en** | |
| colour-vision modes | `Rödsvag` etc. | | `lib/colorblind.ts` pairs a plain label (`Rödsvag`) with a clinical tooltip (`Protanopi / protanomali (…)`); keep the pair |
| friendly robber | vänlig rövare | **en** | |
| fog of war | krigsdimma | **en** | Swedish gaming also uses the untranslated English |
| map gallery names | translated (`Storbritannien och Irland`, …) | | Ordinary nouns that the source treats as copy; the gallery card wraps |

---

## 10. Interface actions

Buttons and menu items. Register: **bare imperative**, sentence case, no final period.

| English | `sv` | Chars | Notes |
|---|---|---|---|
| Build | Bygg | 4 | Shorter than the English |
| Roll | Slå | 3 | |
| Trade | Byt | 3 | Also the turn-step chip; `Handel` is reserved for the Knights track |
| End turn | Avsluta turen | 13 | `Avsluta tur` (11) reads as a heading |
| Accept / Decline / Reject | Acceptera / Avböj / Avslå | 9 / 5 / 5 | |
| Cancel / Confirm | Avbryt / Bekräfta | 6 / 8 | |
| Clear / Reset | Rensa / Återställ | 5 / 9 | |
| Discard | Kasta | 5 | |
| Counter | Motbud | 6 | |
| Withdraw | Dra tillbaka | 12 | Two words. `Återta` (6) means to reclaim |
| Equip / Unequip | Utrusta / Ta av | 7 / 5 | `Avutrusta` is a calque and not Swedish |
| Link / Unlink | Länka / Avlänka | 5 / 7 | `Koppla från` is the natural alternative at 11 |
| Zoom in / out | Zooma in / ut | 9 / 9 | |

---

## 11. Mechanics English conflates

`frontend/src/locales/README.md` names these as commonly confused. Held strictly here.

| English | `sv` | Sense |
|---|---|---|
| upgrade (settlement → city) | **uppgradera** | |
| promote (a knight) | **befordra** | |
| advance / upgrade (an improvement track) | **förbättra** | Pairs with `stadsförbättring`, the thing a track buys |
| improve (a city) | **förbättra** | Same verb; the source uses "improve" for both |
| draw (a card) | **dra** | |
| draw (with a brush) | **rita** | |
| draw (a level game) | **remi** | §9 |
| play (a card) | **spela** | |
| trade (player to player) | **byta** | |
| trade (with the bank) | **byta** | See below |
| Trade (the improvement track) | **Handel** | Proper noun |
| displace (a knight) | **tränga undan** | |
| move (a knight, a ship, the robber) | **flytta** | |
| relocate (a road, a knight) | **flytta** | English splits; Swedish does not |
| discard | **kasta** | `slänga` is the everyday word |
| pillage / raze | **skövla** | |
| repel | **avvärja** | |

**The trade-verb axis.** English `trade` covers three things: player-to-player, the
bank/harbor exchange, and the Knights improvement track named *Trade*. Swedish uses **byta**
for both play senses and **Handel** as the proper noun for the track, so `Handelsleken`,
`Handelsmetropolen` and `Handelsnivå` are track names while `bankbyten` and `spelarbyten`
are the actions. `handla` is what you do in a shop, so `handla med banken` would read as
commerce rather than as the exchange the rule describes, and it would collide with `Handel`
the track in the Knights UI. `byta med banken` is plain and exact: the action *is* an
exchange.

---

## 12. Length

Swedish runs roughly 5–15% longer than English in prose and can be *shorter* in imperatives
(`Bygg` for `Build`). The real risk is the unbreakable compound:

| String | Chars | English | Where | Note |
|---|---|---|---|---|
| `händelsetärning` | 15 | 9 | die tooltip, chapter heading | no shorter form |
| `framstegskortsdragning` | 22 | 22 | under the dice picker | unpack to two words if needed |
| `Rikets försvarare` | 17 | 20 | player card row | fits |
| `regeluppsättning` | 16 | 7 | profile filter | `regelset` (9) is a calque |
| `inbjudningskod` | 14 | 11 | lobby | none |
| `Riddare (4 spelare)` | 19 | 12 | ranked queue menu row | the row grows to its content |
| `Utvecklings­kort` | 15 | 16 | build-cost table, `w-[86px]` cell | carries a soft-hyphen seam (below) |
| `betesmarksbricka` | 16 | | city-yield row | fits on one line |
| `lägg upp något att ge och något att få` | 38 | 22 | trade hint line | the English nominalises two verbs |

**`Utvecklingskort` carries a `U+00AD` at its compound seam.** The build-cost table
(`HowToPlay.tsx`) puts row labels in a `w-[86px] shrink-0` cell sized for English
`Development Card`, which wraps at its space. The unbroken Swedish word would clip; the
soft hyphen gives the browser the same break opportunity, rendering `Utvecklings-` / `kort`.
This is native CSS soft-hyphen behaviour, not the card-title fitter, and the string is shared
with the in-game `ShopTile`, where it has room and the seam stays invisible. Use the same
fix for any long compound in a fixed-width cell.

The post-game scoreboard cells size to their content and stat-row labels wrap
(`max-w-[150px]`, no `truncate`), so the scoreboard short forms (`SP`, `Metrop`, `Köpm`, `Ö`,
`Ö-SP`) and `Riddare med styrka 1/2/3` cost at most a wrapped line.

---

## 13. Gender and definiteness

The definite article in Swedish is a suffix on the noun, not a separate word: `hus` →
`huset`, `stad` → `staden`. So a frame cannot supply "the" around an interpolated noun at
all; it would have to reach inside it. Three shapes, and what the catalogue does with each:

**1. A bare noun in a frame.** Split per item in the source: `card.holdNone.*`,
`card.take.*`, `card.give.*`, `card.putBack.*`, `card.remove.*`, `card.request.*`,
`card.spendOn.*`, `card.allTheirs.*`, `card.autoReceived.*`, `card.bankOut.*`,
`card.victimHoldsNone.*`, `error.NO_PIECES.*`, `short.needOneMore.*`, `harbor.receive.*`,
`track.draw.*`, `track.deckEmpty.*`, `track.metroEarned.*`, `board.metropolis.*`.
Do not reintroduce a frame. Word order shows why: `You need 1 more {resource}` →
`Du behöver 1 tegel till.` Swedish puts the "more" **after** the noun.

**2. A compound with a runtime first half.** Swedish closes compounds into one word, so a
frame like `{0} deck` or `{metro} Metropolis` cannot produce `Handelsleken`. The source has
per-track families for all of these.

**3. A tag boundary inside a compound or a genitive.** The English wraps whole grammatical
units in its tags so a compounding language can close the compound inside the tag:

| English | Swedish |
|---|---|
| `<0>Sea hexes</0> (water) and <1>gold hexes</1>` | `<0>Havsbrickor</0> (vatten) och <1>guldbrickor</1>` |
| `City on a <0>forest hex</0>` | `Stad på en <0>skogsbricka</0>` |
| `<0/> The <1>Merchant token</1>` | `<0/> <1>Köpmansbrickan</1>` |
| `Each <0>Defender token</0>` | `Varje <0>Försvararbricka</0>` |
| `A card <0>may be played the same turn you draw it</0>` | `Ett kort <0>får spelas samma tur som du drar det</0>` |
| `<0>Report a specific message</0> and a moderator sees it` | `<0>Anmäl ett visst meddelande</0> så…` |
| `The two free builds from the <0>Road Building</0> development card` | noun first, so no genitive `-s` follows a closing tag |

Keep a tag over the whole Swedish compound or clause, never over half of it.

**Agreements that depend on the label.** Some adjectives agree with a noun the string does
not show: `Utrustad` (agrees with a common-gender cosmetic; would be `Utrustat` for a neuter
one), `Offentligt` (neuter, agreeing with `ett bord`), `Ingen` / `inga` for the two
different `None` labels, `Bara ditt` for `Yours alone`. Each must be rechecked if what it
labels changes.

---

## 15. Blank entries

An empty `msgstr` falls back to the English string at runtime. Entries whose Swedish
is byte-identical to the English are left blank, which keeps `catalog.test.ts`'s "a
translation is never its own message id" guard meaningful. **None of them carries a
plural**: a blanked plural falls back to the English catalogue and then selects an English
arm for a Swedish count. The kinds:

- **Bare placeholders and ratios**: `{0}`, `{label}, {total}`, `{label}: {n}`,
  `{name}: {instruction}`, `{nextReward}. {nextCost}`, `{staked} → {got}`, `log.produced`,
  `{ratio}:1 {resource}`, `2:1 {resource}`, `{resource} {num}`, `+2`.
- **Product and platform names**: `{0} ({1} Pips)`, `Pips`, `Booster`, `Bot`,
  `Expansion: {name}`.
- **Words identical in Swedish**: `Auto`, `Bank` (two contexts), `Blitz`, `Budget`,
  `design`, `Diplomat`, `Japan`, `Land` (terrain and brush), `Lobby | Costanio`, `Normal`,
  `offline`, `online`, `Rating`, `System`, `Total`, `sand`.

`Diplomat` is a card title: a Swedish card that differs from the English one would have to
be filled in explicitly.

---

## 16. The card-title font subset

`frontend/public/fonts/gelasio-titles.woff2` is generated *from the catalogues* by
`frontend/scripts/gen-title-fonts.py`, which collects exactly the characters the card titles
use in every locale, in both cases. Swedish titles need `Å å Ä ä Ö ö` (`ÖVERFLÖDSÅR`).
After changing any title or seam, run the generator and read its `--check` output (`title
fonts and metrics are current`); `npx vitest run` does not prove it, because
`cardTitle.test.ts` skips the check silently when `fontTools` is absent.

`lib/cardTitle.ts` needs no Swedish special case: `titleFace()` falls through to `latn`, and
`titleCase()` uses `toLocaleUpperCase("sv")`, the ordinary mapping. Swedish has no
Turkish-style locale-dependent casing.

---

## Checks

`scripts/po_verify.py sv` checks the catalogue mechanically against `en` (ids,
placeholders, tags and ICU arguments, plural arms, no `msgstr` equal to its `msgid`, no
blank entry whose English carries a plural).
