# Knights rules spec

Own-wording description of the Knights mechanics. Layered on the base game.
Victory target is 13. There are **no** development cards and **no** Largest
Army; their roles are replaced by progress cards and knights.

## Setup (overrides the base game)

Setup is the snake draft of the base game with one change: the **second**
placement is a **city**, not a second settlement.

1. Round 1: in turn order, each player places 1 settlement + 1 adjacent road.
2. Round 2: in reverse order, each player places **1 city** + 1 adjacent road.
   The distance rule applies to both rounds.
3. Starting resources: each player takes **1 card per hex adjacent to their
   round-2 city** (only 1 per hex during setup, even though a city normally
   produces 2). Commodity-producing hexes still pay a single base resource here.

So every player begins with one settlement and one city; the starting city can
make city improvements and produces commodities from turn 1, and counts toward
the barbarians' strength.

## Commodities

In addition to resources, cities produce **commodities**:
- a city adjacent to a producing pasture (wool) hex yields 1 wool **and** 1
  cloth on a hit;
- a city adjacent to a forest (lumber) hex yields 1 lumber **and** 1 paper;
- a city adjacent to a mountain (ore) hex yields 1 ore **and** 1 coin.
- Settlements (not yet cities) yield only the base resource. Grain and brick
  hexes have no commodity.

### Commodity supply (finite)

Commodities are a **finite shared supply**, exactly as the five resources are:
three stacks beside the five resource stacks, **12 cloth, 12 paper, 12 coin**
(36 cards) at 3-4 players. A stack grows by +6 per player bracket, mirroring
the +5 per bracket of the resource bank, so
5-6 players get 18 of each and 7-10 extrapolate the same step.

Cards move in **both** directions. Production and supply trades draw from a
stack; every commodity a player gives up goes back onto it (a city improvement,
the spend side of a supply trade, and a discard over the hand limit on a 7). Cards passed between
players never touch the stacks.

The base game's **resource shortage rule applies to each commodity stack**: if a
stack cannot cover everyone claiming it on a roll and more than one player is
claiming, **nobody** receives that commodity; if only one player is claiming,
that player takes **as many as remain**. A withheld commodity does **not** become
an extra resource: a city on pasture owes 1 wool and 1 cloth, so with the cloth
stack empty its owner takes the 1 wool and nothing else.

The converse holds too: **a city on commodity terrain claims one card from the
resource stack, not two**, and its
commodity comes off its own stack whatever the resource stack does. So a bank
holding 2 wood covers a city and a settlement on the same forest (1 + 1), a lone
city on a forest with 1 wood left takes that wood **and** its paper, and a city
whose wood is withheld by a contested shortage still takes its paper. A city on
fields or hills has no commodity and still claims 2.

- `Hooks.CityResourceYield` prices the city's resource claim at 1 and the
  commodity is claimed from the board separately. The adjust event carries
  `minted`; logs written before the flag omit it and replay as written.
  `TestKnightsCityClaimsOneResourceUnderShortage` covers all four cases above.

Asking the supply for a commodity it cannot pay (a supply trade or the Trade
level-3 ability) is an **illegal command**, refused with an error, as a bank
trade for a resource the bank does not hold is refused.

## City improvements (three disciplines)

Each city owner may improve along three tracks, paying commodities:
- **Trade** (yellow): paid in **cloth**.
- **Politics** (blue): paid in **coin**.
- **Science** (green): paid in **paper**.

- Advancing to level *n* costs *n* commodities of that track (1, then 2, … up to
  5). You must own at least one city to improve.
- **Level-3 abilities** (one per discipline):
  - **Trade level 3, Merchant Guild**: on your turn, trade **2 of one
    commodity** for **any 1 _other_ commodity or resource** (the output must
    differ from the spent commodity). Unlimited uses per turn. The command and
    event are named `trading_house` for historical reasons; see below.
  - **Politics level 3, Fortress**: you may promote strong knights to **mighty**
    (level 3).
  - **Science level 3, Aqueduct**: on a non-7 production roll that gives **you
    no resources and no commodities** (a robber-blocked number counts as
    producing nothing), take **any 1 resource** from the bank. In an Islands
    game a **gold-field pick is production** too (it is a resource card of your
    choosing), so a roll that owes you one owes no Aqueduct; the core resource
    grant carries no gold picks, so the check must look beyond it. A commodity paid without its resource (a dry
    resource stack, see "Commodity supply") is production as well
    (`TestAqueductCountsEveryCardTheRollPaid` pins both).
