# Auth & Identity

## Discord OAuth2

Standard authorization-code flow:

```
GET /auth/discord          → redirect to Discord (scope: identify)
GET /auth/discord/callback → exchange code, fetch user, upsert users row,
                             create session, set cookie, redirect to app
POST /auth/logout          → delete session
```

By default we request only the `identify` scope (username, id, avatar). No
email, no guilds. The scope list is `auth.Config.Scopes`, which `cmd/costan`
leaves empty, so the `identify` default always applies; no environment variable
sets it. `relationships.read` is opt-in by adding it there; see the friends
section.

The identify response also carries the Discord client language (`locale`),
which we ignore: language is frontend-only, the server stores none, and
`PATCH /api/users/me` accepts only a name (guests get `GUEST_NO_SETTINGS`).

## Decision: opaque session tokens, not JWT

Sessions are random 256-bit tokens in the `sessions` table, delivered as an
HttpOnly, Secure, SameSite=Lax cookie. Why not JWT: revocation is trivial (delete
the row), there's exactly one server and one database, and we avoid a class of
signing/expiry bugs. Sessions expire after 30 days of inactivity (sliding).
Only the SHA-256 of each token is stored (`sessions.token_hash`), so the
database and its backups never hold a usable session.

`POST /api/token` (the Activity code exchange) only accepts
`Content-Type: application/json` from an origin the server recognises as its own
(the base URL, its own host, or `https://<app id>.discordsays.com`), which closes
login CSRF via a cross-site form post.

The websocket handshake authenticates with the same cookie at upgrade time. No
token-in-query-string.

## Guest players

Anyone with an invite link can play without Discord:

- Opening an invite link with no session mints a guest `users` row
  (`is_guest = true`, chosen display name) and a normal session.
- Guests are full players: they hold seats, reconnect, appear in history.
- Guest identity lives only in that cookie: clear it and the identity is orphaned
  (the seat goes to auto-pass like any disconnect).
- If a guest later logs in with Discord, the accounts merge (see
  [storage.md](storage.md)); games and stats carry over.

Public games (joining from the browser without an invite) require Discord; guests
exist so a friend can join your private game easily, not for anonymous public
play. Spectating follows the same rule: invite-link spectators may be guests,
public game spectators need Discord.

## Decision: Discord friends are the friends system (MVP)

The backend has no friendships of its own; Discord's friend graph is the social
layer:

- When `relationships.read` is added to `auth.Config.Scopes` (it is not
  requested by default, and the server binary never adds it), login fetches the user's Discord friend list and
  caches the edges in `discord_friends` (refreshed on each login).
- `GET /api/social/friends` returns the user's Discord friends **who have costan
  accounts**, each with live presence from the hub: online, and which game
  they're in (if any).
- Guests have no Discord identity, so their friends list is empty.

**Caveat:** `relationships.read` is a restricted scope: Discord must approve the
application before real users can grant it, which is why it is off by default.
Without it (or if the fetch fails, which is logged) the friends list is empty and
everything else works. Invite links
remain the universal fallback for getting people into games.

## Rate limiting & abuse

- Per-session command and chat rate limits enforced at the hub.
- Guest creation rate-limited per IP (invite links could otherwise mint unlimited
  identities).
- Game creation rate-limited per user.
