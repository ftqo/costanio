# Cosmetics implementation

This is the implementation-level companion to
[`monetization.md`](monetization.md) §4 (which is the strategy/locked decisions).
The strategy doc says what and why; this one covers how it is built: the data
model, the services, the gating rules, the color system, and the REST contract.
Nothing here is wired to a charge or store-front; see
[`monetization.md`](monetization.md) §9 before enabling one.

Companion: [`cosmetics-assets.md`](cosmetics-assets.md) is the SVG asset manifest
for artists; every catalog `item_id` below maps to an asset entry there.

## 1. Scope

Cosmetics are purely presentational. The engine, ratings, and replays never read
cosmetics or currency; the cosmetic values that reach a live game (color, robber
skin, piece set) are visual only. Cosmetics live in their own packages (`econ`,
`cosmetics`) and tables. Nothing in `engine/` or `bot/` imports them, and `game/`
uses them only to resolve seat colors and robber skins for views and to compute
match Pips, which keeps the game free of pay-to-win.

### Implemented (backend, tested)

- **Currency ledger** (`econ`): earned-only "Pips", append-only, idempotent.
- **Entitlements + loadout** (`cosmetics`): own a cosmetic, equip one per slot.
- **Catalog**: a static, code-defined list of Pip-priced items.
- **Supporter status** (`store.supporter_status`): a snapshot with a tenure badge;
  read by gating logic.
- **Supporter role logic** (`supporter`): pure role→status evaluation over a
  configurable role allowlist (subscription / boost / gift).
- **Pull-based Discord sync** (`discord` + `supporter.Refresher`): a bot-token
  REST read of a member's roles, re-checked at point-of-use and on a sweep, with
  no gateway (§5.2, §7).
- **Colors**: 64-color RGB-cube palette, 10 free, the rest supporter-gated, with a
  CIEDE2000 perceptual-distinctness check and a "keep what you used" entitlement.
- **REST**: wallet, catalog, purchase, loadout, supporter, colors.

### Not implemented

- **A `/gift` slash command** (§7). The interactions endpoint exists
  (`discord/interactions.go`); gifting already works by assigning the role. The
  login pull uses the bot token; reading the user's own roles via the
  `guilds.members.read` OAuth scope remains an optional optimization.
- **Stripe** (entitlements are decoupled from the grant source, so this is a
  config addition).
- **Referrals** (`monetization.md` §5): would be its own package/table.
- **Dice/board art and two piece sets**: v2; catalog entries exist as
  `Reserved` (§4.4).

## 2. Data model (migration `0006_cosmetics.sql`)

Four tables. All timestamps are unix seconds (`INTEGER`), matching the rest of the
schema. All `user_id` columns reference `users(id)`.

```sql
-- Earned currency. Append-only journal (never UPDATE/DELETE); balance is read
-- from the wallet_balance cache below, kept in lockstep in the same tx.
CREATE TABLE wallet_ledger (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,           -- >0 credit (faucet), <0 debit (spend)
    reason     TEXT    NOT NULL,           -- 'match','daily','streak','milestone','referral','stipend','purchase','grant'
    idem_key   TEXT    NOT NULL UNIQUE,    -- dedupe key; replay/retry/crash safe
    created_at INTEGER NOT NULL
);
CREATE INDEX wallet_ledger_user ON wallet_ledger(user_id);

-- Owned cosmetics and kept colors. Grant is idempotent per (user,item).
CREATE TABLE entitlements (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    item_id    TEXT    NOT NULL,           -- catalog id, e.g. 'frame.laurel' or 'color.ff0000'
    source     TEXT    NOT NULL,           -- 'purchase','color-use','founder','grant'
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
);

-- Equipped cosmetic per slot. At most one row per (user,slot).
CREATE TABLE loadout (
    user_id INTEGER NOT NULL REFERENCES users(id),
    slot    TEXT    NOT NULL,              -- 'decoration','dice','pieces','board','color','robber'
    item_id TEXT    NOT NULL,
    PRIMARY KEY (user_id, slot)
);

-- Supporter snapshot. Source of truth synced from Discord/Stripe (later);
-- gating reads `active`, the badge reads `since`.
CREATE TABLE supporter_status (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    active     INTEGER NOT NULL DEFAULT 0, -- currently subscribed
    since      INTEGER,                    -- first-ever supporter ts (tenure badge anchor; never cleared)
    until      INTEGER,                    -- current period end / last-seen-active
    updated_at INTEGER NOT NULL
);
```