- Reaching **level 4** in a discipline takes a **metropolis** (temporary control;
  **level 5** makes it permanent and **steals** it from a level-4 holder). A
  metropolis is placed on one of your cities, is worth +2 VP, and can no longer
  be **pillaged**. Each metropolis must sit on a **different** city: if you have
  no city free of a metropolis, you **may not purchase** the level-4/5
  improvement. Only one metropolis per discipline exists.
- **You choose which of your cities the metropolis is built on**
  (`CmdMetropolisPick`), from among your cities that do not already hold one. It
  matters: a metropolis city can never be pillaged by the barbarians, so the
  choice decides which city becomes permanently safe. A player with exactly one
  eligible city is never asked; the improvement places it outright. With two or more, the improvement leaves the metropolis
  earned but unplaced (`cak_metropolis_pending`): the +2 VP is not scored and
  nothing else at the table may happen until the city is named. On a 15-second
  timeout the server picks for them: the first metropolis-free city in board
  order.
- **One player may hold more than one metropolis**, up to all three, provided
  each sits on a different city. Three metropolises is +6 VP on its own and
  looks like a bug, but the rules cap metropolises per *discipline* (one each)
  and per *city* (one each), never per player. The only limit on a player is how
  many metropolis-free cities they can keep standing; do not add a per-player cap.

## The event die & the barbarians

- **Every** turn you roll the two production dice **plus** an event die,
  including a turn whose production dice total 7 (the event die is resolved
  before the 7 is resolved).
- The event die shows either a **barbarian ship** or one of three colored gates
  (matching the three disciplines).
- **Barbarian ship**: the barbarian fleet advances one step along its track.
  When it reaches the island it attacks (below).
- **Colored gate**: a player draws a **progress card** from that discipline's
  deck when the **red production die is at most their improvement level in that
  discipline, plus one**. So level 1 draws on a red 1-2, level 2 on 1-3, level 3
  on 1-4, level 4 on 1-5, and level 5 on 1-6 (every value). **Level 0 never
  draws.** Draws are dealt in turn order **starting with the current player**.

  The threshold is `red <= level+1`, not `red <= level`: `engine/knights/hooks.go`
  skips a player when `red > level+1`.

### Barbarian attack

When the fleet arrives:
- **Attack strength** = the number of cities on the board (each metropolis still
  counts as a city for this purpose).
- **Defense strength** = the sum of the levels of all **active** knights across
  all players.
- If defense ≥ attack, the barbarians are repelled: the player with the single
  strongest knight contribution earns a **Defender** VP. If two or more tie for
  strongest, **no** VP is awarded; instead each tied player, in turn order
  starting with the current player, draws **one progress card from a deck of
  their choice** (a player with no city improvements still draws).
- If defense < attack, the barbarians win, and **a city is always pillaged,
  unless every city on the board carries a metropolis**. A metropolis city is
  never pillaged, so on a board where every standing city carries one there is
  no city the loss can land on, and nobody loses anything (the cascade below
  runs out of players). `TestPillageAllMetropolises`
  pins that exception and its control case.
  The player(s) with the weakest contribution lose one city each (downgraded to
  a settlement), but only players who actually **have** a city they could lose
  are counted at all. A player with no city, or whose only cities carry a
  metropolis, cannot be pillaged and is therefore **left out of the ranking altogether**, so
  the loss falls on the weakest player who can bear it rather than stopping at
  the weakest player outright. A player with **zero active knights** always
  counts as weakest.

  Equivalently, as a cascade: if the weakest player cannot lose a city, the next
  weakest does, and so on until a city is lost. The engine implements the
  exclusion form (`weakest` in `engine/knights/hooks.go` ranges only over players
  with a downgradable city). Sparing a player whose only city is a metropolis
  never means sparing everyone.

  **The owner chooses which of their own cities is destroyed**
  (`CmdBarbarianDowngrade`), from among their
  non-metropolis cities. A player holding exactly one sacrificable city is never
  asked; the attack event resolves it outright.
  Losers with a real choice resolve **simultaneously and independently** (no
  queue, any order), and on a 10-second timeout the server picks for them: the
  first non-metropolis city in board order, preferring an unwalled one. If a
  downgraded player has **no settlement piece left in supply**, the city is laid
  on its side and **treated as a settlement** on the same vertex (it is not
  removed), and that player **must upgrade it back to a city before upgrading any
  other settlement**.
