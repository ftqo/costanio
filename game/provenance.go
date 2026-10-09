package game

import (
	"log/slog"

	"github.com/ftqo/costan.io/engine"
)

// Provenance: who is really playing a seat. The engine is never told seat
// status, so the actor records it in two ways: every committed batch carries
// an engine.Source (autoSourceFor), and every change in who holds a seat is
// recorded at the log position it took effect (noteControl).

// autoSourceFor is the provenance of an action the server is about to take
// for seat. timedOut distinguishes the two reasons a seat with no bot is
// played for: its clock ran out with the player connected, or nobody is in
// the chair.
//
// A bot takes precedence: once a bot holds the seat it chooses the move,
// whether or not a clock also expired. Among bots, an original bot is
// distinguished from one that took over a human's seat mid-game, since the
// earlier events on that seat were a person's decisions.
func (a *Actor) autoSourceFor(seat engine.PlayerID, timedOut bool) engine.Source {
	if _, isBot := a.botSeats[seat]; isBot {
		// humanSeats is seats whose store status was not "bot" at load, so a
		// seat escalated in an earlier session still reads as a takeover. A
		// seat handed over voluntarily (LeaveSeat marks it "auto") is also a
		// takeover: a human played the opening and a bot the rest.
		if a.humanSeats[seat] {
			return engine.SourceBotTakeover
		}
		return engine.SourceBot
	}
	if timedOut {
		return engine.SourceTimeout
	}
	return engine.SourceAuto
}

// seatControl is the coarse status recorded in the seat_control log: who holds
// the seat now, as opposed to who caused one event. It uses autoSourceFor's
// vocabulary minus the action-only sources.
func (a *Actor) seatControl(seat engine.PlayerID) string {
	if _, isBot := a.botSeats[seat]; isBot {
		if a.humanSeats[seat] {
			return "bot_takeover"
		}
		return "bot"
	}
	if a.autoSeats[seat] {
		return "auto"
	}
	if a.humanSeats[seat] {
		return "human"
	}
	// A seat with no bot source that was never a human seat: an original bot
	// in a game running without a bot factory (sims, tests), played by
	// auto-pass.
	return "auto"
}

// noteControl records seat's current control against the current log
// position, only when it differs from the last known value. Called from every
// path that can change who holds a seat.
//
// The dedupe matters: SetSeatAuto runs on every re-subscribe, and a flaky
// client re-subscribes constantly.
//
// Runs on the actor loop. That is affordable because control changes are
// rare; the store shares one SQLite connection with the event writer (see
// seedControl). A failure is logged and dropped rather than affecting the
// game.
func (a *Actor) noteControl(seat engine.PlayerID) {
	ctl := a.seatControl(seat)
	if a.controlNow[seat] == ctl {
		return
	}
	a.controlNow[seat] = ctl
	if err := a.st.RecordSeatControl(a.ID, a.state.NextSeq, int(seat), ctl); err != nil {
		slog.Error("record seat control", "game", a.ID, "seat", seat, "control", ctl, "err", err)
	}
}

// seedControl primes the in-memory picture of who holds each seat. It writes
// nothing.
//
// seat_control holds transitions, not states. A seat's opening control is
// already in seats.status, so a baseline row per seat per load would duplicate
// it and cost a write on the shared connection at every load (thousands in a
// bot simulation).
//
// Priming from the computed control also keeps a reload silent: a seat that
// escalated in an earlier session gets the same bot back, computes the same
// control, and records nothing.
func (a *Actor) seedControl() {
	for q := range a.state.Players {
		seat := engine.PlayerID(q)
		a.controlNow[seat] = a.seatControl(seat)
	}
}