### Why append-only for currency

A ledger (not a balance column) fits the event-sourced architecture, gives an
anti-fraud audit trail, and makes every credit/debit idempotent via `idem_key`.
Crashes, HTTP retries, and event replay can never double-pay because the second
write collides on the unique key and is a no-op.

### Balance: snapshot + journal (not SUM-on-read)

`wallet_ledger` is the source of truth, but balance is not summed on every read
(O(rows), ~9 ms for a 50k-row account). A cached `wallet_balance(user_id,
balance)` is updated in the same transaction as every ledger append, so reads
are O(1) (~7 µs) and the cache always equals the journal's sum. The cache is
re-derivable (migration `0007` backfills it with `SUM`).

```sql
CREATE TABLE wallet_balance (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    balance    INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
```

### Idempotency keys (canonical forms)

| Flow | `idem_key` | `reason` |
|---|---|---|
| Match completion | `match:{gameID}:{userID}` | `match` |
| Daily first game | `daily:{userID}:{YYYY-MM-DD}` | `daily` |
| Milestone | `milestone:{userID}:{milestoneID}` | `milestone` |
| Referral | `referral:{refereeID}` | `referral` |
| Supporter stipend | `stipend:{userID}:{YYYY-MM}` | `stipend` |
| Purchase | `purchase:{userID}:{itemID}` | `purchase` |
| Admin/test grant | `grant:{uuid}` | `grant` |

Purchase uses a **stable** key per (user,item): buying a permanent item you
already own is a no-op, not a second charge.

## 3. Currency: `econ` package

`econ.Ledger` wraps `*store.Store`. It is the only writer to `wallet_ledger`.

```go
type Ledger struct { st *store.Store }
func New(st *store.Store) *Ledger

func (l *Ledger) Balance(userID int64) (int, error)
// Grant credits amount>0 under idemKey; returns the new balance. Re-using an
// idemKey is a successful no-op (returns the current balance).
func (l *Ledger) Grant(userID int64, amount int, reason, idemKey string) (int, error)
// Spend debits amount>0 under idemKey. Returns ErrInsufficientFunds if the
// balance would go negative. Re-using an idemKey is a successful no-op.
func (l *Ledger) Spend(userID int64, amount int, reason, idemKey string) (int, error)
```

`Spend` is the only place that reads-then-writes, so it runs inside a single
`store` transaction: *(check idem_key → compute balance → reject if insufficient →
insert debit)*. `SetMaxOpenConns(1)` plus the transaction make it race-free.

### Faucets (starter values; `econ/faucets.go`)

Values mirror `monetization.md` §3. Implemented:

- `MatchReward(userID, gameID string, humans)` → +10, idempotent per game
  (`match:{gameID}:{userID}`), **only counts when the game had 2+ humans** and the
  user is under the **3-rewarded-matches/day** cap, enforced by counting today's
  `match` credits before granting.
- `Signup(userID)` → +5,000 once per account, idempotent on `signup:{userID}`. Every
  login path calls it (guest, Discord, Google, dev login) via the nil-safe
  `auth.Service.SetSignupGrant` hook wired in `cmd/costan/main.go`; only the first
  call pays. A guest who later links a provider keeps their user id, so linking
  does not pay a second time.
- `Stipend(userID)` → +10,000, idempotent per calendar month, granted to every active
  supporter by an hourly sweep in `cmd/costan/main.go`.
- **Daily first game** → `DailyPayoutFor(days, today)`: +15 for the first game
  a player finishes each UTC day, +5 for each consecutive day behind it, capped
  at 40 (so 15/20/25/30/35/40 and then flat). Idempotent per
  `daily:{userID}:{date}`.

  The streak is counted from the ledger (`store.CreditDays` returns the distinct
  days a player was paid), so there is no separate counter to drift. The
  arithmetic is a pure function over those days and is tested directly.

  It is asked on every finished game: `DailyPayoutFor` returns 0 once today is
  paid, so nothing tracks which game was first.

**Where the match faucet is paid.** `game.Manager.finalize` builds the payout list
(`matchCredits`) and hands it to `store.FinalizeGame` as `FinalizeInput.Credits`,
so the Pips commit in the same transaction as the stats, ranked strikes and the
match-history row. The recovery sweep re-runs whole finalizations, and the
transaction plus the per-game idem key stop a retry paying twice. The rules (2+
humans, the daily cap, forfeiters excluded) live in `game`; the write lives in
`store`. `econ.Ledger` must not be called inside the finalize path: it opens its
own connection, and with `SetMaxOpenConns(1)` and an open transaction that
deadlocks.

