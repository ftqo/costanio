# Wagons rules spec

Own-wording description of the **Wagons** scenario: a trade-route game in which
every player owns one wagon that hauls cargo around the road network between
three trade hexes, paying road tolls in gold, working around barbarians who
squat on paths, and scoring a victory point for every load delivered.

Wagons is a **scenario**, not a layer: it replaces several base-game fixtures
(the robber, the development deck, the Longest Road award) rather than adding to
them. It is layered on the base game; only the differences are listed.

**Names.** The things a wagon hauls are called **cargo** here, never
"commodities": Knights already uses *commodity* for cloth, paper and coin, and
one of those three is called **coin**.
Knights' *coin* commodity and this scenario's **gold** are unrelated and never
interchangeable. Where both modules are in play, keep them apart by name in the
UI as well.

## What changes at a glance

- Three land hexes become **trade hexes**: a **castle**, a **quarry** and a
  **glassworks**. Each has a **plaza** at its centre where wagons load and
  unload.
- Every player owns one **wagon**, which starts on their round-2 city and moves
  along paths during a new phase at the end of their turn.
- **Gold** is a side currency (a count, not cards): it pays road tolls, buys
  resources, and is earned by delivering cargo.
- **Three barbarians** sit on paths and cost a wagon extra movement to pass.
  **The robber is out of the game entirely**; a 7 moves a barbarian instead.
- The base development deck is replaced. **The Longest Road award is not in
  play**; Largest Army still is.
- Victory target rises to **13**.

## The trade hexes

There are three, and they form a closed cycle:

| Trade hex | Accepts | Ships out |
|---|---|---|
| Castle | marble, glass | tools, sand |
| Quarry | tools | marble, sand |
| Glassworks | sand | glass, tools |

Read the other way round: **marble and glass go to the castle, tools go to the
quarry, sand goes to the glassworks**. **No trade hex ever ships out a cargo
that it also accepts** (the engine asserts this), so the load you pick up
always sends you somewhere else.

### Shape of a trade hex

A trade hex is a coastal hex whose seaward half is taken up by the building, so
its geometry is not an ordinary hex:

- A **plaza** vertex sits at the hex's centre. It is a real intersection: wagons
  stop there, and it is the only place cargo changes hands. **No settlement or
  city may ever be built on a plaza.**
- Four **spokes** run from the plaza to the hex's four **land corners** (the
  corners it shares with at least one land neighbour). Spokes are paths a wagon
  travels at the usual cost.
  **They carry no roads yet** (see the deferred board change below). Until
  `board.Vertex` gains its fourth neighbour, a spoke is an edge
  `board.Edge.Valid` refuses, so a spoke always costs a wagon the bare-path
  2 MP and pays no toll.
- The three edges the hex shares with water are **blocked**: no road, ever, and
  no wagon. The two corners that touch only those blocked edges are **blocked**
  too: no settlement or city.
- The hex's other three edges (the ones it shares with land neighbours) and its
  four land corners behave normally, distance rule included.

So a trade hex offers **seven usable paths** (three perimeter, four spokes)
against an ordinary hex's six, and **five usable intersections** (four land
corners plus the plaza, of which only the four corners are buildable).

**Decision:** the plaza is addressed as a third `Side` value on the trade hex's
own coordinate, and the four spokes as edges joining it to the four land
corners. Reason: every existing consumer of the board already speaks
`Vertex{Q, R, Side}` and `Edge{A, B}`, so a new `Side` keeps the codec, the
adjacency helpers and the replay fold in one vocabulary rather than adding a
parallel graph. `Hex.Vertices`, `Vertex.Edges`,
`Vertex.Neighbors` and the edge-ordering predicate all have to learn about it,
and the board wire format gains the trade-hex roles.

**Decision: that board change is deferred, and the plaza is a module-owned
vertex carrying the address above in the meantime.** `engine/wagons` walks its
own path graph over `board.Vertex{Q, R, 2}` and the twelve spokes;
`engine/board` is untouched. The board change widens `Vertex.Neighbors` from
three neighbours to four, which touches every consumer of the grid; taking the
address now makes that a move later rather than a rewrite. (The trade-hex tile
itself exists: a market town on the hex's own ground for each seaward
direction, with its plaza paved at the hex centre.)

Two of the rules follow from the address with no extra code:

- **No settlement or city on a plaza**, because `checkSettlementSpot` already
  refuses any vertex whose `Side` is past `board.S`, and nothing on the board
  ever produces one, so a plaza is unbuildable and unofferable without a single
  build rule learning what a plaza is.
- **No road on a spoke**, one layer down, because `board.Edge.Valid` already
  refuses an edge with an out-of-range `Side`.

The cost is that **spokes carry no roads** until the board change lands, so a
spoke always costs a wagon the bare-path 2 MP and pays no toll. This scenario
has no Longest Road award, so a spoke road would have earned only the toll and
the 1 MP, and the spokes are a handful of paths out of several hundred.

