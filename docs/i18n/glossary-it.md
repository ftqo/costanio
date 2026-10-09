# Italian (`it`) terminology glossary

This document records the terminology, register and grammar conventions the `it`
catalogue (`frontend/src/locales/it/messages.po`) follows. Terminology is the expensive
decision: a term chosen here recurs in hundreds of strings and is costly to change
afterwards, so check this file before introducing a new word.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/`, `art/cards/cards.json`,
`frontend/src/locales/README.md`, `CONTRIBUTING.md`. Two Italian style guides are cited
where they settle something: *Buone norme di traduzione tecnica* and *Linee guida di
Mozilla Italia*.
**Companions:** `glossary-es.md` (nearest relative), `glossary-de.md`, `glossary-zh-Hans.md`,
`glossary-ja.md` follow the same structure.

---

## 1. Register and global decisions

These are global and hold across every string. Mixing them is the most visible sign of an
assembled translation.

### Formality: `tu`, on every surface

The English source is chatty and informal ("Say hi to your table…", "Jump into a table!").
`Lei` against that source produces a register clash on every screen, and `Lei` is
effectively absent from both Italian board-game rules and Italian software UI. The real
choice is `tu` against the impersonal third person, and the conventions split by surface:

- **Italian software UI uses `tu` and the 2sg imperative** for controls, and the
  **impersonal** for system messages (`Vuoi continuare?`, `Prova di nuovo`, but `Non è
  possibile aprire il documento`). The Mozilla Italia guide prescribes the 2sg imperative
  for buttons and menu commands.
- **Printed Italian board-game rules are largely impersonal** (`il giocatore attivo`,
  `si gioca`).

**The catalogue holds `tu` on every surface, including the rules manual.** The manual is a
help page inside the product, written in English as direct second-person address ("You
collect five resources", "Each turn you roll"), one tab from the game. The Mozilla Italia
guide's own rule for the impersonal carves out exactly this kind of surface: *"Le regole
sotto elencate si riferiscono esclusivamente allo stile dell'interfaccia di programma e alla
documentazione tecnica. Per i contenuti dei siti ... è invece opportuno mantenere uno stile
più naturale e discorsivo per mettere a proprio agio l'utente."* Switching to `il giocatore`
in the manual would make it read as a different product from the UI that links to it.

The impersonal is used where Italian UI convention puts it: error and system messages take
the impersonal (`Non è possibile costruire lì`) or the bare 2sg present (`Non hai
abbastanza risorse`), never an accusatory `Tu`. `voi` appears nowhere.

The decision holds on the legal surfaces too: only the page titles of Terms and Privacy
are in this catalogue, and if their body copy is ever localised it stays `tu`.

**Prefer the impersonal where Italian allows it.** `Non puoi costruire lì`, never `Tu non
puoi costruire lì`. Buttons are imperatives or bare nouns (`Costruisci`, `Impostazioni`),
prompts to act are `tu` imperatives (`Tocca una tessera`), statements about the player's
state are second-person present (`Non hai risorse`).

### Surface register

| Surface | Register | Example |
|---|---|---|
| Board action pills | Bare imperative | `Costruisci`, `Passa`, `Tira i dadi` |
| Dialog buttons | Imperative or noun | `Annulla`, `Conferma`, `Impostazioni` |
| Prompts | `tu` imperative | `Tocca una tessera per piazzare` |
| Errors | Impersonal or 2sg present | `Non puoi costruire lì`, `Non hai abbastanza risorse` |
| Event log | 3rd person, passato prossimo with `avere` where possible | `{player} ha costruito una strada` |
| Rules manual | `tu`, explanatory present | `Ogni turno tiri due dadi` |
| Toasts | Short, 2sg | `Turno passato` |

### Capitalisation

Italian uses **sentence case**, not English title case: `Fine turno`, not `Fine Turno`;
`Carta sviluppo`, not `Carta Sviluppo`. The exceptions:

- **The 30 card titles** (§8) keep initial capitals on the lexical words, because they are
  proper names of cards rendered as display type: `Mastro Mercante`, `Anno dell'Abbondanza`.
- **The awards** (`Strada più lunga`, `Esercito più grande`) capitalise only the first word.
- **The improvement tracks** (`Commercio`, `Politica`, `Scienza`) are capitalised as named
  tracks; the ordinary nouns `commercio`, `politica`, `scienza` are not.
- **Panel headings are written in sentence case** even where they display in capitals: the
  source applies `uppercase` in CSS.
- **Nationality adjectives and days/months are lowercase** (`italiano`, `lunedì`, `agosto`).

### Punctuation and typography

- **No em dash.** Italian does not want it for parentheticals either; the convention is
  a comma, a colon, parentheses or a period.
- **Ellipsis is the single character `…`**, never `...`.
- **Guillemets `«…»` in prose, straight quotes in labels.** Where the rules manual quotes a
  phrase (`"Already occupy" means…`), Italian uses `«Già occupata» significa…`. Where a UI
  label quotes user data (`"{name}" will be removed`), the straight quotes stay.
- **Apostrophe:** the plain ASCII `'` throughout (`l'isola`, `dell'Abbondanza`), matching
  the source's own straight quotes. The typographic `’` is not used. This is a house-style
  decision.
- **Numbers:** comma decimal and point thousands (`4,99 $/mese`, `+10.000 Pips`).
- **Exclamation marks** only where the English has one.
- **No space before `?` `!` `:` `;`** (that is French, not Italian).

### Plurals

`Intl.PluralRules("it")` defines `one`, `many` and `other`, but `many` is selected only at
compact millions (1,000,000), which no count in this app reaches. Every plural in the
catalogue is therefore two-armed, `one` and `other`, and no entry carries a `many` arm.

