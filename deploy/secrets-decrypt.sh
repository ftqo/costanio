#!/usr/bin/env bash
# SOPS-decrypt the three secrets from secrets.enc.yaml into a directory, one file
# per secret, owned by the service user and readable only by it. Invoked by the
# systemd unit's ExecStartPre (as root) on every (re)start; the target dir is the
# unit's tmpfs RuntimeDirectory (/run/costan), so plaintext lives only in RAM.
#
# The encrypted file is not in the repository. It lives on the server, outside
# the checkout, at $SECRETS_FILE (default /etc/costan/secrets.enc.yaml); see
# DEPLOY.md for how to create it and put it there.
#
# Usage: secrets-decrypt.sh [TARGET_DIR]   (default /run/costan)
set -euo pipefail

DIR="${1:-/run/costan}"
SECRETS_FILE="${SECRETS_FILE:-/etc/costan/secrets.enc.yaml}"
OWNER="${SECRETS_OWNER:-costan:costan}"
export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/etc/costan/age.key}"
NAMES=(discord_client_secret google_client_secret discord_bot_token)

command -v sops >/dev/null || { echo "sops not installed" >&2; exit 1; }
[ -f "$SECRETS_FILE" ] || { echo "missing $SECRETS_FILE (see DEPLOY.md: secrets)" >&2; exit 1; }

umask 077
mkdir -p "$DIR"
for name in "${NAMES[@]}"; do
  f="$DIR/$name"
  # --extract pulls a single value; an empty value yields an empty file, which the
  # app treats as "feature disabled".
  sops -d --extract "[\"$name\"]" "$SECRETS_FILE" > "$f"
  chown "$OWNER" "$f"
  chmod 0400 "$f"
done
