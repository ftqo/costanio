# Deploying costan

A self-hosting guide. Replace the placeholders with your own values throughout:
`example.com` is your public site, `api.example.com` the backend origin host,
`<admin user>` the login user on your server, and `<remote>:<bucket>` an rclone
backup destination.

The backend is a single static Go binary run by systemd; nginx (also systemd)
terminates TLS and reverse-proxies to it; the static frontend is on Cloudflare
Pages. Everything is served under one origin (`example.com`). No Docker.

```
browser ──TLS──▶ Cloudflare ──TLS──▶ nginx (systemd) ──▶ 127.0.0.1:4757 costan (systemd) ──▶ sqlite (/var/lib/costan)
                  │  Pages: static frontend (browser sees only example.com)
                  └─ Pages Function: /api /auth /ws /discord → api.example.com (origin, server-side)
```

Naming: the host-side service/user/paths are **`costan`** (after the binary);
the public site is **`example.com`** and the origin host is **`api.example.com`**.

---

## 0. Accounts & infrastructure you need

| Thing | Why | Notes |
|---|---|---|
| A Linux server (VPS), systemd | Runs `costan` + nginx | Public IP; **outbound HTTPS (443)** to `discord.com` and `googleapis.com`. **`nix`** (provides the build + `sops`); **`git`** + **`nginx`** from the distro (`dnf`/`apt`). No Go install needed; `nix build` builds it. |
| Inbound 80/443, twice | Reach nginx at all | Both the **host firewall** (`firewalld` on RHEL-family) **and** the cloud provider's own network ACL (security list / security group / firewall rules), and **restricted to Cloudflare's IP ranges** (§7). Opening only one fails silently; see §7. |
| Cloudflare account + a zone for your domain | TLS, DNS, Pages (static), same-origin proxy | |
| Discord application | Discord login (+ optional Activity / supporter / slash commands) | One app; **Application ID = OAuth Client ID** |
| Google Cloud project | Google login | OAuth consent screen + credentials |

You need **at least one** of Discord/Google login configured; both is fine. We use
`nix build .#costan` for the binary (no Go-version chase) and `sops` from nix; only
git and nginx come from the distro. **SELinux** (RHEL-family, enforcing by default)
needs two tweaks; see §7.

**Distro.** Anything with systemd works. The commands below are written for the
**RHEL family** (RHEL, AlmaLinux, Rocky and similar), which share `dnf`, `firewalld`
and enforcing SELinux. On Debian/Ubuntu swap `dnf install` for `apt install`,
`firewall-cmd` for `ufw`, and skip the SELinux steps.

**nginx version.** EL9 ships nginx 1.20, EL10 ships 1.26. On 1.25+ `nginx -t` warns
that `listen ... http2` is deprecated in favour of a separate `http2 on;` directive.
The warning is harmless; `deploy/nginx-costan.conf` keeps the old form because
`http2 on;` does not parse on 1.20 (EL9).

---

## 1. Same-origin

The frontend is built same-origin: relative `/api` fetches, a `location.host`
websocket, and host-only `SameSite=Lax` cookies. The backend sets **no CORS**. So in
the browser everything must be `example.com`: Cloudflare serves Pages **and** routes
`/api`, `/auth`, `/ws`, `/discord` to the backend, all under `example.com`. This repo
ships that proxy (`frontend/functions/_middleware.js` + `public/_routes.json`).

The backend's own hostname (`api.example.com`) is reached only server-side: the
Pages Function `fetch()`es it and the browser never connects to it. The frontend
must never point at it (a second browser-facing origin breaks login: no CORS,
dropped cookies). `COSTAN_BASE_URL` must equal the public origin exactly (apex
`example.com`, no www); it builds the OAuth redirect URIs and gates the websocket
Origin check.

---

## 2. Cloudflare setup

1. **Origin cert**: SSL/TLS → Origin Server → Create Certificate **covering
   `api.example.com`** (or `*.example.com`). Encrypt it with
   `deploy/cert-encrypt.sh origin.pem origin.key` and install the result on the
   server as `/etc/costan/origin-cert.enc.yaml` (§6). `costan-certs.service`
   decrypts it into tmpfs for nginx at boot, so the key is never plaintext on disk.
2. **SSL/TLS mode** → **Full (Strict)**.
3. **DNS** → add `api.example.com` → the server's IP (recommended **proxied/orange**).
   On a rebuild this is easy to forget: the record still points at the old host and
   Cloudflare answers 521/522. A proxied record only shows Cloudflare's IPs in `dig`,
   so check `sudo tail /var/log/nginx/access.log` on the new host for hits from
   Cloudflare edge ranges (`172.70.x`, `104.23.x`, …). See §9.
