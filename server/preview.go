package server

import (
	"encoding/json"
	"errors"
	mrand "math/rand/v2"
	"net/http"
	"strconv"
	"strings"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The map builder's preview.
//
// `POST /api/preview` deals the builder's board and returns it undrawn, in the
// same `{config, board, ext}` envelope `cmd/costan-sim -dump-view` writes, so
// the builder renders it with the game's own `Board3D`.
//
// It uses the real setup path: engine.New and the fold over its setup events,
// which run every module's SetupBoard and FinishBoard hooks in table order. A
// misshapen board here is one a player could be dealt.
//
// Nothing is persisted: the handler builds a *State in memory, serialises two
// of its fields and drops it.
const previewPlayers = 4

// previewResponse is the wire shape. `config`, `board` and `ext` match
// `-dump-view` (frontend/dev/board-shots.tsx reads that envelope); `seed` and
// `ruleset` let the builder reproduce the deal.
//
// The seed is a decimal string: it is a uint64, and a JSON number above 2^53
// would round to a seed that deals a different board.
type previewResponse struct {
	Seed    string            `json:"seed"`
	Ruleset string            `json:"ruleset"`
	Config  engine.GameConfig `json:"config"`
	Board   *board.Board      `json:"board"`
	Ext     map[string]any    `json:"ext"`
}

// errPreviewFold is the engine's own setup events failing to fold onto an empty
// state. That is a bug here, not a bad request, so handlers answer it with a 500.
var errPreviewFold = errors.New("preview: setup events do not fold")

// dealPreview runs the real setup path for cfg under seed and returns the
// envelope the builder draws.
func dealPreview(cfg engine.GameConfig, seed uint64) (*previewResponse, error) {
	setup, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		return nil, err
	}
	st := engine.Empty()
	for _, e := range setup {
		if err := engine.Apply(st, e); err != nil {
			return nil, errPreviewFold
		}
	}
	if st.Board == nil {
		return nil, errPreviewFold
	}
	return &previewResponse{
		Seed:    strconv.FormatUint(seed, 10),
		Ruleset: cfg.Ruleset,
		Config:  st.Config,
		Board:   st.Board,
		// Viewer 0, matching -dump-view: the preview draws nobody's hand, and
		// every module layer the builder cares about is public board furniture.
		Ext: engine.ModuleExtViews(st, 0),
	}, nil
}

// handlePreviewBoard deals the map builder's board for its embedded preview.
//
// `POST /api/preview` with `{ruleset, seed, board, players}`. The board is the
// builder's own (land-only or fully pinned, see docs/maps.md) and goes through
// engine.New as a custom map, as "Play this map" sends it: framed, resolved from
// the seed where blank, ported, then reshaped by every module in the ruleset.
//
// Islands is allowed; a map with separate landmasses is an Islands map.
// Explorers deals its own map and the engine refuses it (AuthoredMapRefuser),
// surfacing as the same BAD_CONFIG the lobby returns.
//
// Metered with the other map tools for CPU.
func (s *Server) handlePreviewBoard(w http.ResponseWriter, r *http.Request) {
	if !s.mapToolLimit.allow(strconv.FormatInt(auth.UserFrom(r.Context()).ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "MAP_TOOL_RATE_LIMITED", "Too many map requests")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Ruleset string       `json:"ruleset"`
		Seed    string       `json:"seed"`
		Board   *board.Board `json:"board"`
		Players int          `json:"players"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Board == nil {
		writeErr(w, http.StatusBadRequest, "BOARD_REQUIRED", "Board required")
		return
	}
	if err := body.Board.ValidateLayout(); err != nil {
		writeErr(w, http.StatusBadRequest, "MAP_LAYOUT_INVALID", "That map layout isn't valid")
		return
	}
	ruleset := strings.TrimSpace(body.Ruleset)
	if ruleset == "" {
		ruleset = "base"
	}
	if len(ruleset) > 128 {
		writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_RULESET", "That is not a ruleset the preview can build")
		return
	}
	ruleset = engine.CanonicalRuleset(ruleset)
	if err := engine.CheckRuleset(ruleset); err != nil {
		var ce *engine.ConflictError
		if errors.As(err, &ce) {
			writeErrParams(w, http.StatusBadRequest, "RULESET_CONFLICT", map[string]any{"modules": conflictingModules(err)}, "Those expansions can't be combined")
			return
		}
		writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_RULESET", "That is not a ruleset the preview can build")
		return
	}
	var seed uint64
	if raw := strings.TrimSpace(body.Seed); raw != "" {
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "PREVIEW_BAD_SEED", "A seed is a whole number")
			return
		}
		seed = n
	} else {
		seed = mrand.Uint64()
	}
	// The seat count only sizes the view (and lets modules that scale with
	// players deal for that table); out-of-range values fall back to four.
	players := body.Players
	if players < engine.MinPlayers || players > engine.MaxPlayers {
		players = previewPlayers
	}
	out, err := dealPreview(engine.GameConfig{
		Players:   players,
		Ruleset:   ruleset,
		Board:     body.Board,
		BoardMode: board.BoardFair,
	}, seed)
	if errors.Is(err, errPreviewFold) {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Something went wrong")
		return
	}
	if err != nil {
		// The map does not fit the ruleset (Islands with no water, Explorers
		// with any authored map, special terrain with its module off). The
		// lobby answers the same fact with the same code.
		if writeMapRefusal(w, err) {
			return
		}
		writeErr(w, http.StatusBadRequest, "BAD_CONFIG", "That game setup isn't valid")
		return
	}
	writeJSON(w, http.StatusOK, out)
}
