package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ftqo/costan.io/store"
)

// mergeTokenTTL bounds how long a merge offer stays valid after the callback.
const mergeTokenTTL = 5 * 60 // seconds

type mergePayload struct {
	Survivor   int64  `json:"s"`
	Provider   string `json:"p"`
	ProviderID string `json:"i"`
	Exp        int64  `json:"e"`
}

func (s *Service) mergeKey() []byte {
	s.mergeOnce.Do(func() {
		s.mergeSecret = make([]byte, 32)
		if _, err := rand.Read(s.mergeSecret); err != nil {
			panic(err) // crypto/rand failure is unrecoverable
		}
	})
	return s.mergeSecret
}

func (s *Service) mintMergeToken(survivorID int64, provider, providerID string) string {
	return s.mintMergeTokenAt(survivorID, provider, providerID, time.Now().Unix()+mergeTokenTTL)
}

// mintMergeTokenAt is the testable core with an explicit expiry.
func (s *Service) mintMergeTokenAt(survivorID int64, provider, providerID string, exp int64) string {
	body, _ := json.Marshal(mergePayload{survivorID, provider, providerID, exp})
	mac := hmac.New(sha256.New, s.mergeKey())
	mac.Write(body)
	return base64.RawURLEncoding.EncodeToString(body) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Service) parseMergeToken(tok string) (mergePayload, bool) {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 {
		return mergePayload{}, false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return mergePayload{}, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return mergePayload{}, false
	}
	mac := hmac.New(sha256.New, s.mergeKey())
	mac.Write(body)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return mergePayload{}, false
	}
	var p mergePayload
	if err := json.Unmarshal(body, &p); err != nil {
		return mergePayload{}, false
	}
	if time.Now().Unix() > p.Exp {
		return mergePayload{}, false
	}
	return p, true
}

// HandleMergePreview returns a redacted summary of the account a pending merge
// would absorb. GET /api/merge/preview?token=
func (s *Service) HandleMergePreview(w http.ResponseWriter, r *http.Request) {
	cur := UserFrom(r.Context())
	if cur == nil {
		writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
		return
	}
	p, ok := s.parseMergeToken(r.URL.Query().Get("token"))
	if !ok || p.Survivor != cur.ID {
		writeErr(w, http.StatusBadRequest, "MERGE_TOKEN_INVALID", "This merge request is invalid or expired")
		return
	}
	victim, err := s.Store.UserByProvider(p.Provider, p.ProviderID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && victim.ID == cur.ID) {
		writeErr(w, http.StatusConflict, "MERGE_GONE", "That account is no longer available to merge")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not load account")
		return
	}
	sum, err := s.Store.AccountSummary(victim.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not load account")
		return
	}
	shared, err := s.Store.UsersShareGame(cur.ID, victim.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not load account")
		return
	}
	blocked := ""
	if shared {
		blocked = "shared_game"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"provider": p.Provider,
		"victim": map[string]any{
			"name":        sum.Name,
			"avatar":      sum.Avatar,
			"games":       sum.Games,
			"isSupporter": sum.IsSupporter,
			"createdAt":   sum.CreatedAt,
		},
		"blocked": blocked,
	})
}

// HandleMergeConfirm performs the merge. POST /api/merge {token}.
func (s *Service) HandleMergeConfirm(w http.ResponseWriter, r *http.Request) {
	cur := UserFrom(r.Context())
	if cur == nil {
		writeErr(w, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON")
		return
	}
	p, ok := s.parseMergeToken(body.Token)
	if !ok || p.Survivor != cur.ID {
		writeErr(w, http.StatusBadRequest, "MERGE_TOKEN_INVALID", "This merge request is invalid or expired")
		return
	}
	victim, err := s.Store.UserByProvider(p.Provider, p.ProviderID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && victim.ID == cur.ID) {
		// Identity already moved or merge already happened: nothing to do.
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Could not load account")
		return
	}
	switch err := s.Store.MergeAccounts(cur.ID, victim.ID); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, store.ErrMergeSharedGame):
		writeErr(w, http.StatusConflict, "MERGE_BLOCKED_SHARED_GAME", "These accounts share a game and can't be merged")
	default:
		writeErr(w, http.StatusInternalServerError, "INTERNAL", "Merge failed")
	}
}
