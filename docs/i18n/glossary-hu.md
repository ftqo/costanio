# Hungarian (`hu`) terminology glossary

The terminology, register and grammar conventions the `hu` catalogue
(`frontend/src/locales/hu/messages.po`) follows. The catalogue is written against this
document, so changing an entry here means a find-and-replace over the `.po`. Section
numbers are stable; some are intentionally absent.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/*.md`, the engine
(`engine/knights/*.go`, `engine/auto.go`, `lobby/lobby.go`, `timings/timings.go`), and
`glossary-tr.md` (the closest structural model: agglutinative, vowel harmony, suffixes onto
interpolated values).

Hungarian carries four structural risks that the Romance and Germanic catalogues do not:

1. **Vowel harmony.** Every case, possessive and plural suffix comes in a front/back (and
   sometimes rounded) variant chosen by the stem, so **a suffix on an interpolated value is
   undecidable** (§11).
2. **The definite article `a` / `az`,** chosen by the first *sound* of the next word. An
   article immediately before a placeholder fails for the same reason (§11).
3. **Definite versus indefinite conjugation.** The verb agrees with the definiteness of its
   object, which English does not mark at all.
4. **Hungarian does not pluralise a noun after a numeral** (§7), which the CLDR plural
   table does not show.

---

## 1. Register decisions

These hold across every string. Mixing them is the most visible sign of an assembled
translation.

### Formality: **tegezés**, everywhere a person is addressed

`Te jössz`, `Nem engedheted meg magadnak`, `a kezedben`, `Előbb dobj a kockával`. Never
`Ön`, never a magázó imperative. Tegezés matches a source that says "You're up" and "Nice
one", and `de`, `es` and `tr` made the same choice (`du` / `tú` / `sen`).

### Voice: nominal buttons, verbal prose

Buttons, column headers and tab labels use the **deverbal noun**: `Mentés`, `Törlés`,
`Építés`, `Vásárlás`, `Dobás`, `Kör vége`, `Csere`, `Eldobás`, `Kilépés az asztaltól`,
`Maradás`. A button whose English is a whole sentence stays a sentence, in tegezés.

This is the pairing Hungarian software ships, and it is also the pairing that makes the
widths work: a deverbal noun is usually shorter than the imperative that would replace it
(`Dobás` 5 against `Dobj a kockával` 15). The two halves never share a sentence: the prose
addresses the player, the buttons name actions, and the manual quotes a button by its noun
(`A Kilépés és nézés azonnal átadja a helyed…`). If the buttons ever move to the tegező
imperative (`Ments`, `Építs`, `Maradj`), the prose stays in tegezés; the source's voice is
fixed, the buttons' is not.

### Case: Hungarian sentence case, never English Title Case

Headings, card titles, chapter names and column headers all take a capital on the first
word only. `Bőség éve`, not `Bőség Éve`. The card face uppercases its title in CSS, so the
catalogue never hand-types capitals.

Hungarian has no locale-specific case mapping: `i`/`I` behave normally, and `ő`/`Ő`
round-trip under the Unicode default mappings, so `toUpperCase`, `text-transform:
uppercase` and `toLocaleUpperCase("hu")` all agree. None of the Turkish casing findings
apply. `applyDocumentLocale()` stamps `lang="hu"`, which the CSS needs for hyphenation.

### Punctuation

Hungarian quotation marks are `„…”`, used where the English quotes a phrase. Decimal comma,
space as the thousands separator, but no catalogue string formats a number itself (`Intl`
does). The no-em-dash rule for user-facing text holds here too: Hungarian prose would use a
spaced en dash at most, and this catalogue uses a comma or a colon instead.

---

## 2. Naming policy

### 2.0 The rule

> Translate our English faithfully. Only the game title and the expansion names are
> our own.

Our English already uses `Master Merchant`, `Bishop`, `Warlord`, `Longest Road`, `Year of
Plenty`. Those are descriptive phrases. The Hungarian for them is whatever the ordinary
Hungarian for those phrases is. Where that lands on words Hungarian players already know,
that is a coincidence forced by the language. The opposite mistake is substituting a
different ordinary noun (a *village* for a *settlement*) to avoid a word that was never
off-limits.

### 2.1 Coincidence versus substitution

The test applied per term: could a translator arrive here from our English alone? If
yes, a match is a coincidence and the term stays.

- `Lovag` (Knight), `Tégla` (Brick), `Búza` (Wheat), `Kikötő` (Harbor), `Bank`, `Kocka`
  (Dice), `Püspök` (Bishop), `Kém` (Spy), `Diplomata`, `Mérnök`, `Alkimista`, `Feltaláló`,
  `Alkotmány`, `Nyomda`: these are the only ordinary Hungarian word for the concept.
- `Leghosszabb út` (Longest Road) and `Legnagyobb hadsereg` (Largest Army): superlative +
  noun, the one shape Hungarian has.
- `Bőség éve` (Year of Plenty): `bőség` is the standard Hungarian for agricultural plenty;
  `Bőség esztendeje` is the higher-register near-synonym.
- **The game's title stays `Costanio`,** untranslated and uninflected, as in every other
  locale. Where it would have to take a case, the sentence is rewritten around it.
- **The expansion names are ours and are translated as ours:** Islands → **`Szigetek`**,
  Knights → **`Lovagok`**, Fishermen → **`Halászok`**, Caravans → **`Karavánok`**, and the
  scenario modules in §6.

### 2.2 Where we differ from a common reflex because our English differs

| Concept | The common reflex | Ours | Why |
|---|---|---|---|
| the sheep resource | `gyapjú` ("wool") | **`Juh`** ("sheep") | Our English card says `Sheep`. Translating it faithfully lands on a different word. |
| the wheat resource | `gabona` ("grain") | **`Búza`** ("wheat") | Same. |
| settlement | `falu` ("village") | **`település`** | A village is a downgrade our English does not make, and it breaks the game's ladder: `település` → `város` reads as the upgrade the rules describe. `település` also carries its compounds (`kezdőtelepülés`, `településbábu`, `út- és településhálózat`), where `falu` would give `faluhálózat`. |

These two resource words can look like a mistake to a Hungarian reader but are correct.

---

## 3. Core game nouns

| English | Hungarian | Rationale |
|---|---|---|
| settlement | **település** | §2.2 |
| city | **város** | Only word. |
| road | **út** | Exact and short; it appears in `Leghosszabb út` and in dozens of buttons. |
| ship | **hajó** | Exact. |
| route (road+ship chain) | **útvonal** | Different from `út`, because the game distinguishes Longest **Road** from Longest Trade **Route**. |
| robber | **rabló** | Robber/brigand, matching the figure the art draws. It pairs with `kalóz` in register (`A kalóz a rabló tengeri párja`) and compounds cleanly (`rablóelűző cselekvés`, `rablómozgatás`, `barátságos rabló`). `tolvaj` (thief) is the alternative. |
| pirate | **kalóz** | Exact. |
| harbor / port | **kikötő** | Exact. |
| hex | **hatszög** | |
| tile (map builder) | **lapka** | The Hungarian board-game word for a tile, distinct from the hex. |
| edge | **él** | Geometric term. Also the Caravans and Raiders "path" (`parti él`, `tengeri él`, `célél`, `ezt az élt`). |
| vertex / junction / intersection | **csúcs** | Geometric term. `kereszteződés` reads as a road junction and is wrong on a lattice. `sarok` only for the corners of the board or ring. |
| board | **tábla** | |
| bank | **bank** | Byte-identical to the English, hence a blank in the two label entries (§13). |
| supply | **készlet** | Distinct from `bank`, as the English distinguishes them. |
| deck | **pakli** | The card-game word. `csomag` is the box-of-cards sense. |
| hand | **kéz** | It carries the possessive that keeps player names out of the case system (§11). |
| turn | **kör** | |
| round | **forduló** | Distinct from `kör`, as the English distinguishes them. |
| token (Defender, Merchant) | **jelző** | |
| number token / chit | **számjelző** | Distinct from bare `jelző`. A chit stack is `számjelző-kupac`. |
| leaderboard | **ranglista** | |
| ranked / casual | **rangsorolt** / **kötetlen** | |
| dice / die | **kocka** | Hungarian does not distinguish singular and plural here in ordinary use. |
| roll | **dobás** / **dob** | Log lines say `{player} dobott …`, never `{player} dobása …`. |
| trade (swap with a player) | **csere** | What the game actually does. |
| trade (commerce, the track) | **Kereskedelem** | The other word, because the game's Trade improvements and Trade cards are commerce, not a swap. |
| build / buy / discard / steal | **épít** / **vásárol** / **eldob** / **lop** | Buttons take `Építés`, `Vásárlás`, `Eldobás`. |
| victory point (VP) | **győzelmi pont**, abbreviated **GYP** | `GYP` is a Hungarian initialism used where space is short (the HUD pill, column headers, setting labels such as `Cél-GYP`, `Szigetbónusz GYP`). |
| development card | **fejlesztéskártya** | |
| progress card | **haladáskártya** | A different root from `fejlesztés`, because the game has both decks. |
| host | **házigazda** | 9 characters, and the lobby slot takes it. |
| seat | **hely** | Also the slot in the cosmetics shelf; the two never share a screen. `Seat colors` is `Színek a helyedhez`, because `helyszín` means *venue*. |
| table (a game instance) | **asztal** | |
| match | **játszma** | Distinct from `játék` (the game as a product). |
| piece (the class noun) | **bábu** | Where the English means the figure on the board. `összekötő elem` for *connection piece*, where the English means a kind of component. Not `elem` for the class. |
| improvement track | **sáv** | It is what the tracks look like in the seat rail, and it carries the barbarian track too (`A sáv 7 lépés hosszú`), which `ág` (branch) cannot. Not `szakterület` for the track. |
| scoreboard | **eredménytábla** | |
| setup | **előkészítés** | For the phase and its headings; `kezdő-` compounds for concrete objects (`kezdőtelepülés`, `kezdőlerakás`, `Kezdő út`). |

**Vowel-harmony note.** `település`, `város`, `út`, `hajó`, `kocka`, `csúcs` take different
suffix vowels (`települést`, `várost`, `utat`, `hajót`, `kockát`, `csúcsot`), `út`
additionally shortens its vowel before one (`út` → `utat`, not `útat`), and `kéz` alternates
(`kéz` → `kezében`). This is why no catalogue string suffixes an interpolated noun
(§11).

### `fejleszt` in three senses

The English distinguishes a *development* card (base) from a *progress* card (Knights), and
separately uses *upgrade* for a city improvement, *promote* for a knight and *advance* for
the barbarian track. Hungarian uses one root, `fejleszt`, for three jobs:
`fejlesztéskártya`, `városfejlesztés`, and the verb `fejleszt`. The senses never contend
for one sentence: the development deck belongs to the base game, city improvements to
Knights, and chapters that name both keep them apart lexically (`Nincsenek
fejlesztéskártyák` … `három fejlesztési sáv`). The knight is `előléptet` and the barbarians
`előrelép`. Where two senses meet, the perfective prefix disambiguates (`a saját
településeid egyikét fejleszti fel`). If this ever needs changing, rename the improvement
track, not the card.

### The three progress-card decks: adjective or genitive

Headings and accessible names use the **adjective** (`Kereskedelmi pakli`, `Politikai
pakli`, `Tudományos pakli`); sentences use the **genitive** (`A Kereskedelem paklija
üres.`). Hungarian cannot say `Kereskedelem pakli`, and a genitive does not fit a heading.
The deck headings sit directly under the track headings, which keep the nominative
(`Kereskedelem · szövetbe kerül`), so the identity survives by adjacency.

---

## 4. Terrains

These are the `terrain.*` ids in the singular form the catalogue ships. The terrain that
produces brick is called **Clay** in English while the *resource* is **Brick**, and
Hungarian keeps the same split: `Agyag` for the hex, `Tégla` for the card. The same split
runs through Mountain/Ore and Field/Wheat.

| English (`terrain.*`) | Hungarian | Note |
|---|---|---|
| Forest (`wood`) | **Erdő** | |
| Clay (`brick`) | **Agyag** | Paired with the resource `Tégla` |
| Pasture (`sheep`) | **Legelő** | |
| Field (`wheat`) | **Szántóföld** | Paired with the resource `Búza` |
| Mountain (`ore`) | **Hegy** | The hex is named for the landform, not for `Érc`, exactly as the English is |
| Desert (`none`) | **Sivatag** | |
| Sea (`sea`) | **Tenger** | |
| Lake (`lake`) | **Tó** | |
| Land (`land`) | **Szárazföld** | |
| Gold (`gold`) | **Aranymező** | The hex takes the compound so it is not the bare resource `Arany` |
| Border (`border`) | **Határ** | |
| Fog / unexplored (`fog`) | **Köd** | |

The map builder's water brush is **`Víz`** while the terrain stays **`Tenger`**: the English
draws the same split (a `Water` brush, a `Sea` terrain). Where English prose says "hill" for
the brick terrain, Hungarian uses the bound terrain names, never a literal `domb`.

---

## 5. Resources and commodities

| English | Hungarian | Rationale |
|---|---|---|
| Wood | **Fa** | Covers both the tree and the timber, which is what the card art shows. |
| Brick | **Tégla** | Only word. |
| Sheep | **Juh** | The English card says the animal (§2.2). `Birka` is the colloquial synonym. |
| Wheat | **Búza** | §2.2. |
| Ore | **Érc** | `Kő` (stone) would be the hex, not the card. |
| Gold (the wildcard) | **Arany** | |
| Coin | **Érme** | The minted-coin sense, keeping `pénz` free for money in general. |
| Paper | **Papír** | |
| Cloth | **Szövet** | |
| resource (the class) | **nyersanyag** | |
| commodity (the class) | **árucikk** | The commercial term, distinct from `nyersanyag` as the English distinguishes them. |
| good (either class) | **áru** | Too broad for either class alone, so reserved for the class covering both. |

---

## 6. Expansions and scenarios

### Knights, Fishermen, Caravans

| English | Hungarian | Note |
|---|---|---|
| knight (the piece) | **lovag** | |
| strength 1 / 2 / 3 knight | **1-es / 2-es / 3-as erejű lovag** | The product numbers the tiers |
| replacement knight (Deserter) | **pótlovag** | |
| activate a knight | **aktivál** / `Aktiválás` | |
| promote a knight | **előléptet** / `Előléptetés` | |
| upgrade a city improvement | **fejleszt** / `Fejlesztés` | §3 |
| advance (the barbarian track) | **előrelép** | |
| chase (the robber, the pirate, a barbarian) | **elüldöz** / `Rabló elüldözése` | |
| displace (an enemy knight) | **kiszorít** | |
| city improvement | **városfejlesztés** | |
| Trade / Politics / Science | **Kereskedelem** / **Politika** / **Tudomány** | |
| city wall | **városfal** | |
| metropolis | **metropolisz** | |
| barbarian / barbarian attack | **barbár** / **barbártámadás** | |
| aqueduct | **vízvezeték** | |
| Defender of the Realm | **A birodalom védelmezője** | |
| Merchant Guild | **Kereskedőcéh** | |
| Fortress | **Erőd** | |
| pillage | **fosztogat** | |
| event die | **eseménykocka** | |
| fish / fishing ground | **hal** / **halászterület** | |
| old boot | **ócska csizma** | |
| camel / caravan | **teve** / **karaván** | |
| zero bid | **nulla licit** / **nullát licitál** | |

`camel.bid.less` / `camel.bid.more` (`Bid one less {name}`) take the button phrase, a colon,
then `{name}`: `Licit eggyel kevesebbre: {name}`. `{name}` is the capitalised `msgctxt
"resource"` citation form (`Juh`, `Búza`), which cannot take a case ending, so it stays out
of the governed position.

### Expansion names

| English | Hungarian | Alternative | Note |
|---|---|---|---|
| Rivers | **Folyók** | – | Plural, the `Szigetek`/`Lovagok` shape. Takes a singular verb as a title (`A Folyók … tart`), as `A Szigetek az alapjátékra épül` does. |
| Raiders | **Portyázók** | `Fosztogatók` | `fosztogat` is already Knights' *pillage*; `portyázó` is the raiding party. |
| Wagons | **Szekerek** | `Kocsik` | `kocsi` reads as a car. |
| Explorers | **Felfedezők** | – | |
| Harbormaster | **Kikötőmester** | `Révkapitány` | Both the expansion and its 2-point card, as in English. `révkapitány` is the real harbour official but not our English. |

A scenario that replaces the base game is a **helyettesítés** (`csere` is a trade); one that
plays on its own is described with `önmagában` (`egyedül` reads as solo play).

### Raiders

| English | Hungarian | Note |
|---|---|---|
| raider (neutral enemy figure on a hex) | **portyázó** | |
| rider (the player's own figure on a path) | **lovas** | Shares no root with `portyázó`: the English pair is one letter apart and Hungarian must not be. Also distinct from `lovag` (knight). |
| path (where riders and barbarians stand) | **él** | The bound word for a board edge (§3). |
| castle | **vár** | `kastély` is a manor. Also a Wagons trade hex. |
| Muster / Swift Rider / Treason / Intrigue | **Toborzás** / **Gyors lovas** / **Árulás** / **Intrika** | `Intrika` is the Knights card's word too, because the English is the same word. |
| prisoner | **fogoly** | |
| conquer / conquered / liberate | **elfoglal** / **elfoglalt** / **felszabadít** | |
| landing | **partraszállás** | |
| battle sweep | **csatasöprés** | |
| outnumber | **túlszárnyal** | |

### Rivers

| English | Hungarian | Note |
|---|---|---|
| river / bridge / bridge site | **folyó** / **híd** / **hídhely** | |
| river mouth / swamp | **folyótorkolat** / **mocsár** | |
| ford (a river) | **átgázol** | |
| coin | **érme** | The same word as the Knights coin commodity, because the English uses the same word. |
| pays / earns coins (a bridge, a river edge) | **hoz** / **jár érte** | Never `fizet`, which reads as the player paying. |
| purse | **erszény** | |
| can't make change | **visszajáró nincs** / **visszajáró nélkül** | |
| Wealthiest Settler / Poorest Settler | **Leggazdagabb telepes** / **Legszegényebb telepes** | Sentence case (§1); `lapka` added where the English says *tile*. Together they are `vagyonlapkák`, the scoreboard column `Vagyon`. |

### Wagons

| English | Hungarian | Note |
|---|---|---|
| wagon / wagon track | **szekér** / **szekérsáv** | |
| trip (a wagon's move) | **menet** | Never `út` (road). |
| circuit (the Wagons loop) | **szállítási kör** | Bare `kör` is *turn*; `kereskedelmi útvonal` is Longest Trade Route. |
| cargo | **rakomány** | Never `árucikk`, which is Knights' *commodity*. |
| toll | **útdíj** | `vám` is customs at a border. |
| trade hex | **kereskedelmi hatszög** | |
| castle / quarry / glassworks | **vár** / **kőfejtő** / **üveghuta** | |
| plaza / spoke | **piactér** / **küllő** | |
| marble / glass / tools / sand | **márvány** / **üveg** / **szerszám** / **homok** | |
| barbarian (on a path) | **barbár** | The Knights word. |
| drive (a barbarian) off | **elűz** | Kept apart from *chase* (`elüldöz`). |
| Swift Journey | **Gyors utazás** | |
| movement points | **mozgáspont** | Shared with Explorers ships. |
| level (wagon upgrade) | **szint** | |

### Explorers

| English | Hungarian | Note |
|---|---|---|
| settler | **telepes** | The same word as the Rivers tiles, as in English. |
| crew | **legénység** | Over `matróz` (one sailor): the piece is a landing party. Counts after a numeral like any noun (`3 legénység`). |
| fish haul | **halfogás** | Over `halrakomány`. |
| spice sack / spice farm / spice village | **fűszerzsák** / **fűszerültetvény** / **fűszerfalu** | `ültetvény` over `farm`, which reads as livestock. |
| pirate lair | **kalózrejtek** | Over `kalóztanya` / `kalózfészek`. |
| gold field | **aranymező** | The gold-hex word. |
| fish shoal | **halraj** | A school of fish, not `zátony` (a shallow). |
| harbour settlement | **kikötőtelepülés** | The Explorers building, not `kikötő` (a port). |
| hold / basin | **raktér** / **medence** | |
| Council / Council hex / anchor | **Tanács** / **Tanács-hatszög** / **horgonyhely** | |
| Swift Voyage / Pirate Bonus / Fast Gold | **Gyors hajózás** / **Kalózbónusz** / **Gyors arany** | In log lines written in parentheses after `fűszerfalu`/`fűszerültetvény`, so no suffix lands on a name. |
| tribute | **sarc** | |
| mission / track / bonus tile | **küldetés** / **sáv** / **bónuszlapka** | `sáv` as for the Knights tracks. |
| track space (missions) | **mező** | Ship movement stays `lépés`. |
| Production / Action / Movement phase | **Termelés** / **Cselekvés** / **Mozgás** | `Akció` is the loanword alternative. |
| fleet / cargo ship | **flotta** / **teherhajó** | |
| home island / home waters / fog | **hazai sziget** / **hazai vizek** / **köd** | |

### Harbormaster

| English | Hungarian | Note |
|---|---|---|
| Harbormaster (card and expansion) | **Kikötőmester** | |
| harbour points | **kikötőpont** | |
| a settlement on a harbour | **kikötőnél álló település** | `kikötőtelepülés` is only the Explorers building. |
| up for grabs (log) | **gazdátlan** | |

---

## 7. Numbers, plurals and counting

- **Hungarian has two CLDR plural categories** (`one`, `other`). Every ICU `plural` in the
  catalogue carries both, because the runtime addresses them by name and a missing arm is
  a test failure (`catalog.test.ts`).
- **Both arms usually carry the identical singular noun**, because Hungarian does not
  pluralise after a numeral: `3 kártya`, never `3 kártyák`. `{n, plural, one {# kártya}
  other {# kártya}}` is correct Hungarian, not an unfinished entry; such entries carry a
  `PLURAL` note saying so, because they are easy to "correct" into an error. Where the two arms differ it is because verb agreement
  changes, not the noun (`log.goldOwed`: `választ` / `választanak`).
- **A numeral also takes an article chosen by how it is *spoken*:** `mind a 2`, but `mind
  az 1` and `mind az 5`, because `egy` and `öt` begin with vowels. A count is data, so no
  single article is right; see §11.
- **Ordinals** are written `1.`, `2.` with a full stop.
- **`goodCount()`'s `Fa ×2` form needs no change:** `×n` is a suffix on the card, not a
  number governing a noun, so Hungarian's numeral rule never engages. Prefer it wherever
  the text is a tally.

---

## 8. The 30 card titles

Sentence case, because Hungarian does not title-case and the card face uppercases in CSS.
Every title below is the ordinary Hungarian for our English phrase (§2.1).

### Development deck

| English | Hungarian | Note |
|---|---|---|
| Knight | **Lovag** | |
| Victory Point | **Győzelmi pont** | |
| Road Building | **Útépítés** | |
| Year of Plenty | **Bőség éve** | `Bőség esztendeje` is the higher-register alternative. |
| Monopoly | **Monopólium** | The economic term. |

### Trade deck

| English | Hungarian | Note |
|---|---|---|
| Commercial Harbor | **Kereskedelmi kikötő** | |
| Master Merchant | **Kereskedő­mester** | Carries a soft hyphen at the compound seam (§9). `mester` is master-of-a-craft, which fits the guild flavour. |
| Merchant | **Kereskedő** | |
| Merchant Fleet | **Kereskedő­flotta** | Soft-hyphen seam (§9). |
| Resource Monopoly | **Nyersanyag-​monopólium** | A zero-width space after the existing hyphen (§9). |
| Trade Monopoly | **Kereskedelmi monopólium** | |

### Politics deck

| English | Hungarian | Note |
|---|---|---|
| Bishop | **Püspök** | |
| Constitution | **Alkotmány** | |
| Deserter | **Dezertőr** | `Szökevény` is the native-root alternative and is broader (any runaway). |
| Diplomat | **Diplomata** | |
| Intrigue | **Intrika** | |
| Saboteur | **Szabotőr** | |
| Spy | **Kém** | |
| Warlord | **Hadúr** | The established Hungarian for "warlord". |
| Wedding | **Esküvő** | The ceremony. `Lakodalom` is the feast. |

### Science deck

| English | Hungarian | Note |
|---|---|---|
| Alchemist | **Alkimista** | |
| Crane | **Daru** | The machine and the bird are the same word in Hungarian too. |
| Engineer | **Mérnök** | |
| Inventor | **Feltaláló** | |
| Irrigation | **Öntözés** | |
| Medicine | **Orvoslás** | The discipline. `Gyógyszer` would be the drug. |
| Mining | **Bányászat** | |
| Printer | **Nyomda** | The printing house, which is what the art shows. `Nyomdász` would be the person. |
| Road Building (science) | **Útépítés** | Same English, same Hungarian, two decks. |
| Smith | **Kovács** | |

---

## 9. Card-title font and break seams

**The card-title font is a generated subset.** `frontend/scripts/gen-title-fonts.py` walks
every `messages.po`, collects the characters the thirty card titles use in every locale,
and subsets `gelasio-titles.woff2` to exactly those; `frontend/src/lib/titleMetrics.json`
carries the matching glyph advances. Hungarian titles need `ő`/`Ő`, which the subset
carries. `ű`/`Ű` are absent because no Hungarian title contains one; the source face
(`art/cards/tools/fonts/Gelasio-Bold.ttf`) carries all four, so **a title change that
introduces a new character means re-running the generator**, which raises an error naming
the codepoint if the face cannot supply it. Run `gen-title-fonts.py --check` directly and
read its output: the vitest case that wraps it skips when `fontTools` is missing.

`frontend/src/lib/cardTitle.ts` needs no Hungarian special case: `titleFace()` falls `hu`
through to `latn`, and `titleCase()` uses `toLocaleUpperCase("hu")`.

**Break seams are data, never inference.** A long single-word title shrinks below the
fitter's 0.85 cap-height floor unless the catalogue gives it a break opportunity, so the
card-title entries carry them:

- a **soft hyphen** (U+00AD) at the compound seam of `Kereskedő­mester` and
  `Kereskedő­flotta`, which draws a hyphen when used, right for a Hungarian compound;
- a **zero-width space** (U+200B) after the existing hyphen in `Nyersanyag-​monopólium`,
  where a second hyphen would be wrong.

They are invisible in running text. The seams are in the card-title entries only; the same
words in the manual and the log carry none. `cardTitle.test.ts` checks that every catalogue
that needs a seam carries one.

---

## 10. Length and overflow

Hungarian noun compounds grow and Hungarian verb phrases shrink, the same shape Turkish
has. Measured in the shipped face (Baloo 2 700, uppercase, `tracking-[1px]`):

| Message | English | Hungarian | Container |
|---|---|---|---|
| `Win %` | 5 | `Nyert %` (7) | `Leaderboard.tsx` `w-16` (64px), 11px: 50px, fits. `Győzelmi %` (10) would overflow. |
| `Rating` | 6 | `Értékelés` (9) | `Leaderboard.tsx` `w-20` (80px), 11px: 64px, fits. Chosen over `Pontszám`, which is the *victory* score elsewhere in the catalogue. `Értékelés` is the Elo figure in all its siblings (`Ideiglenes értékelés`, `Nincs értékelés`). |
| `Games` | 5 | `Játszmák` (8) | `Leaderboard.tsx` `w-20`: 59px, fits. |
| `Stat` | 4 | `Mutató` (6) | `PostGameScoreboard.tsx` frozen first column. `Statisztika` (11) would cost every player column width. |
| `Target VP`, `Island bonus VP` | 9, 15 | `Cél-GYP` (7), `Szigetbónusz GYP` (16) | `Lobby.tsx` setting labels. `SettingRow` is `flex-wrap` and `SectionLabel` neither truncates nor forbids wrapping, so a long label wraps to a second line and never clips. |
| `Leave & Spectate` | 16 | `Kilépés és nézés` (16) | `Game.tsx` confirm dialog, `max-w-[360px]` two-button row. The faithful `Kilépés és nézőként maradás` is 28 and does not fit; the short form is used in the button, in the manual and in the error that names it. |
| `Longest trade route` | 19 | `Leghosszabb kereskedelmi útvonal hossza` (39) | Scoreboard details matrix, 150px wrapping block. Costs row height, not column width. |
| `Land mix`, `Default` | 8, 7 | `Terepösszetétel`, `Alapértelmezés` | Fixed table headers; the widest Hungarian headers relative to their English, and the ones to check on mobile. |

The post-game scoreboard's stat columns are auto-width `<th>` inside a `w-full` table, so a
longer Hungarian heading widens its column rather than clipping. The failure mode there is
the table growing wide on a narrow viewport.

---

## 11. Interpolation: suffixes, articles and placeholders

Hungarian attaches case, possession and number as suffixes whose vowels harmonise with the
stem, and puts `a` or `az` before a noun depending on the noun's first sound. Both are
decided by a word that, in an interpolated frame, only arrives at runtime. `-val/-vel` is
worse still: it assimilates to a final consonant (`Péterrel`, `fával`) and a name ending in
a short `a`/`e` lengthens it (`Anna` → `Annától`).

**The catalogue never writes a suffix onto a placeholder.** Three rewrites do the work, in
preference order:

1. **Possessive.** Hungarian marks the *possessed*, not the possessor, so the possessor
   stays nominative: `{host} asztala`, `{player} köre`, `{who} kezében`, `{owner} útját`,
   `{track} paklija`. Fully idiomatic, and it carries most of the event log.
2. **Postposition.** Postpositions take the bare nominative: `{name} számára`, `{name}
   nélkül`, `{name} után`, `{name} ellen`.
3. **Colon label.** Move the value out of the governed position entirely: `Csere vele:
   {0}`, `(előző tulajdonos: {prev})`, `Kiegészítő: {name}`.

**Personal names take no article in standard Hungarian** (`Péter nyert`, not `A Péter
nyert`), so `{player}` as the subject of a log line is safe with no rewrite. **Player names
are never suffixed anywhere in this catalogue**: Hungarian would want `Annának`,
`Péternek`, `Zsóhoz`, and the vowel is unknowable.

### 11.1 Frames no rewrite can make idiomatic

Some source frames cannot be made idiomatic by any of the three rewrites. They are rendered
as a colon label or a postposition, which is grammatical and flatter than the English, or,
where an article before a value is unavoidable, with **`a(z)`**, the standard Hungarian
form-letter convention for exactly this situation. The recurring shapes:

| Shape | Example | What is undecidable |
|---|---|---|
| a player name in a governed position | `traded with {other}`, `taken from {prev}` | `-val/-vel` (assimilates), `-tól/-től` |
| a card or track name as a direct object | `the {track} deck`, `Nowhere is a legal target for {name}` | `-t` accusative and the article before it |
| a **numeral** in a suffixed or articled position | `promote to strength {strength}`, `mind a(z) {count} kártyát`, `against {discardAt}` | `-as/-es/-ös`; and `a` vs `az` decided by how the number is *spoken* (`a hét`, but `az öt`) |
| a provider or brand name | `The {victimProvider} account`, `Continue with Google` | `a` vs `az` (`a Google`, `az Apple`); `Google-lal` vs `Google-lel` is contested even among Hungarians |
| a joined list as a grammatical subject | `Accepted: {0}` | the verb's number (`Elfogadta` / `Elfogadták`) |

**The source-side fix is one message per value**, as `frontend/src/lib/cardPhrases.ts`,
`resource.count.*`, `error.NO_PIECES.*`, `harbor.receive.*`, `track.deckEmpty.*` and
`board.metropolis.*` already do, so each locale supplies the suffix and article itself.
Where a family is finite (pieces, tracks, knight tiers, OAuth providers) that retires the
hazard outright. Where it is not finite (a player name, a configurable numeral) the colon
label is the answer.

Do not turn a colon label back into a sentence: flat as it reads, it is the only safe shape.

---

## 12. Name order

Hungarian writes the family name first. **This does not apply anywhere in this
catalogue**: every `{player}`, `{host}`, `{who}`, `{victimName}` and `{other}` carries a
display name the player typed or a Discord handle, not a structured given/family pair.
Reordering would corrupt a handle.

---

## 13. Deliberate blanks

An empty `msgstr` falls back to the identical English at runtime. Where the only correct
Hungarian is a copy of the English, the entry is left blank on purpose rather than filled
with a copy, which keeps `catalog.test.ts`'s "a translation is never its own message id"
guard meaningful. Each carries a `BLANK` note naming its reason. They are not gaps.

| msgctxt | msgid | why blank |
|---|---|---|
| – | `{0}` | bare placeholder |
| – | `{0} ({1} Pips)` | placeholders plus the untranslated product token `Pips` |
| – | `{label}, {total}` | placeholders and punctuation only |
| – | `{label}: {n}` | placeholders and punctuation only |
| progress card board prompt | `{name}: {instruction}` | placeholders and punctuation only |
| – | `{nextReward}. {nextCost}` | two placeholders run together with a period Hungarian punctuates the same way |
| – | `{ratio}:1 {resource}` | a ratio label; Hungarian writes it identically |
| – | `2:1 {resource}` | same |
| the resource supply everyone draws from; trade with the bank | `Bank` (two entries) | the Hungarian is the same word |
| turn timer preset | `Blitz` | product token, kept in English in every locale |
| turn timer preset | `Normal` | the Hungarian is the same word |
| name decoration … booster | `Booster` | platform label, kept in English in every locale |
| – | `Bot` | the Hungarian is the same word |
| – | `Pips` | product token, kept in English in every locale |

A blank entry is never an ICU plural: a blank falls back to the English *message*, and
which arm renders is then chosen by the active locale's rules. The turn-timer preset
`Relaxed` is translated (`Nyugodt`), and the manual names the presets as the picker shows
them.

---

## 14. Things left in English

- **`Costanio`**: the game's title, untranslated and uninflected (§2.1).
- **`Booster`, `Brigand`, `Hourglass`, `Driftwood Set`** and the colour names: brand
  flavour, shipped by the backend, untranslated in every locale.
- **`Elo`, `JSON`, `Discord`, `Google`, `Ko-fi`, `Pips`, `Bot`, `Blitz`**: proper nouns,
  formats and platform tokens.

---

## 19. Further terms

Terms bound file-wide so later entries do not drift:

| English | Hungarian | Note |
|---|---|---|
| Fair (dice and board modes) | **igazságos** | Used identically on the lobby control and in the manual. `kiegyensúlyozott` only where the English says *balanced* (`Kiegyensúlyozott számeloszlás`). |
| random | **véletlen** | |
| Stay (button) | **Maradás** | The deverbal noun, pairing with the `Kilépés…` button opposite it. |
| Ready (socket connected) | **Kapcsolódva** | `Készen áll` is the player-ready sense. |
| Equip / Unequip / Equipped | **Felvétel** / **Levétel** / **Felvéve** | The clothing metaphor. `Felszerelés` reads as arming. |
| name decoration / cosmetics / store | **névdísz** / **testreszabás** / **Bolt** | |
| level with (VP) | **holtverseny** | `szint` is taken. |
| table-setting default | **alapérték** | |
| VP badge | **elsőként N pontig** | |
| lit / highlighted board target | **kiemelt** | Not `kivilágított`. |
| previous holder (log) | **(előző tulajdonos: {x})** | |
| sell / buy section titles | **Árucikk eladása …**, **Nyersanyag vásárlása …** | Deverbal nouns, per §1. |
| Movement phase | **Mozgás fázis** | |

Chapter titles and the names a manual cross-reference points at are rendered identically
everywhere they appear: `Playing online` = `Online játék`, `Table settings` =
`Asztalbeállítások`, `Dice & fairness` = `Kocka és igazságosság`, `Clocks & auto-play` =
`Órák és automatikus lépés`, `Base game` = `Alapjáték`, `Setting up the board` = `A tábla
előkészítése`, the `Play` nav item = `Játék`, the map-builder `Water` brush = `Víz`, and
`Leave & Spectate` = `Kilépés és nézés`.
