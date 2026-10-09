package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/econ"
)

// cosmeticsErr maps cosmetics/econ domain errors onto API responses.
func cosmeticsErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, econ.ErrInsufficientFunds):
		writeErr(w, http.StatusBadRequest, "INSUFFICIENT_FUNDS", "Not enough Pips")
	case errors.Is(err, cosmetics.ErrUnknownItem), errors.Is(err, cosmetics.ErrUnknownColor):
		writeErr(w, http.StatusNotFound, "ITEM_NOT_FOUND", "No such item")
	case errors.Is(err, cosmetics.ErrSupporterExclusive):
		writeErr(w, http.StatusForbidden, "SUPPORTER_EXCLUSIVE_ITEM", "Supporter-exclusive item")
	case errors.Is(err, cosmetics.ErrNotPurchasable):
		writeErr(w, http.StatusBadRequest, "NOT_PURCHASABLE", "Item is not purchasable")
	case errors.Is(err, cosmetics.ErrNotOwned):
		writeErr(w, http.StatusForbidden, "NOT_OWNED", "You don't own that")
	case errors.Is(err, cosmetics.ErrWrongSlot):
		writeErr(w, http.StatusBadRequest, "WRONG_SLOT", "Item doesn't go in that slot")
	default:
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Something went wrong")
	}
}

func (s *Server) handleWallet(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	bal, err := s.led.Balance(u.ID)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	recent, err := s.led.Recent(u.ID, 20)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"balance": bal, "recent": recent})
}

func (s *Server) handleSupporter(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	// Self-heal: a TTL-gated re-pull of the user's own Discord roles so a freshly
	// granted role (e.g. via /setrole) shows up without a re-login. Cheap (no
	// Discord call within the 15s TTL) and self-only.
	v, err := s.cosmetics.RefreshAndView(r.Context(), u.ID, false)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// PushSupporterUpdate sends a user's current supporter view to that user's own
// live connections, so a status change reflects across all their tabs and the
// Discord Activity without a re-login. Wired to the role Refresher's OnChange
// hook. Self-only; SendToUser no-ops when the user has no live connections.
func (s *Server) PushSupporterUpdate(userID int64) {
	v, err := s.cosmetics.SupporterView(userID)
	if err != nil {
		return
	}
	s.hub.SendToUser(userID, map[string]any{"t": "supporter_updated", "supporter": v})
}

// handleRefreshRoles is the explicit "sync my Discord roles" action (the manual
// button). It forces an unconditional pull, rate-limited per user, and returns
// the updated supporter view. Self-only: it can only refresh the caller.
func (s *Server) handleRefreshRoles(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	if !s.refreshLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "ROLE_REFRESH_RATE_LIMITED", "Slow down, try again in a moment")
		return
	}
	v, err := s.cosmetics.RefreshAndView(r.Context(), u.ID, true)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleCosmetics(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	items, err := s.cosmetics.Catalog(u.ID)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handlePurchase(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	// Buying is authenticated and idempotent, but each attempt costs a
	// write, so it is metered like every other mutation.
	if !s.purchaseLimit.allow(strconv.FormatInt(u.ID, 10)) {
		writeErr(w, http.StatusTooManyRequests, "PURCHASE_RATE_LIMITED", "Too many purchases")
		return
	}
	if err := s.cosmetics.Purchase(u.ID, r.PathValue("id")); err != nil {
		cosmeticsErr(w, err)
		return
	}
	bal, _ := s.led.Balance(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"owned": true, "balance": bal})
}

func (s *Server) handleGetLoadout(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	lo, err := s.cosmetics.Loadout(u.ID)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"loadout": lo})
}

func (s *Server) handlePutLoadout(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	var body struct {
		Slot   string `json:"slot"`
		ItemID string `json:"item_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Slot == "" {
		writeErr(w, http.StatusBadRequest, "SLOT_REQUIRED", "Slot required")
		return
	}
	var err error
	if body.ItemID == "" {
		err = s.cosmetics.Unequip(u.ID, body.Slot) // empty item = unequip
	} else {
		err = s.cosmetics.Equip(u.ID, body.Slot, body.ItemID)
	}
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	lo, _ := s.cosmetics.Loadout(u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"loadout": lo})
}

func (s *Server) handleColors(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFrom(r.Context())
	noStore(w)
	colors, err := s.cosmetics.Colors(u.ID)
	if err != nil {
		cosmeticsErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"colors": colors})
}
