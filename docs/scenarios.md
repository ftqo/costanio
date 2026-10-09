# Scenarios (on a standard board)

A loose collection of mostly independent scenario variants. costan implements
only those that work on a standard, procedurally generated board; each ships
as its own small module (ruleset strings `"base+fishermen"`, `"base+caravans"`,
`"base+harbormaster"`, and they compose:
`"base+fishermen+caravans+harbormaster"`).

Some scenario variants are built around fixed, hand-drawn boards and are not
implemented:

- ~~**A river-frame scenario**~~: now implemented as its own module (it needs
  its own terrain and piece). Its derivation removes the fixed-board dependency
  by tracing a watercourse across whatever board the generator dealt. See
  [rivers.md](rivers.md) and [rules/rivers.md](rules/rivers.md).
- **A castle-defense scenario**: needs a central castle hex and a prescribed
  inner/outer terrain layout (and replaces the dev deck).

(The trade-route scenario, **Wagons**, is implemented: its
three trade hexes need three coastal capes 2R apart rather than fixed frame
positions, and a procedurally generated hexagon has exactly six at its outer
corners. See the Wagons section below.)

See [rules/scenarios.md](rules/scenarios.md) for the mechanics costan targets.

## Fishermen

The desert becomes a lake (yields on 2/3/11/12) and up to six fishing grounds
are placed on the coast (numbers 4/5/6/8/9/10, assigned in that order, so a
short board is short from the top; every measured board places six and
`sim.TestFishGroundsCount` pins that), never on a sea hex a harbour's dock
already stands on (see `docs/rules/scenarios.md`). `Fishermen.FinishBoard`
guarantees the lake: it re-floods any desert another finisher made and, when
Islands' carve has drowned the only lake, promotes a seeded interior hex; it
does not touch authored maps.

On a matching roll, each adjacent settlement draws one fish tile and each city
two, from a finite supply of 1/2/3-fish tiles (reshuffled when empty), bounded
by a seven-token holding cap. The robber blocks the lake: `fishCatch` skips a
lake it stands on, so all four of that lake's numbers pay nothing, while a
fishing ground (a marker on water, where the robber may not go) is never
blocked. `Fishermen.SetupBoard` therefore starts the robber beside the board
(`board.OffBoard`) rather than on the lake, which is the scenario's own setup
step.

