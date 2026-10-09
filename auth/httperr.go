package auth

import (
	"encoding/json"
	"net/http"
)

// writeErr writes the same machine-readable error body the HTTP API surface
// uses: {"code":..., "debug":...} with Content-Type application/json.
//
// Duplicated from server (which imports auth, so sharing would be a cycle);
// keep the shape identical.
//
// `code` is the contract, a stable SCREAMING_SNAKE identifier the client
// branches and renders off. `debug` is for developers reading raw responses;
// clients render their own copy from `code`, never from this field.
func writeErr(w http.ResponseWriter, status int, code, debug string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "debug": debug})
}
