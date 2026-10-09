# Vietnamese (`vi`) terminology glossary

The terminology, register and grammar conventions that `frontend/src/locales/vi/messages.po`
follows. The catalogue is written against this document and is internally consistent with
it, so changing a term here means a find-and-replace over the `.po`. Section numbers are
stable; references such as "§1 item 8" point into §1 below.

Vietnamese is an analytic language: no grammatical gender, no case inflection, and one
plural category. Those properties remove whole classes of problem the inflecting locales
have, and they shape several decisions below.

---

## 1. Key decisions

**1. The register: `bạn`, and nominal verb phrases on buttons.**
The catalogue addresses the player as **`bạn`** (peer, informal-neutral) throughout:
`Lượt của bạn`, `Bạn không có tài nguyên cho việc đó`, `Hãy tung xúc xắc trước`. Buttons
and column headers take the **verb phrase** (`Kết thúc lượt`, `Xây khu định cư`, `Đấu lại`),
not a bare imperative and not a deverbal noun.

*Why.* `bạn` is the only second-person pronoun that works with a stranger of unknown age
in Vietnamese software, which is the situation here; every alternative (`anh/chị`,
`em`, `cậu`) picks an age and a relationship the game cannot know. The one `các bạn` in the
catalogue is a real plural ("keep the race to yourselves").

*Where `hãy` goes.* The polite particle **`hãy`** is on **live prompts** the app is asking
the player to answer right now (`Hãy tung xúc xắc trước`, `Hãy chọn một tên`,
`hãy chạm một ô đất`), and on nothing else. It is **not** on button labels, column
headers, ruleset summaries, card-effect summaries, or city-improvement rung descriptions:
those are bare verb phrases (`Kết thúc lượt`, `Xây 2 con đường miễn phí`,
`Hội Thương Nhân: đưa 2 thẻ...`). A statement of fact omits it
(`Bạn đã tung xúc xắc trong lượt này rồi`); a statement of what a card lets you do takes
`hãy` (`hãy tự đặt`). That pairing keeps prompts from reading as commands.

**2. `khu định cư` for *settlement*.**
The alternative a Vietnamese board-game player is likeliest to arrive knowing is **`làng`**
(village). Rejected: a village is a downgrade our English does not make, and it breaks the
game's own ladder: `làng` -> `thành phố` reads as village-to-city where
`khu định cư` -> `thành phố` reads as the upgrade the rules describe. Substituting an
ordinary noun for our term is what the naming policy (§2) rules out. The cost is
length: it is the widest board-action label in the HUD.

**3. `kỵ sĩ` for *knight*.**
Against `hiệp sĩ`. `kỵ sĩ` is the military-unit reading and fits a piece with a strength
level that defends against raids; `hiệp sĩ` is the chivalric-romance word and carries a
moral connotation the piece does not have.

**4. No abbreviation for victory points.**
Vietnamese has no established abbreviation for victory points, and `ĐT` reads first as
`điện thoại` (telephone). Every occurrence is the full word, `điểm` or `điểm thắng`; the
scoreboard column is `Điểm`, and the short victory-target form is `Mốc thắng N`
(`Mục tiêu` collides with a legal target).

