# Rules Engine

`engine/` is pure: no I/O, no clocks, no unseeded randomness. Everything else in the
system treats it as a function `(State, Command) → ([]Event, error)` plus a fold
`Apply(State, Event) → State`.

## Core types

```go
type Command struct {          // what a player wants to do
    Player PlayerID
    Type   CommandType         // BuildRoad, PlayKnight, MoveShip, ...
    Data   json.RawMessage     // command-specific payload
}

type Event struct {            // what actually happened
    Seq    int                 // position in the game's log
    Type   EventType           // RoadBuilt, DiceRolled, BarbarianMoved, ...
    Data   json.RawMessage
    Visible []PlayerID         // seats that may see the full payload; nil = public
    Src    Source              // provenance; set by game/, never read by the engine
}

type State struct {
    Board, Players, Bank, DevDeck, Phase, Turn, ...
    Ext map[string]Extension   // expansion-owned state (knights, fish, missions, ...)
}
```

Randomness (dice, deck shuffles, board generation) uses RNG seeded from the
`EvGameCreated` (`"game_created"`) event at position 0, which carries the seeds, so
replaying the log reproduces the game exactly.

## Action provenance

`Event.Src` records who caused an event: a seated human, or the server acting in
their place. Without it, a move `AutoCommand` synthesized for an expired timer or
an absent seat lands in the log as an ordinary `cards_discarded` or
`robber_moved`, identical to a deliberate one. That is fine for replay but wrong
whenever the log is evidence of what someone decided: training on our own logs,
settling a dispute about an unattended seat, or explaining a strange move in a
replay.

| Source | Meaning |
|---|---|
| `SourceUnrecorded` | Logged before provenance existed. Unknown, **not** human. |
| `SourceHuman` | A seated player's own command. |
| `SourceTimeout` | The decision clock ran out; the server played the minimal legal move. |
| `SourceAuto` | Nobody was in the seat (or a bot declined); minimal legal move. |
| `SourceBot` | A bot that has held the seat since the opening. |
| `SourceBotTakeover` | A bot that inherited a human's seat mid-game. |
| `SourceServer` | Housekeeping owed to no seat: the opening deal, offer expiry, the event-cap finish. |

Three constraints shape where it lives:

- **The engine never sets it and `Apply` never reads it.** Provenance is not a
  rules fact, and the engine is never told seat status (see
  `game.ErrClaimNeedsBots`). `Decide` returns unstamped events; `game.Actor.commit`
  requires a source and stamps the batch before the store write, so a new commit
  path cannot inherit a default. `TestApplyIgnoresSource` replays one log under
  contradictory provenance and requires identical states, so
  `replay(eventLog) == live state` is unaffected.
- **One command, one source.** A batch has a single cause, and every event in it
  carries it. An event can therefore name a player who did not cause it: a payout
  after seat 2's roll names every seat that collected, and all those rows carry
  seat 2's source.
- **Public.** `Src` rides the same wire field for every viewer. It reveals no
  hidden information (it is about who acted, not what was revealed), and the moves
  it labels are visibly synthetic anyway.

Seat control over time (`store.seat_control`) is the companion record: see
[storage.md](storage.md).

## Expansions as composable modules

A game is created with a `Ruleset` assembled from modules. The core engine runs the
base-game state machine; modules extend it at defined points rather than the core
knowing about expansions.

```go
type Module interface {
    Name() string
    // Customize the generated board (sea hexes, fish, fog, ...) with seeded randomness.
    SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand)
    // Handle module commands; handled=false passes the command on.
    Decide(s *State, cmd Command) (events []Event, handled bool, err error)
    // Fold module events into State.Ext; handled=false passes the event on.
    Apply(s *State, e Event) (handled bool, err error)
    Hooks() Hooks                                     // intercept phases
}
```

`Hooks` are the interception points the base state machine exposes:

| Hook | Used by (examples) |
|---|---|
| `OnDiceRolled` | Knights event/barbarian die, scenario fish/gold |
| `OnEvents` | Caravans watching builds/turn-ends to open a camel vote |
| `AfterEvents` | a second event-reaction phase, run once every module's `OnEvents` has landed and before the victory check: Harbormaster re-deriving the harbour-point standings. Hooks run in ruleset order (a name sort), so a module that re-derives a standing from what every other module did needs a phase that runs after all of them ("harbormaster" sorts before "raiders", whose conquests move those standings). It is the one hook that also runs during setup, because a title derived from buildings is already true while they are placed: under Knights the round-2 placement is a city, so a player can finish the draft holding the Harbormaster |
| `BuildingVPSuppressed` | "this building is on the board and worth nothing right now": a Raiders conquest encloses a building so that it scores no VP and its harbour cannot be used. Harbormaster asks the state rather than importing Raiders, and a module answering true still owns the base-VP half through its own `VictoryCheck` |
| `Blocks` / `Auto` | module-pending input (gold picks, Wedding, camel vote) |
| `BlocksTurnActions` | narrower gate than `Blocks` on the active player's voluntary actions: Knights' end-of-turn progress reconcile, and the camel vote freeing every seat it is not waiting on. `Blocks` still governs end-turn and the auto/timer path |
| `RouteEdges` / `RouteWeights` | Islands ships and camel-doubled paths in the longest route. Modules add edges to one `RouteNet` the engine walks once per player, then reweight it in a second pass, so a route can cross from a camel-doubled road onto a ship chain (`engine/route.go`). Two passes because "caravans" sorts before "islands", so a reweight in the first pass would double nothing at sea |
| `ProgressDecks` / `DrawProgressCard` | Knights' three progress decks, offered to other modules: Fishermen's seven-fish spend is "one progress card of your choice" in that combination, and `engine.DrawProgressCardFromModules` draws one without importing `engine/knights` |
| `PillageBuyout` / `FreeBridge` | the two Rivers combination rules, each owned half by two modules that may not import each other: 5 coins keep a city the Knights barbarians would pillage, and 6 fish buy a Rivers bridge. In both, the module holding the currency prices the thing and folds the payment, and the module holding the effect decides when the offer stands; `engine.PillageBuyoutFor` and `engine.FreeBridgeFromModules` are the entry points, like `DrawProgressCardFromModules`. `HasPillageBuyout` / `HasFreeBridge` answer whether the ruleset has such an offer at all, so a rung can be refused as unavailable rather than charged for nothing |
| `VictoryCheck` / `WinThresholdDelta` | Knights metropolis VP and Caravans' between-two-camels VP; the old boot's win bump |
| `TargetVPAdjuster` (interface, not a hook) | an additive victory target: Harbormaster adds one point to whatever the rest of the ruleset settled on, which no `ConfigDefaulter` can express (see below). Wagons uses it for its Knights and Caravans pairings, which are both 15 (a rule of the pair, not a sum); both peers sort first and write their own number, so its adjustment is the difference from what they produced |
| `BankRatio` | Knights Merchant Fleet turn-scoped 2:1 |
| `LegalExtras` | a module's additions to the active seat's legal targets: Knights knights/walls, Islands ships, Fishermen's `FishRobberHexes` |
| `PendingDeciders` / `PendingTargets` | a module obligation owed to a seat that need not be `s.Cur`, with a stable decision id the timer layer sizes (`caravan_bid`, `caravan_place`, `wagon_barbarian`); `PendingTargets` is drained ahead of the `LegalExtras` gates, which is how the camel placer gets `CamelPaths` on somebody else's turn. When any module names a seat, `PendingDeciders` returns the module seats alone, with no fallback to the base deciders, so a module must not report an obligation the engine will not currently let it discharge (for example while a 7's discards are outstanding), or the table stalls |
| `NoDevCards` / `NoRobber` | Knights removes the deck and locks the robber until the first barbarian attack; Fishermen reads both to refuse the 7-fish and 2-fish spends up front |
| `NoLongestRoad` | Wagons removes the award outright. A flag rather than a `VictoryCheck` of -2, because the award is more than two points: `EvLongestRoad` is public, the badge is drawn in the rail and the scoreboard, and a bot reads `LongestRoadHolder` to price a road. Suppressing the event leaves the holder at `NoPlayer` all game, so every one of those reads stays correct. Modules that contribute route pieces are unaffected: the length is still published for the scoreboard; only the title never changes hands |
| `DevDeck` | replaces the deck's composition: Wagons deals 16 Knight, 3 Road Building, 3 Victory Point and no Year of Plenty or Monopoly. Distinct from `NoDevCards`, which removes the deck; without it a module that changes the deck's contents would have to reimplement buying, playing, Largest Army and the VP card |
| `ExtraDevCards` / `DrawExtraDevCard` | a module's own cards shuffled into the same draw (Wagons' Swift Journey). The base buy draws one index uniformly over `DevDeck.Count()` plus every module's extras, so a module card is as likely as its share of the deck and runs out when its supply does, which a separate command with its own price could not reproduce. With no module contributing, the arithmetic is unchanged |

