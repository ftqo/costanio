-- Role-derived perk flags beyond plain supporter status, refreshed on the same
-- Discord role pull-sync as `boosting`. `kofi` gates the green name decoration,
-- `staff` gates the (hidden) fire name decoration. Like boosting, these are a
-- snapshot of currently-held roles and revert when the role is removed.
ALTER TABLE supporter_status ADD COLUMN kofi  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supporter_status ADD COLUMN staff INTEGER NOT NULL DEFAULT 0;
