# Architecture

Single Go binary, layered so the rules engine knows nothing about transport or storage.

```
┌─────────────────────────────────────────────────┐
│  HTTP layer         net/http + coder/websocket   │
│   /auth/*  (Discord OAuth, guest sessions)       │
│   /api/*   (REST: lobby browse, profiles, stats, │
│             replays: request/response stuff)     │
│   /ws      (one websocket per client)            │
├─────────────────────────────────────────────────┤
│  Hub               connection registry, routes   │
│                    client msgs → lobby or game   │
├──────────────┬──────────────────────────────────┤
│  Lobby       │  Game Manager                     │
│  create/join │   one actor goroutine per game    │
│  browse/chat │   command in → events out         │
├──────────────┴──────────────────────────────────┤
│  Engine (pure, no I/O)                           │
│   core rules + expansion modules + board gen     │
│   (State, Command) → ([]Event, error)            │
├─────────────────────────────────────────────────┤
│  Store (SQLite)                                  │
│   users, games, event log, snapshots, stats      │
└─────────────────────────────────────────────────┘
```

## Decision: event sourcing

The append-only **event log is the source of truth** for a game. In-memory state is
a fold over events; periodic snapshots only make rebuilds fast.

Why, over serializing a state blob after each action:

- **Crash-safety and replays come from the same mechanism.** We need move-by-move
  replays as a feature, so we store every action anyway; making the log primary
  avoids maintaining two representations.
- **Hidden information redaction is natural:** each viewer gets a filtered event
  stream rather than a state diff computed ad hoc.
- **Determinism makes bugs reproducible.** Dice come from a seeded RNG whose seed is
  itself an event, so `replay(events)` always reproduces the exact game. Any bug
  report is a regression test.
- State-blob schema migrations across four expansions would be painful; events are
  small, typed, and append-only.

Rejected alternatives: snapshot-state engine (rebuilds half of event sourcing ad hoc),
generic rules-as-data engine (maximum flexibility, but far too abstract and risky).

## Decision: one goroutine per game (actor model)

Each running game is owned by exactly one goroutine. Commands arrive on its channel;
it is the only writer to that game's state and event log. This eliminates locking
across the rules engine entirely. Websocket connections are dumb pipes: they
authenticate, then forward frames to the hub, which routes to lobby or game actors.

## Package layout

```
engine/            pure rules; imports nothing outside stdlib
                   (base-game state machine lives directly in this package;
                    a core/ subpackage would force an import cycle on State)
  board/           hex grid, procedural generation, map presets
  islands/  knights/  scenarios/  ...   one package per expansion (scenarios = Fishermen + Caravans)
game/              actor: command queue, persistence, timers, redaction, broadcast
lobby/             game creation/config, public browser, invite codes, seats
server/            HTTP + WS handlers, hub, session middleware
auth/              Discord OAuth2 flow, guest identities
store/             SQLite access, migrations
lifecycle/         Group: the shutdown owner every background goroutine joins
bot/               Strong (heuristic, engine-simulating) and Simple bots
cmd/costan/         the server binary
```

## Ranked

Two ranked queues are supported: 4-player base game and 4-player base+cak. The
in-process matchmaker lives in `ranked/` and uses band-widening (progressively
relaxing skill-gap thresholds over wait time). Ratings use OpenSkill
(placement-aware, handles ties and multi-player games), implemented in `rating/`;
the per-player (mu, sigma) pair is persisted in `store.ratings` alongside the
cached integer display value. A player who leaves a ranked game is rated in last
place, then receives a leaver strike tracked in `store.ranked_penalties`; enough
strikes trigger a matchmaking cooldown.

## Decision: one shutdown owner per layer

Every goroutine that can reach the store belongs to a `lifecycle.Group`, and
shutdown joins it rather than only signalling it, so `store.Close` never runs
under a goroutine that is still working.

`Group` bundles a stop channel, a `WaitGroup`, and a gate that makes "may I
start?" and "you are now being waited for" one atomic step. A stop-channel peek
followed by `wg.Add` races, and misuses the `WaitGroup`.

Graceful shutdown (`cmd/costan/main.go`) joins these, in order:

1. `httpSrv.Shutdown` stops accepting, then `srv.DrainConns()` close-frames
   every live websocket. Shutdown does not touch hijacked connections, so this
   is what unblocks a read loop parked in `ws.Read`.
2. `srv.Close()` joins `server`'s goroutines: the matchmaker, and each
   connection's read pump, write pump and keepalive. Read loops are where
   `mgr.Get`, `Actor.Do` and `store.LoadEvents` are called from. It must come
   after DrainConns, or it waits for sockets nothing has told to close.
3. `mgr.StopAll()` joins `game`'s: every actor's command loop and its snapshot
   worker (a store writer with its own transaction and fsync), the recovery
   sweep, each idle-reaper firing, each finished-game reap, and any lazy load
   still replaying.
4. The periodic sweeps in `main` (sessions, leaderboard, supporters, stipends)
   are joined by their own deferred `Wait`, which unwinds before `st.Close()`.

Each join is bounded and logs on timeout, so a stalled disk cannot hang exit.
Events are durable per command, so an early return loses no committed state.

## Invariants

1. The engine is **pure and deterministic**: `(State, Command) → ([]Event, error)`,
   no I/O, no clocks, no unseeded randomness.
2. **Persist then broadcast**: events are committed to SQLite before any client sees
   them. A crash never shows players something that wasn't saved.
3. Clients only ever receive **redacted views**; redaction happens in `game/`, not in
   the engine and not in the client.
4. SQLite runs in WAL mode and the store keeps two handles: a writer pinned to
   one connection, and a small read-only pool. Lobby browsing, replays and stats
   use the read pool, so they run concurrently with game writes (WAL alone does
   not give that when reads share the writer's connection). See
   `docs/storage.md`.
