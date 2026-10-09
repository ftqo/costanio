# French (`fr`) terminology glossary

The terminology, register and grammar conventions the `fr` catalogue
(`frontend/src/locales/fr/messages.po`) follows. Terminology is the expensive decision: a
term chosen here recurs in hundreds of strings and is costly to change afterwards, so a
change here means a find-and-replace over the `.po`. Translator comments in the
catalogue cite this file by section number (`glossary §11`), so section numbers are stable
and some are intentionally absent.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/*.md`, the engine itself
(`engine/winnability.go`, `engine/knights/`), `frontend/src/lib/*.ts` call sites,
`art/cards/cards.json`, `frontend/src/locales/README.md`, `docs/i18n/CONTRIBUTING.md`.
**Companions:** `glossary-de.md`, `glossary-es.md`, which share this structure.

---

## 1. Register, typography, plurals, capitalization

These are global and hold across every string. Mixing them is the most visible sign of an
assembled translation.

### Register: `vous`, everywhere, including the legal-page titles

`de` chose `du` and `es` chose `tú`. `fr` chooses `vous`, for these reasons:

- **French `tu` is a stronger claim than German `du` or Spanish `tú`.** In German and
  Spanish consumer software, informal address is now the unmarked default. In French it is
  still marked: `tu` from a product to an adult it has never met reads as familiar rather
  than friendly, and the failure is asymmetric. `vous` with light diction never reads as
  cold; `tu` misjudged reads as presumptuous.
- **The rules manual is about a quarter of this catalogue,** and French board-game rules are
  written to `vous` essentially without exception. `vous` is the register that is right in
  both halves.
- **The source's informality is carried by vocabulary and rhythm, not by the pronoun.**
  "Jump into a table!" becomes `Rejoignez une table !`, not a stiffer sentence. Short verbs,
  `C'est parti`, `À vous de jouer`, no `veuillez`, no `il vous est loisible de`. The register
  is polite-neutral, not formal-corporate.

No entry uses `tu`, `toi`, `ton`, `ta` or `tes`. Held in the legal surfaces too: only the
*titles* of Terms and Privacy are in this catalogue, but when that copy is localized it
stays `vous`, because a register that changes between screens is worse than either register
held consistently.

**Prefer the impersonal where French allows it.** `Impossible de construire ici`, not
`Vous ne pouvez pas construire ici`, wherever the shorter impersonal is natural: it is
shorter (§12) and it sidesteps participle agreement (§13). Buttons are infinitives or bare
nouns (`Construire`, `Réglages`); prompts to act are `vous` imperatives
(`Choisissez une tuile`); statements about the player's state are second-person present
(`Vous n'avez pas assez de ressources`).

**Never `Vous êtes prêt(e)`.** Parenthesised feminines, interpunct forms (`prêt·e`) and
double forms are all out: they are noisy in a dense UI and the project has taken no
position on inclusive orthography. Where agreement with the reader would be forced, the
sentence is restructured (§13). Where restructuring is not available, the generic masculine
is used (`Prêt`, `Vainqueur`, `Défenseur`, `un invité`, `chaque joueur`).

### Typography

French spacing rules are real punctuation, not decoration. Applied without exception:

| Mark | Space before | Character |
|---|---|---|
| `?` `!` `;` | yes, thin | U+202F NARROW NO-BREAK SPACE |
| `:` | yes, full | U+00A0 NO-BREAK SPACE |
| `«` … `»` | inside the marks | U+202F on both sides |
| `,` `.` `…` | none | |
| `%` `€` | full | U+00A0 |

- **Why U+202F and not a plain space:** a plain space before `?` lets the mark wrap to the
  next line, which is the failure the rule exists to prevent. Both characters are
  non-breaking.
- **Why U+202F and not U+00A0 before `? ! ;`:** it is the Imprimerie nationale rule and the
  French Wikipedia convention (thin before `?!;»`, full before `:`). The project ships its
  UI font (Baloo 2), and that font draws U+202F as a real glyph at half a space, so the
  glyph's presence is a property of the file rather than of the browser. Do not normalise
  the file to U+00A0.
- Digit ratios (`2:1`), times and URLs take no space.
- **Quotation marks:** French guillemets `«` `»` replace the source's straight double
  quotes in prose. Straight quotes are kept where the quoted thing is a machine value.
- **Apostrophes:** the typographic apostrophe `’` (U+2019) throughout, never `'`.
- **Dashes.** The repository's no-em-dash rule for user-facing text applies here too, and
  French does not want an em dash for parentheticals either: where the English uses a dash, this
  catalogue uses a comma, a colon, a semicolon or parentheses. En-dash ranges in the source
  (`1–4`, `3–10`) stay en dashes, which is correct French for a range.
- **Ellipsis** is the single character `…`, matching the source. No space before it.
- **Capitalization after a colon** stays lowercase, as in French, even where the English
  capitalizes.

### Plurals

French has exactly the English shape in CLDR: **`one` / `other`**. Every ICU `plural` in the
source keeps its wrapper, its selector variable and both arms. Two French-specific facts:

- **French puts 0 in the `one` category.** `0` renders through the `one` arm, so every
  `one` arm has to read correctly for both `0` and `1`: `# carte restante` is right for
  `0 carte restante` and `1 carte restante`. Do not collapse the arms: French has two
  forms, and they are distributed differently from English. The
  same is why a plural entry is never left blank: a blank falls back to the English message
  while French rules pick the arm, so a French player at zero would read the English
  singular.
- **Some English messages have identical arms** because English does not inflect the noun
  (`{n, plural, one {# sheep} other {# sheep}}`). French usually does, so most become
  two-armed (`# mouton` / `# moutons`). Some stay identical in French on purpose:
  `resource.count.wood` / `.wheat` / `.gold` and their `card.bankLeft.*` and
  `card.harborRate.*` partners, because `bois`, `blé` and `or` are mass nouns (§4), plus
  `log.islandChip`, where the arm is `+# PV`. Each carries a note so the identical arms are
  not read as a copy-paste error.

Where the French verb has to agree with the count, the plural wrapper moves inside the
sentence (`Il {n, plural, one {reste # carte} other {reste # cartes}}`). The parameter and
both arms survive; only the span changes.

### Capitalization

French does not use English headline case, and over-capitalizing is the classic tell of a
translated-from-English interface.

- **Sentence case by default**, including buttons, headings and column headers:
  `Fin du tour`, `Cartes sauvegardées`, `Points de victoire`. Headings that CSS uppercases
  are written in sentence case in the catalogue, not in literal capitals.
- **Title case only for the 30 card titles** (§8), which are rendered as display type over
  the card art with `text-transform: uppercase`.
- **The French board-game convention of capitalizing the game's own nouns** is adopted
  only in the compound card-type names `carte Développement` and `carte Progrès`, where
  it disambiguates the noun from ordinary use. Elsewhere: `une colonie`, `une route`,
  `le voleur`, lowercase.
- Award names take sentence case (`Route la plus longue`, `Plus grande armée`), which is
  French convention and differs from the English source's Title Case.

---

## 2. Naming policy

### 2.0 The rule

> Translate our English faithfully. Only the game title and the expansion names are our own.

Our own English card names (`art/cards/cards.json`: Master Merchant, Warlord, Bishop,
Constitution, Deserter, Diplomat, Intrigue, Saboteur, Crane, Engineer, Inventor,
Irrigation, Medicine, Mining, Printer, Smith, Road Building, Year of Plenty) are
descriptive phrases rather than marks. A French catalogue that avoids the natural French
for them is less faithful than the source, for no benefit.

- **Translate straight, even where the result is familiar board-game French:** all card
  titles, resource names, mechanic names (longest road, largest army, victory point),
  `colonie`, `route`, `ville`, `port`, `voleur`, `carte Développement`, `carte Progrès`.
- **Our own names:** the game's title (`Costanio`, untranslated, §15), and the expansion
  names, which render *our* English words: **Îles**, **Chevaliers**, **Scénarios**,
  **Pêcheurs**, **Caravanes**, **Rivières**, **Pillards**, **Chariots**, **Explorateurs**,
  **Capitaine de port**.

Two failure modes to avoid: substituting ordinary nouns nobody coined (`village` for
`colonie`, `chemin` for `route`), and inventing near-miss card titles to look "different".

### 2.1 Substitutions considered and rejected

| English | Rejected | **Chosen** | Why |
|---|---|---|---|
| settlement | village, comptoir | **colonie** | `colonie` is the direct translation of our English word. `village` invents a distinction the source does not make |
| road | chemin, voie | **route** | Same. `chemin` would collide with the board edge, and `voie` is the improvement track (§7) |
| robber | brigand, bandit | **voleur** | Direct translation, and it keeps `voleur`/`voler` in one lexical family |
| progress card | carte Avancement | **carte Progrès** | The direct translation |
| Year of Plenty | Invention, Découverte | **Année d’Abondance** | Translating ours lands on `Année d’Abondance` |
| Road Building | Deux Routes | **Construction de Routes** | Direct, though long (§8) |

### 2.2 The choices that are not the most obvious rendering, and why each survives

| Term | Our `fr` | Why |
|---|---|---|
| Islands (expansion) | **Îles** | Our expansion is named "Islands". We translate ours |
| Knights (expansion) | **Chevaliers** | Same |
| Scenarios (module) | **Scénarios** | Same |
| sheep | **mouton** | Our English says "Sheep", not "Wool" |
| brick / clay | **brique** / **argile** | Our English separates the `Brick` resource from the `Clay` terrain, and French has the same pair |
| largest army | **Plus grande armée** | Faithful to "Largest Army", and short |
| commodity | **marchandise** | The ordinary translation of "commodity". `denrée` (6 characters against 11) reads as foodstuff, and this game's commodities are cloth, paper and coin; `bien` is too abstract and `produit` collides with production |
| event die | **dé événement** | Faithful to our English |
| city wall | **rempart** | Both `rempart` and `muraille` are correct; `rempart` is one character shorter |
| promote (a knight) | **promouvoir** | Keeps `améliorer` (upgrade a building), `promouvoir` (knight rank) and `progresser` (improvement track) as three distinct verbs, which English blurs |
| Warlord (card) | **Chef de Guerre** | The literal `Seigneur de Guerre` is 18 characters, too long for the card title (§8). `Chef de Guerre` is idiomatic modern French |
| Mining (card) | **Mine** | `Exploitation Minière` is 20 characters. `Extraction` (10) is the alternative that fits but names the wrong half of the idea |
| Defender of the Realm | **Défenseur du royaume** | Faithful to our English |
| gold hex | **tuile d’or** | Faithful and short |
| terrains | forêt, argile, prairie, champ, montagne, désert | Our English names the clay hex "Clay" |

---

## 3. Core game nouns

| English | `fr` | Chars | Rationale |
|---|---|---|---|
| road | route (f) | 5 | Direct, short |
| settlement | colonie (f) | 7 | |
| city | ville (f) | 5 | |
| building (cover term) | bâtiment (m) | 8 | The rules use "building" constantly for settlement-or-city. `construction` (12) is the act |
| ship | bateau (m) | 6 | `navire` is a bigger vessel and a longer word |
| city wall | rempart (m) | 7 | §2.2 |
| knight (piece) | chevalier (m) | 9 | |
| game piece (any physical piece) | pion (m) | 4 | Never `pièce`, which is the coin (§4) |
| connection piece (road or ship) | pion de liaison | | |
| hex / tile (the piece) | tuile (f) | 5 | `hexagone` (8) is kept for the map builder where the geometry is the point |
| hex (as terrain) | terrain (m) | 7 | Where the *terrain* is meant rather than the piece |
| land tile / sea tile | tuile de terre / tuile de mer | | Not `tuile terrestre` |
| vertex / junction / corner (where a building stands) | intersection (f) | 12 | One French word for the three English ones. `coin` only for geometric corners (of the ring, a landmass, a trade hex) |
| edge (and "path", the edge a camel or rider stands on) | arête (f) | 5 | Geometric and short: `arête maritime`, `arête côtière`, `arête de destination`. Never `chemin` |
| spot (a placeable position) | emplacement (m) | 11 | `place` where tight |
| route (a continuous run of roads and ships) | tracé (m) | 5 | `route` is the piece, `voie` is the improvement track |
| port / harbour | port (m) | 4 | English uses both words; unified |
| generic port (3:1) | port 3:1 | 8 | `port générique` only where the ratio is not shown, or where `port 3:1` would make the sentence state its own condition |
| specific port (2:1) | port 2:1 | 8 | `spécialisé` only as an adjective (`ports spécialisés`) |
| robber | voleur (m) | 6 | `voleur terrestre` only where the source contrasts it with the pirate |
| pirate | pirate (m) | 6 | |
| merchant (piece) | marchand (m) | 8 | Over `négociant`; `commerçant` is 11 |
| longest road | Route la plus longue | 20 | |
| longest trade route | Route commerciale la plus longue | 32 | Covers roads *and* ships, so nothing with `maritime` in it would be right |
| largest army | Plus grande armée | 17 | §2.2 |
| victory point (VP) | point de victoire / **PV** | 17 / 2 | `PV` is the established French abbreviation, used in UI chrome wherever the English uses `VP`. The rules manual writes `pt` / `pts` (§14) |
| development card | carte Développement | 19 | `carte Dév.` where tight |
| progress card | carte Progrès | 13 | |
| resource | ressource (f) | 9 | |
| commodity | marchandise (f) | 11 | §2.2 |
| bank | banque (f) | 6 | |
| supply | réserve (f) | 7 | The source distinguishes "bank" from "supply" in adjacent strings; the distinction is preserved |
| trade (player to player) | échange (m) | 7 | `commerce` is reserved for the improvement track |
| trade (with the bank) | échange (m) | 7 | Same word; the complement disambiguates (`échange avec la banque`) |
| turn / round | tour (m) / manche (f) | 4 / 6 | |
| dice / die | dés / dé | 3 / 2 | |
| dice roll (the act) | lancer (m) | 6 | Button: `Lancer les dés` |
| number token | jeton (m) | 5 | `jeton numéroté` (14) in prose, `jeton` in UI. Also the island exploration chip; the two never share a sentence |
| hand / hand limit | main (f) / limite de main | 4 / 14 | |
| discard limit | limite de défausse | 18 | |
| deck | pioche (f) | 6 | Any face-down draw pile, including the progress decks. `paquet` only for the shuffled deck of 36 dice outcomes, which is not a draw pile |
| stack (of resource cards) | pile (f) | 4 | Distinct from `pioche` |
| setup (initial placement) | placement initial | 17 | The second setup placement is `second placement`, never `deuxième tour` |
| snake order (setup) | ordre en serpentin | | `ordre aller-retour` is the descriptive alternative |
| production | production (f) | 10 | |
| discard (verb / noun) | défausser / défausse | 9 / 8 | |
| pips | pips | 4 | Left untranslated; also the store currency's name (§15). "Pip totals" is `totaux de probabilité`, because `points` collides with victory points |
| terrain: forest / clay / pasture / field / mountain / desert | forêt / argile / prairie / champ / montagne / désert | | Ours is named `Clay` and `argile` follows it |
| terrain: sea / gold / lake / fog / border / land | mer / or / lac / brouillard / bordure / terre | | `brume` (5) is the short fallback for `brouillard` |

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and French
preserves the split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **forêt** | `Wood` → **bois** |
| `Clay` → **argile** | `Brick` → **brique** |
| `Pasture` → **prairie** | `Sheep` → **mouton** |
| `Field` → **champ** | `Wheat` → **blé** |
| `Mountain` → **montagne** | `Ore` → **minerai** |

| English | `fr` | Gender | Mass/count | Chars |
|---|---|---|---|---|
| wood / lumber | bois | m | mass | 4 |
| brick | brique | f | count | 6 |
| sheep | mouton | m | count | 6 |
| wheat | blé | m | mass | 3 |
| ore | minerai | m | count in this catalogue | 7 |
| gold | or | m | mass | 2 |
| cloth | tissu | m | count | 5 |
| paper | papier | m | count | 6 |
| coin | pièce | f | count | 5 |

**Gender and the mass/count split are the whole problem.** `brique` and `pièce` are
feminine; the rest are masculine. The countable nouns split cleanly: **invariable** are
`or`, `blé` and `bois` (`bois` cannot take a plural, and `or` and `blé` are mass nouns no
French speaker counts: `2 blé`, not `2 blés`); **variable** are `brique`, `mouton`,
`tissu`, `pièce`, `minerai` and `papier` (`2 minerais`, `2 papiers`). Making `minerai` and
`papier` invariable would put them with `or` and `blé` and against `brique`, `mouton` and
`tissu`, which are exactly as much "a card of a substance" as they are; the game deals all
of them as counted cards.

Any string that interpolates a resource name next to an article or a number cannot be
translated without knowing which one arrives at runtime. The source handles this with
per-card message tables (`lib/cardPhrases.ts`, `harbor.receive.*`, `resource.count.*`), so
French writes `Prendre une brique`, `Prendre un mouton` and `Prendre du bois` as three
separate entries, with the partitive (`du bois`, `de la brique`) where it belongs.

**`pièce` and `pion`.** `pièce` is the direct translation of "Coin" and it is short, but
`pièce` also means a game piece. This catalogue therefore uses **`pion`** for every
physical game piece, never `pièce`, so the two never compete on screen. `monnaie` (7, f) is
the alternative for coin, but it collides with `monnaie` = change. The store's currency is
`Pips` and is left untranslated (§15), so it does not collide either.

---

## 5. Islands expansion

| English | `fr` | Rationale |
|---|---|---|
| Islands (the expansion) | Îles | Our own expansion name, translated |
| ship | bateau | |
| sea edge / coastal edge | arête maritime / arête côtière | |
| ship route | voie maritime | `route maritime` collides with `route` the piece |
| open ship (movable end) | bateau libre | No compact French noun for "open-ended"; `extrémité libre` in prose |
| anchor (a ship or settlement to the network) | ancrer | |
| pirate | pirate | |
| gold hex | tuile d’or | Not `gisement d’or` or `champ d’or` |
| gold pick | choix d’or | Matches the gold-choice UI strings |
| longest trade route | Route commerciale la plus longue | Counts roads and ships both |
| island | île | |
| island discovery | découverte d’île | Scoreboard short form `Île` |
| island bonus | bonus d’île | As in `PV bonus d’île` |
| landmass | masse continentale, or `île` in prose | Literal `masse terrestre` is clumsy; the rules text usually means "island" |

---

## 6. Scenario expansions

Registered under `module.tab` → **Scénarios**. "Expansion" as a noun is **extension**, the
standard French board-game word.

### Fishermen and Caravans

| English | `fr` | Rationale |
|---|---|---|
| Fishermen | Pêcheurs | |
| fishing ground | zone de pêche | `pêcherie` (9) is exact but uncommon. The board-piece label is the singular `Zone de pêche` |
| fish tile | tuile poisson | |
| fish (the token you collect) | poisson | |
| catch (of fish) | prise | |
| side currency (fish) | monnaie parallèle | |
| dock | quai | |
| the old boot | la vieille botte | Meant to be undignified, which is the point of the token |
| Caravans | Caravanes | |
| camel | chameau | |
| oasis | oasis (f) | Invariable in the plural |
| caravan route | route caravanière | |
| camel junction | carrefour caravanier | `jonction` is rail vocabulary; `carrefour` is the ordinary crossroads. It is the only `carrefour` in the catalogue; every other junction is `intersection` (§3) |
| path (the edge a camel stands on) | arête | The edge can carry a camel with no road on it |
| bid / outbid | miser / dépasser | Caravans voting |
| Bid nothing | Miser zéro | A zero bid is an **answer**, not an abstention: the seat responds and the round closes. Not `Ne pas participer` |
| Votes: {total} | Voix : {total} | A label and a value, so `{total}` governs no agreement |
| vote on (where a camel goes) | voter sur | `voter` is intransitive in French: `Toute la table vote sur la destination de chaque chameau` |

`camel.bid.less` / `camel.bid.more` (`Bid one less {name}`) take the button phrase, a
colon, then `{name}`: `Miser une carte de moins : {name}`. `{name}` is the capitalised
`msgctxt "resource"` citation form (`Mouton`, `Blé`), which cannot take an article, so it
stays out of the governed position.

### Rivers

| English | `fr` |
|---|---|
| Rivers (module) | Rivières |
| river / river hex | rivière / tuile rivière |
| watercourse | cours d’eau |
| bridge / bridge site | pont / emplacement de pont |
| coin(s) (Rivers currency) | pièce(s) |
| Wealthiest Settler (tile) | Colon le plus riche |
| Poorest Settler (tile) | Colon le plus pauvre |

### Raiders

| English | `fr` | Note |
|---|---|---|
| Raiders (module) | Pillards | |
| raider (neutral enemy on a hex) | pillard | |
| rider (player's figure on a path) | cavalier | `Rider {0}` is `Cavalier {0}` |
| castle | château | |
| prisoner | prisonnier | |
| Muster (card) | Levée | `Rassemblement` is the alternative |
| Swift Rider (card) | Cavalier rapide | |
| Intrigue (card) | Intrigue | The same title as the Knights card, because the English is the same word |
| Treason (card) | Trahison | |
| hurry (a rider) | presser | |
| battle / conquer | bataille / conquérir | |
| battle sweep | balayage | |
| place in reach (rider) | arête à portée | A rider ends on a path, so the count names paths |

### Wagons

| English | `fr` | Note |
|---|---|---|
| Wagons (module) | Chariots | |
| wagon | chariot | |
| cargo / load | cargaison | Not `chargement` |
| toll(s) | péage | |
| Swift Journey (card) | Trajet éclair | |
| wagon level | niveau | |
| drive a barbarian off | chasser | Not `charger`, which already means loading cargo in the same panel |
| trade hex | tuile de commerce | |
| plaza / central plaza | place / place centrale | |
| spoke | rayon | |
| cargoes | sable, outils, marbre, verre | |
| quarry / glassworks | carrière / verrerie | |
| ford / swamp | gué (`passer à gué`) / marais | |

### Explorers

| English | `fr` | Note |
|---|---|---|
| Explorers (module) | Explorateurs | |
| settler | colon | |
| crew | équipage | |
| fish haul | prise de poisson (short: prise) | |
| spice sack | sac d’épices | |
| spice farm / spice village | plantation d’épices / village d’épices | |
| Fast Gold (village) | Or rapide | |
| Swift Voyage (village) | Traversée rapide | |
| Pirate Bonus (village) | Prime pirate | |
| Council / Council hex / Council anchor | Conseil / tuile du Conseil / mouillage | |
| harbour settlement (a building, not a port) | colonie portuaire | |
| pirate lair | repaire de pirates | |
| (fish) shoal | banc de poissons | |
| hold (a ship's cargo space) | cale | |
| movement points / Movement phase | points de mouvement / phase de mouvement | `N points de mouvement`, never the calque `N de mouvement` |
| step on a track / track | cran / piste | |
| tribute | tribut | |
| explore / reveal (a face-down hex) | explorer / révéler | |
| consolation gold | or de consolation | |
| gold field | tuile d’or | As §5 |

### Harbormaster

| English | `fr` | Note |
|---|---|---|
| Harbormaster (module, award, card) | Capitaine de port | |
| harbour settlement (a settlement on a harbour) | colonie située sur un port | Kept apart from the Explorers building `colonie portuaire` |

### Shared scenario conventions

- `Target N.` in the combination paragraphs is `Objectif : N.`
- Hex labels injected into sentences carry their article (`le désert`, `le lac`,
  `la tuile d’or`), like `cette tuile`; `beside {a}` is `bordant {a}` so no `de le`
  contraction can arise.
- `harbour` as a board piece and as the map-builder heading is `Port`.

---

## 7. Knights expansion

| English | `fr` | Rationale |
|---|---|---|
| Knights (the expansion) | Chevaliers | Our own expansion name, translated |
| knight (piece) | chevalier | |
| knight tiers | **chevalier de force 1 / 2 / 3** | The source numbers the tiers (`Strength 1 knights`, `Promote to strength {next}`). French follows the source exactly |
| strength | force | |
| activate | activer; actif / inactif | |
| build a knight | recruter | A knight is never bought: `le tour où vous le recrutez` |
| promote | promouvoir | §2.2 |
| displace | déloger | `déplacer` is reserved for moving your own piece; `chasser` for the robber, pirate or a barbarian |
| chase the robber | chasser le voleur | Board-action short label `Chasser` |
| progress card | carte Progrès | |
| city improvement | amélioration de ville | |
| improvement track | voie d’amélioration; **voie** in running prose | Never used for a road or ship route, which is `tracé` (§3) |
| advance a track | progresser | Kept distinct from `améliorer` and `promouvoir` |
| Trade / Politics / Science | Commerce / Politique / Science | |
| commodity | marchandise | §4 |
| metropolis | métropole (f) | |
| event die | dé événement | §2.2 |
| barbarians / barbarian fleet | barbares / flotte barbare | |
| barbarian attack / raid / invasion | invasion (f) | The source uses "attack", "raid" and "invasion"; unified except where the source contrasts them |
| landfall | débarquement | The event; the attack itself stays `invasion` |
| step (on the barbarian track) | cran | Not `pas` |
| barbarian distance | distance des barbares | |
| pillage / raze a city | piller | The source's own verb, and the city goes back to a settlement |
| defender of the realm | Défenseur du royaume | |
| Merchant Guild | Guilde des marchands | Wire name `trading_house` must not change |
| Fortress / Aqueduct | Forteresse / Aqueduc | |
| replacement knight (Deserter) | chevalier de remplacement | |

`Master Merchant` compares **public** victory points (`aux points de victoire publics`),
because the engine gates on public VP and hidden victory-point cards do not count.

---

## 8. The 30 card titles

These composite over the card art at runtime, so they are display type at large size *and*
at a small hand thumbnail. The English fits roughly **13 uppercase characters** before the
title fitter shrinks the type; French titles over that budget are accepted where no shorter
faithful word exists.

### Development deck

| id | English | `fr` | Chars | Note |
|---|---|---|---|---|
| `knight` | Knight | Chevalier | 9 | |
| `victory_point` | Victory Point | Point de Victoire | 17 | Short fallback `Victoire` (8) |
| `road_building` | Road Building | Construction de Routes | 22 | Short fallback `Deux Routes` (11) |
| `year_of_plenty` | Year of Plenty | Année d’Abondance | 17 | Short fallback `Abondance` (9) |
| `monopoly` | Monopoly | Monopole | 8 | |

### Trade deck

| id | English | `fr` | Chars | Note |
|---|---|---|---|---|
| `commercial_harbor` | Commercial Harbor | Port Commercial | 15 | |
| `master_merchant` | Master Merchant | Maître Marchand | 15 | |
| `merchant` | Merchant | Marchand | 8 | |
| `merchant_fleet` | Merchant Fleet | Flotte Marchande | 16 | Short fallback `Flotte` (6) |
| `resource_monopoly` | Resource Monopoly | Monopole de Ressource | 21 | Short fallback `Ressources` (10) |
| `trade_monopoly` | Trade Monopoly | Monopole Commercial | 19 | The literal `Monopole de Marchandise` is 23. Must stay visibly distinct from `resource_monopoly` at thumbnail size |

### Politics deck

| id | English | `fr` | Chars | Note |
|---|---|---|---|---|
| `bishop` | Bishop | Évêque | 6 | Accented capital `É` under `text-transform: uppercase` |
| `constitution` | Constitution | Constitution | 12 | Identical to the English; the entry is blank (§15) |
| `deserter` | Deserter | Déserteur | 9 | |
| `diplomat` | Diplomat | Diplomate | 9 | |
| `intrigue` | Intrigue | Intrigue | 8 | Identical; blank |
| `saboteur` | Saboteur | Saboteur | 8 | Identical; blank |
| `spy` | Spy | Espion | 6 | |
| `warlord` | Warlord | Chef de Guerre | 14 | §2.2 |
| `wedding` | Wedding | Mariage | 7 | `Noces` (5) is more period but reads archaic |

### Science deck

| id | English | `fr` | Chars | Note |
|---|---|---|---|---|
| `alchemist` | Alchemist | Alchimiste | 10 | |
| `crane` | Crane | Grue | 4 | |
| `engineer` | Engineer | Ingénieur | 9 | |
| `inventor` | Inventor | Inventeur | 9 | |
| `irrigation` | Irrigation | Irrigation | 10 | Identical; blank |
| `medicine` | Medicine | Médecine | 8 | |
| `mining` | Mining | Mine | 4 | §2.2 |
| `printer` | Printer | Imprimerie | 10 | The trade, not the machine, which is what the card is |
| `road_building_sci` | Road Building | Construction de Routes | 22 | **Must be byte-identical to `road_building`**: the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Forgeron | 8 | |

Uppercase French is wide, and accented capitals (`É`, `À`) need vertical room under
`text-transform: uppercase`. `Évêque` and `Année d’Abondance` (with its `’`) are the test
cases. Changing a card title also affects the card art, which is drawn with the title in
place, so a title change is an art change as well as a text change.

---

## 9. UI and system vocabulary

| English | `fr` | Rationale |
|---|---|---|
| lobby | salon | The waiting room. `hall` is an anglicism, `vestibule` a physical foyer |
| table (a game room) | table | The source's own metaphor, and it survives translation intact |
| game (a match) | partie | Never `jeu` for one instance of play |
| casual game / ranked game | partie amicale / partie classée | |
| ruleset / mode | mode | The source uses both interchangeably; French unifies |
| board | plateau | Never `carte`, which is the map and the card (§11) |
| preset (a board preset) | préréglage | |
| spectate / spectator | observer / spectateur | |
| invite / invite code | inviter / code d’invitation | |
| seat / open seat | place / place libre | `siège` is furniture |
| host (noun) | hôte | |
| host (verb, "start a game") | créer | `Créer une table` reads better than any verb form of `hôte` |
| ready (player) | prêt | Generic masculine, §13 |
| ready (connection) | connecté | Two English "Ready" strings with different `msgctxt`; two different words in French |
| disconnect / reconnect | déconnexion / se reconnecter | |
| ban | bannissement | |
| report (a message) | signaler | |
| slurs | insultes discriminatoires | Legal register |
| mute | masquer | Chat, not audio: `couper le son` would be wrong |
| supporter | mécène | Shorter than `personne qui soutient` |
| cosmetic (item) | décoration | The codebase calls them decorations |
| piece set (a cosmetic) | jeu de pions | |
| guest | invité | Shares a root with `invitation`, unavoidable |
| leave / rematch / surrender | quitter / revanche / abandonner | |
| forfeit (leaving a live game) | abandon | Same word as surrender, which the source also conflates |
| draw (a drawn game) | égalité | Never confuse with "draw a card" (§11) |
| bot | bot | |
| leaderboard | classement | |
| scoreboard | tableau des scores | |
| rating (Elo) | score | `cote` is racing/betting vocabulary. The VP total on the same screen is `total`, not `score` |
| store | boutique | |
| Pips (the currency) | Pips | Left untranslated. A product name |
| settings | réglages | `paramètres` (10) is equally correct and two characters longer |
| theme / light / dark / system | thème / clair / sombre / système | |
| map builder | éditeur de cartes | `constructeur de cartes` is a calque |
| brush / paint / randomize | pinceau / peindre / générer au hasard | `aléatoiriser` is not French; `Générer` alone where tight |
| clock (a running countdown) | chrono | What a French player calls a game clock |
| turn timer (the table setting) | minuteur de tour | Held apart from `chrono` so the setting and the countdown are two words, as in the English |
| turn order | ordre du tour | |
| turn timer presets | Détendu / Normal / Blitz | `Normal` and `Blitz` are identical to the English and left blank |
| Fair / random (dice and board modes) | Équilibré / Aléatoire | Used identically in the lobby and in the manual |
| Skip first attack | Ignorer la première invasion | |
| Friendly robber | Voleur bienveillant | Not `voleur amical` |
| replay | rejouer (verb) / replay (noun) | |
| profile / stats | profil / statistiques | `stats` where tight, as in the source |
| seed / fingerprint (dice fairness) | graine / empreinte | |
| action card | carte action | |
| commodity terrain | terrain de marchandise | |

---

## 10. Interface actions

Buttons and menu items. Register: infinitive or bare noun, sentence case, no final period.

| English | `fr` | Notes |
|---|---|---|
| Build | Construire | Board-action pills take the full phrase (`Construire une colonie`); bare nouns (`Colonie`, `Route`) are the idiomatic short form if a pill must shrink |
| Buy / Play (a card) | Acheter / Jouer | |
| Draw (a card) | Piocher | Never `tirer`, which is the die roll (§11) |
| Discard | Défausser | |
| Dismiss (a toast) | Fermer | Not `défausser`: English uses one word for two actions and French must not |
| Steal | Voler | |
| Move / Place / Pass | Déplacer / Placer / Passer | |
| Roll | Lancer les dés | Short label `Lancer` |
| Offer / Counter | Proposer / Contre-offre | |
| Accept / Decline / Reject | Accepter / Refuser | Two English words, one French word; the `msgctxt` split is preserved in the ids |
| Cancel / Confirm / Undo | Annuler / Confirmer / Annuler l’action | `Annuler` twice is a genuine French collision; `Undo` is `Annuler l’action` where both appear |
| End turn | Fin du tour | The noun form; `Terminer le tour` is 16 and the pill is narrow. Short variant `Fin` |
| Start game | Lancer la partie | |
| Upgrade (settlement → city) | Améliorer en ville | Distinct from `promouvoir` and `progresser` |
| Activate / Promote | Activer / Promouvoir | |
| Chase / Displace / Relocate | Chasser / Déloger / Déplacer | |
| Remove / Remove player | Retirer / Exclure le joueur | The second is a kick and says so |
| Equip / Unequip | Équiper / Retirer | The "this one is on" state is `En usage`, not `Équipé`, on gender grounds (§13) |
| Link / Unlink / Merge | Lier / Délier / Fusionner | |
| Join / Watch / Send | Rejoindre / Regarder / Envoyer | |
| Leave & spectate | Quitter et observer | Matches the in-game button wherever the manual names it |
| Rejoin (from bot) | Reprendre ma place | Short form `Reprendre` |
| Zoom in / out | Zoom avant / Zoom arrière | |
| Save / Load / Delete | Enregistrer / Charger / Supprimer | |
| Copy / Share | Copier / Partager | |

---

## 11. Collisions English hides

| English word | Senses | French |
|---|---|---|
| **draw** | take a card / a level game / paint | `piocher` / `égalité` / `dessiner`. All three appear and all three carry a `msgctxt` |
| **roll** | roll the dice / a die result | `lancer` (verb and the noun for the act) / `résultat`. Never `tirer` for either |
| **upgrade / promote / advance** | settlement→city / knight rank / improvement track | `améliorer` / `promouvoir` / `progresser`, held rigidly |
| **move / displace** | move your own piece / push an enemy knight off | `déplacer` / `déloger` |
| **discard / dismiss** | throw cards away / close a notification | `défausser` / `fermer` |
| **trade** | player-to-player / with the bank / the improvement track | `échange` / `échange avec la banque` / `Commerce` |
| **play** | play a card / play a game | `jouer` covers both and they never collide in practice |
| **piece** (the reverse collision) | French `pièce` is a coin, a room and a game piece | `pion` for every game piece, `pièce` reserved for the coin (§4) |
| **card** | a playing card / a map (`carte`) | A genuine French collision: `carte` is both. The map builder says `carte` (map) and the game says `carte` (card), and they never share a screen. `plan` for map is unidiomatic. The board itself is `plateau` |
| **route / path / track** | a continuous chain of roads / a board edge / an improvement track | `tracé` / `arête` / `voie`. `chemin` is used for none of them |

---

## 12. Length and overflow

French runs 15 to 25% longer than English across the catalogue. Where that excess lands
matters more than how large it is:

- **Post-game stats labels wrap; they do not truncate.** `PostGameScoreboard.tsx` puts each
  label in a `block max-w-[150px]` span, so `Longueur de la route commerciale la plus
  longue` makes its row taller and nothing else.
- **Victory-point columns and the stats matrix sit inside `overflow-x-auto`.** A longer
  French column head widens a table that already scrolls; it never clips.
- **The location dial's seat label is a fallback under the card art,** rendered only when
  the art is missing, inside `max-w-[52px]` with no `overflow-hidden`, so it wraps.
- **The manual's Clocks & auto-play table** is the widest French table (about 546px against
  English's 380px at 390px viewport, inside its own scroll container). Both the Decision
  and Budget columns carry the excess, and neither is a rules statement, so both can be
  shortened freely. The Table settings table is the same width in French as in English.
- **Card titles** are drawn into the illustration, not laid out by CSS (§8).

Short fallbacks, if a surface ever needs one:

| Surface | English | French | Fallback |
|---|---|---|---|
| board action pill | `Build settlement` | `Construire une colonie` | `Colonie` |
| board action pill | `Build road` | `Construire une route` | `Route` |
| board action pill | `Build knight` | `Recruter un chevalier` | `Chevalier` |
| board action pill | `Chase robber` | `Chasser le voleur` | `Chasser` |
| turn pill | `End turn` | `Fin du tour` | `Fin` (the source ships a short variant) |
| lobby setting | `Discard limit` | `Limite de défausse` | `Défausse` |
| lobby setting | `Barbarian distance` | `Distance des barbares` | `Distance` |
| lobby setting | `Turn timer` | `Minuteur de tour` | `Chrono` |
| lobby setting | `Victory points to win` | `Points de victoire pour gagner` | `PV pour gagner` |
| nav item | `Map builder` | `Éditeur de cartes` | `Éditeur` |
| nav item | `How to play` | `Comment jouer` | `Règles` |
| stat pill | `{pct}% win` | `{pct}% de victoires` | `{pct}%` |
| stat pill | `win rate` | `taux de victoires` | `% victoires` |
| header | `Trade route` | `Route commerciale` | `Route comm.` |
| button | `Boost to unlock` | `Boostez le serveur pour débloquer` | none: Discord's "boost" has no compact French and Discord leaves it untranslated |

If the board-action pills ever cannot grow, the whole family should drop to bare nouns
(`Route`, `Colonie`, `Ville`, `Chevalier`), which is idiomatic French for a button.

---

## 13. Gender and agreement that survives interpolation

Strings where the English is neutral, the French would not be, and a rewrite solves it.

| Message | Problem | Resolved as |
|---|---|---|
| `Equipped` | agrees with the unknown item noun | `En usage` |
| `Connected to the table` | `connecté` agrees with the reader | `Vous êtes à la table` |
| `You're already seated at this table.` | same | `Vous avez déjà une place à cette table.` |
| `You're not seated at this table.` | same | `Vous n’avez pas de place à cette table.` |
| `{seatedCount} seated` | `assis` agrees with people | `{seatedCount} à la table` |
| `Winner` | agrees with the player | `Vainqueur`, which French treats as epicene in practice. Better than `Gagnant(e)` |
| `Ready` (player) | agrees with the player | `Prêt`, generic masculine. The pill cannot hold `Prêt(e)` and the project has no inclusive-orthography policy |
| `Full` / `Private` / `Public` (a table) | agree with `table` (f) | `Complète` / `Privée` / `Publique`, safe because the referent is fixed |
| `None` (no decoration) | agrees with `décoration` (f) | `Aucune` |
| `Walled: holds 2 extra cards` | agrees with `ville` (f) | `Fortifiée :` |
| `Pays for Politics/Science/Trade improvements…` | the pronoun would agree with the track's commodity | Three separate strings; each names its own noun rather than pronominalizing |
| `{n, plural, one {# player} other {# players}}` | generic masculine for a mixed group | `# joueurs`. Standard French |
| `Activated this turn` | participle agrees with `chevalier` (m) | Safe: the referent is always a knight |
| a card TITLE injected into a sentence | the title's gender is not `carte`'s | Recast around `cette carte`, so nothing agrees with the injected value |

### 13b. Interpolated nouns

Where a source string injects a bare noun (`{terrain}`, `{resource}`, `{piece}`), French
survives only if the noun lands where nothing governs it: after a colon, in apposition, or
after the negative partitive `de`, which is gender- and number-neutral. The preferred
source shape is a label after a colon (`Terrain : {terrain}`) or one message per value.
Where the antecedent of a pronoun is outside the string, the French names the noun rather
than guessing a gender.

---

## 14. The rules manual

`routes/HowToPlay.tsx` contributes about 515 entries: five tabs, thirty chapters, roughly
12 to 15k words of rules prose. Conventions specific to it:

1. **Rhythm.** English rules prose is short-sentenced and comma-spliced; French rules prose
   is more subordinated. Merge clauses with colons where English uses full stops, prefer
   the impersonal, render `so` as `si bien que` and `and then` as a semicolon where it
   reads better. Avoid calques (`compter X face à Y`, a bare additive `plus un dé
   événement`, `obtenir` for "gets") and stacked determiners.
2. **`vous` throughout**, including inside conditional clauses where the English drops the
   subject ("Build here to claim it").
3. **Terminology identical to the UI.** The manual is where a term is explained, so a
   mismatch there is worse than anywhere else. Cross-references to chapter titles
   (`Jouer en ligne → Réglages de la table`, `Jouer en ligne → Chronos et jeu
   automatique`, `Dés et équité`) must match those titles exactly, and setting names must
   match the lobby's labels.
4. **Victory points are `pt` / `pts` in the manual** (`+1 pt`, `+2 pts`, `2 pts chacun`).
   The UI chrome uses `PV` in its narrower slots; the manual does not switch to `PV`
   mid-chapter.
5. **The `<0>…</0>` emphasis tags** land on different words in French because the emphasis
   falls on a different part of the clause. Each tag wraps a whole grammatical unit, drawn
   around the French word order (`Le <1>pion Marchand</1>`, not `Le pion <1>Marchand</1>`),
   with no space just inside a tag.
6. **One rule, one statement.** Where the English states a rule in two chapters on purpose
   (bots and trading, for example), the French states it the same way in both.

---

## 15. Terms deliberately not translated

- **Player display names, chat bodies, user-saved map names.** User content.
- **Bot display names.** Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values.** Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names.** Brand flavour.
- **`Pips`**, both the board-probability sense and the store currency.
- **`Costanio`**, the game's title, everywhere it appears, and the company names in the
  disclaimer string, which are proper nouns.
- **`Boost` / `Booster` / `Nitro`**, which Discord leaves untranslated in its own French
  interface.

### Deliberate blanks

An empty `msgstr` falls back to exactly the English string at runtime. Where the only
correct French is a copy of the English, the entry is left blank on purpose rather than
filled with a copy, which keeps `catalog.test.ts`'s "a translation is never its own message
id" guard meaningful. Each carries a `BLANK` note saying why. They are not gaps. The kinds:

- **Placeholders, numbers and punctuation only:** `{0}`, `{0} ({1} Pips)`,
  `{label}, {total}`, `{nextReward}. {nextCost}`, `{staked} → {got}`, `{ratio}:1 {resource}`,
  `2:1 {resource}`, `{resource} {num}`, `log.produced` (a name and an icon).
- **Words identical in French:** `Auto`, `Base`, `Blitz`, `Normal`, `Bot`, `design`,
  `Menu`, `Missions`, `Pirate`, `Port`, `production`, `Science`, `science`,
  `Total`, `Volume`, `10 points`, `13 points`, `2 pts`.
- **Card titles identical in French:** `Constitution`, `Intrigue`, `Saboteur`,
  `Irrigation` (§8).
- **Product and platform names:** `Pips`, `Booster`.

A plural entry is never left blank (§1), and a blank is never used for a string that merely
has not been translated yet.

---

## 15b. Further terms

| English | `fr` | Note |
|---|---|---|
| expansion (the noun) | **extension** | The standard French board-game word. The expansion *names* are §2.0's |
| board | **plateau** | Never `carte` (§11) |
| clock (a running countdown) | **chrono** | |
| turn timer (the table setting) | **minuteur de tour** | Held apart from `chrono` |
| route (a continuous run of roads and ships) | **tracé** | `route` is the piece |
| rating (Elo) | **score** | `cote` is betting vocabulary |
| piece set (a cosmetic) | **jeu de pions** | |
| improvement track, in running prose | **voie** | Short for §7's `voie d’amélioration`. Not `discipline` |
| landfall | **débarquement** | |
| raid / attack / invasion | **invasion** | §7 |
| seed / fingerprint (dice fairness) | **graine** / **empreinte** | A pair; keep them consistent |
| forfeit (leaving a live game) | **abandon** | |

## 15c. Further terms (continued)

| English | `fr` | Note |
|---|---|---|
| preset (a board preset) | **préréglage** | |
| stack (of resource cards) | **pile** | Distinct from `pioche` (a face-down draw pile) |
| deck (a progress deck) | **pioche** | `paquet` only for the shuffled deck of 36 dice outcomes |
| scoreboard | **tableau des scores** | The leaderboard stays `classement` (§9) |
| casual game | **partie amicale** | Against `partie classée` |
| land robber | **voleur terrestre** | Only where the source contrasts it with the pirate |
| step (on the barbarian track) | **cran** | |
| connection piece (road or ship) | **pion de liaison** | |
| commodity terrain | **terrain de marchandise** | |
| anchor (a ship) | **ancrer** | |
| gold pick | **choix d’or** | |
| catch (of fish) | **prise** | |
| dock | **quai** | |
| snake order (setup) | **ordre en serpentin** | |
| bid / outbid | **miser** / **dépasser** | Caravans voting |
| side currency (fish) | **monnaie parallèle** | |
| action card | **carte action** | |
| slurs | **insultes discriminatoires** | |
| land tile | **tuile de terre** | Pairs with `tuile de mer` |
| friendly robber | **voleur bienveillant** | The lobby setting's own label, used in the manual too |
| generic harbour | **port 3:1**, or **port générique** where the ratio is not shown | |
| specific harbour | **port 2:1**, with `spécialisé` only as an adjective | |

---

## 16. Checks

`python3 scripts/po_verify.py fr` checks the catalogue's structure (ids and ordering against
`en`, placeholder and tag multisets, ICU plural categories). The French-specific checks
worth running by hand after a change: no plain space before `? ! ; :` in any `msgstr`, no
straight apostrophe, no `tu` / `toi` / `ton` / `ta` / `tes`, no `veuillez`, no
parenthesised feminine `(e)`, no em dash, and none of the rejected substitutions in §2.1.