### Deriving the three trade hexes from a generated board

The three hexes are derived deterministically from the board's own shape:

1. **Candidates are cape hexes**: land hexes with exactly three non-land
   neighbours, and those three consecutive around the hex. On a procedurally
   generated board (a full hexagon of radius *R* with the frame around it) the
   cape hexes are exactly the **six corner hexes of the outer ring**, at
   `R·d[i]` for each of the six neighbour directions. Hexes another module has
   already claimed for a feature of its own are not candidates: the Raiders
   castle, the Caravans oasis and the Fishermen lake.
2. **Pick the triple whose minimum pairwise hex distance is largest.** On a full
   hexagon that is one of the two alternating triples, `{d[0], d[2], d[4]}` or
   `{d[1], d[3], d[5]}`, whose members sit `2R` steps apart; the two tie and the
   parity is broken by the seeded RNG. The three trade hexes sit on alternating
   outer corners so that the three legs of the delivery circuit are the same
   length.
3. **Assign the roles** (castle, quarry, glassworks) to the chosen three by a
   seeded permutation.

The claim depends on nothing but the board's land/sea shape and the seed.
`SetupBoard` order is a lexicographic sort of module names with no dependency
meaning, and since the derivation never reads another module's work, its
answer is the same wherever it runs in that order.

**Decision: the claim is recorded in `InitExtBoard`, not in `SetupBoard`.**
Reason: `SetupBoard` is handed a board and nothing to record into, and this
derivation changes no tile (a trade hex keeps the terrain and the number chip of
the hex it takes over, below). An unrecorded claim would be re-derived on every
replay by whatever the current binary says, breaking determinism.
`InitExtBoard`'s result is marshalled into `EvBoardGenerated` and the fold reads
the log over the derivation, so changing the rule changes new games and leaves
old ones as they were played. `SetupBoard` does one thing: it takes the robber
off the board for good.

So the claim is not visible in the board during the `SetupBoard` pass.
Caravans' oasis repair is interior-only and Islands is refused, so neither can
collide with a trade hex. Rivers could: its watercourse is painted in
`FinishBoard`, before the claim, and runs to the coast. It is handed the
**candidates** instead, through `engine.HexReserver`; see "Rivers" under
Compatibility.

**Decision:** a trade hex **keeps the terrain and the number chip of the hex it
takes over, and produces normally** for buildings on its four land corners.
Reason: blanking three outer-ring hexes would delete about a sixth of a 3-4
player board's production. As a result **the 2 and the 12 stay in the deal**,
and **no roll is ever re-rolled**, which leaves the dice stream and the
fairness audit as they are in every other ruleset.

**Decision:** a **desert** on a cape is an ordinary candidate. A trade hex keeps
the terrain it takes over, and a desert produces nothing either way. What is
vetoed is a hex another module has made a feature of its own: the Caravans
oasis and the Fishermen lake (see Compatibility).
`ruletest.TestPinnedCapeDesertMayBeATradeHex` covers this.

### Harbours on a trade hex

**Ruling (derivation 12): no harbour is stranded on a trade hex.** The base
generator lays the harbours out before the trade hexes are picked, and a trade
hex's two sea-only corners are blocked for building, so a harbour dealt on a
cape's middle seaward edge (both ends on those corners) could never hold a
settlement: useless for maritime trade and, under Harbormaster, scoring for
nobody.

Wagons' `FinishBoard` slides each such harbour one edge along the coast, onto
one of the cape's other two seaward edges, which shares one corner with it and
has its other corner on land. The first of the two in the cape's own clockwise
edge order is tried first, and the second if the first would share a corner or a
dock hex with another harbour; a harbour with nowhere legal to go stays (never on
a generated board, whose harbours sit at least two coast edges apart). It applies
to every cape Wagons could pick (`ReservedHexes`), not only the three the seed
picks, because naming the three needs this module's public slot; a harbour slid
on a cape that ends up ordinary has moved one edge and is as usable as before.
It draws nothing and is idempotent.

**Rejected:** skipping capes that carry a harbour. That leaves the triple to
whatever corners survive and breaks the equal legs of the delivery circuit.
Tests: `ruletest.TestWagonsTradeHexesStrandNoHarbour` (every Wagons ruleset,
procedural and silhouette: every harbour has a buildable corner, and the
generator's spacing rules still hold), `wagons.TestSlideCapeHarbours` (the
direction order and the two refusals, constructed).

## Setup

Base-game snake draft, with these changes:

- The **round-2 placement is a city**, not a second settlement (`SetupRound2City`).
  Starting resources are **1 card per hex adjacent to that city**, not 2, as
  under Knights.
