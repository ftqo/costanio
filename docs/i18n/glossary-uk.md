# Ukrainian (`uk`) terminology glossary

The terminology, register and grammar conventions the `uk` catalogue
(`frontend/src/locales/uk/messages.po`) follows. The catalogue is written against this
document, so a term recorded here should be reused rather than replaced with a synonym, and
changing an entry here means a find-and-replace over the `.po`.

**Sources:** `frontend/src/locales/en/messages.po`, `docs/rules/*.md`,
`art/cards/cards.json`, `docs/i18n/glossary-de.md`, `glossary-es.md` and `glossary-tr.md`.

---

## 1. Register decisions

### Formality: **ти** (informal second person), everywhere

**`ти` / `тебе` / `твій` / `тобі`, second-person-singular verb endings.** The English source
is chatty and informal; `ви` would read correct but distant, like a bank. `de` chose `du`,
`es` chose `tú`, `tr` chose `sen`, and this keeps all four consistent. The catalogue carries
no `ви` forms.

**A bare button is an infinitive; a sentence is `ти`.** Bare buttons are infinitives
(`Зберегти`, `Скасувати`, `Видалити`, `Кинути кубики`, `Перезавантажити`), which is what
Ukrainian interfaces do. The `ти` imperative appears only where the surrounding sentence is
already addressing the player (`Торкнися міста, щоб…`, `Візьми карту прогресу…`). Use the
full reflexive form `торкнися`, not `торкнись`.

**Seat-card hints shown on every player's card carry no `ти`**, because they are read by
everyone at the table, not only by the seat's owner.

**The legal-page titles** (Terms and Privacy keep English bodies by decision; only the
titles and footer links are localized) are plain noun phrases carrying no person:
`Умови користування` and `Політика конфіденційності`.

### Gendered past tense: impersonal, never a gendered default

Ukrainian marks the subject's gender in the past tense and a player's gender is unknowable,
so no string asserts one:

- **The event log is in the historical present:** `{player} бере`, not `{player} узяв/узяла`.
  This is why no log line has to know a player's gender.
- **System reports use the impersonal passive:** `Збережено`, `Скасовано`, `Усі три твої
  мости вже збудовано` (not `Ти збудував…`), `зв’язок утрачено`.
- **Rules prose states a rule in the habitual present or impersonally** (`коли ти купуєш
  карту`, `коли його збудовано`), which is how Ukrainian rules prose normally reads anyway,
  rather than addressing the reader in the masculine past (`коли ти її купив`).
- Rejected: the masculine default and `зберіг(ла)`-style dual forms, which are ugly in a game
  log.
- A product name that would otherwise force a gendered verb (Discord `Activity`) stays in
  Latin script and the sentence is recast impersonally.

### The existential remainder

The `card.bankLeft.*` / `card.supplyLeft.*` / "left in the deck" family uses the impersonal
neuter in the `few`/`many`/`other` arms (`2 цегли залишилося в банку`) with agreement only
in the `one` arm (`1 цегла залишилася в банку`). That is the standard existential pattern;
`залишилися` is used only for a real plural subject.

### Punctuation

- Quotation uses `«…»`. Card titles and named items cited in running text take guillemets
  (`«Начальник порту»`), and a user-supplied name in quotes uses them too (`«{0}»`).
- An en dash `–` (spaced) where English would use a dash. No em dashes.
- **The copula dash.** Ukrainian puts a dash, not a comma, before `це`
  (`«Лицарі» – це найглибший режим`).
- **The apostrophe is `’`** (U+2019), not the ASCII `'`: `з’єднання`, `п’ять`.
- The decimal separator is `,` and the group separator a thin space, but no catalogue string
  formats a number itself (`Intl` does).
- The у/в alternation is euphonic and both forms are correct: `у` after a consonant
  (`зв’язок утрачено`), `в` after a vowel (`нічого не втрачено`). Two forms of the same word
  a few words apart are not an inconsistency.

### Expansion names in guillemets

