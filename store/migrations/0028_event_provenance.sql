-- Action provenance: tell a human's move apart from the server's.
--
-- Before this, a move the server made for an absent or timed-out player was
-- logged identically to the player's own. That is fine for replay but wrong for
-- anything that reads the log as player intent: training data, moderation, and
-- viewers asking why a move was made.
--
-- events.src is engine.Source. 0 is SourceUnrecorded, meaning "logged before
-- this migration". No backfill: the information was never captured, and
-- guessing "human" would create the false signal this column prevents. Old logs
-- replay unchanged; the fold never reads src.
ALTER TABLE events ADD COLUMN src INTEGER NOT NULL DEFAULT 0;

-- Who was actually holding each seat, over time.
--
-- Per-event provenance answers "who made this move", but not "was anyone in
-- that chair" during the stretches where the seat owed nothing, and not the
-- moment a player came back and took their seat over from the bot. This table
-- carries those transitions.
--
-- Transitions only. A seat's opening control is already `seats.status`, so a
-- game nobody leaves writes no rows.
--
-- A side table rather than an event type: seat control is not a rules fact and
-- the engine must stay ignorant of it (see game.ErrClaimNeedsBots). An event
-- would also consume sequence numbers against the event cap. at_seq places each
-- transition in the log's timeline.
--
-- What is recorded is control (human / auto / bot), not socket connectivity:
-- connection flaps do not affect play, and logging them would keep a permanent
-- record of when each player was at their desk.
--
-- The key is a rowid rather than (game_id, at_seq, seat) because several
-- transitions can share a log position (drop, escalate and return between two
-- moves). Order by id; at_seq is not unique.
CREATE TABLE IF NOT EXISTS seat_control (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id  TEXT    NOT NULL,
    at_seq   INTEGER NOT NULL,   -- the log position this took effect at
    seat     INTEGER NOT NULL,
    control  TEXT    NOT NULL,   -- human | auto | bot | bot_takeover
    ts       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seat_control_game ON seat_control (game_id, id);