- **City walls are no defense against the barbarians.** A wall raises its
  owner's 7-discard threshold and nothing else; it does not stop a city being
  pillaged, and a pillaged walled city loses its wall as well.
- After any attack, all knights deactivate, and the fleet resets to the start of
  its track. This happens **whatever the outcome**, won or lost, and a knight may
  not be activated as the fleet lands.

### The barbarian track and the event die, in numbers

- The track is **7 spaces**. Each barbarian-ship face moves the fleet one space
  closer; the seventh lands it. `engine/knights/knights.go` uses 7.
- The event die has **6 faces: 3 barbarian ships and 3 colored gates**, one gate
  per discipline. So the fleet advances on half of all turns, and each discipline
  comes up on one turn in six.

## Knights

Knights are pieces placed on vertices (not roads). Three levels: basic (1),
strong (2), mighty (3).

- **Build** a basic knight: 1 ore + 1 wool, on an empty vertex touching your road
  network (the distance rule does **not** apply to knights).
- **Activate**: 1 grain. Only an active knight can act; a knight cannot act the
  turn it is activated.
- **Promote**: 1 ore + 1 wool to raise a level. The cap is **per knight**, not
  per player: a knight may be promoted only once per turn, so a **single
  knight cannot walk 1 → 2 → 3 in one turn**, while **two different knights may
  both go up in the same turn** if you can pay for both. The Smith progress card
  promotes two knights at once and counts against the same per-knight cap (a
  knight the Smith just raised cannot then be paid up again the same turn).
  Promotion to **mighty** (level 3) requires Politics level 3 (a fortress).
- **Actions**: each **active** knight may take **one action per turn** (move,
  displace, or chase the robber). Taking an action turns that knight
  **inactive**. A knight **cannot act the turn it was activated**.
  - **Move**: a knight moves along **your continuous routes** to a new empty
    vertex. It may pass through **your own** buildings and knights, but **not**
    through an opponent's piece, and must stop on a connected empty intersection.
    There is no step limit.
  - **Displace**: a knight may displace a **strictly weaker** enemy knight by
    moving onto its vertex. The displaced knight's **owner** then moves it (their
    choice) to any empty intersection reachable along **their own continuous
    routes** from the contested vertex; if there is none, it is **removed**. The
    relocation may not itself displace a third knight.
    "Routes", not "roads": in an Islands game a route is **roads and ships**, and
    what that means exactly is in "Knights in an Islands game" below.
  - **Chase the robber**: push the robber off an adjacent hex, then steal as the
    robber does (a **random card from the victim's combined resource +
    commodity** hand). Any knight strength will do. In an Islands game a knight
    on a **sea** intersection chases the **pirate** the same way; see below.
- Active knights contribute their level to barbarian defense. Any knight (active
  or not) occupies its intersection and blocks an opponent's road continuity
  through it, just like a settlement. Knights deactivate after a barbarian attack.

### Knight piece supply

Each player has **two pieces at each level**: 2 basic, 2 strong, 2 mighty, six
knights in all. That is a **component limit**, like the 15 roads and 5
settlements of the base game, and the engine enforces it (`knightsPerLevel` in
`engine/knights/decide.go`; the refusal is `ErrNoPieces`).

It binds in two places:
- **Building** a knight always adds a *basic* one, so it is refused once you
  already field two basic knights, however few knights you have in total.
- **Promoting** swaps a piece for one at the next tier, so it is refused when the
  **destination** tier is full. Two mighty knights on the board means no third
  promotion to mighty, even with strong knights to spare and a fortress built.

So a player can be simultaneously unable to build (two basics out) and unable to
promote (destination tier full) while still holding unused pieces at another
tier. That is not a deadlock: displacing, losing a knight to the
barbarians, or promoting a basic all free a piece up.

## Knights in an Islands game

The governing rule for the combination: **every Knights rule that applies to
roads also applies to ships.** Everything below follows from that.

