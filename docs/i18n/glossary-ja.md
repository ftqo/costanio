# Japanese (`ja`) terminology glossary

The terminology, register, script and typography conventions the Japanese catalogue
(`frontend/src/locales/ja/messages.po`) follows. When this file and the catalogue
disagree, the catalogue is what ships; bring the two back into line in the same change.

**Sources:** `docs/rules/base.md`, `docs/rules/islands.md`, `docs/rules/knights.md`,
`docs/rules/scenarios.md`, `frontend/src/lib/eventlog.ts`, `frontend/src/lib/format.ts`,
`frontend/src/locales/README.md`.

---

## 1. Register and script

### Register

| Surface | Register | Example |
|---|---|---|
| Buttons, menu items, tab labels, column headers | **体言止め** (noun or verb stem, no politeness marker) | `建設`, `購入`, `取引`, `観戦` |
| System messages: errors, toasts, confirmations, empty states, tooltips | **丁寧語 (です・ます)** | `資源が足りません` |
| Event log lines | **常体, plain past (〜した)** | `{player}が開拓地<0/>を建設した` |
| Rules manual (`HowToPlay`), Support page | **丁寧語**, plainer and longer sentences | `盗賊のいるヘクスは何も払いません。` |
| Card rule text on the card face | **常体, terse** | `盗賊を移動し、カードを1枚奪う` |

The manual is teaching material for people who have never played, so it uses the
丁寧語 of a Japanese teaching text rather than the 常体 of a reference document.

No 敬語 (尊敬語/謙譲語) anywhere: it reads as a corporate form letter. Never mix 丁寧語 and 常体 inside the same surface.

