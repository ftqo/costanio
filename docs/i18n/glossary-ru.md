# Russian (`ru`) terminology glossary

The terminology, register and grammar conventions the Russian catalogue
(`frontend/src/locales/ru/messages.po`) follows. A term chosen here recurs across hundreds
of strings, so changing one is a catalogue-wide edit: read the relevant section before
adding or rewording an entry.

**Sources:** `frontend/src/locales/en/messages.po` (the English is the source of truth),
`art/cards/cards.json`, `docs/rules/`, `frontend/src/locales/README.md`,
`docs/i18n/CONTRIBUTING.md`, and `glossary-de.md` / `glossary-es.md` for the shape of this
document. `glossary-uk.md` and `glossary-pl.md` face the same four-category plural system.

Section numbers are stable; gaps in the numbering are intentional.

---

## 1. Register and global decisions

These hold across every string. Mixing them is the most visible sign of an assembled
translation.

### 1.1 Formality: **`вы`**, lower-case, everywhere

**Lower-case `вы` / `ваш` / `вам` throughout, including error messages, board prompts, the
rules manual, and the browser titles of the legal pages. Never `ты`. Never capitalised
`Вы`.**

This departs from what `de` and `es` chose:

- **Russian `вы` is register-neutral, and is not the equivalent of German `Sie`.** German
  `du`/`Sie` and Spanish `tú`/`usted` split roughly along "friendly" versus "formal", so the
  informal form matched the chatty English source. Russian splits along
  "already-acquainted" versus "not", and lower-case `вы` is what a product says to a
  person it has not met.
- **`ты` in Russian is a claim of familiarity**, and a game that opens by addressing a
  stranger as `ты` reads as either a children's product or a rude one. This product has a
  moderation policy, a ban rule and a Terms page in the same catalogue, and `ты` in a ban
  notice reads as contempt rather than warmth.
- **Capitalised `Вы` is the marked, deferential form** of business correspondence. Using it
  in a UI is the over-formality error.

If the register were ever changed to `ты`, it is a scripted change: `вы`→`ты`,
`ваш`→`твой`, `вам`→`тебе`, and every imperative loses its `-те` (`Возьмите`→`Возьми`,
`Постройте`→`Построй`, `Бросьте`→`Брось`, `Нажмите`→`Нажми`).

### 1.2 Surface register

| Surface | Register | Example |
|---|---|---|
| Buttons, menu items, tab labels, column headers | **Bare noun, or bare INFINITIVE for an action** | `Построить`, `Обменять`, `Завершить ход`, `Настройки` |
| System messages: errors, toasts, confirmations, empty states | **Full sentence, `вы`, final period** | `На это у вас не хватает ресурсов.` |
| Board prompts (the lower-case running hints under the board) | **Imperative, `вы`, no final period**, lower-case initial where the source lower-cases it | `нажмите на гекс` |
| Event log lines | **PRESENT tense, plain declarative** (§1.3) | `{player} строит поселение` |
| Card rule text | **Imperative, `вы`** | `Переместите разбойника и украдите случайную карту` |
| Rules manual, legal page titles | **Full sentences, `вы`, longer and plainer** | |

**Infinitive vs. imperative on buttons.** Russian UI convention is the bare infinitive
(`Сохранить`, `Отменить`), not the imperative (`Сохрани(те)`). The catalogue uses the
infinitive on every button and the imperative only in running prompts and card text.

**A transitive verb keeps its object.** `Не удалось сохранить изменение`, `Не удалось начать
игру`: a transitive Russian verb with no object reads as more obviously unfinished than the
English bare form does.

**Headings and standalone controls must not open on a pronoun.** A user can land on a
panel from the sidebar, so a title such as `Как держать и разыгрывать карты прогресса`
names its noun rather than relying on the paragraph above (`Как их…`). The same applies to
lobby strings where a pronoun would attach to the nearest plural noun.

### 1.3 The event log is in the present tense

Russian past tense **agrees with the subject's gender**: `построил` (m.) against
`построила` (f.). A display name gives the renderer no gender, and there is no
gender-neutral past. The options are:

- guess masculine: wrong for half the table, every line;
- a nominal/passive construction (`{player}: построено поселение`): grammatical, but reads
  like a server log, and it would collide with the colon frames §1.5 uses for label/value
  pairs;
- **present tense** (`{player} строит поселение`): genderless in Russian, idiomatic for a
  running log. **This is the convention.**

Every `lib/eventlog.ts` line whose subject is a display name follows it, as do `{who}`,
`{thief}`, `{victimName}` and `{owner}` wherever they appear elsewhere. `{player} took the
Longest Road` is `{player} получает «Самую длинную дорогу»`, not `получил`. A line that
reads as a log keeps to subject-verb-object without evaluative adverbs, which is what keeps
the present neutral rather than sounding like sports commentary.

**The same gender problem exists outside the past tense.** Short-form predicates (`должен`,
`готов`, `рад`) agree in gender too. Where one is needed over a display name, use the
apposition device of §1.5: `Игрок {player} должен отдать город.`