Not implemented: milestones and referrals (no milestone trigger point and no
`referrals` package).

A non-supporter earns at most 30 Pips of match rewards plus a daily bonus of
15–40, so 45–70 a day. Against the shop's 350–2,400 that is a cheap robber in a
week and the crystal in about five, which is what the prices were set against.

## 4. Cosmetics: `cosmetics` package

### 4.1 Catalog (`cosmetics/catalog.go`)

Static, compiled in. The catalog is code; ownership is data.

```go
type Slot string // "decoration","dice","pieces","board","color","robber"

type Item struct {
    ID    string // "frame.laurel"  (slot prefix . name)
    Slot  Slot
    Name  string // display name
    Price int    // Pips; 0 = not Pip-purchasable
    // Supporter-exclusive: not bought with Pips; "owned" only while supporter
    // status is active (the small rotating set in monetization.md §4).
    Supporter bool
}
var Catalog []Item
func ItemByID(id string) (Item, bool)
```

Catalog scope today: name decorations, robber skins, shelf colors and two piece
sets (`pieces.cyclades`, sold, and `pieces.classic`, supporter-only). The other `dice`, `pieces` and `board` items are listed
so their IDs are stable, but are `Reserved` (§4.4).

### 4.2 Ownership, gating, loadout (`cosmetics/service.go`)

```go
type Service struct { st *store.Store; led *econ.Ledger }
func New(st *store.Store, led *econ.Ledger) *Service

func (s *Service) Catalog(userID int64) ([]ItemView, error) // item + owned + equipped + locked
func (s *Service) Purchase(userID int64, itemID string) error
func (s *Service) Loadout(userID int64) (map[string]string, error) // slot -> item_id
func (s *Service) Equip(userID int64, slot, itemID string) error
func (s *Service) Unequip(userID int64, slot string) error
```

**Ownership** of `itemID` by `userID` is true iff:
- there is an `entitlements` row for it, **or**
- the item is `Supporter`-exclusive **and** supporter status is currently active.

(The second clause is why supporter-exclusive items revert on lapse without any
delete: ownership is computed, not stored.)

**Purchase** (`purchase:{user}:{item}` idem key):
1. `ItemByID` or `ErrUnknownItem`.
2. Already owned → success (no-op, no charge).
3. `Supporter`-exclusive → `ErrSupporterExclusive` (not purchasable with Pips).
4. `Price <= 0` → `ErrNotPurchasable`.
5. `led.Spend(user, price, "purchase", key)`; on `ErrInsufficientFunds` propagate.
6. `st.GrantEntitlement(user, item, "purchase")` (idempotent).

Spend-then-grant ordering: the spend's idem key is stable, so a crash between
spend and grant is recovered on retry: the spend no-ops and the grant proceeds.

**Equip**: the item must be owned and `item.Slot == slot`, else `ErrNotOwned` /
`ErrWrongSlot`. Equipping writes one `loadout` row (upsert per slot). Equipping a
supporter-exclusive while lapsed fails the ownership check (correct: the live set
stops while lapsed).

### 4.3 Price and role are separate gates

An item carries a **price** and, independently, **role flags**. They answer two
different questions:

- **Role flags:** who gets it for nothing. `robber.brigand` is free for staff;
  the gift-role effects are free for that role.
- **Price:** what everyone else pays. A priced item is buyable by anyone.

So `itemLocked` is false whenever `Price > 0`: a priced item is unbought, never
locked. **Locked** means price 0 and a role you do not hold, in two kinds that
the store words differently:

- **Earnable:** the supporter, booster and Ko-fi badges, and `robber.keg` (any
  of the three support roles grants it; it reverts when the last lapses). The
  card links to `/support`. Gates on one item are alternatives: `itemLocked` is
  the negation of `owns`, so a Ko-fi holder owns the keg without also being a
  supporter, and the button says "Support to unlock" when more than one route
  is open.
- **Handed out:** the staff badge and the gift role's three monochrome fires
  (black, grey, white). The card says **Unavailable**, since nothing the reader
  can do earns them.