`Лицарі` is both the expansion and the game piece, so no mechanical rule can separate them.
The convention: quote the expansion **when it is named as a product** (mode pickers, lobby,
`Лише для «Лицарів»`, `у грі з «Лицарями»`), and leave it bare when it heads a chapter or a
rule. The pieces on the board are never quoted.

---

## 2. Naming policy

### 2.0 The rule

> Translate our English faithfully. Only the game title and the expansion names are
> our own.

Our English already uses `Master Merchant`, `Bishop`, `Warlord`, `Longest Road`,
`Year of Plenty`. Those are descriptive phrases, not marks.

- **The game's own title stays in Latin script** (`Costanio`, and `costan` where the domain
  is meant), untranslated and uninflected; Latin script inside Cyrillic text is normal for
  product names in Ukrainian. `Костаніо` would decline properly but loses the match with
  the domain.
- **The expansion names are ours and are translated as ours:** `Islands` → **`Острови`**,
  `Knights` → **`Лицарі`**, `Fishermen` → **`Рибалки`**, `Caravans` → **`Каравани`**,
  and the later scenarios as listed in §9.

### 2.1 Coincidence is not a problem

The test: **could a translator arrive here from our English alone?** If yes, a match with a
word Ukrainian players already know is a coincidence and is correct.

### 2.2 Faithful words chosen over looser alternatives

Our English uses concrete agent nouns, and the faithful Ukrainian follows it. Common
Ukrainian board-game usage often reaches instead for abstract nouns or thematic renames; we
do not.

| Our English | Faithful Ukrainian (ours) | Looser alternative | Why ours |
|---|---|---|---|
| Settlement | **поселення** | селище | faithful to *settlement* |
| Brick | **цегла** | глина ("clay") | `глина` would collapse our Brick/Clay split |
| Wood | **дерево** | деревина ("timber") | faithful to *wood* |
| Sheep | **вівця** | вовна ("wool") | our English says the animal |
| Wheat | **пшениця** | збіжжя ("corn/grain") | our English says *wheat* |
| Cloth | **тканина** | сукно ("broadcloth") | faithful to *cloth* |
| Bank | **банк** | резерв ("reserve") | faithful to *bank* |
| Victory point | **переможне очко** | переможний бал | ordinary faithful rendering |
| Largest Army | **Найбільша армія** | Найбільше військо | faithful to *army* |
| Year of Plenty | **Рік достатку** | Наукове відкриття ("scientific discovery") | ours says *Year of Plenty* |
| Card titles naming a person | **Єпископ, Воєвода, Дезертир, Шпигун, Диверсант, Інженер, Коваль, Алхімік, Винахідник** | abstract nouns (*tax*, *valor*, *espionage*, *smithing*…) | our English names the person |
| Metropolis | **метрополія** | столиця ("capital") | faithful to *metropolis* |
| City wall | **міська стіна** | міський мур | transparent and faithful |

Words with **exactly one ordinary Ukrainian equivalent** need no comment: *ore* (`руда`),
*coin* (`монета`), *paper* (`папір`), *knight* (`лицар`), *monopoly* (`Монополія`),
*constitution*, *printer*, *medicine*, *irrigation*, *intrigue*, *wedding*.

Our `Longest Trade Route` (the Islands award) translates faithfully to
**`Найдовший торговий шлях`**: "longest" + "trade" + "route" has one rendering. Our
`Longest Road` is **`Найдовша дорога`**.

Other choices made on the same rule: `ресурси` (not `сировина`) as the umbrella for
resources, `очко` (not `бал`) for a victory point, `ребро` (not `шлях`) for a board edge,
`гекс` (not `плитка місцевості`) for a hex, and `найняти / підвищити / активувати` as the
knight verb triad.

---

## 3. Core game nouns, with gender and plural pattern

Columns: nominative singular · gender · genitive singular · nominative plural · genitive
plural. The last three are what the ICU `other` / `few` / `many` arms need (§7).

