# Contributing to costan

Thanks for your interest. This guide covers the toolchain, the checks a change has
to pass, the architecture's core invariants, and the project's conventions.
The design docs in [`docs/`](docs/) go deeper; start at
[`docs/overview.md`](docs/overview.md) and [`docs/architecture.md`](docs/architecture.md).

Translators: see [`docs/i18n/CONTRIBUTING.md`](docs/i18n/CONTRIBUTING.md).

By contributing you agree that your code is licensed under the [MIT License](LICENSE),
and that art, models, sounds and translations you contribute are licensed under
[CC BY-NC-SA 4.0](LICENSE-ASSETS) (see [NOTICE.md](NOTICE.md)).

## Setup

The toolchain comes from the Nix flake (`use flake` via direnv, or `nix develop`):
Go, Node.js, golangci-lint, gotestsum, sops and the rest. Entering the shell also
installs the git hooks (`scripts/install-hooks.sh`) and registers Git LFS.

**Git LFS holds the board art** (`art/*.blend`, `frontend/public/models/**/*.glb`).
On a fresh clone run `git lfs pull` if the art came down as pointer files. Blender
is not in the flake; see `art/README.md`.

## Commands

Backend (Go, `modernc.org/sqlite`, no cgo):

- `go build ./cmd/costan` builds the server binary.
- `go test ./engine -run TestName` runs one package or one test (`-v` for verbose).
- `go run ./cmd/costan-sim -players 4 -ruleset base` plays a full bot-vs-bot game
  end to end (no network) and prints the transcript. Flags: `-ruleset
  base+islands|base+cak|base+fishermen|base+caravans|...`, `-dice fair`, `-bot
  strong|simple`, `-seed N`, `-n N -workers W` (parallel batch with a summary),
  `-quiet`.

**Changing Go dependencies** (`go.mod`/`go.sum`) also changes the Nix build's
`vendorHash` in `nix/package.nix`. The gate builds with plain `go`, so it will not
notice, but the server's `nix build` will fail with `hash mismatch in fixed-output
derivation`. Run `nix build .#costan`, copy the `got:` hash into `vendorHash`, and
build again before pushing.

Frontend (`cd frontend`):

- `npm run dev`, `npm run build` (`tsc -b && vite build`), `npm run typecheck`,
  `npm test` (vitest).

Local environment:

- `./dev.sh` serves backend and frontend on fixed ports (frontend 6767, backend
  6769, pprof 6771; override with `FE_PORT` / `BE_PORT` / `PPROF_PORT`), with a
  temporary database and dev sign-in enabled. It defaults to the Vite dev server,
  so hot reload is on and an edit mid-session drops the live websocket (a game in
  progress dies). `./dev.sh --built` serves a production build instead, which
  survives edits. Backend output goes to `backend.log`.

Server environment variables are documented in `cmd/costan/main.go` and
[DEPLOY.md](DEPLOY.md).

## The gate

Run the gate before you consider a change done. **Tests always run with `-race`**:
the engine's determinism and the actor model's concurrency guarantees depend on it.

- **`make gate`** runs every check, cheapest first, and stops at the first failing
  stage (each stage announces itself, e.g. `==> gate: frontend`, `==> gate: go`; a
  missing banner means that stage never ran):
  - `make test-tools`: the Blender-free Python tests under `tools/`.
  - `make gate-frontend`: `npm run typecheck`, then `npm test`, then a check that
    every recipe-built board tile is current. It runs `npm ci` first when
    `frontend/node_modules` is missing.
  - `make gate-go`: `go vet ./...`, then `go test -race` over every package via
    gotestsum, then the skip census (below).
- **`make gate-slow`** is the same with `COSTAN_SIM_SLOW=1`, which opts into the
  heavy seeded batches in `sim/`: thousands of games per ruleset checking card
  conservation, VP correctness, the bank never going negative, no orphaned roads,
  the determinism sweep across every ruleset and seed, and bot strength. It takes
  well over an hour. Run it whenever you touched `engine/`, `game/`, `bot/`,
  `store/` or `sim/`: those are what a simulated game is made of, `store/`
  included, because `replay(eventLog) == live state` is a claim about what SQLite
  handed back.
