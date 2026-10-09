# Turkish (`tr`) terminology glossary

The terminology, register and grammar conventions the Turkish catalogue
(`frontend/src/locales/tr/messages.po`) follows. The catalogue is written against this
document and is consistent with it, so changing a term here means changing every entry
that uses it.

Turkish carries three structural risks:

1. **Casing is locale-dependent** (`i`→`İ`, `I`→`ı`). §11 covers how the catalogue and
   the app handle it.
2. **Agglutination.** Turkish attaches case, possession and number as suffixes whose vowels
   harmonise with the stem. A noun interpolated into a frame cannot be given the suffix the
   frame wants, because the stem only arrives at runtime. §10 covers every frame where this
   bites.
3. **Length, in both directions.** Turkish is *shorter* than English on many verb phrases
   (one suffixed word for "if you had built it") and much *longer* on some noun compounds.
   §12 lists the containers that cannot grow.

---

## 1. Register decisions

Global, and they hold across every string.

### Formality: **sen** (informal second person), everywhere

**The `-sın/-sin/-sun/-sün` and `-(y)ın` second-person-singular endings, the imperative
bare stem for buttons (`Kur`, `Katıl`, `At`), `senin` for possession.**

The English source is chatty and informal ("You can't afford that", "Nice one",
"You're up"). Turkish web products aimed at a general audience are overwhelmingly `sen`;
`siz` would read as a bank or a government portal.

- **Buttons** use the imperative (`Oyun kur`), not the verbal noun (`Oyun kurma`), because
  the English is imperative.
- **Confirm-dialog titles** use the impersonal passive (`Bu harita silinsin mi?`,
  `Teslim olunsun mu?`), which is Turkish UI convention.
- **The legal-page titles** are plain noun phrases with no person at all: `Kullanım
  Koşulları`, `Gizlilik Politikası`. The page bodies stay in English.

### Voice: verbal, not nominal

Turkish UI copy often turns every button into a noun (`Kaydetme`, `Silme`). The source is
verbal and direct, so the catalogue is too: `Kaydet`, `Sil`, `Zar at`, `Sırayı bitir`.

### Punctuation

Turkish uses the same ASCII punctuation as English. The catalogue contains no em dashes: a
colon or a comma does the job. Quotation marks are `"…"` (ASCII double) as in ordinary web
copy; the doubled-angle `«…»` is literary and is not used. Thousands separator is `.` and
the decimal separator is `,` (`4,99 $`, `10.000`), though `Intl` formats most numbers.
Ordinals are written `1.`, `2.` with a full stop.

---

## 2. Naming policy

### 2.0 The rule

> Translate our English faithfully. Only the game title and the expansion names diverge.

Our English already uses `Master Merchant`, `Bishop`, `Warlord`, `Longest Road`,
`Year of Plenty`. Those are descriptive phrases, not marks. The Turkish for them is
whatever the ordinary Turkish for those phrases is. Where that lands on a common Turkish
term, that is a coincidence forced by the language. Ordinary nouns are not substituted
for game terms to look "different".

### 2.1 Coincidence

The test per term: **could a translator arrive here from our English alone?** If yes, a
match is a coincidence and the term stays.

- `Şövalye` for *Knight*, `Tuğla` for *Brick*, `Buğday` for *Wheat*, `Koyun` for *Sheep*,
  `Liman` for *Harbor*, `Banka` for *Bank*, `Zar` for *Dice*, `Piskopos` for *Bishop*,
  `Casus` for *Spy*, `Diplomat`, `Mühendis`, `Simyacı`, `Mucit`, `Anayasa`, `Matbaa`:
  these are the only ordinary Turkish word for the concept.
- `En Uzun Yol` (*Longest Road*) and `En Büyük Ordu` (*Largest Army*): superlative +
  noun, the one grammatical shape Turkish has for this.
- `Bereket Yılı` (*Year of Plenty*): `bereket` is the standard Turkish word for
  agricultural plenty.