### The win check follows the points, not the turn

`finalizeWith` (`engine/decide.go`) cannot check only the seat whose turn it is.
Under Caravans the vote opens as the finisher's turn ends and `BlocksTurnActions`
lets the next seat play on around the placement, so the camel that completes an
interior vertex can be placed by a seat that is not `s.Cur`.

The check runs for the acting seat first (so a batch that carries two seats past
the line finishes for the player who moved) and then, in seat order, for every
seat whose total the batch changed, measured against a per-seat snapshot taken
before the fold (`finalizeCtx.vp`). Bounding it by the change rather than sweeping
the table keeps every game that already played the same way finishing the same
way: a seat the batch did not touch was already checked when it last moved, so
re-checking it could only end a game on a move its winner had no part in.

Any module that grants VP to a non-current seat is covered by this. A module that
changes a route length outside a build must say so with
`engine.RegisterRouteEvent` (`tab_camel_placed` does: a camel doubles a road
sharing its path).

Hooks rather than feature flags because several expansions times config options
would turn every core function into a flag thicket. Modules keep each expansion's
rules in one package, independently testable, and make legal combinations
explicit: config validation rejects impossible mixes (a module can declare itself
standalone; Islands + Knights is allowed).

### `TargetVPAdjuster`: moving a target rather than choosing it

`ConfigDefaulter` sets the target only if it is still unset. Knights writes 13
and Caravans writes 12, first writer wins, and `State.New` applies them in ruleset
order. That works for a module that owns a target but cannot express one that
moves whatever target the rest of the ruleset produced. Harbormaster adds one
point: 11 on top of the base default, 14 on top of Knights, 13 on top of Caravans.
No defaulter order can say that.

```go
type TargetVPAdjuster interface {
    AdjustTargetVP(cfg GameConfig) int
}
```

The adjustments are summed after every defaulter and after
`GameConfig.withDefaults`, so the ruleset spelling cannot change the answer:
`base+cak+harbormaster` and `base+harbormaster+cak` are both 14, as
`DiscardLimitDelta` and `WinThresholdDelta` are additive for the same reason.

It adjusts the default, not a target a caller named. A config arriving with a
non-zero `TargetVP` is a table that chose its own finish line, which beats every
module's defaulter. Adjusting on top would make the host's number mean something
other than what the game plays to, and would double the increment on every game
the browser creates, because the lobby always sends a number (`format.ts`'s
`recommendedVP` mirrors this resolution and fills the field in before the request
leaves).

