# Simplified Chinese (`zh-Hans`) terminology glossary

The terminology, register, classifier and typography conventions the Simplified Chinese
catalogue (`frontend/src/locales/zh-Hans/messages.po`) follows. When this file and the
catalogue disagree, the catalogue is what ships; bring the two back into line in the
same change. Terms are frozen once chosen: a term must not vary by surface (tooltip,
event log, error message, Discord reply).

---

## 1. Register decision

**Neutral-formal written Simplified Chinese, mainland conventions, plain game
register.**

- **Second person is 你, never 您.** 您 in a game UI reads as customer service or a
  bank statement; 你 is what mainland online games use. No exceptions.
- **No 呢/啊/吧/哦 sentence particles** in system copy. Toasts and event-log lines are
  statements, not chat.
- **Verb-first imperatives for buttons**, two characters where possible: 建造, 购买,
  接受, 取消. No 请 prefix on buttons. 请 is acceptable in a blocking prompt that
  describes a required decision (请弃牌), where it carries obligation rather than
  politeness.
- **The event log is clipped, headline style**, mirroring the English:
  `{player} 建造道路`, `{player} 激活一名骑士`. No flavour 了. Keep 了 only where the
  grammar needs it: transfers (`把 <0/> 给了`), completed state changes
  (`强盗封锁了 <0/>`, `两个数字标记互换了位置`, `攻破了防线`, `守住了`, `捞到了`,
  `结束了与机器人的对局`, `把一座城市交给了蛮族`). "A X" is 一 + classifier
  (一名骑士).
- **Arabic numerals for every game quantity**: `2 张牌`, `3 点`, `13 分`, not 两张牌 /
  三点. This keeps ICU interpolation and the numeric UI consistent and sidesteps 二/两.
  Spelled numerals only in fixed phrases.
- **Full-width punctuation**: 。，、：；（）「」. Half-width only inside code, IDs and
  numbers.
- **No dashes in player-facing copy.** The project bans the em dash (U+2014); in
  Chinese that also covers the full-width double dash and the wave dash 「～」. Use
  。，：；（）or a 、 list separator. For a label/value pair use a full-width colon:
  `名称：1450`. For an empty table cell use 「–」 as the English does.
- **Folding an interpolated noun into a button label:** the button phrase, a full-width
  colon, then the noun (`少出一张：{name}`). The interpolated name arrives in its
  citation form.
- **Product names stay Latin.** `costan` and `costan.io` are not transliterated.

---

## 2. Naming policy

### 2.1 The rule

The game's title and the expansion titles are our own. Card names,
resource names and mechanic names are translated faithfully from our English, and
where the natural Chinese happens to match a common term, **that is correct**
(`CONTRIBUTING.md`).

So 道路 (road), 城市 (city), 资源 (resource), 港口 (harbor), 骑士 (knight), 骰子
(dice), 银行 (bank) and 商人 (merchant) are used without hesitation: they are
dictionary equivalents of generic English words, and avoiding them would produce
strange Chinese for no benefit. The same applies to the award names:
Longest Road **最长道路**, Longest Trade Route **最长贸易路线**, Largest Army
**最大军队**.

### 2.3 Expansion names

Our expansions are already our own names in English, so the Chinese is a faithful
rendering of them.

| English | zh-Hans | Note |
|---|---|---|
| Islands | 群岛 | |
| Knights | 骑士扩展 / 骑士 | 骑士扩展 in lobby and config surfaces and "alongside Knights"; see §6.0 |
| Fishermen | 渔夫 | |
| Caravans | 商队 | The standard Chinese for a trading caravan |
| Rivers | 河流 | |
| Raiders | 袭掠者 | Also the raider piece; context separates them |
| Wagons | 马车 | |
| Explorers | 探险家 | |
| Harbormaster | 港务长 | Also the 2-point card |
| expansion | 扩展 | Mainland usage; not 扩充 |
| module | 模块 | Internal/config-facing |
| ruleset | 规则集 | e.g. `base+islands` → 基础 + 群岛 |
| scenario | 剧本 | The established mainland board-game word; 情景 / 场景 read as UI-layout words |
| base game | 基础游戏 / 基础版 | 基础 alone where space is tight |

---

## 3. Core game nouns

