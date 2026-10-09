# Blender is not in the nix flake (multi-GB closure, and the export scripts must
# run the same install you author in). Resolution order: BLENDER=, a local
# unpacked build, the macOS app bundle, then PATH.
BLENDER ?= $(shell \
	if [ -x "$$HOME/blender/blender-5.2.0-linux-x64/blender" ]; then \
		echo "$$HOME/blender/blender-5.2.0-linux-x64/blender"; \
	elif [ -x "/Applications/Blender.app/Contents/MacOS/Blender" ]; then \
		echo "/Applications/Blender.app/Contents/MacOS/Blender"; \
	else \
		command -v blender || echo blender; \
	fi)

.PHONY: gate gate-slow gate-go gate-go-slow gate-frontend gate-deps lint lint-fix lint-all skip-budget skip-budget-update hooks art-live placement-live export-tiles export-assets compose-tiles compose-check compose-audit compose-review beach-mirror compress-models test-tools bake-icons card-faces title-fonts robbers verify-split check-hexes board board-shot board-fixture ui-smoke

# The gate.
#
#     make gate        every check, for any change              (~2m40s)
#     make gate-slow   the same, plus sim/'s heavy batches       (~50m)
#
# Some contracts span both languages (the .po catalogues must carry every error
# code: checked by vitest and by server.TestFrontendCopyCoversEveryTransportCode),
# so both halves run every time. Cheapest first:
#
#   test-tools      python, the bpy-free half of tools/
#   gate-frontend   tsc -b --noEmit, then vitest (npm ci first in a fresh
#                   checkout), then compose-check: every recipe-built tile
#                   is current
#   gate-go         go vet, go test -race, then the skip census
#                   (the census re-reads the JSON; it does not re-run tests)
#
# The census reads the `go test -json` stream gate-go writes to $(GATE_JSON).
# For a single package, use go test directly.
gate: test-tools gate-frontend gate-go
	@printf '\n==> gate: clean.\n'

gate-slow: test-tools gate-frontend gate-go-slow
	@printf '\n==> gate (slow): clean.\n'

# Where the `go test -json` stream lands. Gitignored; override to keep it.
GATE_JSON ?= .gate.json

# Narrow the Go half: `make gate-go GATE_PKGS=./lifecycle`. The skip census then
# only sees the named packages, so this is not a full gate.
GATE_PKGS ?= ./...

# gotestsum prints the human view live and writes the JSON for the census.
#
# Go's default timeout is 10 minutes per package, which `sim` can exceed under
# -race on a loaded machine (`panic: test timed out` naming a sim test). Both
# gates share one ceiling, sized for the slow gate on a busy machine: the slow
# `sim` run alone takes about two hours under -race. If it fires, run sim alone
# to tell load from a hang:
#
#     COSTAN_SIM_SLOW=1 go test -race -timeout <ceiling> ./sim
GATE_TIMEOUT ?= 240m

gate-go:
	@printf '\n==> gate: go (vet, race tests, skip census)\n'
	go vet ./...
	gotestsum --format pkgname --jsonfile $(GATE_JSON) \
		-- -race -timeout $(GATE_TIMEOUT) $(GATE_PKGS)
	./scripts/skip-budget.py --json $(GATE_JSON)

# The slow half; see CONTRIBUTING.md.
gate-go-slow:
	@printf '\n==> gate: go SLOW (vet, race tests with COSTAN_SIM_SLOW, skip census)\n'
	go vet ./...
	COSTAN_SIM_SLOW=1 gotestsum --format pkgname --jsonfile $(GATE_JSON) \
		-- -race -timeout $(GATE_TIMEOUT) $(GATE_PKGS)
	./scripts/skip-budget.py --json $(GATE_JSON)

# vitest does not type-check, so tsc runs too. scripts/lint.sh only typechecks
# when a frontend file is in scope, which misses backend changes that add an
# error code.
gate-frontend: gate-deps
	@printf '\n==> gate: frontend (typecheck, vitest, composed tiles)\n'
	cd frontend && npm run typecheck
	cd frontend && npm test
	$(MAKE) compose-check