| English | Ukrainian | g. | gen.sg | nom.pl | gen.pl |
|---|---|---|---|---|---|
| settlement | **поселення** | n | поселення | поселення | поселень |
| city | **місто** | n | міста | міста | міст |
| road | **дорога** | f | дороги | дороги | доріг |
| ship | **корабель** | m | корабля | кораблі | кораблів |
| route | **маршрут** | m | маршруту | маршрути | маршрутів |
| robber | **розбійник** | m | розбійника | розбійники | розбійників |
| pirate | **пірат** | m | пірата | пірати | піратів |
| harbor / port | **порт** | m | порту | порти | портів |
| hex | **гекс** | m | гекса | гекси | гексів |
| tile (map-builder cell) | **клітинка** | f | клітинки | клітинки | клітинок |
| edge | **ребро** | n | ребра | ребра | ребер |
| vertex / junction / intersection | **перехрестя** | n | перехрестя | перехрестя | перехресть |
| island | **острів** | m | острова | острови | островів |
| bank | **банк** | m | банку | банки | банків |
| supply | **запас** | m | запасу | запаси | запасів |
| deck | **колода** | f | колоди | колоди | колод |
| card | **карта** | f | карти | карти | карт |
| hand | **рука** | f | руки | руки | рук |
| turn | **хід** | m | ходу | ходи | ходів |
| round | **раунд** | m | раунду | раунди | раундів |
| die / dice | **кубик** | m | кубика | кубики | кубиків |
| player | **гравець** | m | гравця | гравці | гравців |
| game | **гра** | f | гри | ігри | ігор |
| victory point | **очко** | n | очка | очки | очок |
| development card | **карта розвитку** | f | карти розвитку | карти розвитку | карт розвитку |
| progress card | **карта прогресу** | f | карти прогресу | карти прогресу | карт прогресу |
| knight | **лицар** | m | лицаря | лицарі | лицарів |
| metropolis | **метрополія** | f | метрополії | метрополії | метрополій |
| city wall | **міська стіна** | f | міської стіни | міські стіни | міських стін |
| barbarian | **варвар** | m | варвара | варвари | варварів |
| improvement | **покращення** | n | покращення | покращення | покращень |
| board | **поле** | n | поля | поля | полів |
| map (map-builder artefact) | **мапа** | f | мапи | мапи | мап |

Notes:

- **`поселення` is a neuter `-ння` noun and does not change between nom.sg, gen.sg and
  nom.pl.** Only the genitive plural (`поселень`) differs, so its `one`/`few`/`other` arms
  are identical and its `many` arm different. That is grammar, not a copy-paste error. The
  same holds for `перехрестя` and `покращення`.
- **`гра` has an irregular plural** (`ігри`, `ігор`), the most common agreement mistake in
  Ukrainian catalogues.
- **`карта` vs `мапа`.** `карта` is both *card* and *map* in Ukrainian, and this product has
  hundreds of strings using `карта` for cards, so **`мапа`** carries *map* (the map builder's
  artefact). The play surface is **`поле`**, never `мапа` and never `дошка` (a plank).
- **`клітинка`** is the map builder's grid cell. It is never used for a fish tile (§9).
- **Victory points.** The abbreviation is **`ПО`**, the initialism of **П**ереможне
  **О**чко, invariant in every plural arm (`+# ПО`). It follows the full term: a change to
  the full term changes the abbreviation with it. `оч.` would collide with the singular
  `очко`, and Latin `VP` is not used.
- **`очко` after 2–4 is `очки`**, its nominative plural (`2 очки`, `+2 очки`, `по 2 очки`,
  `2 переможні очки`), and the genitive plural is `очок` (`5 очок`). `очка` is the genitive
  singular: it belongs in the `other` arm (`2,5 очка`) and after a preposition or negation
  (`карта переможного очка`, `пів очка`), never after 2–4, where it is the Russianism §7.1a
  describes. A bare plural without a numeral is `очки` too (`відкриті очки`, `дає очки`).
  Movement is always counted with its noun: `3 очки руху`, never `3 руху`.
- **Pieces and counters.** A playing piece is **`фігурка`** (`фігурка поселення`,
  `фігурка з’єднання` for a connection piece). A counter is **`жетон`**: the Defender and
  Merchant tokens, exploration chips, number tokens (`числовий жетон`) and fish tiles.
  **`фішка`** is kept only where the English itself says *chit*.
