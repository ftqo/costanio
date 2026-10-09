package server

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/replay"
)

// Replay frames endpoints: the logs `/replay` serves, folded into one board per
// event so a client can watch them. The fold is in the `replay` package; this
// file handles access and metering.
//
// `GET /api/games/{id}/frames` is a game the server holds, gated like its log.
// `POST /api/replay/frames` folds a file the viewer supplies (a download, a
// shared file, costan-sim output) that the server has nothing to check against.

// maxReplayBody caps an uploaded log. Well above `maxJSONBody`: a long game is
// thousands of events and a pretty-printed download nearly a megabyte. Still a
// hard ceiling, since the caller chooses how much work this endpoint does.
const maxReplayBody = 8 << 20

// maxReplayEvents caps an uploaded log's length, which is what the work scales
// with. Above the production `-game-event-cap` default of 8000, so every log
// this server wrote is accepted.
const maxReplayEvents = 20000

// handleGameFrames serves a finished game as frames. Access matches the log's
// (see handleReplay): the game must be over, a private game is closed to anyone
// who was not at it and does not hold its code, and the caller decides what
// they are shown.
func (s *Server) handleGameFrames(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	g, err := s.store.GameByID(r.PathValue("id"))
	if err != nil {
		lobbyErr(w, err)
		return
	}
	if !replayable[g.Status] {
		writeErr(w, http.StatusConflict, "REPLAY_NOT_READY", "Replays are available once the game is over")
		return
	}
	participant := s.participatesIn(g, u.ID)
	if !s.mayReadOver(g, r, participant) {
		writeErr(w, http.StatusForbidden, "PRIVATE_GAME", "Private game")
		return
	}

	// A player watches through their own seat (including their hand); everyone
	// else gets the spectator view, as in the live game.
	viewer := game.Spectator
	if participant {
		viewer = s.seatOf(g.ID, u.ID)
	}

	maxSeq, err := s.store.MaxEventSeq(g.ID)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	// Ahead of the meter, as with the log: a 304 carries no events, so a caller
	// over budget can still revalidate. Keyed on the viewer, not just
	// "participant", because each seat gets a different answer.
	etag := framesETag(g.ID, viewer, maxSeq)
	if ifNoneMatch(r.Header.Get("If-None-Match"), etag) {
		setReplayCacheHeaders(w, etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	if !s.allowLog(w, r, u) {
		return
	}

	// Always fold the raw log: a redacted one has no seed and can't be folded.
	// Redaction happens on the way out, on the views by `viewer` and on the
	// events below.
	events, err := s.store.LoadEvents(g.ID, 0)
	if err != nil {
		lobbyErr(w, err)
		return
	}
	// Revealed: the game is finished, so hidden information protects nothing,
	// and a replay with card backs for the other seats is hard to follow. The
	// gate above still decides who may watch, and `viewer` still decides what
	// the events say and whether the seed travels (see below).
	file, err := replay.FoldRevealed(g.ID, events)
	if err != nil {
		// This server wrote and finished this game, so a failed fold is an engine
		// bug. A panic in the fold comes back as replay.PanicError, so the player
		// gets a 500 instead of a dropped connection and the stack goes to the
		// log, not the response.
		var p *replay.PanicError
		if errors.As(err, &p) {
			slog.Error("frames: fold panicked", "game", g.ID, "panic", fmt.Sprint(p.Value), "stack", string(p.Stack))
		}
		writeErr(w, http.StatusInternalServerError, "REPLAY_FOLD_FAILED", fmt.Sprintf("could not fold %s: %v", g.ID, err))
		return
	}
	// A participant may see the raw events and the seed, as the log endpoint
	// gives them (docs/dice.md). Nobody else may; File.Redact covers both
	// places they appear.
	if !participant {
		file.Redact(game.Spectator)
	}
	s.chargeLog(r, u, len(events))
	setReplayCacheHeaders(w, etag)
	writeFrames(w, r, file)
}

// handleReplayFrames folds a log the caller supplies. There is nothing to leak:
// the caller already holds every byte. The work is metered from the same
// buckets as a log read.
//
// The views are spectator views, since a file does not say whose it is.
func (s *Server) handleReplayFrames(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	if !s.allowLog(w, r, u) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxReplayBody)
	var body struct {
		Game   string         `json:"game"`
		Events []engine.Event `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		// One code for "that file is not a replay", whether too big, not JSON, or
		// the wrong shape.
		writeErr(w, http.StatusBadRequest, "REPLAY_FILE_INVALID", "Not a replay file: "+err.Error())
		return
	}
	if len(body.Events) == 0 {
		writeErr(w, http.StatusBadRequest, "REPLAY_FILE_INVALID", "Replay file carries no events")
		return
	}
	if len(body.Events) > maxReplayEvents {
		writeErrParams(w, http.StatusRequestEntityTooLarge, "REPLAY_FILE_TOO_LONG",
			map[string]any{"max": maxReplayEvents}, "Replay file is too long")
		return
	}
	file, err := replay.FoldRevealedUntrusted(body.Game, body.Events)
	if err != nil {
		// Usually a spectator's download: its seed is stripped, so the board is
		// never dealt and the first event that needs it fails. The message says
		// so.
		var applyErr *replay.ApplyError
		if errors.As(err, &applyErr) {
			writeErrParams(w, http.StatusUnprocessableEntity, "REPLAY_NOT_FOLDABLE",
				map[string]any{"seq": applyErr.Seq, "event": string(applyErr.Type)}, applyErr.Error())
			return
		}
		if errors.Is(err, replay.ErrNotAGameLog) {
			writeErr(w, http.StatusUnprocessableEntity, "REPLAY_NOT_FOLDABLE", err.Error())
			return
		}
		writeErr(w, http.StatusBadRequest, "REPLAY_FILE_INVALID", err.Error())
		return
	}
	s.chargeLog(r, u, len(body.Events))
	writeFrames(w, r, file)
}

// seatOf is the seat this user sat in, or Spectator if they did not sit.
// participatesIn is wider: it includes a host who never took a seat (watching
// their own bots), who has no seat and so watches as a spectator.
func (s *Server) seatOf(gameID string, userID int64) engine.PlayerID {
	st, err := s.store.SeatForUser(gameID, userID)
	if err != nil {
		return game.Spectator
	}
	return engine.PlayerID(st.No)
}

// framesETag validates a folded reply. Keyed on the viewer, since the same URL
// serves a different answer per seat and one seat must not revalidate against
// another's copy.
func framesETag(gameID string, viewer engine.PlayerID, maxSeq int) string {
	return fmt.Sprintf(`"f%d-%d-%s-%d"`, replayETagVersion, viewer, gameID, maxSeq)
}

// writeFrames sends a folded replay, gzipped when the caller accepts it.
//
// The only endpoint that compresses: a folded game is a full board per event,
// megabytes of repetitive JSON, and compresses extremely well (the homepage
// recording is 877 KB of frames and 12.8 KB over the wire). Nothing else here
// is large enough to bother.
func writeFrames(w http.ResponseWriter, r *http.Request, file *replay.File) {
	w.Header().Set("Content-Type", "application/json")
	if !acceptsGzip(r) {
		writeJSON(w, http.StatusOK, file)
		return
	}
	// Vary, so a cache doesn't serve gzip to a client that didn't ask. Both
	// headers must be set before WriteHeader.
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.WriteHeader(http.StatusOK)
	zw := gzip.NewWriter(w)
	defer zw.Close()
	// An error here means the client hung up mid-body; the status line is
	// already sent.
	_ = json.NewEncoder(zw).Encode(file)
}

func acceptsGzip(r *http.Request) bool {
	for enc := range strings.SplitSeq(r.Header.Get("Accept-Encoding"), ",") {
		name, _, _ := strings.Cut(strings.TrimSpace(enc), ";")
		if strings.EqualFold(name, "gzip") {
			return true
		}
	}
	return false
}