The resolved number is what `State.New` writes into the config carried by
`EvGameCreated` at log position 0, so a replay reads the target off the log
instead of recomputing it and the increment can never be applied twice.
`engine.ResolveTargetVP` is the same code path without the board work, for
callers that need the number before a game exists (the lobby clamps it against
`MaxVPWithoutCards`).

### `BoardFinisher`: running once the board is finished

`SetupBoard` hooks run in ruleset-string order, which is a lexicographic sort (see
below) with no dependency meaning: `base+caravans+islands` runs Caravans before
Islands only because `c` sorts before `i`. So a module that surveys the board and
repairs something cannot trust what it saw in `SetupBoard`; a later module may
undo it. For example, Caravans guarantees an oasis by finding a surviving desert,
and Islands may then carve the outer ring and drown it.

`BoardFinisher` is the optional interface for that case, alongside
`ConfigDefaulter`, `BoardRadiuser`, `TerrainRequirer`, `MapChecker` (a non-terrain
rule about an authored map, checked by `MapEligibilityIssues`: Harbormaster's
harbour minimum) and `Standalone`:

```go
type BoardFinisher interface {
    FinishBoard(b *board.Board, cfg GameConfig, rng *rand.Rand)
}
```

`State.New` runs it on every implementing module after all `SetupBoard` hooks have
run, with `rngFor(seeds.Public, 3)`.

An implementation must be order-independent among its peers: idempotent, and
correct whichever other `FinishBoard` ran before it. Repairing a missing feature
qualifies; reshaping terrain another module cares about does not.

It is not a general ordering system. An "after these modules" list would put the
load back on order, which canonicalising the ruleset removed. A phase says "run me
when the board is finished" and names nobody.

#### "Authored map" is about the tile, not about `cfg.Board`

A finisher should leave a map its author designed alone, but `cfg.Board != nil`
is not the test for that: every lobby game inlines a board. The frontend puts a
gallery map in the default config, and `lobby.validateConfig` injects a full-land
one when a config carries neither, so only `sim/` and tests leave `Board` nil.

A gallery map authors a silhouette, not terrain: its land hexes arrive as
`board.ResLand` with blank numbers and `board.Resolve` deals the resources, the
numbers and the deserts onto them at start. So the line is per hex, in
`dealtTerrain` (`engine/scenarios/caravans.go`): a tile the config left generic is the
engine's own work and as free to move as a procedural one; a tile the author
pinned (a named terrain, a chosen token) is theirs. Presets pin every tile, so
they come out unchanged through the same rule. Fishermen's finisher still uses the
coarse `cfg.Preset != "" || cfg.Board != nil` guard, since it reshapes terrain
outright rather than repairing a position.

#### A finisher that derives needs its own stream slot

`State.New` mints the generator once per module, so every finisher starts from the
same draws at slot 3, and since `rngFor` is pure in `(seed, seq)` two finishers on
one slot get the same numbers. Caravans and Fishermen can share it because both
draw only when they repair something, and at most one of them does on any board.

A module that draws on every board would be a second consumer of a stream another
module reads. The public seed is revealed at game end so players can re-derive
every public draw, and one public draw should not predict another. So such a
module names a reservation of its own:

```go
type BoardFinisherSlot interface {
    BoardFinisher
    FinishBoardSeq() int
}
```

Rivers uses `engine.RiversBoardSeq` (`-4000000`); it derives a watercourse across
the finished board on every game. The slot goes in `engine/seeds.go` beside every
other public reservation in the same change that takes it, and
`TestPublicSlotsDoNotCollide` sweeps the list.

#### A derivation that paints must be invariant under its own painting

Board-derived module state is recorded in `EvBoardGenerated`'s ext blob and the
log is what a replay runs on (see `ExtBoardInitializer`). The recording pass is
`InitExtBoard`, which sees the board after every `FinishBoard` has reshaped it. So
a module that derives a layout and paints the board from it derives twice, on two
different boards, and the two answers must agree.

