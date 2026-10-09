package store

import "github.com/ftqo/costan.io/rating"

// BumpStats increments a user's per-ruleset game/win/draw counters. won and
// drew are mutually exclusive: a drawn game has no winner to be.
//
// ranked additionally increments the ranked_* mirror: the profile's career
// total counts every finished game, the leaderboard only ranked ones.
func (s *Store) BumpStats(userID int64, ruleset string, won, drew, ranked, casual4 bool) error {
	return bumpStats(s.db, userID, ruleset, won, drew, ranked, casual4)
}

// CasualPlayers is the only player count the casual mirror counts. At four the
// fair win share is always 25%, so win rates are comparable. See migration 0033.
const CasualPlayers = 4

// bumpStats is the tx-aware core, shared by BumpStats (auto-commit) and
// FinalizeGame (inside the finalize transaction).
//
// casual4 means the game was non-ranked and seated exactly CasualPlayers. It is
// not !ranked: a 6-player casual game bumps the career total and neither mirror.
func bumpStats(q execQuerier, userID int64, ruleset string, won, drew, ranked, casual4 bool) error {
	win, draw := 0, 0
	if won {
		win = 1
	}
	if drew {
		draw = 1
	}
	rGame, rWin, rDraw := 0, 0, 0
	if ranked {
		rGame = 1
		rWin, rDraw = win, draw
	}
	cGame, cWin, cDraw := 0, 0, 0
	if casual4 {
		cGame = 1
		cWin, cDraw = win, draw
	}
	_, err := q.Exec(`
		INSERT INTO stats (user_id, ruleset, games, wins, draws, ranked_games, ranked_wins, ranked_draws,
		                   casual_games, casual_wins, casual_draws)
		VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, ruleset) DO UPDATE SET
			games        = stats.games + 1,
			wins         = stats.wins + excluded.wins,
			draws        = stats.draws + excluded.draws,
			ranked_games = stats.ranked_games + excluded.ranked_games,
			ranked_wins  = stats.ranked_wins + excluded.ranked_wins,
			ranked_draws = stats.ranked_draws + excluded.ranked_draws,
			casual_games = stats.casual_games + excluded.casual_games,
			casual_wins  = stats.casual_wins + excluded.casual_wins,
			casual_draws = stats.casual_draws + excluded.casual_draws`,
		userID, ruleset, win, draw, rGame, rWin, rDraw, cGame, cWin, cDraw)
	return err
}

// BumpBotStats increments a personality's casual four-player record. botName is
// the seat's display name exactly as it appears at the table ("Bot Winston"),
// which is the only place a bot's personality is recorded (see migration 0033
// and bot.DisplayNamePrefix).
func (s *Store) BumpBotStats(botName, ruleset string, won, drew bool) error {
	return bumpBotStats(s.db, botName, ruleset, won, drew)
}

func bumpBotStats(q execQuerier, botName, ruleset string, won, drew bool) error {
	if botName == "" {
		return nil
	}
	win, draw := 0, 0
	if won {
		win = 1
	}
	if drew {
		draw = 1
	}
	_, err := q.Exec(`
		INSERT INTO bot_stats (bot_name, ruleset, games, wins, draws)
		VALUES (?, ?, 1, ?, ?)
		ON CONFLICT(bot_name, ruleset) DO UPDATE SET
			games = bot_stats.games + 1,
			wins  = bot_stats.wins + excluded.wins,
			draws = bot_stats.draws + excluded.draws`,
		botName, ruleset, win, draw)
	return err
}

// BotStats is one personality's casual four-player record on one ruleset.
type BotStats struct {
	Name    string `json:"name"`
	Ruleset string `json:"ruleset"`
	Games   int    `json:"games"`
	Wins    int    `json:"wins"`
	Draws   int    `json:"draws"`
}

// AllBotStats returns every personality's record, most-played first.
func (s *Store) AllBotStats() ([]BotStats, error) {
	rows, err := s.rdb.Query(`
		SELECT bot_name, ruleset, games, wins, draws FROM bot_stats
		ORDER BY games DESC, bot_name, ruleset`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BotStats{}
	for rows.Next() {
		var b BotStats
		if err := rows.Scan(&b.Name, &b.Ruleset, &b.Games, &b.Wins, &b.Draws); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

type UserStats struct {
	Ruleset string `json:"ruleset"`
	Games   int    `json:"games"`
	Wins    int    `json:"wins"`
	// Draws is a subset of Games, disjoint from Wins: a game that ended with
	// no winner (an agreed draw, or a claim with nobody ahead).
	Draws int `json:"draws"`
	// CasualGames/CasualWins/CasualDraws are the non-ranked, exactly-four-player
	// mirror. A subset of Games, disjoint from the ranked mirror but not its
	// complement: a casual game at any other player count is in neither.
	CasualGames int     `json:"casual_games"`
	CasualWins  int     `json:"casual_wins"`
	CasualDraws int     `json:"casual_draws"`
	Elo         float64 `json:"elo"`
	Provisional bool    `json:"provisional"` // sigma > ProvisionalSigma (true when unrated)
}

// StatsFor returns a user's per-ruleset stats joined with ratings.
func (s *Store) StatsFor(userID int64) ([]UserStats, error) {
	rows, err := s.rdb.Query(`
		SELECT st.ruleset, st.games, st.wins, st.draws,
		       st.casual_games, st.casual_wins, st.casual_draws,
		       COALESCE(r.elo, 1000), COALESCE(r.sigma, 8.3333333)
		FROM stats st LEFT JOIN ratings r ON r.user_id = st.user_id AND r.ruleset = st.ruleset
		WHERE st.user_id = ? ORDER BY st.ruleset`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserStats
	for rows.Next() {
		var u UserStats
		var sigma float64
		if err := rows.Scan(&u.Ruleset, &u.Games, &u.Wins, &u.Draws,
			&u.CasualGames, &u.CasualWins, &u.CasualDraws, &u.Elo, &sigma); err != nil {
			return nil, err
		}
		u.Provisional = sigma > rating.ProvisionalSigma
		out = append(out, u)
	}
	return out, rows.Err()
}