The measure word (量词) is given for every countable object, because the message
strings need it and Chinese will not let you omit it.

| English | zh-Hans | 量词 | Notes |
|---|---|---|---|
| road | 道路 | 条 | `1 条道路`. Short form 路 in very tight UI (建路) |
| ship (Islands) | 船 | 艘 | `2 艘船`. 船只 for the collective supply |
| settlement | 村庄 | 座 | Two characters, what a player says aloud, and it fits the narrow build-cost cells and piece chips. 定居点 is the more literal alternative |
| city | 城市 | 座 | |
| building (settlement or city) | 建筑 | 座 | 相邻有建筑的玩家 |
| piece | 棋子 | | Not 配件 |
| hex / tile | 地块 | 块 | Prefer naming the terrain (`1 块森林`); 六边形地块 in explanatory prose only |
| terrain | 地形 | | |
| vertex / intersection | 路口 | 个 | Player-facing everywhere. 顶点 is the geometric term and stays out of the UI |
| edge | 边 | 条 | 路段 for a buildable edge or a Raiders path. Never 路径, which reads as a chain of roads |
| coastal | 沿岸 / 沿海 | | |
| port / harbor | 港口 | 座 | Generic 通用港口; 2:1 专用港口 |
| robber | 强盗 | 个 | |
| friendly robber (option) | 友善强盗 | | |
| pirate (Islands) | 海盗 | 个 | |
| number token / chit | 数字标记 | 枚 | Short form 数字 where unambiguous. Red numbers (6 and 8) 红色数字 |
| victory point | 胜利点 / 胜点 | 点 | See below |
| development card | 发展卡 | 张 | |
| progress card (Knights) | 进步卡 | 张 | Must stay visibly distinct from 发展卡 |
| resource | 资源 | 张 (as cards) | |
| commodity (Knights) | 商品 | 张 | 资源 / 商品 is a clean, self-explaining pair |
| bank | 银行 | | The supply of resource cards |
| supply (a player's own pieces) | 存量 | | "your supply", "a supply of 15 ships", the Explorers "In supply" chips, settlers and crews jettisoned back to their owner |
| supply (the shared pool) | 供应区 | | Resources, commodities, coins, raiders, camels, fish tiles and hauls that belong to no player: 卖给供应区, 从供应区中拿, 公共供应区. Not 存量, and not a bare 供应 |
| trade | 交易 | 笔 | Verb and noun. Bank trade 银行交易; maritime trade 海上交易; player trade 玩家交易 |
| trade offer / counter-offer / answer one | 报价 / 还价 / 回应 | | Give / Request (trade sides) 交出 / 索要 |
| turn | 回合 | | One player's turn. See §9.1 |
| round | 轮 | | A full cycle of all players: 第 1 轮. See §9.1 |
| dice roll (the act) | 掷骰 | | |
| dice roll (the result) | 点数 | | `掷出 8 点` |
| die / dice | 骰子 | 颗 | `2 颗骰子`. Event die (Knights) 事件骰 |
| hand / hand limit | 手牌 / 手牌上限 | | |
| deck | 牌堆 | | Deck labels 政治牌堆 / 科学牌堆 / 贸易牌堆 |
| player | 玩家 | 名 / 位 | 名 fits the register; 每位玩家 and 每名玩家 both occur |
| opponent | 对手 | 名 | "every other player" → 其他玩家 |
| board | 棋盘 | | |
| map | 地图 | 张 | Curated map 精选地图 |
| island | 岛屿 | 座 | |
| distance rule | 间距规则 | | 距离规则 suggests measured distance |
| road network | 路网 | | 与你的路网相连 |
| setup | 布局阶段 | | 初始布局 in full |
| snake order | 蛇形顺序 | | |
| production | 产出 | | 生产 as the verb, 产出 as the noun/event |
| target VP | 目标分数 | | "first to N points" badge: 率先达到 N 分 |
| open turn (ship building) | 掷骰之后 | | |

**Victory points.** The rendering follows the English source form: where the English
writes **VP** (scoreboard columns, `vp.ts` rate lines, `Target VP`, the `{vp} VP`
chip) the Chinese is **胜点**; where the English spells out **victory point(s)** (card
text, the rules manual, the `PlayerCard` breakdown) the Chinese is **胜利点**. In
effect: 胜利点 in sentences, 胜点 in headers and chips. Where the English says
"public" (hidden VP cards excluded), the Chinese says 公开胜利点.

---

## 4. Resources, commodities and terrain

The English UI labels are **Wood / Brick / Sheep / Wheat / Ore**
(`frontend/src/lib/cardText.ts`); the rules specs use lumber / wool / grain. Both map
onto one Chinese term each.

### 4.1 The five resources

| English | zh-Hans | 量词 | Notes |
|---|---|---|---|
| Wood / Lumber | 木材 | 张 | 木材 over 木头 (a lump of wood, not a commodity) |
| Brick | 砖块 | 张 | The terrain is 丘陵 and the card art is fired brick |
| Sheep / Wool | 羊毛 | 张 | 羊毛 is the resource, 羊 the animal; it matches its two-character siblings |
| Wheat / Grain | 小麦 | 张 | Over 粮食 (too abstract) and 谷物 (agronomic) |
| Ore | 矿石 | 张 | |

Every surface uses the full two-character form; there are no one-character short
forms.

**张 is the classifier for every counted resource and commodity**, because in this
game each one is a card: `银行还剩 # 张砖块`, `需要 # 张布匹`, `任意 1 张资源`. The
physical classifiers (块 brick, 匹 cloth, 枚 coin) describe substances the game does
not model. A 张 on a non-card noun would be a bug.

### 4.2 The three commodities (Knights)

| English | zh-Hans | 量词 | Notes |
|---|---|---|---|
| Cloth | 布匹 | 张 | Produced by a city on pasture |
| Paper | 纸张 | 张 | Produced by a city on forest |
| Coin | 金币 | 张 | Produced by a city on mountain. Not 硬币 (loose change) or 钱币 |

### 4.3 Terrain

| English | zh-Hans | Notes |
|---|---|---|
| forest | 森林 | Produces 木材 |
| pasture | 牧场 | Produces 羊毛 (+ 布匹 for a city) |
| field | 农田 | Produces 小麦 |
| hill | 丘陵 | Produces 砖块 |
| mountain | 山地 | Produces 矿石 (+ 金币 for a city) |
| desert | 沙漠 | |
| sea / water | 海洋 | Short: 海 |
| lake (Fishermen) | 湖泊 | |
| oasis (Caravans) | 绿洲 | |
| gold hex | 金矿地 | 金矿 alone reads as an ore mine. 黄金 is the Raiders/Wagons/Explorers currency, not the hex |
| fog (unexplored) | 迷雾 | |
| fishing ground (Fishermen) | 渔场 | |

### 4.4 Fishermen and Caravans

| English | zh-Hans | 量词 | Notes |
|---|---|---|---|
| fish (amount) | 鱼 | 条 | `N 条鱼`; `N 渔获` only in tight chips |
| fish tile | 渔获牌 | 张 | 渔获 is the Fishermen currency |
| the old boot | 破靴 | 只 | |
| pass the old boot | 转交 | | |
| camel | 骆驼 | 头 | |
| caravan | 商队 | 支 | |
| spoke (Caravans oasis, Wagons plaza) | 辐条 | 条 | |

---

## 5. Islands mechanics

| English | zh-Hans | Notes |
|---|---|---|
| ship | 船 | 量词 艘 |
| move a ship | 移动船只 | |
| open ship | 自由端 / 自由船 | A ship at an unanchored end of a chain |
| pirate | 海盗 | |
| gold hex payout | 自选资源 | 选择 1 种资源 |
| Island bonus | 岛屿奖励 | For the first settlement on a new island |

---

## 6. Knights mechanics

### 6.0 The 骑士 disambiguation rule

骑士 does triple duty: the expansion, the game piece, and the base-game development
card. Keep them apart mechanically:

- **Expansion:** 骑士扩展 in any lobby/config surface and in "alongside Knights".
- **Piece:** 骑士 (bare). The default reading in a Knights game.
- **Base-game card:** 骑士卡 in every message string. On the card face itself 骑士 is
  fine, since the face *is* the card.

### 6.1 Structures and tracks

| English | zh-Hans | Notes |
|---|---|---|
| city improvement | 城市升级 | Shares 升级 with the settlement→city upgrade; see §9.2 |
| Trade (track and progress deck) | 贸易 | Paid in 布匹. 交易 is the trading action |
| Politics (track) | 政治 | Paid in 金币 |
| Science (track) | 科学 | Paid in 纸张 |
| Merchant Guild (Trade 3) | 商人公会 | The wire name stays `trading_house` |
| Fortress (Politics 3) | 要塞 | |
| Aqueduct (Science 3) | 引水渠 | |
| metropolis | 大都会 | |
| city wall | 城墙 | 量词 道 (`1 道城墙`) |
| barbarians | 蛮族 | 量词 名 |
| barbarian ship / fleet | 蛮族船 / 蛮族舰队 | |
| barbarian attack / landfall | 蛮族入侵 / 入侵 | 登陆 is Raiders' landing only |
| attack strength | 进攻力 | = number of cities |
| defense strength | 防御力 | = sum of active knight levels |
| Defender of the Realm | 王国守护者 | |
| Defender (the strongest contributor, VP token) | 防卫者 | |
| pillage a city | 洗劫 | The city is downgraded; 摧毁 overstates it |

### 6.2 Knights themselves

| English | zh-Hans | Notes |
|---|---|---|
| knight (piece) | 骑士 | 量词 名 |
| strength 1 / 2 / 3 knight | 强度 1 / 2 / 3 骑士 | `basic` / `strong` / `mighty` survive only as wire tokens |
| activate (a knight) | 激活 | |
| active / inactive | 已激活 / 未激活 | |
| freshly activated (cannot act) | 刚激活 | |
| promote | 晋升 | Not 升级. See §9.2 |
| displace (an enemy knight) | 驱逐 | Not 逐出 / 挤走 |
| relocate (the displaced knight) | 转移 | |
| chase the robber | 驱赶强盗 | |

### 6.3 Knights economy

| English | zh-Hans | Notes |
|---|---|---|
| merchant token | 商人标记 | Worth 1 VP while held |
| Merchant Fleet | 商船队 | |
| discard limit / hand limit | 弃牌上限 / 手牌上限 | Raised by city walls |

---

## 7. Card titles

Chinese titles land at 2 to 4 characters against 1 to 3 English words, so every title
fits; the layout risk is the opposite one, a 2-character title looking lost in a box
sized for "Commercial Harbor". The two Road Building cards are the same title in two
decks and share one illustration, so they translate identically.

### 7.1 Development deck (base game)

| English | zh-Hans | Notes |
|---|---|---|
| Knight | 骑士 (face) / 骑士卡 (in messages) | §6.0 |
| Victory Point | 胜利点 | |
| Road Building | 道路建设 | |
| Year of Plenty | 丰收 | |
| Monopoly | 垄断 | The economic term |
| Swift Journey (Wagons) | 急行 | |

### 7.2 Trade deck (Knights)

| English | zh-Hans | Notes |
|---|---|---|
| Commercial Harbor | 商业港口 | |
| Master Merchant | 大商人 | One name everywhere, including the auto-play toast |
| Merchant | 商人 | |
| Merchant Fleet | 商船队 | |
| Resource Monopoly | 资源垄断 | |
| Trade Monopoly | 贸易垄断 | Follows the English title |

### 7.3 Politics deck (Knights)

| English | zh-Hans | Notes |
|---|---|---|
| Bishop | 主教 | |
| Constitution | 宪法 | 宪章 (charter) is the alternative |
| Deserter | 逃兵 | |
| Diplomat | 外交官 | |
| Intrigue | 阴谋 | Shared with the Raiders card of the same English name |
| Saboteur | 破坏者 | |
| Spy | 间谍 | |
| Warlord | 军阀 | The compositional translation; the card is a private force answering to you. 统帅 / 大将 name a rank inside a chain of command, and 枭雄 avoids the Republican-era association of 军阀 |
| Wedding | 婚礼 | |

### 7.4 Science deck (Knights)

| English | zh-Hans | Notes |
|---|---|---|
| Alchemist | 炼金术士 | |
| Crane | 起重机 | The machine, not the bird 鹤 |
| Engineer | 工程师 | |
| Inventor | 发明家 | |
| Irrigation | 灌溉 | |
| Medicine | 医药 | 医术 (the practised skill) is the alternative |
| Mining | 采矿 | |
| Printer | 印刷机 | Not 打印机 (a computer printer) |
| Road Building | 道路建设 | Identical to the development card |
| Smith | 铁匠 | |

**The title font is a subset.** Card titles render in a Noto Serif SC subset
(`notoserifsc-titles.woff2`) generated from the shipped titles. Changing any title
requires regenerating it, or the card renders with a missing glyph:
`uvx --from fonttools --with brotli python frontend/scripts/gen-title-fonts.py`, then
commit the font and `titleMetrics.json`. The test suite does not catch a stale font.

---

## 8. UI, system and moderation vocabulary

| English | zh-Hans | Notes |
|---|---|---|
| lobby (the browser of public games) | 大厅 | English uses "lobby" for both senses; Chinese must not |
| lobby (a specific pre-game room) | 房间 | |
| table | 牌桌 | Not 桌面 (tabletop/desktop) |
| game (a match instance) | 对局 | 加入对局, 本局, 对局无法开始. See below |
| game (the product, the genre) | 游戏 | 游戏模式, 基础游戏 |
| game settings (lobby panel) / table settings (manual) | 游戏设置 / 牌桌设置 | 对局设置 is not used |
| create a game | 创建对局 | |
| spectate / spectator | 观战 / 观战者 | 观看 stays on replays |
| invite / invite code | 邀请 / 邀请码 | |
| seat | 座位 | "take a seat" 入座; "empty seat" 空位 |
| host | 房主 | Transfer host 转让房主. The verb "to host" is 创建, not 主持 |
| ready (a player) | 已准备 | Button 准备 |
| ready (a connected socket) | 已连接 | |
| start | 开始 | |
| disconnect (status) | 掉线 | The natural mainland gaming term |
| reconnecting | 正在重新连接… | |
| rejoin / leave | 重新加入 / 离开 | |
| forfeit | 判负 | The penalty recorded against a player |
| surrender | 认输 | |
| draw (game result) | 平局 | See §9.3 |
| ban | 封禁 | 已封禁; 封禁时长 |
| report (a player/message) | 举报 | Not 报告, which is a document |
| mute | 禁言 | Not 静音, which is audio muting |
| chat | 聊天 | Chat filter 聊天过滤 |
| supporter | 支持者 | The Supporter role and its perks; not 赞助者 |
| cosmetic | 外观 | |
| guest | 访客 | |
| account | 账号 | |
| sign in / out | 登录 / 退出登录 | |
| settings | 设置 | |
| event log | 事件日志 | |
| match history | 对局记录 | |
| ranked | 排位 | Ranked game 排位赛 |
| stats | 统计 | |
| turn timer | 回合计时器 | |
| paused (error state) | 已暂停 | `paused-error` → 因错误暂停 |
| seed fingerprint | 种子的指纹 | |
| refloor (the turn clock) | 抬回 | The clock raises remaining time back to a floor |
| force-finish (a game) | 强制结束 | |
| abandoned (a game) | 废弃 | |
| provisional (rating) | 临时评分 | |

**对局 vs 游戏.** 对局 is a match instance, 游戏 the product or genre. The fixed
collocations **游戏结束** ("game over") and **开始游戏** ("Play", "Start game") keep
游戏, because a Chinese player reads them as single words; so do 继续游戏 ("Keep
playing") and the browser tab title `游戏 | Costanio`.

---

## 9. Collisions English hides and Chinese exposes

### 9.1 turn vs round

- **turn** = 回合: one player's turn. `TurnsCompleted` → 已完成回合数.
- **round** = 轮: one full cycle of all players. Setup "round 1 / round 2" → 第 1 轮 /
  第 2 轮.

Never use 回合 for a cycle, and never use 轮 for a single player's turn.

### 9.2 upgrade vs promote

- settlement → city: **升级** (`将村庄升级为城市`).
- city improvement track, level n → n+1: **升级** (`升级政治`), noun **城市升级**.
- knight tier: **晋升** (`将骑士晋升为强度 2 骑士`). Never 升级.
- upgrading a Wagons wagon: 升级 as well.

The settlement and track senses share 升级. Every log line that could collide names its
object (`{player} 升级政治` against `{player} 升级城市`), so the two never need to
share a sentence. Keep 晋升 strictly for knights.

### 9.3 draw

- draw a card: **抽取 / 抽牌**.
- a drawn game: **平局**.
- draw offer / accept / decline: **提议平局 / 接受平局 / 拒绝平局**.

### 9.4 play

"Play a card" is **打出**, never 玩, which is playing *a game*. "Play" as in "play the
game" → 游玩 / 开始游戏.

### 9.5 pass

"Pass" (skip your build phase, decline to act) is **跳过**, never 通过 (to pass
through, to approve). 通过 is correct only where the English means a check passed, as
on the fairness audit page. "Pass the old boot" is **转交**.

### 9.6 steal, move, place

- steal (a random card from a player): **偷取**. 抢夺 implies open, forceful taking;
  the mechanic is a blind random draw.
- move (the robber, a ship, a knight): **移动**.
- place (a settlement, a camel, the merchant): **放置**.

### 9.7 No plural morphology

- **ICU plurals in `zh-Hans` have exactly one category: `other`.** Never author a
  `one` branch: it is never selected, and invites a silently dead singular.
- `{n, plural, one {# card} other {# cards}}` becomes a single `{n} 张牌`. The measure
  word does the work the plural did, which is why every countable term in §3 and §4
  carries one: `{n} 条道路`, `{n} 座城市`, `{n} 张牌`, `{n} 名骑士`, `{n} 艘船`,
  `{n} 头骆驼`, `{n} 颗骰子`.
- **们 is only for people** (玩家们) and is usually unnecessary; never on objects.
- English genericity ("a/an" vs a bare plural) is lost; check the Chinese does not read
  as "exactly one".
- **Never leave a plural-bearing entry blank.** A blank `msgstr` falls back to English,
  and English then picks `one` or `other` by its own rules. Check the English
  **message text**, not the msgid: keyed ids (`error.*`, `card.*`, `track.*`, …) carry
  their ICU only in `en`'s `msgstr`.

### 9.8 Brevity changes layout, not only width

Chinese renders roughly 40 to 60% of the English width for the same content.

- Buttons sized to English text look sparse. Two-character buttons (建造, 取消) want a
  minimum width, not a hug-content width.
- A two-line English tooltip is usually one line in Chinese; fixed-height containers
  tuned to English will have dead space.
- Chinese does not break on spaces. Containers need `word-break` / `line-break` set,
  and long Latin runs (player names, invite codes) inside Chinese will not wrap
  without help.

---

## 10. Interface actions (button and menu strings)

Two characters wherever possible; these are the highest-traffic strings in the product.

| English | zh-Hans | Notes |
|---|---|---|
| build | 建造 | |
| buy | 购买 | |
| play (a card) | 打出 | §9.4 |
| discard | 弃牌 | |
| steal | 偷取 | §9.6 |
| move | 移动 | |
| place | 放置 | |
| pass | 跳过 | §9.5 |
| roll | 掷骰 | |
| end turn | 结束回合 | |
| offer (a trade) | 提议 | Noun "an offer" 报价 / 交易提议; counter-offer 还价 |
| withdraw / cancel an offer | 撤回 | |
| accept / decline | 接受 / 拒绝 | |
| cancel / confirm / undo | 取消 / 确认 / 撤销 | |
| upgrade (to city) | 升级 | §9.2 |
| promote (a knight) | 晋升 | §9.2 |
| activate | 激活 | |
| trade | 交易 | |
| join / leave | 加入 / 离开 | |
| ready / start | 准备 / 开始 | |
| choose / select | 选择 | |
| reload | 重新加载 | |

---

## 12. Maintenance

- When a string needs a term that is not here, add it here first.
- Any change to a **card title** requires regenerating the title font subset (§7).
- Do not derive Japanese from this document: the shared characters mislead, and the
  vocabulary differs.
- **Blank entries:** bare placeholders and icon/ratio runs whose only
  correct rendering is the English (`{0}`, `{ratio}:1 {resource}`, `2:1 {resource}`,
  `+2`) and the product term `Pips`. An empty `msgstr` falls back to the
  English, and copying the msgid would trip `catalog.test.ts`.
- **Not translated:** player display names, chat bodies, user-saved map names, bot
  display names, error codes and wire tokens, the `debug` field on error frames, and
  the chat token matcher in `lib/chatTokens.ts` (English input vocabulary).

---

## 17. Scenario expansions

### 17.1 Rivers

| English | zh-Hans | Notes |
|---|---|---|
| coin (Rivers currency) | 金币 | Always with 枚 (`3 枚金币`), so it never reads as the Knights Coin commodity |
| river | 河 / 河流 | |
| bridge | 桥 | 量词 座 |
| bridge site ("crossing") | 桥位 | Not 渡口 |
| ford a river | 涉水过河 | |
| swamp | 沼泽 | |
| Wealthiest Settler / Poorest Settler | 最富移民 / 最穷移民 | The tile: 最穷移民板 |
| wealth tiles | 财富板 | |
| sell to the supply | 卖给供应区 | |
| a bridge / river edge pays coins | 让你获得 N 枚金币 | Never bare 支付, which reads as the player paying |
| pay to keep a city | 付金币保住城市 | |

### 17.2 Raiders

| English | zh-Hans | Notes |
|---|---|---|
| raider (neutral enemy on a hex) | 袭掠者 | 量词 名 |
| rider (your own figure on a path) | 骑兵 | 量词 名. Distinct from 骑士, because both pieces can be in one game |
| castle | 城堡 | |
| path (a board edge) | 路段 | |
| prisoner | 俘虏 | 量词 名 |
| conquered | 被占领 | |
| liberate | 解放 | |
| land / landing | 登陆 | |
| battle sweep | 战斗结算 | |
| Muster | 征召 | |
| Swift Rider | 疾行骑兵 | |
| Intrigue | 阴谋 | Same as the Knights card |
| Treason | 叛变 | |
| gold (currency) | 黄金 | Counted bare (`2 黄金`) |
| hurry a rider on | 催促骑兵 | |

### 17.3 Wagons

| English | zh-Hans | Notes |
|---|---|---|
| wagon | 马车 | 量词 辆 |
| trade hex | 贸易地块 | |
| plaza | 广场 | |
| cargo / a load | 货物 | 量词 份; large / small cargo 大件 / 小件 |
| load (verb) | 装货 | |
| deliver / delivery | 交付 | |
| toll | 过路费 | |
| Swift Journey | 急行 | |
| circuit | 环线 | |
| level | 等级 | |
| movement / movement points | 移动力 | |
| barbarian (on a path) | 蛮族 | |
| drive a barbarian off | 驱赶蛮族 | |
| Glassworks / Quarry / Castle | 玻璃工坊 / 采石场 / 城堡 | |
| marble / glass / tools / sand | 大理石 / 玻璃 / 工具 / 沙子 | |
| purchase slot | 格位 | |

### 17.4 Explorers

| English | zh-Hans | Notes |
|---|---|---|
| settler | 移民 | 量词 名 |
| crew | 船员 | 量词 名 |
| fish haul | 鱼货 | 量词 份. Not 渔获, the Fishermen currency |
| spice sack | 香料袋 | 量词 袋 |
| the Council / Council hex | 议会 / 议会地块 | |
| anchor | 锚位 | |
| pirate ship / pirate lair | 海盗船 / 海盗巢穴 | |
| gold field | 金矿地 | |
| spice farm / spice village | 香料农场 / 香料村 | |
| Swift Voyage | 快速航行 | |
| Fast Gold | 快速黄金 | |
| Pirate Bonus | 海盗奖励 | |
| harbour settlement | 港口村庄 | |
| Cargo Ship | 货船 | |
| hold (of a ship) | 货舱 | |
| unexplored | 未探索 | |
| explore / reveal | 探索 / 翻开 | |
| fish shoal | 鱼群 | |
| home island / home waters | 本岛 / 本岛水域 | |
| mission / mission track | 任务 / 任务轨 | |
| space (on a track) | 格 | |
| Movement phase | 移动阶段 | Described as a one-way door: 单向门 |
| event die's ship face | 船面 | |
| tribute | 贡金 | |
| basin | 港湾 | |
| bonus tile | 奖励板 | |
| storm a lair | 攻打巢穴 | |
| befriend a village | 结交村庄 | |

### 17.5 Harbormaster

| English | zh-Hans | Notes |
|---|---|---|
| Harbormaster (scenario, card, scoreboard column) | 港务长 | Bare 港口 would read as a harbour count |
| harbour points | 港口分 | |