- Each player places their **wagon on their round-2 city's intersection**.
- Each player starts with **5 gold**.
- Three barbarians are placed (below).
- **No robber is placed, at any point in the game.**
- The Longest Road award is not in play. Largest Army is.
- Each trade hex is given its own shuffled **cargo stack**.

**Decision:** a cargo stack holds 6 of each of the two cargoes that hex ships,
drawn without replacement; when a stack empties it is refilled with a fresh
shuffled 6-and-6. Reason: a four-player game can plausibly exhaust one
(thirteen VP is roughly ten deliveries a player), a ten-player game certainly
will. The intent is "this hex sends you to one of its two customers, roughly
evenly", and refilling preserves it.

**Decision: a stack's order is derived from a reserved slot on the private seed
rather than recorded in the log.** A stack is a pure function of (private seed,
which hex, how many times it has been refilled), and the fold already carries
the last two as counters. The order is the one hidden thing in this scenario,
and a stack that is never written into an event cannot be published by
accident, redacted wrongly, or reconstructed from a spectator's fold, while
staying fully reproducible.

## Gold

Gold is a **count**, not a hand of cards, and not a resource:

- It does **not** count toward the hand limit, is **not** discarded on a 7, and
  **cannot be stolen** by any effect.
- **1 gold per opponent road** is the wagon's toll (below), paid to that road's
  owner at the moment the wagon crosses.
- **2 gold buys 1 resource of your choice** from the bank, **up to twice per
  turn**, bank-limited like any other bank payout.
- Gold may be **included in player-to-player trades** on either side.
- **Maritime trade to the bank pays out in gold** at whatever rate the player's
  ports give: 4 identical resources for 1 gold generically, 3 at a generic port,
  2 at that resource's own port.
  **Ruling:** the 2:1 port does buy gold: 4:1, 3:1 and 2:1 are all able to
  receive a coin.
- **Gold is never a victory point.** No amount of it scores, and there is no
  end-of-game conversion. (The one exception is a combination: playing Wagons
  with Rivers keeps that scenario's wealthiest-settler award, which is a VP for
  holding the most gold. Standalone, gold buys things and nothing else.)

**Decision:** the gold supply is unbounded: it is a count, and a scenario whose
economy is tolls should not deadlock because the supply ran out of change.

## The wagon

One wagon per player, seat-tinted, standing on an intersection. **Wagons never
block anything and are never blocked**: any number may share an intersection,
buildings do not stop them, opposing roads do not break their path the way they
break a route, and a wagon on a path's endpoint does not stop anyone building
there.

### The movement phase

After the active player has finished trading and building, and before they end
their turn, they **may** move their wagon. Declining is always legal and ends
the turn. Unused movement points are lost; they never bank.

The phase blocks `EndTurn` until the player either moves or declines, and the
module's `Auto` for it is "decline", so an idle seat auto-passes into ending the
turn rather than stalling the table.

**While the wagon is on the move, building and trading are closed**
(`Hooks.BlocksBuildTrade`): no road, settlement, city or development card, and
no bank or player trade, from the first path, boost or drive-off attempt until
the movement action ends. The wagon's own commands (a move, the grain boost, a
drive-off, buying a resource with gold, selling for gold) and ending the turn
stay open. Without this a seat could drive one path, lay a road on the next and
cross it at 1 MP instead of 2.
**Decision:** building reopens once the action ends (a halt, or a plaza), which
is looser than a strict trade-build-move order. A road built after the wagon
has stopped is worth to it only what it would have been worth next turn, and
the baseline bot drives before it builds. Module builds that do not go through the
base build (a Rivers bridge, a Knights knight) and Road Building's free roads are
not covered by the gate.

**Decision: the phase reports no timer decision of its own.** It blocks only the
pass, so a seat in it is taking an ordinary turn on the ordinary turn timer;
reporting a `ModuleDecider` would put every turn of every game on a module cap
instead. The barbarian move is the one real interrupt here and the only thing
that reports one. A seat that runs its turn timer out gets the
decline from `Auto` and the end-turn on the tick after.

### Movement points

A wagon has a **movement point (MP) allowance** each turn, set by its upgrade
level (below). It moves from intersection to adjacent intersection along paths,
paying per path:

| Path | MP | Gold |
|---|---|---|
| No road on it | 2 | – |
| One of **your** roads | 1 | – |
| **Another player's** road | 1 | 1, to that player |
| Any of the above, **with a barbarian on it** | +2 | unchanged |

So an opponent's road under a barbarian costs 3 MP and 1 gold; a bare path under
a barbarian costs 4 MP.

- You must be able to pay a path **in full** to enter it. You may not move part
  way along a path, and unspent MP left over at the end is lost.
- **You must be able to pay the toll to use the road.** With no gold you simply
  cannot cross an opponent's road: a wagon can be walled in by other people's
  roads and no rule rescues it.
- A wagon may stop on any intersection it reaches. It **must** stop the moment
  it enters a plaza.