Rivers is the case: its chain choice reads only the land mask and a fixed
exclusion set, both of which its painting leaves alone; the one rule that reads
terrain it changes (which end of the chain becomes the swamp) is short-circuited
by "an end that is already a swamp is the mouth". A module in this shape should
state in its own file which inputs are invariant and why.
`rivers.TestDeriveRiversIsPure` checks both halves: two calls agree, and a call
after painting agrees with the call before it.

### Edges a module closes, as opposed to edges it occupies

`OccupiesEdge` means "my piece is standing here", and the base road build turns
that into `ErrOccupied`. That fits an Islands ship on a coastal edge but not a
Rivers bridge site, which is empty and shut: a road may never cross the channel,
and telling a player whose piece is in the way would mislead them.

`Hooks.RefusesEdge(s, e, kind)` is the second question, and returns the module's
own error so the refusal carries its own code to the client. The base road build,
the setup connector and `LegalRoads` consult it for `RouteRoad`, and the module
that owns ships consults it for `RouteShip` at its single placement point, so
"a bridge site is closed to every piece except a bridge" is one rule rather than
one per piece kind.

The offer has to ask it too. `LegalRoads` and the auto-mover's `LegalSetupRoads`
both filter on it; otherwise the auto-mover keeps proposing a road the engine
refuses and the draft cannot finish.

`Hooks.RefusesRouteMove(s, p, from, to, kind)` is the same seam for a move, which
cannot be priced as two builds: Rivers charges a coin for taking a ship off a
river edge and pays one for putting it on another, so a move between two river
edges is free and a move off one costs a coin the owner may not have. The move is
refused up front, like an unaffordable build, because the engine has no concept
of debt.

#### The Raiders castle: the same hazard, answered by not touching the board

Raiders needs a castle hex at the centre of the board, and the obvious
implementation replaces that tile with a neutral one. It is a `BoardFinisher` for
the reason above (`caravans` and `fishermen` both sort before `raiders` and may
have claimed the centre), but replacing a tile still collides with both of them,
regardless of order.

Caravans picks its oasis as the first desert in board order, so a desert this
hook creates can outrank the one Caravans just repaired. Under Fishermen, where
every desert has been drowned and the oasis is a lake, a new desert outranks every
lake and always takes the oasis. And there is no free value left in
`board.Resource` to mark a castle with: the map codec reserves nibble 12 for "hex
absent" and `Border` is already 11, so a twelfth terrain would be misread by every
existing map code.

So the castle is a derived hex, recorded in the module's transported ext like the
Caravans oasis, and the tile underneath is left alone. The engine makes it produce
nothing through the `HexInert` hook, the round-2 setup grant skips it for the same
reason, and the client draws the castle over it with a tile-art override. The cost
is a hex that keeps a number chip the client hides. In exchange Raiders reshapes
no terrain any other module reads.

Its `FinishBoard` is not empty: it grows a main landmass an Islands carve left too
small to raid (fewer than eight numbered coastal hexes) by reclaiming the nearest
sea, and it takes the robber off the board, which this scenario does in every
combination. Both are idempotent, as `BoardFinisher` requires.

The castle is a tile override, and so is every river hex, so it must stay off the
watercourse (derivation 12). Rivers cannot route round it the way it routes round
the Wagons capes, because `engine.HexReserver` is for claims that are a function
of the land mask and the castle reads terrain. So the dependency runs the other
way through `engine.WatercourseSource`: the castle asks
`engine.WatercourseHexes(s)` and steps to the nearest ordinary interior hex no
river runs through. That is asked from inside Raiders' own `InitExtBoard`, before
Rivers' ext is stored ("raiders" sorts first), so Rivers answers by running the
same derivation its `InitExtBoard` records, which gives the same answer because
that derivation is invariant under its own painting.

`deriveBoardExt` (the recording pass in `engine.New`) stores each module's value
in the scratch state as it goes, as `Apply` does at `EvBoardGenerated`, so a
module that reads an earlier module's board ext (Wagons asking Raiders where its
castle is) sees the same state on both passes.

