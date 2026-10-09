# Chat Moderation

The in-game chat moderation system: how reports flow from a player to a mod team,
how moderators action them, and how enforcement is applied. The system records
facts, surfaces them to Discord, and applies bans; all judgement lives with the
human mod team.

## Data model

Migration `store/migrations/0023_chat_moderation.sql` adds four tables:

| Table | Purpose |
|---|---|
| `chat_bans` | One row per currently-banned user. `banned_by` and `report_id` are nullable (manual bans via slash command have no linked report). `expires_at` is reserved but always NULL: bans are permanent until lifted. |
| `chat_reports` | One row per distinct reported message (deduped by `chat_id`). `status` is `open` or `resolved`; `resolution` is `none`, `warn`, or `ban`. `report_count` increments when additional reporters file on the same open message. `discord_message_id` records the mod-channel embed id for audit purposes. |
| `mod_strikes` | Append-only ledger of individual strike events. `kind` is `warn` (issued to the accused) or `denial` (issued to the reporter when a report is dismissed). Used both to track escalation and to compute the rolling reporter-abuse window. |
| `mod_config` | Simple key/value store for runtime settings. Currently holds one key: `report_channel` (the Discord channel id where report embeds are posted). |

## Policy constants

All tunables live in `store/moderation.go`; nothing else hard-codes these numbers.

| Constant | Value | Meaning |
|---|---|---|
| `warnEscalateThreshold` | `3` | A user with this many or more warnings inside `warnWindow` is auto-escalated to a chat ban on the next "Warn" button press. Exported as `store.WarnEscalateThreshold()`. |
| `warnWindow` | `180 days` | Rolling window for counting warn strikes against an accused. Exported as `store.WarnWindow()`. |
| `denialThreshold` | `5` | A reporter whose reports have been dismissed this many times within `denialWindow` loses the ability to report. |
| `denialWindow` | `7 days` | Rolling window for counting denial strikes against a reporter. |

**Both sides decay.** Warnings and denials are both counted over a rolling window.
`warnWindow` is much longer than `denialWindow` because a warning is a heavier
finding than a dismissed report and a repeat offender should not be able to wait
out a fortnight. `store.LifetimeWarnCount` keeps the whole history for a moderator
who wants it; it carries no policy weight.

Report rate limit: `~1 report per 10 seconds` per user (`keyedLimiter` at 0.1 tokens/sec,
burst 1), initialized in `server/server.go`. This is enforced in-handler before any DB
access.

## Chat prerequisites

Two checks run at chat ingress (`server/ws.go`, `handleChat`) before any message is
saved or broadcast:

1. **Linked Discord identity.** The sender must have a Discord account linked to their
   profile (`user.DiscordID != ""`). Guests and Google-only logins are blocked with error
   code `CHAT_LINK_REQUIRED`, so every chatter is accountable and reachable by DM.

2. **Not chat-banned.** `store.IsChatBanned` is called on every chat send. Banned users
   receive error code `CHAT_BANNED`; their message is not saved or broadcast. The check
   is live (no session cache), so a ban takes effect immediately on the next message
   attempt.

## Automated language filter

After the two prerequisites, `handleChat` runs `chatfilter.Match` on the message.