- **Once per movement action** you may spend **1 grain** to add **+2 MP** to the
  movement action in progress, including after spending some or all of the
  allowance. A turn normally holds one movement action, so this is normally once
  per turn; the second action a Swift Journey grants may buy it **again**, so a
  turn holds at most two.
  **Ruling:** a Swift Journey's second trip may buy the grain again: "+2 MP, up
  to 2x/turn". Engine: `EvSwiftPlayed` clears `Boosted`; tested by
  `TestGrainBuysTwoMovementOncePerTrip`.

**Decision:** the allowance scales with the board. The base numbers are tuned
to a 19-hex board, where the three trade hexes sit 4 hex steps apart; generated boards
run radius 2 at 2-4 players, 3 at 5-6, and 4 at 7-10, so the same circuit is
half again and then twice as long. Every entry on the upgrade track therefore
gains **+2 MP per ring beyond radius 2**. The grain purchase stays at +2, and
gold values, die ranges and upgrade costs do not change.

| Level | MP (r2) | MP (r3) | MP (r4) | Gold per delivery | Drives a barbarian off on |
|---|---|---|---|---|---|
| 1 | 4 | 6 | 8 | 1 | never |
| 2 | 5 | 7 | 9 | 2 | 6 |
| 3 | 6 | 8 | 10 | 3 | 5 or 6 |
| 4 | 7 | 9 | 11 | 4 | 4, 5 or 6 |
| 5 | 7 | 9 | 11 | 5 | 3, 4, 5 or 6 |

### Upgrading the wagon

During trading and building (not during the movement phase), a player may pay
for the next level on the track. The four upgrades cost, in order:

1. 1 lumber + 1 wool + 1 ore
2. 1 lumber + 1 wool + 1 ore
3. 2 lumber + 1 wool + 1 ore
4. 2 lumber + 1 wool + 1 ore

**Reaching level 5 is worth 1 VP.** Levels 1 to 4 are worth none. There is no way
back down and no way to skip a level.

### Delivering and picking up

A wagon carries **at most one cargo token at a time**, face up and public: what
somebody is hauling and where they must take it is open information, and the
only thing hidden is the order of the three stacks.

When a wagon stops on a plaza:

1. If it is carrying a cargo that **this** hex accepts, it delivers: the token
   goes face down in front of the owner and is **worth 1 VP for the rest of the
   game**, and the owner takes **gold equal to their level's delivery value**.
2. Then, if the wagon is empty, it **draws the top token of this hex's stack**
   and reveals it. That token names the wagon's next destination.
3. If it is carrying a cargo this hex does **not** accept, nothing happens. The
   movement still ends, so arriving at the wrong plaza wastes a turn.

The **first** load of the game is a plain pick-up: a wagon that has never carried
anything drives to whichever of the three plazas its owner likes, delivers
nothing, earns no gold, and draws its first token.

**Ruling:** a wagon cannot deliver at two plazas in one movement action, because
entering a plaza ends the movement. The only way to touch two plazas in a turn
is a Swift Journey card, which grants a second movement action.

### Driving off a barbarian

While its movement is in progress, a wagon standing on an intersection adjacent
to a barbarian may attempt to drive it off:

- The wagon's level must be **2 or better**. Level 1 cannot attempt at all.
- Roll one die. On a result inside the level's range (table above), **move that
  barbarian to any path on the board that has no barbarian on it**, including a
  path with a road. **No card is stolen.**
- The attempt costs no MP and does not end the movement: success or failure, the
  wagon may carry on with whatever MP it has left.
- **Each barbarian may be attempted once per turn**, so a wagon parked between
  two of them may try both.

**Ruling:** "adjacent" means the wagon is standing on one of the two endpoints of
the barbarian's path, and the attempt may be made from the intersection the
wagon starts on, any it passes through, and the one it ends on.

## The barbarians

Outside the Raiders combination there are **three**, they stand on paths, and **at most one occupies a path**.

- A barbarian **does not stop anything being built**. Roads may be built on a
  barbarian's path as normal. Its only effect is the +2 MP a wagon pays
  to cross.
- A barbarian may never stand on a blocked coastal edge of a trade hex. Its legal
  homes currently exclude interior spokes outside the Raiders combination.
  The shared Raiders placement supports those spokes explicitly.

**Decision:** there are three barbarians at every player count: one guard per
trade hex, not a function of board size. Every rule that touches them moves or
drives off one of them, so scaling the count would weaken each of those effects.

### Where they start

For each trade hex sitting at the outer-ring corner in direction `d[i]`, its
barbarian starts on the path shared by the hex at `(R-1)·d[i]` and the hex at
`(R-1)·d[i] + d[i+1]`. That is one ring inside the trade hex and one step around
it: the three positions are
symmetric under the 120 degree rotation that maps one trade hex onto the next,
and each sits astride the natural approach to its hex without blocking the plaza
itself. If a derived path does not exist or is already occupied, walk the
board's deterministic edge order from it and take the first free legal path.