4. **Authenticated Origin Pulls** → SSL/TLS → Origin Server → turn on the
   **global** "Authenticated Origin Pulls" toggle (it uses Cloudflare's own
   certificate). The *zone-level* variant only works once you upload your own client
   certificate for the zone; enabled without one, Cloudflare sends no certificate at
   all and the origin rejects every request. With the global toggle on, Cloudflare
   presents a client certificate on every connection to your origin, and
   `deploy/nginx-costan.conf` (`ssl_verify_client on`) refuses any connection without
   one. Install Cloudflare's origin-pull CA certificate (public; download the
   zone-level `authenticated_origin_pull_ca.pem` from Cloudflare's "Authenticated
   Origin Pulls" documentation) on the server:
   ```sh
   sudo install -D -m 644 authenticated_origin_pull_ca.pem /etc/nginx/certs/cloudflare-origin-pull-ca.pem
   ```
   **Enable it in the dashboard before reloading nginx with this config**, or nginx
   will reject Cloudflare too. Confirm Cloudflare is actually sending the certificate
   before you enforce it: install the config with `ssl_verify_client optional;` and a
   probe log first,
   ```nginx
   # http context (top of the file):
   log_format aop '$time_iso8601 $remote_addr verify=$ssl_client_verify "$request"';
   # in the 443 server block, instead of `ssl_verify_client on;`:
   ssl_verify_client optional;
   access_log /var/log/nginx/aop-probe.log aop;
   ```
   then request `https://api.example.com/api/games` and `https://example.com/api/games`
   and check `sudo tail /var/log/nginx/aop-probe.log`. Every line must read
   `verify=SUCCESS`; `verify=NONE` means Cloudflare is not sending a certificate yet.
   Only then switch to `ssl_verify_client on;`, drop the probe lines, `nginx -t` and
   reload, and confirm both URLs still return 200. A direct request to the origin
   without the certificate should now get 400:
   `curl -sk -o /dev/null -w '%{http_code}' --resolve api.example.com:443:127.0.0.1 https://api.example.com/api/games`. Together with the firewall in §7 this makes the
   `CF-Connecting-IP` header (the backend's rate-limit and moderation key) trustworthy:
   nginx only honours that header from Cloudflare's ranges (`set_real_ip_from`), and
   overwrites it before proxying, so a client cannot forge it.
5. **Pages project**: connect the repo: production branch `main`, root directory
   `frontend`, build command `npm run build` (`tsc -b && vite build`), output
   directory `dist`, custom domain `example.com`. Every push to `main` then deploys
   the frontend. The models, card art and sounds are Git LFS files; after the first
   build check that a model came through as a real file rather than an LFS pointer:
   `curl -s https://example.com/models/barbarians.glb | file -` must say `glTF binary
   model`, not `ASCII text`. Env vars:
   - `ORIGIN_BASE = https://api.example.com`: **required** (the Function 500s without
     it). This is a **runtime** Function var: set it in `frontend/wrangler.toml`
     `[vars]` (Pages reads it, and while that file exists it overrides the dashboard)
     or delete `wrangler.toml` and set it in the Pages dashboard.
   - `VITE_DISCORD_CLIENT_ID`: needed only for the Discord Activity (§3.B). This is a
     **build-time** Vite var (inlined by `vite build`), so it cannot go in
     `wrangler.toml` `[vars]`, which are runtime-only. Put
     it in `frontend/.env.production` (the app id is public and ships in the client
     bundle anyway) or set it as a Pages *build* environment variable, which takes
     precedence over the file.
   - **If you fork this repo:** `frontend/wrangler.toml` (`name`, `ORIGIN_BASE`) and
     `frontend/.env.production` (`VITE_DISCORD_CLIENT_ID`) carry the upstream
     deployment's own public values. Replace them with yours.
   - Ensure no Cache Rule caches `/api` or `/ws`.
6. **On first deploy**, confirm the `/ws` upgrade succeeds through the proxy
   (DevTools → Network → WS).

---

## 3. Discord application

In the Discord Developer Portal. **A is required for Discord login; B/C/D are optional.**

### A. Discord login (required for Discord auth)
- Create an Application; note its **Application ID** (= OAuth Client ID).
- OAuth2 → generate a **Client Secret**.
- OAuth2 → Redirects → add **`https://example.com/auth/discord/callback`** (also serves
  the account-link flow; no extra URI needed).
- `DISCORD_CLIENT_ID` → `/etc/costan/costan.env` (§5); the secret → `secrets.enc.yaml` (§6).
- Login requests only the `identify` scope, so nothing needs approval. (The friends
  list, which needs the restricted `relationships.read` scope, is off by default;
  re-enable by adding it to `Config.Scopes` in `auth/discord.go` once approved.)

### B. Activity / Discord embed (optional)
- Enable Activities; add a URL Mapping (proxy root → `https://example.com`).
- `COSTAN_DISCORD_APP_ID` (= Application ID) → `/etc/costan/costan.env` (backend var).
  `VITE_DISCORD_CLIENT_ID` (same value) for the frontend build, via
  `frontend/.env.production` or a Pages build variable (§2).
- **Rich Presence:** the Activity sets a profile presence card via the Embedded App
  SDK (`frontend/src/lib/richPresence.ts`). It requires the **`rpc.activities.write`**
  OAuth scope (already requested in the Activity authorize call; no portal toggle),
  and an **Art Asset** named **`logo`** uploaded under the application's Rich Presence →
  Art Assets. Without that asset the card still shows but with no image.

### C. Supporter sync (optional)
- Bot → Add Bot → **Bot Token** → `secrets.enc.yaml` (`discord_bot_token`, §6). **No
  privileged intents** (pull-based REST).
- Install the bot to your guild with scopes **`bot` + `applications.commands`**.
- `DISCORD_GUILD_ID` → `/etc/costan/costan.env`.
- *(Optional)* `DISCORD_SUPPORTER_ROLE_IDS` = `roleID:kind` comma list
  (`subscription|boost|gift|kofi|staff`). ⚠️ **A malformed value crashes startup.**
  Can be left empty and managed at runtime on the `/config` panel.

### D. Slash commands (`/config`, `/stats`, `/whois`, …; optional; needs C)
- General Information → **Public Key** → `DISCORD_PUBLIC_KEY` (in `/etc/costan/costan.env`).
- Ensure `COSTAN_DISCORD_APP_ID` is set (commands auto-register at startup).
- **Interactions Endpoint URL** → `https://example.com/discord/interactions`. Save it
  **after** the service is live with `DISCORD_PUBLIC_KEY` set (Discord posts a signed PING).

---

## 4. Google application

Google Cloud Console → APIs & Services:
- Configure the **OAuth consent screen** (External).
- Create **OAuth client ID** (Web application).
- Authorized redirect URI → **`https://example.com/auth/google/callback`**.
- Scopes: `openid email profile` (PKCE; nothing extra to enable).
- `GOOGLE_CLIENT_ID` → `/etc/costan/costan.env` (§5); the secret → `secrets.enc.yaml` (§6).

---

## 5. Environment reference (`/etc/costan/costan.env`)

`/etc/costan/costan.env` is the systemd `EnvironmentFile`. It lives on the server,
outside the checkout, so `git pull` never touches it; the template is
`deploy/costan.env.example` (copy it there in §7 and fill it in). The fixed settings
(`COSTAN_ADDR`, `COSTAN_DB`, `COSTAN_SECURE_COOKIES`, `COSTAN_REAL_IP_HEADER`, and
the `*_FILE` secret paths) are set in `deploy/costan.service`, so
`costan.env` holds only:

**Required:** `COSTAN_BASE_URL=https://example.com`, plus at least one login provider's
public client id (`DISCORD_CLIENT_ID` / `GOOGLE_CLIENT_ID`), with the matching
secret in `secrets.enc.yaml` (§6).

**Optional features:** `COSTAN_DISCORD_APP_ID`, `DISCORD_GUILD_ID`,
`DISCORD_SUPPORTER_ROLE_IDS`, `DISCORD_PUBLIC_KEY`, `COSTAN_LOG_LEVEL`,
`COSTAN_BOT_DELAY`.

**Never set in production:** `COSTAN_DEV_AUTH`, `COSTAN_LOADTEST`, `COSTAN_PPROF`.
Each is refused when the deployment looks like production (`COSTAN_SECURE_COOKIES`
set or an `https://` `COSTAN_BASE_URL`, the same check that guards the dev-login
route). `COSTAN_PPROF` also binds `127.0.0.1` when given a bare `:port`, because a
heap dump contains live session tokens (the database stores only their hashes).

**First boot only:** `COSTAN_ALLOW_NEW_DB=1`. In production the server refuses to
create the database, so a botched restore or a typo in `COSTAN_DB` fails instead
of serving an empty site. On the first start add `COSTAN_ALLOW_NEW_DB=1` to
`/etc/costan/costan.env`, start the service, then **remove it and restart**. While
it is set, every start logs a `COSTAN_ALLOW_NEW_DB is set` warning.

The DB auto-migrates on open (migrations are embedded in the binary); there is no
seed step. It lives at `/var/lib/costan/costan.db` (+ WAL/SHM), the unit's
`StateDirectory`.

---

## 6. Secrets (SOPS + age)

The three secrets (`discord_client_secret`, `google_client_secret`,
`discord_bot_token`) are SOPS-encrypted at rest in `/etc/costan/secrets.enc.yaml`
on the server; at every (re)start the unit's `ExecStartPre` decrypts them into the
tmpfs `RuntimeDirectory` (`/run/costan`), and the binary reads them via `*_FILE`.
The only plaintext at-rest secret on the box is the **age private key**. The
encrypted files are **not** in the repository: they belong to your deployment, and
`.gitignore` keeps them out (`/*.enc.yaml`). Keep a copy off the server (with the
age key) so a rebuild does not depend on the old host.

One-time, on your workstation:
```sh
age-keygen -o age.key                 # note the "Public key: age1..."
# put that age1... key into .sops.yaml (replace the placeholder)
cp deploy/secrets.example.yaml secrets.yaml   # plaintext, gitignored
$EDITOR secrets.yaml                  # fill the 3 values ("" = feature disabled)
sops -e secrets.yaml > secrets.enc.yaml
grep -q 'ENC\[' secrets.enc.yaml && shred -u secrets.yaml   # confirm + remove plaintext
```
**TLS origin cert** (same age key). Encrypt the Cloudflare origin cert + key from §2,
so the private key is never plaintext on disk:
```sh
deploy/cert-encrypt.sh origin.pem origin.key       # -> origin-cert.enc.yaml (gitignored)
```
`costan-certs.service` decrypts it into tmpfs (`/run/costan-certs`) before nginx starts.

Neither encrypted file, nor the age **private** key, ever goes in git. All three are
installed on the server in §7. The scripts read the encrypted files from
`/etc/costan/` by default; override with `SECRETS_FILE` / `ORIGIN_CERT_FILE` in the
units if you keep them elsewhere.

---

## 7. On the server

Run as the **repo-owning login user** (`<admin user>`: whatever non-root account your
image provides, e.g. `ec2-user`, `debian`, `ubuntu`) with passwordless sudo. Do **not** run the whole thing
as root: the tree must be owned by that user or `deploy/update.sh` refuses to run
later (see the ownership note below).

```sh
# ── distro packages ────────────────────────────────────────────────────────
sudo dnf install -y git nginx curl        # Debian/Ubuntu: sudo apt install -y git nginx curl

# ── nix (Determinate installer: works on non-NixOS, enables flakes) ────────
# The piped one-liner is interactive; use this form over SSH or in a script.
curl -fsSL https://install.determinate.systems/nix -o /tmp/nix-install.sh
sudo sh /tmp/nix-install.sh install linux --no-confirm
export PATH=/nix/var/nix/profiles/default/bin:$PATH   # or open a new shell

# ── inbound 80/443 on the host firewall, from Cloudflare only ─────────────
# Admit 80/443 from Cloudflare's published ranges and nothing else: the origin must
# not be reachable around Cloudflare (see "Firewall the origin to Cloudflare" below).
# The cloud provider's own ACL is separate and must be set up too.
sudo firewall-cmd --permanent --new-ipset=cloudflare-v4 --type=hash:net
sudo firewall-cmd --permanent --new-ipset=cloudflare-v6 --type=hash:net --option=family=inet6
for c in $(curl -fsS https://www.cloudflare.com/ips-v4); do
  sudo firewall-cmd --permanent --ipset=cloudflare-v4 --add-entry="$c"
done
for c in $(curl -fsS https://www.cloudflare.com/ips-v6); do
  sudo firewall-cmd --permanent --ipset=cloudflare-v6 --add-entry="$c"
done
for svc in http https; do
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source ipset=cloudflare-v4 service name=$svc accept"
  sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv6 source ipset=cloudflare-v6 service name=$svc accept"
done
# Some images already allow http/https from anywhere in the default zone. Remove
# that, or the rules above restrict nothing:
sudo firewall-cmd --permanent --remove-service=http --remove-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-all     # services: ssh (and dhcpv6-client) only, plus 4 rich rules

# ── SELinux: let nginx connect to the local backend (else every request 502s) ──
sudo setsebool -P httpd_can_network_connect on

# ── service user ──────────────────────────────────────────────────────────
sudo useradd --system --no-create-home --shell /usr/sbin/nologin costan

# ── code, owned by the login user rather than root (see below) ───────────
# Clone your fork if you run one; update.sh pulls from whatever `origin` is.
sudo mkdir -p /opt/costan && sudo chown "$USER:$USER" /opt/costan
git clone https://github.com/ftqo/costan.io.git /opt/costan && cd /opt/costan

# ── deployment files: config, encrypted secrets, age key (out-of-band) ────
# None of these is in the repository. From your workstation:
#   workstation$ cat age.key | ssh <admin user>@<server> \
#       'sudo install -D -m 600 -o root -g root /dev/stdin /etc/costan/age.key'
#   workstation$ scp secrets.enc.yaml origin-cert.enc.yaml <admin user>@<server>:/tmp/
# (Piping the age key leaves no plaintext copy on disk.) Then, on the server:
sudo install -D -m 600 -o root -g root /tmp/secrets.enc.yaml     /etc/costan/secrets.enc.yaml
sudo install -D -m 600 -o root -g root /tmp/origin-cert.enc.yaml /etc/costan/origin-cert.enc.yaml
rm -f /tmp/secrets.enc.yaml /tmp/origin-cert.enc.yaml
sudo install -m 644 -o root -g root deploy/costan.env.example /etc/costan/costan.env
sudoedit /etc/costan/costan.env      # your hostname, client ids, guild id, public key (§5)
# Cloudflare's Authenticated Origin Pulls CA (§2.4):
sudo install -D -m 644 authenticated_origin_pull_ca.pem /etc/nginx/certs/cloudflare-origin-pull-ca.pem

# ── sops onto /usr/local/bin so the ExecStartPre units find it; build the ──
# binary with nix (no Go install). Both are static, so copying out of the store works.
sudo install -m 755 "$(nix build --no-link --print-out-paths 'nixpkgs#sops')/bin/sops" /usr/local/bin/sops
# One binary per git sha under /usr/local/lib/costan, with /usr/local/bin/costan
# a symlink to the live one. deploy/update.sh maintains this layout; rollback is
# re-pointing the symlink (UPDATING.md).
sudo install -d -m 755 /usr/local/lib/costan
out=$(nix build --no-link --print-out-paths '.#costan')
sha=$(git rev-parse --short=12 HEAD)
# The server and the two operator tools come from one derivation
# (costan-recover: UPDATING.md "Operator tools", docs/game-actor.md).
for tool in costan costan-recover costan-backfill; do
  sudo install -m 755 "$out/bin/$tool" "/usr/local/lib/costan/$tool-$sha"
  sudo ln -sfn "/usr/local/lib/costan/$tool-$sha" "/usr/local/bin/$tool"
done

# ── sqlite CLI: the backup needs it (the backend embeds SQLite; nothing else does) ──
sudo dnf install -y sqlite                # Debian/Ubuntu: sudo apt install -y sqlite3
sudo install -d -m 750 -o costan -g costan /var/backups/costan

# ── units ─────────────────────────────────────────────────────────────────
# TLS cert oneshot: decrypts the cert into tmpfs (labelled cert_t for SELinux)
# before nginx (RequiredBy nginx).
sudo cp deploy/costan-certs.service /etc/systemd/system/costan-certs.service
sudo cp deploy/costan.service /etc/systemd/system/costan.service
# Backup timer (every 6h) + the OnFailure= alert handler both units reference.
sudo cp deploy/costan-backup.service deploy/costan-backup.timer /etc/systemd/system/
sudo cp deploy/costan-alert@.service /etc/systemd/system/
# nginx config matches by server_name, so it coexists with the distro default server.
# It names api.example.com: substitute your API hostname as you install it.
sed 's/api\.example\.com/api.YOUR-DOMAIN/g' deploy/nginx-costan.conf | sudo tee /etc/nginx/conf.d/costan.conf >/dev/null
sudo systemctl daemon-reload

sudo systemctl enable --now costan-certs.service
sudo nginx -t && sudo systemctl enable --now nginx
# First boot only: add COSTAN_ALLOW_NEW_DB=1 to /etc/costan/costan.env, start, then
# remove it and restart (§5).
sudo systemctl enable --now costan
sudo systemctl enable --now costan-backup.timer
sudo systemctl start costan-backup.service   # take one now
```

`enable --now` starts it and on every boot: ExecStartPre decrypts the secrets into
tmpfs, then runs the binary. No plaintext secret ever hits persistent disk.

**Alerts need a channel.** `costan-alert@.service` falls back to the Discord
channel set on the `/config` panel (`mod_config.report_channel`), which it cannot
read when the database is what broke. Pin it explicitly:
```sh
printf 'COSTAN_ALERT_CHANNEL_ID=123456789012345678\n' | sudo install -D -m 644 /dev/stdin /etc/costan/backup.env
```
That file is also where `BACKUP_KEEP_DAYS` and `BACKUP_RCLONE_REMOTE` go (§10).

**Firewall the origin to Cloudflare.** The origin must accept 80/443 **only from
Cloudflare's IP ranges** (https://www.cloudflare.com/ips-v4 and `/ips-v6`), at both
the host firewall (above) and the provider's network ACL. Authenticated Origin Pulls
(§2.4) already refuses TLS clients without Cloudflare's certificate, and nginx only
honours `CF-Connecting-IP` from Cloudflare's ranges; the firewall stops anyone
reaching the origin directly. Cloudflare's ranges change rarely; re-check them now and then and update both the
ipsets (`firewall-cmd --permanent --ipset=cloudflare-v4 --add-entry=...`, then
`--reload`) and the `set_real_ip_from` list in `deploy/nginx-costan.conf`. To check
the lock from outside: through Cloudflare the site returns 200, while
`curl -m 8 --resolve api.example.com:443:<server ip> https://api.example.com/healthz`
must fail to connect.

**Open the cloud provider's ACL too.** `firewall-cmd` only opens the host. In front
of it sits the provider's network ACL (a security list, security group or firewall
rule set, depending on the provider): add ingress rules for 443 (and 80) from each
Cloudflare range. If only one is open, `nc -z HOST 443` from outside times out
while `ss -lntp` on the box shows nginx listening. A **timeout** means an ACL is dropping it;
**connection refused** means the packet arrived and nothing was listening.

