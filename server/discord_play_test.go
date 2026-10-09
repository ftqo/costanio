package server

import "testing"

func TestPlayCommandLaunchesActivity(t *testing.T) {
	e := newEnv(t)
	post := discordPoster(t, e)
	for _, name := range []string{"play", "costanio"} {
		resp := post(`{"type":2,"member":{"permissions":"0","user":{"id":"u"}},"data":{"name":"` + name + `"}}`)
		if resp["type"] != float64(responseLaunchActivity) {
			t.Fatalf("/%s → type %v; want LAUNCH_ACTIVITY (%d)", name, resp["type"], responseLaunchActivity)
		}
	}
}
