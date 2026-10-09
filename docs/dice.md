# Dice, fair mode, and the fairness audit

Game config carries `dice_mode`:

- **`random`** (default): each roll is an independent seeded 2d6, streaks and all.
- **`fair`**: rolls are dealt from a deck of all 36 ordered 2d6 outcomes,
  shuffled per 36-roll epoch and dealt without replacement. Over every 36 rolls
  each total appears exactly its expected number of times.

Both modes are pure functions of `(public seed, position)`, which is what makes
the audit possible.

## Two seeds

A game runs on two independently drawn seeds (`engine.Seeds`):

| | drives | drawn | committed | revealed |
|---|---|---|---|---|
| **Public** | dice (both modes), the fair-dice deck, the Knights event die, board generation, seat order, the Fishermen old boot, the Wagons trade hexes and drive-off die | when the lobby opens | immediately, to the lobby | with the finished replay |
| **Private** | robber steals, dev and progress card draws, server auto-moves | at start | in `game_created` | with the finished replay |

Everything the public seed decides is already visible at the table, so revealing
that seed proves the visible game was honest without publishing a hidden card.
If one seed drove everything, an auditable seed would also reconstruct every
hand.

They must be independent draws. Using the same value for both would make the
private stream derivable from the public one wherever their stream slots
coincide. The lobby draws both from `crypto/rand` (`lobby.seedsFor`).
`engine.SeedsFrom` derives a pair from one number for the simulator, the dump
tools and tests, and is not for production.

## The commitment happens when the lobby opens

Commit-reveal proves the operator did not change the seed after the fact. On its
own it does not prove the operator did not shop for one: if the seed were drawn
at start, in the same call that generates the board and deals the seating, the
server could draw seeds in a loop until one produced a board it liked, and every
check would pass.

So the public seed is drawn and committed in `Lobby.Create`, stored on the game
row (migration 0030), and published to the lobby before anyone has joined and
before the ruleset, the map or the player count are settled. There is nothing to
shop for at that point. The stored seed is what starts the game later.

What this still does not prove: that the server did not draw and discard seeds
before publishing the one it published. Nothing checkable after the fact can.
Closing that needs entropy from the players, so the seed is
`H(server ‖ p₁ ‖ … ‖ pₙ)` with every contribution committed before reveal. That
is future work in the lobby start flow; the engine needs no changes.

## Seat order

The lobby permutes seats to set turn order, using
`engine.SeatOrder(publicSeed, n)`.

A derived permutation is not enough by itself: the log records who ended up at
each seat, and any final seating is consistent with some input. So the lobby also
records the roster it permuted, in pre-shuffle order (`games.pre_shuffle_seats`),
and the replay serves it in its `audit` block. Without both, the seating check is
unfalsifiable, and the verifier reports it as skipped.

## Stream slots

All randomness derives from `rngFor(seed, seq)` = `PCG(seed, seq*φ+1)`. This
derivation is frozen: it is republished in `verify/rand.mjs` and every game ever
played is audited against it, so changing the multiplier or the `+1` invalidates
every historical audit. Reserve a new stream by picking an unused `seq`, never by
changing the formula.

Public-seed slots in use. The registry of record is the `seatOrderSeq` comment
in `engine/seeds.go`, which a new reservation must update in the same change;
this table mirrors it:

| slot | consumer |
|---|---|
| `NextSeq` | the roll at that log position (`random` mode) |
| `-(epoch+1)` | the fair-dice deck for rolls 36·epoch … 36·epoch+35 |
| `1`, `2`, `3` | board generation/preset, then each module's `SetupBoard`, then each module's `FinishBoard` (see `State.newBoard`) |
| `-2000000-NextSeq` | the Knights event die (`engine.EventDieSeq`) |
| `-3000000-NextSeq` | the Fishermen old boot (`engine.FishBootSeq`): at the roll's position, or, for the setup bonus's one-token draw, at the round-2 placement's (derivation 13) |
| `-4000000` | the Rivers watercourse (`engine.RiversBoardSeq`) |
| `-1000000` | the seat-order permutation (`seatOrderSeq`) |
| `-4000001` | the Rivers tile variant (`engine.RiversVariantSeq`) |
| `-7000000` | the Wagons board layer (`engine.WagonsBoardSeq`): which cape triple the trade hexes take when the two alternating ones tie, and which of the three is the castle. One fixed slot rather than a run, because the draw happens once per game |
| `-6000000-NextSeq` | every Raiders public draw (`engine.RaidersSeq`), one slot per produced event |
| `-8000000` … `-8000005` | the Explorers board block (`engine.ExplorersBoardSeqs`) |
| `-9000000-NextSeq` | the Explorers dice (`engine.ExplorersDieSeq`), one slot per log position |
| `-10000000` | the Fishermen fishing-ground numbers (`engine.FishGroundsSeq`): one Shuffle of the numbers over the grounds, once per game (derivation 12) |
| `-10000001` | the Fishermen lakes' numbers (`engine.FishLakesSeq`): one Shuffle of the lakes, the first taking 2, 3, 11, 12 and every other 4 and 10, once per game (derivation 13) |
| `-5000000-NextSeq` | the Wagons drive-off die (`engine.WagonsDieSeq`), one slot per log position rather than per roll, because a wagon may attempt each of the three barbarians inside one turn |

