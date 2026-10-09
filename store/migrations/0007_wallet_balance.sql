-- Cached wallet balance (snapshot + journal). wallet_ledger stays the immutable
-- source of truth and audit trail; this is a derived cache kept in lockstep,
-- updated in the same transaction as every ledger append, so balance reads are
-- O(1) instead of SUM-over-journal. See docs/cosmetics.md §3.
CREATE TABLE wallet_balance (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id),
    balance    INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);

-- Backfill from any existing ledger rows so the cache starts consistent.
INSERT INTO wallet_balance (user_id, balance, updated_at)
SELECT user_id, SUM(amount), CAST(strftime('%s', 'now') AS INTEGER)
FROM wallet_ledger
GROUP BY user_id;
