package server

import (
	"net/http"
	"testing"
)

// TestReplayCarriesAuditBlock covers the part of the fairness audit that is not
// in the event log: the commitment stored when the lobby opened (to check the
// revealed seed against), and the rosters before and after the seating shuffle
// (a permutation with no recorded input proves nothing). Without this block the
// audit doesn't fail; it skips two checks and still says "verified".
func TestReplayCarriesAuditBlock(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedGameWithSeed(t, e, host, member, "")

	resp, out := e.req(t, "GET", "/api/games/"+id+"/replay", hostC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("replay = %d, want 200", resp.StatusCode)
	}
	audit, ok := out["audit"].(map[string]any)
	if !ok {
		t.Fatalf("the replay carries no audit block: %v", out["audit"])
	}
	if _, ok := audit["public_seed_commit"]; !ok {
		t.Error("audit block has no public_seed_commit")
	}
	raw, ok := audit["final_seats"].([]any)
	if !ok {
		t.Fatalf("audit block has no readable final_seats: %v", audit["final_seats"])
	}
	seats := make([]int64, len(raw))
	for i, v := range raw {
		n, isNum := v.(float64)
		if !isNum {
			t.Fatalf("final_seats[%d] is not a number: %v", i, v)
		}
		seats[i] = int64(n)
	}
	if len(seats) != 2 || seats[0] != host.ID || seats[1] != member.ID {
		t.Errorf("final_seats = %v, want [%d %d]", seats, host.ID, member.ID)
	}
}
