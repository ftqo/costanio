# Updating costan in production

First-time setup is in [DEPLOY.md](DEPLOY.md). This covers ongoing changes. The
stack is systemd (no Docker): the backend is `/usr/local/bin/costan` run by
`costan.service`; nginx is a normal system service.

## Backend code update (the usual case)

On the server:

```sh
/opt/costan/deploy/update.sh
```

`deploy/update.sh` pulls `main`, rebuilds the binary on the server (`nix build`),
installs it **content-addressed** at `/usr/local/lib/costan/costan-<sha>`, points
the `/usr/local/bin/costan` symlink at it, and restarts the service. It installs
`costan-recover` and `costan-backfill` the same way, so the operator tools are
always on the host; see "Operator tools" below. nginx is a separate unit and
stays up. On SIGTERM the backend sends `1012 Service Restart` close frames,
flushes and exits; the new binary boots in under a second and rehydrates games
lazily. Clients reconnect with jittered backoff and resync the event gap. Game
state is durable.

It then retries a health probe until a deadline (default 300s), because
`store.Open` runs pending migrations before the listener opens. It probes
`/api/games`, since `/healthz` touches no store. If unhealthy, it prints the logs
and a rollback command for every build on disk. On success it collects
`/nix/store` garbage older than 14 days (`NIX_GC_KEEP_DAYS`), because the store
and the database share a filesystem.

Equivalent by hand:
```sh
cd /opt/costan && git pull --ff-only
out=$(nix build --no-link --print-out-paths '.#costan')
sha=$(git rev-parse --short=12 HEAD)
sudo install -d -m 755 /usr/local/lib/costan
sudo install -m 755 "$out/bin/costan" "/usr/local/lib/costan/costan-$sha"
sudo ln -sfn "/usr/local/lib/costan/costan-$sha" /usr/local/bin/costan.new
sudo mv -Tf /usr/local/bin/costan.new /usr/local/bin/costan     # atomic switch
for tool in costan-recover costan-backfill; do
  sudo install -m 755 "$out/bin/$tool" "/usr/local/lib/costan/$tool-$sha"
  sudo ln -sfn "/usr/local/lib/costan/$tool-$sha" "/usr/local/bin/$tool.new"
  sudo mv -Tf "/usr/local/bin/$tool.new" "/usr/local/bin/$tool"
done
sudo systemctl restart costan
```

(You can't overwrite a running executable in place, so each build is its own
file. `mv -T` over the link is atomic; `ln -sfn` alone unlinks then relinks.)

## Frontend update

Nothing on the server: Cloudflare Pages rebuilds and deploys the frontend
automatically when `main` is pushed.

## Releases that change both halves

The backend ships by the manual `update.sh` above; the frontend deploys itself when
`main` is pushed. When the frontend needs something only the new backend has (a new
ruleset, event type or view field), the backend must go first.

Getting this wrong fails quietly. `cmd/costan/main.go` blank-imports every module,
so `engine.ValidRuleset("base+fishermen")` can be true on a backend that predates a
mode's rules and art. A new bundle on an old backend creates the table and plays a
wrong-looking or half-ruled game instead of refusing to start.

So for a both-halves release, in order:

1. **Read the production DB first.** The risk is to active games; with none in
   flight, most of what follows is precaution.
   ```sh
   sqlite3 /var/lib/costan/costan.db "select ruleset, status, count(*) from games group by 1,2"
   ```
2. **Push to a side branch, not `main`.**
   ```sh
   git push origin main:release/<name>
   ```
   Pages builds `main`, so this puts the code where the server can fetch it without
   shipping the frontend. **Check the Pages project is branch-scoped to `main`
   first** (Workers & Pages -> the project -> Settings -> Builds & deployments); a
   build-every-branch configuration can defeat the ordering.
