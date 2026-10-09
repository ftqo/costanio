package verify

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/replay"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// auditedBoard renders a board as the audit sees it, via the board's own
// MarshalJSON (the wire form verify.mjs re-reads in normalizeBoard).
//
// It hashes the board, not the event payload: a field added to
// EvBoardGenerated only to transport state changes no derivation and must not
// force a version bump, which would make every earlier game uncheckable. The
// board's wire form is slightly wider than what normalizeBoard compares, so a
// transport-only field on Board itself would still trip this; narrow to what is
// compared rather than bump.
func auditedBoard(b *board.Board) string {
	raw, err := json.Marshal(b)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

// auditedBoardExt renders the board-derived module state exactly as the audit
// compares it (verify.mjs's verifyBoardExt against modules.mjs's boardExtFor):
// the fishing grounds, the Caravans oasis with its three spokes, and the Rivers
// watercourse with its channel edges and bridge sites.
//
// Narrowed for the reason auditedBoard gives: the ext blob also carries
// opening bookkeeping (bid map, supplies, opening coins) that depends only on
// the ruleset and player count. Hash what is compared.
func auditedBoardExt(ext map[string]json.RawMessage) string {
	if len(ext) == 0 {
		return ""
	}
	var out strings.Builder
	// Fixed order: a map's range order is not one.
	for _, mod := range []string{"fishermen", "caravans", "rivers", "raiders", "wagons", "explorers"} {
		raw, ok := ext[mod]
		if !ok {
			continue
		}
		var blob map[string]json.RawMessage
		if err := json.Unmarshal(raw, &blob); err != nil {
			panic(err)
		}
		// One key list across all six modules, keyed by the JSON name each
		// module marshals: a key absent from a blob is skipped, so "Grounds"
		// only ever matches Fishermen's and the lowercase "rivers" only ever
		// matches the Rivers module's own field (its json tag is `rivers`,
		// inside the blob stored under the module name "rivers").
		//
		// The keys the seed decided, per module. Fishermen, Caravans and
		// Wagons have no json tags on their ext, so they use Go field names;
		// Rivers and Raiders use their tags. Anything else is a constant of the
		// ruleset or player count.
		for _, key := range []string{
			"Grounds", "Lakes", "Oasis", "HasOasis", "Oases", "Arrows", "ArrowCorner",
			"rivers",
			"castle", "has_castle", "land", "coast", "raider_count", "supply",
			"Trade", "Roles", "HasTrade", "Barbarians",
			// Explorers' keys are its json tags (its Ext has an untransported
			// play half, so every recorded field is tagged). All six are
			// board-derived; the pool is the whole face-down map.
			"home", "waters", "pool", "chits", "council", "anchors",
		} {
			v, ok := blob[key]
			if !ok {
				continue
			}
			fmt.Fprintf(&out, " %s.%s=%s", mod, key, v)
		}
	}
	return out.String()
}

// derivationFingerprint is the recorded output of every published derivation
// for engine.DerivationVersion.
//
// A digest that moves is not a derivation that moved. Bump DerivationVersion
// only when an existing ruleset's output changes, since a bump makes every
// earlier game unauditable. When the sweep merely widens (new rows, keys or
// slots), recompute the digest under the same version, and confirm it by
// removing the new rows and reproducing the previous digest.
const derivationFingerprint = "7d648d33834e5108f2e3acb2f6891a33b3a0dd21a72dcdb2a37a4775f751b6a2"

func TestDerivationFingerprint(t *testing.T) {
	var b strings.Builder
	fmt.Fprintf(&b, "derivation_version=%d\n", engine.DerivationVersion)

	// The board, per ruleset x mode x player count. Player count matters
	// because the radius (and so the ring the modules carve) scales with it.
	//
	// 64 seeds: a real derivation change (an FMA divergence in solve.go)
	// first showed at seed 50. Narrowing the window narrows what this catches.
	rulesets := []string{
		"base",
		"base+islands",
		"base+cak",
		"base+fishermen",
		"base+caravans",
		engine.CanonicalRuleset("base+islands+caravans"),
		engine.CanonicalRuleset("base+islands+fishermen+caravans"),
		// Rivers, solo and composed. The composition pins the order: Rivers
		// paints a board Caravans and Fishermen have already reshaped. The
		// player-count sweep matters here: 3-4 players get one river, 8 get
		// three, which is where DeriveRivers' length-cap descent fires.
		"base+rivers",
		engine.CanonicalRuleset("base+islands+rivers"),
		engine.CanonicalRuleset("base+caravans+fishermen+rivers"),
		// Raiders, solo and with Islands. Solo exercises the ext layer and the
		// robber leaving the board; the Islands pairing is the only place the
		// landmass repair can fire, since it needs sea inside the board.
		"base+raiders",
		engine.CanonicalRuleset("base+islands+raiders"),
		// Wagons. Its board layer draws from a seed too.
		"base+wagons",
		engine.CanonicalRuleset("base+caravans+wagons"),
		// Rivers routes round the Wagons trade-hex candidates, so the pairing
		// is its own derivation.
		engine.CanonicalRuleset("base+rivers+wagons"),
		// Fishermen with Wagons (the lake is kept off the capes and trade
		// candidates); Raiders with Rivers (the castle steps off the
		// watercourse); Harbormaster with Wagons (harbour placement).
		engine.CanonicalRuleset("base+fishermen+wagons"),
		engine.CanonicalRuleset("base+raiders+rivers"),
		engine.CanonicalRuleset("base+harbormaster+wagons"),
		// A Standalone: its name is its whole ruleset. Most of its board is
		// dealt face down, so the deal must be audited.
		"explorers",
		// The Knights pairing, whose rule B re-deals one starting-island forest
		// as fields. Both spellings of the scenario must hold.
		engine.CanonicalRuleset("cak+explorers"),
	}
	for _, ruleset := range rulesets {
		for _, mode := range []string{"fair", "random"} {
			for _, players := range []int{3, 4, 5, 6, 8} {
				for seed := uint64(1); seed <= 64; seed++ {
					cfg := engine.GameConfig{Players: players, Ruleset: ruleset, BoardMode: mode}
					events, err := engine.New(cfg, engine.SeedsFrom(seed))
					if err != nil {
						t.Fatalf("%s/%s/%dp/seed %d: %v", ruleset, mode, players, seed, err)
					}
					for _, e := range events {
						if e.Type != engine.EvBoardGenerated {
							continue
						}
						d := engine.DecodeEvent[engine.BoardGeneratedData](e)
						if d.Board == nil {
							t.Fatalf("%s/%s/%dp/seed %d: board_generated carried no board", ruleset, mode, players, seed)
						}
						fmt.Fprintf(&b, "board %s %s %d %d %s%s\n",
							ruleset, mode, players, seed, auditedBoard(d.Board), auditedBoardExt(d.Ext))
					}
				}
			}
		}
	}

	// The public stream slots. A slot that moves invalidates old games just as
	// a generator change does (see engine.EventDieSeq).
	for seed := uint64(1); seed <= 4; seed++ {
		for n := range 12 {
			fmt.Fprintf(&b, "eventdie %d %d %d\n", seed, n,
				engine.PublicRngForSeed(seed, engine.EventDieSeq(n)).IntN(6))
			fmt.Fprintf(&b, "roll %d %d %d\n", seed, n,
				engine.PublicRngForSeed(seed, n).IntN(6))
			fmt.Fprintf(&b, "fishboot %d %d %d\n", seed, n,
				engine.PublicRngForSeed(seed, engine.FishBootSeq(n)).IntN(30))
			fmt.Fprintf(&b, "raiders %d %d %d\n", seed, n,
				engine.PublicRngForSeed(seed, engine.RaidersSeq(n)).IntN(6))
			fmt.Fprintf(&b, "wagondie %d %d %d\n", seed, n,
				engine.PublicRngForSeed(seed, engine.WagonsDieSeq(n)).IntN(6))
		}
		for _, players := range []int{3, 4, 6, 8} {
			fmt.Fprintf(&b, "seats %d %d %v\n", seed, players, engine.SeatOrder(seed, players))
		}
		// The Wagons board slot is a single fixed reservation rather than a run,
		// because the draw happens once per game.
		fmt.Fprintf(&b, "wagonboard %d %v %v\n", seed,
			engine.PublicRngForSeed(seed, engine.WagonsBoardSeq).IntN(2),
			engine.PublicRngForSeed(seed, engine.WagonsBoardSeq).Perm(3))
		// And the Rivers variant slot, which is the same shape: one fixed
		// reservation read once per game, off the finished layout.
		fmt.Fprintf(&b, "riversvariant %d %v\n", seed,
			engine.PublicRngForSeed(seed, engine.RiversVariantSeq).IntN(2))
		// The fishing-ground number deal (derivation 12): one fixed slot, read
		// once per game.
		fmt.Fprintf(&b, "fishgrounds %d %v\n", seed,
			engine.PublicRngForSeed(seed, engine.FishGroundsSeq).Perm(6))
		// The lakes' number deal (derivation 13): one fixed slot, read once per
		// game.
		fmt.Fprintf(&b, "fishlakes %d %v\n", seed,
			engine.PublicRngForSeed(seed, engine.FishLakesSeq).Perm(3))
	}

	sum := sha256.Sum256([]byte(b.String()))
	got := hex.EncodeToString(sum[:])
	if derivationFingerprint == "" {
		t.Fatalf("no fingerprint recorded yet; set derivationFingerprint to %q", got)
	}
	if got != derivationFingerprint {
		t.Fatalf("derivation output differs from version %d\n"+
			"got  %s\nwant %s\n"+
			"if intended: bump engine.DerivationVersion, record the new digest, re-port verify/*.mjs, "+
			"run node scripts/bundle-verify.mjs",
			engine.DerivationVersion, got, derivationFingerprint)
	}
}

// TestDerivationBumpKeepsOldLogs: a derivation bump changes Decide, never Apply.
// A log recorded by any build must fold back to the state it recorded, so no
// Apply path may re-derive from the seed. The test folds each log with its real
// seeds and again with seeds it never saw, and requires identical frames.
//
// The comparison is replay.FoldRevealed (every frame with every hand revealed);
// engine.State itself will not marshal because its building map is keyed by a
// struct.
func TestDerivationBumpKeepsOldLogs(t *testing.T) {
	for _, ruleset := range []string{
		"base",
		"base+fishermen",
		"base+caravans",
		"base+islands",
		"base+cak",
		engine.CanonicalRuleset("base+cak+caravans+fishermen"),
		// Rivers' layout is chosen by the public seed rather than computed
		// from the board, so a fold reading the seed would replay a different
		// watercourse.
		"base+rivers",
	} {
		t.Run(ruleset, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			res, err := sim.RunGame(st, sim.Options{
				Players: 4, Ruleset: ruleset, DiceMode: "fair", BoardMode: "fair", Seed: 77,
			})
			if err != nil {
				t.Fatalf("running the game: %v", err)
			}
			events, err := st.LoadEvents(res.GameID, 0)
			if err != nil {
				t.Fatal(err)
			}

			// The same log, claiming seeds this game was never played on. A fold
			// that reads the log rather than the seed cannot notice.
			stranger := make([]engine.Event, len(events))
			copy(stranger, events)
			if stranger[0].Type != engine.EvGameCreated {
				t.Fatalf("event 0 is %q, not game_created", stranger[0].Type)
			}
			var created engine.GameCreatedData
			if err := json.Unmarshal(stranger[0].Data, &created); err != nil {
				t.Fatal(err)
			}
			created.Seed ^= 0xdeadbeefcafef00d
			created.PublicSeed ^= 0x0123456789abcdef
			raw, err := json.Marshal(created)
			if err != nil {
				t.Fatal(err)
			}
			stranger[0].Data = raw

			// Compare the views only: Frame.Event and Meta.Seed echo the edited
			// log and differ by construction.
			foldOf := func(evs []engine.Event) string {
				t.Helper()
				f, err := replay.FoldRevealed(res.GameID, evs)
				if err != nil {
					t.Fatalf("folding the log: %v", err)
				}
				views := make([]*game.FullView, len(f.Frames))
				for i, fr := range f.Frames {
					views[i] = fr.View
				}
				b, err := json.Marshal(views)
				if err != nil {
					t.Fatal(err)
				}
				return string(b)
			}
			if foldOf(stranger) != foldOf(events) {
				t.Errorf("%s: fold depends on the seed", ruleset)
			}
		})
	}
}
