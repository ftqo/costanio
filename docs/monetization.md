# Monetization Strategy

How the project funds itself: an optional supporter status and an earned-only
cosmetic currency. The principles in §1 are fixed; the numbers are starting
values to tune.

## 1. Principles

1. **No pay-to-win.** Cosmetics never enter the engine or the game actor. Rated games and
   per-ruleset ratings are untouched. The only purchased or earned thing that reaches a live
   game is color, which is purely visual and distinctness-checked.
2. **Real money buys one thing: supporter status.** There is no real-money shortcut to any
   cosmetic, and no paying to skip earning.
3. **The currency is earned, never sold.** It buys almost all cosmetics.
4. **No randomization.** No loot boxes, gacha or mystery pulls. Every item shows exactly what
   it is at a fixed price.
5. **No manufactured FOMO or dark patterns.** No countdown pressure, no guilt screens, no
   hard-to-cancel. Cancelling is easy.

## 2. Revenue model: supporter status from a role allowlist

Supporter status is granted by holding any role in a configured allowlist of Discord roles,
which covers three paths with one rule (`supporter` package, `docs/cosmetics.md` §5):

| Path | Role | Earns money? |
|---|---|---|
| **Paid subscription** | Discord **Server Subscription** role, **$2.99/mo** (Discord's floor; you keep ~90%) | yes |
| **Nitro boost** | the managed **Server Booster** role Discord auto-assigns for boosting *our* guild | indirectly (drives boosts) |
| **Gift / comp** | a manually-assigned **gift** role (a mod assigns the role in Discord; the role is mapped to the `gift` kind on the `/config` panel) | no |

- **Why an allowlist rather than only the subscription role:** boosting is a free way for fans
  to support (and boosts give the server perks), and gifting a user is then a role assignment
  with no separate code path or admin console. "Nitro boost" means boosting our server, not
  merely having Nitro (which we can't see).
- **Status is binary; the role's kind is kept** (subscription > boost > gift, strongest wins) for
  analytics and possible boost-only perks later.
- **Sync:** roles are read at login via OAuth `guilds.members.read` and kept current by pulling
  them over REST (no gateway, no privileged intents): a refresh before any supporter-gated
  action, plus a periodic reconciliation sweep. See `supporter/refresher.go`.
- **Entitlement is internal**, decoupled from how the role was granted, so a future Stripe path
  (for guests, a $1/regional/PPP tier, or annual/lifetime) is a config addition. Discord roles
  are the default; Stripe would cover people without Discord.
- **Eligibility (verify in the Discord Creator Portal before relying on it):** Community-enabled
  server, US bank, 18+, 2FA, W-9 tax onboarding, good standing. The member-count threshold is
  uncertain (sources range from "10+ with high engagement" to "typically 1,000+").

### Supporter perks

| Perk | Notes |
|---|---|
| Expanded color palette | 64 curated colors + custom, vs the 10 free presets |
| Monthly currency stipend | +10,000 Pips/mo, spendable on cosmetics |
| Tenure-tiered supporter badge | Ages up at 1 / 6 / 12 months; the main retention lever |
| Rotating supporter-only cosmetics | A small monthly set, equippable only while subscribed |
| Solo games against bots | Starting a table with no second human (host alone vs bots, or an all-bot table) is gated to active supporters; tables with 2+ humans are free for everyone |

### Lapse policy (stated publicly)

- **Kept forever:** every cosmetic and color you used, currency-bought items, and
  already-granted stipend Pips.
- **What stops:** future stipends and the live rotating set; the badge becomes
  "former supporter" (never deleted); the expanded palette reverts to the nearest free preset
  for new games.
- **No win-back guilt screens.** "Thanks, come back anytime."

## 3. The currency: "Pips" (working name)

Earned-only. Implemented as an append-only ledger, which fits the event-sourced architecture and
gives an audit trail for anti-fraud. Every credit carries a unique idempotency key (e.g.
`match:{gameID}`, `daily:{userID}:{date}`, `referral:{refereeID}`) so crashes, retries and event
replay cannot double-pay. Spends are transactional (check balance, debit, grant in one tx).

### Faucets (starter values, to tune after launch)

| Source | Payout |
|---|---|
| Signup grant | +5,000 one-time, every new account (guest included). **Live**: `econ.Ledger.Signup`, wired to every login path in `auth/` |
| Match completion | +10, first 3 games/day; only games with **2+ humans** count (prevents bot-farming). **Live**: paid inside the finalize transaction (`game.Manager.finalize`) |
| Daily first game | +15, plus +5 per consecutive-day streak, up to +40. **Live**: paid from `game.Manager.finalize` beside the match reward |
| Milestones (one-time) | chunks for onboarding/long-tail goals (e.g. play 10 games +100, rating tiers +100/+200). *Not implemented* |
| Referral | +200 referrer / +100 referee, on qualification (§5). *Not implemented; no `referrals` package yet* |
| Supporter stipend | +10,000/mo while subscribed. **Live**: hourly sweep in `cmd/costan/main.go` |

A free player earns 45–70 Pips a day (3 × 10 for matches, plus a daily bonus that climbs
15 → 40 across a week of consecutive days): the cheapest robber in a week, the crystal in
about five. A supporter gets 10,000 a month on top, which is most of the shop.

So supporting buys no advantage (everything is cosmetic, per §1), but it does buy nearly all
the cosmetics nearly at once. Milestones and referrals are the remaining earned faucets and
would narrow that gap.

## 4. Cosmetics

All purely presentational. All bought with Pips except a small rotating supporter-exclusive
set, so the subscription keeps an identity of its own.

| Slot | Price band (Pips) |
|---|---|
| Victory emote / reaction | 100–300 |
| Avatar frame | 150–400 |
| Dice skin | 200–500 (visual only; does not touch provable-fair dice) |
| Piece skin set (settlement/city/road equivalents) | 400–800 |
| Board / tile theme | 500–1,000 |

**Shipped:** colors, name decorations (the support badges free to their role, the effects on
sale at 2,500 for a sparkle and 5,000 for a fire), and robber skins (350–2,400). Name flair was
cut. Piece, board and dice skins need art and come later.

### Colors

- **10 free presets**: a typical table is ~4 players and even a full 10-seat game needs only 10
  distinct colors. Supporters unlock the 64-color palette + custom.
- **No free full-hex picker**: two players could pick near-identical colors and make the board
  unreadable.
- **In-game distinctness is first-come.** The first player to take a color at a seat locks it;
  a later player whose pick is within a perceptual-distance threshold (Lab ΔE / CIEDE2000) of a
  seated player's must choose another. Enforced in the seat-assignment path.

## 5. Referrals (distinct from the existing game invite codes)

- Each user gets a personal referral code, separate from the private-game `invite_code`.
- **Payout only when** the referred player is a brand-new Discord account (guests never
  qualify) **and finishes one game with 2+ humans.** Both sides are paid.
- **Anti-fraud:** self-referral blocked, one referrer per referee, a lifetime cap (~25 rewarded
  referrals per account), all writes through the idempotent ledger.

## 6. Patronage layer

Voluntary support alongside the subscription, gating nothing:

- **One-time Founder's / Supporter pack**: a permanent cosmetic that cannot be bought later,
  for people who would pay once but never subscribe, and to front-load hosting costs.
- **Optional tip jar** (Ko-fi / pay-what-you-want); most voluntary money is one-time.
- **Public cost transparency**: a visible "servers cost ~$X/mo, funded this month: ▓▓▓░" figure.
- **A public "free forever, never pay-to-win" promise.**

We take lichess's posture (transparent costs, status rather than advantage) but not pure
donation-only funding, which won't scale for a friends-first site.

## 7. Not implemented

- **Engagement layer:** a free, never-expiring season pass and seasonal ladder built on the
  existing per-ruleset ratings and replays (cosmetic-only rewards); supporter private-tournament
  hosting and cosmetic trophies.
- **No paid-entry cash tournaments**: gambling and legal risk (dice-driven outcomes weaken the
  skill-game defense; prizes must not be entry-funded and the operator must not keep a cut).

## 8. Architecture sketch (stdlib `net/http`)

- New packages: **`econ`** (ledger: grant/spend/idempotency), **`cosmetics`**
  (catalog/purchase/loadout/supporter-gating), **`referrals`** (codes/attribution/qualification).
- New tables: `wallet_ledger` (append-only), `entitlements`, `loadout`, `referrals`,
  `supporter_status`. The engine and game actor never read any of these.
- Supporter status written by `auth/` (login role read) + `bot/` (gateway role events).
- REST: `GET /api/me/wallet`, `GET /api/cosmetics`, `POST /api/cosmetics/{id}/purchase`,
  `PUT /api/me/loadout`, `GET /api/me/referral`, `GET /api/me/supporter`, `GET /api/colors`.

## 9. Before enabling payments

Any real-money path ships only alongside the non-affiliation disclaimer, and an
operator enabling payments on their own deployment is responsible for the legal
and tax requirements of their jurisdiction.
