# Storage

SQLite via `modernc.org/sqlite` (pure Go, no cgo, so cross-compilation and
deployment are trivial). WAL mode plus a dedicated read handle, so reads (lobby
browsing, replays, stats) run concurrently with game-actor writes. All access
goes through `store/`; nothing else imports database/sql.

## Two handles

`Store` holds two `*sql.DB` onto the same file, and which one a query uses is a
correctness rule, not a tuning knob.

| | `db` (writer) | `rdb` (reader) |
|---|---|---|
| Pool | exactly 1 connection | `readPoolConns` (4) |
| DSN | WAL, `synchronous=NORMAL`, `foreign_keys` | `mode=ro` |
| May | `Exec`, `Begin`, `Query` | `Query` only |

The writer's single connection serialises every writer in the process, which is
what lets `FinalizeGame` and the ratings read-modify-write assume no concurrent
finish interleaves them. Do not raise it. For the same reason the ledger cannot
be called from inside the finalize transaction: it would wait for a second
connection from a pool of one and deadlock (see `store/finalize.go`).

WAL alone does not give concurrent reads: with one shared connection every
lobby listing, profile lookup and session check queues behind whatever game is
committing events, and a large read (`LoadEvents`, a game load) stalls every
other game's persist-then-broadcast. A large scan is somewhat slower on the
read handle because it runs alongside the writer rather than excluding it,
which is the right trade. `TestReadPoolSizeProbe` (`ROPROBE=1`) measures the
latencies `readPoolConns` was sized from.

**The rule.** `rdb` is never used inside a write transaction, and never to read
a value the same method then writes back. Every read-modify-write in `store/`
takes an `execQuerier` and runs inside a `*sql.Tx` the caller owns, so those
paths never pick a handle themselves. The few reads that decide a write in the
same method (`CreateOrBumpReport`, `AddSeat`'s constraint disambiguation,
`RefreshLeaderboardSnapshotIfDue`, plus `migrate`, which runs before `rdb`
exists) stay on the writer and say so at the call site.
`TestWriterHandleReadsAreAllowlisted` parses the package and fails on any
`db.Query`/`db.QueryRow` outside `writerHandleReaders`, which records the reason
for each entry.

Calling a read method while holding a `db` transaction succeeds on `rdb` but
reads pre-transaction state. Reads inside a transaction must go through that
transaction.

`OpenMem` (tests, bot simulation) aliases `rdb` onto `db`: a second connection
to `file::memory:` would open a different, empty database. An in-memory store
has no fsync to queue behind, so nothing is lost.

## Schema

```sql
users      (id, discord_id NULLABLE UNIQUE, is_guest, name, avatar, created_at)
sessions   (token_hash PK, user_id, expires_at)  -- hex SHA-256 of the cookie token

games      (id, status,            -- lobby | active | finished | paused-error
            ruleset,               -- e.g. "base", "islands+cak"
            config JSON,           -- full GameConfig, validated at creation
            invite_code NULLABLE UNIQUE,  -- the table's link, kept for its whole life
            public INTEGER,        -- 1 = listed in the browser and joinable without the code
            ranked INTEGER,        -- 0 = casual, 1 = ranked queue game
            created_by, winner_user_id NULLABLE, created_at, finished_at)

seats      (game_id, seat_no, user_id, status,  -- active | auto | bot
            PRIMARY KEY (game_id, seat_no))

events     (game_id, seq, type, data JSON, visible_to NULLABLE, ts,
            src INTEGER,                        -- engine.Source; 0 = pre-provenance
            PRIMARY KEY (game_id, seq))         -- append-only, never updated

seat_control (id PK, game_id, at_seq, seat, control, ts)
                                               -- who held each seat, over time

snapshots  (game_id, seq, state BLOB,
            PRIMARY KEY (game_id, seq))         -- every N events; older ones pruned

chat       (id, scope, user_id, msg, ts)        -- scope: "lobby" | "game:<id>"

stats      (user_id, ruleset, games, wins, draws,
            ranked_games, ranked_wins, ranked_draws,  -- ranked mirror (0032)
            casual_games, casual_wins, casual_draws,  -- casual 4-player mirror (0033)
            PRIMARY KEY (user_id, ruleset))
ratings    (user_id, ruleset, elo, mu, sigma, updated_at,
            PRIMARY KEY (user_id, ruleset))     -- elo = cached display; mu/sigma = OpenSkill

bot_stats  (bot_name, ruleset, games, wins, draws,
            PRIMARY KEY (bot_name, ruleset))    -- bot personalities, casual 4-player only

ranked_penalties  (user_id PK, strikes, cooldown_until, updated_at)
                                               -- leaver penalty tracking
```