Lines whose subject is not a display name (barbarian raid outcomes, `Никто ничего не
получил`, `Игра закончилась вничью`) carry no gender problem and are written in the past
tense in the catalogue.

### 1.4 Plurals: four categories

Russian CLDR categories, with the arm each takes:

| Category | Values | Form | Example (`кирпич`) |
|---|---|---|---|
| `one` | 1, 21, 31, 101 … (`n%10==1 && n%100!=11`) | nominative singular | `1 кирпич` |
| `few` | 2–4, 22–24 … (`n%10` 2–4, `n%100` not 12–14) | **genitive singular** | `2 кирпича` |
| `many` | 0, 5–20, 25–30 … | **genitive plural** | `5 кирпичей` |
| `other` | fractions only (1.5, 2.5) | genitive singular | `1,5 кирпича` |

**Every ICU `plural` carries all four arms**, even though the English source has two. A
message with only `one`/`other` is wrong for 2–4 and for 5–20. The pipeline is
category-driven: the arms live inside a single `msgstr` as ICU, `compileMessage()` keeps all
four keys, and `@lingui/core` selects through `Intl.PluralRules`. `catalog.test.ts` compares
argument *names*, not arm contents, so a missing or wrong arm is not caught by the tests and
has to be right by construction.

**`other` is always identical to `few`.** `other` is reachable only for fractions, and
Russian puts a decimal in the genitive singular, which is the `few` form. That is the
invariant to hold; `many == other` is never a convention, only ever a consequence of
`few == many`.

**Where `few` and `many` coincide, and why that is correct:**

| Where | Why |
|---|---|
| after the preposition `до` ("up to"): `error.CHAT_LENGTH.max`, `error.NAME_REQUIRED.max`, `Safe up to # card` | the whole numeral phrase is genitive, so every arm above `one` takes the genitive plural |
| animate masculine in the accusative: `log.knightsActivated`, `# владельцев товара` | the accusative equals the genitive, so 2 and 5 take the same form (`# рыцарей`); `one` stays distinct (`# рыцаря`) |
| `resource.count.gold` | mass noun with no usable genitive plural (§4) |
| `log.goldOwed`, `track.draw.*` | the only inflected word is the verb, which is plural for everything above one |
| `log.islandChip` | `ПО` is an invariant abbreviation; the one block where `one == few` too |

**Declension patterns the catalogue touches:**

| Class | one | few (gen. sg.) | many (gen. pl.) |
|---|---|---|---|
| masculine hard (`кирпич`, `город`, `игрок`, `тайл`, `ресурс`) | # кирпич | # кирпича | # кирпичей |
| feminine `-а` (`овца`, `карта`, `монета`, `игра`) | # овца | # овцы | # овец |
| feminine `-ь` (`ткань`) | # ткань | # ткани | # тканей |
| neuter (`очко`, `дерево`) | # победное очко | # победных очка | # победных очков |
| animate masculine, accusative (`рыцарь`) | # рыцаря | # рыцарей | # рыцарей |

- **An adjective before a masculine noun takes the genitive plural in the `few` arm even
  though the noun takes the genitive singular**: `сейчас # открытых стола` against
  `сейчас # открытый стол`. This is the rule most easily got wrong.
- **The verb can change arm to arm.** `Нужна # ткань` (feminine singular agreement) becomes
  impersonal `Нужно # ткани` from two upward; `# кирпич остался` becomes `# кирпича
  осталось`.
- **`все` does not agree with a singular.** An English `all {n} cards` drops the quantifier
  in the `one` arm (`Вы выбрали 1 карту`) and keeps it in the others (`Вы выбрали все 22
  карты`). Mind the 21/22 wraparound: 21 is `one`.
- **No ordinal over a runtime count.** `первых {forced}` reads wrong at 1; recast so that
  nothing ordinal agrees with the number (`заставить можно только {forced,…} из {all},
  начиная с первого по очереди`).
- **A blank entry must never carry a plural.** An English fallback has no `few` arm,
  so 2/3/4 would render `other`.
- **Counts the English writes without a plural** (`{count} gold`) are recast as a colon
  frame, `золото: {count}`, so no arm is needed. An English "a rider" / "one raider" arm
  becomes an explicit `=1` arm ahead of the four categories, so 21 still reads
  `21 всадника`.

### 1.5 Case, and the frames that remain

`lib/cardPhrases.ts` gives one message per card with the noun written in, and `goodCount()`
writes `Дерево ×2` for tallies; per-resource and per-piece messages
(`short.needOneMore.*`, `error.NO_PIECES.*`, `harbor.receive.*`, `track.*`) do the same.
Where a list remains, it sits after a colon (`short.shortOf`: `You are short of:
{resources}`), so it is grammatically inert. The `resource, standalone label` msgctxts are
only ever labels, so the nominative is the only form needed.

**Names are never inflected.** A display name is an arbitrary foreign string, so the
catalogue never puts one in an oblique case and never forms a possessive from it:

| English | Russian |
|---|---|
| `{curName}'s turn` | `Ходит {curName}` |
| `{host}'s game` | `Игра: {host}` |
| `{player} removed {owner}'s road` | `{player} убирает дорогу игрока {owner}` |
| `Look at {who}'s hand and take 2 cards` | `Посмотреть руку игрока {who} и забрать 2 карты` |
| `Steal a card from {who}` | `Украсть карту у игрока {who}` |
| `Response sent, waiting for {0}` | `Ответ отправлен, ждём игрока {0}` |

The apposition (`игрока {name}`) carries the case, and the name stays nominative.

**Non-name placeholders in agreeing positions** take the colon or a parenthesis where the
value is a label: `{0} deck` → `Колода: {0}`, `{metro} Metropolis` → `Метрополия: {metro}`,
`Close {shownTitle}` → `Закрыть: {shownTitle}`, `Draw a {track} progress card` → `Возьмите
карту прогресса ({track})`, `Bid one less {name}` → `На одну меньше: {name}` (`{name}`
arrives capitalised, in citation form). A count before a noun the message cannot inflect is
a colon frame too (`Купить ресурс за монеты: {price}`). A joined list of names follows a
colon (`Отказались: {names}`, `Ждём: {names}`).

### 1.6 The letter **ё** is written, always

**Write `ё` everywhere it belongs.** `счёт`, `берёт`, `даёт`, `идёт`, `ещё`, `её`, `своё`,
`перекрёсток`, `тёмная`, `жёлтая`, `отражённые`, `рёбер`.

Folding `ё` to `е` is the common default in Russian prose, defensible in long text where
context disambiguates. This catalogue is the opposite: two- and three-word labels with no
context, where `все`/`всё` and `счет`/`счёт` are exactly the pairs that occur. Russian
software splits on the question, so there is no convention to appeal to; writing `ё` keeps
the catalogue mechanically checkable, and folding later is one substitution while
un-folding is a manual edit.

The catalogue writes no folded spelling of an obligatory-`ё` word. `всё` (neuter,
"everything") and `все` (plural, "all/everyone") are different words and both occur; a
folding script would have to handle that pair by hand.

### 1.7 Punctuation

- **No em dash (U+2014).** The repository has none, in any language. Russian requires
  the dash between two nominatives joined by `это`, so do not drop it from that
  construction; rephrase instead (`Корабль: участок пути по воде`, or a verb such as
  `является` or `служит`).
- Quotation marks are Russian angle quotes `«…»`, around card titles, award names,
  expansion names, deck names and user-supplied map names.
- `·`, `…`, `→`, `×`, `✓`, `≥` are kept exactly as the source has them. The en dash `–` is
  kept in numeric ranges (`1–4`, `3–10`).
- Decimal comma where a number is prose (`1,5 кирпича`, `4,99 $/мес.`).

---

## 2. Naming policy

### 2.0 The rule

> **Translate our English faithfully. Only the game title and the expansion names diverge.**

Every Russian sentence is written from the English source. Where our faithful Russian lands
on a word Russian players already know, that is expected and correct.

### 2.1 The policy, and its consequences

1. **The product title and the expansion titles are the only divergences.** The
   product is `Costanio`, never translated and never transliterated. Our expansions are
   named "Islands" and "Knights" in English, so the Russian translates *those*: `Острова`
   and `Рыцари`; the scenario titles likewise (§6).
2. **Everything else is translated on its merits.** The test for every term is: *what is the
   faithful Russian for the English word we use?*
3. **Card names are descriptive phrases.** The ordinary Russian for them is the
   correct Russian for our English.
4. **Where a common Russian term departs from *our* English, we follow our English.**

### 2.2 The divergences, in full

| English | **Ours** | Why |
|---|---|---|
| Islands (expansion) | **Острова** | Faithful rendering of *our* name, "Islands" |
| Knights (expansion) | **Рыцари** | Faithful rendering of *our* name, "Knights" |

The product name `Costanio` is not translated at all (§11).

### 2.3 Faithful words chosen over a looser common alternative

| English | **Ours** | Looser alternative | Why ours is the faithful one |
|---|---|---|---|
| brick (resource) | **Кирпич** | Глина | Our English says "brick" and calls the *terrain* "Clay", which is `Глина`. Keeping both preserves a distinction the source makes |
| sheep | **Овца** | Шерсть | Our English says "sheep", not "wool" |
| wheat | **Пшеница** | Зерно | Our English says "wheat", not "grain" |
| Longest Road | **Самая длинная дорога** | Самый длинный тракт | Our English says "road". `тракт` is a highway |
| Longest Trade Route | **Самый длинный торговый путь** | Самый длинный тракт | Our English says "trade route", and the route counts ships |
| Road Building (card) | **Строительство дорог** | Строительство дороги | Ours builds **2** roads, so the plural is the accurate title |
| Strength 1 / 2 / 3 knight | **Рыцари силы 1 / 2 / 3** | простой / славный / великий рыцарь | Our English numbers the tiers. `error.MIGHTY_NEEDS_FORT` is built on the same `Рыцари силы 3` |
| Merchant Guild (Trade 3) | **Гильдия купцов** | | Faithful rendering of "Merchant Guild" |
| gold hex | **Золотой гекс** | Золотое поле | Our English says "hex"; `поле` is the whole board here (§3) |

