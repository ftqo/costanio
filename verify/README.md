# The fairness audit

This directory answers one question for someone who does not trust the server:
**was this game rigged?**

Give it a finished game's replay and it re-derives, from the seed the server
released, everything that seed was supposed to decide (the board, the fishing
grounds, caravan spokes and river channels that hang off it, the seating, every
roll, every Knights event die, the Fishermen old boot) and checks each one
against what the log says happened. Then it checks the seed against the
fingerprint published when the table opened, before anyone joined.

The full scheme, including what a clean result does and does not prove, is in
[`../docs/dice.md`](../docs/dice.md).

## Running it

Get a replay of a game you played in (only a participant's copy carries the
seeds), then:

```
node verify/cli.mjs replay.json
```

Exit 0 verified, 1 a check failed, 2 nothing could be checked.

Or, without a checkout, from the single-file build the site serves at
`/verify.js`:

```
node -e 'const v=require("./verify.js");
         console.log(v.format(v.verify(require("fs").readFileSync("replay.json","utf8"))))'
```

**Pass the raw text, not a parsed object.** A seed is a `uint64` and
`JSON.parse` produces doubles, so a real seed comes back off by a few hundred
and its commitment check fails. The verifier reads the digits from the text.

## What is here

| file | |
|---|---|
| `rand.mjs` | Go 1.26 `math/rand/v2`: PCG, `uint64n`, `IntN`, `Shuffle`, `Perm`. A transcription of the Go source. |
| `sha256.mjs` | SHA-256, and the seed commitment over it. Included so this runs with no install step, in a browser console too. |
| `coords.mjs` | Hex geometry (`engine/board/coords.go`). |
| `board.mjs` | Board generation: bags, the layout solver, harbors (`engine/board/{generate,solve}.go`), and the curated presets, whose tiles are fixed but whose harbors are dealt from the seed (`engine/board/presets.go`). |
| `frame.mjs` | `Board.Frame` (`engine/board/frame.go`): a map's ocean computed from its land (convex hull plus a one-hex coastal margin). Every gallery map except the three full-hexagon standard ones authors land only, so this is the coast of a real game. Draws no randomness. |
| `modules.mjs` | The expansions' board hooks: the `SetupBoard` pass (Islands carving, Fishermen lakes) and the `FinishBoard` pass after it (Caravans' oasis repair, Fishermen's lake guarantee, and the Rivers watercourse, which derives its chains from a reserved stream slot and repaints the board around them). Also the board's second layer, `boardExtFor`: fishing grounds, the Caravans oasis and spokes, and the river chains with their bridge sites, which the engine derives from the finished board and carries in `board_generated` (`engine.BoardGeneratedData.Ext`). Apply unmarshals that blob over its own derivation, so the audit must compare it: a rewritten blob could move a fishing ground onto a number of the server's choosing. |
| `verify.mjs` | The audit itself. |
| `cli.mjs` | Command line entry. |
| `dist/verify.js` | Generated single-file build. `node scripts/bundle-verify.mjs`. |

## It is a port

Editing `engine/board/solve.go` does not make anything here complain. Instead,
`verify_test.go` plays real games in Go across every ruleset and both dice
modes and requires this JavaScript to reach the same answers. It also tampers
with one die in one log, and with the `ext` blob, and requires the audit to
reject both.

**If `go test ./verify` fails after an engine change, this port is out of
date.** Re-port the change.

## One version

This auditor implements one set of derivations, named by
`engine.DerivationVersion` and stamped into every game at creation. A game
built by any other version is reported **unauditable**, neither verified nor
failed. Pre-migration-0030 games get the same answer; see `docs/dice.md`.

Past generators are not carried here, since unexercised code in the auditor
cannot be trusted to still work. One can be ported back if needed.

### Assert the skip, not the absence of the failure

Tests here must assert the outcome by name. "No `[FAIL]` appeared" is also
satisfied by a verifier that checks nothing. Two examples:

- The vacuous-roll guard asserted `!strings.Contains(out, "0 rolls ...")`, which
  matches any roll count ending in zero.
- The unauditable test's fixture is a current-version game with another
  version's label, so its board still re-derives. It asserts each check appears
  as `[----] <name>`, not just that no `[FAIL]` appeared.

The verdict follows the same rule. The commitment checks pass on their own, so
a skipped board check blocks a "verified" verdict, as an unreproducible
derivation version does. A new check whose skip would leave the verdict
resting on the commitments alone belongs in that rule too.

Tests that edit a replay must **edit it as text.** A seed is a `uint64`,
`JSON.parse` produces doubles, and a parse/re-marshal round trip moves both
seeds by a few hundred, so the commitment checks fail and the test becomes a
different test. See `exactSeeds` and `docs/dice.md`.

`TestDerivationFingerprint` pins the output of every derivation for the current
version, so a generation change that forgets to bump the constant fails there.

`TestVerifyTableCoversEveryModule` derives the required rulesets from
`engine.RegisteredModuleNames`, so a new module with no row in the table fails
the gate.

The frontend's audit-page test runs against a real replay fixture generated by
the same package:

```
COSTAN_FIXTURE=frontend/src/lib/__fixtures__/verifiedReplay.json \
  go test ./verify -run TestWriteFixture
```

Regenerate it when the replay's shape changes, not to make a failing test pass.