### The three populations in `stats`

`stats` carries a career total and two mirrors of subsets of it. **They do not
partition anything**:

| counters | population |
| -------- | ---------- |
| `games` / `wins` / `draws` | every finished game, any player count, bots included. The profile's career total. |
| `ranked_*` | ranked games only. The leaderboard sits beside a ranked ELO, so it needs the population the ELO came from. |
| `casual_*` | non-ranked games seated at **exactly four**. What a player means by "how do I do at a normal table". |

A casual 6-player game increments the career total and neither mirror. Four is
the count the game is balanced around and the only one where a win rate
compares across tables (fair share 25%); pooling 2-player games (50%) with
10-player games (10%) would measure the tables rather than the player.
`store.CasualPlayers` is the constant; `game.Manager.finalize` applies the
guard, taking the count from `seats` rather than the config, because
`lobby.Start` rewrites `cfg.Players` down to the seats that actually started.

`bot_stats` is the same population keyed by bot personality rather than by
account. Every bot is a fresh guest account per game (`lobby.AddBot` calls
`CreateGuest`), so a bot's `stats` row covers one game. The key is the seat's
display name, stored verbatim with its `Bot ` prefix, because that name is the
only record of which weight vector sat there. It feeds `GET /api/bots` so a
personality that stops winning is visible. Nothing reads it for ratings, the
leaderboard, or any human's record.

Neither mirror is idempotent on its own: both are `+1` upserts, protected from
the recovery sweep double-counting only because they commit inside
`FinalizeGame`'s transaction **before** the `match_history` row the sweep keys
off. Anything added beside them must go in the same place.

## Decisions

- **`events` is the source of truth** for a game; `snapshots` are an
  optimization and can be deleted at any time. Snapshot blobs are versioned: on
  schema change we drop old snapshots and rebuild from events rather than
  migrating blobs.
- **A finished game's snapshot is deleted when it finishes**, since a finished
  game is never reloaded into an actor. `FinishGame`/`FinishGameOnce` drop it;
  `PruneFinishedSnapshots(limit)` is the re-runnable catch-up for the backlog
  and for rows the actor's asynchronous snapshot worker writes just after a
  finish. Not transactional with the finish: a surviving row is wasted bytes,
  never a wrong answer.
- **One transaction per command**: all events a command produces commit
  atomically, before broadcast (see [game-actor.md](game-actor.md)). The append
  path is a group-commit writer goroutine, so up to 256 games' appends share one
  transaction and its result. So nothing that can fail inside the transaction
  may be attributable to one caller: `AppendEvents` validates a batch's seq
  contiguity before enqueueing it, so a malformed slice fails only its own
  actor. It returns `ErrStoreClosed` after `Close` rather than panicking on a
  closed channel; `Manager.StopAll`'s degraded shutdown relies on getting that
  error back.
- **Stats/ratings are derived data**, written once at game end inside the same
  transaction as the final event. ELO per ruleset, adapted for multiplayer (each
  game treated as pairwise results against every opponent).
- **Guest merge**: when a guest logs in with Discord, their `users` row gains
  the discord_id (or, if the Discord user already exists, foreign keys are
  repointed and the guest row removed). History and stats follow the user id.
- **`store.userRefs` is the merge's view of the schema**: one entry per column
  that references `users(id)`, and what a merge does with it. Both merge paths
  (`MergeGuestIntoProvider` and `MergeAccounts`) drive their repoints from it
  via `mergeUserRows`, and `TestUserForeignKeysAreHandledByMerge` holds it to
  `PRAGMA foreign_key_list`. **A new table referencing `users(id)` must be added
  there**, whatever its `ON DELETE` clause: without a cascade the merge's final
  `DELETE FROM users` fails (the writer runs with `foreign_keys(1)`), and with
  one the row's data is silently lost. Every guest has a `wallet_ledger` row
  (auth mints the signup grant at guest creation), so a missed table breaks
  every returning player's login.
