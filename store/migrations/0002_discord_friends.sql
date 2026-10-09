CREATE TABLE discord_friends (
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_discord_id TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_discord_id)
);
CREATE INDEX discord_friends_friend ON discord_friends(friend_discord_id);