- **A knight moves along roads and ships**, and may end its move on an empty
  intersection of sea hexes. So a knight can be ferried out to open water and
  left standing there.
- **The two networks join only at your own building.** That is not a Knights rule
  but the Islands definition of a continuous route, which this one inherits: a
  land network of roads connects to a sea network of shipping routes only through
  a settlement or city where they meet. A knight walking your
  road reaches your ship only by passing through a settlement or city of yours.
  - The one exception is the knight's **own starting intersection**: a knight
    stands at an intersection, not on an edge, so it may set out along any of
    your pieces touching that intersection.
  - Your own **knight** does not join two networks. It closes a route (below), it
    does not splice one.
- **A new knight still goes on land.** Placement gains ships as a connection (a
  coastal intersection at the end of your own ship takes a knight just as the
  end of your own road does) but not the sea: you may **move** a knight to a sea
  intersection and may not **place** one there.
- **A knight closes a shipping route, so it can never be marooned.** A knight
  must always stay connected to a route of its owner's colour, and no ship may be
  moved that would break that connection: a route is closed as soon as it
  connects two of your settlements, cities or knights. In practice: a ship with one of your knights standing on an end is **not open**,
  so it cannot be moved, and neither can any ship behind it.
- **A knight on a sea intersection chases the pirate**, just as a knight on
  land chases the robber: same eligibility (active, not activated this
  turn, adjacent to the piece), same stand-down afterwards, and the steal comes
  from a player whose **ship** borders the hex the pirate lands on. The robber
  lock covers the pirate too: neither moves before the first barbarian landfall.

**Known limitations of the combination:**
- **The pirate starts off the board** and arrives when a player first moves it
  there, which is the Islands behaviour; the intended rule holds it out of play
  until the first barbarian attack. In effect the two agree: nothing can move the
  pirate before the first landfall, because a pirate move on a 7 needs a pending
  robber and the robber is suppressed until then, and a knight chase is refused
  by the same lock.
- **The victory target does not rise by 2** for an Islands scenario played under
  Knights. Our target comes from `Config.TargetVP` with no per-combination
  adjustment.
- **Diplomat on a ship**: the card should also remove an open ship (and a seat
  removing its own ship may replace it only with a ship). Our Diplomat is
  road-only.
- **The Bishop may not move the pirate**, and **the merchant may not go on a gold
  hex**: the first holds by construction (the Bishop moves the robber), the
  second is enforced (`merchantHex` requires a producing
  resource, which gold is not).

## Trading commodities

- With other players you may trade any mix of resources and commodities.
- With the **supply** you may also trade **resources for commodities**, and at a
  4:1 bank rate (or 3:1 via a generic port) trade **commodities for resources or
  other commodities**. A trade the relevant stack cannot pay is refused (see
  "Commodity supply").
- **A specific 2:1 resource harbor prices the give side only, and still works
  when what you buy is a commodity.** A commodity **given** never gets the 2:1
  rate (its floor is 3:1 at a generic port, else 4:1), while a resource given
  keeps whatever rate that resource has, including your 2:1: 2 wood buys 1
  paper at a wood harbor. `engine/knights/decide.go` prices a resource give side
  with `s.BankRatio` (harbors included) and routes only a commodity give side
  through `commodityBankRatio`.
- The **Merchant** token: while you control it (from the Merchant progress card)
  you may trade the **resource** of its hex with the bank at **2:1**; holding it
  is worth 1 VP. It goes on a hex **next to one of your own buildings**
  (settlement or city). The hex must also **produce one of the five resources**:
  see "Merchant and Merchant Guild details".
- **Merchant Fleet** (progress card): name 1 resource **or commodity**; for the
  rest of the turn you make 2:1 bank trades of that good.

### Merchant and Merchant Guild details

| Question | Answer |
|---|---|
| What may the Trade level-3 ability (Merchant Guild) produce? | Any **1 other commodity or resource**. Input is 2 **identical commodities**; resources are never valid input, and the output may not be the commodity spent. |
| Is it limited per turn? | **No.** Unlimited on your own turn, like every other Action-phase trade. |
| Is the Merchant token ever removed? | **No.** It stays on its hex until another player plays a Merchant card, which moves it and transfers both the 2:1 and the 1 VP. The robber does not affect it, and the 2:1 rate is the holder's alone. |

