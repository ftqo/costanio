#!/usr/bin/env bash
# Take a verified, self-contained backup of the SQLite database, gzip it, prune
# old ones by age, and optionally push it off-host. Run by costan-backup.timer
# every 6h; safe to run by hand at any time, including while games are live.
#
#   sudo systemctl start costan-backup.service     # one-off, the supported way
#
# VACUUM INTO rather than `sqlite3 .backup`: the online-backup API restarts
# whenever the source is written mid-copy and may never finish on a busy server.
# VACUUM INTO reads one consistent snapshot without blocking the writer and
# produces a single checkpointed file with no -wal/-shm, which cannot be
# restored wrong (see the restore drill in DEPLOY.md §10).
#
# Never as root: sqlite3 opens the source read-write, so a root run can leave
# root-owned -wal/-shm files the service then cannot write.
set -euo pipefail

DB="${COSTAN_DB:-/var/lib/costan/costan.db}"
DEST="${BACKUP_DIR:-/var/backups/costan}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
SERVICE_USER="${BACKUP_USER:-costan}"
# Optional off-host copy, e.g. BACKUP_RCLONE_REMOTE=<remote>:<bucket>. Configure
# the remote in the service user's rclone.conf; empty = local backups only.
RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

umask 077                       # backups are readable only by the service user

log() { printf '%s costan-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FAILED: $*" >&2; exit 1; }

# ── preconditions ───────────────────────────────────────────────────────────
if [ "$(id -u)" = 0 ]; then
  echo "Refusing to run as root: a root sqlite3 leaves root-owned -wal/-shm files" >&2
  echo "next to the database and the service (user: $SERVICE_USER) then cannot write." >&2
  echo "Use:  sudo systemctl start costan-backup.service" >&2
  echo "  or: sudo -u $SERVICE_USER $0" >&2
  exit 1
fi
command -v sqlite3 >/dev/null || die "sqlite3 not installed (dnf install -y sqlite)"
[ -f "$DB" ] || die "no database at $DB"
mkdir -p "$DEST" || die "cannot create $DEST (create it owned by $SERVICE_USER)"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$DEST/costan-$stamp.db"
part="$final.part"
# VACUUM INTO refuses to overwrite, and a leftover .part from a killed run would
# otherwise wedge every subsequent run.
rm -f "$part"

# ── the snapshot ────────────────────────────────────────────────────────────
log "snapshotting $DB -> $part"
sqlite3 "$DB" "VACUUM INTO '$part'" || die "VACUUM INTO failed"

# ── verification, on the copy, before anything trusts it ────────────────────
# integrity_check alone passes an empty, freshly created database, so the
# schema-version and row-count checks are what distinguish a real backup from a
# backup of a recreated one (see requireExistingDB in cmd/costan/main.go).
#
# The queries open the copy read-write: a read-only open of a WAL-mode file with
# no -shm fails (SQLITE_READONLY_CANTINIT). Sidecar files are removed and
# checked below.
size=$(stat -c %s "$part" 2>/dev/null || stat -f %z "$part")
[ "${size:-0}" -ge 4096 ] || die "backup is $size bytes, want at least 4096"

integrity=$(sqlite3 "$part" "PRAGMA integrity_check" 2>&1 | head -5)
[ "$integrity" = "ok" ] || die "integrity_check on the copy: $integrity"

schema=$(sqlite3 "$part" "SELECT COALESCE(MAX(version), 0) FROM schema_version" 2>/dev/null) \
  || die "no schema_version table in the copy: this is not a costan database"
[ "${schema:-0}" -ge 1 ] || die "schema_version is $schema: the database was never migrated"

games=$(sqlite3 "$part" "SELECT COUNT(*) FROM games" 2>/dev/null) \
  || die "no games table in the copy at schema version $schema"
users=$(sqlite3 "$part" "SELECT COUNT(*) FROM users" 2>/dev/null) \
  || die "no users table in the copy at schema version $schema"

# High-water mark. Nothing deletes games or users, so a lower count means a
# different database (a botched restore, a wrong COSTAN_DB). Refuse, or the
# age-based prune would expire every good copy. BACKUP_ALLOW_SHRINK=1 overrides
# for an intended reset.
mark="$DEST/.high-water"
if [ -f "$mark" ]; then
  # shellcheck disable=SC1090
  . "$mark"
  if [ "${BACKUP_ALLOW_SHRINK:-}" != "1" ] &&
     { [ "$games" -lt "${HW_GAMES:-0}" ] || [ "$users" -lt "${HW_USERS:-0}" ]; }; then
    rm -f "$part"
    die "row counts went backwards (games ${HW_GAMES:-0}->$games, users ${HW_USERS:-0}->$users):" \
        "this looks like a DIFFERENT database, not a backup of ours." \
        "If the reset was intended, run once with BACKUP_ALLOW_SHRINK=1."
  fi
fi
printf 'HW_GAMES=%s\nHW_USERS=%s\n' "$games" "$users" > "$mark"

# ── publish ─────────────────────────────────────────────────────────────────
# The backup must not ship with a -wal beside it; assert it.
rm -f "$part-wal" "$part-shm"
[ ! -e "$part-wal" ] && [ ! -e "$part-shm" ] || die "sidecar files survive next to $part"

mv -f "$part" "$final"
gzip -9 "$final"            # removes $final, leaves $final.gz
gzip -t "$final.gz" || die "gzip verification failed for $final.gz"
chmod 0400 "$final.gz"
log "ok: $final.gz ($(stat -c %s "$final.gz" 2>/dev/null || stat -f %z "$final.gz") bytes," \
    "schema $schema, $games games, $users users)"

# ── off-host copy (optional) ────────────────────────────────────────────────
# A local backup survives a bad deploy and a fat-fingered DELETE. It does not
# survive losing the instance itself (provider deletion, disk failure).
if [ -n "$RCLONE_REMOTE" ]; then
  command -v rclone >/dev/null || die "BACKUP_RCLONE_REMOTE set but rclone is not installed"
  log "pushing to $RCLONE_REMOTE"
  rclone copy --no-traverse "$final.gz" "$RCLONE_REMOTE" || die "rclone copy failed"
  # Prune the remote by age too, with the same window.
  rclone delete --min-age "${KEEP_DAYS}d" "$RCLONE_REMOTE" || log "WARN: remote prune failed"
fi

# ── prune, BY AGE ───────────────────────────────────────────────────────────
# By age, not count: if the timer starts failing, the newest good copy survives
# until it is $KEEP_DAYS old.
before=$(find "$DEST" -maxdepth 1 -name 'costan-*.db.gz' | wc -l)
find "$DEST" -maxdepth 1 -name 'costan-*.db.gz' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -name 'costan-*.db.part' -mtime +1 -delete   # killed runs
after=$(find "$DEST" -maxdepth 1 -name 'costan-*.db.gz' | wc -l)
log "kept $after backup(s), pruned $((before - after)) older than ${KEEP_DAYS}d"