- **The noun inflects and so does its article and any adjective**: `1 strada` /
  `2 strade`, `1 insediamento` / `2 insediamenti`.
- **Mass nouns do not inflect**: `# legno` in both arms, `# grano` in both arms. Identical
  arms are intended, not a copy-paste error. §4 says which resources are mass and which
  are count.
- Where the English arms are identical (`track.draw.*`: `(# left)` in both), Italian still
  inflects: `# rimasta` / `# rimaste`.

### Article elision before an interpolated value

Italian elides the definite article before a vowel *sound*, including before a numeral
written as a digit: `sul 6` but `sull'8`, `sull'11`. A frame cannot know which value
arrives, so **no article or articulated preposition stands immediately before a `{param}`
that can carry a number**. `log.robberBlocked` writes `sul numero {num}`, and
`log.tokensSwappedNamed` puts the numerals in apposition. An article before a JSX tag whose
wrapped text is in the same string is fine (`l'<0>oasi</0>`), as is a preposition that
never elides (`di`, `a`, `da`, `con`, `per`, `su`) before a player name.

### Gender, for anyone editing the catalogue

Italian nouns are masculine or feminine and everything agreeing with them inflects. The
recurring referents and their genders:

`la strada` (f) · `l'insediamento` (m) · `la città` (f) · `la nave` (f) ·
`il cavaliere` (m) · `la tessera` (f) · `il porto` (m) · `il ladro` (m) ·
`la carta` (f) · `la risorsa` (f) · `la merce` (f) · `la banca` (f) · `il mazzo` (m) ·
`la partita` (f) · `il tavolo` (m) · `la sala` (f) · `il giocatore` (m) ·
`la mano` (f, irregular: feminine despite the `-o`) · `la metropoli` (f, invariable) ·
`le mura` (f pl., plural-only in the city-wall sense).

`strada` (f) and `nave` (f) share a gender, but no frame interpolates them bare; anyone
adding such a frame must check agreement. For the generic masculine, see §13.

---

## 2. Naming policy

### 2.0 The rule

`CONTRIBUTING.md` at the repository root states it:

> Translate our English faithfully. Only the game title and the expansion names get our
> own words.

Our own English card names (`art/cards/cards.json`: Master Merchant, Warlord, Bishop,
Constitution, Deserter, Diplomat, Intrigue, Saboteur, Crane, Engineer, Inventor,
Irrigation, Medicine, Mining, Printer, Smith, Road Building, Year of Plenty) are
descriptive phrases. An Italian translation that avoids the natural Italian for them is
less faithful than the source, for no benefit.

- **Translate straight, even where the result is familiar board-game Italian:** all card
  titles, resource names, mechanic names (longest road, largest army, victory point),
  settlement, road, city, port, robber, development card, progress card.
- **Diverges:** the game's title (`Costanio`, untranslated), and the expansion
  names, which are our own ("Islands", "Knights", "Scenarios") and are translated:
  **Isole**, **Cavalieri**, **Scenari**.

### 2.1 Two failure modes to avoid

1. **Substituting ordinary nouns nobody coined**, such as `villaggio` for `insediamento`
   or `sentiero`/`via` for `strada`. `insediamento` is the faithful Italian for
   "settlement" and `strada` for "road"; `villaggio` translates "village", which our
   English does not say. `insediamento` costs 12 characters, and that cost is paid in the
   layout rather than avoided by mistranslating (the scoreboard column uses `Insed.`).
2. **Inventing near-miss card titles to look "different".** Where §8 departs from the
   literal (`Condottiero`, `Estrazione`), it departs for length or register, on the merits,
   and the literal is recorded beside it.

### 2.2 The choices that are not the most obvious rendering, and why each stands

| Term | Our `it` | Why |
|---|---|---|
| Islands (expansion) | **Isole** | Our expansion is named "Islands"; we translate ours |
| Knights (expansion) | **Cavalieri** | Same |
| Scenarios (module) | **Scenari** | Same |
| the game | **Costanio** | Untranslated proper noun |
| tile / hex | **tessera** | The standard Italian board-game word for a tile; `casella` is a square on a grid; `esagono` is kept for the strictly geometric sense |
| upgrade (settlement→city) | **potenziare** | The obvious `migliorare` collides with `miglioria`, the Knights city improvement, which the manual uses within one screen (`Migliorie della città` beside `potenziare un insediamento`). `trasformare in città` is not used |
| settlement | **insediamento** | Faithful: `colonia` is a *colony* |
| robber | **ladro** | Faithful: `brigante` is a *brigand* |
| largest army award | **Esercito più grande** | Faithful to "Largest Army" |
| sheep | **pecora** | Our English says "Sheep", not "Wool" |
| brick / clay | **mattone** / **argilla** | Our English separates the `Brick` resource from the `Clay` terrain; Italian maps the split exactly |
| resource (cover term) | **risorsa** | Our English says "resource", not "raw materials" |
| commodity | **merce** | Faithful |
| city wall | **mura** | Faithful |
| city improvement | **miglioria** | Faithful to "improvement" |
| defender of the realm | **Difensore del regno** | Faithful |
| Year of Plenty (card) | **Anno dell'Abbondanza** | Faithful |
| Master Merchant (card) | **Mastro Mercante** | `Mastro` is the guild-master register English's "Master" carries; `Maestro Mercante` is the other reading |
| Warlord (card) | **Condottiero** | The historically exact Italian for a mercenary war-captain. The literal `Signore della Guerra` (20) was not used; `Comandante` is the alternative considered |
| Mining (card) | **Estrazione** | The activity. The literal `Estrazione mineraria` is 20; `Miniera` names the place |
| Printer (card) | **Tipografo** | The trade; the card art is a printing press and its operator. `Stampatore` is the plainer word |

