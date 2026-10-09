# costan overview

costan is a web-based settlement game server supporting the base game plus the
Islands, Knights, and scenario variants, for 2–10 players, with Discord-based
identity.

This directory documents the backend design. The backend exposes a REST +
websocket API that any client can implement against.

## Scope

- **Stack:** Go, SQLite (via `modernc.org/sqlite`, no cgo), websockets (`coder/websocket`). Single binary.
- **Players:** 2–10 per game. The standard game covers 3–6; 2 is supported by the engine (standard radius-2 board) and is the cheapest self-play configuration, though the frontend does not offer it yet; 7–10 use procedural board/component scaling (see [engine.md](engine.md)), with hand-built map presets as an alternative.
- **Expansions:** Islands, Knights, and the scenario variants (Fishermen, Caravans, Harbormaster, Rivers, Raiders, Wagons). Modes combine where the rules allow it, and each has its own config options (e.g. Knights can skip the first barbarian attack). Every variant runs on a procedural board: Raiders is the central-castle scenario, adapted as described in [rules/raiders.md](rules/raiders.md); Rivers derives its watercourse from the dealt board; and the Wagons trade hexes sit on three coastal capes an even distance apart, which a generated hexagon has at its corners.
- **Auth:** Discord OAuth2, plus guest players via invite link (see [auth.md](auth.md)).
- **Lobby:** public game browser, invite links on every table, in-game and lobby chat, spectators.
- **Liveness:** games are played in one sitting but are crash-safe: every action is persisted, so a restart or redeploy resumes games. Disconnect and reconnect are fully supported.
- **AFK handling:** per-game turn timers with server-side auto-pass, and bot takeover for a seat that stays disconnected for a full round (see [bots.md](bots.md)).
- **Post-game:** full history with move-by-move replays, per-player stats, ELO-style ratings per ruleset.

## Audience and growth path

costan starts as a friends-and-family server and may grow into a public hobby
site or a production service. So:

- Design for a **single node now** (SQLite, in-process actors) but keep boundaries
  clean enough that storage or transport could be swapped later. The engine and game
  actor never touch HTTP or SQL directly.
- The server is **authoritative**: clients send intents, the server validates against
  the rules and broadcasts results. Hidden information (hands, fog) never reaches
  clients that shouldn't see it.

## Document map

| Doc | Contents |
|---|---|
| [architecture.md](architecture.md) | Layers, Go package layout, key invariants |
| [engine.md](engine.md) | Rules engine: events, expansion modules, hooks, hidden info, board scaling |
| [game-actor.md](game-actor.md) | Per-game goroutine, persistence flow, timers, auto-pass |
| [protocol.md](protocol.md) | Websocket message format, reconnect, REST surface |
| [storage.md](storage.md) | SQLite schema, snapshots, migrations |
| [auth.md](auth.md) | Discord OAuth, guests, sessions |
| [maps.md](maps.md) | Map data model, ruleset eligibility, frontend wire contract |
| [dice.md](dice.md) | Fair vs random dice; the two seeds, the lobby-time commitment, and the `verify/` audit |
| [bots.md](bots.md) | Simple and Strong bots; the heuristic eval algorithm |
| [errors-and-testing.md](errors-and-testing.md) | Error handling policy, test strategy |
| [user-facing-text.md](user-facing-text.md) | The no-prose-on-the-wire contract: codes, typed parameters, exempt categories |
| [i18n/CONTRIBUTING.md](i18n/CONTRIBUTING.md) | Translator guide: review flags, per-language glossaries, catalogue checks |
| [rules/](rules/) | Implementation-grade rules specs (our wording) for base + every expansion |
| [islands.md](islands.md) | Ships, islands, gold, pirate + module wiring |
| [knights.md](knights.md) | Barbarians, knights, commodities, progress cards |
| [scenarios.md](scenarios.md) | The scenario variants (Fishermen, Caravans, Harbormaster, Raiders, Wagons) |
| [rivers.md](rivers.md) | The Rivers scenario: the derived watercourse, bridges and coins |
| [rules/raiders.md](rules/raiders.md) | The Raiders scenario's own rules spec |
