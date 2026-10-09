# Brazilian Portuguese (`pt-BR`) terminology glossary

The terminology, register and grammar conventions the `pt-BR` catalogue
(`frontend/src/locales/pt-BR/messages.po`) follows. Terminology is the expensive decision:
a term chosen here recurs in hundreds of strings and is costly to change afterwards, so a
new string should reuse the term recorded here rather than coin a synonym.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/`, `art/cards/cards.json`,
`frontend/src/locales/README.md`, `docs/i18n/CONTRIBUTING.md`.
**Companion:** `glossary-es.md` is the closest relative and this document follows its
structure; §2.3 lists where the two differ.

---

## 1. Register and regional decisions

### 1.1 Formality: `você`, everywhere, including the legal page titles

The English source is chatty and informal throughout ("Say hi to your table…", "Jump into a
table!", "Slow down."). Brazilian Portuguese consumer software has settled overwhelmingly on
`você`; `tu` is regional (Rio Grande do Sul, parts of the North and Northeast) and, where it
is used in speech, it is usually conjugated as third person anyway, so a `tu` catalogue would
have to choose between sounding regional and sounding wrong. `o senhor` / `a senhora` is
service-desk register and clashes with every joke in the source.

**The decision holds in the legal surfaces too.** Only the page *titles* of Terms and
Privacy are in this catalogue (the bodies stay in English by decision), but the titles are
written to the same register, and if that copy is ever localized it must stay `você`. A
register that changes between screens reads worse than either one held consistently.

**Prefer the impersonal where Portuguese allows it.** `Não dá para construir aqui`, never
`Você não pode construir aqui` when the shorter form is available and equally clear.
Buttons are infinitives or bare nouns (`Construir`, `Configurações`), prompts to act are
imperatives in the `você` form (`Toque em um hexágono`, not `Toca`), and statements about
the player's state are second-person (`Você não tem recursos`).

**Imperatives must be the `você` imperative, not the `tu` imperative.** `Escolha`, not
`Escolhe`; `Toque`, not `Toca`; `Role os dados`, not `Rola os dados`. This is the single
most visible marker of a mis-registered Portuguese catalogue. The few auto-play strings that
*look* like `tu` imperatives (`Rola os dados`, `Coloca uma vila`) are third-person indicative
describing what the server does on the player's behalf, and are correct as they stand.

**`Could not …` / `Couldn't …`** are rendered `Não foi possível …` / `Não deu para …`
respectively, a register split mirroring the English.

### 1.2 Which Portuguese: Brazilian, and where `pt-PT` would diverge

Every choice below targets Brazil. A European Portuguese catalogue is a separate file, not a
find-and-replace, and this table is what it would have to change.

| Concept | **`pt-BR` (this file)** | `pt-PT` would use | Note |
|---|---|---|---|
| you (sg.) | **você** | tu (+ 2sg verbs) | Changes every imperative and every clitic in the catalogue |
| settlement | **vila** | aldeia / povoado | Brazilian and European usage differ here |
| screen | **tela** | ecrã | Appears in the settings and layout copy |
| user | **usuário** | utilizador | Profile, moderation and account copy |
| to save | **salvar** | guardar | Map builder, throughout |
| to delete | **excluir** | apagar / eliminar | Map builder, account copy |
| team / side | **time** | equipa | Rare here |
| mouse | **mouse** | rato | Input hints |
| to register | **registrar** | registar | Orthographic, not lexical |
| event die | **dado de eventos** | dado de acontecimentos | The European term is 21 characters and unusable in a HUD |
| ranked | **Ranqueada** | Classificativa | Brazilian gaming register is frankly anglicized (§9) |
| leaderboard | **Ranking** | Classificação | Same |
| nickname/handle | **apelido** | alcunha | `apelido` means *surname* in `pt-PT`. A genuine false friend |
| plural "you" | **vocês** | vocês / vós | No divergence in practice |

The game vocabulary proper (`cidade`, `estrada`, `ladrão`, `porto`, `madeira`, `tijolo`,
`trigo`, `minério`, `carta de desenvolvimento`) is the same in both, so a `pt-PT` fork would
be mostly register and UI vocabulary, not game terms. The exception is `vila` / `aldeia`,
and it is the most frequent noun in the file. `guardar` does appear in this catalogue, but
only as the ordinary "keep/store" verb, never as "save".

### 1.3 Punctuation and typography

- Portuguese has no inverted marks. `?` and `!` are written once, at the end.
- No space before `?` `!` `:` `;`. No double spaces.
- The repository's no-em-dash rule is an English house-style rule. Portuguese uses the
  travessão (U+2014) for dialogue and for parentheticals, but this catalogue does not need it:
  where the English uses a dash, the Portuguese uses a comma, a colon, a semicolon or
  parentheses, which is also the shorter option. En-dash number ranges in the source
  (`3–10`) become plain hyphens, which is Brazilian typographic practice.
- Ellipsis is the single character `…`, matching the source.
- **Decimal comma, thousands period.** `1,5` and `1.450`. Nothing in the catalogue
  hardcodes a number format (`lib/format.ts` does the formatting).
- Accents are written in full, including on uppercase card titles
  (`MONOPÓLIO`, `IRRIGAÇÃO`). See §8 on the tilde/cedilla risk under
  `text-transform: uppercase`.
- **Emphasis spans** (`<0>…</0>`) cover a content word or phrase. A narrower span than the
  English on a head noun is a style choice (Portuguese puts the head noun first); a span on
  a bare function word (`que`, `pode`) is a bug, and so is a space inside the span.

### 1.4 Capitalization

Portuguese does not use English headline case:

- **Sentence case by default**, including buttons, headings and column headers:
  `Fim do turno`, `Mapas salvos`, `Pontos de vitória`. Headings that render in capitals do
  so through a CSS `uppercase` class; the catalogue entry is always sentence case.
- **Title case only for the 30 card titles**, which render as display type over the card
  art with `text-transform: uppercase`. When the manual names a card in running text it uses
  the card's own title case (`Ano de Fartura`, `Construir Estradas`).
- Award names take sentence case (`Estrada mais longa`, `Maior exército`), which is the
  Portuguese convention and differs from the English source's Title Case.
- Expansion and module names are capitalized as names (`Cavaleiros`, `Ilhas`).

### 1.5 Plurals

Portuguese has exactly the English shape: **`one` / `other`**. Every ICU `plural` in the
source keeps its wrapper, its selector variable and both arms.