- **The merchant may only go on a resource-producing hex.** The placement rule
  is a land hex next to one of your buildings, and we require `Res.Producing()`,
  the five bankable resources. That bars gold, the desert and the lake: the
  merchant charges 2:1 on the resource its hex represents, so on any other hex
  it would buy the 1 VP and nothing else.

  It is a predicate rather than a list of barred terrain because Fishermen and
  Caravans turn every desert into a lake. `merchantHex` in
  `engine/knights/progress_play.go` is shared by the validator and the offered
  targets, and `TestProgressMerchantTargetsMatchValidator` keeps them in step.
- **Player-facing text says Merchant Guild**, but the wire names are
  `trading_house` (command) and `cak_trading_house` (event). They are persisted
  schema and must not be renamed; `engine/knights/decide.go` notes this at the
  constant.

## Progress cards

**Card names.** The card names below are the ones the client shows and, in
snake case, the persisted card identifiers (`engine/knights/progress.go`), which are
schema and are never renamed.

Three decks (trade/politics/science), **18 cards each, 54 in all**; the exact
composition is in `engine/knights/progress.go`. Hand
limit 4. If it is **not** your turn, discard down to 4 immediately. On **your**
turn you may keep building/trading while over the limit and **reconcile to 4 (by
playing or discarding) by the end of your Action phase**, and you may not **end
your turn** while over the limit.

**When a card may be played.** Any number of progress cards during **your own
Action phase**, with two exceptions:
- **The Alchemist is the one card played before you roll**, because it sets the
  production dice. Every other card waits for the Action phase.
  The event die is still rolled after an Alchemist.
- **Victory-point cards (Constitution, Printer) are never "played".** They are
  revealed the moment they are drawn, kept face up, count 1 VP each, sit outside
  the hand limit and cannot be stolen by a Spy.

Two things you may **not** do with a card: discard one simply because you do not
want it (`CmdDiscardProgress` is refused unless you are over the hand limit, and
reconciling to 4 is the only reason to discard at all), and play one that the
table can already see would do nothing.

- **Decision:** a play that **public information** proves
  would have no effect is refused with `ErrCardNoEffect` (`CARD_NO_EFFECT`) and
  the card **stays in your hand**: an online table knows the outcome before the
  click, and spending a card for nothing helps nobody. The refused plays, each
  decided on counts every seat can see:
  - **Master Merchant** naming a victim who holds no card at all.
  - **Commercial Harbor** when no opponent holds a commodity, or you hold no
    resource to offer one.
  - **Saboteur** when nobody level with or ahead of you holds 2 or more cards.
  - **Wedding** when nobody ahead of you holds a card to give.
  - **Irrigation / Mining** when none of your buildings borders a fields /
    mountains hex, or the supply has none of that resource left.
  - **Warlord** when none of your knights is inactive (or you have none).
  - **Smith** (played without naming knights) when none of your knights can go
    up: none at all, all mighty, a strong one without politics level 3, or
    both pieces of the next tier already fielded. Naming a knight that cannot
    go up keeps its specific error.
  - **Road Building** when you hold road pieces but no edge your network
    reaches is free, and (in an Islands game) no ship can go down either. In
    an Islands game either free build may be a ship, so a seat out of road
    pieces with a ship to place has a live card; with no road **or** ship piece
    at all the refusal is `ErrNoPieces`.
  - **Resource Monopoly / Trade Monopoly** only when **no** opponent holds a
    resource / commodity at all.
- **What is still played for no effect:** a monopoly naming a good that
  opponents turn out not to hold, when they do hold other cards. What they hold
  is hidden, so refusing would leak it; that play goes through, takes nothing,
  and the card is spent.
- Refusing never traps a player over the hand limit: discarding down to 4 is
  always available (`TestOverLimitWithOnlyDeadCardsCanStillDiscard`).
- Cards whose own requirements already refuse a dead play keep their own error:
  Master Merchant with nobody ahead and Spy/Deserter with no eligible victim
  (`ErrBadVictim`), Engineer with no city (`ErrNeedCity`) or with every city
  walled or all 3 walls built (`ErrMaxWalls`), Road Building with no piece
  (`ErrNoPieces`), Crane with no affordable track.