Fish are a side currency spent as whole tiles, with no change, on escalating
actions: 2 remove the robber from the board, 3 steal, 4 take a resource, 5 a
free road (or, under Islands, ship credit), 7 a dev card (or, under Knights, a
progress card of the named discipline). The 2 is unavailable while there is no
robber in play, which under Knights is until the barbarians first land; both
refusals happen before any tile is spent. One tile is the **old boot**: a held
token that adds +1 to its holder's win threshold and is passable, after
rolling, to an equal-or-better player. The wire format, the four commands and
the nine `tab_*` events are in
[protocol.md](protocol.md#scenario-commands-fishermen-caravans).

**The boot draws from the public seed and the tile mix from the private one.**
The mix is a seat's hidden information; whether the boot turned up is announced
on `tab_fish_caught` and affects who wins, so `verify/` must be able to
re-derive it. The boot reads `engine.FishBootSeq`; the mix reads
`engine.PrivateFishTilesSeq`. See `docs/dice.md`.

### What is public about a seat's fish

**How many tiles a seat holds is public; what they are worth is not.** This is
the base game's rule for cards: `hand_count` is public and the cards are not.

The tile count cannot be hidden. The number of tiles a seat draws on a roll
follows from the public board (fishing grounds and lake numbers in `ViewExt`,
public buildings, one tile per settlement and two per city). Publishing the
fish value beside that count would reveal the mix by arithmetic: one tile worth
3 is a 3-fish tile, two tiles worth 5 are a 2 and a 3.
`sim.TestFishMixIsNotPubliclyReconstructible` plays seeded games as a spectator
and fails if public state pins individual draws or seat mixes.

So a catch is logged as two halves: a public `tab_fish_caught` carrying the boot
and the number of tiles each seat drew, then one `tab_fish_gained` per drawing
seat carrying that seat's tiles with `Visible` set to that seat alone.
`tab_fish_spent` is split the same way: the action and the number of tiles it
took go to everyone, the `discard` and its `value` only to the spender. All
three events have registered redactors (`engine.RegisterRedactor`), so
`game.RedactEvent` keeps the public halves for non-parties.

Each seat's tile count survives a redacted fold because `FishExt.Tiles` is
folded from the public halves alone: `+= draws[p]` on a catch, `-= tiles` on a
spend. It cannot be counted from `Held`, which is the mix and is absent from a
redacted stream. This matters for the two paths that fold a redacted stream (a
non-participant's download of a finished public game, and an uploaded log
posted to `/frames`), where counting from `Held` would report zero fish for
every seat. On the server's own state
`Tiles[p] == tileCount(Held[p])` always, which
`engine/scenarios.TestFishTilesTrackHeldOnTruth` pins.

#### The supply snapshot is on the event and on nobody's wire

`tab_fish_caught` carries the post-draw `Supply`/`Used` snapshot, and
`applyCaught` restores it verbatim rather than deriving it from the gains: the
draw-order reshuffle is not reproducible from per-value gains, so a truth replay
needs the recorded result. **It reaches no viewer.** `EvFishCaught` is a public
event with a registered redactor: `Visible` says who may see the full payload, a
redactor says what everyone else sees, and with no `Visible` list everyone is
everyone else. Both fields are stripped before any frame is encoded.

Together they reveal the mix in aggregate. The tile set is constant, so
`sum_p Held[p][v] = fishSupply[v] - Supply[v] - Used[v]` for each value `v`: a
viewer subtracts their own mix and knows the rest of the table's holdings as one
pile (with two seats, the opponent's hand). `Used` also accumulates each spend's
discard, so `used_{k+1} - used_k` is the exact multiset a named spender handed
in.

Nothing public reads either number: `ViewExt` does not publish them, no client
uses them, and the reshuffle happens on the Decide side from authoritative
state. A redacted fold's copy of the supply is therefore stale rather than
wrong. The fields are pointers so absent can be told from zero, and
`applyCaught` keeps the supply it had rather than announcing an empty one.
`game.TestFishRedactedStreamFoldsPublicState` asserts the truth fold
restores both, and asserts only what is true of the redacted fold.

#### What is still inferable

- **The tile count.** Public by construction. It is what `ViewExt` publishes
  and what the seat rail draws.
- **A spend narrows a holding.** `spendTiles` is deterministic (minimum waste,
  then fewest tiles) and the price ladder is printed, so knowing that a seat
  paid a 4-fish price with two tiles rules some holdings out. This is the same
  residue a face-down card play leaves in the base game, and far weaker than the
  value: `engine/scenarios.TestFishSpendValueLeaksTheDiscard` enumerates what the value
  would name (the pairs 2/3, 3/4, 4/5, 4/6 and 7/9 pin the tiles exactly; 5/6
  and 7/8 leave two candidates) and documents why the value is redacted.
- **A finished game reveals everything**, as it reveals every hand:
  `game.NewRevealedReplayView` asks any module implementing
  `engine.RevealedViewable` for its per-seat halves, and `FishExt` answers with
  every seat's tiles under `mixes`.

## The Caravans

The oasis replaces the desert. Three neutral, non-branching caravans grow from
oasis spokes and merge when they meet; one camel is placed after any
build/upgrade turn via a **voting round** (reusing the generalized
pending-action machinery). Settlements or cities between two camels score +1
VP, whichever caravans the two camels came from; camel-paralleling roads (and,
under Islands, ships) count double for Longest Road. The victory target is
per-combination: 12 alone, 15 with Knights, 2 more than either with Islands.
The bid resources are per-combination too: wool and grain, or brick and lumber
alongside Knights.

`Caravans.FinishBoard` guarantees both the oasis and its three spokes: it
promotes an interior hex to desert when Islands drowned the only one, and
swaps an outer-ring oasis (which cannot start three caravans) inward with a
non-red interior tile, token and all. Only engine-dealt tiles move; see
`dealtTerrain` and the `BoardFinisher` section of [engine.md](engine.md).
After the repairs it puts the robber beside the board (`board.OffBoard`), the
scenario's own setup step, and the module's `RobberForbidden` hook keeps the
robber off the oasis for the rest of the game. Every robber destination in the
engine, `cak` and `bot/` asks `engine.RobberMayEnter`, which folds that hook in,
so a forbidden hex is forbidden for every way of moving the robber. Derivation
10; see [rules/scenarios.md](rules/scenarios.md).

Camel VP goes to the building's owner, and the placer is usually not the seat
holding the turn, so a camel can carry a non-current seat over the victory
target. That does not end the game: a seat wins only on its own turn, so the
win is banked and lands at the start of that seat's next turn. `finalizeWith`
checks the seat whose turn it was and the seat whose turn it now is. Recorded as
a Decision in [rules/scenarios.md](rules/scenarios.md), with the base-game
sentence it rests on.

### Open, sequential bids

The vote is **open**: the cards go face up in front of their bidder, and the
next seat clockwise answers having seen them. `tab_camel_bid` is a public event
carrying `{player, cards, path?}` and has no redactor. A sealed bid would make
the round a simultaneous auction, in which the coalition step is impossible.

Order is the finisher first, then clockwise, one answer each. `nextBidder`
derives the seat on the clock from `Bidded` rather than a counter in the ext, so
a fold that replays a bid cannot advance the clock twice; `pendingDeciders`,
`blocksTurnActions` and `auto` all key off it, so only the seat on the clock is
held or timed.

`cards` is a two-element pair, not `wool` and `grain`: the two piles are the
ruleset's bid resources, and alongside Knights they are brick and lumber
(`BidResources`, published in the view as `bid_resources`). Old logs carrying
`wool`/`grain` still fold, through legacy fields the decoder reads and never
writes.

**Payment happens at resolution, not as each bid lands.** `tab_camel_bid` moves
no cards; the public `tab_camel_resolved` carries `paid` (every seat's two
piles, in seat order) and charges the whole round in one event every viewer
receives identically, so every viewer's bank stays correct in a redacted fold.

Because `BlocksTurnActions` lets a seat that has bid keep playing, and the vote
spans a turn boundary, a 7 in between can take resources a seat bid. Each bid is
therefore **clamped** at resolution to what the seat still holds, pile by pile,
and earns only the votes it actually pays for.

A bid may name the placement it wants (`path`). That is the coalition step:
seats naming the same placement pool their votes, and two or more of them
holding a strict majority beat the single largest bidder. When a coalition
carries it, `tab_camel_placed` follows `tab_camel_resolved` in the same batch
and no seat is left a placement pick. `Reason` is stamped on the resolve and
folded into the ext rather than re-derived in the view, because the outcome
depends on the placements seats named, which a settled `Bids` map cannot
reproduce.

`ViewExt` publishes `voting`, `finisher`, `placer`, `bidded`, `bids` (all of
them, open round or closed) and, once closed, `reason`. A finished game follows
the same policy as dev cards and steals: a participant downloads the raw,
unredacted log; a non-participant gets the spectator redaction.

### Drawing the board

`ViewExt` also carries what a client cannot derive: `caravans` (the three
spokes, each `{caravan, arrow, corner}`; without them an unstarted caravan,
which has no camels yet, cannot be drawn), `camel_supply` (the size of the set,
so a client can render "9 of 22" without hardcoding an engine constant),
`occupied` (every camel-bearing edge, flat, for the doubled-route rule) and the
nullable `oasis`. A spoke that does not exist is **omitted**, never serialised
as the zero edge, for the same reason the oasis is nullable: the zero edge is a
real edge on the grid.

`camels` is the same set of edges as `occupied`, grouped by caravan and ordered
outward from the oasis, and the renderer needs both. `occupied` answers "is
there a camel here" for the doubled-route rule; `camels` says which way a
caravan runs, and the camel art has a head. An edge on the wire is an unordered
pair normalised by (q, r, side), so the edge alone gives an axis, not a bearing.
`planCamels` walks each chain from its caravan's `corner`, taking each camel's
head to be the vertex it shares with the next one. Do not sort `camels`; the
order is the information.

The placement picker is fed by `legal.camel_paths`, a list of `{caravan, e}`
present only on the winning placer's own view. It arrives via the module's
**`PendingTargets`** hook, not `LegalExtras`: `LegalTargetsFor` returns early
for any seat that is not `s.Cur`, and the placer usually is not (the vote opens
as the finisher's turn ends), while a placer who is `s.Cur` is held by
`blocksTurnActions` and fails the actionable-turn gate before the `LegalExtras`
branch. `PendingTargets` is drained ahead of both. A camel is identified by the
`(caravan, edge)` **pair**, since one edge can extend two caravan fronts and
which chain it joins decides which junctions become interior and score.

The post-game `votes_cast` stat reads `paid` off `tab_camel_resolved` rather
than the bids: a bid is an intent, and only `paid` says which votes counted.

## Raiders

Raiders has its own package (`engine/raiders/`) and its own rules spec
([rules/raiders.md](rules/raiders.md)), because it is not a twist on the
standard board like the two above: it removes the robber, the pirate, the
development deck and Largest Army, and replaces the reason to build. Only what
it shares with them is covered here.

**It composes with both.** Under Caravans a path may hold a camel and a rider at
once: the camel rule bans a second camel and the rider rule a second rider, and
a rider that stopped a caravan growing would let one seat block the vote's
payoff with six pieces. Under Fishermen:

- The two-fish drive-the-robber-away spend is always refused before any tile is
  spent (`RobberSuppressed` is unconditionally true here, unlike the Knights
  case).
- The rider substitution takes its rung instead: `spend_fish` with
  `use: "rider_hurry"` and a `from`/`to` pair makes one rider's five-path move
  with two fish in place of the grain, through the `FreeRiderHurry` hook.
  Raiders validates the move, then Fishermen charges, so an illegal move costs
  nothing; the `raiders_rider_moved` event carries `fish: true` and takes no
  grain.
- The seven-fish free card draws from the Raiders deck through a `ScenarioCard`
  hook, since `DrawProgressCard` returns one event and a deck whose cards
  resolve on purchase can produce several.
- A conquered building draws no fish, because fish are production.
- The lake cannot be conquered: it carries four numbers and the landing rule
  assumes one per hex.

**Its board work is a `BoardFinisher` that touches almost nothing** (see
[engine.md](engine.md)): the castle is a derived hex recorded in the ext rather
than a tile, so it cannot displace the Caravans oasis or the Fishermen lake. The
finisher only grows a main landmass an Islands carve left too small to raid,
and takes the robber off the board.

**Nothing in it is hidden.** Development cards are revealed and resolved when
bought, gold and prisoners are public counters, and every raider and rider is a
figure on the board. So every draw the scenario makes is on the public seeded
stream and is audited by `verify/`, unlike the Fishermen tile mix, and the
module registers exactly one redactor, for the resource a 7 takes.

## Engine impact

Both fit the Module contract (board/dice/turn hooks, new commands, module state,
`VictoryCheck` / `WinThresholdDelta` additions), and both implement
`BoardFinisher` and `ExtBoardInitializer`. Fishermen uses `OnDiceRolled` for
the catch; it registers no `LegalExtras`, because the two-fish spend takes no
target. Caravans uses `OnEvents` to observe builds and turn-ends, `Blocks` /
`BlocksTurnActions` / `Auto` / `PendingDeciders` / `PendingTargets` for the
vote, `RouteWeights` for the doubled-path rule, and `DefaultConfig` for the
per-combination victory target.

The route hooks run in two passes: every module's `RouteEdges` adds its edges
(Islands' ships), then every module's `RouteWeights` reweights them (a camel
doubles the road or ship beside it), and one walk in `engine/route.go` measures
the result. Hooks run in ruleset order and "caravans" sorts before "islands",
so a single pass would reweight before any ship existed, while a ship beside a
camel must count double just like a road. One walk also lets a route cross from
a camel-doubled road onto a ship chain and count both, rather than taking the
max of per-module lengths.

Fishermen consumes `ProgressDecks` / `DrawProgressCard`, so the seven-fish
spend can hand a player a progress card of their choice without engine/scenarios
importing engine/knights. Knights implements them.

## Harbormaster

A third board-independent variant, in its own package (`engine/harbormaster`,
ruleset string `"base+harbormaster"`), and the smallest module in the set: no
hex, no piece, no cost, no command and no randomness. It adds one 2-VP card
awarded like Longest Road, a derived per-seat harbour-point total (1 per own
settlement and 2 per own city standing on a harbour vertex), and one extra point
on the victory target. The rules are in
[rules/harbormaster.md](rules/harbormaster.md).

Its scenario furniture already exists on every board: harbours are placed by the
base generator, and a curated map without any gets a coastline-scaled set from
`EnsureHarbors` before play. So it implements no `SetupBoard`, `BoardFinisher`,
`BoardRadiuser` or `TerrainRequirer`, and is unaffected by setup ordering. For
the same reason it ports nothing to `verify/`; the fairness table plays it and
its four legal pairs to keep that true.

Its engine surface is `VictoryCheck`, an additive target and one re-derivation
hook, and it is why two seams exist:

- **`AfterEvents`**, the second event-reaction phase, run once every module's
  `OnEvents` has landed and before the victory check. Same reason as
  `RouteWeights` beside `RouteEdges`: hook order is the ruleset string's name
  sort, and `harbormaster` sorts before `raiders`, whose conquests move the
  standings it re-derives. It is also the one hook that runs during setup, so a
  Knights round-2 city on a harbour vertex can finish the draft holding the
  card.
- **`TargetVPAdjuster`**, an additive victory target. Knights and Caravans own a
  target and set it with `ConfigDefaulter`; Harbormaster adds to whatever target
  the rest of the ruleset produced, which a first-writer-wins defaulter cannot
  express. See [engine.md](engine.md) for both, and for why the adjustment
  applies to the ruleset's default rather than to a target a host named.

The harbour-point totals are derived on every batch and stored only so a view
can publish them (`ViewExt` is handed a viewer and no state); that is what
`harbormaster_standings` carries.

Raiders adds four hooks of its own (`BlocksNewConstruction`, `BlocksNewRoad`,
`HexInert`, `BuildingInert`), each separate from the similar neighbouring hook;
see [engine.md](engine.md) for why merging any of them would sever a road the
scenario leaves untouched. It publishes no `legal` fields: every piece it adds
lives on an edge or a hex `LegalTargets` has no field for, so the offers travel
in its own view instead.

## Wagons

A trade-route scenario, `"base+wagons"`. Every player owns one wagon that hauls
cargo around the road network between three trade hexes, paying gold tolls to
cross other people's roads, working around three barbarians who squat on paths,
and scoring a victory point for every load delivered. It plays to 13.

It is a scenario rather than a layer, and it replaces more than any other module
here: **the robber is out of the game entirely** (a 7 moves a barbarian instead,
and `SetupBoard` leaves the robber at `board.OffBoard` where `NoRobber` keeps
it), **the development deck is different** (16 Knight, 3 Road Building, 3
Victory Point, 3 Swift Journey, and no Year of Plenty or Monopoly), and **there
is no Longest Road award**. Largest Army stays.

**The three trade hexes are derived from the board's shape.** A cape is a land
hex with exactly three consecutive non-land neighbours, which on a full hexagon
of radius R is exactly its six outer corners. The triple with the largest
minimum pairwise distance wins, which selects one of the two alternating
triples, 2R apart, so the three legs of the delivery circuit are the same
length. The two triples tie and the seed breaks the tie; the seed also permutes
the three roles (castle, quarry, glassworks) over them. All of it comes off the
public seed at `engine.WagonsBoardSeq` and is recorded in `EvBoardGenerated`, so
`verify/` re-derives and diffs it like any other board layer.

**A trade hex keeps its terrain and its number chip.** Blanking three
outer-ring hexes would delete about a sixth of a small board's production.

**The plaza is deferred.** The spec's trade hex has a plaza vertex at its
centre, four spokes to its four land corners and three blocked coastal edges,
with the plaza as a third `board.Side` value. The blocked edges (through
`OccupiesEdge`) and blocked corners (through `BlocksVertex`) are implemented,
and the plaza lives in this module's own path graph under the address the board
change will give it. What is missing is roads on spokes, so a spoke costs a
wagon the bare 2 MP and pays no toll. The tile is done: a trade hex draws a
market town on its seaward half, on the ground it keeps
(`tiles/trade_<ground>_<dir>.glb`: eight grounds by the six world directions
that half can face, chosen in `frontend/src/lib/board3d/layers/wagons.ts`
`tradeTileOverrides` and fetched per board), with the plaza paved at the hex
centre and its number chip at the standard land mount. The forty-eight are
recipe-built (`make compose-tiles`, see art/README.md).

**Gold is a count, never cards.** It is outside the hand limit, undiscardable,
unstealable, and worth no victory points. It pays the 1-gold toll on an
opponent's road, buys a resource from the bank at 2 gold twice a turn, is bought
back at the seat's own port rate, and travels in a player trade through the
module's `TradeExtra` payload.

**The one interrupt is the barbarian move** (a 7, a played Knight, or a
successful drive-off); the movement phase blocks only the pass, so building and
trading stay open during it. See [rules/wagons.md](rules/wagons.md) for every
ruling and decision, and `engine/wagons` for the code.

## Explorers

Not a scenario on a standard board: a whole ruleset with its own board, setup
draft, piece set and a third turn phase. It is documented in
[rules/explorers.md](rules/explorers.md) (the rules) and
[explorers.md](explorers.md) (the implementation). It combines with exactly one
partner, Knights: `cak+explorers`, with ten lettered rules specified in "Knights
in an Explorers game" in the rules. Every other pairing is refused; see the
compatibility table there and `engine/compat.go`.