### Switching a hex or a building off, without removing it

Four hooks exist for the Raiders scenario and are nil for everything else. Each is
separate from a similar-looking neighbour for a reason:

```go
BlocksNewConstruction func(s *State, v board.Vertex) bool
BlocksNewRoad         func(s *State, e board.Edge) bool
HexInert            func(s *State, h board.Hex) bool
BuildingInert       func(s *State, v board.Vertex) bool
```

`BlocksNewConstruction` and `BlocksNewRoad` refuse new construction beside a
saturated hex. `BlocksNewConstruction` covers every build at an intersection: a
settlement, a city upgrade (through `State.BlocksCityUpgrade`), and the Knights
knight and wall builds (through the exported `State.NewConstructionBlocked`). They
are not `BlocksVertex`, whose two call sites are road continuity and the route
walk: a conquered hex must stop new building without severing anybody's road, and
the pieces already there stay, keep blocking an opponent, and keep their place in
the route network. They are not `OccupiesEdge` either, which means "my piece is
standing here" and answers `ErrOccupied`: nothing is standing on these edges, and
under Islands a ship may still be built on them, since the ship build never
consults that hook.

`HexInert` switches a hex off the way the robber does, and is consulted by
production and by the round-2 setup grant. `BuildingInert` switches a building
off: it produces nothing, draws no fish, cannot use its harbour, and no longer
joins its owner's road network to its ship network (`engine/route.go`), while
still existing and still blocking an opponent. The VP half is not here: a module
subtracts its own inert buildings in `VictoryCheck`, which is already summed into
`PublicVPWithModules` and therefore into every leader test.

`engine.BuildingIsInert` is exported because another module's production, the
bots, and the scoreboard all have to agree with the engine about which buildings
are working.

### Ruleset order is canonicalised at creation, and only there

A ruleset string is `+`-separated and `modulesFor` resolves it in the order
written. `New` then applies each module's `DefaultConfig` in that order, and both
Knights and Caravans set `TargetVP` only when it is still zero, so without
canonicalisation `base+cak+caravans` plays to 13 VP and `base+caravans+cak` to 12.

`engine.CanonicalRuleset` fixes the spelling: `base` first if present, then every
module name once, sorted lexicographically. Lexicographic because it is total,
stable across builds (`moduleRegistry` is a map and registration runs in package
init order, which depends on which modules the binary blank-imports), and needs no
maintenance when a module is added. It carries no dependency meaning: a module that
must run in a particular relation to another has to say so at its hook.

It is applied only where a game is created: `lobby.validateConfig` (Create and
UpdateConfig), `Lobby.CreateRankedMatch` (which bypasses validateConfig), and
`game.Manager.Start` as the idempotent point every start funnels through. It must
never run inside `modulesFor`/`Modules`. `Config.Ruleset` is in the event log, and
`replay(events) == live state`: a game persisted under a non-canonical string must
keep resolving its modules in the order it was played in, or its replay is a
different game.

### Incompatible pairs are a table, not a condition

`Standalone` is a property of one module ("I compose with nothing") and cannot say
"I compose with everything except Wagons". Three of the nine expansions specified
in `docs/rules/` refuse a partner, so `engine/compat.go` holds the pairwise rules
as data, in two tables keyed by a sorted pair:

- `Conflicts`: pair → the sentence a player is shown. Refused.
- `Warnings`: pair → the sentence a player is shown. Played anyway.

Both are read through `ConflictBetween` / `WarningBetween`, which sort their
arguments, so one stored row answers a query in either direction.
`RulesetConflicts(ruleset)` / `RulesetWarnings(ruleset)` walk a ruleset string
pairwise and return every hit, sorted.

Details:

1. **The names include modules that are not registered.** All nine specified
   expansions are in the table, so a pairing rule exists before its module does.
   The tables are about names; `modulesFor` still rejects a name that has no
   factory.