### A 7 is rolled

There is no robber, so a 7 resolves like this:

1. Hexes do not produce.
2. Every player over the hand limit discards half, rounded down. **Gold is not
   counted and never discarded.**
3. The active player **moves one of the three barbarians to a path that has no
   barbarian on it**. The barbarian must end somewhere other than where it
   started.
4. If it lands on a path holding a road, the active player **steals 1 random
   resource** from that road's owner. Gold is never stolen.

## Development cards

The base deck is replaced wholesale by this scenario's deck: **16 Knight, 3 Road
Building, 3 Swift Journey, 3 Victory Point**, scaled per player bracket the same
way the base deck is.

- **Knight**: move one barbarian to a path with no barbarian on it. If it lands
  on a road, steal 1 random resource from that road's owner. Knights still count
  toward **Largest Army** (2 VP), which is the only base special card left.
- **Road Building**: 2 roads at no cost, as in the base game. Spokes are not
  targets: they carry no roads until the deferred board change lands (see "Shape
  of a trade hex").
- **Swift Journey**: after you have taken a movement action this turn, take a
  second one. **Decision:** the second action starts with a **fresh full MP
  allowance** at your current level, rather than resuming the first: the card is
  usually played because the first trip ended at a plaza. The
  second trip may buy the grain boost again: the purchase is once per movement
  action, not once per turn.
- **Victory Point**: 1 VP, held hidden until it wins the game, as in the base
  game.

**Decision: how many Swift Journeys a seat holds is public, though which base
card it holds stays hidden.** The card is a module supply shuffled into the
base deck's one draw, so the purchase produces a module event, and redaction
cannot hide an event's type: every viewer sees `wagons_swift_bought` where a
base card gives them `dev_card_bought` with the kind stripped. Since the count
is already visible from the log, the view publishes it. Which base card a seat
drew and the order of the three cargo stacks stay hidden.

Hiding the count would need the base purchase to emit one event shape whichever
half of the deck it drew from, a change to `decideBuyDevCard`'s event
vocabulary rather than to this module.

There is **no Year of Plenty and no Monopoly** in this deck. Nothing in the game
can take another player's gold.

## Victory points and the end of the game

A player scores from: settlements and cities as normal; **1 VP per delivered
cargo token**; **1 VP for reaching wagon level 5**; Victory Point cards; and
Largest Army. **No VP from gold. No Longest Road award at all.**

The game ends the instant the active player reaches the target **during their
own turn**, deliveries and the level-5 upgrade included. Base target is **13**.

## Compatibility

The lobby enforces this table.

| With | Allowed | Target | Notes |
|---|---|---|---|
| Islands | **No** | – | rule conflict, below |
| Knights | Yes | 15 | knights inherit the drive-off role |
| Fishermen | Yes | 13 | two fish spends change |
| Caravans | Yes | 15 | one camel effect goes dead |
| Rivers | Yes | 13 | crossings and bridge tolls |
| Raiders | Yes | 14 | one shared population, with per-path assignment and capture |
| Harbormaster | Yes | 14 | target +1 |
| Explorers | **No** | – | rule conflict, below |

### Islands: refused

The scenario needs **one contiguous, roughly round landmass** so that the three
legs of the delivery circuit are the same length, and it needs three coastal cape
hexes to put the trade hexes on. An Islands board is an archipelago by
construction: the derivation in step 1 above may find no cape triple at all, and
where it finds one the legs are arbitrary. Wagons cannot cross water (there are no
ferries here), and the two scenarios also disagree about the board's pieces: Wagons
removes the robber outright and Islands' pirate is a robber. Refused in
`engine.ValidRuleset`.

A sea combination is conceivable (wagons moving across sea hexes, with a
movement point and toll table for ship edges), but a procedural archipelago
cannot promise the cape triple or an even circuit, and there are no hand-built
sea maps for this scenario.

### Explorers: refused

Not combinable, on balance grounds and structurally as well: that
expansion has no robber and no ports for gold to be bought through, builds harbour
settlements instead of cities so the round-2 city that carries the wagon has no
meaning, and its own transport economy would sit on top of this one. Refused in
`engine.ValidRuleset`.

### Knights

Playable. Knights already deletes the development deck, so **this scenario's deck
is not used either**: no Swift Journey, no Largest Army (Knights has none anyway),
and progress cards do the work. The robber is out, as it is in both. In its place,
**a knight may be deactivated to drive off a barbarian** as it would chase
the robber, and if the barbarian lands on a road the acting player steals one
random resource or commodity card from that road's owner.
The knight must be active, adjacent to that path, and not freshly activated.
Chasing deactivates it and opens a mandatory barbarian destination choice. This
path action is available before the first Knights invasion: the invasion's
robber lock does not apply to a path barbarian. `EdgeBlockerTargets` and
`ChaseEdgeBlocker` compose this action without module imports. The resulting
steal samples resources and commodities together, including a commodity-only
victim. A knight may not steal from its own road.

**Gold buys resources only, never commodities.** The Alchemist may pre-set the
production roll but never the drive-off die. The word *barbarian* has two
unrelated uses here: Knights' barbarian ship still sails and still attacks on the
event die, and it has nothing to do with the three path barbarians. Target 15.

### Fishermen

Playable. Two changes:

- The **2-fish drive-the-robber-away spend is refused** (there is no robber),
  before any tile is spent, so the attempt is free. The spend tests
  `board.RobberOnBoard`, and this scenario's `SetupBoard` leaves the robber off
  for good.
- In its place, **2 fish substitute for the grain** that buys +2 MP, once per
  movement action like the grain. Implemented by the fish menu's `wagon_boost`
  action and `Hooks.FreeWagonBoost`. Fish and grain share one boost flag, so a
  trip buys one or the other, and a Swift Journey's second trip may buy either
  again. Fish are spent as whole tiles with no change. A refused
  boost spends nothing; a finished movement cannot be reopened by buying one.
- The 7-fish free development card draws from this scenario's deck.
  **Decision:** from its base-kind half only, so a free card is a Knight, a Road
  Building or a Victory Point and never a Swift Journey. The free draw goes
  through `engine.DrawDevCard`, the base deck's own entry point, and the Swift
  Journeys are a module supply shuffled into the purchase only.

**Decision:** the lake stays. The trade hexes take over outer-ring cape hexes,
not the desert, so the desert is still there to become a lake.

**Ruling (derivation 12): the lake is never a trade hex.** The generator deals
the desert anywhere, the outer corners included, and Fishermen floods it where
it lies, so without this a lake could land on a cape. Enforced from both sides,
the same way as the oasis below:

- **Fishermen moves the lake off the candidates.** Its `FinishBoard` swaps every
  lake the engine dealt on a hex `engine.ReservedHexes` names with the nearest
  interior hex (cube distance, then board order) that the engine dealt, is not
  reserved and carries no 6 or 8, drawn from Caravans' oasis sites (so one that
  can start three caravans where any can, which keeps the oasis whole under
  Caravans, where the lakes the oasis rule takes are the oases). A swap, so the
  board keeps every resource and token; nearest rather than seeded, so it draws
  nothing. The triple keeps its equal legs.