**Ordinary words, not leaks.** `strada`, `città`, `cavaliere`, `porto`, `isola`, `nave`,
`pirata`, `barbari`, `monopolio`, `punto vittoria`, `metropoli`, `acquedotto`, `fortezza`,
`vescovo`, `costituzione`, `diplomatico`, `sabotatore`, `spia`, `matrimonio`, `alchimista`,
`ingegnere`, `inventore`, `irrigazione`, `medicina`, `fabbro`, `Costruzione di Strade`,
`Porto Commerciale` are the ordinary Italian words for the ordinary English words our source
uses. For most of them there is no second option, and familiarity is correct.

---

## 3. Core game nouns

| English | `it` | Gender | Rationale |
|---|---|---|---|
| road | strada | f | |
| settlement | insediamento | m | Faithful; scoreboard short form `Insed.` |
| city | città | f | |
| building (cover term) | costruzione | f | `edificio` is a standing structure and reads oddly for a road |
| ship | nave | f | |
| city wall | mura | f pl. | Plural-only in this sense (`le mura`): never `una mura`. `cinta muraria` where a singular is needed; the walled-city label is `Cinta di mura:`. Piece label and table setting: `Mura` |
| knight (piece) | cavaliere | m | |
| hex / tile (the piece) | tessera | f | §2.2 |
| hex (as terrain) | terreno | m | Where the *terrain* is meant rather than the piece |
| hexagon (geometry) | esagono | m | Only where the shape is the point |
| vertex / intersection / junction | incrocio | m | English uses several words; unified. `vertice` is not used; `angolo` only where the English says "corner" |
| open end (of a road) | estremo | m | Reserved for the open end (the Diplomat card and its prompt); a junction is always `incrocio` |
| edge | lato | m | Also the "path" a camel or rider stands on |
| spot (placeable position) | punto | m | A road "spot" (an edge) is also `punto` |
| port / harbor | porto | m | English uses both; unified |
| generic port (3:1) | porto generico | m | |
| specific port (2:1) | porto specifico | m | |
| robber | ladro | m | Keeps `ladro`/`rubare` in one lexical family |
| pirate | pirata | m | |
| merchant (piece) | mercante | m | |
| longest road | Strada più lunga | f | Short form `Strada` |
| longest route / trade route | Rotta più lunga | f | Covers roads *and* ships, so nothing with `navale` in it would be right. A Knights route (Intrigue hint) is also `rotta` |
| largest army | Esercito più grande | m | Short form `Esercito` |
| victory point (VP) | punto vittoria / **PV** | m | `PV` is the established Italian abbreviation, used wherever the English uses `VP`. Per-item awards: `2 PV ciascuno` / `ciascuna`, agreeing with the counted noun |
| development card | carta sviluppo | f | The compact appositive form; `carta di sviluppo` is longer |
| progress card | carta progresso | f | Same shape |
| resource | risorsa | f | |
| commodity | merce | f | Pairs cleanly with `risorsa`. The one cover term for resource-or-commodity is `bene` |
| bank | banca | f | |
| supply | riserva | f | The source distinguishes "bank" and "supply" in adjacent strings; preserved |
| trade (player to player) | scambio | m | `commercio` is reserved for the improvement track |
| trade (with the bank) | cambio | m | The rate is `tasso di cambio` |
| turn / round | turno / round | m / m | `round` is the word Italian gamers use; `giro` is ambiguous with a lap |
| die / dice | dado / dadi | m | |
| dice roll (the act) | tiro | m | Button copy: `Tira i dadi` |
| number token | segnalino numero | m | Short form `numero`. `gettone` is a token, `segnalino` a marker/chip, splitting them exactly as the English does |
| hand | mano | f | Feminine despite the `-o` |
| hand limit | limite di mano | m | |
| discard limit | limite di scarto | m | Short form `Scarto` |
| deck | mazzo | m | |
| setup (initial placement) | piazzamento iniziale | m | Short form `Piazzamento`. `Preparazione` is not used |
| production | produzione | f | |
| discard (v / n) | scartare / scarto | | |
| pips | **Pips** / pip | | The store currency `Pips` is untranslated (§15); the board-probability sense is lower-case `pip` (`i totali dei pip`), so it does not read as the currency |
| movement (Explorers) | N punti movimento | | Not `N di movimento` |

### Terrain

| English | `it` | Gender | Note |
|---|---|---|---|
| forest | bosco | m | `foresta` is a larger wilderness; `bosco` is the worked woodland the card shows |
| clay | argilla | f | The terrain; the resource is `mattone`. A count of clay hexes is written as the material (`3 argilla` in the land-mix rows) |
| pasture | pascolo | m | |
| field | campo | m | |
| mountain | montagna | f | |
| desert | deserto | m | |
| sea | mare | m | |
| gold | oro | m | |
| gold field | giacimento d'oro | m | Not `campo d'oro` |
| lake | lago | m | |
| fog | nebbia | f | |
| border | bordo | m | |
| land | terra | f | |
| landmass | massa continentale | f | Not `massa di terra`. `terraferma` where the sense allows |

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and Italian preserves the
split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **bosco** | `Wood` → **legno** |
| `Clay` → **argilla** | `Brick` → **mattone** |
| `Pasture` → **pascolo** | `Sheep` → **pecora** |
| `Field` → **campo** | `Wheat` → **grano** |
| `Mountain` → **montagna** | `Ore` → **minerale** |

| English | `it` | Gender | Mass / count | Plural |
|---|---|---|---|---|
| wood / lumber | legno | m | mass | (legni) |
| brick | mattone | m | count | mattoni |
| sheep | pecora | f | count | pecore |
| wheat | grano | m | mass | – |
| ore | minerale | m | count | minerali |
| gold | oro | m | mass | – |
| cloth | stoffa | f | mass | (stoffe) |
| paper | carta | f | mass | – |
| coin | moneta | f | count | monete |

**Two genders and a mass/count split.** `pecora`, `stoffa`, `carta` and `moneta` are
feminine; `legno`, `mattone`, `grano`, `minerale`, `oro` are masculine. `legno`, `grano`,
`oro`, `carta` and `stoffa` are mass nouns and do not pluralise in this game's usage;
`mattone`, `pecora`, `minerale` and `moneta` are count nouns and do. That is why any
resource-bearing phrase is one message per noun (§13b).

**Mass nouns beside a count.** The bare count for a standalone quantity or a tally chip
(`# legno`, `# grano`, `# oro`), and the partitive inside a sentence (`Resta # di legno
nella banca`), so both ICU arms differ only by the verb.

### The `carta` collision

**`carta` is the Italian for both "paper" (the Knights commodity) and "card".** The
catalogue keeps `carta` for both:

| Where | Written as | Why |
|---|---|---|
| a game card, always | **qualified**: `carta sviluppo`, `carta progresso`, `le tue carte`, `carte in mano` | The qualifier disambiguates and is natural Italian anyway |
| the commodity, beside a count | **`# di carta`** (`Costa # di carta`, `Dai alla banca # di carta`) | `di carta` reads as the material, not as a card. Matches `# di stoffa` |
| the commodity, standing alone as a label | **`Carta`** | The commodity chips are icon-plus-label; the icon disambiguates |