- Other forced matches: `yol`, `şehir`, `gemi`, `liman`, `banka`, `tuğla`, `buğday`, `zar`,
  `şövalye`, `barbar`, `metropol`, `sur`, `piskopos`, `casus`, `diplomat`, `düğün`,
  `tekel`, `su kemeri`, `ticaret / siyaset / bilim`.
- **Two resource words follow our English literally, on purpose.** Our card says **Sheep**,
  so Turkish says **`Koyun`**, not `yün` (wool). Our card says **Ore**, so Turkish says
  **`Maden`**, not `demir` (iron).

**What diverges:**

| Ours | Turkish |
|---|---|
| the game's title | `costan`, untranslated and uninflected |
| Islands | **Adalar** |
| Knights | **Şövalyeler** |
| Fishermen | **Balıkçılar** |
| Caravans | **Kervanlar** |
| Rivers | **Nehirler** |
| Raiders | **Yağmacılar** |
| Wagons | **Yük Arabaları** |
| Explorers | **Kâşifler** |
| Harbormaster | **Liman Reisi** |

These render *our* English words; see §20 for the reasoning on the later five.

---

## 3. Core game nouns

| English | Turkish | Rationale |
|---|---|---|
| settlement | **yerleşim** | The fuller form is `yerleşim yeri`; the head noun is dropped because the layout is tight. `yerleşke` is a campus/compound; `köy` (village) is a downgrade the English does not make. |
| city | **şehir** | `kent` is the equally correct synonym; `şehir` is more common in games. |
| road | **yol** | Exact and short; appears in `En Uzun Yol` and in dozens of buttons. |
| ship | **gemi** | |
| route (Islands: road+ship chain) | **güzergâh** | Different from `yol`, because the game distinguishes `Longest Road` from `Longest Trade Route`; `yol` for both would destroy a distinction the rules depend on. |
| robber | **haydut** | Brigand/highwayman, matching the figure the art draws. `hırsız` (thief) makes the game's commonest sentence a tautology (`hırsız çalar`). Final `t` voices before a vowel-initial suffix: `haydudu`, `haydudun`. |
| pirate | **korsan** | |
| harbor / port | **liman** | |
| hex / tile | **altıgen** (hex), **karo** (tile, generically) | The board is hexes; the map builder speaks of tiles. Keep them distinct as the English does. |
| edge (incl. *path* meaning a board edge) | **kenar** | Never `patika` or `yol`. |
| vertex / intersection / junction | **köşe** | "Corner". `kavşak` (junction) is for roads and reads oddly on a lattice. |
| camel junction (Caravans) | **deve köşesi** | Uses the same `köşe` as every other junction. |
| landmass / island | **kara parçası** / **ada** | |
| bank | **banka** | |
| supply (commodity supply) | **stok** | Distinct from `banka`, as the English distinguishes bank from supply. |
| deck | **deste** | |
| hand | **el** | Standard card-game term. |
| turn | **sıra** when possessed or subject; **tur** in bare adverbials | `Sıranı bitir`, `kendi sıranda`, `bu sıranın kalanında`, but `bu tur` / `bu turda`, `inşa edildiği turda`: `o sırada` / `bu sırada` mean "at that moment" and bare `bu sıra` reads as "these days". "Once / twice per turn" is `sıra başına bir kez` / `iki kez`. |
| round | **tur** | Shares a word with the adverbial *turn* above; that is the cost of the split. |
| token (Defender, Merchant) | **nişan** | |
| number token / chit | **sayı pulu** | Distinct from `nişan`. |
| island exploration chip | **fiş** | Distinct from both, matching the English's own three words (token / chit / chip). |
| board (the generated board) | **tahta** | A map (`harita`) is what you pick before the game; the board is what it generates. |
| active player | **sırası gelen oyuncu** | `Sıradaki oyuncu` reads as *the next player*. |
| leaderboard | **Sıralama** | The leaderboard (a route) and the end-of-game standings (`Nihai sıralama`) never share a screen. |
| ranked / casual | **dereceli** / **gündelik** | Ranked always with a head noun (`Dereceli oyun aranıyor`). |
| rating (Elo) | **puan** | `Puan` in the column header, `Geçici puan` for provisional. `derece` is unavailable because `Dereceli` is *ranked*. |
| dice / die | **zar** | Turkish does not distinguish singular/plural here in ordinary use. |
| roll (the dice) | **zar atmak** | |
| trade (with a player or the bank) | **takas** | The act of exchanging: `Banka takasları`, `Oyuncu takasları`, the `Takas` chapter. |
| trade (commerce, the improvement track) | **Ticaret** | Reserved for the Knights track and `En Uzun Ticaret Güzergâhı`. |
| trade-off | **tercih** | `takas` is a trade. |
| build | **inşa etmek** / button `İnşa et` | Note the capital `İ`. Also for raising a knight: `şövalye inşa etmek`, not `kurmak`. |
| upgrade (settlement → city) | **şehre geliştirmek** | |
| buy | **satın almak** / button `Satın al` | |
| discard | **kart atmak** / `At` | |
| steal | **çalmak** | |
| victory point (VP) | **zafer puanı**, abbreviated **ZP** | `ZP` in tight columns; `zafer puanı` in full wherever there is room, so the abbreviation is always glossed nearby. |
| development card | **gelişim kartı** | |
| progress card | **ilerleme kartı** | A different word from `gelişim`, because the game has both decks. |
| host (of a table) | **Host** | Kept in English (§13). |
| replay | **tekrar kaydı** | `tekrar kaydında`, never bare `tekrar`. |
| turn timer | **sıra zamanlayıcısı** | The same phrase in the settings table and the Clocks chapter, which links to it. |
| clocks (chapter) | **Saatler** | |
| forfeit | **terk** | `geri çekilmek` is the verb for a displaced knight retreating. |
| draw (a tied game) | **beraberlik** | `Beraberlik teklif et`, `Beraberliği kabul et`; the predicate `Berabere` on the end screen. |
| surrender | **Teslim ol** | The log line is `{player} teslim oldu`, the dialog `Teslim olunsun mu?`. |
| equip / equipped / unequip | **Kuşan** / **Kuşanılı** / **Çıkar** | One root for the whole set. |
| cosmetic / name decoration | **kozmetik** / **süs**, **süsleme** | The class and the item type, kept apart as the English keeps them apart. |
| free | **ücretsiz** (no money) / **bedava** (no resource cost) | `Costanio ücretsiz`, the `Free` price badge, `Ücretsiz renkler`; but `bedava yollar`, `bedava şehir suru`, `bedava terfi`, and the `Free` build badge. |
| sync | **eşitle** | `Rolleri eşitle` |
| boost (Discord) | **boost** | The community loan (`Açmak için boost ver`). |
| withdraw your answer / your offer | **Geri al** / **Geri çek** | Two different acts on the trade card. |
| connection lost | **Bağlantı koptu** | |
| inactive (knight) | **etkin değil** / **etkin olmayan** | `etkisiz` means ineffective. |
| enemy knight | **düşman şövalye** | |
| stand down (knight) | **devre dışı kalmak** | |
| map names (gallery) | Turkish exonyms | `Çin`, `Japonya`, `Amerika Birleşik Devletleri`, `Birleşik Krallık ve İrlanda` |

