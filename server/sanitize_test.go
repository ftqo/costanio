package server

import (
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

// A private lobby with a host, one seated player, and every Summary field set,
// so a dropped field shows up as a diff.
func privateSummary() *lobby.Summary {
	tw := timings.For(60)
	return &lobby.Summary{
		Game: &store.Game{
			ID:         "g1",
			Ruleset:    "base",
			InviteCode: "secret42",
			CreatedBy:  10,
		},
		Seats:          []*store.Seat{{GameID: "g1", No: 0, UserID: 10}, {GameID: "g1", No: 1, UserID: 11}},
		HostName:       "Ada",
		HostDecoration: "deco.crown",
		Timings:        &tw,
	}
}

func TestSanitizeKeepsInviteForParticipants(t *testing.T) {
	s := &Server{}
	for _, tc := range []struct {
		name   string
		userID int64
	}{
		{"the host", 10},
		{"a seated player", 11},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := s.sanitize(privateSummary(), tc.userID)
			if got.Game.InviteCode != "secret42" {
				t.Errorf("invite code = %q, want it kept for a participant", got.Game.InviteCode)
			}
		})
	}
}

func TestSanitizeStripsInviteFromEveryoneElse(t *testing.T) {
	s := &Server{}
	// Someone who followed an invite link and spectated without a seat;
	// handleSub lets them in on the code alone.
	got := s.sanitize(privateSummary(), 99)
	if got.Game.InviteCode != "" {
		t.Fatalf("invite code = %q; want it stripped for a non-participant", got.Game.InviteCode)
	}
}

func TestSanitizeDoesNotMutateTheCaller(t *testing.T) {
	s := &Server{}
	in := privateSummary()
	_ = s.sanitize(in, 99)
	// The browse path shares cached summaries, so redacting must not blank
	// the original.
	if in.Game.InviteCode != "secret42" {
		t.Errorf("sanitize blanked the caller's invite code")
	}
}

// TestSanitizePreservesEverythingButTheInvite compares whole structs, so a field
// added to Summary later is covered without editing this test.
func TestSanitizePreservesEverythingButTheInvite(t *testing.T) {
	s := &Server{}
	in := privateSummary()
	got := s.sanitize(in, 99)

	// Compare with Game set aside (it differs by the blanked invite code), so
	// this checks every other field.
	wantRest, gotRest := *in, *got
	wantRest.Game, gotRest.Game = nil, nil
	if !reflect.DeepEqual(wantRest, gotRest) {
		t.Errorf("sanitize dropped or changed a Summary field:\n  before: %+v\n   after: %+v", wantRest, gotRest)
	}

	// And the game itself differs by the invite code alone.
	wantGame := *in.Game
	wantGame.InviteCode = ""
	if !reflect.DeepEqual(wantGame, *got.Game) {
		t.Errorf("sanitize changed more of the game than the invite code:\n  want: %+v\n   got: %+v", wantGame, *got.Game)
	}
}

func TestSanitizePassesThroughNil(t *testing.T) {
	s := &Server{}
	if got := s.sanitize(nil, 1); got != nil {
		t.Errorf("sanitize(nil) = %+v; want nil", got)
	}
}

// A public table's code is disclosed to everybody: the table is open and the
// link is how it gets passed on. Rotation on going private (lobby.SetPrivacy)
// keeps it from lasting.
func TestSanitizeDisclosesAPublicTablesInvite(t *testing.T) {
	s := &Server{}
	pub := privateSummary()
	pub.Game.Public = true

	for _, tc := range []struct {
		who    string
		userID int64
	}{{"the host", 10}, {"a seated player", 11}, {"a stranger", 99}} {
		t.Run(tc.who, func(t *testing.T) {
			if got := s.sanitize(pub, tc.userID); got.Game.InviteCode != "secret42" {
				t.Errorf("invite code = %q, want it disclosed", got.Game.InviteCode)
			}
		})
	}
}

// The listing publishes a public table's code and withholds a private one's.
// ListGames filters on `public`, so a private table shouldn't appear at all;
// this is a second line of defence on two unauthenticated endpoints.
func TestWithoutInvitesPublishesPublicCodesOnly(t *testing.T) {
	pub := privateSummary()
	pub.Game.ID = "pub"
	pub.Game.Public = true
	priv := privateSummary()
	priv.Game.ID = "priv"

	out := withoutInvites([]*lobby.Summary{pub, priv, nil})
	if len(out) != 3 {
		t.Fatalf("got %d summaries, want 3", len(out))
	}
	if out[0].Game.InviteCode != "secret42" {
		t.Errorf("public table's code = %q, want it listed", out[0].Game.InviteCode)
	}
	if out[1].Game.InviteCode != "" {
		t.Errorf("private table's code leaked into a listing: %q", out[1].Game.InviteCode)
	}
	if out[2] != nil {
		t.Error("a nil summary should pass through as nil")
	}
	// The private one is redacted on a copy: Browse() caches the slice, and
	// the host's own view reads the same pointers.
	if priv.Game.InviteCode != "secret42" {
		t.Errorf("withoutInvites mutated the cached summary: %q", priv.Game.InviteCode)
	}
}
