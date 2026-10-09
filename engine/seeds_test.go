package engine

import "testing"

// TestPublicSlotsDoNotCollide enumerates every reserved slot on the public
// stream and requires them to be distinct.
//
// The public seed is revealed at game end, and rngFor(pub, seq) is a pure function
// of the pair, so two consumers sharing a seq share every draw and one public
// outcome predicts another. The dice, the fair deck and the event die each take a
// run of slots, so ranges are swept, far past anything a real game reaches.
func TestPublicSlotsDoNotCollide(t *testing.T) {
	owner := map[int]string{}
	claim := func(who string, seq int) {
		t.Helper()
		if prev, ok := owner[seq]; ok {
			t.Fatalf("public stream slot %d claimed by both %s and %s", seq, prev, who)
		}
		owner[seq] = who
	}

	// Board generation, SetupBoard and FinishBoard take 1, 2 and 3, once,
	// before the log has any roll in it.
	for _, seq := range []int{1, 2, 3} {
		claim("board generation", seq)
	}

	// The dice take the log position of the roll. That range nominally
	// includes 1-3; it avoids board generation only because the log opens
	// with game_seeded, game_created, board_generated and a whole setup phase
	// before the first roll. So dice are swept from firstRollFloor, and
	// verify_test.go's TestFirstRollAfterBoardSlots checks real games of
	// every ruleset against that floor.
	const firstRollFloor = 4
	const rolls = 200_000 // ~5000 games' worth of log positions
	for seq := firstRollFloor; seq < rolls; seq++ {
		claim("the roll at that log position", seq)
	}
	// The fair-dice deck: one epoch per 36 rolls.
	for epoch := range rolls/36 + 2 {
		claim("the fair-dice deck", -(epoch + 1))
	}
	claim("the seat-order shuffle", seatOrderSeq)
	for seq := range rolls {
		claim("the Knights event die", EventDieSeq(seq))
	}
	for seq := range rolls {
		claim("the Fishermen old boot", FishBootSeq(seq))
	}
	claim("the Rivers watercourse derivation", RiversBoardSeq)
	claim("the Rivers tile-variant choice", RiversVariantSeq)
	claim("the Wagons board layer", WagonsBoardSeq)
	claim("the Fishermen fishing-ground numbers", FishGroundsSeq)
	claim("the Fishermen lake numbers", FishLakesSeq)
	for seq := range rolls {
		claim("the Wagons drive-off die", WagonsDieSeq(seq))
	}
	// The Raiders run takes one slot per produced event, not per roll, so it
	// is swept over the whole log-position range.
	for seq := range rolls {
		claim("a Raiders public draw", RaidersSeq(seq))
	}
}

// TestRaidersSlotIsNotADiceSlot: the Raiders run must never reach a slot the
// dice can read, at any log position a real game can produce.
func TestRaidersSlotIsNotADiceSlot(t *testing.T) {
	for seq := range 100_000 {
		if got := RaidersSeq(seq); got >= 0 {
			t.Fatalf("RaidersSeq(%d) = %d, overlaps the dice slots", seq, got)
		}
	}
}

// TestPrivateSlotsDoNotCollide is the same enumeration for the private stream,
// where a collision leaks hidden information rather than just repeating a public
// draw.
//
// The private stream has two classes of consumer:
//   - RngFor(s, offset), where offset indexes the produced event in its batch.
//     The absolute seq is that event's log position, unique across the game, so
//     these occupy the non-negative range and never meet.
//   - RngForReserved(s, seq), for a draw not tied to one produced event. Each
//     such consumer takes its own descending run, registered next to RngFor,
//     disjoint from the others and from the non-negative range.
//
// A fixed offset breaks this: RngFor(s, 100) is the same stream as RngFor(s, 0) a
// hundred positions later, which can be baseAutoCommand's publicly announced setup
// pick (engine/auto.go).
func TestPrivateSlotsDoNotCollide(t *testing.T) {
	owner := map[int]string{}
	claim := func(who string, seq int) {
		t.Helper()
		if prev, ok := owner[seq]; ok {
			t.Fatalf("private stream slot %d claimed by both %s and %s", seq, prev, who)
		}
		owner[seq] = who
	}

	// Every event-position draw. A batch is a handful of events long, so the
	// reachable set is exactly the log positions themselves.
	const positions = 200_000 // ~5000 games' worth
	for seq := range positions {
		claim("the draw belonging to the event at that log position", seq)
	}
	for seq := range positions {
		claim("the Fishermen fish-tile draw", PrivateFishTilesSeq(seq))
	}
	// The Wagons cargo stacks: three, each refilled every twelve draws. Swept
	// far past what a game reaches (a refill is twelve deliveries).
	for refill := range 100_000 {
		for hex := range 3 {
			claim("the Wagons cargo stack shuffle", PrivateWagonsStackSeq(hex, refill))
		}
	}
}

// TestReservedPrivateSlotsAreNegative: a reserved private run must never land in
// the non-negative range used by RngFor's event-position draws, and must never
// reproduce the fixed offset it replaced.
func TestReservedPrivateSlotsAreNegative(t *testing.T) {
	for seq := range 100_000 {
		if got := PrivateFishTilesSeq(seq); got >= 0 {
			t.Fatalf("PrivateFishTilesSeq(%d) = %d, overlaps the event-position slots", seq, got)
		}
		// The old derivation, kept as the thing this must not be.
		if PrivateFishTilesSeq(seq) == seq+100 {
			t.Fatalf("PrivateFishTilesSeq(%d) is back on the fixed offset the auto-move shares", seq)
		}
	}
}

// TestEventDieSlotIsNotADiceSlot: the event die must not read a slot the dice can
// ever read, at any log position.
func TestEventDieSlotIsNotADiceSlot(t *testing.T) {
	for seq := range 100_000 {
		if got := EventDieSeq(seq); got >= 0 {
			t.Fatalf("EventDieSeq(%d) = %d, overlaps the dice slots", seq, got)
		}
	}
	// The old derivation, kept as the thing this must not be.
	for seq := range 100_000 {
		if EventDieSeq(seq) == seq+11 {
			t.Fatalf("EventDieSeq(%d) is back on the dice stream", seq)
		}
	}
}