**Why `/opt/costan` must not be root-owned.** `deploy/update.sh` refuses to run as
root (nix is not on root's sudo PATH, and it sudos the privileged steps itself), and
a root-owned tree trips git's `dubious ownership` guard when the login user runs
`git pull`. So `sudo git clone` works today and breaks the first update. `chown` the
directory first and clone as the login user, as above.

---

## 8. Verify

```sh
systemctl status costan costan-certs nginx                # all three: active (running)
curl -fsS http://127.0.0.1:4757/healthz                   # -> ok (local, behind nginx)
curl -fsS http://127.0.0.1:4757/api/games                 # -> {"games":[]} (reads sqlite)
journalctl -u costan -b --no-pager | tail                 # JSON logs, "opening store", "listening"
systemctl list-timers costan-backup.timer                 # next + last backup
ls -l /var/backups/costan                                 # at least one costan-*.db.gz
```
`/healthz` is a liveness probe only: no auth, no store, `200` unconditionally, even
with every query failing. `deploy/update.sh` gates on `/api/games` instead.
From outside, through Cloudflare:
```sh
curl -fsS https://api.example.com/healthz                   # -> ok (edge -> nginx -> backend)
curl -s  https://example.com/api/games                      # -> {"games":[]}  (Pages Function -> origin)
curl -s  https://example.com/api/leaderboard                # -> {"entries":...}
curl -s  https://example.com/api/colors                     # -> 401 UNAUTHENTICATED (auth gate intact)
curl -sD- -o/dev/null https://example.com/auth/discord      # -> 302 to discord.com, redirect_uri on the apex
```
**`https://example.com/healthz` is not a health check.** `/healthz` is not in the Pages
Function's route list (`/api /auth /ws /discord`), so Cloudflare serves the SPA's
`index.html` with a `200` whatever the backend's state. Use
`https://api.example.com/healthz`, which goes to the origin, or any `/api/*` endpoint.
Then: log in with each provider; open a game in two tabs, `sudo systemctl restart
costan`, confirm both reconnect with state intact; check the `/ws` upgrade in
DevTools → Network → WS.

---

## 9. Rebuilding on a fresh host (host loss)

The rebuild is §7 verbatim on the new box. What remains is restoring what is not in
git and repointing what names the old IP.

**In git already, no action needed:** every unit file, the nginx config, and the
templates (`deploy/costan.env.example`, `deploy/*.example.yaml`).
Restoring the data is a separate step (§10). Do it before the first start: in
production the server refuses to create the database unless `COSTAN_ALLOW_NEW_DB=1`
is set (§5), so a rebuild cannot silently start empty.

**Not in git; keep these off-box:**

| Thing | Where it lives | If you lost it |
|---|---|---|
| **age private key** | `/etc/costan/age.key` on the old host; your password manager | **Hard blocker.** Without it neither the secrets nor the TLS cert decrypt and `costan.service` will not boot. Recovery: `age-keygen -o age.key`, put the new public key in `.sops.yaml`, re-issue all three secrets (Discord client secret, Google client secret, bot token) from their dashboards, re-encrypt, install under `/etc/costan/`. Budget three dashboard visits. |
| **`secrets.enc.yaml`, `origin-cert.enc.yaml`** | `/etc/costan/` on the old host; your off-box copy | Re-create from the dashboards (§6) if lost; useless without the age key anyway. |
| **`costan.env`** | `/etc/costan/costan.env` on the old host | Rebuild from `deploy/costan.env.example`; every value in it is public and visible in your provider dashboards. |
| **Cloudflare origin cert** | inside `origin-cert.enc.yaml` (needs the age key) | Free to regenerate: SSL/TLS → Origin Server → Create Certificate, then `deploy/cert-encrypt.sh`. |
| **The database** | `/var/lib/costan/costan.db` on the old host; `/var/backups/costan/costan-*.db.gz`, and off-host if `BACKUP_RCLONE_REMOTE` is configured | **Only from a backup.** `costan-backup.timer` (§10) takes one every 6h, but only the `rclone` copy survives losing the instance. Restore before the first start (§10 has the drill). Without a copy, accounts, games, cosmetics and Pips balances are gone. |

**Then repoint everything that names the old IP:**

1. **Cloudflare DNS** → `api.example.com` A record → the new IP (§2.3).
2. **Cloud ACL** → the new instance's subnet needs 443 ingress from Cloudflare (§7).
   If it landed in the same subnet as the old one, this is likely already there.

**Confirm the edge reaches the new box.** A proxied A record hides the origin IP
from `dig`, and Cloudflare's 502 page looks like nginx's, so check from the origin:

```sh
sudo tail -20 /var/log/nginx/access.log   # on the NEW host
```
Requests from Cloudflare edge ranges (`172.70.x`, `104.23.x`, `162.158.x`) with
`api.example.com` as the `server` mean DNS is live and pointing here. Nothing at all
means it is still pointing at the old host.

**Order of operations.** Everything except the age-key install and the service
starts is independent of the secrets, so you can reach "nginx serving TLS, 502 on
the upstream" before you need the key. That 502, with `connect() failed (111:
Connection refused)` in `error.log`, is expected before the backend starts.

---

## 10. Backups and restore

The DB is the only irreplaceable thing on the box. It is a single SQLite file with
one writer, so **do not `cp` it**: a copy taken mid-write, or without the `-wal`,
restores as a corrupt or stale database.

§7 installs the following:

| File | What it is |
|---|---|
| `deploy/backup.sh` | `VACUUM INTO` → verify → gzip → prune by age → optional off-host push |
| `deploy/costan-backup.service` | oneshot, `User=costan`, sandboxed, `OnFailure=` wired |
| `deploy/costan-backup.timer` | every 6h, `Persistent=true`, jittered, offset off the hour |
| `deploy/costan-alert@.service` | posts a failure to the Discord mod channel; `OnFailure=` on **both** `costan.service` and `costan-backup.service` |

```sh
sudo systemctl start costan-backup.service        # take one now
systemctl list-timers costan-backup.timer         # next + last run
journalctl -u costan-backup -n 20 --no-pager      # what it verified
```

**Notes on `backup.sh`:**

- **`VACUUM INTO`, not `sqlite3 .backup`.** The online-backup API restarts from
  page 0 whenever the source is written mid-copy, so on a busy server it may never
  finish. `VACUUM INTO` runs in one read transaction: a consistent snapshot with the
  WAL folded in, without blocking the writer, written as one self-contained file.
- **Never as root.** `sqlite3` opens the source read-write (a WAL reader maps the
  `-shm`), so a root run leaves root-owned `costan.db-wal`/`-shm` files the service
  cannot write. The script refuses to run as root.
- **Verified, and pruned by age.** Each copy is checked for size, `PRAGMA
  integrity_check`, a real `schema_version`, and `games`/`users` counts that have
  not gone down (which catches a backup of an accidentally recreated empty
  database, §5). Pruning is by age (`BACKUP_KEEP_DAYS`, default 30) rather than
  count, so a timer that has been failing for a week does not expire the last good
  copy.

**Off-host.** A local backup survives a bad deploy; it does not survive losing the
instance. Set an `rclone` remote (any object store rclone supports; Cloudflare R2
sits in the same account as the zone) in `/etc/costan/backup.env`:
```sh
BACKUP_RCLONE_REMOTE=<remote>:<bucket>
BACKUP_KEEP_DAYS=30
```
Configure the remote at `/etc/costan/rclone.conf`, where the unit points
`RCLONE_CONFIG` (the `costan` user has no home directory and the unit sets
`ProtectHome=true`):
```sh
sudo RCLONE_CONFIG=/etc/costan/rclone.conf rclone config   # add the remote
sudo chgrp costan /etc/costan/rclone.conf && sudo chmod 640 /etc/costan/rclone.conf
sudo systemctl start costan-backup.service && journalctl -u costan-backup -n 20 --no-pager
```
The bucket wants a lifecycle rule of its own; `BACKUP_KEEP_DAYS` prunes the
remote too, but only on the runs that reach it.
[litestream](https://litestream.io) is the step up: continuous WAL replication,
point-in-time restore, no timer.

### The restore drill (do it once, timed, before you need it)

Run this on a **scratch host or scratch directory**, timed, and write the time down.

```sh
# 1. Fetch the newest copy and unpack it somewhere that is not /var/lib/costan.
ls -t /var/backups/costan/costan-*.db.gz | head -1        # or: rclone lsl <remote>:<bucket>
gunzip -c /var/backups/costan/costan-20260830T012300Z.db.gz > /tmp/restore.db

