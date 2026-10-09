# User-Facing Text

## The rule

**The backend never sends human-readable prose that a client renders.**

A refusal, a notice, anything a player reads, leaves the server as a **stable code**
plus **named, typed parameters**. The client owns the words.

```
server → client   {"t":"err","ref":"c7","code":"NO_RESOURCES",
                   "params":{"missing":{"brick":1,"ore":2}},
                   "debug":"You don't have the resources for that"}

client renders    "You need 1 brick and 2 ore."   (frontend/src/lib/errorCopy.ts)
```

`debug` is a **developer aid**: English, never localized, and never rendered by a
client. It makes a raw socket dump or network-tab inspection readable without a code
table. It is called `debug` rather than `msg` so rendering it does not look like the
obvious thing to do.

### Why

A sentence composed on the server is in the server's language: the client cannot
translate it, reword it without a deploy, or shorten it for a small screen. And if many
distinct refusals share one code with varying prose, the prose carries the meaning the
code should.

Events already follow this rule (~45 snake_case event types with pure-data payloads, no
English in the log or snapshots); this applies it to refusals and the transport.

## Code naming convention

`SCREAMING_SNAKE_CASE`, globally unique across the core, every expansion module, and the
transport. Derived from the sentinel's name with the `Err` prefix dropped:
`ErrTooClose` → `TOO_CLOSE`.

- **No module prefix.** A code names a refusal, not the package that raised it.
  Uniqueness is enforced by test, not by namespacing.
- **Codes are stable identifiers.** They are safe to persist and are the key
  translations hang off. Rename one only with a migration plan.
- **One code, one meaning.** If two call sites share a code but would show different
  sentences, the code is not carrying the meaning. Split it. `TestNoCodeCarriesTwoMeanings`
  in `server/` fails the build when this happens.
  - The one exception is `INTERNAL`: many causes, one meaning to a player
    ("it broke, try again"). The varying detail belongs in `debug` and the logs.

## The typed-parameter requirement

Where a message has variable content, the code carries **named** parameters. Never
positional ones, and never a pre-formatted fragment.

```go
// engine/build.go
return nil, noResources(CostCity, ps.Hand)   // -> NO_RESOURCES {missing:{ore:2,wheat:1}}
return nil, noPieces(PieceCity)              // -> NO_PIECES    {piece:"city"}

// engine/turn.go
return nil, WithParams(ErrBadDiscard, Params{"needed": need})
```

Rules:

- **Named, not positional.** Word order differs across languages, so only the renderer
  can decide where each value belongs. `{needed: 2, resource: "brick"}`, never `[2, "brick"]`.
- **Identifiers, not words.** `"brick"` and `"city"` are stable tokens the client maps
  to its own vocabulary. A parameter that is an English word or phrase puts prose back
  on the wire.
- **Wire-safe shapes only.** `string`, `int`, `bool`, `[]string`, `[]int`,
  `map[string]int`. `engine.ValidParams` defines the set. The registry test exercises it,
  and `errParams` in `server/ws.go` re-checks at the wire boundary: anything else is
  dropped (code kept, operator warned).
- **Send what the player acts on, not what the server computed.** `NO_RESOURCES` sends
  the *shortfall*, not the cost, so the client does not redo arithmetic the server
  already did.

Do not invent parameters where the message has no variable content.

## How to add a new user-facing refusal

Engine or module refusal:

1. Declare the sentinel where the rule lives (`engine/decide.go`, `engine/knights/decide.go`, …).
2. In the owning package's `usererr.go` `init`, register **both**:
   ```go
   engine.RegisterErrorMessage(ErrNoOpenRoad, "That road isn't an open end")
   engine.RegisterErrorCode(ErrNoOpenRoad, "NO_OPEN_ROAD")
   ```
   The message is the English *reference wording*: what the code means, and what a
   headless tool prints when there is no client to render. It is not what a player sees.
3. If the refusal has variable content, return `engine.WithParams(ErrX, engine.Params{…})`
   at the site where the data is in hand. `errors.Is` still resolves to the sentinel, so
   every existing rules test is unaffected.
4. Add the copy to `frontend/src/lib/errorCopy.ts`.

Transport refusal (`server/`):

1. `c.sendErr(f.ID, "SPECTATOR_CANNOT_ACT", "Spectators cannot act")`, or
   `c.sendErrParams(...)` / `writeErrParams(...)` when there is variable content.
2. Add the copy to `frontend/src/lib/errorCopy.ts`.

The guards below fail the build if step 4 is skipped.

## The guards