# Runs `npm ci` once in a fresh clone or worktree.
#
# Go's `./...` does not skip node_modules, so go vet/test also see
# frontend/node_modules/flatted/golang/pkg/flatted (an npm package that ships
# Go). It vets clean today.
#
# Refuses a symlinked node_modules: packages would resolve from the other
# checkout, React would load twice, and vitest fails with `Cannot read
# properties of null (reading 'useRef')`.
gate-deps:
	@if [ -L frontend/node_modules ]; then \
		echo "==> frontend/node_modules is a symlink; a shared install loads React twice."; \
		echo "    Fix: rm frontend/node_modules && make gate-deps"; \
		exit 1; \
	fi
	@if [ ! -d frontend/node_modules ]; then \
		echo "==> frontend/node_modules is missing; npm ci (once per checkout)"; \
		cd frontend && npm ci; \
	fi
	@if [ -L frontend/node_modules/react ]; then \
		echo "==> frontend/node_modules/react is a symlink out of this checkout."; \
		echo "    Fix: rm -rf frontend/node_modules && make gate-deps"; \
		exit 1; \
	fi

# Lint, both languages, one command. See CONTRIBUTING.md "Lint".
#
# `make lint` reports on this branch's changes and writes nothing. `make
# lint-fix` takes every autofix and then reports what no fixer can take.
# `make lint-all` is the whole-tree pass to run before merging.
lint:
	./scripts/lint.sh

lint-fix:
	./scripts/lint.sh --fix

lint-all:
	./scripts/lint.sh --all

# The skip census: fail when a test stops running and the gate still says "ok".
#
#     make skip-budget            # run the tests, then check
#     make skip-budget ARGS=./engine/...   # narrow it
#     make skip-budget-update     # record today's counts, then read the diff
#
# To check a run you already made (`make gate` does this):
#
#     gotestsum --jsonfile /tmp/gate.json -- -race ./...
#     ./scripts/skip-budget.py --json /tmp/gate.json
#
# Do not pipe `go test -json` through test2json: it double-wraps the stream and
# the census then sees zero tests.
#
# See scripts/skip-budget.py and scripts/skip-budget.json.
skip-budget:
	./scripts/skip-budget.py $(ARGS)

skip-budget-update:
	./scripts/skip-budget.py --update $(ARGS)

# Install the pre-commit / pre-merge-commit hooks. The nix flake's shellHook
# does this for you; this target is for anyone not using the flake.
hooks:
	./scripts/install-hooks.sh --verbose

# cwebp is not in the flake; borrow it per command. Override with `WEBP_RUN=` if
# cwebp is on PATH. The backslash matters: an unescaped `#` starts a Makefile
# comment.
WEBP_RUN ?= nix shell nixpkgs\#libwebp -c

ICONS := wood brick sheep wheat ore cloth paper coin
ICON_PROTO := art/prototypes/resource-icons
ICON_DEST := frontend/public/assets

# Regenerate every .glb, the manifest, and palette.json from the blends, in one
# Blender process (the manifest and palette cover all of them; see `ORDER` in
# tools/blender/export_assets.py). palette.json is write-once and reports drift
# rather than overwriting hand edits.
# `ARGS=<family>` exports one family (`ARGS=beach`) and skips the manifest and
# palette.
export-assets:
	$(BLENDER) --background --factory-startup --python tools/blender/export_assets.py -- $(ARGS)
	$(MAKE) compress-models

# Recipe-built tiles: compose them out of their components, then compress.
#
#     make compose-tiles     write frontend/public/models/tiles/<key>.glb for
#                            every art/recipes/<key>.json, and the manifest's
#                            composed half (manifest.composed.generated.ts)
#     make compose-check     compose in memory and byte-compare against what
#                            ships; non-zero if anything drifted (~3s, in the gate)
#     make compose-review    photograph every composed tile beside its base in
#                            the real renderer; sheets land in .compose-review/
#     make compose-audit     measure every shipped composed tile for floating
#                            water, ground through the paving, orphaned parts,
#                            props inside props and hovering (per tile, per
#                            ground); compose.audit.test.ts holds it in vitest
#
# No Blender: the composer is a Node script over the shipped base tiles and the
# parts under art/trade/parts/. See art/README.md, "Recipe-built tiles".
compose-tiles:
	cd frontend && node scripts/compose-tiles.ts
	$(MAKE) compress-models

compose-check:
	cd frontend && node scripts/compose-tiles.ts --check

compose-audit:
	cd frontend && node scripts/compose-audit.ts $(ARGS)