Slot 3 is shared by every `FinishBoard` hook, which is safe only for a hook that
draws when it repairs something: `State.newBoard` mints the generator once per
module, so two finishers on slot 3 get the same sequence of numbers. Caravans and
Fishermen qualify (each draws only on a board that needs its repair, and at most
one of them does on any one board). Rivers derives its chains on every board, so
it names a reserved slot of its own through `engine.BoardFinisherSlot`.

The private seed has its own numbering space and its own registry, next to
`engine.RngFor`. There are two classes of consumer:

- `RngFor(s, offset)`, where the offset is the produced event's index in the
  batch, so the absolute seq is that event's log position and is unique by
  construction.
- `RngForReserved(s, seq)`, for a draw not tied to one produced event, which
  takes a registered descending run: `engine.PrivateFishTilesSeq` (the fish tile
  mix) and `engine.PrivateWagonsStackSeq` (the Wagons cargo stacks, one slot per
  hex per refill). The stack order is the one hidden thing in that scenario and
  is derived rather than recorded, so it cannot be published by accident,
  redacted wrongly, or reconstructed from a spectator's fold.

`engine.TestPrivateSlotsDoNotCollide` enumerates both. A private collision is
worse than a public one, because one end is hidden information. A fixed offset
such as `RngFor(s, 100)` is the same stream as `RngFor(s, 0)` a hundred log
positions later, which is why fixed offsets go through `RngForReserved`.

Two consumers on one `seq` share the whole stream, because `rngFor(seed, seq)` is
a pure function of the pair. Even between two public draws that matters: an event
die at `NextSeq+11` would equal `die1 - 1` of any roll eleven positions later. So
each consumer gets its own descending run, and `engine.TestPublicSlotsDoNotCollide`
enumerates this table and proves it is disjoint. Moving a consumer to a new slot
invalidates the audit of games played before the move, the same as an unported
board hook.

## The audit

`verify/` is a hand-written JavaScript port of every derivation above: Go's
`math/rand/v2` PCG, `uint64n`, `Shuffle` and `Perm`; the dice; the fair deck;
board generation including the fair-mode solver; `Board.Frame`, which computes a
map's ocean from its land; the module board hooks; the seating shuffle. Given a
finished game's replay it re-derives all of it and diffs against the log.

### The board's second layer

`board_generated` carries a sibling to the board: `Ext`, one blob per module,
holding what that module derived from the finished board. Today that is the
fishing grounds (which coastal corners catch fish, and on which number), the lakes
and the numbers each pays on, and the Caravans oases with the three edges each
one's caravans start on. `Apply` unmarshals the logged blob over its own
derivation, so a game replays as it was played rather than as the current binary
would derive it (see `engine.BoardGeneratedData.Ext`). The log, not the
derivation, is what the game runs on.

That makes the blob as forgeable as the board, so it must be audited too:
otherwise a server could move a fishing ground onto the number it wanted and still
verify. `verifyBoardExt` derives and diffs that layer, narrowed to the fields the
board decided. The opening bid map and the camel supply are constants of the
ruleset, not chosen by a seed, and auditing them would make an ordinary field
addition cost a version bump.

### The old boot