2. **The check runs before the registry lookup**, inside `modulesFor`, which both
   admission paths go through: game creation (`lobby.validateConfig`) and replay
   upload (`replay.Fold`), via `engine.CheckRuleset`. So a host is told
   "Explorers and Islands both use ships and a pirate" rather than
   `unknown module "explorers"`.
3. **A warning is not a soft conflict.** `base+caravans+wagons` is legal and the
   spec says so; Wagons deletes the Longest Road award, so the camels' road bonus
   is dead while their settlement points still score. The lobby prints that under
   the shelves and disables nothing.
4. **The refusal is typed.** `*engine.ConflictError` carries the pair and the
   reason, `lobby.ErrRulesetConflict` wraps it, and the API sends
   `RULESET_CONFLICT` with `params.modules` as the two module keys. The reason
   sentence never goes on the wire: the frontend carries the same table
   (`frontend/src/lib/expansionCompat.ts`), translated. `engine/compat_test.go`
   writes the matrix to `engine/testdata/expansion_compat.json`, and the
   frontend's vitest fails when the mirror has drifted from it.

The specs are the source of truth. Each of the nine carries a `## Compatibility`
section, and `compat_test.go` holds the table to them: the expected matrix is
transcribed there with a citation per row, and a second guard reads any
`## Compatibility` markdown table under `docs/rules/` whose verdict column is a
bare Yes or No.

### The robber must be on dry land after setup

`Board.Land` is true for `Lake` (fish water is on the board and produces, but
nothing is built on it), so `board.RobberOK` is the robber's own predicate:
producing land, desert, gold, or the lake; it refuses sea. Fishermen turns every
desert into a lake, so Islands must test `RobberOK` rather than `!Land` when
rescuing the robber, including inside `islands.relocateRobber`, whose fallback
"first land hex" could otherwise land on a lake.

The lake is a legal robber hex, and a preferred one. A lake produces no resource,
so a robber on it blocks nothing (fish are dealt by `fishCatch`, which never reads
the robber), just like the desert it replaced. `board.RobberNeutral` (desert or
lake) is the preference the repairs use: both `FinishBoard` hooks hand the robber
to the neutral hex they just made when it was left on producing land, and the
2-fish spend targets exactly that set.

## Hooks added for Explorers

Explorers replaces enough of the base game that six of its rules could not be
expressed through the existing contract. Each is additive and nil/false by
default, so no other ruleset moves (`engine.TestExplorerSeamsInertElsewhere`).

- **`OwnsSetup` / `AutoSetup`** hand the whole setup draft to the module. The base
  `place_settlement` / `place_road` are refused while it holds, and the module
  folds `s.Cur`, its own round counter and the flip to `PhasePlay` itself.
  Explorers' draft is three rounds placing three different piece kinds (a harbour
  settlement, then a settlement, then a road and a loaded ship) and grants
  starting resources from only the second. `AutoSetup` is what auto-pass and the
  turn timer call, so a timed-out seat is never handed a command its own module
  refuses.
- **`BlocksBuildTrade`** closes building and trading without closing anything
  else. It is not `BlocksTurnActions`, which rides `requireActionableTurn` and so
  would also close end turn, leaving a stage the player cannot leave.
- **`NoCities`** and **`NoLongestRoad`** delete the city and the Longest Route
  outright rather than making them unreachable. Explorers upgrades a settlement to
  a harbour settlement instead, which is a base settlement plus module state rather
  than a base city, because a city produces two of a resource and a harbour
  settlement produces one.
- **`BuildBlockedVertex` / `BuildBlockedEdge`** are the per-seat half of
  `BlocksVertex`. A spice farm is open to the players who have landed a crew on it
  and closed to everyone else, which the player-independent hook cannot say.