COMPOSE_PORT ?= 6794

# The review sheets. Serves this checkout's frontend on COMPOSE_PORT for the
# length of the run and stops it after. `ARGS='--only trade_hills'` narrows it.
compose-review:
	@cd frontend && { npx vite --port $(COMPOSE_PORT) --strictPort --host 127.0.0.1 >/dev/null 2>&1 & pid=$$!; \
	  for i in $$(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:$(COMPOSE_PORT)/dev/compose-review.html && break; sleep 0.5; done; \
	  node dev/compose-review.mjs --url http://127.0.0.1:$(COMPOSE_PORT) --out ../.compose-review \
	    --log ../.compose-review/compose-log.json $(ARGS); s=$$?; kill $$pid; exit $$s; }
	@echo "compose-review: .compose-review/sheet_*.jpg"

# Rewrite art/beach.blend's beach meshes from tools/blender/lattice.py, which
# mirrors frontend/src/lib/board3d/beachGeometry.ts.
#
# Run it after changing a beach constant in the TypeScript and in lattice.py
# (test_lattice.py fails until they agree), then re-export:
#
#     make beach-mirror && make export-assets ARGS=beach
beach-mirror:
	$(BLENDER) --background --factory-startup --python tools/blender/rebuild_beach_mirror.py

# Meshopt-compress every .glb under frontend/public/models, in place.
#
# Chained onto the export targets (the exporters write plain float32, about 3x
# the bytes). Already-compressed files are skipped. See
# frontend/scripts/compress-models.mjs, including which names it must preserve.
compress-models:
	cd frontend && npm run models:compress

# Just the tiles, from art/hexes/. The fast half of export-assets while
# iterating on one tile's art.
export-tiles:
	$(BLENDER) --background --factory-startup --python tools/blender/export_tiles.py
	$(MAKE) compress-models

# Export every tile from its own file and byte-compare against what ships, then
# `compose-check`. Non-zero exit if any tile drifted.
verify-split:
	$(BLENDER) --background --factory-startup --python tools/blender/split_verify.py
	$(MAKE) compose-check

# Link every per-tile blend into art/board.blend, staged on the lattice.
#
# For viewing tiles among their neighbours; linked data is read-only. Edit the
# per-tile blend instead.
board:
	$(BLENDER) --background --factory-startup --python tools/blender/build_board.py

ART_PORT ?= 6790

# The live loop: dev server plus a watcher over every blend in the pipeline.
#
#     make art-live   ->  http://localhost:$(ART_PORT)/dev/board-live.html
#
# Save a tile, piece or robber in Blender and the page redraws in about a second.
#
# Ctrl-C stops both.
art-live:
	@echo "art-live: http://localhost:$(ART_PORT)/dev/board-live.html"
	@node tools/watch_art.mjs & \
	 cd frontend && npx vite --port $(ART_PORT) --strictPort --host 127.0.0.1; \
	 kill %1 2>/dev/null || true

PLACEMENT_PORT ?= 6792

# The placement bench: how the board says where a piece may go.
#
#     make placement-live  ->  http://localhost:$(PLACEMENT_PORT)/dev/placement-live.html
#
# Initial placement, the robber and a knight, each with switchable treatments,
# plus a turn clock that commits the hovered spot instead of passing. Draws the
# real Board3D.
placement-live:
	@echo "placement-live: http://localhost:$(PLACEMENT_PORT)/dev/placement-live.html"
	@cd frontend && npx vite --port $(PLACEMENT_PORT) --strictPort --host 127.0.0.1

BOARD_PROTO := art/prototypes/board
BOARD_FIXTURE := frontend/dev/board-shots.board.json

# Photograph a whole board through the three.js renderer that actually ships.
#
# Unlike `make board`, this shows the runtime-built gutter sand, coastline and
# harbour sign, and palette.json's colours. The board is dumped from the engine;
# re-dump it with `make board-fixture`.
board-shot:
	node frontend/dev/board-shot.mjs $(BOARD_PROTO)
	@echo "board-shot: $(BOARD_PROTO)/ (bearing-000.jpg is the game's opening pose)"

# Create, start and photograph one table per ruleset through the UI. Needs
# ./dev.sh running (FE 6767). Exits non-zero on a browser console error, a
# greyed-out switch, or a ruleset the server did not settle on. Not in the gate
# (it needs a live server); run it before calling an expansion ready.
ui-smoke:
	node frontend/dev/ui-smoke.mjs
	@echo "ui-smoke: shots in .ui-smoke/"

# Regenerate the committed board the harness renders. Deterministic on -seed.
board-fixture:
	go run ./cmd/costan-sim -players 4 -ruleset base -seed 20260812 \
		-dump-board $(BOARD_FIXTURE)

# Measure every per-tile blend and hold it to the hex contract. Non-zero exit
# if a tile breaks a rule. `--json` (pass with ARGS=--json) dumps raw
# measurements instead, for deciding what a new constant should be.
check-hexes:
	$(BLENDER) --background --factory-startup --python tools/blender/check_hexes.py -- $(ARGS)

# The bpy-free half of the pipeline, testable without launching Blender.
test-tools:
	python3 -m unittest discover -s tools/blender -p 'test_*.py' -v

ROBBER_PROTO := art/prototypes/robbers

# Rebuild the twenty robber prototypes and photograph them.
#
# `art/robbers.blend` is generated from `robber_designs.py`, and the frames
# under $(ROBBER_PROTO) from the blend. Change a profile and re-run.
#
# Renders run against art/board.blend so robbers are seen on the board through
# the game camera; re-run `make board` first if a tile changed. Re-shoot part of
# the set by naming stages:
#
#     make robbers ROBBER_STAGES="sheet study"
#
# Stages are set|play|study|finish|sheet; the default is all of them.
robbers:
	$(BLENDER) --background --factory-startup --python tools/blender/build_robbers.py
	$(BLENDER) art/board.blend --background --python tools/blender/render_robbers.py \
		-- $(ROBBER_PROTO) $(ROBBER_STAGES)
	@echo "robbers: art/robbers.blend + $(ROBBER_PROTO)/ (start at sheet.jpg)"

# There is no `rivers` target: the Rivers tiles are hand-modelled (see
# art/README.md), and a generator target could overwrite them.
#
# The stills regenerate from the blends. Subjects are hero|board|detail, all
# three by default:
#
#   blender --background --factory-startup \
#       --python tools/blender/render_rivers.py \
#       -- art/prototypes/river-tiles [hero|board|detail]

# Re-bake the eight resource icons from the hero props through to the files the
# game loads. Geometry is `tools/blender/icons/props.py`, framing is
# `render_icons.py`. The bake writes contour and no-contour variants at 96 and
# 384 into ICON_PROTO (the 384s are not committed), then encodes the 96 contour
# bake into the slot files.
#
# Lossless with `-exact`: lossy alpha would smear the hidden colour of
# transparent pixels into the edge as a halo.
#
# The manifest is untouched: the icons go live only when the eight
# `"ext": "svg"` entries in `frontend/public/assets/manifest.json` become
# `"webp"`.
bake-icons:
	HERO_OUTLINE=0.026,0 HERO_GLB=frontend/public/models/resicons.glb \
		$(BLENDER) --background --factory-startup \
		--python tools/blender/icons/render_icons.py -- $(ICON_PROTO)
	rm -f $(ICON_PROTO)/*-384.png
	$(WEBP_RUN) bash tools/icons/encode_webp.sh $(ICON_PROTO) $(ICON_DEST) $(ICONS)
	@echo "baked: $(ICONS) -> $(ICON_DEST)/icon_*.webp (manifest untouched)"

# Encode the untitled card masters into the slot files the game loads.
#
# art/cards/masters holds untitled 1000x1400 renders; the frontend draws the
# title in the player's language (localization.md §4.3). Cards without a master
# keep their baked English art, so `untitled: true` in
# frontend/public/assets/manifest.json is set per slot.
card-faces:
	$(WEBP_RUN) bash tools/cards/encode_faces.sh art/cards/masters $(ICON_DEST)
	python3 scripts/strip-asset-metadata.py $(ICON_DEST)
	@echo "encoded the untitled masters; set \"untitled\": true on any new slot in manifest.json"

# Rebuild the four card-title webfont subsets and the metric table the fitter
# reads. Run it after any card title changes in any catalogue; `npm test` fails
# with the same message if you forget.
title-fonts:
	python3 frontend/scripts/gen-title-fonts.py