- **A merge carries moderation and penalties forward.** `chat_bans`,
  `name_locks`, `mod_strikes`, `chat_reports` and `ranked_penalties` all follow
  the absorbed account onto the survivor; a per-user row keeps the stricter of
  the two.
- **A merge collapses the signup faucet to one grant per human.** The welcome
  grant's idem key is `signup:{userID}` (per account), so repointing an absorbed
  ledger wholesale would pay it again. Everything earned or spent moves; the
  survivor adopts an absorbed grant only when it has none of its own, and
  `wallet_balance` is then recomputed from `SUM(wallet_ledger)`.
- Migrations are sequential numbered SQL files applied at startup, tracked in a
  `schema_version` table.
- Finished games are kept indefinitely (replays are a feature). A finished game
  costs about **66.7 KiB**, dominated by the log at **104 bytes per event**;
  real games run 920 events (base) to 3,225 (`base+cak`).
  `COSTAN_GAME_EVENT_CAP` caps one game; nothing caps the database, and nothing
  is pruned except expired sessions and finished games' snapshots. The event
  log is **not** prunable: deleting it breaks replay and the fairness audit, so
  moving event rows would have to be archival, a decision rather than a sweep.
  `Store.Sizes()` is the cheap metric meanwhile (file bytes via
  `PRAGMA page_count`, freelist bytes, game and snapshot counts, and snapshot
  blob bytes; it does not `COUNT(*)` the events, since that scan is the cost
  being watched).
- Migration 0014 (`openskill`): added `mu` and `sigma` columns to `ratings` to
  support OpenSkill placement-aware ratings; `elo` is kept as a cached integer
  display value computed from `mu - 3σ`. Existing rows were backfilled.
- Migration 0015 (`ranked_games`): added `games.ranked` flag to distinguish
  casual (lobby) games from ranked-queue games for stats and rating purposes.
- Migration 0016 (`ranked_penalties`): added `ranked_penalties` table for leaver
  strike escalation and matchmaking cooldowns.
- Migration number 0028 is used by `0028_event_provenance.sql` below (an
  earlier `users_lang` draft that never ran took and released it; language is a
  frontend-only concern and `users.lang` does not exist). The sequence runs
  through `0035_chat_filtered.sql`, so the next migration takes **0036**.
- Migration 0034 (`session_token_hash`): renamed `sessions.token` to
  `token_hash` and stores the hex SHA-256 of the cookie token, so a leaked
  database or backup holds no usable session. Existing rows are rehashed in
  place by a Go data step (`goMigrations` in `store/store.go`) inside the same
  transaction, so nobody is signed out. An older binary cannot read the
  migrated table: take a backup before deploying it.
- Migration 0035 (`chat_filtered`): added `chat.filtered` (NOT NULL DEFAULT
  0), set on a message the language filter dropped. Such a message is kept for
  its report but was never broadcast, and until this column `RecentChat` served
  it back as game chat history. Player-facing reads (`RecentChat`, `ChatByID`,
  the context around another report) skip flagged rows; moderation reads do
  not. Existing rows were backfilled from their automated report (reporter ==
  accused, open or resolved); every other row stays 0, visible. See
  [moderation.md](moderation.md).
- Migration 0028 (`event_provenance`): added `events.src` (see
  [engine.md](engine.md), "Action provenance") and the `seat_control` table.
  Existing rows default to 0 = `SourceUnrecorded`: the information was never
  captured, and backfilling "probably human" would create a false training
  signal. Old logs replay unchanged because the fold never reads `src`.
- Migration 0030 (`public_seed_commitment`): added `games.public_seed`,
  `games.public_seed_commit` and `games.pre_shuffle_seats` for the fairness
  audit ([dice.md](dice.md)). They live on the game row rather than in the event
  log because they are written when the lobby opens, before the game has a log.
  A commitment made at start would only prove the seed did not change after the
  board was dealt, not that the server did not redeal until it liked a board.
  `public_seed` is TEXT because a seed is a `uint64` and SQLite's INTEGER is
  signed. Older games have NULL and stay unauditable, since a seed invented now
  would be a commitment after the fact.