- **Wagons drops every lake from the candidates** (Fishermen implements
  `engine.TradeHexEligibility`), for the one case the swap cannot fix: a desert
  the map's author pinned on a cape, which Fishermen floods like any other.

Tests: `ruletest.TestFishermenLakeLeavesTheCapes`,
`ruletest.TestFishermenLakeIsNeverATradeHex`.

### Caravans

Playable, but only partly recommended: **there is no Longest Road award here,
so the camels' road-doubling effect is dead**. Only the between-two-camels VP
survives. Barbarians do not prevent camel placement. Target 15.

**Ruling: the oasis is never a trade hex.** The oasis is the caravans' hub and
has no trade building, and the two cannot share a hex. Enforced from both sides,
with the same reasoning as the Rivers ruling below:

- **Caravans keeps the oasis off the trade candidates.** Its `FinishBoard` repair
  reads `engine.ReservedHexes` (every cape Wagons could pick) and never promotes
  or swaps the oasis onto one, and an oasis that sits on one counts as needing
  the repair. That keeps the trade triple whole, so its legs stay 2R.
- **Wagons drops the oasis from the candidates** (Caravans implements
  `engine.TradeHexEligibility`), for the one case Caravans cannot fix: a map
  author who pinned a desert on a cape. The oasis is not the engine's to move
  there, so the triple is chosen from the remaining capes and the author's map,
  not the scenario's symmetry, decides its shape.

On generated boards the oasis never reaches a cape anyway: the repair moves an
outer-ring oasis inward, and a cape can never start three caravans (its two
sea-only corners are adjacent, so every alternating corner triple holds one).
Only authored boards change, which is why the ruling is part of derivation 11.
Tests: `wagons.TestOasisIsNeverATradeHex`,
`wagons.TestPinnedCapeOasisIsNotATradeHex`, `scenarios.TestOasisRepairAvoidsReservedHexes`.

### Rivers

Playable. Both scenarios have a purse, the wagon's gold and the river's coins,
and the combination merges them into **one purse, called coins**, and re-prices
it:

- Each player starts with **3 coins**, not the wagon's 5, plus whatever the
  river placements pay.
- A **city** placed at a river during setup pays 1 coin; upgrading to a city
  later still pays nothing.
- Building a **bridge** pays 2 coins, not 3.
- A wagon crossing a river **without a bridge** pays **3 MP**; across any bridge,
  **1 MP**; across **another player's** bridge, **2 coins** instead of the
  1-coin road toll.