**5. `hàng hóa` for *commodity*, beside `tài nguyên` for *resource*.**
`hàng hóa` (merchandise, trade goods) must read as a second pool beside `tài nguyên`, not as
a category containing it: `tài nguyên và hàng hóa tính chung` ("resources and commodities
count together") is the discard rule, so it must stay.

**6. `quân man rợ` for *barbarians*, always with `quân`.**
`man rợ` alone is an adjective in Vietnamese and cannot head a noun phrase, so every
barbarian string carries `quân` (troops). `hạm đội man rợ` for the fleet.

**7. `đô thị lớn` for *metropolis*.**
Against `đại đô thị`. Chosen so that `thành phố` (city) stays visibly inside the same
ladder rather than jumping register.

**8. `chip số` for the *number token / number chit*.**
`quân số` is a frozen compound meaning *troop strength / headcount*, so
`Đổi chỗ hai quân số` (Inventor) reads as swapping two headcounts, in a catalogue that also
carries `quân man rợ` and `quân thương nhân`. `thẻ số` is worse: `thẻ` is this catalogue's
word for a card in several hundred strings (`thẻ phát triển`, `thẻ tiến bộ`,
`thẻ Người Phòng Thủ`), and the Inventor prompts put the term two words from a card name.

`chip số` is what a Vietnamese board-game player says out loud at the table. It is a
naturalised loan (poker chips), it collides with nothing here, and it doubles as its own
classifier, which is what makes the board-numbers chapter count naturally:
`túi 18 chip chuẩn`, `một chip 2`, `một chip 12`, `một chip dư`.

Also rejected: `ô số` (`ô` is this catalogue's word for the hex itself, so an `ô số` is a
numbered hex, not the thing sitting on it), `xu số` (`tiền xu` is the coin commodity), and
`con số` alone (works in prose, fails where the physical piece is the subject).

**9. *setup* is `đặt quân khởi đầu`, and a piece placed during it is just `khởi đầu`.**
`dàn quân` is comprehensible but military: it belongs with `dàn trận` and
`bày binh bố trận`, deploying troops for a battle, whereas here each
player puts down two settlements and two roads before anyone rolls. `quân` itself is fine,
because `quân cờ` is the ordinary Vietnamese word for a game piece (`đặt quân`, `đi quân`);
it is `dàn` that supplies the army. `khai cuộc` is chess/go register, and a bare `chuẩn bị`
is too close to `Chuẩn bị bàn chơi` (*setting up the board*) and to `Thiết lập` (settings).

*Where the boundary falls.* The phase, wherever it is a noun, takes the full phrase: the
manual's chapter title `Đặt quân khởi đầu`, `Đặt quân khởi đầu và các lần xây miễn phí`,
`trong lúc đặt quân khởi đầu`, the event log's `Đặt quân khởi đầu: {player}`,
`Hãy đợi xong phần đặt quân khởi đầu.` A **piece** placed during it takes only the
adjective, because Vietnamese modifies the noun directly and nobody says
`Khu định cư lúc đặt quân khởi đầu`: `khu định cư khởi đầu`, `đường khởi đầu`,
`con tàu khởi đầu`. English needs the noun *setup* in both positions; Vietnamese does not,
and forcing it in reads as officialese. (The clocks-table cells that carry these scroll
rather than clip.)

## 2. The naming policy, as it applies here

Per `CONTRIBUTING.md`: **only the game title and the expansion names diverge.** Card,
resource and mechanic names are translated faithfully from our English, and where the
natural Vietnamese for a card title happens to match a common term, that is correct.

- The product name **`Costanio`** is never translated, in any string.
- Expansions: **`Đảo`** (Islands), **`Kỵ Sĩ`** (Knights), **`Ngư Dân`** (Fishermen),
  **`Đoàn Lữ Hành`** (Caravans), **`Kịch Bản`** (Scenarios). The five later scenarios are
  in §8.
- Substituting ordinary nouns for game terms over-applies this rule. That is what §1 item 2
  guards against, and it is why `làng` is rejected rather than left as taste.

## 3. Core vocabulary

| English | Vietnamese | Note |
|---|---|---|
| settlement | `khu định cư` | §1 item 2 |
| city | `thành phố` | |
| city wall | `tường thành` | |
| metropolis | `đô thị lớn` | |
| road | `đường` / `con đường` | classifier `con` in prose, bare in labels |
| ship | `tàu` / `con tàu` | |
| knight | `kỵ sĩ` | §1 item 3 |
| enemy knight | `kỵ sĩ địch` | not `đối thủ` / `đối phương` |
| inactive (knight) | `chưa hoạt động` | deactivating a knight is not `tắt hoạt động`: `tắt` takes a device |
| robber / pirate | `tên cướp` / `tên hải tặc` | `tên` is pejorative-personal, on purpose |
| steal / rob (verb) | `trộm` | `cướp` only inside `tên cướp` (robber) and `cướp phá` (pillage) |
| merchant (piece / card / token) | `thương nhân` / `Thương Nhân` / `quân thương nhân` | case carries the distinction |
| bank | `ngân hàng` | |
| resource / commodity | `tài nguyên` / `hàng hóa` | §1 item 5 |
| development card | `thẻ phát triển` | |
| progress card | `thẻ tiến bộ` | a different word from the above |
| victory point | `điểm thắng` (`điểm`) | no abbreviation, §1 item 4 |
| harbor / port | `cảng` (`cảng chung` / `cảng riêng`) | generic / specific |
| maritime trade | `giao dịch hàng hải` | |
| hex, tile | `ô` | |
| number token, number chit | `chip số` | §1 item 8 |
| junction, vertex, corner | `giao điểm`, `đỉnh`, `góc` | three distinct source words, three renderings; an intersection is `giao điểm`, `góc` only where the English says corner |
| setup (the phase) | `đặt quân khởi đầu` | modifier form on a piece is bare `khởi đầu`: `khu định cư khởi đầu`, `đường khởi đầu`. §1 item 9 |
| setting up the board | `Chuẩn bị bàn chơi` | distinct from the phase above, and from `Thiết lập` (settings) |
| turn | `lượt` | |
| a 7 (the roll) | `ra 7` | not `số 7` / `con 7` |
| hand limit | `giới hạn tay` | |
| Longest Road | `Đường Dài Nhất` | title case as a card name |
| Largest Army | `Quân Đội Lớn Nhất` | |
| Longest Trade Route | `Tuyến Giao Thương Dài Nhất` | `đường` (road) and `tuyến` (route) are kept apart |
| Defender token | `thẻ Người Phòng Thủ` | `Người Bảo Vệ` is the more natural title; `phòng thủ` is the mechanic's root |
| Master Merchant | `Đại Thương Nhân` | a rank; `Thương Nhân Đại Tài` reads as *greatly talented merchant*, praise rather than a rank, and is too long for a card face |
| Warlord | `Thống Lĩnh` | `Lãnh Chúa` is a feudal *lord* and says nothing about war; the card activates every knight you own |
| exploration, island discovery | `khám phá` | not `thăm dò`, which is prospecting or opinion-polling |
| improvement track; Trade track | `nhánh`; `Thương Mại` | `Giao dịch` is the trading step |
| barbarian fleet's track | `lộ trình` | kept apart from the improvement tracks (`nhánh`) and the caravan spokes |
| barbarians | `quân man rợ` | §1 item 6 |
| lobby / table / seat | `phòng chờ` / `bàn` / `chỗ (ngồi)` | |
| UI tab | `tab` | never `thẻ` (card) |
| a match | `ván đấu` | one match only; never for the product as a whole (`Costanio là một ván đấu…` is wrong) |
| replay | `bản phát lại` | |
| bot | `máy` | short on purpose; it appears in seat rows |
| seed (RNG) | `hạt giống` | `mã seed` and bare English `seed` rejected |
| fingerprint (of the seed) | `dấu vân tay` | |
| curated map | `bản đồ tuyển chọn` | |
| main landmass | `vùng đất liền chính` | |
| bid (verb / the act) | `đặt giá` | |
| vote (a unit of voting power) | `phiếu` | the label is `Số phiếu: {total}` |
| sealed (bids) | `niêm phong` | `kín` rejected |
| old boot | `chiếc bốt cũ` | |
| fishing ground | `ngư trường` | |
| Menu | `Trình đơn` | the loanword would equal the msgid |

Terrains: `Rừng` forest, `Đồng Cỏ` pasture, `Đồng Lúa` field, `Đất Sét` clay,
`Núi` mountain, `Sa Mạc` desert, `Vàng` gold, `Biển` sea, `Hồ` lake, `Sương Mù` fog.
Resources: `gỗ`, `gạch`, `lông cừu`, `lúa mì`, `quặng`. Commodities: `vải`, `tiền xu`, `giấy`.

**Capitalisation: mirror the English source's case, entry by entry.** Vietnamese has no
native title case, so the catalogue does not invent one: an entry whose `msgid` is a name
or a heading (`Brick`, `Field hex`, a card title, a deck or track name) is capitalised
per word, and an entry whose `msgid` is a running label or prose (`brick`, `desert`,
`ô đồng lúa` inside a sentence) is not. That is why `Lông Cừu` and `lông cừu`,
`Đồng Lúa` and `đồng lúa`, `Đường Dài Nhất` and `đường dài nhất` all appear, and why a
global recasing would be a regression rather than a tidy-up. Card titles are title case
in every context; the only place they lowercase is where the English describes the
measurement rather than the award.

## 4. Plurals: one arm

Vietnamese selects **`other` only** (`Intl.PluralRules("vi")`), so every ICU plural in
this catalogue carries exactly one arm. The arm has to read correctly at 0, 1 and 200,
and it does, because Vietnamese counts with a numeral + classifier + noun and none of the
three inflects: `# thẻ` is right at every count.

`catalog.test.ts`'s plural guard is a **superset** check, so nothing in the repo stops a
translator from adding a `one` arm. Do not add one: no count can select it, and it
suggests Vietnamese has two categories.

## 5. Blank and reordered entries

Blank falls back to the English source, which is the right rendering when the source is
pure machinery and Vietnamese punctuates it exactly as English does: `{0}`,
`{label}, {total}`, `{label}: {n}`, `{name}: {instruction}`, `{nextReward}. {nextCost}`,
`{resource} {num}` (a hex label), `+2` (a movement-cost chip), `Beta`, and the platform
name `cosmetic.decoration.kofi`. A `msgstr` equal to its own `msgid` is not allowed, so
blank is the correct form for these.

Two entries are **reordered** rather than blanked, because Vietnamese puts the modifier
after the noun: `{ratio}:1 {resource}` renders `{resource} {ratio}:1`, and `2:1 {resource}`
renders `{resource} 2:1`.

## 6. Usage conventions

- **Build verbs:** `đóng` for ships, `tuyển` for knights.
- **`của`, not `từ`, for a card taken off a person**, in card text and in the event log
  alike (`của {other}`). **`từ` is correct** where the source is a pool rather than a
  person: the bank, a deck, a gold hex, "the victim's resources and commodities together",
  and `giành từ {prev}` for a metropolis, which is a title and not a card.
- **`Xóa` only for permanent deletion.** Reversible edits (clearing ports in the map
  builder, a mode-switch warning, kicking a seat) use another verb.
- **Concept boundaries that must not cross:** `thẻ phát triển` / `thẻ tiến bộ`,
  `tài nguyên` / `hàng hóa`, `giao điểm` / `đỉnh` / `góc`, `đường` / `tuyến`,
  settlement / city / metropolis, `tên cướp` / `tên hải tặc`, `cảng chung` / `cảng riêng`,
  and knight `sức mạnh` against barbarian `sức tấn công` / `sức phòng thủ`.
- **Prose style.** Avoid English passives with a `bởi` agent; keep the subject of a ban or
  a reveal the player, not the slur or the card holder; avoid calques that parse but
  stall.
- **A `{name}` that interpolates a resource** (`msgctxt "resource"`, e.g. `Lông Cừu` /
  `Lúa Mì`) arrives capitalised in its citation form, so it goes after a colon:
  `Đặt giá bớt một: {name}`.
- **Prices in a label:** `với giá N` / `trả N`. A bridge's payout is `mang lại tiền xu` /
  `bạn vẫn nhận tiền xu`; `trả` there would read as the bridge costing coins.
- Every number in a translation matches its English.

## 7. Fonts

- Vietnamese diacritics add glyphs to the card-title subset, so a change to a card title
  means regenerating `frontend/public/fonts/gelasio-titles.woff2` and
  `src/lib/titleMetrics.json` with
  `uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py`.
- `vi` is not a CJK locale: it is Latin script and takes the Latin font stack and the
  uppercase rules.
- Google's `latin-ext` subset excludes **U+1EA0-1EF1**, which its separate `vietnamese`
  subset owns and which holds most of the language's accented vowels
  (`ạ ả ấ ầ ậ ắ ẻ ế ệ ị ọ ố ộ ớ ợ ụ ứ ự`). The brand faces therefore ship a
  `*-vietnamese.woff2` subset declared after `latin-ext` in `index.css`. Both halves of a
  subset (the file and the `@font-face` `unicode-range`) must cover these characters.

## 8. Scenario expansions

Scenario names are ours and are translated faithfully:
Rivers / The Rivers `Sông Ngòi` · Raiders / The Raiders `Quân Đột Kích` · Wagons `Xe Ngựa` ·
Explorers / The Explorers `Nhà Thám Hiểm` · Harbormaster (scenario and the 2-point card)
`Trưởng Cảng` · harbour points `điểm cảng`.

### Rivers
coin (Rivers currency) tiền xu, counted `# xu` · river sông · bridge cây cầu / cầu · bridge site vị trí cầu ·
ford a river lội qua sông · swamp Đầm Lầy · Wealthiest Settler Người Định Cư Giàu Nhất ·
Poorest Settler Người Định Cư Nghèo Nhất · the two wealth tiles hai ô thưởng tài sản (short: ô tài sản) ·
sell to the supply bán cho kho chung · pay to keep a city trả xu để giữ thành phố

### Raiders
raider (neutral enemy on a hex) kẻ đột kích · rider (your own figure on a path) kỵ binh (never kỵ sĩ) ·
castle lâu đài · path (a board edge) lối · prisoner tù binh · conquered bị chiếm · liberate giải phóng ·
land / landing đổ bộ · landing trigger điều kiện kích hoạt · battle sweep lượt xét giao tranh ·
Muster Tập Hợp · Swift Rider Kỵ Binh Thần Tốc · Intrigue Mưu Kế · Treason Phản Bội · gold vàng ·
hurry a rider on thúc kỵ binh · banked win chiến thắng được ghi nhận ·
roll-off (prisoner split) tung xúc xắc tranh phần

### Wagons
wagon xe ngựa · trade hex ô giao thương · plaza quảng trường · spoke (of a plaza) nan ·
cargo / a load kiện hàng (`hàng hóa` is commodity) · cargo token thẻ hàng · load (verb) chất hàng ·
deliver / delivery giao hàng · toll phí qua đường · Swift Journey Hành Trình Thần Tốc · circuit vòng đường ·
level cấp · movement / movement points điểm di chuyển · barbarian (on a path) quân man rợ ·
drive a barbarian off đánh đuổi quân man rợ · Glassworks Xưởng Thủy Tinh · Quarry Mỏ Đá · Castle Lâu Đài ·
marble đá cẩm thạch · glass thủy tinh · tools công cụ · sand cát · upgrade the wagon nâng cấp xe ngựa ·
the Drive button Đánh xe

### Explorers
settler người định cư · crew thủy thủ · fish haul mẻ cá · spice sack bao gia vị · the Council Hội Đồng ·
Council hex ô Hội Đồng · anchor bến neo · pirate ship tàu hải tặc · pirate lair sào huyệt hải tặc ·
gold field mỏ vàng · spice farm đồn điền gia vị · spice village làng gia vị · Swift Voyage Hải Trình Thần Tốc ·
Fast Gold Vàng Nhanh · Pirate Bonus Thưởng Hải Tặc · harbour settlement khu định cư cảng · Cargo Ship Tàu Hàng ·
hold (of a ship) khoang tàu · unexplored chưa khám phá · explore / reveal khám phá / lật mở · fog Sương Mù ·
fish shoal / shoal bãi cá · home island đảo nhà · home waters vùng nước nhà · shipyard xưởng đóng tàu ·
mission nhiệm vụ · mission track thang nhiệm vụ · space (on a track) nấc ·
phases Sản xuất / Hành động / Di chuyển · Movement phase giai đoạn di chuyển · tribute tiền cống ·
scrap a ship phá tàu · basin vũng neo · bonus tile ô thưởng · storm a lair tấn công sào huyệt ·
befriend a village kết thân với làng · fishing đánh cá

### Notes
- **rider `kỵ binh` vs knight `kỵ sĩ`.** The manual says the word differs because both
  pieces can be in one game; so does the Vietnamese.
- **A fish tile is `thẻ cá`**, never `ô cá`, because `ô` is this catalogue's word for a hex.
- **Intrigue is `Mưu Kế`** in both decks (the English shares the name).
- The Caravans spoke is `điểm xuất phát`, distinct from a Wagons plaza's `nan`.
- Ship building needs an open turn: `sau khi đã tung xúc xắc`.
- Small phrases: `do mình chọn` (of their choice), `để có chỗ trống` (make room).
