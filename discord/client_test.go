package discord

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGuildMemberRoles(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bot tok" {
			t.Errorf("auth header = %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path != "/guilds/g1/members/u1" {
			t.Errorf("path = %q", r.URL.Path)
		}
		w.Write([]byte(`{"roles":["r1","r2"],"user":{"id":"u1"}}`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", GuildID: "g1", BaseURL: ts.URL}
	roles, err := c.GuildMemberRoles(context.Background(), "u1")
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) != 2 || roles[0] != "r1" || roles[1] != "r2" {
		t.Fatalf("roles = %v", roles)
	}
}

func TestGuildMemberRolesNotMember(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"message":"Unknown Member","code":10007}`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", GuildID: "g1", BaseURL: ts.URL}
	_, err := c.GuildMemberRoles(context.Background(), "u1")
	if !errors.Is(err, ErrNotMember) {
		t.Fatalf("err = %v; want ErrNotMember", err)
	}
}

func TestGuildMemberRolesServerError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	c := Client{Token: "tok", GuildID: "g1", BaseURL: ts.URL}
	if _, err := c.GuildMemberRoles(context.Background(), "u1"); err == nil || errors.Is(err, ErrNotMember) {
		t.Fatalf("err = %v; want a non-ErrNotMember error", err)
	}
}