- The **poor-settler** rule does not apply, because coins have become the
  wagon's fuel and being broke is already the punishment. The
  **wealthiest-settler VP is kept**, and it is the only route from this
  scenario's currency to victory points anywhere in this document.

**Ruling: a trade hex never sits on a river hex** (a hex a watercourse runs
through, the swamp estuary included), **and it is the river that moves.** Every
cape this module could make a trade hex is reserved before Rivers derives its
watercourse (`engine.HexReserver`, implemented by `wagons.ReservedHexes`), and
Rivers treats a reserved hex as one no channel may enter. The trade-hex
derivation itself is untouched: the same two alternating corner triples, the
same seeded parity, the same roles, the same barbarians, because none of them
read anything but the land mask and the seed. A river may still run beside a
trade hex, and pays its coins there as anywhere; it only never runs through one.

Without this, most `base+rivers+wagons` boards would put a trade hex on a
river, because an estuary wants the coast and a river wants its two ends far
apart, which is where the outer corners are. Vetoing river hexes from the
candidate list instead (the `TradeHexEligibility` seam) would often leave a
river across a corner of both alternating triples, forcing adjacent corners and
unequal legs, or too few candidates for the scenario at all. Moving the river
costs little: every board still carries the full Rivers `riverCount`, and the
watercourse picks its best chain from the hexes that remain.

**Decision:** the reservation is every cape (the first `maxCapes` in board
order, which is every one on a generated board) rather than the three the seed
picks, because naming the three needs the Wagons public stream and Rivers must
not read another module's reserved slot. On a generated board that keeps a
river off all six outer corners, three of which end up as ordinary hexes.
Deterministic by construction: the reservation is a pure function of the land
mask, which no finisher changes on a board Wagons can be dealt, so the painting
pass and the recorded pass agree. Derivation version 11; recorded older games
replay as they were played (the log wins) and report as unaudited.

New Rivers/Wagons games use one purse, the Rivers coin count, and one
two-purchases-per-turn counter. Wagon deliveries, road tolls and river earnings
all change that one balance, and either bank panel spends it.
`wagons_start.shared_currency` records this choice, so old logs without the
field keep their two independent balances and their historical costs. In the
multi-scenario variant with Raiders, Raiders gold stays a separate currency.

On the wire, the player-trade payload keys are:

| Ruleset | Raiders gold | Wagon purse |
|---|---|---|
| Rivers + Wagons (shared purse) | – | `coins`; `gold` is accepted as an alias, summed with `coins` and checked against the one purse |
| Rivers + Wagons + Raiders (shared purse) | `gold` | `coins` only |
| Wagons without Rivers, or an old log with two balances | – | `gold`; `wagon_gold` is accepted too, summed with `gold` |
| Wagons + Raiders, no shared purse | `gold` | `wagon_gold` only |

### Raiders

Playable, with a single neutral population shared by conquest and wagon paths.
The Raiders castle and three wagon trade hexes are distinct; trade sites remain
on the main landmass. Two figures start at the centres of the wagon castle and
glassworks, obstructing no path.

A landing or Treason move offers a free path on the receiving hex: six outer
paths on an ordinary hex, or three open outer paths plus four interior spokes
on a trade hex. A path holds at most one figure globally. Only when every path
is occupied does the incoming figure remain at the centre. A figure raises the
cost of its assigned path by two MP. Capture clears both its conquest count and
its path obstruction. Stable figure identities preserve the once-per-turn
charge limit through moves and captures.

A successful drive-off may relocate the figure to a free path of any unconquered
mainland hex except the Raiders castle. When a path touches two eligible hexes,
the player chooses which receives it. Treason likewise permits interior hexes.
Conquering a trade hex suppresses its production and prevents further landings,
but cargo delivery and pickup continue normally.

A 7 uses Raiders' discard-and-steal choice and does not move a figure. A production
roll of 2 or 12 lands one figure. There is no wagon development deck or Largest
Army; Raiders' immediate cards remain. Knights pieces, if also selected, use the
path-chase action above while Raiders' separate riders continue to fight battles.
That permanent Knights/Raiders variant is not a piece merge.

Target 14, raised to 15 when Knights is also active. Board derivation version 9
records the shared population; older recorded board blobs retain independent
populations during replay. Regression coverage is in
`engine/ruletest/wagons_combinations_test.go`.

### Harbormaster

Playable, no rule changes, target 14. The Harbormaster award works on buildings
at ports as normal; nothing in this scenario touches ports except the maritime
rate for gold.

## Engine conformance

- **Trade hexes.** Exactly three, derived from the board as cape hexes (three
  consecutive non-land neighbours), chosen as the triple with the largest minimum
  pairwise distance, parity and role assignment seeded. On a generated full
  hexagon of radius *R* they are three alternating outer-ring corners, `2R` apart.
  The claim is made in `InitExtBoard`, recorded in `EvBoardGenerated`, and reads
  no other module's state. `SetupBoard` only takes the robber off the board.