- Migration 0031 (`drop_dead_indexes`): dropped `games_status` (0001) and
  `idx_games_public_status` (0029), which `EXPLAIN QUERY PLAN` never picks. The
  first is a strict prefix of `games_status_created` (0017), and the second
  cannot beat that index on the browser's query, because
  `(status, created_at DESC)` also satisfies the `ORDER BY` and lets the
  `LIMIT` stop early instead of building a temp b-tree. Unused indexes still
  cost writes on `games` (create, join, start, finish, every privacy flip).
  `chat_bans.expires_at` and `chat_reports.discord_message_id` were reviewed and
  kept; the migration says why.

## Decision: migrations are tested against populated databases

Every test in `store/` opens a fresh `t.TempDir()` database, which only proves
the SQL parses against an empty schema. A migration that fails on real data
cannot be worked around in production: migrations run at startup, so the
server does not come up.

`0025_seats_unique_user.sql` adds a `UNIQUE INDEX` on `seats(game_id, user_id)`
to fix a join race that produced duplicate rows, so it first deletes the
surplus seats, keeping the lowest `seat_no` (the seat the user was shown).
Editing it after release was safe because it never re-runs on a database that
already passed it, and the dedup is a no-op on any database that could have.

`migrateTo(t, path, version)` in `store/migrate_populated_test.go` stops the
migration ladder partway so a test can seed the rows the next migration will
meet. `TestMigrateFromEveryVersionOverPopulatedData` walks every version, seeds
users/games/seats/events/stats/chat, migrates to head and reads the data back.

## Decision: a table's link and its listing are separate columns

`invite_code` is minted when a table is created. `public` alone decides two
things: whether the table appears in the browser, and whether somebody may take
a seat without presenting the code. (Before migration 0029 `invite_code IS NULL`
was the public flag, so going public invalidated the link the host had already
shared.)

The code is a **capability**: presenting a correct one admits its holder to any
table, listed or not (`lobby.Join`).

**A public table publishes its code, and going private rotates it.** The two
rules work as a pair. A listed table is open to anyone, so its link is not a
secret: `sanitize` discloses it to everyone, the browser and `/api/games/live`
carry it, and the Discord feed's Watch button appends `?inv=`.
`SetPrivacy(private=true)` mints a fresh code, so a link scraped from the
browser or an old feed post stops working once the table closes.

The cost: **a link the host sent while the table was public dies when they go
private**. Rotating only on the way in to private keeps a private table's code
stable for as long as it stays private, which is when people are invited by
hand.

`withoutInvites` still strips a private table's code from the two list
endpoints. `ListGames` filters on `public`, so a private table should never
appear there; the strip is a second line of defence because those endpoints are
unauthenticated.

Guests are unchanged: a guest account exists only because somebody was handed a
link, so a guest needs the code even on a listed table, and a seated non-bot
guest still blocks the table from going public.

Tables created before 0029 that were public have no code, and a migration
cannot mint unique random ids per row. They keep NULL until they go private,
which rotates in a code.

## Decision: seat control is logged, raw connection state is not

`seat_control` records transitions of **who is holding a seat** (human / auto /
bot / bot_takeover) against the log position each took effect at. It shows two
things per-event provenance cannot: a seat sitting empty while it owed no
decisions, and a player taking their chair back from a bot, which produces no
event.

**Transitions only.** A seat's opening control is `seats.status`, already
stored and served, so no baseline row is written and a game nobody leaves
writes nothing here. That matters because every game actor and the
group-commit event writer share the writer connection, so per-game-load writes
would compete with the event log.

It is a **side table, not an event type**. Seat status is not a rules fact and
the engine must not know about it; an event would also consume sequence numbers
against `COSTAN_GAME_EVENT_CAP` and pass through every derivation that folds the
log. `at_seq` places each transition in the log's timeline, which is all a
replay or a moderator needs. The key is a rowid rather than
`(game_id, at_seq, seat)`, because a player can drop and return between two
moves and both transitions are worth keeping.

**Raw socket connect/disconnect stays ephemeral.** It flaps with every
backgrounded tab, changes nothing about play on its own, and a permanent record
of when each player was at their desk is data we choose not to collect. Control
changes are the subset that changes who is making the moves, which is what a
dispute is about.