- **An award is a `титул`**, never `звання`.
- **`rematch`** is `реванш`.

---

## 4. Terrains

| English | Ukrainian | g. |
|---|---|---|
| forest | **ліс** | m |
| hills | **пагорби** | m.pl |
| pasture | **пасовище** | n |
| fields | **поля** | n.pl |
| mountains | **гори** | f.pl |
| desert | **пустеля** | f |
| sea | **море** | n |
| lake | **озеро** | n |
| gold river | **золота річка** | f |
| gold field | **золота копальня** | f |
| fog | **туман** | m |
| land (noun) | **суходіл** | m |
| land (adjective) | **сухопутний** | |

Hex names used mid-sentence are lower case (`пустеля`, `озеро`, `золота копальня`).
`суходільний` also occurs as the adjective in some scenario strings; `сухопутний` is the
form the rules prose, the map validator and the map builder use.

---

## 5. Resources

| English | Ukrainian | g. | gen.sg | nom.pl | gen.pl |
|---|---|---|---|---|---|
| Wood | **дерево** | n | дерева | дерева | дерев |
| Brick | **цегла** | f | цегли | цегли | цеглин |
| Sheep | **вівця** | f | вівці | вівці | овець |
| Wheat | **пшениця** | f | пшениці | пшениці | пшениць |
| Ore | **руда** | f | руди | руди | руд |
| Gold (wildcard) | **золото** | n | золота | – | – |

**Mass versus count, which Ukrainian forces and English hides.** `дерево`, `пшениця`,
`руда` and `золото` are **mass** nouns here: "3 wood" is three cards' worth of stuff, not
three trees. `цегла` and `вівця` are **count** nouns: three bricks, three sheep. The
`resource.count.*` per-card messages are where that split is written down. **`цегла`'s
genitive plural is `цеглин`** (from the singulative `цеглина`).

A mass noun after 5+ takes the genitive **singular** (`5 дерева`), which is the same form a
fraction wants (`1,5 дерева`), so the `many` and `other` arms of a mass resource are
identical by grammar.

---

## 6. Commodities (Knights)

| English | Ukrainian | g. | gen.sg | nom.pl | gen.pl |
|---|---|---|---|---|---|
| Coin | **монета** | f | монети | монети | монет |
| Paper | **папір** | m | паперу | папери | паперів |
| Cloth | **тканина** | f | тканини | тканини | тканин |
| commodity (class) | **товар** | m | товару | товари | товарів |
| resource (class) | **ресурс** | m | ресурсу | ресурси | ресурсів |

---

## 7. Plurals: the four categories

### 7.1 The categories

CLDR gives Ukrainian **four cardinal plural categories**, and every one of them is reached
by real values in this game:

| Category | Reached by | Noun form | Example with `карта` |
|---|---|---|---|
| `one` | 1, 21, 31, 101 (ends in 1, not 11) | nominative singular | `1 карта` |
| `few` | 2–4, 22–24, 32–34 (ends 2–4, not 12–14) | **nominative plural** | `2 карти` |
| `many` | 0, 5–20, 25–30, 11–14 | **genitive plural** | `5 карт` |
| `other` | fractions only (1.5, 2.5) | **genitive singular** | `1,5 карти` |

**Every ICU `plural` in the catalogue carries all four arms.** A message with only `one` and
`other` is wrong for 2–4 and for 22–24, which are values this game reaches constantly. The
`other` arm is always filled with the genitive-singular form rather than left to guess.

### 7.1a The `few` arm is nominative plural

**Ukrainian takes the nominative plural after 2–4, not the genitive singular.** `два
гравці`, `три кораблі`, `чотири ресурси`. The genitive singular there (`два гравця`,
`чотири ресурсу`) is a Russianism and is wrong in standard Ukrainian.

For **feminine and neuter** nouns the two forms are homographs (`карти` is both the genitive
singular and the nominative plural of `карта`; `міста` both for `місто`), so the error is
invisible there. For **masculine** nouns they diverge, and so does the neuter `очко`
(`очка` against `очки`), the one non-masculine noun here where the error shows:

| Noun | g. | `few` (correct, nom.pl) | wrong (gen.sg) |
|---|---|---|---|
| гравець | m | `2 гравці` | `2 гравця` |
| ресурс | m | `2 ресурси` | `2 ресурсу` |
| корабель | m | `2 кораблі` | `2 корабля` |
| лицар | m | `2 лицарі` | `2 лицаря` |
| острів | m | `2 острови` | `2 острова` |
| хід | m | `2 ходи` | `2 ходу` |
| кубик | m | `2 кубики` | `2 кубика` |
| гекс / порт / маршрут / раунд / товар / символ | m | `2 гекси / порти / маршрути / раунди / товари / символи` | `гекса / порту / …` |
| карта / гра / дорога / цегла / вівця / монета | f | `2 карти / ігри / дороги / цегли / вівці / монети` | (identical either way) |
| очко | n | `2 очки` | `2 очка` |
| місто / поселення | n | `2 міста / поселення` | (identical either way) |

### 7.2 How the arms are stored

The arms live inside a single `msgstr` as ICU text, not as gettext `msgid_plural` /
`msgstr[n]`, so the `Plural-Forms:` header stays empty, exactly as in `de`/`es`/`ja`, and no
`nplurals` declaration is needed. Lingui compiles the arms as an object keyed by category
name and selects with `Intl.PluralRules`, so all four categories survive to runtime:
`{count, plural, one {# камінь} few {# камені} many {# каменів} other {# каменя}}` renders
`1 камінь`, `2 камені`, `5 каменів`, `21 камінь`, `22 камені`, `25 каменів`, `1,5 каменя`.
`catalog.test.ts` checks that every ICU plural carries all the categories its locale can
reach.

### 7.3 Where `many` equals `other`, legitimately

For a count noun the `many` arm (genitive plural) and the `other` arm (genitive singular)
differ (`5 карт` / `1,5 карти`, `5 гравців` / `1,5 гравця`). They are identical, correctly,
when:

- the noun is a **mass resource** (§5);
- there is **no noun to inflect**: an invariant initialism (`+# ПО`, all four arms
  identical), a verb agreeing only for number (`{names} має/мають`), or an elided noun
  (`# куплено цього ходу.`);
- `перших` + an animate masculine noun, which takes the genitive plural at every count above
  one.

### 7.4 Two departures from the English shape

- **`всі` is dropped in the `one` arm.** Ukrainian `всі` is a plural quantifier, so `всі 1
  карту` is ungrammatical where English tolerates "all 1 card": `Обрано # карту / Обрано всі
  # карти / … всі # карт / … всі # карти`.
- **`#` is dropped where a numeral would be ungrammatical**, as in `лише першого власника
  товарів` (not `лише першого 1 власника`).

---

## 8. The 30 card titles

From `art/cards/cards.json`. For Ukrainian, every title is the faithful rendering of our
English, usually the person our English names rather than an abstract noun (§2.2).

### Development deck

| English | Ukrainian | Note |
|---|---|---|
| Knight | **Лицар** | Only word. |
| Victory Point | **Переможне очко** | |
| Road Building | **Будівництво доріг** | Genitive plural: the card builds two. |
| Year of Plenty | **Рік достатку** | `достаток` = plenty/abundance. `Рік врожаю` (year of harvest) is the alternative. |
| Monopoly | **Монополія** | Only word. |

### Trade deck

| English | Ukrainian | Note |
|---|---|---|
| Commercial Harbor | **Торговий порт** | |
| Master Merchant | **Старший купець** | `Головний купець` is the alternative. |
| Merchant | **Купець** | `Торговець` is the synonym. |
| Merchant Fleet | **Торговий флот** | |
| Resource Monopoly | **Монополія на ресурси** | |
| Trade Monopoly | **Торгова монополія** | |

### Politics deck