**Vowel harmony note.** `yerleşim`, `şehir`, `yol`, `gemi`, `zar`, `köşe` take different
suffix vowels (`yerleşimi`, `şehri`, `yolu`, `gemiyi`, `zarı`, `köşeyi`) and `şehir`
additionally **drops its second vowel** under a vowel-initial suffix (`şehri`, not
`şehiri`). This is why no catalogue string suffixes an interpolated noun; see §10.

---

## 4. Terrains

The exact `terrain.*` message ids, in the singular form the catalogue ships. The terrain
that produces brick is **Clay** in English while the *resource* is **Brick**, and Turkish
keeps the same split: `Kil` for the hex, `Tuğla` for the card.

| English (`terrain.*`) | Turkish |
|---|---|
| Forest (`wood`) | **Orman** |
| Clay (`brick`) | **Kil** |
| Pasture (`sheep`) | **Otlak** |
| Field (`wheat`) | **Tarla** |
| Mountain (`ore`) | **Dağ** (named for the landform, not for `Maden`, as in English) |
| Desert (`none`) | **Çöl** |
| Sea (`sea`) | **Deniz** |
| Lake (`lake`) | **Göl** |
| Land (`land`) | **Kara** |
| Gold (`gold`) | **Altın** |
| Border (`border`) | **Sınır** |
| Fog / unexplored (`fog`) | **Sis** |

