# Explorers rules spec

Original description of the Explorers expansion: a home island, a fog of
face-down hexes that ships reveal, cargo ships carrying settlers and goods,
pirate lairs to storm, fish shoals to work, spice villages to befriend, and gold
as a second currency. costan ships Explorers as **one toggle**: the exploration
core plus all three missions (pirate lairs, fish for the council, spices) are
always on together, which is the expansion's own final and complete scenario.

Explorers is not a layer on the base game the way Islands and Knights are. It
**replaces** large parts of it, so this spec states the subtractions first and
then describes the whole system rather than only the differences.

## What Explorers takes away

Gone for the whole game. None of these are options:

- **Development cards.** No deck, no knights, no Largest Army.
- **Cities.** A settlement never upgrades to a city; it upgrades to a **harbour
  settlement** instead.
- **The robber.** A 7 moves a *pirate ship* on the water instead.
- **Longest Route / Largest Army.** Both special cards are out, so there is no
  route length to compute and roads and ships never form a shared network.
- **Harbours (ports).** There are no 2:1 or 3:1 dock ratios on the coast. Bank
  trade is a flat 3:1 for everyone, everywhere (see [Trade](#trade)).
- **The desert.** Explorers has no robber to park, so a dead hex is only dead.
  The home island is dealt producing terrain only.

What replaces them: harbour settlements, ships with a hold, settlers, crews,
gold, three mission tracks, and roughly two thirds of the board face down at the
start.

## Components

Per player. These counts are mechanics, not stock levels; the small ship supply
is what forces the recycling rule below.

| Piece | Per player | Notes |
|---|---|---|
| Settlement | 5 | 1 VP each |
| Harbour settlement | 4 | 2 VP each, upgrades a coastal settlement |
| Road | 15 | as in the base game |
| Ship | 3 | free-moving cargo vessel, not a connector |
| Settler | 2 | large cargo; becomes a settlement overseas |
| Crew | 9 | small cargo; storms lairs, befriends spice villages |
| Pirate ship | 1 | at most one pirate ship is on the board at a time |
| Mission marker | 1 per track (3) | position on a mission track |

Shared supplies:

- **Pirate lair tokens: 6**, one per gold field, face down over that hex's
  number chit.
- **Fish hauls: `players + 2`.**
- **Spice sacks: one per player per spice farm**, so `6 × players` overall,
  dealt onto a farm when it is revealed.
- **Gold coins.** Treated as unbounded.
  - **Decision:** gold has no supply limit. A shortage would break the "you
    received no resources, take 1 gold" consolation, which must always pay.
- **Bonus VP tiles: 3**, one per mission, 1 VP each: *Greatest Pirate Scourge*,
  *Best Fisher*, *Greatest Spice Merchant*.

## Deriving the map from a generated board

An Explorers map has a framing ocean, a starting island, two regions of
face-down hexes, and a Council hex. Every one of those features is derived from
the seed. This section is the whole derivation; given the game's public seed
and the player count, the layout is fixed.

### Board size

Explorers implements `BoardRadiuser`. It needs a home island, a ring of home
waters, a large unexplored pool and open sea, which does not fit inside the
radius the player count would normally imply.

```
Explorers radius = board.RadiusFor(players) + 3
```

so radius **5** (91 hexes) for 2 to 4 players, **6** (127) for 5 to 6, and
**7** (169) for 7 to 10. All three are far under `ValidateLayout`'s 300 playable
tile cap.

**Decision:** Explorers refuses preset and user maps. `ValidateMap` rejects a
game that pairs the `explorers` ruleset with an authored board. The layout is not
just terrain: it is a partition of the board into home island, home waters and
two unexplored regions, plus a per-region chit stack and a hidden pool order.
None of that survives a share code, and reshaping an authored map is ruled out
by `docs/maps.md` ("a module may not delete another module's feature"). A
curated Explorers map would need its own schema.

### The rim, the home island and home waters

Let `R` be the Explorers radius and `interior = HexesInRadius(R-1)`. Positions are
given in the **doubled-axial** coordinates `engine/board` already uses for its
float-free geometry: `X = 2q + r` (horizontal position, so a constant `X` is a
vertical column of hexes) and `Y = r` (the row). West is small `X`, north is
negative `Y`.

1. **The rim.** Every hex at distance exactly `R` becomes `Sea`. This is the
   framing ocean, and it keeps the home island off the board boundary.
2. **The home island.** Let `L = ceil(7 × players / 2)` (14 land hexes at 4
   players, 21 at 6, 35 at 10).
   Order the interior hexes by the key `(X, |Y|, Y)` and take the first `L`. That
   is: westmost column first, and within a column from the equator outward, north
   before south. The result is one contiguous, vertically centred landmass
   anchored at the west of the board, with a ragged east coast wherever the last
   column is only partly filled.
   - The island keeps the terrain and number chits the generator dealt it,
     including the red-number adjacency rule. Any desert among those `L` hexes is
     re-dealt as a producing terrain from the seed (Explorers has no robber, see
     above).
3. **Home waters.** Every interior hex adjacent to the home island but not part
   of it becomes `Sea`. Because the ring is a full hex thick, both endpoints of
   any island coastal edge are corners only of home-island or home-water hexes,
   never of an unexplored hex, so every coastal edge of the island is legal for
   a ship at setup.
4. **The unexplored pool.** Every interior hex that is neither home island nor
   home waters. It is placed **face down**.

Everything not in the pool is public from the first turn. Nothing in the pool is,
not even its terrain distribution beyond the guarantees stated below.

An unrevealed pool hex is masked to the wire-only `fog` resource by the
`MaskBoard` hook; there is no face-down tile asset. How the renderer draws one
is below.

### How an unrevealed hex is drawn

`frontend/src/lib/board3d/layers/fog.ts`, and one draw block in `Board3D.tsx`
beside the beaches. Two halves:

- **A blank slab.** A `fog` hex draws `tiles/generic.glb` at LAND scale, with
  the lattice gutter and the ring of beach any land hex gets. That is the same
  per-hex override mechanism the Caravans oasis uses (`TileArt` in
  `layers/caravans.ts`: `files` says which model, `land` says the hex is drawn
  as land whatever its resource reads), and `Board3D` merges the two maps before
  a tile is instanced. Without the override, `RESOURCE_FALLBACK` would draw
  `fog` as sea, with a coastline around it, and a reveal would grow land out of
  open water. About four pool hexes in five turn out to be land (a region is
  nine specials, three of them shoals, one sea hex in sixteen, and producing
  land for the rest), so land-shaped is the better guess.
- **A bank of cloud on top of it.** Faceted low-poly puffs: squashed,
  flat-shaded icosahedra, opaque, lit by the board's own rig and casting its
  shadows, which is how every prop on the shipped tiles is built. Per fog hex,
  a flat floor pad (plus six small ones toward the corners) and a cluster of
  billows on it (a core, a crown of three, two tufts), hashed off the hex's
  coordinates for variety and riding a slow swell across the board so the bank
  rolls. Where two fog hexes meet, a flat pad bridges the gutter, and where
  three meet, a pad covers the junction, so the unexplored region reads as one
  cloud bank rather than a honeycomb. Two instanced draws for the whole board,
  static, in the cached board like any other scenery.

Three properties are required, and `layers/fog.test.ts` asserts each:

1. **It leaks nothing.** The server never sends what is under a fog hex, so the
   renderer can only leak it by reading something that correlates with it. The
   bank is a function of which hexes are fogged (public,
   `ViewExt.fog`) and of their coordinates, and of nothing else: the test
   repaints every non-fog hex with other terrains and other numbers and requires
   the cloud to come out identical. The cloud is opaque geometry, so there is no
   zoom at which it thins and no alpha to audit.
2. **It stays off the coast.** Every puff that belongs to a hex holds
   `FOG_EDGE_CLEARANCE` inside the slab on all six sides, measured on the
   hexagon against the worst case of its jitter, for every hex of a ten-player
   board. The coast of the unknown is where a ship explores from and where the
   explore target is drawn. The bridges are the one exception, and they only
   ever cover an edge or a corner fogged on every side, where the rules forbid
   a road, a settlement or a ship anyway.
3. **It never hides the next hex's number.** A puff of top h hides
   (h - chip) / tan(elevation) of board behind it, and the camera never goes
   below `MIN_CAMERA_ELEVATION_DEG`; `fogSightReach` does that sum for every
   puff and the test holds it short of the nearest point of a neighbour's chip.

**Reveal.** A reveal changes the tiles, which rebuilds the board's static half
(tiles, beaches, gutter, cloud) and nothing else. The rig is keyed on the
board's shape (`boardShapeKey`), not its terrain, so a reveal does not reset
the renderer or the camera.

**Framing.** The rim (every hex at distance R, always sea) is fitted by its hex
centres rather than its corners (`explorersFrame` in `layers/explorers.ts`), so
the opening view does not spend a ring of the screen on empty water; every
place a piece can stand on the rim is still in frame.

### The two regions

The unknown is split into two regions, each with its own chit stack and one of
each spice village: the doubled spice advantages depend on owning a crew in
*both* copies of a village, and the fish shoals need six distinct die faces
spread over two ends of the map.

**Decision:** the pool is split about the board's equator:

- `Y < 0` → the **north region**;
- `Y > 0` → the **south region**;
- `Y == 0` (the equator row) → dealt one at a time in ascending `X` to whichever
  region currently holds fewer pool hexes, north on a tie.

The equator is dealt rather than assigned by sign because every pool hex on
that row is east of the island, so a sign rule would hand all of them to one
region. Dealing by current size keeps the two regions within one hex of each
other, which matters because each region carries a fixed nine special hexes.

### What is in a region

Each region gets, from the seed:

- **3 gold fields**, each covered by a face-down pirate lair token.
- **3 fish shoals** (water). The north region's shoals carry the numbers **1, 2,
  3** and the south region's **4, 5, 6**, one each, assigned within the region
  from the seed. Six shoals match the six faces of the single fishing die.
- **3 spice farms**, exactly one of each village: **Swift Voyage**, **Pirate
  Bonus**, **Fast Gold**. Both copies of a village therefore exist and both are
  reachable, as the doubled advantage rule requires.
- **Sea**: `max(1, round(regionSize / 16))` hexes, about 1 in 16. A revealed sea
  hex pays 2 gold and opens a lane.
- **Producing land**: every remaining hex of the region, dealt from the seed with
  the generator's usual resource weights. There is no desert.

The nine special hexes are placed first, from the seed, subject to one
constraint: **no two of the nine may be adjacent.** Three gold fields in a
clump would put a region's whole share of the pirate-lairs mission in one
corner, and two adjacent spice farms or shoals would let one ship work both
from a single position. Where the constraint cannot be satisfied (a region too
small to hold nine mutually non-adjacent hexes, which no supported player count
produces) it is relaxed one violation at a time, cheapest first, as the base
generator relaxes the red-number rule.

### Number chits for revealed land

Each region owns a **face-down chit stack**, shuffled from the seed, with one
chit per producing-land hex and one per gold field in that region. A chit is
drawn from the stack of the region the hex belongs to at the moment the hex is
revealed (for a gold field, at the moment the lair is captured and the token
flips).

- The stack is dealt from the base generator's number distribution for that many
  chits, with **2 and 12 removed**. New land you have to sail to and settle
  should be worth settling, so the region stacks carry only mid numbers.
- **Decision:** the red-number adjacency rule does **not** apply to revealed
  hexes. It cannot: a chit is dealt before anyone knows what the neighbouring
  face-down hexes are, and re-checking on every later reveal would mean rewriting
  chits already in play. The home island is generated under the rule; the new
  world is not.

### The Council hex

**Decision:** the Council hex is the home-waters hex with the greatest `X`,
breaking ties by smallest `|Y|` then smallest `Y`: the middle of the island's
seaward coast, reachable from every seat's starting harbour settlement and on
the way to the unknown rather than behind it.

- It is a **sea hex** for every purpose: ships move on its edges, no building
  stands on it, and its edges and corners are buildable only where they are
  shared with a land hex.
- It is in home waters, so it is adjacent to the home island, so **no pirate ship
  may be placed on it**, by the general rule.
- **Two of its corners are anchors.** Let `d` be the hex direction from the Council
  hex toward the home island's centroid, and number its corners `v0..v5` so that
  `vi` is the corner between the neighbours in directions `i` and `i+1`. The
  anchors are `v(d+1 mod 6)` and `v(d+4 mod 6)`: the opposite pair flanking the
  Council's seaward face. With the island due west, they are the north and south
  corners. A ship **docks** when either of its two ends is an anchor corner. Two
  opposite anchors give ships from the north and from the south a berth each.

### The rim, item by item

| Feature | costan |
|---|---|
| The starting island's outer coastline | the `Sea` rim at distance `R`, plus home waters |
| Outer sea routes | ordinary sea edges on the rim, with no special status |
| Pirate ships on the rim | **Decision:** allowed. The rim is made of real sea hexes with real sea routes, so exempting it would invent a safe highway. The one placement ban is no pirate ship on a sea hex adjacent to the home island. |
| The three mission tracks | not board features. Mission position is player state and the tracks are UI. |

### What the seed owes the audit

The whole derivation above runs off the public seed at game creation, so
`replay(eventLog)` reproduces it and the fairness audit can check it. Two
consequences for the implementation:

- Reserve **new, unused `seq` values** in `rngFor(seeds.Public, seq)` for the
  region assignment, the special-hex placement, the shoal numbering and the two
  chit stacks. Never re-derive an existing stream and never touch the `seq*φ+1`
  formula (`docs/dice.md`).
  - **Decision (implementation):** six slots, not four (the terrain deal, which
    also re-deals a desert on the home island, takes one of its own), reached
    through a new optional interface. `SetupBoard` is handed one `*rand.Rand`
    and a stream cannot be reached from another stream's generator, so the
    module takes the public seed instead, through `engine.BoardSeeder`.
    The slots are registered in `engine/seeds.go` as `ExplorersBoardSeqs`, and
    the dice the module rolls during play (the fishing die, the chase, the lair
    battle) take a descending run of their own, `ExplorersDieSeq`, one slot per
    log position.
- The pool's contents are **hidden state, not secret derivation.** The layout is
  computed at creation and stored; the redactor is what keeps it hidden. Every
  unrevealed pool hex must be sent to every client as `fog` (the wire-only
  resource `MaskBoard` substitutes; see the board derivation above) with no
  terrain, no chit and no region contents, and a reveal is an event carrying just
  that hex. This is the same discipline as a hand of cards: the engine holds the
  truth, the client is never trusted with it, and the audit can confirm after
  the game that the board it was dealt matches the seed.

## Setup

Board first (above), then:

1. Every player takes **2 gold**.
2. **First round, in turn order:** each player places a **harbour settlement**
   with no road, on any coastal intersection of the home island. Any coastal
   intersection is legal.
   - **Decision:** our island is fully ringed by home waters, so every coastal
     intersection faces open sea and none is excluded.
3. **Second round, in reverse turn order:** each player places a **settlement**
   with no road, anywhere on the home island under the usual distance rule. The
   distance rule applies between all pieces placed so far, harbour settlements
   included.
4. **Third round, in turn order:** each player places one **road** on an edge
   touching their settlement, and one **ship** carrying a **settler** on a sea
   edge touching their harbour settlement.
5. Each player collects one resource per producing hex adjacent to their
   **settlement**. The harbour settlement pays nothing at setup.

Every player therefore opens with 3 VP of the 17, one road, one loaded ship and
2 gold.

With Knights the first two rounds swap pieces: a city first, in turn order, and
the harbour settlement second, in reverse (see rule C under
[Knights in an Explorers game](#knights-in-an-explorers-game)).

## Turn structure

Three phases, in this order, and they are one-way doors:

1. **Production.** Roll two dice, everyone collects.
2. **Action.** Trade and build, in any order, as often as you can pay for.
3. **Movement.** Move ships, load and unload, explore, land settlers, fight
   lairs, fish, trade for spices.

You may not build or trade in the Movement phase and you may not return to the
Action phase once you have entered Movement. The one resource spent in Movement
is wool for extra movement points, and the one currency spent is gold, for
tribute. Everything else in Movement is free.

**Ruling:** a piece bought in the Action phase is usable in the same turn's
Movement phase. Buy a settler, load it, sail, and found a settlement, all in one
turn. The reverse does not work: you cannot upgrade to a harbour settlement
during Movement, because that costs resources.

## Production phase

- A producing hex pays **1 resource per settlement and 1 per harbour settlement**
  adjacent to it. There are no cities, so nothing pays 2.
- A **captured** gold field pays **2 gold per adjacent building** of its owner. An
  uncaptured gold field has no visible number and pays nothing.
- **If you received no resource cards from the roll, take 1 gold.** Gold is not a
  resource, so a player whose entire income that roll was gold from a gold field
  still takes the consolation gold.
- The base game's bank shortage rule is unchanged for resources. Gold is
  unbounded, so a gold field never short-pays.
- **Decision:** a 7 pays no consolation gold. The consolation is a
  production-phase rule and a 7 is not a production; otherwise the whole table
  would gain a coin on the roll meant to hurt.

### Rolling a 7

1. Every player holding more than 7 resource cards discards half, rounded down,
   of their own choice. **Gold is never counted, never discarded and never
   stolen** except by the one route below.
2. The player who rolled **activates their pirate ship** (see
   [The pirate ship](#the-pirate-ship)).

## Action phase

### Trade

- **With other players:** any mix of resources and gold, both ways.
- **With the bank:** 3 identical resource cards buy **1 different resource card
  or 1 gold**. This flat 3:1 replaces the base 4:1 and every port; there are no
  ports.
- **Gold to resources:** **twice per turn**, 2 gold buy any 1 resource of your
  choice.
- **Fast Gold** (spice advantage, below): once per Action phase, sell 1 resource
  for 1 gold; twice with both villages.
  - **Ruling:** Fast Gold is *in addition to* the two 2-gold purchases, not
    instead of them. A player with both Fast Gold villages may sell two resources
    for gold and buy two resources with gold in the same Action phase.

### Building costs

| Build | Cost | Limit |
|---|---|---|
| Road | 1 lumber + 1 brick | 15 |
| Settlement | 1 lumber + 1 brick + 1 wool + 1 grain | 5 |
| Harbour settlement (upgrades a coastal settlement) | 2 grain + 2 ore | 4 |
| Ship | 1 lumber + 1 wool | 3 |
| Settler | 1 lumber + 1 brick + 1 wool + 1 grain | 2 |
| Crew | 1 wool + 1 ore | 9 |

### Roads and settlements

- Both may be built only on **explored** land, and never on an edge or an
  intersection **shared with an unexplored hex**. An explored hex beside the fog
  is partly buildable: the corners and edges it does not share with the fog are
  open, the ones it does share are closed.
- **Roads never explore.** A road pointing into the fog reveals nothing. Only
  ships explore.
- A settlement still needs the distance rule and a connecting road of your own,
  with one exception: a settlement founded from a settler ship needs only the
  distance rule (see [Founding a settlement overseas](#founding-a-settlement-overseas)).
- No road or settlement may be built on a **gold field** until its pirate lair is
  captured.
- No road or settlement may be built on a **spice farm** until **you** have
  placed a crew there. This is per player, not per farm: a farm is open to the
  players who befriended it and closed to everyone else.
- **Ruling:** the first building in a region is necessarily a settler landing,
  because a road network cannot cross water. This is not a separate rule; it
  falls out of connectivity. Once you have one settlement in a region, you may
  expand there by road and settlement normally, or keep landing settlers.

### Harbour settlements

- Worth **2 VP**. Replaces one of **your** coastal settlements (one adjacent to a
  sea hex): return the settlement piece to your supply and put the harbour
  settlement on the same intersection.
- Four per player, ever. They are the largest single block of VP in the game and
  the cap is what keeps the target reachable but not automatic.
- A harbour settlement is otherwise **an ordinary settlement**: it produces 1
  resource, it counts for the distance rule, and roads may be built from it.
- It has a **basin** with the same capacity as a ship's hold: 1 large piece
  (settler, fish haul) **or** 2 small pieces (crews, spice sacks).
- **Ships may only be built adjacent to your harbour settlements.** A plain
  settlement on the coast is not a shipyard. This is the reason to build them
  overseas as well as at home.

### Ships

- Placed on a **sea edge** (one bordering at least one sea hex, so coastal edges
  count) with room on it, one of whose ends is the intersection of one of your
  harbour settlements.
- **Never** on an edge with an end at a corner of an unexplored hex.
  - **Ruling:** building there would immediately reveal the hex, and the reveal
    trigger is a ship *end* at a corner, so the test is on corners, not on the
    edge's ownership. There is always at least one legal placement at a coastal
    intersection of the home island: for an edge between a home-island hex and a
    home-water hex, both endpoints are corners of home-island and home-water
    hexes only, never of the pool.
- Ships are **not connectors**. They do not link to roads, they do not form a
  network, they do not block, and they contribute to nothing that is scored.
- **Coastal edges hold a road and ships at the same time.** Up to one road plus
  up to two ships may share a coastal path.
  - **Ruling:** this is the opposite of the Islands rule, where a coastal edge
    holds a road **or** a ship and never both. Islands ships are territory;
    Explorers ships are vehicles and do not claim the edge they sit on, so
    edge-occupancy code shared between the two modules would get this wrong.
- **Recycling.** If you want to build a ship and all 3 are on the board, you may
  return any one of your ships to your supply first. Anything it was carrying
  goes back to its own supply and is lost. Then pay and build the new ship beside
  a harbour settlement as usual. This is how a ship stranded in the wrong ocean
  gets home.

### Settlers and crews

- A settler or a crew is placed, when bought, into an **empty slot** of one of
  your harbour settlements, or into an **empty slot of one of your ships that is
  adjacent to one of your harbour settlements**. A settler needs both slots; a
  crew needs one.
- Never onto land. Settlers and crews move only by ship; they cannot walk.
- If every slot in your harbour settlements and their adjacent ships is full, you
  may **discard** one piece from one of them to the supply to make room. Only
  when everything is full.

## Movement phase

### Moving ships

- Each ship has **4 movement points**. One MP moves it from its current sea edge
  to an **adjacent** sea edge, where adjacent means the two edges share an
  endpoint. A sea edge is any edge bordering at least one sea hex, so a ship may
  run along a coast. Direction is free, including doubling back onto an edge it
  has already used this turn.
- **1 wool buys +2 MP** for one ship, once per ship per turn. Pay separately for
  each ship you want to speed up.
- **Swift Voyage** crews add +1 MP to all your ships, or +2 with both villages,
  and apply the moment the crew lands.
- Maximum possible: `4 + 2 (both Swift Voyage) + 2 (wool)` = **8 MP**.
- Up to **2 ships may share a sea edge**, in any mix of owners. A ship may move
  *past* a full edge but may not **end** its movement on one.
- **Finish one ship before starting another.** Movement is not interleaved.
- Ships do not block each other and there is nothing to cut off.

### Cargo: holds, basins and transfers

A ship's hold and a harbour settlement's basin each hold **1 large piece
(settler, fish haul) or 2 small pieces (crews, spice sacks)**.

Transfers cost **no MP** and may happen in the middle of a ship's movement, after
which the ship keeps moving with whatever MP it has left:

- **Ship ↔ your harbour settlement**, when either end of the ship is the harbour
  settlement's intersection. Loading, unloading and **swapping** are all allowed.
  A swap is one transfer (a load or unload carrying `back`, what travels the other
  way), checked on both sides as they stand after the exchange. It has to be one
  command: a ship carrying a settler beside a basin holding two crews has no free
  slot on either side, so no sequence of one-way transfers can exchange them
  (`TestFullHoldAndBasinSwap`).
- **Ship ↔ an explored hex**, when either end of the ship is a corner of that
  hex, and only to do one of the jobs the hexes support: unload a crew onto an
  uncaptured pirate lair or onto a spice farm, take a spice sack from a farm you
  are befriending, load a fish haul from a shoal, pick a crew back up from a
  captured lair, or land a settler as a settlement.
- **Ship ↔ ship is not allowed directly.** Pass the piece through a shared
  harbour settlement instead: both ships touch the same harbour settlement, one
  unloads and the other loads.
- Crews and sacks may not be unloaded onto ordinary land. There is nothing to do
  there.

### Exploring

- **The trigger:** after every single movement point, if either end of the ship
  that just moved is a corner of an **unexplored** hex, that hex is revealed. It
  is mandatory. You cannot decline to look.
- **Revealing ends that ship's movement immediately.** Any remaining MP is
  forfeited, including MP bought with wool. Other ships are unaffected.
- **Decision:** if both ends of the ship touch unexplored hexes, or one end
  touches two, **every** such hex is revealed, in ascending axial coordinate
  order, each paying its own reward, and then the ship stops. Revealing only
  one would leave the other unrevealable from that position, since moving away
  and back reveals nothing new. There is no one-hex-per-ship-per-turn limit.
- **What a reveal does**, by hex type:

  | Revealed as | Board effect | Reward to the explorer |
  |---|---|---|
  | Producing land | draw the top chit of that region's stack, face up | 1 resource of that terrain |
  | Sea | nothing | 2 gold |
  | Fish shoal | nothing (its number was fixed at setup) | 2 gold |
  | Gold field | place a face-down pirate lair token over its chit | 2 gold |
  | Spice farm | place 1 spice sack per player on the hex | 2 gold |

- A revealed hex is public to everyone from that moment.
- **A ship can never be stranded inland**, with no extra rule. Both
  endpoints of any edge of an unexplored hex are corners of that hex, and so is
  every endpoint shared with an edge a ship could have come from. So the reveal
  always happens one step *before* the ship could occupy that hex's edges, and
  the ship stops there. A ship therefore only ever moves onto an edge whose hexes
  it can already see, and an edge with land on both sides is simply not a sea
  edge and is never a legal destination.
- **Ruling:** a discovery ends *movement*, not the turn and not the ship's other
  work. A settler ship that reveals an island may land its settler on that
  island's corner in the same Movement phase, and a ship that reveals a spice
  farm may unload a crew onto it, because loading, unloading and landing cost no
  movement points.

### Founding a settlement overseas

When one of your ships is carrying a **settler** and either end of the ship is a
corner of an **explored land hex**, you may found a settlement on that corner:

- Return **both the settler and the ship** to your supply. The ship is spent; it
  is not left behind, and the settler figure comes back to its owner's supply of
  two rather than being consumed: it is a transport marker replaced by a
  settlement piece, so overseas expansion is not capped at two settlements.
- The **distance rule applies** as always.
- The corner must not be shared with an unexplored hex, and the hex's other build
  restrictions apply (an uncaptured lair or an unbefriended spice farm is
  closed).
- No further cost. The settler was the cost.

**Ruling:** a settler carried on a ship is worth **no VP**. Only settlements,
harbour settlements, mission position and the three bonus tiles score.

## The pirate ship

Each player owns one pirate ship, but **at most one pirate ship stands on the
board at a time**, whoever it belongs to.

### Activation

The player who rolled a 7, after all discards, resolves exactly one of:

- no pirate ship on the board → **place yours** on a legal hex;
- your own pirate ship on the board → **move it** to a **different** legal hex;
  it may not stay;
- an opponent's pirate ship on the board → **return it to its owner**, then place
  yours on a **different** legal hex.

**Every activation goes somewhere new.** The pirate goes to a different sea hex
in both the second and the third case, and a won chase activates your pirate
ship as a 7 does, so the hex the chased ship stood on is closed to yours too
(`pirateLeaves` in `engine/explorers/rules.go`,
`TestDisplacedPirateMovesHex`). There is no exception. The
Knights Bishop activates the pirate ship, so it follows this section as a 7
does (see rule H
under [Knights in an Explorers game](#knights-in-an-explorers-game);
`TestBishopActivatesPirate`).

A legal hex is any **revealed** sea hex, fish shoals included, **except a sea hex
adjacent to the home island** (which is every hex of home waters, and therefore
the Council hex too). The rim is legal; see
[The rim, item by item](#the-rim-item-by-item). An unrevealed pool hex is
never legal, whatever it turns out to be.

Then **steal 1 random resource card** from a player who has a ship on an edge of
that hex. If several qualify, you choose which one. If the player you choose has
no resource cards, you may take **1 gold** from them instead. If nobody has a
ship on that hex, there is no steal. Buildings are irrelevant to the pirate; only
ships are.

Placing a pirate ship on a fish shoal **removes any fish haul sitting there**,
back to the supply, and blocks a new haul from being placed while it stays.

### Tribute

While an opponent's pirate ship sits on a hex, you pay **1 gold to the supply for
each of your ships that moves onto, off of, or along any edge of that hex**.

- Once per ship per turn. Having paid, that ship may use those edges freely for
  the rest of the turn, including leaving and returning.
- **Building** a ship on one of those edges is free. The tribute is on movement,
  never on construction.
- The pirate's owner never pays.
- **Ruling:** a player who will not or cannot pay simply **may not use those
  edges** this turn. Tribute is not a debt and there is no forced sale.

### Chasing it away

During your Movement phase you may try to drive off an opponent's pirate ship
with your **battle-ready** ships. A ship is battle-ready if:

- it has **not moved yet this turn**, and
- one of its ends is a corner of the pirate ship's hex.

Roll one die per battle-ready ship. A **6** succeeds, and so does the number on
each Pirate Bonus village where you have a crew. So the north village
(5) alone wins on **5 or 6**, the south village (4) alone on **4 or 6**, and both
on **4, 5 or 6**. On a success, return the pirate ship to
its owner and immediately **activate your own pirate ship**: place it on a legal
sea hex and steal, exactly as on a 7.

- **Decision (implementation):** the event records the first round of dice and
  the hero, not every reroll of a tie. A replay folds the recorded outcome and
  re-rolls nothing; no rule or client reads the tie-break sequence. The
  tie-break loop is bounded and falls back to the lowest tied seat, so a
  pathological stream cannot hang a fold.
- **Decision:** the player nominates the order in which their battle-ready ships
  roll, and **rolling stops as soon as the pirate is driven off** (your own
  newly placed pirate ship is not a target for your own ships). The order is
  part of the command because it is observable through the RNG stream.
- A ship that rolled may still move afterwards, successfully or not.
- If the chase failed, tribute applies to those ships as normal. If it succeeded,
  the pirate on the board is now yours and you never pay tribute to it, so the
  rest of your Movement phase is free of it.
- Every die rolled here comes from the game's seeded stream, like the production
  dice. A chase is a real, auditable roll.

## Missions

All three missions run at once. Each has its own track and its own bonus tile.

### The mission tracks

Each track is a start space **S** followed by **7 spaces**. Every player begins
with one marker on `S` of each track. Progress moves a marker forward one space
at a time; a marker never moves backward.

VP by position:

| Space | S | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| VP | 0 | 1 | 1 | 2 | 2 | 2 | 3 | 3 |

- Markers **stack**. A marker moving onto an occupied space goes on **top** of
  the stack; the order records who arrived first.
- The player **farthest along** each track holds that track's **bonus VP tile**
  (1 VP). If the leading space holds a stack, the marker at the **bottom** keeps
  the tile, because it got there first. The tile moves the instant someone
  overtakes.
- **Decision:** progress beyond space 7 is discarded. A marker on space 7 that
  earns another advance stays where it is and scores 3. Staying on space 7 still
  holds the bonus tile against a challenger.
- Maximum mission VP for one player is therefore 3 + 3 + 3 = 9, plus the 3 bonus
  tiles.

### Pirate lairs

Every gold field is revealed with a **pirate lair** on it: a face-down token
covering its number chit. Until the lair is captured the hex produces nothing and
nothing may be built on it.

**Capturing.** A crew is unloaded onto the hex from a ship with an end at one of
the hex's corners. When the **third** crew stands on the hex the lair is
captured. Those crews may belong to one player or several, placed on different
turns.

- **Decision:** crews may keep arriving after the third and before the battle is
  resolved, and they count. Resolution waits until the end of the active
  player's Movement phase so the player can finish moving; the hex never closes
  at three. Only the active player can add them, because only the active
  player moves ships.

**Resolution**, once the active player has finished their Movement phase:

1. Starting with the active player and going clockwise, every **involved** player
   (one with at least one crew on the hex) takes **2 gold** and advances **1
   space** on the pirate lairs track.
2. Every involved player rolls **1 die** and adds the number of their own crews
   on the hex. Highest sum is the **hero of the battle**.
   - Tie → the tied player with **more crews** on the hex is the hero.
   - Still tied → the tied players reroll, repeating until one is strictly
     highest.
3. The hero advances **1 more space** and returns **1 of their crews** from the
   hex to their supply.
4. Flip the lair token to reveal the hex's number chit. The gold field now
   **produces 2 gold per adjacent building**, and roads and settlements may be
   built on it.

Surviving crews stay on the hex and may be picked up by a ship on a later turn,
by anyone who owns them. A sole attacker who placed all three crews is trivially
the hero: 2 gold and 2 spaces, and one crew back.

### Fish for the council

- **Once during your Movement phase**, before or after moving one of your ships
  and not in the middle of one ship's move, you may **roll 1 die**. The roll is
  always accepted; a ship already under way has its move ended, so nobody reads
  the die and then chooses where to finish sailing
  (`TestFishRollNotMidVoyage`). Loading a haul costs no movement, so a
  ship that is already beside the shoal still takes the catch. If the result
  matches the number of an **explored** fish shoal, place a fish haul on that
  shoal. Nothing happens if the number belongs to an unexplored shoal.
- No haul is placed if that shoal already has one, if a pirate ship is on it, or
  if the fish haul supply is empty.
- **Loading** a haul costs no MP and needs only that one end of your ship is a
  corner of the shoal hex or that the ship stands on one of its edges. A haul is
  a **large** piece: the ship must be otherwise empty. The ship may keep moving
  afterwards.
- **Delivering:** a ship end on either **anchor** of the Council hex. Return the
  haul to the supply and advance **1 space** on the fish track.
- A haul may be parked in a harbour settlement basin and picked up later by
  another of your ships.

### Spices for the council

- A revealed spice farm carries **one sack per player**.
- To take a sack, a ship with a **crew** aboard puts an end on a corner of the
  farm, **unloads 1 crew onto the farm**, and loads **1 spice sack** into the
  ship. A sack is a small piece.
- **One crew and one sack per player per farm, for the whole game.** You cannot
  return for a second sack from the same village.
- **The crew stays there permanently.** It is spent, not parked; no ship ever
  picks it up again.
- Placing the crew immediately opens that farm's edges and corners **to you** for
  roads and settlements, and immediately grants its advantage.
- **Delivering:** a ship end on either anchor of the Council hex. Advance **1
  space per sack delivered**; delivered sacks leave the game.

### Spice farm advantages

Each advantage exists once per region, so twice on the board. Holding both copies
doubles it. Advantages last the rest of the game and cannot be lost.

| Village | One crew | Both crews |
|---|---|---|
| **Swift Voyage** | +1 MP to all your ships | +2 MP to all your ships |
| **Pirate Bonus** | chase away the pirate on a 6 or the village's own number: 5 or 6 (north village), 4 or 6 (south) | chase away on a 4, 5 or 6 |
| **Fast Gold** | once per Action phase, sell 1 resource for 1 gold | twice per Action phase |

- **The number is a face, not a threshold.** The two Pirate Bonus villages are
  not interchangeable: the north region's copy shows a **5** and the south
  region's a **4**. "A 6 or the number shown on the hex" adds exactly that one
  face, so the north village alone chases on 5 or 6 and the south alone on 4 or
  6; with both you hold 4, 5 and 6. `chaseHits` in `engine/explorers/rules.go`
  is the rule (`TestPirateBonusChaseNumbers`,
  `TestSouthVillageNoChaseOnFive`).
- **Ruling:** Swift Voyage applies **immediately**, including to the very ship
  that just delivered the crew, which may continue moving with its new MP. The
  exception is a ship whose movement has already ended because it revealed a hex
  this turn: that ship is finished regardless.

## Gold

Gold is a second currency and is **not a resource card**.

- It does not count toward the 7-card discard, and it is never discarded.
- It cannot be stolen by the pirate, except from a player who has **no** resource
  cards at all, in which case the pirate's owner may take 1 gold instead.
- Sources: the consolation gold when a production roll pays you no resources;
  2 gold per building on a captured gold field; 2 gold for revealing a sea hex, a
  shoal, a gold field or a spice farm; 2 gold per involved player when a lair
  falls; 1 gold for 3 identical resources at the bank; Fast Gold; and player
  trades.
- Uses: 2 gold buy any 1 resource, twice per turn; tribute to an opponent's
  pirate ship, 1 per ship per turn; and player trades.

## Victory

**17 VP, checked at any point during your own turn**, at every player count. The
game ends immediately.

| Source | VP |
|---|---|
| Settlement | 1 each, up to 5 |
| Harbour settlement | 2 each, up to 4 |
| Mission track position | 0 to 3 per track, up to 9 |
| Mission bonus tile | 1 each, up to 3 |

Nothing else scores. There is no Longest Route, no Largest Army, no development
card VP, and a settler in a hold is worth nothing.

- **Decision:** the target does not scale with player count. The per-player
  piece supplies are identical at every count, and the mission tracks cap at 9
  whatever the table size. What scales is the board and the fish haul and spice
  sack supplies.
- **Decision (implementation): you win only on your own turn.** The base rule
  ("if you reach the target when it is not your turn, the game continues until
  any player has it on their turn") applies; see the victory check in
  `engine/decide.go`. A lair battle can push a non-active seat over 17; that
  seat banks the win, and since the check runs on every batch and `after.Cur`
  is that seat at the next turn change, the game finishes there.

## Knights in an Explorers game

`cak+explorers` is the one combination Explorers accepts. Its rules are
lettered A to J below, and the code and tests cite those letters.

Two framing facts:

- **The combination is played on the complete Explorers scenario**, which is the
  one and only thing costan's Explorers toggle is (see the top of this file).
  There is no reduced mission set to select and nothing to gate.
- **Except where noted, the rules of both expansions apply.** Everything in
  [knights.md](knights.md) and everything in this file applies unless a rule
  below changes it. The
  commodities, the three improvement tracks, the metropolises, the event die,
  the barbarian track, the progress decks, the city walls and the 7-discard all
  arrive unmodified; what changes is listed here and nowhere else.

### A. Cities come back

A settlement may be upgraded to a **city** as in the base game (3 ore +
2 grain), so cities, commodities and city improvements all work. A **coastal**
settlement therefore has a choice: it may become a city, or it may become a
harbour settlement. **The choice is one-way and terminal in both directions:**
a city never becomes a harbour settlement, and a harbour settlement never
becomes a city.

### B. One forest becomes fields on the starting island

Relative to a plain Explorers starting island, one forest becomes one fields:
Knights spends grain on activation and on every city.

The home island keeps the terrain the generator dealt it
(see [The rim, the home island and home waters](#the-rim-the-home-island-and-home-waters)),
so after the desert re-deal, the **first forest hex of the home island in
`(X, |Y|, Y)` order** is re-dealt as fields. If the island has no forest,
nothing happens. It is done in the same pass as the desert re-deal and from the
same stream, so the board stays a pure function of the public seed and the
audit port reproduces it.

The barbarian track is on screen, not on the board edge.

### C. The first setup placement is a city, the second a harbour settlement

Explorers' draft keeps its shape, with a city in place of the first settlement:

1. Every player takes **2 gold**.
2. **First round, in turn order:** each player places a **city**, with no road,
   anywhere on the home island.
3. **Second round, in reverse turn order:** each player places a **harbour
   settlement**, with no road, on a coastal intersection of the home island. The
   distance rule counts everything placed so far, cities included.
4. **Third round, in turn order:** one **road** touching the city and one **ship
   carrying a settler** touching the harbour settlement, as in plain Explorers.
5. Starting production is **1 resource per producing hex adjacent to the city**,
   one per hex even though a city normally produces two, and the base resource
   only from a commodity hex. Explorers pays its starting resources for "the
   settlement", and the city is what replaced it; the harbour settlement still
   pays nothing at setup.

Opening VP is **4** of the 22: a city at 2 and a harbour settlement at 2.

What this changes in play is who gets the best spot for what. The first pick of
the draft is a producing city spot, which is the most valuable opening in
Knights, and the harbour settlements, which decide where each player's ships
start, are chosen last and in reverse order.

`harbourRound` in `engine/explorers/decide.go` is the rule. Tested by
`TestPairingSetupPlacesTheCityFirst` and `TestPlainExplorersSetupHarbourFirst`
(`engine/ruletest/explorers_knights_combination_test.go`). A log written when the
harbour settlement came first still replays: the fold never checked which round
a piece came in.

### D. Knights

- **Knights stay on the island where they were built**, and are never carried by
  ship. This needs no rule of its own: Explorers ships are vehicles, not
  connectors, so they never join a route, and a knight moves along its owner's
  continuous routes. It moves freely along its own island's roads, with no step
  limit, as in a base Knights game.
- **Knights do not take part in missions.** A knight may not join a pirate lair
  battle, even one on the island it stands on, and may not act as a merchant at
  a spice village. Delivering fish and spice is done by ships, which a knight
  never is.
- **Knights may neither be built on, nor moved onto, an intersection adjacent to
  an unexplored hex.** This is the fog rule that already governs roads and
  settlements, extended to the piece Knights adds. It bars **both** ends of the
  action.

### E. Barbarian strength counts cities, everywhere

The barbarians' strength is the number of cities on the board (metropolises
included), on the starting island and on new-world hexes alike. Harbour
settlements are not counted.

Harbour settlements are free of the barbarians in both directions: they do not
summon them and cannot be pillaged, which makes the rule-A choice a defensive
decision as well as an economic one.

**Defense is unchanged: the summed strength of every active knight**, as in
`knights.md`, wherever on the board the knight stands. Basic and mighty knights
do not count equally, and inactive knights do not defend.

### F. Crews do not defend

Crews are cargo, not soldiers, and are never counted in the defense.

### G. Gold does not buy commodities

- When trading with the supply, gold never buys a commodity. Explorers' **2 gold
  buy any 1 resource, twice per turn** is unchanged, and it buys a **resource**
  only.
- **Fast Gold** may sell 1 resource **or 1 commodity** for 1 gold, once per
  Action phase, or twice with crews on both Fast Gold hexes.

### H. Progress cards

Four cards are reworded in this pairing.

| Card | In this pairing |
|---|---|
| **Medicine** | Upgrades a settlement to a city for 1 grain and 2 ore, **or** to a harbour settlement for 1 grain and 1 ore. The card carries both prices. |
| **Bishop** | Instead of moving the robber, it activates your pirate ship: the same activation a 7 arms, with every rule of [Activation](#activation). An opponent's pirate ship goes home and yours goes on a **different** sea hex. |
| **Deserter** | Applies only to knights. Crews cannot desert. |
| **Road Building** | Applies only to roads. It never builds ships. |

- **The Bishop has no exception.** It is exactly a 7
  (`TestBishopActivatesPirate`,
  `engine/explorers/audit_test.go`). The card steals only through the
  pirate: one card from one ship owner on the new hex, not a card from every
  neighbour as the land Bishop does.

Two cards need no rewording:

- **Mining and Irrigation** pay for each mountains/fields hex adjacent to at
  least one of your buildings, and a harbour settlement is a building; the
  cards count every building a seat owns, harbour settlements included.
- **Inventor** swaps two number discs anywhere on the board except 2, 6, 8 and
  12, with no adjacency requirement. It takes any hex carrying a number except
  those four; an unexplored hex and an uncaptured lair carry none yet, so the
  fog is excluded by that test rather than by a rule of its own.

### I. The Aqueduct never pays on a 7

The Knights Aqueduct pays 1 resource of your choice when the production roll
gives you no cards, except on a 7. That holds in this pairing too. So:

- **On a 7**, nobody is owed an Aqueduct pick and nobody takes gold, holder or
  not. The Explorers consolation gold does not pay on a 7 either (see
  [Production phase](#production-phase)).
- **On any other roll**, the two base rules run side by side, each with its own
  test: the Knights Aqueduct pays 1 resource to a holder who received **no
  cards** (no resources and no commodities), and the Explorers consolation pays
  1 gold to anyone who received **no resource cards**. A holder who received
  nothing at all takes both: 1 resource of their choice and 1 gold.

There is no code for this pairing beyond the two base rules: the Knights
Aqueduct is armed in the production batch (never on a 7) and taken by its own
later command, so it can never suppress the consolation gold. Tested by
`TestAqueductOwesNothingOnASeven` and, for the ordinary rolls,
`TestAqueductAndConsolationGoldBothPay`.

### J. Victory is 22

The pairing plays to the Explorers target plus 5. Explorers plays to 17, so
**`cak+explorers` plays to 22**, checked at any point during your own
turn.

VP sources, all of them:

| Source | VP |
|---|---|
| Settlement | 1 each |
| City | 2 each |
| Harbour settlement | 2 each, up to 4 |
| Metropolis | 2 each, up to 3 |
| Mission track position | 0 to 3 per track, up to 9 |
| Mission bonus tile | 1 each, up to 3 |
| Defender token | 1 each |
| Constitution / Printer | 1 each |

There is still no Longest Route and no Largest Army, and the target still does
not scale with player count.

### Further decisions

Questions the combination raises that the lettered rules do not settle, each a
**Decision**.

- **A knight's chase action has no target.** Knights chase the robber, and there
  is no robber. The pirate ship belongs to the Bishop and to nobody else among
  the Knights pieces, so the chase is simply **unavailable** in this pairing, and
  Explorers' own `explorers_chase_pirate` (pay tribute, or drive it off) is
  untouched and belongs to every player as it always did.
- **The Merchant token still works, on explored producing land only.** It may not
  be placed on an unexplored hex, a gold field, a shoal or a spice farm.
- **The Merchant's 2:1 sits on top of Explorers' flat 3:1**, and does not replace
  it. Explorers deletes ports, not trade rates, and the Merchant is not a port.
  (`BankRatio` composes by taking the minimum across modules.)
- **Commodities trade at 4:1, not at Explorers' flat 3:1.** Explorers' rule is
  about resource cards; Knights prices a commodity at 4:1, or 3:1 through a
  generic port, and Explorers has no ports. The trade-rate panel therefore reads
  "4:1 on everything else" with all five resources listed at 3:1.
  `TestExplorersCommodityRatioRuling` covers resource 3:1, commodity 4:1, and
  Merchant Fleet's explicit commodity discount.
- **A pillaged city becomes a settlement**, and that settlement may then be
  upgraded again, to either a city or (if coastal) a harbour settlement. Rule A's
  one-way clause bars converting a standing city, not rebuilding a razed one.
- **The barbarians never interact with the fog.** They attack cities, and a city
  cannot stand next to an unexplored hex in the first place.
- **Gold is never discarded on a 7**, in this pairing as in every other. The
  7-discard counts resources and commodities together (`knights.md`); gold is
  neither.

## Compatibility

Explorers replaces the development deck, cities, the robber, both special cards
and the entire port system, and adds a third turn phase, so it combines with
almost nothing.

**Decision:** costan ships Explorers as a **standalone ruleset** (`explorers`,
implementing `Standalone()`), not as `base+explorers`. It takes exactly one
partner. `cak+explorers` is implemented; see
[Knights in an Explorers game](#knights-in-an-explorers-game). Every other
pairing is refused, for the reasons in the table.

| Module | costan |
|---|---|
| **Islands** | Rejected. The two expansions' rules for building and moving ships are fundamentally different. Islands ships are connectors that claim an edge, block opponents and count toward the longest route; Explorers ships are vehicles that share edges with roads and each other, move 4 to 8 spaces a turn and score nothing. Both modules also own "the pirate", and they are different pieces with different rules. |
| **Knights** | **Implemented** as `cak+explorers`. See [Knights in an Explorers game](#knights-in-an-explorers-game). |
| **Fishermen** | Rejected for now. A combination is possible but the substitutions are not small: the fishing grounds would have to be placed on top of the Explorers layout, the lake would displace a home island hex, fish tiles do not satisfy the "received no resources" test so they would still pay the consolation gold, and three of the five fish spends would need redefining (**2** ignores the pirate ship instead of driving off the robber, **5** buys a free road **or ship**, **7** moves a ship a second time). Recorded for a later pass. |
| **Caravans** | Rejected. Caravan scoring pays VP for settlements between two camels and doubles camel-parallel roads for the longest route, and Explorers has no longest route to double and a 17 VP target that a second VP engine would wreck. |
| **Rivers** | Rejected. Rivers is a land-connectivity module with bridge edges and gold from river hexes; most Explorers land is face down at the start, so a river cannot be laid out at all. |
| **Raiders** | Rejected. Raiders needs a central castle and knights riding to defend it; Explorers has no fixed board, no knights of its own, and the castle would sit in the fog. |
| **Wagons** | Rejected. Wagons move goods overland to trade hexes on a land-connected map; Explorers is not land-connected, and its cargo model is the ship hold. |
| **Harbormaster** | Rejected. Harbormaster scores harbour ownership and Explorers deletes ports outright, so the variant has nothing to count. (An Explorers *harbour settlement* is a building, not a port.) |
| **Explorers** | The ruleset is `explorers`, alone. |

## Engine conformance

Board and setup:

- Explorers implements `BoardRadiuser` at `board.RadiusFor(players) + 3` and
  `Standalone()`; `ValidateMap` rejects `explorers` paired with a preset or
  user-authored board.
- The derivation produces, from the public seed alone: a `Sea` rim at distance
  `R`; a home island of `ceil(7 × players / 2)` contiguous interior hexes taken
  in `(X, |Y|, Y)` order with no desert (`X = 2q + r`, `Y = r`); a one-hex `Sea`
  ring of home waters around it; a face-down pool of everything else, split
  north/south by the sign of `Y`, with the `Y == 0` row dealt in ascending `X` to
  the smaller region.
- Each region carries exactly 3 gold fields, 3 fish shoals, 3 spice farms (one
  Swift Voyage, one Pirate Bonus, one Fast Gold), `max(1, round(size/16))` sea
  and producing land for the rest, with no two of the nine special hexes
  adjacent.
- Shoal numbers are 1/2/3 in the north region and 4/5/6 in the south, one each.
- Each region owns a seeded chit stack drawn from the base distribution minus 2
  and 12, sized to its producing land plus its gold fields, consumed on reveal.
- The Council hex is the home-waters hex with greatest `X` (ties: smallest `|Y|`,
  then smallest `Y`), is sea for all purposes, and has exactly two anchor
  corners, the opposite pair flanking its seaward face.
- Every `rngFor` stream Explorers uses is a **new, unused** `seq`.
- Setup is three rounds: harbour settlements in turn order, settlements in
  reverse order, then road plus settler-loaded ship in turn order; starting
  resources come from the settlement only; every player starts with 2 gold.

Redaction and replay:

- An unrevealed pool hex is sent to every client with no terrain, no chit and no
  region contents. Reveals are events. `replay(eventLog)` reproduces both the
  layout and the reveal order exactly.

Turn structure and economy:

- Three phases per turn (Production, Action, Movement) with no way back from
  Movement to Action.
- Bank trade is a flat 3:1 for a different resource **or** 1 gold; no ports are
  generated and `BankRatio` never returns 4:1 or a 2:1 dock rate.
- Twice per turn, 2 gold buy 1 resource; Fast Gold is additive to that.
- No resources from the roll (gold does not count) pays 1 gold.
- A captured gold field pays 2 gold per adjacent building; an uncaptured one
  pays nothing.
- Gold is excluded from the 7-card discard and from ordinary stealing.
- Five per-turn counters reset at the start of every turn and are all separately
  enforced: two 2-gold purchases, one or two Fast Gold sales, one wool MP
  purchase **per ship**, one fishing die roll, and one tribute payment **per
  ship** per opponent pirate hex.

Building:

- Costs and per-player limits exactly as tabulated: road 15, settlement 5,
  harbour settlement 4, ship 3, settler 2, crew 9.
- No development cards, no cities, no robber, no Longest Route, no Largest Army,
  and no route length computed at all.
- Nothing builds on an edge or intersection shared with an unexplored hex;
  nothing builds on an uncaptured gold field; a spice farm is buildable only by
  players who have placed a crew on it.
- A coastal edge may hold one road **and** up to two ships simultaneously. The
  Islands road/ship exclusion must not be shared with this module.
- Ships build only on sea edges with an end at one of the builder's own harbour
  settlements, never on an edge with an end at a corner of an unexplored hex;
  recycling a board ship destroys its cargo.
- Harbour settlements upgrade only the owner's own coastal settlements, produce
  1 resource, and permit roads.

Movement:

- 4 MP base, +1 or +2 from Swift Voyage, +2 for 1 wool once per ship per turn,
  cap 8. One ship completes before the next starts. Two ships per edge maximum,
  pass-through allowed, stopping on a full edge is not.
- Reveal is checked after every MP, is mandatory, reveals **every** qualifying
  hex, pays per hex, and ends that ship's movement with MP forfeited.
- Load, unload and swap (one transfer, both sides checked after it) cost 0 MP
  mid-move; ship-to-ship transfer only through a
  shared harbour settlement; large piece fills a hold, two small pieces fit.
- Founding a settlement from a settler consumes both settler and ship and obeys
  the distance rule.

Pirate:

- At most one pirate ship on the board; activation on a 7 by the roller; legal on
  any **revealed** sea hex except one adjacent to the home island; every
  activation (your own moved, an opponent's displaced, or a won chase) goes to a
  different hex from the one the last pirate ship stood on, the Knights Bishop
  included; steals from a ship owner on that hex, gold only if the
  target has no resource cards, nothing if no ship is there; removes a fish haul
  from a shoal it lands on.
- Tribute is 1 gold per ship per turn for moving onto, off, or along the pirate
  hex's edges; free to build there; unpayable tribute means those edges are
  simply unusable.
- Battle-ready = has not moved this turn and has an end at a corner of the
  pirate's hex; one die each in a player-nominated order; success on a 6, on a 5
  with the north Pirate Bonus village and on a 4 with the south one, each face
  on its own (south alone does not win on a 5; see the village table and
  `chaseHits`); rolling stops at the first success;
  success chains straight into activating the winner's own pirate ship.

Missions:

- Three tracks of S plus 7 spaces, VP 0/1/1/2/2/2/3/3, markers stack, leader
  holds a 1 VP tile, ties go to the bottom of the stack, progress past space 7 is
  discarded.
- Lair: captured on the third crew, resolved at the end of the active player's
  Movement phase, later crews still count, each involved player takes 2 gold and
  +1 space clockwise from the active player, hero by die plus own crew count with
  ties to more crews then reroll, hero takes +1 space and one crew back, then the
  chit flips and the hex produces and is buildable.
- Fish: one die roll per Movement phase, which ends the move of any ship under
  way, explored shoals only, blocked by an
  existing haul, a pirate ship or an empty supply; loading needs no MP; delivery
  at either Council anchor is +1 space.
- Spices: one crew and one sack per player per farm, crew is permanent, the
  advantage lands immediately, delivery at either Council anchor is +1 space per
  sack.

Victory:

- 17 VP at every player count, checked during the holder's turn, from
  settlements, harbour settlements, mission position and mission tiles only. A
  settler is never VP.
- **You win only on your own turn.** A lair battle that pushes a non-active seat
  past 17 banks the win: the check runs on every batch and that seat is the
  active one at the next turn change, so the game finishes there. That is the
  base rule ("if you reach the target when it is not your turn, the game
  continues until any player has it on their turn"), which no expansion here
  overrides.