| English | Ukrainian | Note |
|---|---|---|
| Bishop | **Єпископ** | Only word. |
| Constitution | **Конституція** | Only word. |
| Deserter | **Дезертир** | Only word. |
| Diplomat | **Дипломат** | Only word. |
| Intrigue | **Інтрига** | Only word. |
| Saboteur | **Диверсант** | `Саботажник` is the transparent alternative. |
| Spy | **Шпигун** | Only word. |
| Warlord | **Воєвода** | The historically Ukrainian word for a war-leader, and the right register for the card. `Воєначальник` is the neutral modern term and is 13 characters. |
| Wedding | **Весілля** | Only word. |

### Science deck

| English | Ukrainian | Note |
|---|---|---|
| Alchemist | **Алхімік** | |
| Crane | **Кран** | The machine, not the bird. Ukrainian `кран` is also a tap; `Підйомний кран` disambiguates at 14 characters. |
| Engineer | **Інженер** | |
| Inventor | **Винахідник** | |
| Irrigation | **Зрошення** | |
| Medicine | **Медицина** | The discipline. |
| Mining | **Гірництво** | `Видобуток` (extraction) is the alternative. |
| Printer | **Друкарня** | The printing house, which is what the art shows. |
| Road Building (science) | **Будівництво доріг** | Same English, same Ukrainian, two decks. |
| Smith | **Коваль** | |

---

## 9. Knights-expansion and scenario vocabulary

### Knights

| English | Ukrainian | Note |
|---|---|---|
| strength 1 / 2 / 3 knight | **лицар сили 1 / 2 / 3** | The source numbers the tiers; Ukrainian follows exactly (`Збудувати лицаря сили 1`, `Обидва лицарі сили {next} вже на полі`, scoreboard `Лицарі сили 1 / 2 / 3`). No named tiers |
| hire (a knight) | **найняти** | |
| activate | **активувати** | |
| promote | **підвищити** | |
| upgrade (a city) | **покращити** | |
| advance (barbarian track) | **просунути** | |
| barbarian track | **шкала** | |
| barbarian attack | **напад варварів** | |
| aqueduct | **акведук** | |
| Trade / Politics / Science | **Торгівля / Політика / Наука** | Proper names, capitalised, including in `Колода Торгівлі / Політики / Науки` |
| Defender of the Realm | **Захисник краю** | `край` leans towards homeland rather than kingdom |
| Merchant Guild | **Купецька гільдія** | |
| Fortress | **Фортеця** | |
| pillage | **грабувати** | |
| event die | **кубик подій** | |
| public victory points | **публічні переможні очки** (`публічними переможними очками`) | Wherever the English (or the rule) is about public VP, the qualifier is written out |

The three improvement-track headings share one construction (they cost a commodity), and
`Для лицарів сили 3 потрібен рівень 3 у Політиці.` shows the strength vocabulary in the
genitive with the track name capitalised.

### Fishermen and Caravans

No established Ukrainian usage exists for this material, so these terms are ours.

| English | Ukrainian | Alternatives considered |
|---|---|---|
| Fishermen | **Рибалки** | |
| fish | **риба** | |
| fishing ground | **рибне місце** | `рибне угіддя` (the regulatory term) |
| fish tile | **рибний жетон** | `рибна клітинка` (rejected: `клітинка` is the map-builder cell) |
| the old boot | **чобіт** (`старий чобіт`) | `старий черевик` (a shoe, worse) |
| side currency | **побічна валюта** | `допоміжна валюта` (more clerical), `окрема валюта` |
| Caravans | **Каравани** | |
| camel | **верблюд** | |
| caravan | **караван** | |
| oasis | **оазис** | never `оаза` |
| oasis spoke | **спиця** (оазису) | `промінь`, `виступ`, `відгалуження` |
| camel junction | **верблюже перехрестя** | reuses the settled `перехрестя` |
| path (a board edge a camel stands on) | **ребро** | `шлях` (rejected: it is the Longest Road chain), `стежка` |
| bid one less / one more `{name}` | `На одну менше: {name}` / `На одну більше: {name}` | `{name}` arrives capitalised in the nominative citation form (`Вівця`, `Пшениця`), so it follows a colon as a label rather than being folded into the verb phrase |

### Harbormaster, Rivers, Raiders, Wagons, Explorers