---

## 5. Resources

| English | Turkish | Rationale |
|---|---|---|
| Wood | **Odun** | Raw timber, matching the card art's raw log. `Kereste` is sawn lumber. |
| Brick | **Tuğla** | |
| Sheep | **Koyun** | The English card says the animal, not the wool. |
| Wheat | **Buğday** | |
| Ore | **Maden** | What a player says; `Cevher` reads geological. Not `demir` (iron). |
| Gold (the wildcard) | **Altın** | |

---

## 6. Commodities (Knights)

| English | Turkish | Rationale |
|---|---|---|
| Coin | **Sikke** | The minted-coin sense, keeping `para` free for money in general. `madeni para` is 11 characters in a column with room for about 5. |
| Paper | **Kâğıt** | With the circumflex, standard orthography for this word. |
| Cloth | **Kumaş** | |
| commodity (the class) | **emtia** | The economic term, distinct from `kaynak` (resource), as the English distinguishes them. `ticaret malı` is twice as long. |
| resource (the class) | **kaynak** | |
| good (either class) | **mal** | |

Payment headings use the instrumental: `sikke ile ödenir`, `kâğıtla ödenir`, `kumaşla
ödenir`.

---

## 7. Numbers, plurals and counting

- **Turkish has two CLDR plural categories** (`one` for exactly 1, `other`). Every ICU
  `plural` in the catalogue keeps both arms, because the runtime addresses them by name.
- **Both arms usually carry the identical noun form,** because Turkish drops the plural
  suffix after a numeral: `3 kart`, never `3 kartlar`. `{n, plural, one {# kart} other
  {# kart}}` is correct Turkish and is not an unfinished entry. Where the two arms *do*
  differ, it is because the surrounding verb or a bare reading changes, not the noun (for
  example `hepsi`, "all of them", reads oddly of a single card, so `You have picked all 1
  card` drops it in the `one` arm).
- `resource.count.*` and `card.bankLeft.*` write the noun into the message, with the count
  as an ICU argument inside it. Nothing is interpolated.
- **Ordinals** (`1st`, `2nd`) are written `1.`, `2.` with a full stop.
- **`goodCount()`'s `Odun ×2` form needs no change:** `×n` is a suffix on the card, not a
  number governing a noun.
- Where English uses the article "a" for one card (`card.give.*`, `card.take.*`), Turkish
  may use the numeral `1`.
- Countable nouns are preferred where the English counts: `3 tayfa` (crew), not the
  collective `mürettebat`.

---

## 8. The card titles

Every title is the ordinary Turkish for our English phrase, in title case.

### Development deck

| English | Turkish | Note |
|---|---|---|
| Knight | **Şövalye** | |
| Victory Point | **Zafer Puanı** | |
| Road Building | **Yol Yapımı** | "Road construction". `Yol İnşası` is the synonym. |
| Year of Plenty | **Bereket Yılı** | `Bolluk Yılı` is the equally good alternative; `bereket` carries the harvest sense the art has. |
| Monopoly | **Tekel** | The Turkish economic term. |

