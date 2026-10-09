# Raiders rules spec

Original description of the Raiders scenario. Layered on the base game; only the
differences are listed. Raiders is a module (`engine/raiders`, ruleset token
`raiders`) and owns `State.Ext["raiders"]`.

Raiders turns the base game inside out. There is no robber, no Largest Army and
no base development deck. Instead a hostile force lands on the coast, hex by
hex, every time anybody builds; hexes it saturates stop producing, and buildings
it surrounds stop scoring. Seats answer by putting riders on the board and
marching them to the coast, and the arithmetic of a battle is table-wide, so
defending is usually a joint effort between two or three seats who then argue
over the spoils.

## Vocabulary

- A **raider** is a neutral enemy figure standing on a **hex**.
- A **rider** is a seat-tinted figure standing on a **path** (an edge). Riders are
  the defenders. This is the piece the Knights expansion would call a knight; the
  word is different here because both modules can be in the same game.
- **raider** and **rider** are one letter apart. Player-facing copy must always
  carry the article and the noun in full ("three raiders on this hex", "move your
  riders"), never an abbreviation, never a bare plural in a toast. Identifiers
  should follow: `Raider`/`RaiderCount` versus `Rider`/`RiderAt`, never `R`.
- A **coastal hex** is a land hex with at least one neighbouring position that is
  not land: a sea hex, or off the board entirely. Everything else is **interior**.
- **Gold** is a per-seat integer counter, not a piece. So are prisoners.

## Components & board

- One **castle hex**: neutral terrain, no number chip, produces nothing, can never
  be conquered, and is where riders enter the board.
- **Raider** figures in a shared neutral supply (see *The raider supply*).
- **Riders**, six per seat. A component limit, enforced like roads and
  settlements; a seat with all six on the board cannot place a seventh.
- **Gold**, a counter per seat. **Prisoners**, a counter per seat.
- The robber is **not in play at all**, in any combination. Neither is the pirate.
  `Board.Robber` is meaningless in a Raiders game and nothing may read it.
- The Largest Army card is **not in play** (there are no knight development cards
  to count). Longest Road is unchanged, and becomes Longest Trade Route under
  Islands as usual.

### Deriving the castle from a generated board

**Decision:** the castle takes the **centre hex** of the board (of the main
landmass under Islands, defined below), replacing whatever tile was generated
there, rather than at a corner of the outer ring. Two reasons, both following
from generated boards coming in three sizes:

1. **March time has to scale.** A rider covers 3 paths a turn, 5 if paid for, and
   dies regularly. From the centre the farthest coastal hex is `Radius` hexes
   away, so about `2·Radius + 1` paths: two turns at radius 2, three at radius 4.
   From a ring corner the far coast is roughly twice that, which is playable on
   a 19-hex board but not on the 61-hex board dealt for 7–10 seats.
2. **No seat should be structurally cheaper to defend.** A corner castle makes
   the coast beside it permanently well-garrisoned and the far coast permanently
   abandoned, and which seat gets which is decided by the seed at placement time.
   From the centre every coastal hex is within one hex of the same distance.

The castle also cannot be conquered, so a coastal castle would hand a
seed-chosen stretch of coast permanent immunity as well. At the centre that
protection is worth nothing, because interior hexes are already immune.

**Decision (implementation):** the castle is a **derived hex**, not a tile. The
board keeps whatever terrain and number the generator dealt at that position; the
module records the hex in its transported ext (as Caravans records the
oasis), makes it produce nothing through the engine's `HexInert` hook, and the
client draws the castle over it and hides that hex's number chip.

Replacing the tile with a neutral one would collide with two other modules.
Caravans picks its oasis as the first desert in board order, so a desert this
hook creates could outrank the one Caravans just repaired; under Fishermen,
where every desert has become a lake and the oasis is a lake, a new desert would
always take the oasis. And there is no free value left in `board.Resource` to
mark a castle with: the map codec reserves nibble 12 for "hex absent" and
`Border` already sits at 11, so a twelfth terrain would be misread by every
existing map code. The cost is a hex that keeps a chip nobody is shown; in
exchange Raiders reshapes no terrain any other module reads.

**Decision:** the castle is placed by a `BoardFinisher`, not by `SetupBoard`.
`SetupBoard` order is the ruleset string's lexicographic sort, so `caravans` and
`fishermen` both run before `raiders` and may already have claimed the centre for
the oasis or the lake. As a finisher, Raiders sees the finished board: it takes
the centre hex if that hex is ordinary terrain, and otherwise the nearest hex by
cube distance that is ordinary interior terrain, ties broken by ascending `Q`
then `R` (see the Caravans oasis note in `docs/engine.md`).

**Ruling (derivation 12): the castle never stands on a hex another module draws a
tile over.** "Ordinary" also excludes every hex a river runs through
(`engine.WatercourseHexes`: headwater, channel and swamp estuary) and every hex
another module reserved (`engine.ReservedHexes`, the Wagons trade-hex
candidates). The castle and a river hex are both drawn over their hex, so
sharing one would leave a gap in the river, and a watercourse often crosses the
centre. The castle moves rather than the river because Rivers can only route
round a reservation that is a function of the land mask (`engine.HexReserver`),
and the castle reads terrain. The rule is the one above applied to the smaller
set, so the castle stays central: it is always the centre or a hex of ring 1
(`ruletest.TestRaidersCastleIsNeverARiverHex`). Only when no ordinary hex is
free does it fall back to the unfiltered rule. The landmass repair and the refuge
check run before the watercourse exists and ask the unfiltered rule; a castle
that then steps off a river hex leaves that hex, productive and interior,
standing as the refuge in its place.

### Deriving the coast and the number chips

A fixed Raiders board can give *each coastal hex a different number*; the
generator cannot. There are only ten usable numbers and the outer rings hold 12,
18 or 24 hexes, so every board has duplicates on the coast.

**Ruling:** duplicates are resolved by **filling evenly, roller chooses**. When a
landing roll names a number carried by more than one eligible coastal hex, the
raider goes to one of the hexes holding the **fewest** raiders; if several are
tied for fewest, the player who rolled picks among them. It extends unchanged to
three or more hexes sharing a number.

**Decision:** the choice is only ever offered when it is real. The engine
narrows the candidates to eligible coastal hexes carrying the rolled number,
drops the conquered ones, keeps those with the minimum raider count, and places
automatically when one candidate survives. Only a genuine tie interrupts the
roller; three landings per build is enough prompting already.

**Decision:** the generated number chips are **not** reshuffled to force
distinctness, and no board is rejected for having duplicates on the coast. The
chip layout is what the fairness audit reproduces from the seed (`verify/`),
and permuting it after generation would put the port and the engine out of step.

**Decision:** a rolled number that no eligible coastal hex carries places
nothing, and is **not** re-rolled. It still counts as one of the three distinct
numbers of that attack. A roll that lands on an already-saturated hex is
treated the same way, and this keeps the attack bounded.

### The raider supply

**Decision:** the supply is `3 × (number of numbered coastal hexes at setup)`,
exactly enough to saturate the whole coast. Raiders leave the supply when they
land and do not return to it when they are captured (a prisoner is held by the
seat that took it), so the supply drains over a game and the pressure tails
off. **When the supply is empty, landings stop entirely**: no attack is rolled,
and building has no consequence for the rest of the game.

Under Knights the supply is unbounded instead; see *Compatibility*.

## Setup (overrides the base game)

1. Build the board, then place the castle as above.
2. Placement in snake order as usual, except that the **second placement is a
   city**, not a settlement, and it still pays **one** resource per adjacent
   producing hex, not two. (This matches the Knights ruleset's override; the two
   agree, so `base+cak+raiders` needs no third rule.) Under Islands a starting
   city adjacent to gold owes one free pick per adjacent gold hex, as usual.
3. Seed the coast with raiders. **Decision:** place one raider on each of the
   `max(2, round(coastalHexes / 5))` numbered coastal hexes with the **lowest dice
   probability**, ties broken by ascending `Q` then `R`. On a 19-hex board
   that typically picks the 2 and the 12 and places two raiders; on the larger
   boards it scales the seeding with the length of the coast. Landings per build
   do not scale with board size, so without this the bigger boards would start
   slower and stay slower.
4. **Decision:** the placement round does **not** trigger landings; step 3 is
   the setup seeding instead. An attack per starting city would put six to
   twenty raiders on the board before anyone has rolled.

## Turn structure

The base turn is unchanged up to the end of building. Raiders adds five things,
in this order:

1. **A landing**, immediately, each time you build a settlement or upgrade a
   settlement to a city. It interrupts the turn and is resolved before anything
   else.
2. **An immediate development-card resolution**, each time you buy one.
3. **A rider placement**, when a card that places one resolves.
4. **Rider movement**, once, after you have finished trading and building.
5. **The battle sweep**, after movement.

**Ruling:** steps 4 and 5 are strictly ordered and never interleaved. You move
*all* of your riders, and only then are *all* the battles fought. You may not
fight a battle, see the result, and then move another rider into a second one.

### 1. Landings

Each time you build a settlement or upgrade a settlement to a city, resolve a
landing of three raiders:

- Roll the two dice until you get a result that is not 7 and is not a result
  already used in **this** landing. That is one number.
- Do this three times, so a landing produces three distinct non-7 numbers.
- For each number in the order rolled, place one raider on the coastal hex it
  names, by the eligibility and tie rules above. A number naming no eligible hex,
  or only saturated ones, places nothing and is not re-rolled.
- Stop early if the supply empties mid-landing.

The dice come from the game's seeded stream like every other roll, so a replay
reproduces the landing exactly. If the supply was already empty when the build
happened, no dice are rolled at all.

**Decision:** the loop is *three distinct numbers*, not *keep rolling until
three raiders have landed*, which would not terminate once fewer than three
unsaturated coastal hexes remain.

### 2. Development cards

The base deck is not used. Raiders ships its own, bought at the usual price
(1 ore + 1 wool + 1 grain) and **revealed and resolved the moment it is bought**,
then discarded. Nothing is ever held in hand, so there are no hidden development
cards, no VP cards and nothing for Monopoly-style effects to see. You may buy
several in a turn, but each must be fully resolved before the next is bought.
When the deck runs out the discard pile is reshuffled and becomes the new deck,
so the deck is effectively infinite and its composition is a probability, not a
budget.

The composition is 14 : 4 : 4 : 4.

| Card | Effect |
|---|---|
| **Muster** (×14) | Place one of your riders on one of the castle hex's six paths. That path must not already hold a rider. |
| **Swift Rider** (×4) | You *may* place one of your riders on any path that does not already hold a rider. Optional, and not restricted to the castle. |
| **Treason** (×4) | Take 2 gold. Move 2 raiders from 2 **different** hexes onto 2 **other** unconquered coastal hexes. If fewer than 2 hexes hold a raider, take one or both from the supply instead. |
| **Intrigue** (×4) | Remove 1 raider from a hex of your choice and add it to your prisoners. If no raider is on any coastal hex, discard this card and draw another. |

**Ruling:** Treason may only place raiders on **coastal** hexes. It cannot seed
the interior, which would otherwise be a way to conquer a hex the landing rules
can never reach.

**Decision:** a Muster with nothing to place (no rider left in your supply, or
all six castle paths occupied) is discarded with no effect. It is not held, not
refunded and does not draw a replacement. Only Intrigue redraws, because only
Intrigue says so.

### 3. Placing riders

Riders enter only from a card. There is no resource cost to put one on the
board, which is why Muster is more than half the deck: buying development cards
*is* how you raise an army here.

A path may hold at most one rider. Riders and roads coexist on the same path
freely, in either order, and neither blocks the other. Riders never affect the
distance rule, never block a settlement, and never break a road.

### 4. Moving riders

After you have finished trading and building, you may move each of your own
riders once.

- Base allowance is **3 paths**. Paying **1 grain** raises **that one rider** to
  **5 paths**. The grain is paid per rider, so speeding up three riders costs
  three grain.
- **Ruling:** movement passes freely through everything. Other riders (yours or
  an opponent's), roads, settlements and cities do not block a rider in transit.
- A rider may not **end** its move on a path that already holds a rider, nor on
  one of the castle hex's six paths. It may pass through them. Otherwise a
  castle rider could step one path round the ring, count as moved, and stay
  (`TestNoRiderEndsItsMoveAtTheCastle`).
- **Decision:** riders move only on paths with at least one adjacent land hex.
  A path between two sea hexes is not a path a rider can stand on or cross.
- Conquered hexes do not impede movement. Raiders standing on a hex do not
  impede movement either. Rivers do not impede movement (see *Compatibility*).
- **Ruling:** a rider placed at the castle **must** be moved off, and it moves in
  this phase, on the turn it was placed. It does not wait a turn.
- After you finish moving, **none of your riders may be on a path adjacent to the
  castle hex**. Ending the turn is refused while one is, so the castle is a
  gateway rather than a garrison.
- **Decision:** if a castle rider has no legal destination (every path within
  its allowance already holds a rider), it stays, and the turn may end. Deleting
  the piece, or freezing the turn, would punish a seat for placements it does
  not control.

### 5. The battle sweep

Check every coastal hex once, in a fixed order. A hex is a **victory** when it
holds at least one raider and the riders on its six adjacent paths **outnumber**
them.

**Decision:** the sweep order is ascending `(Q, R)` over coastal hexes, not
clockwise round the coast: under Islands the coast can be several disjoint
loops, and "clockwise" is then undefined. Order matters (a rider can die in one
battle and be missing from the next), so it must be total, deterministic and
reproducible from the log, which ascending `(Q, R)` is.

Battles are resolved **one at a time, in full**, including losses, before the
next hex is checked.

**Ruling:** every seat's riders count, whoever's turn it is. The sweep is
automatic, not an action, and the active player cannot decline a battle or choose
which hexes to check. A seat can be handed prisoners on somebody else's turn
without doing anything.

**Ruling:** a rider that survives a battle stays on its path and **may fight
again in the same sweep**, for an adjacent hex checked later. A rider removed as
a loss cannot.

#### Resolving a victory

Every raider on the hex is removed from the board and becomes a **prisoner**.
Prisoners never return to the supply. The **involved** seats are those with at
least one rider on the hex's six adjacent paths, and the prisoners go to them:

- One involved seat: it takes all of them.
- Several involved seats, at least as many prisoners as seats: one each, in seat
  order.
- Several involved seats, fewer prisoners than seats: each involved seat rolls;
  the highest rollers take the prisoners, re-rolling ties among them. **Any seat
  that rolls and comes away with nothing takes 3 gold.**
- A prisoner left over after everyone has one goes to the seat with the **most
  involved riders**; a tie there is settled by a roll among the tied seats, and
  the losers take 3 gold each.

At most three raiders ever stand on one hex, so with two or more involved seats
there is at most one leftover, and the "most involved riders" rule never has to
run twice. Rolls come from the seeded stream; who physically rolls is not
modelled.

**Two prisoners are worth 1 VP.** A single prisoner is worth nothing at all:
not half a point, including when working out who is leading. That matters
wherever a rule targets the leader (the old boot under
Fishermen, Master Merchant and Wedding under Knights): a seat sitting on an odd
prisoner is not "half a point" ahead of anyone.

#### Reconquest

A victory on a **conquered** hex un-conquers it: its number chip turns face up,
it produces again, it can be landed on again, and any adjacent conquered
buildings stand back up.

#### Losses

After **each** victory, roll one die. Its face names one of the three **edge
directions** of the hex grid: the castle hex's six paths carry the six die faces,
and the roll picks the path with that face together with the path opposite it,
which is the same direction twice. In implementation terms the direction is
`(die - 1) mod 3`.

Each direction is struck with probability one third, so the labelling of faces
is arbitrary: `(die - 1) mod 3` pairs 1&4, 2&5 and 3&6.

Every rider that was **involved in that victory** and stands on a path of that
direction is returned to its owner's supply, and its owner takes **3 gold** for
each one. Riders elsewhere on the board are untouched, whatever direction they
face.

**Ruling:** losses are settled immediately after the battle that caused them, not
batched at the end of the sweep. A rider lost at one hex is not available to
defend the next one checked.

## Conquered hexes

A coastal hex holding **three** raiders is **conquered**.

**Decision:** conquest is a derived predicate (`raiders on hex == 3`), not a
stored flag, so every rule that adds or removes a raider updates it
automatically and there is no second copy to fall out of step.

A conquered hex:
- produces nothing, on any roll;
- receives no further landings;
- refuses every **build** on its six adjacent paths and six adjacent
  intersections: a new road, a new settlement, and a **city upgrade** of a
  settlement already standing there.

**Ruling:** nothing may be built on the edges or intersections of a conquered
hex. A city upgrade is a build, so it is barred too.
Engine: `Hooks.BlocksNewConstruction` is asked by the settlement spot check, by
`State.BlocksCityUpgrade` (so the city build, `LegalCities` and the Medicine
card agree, all answering `ErrBadPlacement`), and by the Knights builds below.
Tested by
`TestUpgradeIsRefusedBesideAConqueredHex` and
`TestMedicineIsRefusedBesideAConqueredHex`.

**A table with no legal build is not a deadlock.** On a small Islands main
landmass the ruling can close every settlement spot and every city upgrade at
once. The way back stays open: interior and outer-island hexes produce, gold
buys two resources a turn, the bank trades, the card musters riders, four
riders beat three raiders, and a victory un-conquers the hex and reopens its
corners. Bots must take that route (see `docs/bots.md`, Raiders).

**Under Knights**, read from the same sentence:
- a **new knight** is built on an intersection, so it is barred there, whether
  bought or placed by the Deserter;
- a **city wall** is built at the city's intersection, so it is barred there,
  whether bought or free from the Engineer (both now name the first city they
  may wall, rather than the first unwalled one);
- **moving** a knight onto such a corner, and **promoting** or **activating** a
  knight already there, are not builds and stay legal;
- a **metropolis** is placed by a city improvement, not built, and a metropolis
  is never conquered (see *Compatibility*), so it is not covered.
Tested by `TestKnightsBuildsRefusedBesideConqueredHex`.

**Ships are still allowed** on a conquered hex's edges under Islands ("the coast
is where you retreat to", in the engine's words). Whether "edges" should bar
ships too is an open question.

Roads and settlements already on those paths and intersections stay where they
are. Nothing is ever removed by conquest.

The castle hex, the desert, and (under Fishermen) the lake carry no single number
chip and can never be conquered. So can no interior hex, since landings only ever
touch the coast.

## Conquered buildings

A settlement or city adjacent to **no unconquered hex** (every neighbour is
conquered, sea, or off the board) is itself **conquered**. It is laid on its
side and left where it is.

**Decision:** like hex conquest, this is a derived predicate recomputed whenever
any hex's conquest changes. Un-conquering one hex can stand several buildings
up at once, and state that is never stored cannot be inconsistent.

A conquered building:
- is worth **0 VP**;
- produces nothing, and draws no fish under Fishermen;
- cannot use its harbour, and contributes no harbour points under Harbormaster;
- **Ruling:** still exists and still blocks. An opponent's conquered settlement
  still breaks your road for Longest Road, as an upright one does, and no
  one may build through its intersection.
- **Ruling:** no longer **joins** your own segments. Under Islands a road and a
  ship route that meet only at a conquered building of yours are two separate
  routes for Longest Trade Route, and the pieces either side of it are not "open"
  ends either.

A building touching at least one interior hex can never be conquered, since no
interior hex is ever conquered, so only the coastal fringe is ever at risk.

The road ban above settles "may I build out of a conquered settlement?" for
roads: a conquered building is by definition
surrounded by conquered hexes and water, so every path at it is either banned
already or is not a land path. Ships are the only piece that needs a rule of its
own, and Islands supplies it.

## Rolling a 7

There is no robber, so a 7 is:

1. Every player holding more than 7 resource cards returns half, rounded down, of
   their own choice. Gold is not a resource and is not counted.
2. The active player takes **one random resource card from a player of their
   choice**. Nothing is moved, nothing is blocked. If the chosen player has no
   cards, nothing is taken.

There is no production on a 7.

**The friendly robber does not apply.** There is no robber, so the lobby does
not offer the switch and the engine ignores it (`Hooks.RobberNeverInPlay`, see
`docs/rules/base.md`, "Friendly robber"). Any seat holding a card may be chosen
by the 7's take.

## Gold

Gold is a counter, and each seat's total is public.

**Decision:** the supply is unbounded. Nothing in the rules turns on running
out, and a counter has no denominations to make change with.

You gain gold from: 3 per rider of yours removed as a loss; 3 for rolling off in
a prisoner split and coming away empty; 2 from Treason; and from maritime trade.

You spend it on:
- **Buying a resource from the bank for 2 gold, at most twice per turn.** Bank
  limited: if the bank has none of that resource, the purchase is refused before
  the gold is spent.
- **Trading with other players.** Gold may be on either side of a player trade,
  in any mix with resources.

Maritime trade can also **produce** gold, at the seat's own port rate: 4
identical resources for 1 gold, 3 at a generic 3:1 harbour, **2 at that
resource's own harbour**.

**Ruling:** the 2:1 harbour **does** apply: the purchase is priced at the
general 4:1 rate, or 3:1 or 2:1 with a building at a port, and `wagons.md`
states the same Ruling for the same currency. The engine reads
`engine.State.CurrencyRatio`, the one function all three currency scenarios
price this purchase with, so a module's override of a rate reaches it too. A
harbour at a **conquered** building does not count, since that building cannot
use its harbour.

**Decision:** the maritime-to-gold trade is implemented even though it is
strictly dominated (4 resources into 1 gold is half the value of the ordinary
4:1 bank trade). It costs nothing to support, and a player who tries it should
get the rule rather than a refusal.

Gold is **not a resource**. It is not counted toward the 7-discard, it cannot be
taken by the 7-steal, and no effect that names resource cards (Monopoly-style
effects, hand-size checks, the bank shortage rule) sees it.

## Victory

- The target is **12 VP** (13 under Knights; +1 more while you hold the old boot
  under Fishermen).

**Decision (implementation):** the target is a `ConfigDefaulter` writing **12**,
not a `TargetVPAdjuster`. An adjuster moves whatever target the rest of the
ruleset produced (Harbormaster adds one point to any game); Raiders owns a
target, as Knights does, so it names one and the first writer wins.

**The 13 under Knights needs no code of its own.** `cak` sorts before `raiders`,
so Knights' defaulter has already written 13 when this module's runs, and the
first writer wins.

First-writer-wins cannot arbitrate between two scenarios that each own a target;
they resolve to whichever sorts first. Caravans is an adjuster (+2, and +2 more
with Islands), so `base+cak+caravans+raiders` is Knights' 13 plus 2. The pairing
with Wagons is named rather than sorted: `wagons.md` prices it at **14**, which
Wagons sets through its own `TargetVPAdjuster` (`base+raiders+wagons` = 14).
Harbormaster's +1 composes on top of all of it.
`ruletest.TestEveryValidRulesetResolvesItsTarget` covers every valid ruleset,
and `ruletest.TestSpecStatedTargets` covers the ones a spec states.
- Sources: settlements 1, cities 2, Longest Road 2, `floor(prisoners / 2)`
  (`floor(prisoners / 3)` under Knights), plus whatever the other active modules
  award (island VP under Islands, between-two-camels VP under Caravans, harbour
  points under Harbormaster).
- Conquered buildings contribute 0.
- No Largest Army, and no development-card VP: nothing is ever held.
- Checked on your own turn, as in the base game.

In practice buildings alone cannot get you to 12 while the coast is being
eaten, so games are decided by prisoners, which depend on two or three seats
co-operating long enough to outnumber three raiders on one hex.

## Compatibility

Raiders needs a **continuous landmass with a numbered coastline**. Every
combination below turns on that requirement.

| Module | Allowed | Why |
|---|---|---|
| Islands | **Yes**, with conditions | Wherever the board has a continuous main island. See below. |
| Knights | **Yes** | Knights replaces the riders and the deck; see below. |
| Fishermen | **Yes** | Two fish spends change; see below. |
| Caravans | **Yes** | Camels and riders share paths; see below. |
| Rivers | **Yes** | Rivers do not impede riders. |
| Wagons | **Yes** | Its own path-lurking barbarians are dropped in favour of ours; see below. |
| Harbormaster | **Yes** | Same-family variant. A conquered building's harbour scores nothing. |
| Explorers | **No** | Standalone. |

### Islands

Allowed: island boards work when they have a continuous main island, and
all-archipelago boards do not. Concretely:

- **Decision:** the **main landmass** is the largest connected component of land
  hexes; ties broken by the lowest `(Q, R)` in the component. The castle goes at
  its centre-most hex: the hex minimising the maximum cube distance to the
  component's coastal hexes, ties by ascending `(Q, R)`.
- **Decision:** Raiders' `BoardFinisher` **guarantees** the main landmass carries
  at least 8 numbered coastal hexes and a numbered, producing interior hex
  outside the castle. If either is absent, it adds the radius-two land patch
  needing the fewest new tiles (ties by centre `(Q, R)`), preserving existing
  terrain and the channels separating other islands. The patch may extend the
  footprint: small Islands boards cannot always fit a refuge inside their old
  boundary. New tiles get seeded non-red numbers and resources; the board is
  re-framed and harbours redealt along its new coast. This mirrors what Islands
  does to guarantee Caravans a neutral hex: repairing the board beats forbidding
  the pairing on a seed-dependent condition players cannot see.
- Raiders land **only** on the main landmass's coastal hexes. Building or
  upgrading on an outer island still triggers a full landing on the main
  landmass.
- Riders exist only on paths touching the main landmass. They never cross water,
  and a rider is never placed on an outer island, including by Swift Rider.
- **Neither the pirate nor the robber is in play.** Neither exists.

**Why the interior refuge (derivation 8).** Conquest ratchets: three raiders
take a coastal hex, a conquered hex refuses any new build on its six
intersections (`blocksNewConstruction`), and a building with no unconquered land
neighbour scores nothing (`buildingInert`). The only way back is winning a
battle. The design relies on interior hexes, which can never be conquered,
giving every seat somewhere that keeps producing, scoring and taking builds. A
small procedural Islands main landmass can have no interior at all; conquest
then saturates it, the table runs out of legal builds and the game cannot end.
This showed up only in rulesets containing all of `cak`, `islands` and
`raiders` (Knights' 13-point target and missing Defender points make the race
long enough), which the pairwise compatibility tables cannot express.

`BoardFinisher` therefore checks for both the numbered coast and a productive
interior refuge outside the castle. Its compact patch keeps separate islands
separate and may extend the board boundary when the carve leaves no room. This
is a generated-board adaptation, not a conquest rule; existing valid boards do
not move. The JavaScript verifier carries the same patch selection, draws,
framing and harbour placement; boards from older derivation versions replay but
report as unauditable.

The board regression covers 480 procedural boards (five player counts, three
combinations, 32 seeds), requiring a productive refuge, at least eight landing
hexes, separate islands and idempotence. `TestKnightsIslandsRaidersFinishes`
plays eight four-seat seeds for each valid superset of the triple. These are
regression samples, not a guarantee that every bot game finishes.

On an authored board whose mainland is completely enclosed by foreign land, a
separate patch may not fit. The repair leaves that board untouched; the
procedural guarantee is the one tested here.

### Knights

**Decision: the shipped pairing is a permanent local variant.**
The full piece merge is not planned. Knights remain vertex pieces on their road
network, and riders remain separate path pieces, as the client presents them.

The following paragraphs describe the **full combination design as reference**;
only the implemented rules enumerated in "What of the Knights combination is
implemented" below define the local variant. In the full merge only one
kind of knight and one barbarian system survives. Do not infer from this
reference that the omitted piece, progress-card or metropolis rules are live.

**What is dropped.** Knights' **barbarian fleet, its track, and the Defender VP
that goes with repelling it** are all out; Raiders' coast replaces that
subsystem. Raiders' **riders and its development deck** are also out;
Knights' knights and progress cards do the work.

**What that drop takes with it.** Knights keeps its robber out of play "until
the barbarians have landed once", and in this pairing they never sail, so:

- **The Knights robber is out of play for the entire game** (`robberLocked` is
  `Attacks == 0`, and `Attacks` can never rise). A 7 discards and steals by this
  scenario's own rule.
- **The Bishop can never be played**, so its two copies are **not dealt**: the
  Politics deck is built without them in a Raiders ruleset (`freshDecks`, the
  same shape as `wagons.swiftDeckFor`).
- **Defender of the Realm points are unreachable**, since no attack is ever
  repelled, and the client no longer draws the track or the column
  (`caps.hasBarbarians`).
- **The Fishermen 2-fish removal is permanently unavailable**, which is the
  refusal recorded under Fishermen below.

**Decision: no target of its own for the pairing.** It plays to Knights' 13, and
the points Raiders adds (prisoners at `floor(n / 3)`) are what replaces the
Defender VP the drop removed.

**Where the knights stand.** Recruited knights are placed on **unoccupied paths
of the castle hex**, not on intersections. For the length of a Raiders game a
knight is an **edge** piece: it does not occupy a vertex, does not block road
continuity, and is not built onto your road network. Activation, promotion and
the per-knight promotion cap are unchanged.

**Movement**, in the end-of-turn phase:
- An **active** knight moves up to **5** paths; an **inactive** knight up to **3**.
- Any path, not just your own routes. **Ruling:** a knight may move past foreign
  knights, settlements and cities.
- **Moving does not deactivate an active knight by itself.** Every knight moves 3
  paths whether active or not; an active one may continue for up to 2 additional
  paths **and is then deactivated**. So an active knight that moves three paths
  or fewer is still active and still defends.
- **Participating in a battle deactivates an active knight.**
- An active knight may **displace** a weaker opponent knight if it moves no more
  than 3 paths. **Only the weaker knight deactivates**, not both. **Ruling:** the
  displaced knight's owner puts it on the next free path.
- **Decision: none of the three rules above is implemented.** The knight half of
  this pairing is not built (see the end of this file), so these lines describe
  the full design, not what the engine plays.
- Chasing the robber is unavailable: there is no robber.

**Landings** get two extra triggers on top of build-and-upgrade:
- The event die's **ship face** places **one** raider on the coastal hex matching
  the two production dice, if it holds fewer than three. A production roll of 7
  places none.
- Each **city improvement** built places **one** raider the same way, rolling the
  two production dice immediately.
Both are single raiders, not full three-raider landings, and both stack with the
build trigger, which is not removed.

**Battles** are fought on strength, not headcount: the raiders' strength is their
number, the defenders' strength is the **sum of the levels of the active knights**
on the six paths (basic 1, strong 2, mighty 3). Inactive knights defend nothing.
A leftover prisoner goes to the seat with the highest total knight strength in
that battle.

**Losses** step down instead of dying: a basic knight goes to its owner's supply;
a strong knight is replaced by a basic one if a piece is free, else to supply; a
mighty knight becomes strong, else basic, else supply. **3 gold per knight removed
or downgraded**, the same as a rider.

**Scoring and end.** Every **3** prisoners are 1 VP, and the game ends at **13
VP**. The raider supply is **unbounded** in this combination.

> **Decision:** there is no "hand back 3 prisoners for a VP token when the
> figures run out" recycle. With a counter and a `floor(n/3)` VP rule it would
> be a no-op; the rule is simply "the supply is unbounded".

**Progress cards** with changed effects: Intrigue removes one raider from a hex of
your choice into your prisoners; Invention swaps two of the interior number chips;
Merchant is removed from the board if its hex is conquered; Treason places your
knight on the path where an opponent's knight was removed.

> **Decision:** the **Bishop** selects a hex and steals one random resource or
> commodity from each player with an **unconquered** building on it. There is
> no robber, so the hex is chosen directly rather than by moving one.

**Metropolis and walls.** A walled city is conquered normally. A **metropolis is
never conquered**; a metropolis touching only conquered hexes and the frame keeps
its 4 VP but produces neither resources nor commodities, and its discipline track
is frozen until an adjacent hex is un-conquered.

**Gold buys resources only.** It may not buy commodities, and it may not be the
output of a 3:1 or 4:1 maritime trade for a commodity.

**The 7** is Raiders' 7, not Knights': discard over the limit, then take one
random card from a player of your choice. Knights' rule about the robber staying
put until the first barbarian attack has nothing to attach to and is dropped.

### Fishermen

Allowed. Two seams:

- **The 2-fish spend is replaced rather than refused.** An effect substitutes
  for the one the missing robber takes away: 2 fish move one of your marching
  pieces up to five paths, just as if you had paid 1 grain (the same shape as
  the Knights pairing, where the 7-fish rung is replaced rather than deleted).
  **Implemented, on the rider.** The robber removal is still refused, always and
  before any tile is spent (`SPEND_UNAVAILABLE`); the substitution is the rider's
  hurry, so two fish buy **one rider's five-path move** in place of the grain: `spend_fish` with `use:
  "rider_hurry"`, `from` and `to`. It is the same move in every other respect:
  once per rider per turn, may not end on an occupied path, validated by Raiders
  (`FreeRiderHurry`) before Fishermen takes a tile, so an illegal destination
  costs nothing. A seat holding both may pay either; the rider panel and the
  move prompt offer the choice, and Strong pays in fish only when it has no
  grain and the extra two paths complete a battle (the only case it pays the
  grain for either). `engine/ruletest/raiders_fish_hurry_test.go`.
- **A fish spend may not build on the edge of a conquered hex either.** The
  five-fish road is a free-road credit placed through the ordinary road build,
  and both the build and `LegalRoads` ask `BlocksNewRoad`, so a conquered hex's
  paths refuse it as they refuse a paid road
  (`TestFreeRoadRefusedBesideConqueredHex`).
- **The 7-fish free development card works**, and draws from the Raiders deck:
  you take one card and resolve it immediately, like any other.
- **Decision:** the lake is a **permanently unconquerable** hex, like the desert
  and the castle. It carries four numbers (2, 3, 11, 12) and the landing rule
  assumes one number per hex; a lake on the coast would otherwise soak up four of
  the ten rollable numbers. Fishing grounds sit on sea hexes and are unaffected by
  anything Raiders does.
- A **conquered building draws no fish**. It produces nothing, and fish are
  production.
- The old boot raises your own target by 1, as usual: 13 here, 14 under Knights.
  Working out who is leading uses whole VP, so an odd prisoner does not count.

### Caravans

Allowed. Caravans is a target adjuster (+2, and +2 more with Islands), so the
pairing plays to **14** (16 with Islands, 15 with Knights); see *Victory*.

- **Decision:** a path may hold **a camel and a rider at the same time**. The
  camel rule bans a second camel on a path and says nothing about figures; the
  rider rule bans a second rider and says nothing about markers. They are
  different pieces, and a rider stopping a caravan from growing would let one
  seat wall off the vote's whole payoff with six pieces.
- Camels do not block rider movement and riders do not block camel placement.
- If the board's only desert is where the castle wants to go, the castle takes
  the nearest ordinary interior hex instead (the `BoardFinisher` rule above), so
  Caravans keeps its oasis.
- The camel vote runs alongside the next seat's turn as usual; a landing
  interrupt and an open vote can be pending at the same time without either
  blocking the other.

### Rivers

Allowed.

- **Decision:** rivers do **not** impede riders. River movement costs are
  written for the wagon, and a rider cost would penalise the seat whose coast
  lies across a river. Riders ford freely, and bridges are irrelevant to them.
- Bridges are edges and can hold a rider like any other path.
- The conquered-hex road ban applies to bridges too: no new bridge on a path
  adjacent to a conquered hex.
- **The castle is never a river hex** (derivation 12). It takes the nearest
  ordinary interior hex to the centre that no watercourse runs through; see
  "Deriving the castle from a generated board".

### Wagons

Allowed; the two are often played together.

- The two barbarian populations merge **per path, not per hex**: each raider
  that lands is "associated with an edge or interior path" of its hex, raising
  that one path's cost, with overflow raiders sitting at the hex centre and
  raising nothing. (Raising all six paths would make a landing six times as
  obstructive and remove the choice of which path to block.) The pairing also
  **removes Largest Army and the wagon deck**, makes a rolled **2 or 12 place a
  raider**, and sets the pairing's target at **14** (see below).
- **Decision:** the Wagons scenario's own barbarians, the ones that lurk on paths
  and are driven off by a wagon, are **not used**: two unrelated barbarian
  systems on one board would be impossible to follow or label. Raiders' raiders
  take over the role, per the per-path association above.
  The exact cost table belongs to `wagons.md`, which owns wagon movement.
- **Implemented:** conquest and path occupancy read the same recorded figures.
  Two initial figures sit at the wagon castle and glassworks centres. New
  arrivals and Treason moves choose one available path; trade hexes offer four
  interior spokes as well as their three open outer paths. Only a hex with no
  free path leaves its new figure at the centre. Captures remove the blocker.
  Drive-offs and Treason may move to unconquered interior mainland hexes, but
  never to the Raiders castle. Cargo delivery and pickup continue at conquered
  trade hexes. See `wagons.md` for the complete movement and selection rules.
- Riders and wagons coexist on a path; neither blocks the other.
- End-of-turn order when both are active: camels (if Caravans), then riders, then
  the wagon, then the battle sweep.
- **The pairing plays to 14**, `wagons.md`'s number: 14 is a rule of the pair,
  so Wagons names it through its `TargetVPAdjuster` and this module keeps the
  plain 12.

### Harbormaster

Allowed. A **conquered** settlement or city contributes **no harbour points**,
for the same reason it cannot use its harbour. Standing back up restores them,
and the card can change hands as a result of a battle three seats away.

### Explorers

**Not allowed.** Explorers is a `Standalone`: it brings its own board, its own
setup, its own pieces and its own turn structure, and there is no continuous
numbered coastline for raiders to land on, and no castle to place.

## Engine conformance

- `engine/raiders`, ruleset token `raiders`; state in `State.Ext["raiders"]`.
- Castle terrain: neutral, unnumbered, never produces, never conquered. Placed by
  a `BoardFinisher` at the board (or main-landmass) centre, falling back to the
  nearest ordinary interior hex by cube distance with `(Q, R)` ties, where
  ordinary excludes river hexes and reserved hexes (derivation 12).
- The robber and the pirate are absent from every Raiders ruleset. `Board.Robber`
  is never read.
- Coastal hex = land hex with a non-land neighbour. Landing eligibility = coastal,
  numbered, on the main landmass, not saturated.
- Setup: second placement is a city paying 1 resource per adjacent hex; setup
  seeds `max(2, round(coastalHexes / 5))` raiders on the lowest-probability
  numbered coastal hexes, `(Q, R)` ties; no landing is triggered by setup.
- Raider supply = `3 ×` numbered coastal hexes at setup; prisoners never return
  to it; an empty supply stops all landings. Unbounded under Knights.
- Landing: three distinct non-7 numbers per triggering build or upgrade; a number
  naming no eligible hex places nothing and is not re-rolled; ties among
  equally-empty candidate hexes prompt the roller, a single candidate does not.
- Conquest is derived: hex conquered ⟺ 3 raiders; building conquered ⟺ no
  adjacent unconquered hex. Neither is stored.
- Conquered hex: no production, no landings, no new road on an adjacent path, no
  new settlement on an adjacent intersection, and no city upgrade there either.
- Conquered building: 0 VP, no production, no fish, no harbour, no harbour points;
  still blocks an opponent's road; does not join a road to a ship route.
- Rider supply 6 per seat; one rider per path; riders and roads (and camels, and
  wagons) share a path.
- Movement: 3 paths, 5 for 1 grain paid per rider; passes through everything;
  may not end on an occupied path or on a castle path; land-adjacent paths only; a castle rider must
  leave this turn if any legal destination exists, and the turn is refused while
  one that could have left has not.
- Move phase fully precedes the battle sweep; no interleaving.
- Sweep: every coastal hex in ascending `(Q, R)`, one battle fully resolved
  (including losses) before the next hex is checked; every seat's riders count;
  a survivor may fight again in the same sweep, a loss may not.
- Victory: raiders ≥ 1 and riders > raiders. All raiders on the hex become
  prisoners.
- Prisoner split: sole involved seat takes all; otherwise one each in seat order;
  short splits roll off with 3 gold to each empty-handed roller; a leftover goes
  to the most involved riders with a roll-off and 3 gold to the loser.
- Losses: one die per victory, direction `(die - 1) mod 3`; involved riders on
  paths of that direction return to supply, 3 gold each.
- The Knights variants of the three bullets above (knight strength rather than
  headcount decides a battle, strength breaks a leftover tie, and knights step
  down a level instead of dying) belong to the piece merge, which is not built;
  see the end of this file.
- Reconquest: a victory on a saturated hex restores its production, its
  eligibility for landings, and every adjacent conquered building.
- Development deck: 14 Muster / 4 Swift Rider / 4 Treason / 4 Intrigue, bought at
  the base price, resolved immediately, discarded, reshuffled when empty; nothing
  held in hand. Treason places only on coastal hexes. A Muster with nothing to
  place is discarded silently; only Intrigue redraws.
- 7: discard over 7 (gold not counted), then steal one random resource from a
  chosen player; no robber move, no production.
- Gold: unbounded counter, public; 2 gold buys 1 bank-limited resource at most
  twice per turn; tradeable with players; obtainable at the seat's own port rate
  (4:1, 3:1 at a generic harbour, 2:1 at that resource's own harbour, and never
  at a conquered building's harbour); never a resource for discards, steals or
  Monopoly-style effects;
  never buys commodities under Knights.
- Victory at 12 (13 under Knights, +1 per old boot), `floor(prisoners / 2)`
  (`floor(prisoners / 3)` under Knights), no Largest Army, no development-card VP;
  a lone prisoner is worth nothing including for leader determination.
- `ValidRuleset` accepts `raiders` with any of `islands`, `cak`, `fishermen`,
  `caravans`, `rivers`, `wagons`, `harbormaster`, and refuses it with `explorers`.
- All randomness (landing dice, split roll-offs, loss dice) comes from the seeded
  stream, so `replay(eventLog)` reproduces every landing and every battle.

## Implementation decisions

Decisions the code needed that the rules above do not settle. Each is
implemented as written and tested.

**Decision:** every draw this scenario makes is on the **public** stream
(`engine.RaidersSeq`, one slot per produced event). The landing dice, the loss
die and the prisoner roll-offs are all announced to the table by the rules
themselves, and the development cards are revealed and resolved the moment they
are bought, so none of it is hidden, and a draw from the private seed would be
a visible outcome no player could re-derive. The one exception is which
resource a 7 takes, which is private and redacted.

**Decision:** the per-turn bookkeeping (which riders have moved, how much gold
has been spent on resources) is cleared by an explicit `raiders_sweep` event at
every turn end rather than by comparing a stored turn stamp. A module's view is
handed a viewer and no state, so a stamp nothing can compare against would leave
a client unable to say which riders may still move; and a module never sees a
base event, so the turn boundary has to arrive as an event of its own. The event
carries no result and the client renders no line for it.

**Decision:** a batch carrying two builds queues two landings' worth of numbers
on one event rather than opening two. Nothing in the base game produces such a
batch today; a module that does will not lose a landing.

**Decision:** the castle-rider rule is enforced through the strict `Blocks` hook
only, never `BlocksTurnActions`. A seat owing that move keeps building, trading
and buying cards; what it cannot do is pass, which is what "ending the turn is
refused while one is" says. It is also not reported before the dice are thrown,
because `AutoCommand` consults `Blocks` before it reaches the roll and would
otherwise offer a move the engine then refuses for want of one.

**Decision:** Treason names its whole plan in one command
(`raiders_treason {moves}`) rather than as a sequence of picks, and the number of
moves it must carry is derived by building the greedy plan rather than by
counting sources and destinations separately (which overstates it, because a
destination may not also be a source). The greedy plan takes a **conquered**
source first: an unconquered source uses up a destination and a conquered one
does not (`TestTreasonCountsAConqueredSourceAsFree`). The
count travels to the client as `pend.treason_count`, because the two pick lists
alone cannot say it.

**Decision:** the seven-fish free card reaches this scenario's deck through a
new additive hook (`Hooks.ScenarioCard`) rather than through the existing
`DrawProgressCard`. That one returns one event, and a deck whose cards resolve on
purchase can produce several: an Intrigue drawn with no raider to take is
discarded and redraws, which is two events and a pending. Widening
`DrawProgressCard`'s signature would change a contract Knights already
implements, so it is a second hook.

**Decision:** this module publishes no `legal` fields. Every piece it adds lives
on an edge or a hex `engine.LegalTargets` has no field for, and the offers travel
in its own view (`ext.raiders.pend`, `rider_moves`, `castle_paths`) instead,
as camel paths and fishing grounds do.

### What of the Knights combination is implemented

**Done.** Knights' barbarian fleet, its track and the Defender VP are dropped:
the event die is still rolled and recorded (it is a public derivation the
fairness audit re-derives, and skipping the roll would move every later draw in
the game) and its gate faces still deal progress cards, but the ship face
advances nothing and no landfall is ever resolved. The two extra landing triggers
are in: the ship face lands one raider on the hex the turn's own production dice
named, and each city improvement rolls the two dice immediately and lands one the
same way, both stacking with the build trigger. The target is 13, prisoners score
`floor(n / 3)`, the raider supply is unbounded, and the 7 is this scenario's.

> **Decision:** a 7 places no raider, for either extra trigger; any other reading
> would need a re-roll rule.

**Permanently omitted: the piece merge.** Knights' knights are still vertex
pieces built onto a road network, and this scenario's riders still exist
alongside them. The
full design turns knights into the path pieces in place of riders, with strength
battles (basic 1, strong 2, mighty 3), 5/3-path movement, deactivation only
beyond the third path and on taking part in a battle, displacement that
deactivates the weaker knight, and step-down losses. Strength also decides a
battle and breaks a leftover prisoner tie under that merge. That would be a
rewrite of `engine/knights`'s knight subsystem from vertices to edges, which is
outside the local variant. Also omitted: the changed progress-card effects (Intrigue,
Invention, Merchant, Treason, Bishop), and "a metropolis is never conquered".

So `base+cak+raiders` today is a coherent, playable ruleset with one barbarian
system rather than two; it is a local variant, not the full combination.

### What the client does not draw yet

A conquered building is not drawn lying on its side. The engine publishes the
conquered hexes in `ext.raiders.conquered`, and whether a building is conquered
follows from them, but the module's view is handed a viewer and no state
(`ViewExt`), so it cannot compute the per-vertex answer, and the rule should not
be re-derived in TypeScript. Publishing it needs a game-layer seam that hands a
module the state when the view is built; until then the board shows the
conquered hexes and the scoreboard shows the count.

