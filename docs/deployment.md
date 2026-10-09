# Deployment

Costanio = a Go backend (`cmd/costan`, module `github.com/ftqo/costan.io`) + a
React frontend (`frontend/`). Backend default `:4757`, frontend dev `:4758`.

> The production deploy procedure lives in [DEPLOY.md](../DEPLOY.md) (systemd +
> nginx + Cloudflare Pages) and [UPDATING.md](../UPDATING.md). This file is the
> config-and-feature reference (env table, local testing, supporter perks,
> monetization, go-live checklist).

## Configuration

### Backend (env / flags)

Every one of these has a matching `-flag` (see `cmd/costan/main.go`); the env var
is the default and the flag overrides it. "Production" in the Notes column means
the inference `cmd/costan/main.go:prodLike` makes: `COSTAN_SECURE_COOKIES` set
or an `https://` `COSTAN_BASE_URL`. The three dev-only switches are all gated on
it, so forgetting the flag on a TLS host does not re-open them.

In production the non-secret settings live in `/etc/costan/costan.env` on the
server (start from `deploy/costan.env.example`); the secrets are SOPS-encrypted
in `/etc/costan/secrets.enc.yaml`. Neither is committed. See DEPLOY.md.

| Setting | Env | Default | Notes |
|---|---|---|---|
| Listen address | `COSTAN_ADDR` | `:4757` | |
| SQLite path | `COSTAN_DB` | `costan.db` | `/var/lib/costan/costan.db` in prod (systemd StateDirectory) |
| Allow creating the DB | `COSTAN_ALLOW_NEW_DB` | off | In production the server refuses to *create* a missing database (an empty one passes every health check). Set for a genuine first boot, then remove (DEPLOY.md §5) |
| Public base URL | `COSTAN_BASE_URL` | `http://localhost:4757` | OAuth redirect + prod origin check; an `https://` value alone marks the deployment production |
| Secure cookies | `COSTAN_SECURE_COOKIES` | off | set behind TLS |
| Dev guest login | `COSTAN_DEV_AUTH` | off | enables `GET /auth/dev`; ignored in production; never in prod |
| Log level | `COSTAN_LOG_LEVEL` | `INFO` | `DEBUG`\|`INFO`\|`WARN`\|`ERROR`; an unparseable value keeps `INFO`. Format is text in dev, JSON under secure cookies |
| Bot action delay | `COSTAN_BOT_DELAY` | `1500ms` | pause before each bot action; `0` = instant (what the sim harness wants) |
| Idle game eviction | `COSTAN_GAME_IDLE_EVICT` | `5m` | unload an active game from memory after this long with no subscribers; rebuilt on demand. `0` = never |
| Event-log cap | `COSTAN_GAME_EVENT_CAP` | `8000` | force-end a game once its log exceeds this many events. `0` = no cap |
| Discord client id | `DISCORD_CLIENT_ID` | – | = the Discord Application ID |
| Discord secret | `DISCORD_CLIENT_SECRET` | – | or `DISCORD_CLIENT_SECRET_FILE` (see below) |
| Discord app id | `COSTAN_DISCORD_APP_ID` | – | Activity origin (`<id>.discordsays.com`) and slash-command registration |
| Discord bot token | `DISCORD_BOT_TOKEN` | – | or `DISCORD_BOT_TOKEN_FILE`. Enables supporter role sync; bot must be a guild member |
| Discord guild id | `DISCORD_GUILD_ID` | – | the server whose roles grant perks |
| Discord public key | `DISCORD_PUBLIC_KEY` | – | app's Ed25519 key; enables `POST /discord/interactions` (the slash commands, including `/config`) |
| Supporter role allowlist | `DISCORD_SUPPORTER_ROLE_IDS` | – | *optional* static `roleID:kind,…`; unioned with the DB mapping set on the `/config` panel. See "Supporter perks" below. A malformed value is fatal at startup |
| Google client id | `GOOGLE_CLIENT_ID` | – | enables Google sign-in; omit to disable that provider |
| Google secret | `GOOGLE_CLIENT_SECRET` | – | or `GOOGLE_CLIENT_SECRET_FILE` |
| Trusted client-IP header | `COSTAN_REAL_IP_HEADER` | – | e.g. `CF-Connecting-IP` behind a proxy |
| Load-test mode | `COSTAN_LOADTEST` | off | relaxes rate limits for local load tests; ignored in production; never in prod |
| pprof listener | `COSTAN_PPROF` | off | e.g. `:6771`; also turns on block+mutex profiling. A bare `:port` binds `127.0.0.1`, and the whole thing is refused in production: the heap dump contains live session tokens. Never in prod |

