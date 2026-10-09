# Spanish (`es`) terminology glossary

This document records the terminology, register and grammar conventions the `es`
catalogue (`frontend/src/locales/es/messages.po`) follows. Terminology is the expensive
decision: a term chosen here recurs in hundreds of strings and is costly to change
afterwards, so check this file before introducing a new word.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/base.md`,
`docs/rules/islands.md`, `docs/rules/knights.md`, `docs/rules/scenarios.md`,
`art/cards/cards.json`, `frontend/src/locales/README.md`, and the calling code
(`src/lib/cardPhrases.ts`, `src/lib/locationActions.ts`, `src/lib/boardInfo.ts`,
`src/routes/HowToPlay.tsx`).
**Companions:** `glossary-zh-Hans.md`, `glossary-ja.md` follow the same structure. The
naming policy is in §2.

---

## 1. Register and regional decisions

These are global and hold across every string. Mixing them is the most visible sign of an
assembled translation.

### Which Spanish: neutral international (`es`), not `es-ES` and not `es-419`

The target is a vocabulary that a player in Madrid, Mexico City, Bogotá or Buenos Aires
reads without friction. Where a peninsular and an American term compete, the rule is:
**pick the term that is understood everywhere, even where it is nobody's first choice.**
There is one Spanish catalogue for both hemispheres; the vocabulary that actually divides
is small, the game's domain is medieval and concrete, and every divided term has a
neutral option.

| Concept | Peninsular | American | **Chosen** | Note |
|---|---|---|---|---|
| you (sg.) | tú | tú / vos | **tú** | `vos` is Rioplatense and Central American; `tú` is understood universally. Never `vos` |
| you (pl.) | vosotros | ustedes | **ustedes** | `vosotros` is the loudest peninsular marker and does not exist in American Spanish. It appears nowhere in the catalogue |
| settings | ajustes | configuración | **Ajustes** | Both understood; `Ajustes` is 7 characters against 13, which the settings drawer needs. A soft split, not a hard one |
| to report (a message) | denunciar | reportar | **denunciar** | `reportar` is a marked calque in Spain; `denunciar` is understood everywhere, though heavier in tone. The translation-error link uses `Informar de un error de traducción` |
| tile (board piece) | loseta | ficha / casilla | **casilla** | `loseta` is peninsular board-game jargon; `ficha` collides with the number token (§3) |
| to add | añadir | agregar | **añadir** | Both understood everywhere and neither is marked |
| live (streaming) | en directo | en vivo | **en vivo** | The pan-Hispanic form, used in Spain too |
| to click | hacer clic | hacer clic / cliquear | **haz clic** | The source splits `Tap` (touch) from `Click` (mouse); the split is preserved (`toca` / `haz clic`) |
| OK / fine | vale | ok / bueno | *(avoided)* | `vale` is peninsular; no string needs it |
| a match | partida | partida | **partida** | Universal, and better than `juego` for one instance of play |
| fishing ground | caladero | caladero | **caladero** | Trade vocabulary rather than a regionalism; the Fishermen scenario is about fishing and the manual glosses it in place. Alternative `zona de pesca` |
| Auto (toggle) | auto | auto | **Automático** | `Auto` alone means *car* in most of Latin America, so the English cannot be borrowed |

**Never used:** `coger` (obscene across most of Latin America; use `tomar` / `quitar`) and
any `vosotros` conjugation (`sabéis` and the like). A quick check:
`grep -nE '\bcog(e|es|er|iendo)|éis\b' es/messages.po` should return nothing.

### Formality: `tú`, everywhere, including the legal pages

The English source is chatty and informal ("Say hi to your table…", "Jump into a
table!"). `usted` against that source produces a register clash on every screen, and
Spanish game and app localisation has settled on `tú` for consumer products. `ustedes` is
the plural. The decision holds on the legal surfaces too: only the page titles of Terms and
Privacy are in this catalogue today, and if their body copy is ever localised it stays
`tú`, since a register that changes between screens is worse than either register held
consistently.

**Prefer the impersonal where Spanish allows it.** `No puedes construir ahí`, never
`Tú no puedes construir ahí`. Buttons are infinitives or bare nouns (`Construir`,
`Ajustes`), prompts to act are `tú` imperatives (`Toca una casilla`), and statements about
the player's state are second-person present (`No tienes recursos`).

### Draw and steal: `tomar` and `robar`

A card is **drawn** with `tomar` and **stolen** with `robar`. `robar` for both is what many
Spanish card players say (DRAE *robar* 3), but holding the two apart keeps three places
unambiguous: the log, where `{player} tomó <0/>` (drew) and `{thief} robó a {victim} <0/>`
(stole) scroll in the same column; the `Robadas / perdidas` scoreboard row, which names
only theft; and phrases with no dative to lean on (`alguien resulta robado`, `no se roba
nada`). Every steal string carries an explicit dative (`roba una carta a cualquier
jugador`, `elige a quién robar`).

The rule applies across modules: a steal is `robar` in the Raiders 7 and the Explorers
pirate too, even where the English says "take". A draw is always `tomar`.

### Punctuation

- **Inverted marks are mandatory.** Every question gets `¿…?` and every exclamation
  `¡…!`, including inside a longer sentence: `¡Gana {who}! 🎉`, `¿Volver a la sala?`.
- The repository's no-em-dash rule is an English house-style rule, but Spanish does not
  want an em dash for parentheticals either: where the English uses a dash, this catalogue uses a
  comma, a colon, a semicolon or parentheses. En-dash number ranges in the source (`1–4`,
  `3–10`) become plain hyphens.
- No space before `?` `!` `:` `;`. Ellipsis is the single character `…`, matching the source.

### Plurals

Spanish has the English shape: **`one` / `other`**. `Intl.PluralRules("es")` also defines
`many`, but only at exact millions, which no count in this app reaches, so it is not
required. Every ICU `plural` in the source keeps its wrapper, its selector variable and both
arms.

English messages with identical arms (`{n, plural, one {# sheep} other {# sheep}}`) usually
become two-armed in Spanish (`one {# oveja} other {# ovejas}`). Those for
`madera`, `trigo` and `oro` stay identical on purpose, because they are mass nouns.

A plural wrapper may move *inside* the sentence so the Spanish verb or article can agree
with the count (`Se {n, plural, one {descartó # carta} other {descartaron # cartas}}
automáticamente.`; `{count, plural, one {Ya has elegido # carta} other {Ya has elegido las
# cartas}}`). The parameter and both arms survive; only the span changes.

### Capitalisation

Spanish does not use English headline case:

- **Sentence case by default**, including buttons, headings and column headers:
  `Fin de turno`, `Mapas guardados`, `Puntos de victoria`.
- **Panel headings are written in sentence case** even where they display in capitals: the
  source applies `uppercase` in CSS (`Capítulos`, `Tamaño`, `Recurso`, `Número`,
  `Puerto`). Accented capitals survive the transform (`LÍMITE DE DESCARTE`).
- **Card titles are Title Case** (`Construir Caminos`, `Maestro Mercader`, `Año de
  Abundancia`, `Flota Mercante`) and are proper names: they keep their capitals in prose
  mentions too. They render as display type with `text-transform: uppercase`.
- **Award names take sentence case** (`Camino más largo`, `Mayor ejército`, `Ruta más
  larga`), as does `Gremio de mercaderes`.

---

## 2. Naming policy

### 2.0 The rule

> Translate our English faithfully. Only the game title and the expansion names get our
> own words.

Our own English card names (`art/cards/cards.json`: Master Merchant, Warlord, Bishop,
Constitution, Deserter, Diplomat, Intrigue, Saboteur, Crane, Engineer, Inventor,
Irrigation, Medicine, Mining, Printer, Smith, Road Building, Year of Plenty) are
descriptive phrases. A Spanish translation that avoids the natural Spanish for them is
less faithful than the source, for no benefit. `CONTRIBUTING.md` at the repository root
states the rule.

- **Translate straight, even where the result is familiar board-game Spanish:** all card
  titles, resource names, mechanic names (longest road, largest army, victory point),
  settlement, road, city, port, robber, development card, progress card.
- **Diverges:** the game's title, and the expansion names, which are our own
  ("Islands", "Knights", "Scenarios") and are translated as such.

### 2.1 Direct translations over invented substitutes

| English | Invented alternative (not used) | **Used** | Why |
|---|---|---|---|
| settlement | asentamiento | **poblado** | Direct, and 7 characters against 12: `Construir poblado` (17) rather than `Construir asentamiento` (22) |
| robber | bandido | **ladrón** | The direct translation, and it keeps `ladrón`/`robar` in one lexical family |
| progress card | carta de avance | **carta de progreso** | The direct translation |
| Master Merchant (card) | Gran Mercader | **Maestro Mercader** | The direct translation of our card's name |
| Year of Plenty (card) | Abundancia | **Año de Abundancia** | The direct translation |

### 2.2 The choices that are not the most obvious rendering, and why each stands

| Term | Our `es` | Why |
|---|---|---|
| Islands (expansion) | **Islas** | Our expansion is named "Islands"; we translate ours |
| Knights (expansion) | **Caballeros** | Same |
| Scenarios (module) | **Escenarios** | Same |
| road | **camino** | `carretera` is a modern paved highway, a poor fit for a medieval fiction; `camino` is the plainest word |
| tile / hex | **casilla** | Neutrality: `loseta` is peninsular (§1). `casilla` names a hexagon with a word meaning *cell*, which is accepted; `hexágono` is exact but would require masculine agreement throughout |
| promote (a knight) | **ascender** | `promocionar` is marketing register. `ascender` keeps `mejorar` (upgrade a building) and `subir de nivel` (advance a track) distinct |
| event die | **dado de eventos** | `acontecimientos` is 15 characters |
| sheep | **oveja** | Our English says "Sheep", not "Wool" |
| brick / clay | **ladrillo** / **arcilla** | Our English separates the `Brick` resource from the `Clay` terrain, and Spanish maps the split exactly |
| resource (cover term) | **recurso** | Our English says "resource", not `materias primas` |
| longest road award | **Camino más largo** | Faithful to our English |
| largest army award | **Mayor ejército** | Faithful to our English |
| Merchant Guild | **Gremio de mercaderes** | Faithful to our English name |
| knight tiers | **de fuerza 1/2/3** | Our English uses `Strength 1/2/3` |
| Irrigation (card) | **Riego** | `riego` is the ordinary word for watering land; `Irrigación` is technical |
| Warlord (card) | **Caudillo** | The exact word, and short. It carries political associations in Spain and Latin America; `Comandante` is the alternative considered |
| Trade Monopoly (card) | **Monopolio Comercial** | Stands on being the better phrase; the literal `Monopolio de Mercancías` was not used |
| Constitution (card) | **Constitución** | Neutral register; `Fuero` (a medieval charter) is historical and reads as peninsular |

---

## 3. Core game nouns

| English | `es` | Rationale |
|---|---|---|
| road | camino | Plainest word, short enough for a HUD counter |
| settlement | poblado | Direct and compact |
| city | ciudad | |
| building (settlement or city, collectively) | construcción | `edificio` is a standing structure and reads oddly for a road |
| ship | barco | `navío` is literary, `nave` reads as spacecraft |
| city wall | muralla | A defensive city wall, as against `muro` (any wall) |
| knight (piece) | caballero | |
| hex / tile (the piece) | casilla | §1, §2.2 |
| hex (as terrain) | terreno | Where the *terrain* is meant rather than the piece |
| vertex / intersection / junction | cruce | `intersección` is too long for a prompt. English uses several words; unified. `vértice` is not used; `esquina` only for a real corner |
| edge | arista | Geometric and precise; `lado` is ambiguous. A board edge is always `arista`, never `trayecto` (see below) |
| spot (a placeable position) | punto | A road or ship spot (an edge) is also `punto` |
| port / harbor | puerto | English uses both; unified |
| generic port (3:1) | puerto general | |
| specific port (2:1) | puerto específico | |
| robber | ladrón | Personified: `movió al ladrón`, `ahuyentar al ladrón`, with the personal `a` throughout |
| pirate | pirata | |
| merchant (piece) | mercader | Over `comerciante` |
| longest road | Camino más largo | `trayecto` is the word for the continuous chain (`tu trayecto continuo más largo`) |
| longest route / longest trade route | Ruta más larga | Covers roads and ships both |
| largest army | Mayor ejército | Short form `Ejército` |
| victory point (VP) | punto de victoria / **PV** | `PV` is the established Spanish abbreviation, used wherever the English uses `VP` |
| development card | carta de desarrollo | |
| progress card | carta de progreso | |
| resource | recurso | |
| commodity | mercancía | §4 |
| bank | banco | |
| supply | reserva | The source distinguishes "bank" and "supply" in adjacent strings; preserved |
| trade (player to player) | intercambio | `comercio` is reserved for the improvement track |
| trade (with the bank) | cambio | |
| turn / round | turno / ronda | |
| dice / die | dados / dado | |
| dice roll (the act) | tirada | Button copy: `Tirar los dados` |
| number token | número / ficha de número | `ficha numerada` is correct and too long for repeated use |
| hand / hand limit | mano / límite de mano | |
| discard limit | límite de descarte | |
| deck | mazo | |
| setup (initial placement) | colocación inicial | |
| production | producción | |
| discard (verb / noun) | descartar / descarte | |
| harvested (Irrigation and Mining log line) | recolectar | One line serves wheat and ore; `cosechar` is wrong for ore and `extraer` for wheat |
| pips | pips | Left untranslated; also the store currency's name (§15) |
| terrain: forest / clay / pasture / field / mountain / desert | bosque / arcilla / pastos / campo / montaña / desierto | `pastos` over `pradera`; `dehesa` is markedly peninsular |
| terrain: sea / gold / lake / fog / border / land | mar / oro / lago / niebla / borde / tierra | |
| mainland | continente | `tierra firme` is the alternative |

**`trayecto` is a journey, not an edge.** It names a continuous run (the Longest Road
chain, a wagon's or a knight's move). A board edge, including the one a camel or rider
stands on, is `arista`. Using `trayecto` for an edge produces sentences where one word
means two things a clause apart.

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and Spanish preserves the
split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **Bosque** | `Wood` → **Madera** |
| `Clay` → **Arcilla** | `Brick` → **Ladrillo** |
| `Pasture` → **Pastos** | `Sheep` → **Oveja** |
| `Field` → **Campo** | `Wheat` → **Trigo** |
| `Mountain` → **Montaña** | `Ore` → **Mineral** |

| English | `es` | Gender | Count / mass |
|---|---|---|---|
| wood / lumber | madera | f | mass |
| brick | ladrillo | m | count |
| sheep | oveja | f | count |
| wheat | trigo | m | mass |
| ore | mineral | m | count |
| gold | oro | m | mass |
| cloth | tela | f | see below |
| paper | papel | m | see below |
| coin | moneda | f | count |

**Mixed genders and the mass/count split are why resource-bearing strings are one message
per noun** (§13b). Any phrasing that puts an article, quantifier or adjective next to a
resource must know which noun it is.

**`mercancía` for *commodity*.** It is concrete, pairs cleanly with `recurso` (`los
recursos y las mercancías de la víctima juntos`) and never reads as *asset*. `bien` /
`bienes` is shorter but abstract. Spanish has no short cover noun for resources and
commodities together, so where the English has one ("same good on both sides") the noun is
dropped (`lo mismo en los dos lados`).

**Counting cloth and paper: `# de tela`, `# de papel`.** `tela` and `papel` are mass nouns
in ordinary Spanish and `2 telas` reads as *two fabrics*. `moneda` is a count noun and is
always `2 monedas`. A bare `de tela` cannot stand without a count, so a ratio line reads
`Cambiar tela a 2:1`, not `Cambia de tela a 2:1`.

**Counted amounts of gold** are `N de oro`, with identical plural arms (mass noun).

**`moneda` has two senses.** It is both the Knights commodity (and the Rivers currency)
and the ordinary word for the store's earned currency. No second word exists for either,
so the two must not appear in the same sentence; the store string reads `Moneda que se gana
jugando y se gasta en la tienda`, which is unambiguous in isolation.

---

## 5. Islands expansion

| English | `es` | Rationale |
|---|---|---|
| Islands (the expansion) | Islas | Our own expansion name, translated |
| ship | barco | |
| sea edge / coastal edge | arista marítima / arista costera | Not `arista de mar` |
| ship route | ruta marítima | |
| open ship (movable end) | barco en el extremo abierto | No compact noun exists; `extremo abierto` in prompts. `extremo` is reserved for the free end of a ship line and is never used for a junction (`cruce`) |
| pirate | pirata | |
| gold hex | casilla de oro | |
| longest trade route | Ruta más larga | The route counts roads *and* ships, so `marítima` would be wrong |
| island | isla | |
| island discovery / island bonus | Descubrimiento de islas (scoreboard label) / bonificación por isla (manual prose and table setting) | Scoreboard short form `Isla` |

---

## 6. Scenario expansions

Registered under `module.tab` → **Escenarios**. Event-log lines use the preterite
(`construyó`, `tomó`), as the rest of the log does.

### 6.1 Fishermen

| English | `es` | Rationale |
|---|---|---|
| Fishermen | Pescadores | |
| fishing ground | caladero | Singular `Caladero` for the label of one tile. Alternative `zona de pesca` (§1) |
| fish tile | ficha de pesca | A 1-fish tile is `ficha de 1 pez` |
| fish (the currency) | peces | `pescado` only for a catch |
| fish-spend rung | escalón | |
| the old boot | Bota vieja | Meant to be undignified, which is the point of the token |

### 6.2 Caravans

| English | `es` | Rationale |
|---|---|---|
| Caravans | Caravanas | |
| camel | camello | |
| oasis | oasis | Invariable in the plural |
| caravan route | ruta de caravanas | |
| camel junction | cruce de camellos | |
| path (the shared board edge) | arista | The edge can carry a camel and no road; `tramo de camino` is not used |
| Bid nothing | Pujar cero | Bidding zero is a response, not sitting out; on time-out the seat is recorded as bidding zero (`no se puja nada en tu nombre`) |
| a road credit | un crédito de camino | The spend buys the credit; the road is placed later, as a separate move |
| votes: {total} | `votos: {total}` | Label and value, which avoids number agreement on `{total}` |

**`Bid one less {name}` / `Bid one more {name}`** take the button phrase, a colon, then
`{name}` (`Pujar una carta menos: {name}`). `{name}` arrives capitalised in its citation
form (`Oveja`, `Trigo`), so it cannot take an article; the colon is the label/value
separator the house style allows.

### 6.3 Rivers

| English | `es` |
|---|---|
| Rivers (module) | Ríos |
| river / river hex | río / casilla de río |
| bridge / bridge site ("crossing") | puente / sitio de puente (`cruce` is the vertex) |
| coin(s) (Rivers currency) | moneda(s) |
| Wealthiest Settler (tile) | Colono más rico |
| Poorest Settler (tile) | Colono más pobre |
| mouth / channel, watercourse / headwater | desembocadura / cauce / nacimiento |
| ford (noun / verb) / swamp | vado / vadear / pantano |

### 6.4 Raiders

| English | `es` |
|---|---|
| Raiders (module) | Saqueadores |
| raider (neutral enemy on a hex) | saqueador |
| rider (player's figure on a path) | jinete |
| castle | castillo |
| prisoner | prisionero |
| Muster (card) | Leva (alternative considered: `Reclutamiento`) |
| Swift Rider (card) | Jinete veloz |
| Intrigue (Raiders card) | Intriga, as the Knights card |
| Treason (card) | Traición |
| hurry (a rider) | apurar |
| battle / conquer | batalla / conquistar |
| battle sweep | barrido |
| buyout (pillage) | rescate |
| place in reach (rider) | arista a su alcance (a rider ends on a path, so the count names paths) |

The English heading "Two words, one letter apart" (raider / rider) cannot hold in Spanish
(`saqueador` / `jinete`), so it reads `Dos figuras que no hay que confundir`.

### 6.5 Wagons

| English | `es` |
|---|---|
| Wagons (module) | Carretas |
| wagon | carreta |
| cargo / load (scoreboard) | carga |
| cargoes: sand / tools / marble / glass | arena / herramientas / mármol / vidrio |
| quarry / glassworks | cantera / vidriería |
| toll(s) | peaje |
| Swift Journey (card) | Viaje veloz |
| wagon level / the level track | nivel / Los niveles de la carreta |
| trade hex | casilla comercial |
| plaza | plaza |
| spoke | radio |
| drive a barbarian off | ahuyentar (as for the pirate and the robber) |
| "Takes X" (trade hex) | Recibe X |
| Upgrade and trade | Mejorar y cambiar (`cambio` = trade with the bank) |

Gender-neutral frames are used where a cargo name is interpolated: `Carga: {0}, destino:
{1}.` and `{res}: no tienes suficiente en la mano`.

### 6.6 Explorers

| English | `es` |
|---|---|
| Explorers (module) | Exploradores |
| settler | colono |
| crew | tripulación |
| fish haul | captura de pescado (short: captura) |
| (fish) shoal | banco de peces |
| spice sack | saco de especias |
| spice farm / spice village | plantación de especias / aldea de especias |
| Fast Gold (village) | Oro rápido |
| Swift Voyage (village) | Travesía veloz |
| Pirate Bonus (village) | Bonificación pirata |
| Council / Council hex | Consejo / casilla del Consejo |
| Council anchor | fondeadero |
| harbour settlement (a building, not a port) | poblado portuario |
| pirate lair | guarida pirata |
| hold (a ship's cargo space) | bodega |
| movement points / Movement phase | puntos de movimiento / fase de movimiento |
| tribute | tributo |
| explore / reveal (a face-down hex) | explorar / revelar |
| track / a step on it (track position) | pista / paso (`casilla` is the hex) |
| basin | dársena |
| scrap a ship | desguazar |
| home island | isla de origen |
| chit stacks | pilas de fichas |
| Cargo Ship / Fleet | Barco de carga / Flota |
| consolation gold | oro de consolación |

### 6.7 Harbormaster and shared scenario terms

| English | `es` |
|---|---|
| Harbormaster (module, award, card) | Capitán de puerto |
| "Target N." (combination paragraphs) | Objetivo: N. |
| hex label: desert / lake / gold field | el desierto / el lago / el campo de oro (with the article, like `esta casilla`; `beside {a}` is `bordeando {a}` and `to {name}` is `hacia {name}`, so no `a el` can arise) |

---

## 7. Knights expansion

| English | `es` | Rationale |
|---|---|---|
| Knights (the expansion) | Caballeros | Our own expansion name, translated |
| knight (piece) | caballero | |
| build a knight | Reclutar caballero | You do not build a person |
| knight tiers | **caballero de fuerza 1 / 2 / 3** | The source says `Strength 1 knights`, `Promote to strength {next}`; Spanish follows it |
| strength (a knight's tier) | fuerza | |
| level (total of active knights, barbarian rail) | nivel | Held apart from `fuerza` |
| activate | activar; activo / inactivo | |
| promote | ascender | §2.2 |
| displace | desplazar | |
| chase the robber | ahuyentar al ladrón | Short board-action label `Ahuyentar` |
| progress card | carta de progreso | The decks are `Comercio`, `Política`, `Ciencia`; where the superordinate is avoidable the catalogue names the deck |
| city improvement | mejora de ciudad | |
| improvement track | vía de mejora | Only where the source needs the abstraction |
| Trade / Politics / Science | Comercio / Política / Ciencia | Track names are proper names: `Política de nivel 3` |
| commodity | mercancía | §4 |
| metropolis | metrópoli | |
| event die | dado de eventos | §2.2 |
| barbarians / fleet | bárbaros / flota bárbara | |
| barbarian attack | invasión | The source uses "attack", "invasion" and "landfall"; unified except where the source contrasts them |
| barbarian distance | distancia de los bárbaros | |
| pillage / raze a city | arrasar | Used consistently; `degradar` is accurate and bloodless |
| defender of the realm | Defensor del reino | The token is `ficha de Defensor` (a player *earns a Defender token*, `gana una ficha de Defensor`) |
| Merchant Guild | Gremio de mercaderes | Wire name `trading_house` must not change |
| Fortress / Aqueduct | Fortaleza / Acueducto | |
| demanded (levy) | exigió | `pidió` is too soft for a card that takes without asking |
| is up for grabs | queda vacante | `está en juego` is ambiguous in a game |

---

## 8. The 30 card titles

Titles composite over the card art at runtime, as display type at large size and at a
small hand thumbnail. At thumbnail size the title is decoration in every language and the
art and deck stripe identify the card.

**Length.** About 12 average uppercase characters fit on one line at the full 62 px cap.
Several English titles already exceed one line and are auto-shrunk. Split at the best
space, every multi-word Spanish title fits on two lines at the full cap (`MONOPOLIO` /
`DE RECURSOS`, `CONSTRUIR` / `CAMINOS`, `AÑO DE` / `ABUNDANCIA`), so the faithful titles
are used rather than shortened ones. Shorter alternatives such as `Comercio` and `Recursos`
are avoided because the two monopoly cards would stop being distinguishable at a glance.
Accented capitals (`Ó`, `Í`, `Á`) need vertical room under `uppercase`; `Constitución` and
`Diplomático` are the test cases.

### Development deck

| id | English | `es` |
|---|---|---|
| `knight` | Knight | Caballero |
| `victory_point` | Victory Point | Punto de Victoria |
| `road_building` | Road Building | Construir Caminos (`Construcción de Caminos`, 23, not used) |
| `year_of_plenty` | Year of Plenty | Año de Abundancia |
| `monopoly` | Monopoly | Monopolio |

### Trade deck

| id | English | `es` |
|---|---|---|
| `commercial_harbor` | Commercial Harbor | Puerto Comercial |
| `master_merchant` | Master Merchant | Maestro Mercader |
| `merchant` | Merchant | Mercader |
| `merchant_fleet` | Merchant Fleet | Flota Mercante |
| `resource_monopoly` | Resource Monopoly | Monopolio de Recursos |
| `trade_monopoly` | Trade Monopoly | Monopolio Comercial (must stay visibly distinct from `resource_monopoly`) |

### Politics deck

| id | English | `es` |
|---|---|---|
| `bishop` | Bishop | Obispo |
| `constitution` | Constitution | Constitución |
| `deserter` | Deserter | Desertor |
| `diplomat` | Diplomat | Diplomático |
| `intrigue` | Intrigue | Intriga |
| `saboteur` | Saboteur | Saboteador |
| `spy` | Spy | Espía |
| `warlord` | Warlord | Caudillo (§2.2) |
| `wedding` | Wedding | Boda |

### Science deck

| id | English | `es` |
|---|---|---|
| `alchemist` | Alchemist | Alquimista |
| `crane` | Crane | Grúa |
| `engineer` | Engineer | Ingeniero |
| `inventor` | Inventor | Inventor (identical; the entry is blank, §17) |
| `irrigation` | Irrigation | Riego |
| `medicine` | Medicine | Medicina |
| `mining` | Mining | Minería |
| `printer` | Printer | Imprenta |
| `road_building_sci` | Road Building | Construir Caminos. **Must be byte-identical to `road_building`**: the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Herrero |

---

## 9. UI and system vocabulary

| English | `es` | Rationale |
|---|---|---|
| lobby | sala | `vestíbulo` is a physical foyer |
| table (a game room) | mesa | The source's own metaphor, and it survives translation |
| game (a match) | partida | |
| ruleset / mode | modo | The source uses both interchangeably; Spanish unifies |
| spectate / spectator | observar / espectador | The button is `Salir y observar` |
| invite / invite code | invitar / código de invitación | |
| seat / open seat | asiento / asiento libre | |
| host (noun) | anfitrión | |
| host (verb, "start a game") | crear | `Crear una mesa` |
| ready (player) | listo | Generic masculine, §13 |
| ready (connection) | conectado | The source has two "Ready" strings with different `msgctxt`; they are two words in Spanish |
| disconnect / reconnect | desconectar / reconectar | |
| Connection lost / Reload | Conexión perdida / Recargar | The standard UI noun phrase |
| ban | suspensión | |
| report (a message) | denunciar | §1. `Denunciar mensaje`, `Chat y denuncias` |
| mute | silenciar | |
| supporter | mecenas | Invariable in the plural (`los mecenas`), which sidesteps gender |
| cosmetic (the category) | cosmético | `Seat cosmetics`, `Cosmetics never affect play` |
| decoration (the name effect) | decoración | `Name decoration`, `Could not set decoration`: a specific item, not the category |
| guest | invitado | Shares a root with `invitación`; no neutral alternative exists, and `anónimo` would be a different claim |
| leave / rematch / surrender | salir / revancha / rendirse | |
| draw (a drawn game) | empate | Never confuse with "draw a card" (§11) |
| bot | bot | |
| ranked | clasificatoria | `Buscando clasificatoria` for the queue heading |
| Casual | Informal | `casual` means "by chance" in Spanish |
| leaderboard | clasificación | |
| rating | puntuación | |
| Win % (column) | % vict. | Fits the narrow leaderboard column on one line |
| store | tienda | |
| on the shelf | a la venta | The shelf metaphor does not survive into Spanish |
| Pips (the currency) | Pips | Left untranslated: a product name |
| boost (Discord) | mejora el servidor | `boostear` is the loanword players use; the description was preferred |
| settings | ajustes | §1 |
| theme / light / dark / system | tema / claro / oscuro / sistema | |
| map builder | editor de mapas | `constructor de mapas` is a calque |
| custom map | mapa propio | `Mapa personalizado` implies customising a preset rather than authoring one |
| brush / paint / randomize | pincel / pintar / aleatorizar | |
| turn timer | reloj de turno | The setting's label; manual prose also uses `temporizador de turno` |
| turn order | orden de turno | |
| friendly robber (table setting) | ladrón amable | |
| Live now | en vivo | §1 |

---

## 10. Interface actions

Buttons and menu items. Register: infinitive or bare noun, sentence case, no final period.

| English | `es` | Notes |
|---|---|---|
| Build | Construir | |
| Buy / Play (a card) | Comprar / Jugar | |
| Draw (a card) | Tomar | Never `robar` (§1) |
| Discard | Descartar | |
| Dismiss (a toast) | Cerrar | Not `descartar`: English uses one word for two actions and Spanish must not |
| Steal | Robar | |
| Move / Place / Pass | Mover / Colocar / Pasar | |
| Roll | Tirar los dados | |
| Offer / Counter | Ofrecer / Contraoferta | |
| Accept / Decline / Reject | Aceptar / Rechazar | Two English words, one Spanish word; the `msgctxt` split is preserved |
| Cancel / Confirm / Undo | Cancelar / Confirmar / Deshacer | |
| End turn | Fin de turno | The noun form; short variant `Fin` |
| Start game | Empezar partida | |
| Upgrade (settlement → city) | Mejorar a ciudad | Distinct from `ascender` and `subir de nivel` |
| Activate / Promote | Activar / Ascender | |
| Chase / Displace / Relocate | Ahuyentar / Desplazar / Reubicar | |
| Remove / Remove player | Quitar / Expulsar jugador | The second is a kick and says so |
| Rejoin (take a seat back from a bot) | Recuperar asiento | |
| Equip / Unequip | Equipar / Quitar | The "this one is on" state is `En uso`, not `Equipado`, on gender grounds (§13) |
| Link / Unlink / Merge | Vincular / Desvincular / Fusionar | |
| Join / Watch / Send | Unirse / Ver / Enviar | |
| Zoom in / out | Acercar / Alejar | |

**Tap-tips are infinitives** (`Tomar un ladrillo`, `Tomar hasta 2 ladrillos`), not
imperatives, across the whole family.

---

## 11. Collisions English hides

| English word | Senses | Spanish |
|---|---|---|
| **draw** | take a card / a level game / paint with a brush | `tomar` / `empate` / `dibujar`, each with its own `msgctxt` |
| **robar** (the reverse collision) | the Spanish idiom covers *draw* and *steal* | Reserved for **steal** only (§1) |
| **upgrade / promote / advance** | settlement→city / knight rank / improvement track | `mejorar` / `ascender` / `subir de nivel`, held rigidly |
| **discard / dismiss** | throw cards away / close a notification | `descartar` / `cerrar` |
| **trade** | player-to-player / with the bank / the improvement track | `intercambio` / `cambio` / `Comercio` |
| **path / edge** | a board edge / a chain of roads | `arista` / `trayecto` (§3) |
| **strength / level** | a knight's tier / a total on the barbarian rail | `fuerza` / `nivel` |
| **moneda** | the Knights commodity / the store currency | Both are `moneda`; never in one sentence (§4) |
| **play** | play a card / play a game | `jugar` covers both and they never collide in practice |

---

## 12. Length and overflow

Spanish runs 20-30% longer than English, but most strings are not in fixed-width slots:
native `title=` tooltips are sized by the browser, the post-game stats labels wrap, the
post-game scoreboard is a full-width table inside `overflow-x-auto`, the LocationDial
readout grows upward rather than clipping, the turn chip is capped for long seat names,
and buttons size to their content. The tight places:

| Surface | English | Spanish | Note |
|---|---|---|---|
| ranked queue panel heading (fixed `w-[260px]`) | `Searching ranked` | `Buscando clasificatoria` | `Buscando partida clasificatoria` wraps to a second line |
| leaderboard column (`w-16`) | `Win %` | `% vict.` | `% victorias` wraps |
| settings drawer | `Settings` | `Ajustes` | `Configuración` does not fit |
| Store button | `Boost to unlock` | `Mejora el servidor para desbloquear` | The button wraps by design (`<Button wrap>`); covered by `i18nOverflow.test.tsx` |
| rejoin button | `Rejoin` (from bot) | `Recuperar asiento` | Covered by `i18nOverflow.test.tsx` |
| map builder half-width button | `Reroll ports` | `Volver a repartir los puertos` | Wraps to two lines; acceptable |
| three-button toggle row | `Auto` | `Automático` | The row widens; nothing clips |

Card titles are covered in §8. `components/ui/segmented.tsx` capitalises every word of a
segment label, so a two-word label such as `Al azar` renders as `Al Azar`; the catalogue
string stays in sentence case.

---

## 13. Gender agreement

### Restructure first

Where the English is gender-neutral and the Spanish would not be, the string is
restructured so nothing agrees with the reader. These are settled; do not "correct" them
back.

| Message | Problem | Rendered as |
|---|---|---|
| `{seatedCount} seated` | `sentados` agrees with people | `{seatedCount} en la mesa` |
| `Connected to the table` | `conectado` agrees with the reader | `Ya estás en la mesa` |
| `You're already seated at this table.` | same | `Ya tienes un asiento en esta mesa.` |
| `You're not seated at this table.` | same | `No tienes asiento en esta mesa.` |
| `Equipped` | agrees with the (unknown) item noun | `En uso` |
| `Full` / `Private` / `Public` | agree with `mesa` | `Llena` / `Privada` / `Pública`, safe because the referent is fixed |
| `Pays for Politics/Science/Trade improvements…` | the pronoun agrees with the track's commodity | Three separate strings: `Lo produce` for `papel`, `La produce` for `moneda` and `tela` |
| `None` (no decoration) | agrees with `decoración` | `Ninguna` |
| `Walled: holds 2 extra cards` | agrees with `ciudad` | `Amurallada:` |

### Generic masculine where no restructure exists

Four strings have nowhere to go, and use the standard generic masculine rather than
inclusive forms (`Ganador/a`, `@`/`x` endings), which would also not fit the chrome:

| String | Rendered as |
|---|---|
| `Ready` (player) | `Listo` |
| `Winner` | `Ganador` |
| `# players` | `# jugadores` |
| `strongest defender` | `defensor` |

---

## 13b. Strings that interpolate a noun

A frame that interpolates a bare resource, commodity or card name into a slot where
Spanish needs an agreeing article, quantifier or number cannot be translated correctly:
resource names split across two genders and across mass and count nouns, so no single
phrasing is right for all values (`Take every {0} in play` would need `todo el` / `toda
la` / `todas las`). The source therefore uses three shapes, and any new string of this kind
should take one of them:

1. **One message per noun**, keyed `card.<phrase>.<card>` (and `dev.notHeld.<card>`) in
   `frontend/src/lib/cardPhrases.ts`. `Tomar un ladrillo` / `Tomar una oveja` / `Tomar
   madera` are three entries; `Tomar todas las ovejas en juego` sits alongside `Tomar todo
   el trigo en juego`. Passing an article-bearing parameter instead was not adopted: it
   does not generalise to languages that need case, and it moves the grammatical decision
   to call sites that do not know what they interpolate into.
2. **Counted nouns carry the count as an ICU `plural`**, so Spanish inflects the noun and
   agrees the verb:

   | id | `one` | `other` |
   |---|---|---|
   | `card.bankLeft.sheep` | `Queda # oveja en el banco` | `Quedan # ovejas en el banco` |
   | `card.bankLeft.wood` | `Queda # madera en el banco` | `Quedan # madera en el banco` |
   | `card.bankLeft.ore` | `Queda # mineral en el banco` | `Quedan # minerales en el banco` |
   | `card.improveCost.coin` | `Cuesta # moneda` | `Cuesta # monedas` |

   Identical arms on `madera` and `trigo` are intended (mass nouns); `tela` and `papel`
   use `# de tela` / `# de papel` (§4).
3. **Tallies use a multiplier suffix** (`madera ×2`, through `goodCount()` in
   `frontend/src/lib/cardFace.ts`) for price and trade lines, so no agreement is needed and
   the form matches the icon-plus-`×n` trade chips.

---

## 14. Structural conventions

These hold for every entry and are checked by `scripts/po_verify.py es`:

- The `(msgctxt, msgid)` sequence matches `en` exactly; keyed ids (`error.*`, `card.*`,
  `log.*`, `mapIssue.*` and the rest) are preserved byte for byte.
- Every `{name}` placeholder and every `<0>`/`</0>`/`<0/>` tag in the English appears in
  the Spanish, as a multiset. Compare against the English *msgstr*: keyed entries carry no
  placeholders in their msgid.
- Every ICU plural keeps its wrapper and selector, with arms for `one` and `other`.
- No translation equals its own msgid (`catalog.test.ts`'s guard); a translation that would
  is left blank instead (§17).
- Every `?` and `!` is opened with `¿` / `¡`.
- Translator comments use the `#` namespace, never `#.` (which `lingui extract`
  regenerates), and come before any `msgctxt` line.

---

## 15. Terms deliberately not translated

- **Player display names, chat bodies, user-saved map names.** User content
  (`docs/user-facing-text.md`, category (c)).
- **Bot display names.** Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values.** Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names.** Brand flavour.
- **`Pips`**, both the board-probability sense and the store currency.
- **`Costanio`**, in every page title, and proper nouns in the disclaimer string.
- **`Booster`**, Discord's own label for the role.

---

## 17. Deliberate blanks

An entry whose only correct Spanish is a copy of the English is left with an empty
`msgstr`. It falls back to exactly that string at runtime, and keeps `catalog.test.ts`'s
"a translation is never its own message id" guard meaningful. A short translator comment
on the entry says why it is blank. The kinds:

| Entry | Why blank |
|---|---|
| `{0}`, `{label}, {total}`, `{label}: {n}`, `{name}: {instruction}`, `{resource} {num}` | placeholders and a separator |
| `{0} ({1} Pips)` | placeholder, product name, punctuation |
| `{nextReward}. {nextCost}` | two translated sentences run together; Spanish punctuates it the same way |
| `{ratio}:1 {resource}`, `2:1 {resource}` | a ratio and a placeholder |
| `{staked} → {got}` | two placeholders and an arrow |
| `log.produced` | a name followed by a card run |
| `Base` (ruleset name, each context), `Bot`, `Color`, `Total`, `Inventor`, `Normal` (turn-timer preset) | the same word in Spanish. The other two presets are translated (`Relámpago`, `Relajado`) |
| `China` | a map name, and the country's name in Spanish |
| `Pips` | the store currency's product name |
| `Booster` | Discord's own label for the role |

A blank must never be an entry that carries an ICU plural: the English fallback would then
render English plural arms. Blanks are only ever placeholder frames or words Spanish
spells identically.
