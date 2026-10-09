# Error Handling & Testing

## Error handling policy

| Failure | Response |
|---|---|
| Illegal / out-of-turn command | `err` frame to sender; state untouched; never a disconnect |
| Malformed frame, flooding | rate-limit, then close socket; session stays valid |
| Engine invariant violation (bug) | game marked `paused-error`, players notified, log preserved for exact reproduction; never guess or corrupt state |
| Server crash / redeploy | games rebuild lazily from snapshot + events on first reconnect; timers restart with full duration |
| Player disconnect | seat keeps its timer; on expiry, auto-pass (see [game-actor.md](game-actor.md)) |

Player mistakes are cheap and recoverable; engine bugs are loud and frozen. A stuck
game that can be replayed beats a silently corrupted one.

How a refusal is worded is a separate contract: the backend sends a stable code plus
named, typed parameters, and the client renders the words. See
[user-facing-text.md](user-facing-text.md).

## Testing strategy

**Engine:**

- Table-driven unit tests per module; every rule and edge case a row.
- **Determinism property**: after any simulated game, `replay(eventLog)` must equal
  the live final state.
- **Simulation**: thousands of random legal games per ruleset (seeded,
  reproducible), asserting global invariants: card conservation, VP correctness,
  bank never negative, no orphaned roads/ships.
- Every fixed bug's event log becomes a regression fixture: replay it, assert the
  outcome.

**Game actor:** integration tests with a fake clock: timer expiry, auto-pass,
snapshot/rebuild equivalence, persist-before-broadcast ordering.

**Protocol:** end-to-end tests running the real server with N websocket clients
playing scripted games; reconnect with `since` gaps; redaction checks (a client must
never receive another player's hidden data, asserted on raw frames).

**Store:** migration tests (fresh DB vs. migrated DB produce identical schema),
guest-merge correctness.

The gate always runs with the race detector on. There is no CI and the pre-commit
hook covers lint only, so the gate is one command covering both languages. Some
contracts have a guard on each side (the `.po` catalogues must carry every error
code: vitest checks the frontend, `server.TestFrontendCopyCoversEveryTransportCode`
checks Go), and only a single gate runs both.

- **Default:** `make gate`. `go vet ./...` + `go test -race -timeout 240m ./...` (every
  package's unit and integration tests, plus `sim/`'s cheap end-to-end games and one
  instance of the determinism property: `sim.TestStrongDeterministic` narrows to
  base+cak on a single seed), the frontend's `npm run typecheck` and `npm test`,
  `tools/blender`'s python tests, and the skip census (`make skip-budget`) off the
  same `go test -json` stream. Go's default timeout is 10 minutes per package and
  `sim` can exceed that on a busy machine; a timeout shows up as
  `panic: test timed out`, which looks like a hang but is not one.
- **When game logic changed** (`engine/ game/ bot/ store/ sim/`): `make gate-slow`, i.e.
  `COSTAN_SIM_SLOW=1 go test -race -timeout 240m ./...` plus the same extras, which
  takes an hour or more. The extra time is the seeded simulation batches: the
  invariant sweeps and the every-ruleset determinism sweep. Under `-race` the A/B
  ladders skip and the sweeps narrow (see `sim/race_norace_test.go`), so the gate
  does not measure the ladder. The timeout is sized for slow machines, not as a
  budget.

`COSTAN_SIM_SLOW` is read only by `sim/`. Unset, the heavy batches `t.Skip` with a
message naming the variable, so `go test -v ./sim` shows what did not run and how to
run it. See the root `CONTRIBUTING.md` for the gate commands.