- `TestProgressCardWithNoEffectIsRefused` pins every refused case against a
  twin that has an effect and is accepted. Bots propose every progress play
  through `engine.Decide`, so they never attempt a refused one; the dock
  disables the card and names the reason (`progressNoEffectReason`).

**The decks recycle and there is no discard pile.** A played or discarded card
goes face down **under its own stack**, so it comes back round only after every
card above it has been drawn. The engine keeps each deck in two parts: the shuffled part
(`Ext.Decks`, drawn at random) and the bottom (`Ext.Under`, a queue in the order
cards were put there). A draw takes the shuffled part while any of it is left,
then the bottom from the front. If a whole deck runs dry partway through a gate
draw, the players later in the order simply get nothing that turn: nothing is
reshuffled.

- The played and discarded events carry `under`, as does a draw that came off
  the bottom. Logs written before the field omit it and fold the old way (the
  card returns to the shuffled counts). Tested by `TestPlayedCardGoesUnderTheDeck`,
  `TestGateDrawsReachTheBottomOfTheDeck` and
  `TestOldReturnFoldsIntoShuffledDeck`.

Some cards have specific exchanges:
- **Commercial Harbor**: the card player **may** offer **each opponent 1
  resource** from the player's own hand; every opponent so offered must return
  **1 commodity of their choice** (if they have one, and they cannot refuse).
  The card player picks which resource goes to whom; the opponent picks which
  commodity comes back.
  - **The only cap is one offer per player.** You may skip an opponent you could
    afford to force (not feeding the leader is a real play) and you may stop
    early. You may not offer the same player twice, or play the card to force
    nobody while somebody affordable is holding a commodity.
    `TestCommercialHarborMayOfferASubset` covers this.
- **Master Merchant**: choose a player with **more victory points** than you,
  **look at their hand** (resources and commodities), and **take 2** cards of
  your choice. Like Spy, this is a look-then-take: the victim's hand is revealed
  only to you, then you pick.
  - **Decision:** a victim holding **fewer than 2** cards gives up all of them,
    so the card is neither voided nor refunded.
- **Spy**: look at an opponent's progress-card hand and **choose 1** to take
  (VP cards cannot be taken).
- **Deserter**: the chosen opponent **removes 1 knight of their choice**; you
  then place one of your own knights **of the same strength or lower**, your
  choice of tier among those where you still have a free piece, and it
  **inherits the removed knight's active/inactive status**. The replacement
  follows the normal placement rules; the chosen player removes their knight
  even if you cannot place one; and a mighty replacement for a removed mighty
  knight is allowed even without the matching city improvement.
  - The engine records the highest tier you can field at or below the removed
    knight as the owed ceiling (`DeserterLevel`); `CmdDeserterPlace` takes an
    optional `level` from 1 up to it, and an omitted level (every log written
    before the field, and the timeout) takes the ceiling.
  - **An active replacement may not act this turn.** It inherits the removed
    knight's status, but only knights that were active at the beginning of
    your Action phase may take an action, and this one arrived during it. It
    is placed locked, as a knight activated this turn is, and is free from the
    taker's next turn (`TestDeserterPreservesActiveStatus`).
  - **No Politics requirement.** A mighty (level 3) replacement needs no
    Fortress: that improvement gates *promotion* to mighty, never this
    placement.
  - With no free piece at any tier at or below (or no legal spot), the
    replacement is forfeited, and the opponent still loses their knight.
  - `TestDeserterReplacementTierIsTheTakersChoice` covers the choice, the
    ceiling and the refusals; `TestDeserterReplacementMatchesEveryTier` covers
    the Fortress waiver.
