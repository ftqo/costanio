#!/usr/bin/env bash
# Pull the latest main, rebuild the backend binary, and restart the service.
# nginx is a separate unit and stays up; clients reconnect and resync over the
# ~1s restart (game state is durable per command). The unit's ExecStartPre
# re-decrypts secrets, so a changed /etc/costan/secrets.enc.yaml is picked up.
#
# Run as the repo owner, not with sudo: git refuses a user-owned tree as root,
# and nix isn't on root's sudo PATH. The script sudos only the install and
# restart steps, so the owner needs passwordless sudo.
#
#   /opt/costan/deploy/update.sh
set -euo pipefail

REPO="${REPO:-/opt/costan}"
BIN="${BIN:-/usr/local/bin/costan}"
# Content-addressed install root: one file per git sha, and $BIN is a symlink
# into it. See "installing" below.
LIBDIR="${LIBDIR:-/usr/local/lib/costan}"
# Where the symlinks live; the operator tools go beside $BIN so they are on PATH.
BINDIR="$(dirname "$BIN")"
KEEP_BUILDS="${KEEP_BUILDS:-10}"
# Probe an endpoint that reads the database. /healthz never touches the store,
# so it stays 200 even when every query fails.
PROBE="${PROBE:-http://127.0.0.1:4757/api/games}"
# The listener opens only after store.Open has run every pending migration,
# which can take minutes. A long migration must not read as a failed deploy.
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
# Every deploy adds a Go toolchain and a closure to /nix/store, which shares a
# filesystem with /var/lib, so a full store stops database writes. 0 disables.
NIX_GC_KEEP_DAYS="${NIX_GC_KEEP_DAYS:-14}"

if [ "$(id -u)" = 0 ]; then
  echo "Run as the repo owner (your admin user), not root/sudo; it uses sudo for the privileged" >&2
  echo "steps itself; git + nix build must run as the owner." >&2
  exit 1
fi

# Non-login shells don't source the nix profile, so ensure nix is on PATH.
command -v nix >/dev/null 2>&1 || export PATH="/nix/var/nix/profiles/default/bin:$PATH"
command -v nix >/dev/null 2>&1 || { echo "nix not found on PATH" >&2; exit 1; }

cd "$REPO"

echo "==> Pulling latest main"
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
[ "$before" = "$after" ] && echo "    Already at ${after:0:12}, rebuilding anyway." || echo "    ${before:0:12} -> ${after:0:12}"

echo "==> Building binary (nix)"
# The build shares RAM with the running server, and the OOM killer would pick
# the server. A transient user scope with MemoryMax makes the build die instead.
# Where a user scope is unavailable (no session, cgroup v1, no delegation) the
# build runs unbounded.
NIX_MEMORY_MAX="${NIX_MEMORY_MAX:-3G}"
bound=()
if [ "$NIX_MEMORY_MAX" != "0" ] && command -v systemd-run >/dev/null 2>&1 &&
   systemd-run --user --scope --quiet -p MemoryMax=64M -p MemorySwapMax=0 -- true >/dev/null 2>&1; then
  # MemorySwapMax=0: swapping beside a live sqlite writer is as bad as an OOM.
  bound=(systemd-run --user --scope --quiet
         -p "MemoryMax=$NIX_MEMORY_MAX" -p MemorySwapMax=0 --)
  echo "    (MemoryMax=$NIX_MEMORY_MAX)"
else
  echo "    (no memory bound: systemd-run --user --scope unavailable)"
fi
# ${bound[@]+...} because an empty array is unbound under `set -u` on older bash.
if ! out=$(${bound[@]+"${bound[@]}"} nix build --no-link --print-out-paths '.#costan'); then
  echo "    !! build failed. If it was OOM-killed, raise NIX_MEMORY_MAX (now $NIX_MEMORY_MAX)" >&2
  echo "       or set NIX_MEMORY_MAX=0 to build unbounded." >&2
  exit 1
fi

# ── installing: content-addressed, symlink-switched ─────────────────────────
# Every build lands at $LIBDIR/costan-<sha> and $BIN is a symlink. Rollback is
# re-pointing the symlink at any sha still on disk ($KEEP_BUILDS deep).
sha=$(git rev-parse --short=12 HEAD)
git diff --quiet HEAD 2>/dev/null || sha="$sha-dirty"   # a dirty tree is not its sha
target="$LIBDIR/costan-$sha"