The store's shelf split (`onTheShelf` in
`frontend/src/components/StoreShelves.tsx`) uses the same rule: price alone
decides purchasability. `cosmetics.TestPriceAloneDecidesPurchasability` and the
two Brigand cases in Store.test.tsx pin both sides.

### 4.4 Reserved ids

`Item.Reserved` is separate from price and role: the id and price exist, the art
does not. Six rows carry it (`dice.bone`, `dice.gem`, `pieces.driftwood`,
`pieces.obsidian`, `board.parchment`, `board.aurora`), held for v2.

A reserved item is **Locked** in the catalog view and refused by `Purchase` with
`ErrNotPurchasable` (the price gate alone would sell it, and the API is
reachable even though the store UI hides these). The card says **Unavailable**,
so the `reserved` branch sits ahead of the `locked` branches in `ItemCard`.
Clear the flag when the art and store section ship.

Every other effect is ordinary stock: 5,000 for a fire, 2,500 for a sparkle,
gated by nothing.

### 4.5 The robber slot (the one cosmetic nobody wears)

`SlotRobber` ("robber") equips an alternate model for the robber. It is bought and
equipped like any other slot, but the robber belongs to no player, so the board
draws it in the skin of whichever seat most recently moved it.

How that reaches a client, without touching the engine:

1. `store.Seat.Robber` joins the equipped skin onto the seat, exactly as
   `Decoration` already does (`seatSelect`; it has three readers, `Seats`,
   `SeatsForGames` and `SeatForUser`, each scanning by hand).
2. `game.Manager.load` captures seat → skin into `Actor.seatRobbers`, alongside
   `seatNames`. Equipping mid-game takes effect at the next load.
3. `Actor.apply` records the mover in `robberBy` on every `EvRobberMoved`. One
   case covers every ruleset: the base move, the Knights chase and Bishop, and the
   Fishermen's all emit that one event with the seat that did it.
4. `Actor.seedRobberBy` recovers `robberBy` at load via
   `store.LastEventOfType(gameID, "robber_moved")`. An actor rebuilds from its
   latest snapshot and replays only what came after, so without this an evicted
   game would come back wearing the stock robber.
5. `FullView.RobberSkin` carries the resolved item id (`""` = stock art) to every
   viewer, spectators included. It is public: who moved the robber is already in
   the event log.

A human seat with nothing equipped shows the stock robber; a bot with nothing
equipped shows the Brigand (`cosmetics.RobberForSeat`).

The store draws them live rather than from baked stills
(`components/CosmeticGallery.tsx`): one WebGL context for the page, a still
rendered per card, and the model turning in the hovered card. A client without
WebGL gets a chroma's three slot colours instead.

Client side, `robberAssetFile` maps the id to `robbers/<name>.glb`; every skin
carries `Robber_`-prefixed nodes in its own file, so the stock art and a purchased
one are interchangeable at the call site. Anything unrecognised (an unknown id, a
failed fetch, a model with misnamed nodes) falls back to the stock robber, so the
board always has a robber.

Adding a robber needs a row in `cosmetics/catalog.go`, an entry in
`frontend/src/lib/robbers.ts`, and the glb (see `cosmetics-assets.md` §8a).
`frontend/src/lib/robbers.assets.test.ts` checks they agree and enforces the
asset contract: node prefix, anchoring, and the bounding-box limit the flip
animation depends on.

### 4.6 The pieces slot (the one cosmetic you wear)

A piece set is the buildings you place: settlement, city, road. Unlike the
robber, a set is worn by one seat and drawn in that seat's colour.

A set glb is a drop-in for `pieces.glb`: the same node names (`Settlement_A_*`,
`City_A_*`, `Road_*`) and the same three `Seat_` materials. One loader, one
`subsetByPrefix` and one tint path serve every set.
`frontend/src/lib/pieceSets.assets.test.ts` checks this against the shipped
bytes, since a set with misnamed nodes would silently draw nothing.

Client side, `pieceSetAssetFile` (`frontend/src/lib/pieceSets.ts`) maps the id to
its file and falls back to the stock set for anything unrecognised (a bundle can
be older than the catalog).

It reaches a client like the robber (§4.5), except a set is per seat, not per
table:

1. `seatSelect` joins the equipped set onto each seat as `store.Seat.Pieces`,
   beside `Robber` and through the same three hand-written scanners.
2. `game.Manager.load` captures seat → set into `Actor.seatPieces`, like the
   names and robber skins; equipping mid-game takes effect at the next load.