3. **Deploy the backend from that ref.** Not with `deploy/update.sh`, which pulls
   `main`. By hand instead:
   ```sh
   cd /opt/costan && git fetch origin && git checkout release/<name>
   out=$(nix build --no-link --print-out-paths '.#costan')
   sha=$(git rev-parse --short=12 HEAD)
   sudo install -d -m 755 /usr/local/lib/costan
   sudo install -m 755 "$out/bin/costan" "/usr/local/lib/costan/costan-$sha"
   sudo ln -sfn "/usr/local/lib/costan/costan-$sha" /usr/local/bin/costan.new
   sudo mv -Tf /usr/local/bin/costan.new /usr/local/bin/costan
   sudo systemctl restart costan
   ```
   Then check, in this order:
   ```sh
   systemctl status costan                            # active (running)
   curl -fsS http://127.0.0.1:4757/api/games          # local, and it reads sqlite
   curl -fsS https://api.example.com/healthz            # edge -> nginx -> backend
   journalctl -u costan -b --no-pager | tail          # migrations applied, no rebuild errors
   ```
   Not `https://example.com/healthz`, which returns 200 with the backend dead (DEPLOY.md
   §8). `/healthz` on any host only shows the process is serving. Then **open one
   live game**: after a snapshot-version bump every existing game full-replays from
   seq 0 on first load, and only loading a game exercises that.
4. **Then push `main`** and let Pages build. Hard-reload (the SPA is cached), create a
   table on each ruleset the release touches, and confirm the board draws (a stale
   asset manifest shows as a blank board, not a console error).
5. **`git checkout main` on the server afterwards.** Otherwise the next `update.sh`
   either fails its `--ff-only` or rebuilds the wrong ref. Once `main` contains the
   release, this is a fast-forward to the same code.

Between steps 3 and 4 the site runs new backend with old bundle, which is safe: the
new backend serves everything the old bundle asks for. The reverse produces a
playable but wrong game.

## Rotating / changing a secret

The encrypted secrets live on the server at `/etc/costan/secrets.enc.yaml`, not in
the repository. Edit your workstation copy (on a machine with the age **private**
key), then install it on the server:

```sh
SOPS_AGE_KEY_FILE=age.key sops secrets.enc.yaml   # workstation: opens decrypted in $EDITOR
scp secrets.enc.yaml <admin user>@<server>:/tmp/
# on the server:
sudo install -m 600 -o root -g root /tmp/secrets.enc.yaml /etc/costan/secrets.enc.yaml && rm /tmp/secrets.enc.yaml
sudo systemctl restart costan                     # ExecStartPre re-decrypts on restart
```

