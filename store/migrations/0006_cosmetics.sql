-- Cosmetics & earned currency. None of these tables are read by the engine or
-- game actor; cosmetics are purely presentational (see docs/cosmetics.md).

-- Earned currency ("Pips"): append-only. Balance is SUM(amount). The unique
-- idem_key makes every credit/debit safe against retries, crashes, and replay.
CREATE TABLE wallet_ledger (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL, -- >0 credit (faucet), <0 debit (spend)
    reason     TEXT    NOT NULL,
    idem_key   TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE INDEX wallet_ledger_user ON wallet_ledger(user_id);

-- Owned cosmetics and kept colors. Grant is idempotent per (user,item).
CREATE TABLE entitlements (
    user_id    INTEGER NOT NULL REFERENCES users(id),
    item_id    TEXT    NOT NULL,
    source     TEXT    NOT NULL, -- 'purchase','color-use','founder','grant'
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, item_id)
);

-- Equipped cosmetic per slot. At most one row per (user,slot).
CREATE TABLE loadout (
    user_id INTEGER NOT NULL REFERENCES users(id),
    slot    TEXT    NOT NULL,
    item_id TEXT    NOT NULL,
    PRIMARY KEY (user_id, slot)
);

-- Supporter snapshot, synced from Discord/Stripe (later). Gating reads `active`;
-- the tenure badge is derived from `since` (which is never cleared on lapse).
CREATE TABLE supporter_status (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    active     INTEGER NOT NULL DEFAULT 0,
    since      INTEGER,
    until      INTEGER,
    updated_at INTEGER NOT NULL
);