**"You" is normally dropped**, because Japanese drops a recoverable subject:
`You cannot build there` is `そこには建設できません`. あなた is kept only where it
contrasts the player with another party and the sentence is ambiguous without it
(`ボットがあなたの席に入ります`, where `ボットが席に入ります` could mean the bot's own seat).
Where a comparison is to the player themself, use 自分 (`自分より上`).

**Log lines that report a state rather than a completed event** end on a bare noun
(体言止め): `金：{names}が資源を選択`, `…を獲得し、都市を選択中`. 〜中 is the standard
form for an ongoing state (接続中, 読み込み中). `log.barb.mustGiveCity` uses the
obligation form 〜しなければならない, because it states an obligation, not an event.

### Script

| Script | Use it for |
|---|---|
| **Kanji** | Game-mechanical nouns rooted in the pre-industrial fiction: 開拓地, 都市, 資源, 手札, 銀行, 港, 騎士, 城壁, 盗賊, 蛮族 |
| **Katakana** | Software and network vocabulary, and terms with no compact kanji form: ロビー, ホスト, ゲスト, キャンセル, ミュート, サポーター, ダイス, カード, タイル, ヘクス, ボット |
| **Hiragana** | Grammatical glue, and softening a verb kanji would harden: 捨てる, 振る |

**Katakana for the software, kanji for the game.** `ロビー` and `開拓地` in one
sentence is correct, because they belong to different layers of the product. What is wrong is katakana-ising game fiction (`セツルメント`) or kanji-ising
software (`退室` for "disconnect").

### Punctuation

Full-width `。` `、` `：` `（）`. Never ASCII `.` or `,`. No space before `？` or `！`.
Quote names and terms with 「」, never ASCII quotes. The project's no-em-dash rule is
an English house-style rule, and Japanese does not use an em dash for parentheticals either.
Where the English uses a dash for a parenthetical, use `（）` or split the sentence. Do
not use `〜` in error copy, and do not use the em dash (U+2014), single or doubled.

`→` is kept as-is (Japanese uses the same glyph), with no surrounding ASCII spaces.

Where the English joins a label and a value, use the full-width colon:
`入札を1減らす：{name}`, `票数：{total}`. This is also the pattern for folding an
interpolated noun (which arrives in its citation form) into a button label.

**No space between Latin text and Japanese.** `Discordで`, not `Discord で`; the
renderer supplies the visual gap.

### Plurals

Japanese has **exactly one ICU plural category (`other`)**. Every `plural` message
collapses to a single `other` arm, with no stray `one` / `few` / `many` arm carried
over from another language. `catalog.test.ts` takes the required set from
`Intl.PluralRules` and enforces this.

### Counting

Count is a numeral plus a counter, placed **after** the noun in running text:
`カードを2枚引いた`, not `2枚のカードを引いた`.

**No space between the numeral and the counter, and that includes ICU's `#`.** Write
`{n, plural, other {カードを#枚引いた}}`, never `#␠枚` (which renders `3 枚`).

A score already named by 勝利点 does not repeat the unit: `勝利点+#`, not `勝利点+#点`.

| Object | Counter | Note |
|---|---|---|
| Cards (resource, commodity, development, progress), fish tiles | 枚 | Commodities too; never the bare universal つ |
| Fish counted by value (2 fish, 6 fish) | 匹 | `魚N枚` would read as N tiles, and one tile can be worth 3 |
| Roads, bridges | 本 | |
| Ships | 隻 | |
| Settlements, cities, walls, metropolises | 個 | |
| Knights, riders, raiders, prisoners | **体** | The counter for a figure on a board; 人 would read as people rather than pieces |
| Players, opponents, settlers, crew | 人 | |
| Dice, number tokens, ports | 個 | |
| Board tiles | **枚** | Flat, like cards; keep it consistent with cards, since the manual's board-size table puts both in one sentence |
| Camels | 頭 | |
| Wagons | 台 | |
| Victory points | 点 | |
| Turns, rounds, rolls, attacks | 回 | |
| Games played | **戦** | The competitive-play idiom, and one character in a narrow profile column. 回 is the neutral alternative |
| Characters (of a name, a chat message) | 文字 | |

Ordinals are `第n〜` or `n番目の〜`.

---

## 2. Naming policy

The game's title and the expansion titles are our own. Card names, resource names and
mechanic names are not: our English already uses Master Merchant, Bishop,
Warlord, Longest Road, Year of Plenty and the rest, because those are descriptive
phrases. Translate our English faithfully, and where the natural Japanese for a card
title happens to match a common term, that is correct (`CONTRIBUTING.md`).

Do not substitute uncommon words for the ordinary Japanese ones to make the vocabulary
look different. Renderings considered and rejected on that basis:

| English | Rejected | **Used** |
|---|---|---|
| settlement | 集落 | **開拓地** |
| development card | 開発カード | **発展カード** |
| progress card | 進展カード | **進歩カード** |
| longest road | 最長の道 | **最長交易路** |
| largest army | 最大兵力 | **最大騎士力** |
| robber | 山賊 | **盗賊** |
| commodity | 商品 | **交易品** |
| activate (a knight) | 出動 | **起動** |
| knight tiers | 一般 / 精鋭 / 勇猛 | **強さ1 / 2 / 3**, following the English Strength 1/2/3 |

`道` for road is used for length: it is one character and these strings sit in HUD
counters.

The product name (`Costanio`) is not translated. The expansion names translate our own
English titles:

| Our English | `ja` |
|---|---|
| Islands | **島** |
| Knights | **騎士** |
| Fishermen | **漁師** |
| Caravans | **隊商** |
| Scenarios | **シナリオ** |
| Rivers | **河川** |
| Raiders | **襲撃者** |
| Wagons | **荷馬車** |
| Explorers | **探検家** |
| Harbormaster | **港湾長** |

隊商 (the classical word) is used for the expansion name and for caravans, while the
camel piece is ラクダ (the ordinary spelling for the animal); the loanword キャラバン is
not used.

---

## 3. Core game nouns

| English | `ja` | Counter | Note |
|---|---|---|---|
| road | 道 | 本 | 1 character, ideal for HUD counters |
| settlement | 開拓地 | 個 | |
| city | 都市 | 個 | |
| building (cover term) | 建物 | 個 | The rules use "building" constantly and Japanese needs the same cover term |
| hex / tile (the piece) | タイル | 枚 | |
| hex (the board position) | ヘクス | | Where the geometry is meant (`陸地ヘクス`, `海ヘクス`). Not マス, which is a track space |
| terrain | 地形 | | Distinct from タイル; used where the *kind* of land is meant |
| vertex / junction / intersection | 頂点 | | The English uses three words; Japanese uses one |
| edge (incl. "path" meaning a board edge) | 辺 | 本 | Never 経路, which is a route |
| port / harbor | 港 | 個 | The English uses both words; Japanese uses one |
| generic port (3:1) | 一般港 | | |
| specific port (2:1) | 専用港 | | |
| dock (the structure on the water hex) | 桟橋 | | Distinct from 港, the trading right |
| robber | 盗賊 | | |
| pirate | 海賊 | | |
| longest road | 最長交易路 | | |
| longest trade route (Islands) | 最長交易路（航路含む） | | |
| largest army | 最大騎士力 | | |
| victory point | 勝利点 | 点 | Abbreviated 点 in tight HUD space |
| public victory points | 公開勝利点 | | Where the English says "public" (hidden VP cards excluded) the Japanese must say 公開 too |
| development card | 発展カード | 枚 | |
| progress card | 進歩カード | 枚 | Shortened to 交易/政治/科学カード in the event log for width |
| resource | 資源 | 枚 | |
| commodity | 交易品 | 枚 | |
| bank | 銀行 | | Resources and the development deck |
| supply | 供給 | | The commodity stacks and the piece supply, which the rules keep distinct from the bank |
| trade (player-to-player) | 取引 | 回 | |
| trade (with the bank) | 交換 | 回 | See §12 |
| trade-off | 引き換え | | Not 取引 |
| turn | 手番 | 回 | Not ターン |
| round | ラウンド | 回 | |
| dice | サイコロ / ダイス | 個 | サイコロ in the roll button, ダイス in イベントダイス and in settings |
| roll (the dice) | 振る (verb), ロール (bare label) | | See §12 |
| dice result | 出目 | | The board-game word. Not 結果 |
| number token | 数字チップ | 個 | |
| hand | 手札 | | |
| hand limit | 手札上限 | | |
| deck | 山札 | | デッキ only on the bare progress-deck labels (§12) |
| distance rule | 距離ルール | | |
| setup | 初期配置 | | |
| production | 産出 | | |
| discard | 捨てる / 捨て札 | 枚 | |
| map (board layout) | マップ | | Not 地図 |
| curated map | 厳選マップ | | |
| forest / pasture / field / clay / mountain / desert | 森 / 牧草地 / 農地 / 粘土 / 山地 / 砂漠 | 枚 | |
| sea / gold / lake / oasis | 海 / 金 / 湖 / オアシス | 枚 | |

## 4. Resources and commodities

| English | `ja` | Chars |
|---|---|---|
| wood / lumber | 木材 | 2 |
| brick | レンガ | 3 (katakana; 煉瓦 is correct but dated and stroke-dense at HUD size) |
| sheep / wool | 羊 | 1 (the animal, because the icon is a sheep and the HUD is narrow) |
| wheat / grain | 小麦 | 2 |
| ore | 鉱石 | 2 |
| cloth | 布 | 1 |
| paper | 紙 | 1 |
| coin | 硬貨 | 2 |
| gold (the hex, and the pick it pays) | 金 | 1 |

`金` (gold) and `硬貨` (coin) are different words: gold is a terrain that
pays your choice of resource, coin is the Politics commodity (and the Rivers currency).

**The chat token matcher (`lib/chatTokens.ts`) is not translated.** It is *input*
vocabulary matched against what a player typed. Japanese has no word boundaries, so
substring-matching 羊 or 木 inside ordinary chat would decorate constantly and wrongly;
leaving it English-only degrades to "no icon". If it is ever ported, the shorthand
Japanese players actually type is the kanji alone (木, 土, 羊, 麦, 鉄) plus digits, which
is a different design with its own tests.

## 5. Islands

| English | `ja` | Counter |
|---|---|---|
| ship | 船 | 隻 |
| sea edge | 海の辺 | 本 |
| coastal edge | 海岸の辺 | 本 |
| ship network / route | 航路 | |
| open ship (a movable end) | 端の開いた船 | |
| gold hex | 金ヘクス | 枚 |
| island | 島 | |
| exploration chip / Island bonus | 島ボーナス / チップ | 点 |

## 6. Scenarios

### 6.1 Fishermen and Caravans

| English | `ja` |
|---|---|
| fishing ground | 漁場 |
| fish tile | 魚タイル (枚) |
| catch (Fishermen) | 釣果 (漁獲 is the Explorers fish haul) |
| the old boot | 古い靴 |
| camel | ラクダ (頭) |
| oasis | オアシス |
| caravan | 隊商 |
| voting round | 投票 |
| spoke (Caravans oasis, Wagons plaza) | スポーク |

### 6.2 Rivers

| English | `ja` |
|---|---|
| coin / coin purse | 硬貨 (枚) |
| river | 川 |
| bridge | 橋 (本) |
| bridge site | 架橋地点 |
| ford a river | 川を渡る (渡河) |
| swamp | 沼地 |
| Wealthiest Settler / Poorest Settler | 最富裕開拓者 / 最貧開拓者 |
| the two wealth tiles | 富のタイル |
| sell to the supply | 供給に売る |
| pay to keep a city (pillage buyout) | 硬貨を払って都市を守る |

### 6.3 Raiders

| English | `ja` |
|---|---|
| raider (neutral enemy on a hex) | 襲撃者 (体) |
| rider (your figure on a path) | 騎兵 (体). Distinct from 騎士: both pieces can be in one game |
| castle | 城 |
| path (a board edge) | 辺 |
| prisoner | 捕虜 (体) |
| conquered | 制圧された / 制圧 |
| liberate | 解放 |
| land / landing | 上陸 (the Knights barbarian landfall is 襲来) |
| battle sweep | 戦闘判定 |
| Muster | 召集 |
| Swift Rider | 快速騎兵 |
| Intrigue | 策略 (shares the Knights progress card's name, so shares the Japanese) |
| Treason | 裏切り |
| gold | 金 (枚) |
| hurry a rider on | 騎兵を急がせる |

### 6.4 Wagons

| English | `ja` |
|---|---|
| wagon | 荷馬車 (台) |
| trade hex | 交易ヘクス |
| plaza | 広場 |
| cargo / a load | 積荷 |
| load (verb) | 積む |
| deliver / delivery | 配達 |
| toll | 通行料 |
| Swift Journey | 急ぎ旅 |
| the circuit | 周回路 (交易路 is Longest Road) |
| level | レベル |
| movement / movement points | 移動力 |
| barbarian (on a path) | 蛮族 |
| drive a barbarian off | 蛮族を追い払う |
| Glassworks / Quarry / Castle | ガラス工房 / 採石場 / 城 |
| marble / glass / tools / sand | 大理石 / ガラス / 道具 / 砂 |
| upgrade the wagon | 荷馬車を強化 |
| coastal corner (a board-corner hex) | 海岸の角 (never 頂点, which is an intersection) |
| Drive (button) | 走行 |

### 6.5 Explorers

| English | `ja` |
|---|---|
| settler | 入植者 (人) |
| crew | 乗組員 (人) |
| fish haul | 漁獲 (個) |
| spice sack | 香辛料袋 (袋) |
| the Council / Council hex | 評議会 / 評議会ヘクス |
| anchor (of the Council hex) | 停泊地 |
| pirate ship / pirate lair | 海賊船 / 海賊の隠れ家 |
| gold field | 金鉱地 |
| spice farm / spice village | 香辛料農園 / 香辛料の村 |
| Swift Voyage | 快速航海 |
| Fast Gold | 即金 |
| Pirate Bonus | 海賊ボーナス |
| harbour settlement | 港湾開拓地 (a building, not a port; 港湾 keeps it apart from 港) |
| upgrade to a harbour settlement | 港湾開拓地にする |
| a building already upgraded (city or harbour settlement) | 格上げ |
| Cargo Ship | 貨物船 |
| hold (of a ship) / its cargo slots | 船倉 / 枠 |
| shipyard | 造船所 |
| unexplored | 未探索 |
| explore / reveal | 探索 / 公開 |
| fog | 霧 |
| fish shoal | 魚群 |
| home island / home waters | 本島 / 本島の周辺海域 |
| mission / mission track | 任務 / 任務トラック |
| space (on a track) | マス |
| Movement phase | 移動フェイズ |
| tribute | 通行税 |
| scrap a ship | 船を解体 |
| basin | 泊地 |
| bonus tile | ボーナスタイル |
| storm a lair | 隠れ家を襲撃 |
| befriend a village | 村と友好を結ぶ |

### 6.6 Harbormaster

| English | `ja` |
|---|---|
| Harbormaster (scenario, and the 2-point card) | 港湾長 |
| harbour points | 港湾点 |

## 7. Knights

| English | `ja` | Counter |
|---|---|---|
| knight (piece) | 騎士 | 体 |
| knight tiers | 強さ1 / 強さ2 / 強さ3 (`強さ1の騎士` …) | 体 |
| activate | 起動 | |
| active / inactive | 起動中 / 待機 | |
| promote | 昇進 | |
| displace | 追い出す | |
| chase the robber | 盗賊を追う (button: 盗賊追跡; pirate: 海賊追跡) | |
| city improvement (the system) | 都市の発展 | |
| upgrade a track (the action) | 強化 | |
| Trade / Politics / Science | 交易 / 政治 / 科学 | |
| metropolis | 大都市 | 個 |
| city wall | 城壁 | 個 |
| event die | イベントダイス | 個 |
| barbarians | 蛮族 | |
| barbarian fleet | 蛮族の船団 | |
| barbarian attack | 蛮族の襲来 | 回 |
| barbarian landfall | 襲来 (上陸 belongs to Raiders) | |
| attack / defense strength | 攻撃力 / 防衛力 | |
| Defender of the Realm / Defender token | 国の守護者 / 国の守護者コマ | |
| pillage / raze a city | 略奪 / 破壊 | |
| Merchant Guild (Trade 3) | 商人ギルド | |
| Fortress (Politics 3) | 要塞 | |
| Aqueduct (Science 3) | 水道橋 | |
| Merchant (token) | 商人コマ | 個 |

The unnamed improvement log line says 都市を発展させた, while the three named-track lines
say `{track}を強化した`. The English is split the same way ("improved a city" against
"improved Trade"), and the different verb helps a reader tell the two apart in the log.

The Merchant Guild's wire name is `trading_house` and must never change; only the
display string is 商人ギルド. `basic` / `strong` / `mighty` survive only as wire tokens.

## 8. UI and system vocabulary

| English | `ja` |
|---|---|
| lobby | ロビー |
| game (a match) | ゲーム |
| table (a game room) | 卓 (部屋 is the chat channel) |
| spectate / spectator | 観戦 / 観戦者 |
| invite / invite code | 招待 / 招待コード |
| seat | 席 |
| only seats N | 定員はN人まで |
| host | ホスト |
| ready (a player) | 準備完了 |
| ready (a connection that is established) | 接続完了 (接続中… is "connecting") |
| disconnect / reconnect | 切断 / 再接続 |
| reload | 再読み込み |
| ban | 利用停止 |
| chat ban | チャット利用停止 |
| report (a player) | 通報 (never レポート, which is a document) |
| report (a problem) | 報告 |
| mute | ミュート |
| supporter | サポーター |
| cosmetic item | 装飾アイテム |
| guest | ゲスト |
| leave | 退出 |
| rematch | 再戦 |
| forfeit | 不戦敗 |
| surrender | 投了 (the shogi word) |
| draw (a drawn game) | 引き分け |
| claim (a game against bots) | ボット戦の終了 |
| bot | ボット |
| ranked | ランク戦 |
| counter-offer | 逆提案 |
| seed fingerprint | 指紋 (ハッシュ値 is the plainer alternative) |
| vacant (a title held by nobody) | 空位 |
| colour-vision deficiency labels | clinical vocabulary (2型色覚 and the rest) |
| map and board-size presets | translated as proper nouns: 群島, 中国, 日本, イギリスとアイルランド, アメリカ合衆国, 海岸（大/中/小）, 大/中/小 |
| turn-timer presets (Blitz / Normal / Relaxed) | 電撃戦 / 標準 / ゆったり |

## 9. Interface verbs

| English | Button | In prose |
|---|---|---|
| build | 建設 | 建設する |
| buy | 購入 | 購入する |
| play (a card) | 使用 | 使用する |
| discard | 捨てる | 捨てる |
| steal | 奪う | 奪う |
| move | 移動 | 移動する |
| place | 配置 | 配置する |
| pass | パス | パスする |
| roll | サイコロを振る | 振る |
| offer | 提案 | 提案する |
| accept | 承諾 | 承諾する |
| decline | 辞退 | 辞退する |
| withdraw (an offer) | 取り下げる | 取り下げる |
| cancel | キャンセル | |
| confirm | 確定 | |
| end turn | 手番を終了 | |
| upgrade to a city | 都市化 | 都市化する |
| activate a knight | 起動 | 起動する |
| promote a knight | 昇進 | 昇進させる |
| remove (a road, in the log) | 撤去 | 撤去した |
| take (a metropolis, in the log) | 奪取 | `（{prev}から奪取）` |

Not collisions, and correct as they stand: 引き分け (a drawn game) vs 引く (draw a
card); 使用 (play a card) vs プレイ (play a game); 昇進 (promote a knight) vs 強化
(upgrade an improvement track) vs 都市化 (upgrade a settlement to a city).

## 10. Deliberately not translated

- **Player display names, chat bodies, user-saved map names.** User content.
- **Bot display names** (`Bot William`, …). Proper nouns, persisted, replay-stable.
- **Error codes, event identifiers, wire enum values** (`brick`, `paused-error`,
  `trading_house`). Machine tokens.
- **The `debug` field on error frames.** English by contract.
- **Cosmetic colour names** (`Midnight`, `Periwinkle`, …). Product-flavoured proper
  nouns; translating them would be a separate exercise in Japanese colour naming.
- **Blank entries:** `{0}` (a bare placeholder) and `Pips` (a product
  term). An empty `msgstr` falls back to exactly the English at runtime, and copying
  the msgid would trip `catalog.test.ts`.

**Never blank a plural-bearing entry.** Japanese has one plural category, so a blank
`msgstr` on an entry whose English carries an ICU `plural` (or `select`) would fall back
to English and let English's plural rules pick an arm. Check the English message
text, not the msgid: keyed ids (`card.harborRate.wood`, `track.draw.politics`, …)
carry their ICU only in `en`'s `msgstr`.

---

## 11. Card titles

| English | `ja` | Note |
|---|---|---|
| Knight (development) | 騎士カード | |
| Monopoly | 独占 | |
| Road Building (development and progress) | 街道建設 | One name for both decks; they share one art render |
| Victory Point | 勝利点カード | |
| Year of Plenty | 収穫 | 豊作 is the alternative; 収穫 also appears as the log verb for gaining cards |
| Swift Journey | 急ぎ旅 | |
| Alchemist | 錬金術師 | Names the person, not the discipline (錬金術) |
| Bishop | 司教 | |
| Commercial Harbor | 商業港 | |
| Constitution | 憲法 | 憲章 (a charter) is the alternative |
| Crane | クレーン | Katakana for legibility over the period-correct 起重機 |
| Deserter | 脱走兵 | |
| Diplomat | 外交官 | |
| Engineer | 技師 | |
| Intrigue | 策略 | |
| Inventor | 発明家 | |
| Irrigation | 灌漑 | 用水路 is the alternative; 灌漑 is stroke-dense and outside 常用漢字 |
| Master Merchant | 大商人 | |
| Medicine | 医術 | |
| Merchant | 商人 | |
| Merchant Fleet | 商船隊 | |
| Mining | 鉱業 | |
| Printer | 印刷所 | |
| Resource Monopoly | 資源独占 | |
| Saboteur | 妨害者 | An actor noun, matching 脱走兵 / 外交官 in the same deck; used in the manual and board prompt too |
| Smith | 鍛冶屋 | |
| Spy | スパイ | |
| Trade Monopoly | 交易独占 | |
| Warlord | 将軍 | The card activates all your knights at once, so "general" fits the effect |
| Wedding | 婚礼 | |

Card titles composite over the card art at roughly a 56×80 px hand thumbnail. Japanese
titles are 2 to 4 characters, so the constraint is stroke density, not length.
Prefer jōyō characters with a moderate stroke count.

**The title font is a subset.** Card titles render in a Noto Serif JP subset
(`frontend/public/fonts/notoserifjp-titles.woff2`) generated from the shipped titles.
Changing any title requires regenerating it, or the card ships with a missing glyph:
`uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py`, then
commit the font and `titleMetrics.json`. The test suite does not catch a stale font.

## 12. Usage notes

- **取引 / 交換.** English says "trade" for both; Japanese uses 取引 for a
  player-to-player trade and 交換 for a bank trade, consistently across the log, the
  HUD and the manual. Bank buy/sell with gold is 売買 / 交換, never 取引.
- **ロール.** The verb is 振る and the result is 出目. ロール appears as the bare roll
  label and in some compact UI, and also means a **Discord role** (ロールを同期,
  サポーターロール), which cannot change. Prefer 振る / 出目 in running prose.
- **山札 / デッキ.** 山札 in prose, chapter headings (政治の山札) and accessible names.
  The three bare progress-deck labels (`msgctxt "progress card deck"`) read 交易デッキ
  etc., because bare 交易 is the improvement track of the same name. Never write a term
  that already contains its head noun twice (交易デッキの山札).
- **進歩カード in the log.** The progress-deck log lines shorten 政治の進歩カード to
  政治カード for width.
- **奪取 / 撤去.** Terse Sino-Japanese nouns in the log: `（{prev}から奪取）` inside a
  parenthetical gloss, and 撤去 for removing a road (the word for removing
  infrastructure). A removed knight is 取り除かれた.
- **追い払う** covers both chasing the barbarian/pirate in prose and driving a Wagons
  barbarian off.
- **The Raiders scenario and the raider piece** share 襲撃者; context separates them.