- Both gates pass a generous `-timeout` (`GATE_TIMEOUT` in the `Makefile`), since
  `sim` can exceed Go's 10-minute default under the race detector. A `panic: test
  timed out` naming a sim test is usually that ceiling, not a hang; run the package
  alone to check: `COSTAN_SIM_SLOW=1 go test -race -timeout 240m ./sim`.
- Neither gate runs the bot A/B ladders: they skip under `-race` and need
  `COSTAN_LADDERS`. Ask for them explicitly, without the race detector:
  `COSTAN_LADDERS=1 go test ./sim -run 'Ladder|Beats|Wins|Cost'`.
- Never symlink `frontend/node_modules` from another checkout. Packages then
  resolve out of the other checkout, React loads twice, and vitest fails hundreds
  of component tests with `Cannot read properties of null (reading 'useRef')`.
  `make gate-deps` refuses a symlinked `node_modules`; run `npm ci` instead.

There is no CI. The gate and the git hooks are the checks.

### The skip census

A green suite is not proof the tests ran: `t.Skip` prints `ok`. `scripts/skip-budget.py`
parses the `go test -json` stream, counts skips per package, and **fails on any skip
that is not opt-in**. A package with no entry in `scripts/skip-budget.json` is
budgeted at zero; the `exempt` patterns there are the environment-variable opt-ins
(`COSTAN_SIM_SLOW`, `COSTAN_LADDERS`, `LOADTEST`, `ROPROBE`, `COSTAN_FIXTURE`), each
with a written reason.

- It runs inside `make gate` off that run's own JSON, so it costs no second run.
- `make skip-budget` runs the tests and checks standalone; `./scripts/skip-budget.py
  --json FILE` checks a run you already made.
- `make skip-budget-update` rewrites the baseline. Read that diff: raising a budget
  is agreeing that a test may stop running.
- **Avoid conditional skips.** A test that skips when a seed fails to deal the
  state it needs is one board-generation change away from never running. Construct
  the state instead; where a search is genuinely needed, `t.Fatal` when its budget
  runs out.

## Lint

One command covers both languages, and it is **read-only unless you say `--fix`**:

- **`make lint`** (`./scripts/lint.sh`) reports on what your branch changed against
  `main`, plus anything uncommitted. Writes nothing.
- **`make lint-fix`** applies every autofix in the same scope, then reports what no
  fixer can take. It announces itself before writing and prints `git status --short`
  afterwards. Read the diff: autofixers can misplace edits.
- **`make lint-all`** lints the whole tree. Run it before merging, because a scoped
  run cannot see an `unused` finding whose last caller was deleted elsewhere.
- `--staged` (index only) and `--since REF` select other scopes.

The pre-commit and pre-merge-commit hooks run `lint.sh --staged` on every commit
(instant when nothing lintable is staged). `scripts/install-hooks.sh` installs them,
and the flake's shell hook calls it. Do not skip them (`--no-verify`,
`COSTAN_SKIP_LINT=1`) for anything that is going to `main`.

Where a lint rule is wrong, change the rule and write down why in the config
(`.golangci.yml`, `frontend/eslint.config.js`) rather than working around it.

`scripts/lint.sh` gives each checkout its own golangci-lint cache (inside that
checkout's git directory), so removing a worktree removes its cache too. If you run
golangci-lint by hand and it reports findings in files that do not exist, its
shared cache is stale: run `golangci-lint cache clean`.

**Frontend design-system rules.** ESLint enforces the Tailwind theme in
`frontend/src/index.css` and the primitives under `@/components/ui`: `no-restyle` (a
caller passes only layout to a primitive), `no-raw-colors`, `no-arbitrary-values`,
`no-inline-styles`, `no-unknown-classes`, `require-static-classes`. Findings that
predate the rules are budgeted per file per rule in
`frontend/eslint-suppressions.json`, and the budget only goes down: fix a finding,
then `make lint-fix` (or `npx eslint --prune-suppressions <files>`) lowers it. A new
file is held to zero. To take a single exception, say why on the line:
`// eslint-disable-next-line shadcn/<rule> -- <reason>`. A runtime value such as a
seat colour goes through a custom property: `style={{ "--swatch": hex } as
React.CSSProperties}` with `className="bg-(--swatch)"`.

## Architecture invariants

The layers, top to bottom: HTTP (`server/`: `/auth/*`, `/api/*`, `/ws`) → Hub
(connection registry, routes client messages to a lobby or a game) → `lobby/` and
`game/` (the game manager) → `engine/` (pure rules) → `store/` (SQLite). The rules
engine knows nothing about transport or storage.

Violating any of these three invariants is a bug:

1. **The engine is pure and deterministic.** `engine/` imports nothing outside the
   standard library except its own subpackages. It is a function `(State, Command)
   → ([]Event, error)` plus a fold `Apply(State, Event) → State`. No I/O, no clocks,
   no unseeded randomness: dice, shuffles and board generation all come from RNGs
   seeded by the `game_created` event at log position 0, so `replay(events)`
   reproduces a game exactly.
2. **Event sourcing is the source of truth.** The append-only event log is primary;
   in-memory state is a fold over it and snapshots are only an optimisation. This is
   what gives replays, crash safety and reproducible bugs (any bug report's event log
   becomes a regression fixture). **Persist, then broadcast**: events reach SQLite
   before any client sees them.
3. **Clients only receive redacted views.** Hidden information (hands, face-down
   cards, fog) is redacted in `game/`, never in the engine and never trusted to the
   client. Each event carries `Visible []PlayerID` listing the seats that may see the
   full payload (nil means public); the redactor produces per-viewer streams.

**Actor model.** Each running game is owned by exactly one goroutine
(`game/actor.go`). Commands arrive on its channel and it is the sole writer of that
game's state and log, so there is no locking across the rules engine. Websocket
connections are dumb pipes. SQLite runs in WAL mode, and `store/` keeps two handles:
a one-connection writer and a small read-only pool, so lobby, replay and stats reads
run concurrently with game writes. The read pool is never used inside a write
transaction. See [`docs/storage.md`](docs/storage.md).