# 2. Check it before trusting it.
sqlite3 /tmp/restore.db 'PRAGMA integrity_check'                       # -> ok
sqlite3 /tmp/restore.db 'SELECT MAX(version) FROM schema_version'      # -> a plausible number
sqlite3 /tmp/restore.db 'SELECT COUNT(*) FROM games'                   # -> the games you expect
sqlite3 /tmp/restore.db 'SELECT COUNT(*) FROM users'

# 3. Stop the server. One writer, and it is holding the file you are replacing.
sudo systemctl stop costan

# 4. Move the old WAL and shared-memory files aside too. SQLite may replay an old
#    -wal over the restored file, silently corrupting it. Moving rather than
#    deleting keeps a failed restore recoverable:
sudo mv /var/lib/costan/costan.db     /var/lib/costan/costan.db.pre-restore
sudo mv /var/lib/costan/costan.db-wal /var/lib/costan/costan.db-wal.pre-restore   # if present
sudo mv /var/lib/costan/costan.db-shm /var/lib/costan/costan.db-shm.pre-restore   # if present

# 5. Install the restored file owned by `costan`, or the service cannot write it.
sudo install -o costan -g costan -m 600 /tmp/restore.db /var/lib/costan/costan.db

# 6. Start, and verify against something that reads the DB (not /healthz).
sudo systemctl start costan
curl -fsS http://127.0.0.1:4757/api/games
journalctl -u costan -b --no-pager | tail