### 2.4 Familiar words that are the ordinary Russian

`Поселение` · `Город` · `Дорога` · `Разбойник` · `Пират` · `Рыцарь` · `Карта развития` ·
`Победное очко` · `Метрополия` · `Городская стена` · `Варвары` · `Акведук` ·
`Кубик событий` · `Товар` · `Бумага` / `Ткань` / `Монета` · `Руда` · `Дерево` ·
`Самая большая армия` · and the card titles `Рыцарь`, `Монополия`, `Год изобилия`,
`Победное очко`, `Епископ`, `Конституция`, `Дезертир`, `Дипломат`, `Интрига`, `Шпион`,
`Свадьба`, `Купец`, `Торговый флот`, `Алхимик`, `Инженер`, `Изобретатель`, `Орошение`,
`Медицина`, `Кузнец`. These are not leaks; they are what our English says.

---

## 3. Core game nouns

Gender is given because it governs every adjective and past-tense verb around the noun, and
the one/few/many pattern because §1.4's plural arms are built from it.

| English | `ru` | Gender | one / few / many | Note |
|---|---|---|---|---|
| road | дорога | f | дорога / дороги / дорог | |
| settlement | поселение | n | поселение / поселения / поселений | |
| city | город | m | город / города / городов | |
| ship | корабль | m | корабль / корабля / кораблей | |
| knight | рыцарь | m | рыцарь / рыцаря / рыцарей | Animate: accusative plural = genitive plural (`активирует 2 рыцарей`). Where the English says "knights", say `рыцари`, not `фишки`: the manual uses `фишки` for the reserve supply |
| city wall | городская стена | f | стена / стены / стен | Short form `стена` in narrow labels |
| building (cover term) | постройка | f | постройка / постройки / построек | |
| build (verb) | строить / построить | | | Never reflexive `строиться`, which means "line up" |
| robber | разбойник | m | | |
| pirate | пират | m | | |
| merchant (token and card) | купец | m | купец / купца / купцов | |
| harbor / port | **порт** | m | порт / порта / портов | Our English uses "harbor", "harbour" and "port" for one thing; Russian unifies them as `порт`. `гавань` (f.) is also correct, but two words for one component would read as a bad translation, and `порт` is shorter in the tightest surfaces (the board-size table's `Порты` column, the 2:1 / 3:1 chips) |
| hex (board space) | **гекс** | m | гекс / гекса / гексов | The Russian board-gamer loan, 4 characters, and it keeps `поле` free for the board. `клетка` is a square |
| tile (map-builder piece) | тайл | m | тайл / тайла / тайлов | Only in the map builder, where the source itself switches from "hex" to "tile" |
| board (the whole thing) | поле | n | | `Поле: шестиугольник из гексов`. Because `поле` is the board, the wheat terrain is `пашня` |
| vertex / intersection / spot | перекрёсток | m | перекрёсток / перекрёстка / перекрёстков | Three English words unified. `узел` reads as a maths term |
| edge / path (a board edge) | ребро | n | ребро / ребра / рёбер | `путь` is reserved for a chain of roads (`Самый длинный путь`, `Самый длинный торговый путь`). Sea edge: `морское ребро` |
| card | карта | f | карта / карты / карт | |
| development card | карта развития | f | | The deck is `колода карт развития` |
| progress card | карта прогресса | f | | Our English distinguishes development (base) from progress (Knights) |
| deck | колода | f | | |
| victory point | победное очко | n | очко / очка / очков | Only *public* victory points count where the English says "public": `открытым победным очкам` |
| VP (abbreviation) | **ПО** | | | Two letters, which the scoreboard columns need |
| resource | ресурс | m | ресурс / ресурса / ресурсов | |
| commodity | товар | m | товар / товара / товаров | |
| bank | банк | m | | |
| supply (of commodities) | запас | m | | The source distinguishes the resource *bank* from the commodity *supply*. "in supply": `в запасе` |
| number token / chit | жетон числа | m | жетон / жетона / жетонов | |
| metropolis | метрополия | f | метрополия / метрополии / метрополий | |
| city improvement | улучшение города | n | | |
| improvement track | ветка улучшений | f | | |
| barbarians | варвары | pl | | |
| barbarian fleet | флот варваров | m | | |
| camel | верблюд | m | верблюд / верблюда / верблюдов | |
| caravan | караван | m | | |
| oasis | оазис | m | | |
| fish | рыба | f | рыба / рыбы / рыб | |
| fish tile | рыбный жетон | m | | |
| fishing ground | рыбное место | n | | |
| old boot | старый сапог | m | | |
| lake | озеро | n | | |
| seat (at a table) | место | n | место / места / мест | |
| table (a game) | стол | m | стол / стола / столов | |
| host | хозяин | m | | `ведущий` reads as a quiz-show compère |
| player | игрок | m | игрок / игрока / игроков | Also the apposition that carries case for display names (§1.5) |
| opponent | соперник | m | соперник / соперника / соперников | |
| spectator | зритель | m | зритель / зрителя / зрителей | |
| bot | бот | m | бот / бота / ботов | |
| turn | ход | m | ход / хода / ходов | |
| die / dice | кубик | m | кубик / кубика / кубиков | |
| draw (a level game) | ничья | f | | |
| forfeit | поражение | n | | One word for "forfeit" across the ranked-play copy |
| game (a match) | игра | f | игра / игры / игр | |

### Terrain

| English | `ru` | Note |
|---|---|---|
| forest | лес | |
| pasture | пастбище | |
| field | пашня | The wheat terrain. Never `поле`, which is the board |
| hill | холм | |
| clay (map-builder terrain) | глина | The resource is `кирпич` (§2.3) |
| mountain | гора | |
| desert | пустыня | |
| sea | море | |
| water | вода | The map-builder brush |
| land | суша | |
| gold | золото | |
| fog | туман | |
| border | граница | |
| swamp | болото | |

A hex named by its terrain in running text is lower case: `пустыня`, `озеро`,
`золотой гекс`. Resources produced by a gold hex are taken `с золотого гекса`; `за золото`
would mean "in exchange for gold".

---

## 4. Resources and commodities, and the counted-mass-noun problem

| English | `ru` | Gender | one | few | many |
|---|---|---|---|---|---|
| wood | **Дерево** | n | дерево | дерева | **деревьев** |
| brick | **Кирпич** | m | кирпич | кирпича | кирпичей |
| sheep | **Овца** | f | овца | овцы | овец |
| wheat | **Пшеница** | f | пшеница | пшеницы | **пшениц** |
| ore | **Руда** | f | руда | руды | **руд** |
| gold | **Золото** | n | золото | золота | **золота** |
| paper | **Бумага** | f | бумага | бумаги | бумаг |
| cloth | **Ткань** | f | ткань | ткани | тканей |
| coin | **Монета** | f | монета | монеты | монет |

Four of these are mass nouns in both languages, and the game counts them as cards:

- `деревьев` is also the ordinary genitive plural of "tree". In context (beside a resource
  icon, in a row of resources, or in a phrase like `осталось в банке`) it reads as wood.
  The alternatives considered were `древесина` ("timber", which counts just as badly:
  `5 древесин`) and a measure word (`5 карт дерева`), unambiguous but 8 characters longer
  and inconsistent with the other resources.
- `пшениц` and `руд` are grammatical genitive plurals of nouns that are not normally
  pluralised: unusual, not wrong, and not open to misreading. A measure word (`до 2 карт
  пшеницы`) costs 8 characters in the tightest surfaces (hand shelf, bank row, trade panel).
- `золото` has no usable genitive plural, so the `many` arm uses the genitive singular
  (`5 золота`), which is what Russian does for an uncounted mass noun.

Each resource has its own message in `lib/cardPhrases.ts` and its own four arms, so a
change to one resource (for example a measure word for wood alone) is contained.

**The lower-case mid-sentence forms** (`msgctxt "resource, mid-sentence"`) are lower-cased:
`кирпич`, `овца`, `пшеница`, `руда`, `дерево`, `золото`, `бумага`, `ткань`, `монета`.

---

## 5. Islands expansion

| English | `ru` | Note |
|---|---|---|
| Islands | **Острова** | Expansion title (§2.2) |
| ship | корабль | |
| sea edge | морское ребро | |
| gold hex | золотой гекс | |
| pirate | пират | |
| island bonus / island discovery | очки за острова | One label everywhere |
| exploration points | очки за исследование | |
| Longest Trade Route | Самый длинный торговый путь | |

---

## 6. Scenario expansions

Scenario titles are faithful renderings of our own English titles.

| English | `ru` | Note |
|---|---|---|
| Scenarios | Сценарии | |
| Fishermen | **Рыбаки** | |
| fishing ground | рыбное место | |
| fish tile | рыбный жетон | |
| old boot | старый сапог | |
| Caravans | **Караваны** | |
| oasis | оазис | |
| camel | верблюд | |
| caravan | караван | |
| voting round | раунд голосования | |
| bid nothing (on timeout) | пустая ставка | `сервер сделает за вас пустую ставку` |
| Harbormaster (scenario, card) | **Начальник порта** | «Начальника порта» in the log's accusative |
| harbour points | портовые очки | |
| harbour settlement | портовое поселение | |
| Rivers | **Реки** | |
| coin(s) (Rivers purse) | монета / монеты / монет | Same word as the Knights commodity; the source says "coins" for both |
| bridge / bridge site | мост / место для моста | `место для моста` also for a bridge *crossing* |
| swamp | болото | |
| ford (a river) | переходить вброд | |
| Wealthiest / Poorest Settler | «Богатейший поселенец» / «Беднейший поселенец» | |
| Raiders | **Налётчики** | raider = налётчик, animate, accusative plural = genitive plural |
| rider | всадник | Animate, like рыцарь |
| castle | замок | |
| prisoner | пленник | |
| conquered | захваченный | |
| landing | высадка | |
| Muster / Swift Rider / Treason / Intrigue | «Сбор» / «Быстрый всадник» / «Измена» / «Интрига» | Intrigue coincides with the Politics card title, as the English does |
| path (a board edge) | **ребро** | As "edge" elsewhere; `путь` stays the Longest Road chain |
| Wagons | **Повозки** | wagon = повозка |
| plaza / spoke | площадь / спица | |
| trade hex | торговый гекс | |
| quarry / glassworks | каменоломня / стекольная мастерская | |
| marble / glass / tools / sand | мрамор / стекло / инструменты / песок | |
| cargo, load | груз | Also the Wagons VP label |
| toll | пошлина | |
| Swift Journey | «Быстрая поездка» | |
| Wagons barbarian place | между гексами {a} и {b} / у гекса {a} / на побережье | Labels stay nominative, in apposition |
| Explorers | **Исследователи** | |
| home island / home waters | родной остров / родные воды | |
| settler / crew | поселенец / экипаж | |
| fish haul / spice sack | улов / мешок специй | |
| spice farm / spice village | плантация специй / деревня специй | |
| Fast Gold / Pirate Bonus / Swift Voyage | «Быстрое золото» / «Пиратская премия» / «Быстрое плавание» | |
| gold field (Explorers) | **золотой прииск** | Not `золотое поле`: `поле` is the board. Distinct from the Islands `золотой гекс` |
| shoal | отмель | |
| pirate lair | пиратское логово | |
| Council | Совет | |
| hold / basin | трюм / док | |
| tribute | дань | |
| Movement / Action / Production phase | фаза движения / действий / производства | |
| movement (counted) | очки движения | `3 очка движения`, never `3 движения` |
| mission / track / bonus tile | миссия / шкала / бонусный жетон | |
| a module that "plays alone" | не сочетается с другими дополнениями | Not `в одиночку` |

---

## 7. Knights expansion

| English | `ru` | Note |
|---|---|---|
| Knights | **Рыцари** | Expansion title (§2.2) |
| commodity | товар | |
| city improvement | улучшение города | |
| improvement track | ветка улучшений | |
| metropolis | метрополия | |
| city wall | городская стена | |
| barbarians / barbarian fleet | варвары / флот варваров | |
| event die | кубик событий | |
| activate a knight | активировать рыцаря | |
| promote a knight | повысить рыцаря | |
| displace a knight | вытеснить рыцаря | Distinct from `переместить` (move) and `убрать` (remove) |
| chase the robber | прогнать разбойника | |
| Defender of the Realm | **Защитник страны** | "Realm" has no settled Russian here; `державы` is grander, but this game has no empire in it and `страны` is the neutral read. The token alone is `Защитник` |
| Aqueduct | Акведук | |
| Fortress | Крепость | |
| Merchant Guild | Гильдия купцов | |
| Trade / Politics / Science | Торговля / Политика / Наука | Track headings and deck names alike |

**English senses that Russian splits:**

- **"upgrade" / "promote" / "improve"** are three distinct mechanics with three distinct
  verbs: `улучшить (поселение до города)` for a settlement→city upgrade, `повысить (рыцаря)`
  for a knight promotion, `поднять (ветку)` / `улучшить (город)` for a city improvement. The
  source's `msgctxt` values already name these senses.
- **"draw"** is `взять (карту)` for taking a card and `ничья` for a level game.
- **"play"** is `разыграть (карту)` for a card and `играть` for playing the game.
- **"trade"** is `обмен` (the noun, both bank and player trades) and `обменять` / `менять`
  (the verb). `торговля` is reserved for the **Trade improvement track**, so the two never
  collide.
- **"build" a knight** is `построить`: a knight has no purchase step, so never `купить`.

---

## 8. The 30 card titles

From `art/cards/cards.json`. All 30 are set uppercase on the card art.

### Development deck (base game)

| English | `ru` | Chars | Note |
|---|---|---|---|
| Knight | Рыцарь | 6 | |
| Victory Point | Победное очко | 13 | |
| Road Building | Строительство дорог | 19 | Plural, because ours builds 2 (§2.3) |
| Year of Plenty | Год изобилия | 12 | |
| Monopoly | Монополия | 9 | |

### Trade deck

| English | `ru` | Chars | Note |
|---|---|---|---|
| Commercial Harbor | **Коммерческий порт** | 17 | English uses both "Commercial" and "Trade"; both map to `торговый`, so `Коммерческий` keeps it apart from `Торговый флот` and the Trade track. Follows `порт` (§3) |
| Master Merchant | **Главный купец** | 13 | No settled Russian; the plainest of `Старшина купцов` (15) and `Купец-мастер` (12) |
| Merchant | Купец | 5 | |
| Merchant Fleet | Торговый флот | 13 | |
| Resource Monopoly | Монополия на ресурсы | 20 | |
| Trade Monopoly | Торговая монополия | 18 | Translates the *title*, not the effect (it takes commodities) |

### Politics deck

| English | `ru` | Chars | Note |
|---|---|---|---|
| Bishop | Епископ | 7 | |
| Constitution | Конституция | 11 | |
| Deserter | Дезертир | 8 | |
| Diplomat | Дипломат | 8 | |
| Intrigue | Интрига | 7 | |
| Saboteur | **Диверсант** | 10 | `Саботажник` is the calque and reads as a loan; `Диверсант` is the ordinary Russian for what the card does |
| Spy | Шпион | 5 | |
| Warlord | Военачальник | 12 | The card activates all your knights, which is a commander's act |
| Wedding | Свадьба | 7 | |

### Science deck

| English | `ru` | Chars | Note |
|---|---|---|---|
| Alchemist | Алхимик | 7 | |
| Crane | **Кран** | 4 | `Кран` also means a tap; the Science deck context (beside `Инженер`, `Изобретатель`) and the rule text disambiguate. `Подъёмный кран` (14) is unambiguous but more than triple the length |
| Engineer | Инженер | 7 | |
| Inventor | Изобретатель | 12 | |
| Irrigation | Орошение | 8 | |
| Medicine | Медицина | 8 | |
| Mining | **Горное дело** | 11 | `Добыча руды` describes the effect rather than translating the title |
| Printer | **Типография** | 10 | The printing trade. `Принтер` is an office device; `Печатный станок` (15) is the press itself |
| Road Building | Строительство дорог | 19 | Same title as the development card, as in the source |
| Smith | Кузнец | 6 | |

The longest titles are `Монополия на ресурсы` (20), `Строительство дорог` (19),
`Торговая монополия` (18) and `Коммерческий порт` (17).

---

## 9. UI and system vocabulary

| English | `ru` | Note |
|---|---|---|
| Play (nav) | Играть | |
| Join / Take a seat | Присоединиться / Занять место | |
| Watch / Spectate | Смотреть | |
| Leave | Выйти | |
| Log out | Выйти из аккаунта | Bare `Выйти` collides with leaving a table |
| Home | Главная | |
| How to play | **Правила** | The page is the rules. `Как играть` is longer and promises a tutorial |
| Leaderboard | Таблица лидеров | |
| Store | Магазин | |
| Support (nav) / Support (page) | Поддержать / Поддержка | Verb in the nav, noun as the title |
| Supporter (role, tier, perks, the name decoration) | **Сторонник** | One word for the concept everywhere, declined in context: `цвет сторонников`, `бонусы сторонника`, `доступен только сторонникам`, `Вы наш сторонник`. The tier labels read `Сторонник (4,99 $/мес. в Discord)`. Never the Latin `Supporter`, and not `Спонсор`, `Подписчик` or a `поддерживающие` paraphrase. The verb `support` stays `поддержать` |
| Booster (Discord server booster, the name decoration) / boost the server | **Бустер** / буст, `бустите сервер` | The role and the decoration are `Бустер`; the act is `буст` (`розовая за буст`, `Буст сервера`) and the imperative `Бустите, чтобы открыть`. Not the Latin `Booster`. Unrelated: the Wagons movement boost is `ускорение` |
| Profile | Профиль | |
| Map builder | Редактор карт | |
| Settings | Настройки | |
| Lobby | Лобби | Indeclinable |
| Rematch | Реванш | |
| Ranked | Рейтинговая игра | |
| Rating | Рейтинг | |
| Draw (result) | Ничья | |
| Win / Loss | Победа / Поражение | |
| Host | Хозяин | |
| Bot | Бот | |
| Turn timer | Таймер хода | |
| Turn-timer presets (Relaxed / Normal / Blitz) | Спокойный / обычный / блиц | As in the manual sentence `Спокойный 120 с, обычный 60 с или блиц 30 с.`; capitalised as standalone control labels |
| Hand limit | Лимит карт на руке / Лимит руки | Long form in prose, short in labels |
| Discard limit | Лимит сброса | |
| Event log | Журнал событий | |
| Table chat | Чат стола | |
| Friendly robber | **Добрый разбойник** | The plainest reading of a mechanic that spares low scorers. `Мягкий` reads as a texture, `Щадящий` as bureaucratic |
| Privacy (legal page) | Конфиденциальность | |
| Terms of Service | Условия использования | |
| Connection lost / Reload | Связь потеряна / Перезагрузить | |
| Withdraw (a trade answer) | Отозвать | |
| Pips (currency) | **`Pips`**, untranslated | A product name, like `Costanio` |

---

## 10. Interface actions

Buttons take the infinitive; prompts take the imperative.

| English | Button (infinitive) | Prompt (imperative) |
|---|---|---|
| Build | Построить | Постройте |
| Buy | Купить | Купите |
| Trade | Обменять | Меняйтесь |
| Roll | Бросить кубики | Бросьте кубики |
| End turn | Завершить ход | |
| Play (a card) | Разыграть | Разыграйте |
| Take / Draw | Взять | Возьмите |
| Give | Отдать | Отдайте |
| Discard | Сбросить | Сбросьте |
| Steal | Украсть | Украдите |
| Move | Переместить | Переместите |
| Place | Поставить | Поставьте |
| Upgrade to city | Улучшить до города | |
| Promote | Повысить | Повысьте |
| Activate | Активировать | Активируйте |
| Accept / Reject / Decline | Принять / Отклонить / Отклонить | |
| Cancel / Confirm | Отмена / Подтвердить | |
| Save / Load / Delete | Сохранить / Загрузить / Удалить | |
| Surrender | Сдаться | |
| Offer a draw | Предложить ничью | |

---

## 11. Terms not translated

`Costanio` · `Discord` · `Google` · `Ko-fi` · `Activity` (Discord's own product) ·
`Pips` · `WebGL` · `JSON` · `ELO` ·
the company names in the non-affiliation disclaimer · `Beginner` / `Expanded` / `Grand`
(board presets, which are not in the catalogue; they reach a player only inside one
translated sentence of the map-issue copy).

**Blank entries.** An empty `msgstr` falls back to the English at runtime, which keeps
`catalog.test.ts`'s "a translation is never its own msgid" guard meaningful. Russian leaves
blank only pure placeholder frames (`{0}`, `{label}: {n}`, `{label}, {total}`,
`{staked} → {got}`, `{name}: {instruction}`, `log.produced`, `{ratio}:1 {resource}`,
`2:1 {resource}`, `{0} ({1} Pips)`, `{nextReward}. {nextCost}`) and the Latin product and
the Latin name `Pips`. `Supporter` and `Booster` are translated (`Сторонник`, `Бустер`, §9), in the tier labels and the decoration names as everywhere else. None of them may carry an ICU plural (§1.4).

---

## 12. Length and overflow

Russian runs roughly 10–30% longer than English in prose and considerably longer on short
labels, where it has no equivalent of an English monosyllable. The places to check first
when a layout changes:

| Where | English | `ru` | Chars |
|---|---|---|---|
| Scoreboard column | `Metro` | `Метроп.` | 5 → 7 |
| Scoreboard column | `Settle` | `Посел.` | 6 → 6 |
| Board action, short | `Activate` | `Актив.` | 8 → 6 |
| Knight-action card | `Activate` | `Активировать` | 8 → 12 |
| Turn pill, short | `End` | `Конец` | 3 → 5 |
| Footer link | `Privacy` | `Конфиденциальность` | 7 → 18 |
| Top nav | `Leaderboard` | `Таблица лидеров` | 11 → 15 |
| Top nav | `Log out` | `Выйти из аккаунта` | 7 → 17 |
| Badge | `Provisional rating` | `Предварительный рейтинг` | 18 → 23 |
| Queue pill | `Searching ranked` | `Поиск рейтинговой игры` | 16 → 22 |
| Stats row | `Longest trade route length` | `Длина самого длинного торгового пути` | 26 → 36 |
| Stats row | `Longest road length` | `Длина самой длинной дороги` | 19 → 26 |
| Stats row | `Progress played` | `Разыграно карт прогресса` | 15 → 24 |
| Stats row | `Dev cards held` | `Карт развития на руке` | 14 → 21 |
| Lobby setting | `Balanced number spread` | `Сбалансированное распределение чисел` | 22 → 36 |
| Map picker | `UK & Ireland` | `Великобритания и Ирландия` | 12 → 25 |

**Russian has no short forms for three words the UI abbreviates.** `метрополия`,
`поселение` and `активировать` have no idiomatic clipped forms, so the scoreboard and
board-action abbreviations are truncations with a period. The remedy for those is a wider
column, a smaller type step or an icon, not a different word.

---

## 13. The card-title face

Card titles are drawn by the runtime card-title layer (`lib/cardTitle.ts`) in a title face
that covers Cyrillic: `frontend/scripts/gen-title-fonts.py` builds a Cyrillic subset
(`vollkornsc-titles-cyrl.woff2`) from the characters the Cyrillic catalogues' titles use.
**If you change a Russian card title, re-run**
`uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py` **and commit
the regenerated font and `titleMetrics.json`**; the test suite does not catch a stale
subset. The rest of the UI uses system font stacks, which carry Cyrillic everywhere.

---

## 14. Checks

A Russian entry must keep, relative to `en`: ids, `msgctxt` and order; the multiset of
`{name}` parameters; the rich-text tag multiset; and every ICU wrapper, with all four plural
arms (§1.4). A rich-text tag wraps a whole phrase and never opens or closes on a space. No
live `msgstr` may equal its `msgid`. `scripts/po_verify.py ru` checks the mechanical part;
plural-arm correctness (§1.4) is not mechanically checked and has to be right by
construction.
