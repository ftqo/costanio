package server

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

// fakeServerRefresh satisfies cosmetics.SupporterRefresher and writes a fixed
// staff status when either refresh method runs, so endpoint tests can assert the
// handler actually triggered a self refresh.
type fakeServerRefresh struct {
	st           *store.Store
	staff        bool
	ensureCalls  int
	refreshCalls int
}

func (f *fakeServerRefresh) EnsureFresh(_ context.Context, uid int64) error {
	f.ensureCalls++
	return f.st.SetSupporter(uid, false, false, false, f.staff, false, 0)
}

func (f *fakeServerRefresh) Refresh(_ context.Context, uid int64) error {
	f.refreshCalls++
	return f.st.SetSupporter(uid, false, false, false, f.staff, false, 0)
}

// GET /api/me/supporter must self-heal: a TTL-gated EnsureFresh runs before the
// view is returned, so a freshly-granted role shows up without a re-login.
func TestSupporterEndpointRefreshesSelf(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d-staff", "staffy")
	fake := &fakeServerRefresh{st: e.st, staff: true}
	e.srv.SetSupporterRefresher(fake)

	resp, body := e.req(t, "GET", "/api/me/supporter", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if body["staff"] != true {
		t.Fatalf("staff not reflected after self-refresh: %v", body)
	}
	if fake.ensureCalls == 0 {
		t.Fatal("GET /api/me/supporter did not trigger EnsureFresh")
	}
}

// PushSupporterUpdate delivers a supporter_updated frame carrying the current
// view to the user's own live ws connections.
func TestPushSupporterUpdate(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d-push", "pushy")
	ws := dialWS(t, e.ts, c)

	// Wait until the connection is registered with the hub before pushing.
	for i := 0; i < 200 && !e.srv.hub.Online(u.ID); i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if !e.srv.hub.Online(u.ID) {
		t.Fatal("connection never registered with hub")
	}

	if err := e.st.SetSupporter(u.ID, false, false, false, true, false, 0); err != nil {
		t.Fatal(err)
	}
	e.srv.PushSupporterUpdate(u.ID)

	f := ws.waitFrame(func(f map[string]any) bool { return f["t"] == "supporter_updated" }, "supporter_updated")
	sup, _ := f["supporter"].(map[string]any)
	if sup == nil || sup["staff"] != true {
		t.Fatalf("supporter_updated frame = %v; want supporter.staff true", f)
	}
}

// POST /api/me/supporter/refresh forces an unconditional pull (the manual "sync
// roles" button) and is rate-limited per user.
func TestRefreshRolesEndpoint(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d-ref", "reffy")
	fake := &fakeServerRefresh{st: e.st, staff: true}
	e.srv.SetSupporterRefresher(fake)

	resp, body := e.req(t, "POST", "/api/me/supporter/refresh", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %v", resp.StatusCode, body)
	}
	if body["staff"] != true {
		t.Fatalf("staff not reflected: %v", body)
	}
	if fake.refreshCalls != 1 {
		t.Fatalf("forced Refresh calls = %d; want 1", fake.refreshCalls)
	}

	// Burst is 1: an immediate second call is rate-limited.
	resp2, _ := e.req(t, "POST", "/api/me/supporter/refresh", c, nil)
	if resp2.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second refresh = %d; want 429", resp2.StatusCode)
	}
}

