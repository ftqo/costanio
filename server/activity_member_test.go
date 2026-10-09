package server

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/discord"
)

// stubInstances is an activityInstanceLister with a fixed roster per instance.
type stubInstances struct {
	users map[string][]string
	err   error
	calls int
}

func (s *stubInstances) ActivityInstanceUsers(_ context.Context, _, instanceID string) ([]string, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	u, ok := s.users[instanceID]
	if !ok {
		return nil, discord.ErrNoInstance
	}
	return u, nil
}

// TestActivityLobbyRequiresInstanceMembership: an instance id is a client claim.
// With the membership check wired, only a user Discord lists in that instance
// may open (and so create or join) its table.
func TestActivityLobbyRequiresInstanceMembership(t *testing.T) {
	e := newEnv(t)
	e.srv.SetDiscordAppID("app1")
	stub := &stubInstances{users: map[string][]string{"i-1": {"d-in"}}}
	e.srv.SetActivityInstances(stub)

	_, inC := e.discordUser(t, "d-in", "inside")
	if resp, body := activityLobby(t, e, inC, "i-1"); resp.StatusCode != http.StatusOK {
		t.Fatalf("member open = %d: %v", resp.StatusCode, body)
	}

	_, outC := e.discordUser(t, "d-out", "outsider")
	if resp, body := activityLobby(t, e, outC, "i-1"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-member open = %d (%v), want 403", resp.StatusCode, body)
	}
	if resp, _ := activityLobby(t, e, outC, "i-unknown"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("unknown instance = %d, want 403", resp.StatusCode)
	}
	_, guestC := e.guest(t, "g")
	if resp, _ := activityLobby(t, e, guestC, "i-1"); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("guest (no Discord id) = %d, want 403", resp.StatusCode)
	}

	// Discord unreachable: fail closed, never seat on an unverified claim.
	stub.err = errors.New("discord down")
	if resp, _ := activityLobby(t, e, inC, "i-1"); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("discord error = %d, want 503", resp.StatusCode)
	}
	if stub.calls == 0 {
		t.Fatal("the membership check was never consulted")
	}
}

// TestActivityLobbyFailsClosedWithoutVerifier: a production
// deployment with no bot token cannot verify membership, so it refuses rather
// than trusting the client's instance id.
func TestActivityLobbyFailsClosedWithoutVerifier(t *testing.T) {
	e := newEnv(t)
	e.srv.auth.Secure = true
	_, c := e.discordUser(t, "d-in", "inside")
	if resp, _ := activityLobby(t, e, c, "i-1"); resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("prod without verifier = %d, want 503", resp.StatusCode)
	}
}