The Fishermen boot is a visible outcome (`tab_fish_caught` is public, names the
seat that got the boot, and raises that seat's win threshold), so it draws from
the public `engine.FishBootSeq` and the audit re-derives whether each catch
turned the boot up. A catch is keyed on the roll's log position, or, for the
setup bonus (a second settlement beside a ground or a lake draws one token,
derivation 13), on the placement's; the notional supply the boot hides among is
the table's (30, 44 or 58).

Which seat received it is not re-derived, and the check says so. That is the
second draw off the same stream, weighted by each seat's draw count for the roll,
which would mean porting a slice of the base game's building state machine into
the auditor. A subtly wrong port reports FAILED at an honest server, which is the
worst thing this tool can do.

`Frame` must stay ported: eight of the eleven gallery maps (Shores
small/medium/large, Archipelago, the United States, China, Japan, the UK) are
authored land only and get their coast from `Frame` at game start, so without it
those games are unauditable. `TestJSFramesGalleryMaps` and
`TestJSFrameMatchesGo` cover non-hexagonal boards.

- `verify/*.mjs` are the source of truth, and what `/verify` in the app loads.
- `verify/dist/verify.js` is the generated single-file build, for pasting into
  a console or running beside a saved replay. `node scripts/bundle-verify.mjs`
  rebuilds it; the app serves it at `/verify.js`.
- `node verify/cli.mjs replay.json` audits a saved log. Exit 0 verified,
  1 failed, 2 nothing to check.

**Pass the raw response text, not a parsed object.** A seed is a `uint64` and
`JSON.parse` produces doubles, so a real seed comes back off by a few hundred and
its commitment check fails against an honest game. The verifier reads the digits
out of the text itself (`exactSeeds`). Small test seeds survive the round trip,
so tests with them will not catch this.

### Testing the port

Nothing about editing `solve.go` makes a `.mjs` file complain, so agreement
between the two implementations is a test: `verify/verify_test.go` plays real
games in Go across every ruleset and both dice modes, hands the finished logs to
the JavaScript, and requires the same answers. It also tampers with one die in
one event and requires the audit to reject it, and asserts that rolls were
actually compared, since every check can come back "skipped".

If those tests fail after you changed board generation or the dice, the port is
out of date. Re-port the change.

### Rolls the seed did not decide

The Knights Alchemist lets its holder name both dice before rolling. Such a roll
is not derivable, so `DiceRolledData.Fixed` marks it and the audit exempts it.
The flag is a claim the server makes about its own randomness, so the auditor
checks every one: a flagged roll must match a preceding public `cak_dice_fixed`
event declaring exactly those two numbers, each declaration is spent on exactly
one roll (the engine clears `AlchemistD1` when the roll consumes it), and the
ruleset must include Knights. An unbacked flag is a FAIL, not an exemption.

Without that check, a log with every roll flagged would make the whole dice check
`skip`, and a skipped dice check still verifies (the verdict override guards only
the board check). `TestFlaggedRollMustBeDeclared` covers this on the JS side,
since the verifier a player downloads is the JavaScript, not the Go guard
(`vacuousRolls`).

### Derivation versions

Everything above is a published derivation: given the public seed, a player can
recompute it. That also makes changing any of it expensive, because a game
recorded under the old rule no longer matches what the current code derives, and
an unversioned audit would report `[FAIL] board built from the seed` against an
honest game.

So `game_created` carries `derivation_version` (`engine.DerivationVersion`),
stamped at creation for the same reason the seed commitment is written when the
lobby opens: a version recorded later is a claim made after the fact. The
verifier implements exactly one version and compares:

- **Same version.** Everything is checked.
- **Any other version, or no version** (a game older than the stamp): every check
  that reads a derivation is reported skipped, with the version as the reason,
  and the verdict is **unauditable**. The two commitment checks still run, since
  a hash is not a derivation, but they cannot carry the verdict alone: they prove
  the seeds were fixed in advance, not what the seeds produced.

The verifier does not keep past generators. Old generators that are never
exercised cannot be trusted to still work, and they would accumulate as dead code
in the file the whole scheme rests on. "I cannot check this" stays true for free.
A specific old version can be ported back if there is ever a reason.

Forgetting to bump the version is silent and worse than not versioning: games
from two generators would claim the same version and the audit would fail honest
games. `verify.TestDerivationFingerprint` pins the output of every derivation for
the current version and fails, naming the constant, when the output moves without
the number. Changing a derivation is therefore two edits (bump, re-record) plus
the re-port into `verify/*.mjs`.

### Legacy games

A game created before migration 0030 has no pre-committed public seed and ran on
one undivided seed. It is not retrofitted, because a seed invented now would be a
commitment made after the fact. `Apply` points both streams at the single logged
seed so those games replay byte for byte, and the verifier reports them as
unauditable. A game from before `derivation_version` existed gets the same
verdict for the same reason.

### What a clean result proves

- The seed hashes to the commitment published before anyone joined the table, so
  the server did not pick a seed after seeing who was playing, and did not change
  it afterwards.
- Every visible outcome follows from that seed by a published rule, so the server
  did not choose any of them.

Hidden outcomes are outside the audit. They are revealed by the same replay, but
re-deriving them proves nothing a player could not already see, and binding them
to the public seed would have published every hand mid-game.