A hit is not a ban. It drops the message (never broadcast, never shown to anyone
else) and opens a report for a human, via `store.CreateFilterReport`. An automatic
ban is not safe given the matcher's limits: many ordinary phrases and real surnames
contain listed terms ("nip it in the bud", "spic and span", "the dyke held the
flood back", the surnames Coon, Nip and Van Dyke), and a determined user can always
find a spelling the matcher misses. Both directions are tests
(`chatfilter/evasion_test.go`, `namefilter/surnames_test.go`).

How matching works:

- **Normalization first** (`chatfilter.Fold`). Format runes (Cf: zero-width
  characters, soft hyphen, bidi overrides) and combining marks are dropped;
  fullwidth forms fold to ASCII; then lookalike letters (Cyrillic, Greek) and leet
  digits fold to ASCII, but only inside a run that already contains an ASCII
  letter, so genuine Cyrillic or Greek text is left alone rather than rewritten
  into Latin gibberish that could collide with a listed term. Each token is also
  tried with runs of three or more identical letters collapsed and with a plural
  suffix trimmed. The message is scanned twice, raw and folded, because the fold
  blurs some boundaries the raw pass keeps (`chink1`).
- **Whole-word only, never substring.** `chatfilter.Tokens` splits on any
  non-letter rune and on script transitions (Latin↔Han, ↔kana, ↔Hangul,
  ↔Cyrillic, …). The script rule is needed because CJK is written without spaces
  and every CJK character is a letter, so `你好chink你好` would otherwise be one
  token. Combining marks continue a token rather than ending it, so Devanagari,
  Hebrew and Vietnamese words stay whole. No substring matching, which keeps the
  Scunthorpe class ("chinkapin", "snigger") safe.
- **Two tiers** (`chatfilter/wordlist.go`). `bannedWords` are terms with no
  ordinary English reading and match on their own. `ambiguousWords` (`coon`,
  `spic`, `fag`, `dyke`, `chinaman`, `retard`) are also ordinary words, surnames or
  terms of art, and match only when used as a direct epithet: reading backwards
  past articles and intensifiers, the message says "you are a …".

`namefilter.Screen` reuses the same matcher and the same fold, so a reserved name
cannot be spelled around either (`аdmin` with a Cyrillic а, `adm1n`). A name hit
is still `NameSlur`, which rejects the name and locks the account: a name is
chosen rather than typed in passing, and it is rejected before it ever exists.
The ambiguous terms match only as a direct epithet, which a bare name never is, so
surnames such as Coon and Van Dyke pass.

### What `handleChat` does on a hit

In `server/ws.go`, `handleChat`:

1. `store.SaveFilteredChat` persists the message with `chat.filtered = 1`. A
   moderator cannot adjudicate text nobody kept, and the report row keys off
   `chat.id`. The flag keeps it out of every read a player can reach:
   `RecentChat` (the game screen's chat history from `GET /api/games/{id}`),
   `ChatByID` (so it cannot be reported by guessing its id), and the context
   window of any other report. Moderation reads keep it: `ReportByID`,
   `OpenReports` (the `/reports` queue) and the reported line of its own
   report's context.
2. It is **not** broadcast: no other connection ever sees it.
3. `store.CreateFilterReport` opens (or bumps) the report, and a newly-opened one
   posts `postReportEmbed` on the background group, as `handleReport` does.
   `Report.Automated()` is true for these, and `postReportEmbed` renders
   them as "Chat report (language filter)" with "Automated language filter" in
   the Reporter field rather than printing the accused's own name twice.
4. The sender gets `CHAT_FILTERED` ("That message was not sent. It has been
   flagged for review."). Not `CHAT_BANNED`: nothing has been revoked.

**The chat rate limiter runs before the filter.** Every filter hit persists a row,
opens a report and may post a Discord embed, so without the throttle a flagged user
could flood the mod queue. Throttling first bounds it to one report per second per
user, and a throttled message was never shown to anyone anyway.
`server.TestChatLanguageFilterBurstOpensOneReport` holds the order.

`postNameLockEmbed` still exists, since a name hit is still a lock.

## Report flow

### 1. Client sends a report frame

```json
{"t": "report", "chat_id": 12345}
```

The frame is handled by `server/moderation.go` (`handleReport`). Pre-conditions checked
in order:

- `chat_id` must be positive.
- The reporter must have a linked Discord account (`CHAT_LINK_REQUIRED`).
- `store.CanReport` must return true; false means the reporter has accumulated
  `denialThreshold` dismissals in the last `denialWindow` (`REPORT_REVOKED`).
- The per-user rate limiter must permit the request (`RATE_LIMITED`).
- The referenced chat message must exist in the DB (`BAD_FRAME`).
- The reporter must not be reporting their own message (`BAD_FRAME`).

All checks are server-side. The client has no way to bypass them.

### 2. Persist the report

`store.CreateOrBumpReport` runs a dedup check: if an open report already exists for
`chat_id`, it increments `report_count` and returns `isNew=false`. Otherwise it inserts
a new row and returns `isNew=true`. The report is durably stored before any Discord
action is taken.

### 3. Post the mod-channel embed (best-effort, new reports only)

When `isNew=true`, `postReportEmbed` is launched in a goroutine. It is best-effort: if
no bot token is configured or no mod channel has been set, it logs a warning and returns
(the report is already in the DB).

The embed includes:
- The reported message text (truncated to 1 000 characters).
- Accused and reporter display names + Discord mentions.
- The scope (`lobby` or `game:<id>`).
- The accused's prior warning count.
- The report count if > 1 (consolidates duplicate reports on the same message).
- A **Context** field: the chat around the reported message (see below).

Three action buttons accompany the embed:

| Button | Style | `custom_id` |
|---|---|---|
| Do nothing | Secondary | `mod:report:<id>:none` |
| Warn | Primary | `mod:report:<id>:warn` |
| Chat ban | Danger | `mod:report:<id>:ban` |

The Discord message id is saved to `chat_reports.discord_message_id` for audit.

**Everything player-authored in the embed must be escaped.** The reported message
is written by the person the embed is about. `discord.Quote` strips control
characters and bidi overrides, escapes markdown, and gives every line its own `> `
marker (a single `> ` quotes only the first line, so later lines could forge an
"Already actioned." line, a second "Accused" block, or a masked link).
`discord.NameMention` does the same for a display name beside its mention.
Both are wired: `postReportEmbed` and `postNameLockEmbed` quote the text with
`discord.Quote` (the source is truncated to 1000 bytes first, so the cut can never
split an escape sequence) and render names through `nameLine` →
`discord.NameMention`; the `/reports` queue does the same via `reportName`. The
escaper also neutralises `<` and `@`, so a typed `<@id>`, role, channel or emoji
tag, or `@everyone`, shows as literal text. Every other bot reply that prints a
display name (`/stats`, `/spectate`, `/leaderboard`, `/link`, `/whois`,
`/reset-user`, `/unban-chat`, `/unlock-name`, `/report-strikes`) escapes it with
`discord.EscapeMarkdown`; `server/moderation_embed_test.go` holds all of this.
`Embed.MarshalJSON` also strips control characters and enforces Discord's
per-field length limits on every string, so an oversized field is clipped rather
than failing the API call and dropping the report.

#### The surrounding chat

A message is judged by what it answered, so the embed carries a **Context**
field: up to `reportContextLines` (3) messages before the reported one and 3
after, oldest first, from `store.ReportContext`, rendered by
`discord.FitContext`. It looks like this (`**>**` marks the reported line):

```
   **Ann:** gg, well played
   **Bob:** you only won on dice
**>** **Cid:** \*\*shut up\*\* \@everyone
   **Ann:** ok, rematch?
```

What may appear there, and why:

- **The reported message's own scope only.** `ReportContext` reads by
  `chat.scope`, so a lobby report shows lobby chat and a game report shows that
  one game's table chat, never another game's. There is no whisper or team
  chat; both scopes are shown to everyone in them, so the window shows a
  moderator nothing a participant could not already have read. Bot seats do not
  chat, so every line is a person's.
- **Every name and message is escaped** exactly as the reported text is, one
  line per message (a message's second line is cut to " …", so a context line
  cannot forge another), and each message is cut to `reportContextMsgBytes`
  (150) before escaping. The name is bold, not a code span: Discord ignores
  backslash escapes inside a code span, so an escaped name there would show its
  backslashes and a backtick in it would close the span.
- **The context gives way, never the report.** The description (the reported
  message) is built first and is never shortened for the context. The field is
  fitted to what is left of Discord's limits (1 024 per field, 6 000 per embed):
  whole lines are dropped from the far ends, the line after before the line
  before on a tie (what the message answered matters more than what answered
  it), and the reported line goes last. A failed context read is logged and the
  embed posts without the field.
- **No field when there is nothing around it.** A message alone in its scope
  would only repeat the description.

Messages the language filter dropped never appear as context: they were
never shown to the scope, so a reply cannot have answered them (`chat.filtered`,
see [What `handleChat` does on a hit](#what-handlechat-does-on-a-hit)). A
filter report's own message is the exception, as its reported line.

The `/reports` queue does not show context: it is one field per report, up to
25, under the same 6 000-character embed total, which leaves no room; the
pushed embed is where a report is judged.

### 4. Reporter gets no outcome

`handleReport` returns nothing to the client on success. The client toasts
optimistically. The accused does not learn who filed the report.

## Mod actions

Button presses arrive at `POST /discord/interactions` as message-component interactions.
They are Ed25519-verified, then routed to `handleReportButton`. All three paths begin
with an idempotent CAS:

```
store.ResolveReport(id, resolution, modID)
  → rows affected = 1 (won the race): apply side effects
  → rows affected = 0 (already resolved): edit embed to "Already actioned." and stop
```

This prevents double-clicks from issuing duplicate warnings or bans.

### Do nothing

- `store.RecordStrike(reporterID, "denial", &reportID)`: one denial strike on the
  reporter.
- Embed is updated: "Dismissed, no action. Reporter received a denial strike."

### Warn

Before recording the outcome, `store.WarnCount(accusedID)` is fetched. If the count is
already `>= store.WarnEscalateThreshold()` (3), the action is silently escalated to
`ban`: the mod clicked "Warn" but the limit was already reached, so a ban is applied
instead, and the embed says so.

If not escalated:
- `store.RecordStrike(accusedID, "warn", &reportID)`: one warn strike on the accused.
- Best-effort DM to the accused: "You've received a warning for a reported chat
  message. Continued violations may result in a chat ban."
- Embed: "Warned."

If escalated:
- `store.BanChat(accusedID, ...)`: permanent ban recorded.
- Best-effort DM to the accused: "You've been chat-banned after reaching the warning
  limit."
- Embed: "Warning limit reached, chat ban applied."

### Chat ban

- `store.BanChat(accusedID, "report resolution", &modID, &reportID)`: permanent ban.
- Best-effort DM to the accused: "You've been chat-banned for a reported chat message."
- Embed: "Chat ban applied."

### Undo

`store.ReopenReport(id)` is the mirror image of a resolution, in one transaction:
the strike that resolution wrote is deleted, a ban it applied is lifted (only when
the `chat_bans` row still points at this report, so an unrelated or manual ban is
left alone), and the report goes back to `status='open'` for someone to action
again. A newer open report on the same message refuses the reopen by name
(`store.ErrReportSuperseded`) rather than tripping the one-open-report-per-message
index; the message is already back in the queue under another id.

`store.ForgiveLatestStrike(userID, kind)` is the smaller undo: drop a user's most
recent warn or denial without reopening anything.

The likeliest misclick is "Do nothing" on a genuine report (styled as the safe
default), which closes the report and penalises an honest reporter; undo covers it.
What cannot be undone: the DM the accused has already received, and the fact a
moderator has seen the message.

### DM delivery

`dmUser` is always launched in a goroutine (fire-and-forget). Users who have blocked
DMs from unknown bots simply don't receive the notification; the moderation action is
not rolled back. `slog.Warn` is emitted on DM failure.

The DM is English: it renders inside a Discord client, where the frontend's
localization cannot reach it, and the server stores no language. `dmUser` takes a
finished string. Same for every other bot-originated surface (command replies, the
config panel, the game feed).

## Reporter abuse protection

`store.CanReport` counts `mod_strikes` rows where `kind='denial'` and
`created_at >= now - 7*24*3600`. If the count reaches `denialThreshold` (5), the
function returns false and the reporter receives `REPORT_REVOKED`.

This is self-healing: denials age out of the rolling window after 7 days, so a reporter
who reforms is re-enabled without admin intervention. The accused side works the same
way (`warnWindow`, see "Policy constants").

## Slash commands

All moderation commands require the **Manage Server** permission (enforced both by
Discord's `default_member_permissions` at registration and by an in-handler check),
and the interaction must come from the configured home guild (`DISCORD_GUILD_ID`):
Manage Server in any other guild, or in a DM, grants nothing. Interactions whose
signed timestamp is more than five minutes from the server's clock are refused.

| Command | Arguments | Action |
|---|---|---|
| `/config` | *(none)* | Opens the ephemeral admin settings panel (see below). It is the single home for all runtime bot configuration. |
| `/unban-chat @user` | `user` (Discord user) | Looks up the linked costan account and calls `store.UnbanChat`. No-op if not currently banned. |
| `/report-strikes @user` | `user` (Discord user) | Prints the user's total warn count, denials in the last 7 days, and current ban status. |
| `/reports` | *(none)* | Shows the open report queue, oldest first (`store.OpenReports` rendered by `discord.ReportQueueEmbed`). |
| `/undo-report id` | `id` (report id) | Reopens a resolved report and undoes what it did (`store.ReopenReport`). |

### The `/config` panel

`/config` renders an ephemeral, tabbed panel; the active tab is encoded in each
component's custom_id (`config:tab:<tab>`), so the panel is stateless between clicks
and re-renders in place (`UPDATE_MESSAGE`). Tabs (a button row highlights the active
one):

- **Channels**: a channel-select each for the chat-report log, the game feed and
  player feedback, plus disable buttons. Selecting stores immediately
  (`store.SetModChannel` / `store.SetFeedChannel` / `store.SetFeedbackChannel`).
  That is five action rows, Discord's limit, so a fourth channel needs another tab.
- **Supporter roles**: a kind select (`subscription/boost/gift/kofi/staff`) and a
  multi-role-select showing every role mapped to the chosen kind. Editing the
  role-select *rewrites* that kind's whole set: newly-selected roles are mapped
  (reassigning any that were on another kind) via `store.SetPerkRole`, and deselected
  ones removed via `store.DeletePerkRole`. Applies on each member's next role sync.
- **Feed title**: an `Edit title` button opens a modal (text input, prefilled)
  that stores an override (`store.SetFeedTitle`); `Reset to default` clears it.
  Modal submissions arrive as MODAL_SUBMIT (interaction type 5) and re-render the tab.

Re-registering the guild command set with Discord replaces old command names;
Discord purges stale entries after a short propagation window.

## Game feed

When a game starts, `server.postGameFeed` (fired best-effort from a goroutine, so
it never blocks or fails the start) posts a message to the channel configured via
`/config`'s game-feed select. Both start paths fire it: the host pressing start
(`handleStart`) and the matchmaker pairing a ranked queue (`lobbyMatcher`).

The message is a **Components V2** container (`discord.Container`, message flag
`FlagComponentsV2`) rather than an embed, because an embed carries exactly one
thumbnail and the roster needs one avatar per player. Its layout, built by
`gameFeedComponents`:

- a heading (the feed title) and a ruleset + player-count line, marked 🏆 Ranked
  for a matchmade game;
- one `discord.Section` per seat, in seat order (which is turn order, so rows are
  numbered), carrying the seat's color square, its identity, and the player's
  profile picture as the section's thumbnail accessory. Linked players are
  `<@id>`-mentioned, bots show a 🤖 marker, and guests render by name. Seats with
  no avatar (bots, guests) fall back to a stock Discord avatar, since a section
  accessory must carry an image;
- a settings line (target VP, turn timer, fair dice), omitted entirely when a game
  runs on defaults, since a components message may not carry an empty text block;
- a **Watch** link button. A private game's link carries its invite code
  (`/game?g=<id>&inv=<code>`, via `inviteSpectateLink`), because the spectate gate
  needs it (tables are private unless the host opts into public). That puts the
  invite code in the feed channel, which is acceptable because the channel is the
  operator's own and its readers are people the table would hand the code to.
  `/spectate` answers any user about any player, so it hands a private game's
  link (invite code and all) only to a Manage-Server admin; to everyone else a
  private game reads as no game at all.

Seat colors render as the nearest colored-square emoji, assigned greedily in seat
order so no two seats share a square (the palette is finer than the nine-square
emoji set: cyan and blue both sit closest to 🟦). Mentions post with
`allowed_mentions: {parse: []}`, so they render as names but never ping (component
text pings by default, unlike embed text). Player names are escaped
(`discord.EscapeMarkdown`) so a name cannot restyle the message.

The title defaults to "🎲 A game is starting" and can be overridden on the
`/config` **Feed title** tab. No feed channel set, or no bot token wired ⇒ it logs
and returns. The feed announces game *starts* only.

## Player feedback

The profile menu's **Send feedback** item opens a form (`FeedbackDialog`) that
sends `POST /api/feedback`. `server.handleFeedback` stores the row in `feedback`
first (migration 0036), then posts it best-effort from a goroutine to the channel
set on `/config`'s Channels tab, as an embed titled "Feedback": the message in a
`discord.Quote` (escaped, every line quoted, so it cannot pass as the bot's own
text), who sent it (`nameLine`, plus "guest"), and the page. The page is the
client's `location.pathname`, cut by `feedbackPage` to a bare in-app path: no
query string or fragment (invite codes travel there) and nothing that is not a
local path. No channel or no bot ⇒ it logs and the row stays in the table, so
feedback sent before the channel was set is still in the database.

Any signed-in user may send it, guests and chat-banned players included: nothing
in it is shown to other players. It is limited to 2000 characters and to about one
send a minute per user with a burst of three (`feedbackLimit`); refusals are
`FEEDBACK_REQUIRED`, `FEEDBACK_TOO_LONG` (`params.max`) and
`FEEDBACK_RATE_LIMITED`. There are no buttons on the embed: feedback is read, not
actioned.

## Graceful degradation

The reporting pipeline never blocks on Discord availability:

- **No bot token configured:** `postReportEmbed` detects `s.discordBot == nil`, logs
  `slog.Warn`, and returns. The report is already in the DB. Moderators can still
  inspect reports directly.
- **No mod channel set:** same path: `store.ModChannel()` returns `""`, a warning is
  logged, and the embed is skipped.
- **Discord API timeout:** `postReportEmbed` uses a 10-second context deadline. A
  timeout is logged as `slog.Error`; the persisted report is unaffected.
- **DM blocked by user:** `dmUser` goroutine logs `slog.Warn`; the moderation outcome
  stands.

**Watch the backlog.** If the bot token is revoked at runtime, reports pile up in
SQLite silently. `store.OpenReports` lists the queue and
`store.OpenReportBacklog` returns the count and the age of the oldest open report;
that age is the number worth logging on a timer, since one that keeps growing means
a broken bot rather than a quiet channel.

## Reviewing what happened in a game

Chat reports are message-anchored, but disputes about *play* are settled from the
event log, which says who made each move. Every event carries an
`engine.Source` (`events.src`), so a move the server auto-played for a timed-out
or absent seat is distinguishable from one its player chose; `store.seat_control`
records who was holding each seat over the course of the game, including the
stretches where an unattended seat owed nothing and the moment its player came
back. Both are served by `GET /api/games/{id}/replay`. See
[engine.md](engine.md), "Action provenance", and [storage.md](storage.md).

Nothing here records raw connect/disconnect. "This seat was unattended when that
happened" is answerable; "this player was away from their keyboard at 21:04" is not,
by design.

## Out of scope

**Username / display-name reporting is not supported.** Reports are message-anchored:
`chat_id` is required and must refer to a real persisted chat message. Offensive
display names are handled out of band via existing admin tools (`/whois`, `/reset-user`,
direct DB access). Name-only reports would have no message text to show the mod team
and would need a separate review flow.