| English | `uk` | Note |
|---|---|---|
| Harbormaster | **Начальник порту** | harbour points = портові очки |
| Rivers | **Річки** | |
| coins | монета / монети / монет | |
| bridge / bridge site (crossing) | міст / місце для мосту | |
| swamp / ford | болото / переходити вбрід | |
| Wealthiest / Poorest Settler | «Найзаможніший поселенець» / «Найбідніший поселенець» | |
| Raiders | **Нападники** | raider = нападник |
| rider | вершник | |
| castle / prisoner / conquered / landing | замок / полонений / захоплений / висадка | |
| Muster / Swift Rider / Treason / Intrigue | «Збір» / «Швидкий вершник» / «Зрада» / «Інтрига» | |
| path (a board edge) | **ребро** | `шлях` stays the Longest Road chain |
| Wagons | **Вози** | wagon = віз (воза, вози, возів). The imperative `вози` collides, so "haul cargo" is `перевозь` |
| plaza / spoke / trade hex | площа / спиця / торговий гекс | |
| quarry / glassworks | каменоломня / склярня | |
| marble / glass / tools / sand | мармур / скло / інструменти / пісок | |
| cargo / load / toll | вантаж / вантаж / мито | |
| Swift Journey | «Швидка поїздка» | |
| Wagons barbarian place | між гексами {a} і {b} / біля гекса {a} / на узбережжі | Labels stay nominative, in apposition |
| Explorers | **Дослідники** | |
| home island / home waters | рідний острів / рідні води | |
| settler / crew | поселенець / екіпаж | |
| fish haul / spice sack | улов / мішок прянощів | |
| spice farm / spice village | плантація прянощів / село прянощів | |
| Fast Gold / Pirate Bonus / Swift Voyage | «Швидке золото» / «Піратська премія» / «Швидке плавання» | |
| shoal / pirate lair / Council | мілина / піратське лігво / Рада | |
| harbour settlement / hold / basin | портове поселення / трюм / док | |
| tribute | данина | |
| island bonus | очки за острови | |
| movement points | очки руху | always with the noun: `3 очки руху`, never `3 руху` |

Scenario conventions:

- *Build* is `будувати`; the reflexive `будуватися` is not used for building something.
- A count before a noun the ICU message cannot inflect becomes a colon frame
  (`Купити ресурс за монети: {price}`).
- A module that "plays alone" `не поєднується з іншими доповненнями`, never
  `грається окремо`.
- Trade-offer status lines use colon frames for the joined name lists:
  `Усі відмовилися` / `Відмовилися:` / `Чекаємо:`.

---

## 10. Case, and the frames it bites

Ukrainian assigns case by the governing word. `для` takes genitive, `отримати` takes
accusative, a numeral takes one of three forms (§7). None of that is decidable when a noun
arrives at runtime, so the source and the catalogue keep to shapes where no case is owed:

- **Per-noun messages.** Where a frame would govern an interpolated noun, the source writes
  one message per noun (`lib/cardPhrases.ts`, `short.needOneMore.*`, `harbor.receive.*`),
  and the Ukrainian writes the governed form out in each (`отримуєш дерево / цеглу / вівцю
  / пшеницю / руду`).
- **Tallies as suffixes.** `goodCount()` writes `Дерево ×2`: `×2` is a suffix on the card
  rather than a numeral governing the noun, so the three-way numeral agreement never
  engages.
- **Labels and colons.** `{ratio}:1 {resource}`, `2:1 {resource}`, `Expansion: {name}`,
  `{name}: {instruction}`, `event: {name}`: the value is nominative by construction.
- **Subjects.** `{name}: цю карту треба зіграти до кидка кубиків.` A card name is moved in
  front of a colon where the English makes it the subject of a longer sentence.
- **Quotation.** `«{name}» буде видалено з твоєї бібліотеки.` Quotation isolates the name.

**Player names are never inflected anywhere in this catalogue.** Ukrainian would need a
vocative or genitive on a name whose declension class is unknowable (and many player names
are not Ukrainian words at all), so every such message is written into a colon or
nominative frame instead. The redaction placeholder for a hidden player has a subject form
(`Хтось`) and an object form (`когось`).