- **`BoardSeeder`** (an optional interface, not a hook) hands a module the public
  seed rather than the one `*rand.Rand` `SetupBoard` gets. Explorers reads six
  reserved slots (the region split, the special hexes, the shoal numbering, the
  two chit stacks and the terrain), so each is a stream an auditor can name, a
  change to one does not shift the others, and no stream is reachable from
  another's generator.


## Per-mode configuration

Each module defines a typed config struct, e.g.
`knights.Config{SkipFirstBarbarianAttack bool, ...}`. Global options live in
`GameConfig`: VP target, discard limit, friendly robber, turn timer, player count.
Config is validated at game creation and stored on the game row; it never changes
mid-game.

### Display-only settings

Three fields of `GameConfig` are read by nobody in `engine/` and change no rule:
`ShowBank`, `ShowImprovements` and `MemoryMode`. They ride on the config because
the table agrees on them before the game starts and a replay carries them, but
they only govern what the client draws. The redacted view is identical either way
(a client needs the bank to price a trade and the improvement levels to price its
own upgrade, whether or not it shows them).

`MemoryMode` removes the bank supply readout, the victory-point total and the
counters row on the seat cards, and makes event-log lines fade fifteen seconds
after they arrive instead of accumulating scrollback. The award chips stay
(Longest Road, Largest Army, Defender of the realm, kept VP cards), because those
points are not on the board to be counted. The dividing rule is "could a player
work this out by looking at the table?", which is why the improvement tracks stay:
at a physical table they sit face up on each player's board. Off by default;
ranked games lock it on (`ranked.ConfigFor`).

The frontend honours all three: `selectBank` in `hud/TableStatus.tsx`,
`seatFields`/`seatPanelHeight` in `lib/seatPanels.ts`, and `lib/fadingLog.ts` for
the log. Absent means default, so a client that predates a field draws the game as
before.

## Hidden information

Events carry `Visible []PlayerID`, the seats that may see the full payload (nil =
public). The redactor (in `game/`, not the engine) produces per-viewer streams:

- Your own hand: full detail. Others' hands: counts only.
- Dev/progress cards: face-down until played.
- Fog hexes (future fog-of-war mode): masked until explored.
- Spectators see what a seatless player sees.
- Replays of **finished** games are unredacted.

## Board generation and 7–10 players

`engine/board` generates boards procedurally: ring count grows with player count,
and resource/commodity/dev-card/bank counts scale by formula. These formulas are
house rules; the standard game stops at 6 players. Hand-built **map presets** can
override any of it (fixed layout, custom counts); presets are how unusual
large-game maps get tuned.

### Board scoring must not be fused

The fair-mode layout solver (`engine/board/solve.go`) accepts or rejects a move by
comparing two floating-point penalty sums. Go permits a compiler to contract
`a + b*c` into a fused multiply-add, and the arm64 backend does while amd64 does
not. The fused product keeps more than float64 precision, so the same seed can
score `18 + 40 + 1.66*20` as `91.2` on arm64 and `91.19999999999999` on amd64, and
every tile and harbour after a differently accepted move diverges. JavaScript has
no FMA, so `verify/board.mjs` could never reproduce a fused board.

Every product that feeds an addition in the scoring path therefore goes through
`roundf`, whose explicit `float64` conversion forces the rounding.
`board.TestPenaltyArithmeticIsNotFused` pins the resulting value without needing
`node`, and `verify.TestJSDerivesBoards` re-derives seeds that diverged. Do
not remove a `roundf` call.

Production (arm64) boards generated before this fix were fused, so the fix was a
`DerivationVersion` change: it moves 8 of 200 seeds at radius 2 (3 and 4 players),
1 of 200 at radius 3 (6 players) and 0 of 200 at radius 4 (8 players).
`TestDerivationFingerprint` does not catch it, because it samples seeds 1 to 8 and
the earliest affected seed is 50. A green fingerprint does not prove a derivation
held; see the note on its sample width there.