# 7. Only once the site is right: remove the .pre-restore files.
```

The server does not need `COSTAN_ALLOW_NEW_DB` here, because the file exists by
step 5. If it complains that it "expected an existing database", check the path
and owner; the override would turn a bad restore into an empty site.

## Updating

Ongoing updates, secret rotation, rollback, reboots, and troubleshooting:
**[UPDATING.md](UPDATING.md)**. In short, a code update keeps nginx up and clients
reconnect over a sub-second gap:

```sh
/opt/costan/deploy/update.sh     # pull main, rebuild, restart the service
```

Frontend updates deploy themselves: pushing `main` triggers the Cloudflare Pages build.

So for a release that changes both halves, **push order matters**: pushing `main`
puts the new frontend live against the old backend. Module registration is broad enough that the old backend
accepts a ruleset it cannot render properly, so the result is a playable but wrong
game rather than a clean error. The safe sequence (side branch, backend first, then
`main`) is in [UPDATING.md](UPDATING.md) under *Releases that change both halves*.

---

## Why there's no zero-downtime / blue-green

State lives in the single sqlite file (one writer) and the in-memory actors (two
processes on one game = split brain), so there is exactly one backend and a brief
(~1 second) gap on each restart. State is durable per command and rehydrates
lazily, clients reconnect and resync, an all-player drop suspends the game (turns
freeze, nobody is forfeited), and a 3-minute suspend-abandon grace backstops it. The
1012 close frame on SIGTERM, full-jitter reconnect and a delayed reconnect indicator
smooth the gap.

## Nix (optional)

The flake provides more than the dev shell:
- `nix develop` includes `sops` + `age` for the Step 2 / Pages workflow. Wrangler is
  not in the shell (nixpkgs' darwin build is broken); run it as `npx wrangler` from
  `frontend/`.
- `nix build .#costan` builds the backend binary reproducibly; this is what §7 and
  `deploy/update.sh` use on the server (no Go toolchain needed). The derivation
  carries the operator tools too (`result/bin/costan-recover`,
  `result/bin/costan-backfill`), and each is a flake app: `nix run .#costan-recover`.
- `nixosModules.costan` configures the whole stack (the `costan` service, the
  cert-decrypt oneshot, nginx, the backup timer, and the OnFailure Discord alert)
  declaratively. It is only relevant if the server runs NixOS; the §7 deploy
  does not use it. Usage is in `nix/module.nix`. Nothing tests it, so it can fall
  behind `deploy/costan.service`: if you change one unit, change the other.

## Notes

- **Off-host backups are opt-in.** §10 ships the timer and it runs on every host,
  but `BACKUP_RCLONE_REMOTE` is unset by default, so out of the box the copies
  live on the same instance as the original. Configure the remote.