---

## 11. Casing

- Ukrainian has no dotted/dotless-`i` problem, so §11 of `glossary-tr.md` does not apply.
- **Headings are written in normal case.** Where a panel renders a heading in capitals it
  does so with a CSS `uppercase` class, so the catalogue entry is `Номер`, `Порт`, `Ресурс`,
  `Розмір`, never `НОМЕР`. Ukrainian display typography uses caps far less than English
  does.
- Proper names of tracks, decks and expansions are capitalised (`Політика`, `Колода Науки`,
  `Лицарі`).

---

## 12. Length

Ukrainian runs **roughly 10–20% longer than English**, similar to German, and noun phrases
grow further when a case ending is added.

| Message | English | Ukrainian | Note |
|---|---|---|---|
| `Largest Army` badge | 12 | `Найбільша армія` (15) | Tight |
| `Longest Trade Route` badge | 19 | `Найдовший торговий шлях` (23) | The longest award name |
| `Defender of the Realm` | 21 | `Захисник краю` (13) | Shorter |
| `End turn` button | 8 | `Завершити хід` (13) | Tight in the HUD |
| `Roll` button | 4 | `Кинути кубики` (13) | |
| `Waiting for players` | 19 | `Чекаємо на гравців` (18) | Fits |
| `Victory Point` | 13 | `Переможне очко` (14) | Fits |
| withdraw your own trade offer | 6 (`Cancel`) | `Відкликати пропозицію` (21) | Has its own row; the same act as on the draw-offer card |

---

## 14. Things left in English, and blank entries

**Left in English / Latin script:** `Costanio` / `costan`; `Brigand`, `Hourglass`,
`Driftwood Set` and the colour names (backend-shipped brand flavour, untranslated in every
locale); `Elo`, `JSON`, `Discord`, `Google`; Discord's `Activity`. `Bot` is written in
Cyrillic (`Бот`), and `Booster` is `Бустер`. **`Host`** is translated (`Господар`) rather
than borrowed, because Ukrainian has no comfortable loan for it.

**Blank entries.** An empty `msgstr` falls back to the identical English at
runtime, and `catalog.test.ts`'s "a translation is never its own message id" guard is what
makes writing the copy out illegal. These are not gaps:

| entry | why blank |
|---|---|
| `{0}` · `r{0}` · `+2` | a bare placeholder or number |
| `{label}, {total}` · `{label}: {n}` · `{nextReward}. {nextCost}` · `{name} {level}/5` · `{resource} {num}` | placeholders and punctuation only |
| `{name}: {instruction}` *(ctxt: progress card board prompt)* | same |
| `2:1 {resource}` · `{ratio}:1 {resource}` | a ratio and a placeholder |
| `Pips` · `{0} ({1} Pips)` | the product's own currency name, English in every locale |

---

## 20. UI and product vocabulary

| English | Ukrainian | Alternatives considered |
|---|---|---|
| store | **Крамниця** | `Магазин` (a loan, colder) |
| supporter | **Прихильник** | `Спонсор` (advertising), `Патрон` (nobility), `Підтримувач` |
| boost (Discord) | **буст** | `підсилення` describes something else; this names the platform feature |
| rating / ranked | **рейтинг** / **рейтинговий** | `ранг` / `рангова гра` (reads as a military grade) |
| cosmetics / decoration | **косметика** / **оздоблення** | `оздоба`, `прикраса` |
| equip / unequip | **Застосувати** / **Зняти** | `екіпірувати` (a military loan) |
| preset | **пресет** | `стандартний варіант` (not what a preset is) |
| rematch | **реванш** | `матч-реванш` |
| host | **Господар** | `Ведучий` |
| "Try again in a moment." | **Спробуй ще раз за мить.** | One rendering for every entry with this English |
| withdraw (own trade offer) | **Відкликати пропозицію** | |
| Every turn | **Кожного ходу** | `Щохода` is not a word |

The Discord `Activity` stays in Latin script (§1, gendered past tense).