| Test | Where | What it catches |
|---|---|---|
| `TestErrorRegistryIsOneToOne` | `engine/ruletest` | A sentinel with a message but no code (it would collapse into `STORAGE_ERROR`), or a code with no message. |
| `TestEveryRulesSentinelIsRegistered` | `engine/ruletest` | A sentinel added to *neither* table, which the 1:1 check cannot see. |
| `TestErrorCodesAreUniqueAndWellFormed` | `engine/ruletest` | Two refusals sharing a code; a code that is not `SCREAMING_SNAKE_CASE`; a code colliding with the `STORAGE_ERROR` fallback. |
| `TestErrorMessagesAreWellFormed` | `engine/ruletest` | Empty wording, em dashes, internal jargon (`cak:`) leaking into presentation. |
| `TestFrontendCopyCoversEveryCode` | `engine/ruletest` | A backend code with no entry in `errorCopy.ts`, which a player would otherwise see raw (`MIGHTY_NEEDS_FORT`). |
| `TestRefusalParamsAreWireSafe` | `engine/ruletest` | A parameter that is not a JSON-safe scalar or flat container. |
| `TestErrFrameWireShape` | `server/` | The err frame growing a `msg` field, or any field outside `{t, ref, code, params, debug}`. |
| `TestNoCodeCarriesTwoMeanings` | `server/` | Two transport sites sharing a code while saying different things, i.e. prose doing the code's job. |
| `TestTransportCodesAreWellFormed` | `server/` | A malformed transport code. |
| `TestReferenceWordingIsClean` | `server/` | An em dash in reference wording. |
| `TestFrontendCopyCoversEveryTransportCode` | `server/` | A transport code (from `server/` or `auth/`, a call wrapped over several lines included) with no entry in `errorCopy.ts`'s `ERROR_COPY` table. |
| `TestFrontendCopyCoversEveryMapIssueCode` | `engine/ruletest` | A map lint code with no entry in `MAP_ISSUE_COPY`. |
| `errorCopy.test.ts` | `frontend/` | Copy that is a bare code, empty copy, an em dash, parameter composition. |

The registry checks live in `engine/ruletest` because they need every module registered,
and `engine`'s own tests cannot import the modules (they import `engine`).

## Exempt categories

Not everything is prose to be coded; converting internal logs would only make
debugging harder.

### (c) User-generated content: never translate, never code

Chat message bodies, player display names, user-saved map names, quoted report text.
These are content, not copy. Passing them through unchanged is correct.

Bot display names (`lobby/lobby.go`) sit next to this category: they are proper nouns,
not sentences, and are treated as content.

### (d) Operator-facing: exempt

- **`slog` lines.** ~70 sites. Lowercase noun phrase plus structured key/value pairs.
  None is forwarded to a client.
- **Go error text.** `fmt.Errorf` / `errors.New` with package prefixes
  (`lobby: game is full`). These are matched with `errors.Is` and mapped to a code; the
  text itself is never forwarded. `lobbyErr` in `server/api.go` is the mapping.
- **Moderation reasons persisted to SQLite** (`chat_bans.reason`, `name_locks.reason`).
  An audit trail read only by the moderation surface, never rendered to the player.
- **Discord moderator surfaces.** The `/config` panel, mod-channel embeds, admin slash
  commands, `/whois`. These render in a Discord client to a moderator.
- **Ledger reason tokens** (`econ/faucets.go`: `"match"`, `"stipend"`). Lowercase enum
  tokens, not prose.
- **Startup/config failures**, the health endpoint's `"ok"`, the websocket close reason
  on drain.

### (b) Already structured: nothing to do

Event types (`game_paused_error`, the ~45 snake_case engine events), game status values
(`lobby`, `active`, `finished`, `paused-error`), the resource vocabulary (`wood`,
`brick`, …), presence and lobby frames, views and scoreboards.

## Map lint issues

`/api/maps/lint` returns `board.Issue{severity, code, params?, debug, hexes}`. Same
contract, separate namespace: lint codes are lowercase `snake_case`, because they
describe a board rather than refusing a command, and they render from
`MAP_ISSUE_COPY` / `mapIssueText` rather than `ERROR_COPY`. The two issues with
variable content (`terrain_needs_module`, `module_needs_terrain`) carry
`{terrain, module}` as stable tokens, so the client picks its own terrain and
expansion vocabulary. `module_needs_harbours` (Harbormaster on a map with one harbour)
carries `{module, min}`, and its lobby refusal is the transport code
`HARBORMASTER_NEEDS_HARBOURS` with `{min}`.

## The event log stays free of prose

Events carry pure data, so `replay(events)` reproduces the live final state and
per-viewer redaction is a filter over typed payloads. Refusals are not events: a
rejected command produces none, the sender gets an `err` frame, and state is untouched.
Nothing in this contract touches the log, snapshots, redaction or replay.

Player mistakes stay cheap: an illegal or out-of-turn command gets an `err` frame,
never a disconnect.

## Audit inventory

