# Explorers, as implemented

The rules are in [rules/explorers.md](rules/explorers.md); this is what the code
does with them, and where each piece lives. Read the rules first.

Explorers is a standalone ruleset. Its ruleset string is `explorers`, not
`base+explorers`: `engine.modulesFor` refuses a `Standalone` module combined with
anything, the literal `base+` included. `engine/compat.go` carries one refusal per
partner with its own sentence, because that sentence is what a host reads when
the switch they wanted is greyed out.

It takes one companion: `cak+explorers`, the Knights combination, ten lettered
rules specified in "Knights in an Explorers game" in
[rules/explorers.md](rules/explorers.md). It is expressed as
`StandaloneCompanions` on the module rather than by dropping `Standalone`,
because an ordinary module canonicalises to `base+explorers` and that would
rename every stored Explorers game.

## The Knights pairing, seam by seam

Every rule of the pairing involves two modules, and no module imports another,
so each lands on an additive engine hook. This maps the rule letters in
[rules/explorers.md](rules/explorers.md) to the code:

| Rule | Seam | Where |
|---|---|---|
| A, cities come back | `Hooks.NoCities` became a func of the state; `Hooks.BlocksCityUpgrade` refuses the harbour-to-city direction, `checkHarbourSpot` the other | `engine/module.go`, `engine/explorers/hooks.go` |
| B, one forest becomes fields | in `SetupBoardSeeded`, after the desert re-deal, gated on the ruleset; ported to `verify/modules.mjs` so the audit reproduces it | `engine/explorers/board.go` |
| C, the city first, the harbour settlement second | `harbourRound`/`buildingRound` pick which round takes which command; `placeData.City`, set by `WithKnights` | `engine/explorers/decide.go`, `engine/explorers/hooks.go` (`autoSetup`, `legalExtras`) |
| D, knights and the fog | `Hooks.UnrevealedVertex`, consulted by knight build, move, relocation and the timeout pick | `engine/knights/decide.go` |
| E, barbarians count cities | already true: `knights.attackStrength` counts `b.City`, and a harbour settlement is a base settlement plus module state | `engine/knights/exports.go` |
| F, crews do not defend | already true: nothing in `cak` reads Explorers state, and nothing in `explorers` reads a knight | – |
| G, gold and commodities | the purchase is typed to resources, so it never reaches one; `Hooks.SellGood` lets Fast Gold put one back on its stack | `engine/knights/hooks.go` |
| H, Medicine | `Hooks.FreeHarbour` (sibling of `FreeBridge`), plus `placeData.Free` so the module's own price is not charged twice | `engine/knights/progress_play.go` |
| H, Bishop | `Hooks.ArmSeaBlocker`: the card arms the pirate activation a 7 arms, so the placement keeps the module's own picker, displacement, victim and timeout. It has no exception to "a different sea hex" (`pirateLeaves`) | `engine/explorers/hooks.go`, `engine/explorers/rules.go` |
| H, the other four cards | already true: Mining/Irrigation count buildings and a harbour settlement is one; Inventor's exclusions are already 2/6/8/12 and an unrevealed hex carries no chit; Deserter only ever touched knights; Road Building's free-road credit is not read by any Explorers command. | – |
| I, the Aqueduct | on an ordinary roll, already true: the Aqueduct is armed in the production batch and taken in a later one, so it can never suppress the consolation gold. On a 7 nothing pays | `engine/knights/hooks.go`, `engine/explorers/hooks.go` |
| J, 22 to win | `knights.Module.AdjustTargetVP` adds the pairing's +5; Knights' `DefaultConfig` stands aside so the scenario's 17 is what it adds to | `engine/knights/hooks.go` |

Six of the twelve rows needed no code; they are listed so nobody goes looking for
a Deserter change that does not exist. The conformance tests for all of them are
in `engine/ruletest/explorers_knights_test.go`.

## Where it lives

```
engine/explorers/
  explorers.go   the module, its constants, Ext, clone/restore/view plumbing
  board.go       the whole board derivation (see below)
  events.go      the command and event names, and their payload types
  decide.go      every command, the setup draft included
  apply.go       the fold, and the copy-on-write tile writer
  rules.go       the predicates Decide, the hooks and the legal-target builder share
  hooks.go       the Hooks value, production gold, the lair battle, legal targets
  decisions.go   the one decision id (the pirate activation a 7 demands)
  plan.go        the planning surface bots and clients read (Jobs, paths, supplies)
  views.go       ViewExt and the two redactors
  usererr.go     the module's own refusals and their codes
```

Nothing else imports it except the blank imports that register it (`cmd/*`), the
bot's own module (`bot/explorers.go`), the sim's invariant checks and the tests.

## The board

The derivation is split in two because it runs twice (once to write the terrain
onto the board, once to record the layout in the event log), and neither pass
may read anything the other has changed.

- `partition(radius, players)` is pure geometry: the `Sea` rim at distance `R`,
  the home island (the first `ceil(7*players/2)` interior hexes in `(X, |Y|, Y)`
  order, so westmost column first and, within a column, from the equator
  outward), a one-hex ring of home waters, and the face-down pool of everything
  else. It also picks the Council hex (the greatest-`X` home-water hex) and its
  two anchors (the opposite pair flanking its seaward face).
- `derivePool(pool, seed)` is the seeded half: the region split about the
  equator, the nine special hexes per region, the shoal numbering, the terrain
  and each region's number-chit stack.

Six reserved public stream slots carry it (`engine.ExplorersBoardSeqs`), one per
step, so each is re-derivable on its own and a change to one does not shift the
others. `SetupBoard` is handed a single `*rand.Rand` and cannot reach six
streams, so the module takes the seed instead, through `engine.BoardSeeder`.

