#!/usr/bin/env bash
# Dev runner: builds the backend, then serves the Go server + the frontend on
# fixed ports. Everything is ephemeral (temp db, deleted on exit) and server
# output goes to log files; stdout shows only the URLs.
#
#   ./dev.sh            Vite dev server (default)
#   ./dev.sh --built    serve a production-style build instead
#
# The dev server is the default because React DevTools can only profile it
# (a `vite build` bundle has no profiling instrumentation). Its hot-reload drops
# the live websocket on an edit, ending any game in progress. To play, or to
# check what ships, use `--built`: a `vite preview` of the bundle that ignores
# edits until you re-run.
set -euo pipefail
cd "$(dirname "$0")"

FE_MODE=dev
for arg in "$@"; do
  case "$arg" in
    --built | --preview) FE_MODE=preview ;;
    --dev) FE_MODE=dev ;; # the default
    -h | --help)
      # The leading comment block, minus the shebang, is the help text.
      awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# Fixed ports (override with FE_PORT / BE_PORT / PPROF_PORT in the environment).
FE_PORT="${FE_PORT:-6767}"
BE_PORT="${BE_PORT:-6769}"
PPROF_PORT="${PPROF_PORT:-6771}"

# port_busy $p: true when something is already listening on localhost:$p.
#
# Both stacks: `vite preview` binds only [::1], while Go's ":port" binds both.
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null ||
    (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
}

# If any port is taken, a dev runner is already up.
for p in "$FE_PORT" "$BE_PORT" "$PPROF_PORT"; do
  if port_busy "$p"; then
    echo "port $p already in use; dev is already running." >&2
    exit 1
  fi
done

DB="$(mktemp -u -t costan-dev.XXXXXX.db)"
WORK="$(mktemp -d -t costan-dev.XXXXXX)" # backend binary + logs, isolated per run
BIN="$WORK/costan-dev"
# Backend log lives at a stable repo-root path (gitignored) so it's easy to tail;
# truncated each run. The frontend log stays in the temp dir.
BE_LOG="backend.log"
FE_LOG="$WORK/frontend.log"

cleanup() {
  trap - EXIT INT TERM
  set +e # never let a failing kill/rm abort the rest of teardown
  [[ -n "${BE_PID:-}" ]] && { pkill -P "$BE_PID" 2>/dev/null; kill "$BE_PID" 2>/dev/null; }
  # vite preview spawns children; take the whole subtree down.
  [[ -n "${FE_PID:-}" ]] && { pkill -P "$FE_PID" 2>/dev/null; kill "$FE_PID" 2>/dev/null; }
  wait 2>/dev/null
  rm -rf "$WORK"
  rm -f "$DB" "$DB"-wal "$DB"-shm
  exit 0
}
trap cleanup EXIT INT TERM

# Build both up front so a compile error fails fast (before we claim any ports).
echo "building backend…" >&2
if ! go build -o "$BIN" ./cmd/costan >"$BE_LOG" 2>&1; then
  echo "backend build failed:" >&2
  cat "$BE_LOG" >&2
  exit 1
fi

# The dev server compiles on demand, so there is nothing to build up front.
if [[ "$FE_MODE" == preview ]]; then
  echo "building frontend…" >&2
  # NODE_ENV=development keeps import.meta.env.DEV true in the bundle, which
  # gates dev-only UI like the "Dev login (Tester)" button.
  if ! (cd frontend && NODE_ENV=development npm run build) >"$FE_LOG" 2>&1; then
    echo "frontend build failed:" >&2
    tail -n 40 "$FE_LOG" >&2
    exit 1
  fi
fi

# Backend: run the compiled binary with dev-auth, an ephemeral db, the chosen
# port, and pprof. Appends to the same log the build wrote to.
COSTAN_ADDR=":$BE_PORT" \
  COSTAN_DEV_AUTH=1 \
  COSTAN_DB="$DB" \
  COSTAN_BOT_DELAY="${COSTAN_BOT_DELAY:-1s}" \
  COSTAN_PPROF=":$PPROF_PORT" \
  "$BIN" >>"$BE_LOG" 2>&1 &
BE_PID=$!

# Frontend: `vite preview` over the built bundle, or the dev server under --dev.
# Either way vite proxies /api, /auth and /ws to the backend (one shared proxy
# config in vite.config.ts), so the browser talks to a single origin.
(
  cd frontend
  exec env BACKEND_ORIGIN="http://localhost:$BE_PORT" \
    npm run "$FE_MODE" -- --port "$FE_PORT" --strictPort >>"$FE_LOG" 2>&1
) &
FE_PID=$!

# Wait until each port accepts connections before printing the URLs.
wait_port() {
  local p="$1" n="$2" i
  for ((i = 0; i < n; i++)); do
    if port_busy "$p"; then return 0; fi
    if ! kill -0 "$BE_PID" 2>/dev/null || ! kill -0 "$FE_PID" 2>/dev/null; then return 1; fi
    sleep 0.25
  done
  return 1
}

if ! wait_port "$BE_PORT" 120; then
  echo "backend failed to start:" >&2
  tail -n 30 "$BE_LOG" >&2
  exit 1
fi
if ! wait_port "$FE_PORT" 120; then
  echo "frontend failed to start:" >&2
  tail -n 30 "$FE_LOG" >&2
  exit 1
fi

if [[ "$FE_MODE" == dev ]]; then
  echo "frontend: http://localhost:$FE_PORT  (dev server: profiling on, HMR drops live games)"
else
  echo "frontend: http://localhost:$FE_PORT  (built bundle, no hot-reload)"
fi
echo "backend:  http://localhost:$BE_PORT"
echo "pprof:    http://localhost:$PPROF_PORT/debug/pprof/"

# Block until a server exits; Ctrl-C is handled by the trap above.
wait -n "$BE_PID" "$FE_PID" || true