3. `FullView.SeatPieces` carries seat → item id to every viewer, spectators
   included. A seat wearing the stock art has no entry. It is public
   information.
4. `Board3D` resolves a file per seat (`pieceSetAssetFile`) and tints that seat's
   own asset, instead of tinting one shared `pieces.glb` for the whole table.
   `loadAsset` is cached per file, so a table where four players wear one set
   downloads it once.
5. The hover ghost (`loadGhosts`) and the build cards (`shopSetFor`) follow the
   viewer's set, since they preview the piece your click would build.

Three cases fall back to the stock buildings: an unknown id, a file that will
not load, and a file with misnamed nodes (the board checks for `Settlement_A*`
before accepting a set).

The `Board3D` `pieceSet` prop means "draw the whole table in this one set", for
the dev route `dev/board-live.html?pieces=<set>`.

The event-log icons do not follow sets: at ~18px (`ICON_SET`) a set's
silhouette is unrecognisable, and per-seat sets would multiply the shot cache.

The store shows only the sets this client can draw (`PIECE_SETS`), which hides
the reserved piece ids. That is a rendering filter; the purchase policy lives on
the catalog row (`Item.Reserved`, §4.4).

Each of the two modelled slots also shows a **Default** card: the stock art,
first in its grid, equipped when the slot is empty. It is not a catalog row;
equipping it sends `""`. In such a section no card offers Unequip, since
removing a set and equipping the default are the same act.

### 4.7 Lapse behavior (how the policy falls out of the model)

`monetization.md` §2 "Lapse policy" maps directly onto the model with **no special
cases**:

- *Keep forever:* anything in `entitlements` (purchases, founder grants, and colors
  you used; see §6.2) is unconditional. Spent/earned Pips already in the ledger
  stay.
- *Lose only the flow:* supporter-exclusive ownership is computed from `active`, so
  it stops on lapse; the expanded color palette likewise (except colors already
  entitled by use); future stipends simply aren't granted.
- *Badge:* `supporter_status.since` is never cleared, so a lapsed supporter renders
  a "former supporter" badge from `since`; `active=0` downgrades the live tier.

## 5. Supporter status

`supporter_status` is a **snapshot**, written by whatever proves entitlement
(Discord role today, Stripe later) and read by gating. This provides:

```go
// store
func (s *Store) Supporter(userID int64) (Supporter, error) // zero value = not a supporter
func (s *Store) SetSupporter(userID int64, active bool, periodEnd int64) error
```

`SetSupporter(active=true)` stamps `since` on first activation (and never again),
updates `until`, and is idempotent. `SetSupporter(active=false)` flips `active` to
0 and leaves `since` intact.

**Tenure badge** is derived, not stored: `monthsSince(since)` → bucket at 1 / 6 /
12 months. The badge level is computed in the view layer so the buckets can be
re-tuned without a migration.

### 5.1 Role allowlist (`supporter` package)

What *proves* entitlement is **holding any role in a configured allowlist**, so
the paid subscription, a Nitro **server boost**, and a manual **gift** all reduce
to one rule. The evaluation is pure (no Discord/DB calls); the pull refresher (§7)
feeds it the member's current role IDs:

```go
type Kind string // "subscription" | "boost" | "gift"
type Config struct{ Roles map[string]Kind } // role ID -> kind

func ParseConfig(env string) (Config, error)            // "123:subscription,456:boost,789:gift"
func (c Config) withDBRoles(db map[string]string) Config // union env allowlist + the /config panel's DB map
func (c Config) Evaluate(memberRoleIDs []string) Status  // Active + strongest Via + perks
func (r *Refresher) Refresh(ctx, userID int64) error     // pull roles -> Evaluate -> SetSupporter
```

`Evaluate` returns `Active` plus `Via`, the strongest matching kind by precedence
(subscription > boost > gift), so a subscriber who also boosts isn't labeled a
booster. Status is binary; `Via` is kept for analytics and possible boost-only
perks. `Refresher.Refresh` is the single write path to `SetSupporter`
(`periodEnd=0`: role-based status lasts while the role is held); it unions the
env allowlist with the `/config` panel's DB role map (`withDBRoles`) before
evaluating. Config comes from `DISCORD_SUPPORTER_ROLE_IDS`, parsed by
`ParseConfig` and wired in `cmd/costan/main.go`.