### Trade deck

| English | Turkish | Note |
|---|---|---|
| Commercial Harbor | **Ticaret Limanı** | |
| Master Merchant | **Usta Tüccar** | `usta` is master-of-a-craft, which fits the guild flavour; `Baş Tüccar` (chief) is the alternative. |
| Merchant | **Tüccar** | |
| Merchant Fleet | **Tüccar Filosu** | |
| Resource Monopoly | **Kaynak Tekeli** | Possessive `-i` on fixed text, so safe. |
| Trade Monopoly | **Ticaret Tekeli** | |

### Politics deck

| English | Turkish | Note |
|---|---|---|
| Bishop | **Piskopos** | |
| Constitution | **Anayasa** | |
| Deserter | **Asker Kaçağı** | Literally "army runaway", the standard term. `Firari` is shorter but reads as "fugitive". |
| Diplomat | **Diplomat** | |
| Intrigue | **Entrika** | |
| Saboteur | **Sabotajcı** | Loan + agentive suffix. `Baltalayıcı` reads archaic. |
| Spy | **Casus** | |
| Warlord | **Savaş Ağası** | The established Turkish for "warlord". |
| Wedding | **Düğün** | The feast. `Nikâh` is the legal act. |

### Science deck

| English | Turkish | Note |
|---|---|---|
| Alchemist | **Simyacı** | |
| Crane | **Vinç** | The machine, unambiguous in Turkish. |
| Engineer | **Mühendis** | |
| Inventor | **Mucit** | |
| Irrigation | **Sulama** | |
| Medicine | **Tıp** | The discipline. `İlaç` would be the drug. |
| Mining | **Madencilik** | |
| Printer | **Matbaa** | The printing house, which is what the art shows. `Matbaacı` would be the person. |
| Road Building (science) | **Yol Yapımı** | Same English, same Turkish, two decks. |
| Smith | **Demirci** | |

---

## 9. Knights-expansion vocabulary

| English | Turkish |
|---|---|
| knight (the piece) | **şövalye** |
| strength N knight | **Güç N şövalye** (`Güç 3 şövalyeler`); `güç` for knight strength, `seviye` for improvement level, as the English splits them |
| activate (a knight) | **etkinleştirmek** |
| promote (a knight) | **terfi ettirmek** |
| upgrade (a city improvement) | **geliştirmek** |
| advance (the barbarian track) | **ilerlemek** |
| city wall | **şehir suru** |
| metropolis | **metropol** |
| barbarian | **barbar** |
| barbarian attack | **barbar saldırısı** |
| aqueduct | **su kemeri** |
| improvement (city improvement) | **gelişme** |
| improvement track | **dal** (`gelişme dalı`, `üç dalda ilerler`) |
| Trade / Politics / Science improvements | **Ticaret / Siyaset / Bilim** |
| Defender of the Realm | **Diyarın Savunucusu** |
| Merchant Guild | **Tüccar Loncası** |
| Fortress | **Kale** |
| pillage | **yağmalamak** |
| event die | **olay zarı** |
| Action (phase) | **Eylem** |

Activate, promote and upgrade are three mechanics and take three verbs; the `msgctxt` on
the ambiguous entries names the sense. In rich text, keep the head noun inside the tag:
`<1>Savunucu nişanı</1>`, `<1>Tüccar nişanı</1>`.

---

## 10. Agglutination, and every frame it bites

Turkish attaches case to the noun. A frame that says `for {name}` needs `{name} için` (a
postposition taking the bare nominative, which is safe), but a frame that says `to {name}`
needs `{name}'e` or `{name}'a` **chosen by the last vowel of a word that only exists at
runtime**. Turkish also inserts a buffer consonant (`-y-`) after a vowel and voices a final
stop (`kitap` → `kitabı`). None of this is decidable in a catalogue.

