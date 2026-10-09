# Client Protocol

Two surfaces: REST for request/response, one websocket per client for everything live.
Both authenticate via the session cookie (see [auth.md](auth.md)).

## REST (`/api/*`)

Request/response things that don't need push:

- `GET  /api/games`: public game browser (filter by mode, player count, status)
- `POST /api/games`: create game (config validated against ruleset)
- `POST /api/games/{id}/join`: take a seat. A correct invite code always admits its
  holder; without one the table must be public (and a guest needs the code either way)
- `GET  /api/games/{id}`: game summary; for an active game it also carries the
  per-viewer live `view`, the redacted event `log`, and the last 50 `chat` lines, so
  the in-game screen renders without waiting for the socket. `?since=N` starts the
  log at seq `N`; omitted (or 0) sends the whole log (see [Event log](#event-log)).
  `?inv=CODE` authorizes reading a private game, the same way the code authorizes
  following one over the socket (`sub`'s `invite`). The two gates must agree: the game
  screen fetches this endpoint and subscribes, and leaves the table on a terminal 4xx
  here, so a watch link that passes only the socket gate still fails. The response
  never echoes the code back to a spectator.
- `GET  /api/invites/{code}`: resolve an invite code to its game summary
- `GET  /api/games/{id}/replay`: for a game that is over, the full unredacted event log
  for participants, redacted spectator view for everyone else. A private game is
  403 unless the caller was at it or presents its code as `?inv=` (the same code
  the socket takes, so a watch link keeps working after the game ends). "Over" means any terminal
  status, not just a win: `finished`, `abandoned` (reset back to a lobby, where
  the log is the only surviving record of the game) and `paused-error` (an engine
  invariant violation, where the log *is* the bug report). A game still in
  progress gets 409 `REPLAY_NOT_READY`; use `GET /api/games/{id}`, which embeds the
  live log. Metered for every caller, participants included, and revalidatable
  with an `ETag` (see Metering the log).
- `GET  /api/games/{id}/frames`: the same game, folded: every event plus the
  authoritative board as it stood once that event had been applied. Gated
  as `/replay` is (over, private-game rule, same meter), and served through the
  same fold the CLI writes files with (`replay.Fold`). Two differences: the
  views are rendered for the caller's own seat when they played and for a
  spectator otherwise, so a player gets their own hand back and nobody else's;
  and a non-participant's copy is redacted whole (`replay.File.Redact`), covering
  both the events inside the frames and the seed in the meta. Gzipped when the
  caller sends `Accept-Encoding: gzip`; this is the only endpoint that compresses
  itself, because a board per event is large and repetitive (compression is
  roughly 70x).
- `POST /api/replay/frames`: fold a log the caller supplies, body
  `{game, events}`, which is the file the download button writes. This makes a
  downloaded replay watchable, including a log this server has never seen (a
  friend's file, a `costan-sim` run, a bug report). Any session will do, guests
  included. Metered from the same buckets and in the same unit as a log read.
  Views are spectator views: a file does not say whose it is. Refusals are
  `REPLAY_FILE_INVALID` (not a replay), `REPLAY_NOT_FOLDABLE` (a replay the engine
  cannot carry to the end, or a list of events that never starts a game) and
  `REPLAY_FILE_TOO_LONG`. This is the only place the engine is handed input it did
  not write, so the fold goes through `replay.FoldUntrusted`, which turns a panic
  into an error.
  The `/replay` response also carries `seat_control`: who was holding each seat
  over the course of the game, anchored to log positions. Together with each
  event's own `src` it is what lets a replay say why a move happened (see
  [engine.md](engine.md), "Action provenance"). Both are empty/absent for games
  logged before provenance existed.
- `GET  /api/users/{id}`: profile, stats, ratings. Each `stats` row carries
  three overlapping populations: the career total
  (`games`/`wins`/`draws`, every finished game at every table size), the ranked
  mirror, and `casual_games`/`casual_wins`/`casual_draws`, which counts
  non-ranked games seated at exactly four. A casual 6-player game is in the
  career total and in neither mirror. See [storage.md](storage.md).
- `GET  /api/leaderboard?ruleset=...`: ruleset must be a ranked one (`base` or
  `base+cak`, the two 4p queues); anything else is a 400 `UNKNOWN_RULESET`,
  since only ranked games move rating
- `GET  /api/bots`: the bot personality roster: `{personalities: [{name,
  character, record?}]}`, in registry order. `record` is that personality's
  casual four-player results per ruleset (absent until it has finished one).
  Public and unauthenticated: strategies and aggregate win counts, nothing about
  any player. `character` is the English source and clients do not render it;
  the translated copy lives in `frontend/src/lib/botPersonality.ts` keyed by
  `name`, since the backend sends codes, not prose. It is on the wire so the
  endpoint reads on its own and so a client that predates a new personality has
  a fallback. See [bots.md](bots.md).
- `POST /api/preview`: deal the map builder's own board and hand it back
  undrawn, for the preview embedded in the builder. Body is
  `{ruleset, seed, board, players}`; response is `{seed, ruleset, config, board,
  ext}`: the same `{config, board, ext}` envelope `costan-sim -dump-view` writes,
  so the builder draws it through `Board3D` with no translation in between, plus
  the seed and the canonical ruleset. The seed is a decimal string in both
  directions (it is a uint64 and JSON numbers are float64 on the client; a
  rounded seed reproduces a different board). Absent seed means random, and the
  response says which one it used. It runs the real setup path (`engine.New`
  plus the fold over its setup events) with the board as a custom map, so every
  module's `SetupBoard`/`FinishBoard` hook runs in the order a table runs them
  and a misshapen board here is one a player could be dealt. Persists nothing:
  no game, no lobby row, no seat. Refusals: `BOARD_REQUIRED` with no board,
  `MAP_LAYOUT_INVALID` for a layout that will not validate, `RULESET_CONFLICT`
  for a refused pair, `PREVIEW_BAD_RULESET` for anything else that will not
  resolve, `PREVIEW_BAD_SEED` for a seed that is not a uint64, `BAD_CONFIG`
  where the map does not fit the ruleset (Islands with no water, Explorers with
  any authored map). Authenticated and metered with the other map tools, because
  it takes an arbitrary board through the validator and the fair solver.
- `GET  /api/social/friends`: Discord friends with costan accounts + presence
  (online, current game). Empty for guests. See [auth.md](auth.md).
- `POST /api/feedback` `{msg, page}`: the profile menu's feedback form. `204` on
  success. Refusals: `FEEDBACK_REQUIRED` (blank), `FEEDBACK_TOO_LONG`
  (`params.max`, characters), `FEEDBACK_RATE_LIMITED`. See
  [moderation.md](moderation.md#player-feedback).

## Websocket (`/ws`)

JSON frames, single multiplexed socket per client. Client messages carry a client-
chosen `id` echoed back in errors for correlation.

Client to server:

```
{"t":"sub",  "game":"g123", "since":42}
{"t":"cmd",  "id":"c7", "game":"g123", "cmd":{...}}
{"t":"chat", "scope":"game:g123", "msg":"..."}
```

| `t` | Meaning |
|---|---|
| `sub` | join, spectate or resume a game |
| `cmd` | a game command (see [Game commands](#game-commands)) |
| `chat` | a chat message; `scope` is `game:<id>` or `lobby` |

Server to client:

```
{"t":"ev",    "game":"g123", "seq":43, "ev":{...}}
{"t":"state", "game":"g123", "seq":43, "full":{...}}
{"t":"err",   "ref":"c7", "code":"NO_RESOURCES", "params":{"missing":{"brick":1}}, "debug":"..."}
{"t":"chat",  "scope":"...", "from":"...", "msg":"..."}
{"t":"lobby", ...}
```

| `t` | Meaning |
|---|---|
| `ev` | one redacted event. `ev` carries an optional `src` (1 human, 2 timeout, 3 auto, 4 bot, 5 bot takeover, 6 server). It is additive and omitted when absent, so a client that ignores it behaves exactly as before. |
| `state` | the full redacted view |
| `err` | a refusal; `ref` echoes the client message's `id` |
| `chat` | a chat message |
| `lobby` | lobby updates (seats, game started) |

A table that is replaced rather than updated (the host resets a live game, or
starts a rematch) redirects its followers instead: `{"t":"lobby", "next":"<new
game id>", "next_invite":"<code>"}`, and the same pair on the `postgame` frame's
`rematch` object. Both tables are private in that case and the new one has a
new code. A seated player passes the new lobby's `sub` gate on membership, but a
spectator needs the code they were redirected with.

## Game commands

`cmd.type` values and their `data` payloads (vertices `{q,r,side}`, edges
`{a,b}`, hands are 6-int arrays indexed by resource):

| type | data | notes |
|---|---|---|
| `place_settlement` | `{v}` | setup phase |
| `place_road` | `{e}` | setup phase |
| `roll_dice` | none | once per turn |
| `discard_cards` | `{cards}` | when a 7 demands it |
| `move_robber` | `{hex, victim?}` | after a 7 or a knight |
| `build_road` | `{e}` | free while road-building roads remain |
| `build_settlement` | `{v}` | |
| `build_city` | `{v}` | |
| `bank_trade` | `{give, get, count?}` | resources, not hands; ratio from harbors |
| `offer_trade` | `{give, want}` | hands; replaces any open offer |
| `respond_trade` | `{accept}` or `{retract:true}` | non-offerers; revisable while the offer stands |
| `execute_trade` | `{with}` | offerer picks an accepter |
| `cancel_trade` | none | offers also die at turn end |
| `buy_dev_card` | none | card identity visible only to buyer |
| `play_dev_card` | `{card, gain?, res?}` | knight may be played before rolling; one dev card per turn |
| `end_turn` | none | |

### Scenario commands (Fishermen, Caravans)

The two scenario modules (`engine/scenarios/`) add four commands. Names are the
`engine.CommandType` constants in `engine/scenarios/fishermen.go` and
`engine/scenarios/caravans.go`. `caravan_bid` and `caravan_place` are not commands;
see "Decision ids" below.

| type | data | notes |
|---|---|---|
| `spend_fish` | `{use, victim?, res?, e?, deck?}` | your own actionable turn; `use` picks the extra field: `remove_robber` (2 fish), no field, the robber leaves the board entirely; `steal` (3) `{victim}`; `take_resource` (4) `{res}`, wood..ore, bank must hold one; `free_road` (5) `{e}`, an edge in `legal.roads` or (under Islands) `legal.ships` (the spend grants a credit, the piece is then placed with `build_road` or `build_ship`); `bridge` (6) `{e}`, only in a ruleset with bridges (Rivers), a legal bridge site for that seat, refused before a tile is spent when it is not; `dev_card` (7), no field; `progress_card` (7) `{deck}`, only in a ruleset with no development deck, one card of the discipline named. Whole tiles, no change: the tiles handed in are chosen by the engine (least waste, then fewest tiles). A seat may hold at most seven tiles |
| `give_boot` | `{to}` | boot holder only, own actionable turn; `to` must have at least the holder's public VP (module VP included) |
| `bid_camel` | `{cards, path?}` | while a vote is open and unresolved, and only from the seat on the clock: bidding is open and sequential, starting with the finisher and going clockwise, once each. `cards` is `[n, m]` against the ruleset's two bid resources (`ext.caravans.bid_resources`), which must be held now (`[0,0]` passes). `path` is `{caravan, e}` from `legal.camel_paths` and names the placement this seat wants, which is how a coalition agrees; it is optional and joins no coalition when absent |
| `place_camel` | `{caravan, e}` | the placer only, after the round resolves; the pair must appear in `legal.camel_paths` |

Refusals carry the module's own codes alongside the core ones: `NO_FISH`,
`BOOT_RECIPIENT`, `ALREADY_BID`, `SPEND_UNAVAILABLE` (the
ruleset has removed what the spend buys, or the board has: `dev_card` under
Knights, `progress_card` without it, and `remove_robber` whenever there is no
robber on the board, which under Knights lasts until the barbarians first
land). See `engine/scenarios/usererr.go`.

**Decision ids.** A camel vote is a module interrupt, and the seats it is waiting
on are reported through `PendingDeciders` with a stable id the timer layer sizes
a budget from (`timings/timings.go`): `caravan_bid` (the one seat on the clock,
20s) and `caravan_place` (the placer, 25s). A sequential round's budgets add, so
a round's length grows with the table. 20s gives a first-time player time to
read what a bid does (an expired bid is a pass). Fishermen owes nobody a
decision: both of its commands are voluntary turn actions.

### Raiders commands

The Raiders scenario (`engine/raiders/`) adds nine commands. Names are the
`engine.CommandType` constants in `engine/raiders/events.go`.

| type | data | notes |
|---|---|---|
| `raiders_buy_card` | none | your own actionable turn; costs 1 ore + 1 wool + 1 grain. The card is revealed, resolved immediately and discarded, so nothing is ever held in hand. Most cards open a pending (below); a card with nothing to do is discarded with no effect |
| `raiders_place_rider` | `{e}` | answers a `raiders_muster` or `raiders_swift` pending; `e` must appear in `ext.raiders.pend.edges` |
| `raiders_decline` | none | declines a `raiders_swift` pending. Swift Rider is the only optional card |
| `raiders_pick_hex` | `{hex}` | answers a `raiders_landing` tie or a `raiders_intrigue`; `hex` must appear in `ext.raiders.pend.hexes` |
| `raiders_treason` | `{moves:[{from?, to}]}` | answers a `raiders_treason` pending. The number of moves is fixed by the board and refused if wrong; `from` omitted takes the raider from the supply, which the card allows only for the shortfall when fewer than two are on the board. Sources distinct, destinations distinct, unconquered, coastal, and never also a source |
| `raiders_move_rider` | `{from, to, hurry?}` | your own actionable turn; each rider moves once, 3 paths, or 5 for `hurry` which costs that one rider 1 grain. `ext.raiders.rider_moves` publishes the destinations |
| `raiders_steal` | `{victim}` | answers the `raiders_steal` pending a 7 opens. `victim` is a seat holding at least one resource card, or `null` when nobody does. There is no robber and nothing is blocked |
| `raiders_buy_resource` | `{res}` | 2 gold for one bank resource, at most twice a turn, refused before the gold moves when the bank holds none |
| `raiders_sell_for_gold` | `{res, count}` | `count` gold for `count x ratio` identical resources. The ratio is the seat's own maritime rate for that resource (`engine.State.CurrencyRatio`): 4, 3 at a generic harbour, 2 at that resource's own harbour |

Gold also rides on a player trade, in the same opaque `give_com` / `want_com`
slot the Knights commodities use: `{"gold": n}`. A module that does not
recognise a payload reports zero for it, so the two compose.

Refusals carry the module's own codes: `RIDER_MOVED`, `NO_RIDERS`, `NO_GOLD`,
`GOLD_BUYS_USED`, `BAD_TREASON_PLAN`. See `engine/raiders/usererr.go`.

**Decision ids.** Six pendings plus the castle-rider prompt, each with a budget
in `timings.ModuleCaps`: `raiders_landing`, `raiders_path` and `raiders_muster`
at 20s, `raiders_rider_leave`, `raiders_swift`, `raiders_intrigue` and
`raiders_steal` at 25s, `raiders_treason` at 45s; the note on `ModuleCaps`
explains the tiers. These are the Normal-table bases: every decision
budget scales with the table timer, so a Relaxed table doubles them (see
"Per-decision budgets" in [game-actor.md](game-actor.md)).

### Scenario events

Nine `tab_*` events. "Sealed" means the engine emits it with `Visible` set to
one seat and `game.RedactEvent` hands everyone else the registered redactor's
public half (`engine.RegisterRedactor`); everything else is public. The
public fold of a redacted stream reproduces every public number (fish totals,
supply, boot, bank, hands) and no other seat's tile mix or unsettled bid.

| event | payload | visibility |
|---|---|---|
| `tab_fish_caught` | `{values, total, boot_to, supply, used}` | public. `values` is the fish value each seat gained (seat-indexed); `supply`/`used` are the post-draw snapshot and are restored verbatim on fold; `boot_to` is `-1` unless the boot surfaced. One per roll that draws anything |
| `tab_fish_gained` | `{player, gain}` | sealed to `player`; others see `{player}`. `gain` is that seat's tiles drawn (`[1s, 2s, 3s]`). One per drawing seat, after the `tab_fish_caught` |
| `tab_fish_spent` | `{player, use, discard, value, res?, grant_road?}` | sealed to `player`; others see `{player, use, value, res?, grant_road?}`. `discard` is the tile mix handed in, `value` its fish value (may exceed the price). Followed in the same batch by `robber_moved` to the off-board coordinate (`remove_robber`), `card_stolen` (`steal`, visible to thief and victim), `dev_card_bought` with `free: true` (`dev_card`, visible to the buyer), `rivers_bridge_built` with `free: true` (`bridge`) or `cak_progress_drawn` (`progress_card`, visible to the drawer) |
| `tab_boot_given` | `{player}` | public; `player` is the new holder |
| `tab_camel_built` | `{player}` | public; marker that the active player built or upgraded this turn |
| `tab_camel_vote` | `{finisher}` | public; a qualifying turn ended, a round opens |
| `tab_camel_bid` | `{player, cards, path?}` | public, with no redactor: the cards go face up, which is what lets the next seat answer knowing the tally. Moves no cards. A log written before the bid resources became ruleset-dependent carries `{wool, grain}` instead of `cards`, and still folds |
| `tab_camel_resolved` | `{placer, paid, reason}` | public; `paid` is `[{player, cards}]` in seat order, each bid clamped to what the seat still held, and it is where the cards move; `reason` is `majority`, `coalition`, `tie` or `nobody` |
| `tab_camel_placed` | `{caravan, e}` | public; ends the round. Follows `tab_camel_resolved` in the same batch when a coalition carried the vote, because the agreed placement leaves nobody a pick |
| `harbormaster_standings` | `{holder, points, prev}` | public, and it has no redactor: the card and every seat's harbour points are as public as Longest Road and every seat's road length. `points` is seat-indexed; `holder` and `prev` are seats, or `-1`. Emitted whenever the holder or any seat's total changes, so it fires on ordinary builds too. It can arrive during setup (a Knights round-2 city on a harbour vertex can finish the draft holding the card) and on another player's turn (a barbarian downgrade moves it) |

### Raiders events

Fourteen `raiders_*` events, and only one of them is redacted. Nothing in
this scenario is held in hand: the development cards are revealed and resolved
on purchase, gold and prisoners are public counters, and every raider and rider
is a figure standing on the board. The one hidden thing is which resource a 7
takes.

| event | payload | visibility |
|---|---|---|
| `raiders_landing` | `{player, numbers}` | public; a build or upgrade rolled three distinct non-7 numbers (six for a batch with two builds) |
| `raiders_landed` | `{hex?, rest?}` | public; one number resolved. `hex` absent means the number named no eligible hex, which places nothing and is not re-rolled, or the supply emptied mid-landing. `rest` is what is left to resolve; empty closes the landing |
| `raiders_card` | `{player, card, void?, gold?, free?}` | public. `card` is `muster`, `swift_rider`, `treason` or `intrigue`. `void` marks a card discarded with no effect; only a void Intrigue is followed by another card in the same batch, because only Intrigue redraws. `free` marks the redraws and a card granted by another module's spend |
| `raiders_rider_placed` | `{player, e, card}` | public |
| `raiders_rider_moved` | `{player, from, to, hurry?}` | public; `hurry` is where the grain is taken |
| `raiders_declined` | `{player, card}` | public; a Swift Rider not taken |
| `raiders_treason` | `{player, moves}` | public |
| `raiders_intrigue` | `{player, hex}` | public; one raider becomes a prisoner |
| `raiders_battle` | `{hex, raiders, strength, involved, prisoners?, gold?, die, dir, lost?}` | public; one whole battle, resolved. `dir` is `(die-1) mod 3` and names a path and the path opposite it |
| `raiders_sweep` | `{player}` | public; the end-of-turn marker. It closes the turn's rider-move and gold-buy bookkeeping and carries no result of its own, so a client renders no line for it |
| `raiders_seven` | `{player}` | public; the 7 opens the steal |
| `raiders_stolen` | `{thief, victim, res?, nothing?}` | sealed to thief and victim; others see `{thief, victim, nothing?}` |
| `raiders_gold_spent` | `{player, res, gold}` | public |
| `raiders_gold_gained` | `{player, give, gold}` | public |
| `raiders_gold_moved` | `{from, to, gold}` | public; a player trade's gold leg |
| `raiders_conquest` | `{conquered?, liberated?, lost?, restored?}` | public; the log's announcement of a change in conquest, appended (AfterEvents) to any batch carrying `raiders_landed`, `raiders_battle`, `raiders_treason`, `raiders_intrigue` or `raiders_path_placed` that moved it. `conquered`/`liberated` are hexes; `lost`/`restored` are `{player, v, city?, vp}`, a building switched off or back on and the `vp` (1 or 2) that costs or returns. Conquest itself stays derived: no rule reads this event, whose fold only records what has been announced (`engine/raiders/announce.go`) |

### Wagons commands

Nine, all from `engine/wagons`. Every one of them is refused unless it is that
seat's own actionable turn, with two exceptions noted below.

| type | data | notes |
|---|---|---|
| `wagons_move` | `{to}` | one path along. `to` must be in `legal.wagon_steps`, which is already priced: the server offers only paths the wagon can pay in full out of the movement points it has and whose toll it can pay, because a toll that cannot be paid makes the path illegal rather than free. Entering a plaza ends the movement, delivers a cargo the hex accepts and then draws the next load |
| `wagons_halt` | none | ends the movement action. With none open this is the decline that lets the turn end, and the module's `Auto` sends it |
| `wagons_boost` | none | 1 grain for +2 MP, once per turn and once across both actions when a Swift Journey grants a second. Legal after the whole allowance is spent, which is the case the rule is for |
| `wagons_charge` | `{barb}` | drive-off attempt on barbarian 0, 1 or 2. Level 2 or better, once per barbarian per turn, from either endpoint of that barbarian's path. Costs no MP and does not end the movement. The die is on the public stream (`engine.WagonsDieSeq`) so a player can re-derive it |
| `wagons_barbarian` | `{barb, e}` | places a barbarian this seat owes: after a 7, a played Knight, or a drive-off that carried. `e` must be in `legal.barbarian_edges` and may not be where that barbarian stands. Not gated on an actionable turn (a Knight played before the roll opens it, and while it is owed nothing else is legal), but it is gated on the 7's discards being settled first |
| `wagons_upgrade` | none | the next level on the track, 1/1/2/2 lumber with 1 wool and 1 ore each. Refused once a movement action is open: the track is bought during trading and building |
| `wagons_buy` | `{res}` | 2 gold for one resource from the bank, twice per turn, bank-limited like any other payout |
| `wagons_sell` | `{res}` | maritime trade paid out in gold, at the seat's own port rate (4:1, 3:1 or 2:1; the 2:1 does buy gold) |
| `wagons_swift` | none | a Swift Journey: a second movement action with a fresh full allowance. Requires a first action to have been taken and ended, and counts as this turn's development card |

Refusals carry this module's own codes: `NO_WAGON`, `MOVEMENT_OVER`,
`NO_MOVEMENT`, `NO_GOLD`, `WAGON_LEVEL`, `ALREADY_CHARGED`, `MAX_LEVEL`,
`GOLD_LIMIT`, `NO_SWIFT`, `NO_JOURNEY`, `BARBARIAN_SPOT`, `NO_BARBARIAN`.
`NO_MOVEMENT` and `NO_GOLD` carry a `needed` parameter.

**Decision ids.** One: `wagon_barbarian` (15s), the barbarian move. It is a
real interrupt: it can be owed before the roll, and while it is owed nothing
else is legal. The movement phase reports none. It blocks only the pass, so a
seat in it is on the ordinary turn timer; reporting a decider would put every
turn of every game on a module cap instead.

### Wagons events

| type | data | notes |
|---|---|---|
| `wagons_started` | `{at, gold, seated}` | public; the wagons go out on their round-2 cities and the gold is dealt. Emitted on the first batch of the play phase, not during setup, because `OnEvents` is a module's only seam onto the base stream and it does not run outside `PhasePlay` |
| `wagons_turn` | `{player}` | public; resets the per-turn bookkeeping. Emitted alongside `turn_started`, since a module cannot fold a base event |
| `wagons_moved` | `{player, from, to, mp, toll?, paid?}` | public in full: a wagon on a board is not hidden, and neither is a payment between two players |
| `wagons_halted` | `{player}` | public |
| `wagons_boosted` | `{player, mp}` | public; the grain goes to the bank here |
| `wagons_charged` | `{player, barb, die, drove}` | public; the die and whether it carried |
| `wagons_barbarian_owed` | `{player, idx, steal}` | public; opens the interrupt. `idx` is -1 when the seat may choose which of the three. Its fold also clears `robber_pending`, which a played Knight sets and this game has no robber for |
| `wagons_barbarian_moved` | `{player, barb, e}` | public; followed by a base `card_stolen` (visible to thief and victim) when it landed on somebody else's road after a 7 or a Knight |
| `wagons_loaded` | `{player, hex, cargo}` | public: what a wagon is hauling and where it must take it is open information |
| `wagons_delivered` | `{player, hex, cargo, gold}` | public; 1 VP, permanently, plus the level's gold |
| `wagons_upgraded` | `{player, level, cost}` | public |
| `wagons_bought` | `{player, res, gold}` | public; 2 gold to the bank for a resource |
| `wagons_sold` | `{player, res, count, gold}` | public; resources to the bank for 1 gold |
| `wagons_gold_moved` | `{from, to, gold}` | public; gold inside a player trade, which is the only route it takes between seats |
| `wagons_swift_bought` | `{player}` | sealed to `player`; others see `{player}`. Bought from the same deck at the same price as any other development card, and it pays for itself in this event's fold |
| `wagons_swift_played` | `{player}` | public |

### Wagons view shape

`state.full.ext.wagons` (from `WagonsExt.ViewExt`):

```
{"has_trade":true, "started":true,
 "trade":[{"hex":{q,r},"role":0,"plaza":{q,r,side},"accepts":[1,2],"ships":[4,3],"left":12}, ...],
 "barbarians":[{a,b},{a,b},{a,b}],
 "wagons":[{"player":0,"v":{q,r,side}}, ...],
 "gold":[5,5,5,5], "level":[1,1,1,1], "cargo":[0,3,0,1], "delivered":[0,2,0,0],
 "turn_seat":0, "move_open":false, "move_done":false, "mp":0, "boosted":false,
 "bought":0, "tried":[false,false,false], "barb_seat":-1, "barb_index":-1,
 "swift":1, "swift_new":0,
 "swift_held":[1,0,0,0], "swift_left":2,
 "mp_track":[4,5,6,7,7], "max_level":5, "gold_price":2, "buys_a_turn":2,
 "stack_depth":12, "drive_floors":[7,6,5,4,3]}
```

- `wagons`: a seat with no wagon is absent.
- `swift`, `swift_new`: the viewer's own; absent for spectators.

A plaza's `side` is past the board's two corner sides. It is the trade hex's
own coordinate with a third value, the address `engine/board` will give it when
the trade-hex tile is modelled; today it is a module-owned vertex and no
`vertexToWorld` can place it (its world position is the hex centre). Wagons stop
on it and it is never buildable: the base engine refuses any vertex past
`board.S` without knowing what a plaza is.

The only thing withheld is the order of the three cargo stacks, and it is not in
the server's state either: it is derived from the private seed on demand. What
travels is `trade[i].left`, how many tokens each stack has before it is
refilled.

The rules constants travel too (`mp_track`, `gold_price`, `drive_floors`, ...)
so a client labels a level, a price and a die range from the engine rather than
keeping a second copy of the scenario in TypeScript.

`legal` gains two lists: `wagon_steps` (vertices, already priced, for the seat
whose movement phase is open) and `barbarian_edges` (edges, for the seat that
owes a barbarian move, through `PendingTargets` so it reaches a seat that is not
`cur`).

### Explorers commands

Explorers (`engine/explorers/`) is a standalone ruleset: its name is its whole
ruleset string, never `base+explorers`. It replaces the setup draft, the turn
structure and most of the piece set, so it adds more commands than every other
module combined.

| type | data | notes |
|---|---|---|
| `explorers_place_harbour` | `{v}` | setup round 0, turn order: a harbour settlement on any coastal intersection of the home island. No road follows |
| `explorers_place_settlement` | `{v}` | setup round 1, reverse order: a settlement anywhere on the home island. The only starting building that collects resources |
| `explorers_place_start` | `{road, ship}` | setup round 2, turn order: both at once. `road` touches your settlement, `ship` is a sea edge touching your harbour settlement and the ship arrives carrying a settler |
| `explorers_build_harbour` | `{v}` | Action phase. Upgrades one of your own coastal settlements; the settlement piece goes back to your supply. 2 grain + 2 ore, four per player, worth 2 VP, and the only shipyard |
| `explorers_build_ship` | `{e, recycled?}` | Action phase. A sea edge with room, one end at one of your harbour settlements, neither end at a corner of an unexplored hex. `recycled` names one of your ships to return to the supply first, which is how a hull stranded in the wrong ocean gets home; its cargo goes back to its own supply |
| `explorers_buy_cargo` | `{settler, at_ship, ship_id?, v?}` | Action phase. A settler (both hold slots) or a crew (one) into an empty slot of one of your harbour settlements, or of one of your ships standing at one |
| `explorers_jettison` | `{cargo, at_ship, ship_id?, v?}` | Action phase, and only when every slot in your harbour settlements and their docked ships is full |
| `explorers_gold_buy` | `{res}` | Action phase. 2 gold buy any 1 resource, twice per turn |
| `explorers_gold_sell` | `{res}` | Action phase. The Fast Gold advantage: 1 resource for 1 gold, once per village held |
| `explorers_bank_gold` | `{res}` | Action phase. 3 identical resource cards buy 1 gold. (3 identical for a different resource is the ordinary `bank_trade`, priced by the module's flat 3:1) |
| `explorers_enter_movement` | none | One-way: after it no build and no trade is legal this turn |
| `explorers_move_ship` | `{ship_id, path}` | Movement phase. `path` is one edge per movement point, each adjacent to the last. A reveal ends the move, so a path that continues past one is refused rather than truncated |
| `explorers_speed_ship` | `{ship_id}` | Movement phase. 1 wool buys +2 movement points, once per ship per turn |
| `explorers_load` / `explorers_unload` | `{ship_id, cargo}` | Movement phase, no movement cost. Between a ship's hold and the basin of the harbour settlement one of its ends stands on. Ship to ship is not allowed; the relay is through a shared harbour settlement |
| `explorers_land_crew` | `{ship_id, h}` | Movement phase. A crew onto an uncaptured pirate lair, or onto a spice farm (which takes the sack in exchange, permanently spends the crew and grants the advantage at once) |
| `explorers_take_crew` | `{ship_id, h}` | Movement phase. One of your own surviving crews back off a captured lair |
| `explorers_load_haul` | `{ship_id, h}` | Movement phase. A fish haul off a shoal. A haul is a large piece, so the hold must be otherwise empty |
| `explorers_deliver` | `{ship_id}` | Movement phase, at either anchor of the Council hex. Hands over the haul and every sack aboard: +1 space on the fish track and +1 per sack on the spice track |
| `explorers_found` | `{ship_id, v}` | Movement phase. Lands a settler as a settlement on a corner of an explored land hex the ship touches. Both the settler and the ship are spent; only the distance rule applies |
| `explorers_fish_roll` | none | Movement phase, once. One die; a match with an explored shoal's number places a haul there |
| `explorers_chase_pirate` | `{ships}` | Movement phase. Battle-ready ships (not moved this turn, standing at a corner of the pirate's hex) roll one die each in the order given, and rolling stops at the first success |
| `explorers_move_pirate` | `{h, victim?}` | Owed after a 7, and again after a successful chase. Any revealed sea hex except one adjacent to the home island; your own pirate ship must move somewhere new |

Refusals carry the module's own codes: `SHIP_NEEDS_WATER`, `INTO_THE_FOG`,
`NO_SHIPYARD`, `NOT_COASTAL`, `HOLD_FULL`, `ROOM_REMAINS`, `NOT_AT_HARBOUR`,
`NOT_MOVEMENT`, `NO_MOVEMENT`, `STOPS_AT_THE_FOG`, `ALREADY_SPED`, `NO_TRIBUTE`,
`PIRATE_PENDING`, `PIRATE_MUST_MOVE`, `NO_CHASE`, `OUT_OF_REACH`, `NO_CREW`,
`NO_SETTLER`, `LAIR_CAPTURED`, `FARM_BEFRIENDED`, `NO_HAUL`, `ALREADY_FISHED`,
`NOT_AT_COUNCIL`, `NOTHING_TO_DELIVER`, `NO_GOLD`, `GOLD_SPENT`, `NO_FAST_GOLD`,
plus the core `BUILDING_OVER` for a build or a trade attempted after the
Movement door. See `engine/explorers/usererr.go`.

**Decision ids.** One: `explorers_pirate` (15s), the activation a 7 owes. It is
a placement plus, where the hex has ships on it, a victim, so it sits with the
other "pick a spot" decisions rather than with the deliberations.

### Explorers events

Every event is public except the pirate's steal. The module's other secret
belongs to no seat: two thirds of the board is face down, so it is kept by
masking the board rather than by hiding an event (see below).

| event | payload | visibility |
|---|---|---|
| `explorers_harbour_placed` / `explorers_settlement_placed` | `{player, v, gain?}` | public; the setup draft. `gain` is the round-1 settlement's starting resources |
| `explorers_start_placed` | `{player, road, ship, ship_id}` | public; setup round 2, both pieces |
| `explorers_harbour_built` | `{player, v}` | public; the upgrade |
| `explorers_ship_built` | `{player, ship_id, e, recycled?}` | public |
| `explorers_ship_moved` | `{player, ship_id, from, to, path, steps, tribute?, stopped?}` | public. `path` is every edge crossed, one per movement point; `stopped` marks a move that ended in a reveal |
| `explorers_ship_sped` | `{player, ship_id}` | public |
| `explorers_hex_revealed` | `{player, h, res, number?, kind?, shoal?, village?, region, gain?}` | public, and it carries the terrain: a revealed hex is public from that moment, and the client's own board copy still says `fog`. `number` is the chit drawn from that region's stack |
| `explorers_cargo_bought` / `explorers_jettisoned` | `{player, cargo, cost?, at_ship, ship_id?, v?}` | public |
| `explorers_cargo_moved` | `{player, ship_id, v, cargo, to_ship}` | public |
| `explorers_crew_landed` | `{player, ship_id, h, sack?, village?, region?}` | public |
| `explorers_crew_taken` | `{player, ship_id, h}` | public |
| `explorers_haul_placed` / `explorers_haul_missed` | `{player, h?, die}` | public; the fishing roll, hit and miss. The miss is an event because the roll is a public draw off the seeded stream and a replay has to reproduce it |
| `explorers_haul_loaded` | `{player, ship_id, h}` | public |
| `explorers_delivered` | `{player, ship_id, hauls?, sacks?}` | public |
| `explorers_founded` | `{player, ship_id, v}` | public |
| `explorers_lair_resolved` | `{h, involved, rolls, crews, hero, number}` | public; the whole battle in one event, so a replay reproduces it without re-rolling. `involved` is clockwise from the active player |
| `explorers_pirate_owed` | `{player}` | public; a 7 owes an activation |
| `explorers_pirate_moved` | `{player, h, from?, displaced?, victim?, res?, gold?, haul?}` | the card is sealed to the thief and the victim; everyone else sees the same payload with `res` cleared. `gold` is set only on the one route by which gold is ever stolen: a victim with no resource cards at all |
| `explorers_pirate_chased` | `{player, ships, rolls, need, won}` | public |
| `explorers_gold_changed` | `{gains: [{player, amount, reason?}], reason?}` | public; a batch, because a production roll pays the consolation gold to every seat that received no resources |
| `explorers_gold_traded` | `{player, give?, get?, gold, reason}` | public |
| `explorers_movement_began` | `{player}` | public |
| `explorers_turn_reset` | none | public bookkeeping: the per-turn counters |

**The fog on the wire.** `board_generated` is emitted with `Visible: []` (nobody
sees the full payload) whenever a module implements `MaskBoard`, and a
registered redactor produces what everybody gets instead: the same board with
every unrevealed pool hex rewritten to the wire-only `fog` resource and no chit,
and the module's recorded layout blob dropped, which is the whole face-down map
in one field. Live state views are masked the same way through `MaskBoard`
itself. For every other ruleset the redactor is inert: a registered redactor is
applied to a public event for every viewer, and a base-game `board_generated`
is one, so it re-marshals the payload unchanged.

### Scenario view shapes

`state.full.ext.fishermen` (from `FishExt.ViewExt`):

```
{"fish":[3,0,5],
 "boot_holder":-1,
 "grounds":[{"v":[...],"hex":{q,r},"number":8}, ...],
 "lake_numbers":[2,3,11,12],
 "mix":[1,1,0]}
```

- `fish`: fish value per seat, public.
- `boot_holder`: a seat, or -1.
- `grounds`: up to six; `v` is 2 or 3 contiguous coastal vertices.
- `mix`: the viewer's own `[1s,2s,3s]`; absent for spectators.

In a Fishermen game the robber can be off the board, and the wire says so by
coordinate rather than by flag: `board.robber` carries a hex outside every
board (`board.OffBoard`, a large negative pair) from setup until the first 7
and again after any two-fish spend. A client draws the robber only when its hex
is a tile on the board, and every "is this hex blocked" test answers no without
a special case.

`state.full.ext.caravans` (from `CaravansExt.ViewExt`):

```
{"camels":[{"caravan":0,"e":{a,b}}, ...],
 "camels_left":19, "camel_supply":22,
 "caravans":[{"caravan":1,"arrow":{a,b},"corner":{q,r,side}}, ...],
 "occupied":[{a,b}, ...],
 "oasis":{q,r},
 "bid_resources":[3,4],
 "voting":true, "finisher":2, "placer":-1, "bidded":[0,2],
 "bids":[{"player":0,"cards":[1,0],"path":{...}}, ...],
 "reason":"coalition"}
```

- `camels`: grouped by caravan, in chain order from the oasis; never sort it.
- `caravans`: the spokes; a missing spoke is omitted.
- `occupied`: every camel edge, flat.
- `oasis`: omitted when the board has none.
- `bid_resources`: the two resources this ruleset bids in (brick and lumber
  under Knights).
- `voting`, `finisher`, `placer`, `bidded`: while a round is open.
- `bids`: every bid, open round or closed.
- `reason`: once resolved, until the camel is placed.

`legal` gains one list: `camel_paths` (`[{caravan, e}]`, in the module's own
order), present only for the seat that can act on it: the placer once the round
has closed, and the seat on the clock while it is open, because a bid may name
the placement it wants. It reaches a seat that is not `cur` because it comes
through the `PendingTargets` hook rather than `LegalExtras`; see
[scenarios.md](scenarios.md).

So `camel_paths` also tells the client whose go it is: while
`ext.caravans.voting` is true and `placer` is `-1`, the view carrying the list
belongs to the seat on the clock. Gate bid controls on that rather than
re-deriving the clockwise order in the client.

`state.full.ext.harbormaster` (from `harbormaster.Ext.ViewExt`):

```
{"holder":2,
 "points":[1,0,3],
 "threshold":3}
```

- `holder`: the seat holding the Harbormaster card, or -1.
- `points`: harbour points per seat: 1 per own settlement and 2 per own city on
  a harbour vertex.
- `threshold`: the total needed to hold the card, published so the client need
  not hard-code a rule.

Everything in it is public and the view is identical for every viewer, spectators
included. `points` is derived (a pure function of the board and the buildings
on it) and folded from `harbormaster_standings` only so a view can publish it:
`ViewExt` gets a viewer and no state, so it can only publish what the ext
stores. The card's 2 VP are in `public_vp` as well as `vp`, like Longest Road's.

`legal` gains nothing: the module adds no command.

`state.full.ext.raiders` (from `Ext.ViewExt`):

```
{"castle":{q,r},
 "castle_paths":[{a,b}, ...],
 "coast":[{q,r}, ...],
 "raider_count":[0,1,3, ...],
 "conquered":[{q,r}, ...],
 "supply":31,
 "riders":[{"player":0,"e":{a,b}}, ...],
 "riders_left":[4,6,6,5], "riders_per_seat":6,
 "prisoners":[3,0,1,0], "gold":[6,0,3,9],
 "deck":[13,4,4,3],
 "gold_buys_left":2,
 "rider_moves":[{"from":{a,b},"to":[...],"hurry":[...],"must_leave":true}, ...],
 "pend":{"kind":"raiders_landing","seat":2,"numbers":[8,6],"hexes":[...]}}
```

- `castle`: omitted when the board has none. The tile underneath keeps its
  resource and its number, and the client draws the castle over it and hides
  that chip.
- `castle_paths`: the six paths riders enter on.
- `coast`: the landing-eligible hexes, ascending `(q,r)`.
- `raider_count`: parallel to `coast`; 3 is conquered.
- `conquered`: the saturated hexes, spelled out rather than left to be derived.
- `supply`: meaningless under Knights, where it is unbounded.
- `deck`: muster, swift_rider, treason, intrigue.
- `rider_moves`: the viewer's own riders only.

`pend.hexes`, `pend.edges` and the two Treason lists reach only the seat being
asked; everyone else is told the kind and the seat, which is enough for the
board and the event log. `rider_moves` holds the viewer's own riders only.

Raiders publishes no `legal` fields: every piece it adds lives on an edge or a
hex `LegalTargets` has no field for, and that struct is shared by every module.
A client reads the offers from `ext.raiders`, as it does for camel paths and
fishing grounds.

The robber is off the board in every Raiders game, at `board.OffBoard`, and
`board.Robber` is never read. A 7 discards over the limit (gold is not counted)
and then takes one random resource card from a player of the roller's choice.

### Rivers commands, events and view

`engine/rivers/` adds one piece (the bridge), one currency (coins) and three
commands. Nothing it holds is hidden information: coins are public, the
watercourse is public, and the module registers no redactor, so every event
below is public and the fold of a spectator stream reproduces every number in it.

| type | data | notes |
|---|---|---|
| `build_bridge` | `{e}` | your own actionable turn, never during setup, and never paid for by a free-road credit. `e` must appear in `legal.bridges`, which lists the empty bridge sites this seat's own network reaches; the 2 brick + 1 lumber and the 3-per-player supply are checked on the command |
| `buy_coin` | `{res}` | your own actionable turn, as often as you like. Sells `res` to the supply for one coin at this seat's best rate for it, which is the same number `bank_ratios[res]` publishes: 4:1, 3:1 at a generic harbour, 2:1 at that resource's own |
| `spend_coins` | `{res}` | your own actionable turn, at most twice a turn (`ext.rivers.spends_left`). Two coins buy one card of `res` from the supply, and the purchase is refused whole when the supply is out |

Two more commands buy something of this module's with another module's
currency, and live in the module that owns the effect rather than here:
`spend_fish` `{use: "bridge", e}` builds a bridge for 6 fish (Fishermen), and
`pillage_buyout` (no payload) spends 5 coins to keep a city the barbarians were
about to take (Knights). The second is only legal for a seat the attack listed
as owing a sacrifice, is refused with `NO_COINS` when the seat cannot pay, and
resolves as `rivers_coins_changed` with `reason: "pillage"` followed by
`cak_pillage_bought_out`. Under a ruleset that sells the buyout, a losing seat
with only one city is asked rather than razed inside the attack event, because
it has a choice.

Refusals carry the module's own codes: `BRIDGE_SITE_ONLY` (a road or a ship on
an edge the channel crosses), `NOT_BRIDGE_SITE` (a bridge anywhere else),
`NO_BRIDGES`, `NO_SETUP_BRIDGE`, `NO_COINS`, `COIN_SPEND_CAP`, `SUPPLY_EMPTY`.
See `engine/rivers/usererr.go`. Rivers owes nobody a decision: it never
interrupts a turn, so it reports no `PendingDeciders` and has no decision ids.

Six `rivers_*` events, all public:

| event | payload | notes |
|---|---|---|
| `rivers_bridge_built` | `{player, e, free?}` | `free` marks a bridge another module paid for (Fishermen's six-fish spend); it still pays its 3 coins, because coins are paid for the placement |
| `rivers_coins_changed` | `{player, delta, reason, e?, v?}` | `reason` is `build`, `bought`, `spent`, `trade` or `pillage` (5 coins paid to keep a city under Knights). `e`/`v` name the edge or vertex a building payment was made (or reclaimed) for, which is what lets a replay rebuild the "which pieces have already paid" ledger; absent on a purchase, a spend or a trade. A `delta` of 0 with a position is a reclaim clamped against an empty purse, and still clears the ledger entry |
| `rivers_coin_bought` | `{player, res, paid}` | the cards leaving the hand for the supply; the coin arrives on the `rivers_coins_changed` that follows |
| `rivers_coins_spent` | `{player, res}` | the supply paying one card; the coins leave on the `rivers_coins_changed` that follows |
| `rivers_coin_traded` | `{from, to, coins}` | coins moving in a player trade |
| `rivers_wealth_changed` | `{wealthiest, poorest}` | the whole new assignment, not a delta: `wealthiest` is a seat or `-1` (a tie gives the tile to nobody), `poorest` every seat tied for the fewest coins |
| `rivers_turn_reset` | `{}` | clears the per-turn coin-spend counter |

Coins ride a player trade through the same opaque module payload Knights uses
for commodities (`give_com` / `want_com`), as an object with a `coins` key. One
blob is handed to every module, so the two shapes coexist: Knights reads a bare
array or `{"commodities": [...]}`, Rivers reads `{"coins": n}`, and either
module reports a payload it does not recognise as nothing of its own rather than
refusing the trade.

`state.full.ext.rivers` (from `rivers.Ext.ViewExt`):

```
{"rivers":[{"hexes":[{q,r}, ...],
            "mouth":3,
            "in":[{a,b}, ...],
            "out":[{a,b}, ...],
            "shapes":["src_w", ...],
            "sites":[{a,b}, ...],
            "variants":[0, ...]}],
 "sites":[{a,b}, ...],
 "bridges":[{"player":0,"e":{a,b}}],
 "coins":[3,0,1],
 "bridges_left":[2,3,3],
 "poorest":[false,true,false],
 "wealthiest":0,
 "poorest_in_play":true,
 "bridge_supply":3, "bridge_cost":[0,1,2,0,0,0],
 "coin_per_res":2, "spends_left":2,
 "wealthiest_vp":1, "poorest_vp":-2}
```

Per river:

- `hexes`: the chain, downstream: source first, estuary last.
- `mouth`: the index into `hexes` of the swamp; always `len-1`.
- `in`, `out`: per hex, the edge its channel enters by and the edge it leaves by.
- `shapes`: per hex, which channel it draws.
- `sites`: this river's bridge sites, in chain order.
- `variants`: per hex, which authored meander of that shape.

For the board:

- `sites`: every bridge site on the board, flat.
- `coins`: per seat, public.
- `poorest`: per seat.
- `wealthiest`: a seat, or -1 for nobody.
- `poorest_in_play`: false alongside Wagons and Raiders.

`in` and `out` are the rules fact a client draws from: the two edges a hex's
channel meets join river hexes into one river and decide where a bridge may
stand. At the source they are the same edge: a headwater hex has one mouth, the
seam with the next hex downstream. That is also why `sites` is `n` long rather
than `n+1`.

`shapes` names which channel each hex draws, as the two mouth directions sorted
by the engine's direction index and joined with an underscore: nine two-mouth
ids (`"e_w"`, `"ne_sw"`, `"nw_se"`, `"ne_w"`, `"e_nw"`, `"e_sw"`, `"w_se"`,
`"ne_se"`, `"nw_sw"`), six one-mouth headwater ids (`"src_e"` through
`"src_se"`), or `""` for a pair no tile has, which a client draws as plain
terrain. It is derivable from `in` and `out` and is published anyway so the
client needs no second copy of the axial-to-world mapping. There is no rotation
to publish: a river tile is laid down at the board's own facing like every other
tile, and the shape picks the file. Which of the four terrains wears it is art
the renderer owns; see `frontend/src/lib/board3d/layers/rivers.ts`.

`variants` is which authored meander of that shape the hex draws, parallel to
`hexes`. Only the east-west straight has more than one (two: an asymmetric
meander and its mirror), so every other entry is 0. It is a derivation, not a
rendering choice: one draw per east-west hex off the reserved public slot
`engine.RiversVariantSeq`, recorded in the board event and reproduced by
`verify/`, because players can see it. A client that predates the field draws
meander 0 everywhere.

The module adds one terrain string: `"swamp"`, the non-producing land hex a
river ends on. It takes no number token, produces nothing and may hold the
robber, like the desert.

`state.full.ext.explorers` (from `explorers.Ext.ViewExt`) is the same shape for
every viewer, spectators included, because nothing in it is a seat's secret:

- `home`, `waters`, `council`, `anchors`: the partition, and the two berths a
  delivery is made at.
- `fog`: every hex nobody has revealed. Derivable from the masked board too,
  and served anyway so a client never has to infer a rule from a resource name.
- `revealed`: one entry per revealed hex: `{h, region, kind,
  shoal?, village?, captured?, crews?, farmers?}`.
- `harbours`, `ships`, `hauls`, `hauls_left`, `pirate`, `pirate_owner`,
  `pirate_by`.
- `seats`: per seat: `gold`, the four supplies, `track` (three markers),
  `villages`, the two per-turn counters and `mission_vp` (positions plus tiles,
  already summed, because the tiles depend on who is farthest along and the view
  does not carry arrival order).
- `leaders`: who holds each track's bonus tile, or -1.
- `chits_left`: how many number chits each region's face-down stack still
  holds. Public: the stacks are face down but their size is a count anyone at
  the table can keep, and it tells a player how much new land is left.
- `movement`, `fish_rolled`, `round`: the turn stage, the fishing die and
  which of the three setup rounds is running.

`legal` gains two fields for it: `harbours` (the intersections a harbour
settlement may take, which during setup round 0 is where a starting one may go)
and `explorer_ships` (per movable ship: `{ship, from, moves, acts, left}`).
`moves` is one step, not everywhere the ship can reach, because a discovery ends
its movement. `acts` names
each job (`found`, `land_crew`, `take_crew`, `load_haul`) rather than giving a
bare corner, because two jobs can be legal at one corner and one of them spends
the ship.

## Reconnect

Every `sub` to an active game is answered with a fresh full `state` frame; the
frame's `since` is accepted but ignored, because a partial replay would leave a
reconnecting client on a stale view with no turn timer. Clients treat `state` as an
authoritative replacement and `ev` as an increment.

**A re-subscribe on the same socket loses no `ev` frame.** The stock client
re-subscribes after every event burst (the snapshot is the only frame that moves
the phase flags). The server waits for the old forwarder to stop, notes the
first seq it had not queued, and starts the new subscription there: the client
receives the owed `ev` frames, then the `state` frame at the next seq, then the
live stream. It falls back to starting at the snapshot when the viewer changed
(a spectator who took a seat) or the owed
frames have left the shared ring, and the client's gap check then backfills the
log over REST. A re-subscribe that lands on a game that has just finished gets
the owed frames from the store instead, ahead of the final `state` frame.

Missed *log lines* are recovered over REST rather than over the socket: see below.

## Event log

The event log is the game's history, and the two ends keep different amounts of it.

- **The server keeps a short tail in memory.** Each running game has one shared ring
  of ~100 encoded broadcast frames (`game.frameRingCap`). It is a delivery buffer for
  connections that are keeping up: a subscriber that falls further behind is dropped
  and sent `{"t":"resync"}`. SQLite holds the durable log.
- **Clients keep all of it.** A client retains every redacted event it has been given
  for the game it is in, so the in-game log scrolls back to the first roll.

The log is rebuilt from the store, not from the ring:
`GET /api/games/{id}` answers `?since=N` from `EventsSince`, so a cold load asks for
everything (`since` 0) and a reconnecting client asks for the first seq it is
missing. Events are identified by `seq`, and clients merge on it, so an overlapping
refetch is idempotent: a reconnect can neither duplicate nor drop a line.

### Metering the log

`GET /api/games/{id}` (active) and `GET /api/games/{id}/replay` are the only two
endpoints where a small request buys an arbitrarily large answer, so both are
budgeted in events served, not requests, charged after the response is built
(`Server.allowLog` / `chargeLog`). Consequences:

- **Callers in a live game are exempt.** A seated player or the host is never
  metered by `getGame` on their own active table. A failed `getGame` sends the game
  screen back to the lobby, so a budget there could evict a player, for example
  when a housemate, a campus or a Discord Activity shares their address.
  `/replay` meters everyone, players included: a finished game has no table to be
  thrown out of, a refused replay can be retried shortly, and a participant's
  replay is the full unredacted log off disk with no `?since=` cursor.
- **A gap refetch is nearly free.** `?since=<first missing seq>` is billed the
  events in the gap, so the request a real client repeats costs almost nothing.
  Junk cursors fall back to the whole log and are billed as such, so `?since=abc`
  is no bypass.

Everyone metered (spectators, and every replay reader) gets a per-user budget of a
few whole logs with a steady refill, behind a roomier per-IP backstop that exists
because guest sessions are cheap to mint. Over budget is `429 LOG_RATE_LIMITED`, which clients
must treat as retryable with backoff, never terminal (`isFatalApiError` in
`frontend/src/lib/api.ts`).

### Revalidating a replay

A finished game's log never changes, so `/replay` serves an `ETag` and honors
`If-None-Match`, turning a repeat download into a `304` with no body. This saves
bandwidth rather than CPU, and it composes with the meter: a 304 serves zero
events, so it is billed zero. The check runs before the meter, so a caller who
has spent their budget can still confirm a copy they already hold.

The validator is `"r<version>-<p|s>-<gameID>-<maxSeq>"`:

- **`p|s` is security-critical.** One URL serves two bodies: the raw log (seed and
  hidden plays) to someone who played, a redacted one to everyone else. Keyed on
  the game alone, a spectator could present a participant's ETag and be told "not
  modified", which hands over the hidden log via an empty 304.

- **`maxSeq`** invalidates on any append. A terminal status should freeze the log,
  but the validator does not rely on it; `store.MaxEventSeq` is an index seek on
  the `(game_id, seq)` primary key, so the check is free.
- **`version`** (`replayETagVersion` in `server/api.go`) must be bumped whenever
  the bytes change for an unchanged log (a redaction rule, the event shape, the
  envelope), or clients keep the old body off a 304.

`Cache-Control` is `private, no-cache`: storable, but revalidated every time, so
the server stays authoritative and no shared cache ever holds one viewer's copy for
another.

`/frames` revalidates the same way, except that its validator is
`"f<version>-<viewer>-<gameID>-<maxSeq>"`, keyed on the seat rather than on a
participant flag: its views carry that seat's own hand, so there is one body per
seat.

### Why a replay is folded on the server

A client cannot fold a log into a board. `frontend/src/lib/foldEvent.ts` folds
geometry only: victory points, hands, longest road and phase are derived
quantities, and deriving them client-side would mean a second rules engine. A
replay needs all of them, so the fold runs in the engine (`replay.Fold`) and the
client only selects a frame.

Two consequences for redacted logs:

- **A spectator's download still replays.** The seed is stripped from it, but
  the log records outcomes rather than instructions: the board arrives whole
  inside `board_generated`, every roll is its own event, and `Apply` never
  consults the seed. The seed is there to be audited against the commitment the
  players were shown (see [dice.md](dice.md)), not to be replayed from.
- **It must only be folded to a spectator view.** A redacted log's frames match
  a raw log's while nobody's hand is shown, and diverge from the first
  `card_stolen`: a redacted steal does not say which card moved, so folding to a
  seat would show it cards it never held. The upload endpoint therefore folds as
  a spectator and the game endpoint folds from the server's raw log. Both
  properties are tested in `replay/fold_test.go`.

## Decision: server-authoritative, intents only

Clients never send state, only intents (`cmd`). The server validates every command
against the engine and broadcasts what actually happened. Combined with redaction
(hands, fog, face-down cards never leave the server), cheating is limited to what a
player could do at a physical table anyway.

## Errors

- Illegal/out-of-turn commands → `err` frame, state untouched, never a disconnect.
- Malformed frames or floods → rate-limited, then the socket is closed (the session
  stays valid; the client may reconnect).

### The client renders the words, not the server

The backend never sends prose a client renders. An `err` frame (and an HTTP error
body) carries a stable `code` plus optional named `params`; the client turns those into a
sentence in the player's own language. See [user-facing-text.md](user-facing-text.md) for
the naming convention, the typed-parameter rules, and how to add a refusal.

`debug` is a developer aid: English reference wording so a raw socket dump reads
without a code table. It is never localized and clients must not render it, which is
why it is named `debug` rather than `msg`.

Every distinct refusal has its own code, and the build fails if a refusal with curated
wording is missing one (`engine/ruletest` sweeps every `decide.go` sentinel). So an
error that reaches the transport with no registered code is a server failure rather
than a refusal, usually `store.AppendEvents` returning a raw SQLite error. Those get
`STORAGE_ERROR` ("nothing was saved, so nothing changed") plus an operator log line.


HTTP error bodies use the same shape:

```
{"code":"GAME_FULL", "params":{...}, "debug":"This game is full"}
```
