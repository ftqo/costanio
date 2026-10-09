package discord

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestBaseDefaultsToAPIBase(t *testing.T) {
	// No BaseURL set -> the live API base is used.
	if got := (Client{}).base(); got != apiBase {
		t.Fatalf("base() = %q; want %q", got, apiBase)
	}
	// A trailing slash on an override is trimmed.
	if got := (Client{BaseURL: "https://example.test/"}).base(); got != "https://example.test" {
		t.Fatalf("base() = %q; want trailing slash trimmed", got)
	}
}

func TestHTTPCDefaultsToSharedClient(t *testing.T) {
	if got := (Client{}).httpc(); got != defaultClient {
		t.Fatalf("httpc() = %p; want the package default client %p", got, defaultClient)
	}
	custom := &http.Client{Timeout: time.Second}
	if got := (Client{HTTP: custom}).httpc(); got != custom {
		t.Fatalf("httpc() = %p; want the injected client %p", got, custom)
	}
}

func TestGuildMemberRolesDecodeError(t *testing.T) {
	// HTTP 200 but a malformed body triggers the decode-error branch.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{not valid json`))
	}))
	defer ts.Close()

	c := Client{Token: "tok", GuildID: "g1", BaseURL: ts.URL}
	_, err := c.GuildMemberRoles(context.Background(), "u1")
	if err == nil || !strings.Contains(err.Error(), "decode member") {
		t.Fatalf("err = %v; want a decode-member error", err)
	}
}

func TestGuildMemberRolesRequestError(t *testing.T) {
	// A control character in the user ID makes http.NewRequestWithContext fail,
	// covering the request-construction error path.
	c := Client{Token: "tok", GuildID: "g1", BaseURL: "http://127.0.0.1:0"}
	if _, err := c.GuildMemberRoles(context.Background(), "bad\x7fid"); err == nil {
		t.Fatal("want an error for an unparseable request URL")
	}
}