**`*_FILE` forms.** Each of the three secrets may be given as `<KEY>_FILE`
naming a file to read instead of the value itself:
`DISCORD_CLIENT_SECRET_FILE`, `GOOGLE_CLIENT_SECRET_FILE`,
`DISCORD_BOT_TOKEN_FILE`. That is how the production unit delivers them: its
`ExecStartPre` SOPS-decrypts `/etc/costan/secrets.enc.yaml` into the tmpfs `RuntimeDirectory` (`/run/costan`),
so the plaintext is a mode-0400 file in RAM rather than an environment variable
readable from the process table. A trailing newline is trimmed; a file that is
set but unreadable is fatal, so a broken secret setup fails loudly instead of
silently disabling login. See `secretEnv` in `cmd/costan/main.go`.

### Frontend (build-time, Vite)
| Setting | Env | Notes |
|---|---|---|
| Backend origin (dev proxy) | `BACKEND_ORIGIN` | default `http://localhost:4757` |
| Discord client id | `VITE_DISCORD_CLIENT_ID` | required for the Activity; `activity.ts` throws if unset |
| Backend host (Activity proxy) | `VITE_BACKEND_HOST` | host only, no scheme; falls back to `window.location.host` |

Per-table game settings (`engine.GameConfig`: players, target_vp, dice/board
mode, ruleset, module options) are runtime data chosen by the host in the
waiting room, not deployment config.

## Testing (local)
Same-origin via the Vite dev proxy:
```bash
COSTAN_DEV_AUTH=1 go run ./cmd/costan        # backend :4757
cd frontend && npm run dev                     # frontend :4758, proxies /api /auth /ws
# open http://localhost:4758/auth/dev once -> guest session -> play
```
The proxy keeps the browser same-origin, so the session cookie and the backend's
strict WebSocket origin check work unchanged. (Free :4757 first if `tilt` or
anything else holds it, or set `COSTAN_ADDR` + `BACKEND_ORIGIN`.)

## Production: web (frontend on Cloudflare Pages)

The backend is same-origin (cookie auth, strict WS origin check,
no CORS), so keep the browser on one origin:

- **What ships: same-origin via a Pages Function.** Pages serves the SPA at
  `example.com` (your site hostname), and `frontend/functions/_middleware.js` (scoped by
  `frontend/public/_routes.json`) forwards `example.com/api/*`, `/auth/*`, `/ws`
  and `/discord/*` to the origin named by the Function's `ORIGIN_BASE` variable
  (`https://api.example.com`). It is a Pages Function, not a Worker on a zone
  route: it lives in the repo, deploys with the frontend, and needs no separate
  Workers project. The browser stays on `example.com`, so cookies and the strict WS
  origin check work with zero backend changes. Backend:
  `COSTAN_BASE_URL=https://example.com`, `COSTAN_SECURE_COOKIES=1`. Setup:
  DEPLOY.md §2.
- **Alternative: split origin (`api.example.com`).** Simpler infra but requires
  backend changes (CORS allow-list, `SameSite=None; Secure` cookies, allow the
  Pages origin in `checkOrigin`). Not implemented.

Cloudflare Pages: root `frontend`, build `npm run build`, output `dist`. The
committed `frontend/public/_redirects` (SPA fallback) and `frontend/public/_headers`
(CSP `frame-ancestors` for Discord embedding) are applied automatically.

### TLS

Cloudflare handles edge TLS; the Go process does not run HTTPS. The backend
serves plain HTTP (`http.ListenAndServe`); TLS terminates at Cloudflare and the
browser only ever sees `https://example.com`.