A sweep of the whole backend when this contract was introduced. Category (a) is backend
prose a client rendered; (b) already structured; (c) user-generated; (d) operator-facing.

| Area | Finding | Category | Status |
|---|---|---|---|
| `engine/` events | ~45 snake_case identifiers, pure-data payloads | (b) | Unchanged, preserved |
| `engine/` + modules refusals | 58 rules sentinels with curated wording, 14 codes | (a) | **Converted**: 60 codes (with the 2 game-layer ones), 1:1 with messages |
| `engine/` param-bearing refusals | none carried variable content as data | (a) | **Converted**: `NO_RESOURCES`, `NO_PIECES`, `BAD_DISCARD` now typed |
| `server/ws.go` `err` frames | 25 sites, `{code, msg}`; `FORBIDDEN`/`BAD_FRAME` each overloaded 4-5 ways | (a) | **Converted**: codes split, `msg` → `debug`, `params` added |
| `server/moderation.go` (websocket report flow) | 8 sites; `SERVER` as a third spelling of `INTERNAL` | (a) | **Converted** |
| `server/rematch.go` | 4 sites | (a) | **Converted** |
| `server/api.go` HTTP bodies | ~110 sites; `CONFLICT` covered 8 meanings, `BAD_REQUEST` ~12 | (a) | **Converted**: codes split, `msg` → `debug` |
| `server/cosmetics_api.go`, `ranked_api.go`, `avatar.go`, `server.go` | ~16 sites; `ERROR` as a spelling of `INTERNAL` | (a) | **Converted** |
| `auth/` | ~30 sites building JSON bodies as raw Go string literals, bypassing `writeErr` | (a) | **Converted** |
| `auth/provider.go` OAuth callback | 7 bare `text/plain` strings with no code at all | (a) | **Converted** |
| `lobby/` | 15 sentinels, Go-lowercase, mapped through `lobbyErr` | (d) | Exempt: text never forwarded |
| `game/` actor, timers, auto-pass, disconnect | typed events, structured data, no strings | (b) | Nothing to do |
| `game/actor.go` | 3 registered refusals (`CLAIM_NEEDS_BOTS`, `SEAT_BOT_CONTROLLED`, `GAME_STOPPED`) | (a) | Already coded; now covered by the 1:1 test |
| `store/migrations/*.sql` | all 27 swept: only `''` and enum-ish status defaults | (b) | No prose persisted |
| `engine/board/lint.go` + `engine/module.go` | 14 map lint issues with a prose `message`, 2 of them formatted with variable content | (a) | **Converted**: `Message` → `Debug`, `params` added, copy moved to `MAP_ISSUE_COPY` |
| `store/games.go` | `'Guest'` display fallback hardcoded in SQL (3 queries) | (a) | **Not converted**, see below |
| `cosmetics/catalog.go`, `color.go` | ~45 catalog display names, keyed by stable item id | (a)-adjacent | **Converted** for the 42 static items (`frontend/src/lib/cosmeticNames.ts`); colour names not, see below |
| Discord player-facing commands (`/stats`, `/leaderboard`, `/link`) | ~25 strings, plus an English `" and "` list join | (a) on Discord | **Not converted**, see below |
| Discord moderator surfaces, `slog`, Go error text, ledger tokens | ~150 strings | (d) | Exempt |
| Chat bodies, display names, map names | | (c) | Exempt |

## Out of scope

Three items above are not (fully) converted. None is an error-code problem:

1. **`'Guest'` in SQL** (`store/games.go`). The anonymous-guest fallback is baked into
   three `COALESCE` expressions, indistinguishable from a player named "Guest". The fix
   is to return an empty name and let the client render the fallback, which touches seat
   rendering across the lobby and game screens.

2. **Cosmetic catalog names** (`cosmetics/`). Every item has a stable id
   (`decoration.fire_blue`). **Done for the static catalog:** the shop renders
   `cosmeticName(item)` from `frontend/src/lib/cosmeticNames.ts`, keyed by id,
   with the server's `name` as the fallback for an id the bundle predates.
   `cosmeticNames.test.ts` reads `catalog.go` and fails when a row has no client copy
   or the two Englishes drift. The ~64 **colour** names (`color.go`) are still sent and
   shown as-is: the docs/i18n glossaries list them as brand flavour, not translated.

3. **Discord player-facing command replies.** These render in a Discord client, which
   our frontend's localization cannot reach, so this surface (plus moderation DMs) is
   English only and the server resolves no language. `rulesetLabel` joins module names
   with a literal `" and "`.

The i18n layer: `errorCopy.ts` holds Lingui message descriptors rendered in the active
locale, and the frontend ships catalogues and a language switcher. The choice of language is a
purely client-side one (`localStorage` -> `?lang=` -> `navigator.languages` -> `en`);
the server stores none.