func TestCosmeticsEndpoints(t *testing.T) {
	e := newEnv(t)
	u, ck := e.guest(t, "shopper")

	// Catalog is readable and non-empty.
	resp, body := e.req(t, "GET", "/api/cosmetics", ck, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET cosmetics = %d", resp.StatusCode)
	}
	if items, _ := body["items"].([]any); len(items) == 0 {
		t.Fatal("empty catalog")
	}

	// Empty wallet.
	_, body = e.req(t, "GET", "/api/me/wallet", ck, nil)
	if body["balance"].(float64) != 0 {
		t.Fatalf("starting balance = %v; want 0", body["balance"])
	}

	// Fund the wallet out-of-band (no faucet trigger in a unit test).
	if _, err := e.st.LedgerCredit(u.ID, 500, "grant", "test-seed"); err != nil {
		t.Fatal(err)
	}

	// Purchase.
	resp, body = e.req(t, "POST", "/api/cosmetics/robber.sentinel/purchase", ck, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("purchase = %d", resp.StatusCode)
	}
	if body["balance"].(float64) != 100 { // 500 seeded - 400 for the sentinel
		t.Fatalf("balance after purchase = %v; want 100", body["balance"])
	}

	// Equip it.
	resp, body = e.req(t, "PUT", "/api/me/loadout", ck, map[string]string{"slot": "robber", "item_id": "robber.sentinel"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("equip = %d", resp.StatusCode)
	}
	lo, _ := body["loadout"].(map[string]any)
	if lo["robber"] != "robber.sentinel" {
		t.Fatalf("loadout = %v", lo)
	}

	// Colors palette is exposed.
	_, body = e.req(t, "GET", "/api/colors", ck, nil)
	if colors, _ := body["colors"].([]any); len(colors) != 64 {
		t.Fatalf("colors = %d; want 64", len(colors))
	}

	// /api/me now carries the Pip balance.
	_, body = e.req(t, "GET", "/api/users/me", ck, nil)
	if body["pips"].(float64) != 100 {
		t.Fatalf("me.pips = %v; want 100", body["pips"])
	}
}

func TestPurchaseInsufficientFunds(t *testing.T) {
	e := newEnv(t)
	_, ck := e.guest(t, "broke")
	resp, body := e.req(t, "POST", "/api/cosmetics/robber.sentinel/purchase", ck, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", resp.StatusCode)
	}
	if body["code"] != "INSUFFICIENT_FUNDS" {
		t.Fatalf("code = %v; want INSUFFICIENT_FUNDS", body["code"])
	}
}

func TestPurchaseSupporterExclusiveRejected(t *testing.T) {
	e := newEnv(t)
	u, ck := e.guest(t, "fan")
	e.st.LedgerCredit(u.ID, 5000, "grant", "seed")
	resp, body := e.req(t, "POST", "/api/cosmetics/decoration.supporter/purchase", ck, nil)
	if resp.StatusCode != http.StatusForbidden || body["code"] != "SUPPORTER_EXCLUSIVE_ITEM" {
		t.Fatalf("supporter-exclusive purchase = %d %v; want 403 SUPPORTER_EXCLUSIVE_ITEM", resp.StatusCode, body["code"])
	}
}

func TestSupporterBoostingExposed(t *testing.T) {
	e := newEnv(t)
	u, ck := e.guest(t, "booster")
	if err := e.st.SetSupporter(u.ID, true, true, false, false, false, 0); err != nil {
		t.Fatal(err)
	}

	resp, body := e.req(t, "GET", "/api/me/supporter", ck, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET supporter = %d", resp.StatusCode)
	}
	if body["boosting"] != true {
		t.Fatalf("supporter.boosting = %v; want true", body["boosting"])
	}

	_, me := e.req(t, "GET", "/api/users/me", ck, nil)
	if me["supporter_boosting"] != true {
		t.Fatalf("me.supporter_boosting = %v; want true", me["supporter_boosting"])
	}
}

// Purchases are rate-limited like every other mutation. Buying is idempotent
// and authenticated, so the risk is DB load, not theft.
func TestPurchaseIsRateLimited(t *testing.T) {
	e := newEnv(t)
	u, ck := e.guest(t, "spendy")
	if _, err := e.st.LedgerCredit(u.ID, 10_000, "grant", "test:seed"); err != nil {
		t.Fatal(err)
	}

	// Past the burst, the endpoint sheds load rather than serving it.
	var last int
	for range 12 {
		resp, _ := e.req(t, "POST", "/api/cosmetics/robber.sentinel/purchase", ck, nil)
		last = resp.StatusCode
		if last == http.StatusTooManyRequests {
			break
		}
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("purchases never rate-limited; last status = %d, want 429", last)
	}
}
