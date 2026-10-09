package sim

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// Contender is one competitor in a ladder: a name and a way to build a fresh
// bot for a seat. New returns a new instance per seat per game because bots
// carry per-game cached state (see bot.Strong.Prime). A contender in another
// language would only need a New that proxies Act to a subprocess.
type Contender struct {
	Name string
	New  func() game.CommandSource
}

// LadderOptions configures a head-to-head run.
type LadderOptions struct {
	Contenders []Contender
	Games      int                        // total games to play; rounded up to a multiple of Players
	Players    int                        // seats per game
	Ruleset    string                     // "" = base
	Board      *board.Board               // authored map, as the lobby passes a gallery map
	Modules    map[string]json.RawMessage // per-module config, as Options.Modules
	Seed       uint64                     // base seed; game i uses Seed+i
	Workers    int                        // 0 = 1
	TargetVP   int
	MaxEvents  int
	// Timeout is the per-game deadline handed to RunGame; 0 keeps its 30s
	// default. Set it for wide tables: a 10-player game is several times the
	// work of a 4-player one, and one game over the deadline aborts the whole
	// ladder (Run keeps the first non-stalemate error). Size it for a loaded
	// machine.
	Timeout time.Duration
	// BotDelay paces bot seats as the server does. At zero, runAutoSeats plays
	// up to 64 actions before runOfferResponses runs, so a standing offer is
	// gone before anyone answers. Set it for anything involving trade
	// responses. See Options.BotDelay.
	BotDelay time.Duration
}

// LadderResult reports one contender's record.
type LadderResult struct {
	Name     string
	Wins     int
	Games    int
	WinRate  float64
	CILow    float64 // Wilson 95% interval
	CIHigh   float64
	AvgVP    float64
	SeatWins []int // wins by seat index, to expose residual seat bias
}

// Ladder is the outcome of a head-to-head run.
type Ladder struct {
	Results    []LadderResult
	Played     int
	Stalemates int
	// Draws counts games that finished with no winner. Excluded from Played for
	// the same reason stalemates are: no contender won them.
	Draws int
}

// ladderTag names a game's seat-to-contender assignment, deterministically, for
// the game id, so two ladders sharing a store and seed base don't collide on
// games.id.
func ladderTag(contenders []Contender, seatOf []int) string {
	var b strings.Builder
	for seat, c := range seatOf {
		if seat > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%d:%s", seat, contenders[c].Name)
	}
	return b.String()
}

