#!/usr/bin/env bash
# Decrypt the Cloudflare origin TLS cert + key from origin-cert.enc.yaml into a
# tmpfs dir (/run/costan-certs) that nginx reads. Run as root by costan-certs.service
# (ordered Before nginx), so the private key is never plaintext on persistent disk.
#
# The encrypted file is not in the repository. It lives on the server, outside
# the checkout, at $ORIGIN_CERT_FILE (default /etc/costan/origin-cert.enc.yaml);
# see DEPLOY.md.
set -euo pipefail

DIR=/run/costan-certs           # /run is tmpfs -> RAM, cleared on reboot
ENC="${ORIGIN_CERT_FILE:-/etc/costan/origin-cert.enc.yaml}"
export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/etc/costan/age.key}"

command -v sops >/dev/null || { echo "sops not installed" >&2; exit 1; }
[ -f "$ENC" ] || { echo "missing $ENC (build it with deploy/cert-encrypt.sh and copy it there; see DEPLOY.md)" >&2; exit 1; }

umask 077
mkdir -p "$DIR"
sops -d --extract '["origin_pem"]' "$ENC" > "$DIR/origin.pem"; chmod 0644 "$DIR/origin.pem"
sops -d --extract '["origin_key"]' "$ENC" > "$DIR/origin.key"; chmod 0600 "$DIR/origin.key"

# On SELinux hosts (RHEL/Alma, enforcing by default) nginx runs as httpd_t and
# can't read a cert under /run without the cert_t label. Best-effort; a no-op
# where SELinux isn't present.
if command -v chcon >/dev/null 2>&1; then
  chcon -t cert_t "$DIR/origin.pem" "$DIR/origin.key" 2>/dev/null || true
fi
