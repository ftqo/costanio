# Rules specifications

These are original, implementation-oriented descriptions of the game mechanics,
written in our own words as the engine's correctness reference, with the detail
an implementer needs (costs, limits, timing, edge cases).

When the implementation and one of these specs disagree, the spec is the
intended behavior; fix the code (or, if the spec is wrong, fix the spec).

| File | Covers |
|---|---|
| [base.md](base.md) | The base game |
| [islands.md](islands.md) | Islands expansion |
| [knights.md](knights.md) | Knights expansion |
| [scenarios.md](scenarios.md) | The board-independent scenario variants (Fishermen, Caravans) |
| [harbormaster.md](harbormaster.md) | Harbormaster variant (harbour points and the 2 VP card) |
| [rivers.md](rivers.md) | Rivers expansion (derived watercourse, bridges, coins, wealth tiles) |
| [raiders.md](raiders.md) | Raiders expansion (castle hex, coastal landings, riders, gold) |
| [wagons.md](wagons.md) | Wagons scenario (cargo, trade hexes, road tolls, barbarians) |
| [explorers.md](explorers.md) | Explorers expansion (standalone: exploration, missions, gold) |

## The nine expansions, and which of them compose

costan specifies nine expansions: **Islands**, **Knights**, **Fishermen**,
**Caravans**, **Rivers**, **Raiders**, **Wagons**, **Harbormaster** and
**Explorers**. Each carries a `## Compatibility` section stating which partners
it accepts, which it refuses, and the reason for every refusal in its own words.
(harbormaster.md heads the same material `## Composition`; scenarios.md holds two
modules, so it names one per section: `## Compatibility: Fishermen` and
`## Compatibility: Caravans`. `engine/compat_test.go` reads all of them and fails
when a module has no section it can read.)

Read that section before touching a pairing.

All nine are registered in the engine. The compatibility table can refuse a
name before its module exists, so a pairing rule can land ahead of the code.


The resolved matrix lives in `engine/compat.go` as two tables: `Conflicts`,
which game creation and the replay-upload path refuse outright, and `Warnings`,
for a pairing that is legal and loses something. Both are keyed by module name,
both carry the sentence a player is shown, and `engine/compat_test.go` pins them
against these specs. See "Incompatible pairs are a table, not a condition" in
[../engine.md](../engine.md) for the mechanism.

The short version: **Explorers plays alone** (it is a `Standalone`, with its own
board, its own pieces and a turn structure of its own), **Wagons refuses
Islands** (it needs one contiguous landmass and cannot cross water), **Wagons
with Caravans plays and warns** (Wagons removes the Longest Road award, so the
camels' road bonus is dead while their settlement points still score), and every
other pair composes.

Each spec ends with an **Engine conformance** section listing the points the
costan implementation must satisfy, so they double as a checklist.
