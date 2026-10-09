# Game Actor

Each running game is one goroutine, spawned by the Game Manager. It is the only
writer to that game's state and event log.

## Lifecycle

1. **Spawn** when a game starts, or lazily on first reconnect after a server restart.
2. **Rebuild**: load latest snapshot + tail events from the store, fold into state.
3. **Loop**: process commands one at a time from the actor's channel.
4. **Unload** after a grace period once the game finishes or all players disconnect
   (state is always recoverable from the log).

## Command processing

For each command:

```
validate via engine → stamp the batch's provenance (engine.Source)
                    → append events to SQLite (one transaction)
                    → apply events to in-memory state
                    → broadcast redacted views to subscribers
```

`commit` takes the source as a required argument, so every path that writes to
the log says who caused the batch and a new auto-play path cannot inherit someone
else's label. See [engine.md](engine.md), "Action provenance", and
`game/provenance.go` for how a seat's source is derived.

**Persist then broadcast**: a crash never shows players something that wasn't
saved. Every N events the actor writes a snapshot row so future rebuilds are fast.

Illegal commands produce an error frame back to the sender and touch nothing.

The actor handles claims and draw offers itself, because both depend on seat
status and the engine never learns it (see docs/rules/base.md, "Ending a game
nobody can win"):

- `claim_game` is refused unless every other seat is bot-controlled
  (`ErrClaimNeedsBots`). The engine would otherwise accept a claim from a player
  whose opponents are all human.
- An open draw offer is accepted for every bot/auto seat (`runDrawResponses`),
  as ordinary logged commands, so a draw needs only the other human seats. One
  acceptance per pass, paced by `botDelay` like bot trade responses, so one client
  frame cannot fan out into a seat's worth of writes and broadcasts.
- An open draw offer gets the same expiry treatment as a table trade offer
  (`maintainDrawTimer` / `expireDrawOffer`, issuing `cancel_draw` on the
  offerer's behalf). Turn end clears it too, but a table with `TurnTimerSec == 0`
  has nothing forcing a turn to end.

Terminal conditions are checked first: a command sent to a finished game reports
`ErrGameFinished`, not a refusal about a game still in progress.

## Timers and auto-pass

All timing lives in the actor (the engine is clock-free): turn timer, discard timer
on a seven, Knights barbarian decisions, trade-offer expiry. On expiry the actor
synthesizes the minimal legal command for the seat (discard random cards, decline
the trade, end the turn) and feeds it through the normal pipeline stamped
`engine.SourceTimeout`, so clients can show "auto-played" and the log records it.

A disconnected or kicked seat goes into auto-pass mode: the game keeps moving with
minimal legal moves, stamped `SourceAuto`. After a full round the seat escalates
to a real bot and its moves become `SourceBotTakeover`, distinct from an original
bot's `SourceBot` because the seat's earlier events are a person's decisions.
Every transition is also recorded in `store.seat_control` (see
[storage.md](storage.md)), which covers stretches where an empty seat owed nothing
and the moment its player comes back.

Across a live suspend/resume (the last human leaves and later reconnects) the
clock is paused, not reset: Suspend stashes each on-clock seat's remaining budget
and Resume restores it, so the suspended interval never counts against the player
and a reconnect can't refresh the countdown. Across a server restart timers are
ephemeral: there is no prior actor to stash from, so the current timer restarts
with its full duration. Persisting deadlines to the event log was judged not worth
it.

### Per-decision budgets scale with the table timer

The configured turn timer is the budget for a whole build/trade turn. Every other
decision has its own, shorter budget: a base sized for a Normal (60s) table,
scaled by the table's timer (`timings.Scaled`). The factor is `turn timer / 60`,
clamped to [1, `timings.MaxDecisionScale` (4)]; the result is truncated to whole
seconds and then clamped to the turn timer. A Relaxed table doubles every
decision. A Blitz table keeps the bases (sized for a player seeing the prompt for
the first time), compressed only by the clamp to its 30s turn. A table set to an
hour stops at 4x, so one idle seat cannot hold a roll for fifteen minutes.

| decision | base (Normal, 60s) | Relaxed (120s) | Blitz (30s) | ranked Knights (75s) |
|---|---|---|---|---|
| roll (the whole Alchemist decision window in Knights) | 15s | 30s | 15s | 18s |
| Alchemist floor, once the dice are fixed | 10s | 20s | 10s | 12s |
| discard on a seven | 30s | 60s | 30s | 37s |
| robber move and steal | 20s | 40s | 20s | 25s |
| setup settlement | 45s | 90s | 30s | 56s |
| setup road | 15s | 30s | 15s | 18s |
| main-turn inactivity floor | 15s | 30s | 15s | 18s |
| module, one-tap tier: `aqueduct`, `gold_pick`, `defender_draw`, `deserter_surrender`, `raiders_landing`, `raiders_path`, `raiders_muster`, `caravan_bid` | 20s | 40s | 20s | 25s |
| module, board-read tier: `spy`, `master_merchant`, `deserter_place`, `relocate_knight`, `caravan_place`, `metropolis_pick`, `raiders_rider_leave`, `raiders_swift`, `raiders_intrigue`, `raiders_steal`, `wagon_barbarian`, `explorers_pirate`, and any id missing from the table | 25s | 50s | 25s | 31s |
| module, deliberation tier: `wedding_give`, `harbor_return`, `progress_discard`, `barbarian_downgrade` | 30s | 60s | 30s | 37s |
| `raiders_treason` | 45s | 90s | 30s | 56s |
| main turn | the turn timer | 120s | 30s | 75s |

Two clocks do not scale. The main turn is the table timer. A trade offer's
lifetime is derived from it directly (half the turn, bounded to 15s..30s, so a
Relaxed table's offer lives 30s). An untimed table arms only a blocking module
decision's budget, at its base.

The bases live in `timings/timings.go`; the server serves the scaled numbers to
the client (`timings.For`) and stamps every real deadline itself
(`seat_budgets`), so a client never computes a budget. These are wall-clock
policy in the game layer: a timeout's auto-answer is an ordinary event in the
log, so no recorded game replays differently if these numbers change.

## Bots

```go
// game/actor.go
type CommandSource interface {
    Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool)
}
```

A bot is another command source for a seat; it plugs in where auto-pass
synthesizes commands. `Manager.SetBotFactory` installs one per seat; the server
binary installs `bot.NewStrong()`. Two implementations ship in `bot/`: `Strong`
(heuristic, scores moves by simulating through the engine) and `Simple` (a greedy
fallback and benchmark baseline). See [bots.md](bots.md).

## Engine invariant violations

If the engine ever returns an impossible result (a bug, e.g. negative bank), the
actor does not guess: it logs the game id + event seq, marks the game
`paused-error`, and notifies players. Because the engine is deterministic, replaying
the stored log reproduces the bug exactly; the log becomes a regression test.

A rebuild that cannot fold the log pauses the game the same way, instead of
returning an error that leaves the row `active` with no view. Only a fold failure
pauses; a failed store read is transient and leaves the row alone
(`game.ErrRebuildFailed` separates the two).

### Getting out of `paused-error`

There is no unpause: resuming play from a state the engine has called impossible
turns a bug into corruption. `Manager.load` refuses any row that is not `active`,
so without intervention the seats never get their rating, Pips, match history,
post-game screen or rematch.

`cmd/costan-recover` offers two endings. Neither resumes play, and both keep the
event log:

- `finish` (`Manager.ForceFinishPaused`) commits `engine.ForceFinish`'s tiebreak
  result stamped `SourceServer` (so the log tells it apart from a real win) and
  runs the ordinary `finish` path, so ratings, Pips and match history land. Use
  it when only a command went wrong.
- `abandon` (`Manager.AbandonPaused`) moves the row to `abandoned` and releases
  the seats, with no result and no rating movement. Use it when the log will not
  fold, which is when `finish` refuses.

Both work off the store rather than a live actor, because the actor refuses every
command while paused. A paused actor is evictable, so it does not stay in memory.

`Load` also fires `onFinish` when the rebuilt log already ends in a win. That
covers a crash between the winning event reaching the log and `FinishGameOnce`
running: the row would otherwise stay `active` with a finished phase, refusing
every command, and the startup recovery sweep only looks at rows already
`finished`. `FinishGameOnce` is idempotent, so the ordinary path pays nothing.