There is no public HTTP write path: `SetSupporter` is internal, driven by the
pull refresher (§7). Gifting needs no code: a mod assigns the gift role and the
next role pull picks it up.

**The gift role also unlocks a private decoration set.** `Evaluate` records a
`Gift` flag (persisted to `supporter_status.gift`) whenever a gift-kind role is
held. Gift still sets `Active` (and so the bot-only-game perk), but the separate
flag lets the gift-only decorations (`Item.Gift`) be owned by gift holders
alone. Like the `staff` decoration, they are hidden from the picker unless owned
(`owns()`/`itemLocked()` gate on `sup.Gift`; the client filters
`(!staff && !gift) || owned`).

### 5.2 Liveness: pull when it matters (no gateway)

Supporter status must reflect the user's current roles so nobody can boost, log
in, un-boost, and keep the perks. Discord delivers role changes only over the
gateway, so instead of running one we pull roles over REST when it matters:

1. **No cached copy in the request path.** Status is read fresh from
   `supporter_status` on **every** gated request (catalog, equip, color checks,
   `/api/me`), never copied onto the session, a JWT, or an in-memory cache.
   Responses that carry it are `Cache-Control: no-store`, so no browser/proxy pins
   a stale badge. `supporter_status` is itself a short-lived cache of Discord's
   truth, kept fresh at three boundaries:
2. **Login pull.** On a successful login, the auth service fires a best-effort,
   background `Refresher.Refresh` for the resolved user (`Service.syncRoles`, wired
   from `cmd/costan/main.go`). This is the authoritative *gain* path: a role granted
   in Discord (or removed) takes effect on the member's next login. It runs in a
   goroutine with its own context so login latency is unaffected; reads stay pure
   snapshot reads and trust what login/sweep/point-of-use have written.
3. **Point-of-use re-check.** Before granting a supporter perk (equipping a
   supporter-exclusive item or a supporter color) the service calls
   `Refresher.EnsureFresh`, which re-pulls the member's roles from Discord
   (`GET /guilds/{guild}/members/{user}`) when the snapshot is older than
   `supporterCheckTTL` (~15s) and writes the result. So *using* a perk after
   un-boosting is denied (`TestPointOfUseRefreshClosesExploit`). It's
   best-effort: if Discord is down the
   gated read falls back to the cached snapshot rather than blocking the user.
4. **Background sweep.** A periodic sweep (`Refresher.Sweep`, every
   `supporterSweepEvery` ≈ 10 min) re-pulls anyone currently holding any status
   (an active supporter or a staff/Ko-fi perk holder) who hasn't been checked
   recently, so a lapse is caught without a point-of-use hit. It skips all-false
   rows; those gain a newly granted role via the login pull.

Compared with a gateway, the displayed badge can lag by up to the TTL or sweep
window, but using a perk is always verified against Discord at that moment.

Purchased items and colors already used are kept on un-boost (§4.7/§6.2). The
expanded palette, supporter-exclusive items, and (after the next check) the
badge revert.

## 6. Colors

Color is the one cosmetic that reaches a live game, so it carries the most rules.

### 6.1 Palette (`cosmetics/color.go`)

The palette is the **4-level RGB cube**: each of R, G, B is one of `{0, 85, 170,
255}` (`0x00 / 0x55 / 0xAA / 0xFF`), which yields exactly **4³ = 64** colors.
Color ids are the hex (`color.ff00aa`); every color has a name (`cubeNames`,
asserted complete by the tests) for purchase confirmations and the ledger. Each
entry:

```go
type Color struct {
    ID    string     // "color.ff0000"
    Name  string     // "Red"
    Hex   string     // "#ff0000"
    Free  bool       // the 10 free presets
    Price int        // Pips, 0 = not on the shelf
    lab   [3]float64 // precomputed CIE L*a*b* for distinctness
}
var Palette []Color // len 64; Palette[:10] are the free colors
```

**10 free, 12 sold, 42 supporter-only.** The free presets are named cube colors
(Black, White, Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta), all
mutually ≥ `ColorThreshold` apart so a full table can use them at once
(asserted by the tests). The rest of the cube is supporter-gated, except
`shopColors`, which are also for sale.

**The shelf (`shopColors`, `ColorPrice`).** Twelve colors at `ColorPrice` Pips
each: Denim, Deep Sea, Emerald, Wine, Rust, Sand, Ash, Periwinkle, Sky, Graphite,
Blush, Orchid. A color within `ColorThreshold` of a free preset is refused at any
table seating that preset (§6.3), and unpicked seats default to free presets, so
every shop color clears all ten free presets and every other shop color (both
asserted in `cosmetics/shopcolor_test.go`).