The alternative considered is `pergamena` (parchment) for the commodity, which ends the
collision but translates a word our English does not use.

**`moneta`** is both the Knights commodity (and the Rivers currency) and the ordinary word
for money. The store currency is `Pips` and stays untranslated (§15), so the two never
appear together.

---

## 5. Islands expansion

| English | `it` | Rationale |
|---|---|---|
| Islands (the expansion) | Isole | Our own expansion name, translated |
| ship | nave (f) | |
| sea edge / coastal edge | lato di mare / lato costiero | `lato marittimo` and `lato marino` are not used |
| ship route | rotta navale | |
| open ship (movable end) | nave all'estremità aperta | No compact Italian noun exists; `estremità aperta` in prompts |
| pirate | pirata (m) | |
| gold hex | tessera oro | |
| longest trade route | Rotta più lunga | The route counts roads *and* ships, so `navale` would be wrong |
| island | isola (f) | |
| island bonus | Bonus isola | One term for the scoreboard label, the table setting and the VP source; `PV bonus per isola` in the scoreboard long form. `Scoperta di isole` and `Punti isola` are not used |
| landmass | massa continentale | §3 |

---

## 6. Scenario expansions

Registered under `module.tab` → **Scenari**. Event-log lines use the passato prossimo
(`ha costruito`), as the rest of the log does.

### 6.1 Fishermen

| English | `it` | Rationale |
|---|---|---|
| Fishermen | Pescatori | |
| fishing ground | zona di pesca | `peschiera` is a fish pond. Singular `Zona di pesca` for the label of one tile |
| fish tile | tessera pesce | |
| a catch | pescata | Also the Explorers fish haul; the two never meet, because Explorers plays alone |
| you've already fished | hai già fatto il tiro di pesca | `pescare` already means drawing a card |
| fish-spend rung | gradino | |
| the old boot | Vecchio stivale | Meant to be undignified, which is the point of the token |

### 6.2 Caravans

| English | `it` | Rationale |
|---|---|---|
| Caravans | Carovane | |
| camel | cammello (m) | |
| oasis | oasi (f) | Invariable in the plural |
| caravan route | rotta carovaniera | |
| camel junction | incrocio dei cammelli | |
| path (the shared board edge) | lato | The edge can carry a camel and no road; `tratto di strada` is not used |
| Bid nothing | Punta zero | Bidding zero is a response, not sitting out; on time-out the seat is recorded as bidding zero (`non viene puntato nulla per te`) |
| a road credit | un credito per una strada | The spend buys the credit; the road is placed later, as a separate move |
| votes: {total} | `voti: {total}` | Label and value, which avoids number agreement on `{total}` |

**`Bid one less {name}` / `Bid one more {name}`** take the button phrase, a colon, then
`{name}` (`Punta una carta in meno: {name}`). `{name}` arrives capitalised in its citation
form (`Pecora`, `Grano`), so it cannot take an article; the colon is the label/value
separator the house style allows.

### 6.3 Rivers

| English | `it` |
|---|---|
| Rivers (module) | Fiumi |
| river / river hex | fiume / tessera fiume |
| bridge / bridge site | ponte / sito del ponte |
| coin(s) (Rivers currency) | moneta / monete |
| Wealthiest Settler (tile) | Colono più ricco |
| Poorest Settler (tile) | Colono più povero |
| wealth tiles | Tessere ricchezza |
| channel / headwater / mouth | alveo / sorgente / foce |
| watercourse | corso d'acqua |
| ford (noun / verb) / swamp | guado / guadare / palude |

### 6.4 Raiders

