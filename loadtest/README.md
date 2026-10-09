# Load testing: wire and connection capacity

Measures the over-the-wire capacity of the backend: concurrent WebSocket
connections, broadcast fan-out, redaction cost, and slow-consumer drops.
Server-side bots play the games; k6 clients spectate and consume broadcasts.

## What this does and does not measure

- Measured (k6): max stable concurrent connections, broadcast fan-out,
  connection memory, slow-consumer drops (`resync`), connect success, time to
  first state frame.
- Not measured here: raw engine/bot compute and the SQLite write ceiling.
  Those are server-side and covered by `cmd/costan-sim` and
  `LOADTEST=1 go test ./sim -run GameThroughputCeiling`. Bots never run in k6.

## How it works (topology)

Spectating public games requires a registered identity, so the harness works
like this:

1. The orchestrator logs in as the registered dev account (`/auth/dev`), the
   host, since only registered accounts may create games.
2. It creates private bot games (host at seat 0, bots in the rest), starts
   them, and records each game's invite code. The idle host seat auto-passes
   and escalates to a bot, so play is bot-driven. (Starting a bots-only game is
   a supporter perk; the dev-auth host has supporter perks.)
3. k6 connects as guests, which may spectate a private game with its invite
   code. `targets.json` carries `{games:[{id,invite}], tokens:[...]}`.

`maxSpectators` (the per-game fan-out cap) is relaxed in load-test mode so fan-out
isn't throttled. Spectator presence dedups by user, so a small reused token pool
already sidesteps the cap; the relax also covers distinct-user runs.

## Prerequisites

- k6 is provided by the Nix flake (`k6 v2.0.0`): run commands inside `nix develop`
  (or `nix develop --command <cmd>`). To install standalone instead:
  https://grafana.com/docs/k6/latest/set-up/install-k6/
- Build the backend: `go build ./cmd/costan ./cmd/costan-loadgen`

`spectate.js` imports the stable `k6/websockets` module (k6 ≥ v1.6). For
older k6, change the import to `k6/experimental/websockets`; the API is the
same.

## Step 1: run a load-test backend

The host uses dev-auth, so enable both `COSTAN_DEV_AUTH` (host login) and
`COSTAN_LOADTEST` (relaxed limiters and spectator cap). Both are ignored under
secure cookies, so they cannot run in production. Enable pprof
for the sampler.

```bash
COSTAN_DEV_AUTH=1 COSTAN_LOADTEST=1 COSTAN_PPROF=:6771 COSTAN_BOT_DELAY=1500ms \
  go run ./cmd/costan -addr :6769 -db /tmp/loadtest.db
```

Without `COSTAN_LOADTEST` the orchestrator still works but is throttled (one
host creates ~5 games before the per-user limiter bites). For >~50 games or many
sessions, use load-test mode. `COSTAN_DEV_AUTH` is required either way.

## Step 2: generate targets (orchestrator)

```bash
go run ./cmd/costan-loadgen \
  -base-url http://localhost:6769 \
  -games 50 -players 4 -ruleset base -sessions 20 \
  -out loadtest/targets.json
```

Writes `loadtest/targets.json` = `{games:[{id,invite}], tokens:[...]}`.

### Sizing the game pool

k6 reads `targets.json` once at start; when a connection's game ends it
re-subscribes to another game from the list. Size the pool so enough games stay
live for the whole run:

```
pool_size >= target_live_games + (run_seconds / avg_game_seconds) * target_live_games
```

A 4-player base game at 1500ms bot-delay lasts roughly 4-10 minutes, so for a
5-minute ramp+hold most games survive; a pool of ~50 is ample for a few hundred
connections. A lower bot-delay shortens games, so raise the pool accordingly.

## Step 3: run k6 and the pprof sampler together

```bash
# Terminal A: sample server-side resources for the run's duration.
PPROF=http://localhost:6771 INTERVAL=2 DURATION=120 \
  ./loadtest/scrape-pprof.sh > run-200conn.csv

# Terminal B: hold 200 connections for 60s (inside the flake shell for k6).
nix develop --command k6 run \
  -e WS_URL=ws://localhost:6769/ws -e CONNS=200 -e HOLD=60 \
  loadtest/k6/spectate.js
```

## Reading the results

A load level is stable when all of these hold:

- `ws_connect_success` >= 0.99
- `initial_state_ms` p95 under your latency budget (e.g. < 500ms)
- `resync_total` ~ 0 (each `resync` = the server dropped a slow consumer; k6
  omits the metric entirely when it is zero)
- server CPU < ~85% and goroutines/heap bounded (from the pprof CSV)

Capacity = the highest `CONNS` (or game count) still stable. Ramp `CONNS`
(100, 200, 400, 800, ...) until one of the signals breaks; the last stable level
is your max concurrent users.

## The four capacity questions

| Question | How to answer |
|---|---|
| Max users (connections) | Ramp `-e CONNS=...` (this harness); last stable level. |
| Max games | Ramp `-games` in the orchestrator at fixed `CONNS`; last stable level. Cross-check `LOADTEST=1 go test ./sim -run GameThroughputCeiling -v`. |
| Max bots | Compute-bound, not a wire question. Read server CPU headroom (pprof CSV) at your target game count, and use `go run ./cmd/costan-sim -n N -workers W`. |
| Bot wait time | Sweep `COSTAN_BOT_DELAY` (e.g. 250ms, 500ms, 1500ms). Lower delay raises broadcast + SQLite-write rate and shortens games. Pick the delay that keeps event rate under the write ceiling (`concurrent_games ~= events_per_sec_ceiling * bot_delay`) with headroom while staying responsive. |

## Phases (suggested)

0. Validate locally: small pool, few hundred connections; confirm metrics.
1. Connection ramp (fixed games + bot-delay) -> max users.
2. Game-pool ramp (fixed connections) -> max games; cross-check offline.
3. Bot-delay sweep -> bot wait-time recommendation.