(Or edit in place on the server with `sudo SOPS_AGE_KEY_FILE=/etc/costan/age.key
sops /etc/costan/secrets.enc.yaml`, if `sops` is on root's PATH.)

After rotating an OAuth client secret, also update it in the provider's dashboard so
the two halves match.

## Changing non-secret config

The non-secret config (`COSTAN_BASE_URL`, client ids, `DISCORD_PUBLIC_KEY`, guild id,
…) lives on the server in `/etc/costan/costan.env` (template:
`deploy/costan.env.example`). Edit it and restart (no rebuild needed):

```sh
sudoedit /etc/costan/costan.env
sudo systemctl restart costan
```

## Rolling back

Every build stays on disk under `/usr/local/lib/costan/costan-<sha>` (the newest
10), and `/usr/local/bin/costan` is a symlink. Rolling back is re-pointing it:

```sh
ls -lt /usr/local/lib/costan            # what is available, newest first
readlink -f /usr/local/bin/costan       # what is live now
sudo ln -sfn /usr/local/lib/costan/costan-<sha> /usr/local/bin/costan.new
sudo mv -Tf /usr/local/bin/costan.new /usr/local/bin/costan
sudo systemctl restart costan
```

`deploy/update.sh` prints these lines, filled in, whenever its health check
fails. Rollback is repeatable: earlier builds stay on disk however many times you
deploy.

`costan-recover` and `costan-backfill` live in the same directory and are
symlinked the same way; roll them back with the server (`ln -sfn`/`mv -Tf`
against `/usr/local/bin/<tool>`) so the recovery tool's engine matches.

To revert source too: `cd /opt/costan && git checkout <good-commit>` (or
`git revert`), then `/opt/costan/deploy/update.sh`. Migrations only move forward:
fix forward rather than down-migrating.

**The DB survives a rollback; not every game in it does.** Safe:

- **Snapshots are safe in both directions.** A snapshot blob is prefixed with
  `snapshotVersion` (`game/actor.go`) and `rebuild` accepts it only when
  `blob[0] == snapshotVersion`; anything else is dropped for `engine.Empty()` plus a
  full replay from seq 0, so a newer blob costs a replay, not a game.
- **The schema is safe in both directions.** `store.migrate` applies only files whose
  version is greater than the recorded one, so an old binary never tries to undo
  anything, and the added columns are nullable `ALTER TABLE ... ADD COLUMN`s the old
  code does not read. No query in `store/` uses `SELECT *`, so a wider table does not
  shift anyone's column indexes.

Not safe:

- **An event type the old binary does not know freezes that game.** `engine.Apply`'s
  default arm returns `unknown event type %q at seq %d`, `rebuild` propagates it, and
  the game fails to load until you roll forward. As of the scenario release the only
  such type is `tab_fish_gained` (`engine/scenarios`), so this affects Fishermen games. The
  log is intact and the game loads again under the new binary.
- **A game started under the new binary loses its fairness commitment.** New games
  draw two seeds (public, committed at table creation; private, drawn at start) and
  roll dice off the *public* stream. The old binary has no `PublicSeed`: its `Apply`
  reads only `Seed`, so after a rollback that table's remaining dice come off the
  private seed, which was never committed. The game plays fine but cannot be verified
  against its commitment.

- **Rolling back across a `DerivationVersion` bump makes every game created in
  the window permanently unauditable.** The backend writes the stamp
  (`engine.DerivationVersion`, into `game_created`), but the verifier ships with
  the frontend as `/verify.js`. After a backend rollback, new games are stamped
  with the old version while the live verifier implements only the new one, and
  `verify/` reports any other version as unauditable (`verify/README.md`, "One
  version, and no museum"). The stamp is written once, so this persists after the
  roll-forward. If a rollback crosses a bump, take the site offline for the window.

- **Rolling back past the fish privacy change shows every seat holding nothing.**
  `tab_fish_caught` and `tab_fish_spent` now carry tile counts (`draws`, `tiles`)
  instead of fish values (`values`, `value`), because values plus the public board
  revealed every seat's exact tiles. An old binary folding a new log finds neither
  field, so `FishExt.Total` stays at zero and the rail shows nobody holding fish;
  play is otherwise correct. Rolling forward fixes it at the next rebuild.

- **Rolling back past the camel-vote reshape empties every open bid.** The
  Caravans bid changed from two named piles (`wool`, `grain`) to `cards`, a pair
  against the ruleset's bid resources (brick and lumber alongside Knights); the
  ext also gained `BidRes` and `Reason`. An old binary folding a new log sees
  every open bid as empty, and `BidRes`'s zero value is a real resource. A full
  replay under the new binary rebuilds both. This and the fish change share one
  `snapshotVersion` (8).

So: **prefer fixing forward.** If you must roll back, roll back fast, and treat every
Fishermen game and every game created after the deploy as needing a roll-forward to
finish.

## Operator tools

Two commands ship beside the server and are on `PATH` on the host:

```sh
sudo -u costan costan-recover -db /var/lib/costan/costan.db list
```

`costan-recover` handles a game frozen in `paused-error` (an engine invariant
violation freezes the game and keeps its log): `list`,
then `finish <id>` to force-finish and finalize, or `abandon <id>` to write it
off. Neither resumes play, and both keep the log, so report the bug from it
first. See `docs/game-actor.md`. `costan-backfill` populates
`match_history` rows for finished games that predate the match-history
feature; it is idempotent, so re-running it is safe.

Both are built by the same derivation as the server (`subPackages` in
`nix/package.nix`). Off the host, both are also
`nix run github:ftqo/costan.io#costan-recover` (or `.#costan-recover` from
a checkout).

## Reboots

Automatic. `costan.service` is enabled, so on boot systemd runs its `ExecStartPre`
(SOPS-decrypts the secrets from `/etc/costan/secrets.enc.yaml` into tmpfs using
`/etc/costan/age.key`) and then the binary. No plaintext secret is ever written to
persistent disk.

```sh
systemctl status costan                 # active (running) = up
sudo systemctl restart costan           # graceful restart (quiet swap)
sudo systemctl stop costan              # stop
journalctl -u costan -b --no-pager      # this-boot logs
```

**A restart resets turn timers to a full budget.** Deadlines (`seatDeadlines`, the
offer and draw expiries) are in memory only and actors load lazily, so a table
mid-decision is inert until a client touches it, and `armTimer` then gives every
pending seat a fresh budget. A restart never times anyone out.

## nginx / TLS

The Cloudflare Origin cert lives SOPS-encrypted in `/etc/costan/origin-cert.enc.yaml` and is
decrypted into tmpfs (`/run/costan-certs`) by `costan-certs.service` before nginx
starts. It's valid for years; to renew, generate a fresh one (SSL/TLS → Origin
Server) and re-encrypt:

```sh
deploy/cert-encrypt.sh origin.pem origin.key     # workstation -> origin-cert.enc.yaml
scp origin-cert.enc.yaml <admin user>@<server>:/tmp/
# on the server:
sudo install -m 600 -o root -g root /tmp/origin-cert.enc.yaml /etc/costan/origin-cert.enc.yaml && rm /tmp/origin-cert.enc.yaml
sudo systemctl restart costan-certs              # re-decrypt into tmpfs
sudo systemctl reload nginx                      # pick up the new cert
```

For changes to `deploy/nginx-costan.conf`: copy it to `/etc/nginx/conf.d/costan.conf`,
then `sudo nginx -t && sudo systemctl reload nginx`.

## Troubleshooting

```sh
systemctl status costan
journalctl -u costan -n 100 --no-pager            # backend logs (JSON in prod)
journalctl -u nginx -n 50 --no-pager
curl -fsS http://127.0.0.1:4757/healthz            # local backend -> ok
curl -fsS https://api.example.com/healthz            # through Cloudflare -> nginx -> backend
curl -s   https://example.com/api/games              # through the Pages Function -> origin
```
**Not** `https://example.com/healthz`: `/healthz` is not in the Pages Function's route
list, so Cloudflare serves the SPA and returns `200` regardless. Use the `api.` host,
or any `/api/*` path.

- **502/523 from Cloudflare:** backend down or restarting: `systemctl status
  costan`, `journalctl -u costan`. `connect() failed (111: Connection refused)` in
  `/var/log/nginx/error.log` means nginx is fine and the upstream is not running;
  anything else there points at nginx or TLS.
- **521/522 from Cloudflare:** the edge could not reach the origin: DNS or a
  firewall, not the backend. Check the `api.example.com` A record points at
  the current host (DEPLOY.md §9), that the host firewall admits `https` from
  Cloudflare's ranges (`firewall-cmd --list-rich-rules`, `firewall-cmd
  --ipset=cloudflare-v4 --get-entries`), and that the cloud provider's ingress ACL
  allows 443 from them.
- **Every API request returns 400 through Cloudflare, the static site still loads:**
  nginx requires Cloudflare's client certificate and Cloudflare is not sending one.
  `/var/log/nginx/error.log` says `client sent no required SSL certificate`. Check
  that the **global** Authenticated Origin Pulls toggle is on (the zone-level one
  needs an uploaded certificate; DEPLOY.md §2.4). To restore service immediately,
  comment out `ssl_verify_client on;` and reload nginx; the firewall still keeps
  everyone but Cloudflare out.
- **Every request 502s right after a rebuild, nginx healthy:** on RHEL-family hosts
  this is SELinux blocking the loopback proxy: `sudo setsebool -P
  httpd_can_network_connect on`.
- **Service won't start, "read secret file" fatal:** the SOPS decrypt failed;
  check `/etc/costan/age.key` exists (root, 600) and `/etc/costan/secrets.enc.yaml` is present
  and decryptable; see the `ExecStartPre` output in `journalctl -u costan`.
- **Login fails / cookies dropped:** confirm `COSTAN_BASE_URL=https://example.com` (your apex)
  (apex, no www) and that Cloudflare routes `/api`,`/auth`,`/ws`,`/discord` to the
  origin under your apex (DEPLOY.md §1).
- **Supporter perks / `/config` role mapping not working:** a missing `discord_bot_token`
  disables supporter sync silently; confirm it's set in `/etc/costan/secrets.enc.yaml`.
- **"expected an existing database ... Refusing to create an empty one" at
  startup:** the guard from DEPLOY.md §5. The database is not where the server
  looked: usually `COSTAN_DB` or the unit's `StateDirectory`, sometimes a restore
  with the wrong owner. Check (`sudo ls -l /var/lib/costan/`) before using
  `COSTAN_ALLOW_NEW_DB=1`, which is only for a genuine first boot.
- **A backup failed:** `journalctl -u costan-backup -n 40 --no-pager`. Row counts
  "went backwards" means the database has fewer games/users than the last good
  copy, so it is probably the wrong database; find out why before overriding. Restore drill: DEPLOY.md §10.

## Moving to a new repository

If the code moves to a new Git repository (a rename, or a fresh history):

1. **Server checkout.** A fresh history does not fast-forward, so `git pull` fails.
   Re-point and reset once, then `update.sh` works as before:
   ```sh
   cd /opt/costan
   git remote set-url origin https://github.com/<owner>/<repo>.git
   git fetch origin && git reset --hard origin/main && git branch -u origin/main
   ```
   `reset --hard` deletes files that were tracked before and are not in the new tree,
   so copy anything the deploy still reads from the checkout out first (see below).
2. **Pages.** Re-link the Pages project to the new repository with the same settings
   (DEPLOY.md §2.5), or pushes to it will not deploy the frontend.
3. **Workstation.** `git remote set-url origin git@github.com:<owner>/<repo>.git`.

## Upgrading an install that keeps config in the checkout

Older installs read `deploy/costan.env`, `secrets.enc.yaml` and
`origin-cert.enc.yaml` from `/opt/costan`. Current units and scripts read them from
`/etc/costan` (`costan.env`, `secrets.enc.yaml`, `origin-cert.enc.yaml`), and the
repository no longer contains them. Before pulling a version with this layout:

```sh
B=/var/backups/costan/pre-upgrade-$(date -u +%Y%m%d-%H%M%S); sudo install -d -m 700 "$B"
sudo sqlite3 /var/lib/costan/costan.db ".backup $B/costan.db"   # integrity_check it
sudo install -m 600 -o root -g root /opt/costan/secrets.enc.yaml /etc/costan/secrets.enc.yaml
sudo install -m 600 -o root -g root /opt/costan/origin-cert.enc.yaml /etc/costan/origin-cert.enc.yaml
sudo install -m 600 -o root -g root /opt/costan/deploy/costan.env /etc/costan/costan.env
# after pulling:
sudo cp deploy/costan.service deploy/costan-certs.service deploy/costan-alert@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Then run `update.sh`. Check the decrypt step against the new paths before restarting
if you want to be careful: `sudo env PATH=/usr/local/bin:/usr/bin:/bin
SECRETS_OWNER=root:root /opt/costan/deploy/secrets-decrypt.sh /run/costan-test`
(then `sudo rm -rf /run/costan-test`). Migration 0034 rewrites the sessions table
in place on first boot; an older binary cannot read the result, so roll back with
the database backup, not just the binary.