The source avoids governed holes by writing one message per value (`lib/cardPhrases.ts`,
`short.needOneMore.*`, `harbor.receive.*`, `error.NO_PIECES.*`, `board.metropolis.*`,
`track.deckEmpty.*`, `track.draw.*`, the map-eligibility messages). The frames that still
interpolate a noun are safe in Turkish by construction:

| Message | Why it is safe |
|---|---|
| `{name}: nothing on the board is a legal target right now.` | colon frame, nominative |
| `{name} has to be played before you roll.` / `{name} is never played.` | nominative subject, no suffix |
| `{ratio}:1 {resource}`, `2:1 {resource}` | a label, bare nominative |
| `Expansion: {name}`, `event: {name}`, `{name}: {instruction}` | colon frames |

`{rate}` is never a bare number: `portLabel()` returns `2:1 tuğla` or `3:1 herhangi`, so an
attributive genitive frame is well formed for every value.

**Player names are never suffixed anywhere in this catalogue.** Turkish would need an
apostrophe plus a harmonised case suffix on a proper noun (`Ayşe'ye`, `Burak'a`,
`Deniz'e`), and the vowel is unknowable. Every message that would have wanted one is
written into a colon or a postposition frame instead (`Sıra: {name}`, `{name} için`,
`{name} kazandı`). This is the most important structural rule in the Turkish catalogue.

**`camel.bid.less` / `camel.bid.more`** (`Bid one less {name}`): `{name}` arrives
capitalised and in its citation form (`Koyun`, `Buğday`), so it goes after a colon rather
than into the verb phrase: `Bir eksik teklif et: {name}`.

---

## 11. Casing

Turkish has two `i`s. `i` uppercases to `İ` (dotted) and `I` lowercases to `ı` (dotless).
`İSKELE` and `ISKELE` are different words to a reader.

**Write every msgstr in normal case.** Headings and labels drawn in capitals get their caps
from CSS: `text-transform: uppercase` is locale-sensitive, and the app sets `lang` on the
document from the active locale (`applyDocumentLocale()` in `src/lib/i18n.ts`), so under
`lang="tr"` the browser folds `Liman` to `LİMAN` and `Sayı` to `SAYI`. A hand-typed
capital string gets this wrong. Map-builder headings, for
example, are `Boyut`, `Kaynak`, `Sayı`, `Liman`; manual headings `Bölümler`, `Kod paylaş`,
`Haritaların`, `Sorunlar`, `Karolar`.

For developers: JavaScript's `toUpperCase()` / `toLowerCase()` are locale-invariant by
specification. They are correct on ASCII wire identifiers and wrong on translated or
player-entered Turkish text, which needs `toLocaleUpperCase` / `toLocaleLowerCase` with the
reader's locale. Lobby search folds both sides that way. The chat trade-token parser
(`lib/chatTokens.ts`) still folds locale-invariantly, which is right while its word lists
are English input vocabulary and would need changing before Turkish trade slang is added.

---

## 12. Length and overflow

Turkish **verb phrases shrink** and Turkish **noun compounds grow**. Most containers are
auto-width (the post-game scoreboard columns widen rather than clip), so the risk lives in
the fixed-width columns and a few HUD pills:

| Message | English | Turkish | Container |
|---|---|---|---|
| `Win %` | 5 | `Gal. %` (6) | `Leaderboard.tsx`: `w-16` (64px), uppercase, no truncate. `Galibiyet %` does not fit. |
| `Win` | 3 | `Galibiyet` (9) | `MatchHistory.tsx`: a `shrink-0` pill; widens its row. |
| `Counter` | 7 | `Karşı teklif` (12) | trade button, `flex-1`; widens on a narrow viewport. |
| `Discard` | 7 | `Atılacak kart` (13) | HUD label in a `shrink-0` column. |
| `Unlink` | 6 | `Bağlantıyı kaldır` (17) | small button in a `shrink-0` row. |
| `Searching ranked` | 16 | `Dereceli oyun aranıyor` (22) | `RankedQueueToast`, 200px available; fits on one line. |
| `Longest Trade Route` | 19 | `En Uzun Ticaret Güzergâhı` (25) | drawn only in a tooltip as a badge label; long in prose and the log. |