echo "==> Installing $target + switching the symlink (sudo)"
sudo install -d -m 755 "$LIBDIR"
sudo install -m 755 "$out/bin/costan" "$target"
# ln -sfn is unlink-then-symlink, so switch via a rename: mv -T over the symlink
# is atomic (and also replaces a plain file at $BIN).
sudo ln -sfn "$target" "$BIN.new"
sudo mv -Tf "$BIN.new" "$BIN"

# The operator tools, installed the same way as the server so a rollback moves
# them too (a recover tool must match the engine that wrote the log).
for tool in costan-recover costan-backfill; do
  sudo install -m 755 "$out/bin/$tool" "$LIBDIR/$tool-$sha"
  sudo ln -sfn "$LIBDIR/$tool-$sha" "$BINDIR/$tool.new"
  sudo mv -Tf "$BINDIR/$tool.new" "$BINDIR/$tool"
done

# Prune, keeping the newest $KEEP_BUILDS and always the one just installed
# (by count, since these are rollback targets).
#
# Per name, since $LIBDIR holds three files per build. The 12-hex sha suffix
# (plus optional `-dirty`) keeps `costan-<sha>` from matching
# `costan-recover-<sha>`.
for name in costan costan-recover costan-backfill; do
  # shellcheck disable=SC2012 # our own filenames; no whitespace to mishandle
  { ls -1t "$LIBDIR" 2>/dev/null || true; } |
    grep -E "^$name-[0-9a-f]{12}(-dirty)?\$" |
    tail -n "+$((KEEP_BUILDS + 1))" | while read -r stale; do
    [ "$stale" = "$name-$sha" ] && continue
    sudo rm -f -- "$LIBDIR/$stale"
  done
done

sudo systemctl restart costan

# ── health gate ─────────────────────────────────────────────────────────────
# store.Open runs migrations before the listener opens, so a new schema can
# spend minutes not listening. Retry to a deadline, and separate "not listening
# yet" (keep waiting) from "listening and answering wrong" (fail now).
echo "==> Health check ($PROBE, up to ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
announced=0
healthy=0
while :; do
  if ! systemctl is-active --quiet costan; then
    echo "    !! unit is not active (exited)" >&2
    break
  fi
  code=$(curl -sS -o /dev/null -m 5 -w '%{http_code}' "$PROBE" 2>/dev/null) && rc=0 || rc=$?
  if [ "$rc" = 0 ] && [ "$code" = 200 ]; then
    echo "    OK: active, listening, serving"
    healthy=1
    break
  fi
  if [ "$rc" != 0 ]; then
    # curl 7 = connection refused: up but not listening yet (a long migration).
    if [ "$announced" = 0 ] && [ "$rc" = 7 ]; then
      echo "    not listening yet (migrations may be running), waiting..."
      announced=1
    fi
  else
    echo "    !! probe returned HTTP $code" >&2
    break
  fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo "    !! still not healthy after ${HEALTH_TIMEOUT}s" >&2; break; }
  sleep 2
done

if [ "$healthy" = 0 ]; then
  echo "    recent logs:" >&2
  sudo journalctl -u costan -n 40 --no-pager >&2
  echo "" >&2
  echo "    rollback (any build still on disk, newest first):" >&2
  # shellcheck disable=SC2012 # names here are ours and contain no whitespace
  { ls -1t "$LIBDIR" 2>/dev/null || true; } | head -5 | sed "s|^|      sudo ln -sfn $LIBDIR/|; s|\$| $BIN.new \&\& sudo mv -Tf $BIN.new $BIN \&\& sudo systemctl restart costan|" >&2
  exit 1
fi

# ── /nix/store housekeeping ─────────────────────────────────────────────────
# After the health gate, never before. The binary was copied out of the store
# into $LIBDIR, so no store path is still needed. Best-effort: a failed GC
# does not fail the deploy.
if [ "$NIX_GC_KEEP_DAYS" != "0" ]; then
  echo "==> Collecting /nix/store garbage older than ${NIX_GC_KEEP_DAYS}d"
  # nix is not on root's sudo PATH, so hand sudo the absolute path.
  gc=$(command -v nix-collect-garbage || echo /nix/var/nix/profiles/default/bin/nix-collect-garbage)
  if sudo "$gc" --delete-older-than "${NIX_GC_KEEP_DAYS}d" >/dev/null 2>&1; then
    df -h /nix/store /var/lib | sed 's/^/    /'
  else
    echo "    (skipped: run \`sudo $gc --delete-older-than ${NIX_GC_KEEP_DAYS}d\` by hand)"
  fi
fi
