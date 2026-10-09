# costan

A web-based multiplayer settlement and trading board game for 2 to 10 players.
Build roads, settlements and cities on a hex board, trade resources, and race to
the target victory points, against friends or bots, in the browser or inside
Discord.

costan is a Go backend that serves a REST and websocket API, and a React (Vite)
single-page frontend with a 3D board.

## Features

- **The base game plus expansion modes**, composable where the rules allow:
  Islands (ships, gold, the pirate), Knights (barbarians, knights, commodities,
  progress cards), Explorers, and the scenarios Fishermen, Caravans,
  Harbormaster, Rivers, Raiders and Wagons.
- **2 to 10 players.** Boards for 7 to 10 players are generated procedurally,
  with hand-built map presets as an alternative.
- **Bots**, from a simple greedy one to a strong heuristic bot that scores its
  moves by simulating them through the rules engine. A bot takes over a seat
  whose player stays disconnected.
- **Crash-safe games.** Every action is persisted before anyone sees it; a
  restart or redeploy resumes games where they were.
- **Replays** of every finished game, move by move, plus per-player stats and
  ratings per ruleset.
- **Provably fair dice and boards.** The seeds are committed when a lobby opens,
  and a JavaScript port of the derivations (`verify/`) lets any player check that
  a finished game was not rigged.
- **Discord and Google sign-in**, guest play via invite links, spectators, chat
  with moderation tools, and a Discord Activity embed.
- **English plus 17 translations**, handled entirely in the frontend.

## Quick start

The toolchain comes from a [Nix](https://nixos.org) flake (Go, Node, sops, lint
tools). With Nix and [direnv](https://direnv.net) installed:

```sh
git clone https://github.com/ftqo/costan.io.git
cd costan.io
direnv allow          # or: nix develop
git lfs pull          # the board art (3D models, Blender files) is in Git LFS
./dev.sh              # backend + frontend on fixed local ports
```

`./dev.sh` builds the backend, starts it with a temporary database and dev
sign-in enabled, and serves the frontend (Vite dev server; `./dev.sh --built`
serves a production build instead). It prints the URLs to open.

Without Nix you need Go (see `go.mod` for the version), Node.js with npm, and
Git LFS. Then `go build ./cmd/costan` builds the server and `cd frontend && npm
ci && npm run dev` runs the frontend.

To watch bots play a whole game in the terminal, with no network involved:

```sh
go run ./cmd/costan-sim -players 4 -ruleset base
```

## Repository layout

| Path | What lives there |
|---|---|
| `engine/` | The pure, deterministic rules engine; one subpackage per expansion module |
| `game/` | One actor goroutine per running game: persistence, timers, redaction, broadcast |
| `lobby/` | Game creation and configuration, the public browser, invite codes |
| `server/` | HTTP and websocket handlers, the connection hub, sessions |
| `store/` | SQLite access and numbered migrations |
| `auth/` | Discord and Google OAuth, guest identities |
| `bot/` | The Simple and Strong bots |
| `sim/` | Headless simulation harness: thousands of seeded games checking global invariants |
| `replay/` | Folds an event log into drawable frames |
| `verify/` | The fairness audit, a JavaScript port of every derivation a player can see |
| `cmd/` | Binaries: the server, the bot match runner, operator tools |
| `frontend/` | The React/Vite single-page app |
| `art/`, `tools/` | Blender sources and the scripts that export the board art |
| `deploy/`, `nix/` | systemd units, nginx config and a NixOS module for self-hosting |
| `docs/` | Design documentation |

## Documentation

- [docs/overview.md](docs/overview.md) is the entry point to the design docs,
  and [docs/architecture.md](docs/architecture.md) explains the layers and their
  invariants.
- [docs/rules/](docs/rules/) holds the rules of every mode, in our own words.
- [CONTRIBUTING.md](CONTRIBUTING.md) covers the development workflow, tests and
  lint, and the project's conventions.
- [DEPLOY.md](DEPLOY.md) and [UPDATING.md](UPDATING.md) describe self-hosting
  behind Cloudflare with systemd and nginx.
- [docs/i18n/CONTRIBUTING.md](docs/i18n/CONTRIBUTING.md) is the guide for
  translators.

## Licence

- **Code** is under the [MIT License](LICENSE).
- **Art, 3D models, card art, sounds, images and translations** are under
  [CC BY-NC-SA 4.0](LICENSE-ASSETS).
- **Fonts** are under the SIL Open Font License 1.1.

[NOTICE.md](NOTICE.md) maps every path to its licence.

## Disclaimer

costan is an independent project. It is not
affiliated with, endorsed by, or sponsored by the publishers or rights holders of
any commercial board game. The game's title and the expansion names are our own;
game mechanics are not subject to copyright, and every name, text, image, model
and sound here is original to this project or used under the licences above.

Contributions are welcome as pull requests (see [CONTRIBUTING.md](CONTRIBUTING.md)).
See [SECURITY.md](SECURITY.md) to report a vulnerability and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.