| English | `it` |
|---|---|
| Raiders (module) | Predoni |
| raider (neutral enemy on a hex) | predone |
| rider (player's figure on a path) | cavalleggero, never `cavaliere` (the Knights piece). `staffetta` is the alternative considered |
| castle | castello |
| prisoner | prigioniero |
| Muster (card) | Adunata (`Raduno` is the alternative; `Leva` also means a lever) |
| Swift Rider (card) | Cavalleggero rapido |
| Intrigue (Raiders card) | Intrigo, as the Knights card |
| Treason (card) | Tradimento |
| hurry (a rider) | spronare |
| battle / conquer | battaglia / conquistare |
| battle sweep | rastrellamento |
| buyout (pillage) | riscatto |
| place in reach (rider) | lato raggiungibile (a rider ends on a path, so the count names paths) |

The English heading "Two words, one letter apart" (raider / rider) reads `Due figure da non
confondere`.

### 6.5 Wagons

| English | `it` |
|---|---|
| Wagons (module) | Carri |
| wagon | carro |
| cargo / load (scoreboard) | carico |
| cargoes: sand / tools / marble / glass | sabbia / attrezzi / marmo / vetro |
| quarry / glassworks | cava / vetreria |
| toll(s) | pedaggio |
| Swift Journey (card) | Viaggio lampo |
| wagon level / the level track | livello / I livelli del carro |
| upgrading the wagon | migliorare (the wagon, not a settlement) |
| trade hex | tessera commerciale |
| plaza / central plaza | piazza / piazza centrale |
| spoke | raggio |
| sends out / takes (trade hex) | Spedisce / Riceve |
| drive a barbarian off | scacciare (as for the robber) |

### 6.6 Explorers

| English | `it` |
|---|---|
| Explorers (module) | Esploratori |
| settler | colono |
| crew | equipaggio |
| fish haul | pescata |
| (fish) shoal | banco di pesci |
| spice sack | sacco di spezie |
| spice farm / spice village | piantagione di spezie / villaggio delle spezie |
| Fast Gold (village) | Oro rapido |
| Swift Voyage (village) | Traversata rapida |
| Pirate Bonus (village) | Bonus pirata |
| Council / Council hex | Consiglio / tessera del Consiglio |
| Council anchor | ancoraggio |
| harbour settlement (a building, not a port) | insediamento portuale |
| pirate lair / stormed (lair) | covo dei pirati / espugnato |
| hold (a ship's cargo space) | stiva |
| movement points / Movement phase | punti movimento / fase di movimento |
| tribute | tributo |
| explore / reveal (a face-down hex) | esplorare / rivelare |
| track / a step on it | tracciato / passo |
| basin | darsena |
| home island / home waters | isola di partenza / acque di casa |
| scrap a ship | smantellare |
| Cargo Ship / Fleet | Nave da carico / Flotta |
| chit | segnalino numero |
| befriend | stringere amicizia |
| consolation gold | oro di consolazione |
| mission marker | segnalino missione |

### 6.7 Harbormaster and shared scenario terms

| English | `it` |
|---|---|
| Harbormaster (module, award, card) | Capitano di porto |
| harbour settlement (a settlement on a harbour) | insediamento su un porto, kept apart from the Explorers building `insediamento portuale` |
| "Target N." (combination paragraphs) | Obiettivo: N. |
| a refused pair | non è ammesso |
| hex label: desert / lake / gold field | il deserto / il lago / il giacimento d'oro (with the article, like `questa tessera`; `beside {a}` is `lungo {a}` and `to {name}` is `verso {name}`, so no `a il` can arise) |

Gender-neutral frames are used where a noun is interpolated: `Carico: {0}, destinazione:
{1}.`, `{res}: non ne hai abbastanza in mano`, `Scelti: {0} su {count}`.

---

## 7. Knights expansion

| English | `it` | Rationale |
|---|---|---|
| Knights (the expansion) | Cavalieri | Our own expansion name, translated |
| knight (piece) | cavaliere (m) | |
| build a knight | Recluta cavaliere; `Recluta forza 1` | `Costruisci cavaliere` reads wrong for a person. `costruire` stays for roads, settlements, cities, ships and walls |
| knight tiers | **cavaliere di forza 1 / 2 / 3** | The source numbers the tiers throughout |
| `Strength N knights` (label) | Cavalieri di forza 1 / 2 / 3 | One entry serves the post-game scoreboard and the StatusPanel legend |
| strength | forza (f) | |
| activate | attivare; attivo / inattivo | |
| promote | promuovere | `Promuovi a forza {next}`; §11 |
| displace | spostare | |
| chase the robber | scacciare il ladro | Short board-action label `Scaccia` |
| progress card | carta progresso | Where the superordinate is avoidable the catalogue names the deck |
| city improvement | miglioria (f) | `miglioramento` is longer and abstract; `miglioria` is the concrete built improvement |
| improvement track | percorso di miglioria | Only where the source needs the abstraction |
| advance (a track) | avanzare | §11 |
| Trade / Politics / Science | Commercio / Politica / Scienza | |
| maritime trade | commercio marittimo | |
| commodity | merce (f) | |
| metropolis | metropoli (f, inv.) | |
| event die | dado evento | The compact appositive form is idiomatic Italian for game components |
| barbarians / barbarian fleet | barbari / flotta barbara | |
| barbarian attack | invasione (f) | The source uses "attack", "invasion" and "landfall"; unified except where the source contrasts them. `incursione` is not used |
| barbarian distance | distanza dei barbari | |
| pillage / raze a city | saccheggiare | `declassare` is accurate and bloodless; the source is not bloodless |
| defender of the realm | Difensore del regno | The token is `gettone Difensore`, always with the noun |
| Merchant Guild | Gilda dei mercanti | Wire name `trading_house` must not change |
| Fortress / Aqueduct | Fortezza / Acquedotto | |
| city wall | mura | §3; plural-only |

---

## 8. The 30 card titles

Titles composite over the card art at runtime. `lib/cardTitle.ts` fits a title from the
subset fonts' advance widths, splitting at authored break opportunities (a space, a soft
hyphen `U+00AD`, a zero-width space `U+200B`) before it shrinks, and `cardTitle.test.ts`
runs every title in every catalogue through it. All thirty Italian titles fit; nine set on
two lines at the standard two-line scale (0.850), as eight English titles also do:

| Italian | Sets as |
|---|---|
| `Porto Commerciale` | `PORTO` / `COMMERCIALE` |
| `Mastro Mercante` | `MASTRO` / `MERCANTE` |
| `Flotta Mercantile` | `FLOTTA` / `MERCANTILE` |
| `Monopolio di Risorse` | `MONOPOLIO` / `DI RISORSE` |
| `Monopolio Commerciale` | `MONOPOLIO` / `COMMERCIALE` |
| `Costruzione di Strade` (×2) | `COSTRUZIONE` / `DI STRADE` |
| `Punto Vittoria` | `PUNTO` / `VITTORIA` |
| `Anno dell'Abbondanza` | `ANNO DELL'` / `ABBONDANZA` |

- **`Anno dell'Abbondanza` carries a `U+200B` after the apostrophe.** It is the seam the
  fitter breaks at, `bestSplit` in `cardTitle.ts` names this title in its comment, and a
  test asserts the split. Do not remove it, and do not let a cleanup that strips invisible
  characters remove it either.
- The two `Monopolio…` titles share their first line, `MONOPOLIO`; the second line
  distinguishes them.
- Any change to a title must be re-run through `cardTitle.test.ts`.

### Development deck

| id | English | `it` |
|---|---|---|
| `knight` | Knight | Cavaliere |
| `victory_point` | Victory Point | Punto Vittoria |
| `road_building` | Road Building | Costruzione di Strade |
| `year_of_plenty` | Year of Plenty | Anno dell'Abbondanza |
| `monopoly` | Monopoly | Monopolio |

### Trade deck

| id | English | `it` |
|---|---|---|
| `commercial_harbor` | Commercial Harbor | Porto Commerciale |
| `master_merchant` | Master Merchant | Mastro Mercante (§2.2) |
| `merchant` | Merchant | Mercante |
| `merchant_fleet` | Merchant Fleet | Flotta Mercantile |
| `resource_monopoly` | Resource Monopoly | Monopolio di Risorse |
| `trade_monopoly` | Trade Monopoly | Monopolio Commerciale |

### Politics deck

| id | English | `it` |
|---|---|---|
| `bishop` | Bishop | Vescovo |
| `constitution` | Constitution | Costituzione |
| `deserter` | Deserter | Disertore |
| `diplomat` | Diplomat | Diplomatico |
| `intrigue` | Intrigue | Intrigo |
| `saboteur` | Saboteur | Sabotatore |
| `spy` | Spy | Spia |
| `warlord` | Warlord | Condottiero (§2.2) |
| `wedding` | Wedding | Matrimonio (`Nozze` is shorter and more festive) |

### Science deck

| id | English | `it` |
|---|---|---|
| `alchemist` | Alchemist | Alchimista |
| `crane` | Crane | Gru |
| `engineer` | Engineer | Ingegnere |
| `inventor` | Inventor | Inventore |
| `irrigation` | Irrigation | Irrigazione |
| `medicine` | Medicine | Medicina |
| `mining` | Mining | Estrazione (§2.2) |
| `printer` | Printer | Tipografo (§2.2) |
| `road_building_sci` | Road Building | Costruzione di Strade. **Must be byte-identical to `road_building`**: the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Fabbro |

---

## 9. UI and system vocabulary

| English | `it` | Rationale |
|---|---|---|
| lobby | sala (f) | `atrio` is a physical foyer |
| table (a game room) | tavolo (m) | The source's own metaphor, and it survives translation |
| game (a match) | partita (f) | `gioco` is the game as a product; `partita` is one instance of play |
| non-ranked game | partita amichevole | One term in every chapter |
| ruleset / mode | modalità (f, inv.) | The source uses both interchangeably; Italian unifies |
| spectate / spectator | osservare / spettatore | |
| invite / invite code | invito / codice di invito | |
| seat / open seat | posto / posto libero | |
| host (noun) | organizzatore (m) | Borrowed `host` (invariable, shorter) is the alternative considered |
| host (verb, "start a game") | crea | `Crea un tavolo` |
| ready (player) | pronto | Generic masculine, §13 |
| ready (connection) | connesso | The source has two "Ready" strings with different `msgctxt`; two words in Italian |
| disconnect / reconnect | disconnettere / riconnettere | |
| Connection lost / Reload | Connessione persa / Ricarica | |
| ban | sospensione (f) | |
| report (a message) | segnalare | |
| mute | silenziare | |
| supporter | sostenitore (m) | Generic masculine; `chi ci sostiene` is a phrase, not a label |
| cosmetic / name decoration | decorazione (f) | `Decorazioni del nome`; supporter copy also says `cosmetici da sostenitore` |
| guest | ospite (m/f) | Invariable in gender |
| leave / rematch / surrender | esci / rivincita / arrenditi | |
| Exit / Leave / Log out | Esci | One word for all three; `Disconnetti` reads as dropping the connection |
| draw (a drawn game) | pareggio (m) | Unrelated to drawing a card (§11) |
| bot | bot | |
| ranked | classificata | Agrees with `partita` (f), which is fixed |
| leaderboard | classifica (f) | |
| rating | punteggio (m) | |
| store | negozio (m) | |
| Pips (the currency) | Pips | Left untranslated; a product name |
| settings | Impostazioni | |
| display (settings heading) | Visualizzazione | |
| Home (nav) | Inizio | |
| player count on ranked chips | `4g` | `g` for `giocatori` |
| the fine print | i dettagli in piccolo | Both occurrences match |
| pay-to-win / loot box | pay-to-win / loot box | Borrowed, as `bot`, `Pips` and `Privacy` are |
| online | online | Borrowed |
| cooldown | Sei in attesa… | |
| reset (to lobby) | Reimposta | |
| Fair (dice mode) | Equilibrati | The board-generation setting keeps its own `Equilibrato` |
| friendly robber (table setting) | Ladro gentile | One term in the lobby and the manual |
| theme / light / dark / system | tema / chiaro / scuro / sistema | |
| map builder | editor di mappe | `costruttore di mappe` is a calque |
| custom map | mappa personalizzata | |
| brush / paint / randomize | pennello / dipingi / casuale | |
| turn timer / turn order | timer del turno / ordine di turno | `timer` is the word Italian UIs use; `cronometro` is a stopwatch |
| turn-timer presets | Blitz / Normale / Rilassato | `Blitz` is the Italian word too (§15) |
| replay | riproduzione (f) | |
| board | tabellone (m) | |

---

## 10. Interface actions

Buttons and menu items. Register: imperative or bare noun, sentence case, no final period.

| English | `it` | Notes |
|---|---|---|
| Build | Costruisci | |
| Buy / Play (a card) | Compra / Gioca | |
| Draw (a card) | Pesca | Never `ruba` (§11) |
| Discard | Scarta | |
| Dismiss (a toast) | Chiudi | Not `scarta`: English uses one word for two actions and Italian must not |
| Steal | Ruba | |
| Move / Place / Pass | Sposta / Piazza / Passa | |
| Roll | Tira i dadi | Short variant `Tira` |
| Offer / Counter | Offri / Controfferta | |
| Accept / Decline / Reject | Accetta / Rifiuta | Two English words, one Italian word; the `msgctxt` split is preserved |
| Cancel / Confirm | Annulla / Conferma | The product has no Undo, so `Annulla` only ever means Cancel |
| End turn | Fine turno | The noun form; short variant `Fine` |
| Start game | Inizia partita | |
| Upgrade (settlement → city) | Potenzia | Distinct from `promuovi` and `avanza` (§11) |
| Activate / Promote | Attiva / Promuovi | |
| Chase / Displace / Relocate | Scaccia / Sposta / Ricolloca | `Sposta` is both "Move" (the robber) and "Displace" (a knight); the two never appear on the same surface |
| Remove / Remove player | Rimuovi / Espelli giocatore | The second is a kick and says so |
| Rejoin (take a seat back from a bot) | Riprendi posto | |
| Equip / Unequip | Equipaggia / Rimuovi | The "this one is on" state is `In uso`, not `Equipaggiato`, on gender grounds (§13) |
| Link / Unlink / Merge | Collega / Scollega / Unisci | |
| Join / Watch / Send | Unisciti / Guarda / Invia | |
| Zoom in / out | Ingrandisci / Riduci | |
| Auto (toggle) | Automatico | |

---

## 11. Collisions English hides

| English word | Senses | Italian | Note |
|---|---|---|---|
| **draw** | take a card / a level game / paint with a brush | **pescare** / **pareggio** / **disegnare** | Three unrelated words, each with its own `msgctxt` |
| **steal** | take from a player | **rubare** | Italian keeps `pescare` and `rubare` apart natively |
| **upgrade / promote / advance** | settlement→city / knight rank / improvement track | **potenziare** / **promuovere** / **avanzare** | Held rigidly. `migliorare` is avoided for buildings because `miglioria` is the city improvement |
| **discard / dismiss** | throw cards away / close a notification | **scartare** / **chiudere** | |
| **trade** | player-to-player / with the bank / the improvement track | **scambio** / **cambio** / **Commercio** | |
| **carta** (the reverse collision) | Italian's own word covers *paper* and *card* | Card always qualified; commodity written `# di carta` | §4 |
| **Sposta** (reverse collision) | Italian's own word covers *Move* and *Displace* | Both `Sposta`; they never co-occur | §10 |
| **Esci** (reverse collision) | Exit / Leave / Log out | All `Esci` | §9 |
| **pip / Pips** | board probability / store currency | `pip` / `Pips` | §3 |
| **play** | play a card / play a game | `giocare` covers both and they never collide in practice | |
| **ready** | player is ready / connection is ready | `pronto` / `connesso` | The `msgctxt` split is honoured |
| **knight / rider** | Knights piece / Raiders figure | `cavaliere` / `cavalleggero` | §6.4 |

---

## 12. Length and overflow

Italian runs 15-25% longer than English. Most strings are not in fixed-width slots, but
the following are the known tight surfaces and their short forms:

| Surface | English | Italian | Short form |
|---|---|---|---|
| board action pill | `Build settlement` | `Costruisci insediamento` | `Insediamento` |
| board action pill | `Build city` | `Costruisci città` | `Città` |
| board action pill | `Build knight` | `Recluta cavaliere` | `Cavaliere` |
| turn chip | `Build / Trade` | `Costruisci / Scambia` | |
| turn pill | `End turn` | `Fine turno` | `Fine` |
| turn pill | `Roll` | `Tira i dadi` | `Tira` |
| scoreboard column | `Army` | `Esercito` | none |
| scoreboard column | `Settle` | `Insed.` | |
| scoreboard row + StatusPanel legend | `Strength 1/2/3 knights` | `Cavalieri di forza 1/2/3` | `Cavalieri forza N` |
| lobby setting | `Discard limit` | `Limite di scarto` | `Scarto` |
| lobby setting | `Barbarian distance` | `Distanza dei barbari` | `Distanza` |
| lobby setting | `Turn timer` | `Timer del turno` | `Timer` |
| lobby setting | `Max players` | `Giocatori max` | already abbreviated |
| lobby setting | `Setup` | `Piazzamento iniziale` | `Piazzamento` |
| nav item | `Map builder` | `Editor di mappe` | `Editor` |
| queue chip | `Ranked` | `Classificata` | `Classif.` |
| button | `Boost to unlock` | `Potenzia il server per sbloccare` | no compact Italian for Discord's "boost" |
| button | `Rejoin` (from bot) | `Riprendi posto` | `Riprendi` |
| stat pill | `win rate` | `percentuale di vittorie` | `% vittorie` |
| store label | `Equipped` | `In uso` | shorter, and avoids gender |

Card titles are covered in §8 and are measured by `cardTitle.test.ts`.

---

## 13. Gender agreement

### Restructure first

Where the English is gender-neutral and the Italian would not be, the string is
restructured so nothing agrees with the reader:

| Message | Problem | Rendered as |
|---|---|---|
| `{seatedCount} seated` | `seduti` agrees with people | `{seatedCount} al tavolo` |
| `Connected to the table` | `connesso` agrees with the reader | `Sei al tavolo` |
| `You're already seated at this table.` | same | `Hai già un posto a questo tavolo.` |
| `You're not seated at this table.` | same | `Non hai un posto a questo tavolo.` |
| `Equipped` | agrees with the (unknown) item noun | `In uso` |
| `Full` / `Private` / `Public` | agree with `partita`/`tavolo` | resolved per referent; both are fixed nouns |
| `None` (no decoration) | agrees with `decorazione` (f) | `Nessuna` |
| `Walled: holds 2 extra cards` | agrees with `città` (f) | `Cinta di mura:` |
| `recommended:` hints | agree with each control's noun | each agrees with its own control (`consigliato:` / `consigliata:`), possible because the English is four separate messages |

**Number agreement is the Italian-specific extra.** Italian has `-o/-i` and `-a/-e`
plurals that a count drives, so wherever a count and a noun meet, the noun is written inside
the ICU arm rather than interpolated (§13b).

### Generic masculine where no restructure exists

The generic masculine is used for the player where every alternative is gendered too and
the layout cannot hold `pronto/a`: `Pronto` (seat badge), `Vincitore` (scoreboard),
`# giocatori`, `Sostenitore`, `Organizzatore`, `il tuo avversario` (the generic in Italian
rules register, used that way throughout the manual), and `passare a spettatore` (a
predicate role in a transition idiom, where Italian leaves the noun unmarked).

---

## 13b. Strings that interpolate a noun

A frame that interpolates a bare resource, commodity or card name into a slot where
Italian needs an agreeing article, quantifier or number cannot be translated correctly,
because the resource names split across two genders and across mass and count nouns. The
source therefore uses three shapes, and any new string of this kind should take one of them:

1. **One message per noun**, keyed `card.<phrase>.<card>` and `dev.notHeld.<card>` in
   `frontend/src/lib/cardPhrases.ts`, with the noun written into the message.
2. **Counted nouns carry the count as an ICU `plural`**, so the verb agrees with the count
   and the noun inflects:

   | id | `one` | `other` |
   |---|---|---|
   | `card.bankLeft.sheep` | `Resta # pecora nella banca` | `Restano # pecore nella banca` |
   | `card.bankLeft.wood` | `Resta # legno nella banca` | `Restano # legno nella banca` |
   | `card.bankLeft.ore` | `Resta # minerale nella banca` | `Restano # minerali nella banca` |
   | `card.improveCost.coin` | `Costa # moneta` | `Costa # monete` |
   | `card.improveCost.paper` | `Costa # di carta` | `Costa # di carta` |

   The identical arms on `legno`, `grano` and `carta` are the mass-noun
   non-inflection of §1 and §4.
3. **Tallies use a multiplier suffix** (`Legno ×2`, through `goodCount()` in
   `frontend/src/lib/cardFace.ts`), which governs nothing.

A list in a governed position takes a colon instead (`You are short of: {missing}`), so
nothing has to agree with it.

---

## 14. Structural conventions

These hold for every entry and are checked by `scripts/po_verify.py it`:

- The catalogue's entry order matches `en`; keyed ids (`error.*`, `card.*`, `log.*`,
  `mapIssue.*`, `terrain.*`, `piece.*`, `module.*`) are preserved byte for byte.
