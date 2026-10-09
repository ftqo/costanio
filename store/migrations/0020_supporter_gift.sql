-- The `gift` role kind already confers supporter status (active = 1, which gates
-- bot-only game starts). This flag additionally records that the supporter status
-- came from the gift role specifically, so the gift-only name decorations can be
-- gated to gift holders (and stay hidden from everyone else), the same way `staff`
-- gates the fire decoration. A snapshot of the currently-held role; reverts when
-- the role is removed.
ALTER TABLE supporter_status ADD COLUMN gift INTEGER NOT NULL DEFAULT 0;