- Several English messages have *identical* arms because English does not inflect the noun
  (`{n, plural, one {# sheep} other {# sheep}}`). **Portuguese usually does**, so those
  become two-armed (`one {# ovelha} other {# ovelhas}`). The mass nouns
  `madeira`, `trigo` and `ouro` keep identical arms on purpose (§4); they are not a
  copy-paste error.
- Where the Portuguese verb has to agree with the count, the plural wrapper moves *inside*
  the sentence (`{n, plural, one {Restou # carta} other {Restaram # cartas}}`). The
  parameter and both arms survive; only the span changes.
- **Zero selects `one`.** `Intl.PluralRules("pt-BR").select(0)` is `one`, where English is
  `other`. The `one` arm must therefore read correctly at zero wherever zero can reach it.
- **No `many` arm.** pt-BR's `many` is the compact-millions category and fires only at exact
  whole multiples of one million. Every count in this catalogue is a hand size, a piece count
  or a seat count, so two arms is complete and correct.
- The singular arm must carry the same meaning as the plural: if the plural says *todas as
  # cartas*, the singular keeps the sense of completion rather than dropping it.

---

## 2. Naming policy

### 2.0 The rule

> **Translate our English faithfully. Only the game title and the expansion names are
> our own.**

Our own English card names (`art/cards/cards.json`: Master Merchant, Warlord, Bishop,
Constitution, Deserter, Diplomat, Intrigue, Saboteur, Crane, Engineer, Inventor,
Irrigation, Medicine, Mining, Printer, Smith, Road Building, Year of Plenty) are
descriptive phrases, not marks. A Portuguese catalogue that dodges the natural Portuguese
for them is less faithful than the source, for no benefit. `CONTRIBUTING.md` at the
repository root states the rule.

- **Translate straight, even where the result is familiar board-game Portuguese:** all
  card titles, resource names, mechanic names (longest road, largest army, victory point),
  settlement, road, city, port, robber, development card, progress card.
- **Our own names:** the game's title (`Costanio`, untranslated), and the expansion names,
  which are "Islands", "Knights" and "Scenarios" in our English and are translated as such.

Every sentence in the `.po` is written from our English.

### 2.1 Faithful choices where another phrase might be expected

| Term | Ours | Why |
|---|---|---|
| city / road / robber / knight / development card | cidade / estrada / ladrão / cavaleiro / carta de desenvolvimento | The plain words. `caminho` is a footpath; `estrada` is the plain word |
| settlement | vila | The shortest correct option (§3) |
| the five resources | madeira, tijolo, ovelha, trigo, minério | Our English says "Sheep", so `ovelha` rather than `lã` |
| longest road | Estrada mais longa | The faithful translation of "Longest Road" |
| largest army | Maior exército | The faithful short form |
| resource (cover term) | recurso | Our English says "resource" |
| Year of Plenty | Ano de Fartura | `fartura` is the everyday Brazilian word for plenty |
| Merchant Guild | Guilda de mercadores | Faithful to our own card name |
| Islands / Knights (expansions) | **Ilhas / Cavaleiros** | Our own expansion names, translated |

### 2.2 The choices that are not the most obvious rendering, and why each holds

| Term | Our `pt-BR` | Why |
|---|---|---|
| Islands (expansion) | **Ilhas** | Our expansion is "Islands". We translate ours |
| Knights (expansion) | **Cavaleiros** | Same |
| Scenarios (module) | **Cenários** | Same |
| resource | **recurso** | `matéria-prima` is 13 chars, and wrong for `ouro` |
| sheep | **ovelha** | Our English says "Sheep", not "Wool" |
| brick / clay | **tijolo** / **argila** | Our English separates the `Brick` resource from the `Clay` terrain, and Portuguese maps the split exactly |
| event die | **dado de eventos** | `dado de acontecimentos` is 21 characters and reads European |
| promote (a knight) | **promover** | Keeps `melhorar` (upgrade a building) and `avançar` (advance a track) cleanly distinct: three mechanics English blurs |
| commodity | **mercadoria** | Pairs cleanly with `recurso` |
| city improvement | **melhoria de cidade** | Shorter and plainer than `aperfeiçoamento` |
| Printer (card) | **Imprensa** | The card is a printing press, not a person. `Impressor` is the operator and `Impressora` is an office peripheral |
| Warlord (card) | **Senhor da Guerra** | The literal and idiomatic Portuguese. Over the title budget (§8), but carries none of the political freight `Caudillo` carries in Spanish |
| Road Building (card) | **Construir Estradas** | `Construção de Estradas` is 22 characters |

### 2.3 Where `pt-BR` differs from the Spanish glossary

| `es` decision | `pt-BR` | Why it does not transfer |
|---|---|---|
| `robar` reserved for *steal*, `tomar` for *draw* | **No such problem.** `roubar` = steal, `comprar` = buy a development card, `pegar` = draw from a deck | Portuguese never merged the two senses the way Spanish did; the Spanish workaround must not be imitated |
| `poblado` for settlement (7) | **`vila`** (4) | A different word, and shorter still |
| `camino` for road, rejecting `carretera` | **`estrada`** | `estrada` is the plain Portuguese word and carries none of `carretera`'s motorway sense |
| `casilla` for tile, for pan-Hispanic neutrality | **`hexágono`** | The peninsular/American split that forced `casilla` has no Portuguese counterpart |
| `Caudillo` for Warlord | **`Senhor da Guerra`** | `Caudilho` is a Spanish-flavoured borrowing in Portuguese. The literal phrase is idiomatic here; its only problem is length |
| `Riego` for Irrigation, chosen for length | **`Irrigação`** (9) | Fits the budget. No compromise needed |
| `Año de Abundancia` (17) | **`Ano de Fartura`** (14) | `fartura` is the everyday Brazilian word for plenty and is shorter |
| `Ajustes` for settings, on length | **`Configurações`** | What Brazilian software says. Naturalness wins over length |
| `Clasificatoria` / `Clasificación` | **`Ranqueada`** / **`Ranking`** | Brazilian gaming register is openly anglicized and the anglicism is both shorter and more natural (§9) |
| Inverted `¿` `¡` | Not applicable | Portuguese has no inverted marks |

Everything else transfers: the register argument, the sentence-case rule, the mass/count
split in the resources, the `upgrade`/`promote`/`advance` triple, and the length discipline.

---

## 3. Core game nouns

