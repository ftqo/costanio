package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestMintGuestReturnsSessionToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/auth/guest" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		http.SetCookie(w, &http.Cookie{Name: "costan_session", Value: "tok-123", Path: "/"})
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":1,"name":"","guest":true}`))
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := c.MintGuest()
	if err != nil {
		t.Fatal(err)
	}
	if tok != "tok-123" {
		t.Fatalf("token = %q; want tok-123", tok)
	}
}

func TestMintDevReturnsSessionTokenFrom302(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/dev" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		http.SetCookie(w, &http.Cookie{Name: "costan_session", Value: "dev-tok", Path: "/"})
		w.Header().Set("Location", "/")
		w.WriteHeader(http.StatusFound) // dev endpoint redirects with the cookie set
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	tok, err := c.MintDev()
	if err != nil {
		t.Fatal(err)
	}
	if tok != "dev-tok" {
		t.Fatalf("token = %q; want dev-tok", tok)
	}
}

func TestMintDevReports404WhenDisabled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL)
	if _, err := c.MintDev(); err == nil {
		t.Fatal("expected error when dev-auth disabled (404)")
	}
}

func TestTargetsRoundTrip(t *testing.T) {
	want := Targets{
		Games:  []GameTarget{{ID: "g1", Invite: "inv1"}, {ID: "g2", Invite: "inv2"}},
		Tokens: []string{"t1"},
	}
	path := filepath.Join(t.TempDir(), "targets.json")
	if err := want.Save(path); err != nil {
		t.Fatal(err)
	}
	got, err := LoadTargets(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round-trip = %+v; want %+v", got, want)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file not written: %v", err)
	}
}