// Run plays a seat-rotated round of games between the contenders and reports
// win rates with confidence intervals.
//
// Each contender occupies each seat equally often (game i assigns contender
// (seat + i) mod len(Contenders) to each seat), since seat 0 wins about 29% of
// a 4-player field against a fair 25% and tuning against fixed seating would
// partly tune against that.
//
// Stalemates (games that hit the event cap) are excluded from the denominator
// rather than scored as losses: they are a bot limitation, not evidence about
// either contender, and at 4 players they are ~0.
func Run(st *store.Store, opts LadderOptions) (Ladder, error) {
	if len(opts.Contenders) < 2 {
		return Ladder{}, fmt.Errorf("sim: ladder needs at least 2 contenders, got %d", len(opts.Contenders))
	}
	if opts.Players < 2 {
		return Ladder{}, fmt.Errorf("sim: ladder needs at least 2 players, got %d", opts.Players)
	}
	if len(opts.Contenders) > opts.Players {
		return Ladder{}, fmt.Errorf("sim: %d contenders will not fit in %d seats", len(opts.Contenders), opts.Players)
	}
	// Seats must divide evenly among contenders, otherwise one of them holds an
	// extra seat every game and its higher win rate measures the extra seat
	// rather than any difference in skill.
	if opts.Players%len(opts.Contenders) != 0 {
		return Ladder{}, fmt.Errorf("sim: %d seats do not divide evenly among %d contenders", opts.Players, len(opts.Contenders))
	}
	if opts.Workers < 1 {
		opts.Workers = 1
	}
	// Round up so every contender gets each seat the same number of times.
	games := opts.Games
	if r := games % opts.Players; r != 0 {
		games += opts.Players - r
	}

	type outcome struct {
		winnerContender int // index into Contenders, -1 if stalemate or drawn
		winnerSeat      int
		vp              []int
		seatOf          []int // seat -> contender index
		stalemate       bool
		drawn           bool
	}

	outcomes := make([]outcome, games)
	var wg sync.WaitGroup
	work := make(chan int)
	var firstErr error
	var errOnce sync.Once

	for range opts.Workers {
		wg.Go(func() {
			for i := range work {
				seatOf := make([]int, opts.Players)
				for seat := range seatOf {
					seatOf[seat] = (seat + i) % len(opts.Contenders)
				}
				res, err := RunGame(st, Options{
					Players:   opts.Players,
					Ruleset:   opts.Ruleset,
					Board:     opts.Board,
					Modules:   opts.Modules,
					TargetVP:  opts.TargetVP,
					Seed:      opts.Seed + uint64(i),
					MaxEvents: opts.MaxEvents,
					Timeout:   opts.Timeout,
					BotDelay:  opts.BotDelay,
					// The seat assignment is what GameConfig can't see, so it keeps
					// two ladders' rows apart. Derived from contender names and this
					// game's rotation: same ladder, same ids.
					IDTag: ladderTag(opts.Contenders, seatOf),
					Bots: func(seat engine.PlayerID) game.CommandSource {
						return opts.Contenders[seatOf[int(seat)]].New()
					},
				})
				switch {
				case errors.Is(err, ErrStalemate):
					outcomes[i] = outcome{stalemate: true, seatOf: seatOf}
				case err != nil:
					errOnce.Do(func() { firstErr = err })
				case res.Winner < 0:
					// A drawn game (engine.NoPlayer) has no winning seat. Excluded
					// from the denominator like a stalemate; indexing seatOf with -1
					// would panic.
					outcomes[i] = outcome{winnerContender: -1, drawn: true, seatOf: seatOf}
				default:
					outcomes[i] = outcome{
						winnerContender: seatOf[int(res.Winner)],
						winnerSeat:      int(res.Winner),
						vp:              res.Scores,
						seatOf:          seatOf,
					}
				}
			}
		})
	}
	for i := range games {
		work <- i
	}
	close(work)
	wg.Wait()
	if firstErr != nil {
		return Ladder{}, firstErr
	}

	out := Ladder{Results: make([]LadderResult, len(opts.Contenders))}
	vpTotal := make([]int, len(opts.Contenders))
	vpCount := make([]int, len(opts.Contenders))
	for i := range out.Results {
		out.Results[i] = LadderResult{
			Name:     opts.Contenders[i].Name,
			SeatWins: make([]int, opts.Players),
		}
	}
	for _, o := range outcomes {
		if o.stalemate {
			out.Stalemates++
			continue
		}
		if o.drawn {
			out.Draws++
			continue
		}
		out.Played++
		out.Results[o.winnerContender].Wins++
		out.Results[o.winnerContender].SeatWins[o.winnerSeat]++
		for seat, c := range o.seatOf {
			if seat < len(o.vp) {
				vpTotal[c] += o.vp[seat]
				vpCount[c]++
			}
		}
	}
	for i := range out.Results {
		r := &out.Results[i]
		// Every contender is seated in every game, and one holding several
		// seats still wins at most once, so the denominator is games played,
		// not seats occupied.
		r.Games = out.Played
		if r.Games > 0 {
			r.WinRate = float64(r.Wins) / float64(r.Games)
			r.CILow, r.CIHigh = wilson(r.Wins, r.Games)
		}
		if vpCount[i] > 0 {
			r.AvgVP = float64(vpTotal[i]) / float64(vpCount[i])
		}
	}
	return out, nil
}

// wilson returns the 95% Wilson score interval for k successes in n trials.
// Wilson rather than the normal approximation because win rates near small
// fractions (1/players) make the normal interval misbehave and go below zero.
// At 200 games a 4-point gap is not significant.
func wilson(k, n int) (low, high float64) {
	if n == 0 {
		return 0, 0
	}
	const z = 1.96
	p := float64(k) / float64(n)
	nf := float64(n)
	denom := 1 + z*z/nf
	center := (p + z*z/(2*nf)) / denom
	spread := z * math.Sqrt(p*(1-p)/nf+z*z/(4*nf*nf)) / denom
	return math.Max(0, center-spread), math.Min(1, center+spread)
}

// FairShare is the win rate a contender would post if all contenders were
// equally strong.
func (l Ladder) FairShare() float64 {
	if len(l.Results) == 0 {
		return 0
	}
	return 1 / float64(len(l.Results))
}

// Beats reports whether contender a's win rate is separated from b's with 95%
// confidence (non-overlapping Wilson intervals). This is the ladder's verdict:
// anything that does not clear it is not a measured improvement.
func (l Ladder) Beats(a, b string) bool {
	ra, rb := l.find(a), l.find(b)
	if ra == nil || rb == nil {
		return false
	}
	return ra.CILow > rb.CIHigh
}

func (l Ladder) find(name string) *LadderResult {
	for i := range l.Results {
		if l.Results[i].Name == name {
			return &l.Results[i]
		}
	}
	return nil
}

// String renders a compact table for test logs and the CLI.
func (l Ladder) String() string {
	s := fmt.Sprintf("%d games played (%d stalemates, %d draws), fair share %.1f%%\n",
		l.Played, l.Stalemates, l.Draws, l.FairShare()*100)
	var sSb276 strings.Builder
	for _, r := range l.Results {
		fmt.Fprintf(&sSb276, "  %-24s %4d/%-4d  %5.1f%%  [%.1f%%, %.1f%%]  avgVP %.2f\n",
			r.Name, r.Wins, r.Games, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
	}
	s += sSb276.String()
	return s
}