`Host` stays English partly for length: `Ev sahibi` is 10 characters where the lobby has
room for about 4.

---

## 13. Things left in English

- **`costan`**: the product name.
- **`Booster`, `Brigand`, `Hourglass`, `Driftwood Set`** and the colour names: brand
  flavour shipped by the backend, untranslated in every locale.
- **`Host`**: kept as the loan Turkish gamers use. `Kurucu` is the alternative; switching
  means filling the two blank `Host` entries (§14) in the same edit.
- **`Elo`, `JSON`, `Discord`, `Google`**: proper nouns and formats.

---

## 14. Blank entries

An empty `msgstr` falls back to the English at runtime. A blank is used only where the
faithful Turkish is byte-identical to the msgid, which `catalog.test.ts` forbids as a
msgstr; each carries a comment naming its reason.

| msgctxt | msgid | why blank |
|---|---|---|
| | `{0}` | bare placeholder |
| | `{0} ({1} Pips)` | placeholders plus the product token `Pips` |
| | `{label}, {total}`, `{label}: {n}` | placeholders and punctuation only |
| progress card board prompt | `{name}: {instruction}` | placeholders and punctuation only |
| | `{nextReward}. {nextCost}` | two placeholders run together with a period |
| | `log.produced` (`{player} <0/>`) | a placeholder plus a tag, no words |
| | `{ratio}:1 {resource}`, `2:1 {resource}`, `{resource} {num}` | labels Turkish writes identically |
| | `{staked} → {got}`, `+2` | placeholders, numbers and an arrow |
| name decoration … booster | `Booster` | platform label, English in every locale |
| | `Beta`, `Bot`, `Pips` | the Turkish is the same word |
| progress card | `Diplomat` | the Turkish for Diplomat is Diplomat |
| turn timer preset | `Blitz`, `Normal` | identical in Turkish; the third preset, `Relaxed`, is `Rahat` |
| the player who owns the table | `Host`, `Host: {host}` | `Host` is kept in English (§13) |

**Never fill an ICU-plural entry with a single arm.** Turkish selects `one` and `other`, and
`catalog.test.ts` enforces both.

---

## 20. Scenario expansions

### Expansion names

| English | Turkish | Alternative | Why |
|---|---|---|---|
| Rivers | **Nehirler** | `Irmaklar` | `nehir` is the everyday word; `ırmak` is literary. |
| Raiders | **Yağmacılar** | `Akıncılar` | `akıncı` is an Ottoman frontier raider and carries history the game does not mean. `yağmacı` shares a root with `yağmalamak` (Knights *pillage*). |
| Wagons | **Yük Arabaları** | `Arabalar`, `Kağnılar` | bare `araba` is a car today; `kağnı` is an ox cart the art does not draw. |
| Explorers | **Kâşifler** | `Keşifçiler` | standard word, with the circumflex. |
| Harbormaster | **Liman Reisi** (expansion and card) | `Liman Başkanı` | `reis` is the maritime captain; `başkan` reads as a port-authority official or a mayor. |

### Key nouns

