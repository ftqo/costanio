# Islands (design)

The first expansion module, and the one that made the engine consult the
`engine.Module` contract. Scope: ships, multi-island boards, gold hexes, the
pirate, and the "explore new islands" VP chips.

## Module wiring

- A package-level **module registry** (`engine.RegisterModule`, like board
  presets): ruleset string → ordered module list, e.g.
  `"base+islands"` → `[islands.Module]`.
- `Decide` dispatches unknown command types to the modules' `Commands()`
  handlers; `Apply` dispatches unknown event types to `Module.Apply`.
- Hooks run at the documented points (`OnDiceRolled`, `OnBuild`,
  `VictoryCheck`, ...). `finalize()` centralizes titles and victory, so module
  VP plugs in there.
- `State.Ext map[string]any` holds module state; each module registers its
  concrete type with `gob.Register` for snapshots and owns its JSON shape for
  views. Redaction has a per-module hook (a fog-of-war mode would need it).

## Rules scope

- **Ships** (`build_ship`): cost wood+sheep; piece limit 15. Ships connect
  along sea edges (edges with at least one sea hex) starting from a coastal
  settlement; a chain mixes with roads only through a settlement/city.
  An **open** ship (end of chain, not anchored at both ends) may move once per
  turn (`move_ship`), not on the turn it was built.
- **Sea hexes & islands**: board generation has terrain `Sea` and scenario
  layouts (start island + outer islands). Procedural generator: a sea channel
  splitting land into 2-4 islands, scaled by player count (see [The carve](#the-carve));
  presets cover curated scenarios.
- **Gold hexes**: produce any resource. On a hit, each owner picks
  (`choose_gold` pending-action, like discards).
- **Pirate**: the sea robber. On a 7 or knight the mover picks robber *or*
  pirate; the pirate blocks ship movement/building adjacent to its hex and
  steals from adjacent ship owners.
- **Longest route**: longest road computation extends to mixed road+ship
  routes (break at the road/ship junction unless a building sits there). The
  module contributes its ships to the engine's `RouteNet` via `RouteEdges`; the
  junction rule is the engine's, so other modules' weights (Caravans) apply on
  the land leg of the same route.
- **Island VP**: +2 VP chip for each new island a player reaches (first
  settlement on an island other than where they started). Tracked in module
  state; feeds `VictoryCheck`.

## The carve

`Module.SetupBoard` turns a procedural full hexagon into an archipelago: a
mainland, plus one outer island per ~8 hexes of the outer ring (1 at radius 2,
2 at radius 3, 3 at radius 4, so 2 to 4 landmasses in all, scaled by player count
through `board.RadiusFor`). Presets and inlined custom maps ship their own sea and
are never carved.

Each island is an arc of two or three hexes of the outer ring, positioned by a
single seeded rotation plus a per-island jitter that keeps the arcs at least one
hex apart. The channel is what separates it from the mainland: the ring-(R−1)
hexes behind the arc are drowned, along with the ring hexes flanking it. The
surviving mainland coast then takes up to `radius` single-hex notches, never two
adjacent, so two seeds get different coastlines. Because no two notches touch,
every ring hex keeps a ring neighbour and no connectivity check is needed (one
would also be a branch the JavaScript port never exercises). Gold lands on the
islands (one in four, and at least one per board), since gold is what makes a
two-hex rock worth the ships.

The channel matters: drowning only the outer ring leaves every survivor
connected to the inner disc, so `Board.Islands()` returns one component, island
chips never fire, and `bot.Strong` turns sailing off (`islandsActive` tests
`len(islands) > 1`). Adding the channel was a `DerivationVersion` bump (2 → 3)
and a re-port into `verify/modules.mjs`; see [dice.md](dice.md) for what a bump
requires.

**A fair-mode board is rebalanced after the carve** (derivation 13). The
generator balances numbers against the full hexagon; the carve then drowns a
sixth of it and the desert repair takes a token. `SetupBoard` ends with
`board.Rebalance` over every token (a carved board is never authored, so every
token is the engine's). It is rng-free, so no stream moves. It runs after the
gold and before every `BoardFinisher` (Rivers' headwater swap, the Caravans
oasis, the Fishermen grounds and lakes, the Raiders castle), so they all see the
balanced board; `ruletest.TestIslandsRebalanceBeforeFinishers` pins that
order. Rivers and a Caravans promotion rebalance again after they take a token.
Mean per-resource pip spread before → after, over 60 procedural seeds per seat
count (base game: 0.33; solver band: 0.34):

| Ruleset (fair) | 2-4 seats | 5-6 seats | 7-10 seats |
|---|---|---|---|
| base+islands (also +cak, +fishermen) | 1.649 → 0.496 | 1.057 → 0.308 | 0.752 → 0.274 |
| base+caravans+islands | 1.649 → 0.496 | 0.748 → 0.289 | 0.462 → 0.274 |
| base+islands+rivers | 0.665 → 0.592 | 0.281 → 0.294 | 0.278 → 0.261 |

The small boards still sit above the 0.34 band on about half the seeds (26 of
60 inside it): token swaps cannot fully balance a 13-hex board whose terrain
mix the carve decided. Random mode is untouched, and so are the gallery Islands
maps: they are authored, never carved, and `board.Resolve` already deals their
numbers fair.

## Harbors on a carved coast

The coastline `SetupBoard` returns is ragged (bays, straits, channels, small
islands), so it recomputes harbors from scratch (`board.PlaceHarbors`) against
the new coast.

On ragged coasts one water hex can serve several coast edges, and a harbor's
dock stands on that water hex. `placeHarbors` allows one dock per water hex; the
rule lives in [docs/maps.md](maps.md#one-dock-per-water-hex), and Islands needs
nothing beyond going through `PlaceHarbors`. A very chopped-up coast may
therefore get fewer harbors than the pre-carve count, since a harbor with
nowhere legal to go is dropped rather than stacked.

## Config (`islands.Config`)

```go
type Config struct {
    IslandVP int  `json:"island_vp"` // VP per newly reached island; default 2, 0 disables
    Pirate   bool `json:"pirate"`    // default true
}
```

## Out of scope for this module

Fog/exploration (a separate mode) and scenario-specific specials. Knights
interactions live in the `"base+islands+cak"` rulesets.
