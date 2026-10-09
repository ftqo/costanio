// Package replay turns an event log into something a viewer can watch: the
// log, plus the authoritative board after each event.
//
// The fold runs in the engine rather than the client because victory points,
// hands, longest road and phase are derived quantities; lib/foldEvent.ts folds
// geometry only, so the client never re-implements the rules. The client just
// selects a frame.
//
// cmd/costan-replay (homepage attract loop, harnesses) and the server's
// /api/games/{id}/frames and /api/replay/frames endpoints share this fold and
// its output shape.
package replay

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime/debug"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// Frame is one step: the event that fired, and the board once it had been
// applied.
type Frame struct {
	Seq   int              `json:"seq"`
	Type  engine.EventType `json:"type"`
	Event engine.Event     `json:"event"`
	View  *game.FullView   `json:"view"`
}

// Meta is what the log says about itself, read off the fold rather than passed
// in, so it always matches the frames.
type Meta struct {
	GameID  string `json:"game_id"`
	Players int    `json:"players"`
	Ruleset string `json:"ruleset"`
	// Seed is the committed seed, present only when the log carries it. A
	// spectator's log has it stripped (see game.RedactEvent), and such a log
	// cannot be folded. A pointer because 0 is a valid seed.
	//
	// Sent as a JSON string, like every seed this server sends: a uint64 does
	// not survive JSON.parse's float64.
	Seed *uint64 `json:"seed,string,omitempty"`
	// Winner is engine.NoPlayer (-1) for a game with no winner, which includes
	// a draw and a log that stops early.
	Winner int   `json:"winner"`
	Scores []int `json:"scores"`
	Events int   `json:"events"`

	// Sim provenance, set only by cmd/costan-replay.
	Bot       string `json:"bot,omitempty"`
	Lookahead int    `json:"lookahead,omitempty"`
	Width     int    `json:"width,omitempty"`
}

// File is a whole replay: what the log was, and every frame in it.
type File struct {
	Meta   Meta    `json:"meta"`
	Frames []Frame `json:"frames"`
}

// ErrEmpty is a log with nothing in it, distinct from a malformed one: nothing
// to watch rather than something wrong.
var ErrEmpty = errors.New("replay: empty event log")

// ErrNotAGameLog is a list of events that does not start at the beginning of a
// game. The engine will not object: Apply takes a lone `dice_rolled` at seq 0
// and returns a state with no board, which folds to an empty replay.
var ErrNotAGameLog = errors.New("replay: log does not start with game_created")

// ApplyError is a log the engine refused, naming the event that stopped it so a
// caller can report which event the engine could not reproduce.
type ApplyError struct {
	Seq   int
	Type  engine.EventType
	Cause error
}

func (e *ApplyError) Error() string {
	return fmt.Sprintf("replay: event %d (%s): %v", e.Seq, e.Type, e.Cause)
}

func (e *ApplyError) Unwrap() error { return e.Cause }

// PanicError is a fold the engine crashed inside.
//
// Every fold recovers into this, not only untrusted ones: a module bug can
// produce logs that panic on Apply, and without a recover net/http just closes
// the connection. As an error the endpoint can return a 500 naming the game.
// The fold is abandoned and no frames are served.
//
// Stack is kept for logging and left out of Error(), because the trusted
// endpoint puts the error text in its response body.
type PanicError struct {
	Value any
	Stack []byte
}

func (e *PanicError) Error() string { return fmt.Sprintf("replay: fold panicked: %v", e.Value) }

// Fold plays the log through the engine, snapshotting the view after every
// event.
//
// `viewer` is whose eyes the frames are drawn through; game.Spectator is what
// the server serves. Redaction happens on the view, not the log, because a
// redacted log (no seed) cannot be folded; the server folds the raw log it
// holds.
//
// Incremental Apply rather than engine.Replay per prefix: same result, linear
// instead of quadratic.
//
// Frames carry no legal-target lists (see game.NewReplayView): nobody acts in a
// replay, and they are the expensive part of a view.
func Fold(gameID string, events []engine.Event, viewer engine.PlayerID) (*File, error) {
	return fold(gameID, events, func(s *engine.State) *game.FullView {
		return game.NewReplayView(s, viewer)
	})
}

// FoldRevealed is Fold with every seat's hand on every frame.
//
// Finished games only, which is all either endpoint serves; see
// game.NewRevealedReplayView for why the hands are shown. The events are still
// redacted per viewer on the way out (see Redact): the log's record of a steal
// and the seed are a separate question.
func FoldRevealed(gameID string, events []engine.Event) (*File, error) {
	return fold(gameID, events, game.NewRevealedReplayView)
}

func fold(gameID string, events []engine.Event, view func(*engine.State) *game.FullView) (file *File, err error) {
	defer func() {
		if r := recover(); r != nil {
			file, err = nil, &PanicError{Value: r, Stack: debug.Stack()}
		}
	}()
	if len(events) == 0 {
		return nil, ErrEmpty
	}
	// A game log starts where a game starts. Apply does not check this (see
	// ErrNotAGameLog), and an uploaded file can be anything.
	if events[0].Seq != 0 || events[0].Type != engine.EvGameCreated {
		return nil, ErrNotAGameLog
	}
	s := engine.Empty()
	frames := make([]Frame, 0, len(events))
	for _, ev := range events {
		if err := engine.Apply(s, ev); err != nil {
			return nil, &ApplyError{Seq: ev.Seq, Type: ev.Type, Cause: err}
		}
		frames = append(frames, Frame{
			Seq:   ev.Seq,
			Type:  ev.Type,
			Event: ev,
			View:  view(s),
		})
	}
	return &File{Meta: metaOf(gameID, s, events), Frames: frames}, nil
}