| English | Turkish | Note |
|---|---|---|
| raider (neutral enemy figure on a hex) | **yağmacı** | Must never meet `atlı`. |
| rider (the player's own figure on a path) | **atlı** | `süvari` is a cavalry arm, not one figure. Unlike the English pair, the two Turkish words share nothing. |
| path (the edge a rider, wagon or barbarian uses) | **kenar** | Not `yol`, which is the road piece. |
| castle (Raiders, Wagons) | **hisar** | `kale` is already the Knights *Fortress*; `şato` reads French. |
| coin (Rivers) | **sikke** | Same word as the Knights coin commodity, because the English uses one word. |
| gold (Raiders, Wagons, Explorers side currency) | **altın** | Same as the Islands gold terrain, as in English. |
| wagon | **yük arabası** | Possessed forms: `yük araban`, `yük arabanı`. |
| cargo / load | **yük** | Distinct from Knights `emtia`, as the English distinguishes cargo from commodity. |
| toll | **geçiş ücreti** | |
| circuit (Wagons) | **tur** / **teslimat turu** | never `döngü` or `yol` |
| trade hex / plaza / spoke | **ticaret altıgeni** / **meydan** / **kol** | `kol` matches the Caravans `vaha kolu`. |
| castle / quarry / glassworks (Wagons trade hexes) | **Hisar** / **Taş Ocağı** / **Camhane** | lower case in running text |
| marble / glass / tools / sand | **mermer** / **cam** / **alet** / **kum** | |
| movement points | **hareket puanı** | |
| Swift Journey (Wagons card) | **Hızlı Yolculuk** | |
| Muster / Treason / Intrigue / Swift Rider (Raiders cards) | **Seferberlik** / **İhanet** / **Entrika** / **Hızlı Atlı** | `Entrika` is the existing Politics card title, as the English reuses *Intrigue*. The verb *muster a rider* stays plain: `bir atlı topladı`. |
| prisoner | **esir** | |
| conquer / conquered / liberated | **fethetmek** / **fethedilmiş** / **kurtarılmış** | `ele geçirmek` only for *capture* (lairs, gold fields) |
| landing (raiders coming ashore) | **çıkarma** | |
| bridge / bridge site / ford | **köprü** / **köprü yeri** / **sığdan geçmek** (`sığlık`) | In running text the locative `köprü yerinde`; the dative `köprü yerine` also reads "instead of a bridge". |
| a bridge / river edge pays coins | **kazandırır** / **getirir** | bare `öder` reads as the player paying |
| swamp (river mouth tile) | **Bataklık** | |
| river source hex / river mouth | **nehrin doğduğu altıgen** / **nehir ağzı** | `kaynak` is resource |
| Wealthiest Settler / Poorest Settler | **En Zengin Yerleşimci** / **En Yoksul Yerleşimci** | tile = `pul`; the pair = `zenginlik pulları` |
| settler (Explorers piece) | **yerleşimci** | Same word as the wealth tiles, as in English. |
| crew | **tayfa** | Countable (`3 tayfa`); `mürettebat` is collective. |
| fish haul | **balık yükü** | A load a ship carries; `balık avı` also means the activity. |
| fish tile (Fishermen) | **balık pulu** | |
| fish shoal | **balık sürüsü** | bare `sürü` only where space forbids |
| spice sack / spice farm / spice village | **baharat çuvalı** / **baharat çiftliği** / **baharat köyü** | |
| pirate lair | **korsan ini** | |
| gold field | **altın yatağı** | `Tarla` is the wheat terrain. |
| harbour settlement (Explorers building) | **liman yerleşimi** | Not a port, as the manual itself says. |
| the Council / Council anchor | **Konsey** / **Konsey demir yeri** | |
| Fast Gold / Swift Voyage / Pirate Bonus | **Hızlı Altın** / **Hızlı Sefer** / **Korsan Bonusu** | |
| hold / basin | **ambar** / **havza** | |
| tribute | **haraç** | |
| home island / home waters / fog | **ana ada** / **ana sular** / **sis** | |
| mission / track | **görev** / **çizelge** | `çizelge` also for the wagon track. |
| Explorers track space | **basamak** | ship movement stays `yer` |
| phases: Production / Action / Movement | **Üretim** / **Eylem** / **Hareket** | `Eylem` matches the Knights `Eylem`. |
| harbour points (Harbormaster) | **liman puanı** | |
| procedurally generated | **yordamsal olarak üretilen** | |
| curated map | **seçme harita** | |
| map builder: Generate / Preview / Brush / Canvas / tile | **Üret** / **Önizle(me)** / **Fırça** / **Tuval** / **karo** | |