A priced color is also a catalog `Item` in slot `color` (`colorItems()`,
appended to `Catalog`). `Purchase` grants the `color.xxxxxx` entitlement that
`equipColor` and `UseColor` check, so a bought color behaves like a color kept
under "keep what you used", including surviving a supporter lapse.

The palette as a whole need not be mutually separated (a coarse RGB cube has
near-neighbors such as `#005500` vs `#0055aa`); distinctness only matters
within a game and is enforced at pick time (§6.3).

### 6.2 Availability and "keep what you used"

`Service.Colors(userID)` returns each palette color tagged available/locked:

- Free colors: always available.
- Supporter colors (price 0): available iff supporter `active`, or the user has
  a `color.*` entitlement for it (a color they previously used, kept forever).
- Shelf colors (price > 0): available only with the entitlement (bought or
  granted). Supporter status does not grant them.

One predicate decides all three cases, and all three call sites (`Colors`,
`equipColor`, `UseColor`) go through it:

```go
func HasColor(col Color, ent map[string]bool, supporterActive bool) bool
```

`ColorView` also carries `Price`, which is what lets the store offer the one
action a swatch has: equip it, buy it, or (for the supporter-only half) point at
`/support`, the same route the locked name effects use.

When a user uses a supporter color in a game (equips it for a seat), the seat
path calls `st.GrantEntitlement(user, colorID, "color-use")`, which implements
the "keep the colors you used" lapse rule.

### 6.3 In-game distinctness (CIEDE2000)

Two players must not pick perceptually indistinguishable colors (unreadable board).
The rule is **first-come lock** at a seat: the first player to take a color locks
it; a later player whose pick is within a perceptual threshold of any *seated*
player's color must choose another.

```go
// cosmetics/ciede2000.go: perceptual color distance (CIE ΔE 2000).
func DeltaE2000(a, b [3]float64) float64
// cosmetics/color.go
func (c Color) DeltaE(o Color) float64
// AllowedColor reports whether `cand` is far enough from every seated color.
func AllowedColor(seated []Color, cand Color, threshold float64) bool
```