### Engine modules

Expansions are **composable modules**, not feature flags in the core. A game's
`Ruleset` is assembled from modules; the core runs the base state machine and
modules extend it at defined `Hooks` (`OnDiceRolled`, `OnEvents`, `Blocks`/`Auto`,
`RouteEdges`/`RouteWeights`, `VictoryCheck`, `BankRatio`, ...), plus optional
interfaces a module may implement (`ConfigDefaulter`, `BoardRadiuser`,
`TerrainRequirer`, `Standalone`, `BoardFinisher`). Each module owns its package and
its state in `State.Ext[name]`:

- `engine/`: the base game (directly in the package; a `core/` subpackage would
  force an import cycle on `State`).
- `engine/board/`: the hex grid, procedural generation (rings scale with player
  count for 7 to 10), map presets.
- `engine/islands/`, `engine/knights/` (Knights), `engine/scenarios/` (Fishermen and
  Caravans), `engine/harbormaster/`, `engine/rivers/`, `engine/raiders/`,
  `engine/wagons/`, `engine/explorers/`: one package per mode. Register them with a
  blank import (see `cmd/costan-sim/main.go`) so non-base rulesets resolve.

**`SetupBoard` order is not a dependency order**: it is the lexicographic sort of
the ruleset string. A module whose board work depends on what every other module
did must implement `BoardFinisher` and do it there. See
[`docs/engine.md`](docs/engine.md).

When adding or changing rules, add table-driven tests in the module and rely on the
simulation tests in `sim/`. The determinism property, that `replay(eventLog)` equals
the live final state, is asserted across the suite.

### The fairness audit is a port

`verify/*.mjs` reimplements in JavaScript every derivation a player can see: Go's
`math/rand/v2` PCG, `uint64n`, `Shuffle` and `Perm`; the dice and the fair deck;
board generation including the fair-mode local search; the module board hooks; the
seating shuffle. Players run it to check a game was not rigged
([`docs/dice.md`](docs/dice.md)).

Nothing about editing the Go makes a `.mjs` file complain, so **if `go test ./verify`
fails after you changed board generation or the dice, the port is out of date, not
the engine**: re-port the change. The test needs `node` on PATH (the flake provides
it) and skips without it. `verify/dist/verify.js` is generated (`node
scripts/bundle-verify.mjs`) and committed; a test fails when it is behind.

Two things there are frozen: `rngFor`'s derivation (`seq*φ+1`), because every game
ever played is audited against it, and the commitment being written when the
**lobby opens** rather than at game start. Reserve a new random stream by picking an
unused `seq`, never by changing the formula.

## Conventions

- **Player mistakes are cheap and recoverable; engine bugs are loud and frozen.** An
  illegal or out-of-turn command gets an `err` frame and leaves state untouched
  (never a disconnect). An engine invariant violation marks the game `paused-error`
  and preserves the log for exact reproduction. Never guess or corrupt state.
- **No em dashes (U+2014) anywhere in the repository.** That covers UI copy, code,
  comments, logs, tests, docs and data. Use a period, comma, colon, semicolon or
  parentheses instead. Where the dash is structural: a colon for label/value
  separators (`Name: 1450`), an en dash (`–`) for empty table cells. In a test that
  asserts text has no em dash, write the escape `\u2014` rather than the character.
  Translations follow the same rule.
- **The backend sends codes, not prose.** User-facing text lives in the frontend's
  message catalogues; see [`docs/user-facing-text.md`](docs/user-facing-text.md).
- **Schema changes** go in numbered `store/migrations/NNNN_*.sql` files.
- **`docs/` is implementation-grade and kept current.** `docs/rules/` holds the rules
  of every mode in our own words. Read the relevant doc before changing a subsystem,
  and update it in the same change.

### Naming

costan is an independent game and its code, comments and docs use its own names.
The **game's title and the expansion titles** are our own (the
expansions are "Islands", "Knights", "Rivers" and so on), and no other game's
trademarked titles appear anywhere in the repository. Use generic functional terms
in code (roads, settlements, cities).

That rule is narrow. Card names, resource names and mechanic names are ordinary
descriptive phrases (Longest Road, Year of Plenty, Master Merchant, Bishop and so on)
and are used as they are. Translations follow the same rule: **translate our English
faithfully**. Where the natural word in another language for a card or a piece
happens to be the familiar one, that is correct. Only the game title and the
expansion names get a different word, and ordinary nouns (the usual
word for "settlement" or "road") must not be swapped for awkward substitutes.

## Submitting changes

Contributions arrive as pull requests; the repository has no issue tracker. A bug
report is most useful as a pull request that adds a failing test (an event log from
the affected game makes a good regression fixture), and a proposed change is best
discussed in the pull request that makes it. Security vulnerabilities are the
exception: report them privately as described in [SECURITY.md](SECURITY.md).