The pool's terrain lives on the board, never on `PoolHex`. `PoolHex` is recorded
in `board_generated` and reaches every client in the module's view, so terrain
there would publish the whole unexplored map.

## The fog

Three mechanisms, all needed:

1. `MaskBoard` rewrites every unrevealed pool hex to the wire-only `fog`
   resource in every client view. It masks the same way for everyone, as the
   hook's viewer-less signature says: the fog is nobody's knowledge, not one
   player's secret.
2. `board_generated` is emitted with `Visible: []` (State.New does this for any
   module with a `MaskBoard` hook) and a registered redactor produces what
   everybody gets instead: the masked board, and no layout blob.
3. `ViewExt` publishes `fog` (which hexes are unexplored) and `revealed` (what
   the explored ones turned out to be), and nothing about the former.

The redactor must be inert for every other ruleset, because a registered redactor
is applied to a public event for every viewer, and a base-game `board_generated`
is one. It re-marshals the payload rather than echoing it, so an unknown field
cannot survive either; `game.TestRedactionLeavesNoTypedPayload` checks
this.

`game/explorers_redaction_test.go` folds the spectator stream and requires that
no payload names a hex nobody has looked at.

## Pieces that are not base pieces

A **harbour settlement** is a base `Building` plus an entry in `Ext.Harbours`.
It is not a city: a city pays two of a resource and a harbour settlement pays
one. Base `PublicVP` counts it as a settlement (1) and the module's
`VictoryCheck` adds the second point. The upgrade returns the settlement piece to
the supply and spends a harbour piece, so a player can have five settlements and
four harbour settlements standing at once. `sim/piece_conservation_test.go`
carries a correction term for it, as it does for a Knights laid city.

A **ship** is a vehicle, not a connector. The module does not implement
`OccupiesEdge`: that hook enforces the Islands rule that a coastal edge holds a
road or a ship, and Explorers reverses it. Up to two ships share an edge, in any
mix of owners, alongside a road.

## The third turn phase

`BlocksBuildTrade` closes building and trading once the Movement phase begins.
It is separate from `BlocksTurnActions` because that one rides
`requireActionableTurn`, which `end_turn` also goes through, and a turn stage a
player cannot leave would hang the game.

## The bots

`bot/explorers.go` is a policy over the module's own planning surface
(`plan.go`), not a second reading of the rules: every command it returns comes
from a `Job` or a path the module said was legal. Strong owns the Movement phase
through the same policy, because a position evaluator cannot price any of it
(ships and crews are not victory points, and an unexplored hex is not on the
board until somebody sails to it).

Behaviours the policy relies on:

- Strong's road veto must not end the turn, since this ruleset has a stage after
  building.
- Path planning looks further than one turn and truncates, so a ship more than a
  turn from the fog still moves.
- Crews are concentrated rather than spread one per lair, because a lair pays on
  the third.
- Selling cards for gold on a surplus would churn (three cards for a gold, two
  gold for a card), so it is gated on the discard limit.

## The audit

`verify/modules.mjs` re-derives the whole layout in JavaScript from the same six
slots, and `verify/` compares both the board and the recorded ext against real
games. The check is named for the layer ("the board's second layer derived from
the seed") rather than its contents, since it covers both the Fishermen grounds
and this face-down map.

`verify/derivation_test.go`'s fingerprint sweep includes the ruleset and its six
recorded keys. `engine.DerivationVersion` did not change when they were added,
because the input list grew without any derivation moving, and the version is a
promise about games already played.

## Drawing it

The renderer's half is in `frontend/src/lib/board3d/layers/fog.ts` (the cloud
over an unrevealed hex, specified in "How an unrevealed hex is drawn" in the
rules) and `layers/explorers.ts` (everything else). Four things there concern how
the board reads rather than what it contains:

- **The shoal is drawn without its wet-sand flat.** `sea_shoal.glb` carries a
  sand plate and fringe covering nearly the whole hex, which made every revealed
  shoal a flat tan mound. `SHOAL_DRAWN_PREFIXES` draws the sea's own hull and
  waves, the three islets, the rocks, the school and the buoy. It is a cut in
  code standing in for a re-authored tile; `explorersArt.test.ts` fails if the
  file gains a part the list neither draws nor cuts.
- **A stocked shoal shows its haul.** `ExtView.hauls` is drawn by
  `planShoalHauls`: one `Haul_` piece at the shoal's middle, clear of the swell.
- **The rim is framed by its centres** (`explorersFrame`), so the opening view
  is the map rather than the ring of empty sea round it.
- **A reveal keeps the camera.** The rig's key is the board's shape
  (`boardShapeKey`), so turning a hex over rebuilds the tiles and not the
  renderer.

## Stills

The board shots (written to the untracked `art/prototypes/explorers/board/`) are
three frames of a real four-player board (seed 20260902) through the game's own
renderer, both looks: the home island with its numbers, the fog over most of the
map, and a sample of revealed hexes including a gold field and a spice farm.

The fixture is `frontend/dev/board-shots.explorers.board.json`. Unlike the other
fixtures it is not a bare `-dump-board` dump, because gold fields, shoals and
spice farms are drawn from the module's view rather than a resource name, and the
fog slab only appears once the ruleset says so. It is a `{board, ruleset, ext}`
envelope, and `board-shots.tsx` reads either shape. It was built from a game
with a few reveals near the Council and one of each special kind, then
`game.NewFullView(s, game.Spectator)`, so it carries exactly what a spectator is
served.
