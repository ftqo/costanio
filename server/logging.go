package server

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// logRequests emits one structured line per HTTP request (method, path, status,
// duration). 5xx logs at error, 4xx at warn, everything else at info.
//
// WebSocket upgrades are hijacked, so the recorder forwards Hijack to the
// underlying ResponseWriter. For those the line is emitted when the socket
// closes, and the duration is the whole session.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// nosniff on every response: endpoints that echo player-supplied bytes
		// (chat, names, map blobs) would otherwise risk a sniffed text/html
		// turning a JSON body into a same-origin script. Set before the handler
		// runs so it applies even if the handler writes its status immediately.
		w.Header().Set("X-Content-Type-Options", "nosniff")
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		level := slog.LevelInfo
		switch {
		case rec.status >= 500:
			level = slog.LevelError
		case rec.status >= 400:
			level = slog.LevelWarn
		}
		slog.LogAttrs(r.Context(), level, "http",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Duration("dur", time.Since(start)),
		)
	})
}

// statusRecorder captures the response status for the access log while leaving
// the write path otherwise untouched.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	r.wrote = true // an implicit 200 if WriteHeader was never called
	return r.ResponseWriter.Write(b)
}

// Hijack passes through to the underlying ResponseWriter so the WebSocket
// upgrade can take over the connection.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hj.Hijack()
}
