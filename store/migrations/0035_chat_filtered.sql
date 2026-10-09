-- chat.filtered marks a message the language filter dropped. handleChat keeps
-- such a message (its report points at it) but never broadcasts it, and until
-- now nothing on the row said so: RecentChat served it back as the game's chat
-- history to everyone who opened the table.
--
-- Delivered chat stays 0 (visible). Rows filtered before this column existed
-- are found by their automated report, which records the sender as its own
-- reporter (Report.Automated; handleReport refuses real self-reports), whether
-- that report is still open or already resolved. A filtered message with no
-- report row cannot be told apart, but the filter path has always opened one.
ALTER TABLE chat ADD COLUMN filtered INTEGER NOT NULL DEFAULT 0;

UPDATE chat SET filtered = 1
WHERE id IN (SELECT chat_id FROM chat_reports WHERE reporter_id = accused_id);