- Every `{name}` placeholder and every `<0>`/`</0>`/`<1/>` tag in the English appears in
  the Italian, as a multiset.
- Every ICU `plural` keeps its variable, keyword and both `one` and `other` arms; every
  `select` keeps its exact arm set.
- No translation equals its own msgid (`catalog.test.ts`'s guard); a translation that would
  is left blank instead (§15).
- Translator comments use the `#` namespace, never `#.` (which `lingui extract`
  regenerates), and come before any `msgctxt` line.
- Numeric literals in the rules manual match the English.
- Emphasis tags wrap the content word the English emphasises, not a function word that
  Italian word order happened to leave inside the tag, and a tag never begins with a space.

---

## 15. Terms deliberately not translated, and deliberate blanks

- **Player display names, chat bodies, user-saved map names.** User content.
- **Bot display names.** Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values.** Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names.** Brand flavour.
- **`Pips`**, the store currency.
- **`Costanio`**, in every page title, and proper nouns in the disclaimer string.

**Deliberate blanks.** An entry whose only correct Italian is a copy of the English is left
with an empty `msgstr`. It falls back to exactly that string at runtime, and keeps
`catalog.test.ts`'s "a translation is never its own message id" guard meaningful. A short
translator comment on the entry says why it is blank. The kinds:

- Placeholder frames with no translatable word: `{0}` · `{0} ({1} Pips)` ·
  `{label}, {total}` · `{label}: {n}` · `{name}: {instruction}` · `{nextReward}. {nextCost}` ·
  `{ratio}:1 {resource}` · `{staked} → {got}` · `2:1 {resource}` · `{resource} {num}` ·
  `log.produced` (a bare `{player} <0/>` frame).
- Words Italian uses identically: `Base` (the ruleset name, each context) · `Blitz`
  (turn-timer preset) · `Bot` · `Menu` · `Privacy` (footer link and page title) · `Volume`.
- Product and platform names: `Pips` · `Booster` (Discord's own label for the role).

A blank must never be an entry that carries an ICU plural: the English fallback would then
render English plural arms.