Default `threshold = 12.0` ΔE (above "just noticeable", below "obviously
different": two distinct reds are allowed, near-twins are not). The constant
lives in `cosmetics` so the lobby imports one source.

**Where it is enforced.** `lobby.SetSeatColor` runs `AllowedColor` against every
other seat and returns `ErrColorTaken` when the pick is too close; that is the
first-come lock. It only inspects a color being written, so the next rule is
also needed.

**Every seat carries an explicit color, from the moment it is created.**
`lobby.stampSeatColor` (Create, Join) and `cosmetics.PickSeatColor` (AddBot) give
each new seat the player's loadout color when they own it and it clears the
table, and otherwise the nearest free preset that does. `Start` and
`recreateLobby` carry those colors through `keepDistinct` rather than pinning
them as found.

A color resolved at read time (`DefaultSeatColor(seat_no)`) is only distinct
from other defaults, not from colors players picked, so stamping at creation is
what makes the distinctness rule hold for every seat.

An empty `color` column is a legacy row; that is the case `keepDistinct`
handles.

The seat path also grants the color-use entitlement for supporter colors, per
§6.2.

## 7. Discord supporter sync (pull-based, no gateway)

Discord delivers role-change events (`GUILD_MEMBER_UPDATE`) only over the
gateway; its HTTP webhook events do not cover member or role changes. Rather than
run a gateway for this, status is resolved by pulling roles over REST:

- **`discord` package:** a minimal bot-token REST client.
  `GuildMemberRoles(ctx, discordUserID)` does `GET /guilds/{guild}/members/{user}`
  and returns the role IDs; `ErrNotMember` (404) means "not in the guild → no
  granting roles". Plain request/response; no persistent connection.
- **`supporter.Refresher`:** orchestrates pull → `Config.Evaluate` → `SetSupporter`:
  - `EnsureFresh` re-pulls when the snapshot is older than `supporterCheckTTL`
    (~15s); called by the cosmetics gate at **point of use** (§5.2).
  - `Refresh` always pulls; `ErrNotMember` → inactive; a transient error keeps the
    cached snapshot (a Discord hiccup never flips someone to inactive). It unions the
    env allowlist with the `/config` panel's DB role map before evaluating.
  - `Sweep(olderThan)` re-pulls stale rows that hold any status (active supporter
    or staff/Ko-fi perk) on a timer to heal lapses; all-false rows are skipped.
- **Login pull:** on a successful login the auth service fires a best-effort,
  background `Refresher.Refresh` for the resolved user (`auth.Service.syncRoles`,
  wired from `main.go`). This is the authoritative *gain* path: a newly-granted role
  takes effect on the member's next login. Guests / non-Discord
  users are a no-op (`Refresh` self-gates on an empty `DiscordID`).
- **Config:** `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and
  `DISCORD_SUPPORTER_ROLE_IDS` (`roleID:kind,…`, parsed by `supporter.ParseConfig`;
  the `/config` panel's DB role map can supply roles too, so the env var is optional). When the
  bot token + guild are set, `cmd/costan/main.go` builds the client + refresher, wires
  it into the cosmetics gate **and the login hook**, and starts the sweep. Absent
  them, everything runs unchanged with no Discord calls.

**Still to build:**

- **`/gift` management on the HTTP Interactions Endpoint** (no gateway). The endpoint
  itself is built and serves the command set in `discord/interactions.go` (`/config`,
  `/stats`, `/whois`, …); no `/gift` or `/ungift` command is registered on it. Such a
  command would add/remove the gift role via REST, and supporter status follows on
  the next pull. Gifting already works without it: a mod assigns the gift role in
  Discord and the next pull picks it up.
- **Own-token login role-read (optional):** the login pull uses the bot token.
  With the `guilds.members.read` OAuth scope we could read the user's own roles
  from their access token instead, saving one bot call; deferred because the
  scope re-prompts existing users for consent.

Entitlement is decoupled from the grant source, so a Stripe webhook (or the
`ENTITLEMENT_*` HTTP webhooks, if the paid tier is later modeled as a Discord SKU)
calls the same `SetSupporter` and nothing downstream changes.

## 8. REST API

All under `auth.RequireUser`. Responses use the existing `writeJSON`/`writeErr`
envelope (`{"code","params","debug"}` on error; the client renders its own copy from
`code`, see [user-facing-text.md](user-facing-text.md)).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/me/wallet` | – | `{balance, recent:[{amount,reason,at}]}` |
| GET | `/api/cosmetics` | – | `{items:[{id,slot,name,price,supporter,owned,equipped,locked}]}` |
| POST | `/api/cosmetics/{id}/purchase` | – | `{balance, owned:true}` or error (`INSUFFICIENT_FUNDS`, `SUPPORTER_ONLY`, `NOT_FOUND`, `RATE_LIMITED`). Rate-limited per user (~1/s, burst 5) |
| GET | `/api/me/loadout` | – | `{loadout:{slot:item_id}}` |
| PUT | `/api/me/loadout` | `{slot,item_id}` (empty `item_id` = unequip) | `{loadout:{...}}` |
| GET | `/api/me/supporter` | – | `{active, since, tier, badge}` |
| GET | `/api/colors` | – | `{colors:[{id,name,hex,free,available}]}` |

`/api/me` (existing profile) gains `supporter` (bool) and `pips` (balance) so the
client can render the header without extra round-trips.

Error codes added: `INSUFFICIENT_FUNDS`, `SUPPORTER_ONLY`, `NOT_PURCHASABLE`,
`WRONG_SLOT`, `NOT_OWNED`.

## 9. Architecture boundaries

```
store/            econ.go, cosmetics.go      (the only SQLite access)
econ/             ledger.go, faucets.go       (currency policy; depends on store)
cosmetics/        catalog.go, service.go,     (catalog + gating + colors; depends on store, econ)
                  color.go, ciede2000.go
server/           cosmetics_api.go            (HTTP; depends on econ, cosmetics)
```

`engine/` and `bot/` import none of the above. `game/` imports `cosmetics` for
seat colors and robber skins and `econ` for match payout constants, never for
rules. The Server gains two
fields (`led *econ.Ledger`, `cosmetics *cosmetics.Service`) constructed in
`cmd/costan/main.go` and passed to `server.New`.

## 10. Payments

See [`monetization.md`](monetization.md) §9 before enabling any charge, store-front, or the
Discord subscription. Everything described here is inert revenue-wise: there is no
money path, only earned Pips and synced supporter status.
