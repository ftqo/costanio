#!/usr/bin/env bash
# Build the SOPS-encrypted origin-cert.enc.yaml from your Cloudflare Origin CA cert
# + key, so the TLS private key is never plaintext at rest on the server. Run on a
# machine with the age recipient set up in .sops.yaml.
#
#   deploy/cert-encrypt.sh path/to/origin.pem path/to/origin.key
#   scp origin-cert.enc.yaml <admin user>@<server>:/tmp/
#   # on the server:
#   sudo install -m 600 -o root -g root /tmp/origin-cert.enc.yaml /etc/costan/origin-cert.enc.yaml
#
# The output is written to the repo root, where .gitignore keeps it out of git:
# the encrypted files belong to your deployment, not to the repository.
set -euo pipefail

PEM="${1:?usage: cert-encrypt.sh <origin.pem> <origin.key>}"
KEY="${2:?usage: cert-encrypt.sh <origin.pem> <origin.key>}"
REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="$REPO/origin-cert.yaml"   # gitignored plaintext working file
trap 'shred -u "$WORK" 2>/dev/null || rm -f "$WORK"' EXIT

command -v sops >/dev/null || { echo "sops not installed" >&2; exit 1; }
# Emit the two PEMs as YAML block scalars (each line indented two spaces).
{
  echo "origin_pem: |"; sed 's/^/  /' "$PEM"
  echo "origin_key: |"; sed 's/^/  /' "$KEY"
} > "$WORK"
sops -e "$WORK" > "$REPO/origin-cert.enc.yaml"
echo "wrote $REPO/origin-cert.enc.yaml (encrypted); copy it to /etc/costan/ on the server"