// Redact rewrites a folded replay as `viewer` may see it: every event through
// game.RedactEvent, and Meta.Seed dropped.
//
// One call because the seed is in two places: the events, and Meta.Seed, which
// is read off the raw log during the fold.
//
// The views are not touched: they were already built for the fold's viewer and
// cannot be redacted afterwards.
func (f *File) Redact(viewer engine.PlayerID) {
	for i := range f.Frames {
		f.Frames[i].Event = game.RedactEvent(f.Frames[i].Event, viewer)
	}
	f.Meta.Seed = nil
}

// FoldUntrusted is Fold over a log this server did not write.
//
// Apply validates the sequence and decodes payloads but is not hardened against
// hostile input. A panic becomes ErrNotAGameLog here, so the upload endpoint
// answers 422 rather than 500: the file is at fault, not the server.
//
// checkUntrusted bounds the opening config before folding, because some hostile
// input does not panic at all: `players: 1e8` allocates 16 GB, and Go's fatal
// out-of-memory cannot be recovered.
func FoldUntrusted(gameID string, events []engine.Event, viewer engine.PlayerID) (*File, error) {
	if err := checkUntrusted(gameID, events); err != nil {
		return nil, err
	}
	return untrusted(Fold(gameID, events, viewer))
}

// FoldRevealedUntrusted is FoldRevealed behind the same guard, for the upload
// endpoint. See FoldUntrusted and FoldRevealed.
//
// A file that folds is a raw log (a redacted one has no seed), so the hands
// shown are data the uploader already has.
func FoldRevealedUntrusted(gameID string, events []engine.Event) (*File, error) {
	if err := checkUntrusted(gameID, events); err != nil {
		return nil, err
	}
	return untrusted(FoldRevealed(gameID, events))
}

// untrusted restates a crashed fold as "that file is not a game", which the
// endpoint turns into a 422. The panic value is kept; the stack is not.
func untrusted(file *File, err error) (*File, error) {
	var p *PanicError
	if errors.As(err, &p) {
		return nil, fmt.Errorf("%w: %v", ErrNotAGameLog, p.Value)
	}
	return file, err
}

// checkUntrusted refuses a log whose opening event describes a game that could
// not exist, before any event is folded.
//
// The engine bounds the same numbers (engine.CheckConfigBounds, from Apply).
// This runs first so the error names the file's problem, and it resolves the
// ruleset up front: an unregistered module panics in State.Modules, which would
// surface only as "not a game log".
//
// The rest of the log (seq chain, payloads, player indices) is left to Apply;
// this only bounds the fields that size work before Apply runs.
func checkUntrusted(gameID string, events []engine.Event) error {
	if len(events) == 0 || events[0].Type != engine.EvGameCreated {
		return nil // not a game log at all; fold says so, in its own words
	}
	var d engine.GameCreatedData
	if err := json.Unmarshal(events[0].Data, &d); err != nil {
		return fmt.Errorf("%w: %s: unreadable %s: %w",
			ErrNotAGameLog, clip(gameID), engine.EvGameCreated, err)
	}
	if err := engine.CheckConfigBounds(d.Config); err != nil {
		return fmt.Errorf("%w: %s: %w", ErrNotAGameLog, clip(gameID), err)
	}
	if !engine.ValidRuleset(d.Config.Ruleset) {
		return fmt.Errorf("%w: %s: unknown ruleset %q",
			ErrNotAGameLog, clip(gameID), clip(d.Config.Ruleset))
	}
	return nil
}

// clip bounds an uploader-chosen string before it is quoted back in an error,
// so an 8 MB game id doesn't become an 8 MB message.
func clip(s string) string {
	const limit = 64
	if len(s) <= limit {
		return s
	}
	return s[:limit] + "..."
}

// metaOf reads the summary off the state the fold ended on.
func metaOf(gameID string, s *engine.State, events []engine.Event) Meta {
	scores := make([]int, s.Config.Players)
	for seat := range scores {
		scores[seat] = s.VPWithModules(engine.PlayerID(seat))
	}
	m := Meta{
		GameID:  gameID,
		Players: s.Config.Players,
		Ruleset: s.Config.Ruleset,
		Winner:  int(s.Winner),
		Scores:  scores,
		Events:  len(events),
	}
	if seed, ok := seedOf(events); ok {
		m.Seed = &seed
	}
	return m
}

// seedOf reads the committed seed out of the log's opening event. Optional: a
// spectator's log has it stripped. When present, a player can check the dice
// against the commitment shown during the game (docs/dice.md).
func seedOf(events []engine.Event) (uint64, bool) {
	for _, ev := range events {
		if ev.Type != engine.EvGameCreated {
			continue
		}
		var d engine.GameCreatedData
		if err := json.Unmarshal(ev.Data, &d); err != nil {
			return 0, false
		}
		// A redacted GameCreated keeps `config` and the commitments and drops the
		// seeds, which unmarshal to zero. A real log has both seed and commitment.
		return d.Seed, d.SeedCommit == "" || d.Seed != 0
	}
	return 0, false
}
