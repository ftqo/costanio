package discord

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestActivityInstanceUsers(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bot tok" {
			t.Errorf("auth header = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/applications/app1/activity-instances/i-1":
			w.Write([]byte(`{"application_id":"app1","instance_id":"i-1","launch_id":"9","location":{"id":"gc-1","kind":"gc","channel_id":"c"},"users":["u1","u2"]}`))
		case "/applications/app1/activity-instances/i-500":
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte(`{"message":"Unknown Activity Instance"}`))
		}
	}))
	defer ts.Close()
	c := Client{Token: "tok", BaseURL: ts.URL}

	users, err := c.ActivityInstanceUsers(context.Background(), "app1", "i-1")
	if err != nil || len(users) != 2 || users[0] != "u1" || users[1] != "u2" {
		t.Fatalf("users = %v, err = %v", users, err)
	}
	if _, err := c.ActivityInstanceUsers(context.Background(), "app1", "nope"); !errors.Is(err, ErrNoInstance) {
		t.Fatalf("unknown instance: err = %v; want ErrNoInstance", err)
	}
	if _, err := c.ActivityInstanceUsers(context.Background(), "app1", "i-500"); err == nil || errors.Is(err, ErrNoInstance) {
		t.Fatalf("server error: err = %v; want a non-ErrNoInstance error", err)
	}
}