- **Diplomat**: remove an **open** road. A road is open when one of its ends is
  not next to one of your roads or buildings **and** it is not part of a
  continuous route connecting two of your buildings and/or knights. `openRoad` (`engine/knights/progress_play.go`) tests both clauses:
  1. **An end with none of your roads or buildings at it.** A knight does
     **not** count here. (A Rivers bridge of yours is a road segment and does; a
     ship does not, because a road and a ship join only at a building.)
  2. **Not on a route between two of your buildings and/or knights.** The road
     is closed when **both** sides reach one of your buildings or knights along
     your own roads, and an opponent's building or knight on the way breaks the
     route. In practice this is where a knight matters: a road whose only
     attachment at one end is your knight is closed when the route beyond its
     other end reaches another of your buildings or knights, and **open** when
     it does not (it trails off, or an opponent's piece cuts it).
  - `TestDiplomatOpenRoadTwoClauses` covers both clauses.
  - A road **circle** rooted at one of your buildings is not open: every road
    in it has your own roads at both ends, so the first clause fails. Islands
    gives a **ship** circle the opposite answer (open).
  - An opponent's removed road goes back to their supply and you may not put one
    of yours in its place. If the road was your own, you may immediately build 1
    road for free.
  - Ships are not covered: ours is road-only (see "Knights in an Islands
    game").
  - **Decision:** the free road **must connect to your network
    independently of the road just removed**: you may not simply put it back, or
    hang it off the gap, or the card would do nothing.

Five more carry rules worth spelling out:
- **Intrigue**: displace an opponent's knight standing on an intersection
  connected to at least one of **your** roads **or shipping routes** (the sea
  combination's blanket roads-are-ships rule).
  There is no strength requirement and you need no knight of your own; the
  displaced knight relocates by its owner's choice exactly as after an ordinary
  displacement.
- **Irrigation / Mining**: 2 grain / 2 ore for **each distinct** fields /
  mountains hex that any of your buildings borders. **A hex pays once, however
  many of your buildings touch it**, so two settlements on one fields hex pay 2
  grain for it, not 4; and a **city does not double it**, since the count is per
  hex, not per production. The engine collects the hexes in one set across all
  your buildings (`seen` in `engine/knights/progress_play.go`), and the harvest is
  capped by what the supply holds (`TestIrrigationPaysEachHexOnce`).
- **Saboteur**: every player with **as many as or more** victory points than you
  discards half their cards (rounded down). "As many as" includes a player level
  with you, not only players ahead.
- **Crane**: one city improvement for 1 commodity less. **One Crane per
  improvement**: two Cranes do not stack into a 2-commodity discount.
- **Bishop**: moves the **robber** (never the pirate) and draws 1
  random card from **each** player with a building next to its new hex, one card
  per player, however many buildings they have there. Playable only after the
  first barbarian attack, like everything else the robber touches.

## The 7-roll discard & the robber

On a 7, count your **resources and commodities together** toward the discard
limit; if the combined total is over the limit, discard **half of the combined
total** (rounded down), payable from either pool. The robber does not move or
steal until it is placed on the desert after the **first** barbarian attack;
thereafter it steals a **random card from the victim's combined resource +
commodity** hand, and any player holding either kind of card is a valid target.

## City walls

Each city may have **one** city wall, and a player may wall up to **3** cities.
Each wall lets that player keep **2 more cards** on a 7 (raising the threshold
to 9, 11, 13). Cost: 2 brick each. A walled city that is **destroyed by
barbarians loses its wall** (the +2 bonus drops with it).

## Victory

First to 13 VP on their own turn. VP sources: settlement 1, city 2, each
metropolis 2, Defender tokens 1 each, certain progress cards, and the
Merchant token (1 while held). No Largest Army, no Longest Road change (Longest
Road still exists and is worth 2).

## Compatibility

The lobby enforces this table; `engine/compat.go` is the resolved matrix and
`engine/compat_test.go` holds the two to each other.

| With | Allowed | Notes |
|---|---|---|
| Islands | Yes | Knights travel roads and ships, chase the pirate at a sea intersection, and the sea scenario's own target rules are recorded in "Knights in an Islands game" above. |
| Fishermen | Yes | The 7-fish rung becomes one progress card of the discipline you name, and the 2-fish removal waits until the barbarians have landed once. See `scenarios.md`. |
| Caravans | Yes | The vote is bid in brick and lumber instead of wool and grain, and the pairing plays to 15. See `scenarios.md`. |
| Rivers | Yes | Knights cross bridges as roads, the Diplomat may not touch a bridge, and 5 coins keep a city the barbarians would pillage. See `rivers.md`. |
| Raiders | Yes | Raiders replaces the riders and the deck, and **this expansion's barbarian fleet does not sail at all** in that pairing, so the Knights robber, the Defender of the Realm points and the Bishop go with it. See `raiders.md`. |
| Wagons | Yes | Knights inherit the drive-off role, this expansion's progress cards replace the wagon deck, and the pairing plays to 15. See `wagons.md`. |
| Harbormaster | Yes | The only expansion that can lower a seat's harbour points: a pillaged harbour city drops from 2 to 1, on somebody else's turn. See `harbormaster.md`. |
| Explorers | Yes | The only partner that standalone takes. Cities come back beside harbour settlements, setup places a city first and the harbour settlement second, knights are confined to their island and barred from the fog's edge, the barbarians count cities only, four progress cards are reworded (the Bishop simply activates the pirate ship), the Aqueduct still never pays on a 7, and the pairing plays to 22. See "Knights in an Explorers game" in `explorers.md`. |

## Engine conformance

- Setup places a round-2 **city** (`SetupRound2City` hook) with city-based
  starting production; commodity production mapping and amounts; three
  improvement tracks with cumulative commodity costs; metropolis at level 4,
  steal at level 5, +2 VP, gated on having a free (non-metropolis) city, with the
  **interactive** placement of the metropolis city (`CmdMetropolisPick`).
- Event die rolls **every** turn including a 7; barbarian advance/attack with the
  strength/defense/defender/downgrade resolution above, the no-settlement-supply
  laid-on-side rule, the per-tied-player **interactive** deck choice
  (`CmdDefenderDraw`, current-player order), and the per-loser **interactive**
  city sacrifice (`CmdBarbarianDowngrade`, simultaneous); the **owner**
  picks which city burns.
- Knights: build/activate/promote (one promotion per knight per turn)/move
  (passing own pieces)/displace (owner relocates along their own continuous
  routes via `CmdRelocateKnight`)/chase; freshly-activated lock that clears next
  turn; mighty needs Politics 3; deactivate after an attack; block roads.
- With Islands: knight movement and relocation walk **roads and ships**, joining
  only at the owner's own buildings; a move may end on a sea intersection but a
  build may not; a knight anchors a ship end, so a ship it stands on cannot be
  moved; a knight on a sea intersection chases the **pirate**. See "Knights in an
  Islands game" for what is not modelled.
- Commodity maritime trade (`CmdCommodityTrade`), Merchant-token 2:1, Merchant
  Fleet over resources **and** commodities, Merchant Guild "any other".
- Finite commodity stacks (`knights.Ext.CommoditySupply`, `CommodityPerType`), drawn
  down by production and both supply-trade routes and paid back by improvements,
  over-limit discards and the give side of both routes; player-to-player transfers
  leave them alone. The shortage rule is applied on the **decide** side, in the
  production hook, so the resulting event records how much was withheld
  (`short`) and the fold stays a pure ledger move: logs written before the field
  existed omit it, decode it as 0, and replay to exactly the state they always
  did. Trades the relevant stack cannot cover are refused with
  `ErrComSupplyEmpty`, an error frame rather than a paused game. Conservation
  (stacks + every hand == the starting count) is asserted at every step of every
  simulated game in `sim/`.
- **Knight piece limits** (2 per level, six in all) are enforced, on building and
  on the destination tier of a promotion.
- A player may hold **several metropolises**, one per discipline, each on a
  different city. There is no per-player cap.
- Robber and knight-chase steal from the combined resource+commodity hand.
- Progress decks, hand limit 4 with on-turn reconcile deferred to end of Action
  phase; gate draws and tied-defender draws in current-player order.
- City walls +2 discard threshold each (max 3).
- No dev cards, no Largest Army, target 13.
- The event die resolves **before** production and the 7-discard: every roll
  folds its event-die events (incl. a barbarian landfall) onto a throwaway copy
  first, so a city pillaged on that roll produces as a **settlement** (not a city,
  and no commodity), and a city wall pillaged on a 7 lowers the owner's discard
  threshold that same roll.
  - **Known deviation, interactive sacrifice only:** that ordering holds for a
    sacrifice the attack event resolves itself (a sole sacrificable city, and
    every log written before the choice existed). When the loser holds two or
    more cities, the razing waits on their command, which necessarily lands
    after this roll's production and discard requirement, so the sacrificed
    city produces once more and its wall still counts toward the threshold on
    that roll. The engine cannot pause mid-command for a player, and a
    heuristic pre-pick could contradict the player's choice.