- **Trade hex topology.** Plaza vertex, four spokes to the four land corners,
  three blocked coastal edges, two blocked coastal corners. Seven usable paths,
  five usable intersections, four buildable. No settlement or city on a plaza or
  on a blocked corner; no road on a blocked edge; **no road on a spoke** until the
  deferred board change (the rules allow one); distance rule applies to
  the four land corners normally.
- **Trade hexes keep terrain and number** and produce for their land corners. The
  2 and the 12 stay in the number deal and no roll is ever re-rolled.
- **Cargo cycle.** Castle accepts marble and glass, ships tools and sand; quarry
  accepts tools, ships marble and sand; glassworks accepts sand, ships glass and
  tools. Assert the invariant that no hex ships a cargo it accepts, so a draw
  always points elsewhere.
- **Cargo stacks.** 6 + 6 per hex, drawn without replacement, refilled with a
  fresh shuffled 6-and-6 on exhaustion. Seeded from the game seed on a reserved
  stream; the carried token is public, the stack order is not.
- **Setup.** Round-2 placement is a city paying 1 card per adjacent hex; wagon
  starts on that city's intersection; 5 gold each (3 under Rivers); no robber ever
  placed; Longest Road award absent; Largest Army present.
- **Movement.** MP costs 2 / 1 / 1+1 gold / +2 barbarian; no partial
  paths; unused MP lost; mandatory stop on entering a plaza; any number of wagons
  per intersection; buildings and wagons never block; a toll that cannot be paid
  makes the path illegal rather than free.
- **MP allowance** 4/5/6/7/7 at radius 2, +2 per ring beyond it. One grain (or 2
  fish under Fishermen) for +2 MP, **once per movement action** (so twice in a
  turn with a Swift Journey), allowed after MPs are already spent.
- **Upgrades** cost 1/1/2/2 lumber with 1 wool and 1 ore each, bought during
  trading and building, one level at a time, level 5 worth 1 VP.
- **Delivery** flips the token (1 VP, permanent), pays the level's gold, then
  draws when the wagon is empty. The first load draws with no delivery and no
  gold. Arriving with the wrong cargo does nothing and still ends the movement.
- **Barbarians.** Exactly three, one per path, never on a blocked edge, never
  blocking construction. Start positions derived per trade hex at `(R-1)·d[i]` /
  `(R-1)·d[i] + d[i+1]` with a deterministic walk as the fallback.
- **Drive-off** requires level 2+, one die against the level's range, one attempt
  per barbarian per turn, from any intersection the wagon occupies during its
  movement, costs no MP, never steals, and does not end the movement.
- **A 7** produces nothing, discards normally with gold excluded, moves one
  barbarian to a different unoccupied path, and steals a resource (never gold) if
  that path holds a road.
- **Gold** is a count: outside the hand limit, undiscardable, unstealable,
  untradeable by any card effect, tradeable by agreement, 2-for-a-resource twice
  per turn bank-limited, bought from the bank at 4:1 / 3:1 / 2:1 by port. Worth no
  victory points except through the Rivers combination's wealthiest-settler award.
- **Development deck** replaced: 16 Knight (move a barbarian, steal from a road
  owner), 3 Road Building, 3 Swift Journey (a second movement action with a fresh
  allowance), 3 Victory Point. No Year of Plenty, no Monopoly.
- **The wagon phase** sits after trading and building, blocks `EndTurn`, and its
  `Auto` declines to move.
- **The winnable ceiling.** **Decision:** this scenario reports minus two for the
  Longest Road award it removes, plus one for reaching level 5, plus twelve for
  delivered tokens. The minus two is required: the base ceiling counts the
  award's two points, so without it a lobby would accept a target two points
  above what the board can pay out. The twelve is a floor rather than a maximum:
  deliveries have no component limit (a stack that empties is refilled), so the
  real bound is the game's length, and twelve is one filling of one stack, with
  headroom above the largest target this scenario names.
- **Victory** at 13, checked only on the active player's turn; 15 with Knights,
  15 with Caravans, 14 with Raiders, 14 with Harbormaster, 13 with Fishermen or
  Rivers, and Fishermen's boot still adds 1 to whichever of those applies. Two of
  those rows are this module's `TargetVPAdjuster` (Knights, Raiders: a number
  belonging to the pair) and two are summation (Caravans' +2 and Harbormaster's
  +1, each that module's own adjuster on top of this scenario's 13). Tested per
  ruleset by `ruletest.TestEveryValidRulesetResolvesItsTarget` and, for the rows a
  spec states, `ruletest.TestSpecStatedTargets`.
- **`engine.ValidRuleset` refuses `islands` and `explorers` alongside `wagons`**,
  with the reasons above.