| English | `pt-BR` | Gender | Chars | Rationale |
|---|---|---|---|---|
| road | estrada | f | 7 | The plain word; `caminho` is a footpath |
| settlement | vila | f | 4 | Plain Brazilian word and the shortest correct option. `aldeia` (6) carries a rural, pre-modern connotation that fights the `cidade` upgrade path; `povoado` (7) is a settlement in the demographic sense rather than a thing you build. `Construir vila` has to fit a board-action pill and `Vilas` is a scoreboard column |
| city | cidade | f | 6 | |
| building (cover term) | construção | f | 10 | `edificação` is heavier and `edifício` cannot cover a road |
| ship | navio | m | 5 | `barco` is a small boat; `nave` reads as spacecraft |
| city wall | muralha | f | 7 | A defensive wall, against `muro` (any wall) |
| knight (piece) | cavaleiro | m | 9 | |
| board | tabuleiro | m | 9 | |
| hex / tile (the piece) | hexágono | m | 8 | Precise, and what Brazilian players say. `peça` (4) is the short form where space is tight |
| hex (as terrain) | terreno | m | 7 | Where the *terrain* is meant rather than the piece |
| land hex | hexágono de terra | m | | Map builder, board info |
| vertex / intersection | cruzamento | m | 10 | English uses both words; unified. `vértice` (7) is the short form for prompts. `canto` only where the English says *corner* |
| edge | aresta | f | 6 | Geometric and precise; `lado` is shorter but ambiguous. **`caminho` is never a board edge**: it is the word for a chain of roads in the Longest Road rules |
| spot (a placeable position) | ponto | m | 5 | |
| port / harbor | porto | m | 5 | English uses both; unified |
| generic port (3:1) | porto comum | m | 11 | Alt. `porto 3:1` |
| specific port (2:1) | porto específico | m | 16 | Alt. `porto 2:1` where tight |
| dock (on a harbor's water hex) | cais | m | 4 | Over `atracadouro` |
| robber | ladrão | m | 6 | |
| friendly robber (setting) | ladrão amigável | m | | |
| pirate | pirata | m | 6 | |
| merchant (piece) | mercador | m | 8 | Over `comerciante` (11) |
| longest road | Estrada mais longa | | 18 | Short form `Estrada` |
| longest route / trade route | Rota mais longa | | 15 | Covers roads and ships both, so it never says `comercial` or `marítima`. Used on every surface (VP breakdown, event log, player card, scoreboard, manual) |
| largest army | Maior exército | | 14 | Short form `Exército` |
| victory point (VP) | ponto de vitória / **PV** | m | 16 / 2 | `PV` is the established Portuguese abbreviation and is used wherever the English uses `VP` |
| development card | carta de desenvolvimento | f | 24 | Short form `desenvolvimento` where "carta" is implied, or `carta de desenv.` |
| development card deck | baralho de cartas de desenvolvimento | m | | Short form `baralho de desenvolvimento` |
| progress card | carta de progresso | f | 18 | |
| resource | recurso | m | 7 | |
| commodity | mercadoria | f | 10 | Pairs cleanly with `recurso` |
| "good" (resource or commodity, cover term) | item | m | 4 | Over `bem`; trade summaries |
| bank | banco | m | 5 | |
| supply | reserva | f | 7 | The source distinguishes "bank" from "supply" in adjacent strings; the distinction is preserved. "limited supply" is `reserva limitada`; "in supply" is `na reserva`. `estoque` only where the English says *in stock* |
| trade (player to player) | troca / trocar | f | 5 | `comércio` is reserved for the improvement track |
| trade (with the bank) | troca com o banco | | 17 | Same verb, disambiguated by the complement |
| offer / counter-offer | oferta / contraoferta | f | 6 / 12 | |
| opponent | adversário | m | 10 | The everyday Brazilian word for a rival at a table. Card effect text uses it in almost every sentence, so it has to be neutral; `oponente` is a register up and reads as sports commentary. `oponente` is not used |
| turn / round | turno / rodada | m / f | 5 / 6 | |
| dice / die | dados / dado | m | 5 / 4 | |
| dice roll (the act) | rolagem | f | 7 | Button copy: `Rolar os dados`; in the event log, `rolou` |
| number token / chit | número / ficha numerada | m / f | 6 / 14 | `ficha numerada` in the manual; `número` for repeated use |
| token (Defender, Merchant) | token | m | 5 | `ficha` is already spent on number chits, exploration chips and fish tiles, so `token` keeps the chit/chip/tile vs token distinction English makes. All token strings use the same word |
| hand / hand limit | mão / limite de mão | f | 3 / 13 | |
| discard limit | limite de descarte | m | 18 | Short `Descarte` |
| deck | baralho | m | 7 | `monte` is the pile, not the deck |
| setup (initial placement) | posicionamento inicial | m | 22 | Short form `início` where the phase is meant |
| snake order (setup) | ordem em serpente | f | | Over `ordem de ida e volta` |
| production | produção | f | 8 | |
| discard (verb / noun) | descartar / descarte | | 9 / 8 | |
| pips | pips | | 4 | Left untranslated, and also the store currency's name; §16 |
| base game | jogo base | m | | Never `jogo básico` |
| terrain: forest / clay / pasture / field / mountain / desert | floresta / argila / pasto / campo / montanha / deserto | | | `pasto` over `pastagem` |
| terrain: sea / gold / lake / fog / border / land | mar / ouro / lago / névoa / borda / terra | | | `névoa` over `neblina` on length. Mid-sentence hex names are lowercase (`deserto`, `lago`, `campo de ouro`) |
| loop / ring of roads | circuito / anel | m | | |
| connection piece | peça de ligação | f | | |
| open road (no building at its end) | estrada livre | f | | Over `estrada desimpedida`; Diplomat strings |
| force-finished (a game) | encerrada à força | | | |
| forfeit | desistência | f | | |
| fog of war | névoa de guerra | f | | Sits beside the Islands `névoa` |

---

## 4. Resources and commodities

The source separates the terrain name from the resource name, and Portuguese
preserves the split:

| Hex (terrain) | Card (resource) |
|---|---|
| `Forest` → **Floresta** | `Wood` → **Madeira** |
| `Clay` → **Argila** | `Brick` → **Tijolo** |
| `Pasture` → **Pasto** | `Sheep` → **Ovelha** |
| `Field` → **Campo** | `Wheat` → **Trigo** |
| `Mountain` → **Montanha** | `Ore` → **Minério** |

| English | `pt-BR` | Gender | Mass/count | Chars |
|---|---|---|---|---|
| wood / lumber | madeira | f | mass | 7 |
| brick | tijolo | m | count | 6 |
| sheep | ovelha | f | count | 6 |
| wheat | trigo | m | mass | 5 |
| ore | minério | m | count* | 7 |
| gold | ouro | m | mass | 4 |
| cloth | tecido | m | count | 6 |
| paper | papel | m | count | 5 |
| coin | moeda | f | count | 5 |

\* `minério` is a mass noun in ordinary Portuguese (*minério de ferro*) but is counted as
cards here, the same reason English says "three ores" only in a board-game sentence, so
`2 minérios` is the game register. `tijolo` and `ovelha` are counted for the same reason, so
treating `minério` as mass would introduce the only irregularity in the system.

**Mixed genders and the mass/count split.** `madeira`, `ovelha` and `moeda` are feminine;
`tijolo`, `trigo`, `minério`, `ouro`, `papel`, `tecido` are masculine. `madeira`, `trigo` and
`ouro` are mass nouns and take no article and no plural after a number (`2 madeira`,
`Pegue trigo`, `# ouro` in both plural arms); a counted amount of gold is `N de ouro`
(`1 de ouro`). The rest are counted (`2 tijolos`, `Pegue um minério`,
`# minério / # minérios`).

The split is applied without exception across every family that expresses it:
`resource.count.*`, `card.bankLeft.*` / `card.supplyLeft.*`, `card.take*` / `card.give*` /
`card.remove*` / `card.request*` / `card.return*` / `card.putBack*`, `card.harborRate.*`,
`card.improveCost.*` / `card.improveShort.*`, `card.holdNone.*` / `card.allTheirs.*`,
`short.needOneMore.*` and `harbor.receive.*`. That consistency is why `Pegue trigo` and
`Pegue um minério` in the same menu read as grammar rather than as a mistake.

**`tecido`, not `tela`.** `tela` is *screen* and *canvas* in Brazilian Portuguese and would
collide with the settings copy.

**`moeda`** is both the Knights commodity and the Rivers coin. The store currency is `Pips`
and is left untranslated (§16), so it never competes with `moeda`.

---

## 5. Islands expansion

| English | `pt-BR` | Rationale |
|---|---|---|
| Islands (the expansion) | Ilhas | Our own expansion name, translated |
| ship | navio | |
| sea edge / coastal edge | aresta marítima / aresta costeira | |
| ship route | rota marítima | |
| open ship (movable end) | navio na ponta aberta | No compact noun exists; `ponta aberta` in prompts |
| re-sail a ship | renavegar | |
| pirate | pirata | |
| gold hex | hexágono de ouro | |
| longest trade route | Rota mais longa | Counts roads *and* ships, so anything with `marítima` or `comercial` in it would be wrong |
| island | ilha | |
| to settle an island | colonizar | Over `povoar`; VP strings |
| island bonus | Pontos por ilha | Every label, the table setting and the manual use the same phrase |
| fog / fog hex | névoa / hexágono de névoa | `névoa` (5) over `neblina` (7) |

---

## 6. Scenario expansions

Registered under `module.tab` → **Cenários**.

### 6.1 Fishermen and Caravans

| English | `pt-BR` | Rationale |
|---|---|---|
| Fishermen | Pescadores | |
| fishing ground | pesqueiro | The exact Brazilian word for a fishing spot, and compact. The single board piece is `Pesqueiro` |
| fish tile | ficha de peixe | |
| fish catch (Fishermen) | pescaria | Kept apart from the Explorers `pescado` |
| the old boot | Bota velha | Meant to be undignified, which is the point of the token |
| Caravans | Caravanas | |
| camel | camelo | |
| oasis | oásis | Invariable in the plural |
| caravan route | rota de caravanas | |
| camel junction | cruzamento de camelos | Short form `cruzamento` |
| camel vote | votação de camelos | |
| path (the shared board edge a camel stands on) | aresta | An edge can hold a camel and no road; `aresta` is the established word (`aresta de destino`, `aresta marítima`) |
| Bid nothing | Dar lance zero | A zero bid is an answer, not sitting the round out; when the clock runs out the seat is recorded as a zero bid |
| a road credit | um crédito de estrada | The spend buys the credit; the road is placed later, as a separate move |
| bid one less / one more `{name}` | `Um a menos no lance: {name}` / `Um a mais no lance: {name}` | `{name}` arrives capitalised in its citation form (`Ovelha`, `Trigo`), so it follows a colon as a label rather than being folded into the verb phrase |
| votes | `votos: {total}` | Label and value, which avoids number agreement on `{total}` |

### 6.2 Rivers

| English | `pt-BR` |
|---|---|
| Rivers (module) | Rios |
| river / river hex | rio / hexágono de rio |
| channel / watercourse | leito / curso d'água |
| headwater / mouth | nascente / foz (plural `fozes`) |
| ford (a river) / swamp | vau (`atravessar a vau`) / pântano |
| bridge / bridge site (crossing) | ponte / local de ponte |
| coin(s) (Rivers currency) | moeda(s) |
| wealth tiles | fichas de riqueza |
| Wealthiest Settler (tile) | Colono mais rico |
| Poorest Settler (tile) | Colono mais pobre |

### 6.3 Raiders

| English | `pt-BR` | Note |
|---|---|---|
| Raiders (module) | Saqueadores | |
| raider (neutral enemy on a hex) | saqueador | |
| rider (player's figure on a path) | ginete | Never `cavaleiro`, which is the Knights piece |
| castle | castelo | |
| prisoner | prisioneiro | |
| Muster (card) | Convocação | In the log, `convocou` |
| Swift Rider (card) | Ginete veloz | |
| Intrigue (Raiders card) | Intriga | Same as the Knights card |
| Treason (card) | Traição | |
| hurry (a rider) | apressar | |
| battle / conquer | batalha / conquistar | |
| battle sweep | varredura | |
| buyout (pillage) | resgate | |
| path (board edge a rider stands on) | aresta | |
| "Two words, one letter apart" (heading) | Duas figuras que não se pode confundir | |

### 6.4 Wagons

| English | `pt-BR` |
|---|---|
| Wagons (module) | Carroças |
| wagon | carroça |
| cargo / load delivered | carga / carga entregue |
| cargoes: sand / tools / marble / glass | areia / ferramentas / mármore / vidro |
| quarry / glassworks | pedreira / vidraria |
| toll(s) | pedágio |
| Swift Journey (card) | Jornada veloz |
| wagon level / the wagon track | nível / Os níveis da carroça |
| upgrade the wagon | melhorar |
| trade hex | hexágono comercial |
| plaza | praça |
| spoke | raio |
| sends out / takes | Envia / Recebe |
| drive a barbarian off | afugentar |
| barbarian place: between {a} and {b} / beside {a} / on the coast | entre {a} e {b} / ao lado de {a} / na costa |

### 6.5 Explorers

| English | `pt-BR` |
|---|---|
| Explorers (module) | Exploradores |
| settler | colono |
| crew | tripulação |
| fish haul | pescado |
| spice sack | saco de especiarias |
| spice farm / spice village | fazenda de especiarias / aldeia de especiarias |
| Fast Gold (village) | Ouro rápido |
| Swift Voyage (village) | Travessia veloz |
| Pirate Bonus (village) | Bônus pirata |
| befriend (a village) | fazer amizade |
| Council / Council hex / Council anchor | Conselho / hexágono do Conselho / ancoradouro |
| harbour settlement (a building, not a port) | vila portuária (VP source `Vilas portuárias`) |
| pirate lair | covil pirata |
| (fish) shoal | cardume |
| hold (a ship's cargo space) | porão |
| basin | doca |
| home island / home waters | ilha de origem / águas de origem |
| Cargo Ship / Fleet | Navio de carga / Frota |
| scrap a ship | desmontar |
| chit | ficha de número |
| movement points / Movement phase | pontos de movimento / fase de movimento |
| tribute | tributo |
| explore / reveal (a face-down hex) | explorar / revelar |
| track / a step on it | trilha / casa |

### 6.6 Harbormaster

| English | `pt-BR` | Note |
|---|---|---|
| Harbormaster (module, award, card) | Capitão do porto | |
| harbour settlement (a settlement on a harbour) | vila em um porto | Kept apart from the Explorers building `vila portuária` |

### 6.7 Shared scenario conventions

- Event-log lines use the preterite (`construiu`, `rolou`); a bid is `dar lance` / `lance zero`.
- The player-trade panel's scenario currencies (coins or gold) are `Valores`; `Moedas` would
  name only the Rivers coin.
- Gender-neutral frames for injected values: `Carga: {0}, destino: {1}.`,
  `{res}: você não tem o suficiente na mão`, `Escolhidos: {0} de {count}`.
- "Target N." in the combination paragraphs is `Meta: N.`
- Trade offer status: `Todos recusaram` / `Recusaram:` / `Esperando`.

---

## 7. Knights expansion

| English | `pt-BR` | Rationale |
|---|---|---|
| Knights (the expansion) | Cavaleiros | Our own expansion name, translated |
| knight (piece) | cavaleiro | |
| knight tiers | **cavaleiro de força 1 / 2 / 3** | The source uses numbered tiers (`Strength 1 knights`, `Strength {level} of 3`, `Promote to strength {next}`); Portuguese follows exactly and never invents named tiers. Tier labels are `Cavaleiros de força 1 / 2 / 3`, short form `Força N` |
| strength | força | |
| hire a knight | recrutar | Over `contratar`. Board action `Recrutar cavaleiro` |
| replacement knight | cavaleiro substituto | |
| activate | ativar; ativo / inativo | |
| promote | promover | §2.2 |
| displace | deslocar | Of a knight pushed off its spot |
| chase the robber | afugentar o ladrão | Short board-action label `Afugentar` |
| progress card | carta de progresso | The decks are `Comércio`, `Política`, `Ciência`; where the superordinate is avoidable the catalogue names the deck |
| city improvement | melhoria de cidade | Shorter and plainer than `aperfeiçoamento` (15) |
| improvement track | trilha de melhorias | `trilha` is the natural Brazilian word for a progress track |
| Trade / Politics / Science | Comércio / Política / Ciência | |
| commodity | mercadoria | |
| metropolis | metrópole | Plural `metrópoles` |
| event die | dado de eventos | §2.2 |
| event die gate face | portão | |
| barbarians / barbarian fleet | bárbaros / frota bárbara | |
| a step on the barbarian track | passo | Never `casa`, which reads as a board square |
| barbarian attack | invasão | The source uses "attack", "invasion" and "landfall"; unified except where the source contrasts them |
| barbarian distance | distância dos bárbaros | Short form `Distância` |
| defence must reach the attack | alcançá-los | Defence ≥ attack, so never `empatar` (tie) |
| pillage / raze a city | arrasar | `rebaixar` is mechanically accurate and bloodless. `saquear` is *raid*, a different word |
| defender of the realm / top defender | Defensor do Reino / melhor defensor | |
| Merchant Guild | Guilda de mercadores | Faithful to our English name. Wire name `trading_house` must not change |
| Fortress / Aqueduct | Fortaleza / Aqueduto | |

---

## 8. The 30 card titles

These composite over the card art at runtime, so they are display type at large size *and*
at hand-thumbnail size. The English fits roughly **13 uppercase characters** before the
shrink loop bites: prefer under 13, accept up to 17, and give an 18+ title a shorter
fallback.

### Development deck

| id | English | `pt-BR` | Chars | Fallback |
|---|---|---|---|---|
| `knight` | Knight | Cavaleiro | 9 | |
| `victory_point` | Victory Point | Ponto de Vitória | 16 | `Vitória` (7) |
| `road_building` | Road Building | Construir Estradas | 18 | `Duas Estradas` (13) |
| `year_of_plenty` | Year of Plenty | Ano de Fartura | 14 | `Fartura` (7) |
| `monopoly` | Monopoly | Monopólio | 9 | |

### Trade deck

| id | English | `pt-BR` | Chars | Fallback |
|---|---|---|---|---|
| `commercial_harbor` | Commercial Harbor | Porto Comercial | 15 | `Porto` (5) |
| `master_merchant` | Master Merchant | Mestre Mercador | 15 | `Mercador-Chefe` (14) |
| `merchant` | Merchant | Mercador | 8 | |
| `merchant_fleet` | Merchant Fleet | Frota Mercante | 14 | |
| `resource_monopoly` | Resource Monopoly | Monopólio de Recursos | 21 | `Recursos` (8) |
| `trade_monopoly` | Trade Monopoly | Monopólio Comercial | 19 | `Comércio` (8) |

### Politics deck

| id | English | `pt-BR` | Chars | Fallback |
|---|---|---|---|---|
| `bishop` | Bishop | Bispo | 5 | |
| `constitution` | Constitution | Constituição | 12 | |
| `deserter` | Deserter | Desertor | 8 | |
| `diplomat` | Diplomat | Diplomata | 9 | |
| `intrigue` | Intrigue | Intriga | 7 | |
| `saboteur` | Saboteur | Sabotador | 9 | |
| `spy` | Spy | Espião | 6 | |
| `warlord` | Warlord | Senhor da Guerra | 16 | `Comandante` (10) or `Chefe de Guerra` (15) |
| `wedding` | Wedding | Casamento | 9 | |

### Science deck

| id | English | `pt-BR` | Chars | Note |
|---|---|---|---|---|
| `alchemist` | Alchemist | Alquimista | 10 | |
| `crane` | Crane | Guindaste | 9 | The machine, not the bird |
| `engineer` | Engineer | Engenheiro | 10 | |
| `inventor` | Inventor | Inventor | 8 | Identical to the English; the entry is left blank (§16) |
| `irrigation` | Irrigation | Irrigação | 9 | |
| `medicine` | Medicine | Medicina | 8 | |
| `mining` | Mining | Mineração | 9 | |
| `printer` | Printer | Imprensa | 8 | The press, not the operator (`Impressor`) and not the peripheral (`Impressora`) |
| `road_building_sci` | Road Building | Construir Estradas | 18 | **Byte-identical to `road_building`**: the two share one render (`art` field in `cards.json`) |
| `smith` | Smith | Ferreiro | 8 | |

### Card-title layout notes

- `Monopólio de Recursos` and `Monopólio Comercial` share their first and longest word and
  must stay distinguishable at thumbnail size. If they do not fit, the fallbacks `Recursos`
  and `Comércio` differ from the first letter and lose nothing a player needs.
- For the other long titles every fallback loses meaning (`Duas Estradas` states the effect
  rather than naming the card; `Vitória` makes a victory-point card sound like a victory;
  `Porto` collides with the ordinary harbour label), so they are better served by type size
  than by a shorter word.
- Uppercase Portuguese is wider, and `Ó`, `Ã`, `Ç` need ascender and descender room.
  `MONOPÓLIO`, `IRRIGAÇÃO` and `CONSTITUIÇÃO` are the test cases: a clipped cedilla is a
  visible bug even where the word fits horizontally.
- In other strings a card prompt such as Monopoly's "Name this card" is `Diga uma carta`.

---

## 9. UI and system vocabulary

| English | `pt-BR` | Rationale |
|---|---|---|
| lobby | sala | `saguão` is a physical foyer; `lobby` untranslated reads as jargon |
| table (a game room) | mesa | The source's own metaphor, and it survives translation intact |
| game (a match) | partida | |
| ruleset / mode | modo | The source uses both interchangeably; Portuguese unifies |
| spectate / spectator | assistir / espectador | |
| invite / invite code | convidar / código de convite | |
| seat / open seat | lugar / lugar livre | `assento` is a physical chair; `lugar` is what you take at a table |
| seat cosmetics | aparência do lugar | |
| player rail | barra de jogadores | |
| swatch | amostra | |
| host (noun) | anfitrião | |
| host (verb, "start a game") | criar | `Criar uma mesa` beats any verb form of `anfitrião` |
| ready (player) | Pronto | Generic masculine, §13 |
| ready (connection) | Conectado | The source has two "Ready" strings with different `msgctxt`; they are two different words here |
| disconnect / reconnect | desconectar / reconectar | |
| ban | banimento / banir | `suspensão` is softer than the source |
| report (a message) | denunciar | The standard Brazilian verb for reporting abuse |
| mute | silenciar | |
| supporter | apoiador | Generic masculine, §13. `patrocinador` is a sponsor |
| cosmetic (item) | decoração | The codebase calls them decorations |
| guest | convidado | Shares a root with `convite`, unavoidably |
| leave / rematch / surrender | sair / revanche / desistir | |
| draw (a drawn game) | empate | Never confused with drawing a card, §11 |
| bot | bot | `robô` means a physical robot and would mislead about a seat-filling program |
| ranked | Ranqueada | The word the Brazilian gaming register uses for ranked queues. `Classificatória` is a competition-format word (a qualifier) and is 15 characters in a queue chip |
| leaderboard | Ranking | 7 characters in a top-level nav item against `Classificação`'s 13, and consistent with `Ranqueada` beside it. `Classificação final` is still used for a game's final standings |
| replay (the downloadable log) | replay | `repetição` means a repeat, not a recorded game file |
| rating | pontuação | |
| scoreboard (in game) | placar | Over `quadro de pontos` |
| store | loja | |
| Pips (the currency) | Pips | Left untranslated. A product name |
| settings | Configurações | What Brazilian software says. Short form `Config.` only if a slot requires it |
| theme / light / dark / system | tema / claro / escuro / sistema | |
| map builder | editor de mapas | `construtor de mapas` is a calque |
| design mode (map builder) | desenho | Over `detalhes` |
| brush / paint / randomize | pincel / pintar / sortear | `aleatorizar` is a calque; `sortear` is the plain word |
| save / delete | salvar / excluir | Brazilian, §1.2 |
| "Shores" map | Litoral | `Costas` is ambiguous |
| layout (of a map) | layout | |
| preset | predefinição | |
| slot | espaço | |
| cooldown | tempo de espera | |
| merge (account, noun) | mesclagem | Over `fusão` |
| loot box / pay-to-win | kept in English | Support page |
| turn timer | tempo de turno | Shorter than `temporizador de turno` (21) and just as clear |
| turn order | ordem dos turnos | |
| screen | tela | Brazilian, §1.2 |
| account / sign in / sign out | conta / entrar / sair | |
| nickname | apelido | False friend in `pt-PT`, §1.2 |
| Green-weak / Red-weak / Blue-weak | Verde fraco / Vermelho fraco / Azul fraco | Colour-vision settings |
| unaccounted (discard delta) | Não contabilizado | Over `Sem explicação` |
| Reset view (board controls) | Centralizar | `Redefinir a visão` is 17 characters |

`Ranqueada` is written lower-case in running text (`partida ranqueada`, `fila ranqueada`)
and capitalized only where it stands as the queue's name (`A Ranqueada precisa de uma
conta.`).

---

## 10. Interface actions

Buttons and menu items. Register: infinitive or bare noun, sentence case, no final period.

| English | `pt-BR` | Notes |
|---|---|---|
| Build | Construir | 9 chars against 5 on the board-action pills |
| Buy (a dev card) | Comprar | |
| Play (a card) | Jogar | |
| Draw (a card) | Pegar | Never `comprar`, which is reserved for *buy*; §11 |
| Discard | Descartar | |
| Dismiss (a toast) | Fechar | **Not `descartar`**: English uses one word for two actions and Portuguese must not |
| Steal | Roubar | |
| Move / Place / Pass | Mover / Colocar / Passar | |
| Roll | Rolar os dados | Short form `Rolar` |
| Offer / Counter | Oferecer / Contraoferta | |
| Accept / Decline / Reject | Aceitar / Recusar | Two English words, one Portuguese word; the `msgctxt` split is preserved in the ids |
| Cancel / Confirm / Undo | Cancelar / Confirmar / Desfazer | |
| End turn | Fim do turno | The noun form (12); `Encerrar turno` is 14 and the pill is narrow. Short variant `Fim` |
| Start game | Começar partida | |
| Upgrade (settlement → city) | Melhorar para cidade | Distinct from `promover` and `avançar` |
| Activate / Promote | Ativar / Promover | |
| Chase / Displace / Relocate | Afugentar / Deslocar / Realocar | |
| Remove / Remove player | Remover / Expulsar jogador | The second is a kick and says so |
| Equip / Unequip | Equipar / Remover | The "this one is on" state is **`Em uso`**, not `Equipado`, on gender grounds (§13) |
| Link / Unlink / Merge | Vincular / Desvincular / Mesclar | |
| Join / Watch / Send | Entrar / Assistir / Enviar | |
| Rejoin | Retomar o lugar | |
| Zoom in / out | Aproximar / Afastar | |
| Copy / Share | Copiar / Compartilhar | Brazilian; `pt-PT` says `partilhar` |

---

## 11. Collisions English hides

| English word | Senses | `pt-BR` |
|---|---|---|
| **draw** | take a card / a level game / paint with a brush | `pegar` / `empate` / `desenhar`. All three appear; all three carry a `msgctxt` |
| **buy vs. draw** | buy a development card / draw from a deck | `comprar` / `pegar`, held apart. The distinction is mechanically real: buying a development card costs resources and can be refused; drawing a progress card costs nothing. A player who reads `comprar` on a free draw would look for the price. Nothing collides with *steal* (`roubar`), so this is not the Spanish `robar` problem |
| **upgrade / promote / advance** | settlement→city / knight rank / improvement track | `melhorar` / `promover` / `avançar`, held rigidly |
| **discard / dismiss** | throw cards away / close a notification | `descartar` / `fechar` |
| **trade** | player-to-player / with the bank / the improvement track | `troca` / `troca com o banco` / `Comércio` |
| **play** | play a card / play a game | `jogar` covers both and they never collide in practice |
| **left** | remaining / departed | `restante` / `saiu`. The event log uses both |
| **tile** | the physical hex / a UI card in a grid | `hexágono` / `bloco`. Only the first appears in game copy |
| **path / edge** | a board edge / a chain of roads | `aresta` / `caminho`. Never `caminho` for an edge |
| **claim / claimant** | a claim on a route / the player making it | Never the same noun: a player *counts as* a claim (`conta como um único pedido de 3`), not *is* one |

---

## 12. Strings expected to overflow

Portuguese runs 20–30% longer than English. Where a shorter fallback exists it is given.

| Surface | English | `pt-BR` | Ratio | Fallback |
|---|---|---|---|---|
| board action pill | `Build settlement` | `Construir vila` | 16 → 14 | fits, thanks to `vila` |
| board action pill | `Build knight` | `Recrutar cavaleiro` | 12 → 18 | `Cavaleiro` |
| board action pill | `Build / Trade` | `Construir / Trocar` | 13 → 18 | tab label, tight |
| turn pill | `End turn` | `Fim do turno` | 8 → 12 | `Fim` (the source ships a short variant) |
| leaderboard column | `Win %` | `% vit.` | 5 → 6 | the only form that holds one line |
| card title | `Resource Monopoly` | `Monopólio de Recursos` | 17 → 21 | `Recursos` |
| card title | `Trade Monopoly` | `Monopólio Comercial` | 14 → 19 | `Comércio` |
| card title | `Road Building` | `Construir Estradas` | 13 → 18 | `Duas Estradas` |
| card title | `Victory Point` | `Ponto de Vitória` | 13 → 16 | `Vitória` |
| card title | `Warlord` | `Senhor da Guerra` | 7 → 16 | `Comandante` |
| lobby setting | `Discard limit` | `Limite de descarte` | 13 → 18 | `Descarte` |
| lobby setting | `Barbarian distance` | `Distância dos bárbaros` | 18 → 22 | `Distância` |
| lobby setting | `Turn timer` | `Tempo de turno` | 10 → 14 | already the short option |
| lobby setting | `Max players` | `Máx. de jogadores` | 11 → 17 | `Jogadores máx.` |
| nav item | `Leaderboard` | `Ranking` | 11 → 7 | shorter than English |
| nav item | `Map builder` | `Editor de mapas` | 11 → 15 | `Editor` |
| nav item | `Settings` | `Configurações` | 8 → 13 | `Config.` |
| queue chip | `Ranked` | `Ranqueada` | 6 → 9 | `Ranked` (also used in Brazil) |
| toggle | `Auto` | `Auto` | 4 → 4 | no change needed |
| button | `Boost to unlock` | `Impulsione o servidor para liberar` | 15 → 34 | no compact Portuguese for Discord's "boost" |
| button | `Rejoin` (from bot) | `Retomar o lugar` | 6 → 15 | `Retomar` |
| store label | `Equipped` | `Em uso` | 8 → 6 | shorter, and avoids a gender problem |
| dev card | `Development card` | `Carta de desenvolvimento` | 16 → 24 | `Desenvolvimento` where the "carta" is implied |

**The post-game scoreboard's stat-name column wraps by design** (about 21 English characters
wide), so long row labels such as `Tamanho da estrada mais longa`, `Cartas de progresso
jogadas`, `Cartas de desenv. na mão` and `Defesas contra bárbaros` take two lines rather than
clipping. `Pontos de vitória finais` and `Vencedor` on that screen are `title=` tooltips and
cannot clip.

---

## 13. Gender agreement that survives interpolation

Strings where the English is gender-neutral, the Portuguese would not be, and a rewrite
solves it:

| Message | Problem | Rendered as |
|---|---|---|
| `{seatedCount} seated` | `sentados` agrees with people | `{seatedCount} na mesa` |
| `Connected to the table` | `conectado` agrees with the reader | `Você já está na mesa` |
| `You're already seated at this table.` | same | `Você já tem um lugar nesta mesa.` |
| `You're not seated at this table.` | same | `Você não tem lugar nesta mesa.` |
| `Equipped` | agrees with the (unknown) item noun | `Em uso` |
| `Full` / `Private` / `Public` | agree with `mesa` | `Cheia` / `Privada` / `Pública`, safe because the referent is fixed |
| `None` (no decoration) | agrees with `decoração` | `Nenhuma` |
| `Walled: holds 2 extra cards` | agrees with `cidade` | `Com muralha:` |
| `Ready` (player) | agrees with the player | `Pronto`, generic masculine. The layout cannot hold `Pronto(a)` |
| `Winner` | agrees with the player | `Vencedor`, generic masculine. It is a tooltip on the winner's crown, so the verb `Venceu` is a possible restructure |
| `Supporter` | same | `Apoiador`, generic masculine |
| `{n, plural, one {# player} other {# players}}` | generic masculine for a mixed group | `# jogadores`. Standard Portuguese |

**Brazilian Portuguese has no neutral third option in wide enough use to ship.** `@`, `x`
and `e` endings are politically marked, do not survive a screen reader, and would be the
most visible thing about the translation. Doublets (`Pronto(a)`) are readable in a form
label and unreadable in a scoreboard column. The generic masculine is the conventional
answer and is used here. Adopting inclusive forms would be a product decision across
every locale, not a translation call.

Many adjectives that look like gender choices (`Justo`, `Cheia`, `Privada`, `Pública`,
`Aleatória`, `Nenhuma`) agree with a fixed non-person antecedent and are not a gender
problem at all.

**Player-name frames.** Event-log and scoreboard strings that interpolate a display name use
a verb form that does not agree (`{name} construiu uma vila`, `{name} saiu`) rather than a
participle. Two English frames cannot be rescued this way, because the gendered word is
predicated of the injected value: `{promoteName} will become the host…` (`anfitrião`, the
noun *is* the predicate) and `{0} (too similar to another player)` (the adjective agrees
with the injected colour noun, always `cor`, feminine). Both use the generic or the fixed
agreement.

**Injected nouns.** The source never puts a bare resource, piece or terrain noun where an
article or agreement would be owed: such families are split per noun
(`card.take.<resource>`, `error.NO_PIECES.<piece>`, `short.needOneMore.<resource>`), or the
noun sits after a colon as a label (`Terreno: {terrain}.`). New strings should keep to these
two shapes.

---

## 14. The rules manual

`routes/HowToPlay.tsx` is translated in full: five tabs and thirty-odd chapters of connected
prose, plus the scenarios chapter. It is prose and should be read in source order (sort by
the `#:` reference, not by msgid) with the preceding sentence in view. Specific hazards:

1. **Chapter-length arguments split across many small entries.** Lingui extracts per JSX
   element, so a paragraph arrives as three or four messages and connectives
   (`Then`, `But`, `Instead`) land alone. Portuguese connectives are longer and the
   sentence flow across entries matters.
2. **Rich-text placeholders (`<0>…</0>`) sit inside sentences.** Portuguese word order
   moves the emphasised span; the tags move with it wherever the emphasis is on a noun
   phrase (§1.3).
3. **The imperative-heavy tutorial voice.** Every instruction is a `você` imperative.
4. **Terminology density.** Every term in §3 through §7 appears in running text rather than
   as a label.
5. **Cross-references name chapters exactly.** A reference such as `como diz o capítulo
   Trocas` or `Veja Jogo base → Preparando o tabuleiro` must match the pt-BR chapter heading
   word for word, or the reader goes looking for a chapter that does not exist.
6. **A rule is stated once.** Where the English states a rule in one chapter and
   cross-references it from another (bots and table trading, for instance), the Portuguese
   does the same, with identical wording, rather than restating it.
7. **Panel headings stand alone.** A heading that sits away from its chapter title names its
   subject (`Como guardar e jogar cartas de progresso`) rather than leaning on a pronoun or
   bare article.
8. **Adjectives sit against their head noun**, so a long noun phrase such as `carta de
   desenvolvimento de ponto de vitória` does not attach an adjective to the wrong noun.

---

## 15. Conventions a check can verify

- Placeholders, rich-text tags, ICU plural wrappers and `msgctxt` match the English entry for
  entry; keyed ids are untouched.
- No translation equals its own msgid (an identical rendering is left blank, §16).
- No `tu` forms (`teu`, `tua`, `contigo`, 2sg imperatives).
- No `¿`/`¡`, em dashes, en dashes, double spaces or spaces before `;:!?`.
- No `pt-PT` vocabulary (`ecrã`, `utilizador`, `partilhar`, `equipa`, `alcunha`, `registar`,
  `acontecimentos`, `rato`).
- No terminology drift off §3–§10 (`aldeia` for settlement, `oponente`, `caminho` for road or
  edge, `muro`, `matéria-prima`, `aperfeiçoamento`, `atualizar` for the upgrade mechanic,
  named knight tiers).

`scripts/po_verify.py pt-BR` runs the structural checks.

---

## 16. Terms not translated

- **Player display names, chat bodies, user-saved map names.** User content.
- **Bot display names.** Proper nouns, persisted, replay-stable.
- **Error codes, event type identifiers, wire enum values.** Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names.** Brand flavour, and a separate exercise in Portuguese colour
  naming.
- **`Pips`**, both the board-probability sense and the store currency.
- **`Costanio`**, in every page title.
- **Blank entries.** `{0}`, `{label}: {n}`, `2:1 {resource}`, `Base`, `Bot`,
  `Auto`, `Inventor`, `Pips`, `Total`, `Volume`, `China`, `Booster`, `online` / `offline`
  and the like: messages whose only correct Portuguese is a copy of the English. An empty
  `msgstr` falls back to that string at runtime and keeps `catalog.test.ts`'s guard
  (no translation equal to its msgid) meaningful. They are not gaps.
- **Two of the three turn-timer presets.** `Blitz` and `Normal` (msgctxt `turn timer
  preset`) are blank, because both words are ordinary Brazilian Portuguese as they stand.
  `Relaxed` is translated. The board presets (Beginner / Expanded / Grand) are not
  translatable strings.

