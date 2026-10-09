#!/usr/bin/env bash
# Post "<unit> failed" plus its last journal lines to the Discord mod channel.
# Invoked as root by costan-alert@.service, which is wired as OnFailure= on
# costan.service and costan-backup.service.
#
#   alert.sh costan-backup.service
#
# It reuses the bot token from /etc/costan/secrets.enc.yaml and the channel set on the
# Discord /config panel (mod_config.report_channel in the database).
# COSTAN_ALERT_CHANNEL_ID overrides the channel, which also covers the case where
# the database itself is broken.
#
# Best-effort: it always exits 0, since a failing OnFailure= handler helps nobody.
set -uo pipefail

UNIT="${1:-unknown.service}"
REPO="${REPO:-/opt/costan}"
# Overridable because the NixOS module (nix/module.nix) has no checkout.
SECRETS_FILE="${COSTAN_SECRETS_FILE:-/etc/costan/secrets.enc.yaml}"
DB="${COSTAN_DB:-/var/lib/costan/costan.db}"
export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/etc/costan/age.key}"

warn() { echo "costan-alert: $*" >&2; }

token="${DISCORD_BOT_TOKEN:-}"
if [ -z "$token" ] && command -v sops >/dev/null && [ -f "$SECRETS_FILE" ]; then
  token=$(sops -d --extract '["discord_bot_token"]' "$SECRETS_FILE" 2>/dev/null)
fi
[ -n "$token" ] || { warn "no discord_bot_token; $UNIT failed, alert not sent"; exit 0; }

channel="${COSTAN_ALERT_CHANNEL_ID:-}"
if [ -z "$channel" ] && command -v sqlite3 >/dev/null && [ -f "$DB" ]; then
  channel=$(sqlite3 -readonly "$DB" "SELECT v FROM mod_config WHERE k='report_channel'" 2>/dev/null)
fi
[ -n "$channel" ] || { warn "no alert channel (set COSTAN_ALERT_CHANNEL_ID in /etc/costan/backup.env or /config -> Channels)"; exit 0; }

host=$(hostname)
result=$(systemctl show -p Result --value "$UNIT" 2>/dev/null)
logs=$(journalctl -u "$UNIT" -n 20 --no-pager -o cat 2>/dev/null | tail -c 1400)

# Discord caps a message at 2000 characters; build the JSON in python so the
# truncation is safe.
payload=$(UNIT="$UNIT" HOST="$host" RESULT="${result:-unknown}" LOGS="$logs" python3 - <<'PY' 2>/dev/null
import json, os
body = ("**:rotating_light: `%s` failed on `%s`** (result: %s)\n```\n%s\n```"
        % (os.environ["UNIT"], os.environ["HOST"], os.environ["RESULT"],
           os.environ["LOGS"] or "(no log lines)"))
print(json.dumps({"content": body[:1990], "allowed_mentions": {"parse": []}}))
PY
)
[ -n "$payload" ] || payload=$(printf '{"content":"%s failed on %s"}' "$UNIT" "$host")

curl -fsS -m 15 -X POST \
  -H "Authorization: Bot $token" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  "https://discord.com/api/v10/channels/$channel/messages" >/dev/null \
  || warn "posting the alert for $UNIT failed"
exit 0