- **Edge → browser:** automatic. Pages (the SPA and its Function) is served over
  HTTPS by Cloudflare; turn on **Always Use HTTPS** (and HSTS) for the zone.
- **Cloudflare → backend origin:** set the zone SSL/TLS mode to **Full (strict)**
  and put a TLS cert on the origin (a free [Cloudflare Origin
  Certificate](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
  is easiest), so the hop from Cloudflare to your backend is encrypted and
  verified. If the backend has no TLS listener, **Full** (encrypted but
  unverified) works but is weaker; never use **Flexible** (it would let the
  backend believe requests are plain HTTP and break the secure-cookie
  assumption). If you instead use a [Cloudflare
  Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  to reach the origin, the tunnel is already encrypted end-to-end and no origin
  cert is needed.
- Because the browser is on HTTPS, run the backend with
  `COSTAN_SECURE_COOKIES=1` (sets `Secure` on the session cookie). This also
  hard-disables the dev guest login regardless of `COSTAN_DEV_AUTH`.

## Production: Discord Activity

### Discord Developer Portal
1. Create an Application. Its **Application ID** is your client id and your
   Activity origin prefix (`<app_id>.discordsays.com`).
2. OAuth2 → copy Client ID + Client Secret; add redirect
   `https://example.com/auth/discord/callback` (web login only; the Activity
   grant uses no redirect URI).
3. Activities → Enable. **URL Mappings**: `/` → the frontend Pages host;
   `/api` and `/ws` → the backend host.
4. Activity default scope: `identify` only.

### Env
- Backend: `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` = the app id/secret;
  `COSTAN_DISCORD_APP_ID` = the app id; `COSTAN_BASE_URL=https://example.com`;
  `COSTAN_SECURE_COOKIES=1`.
- Frontend (Pages build vars): `VITE_DISCORD_CLIENT_ID` = the app id;
  `VITE_BACKEND_HOST` = the backend host.

### Launch & verify
In Discord (desktop/web): join a voice channel → Activity launcher → your app.
Flow: `ready` → `patchUrlMappings` → `authorize` (consent) → `POST /api/token`
(bearer session) → `authenticate` → `POST /api/activity/lobby` → `/ws` with a
`{"t":"auth","token":…}` first frame. First opener hosts the call's table; later
openers join or spectate. Before seating anyone, the server asks Discord
(`GET /applications/{app}/activity-instances/{id}`, with the bot token) whether
the caller is really in that instance, so a leaked instance id does not seat a
stranger. In production this needs `DISCORD_BOT_TOKEN` and
`COSTAN_DISCORD_APP_ID`; without them the Activity refuses openers. The same
game is rejoinable from the website via its invite link.

The `activity_instances` row maps one Discord instance to one table, and it
follows the call rather than pinning it: a rematch or a reset carries the
mapping to the table that replaced the old one (`store.FollowActivityGame`), and
an opener who finds the mapped table abandoned or wedged creates a replacement
and repoints the instance at it (`store.RepointActivity`, guarded on the dead id
so simultaneous openers cannot fork the call). Without both, a call would be
stuck with its first table, and anyone opening the activity after that table
ended would land in a room that never starts. Where an opener lands is decided by
that table's status, not by their role: `lobby` is the waiting room, `active` the
board, `finished` the scoreboard (see `activityRoute`).

## Supporter perks, name decorations & role mapping

Supporter status and the role-gated **name decorations** are driven by Discord
roles, pulled over REST (no gateway). Strategy: [`monetization.md`](monetization.md);
data model: [`cosmetics.md`](cosmetics.md).

### Enable it
The supporter sync turns on when **`DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID`** are
set (bot must be a guild member). The slash commands additionally need
**`DISCORD_PUBLIC_KEY`**; command auto-registration additionally needs
**`COSTAN_DISCORD_APP_ID`**.

Discord Developer Portal (in addition to the Activity setup above):
1. **Bot** → token → `DISCORD_BOT_TOKEN`; invite the bot into the guild.
2. **General Information** → **Public Key** → `DISCORD_PUBLIC_KEY`.
3. **Interactions Endpoint URL** → `https://example.com/discord/interactions`.
   Discord PINGs it on save; the server answers once deployed with the public key,
   so it verifies green. The guild command set (`/config`, `/whois`, `/stats`, …)
   then auto-registers on startup.

### Roles → decorations
Each Discord **role** maps to a **kind**; many roles may share a kind.

| Kind | Decoration | Role granted to members by |
|---|---|---|
| `boost` | **pink** sparkle (Booster); also an active supporter | Discord auto-assigns the Server Booster role |
| `subscription` / `gift` | **blue** sparkle (Supporter) | Discord Server Subscription role, or a manual gift role |
| `kofi` | **yellow** sparkle (Ko-fi) | your Ko-fi → Discord integration (assigns the role on support) |
| `staff` | **red fire** (Staff; hidden unless held) | assigned manually to staff |

- `boost`/`subscription`/`gift` confer **active supporter** status (blue decoration
  + full colour palette + monthly stipend). `boost` additionally lights the pink
  Booster decoration. `kofi`/`staff` are **perk-only** (their decoration, no
  supporter status).
- Access reverts automatically when a role is removed: caught at point-of-use
  (≤15s) or by the ~10-min sweep.

Map roles in Discord with **`/config` → Supporter roles** (requires Manage Server):
pick a kind (`subscription/boost/gift/kofi/staff`), then use the role-select to set
that kind's whole set of roles. Deselecting a role unmaps it. Changes apply on each
member's next role sync. There is no `/setrole` command; the panel replaced it.

Or map them statically via the env var, which is unioned with the panel's mapping:
```
DISCORD_SUPPORTER_ROLE_IDS=boostId:boost,subId:subscription,kofiId:kofi,staffId:staff
```

### Automatic background jobs (no setup)
- **Supporter sweep** (~10 min) heals lapses.
- **Monthly stipend** (hourly tick, idempotent per calendar month): credits each
  active supporter **+10,000 Pips/month** (`econ.StipendPayout`).
- **Point-of-use refresh** re-verifies roles when a member equips a role-gated
  cosmetic. Migrations apply automatically on startup.

### Enabling payments & pre-launch fill-ins
See [`monetization.md`](monetization.md) §9. The $2.99 Discord subscription is the
only charge; in the UI it stays "Coming soon" until `MONETIZATION_LIVE` is flipped
in `frontend/src/routes/Support.tsx`. Boost / Ko-fi / staff decorations are free
and independent of it.

Before launch, in `frontend/src/routes/Support.tsx`: set real `DISCORD_URL` +
`KOFI_URL` (placeholders today) and flip `MONETIZATION_LIVE` when the paid path is
ready.

### Go-live checklist
1. [ ] HTTPS; `COSTAN_BASE_URL` (https) + `COSTAN_SECURE_COOKIES`; `COSTAN_DEV_AUTH`, `COSTAN_LOADTEST`, `COSTAN_PPROF` not set (production refuses all three, but a set-and-refused var still logs a warning).
2. [ ] `costan-backup.timer` enabled and one backup taken and *restored* once, timed (DEPLOY.md §10); `BACKUP_RCLONE_REMOTE` configured, or you have accepted that the backups die with the instance.
3. [ ] OAuth login works.
4. [ ] `DISCORD_BOT_TOKEN`+`DISCORD_GUILD_ID` set, bot in guild → sync logs "enabled".
5. [ ] `DISCORD_PUBLIC_KEY`+`COSTAN_DISCORD_APP_ID` set; Interactions URL verified; `/config` visible.
6. [ ] Roles mapped (boost/subscription/kofi/staff); verify each decoration + the palette/stipend land.
7. [ ] `COSTAN_ALERT_CHANNEL_ID` set in `/etc/costan/backup.env`, and `costan-alert@.service` proven to post (DEPLOY.md §7); it is the only alerting path.
8. [ ] Real Discord/Ko-fi URLs filled in on the Support page.
9. [ ] Payment, legal and tax requirements for your jurisdiction checked before flipping `MONETIZATION_LIVE` / enabling the subscription.

## Disclaimer

costan is an independent project. It is not affiliated with, endorsed by, or
sponsored by the publishers or rights holders of any commercial board game.
