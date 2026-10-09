package knights

import (
	"maps"
	"slices"
	"strings"
)

// ProgressCard identifies a Knights progress card. The string form goes on the
// wire (append-only vocabulary, like terrains).
type ProgressCard string

const (
	// Trade (cloth) deck.
	CardCommercialHarbor ProgressCard = "commercial_harbor"
	CardMasterMerchant   ProgressCard = "master_merchant"
	CardMerchant         ProgressCard = "merchant"
	CardMerchantFleet    ProgressCard = "merchant_fleet"
	CardResourceMonopoly ProgressCard = "resource_monopoly"
	CardTradeMonopoly    ProgressCard = "trade_monopoly"

	// Politics (coin) deck.
	CardBishop       ProgressCard = "bishop"
	CardConstitution ProgressCard = "constitution"
	CardDeserter     ProgressCard = "deserter"
	CardDiplomat     ProgressCard = "diplomat"
	CardIntrigue     ProgressCard = "intrigue"
	CardSaboteur     ProgressCard = "saboteur"
	CardSpy          ProgressCard = "spy"
	CardWarlord      ProgressCard = "warlord"
	CardWedding      ProgressCard = "wedding"

	// Science (paper) deck.
	CardAlchemist    ProgressCard = "alchemist"
	CardCrane        ProgressCard = "crane"
	CardEngineer     ProgressCard = "engineer"
	CardInventor     ProgressCard = "inventor"
	CardIrrigation   ProgressCard = "irrigation"
	CardMedicine     ProgressCard = "medicine"
	CardMining       ProgressCard = "mining"
	CardPrinter      ProgressCard = "printer"
	CardRoadBuilding ProgressCard = "road_building"
	CardSmith        ProgressCard = "smith"
)

// deckComposition is the card mix per discipline.
var deckComposition = [trackKinds]map[ProgressCard]int{
	Trade: {
		CardCommercialHarbor: 2, CardMasterMerchant: 2, CardMerchant: 6,
		CardMerchantFleet: 2, CardResourceMonopoly: 4, CardTradeMonopoly: 2,
	},
	Politics: {
		CardBishop: 2, CardConstitution: 1, CardDeserter: 2, CardDiplomat: 2,
		CardIntrigue: 2, CardSaboteur: 2, CardSpy: 3, CardWarlord: 2, CardWedding: 2,
	},
	Science: {
		CardAlchemist: 2, CardCrane: 2, CardEngineer: 1, CardInventor: 2,
		CardIrrigation: 2, CardMedicine: 2, CardMining: 2, CardPrinter: 1,
		CardRoadBuilding: 2, CardSmith: 2,
	},
}

// deckOrder gives a stable iteration order for weighted draws.
var deckOrder = [trackKinds][]ProgressCard{
	Trade: {CardCommercialHarbor, CardMasterMerchant, CardMerchant,
		CardMerchantFleet, CardResourceMonopoly, CardTradeMonopoly},
	Politics: {CardBishop, CardConstitution, CardDeserter, CardDiplomat,
		CardIntrigue, CardSaboteur, CardSpy, CardWarlord, CardWedding},
	Science: {CardAlchemist, CardCrane, CardEngineer, CardInventor,
		CardIrrigation, CardMedicine, CardMining, CardPrinter,
		CardRoadBuilding, CardSmith},
}

// DeckCounts tracks remaining cards; draws are weighted picks on the seeded rng
// (as for the dev deck), so only the counts need persisting.
type DeckCounts [trackKinds]map[ProgressCard]int

// freshDecks is the full card mix, minus any card this ruleset makes
// unplayable. Today that is the Bishop under Raiders: there is no robber and
// the barbarians never sail (barbariansSail), so robberLocked stays true and
// the card could never resolve. Its count is zeroed, as in
// `wagons.swiftDeckFor`, so the view's deck counts, the weighted draw and the
// empty-deck refusal all follow automatically.
func freshDecks(ruleset string) DeckCounts {
	var d DeckCounts
	for t := range deckComposition {
		d[t] = map[ProgressCard]int{}
		maps.Copy(d[t], deckComposition[t])
	}
	if slices.Contains(strings.Split(ruleset, "+"), raidersName) {
		delete(d[Politics], CardBishop)
	}
	return d
}

func (d DeckCounts) remaining(t Track) int {
	n := 0
	for _, c := range d[t] {
		n += c
	}
	return n
}

// pick returns the idx-th card of the track in stable order.
func (d DeckCounts) pick(t Track, idx int) ProgressCard {
	for _, card := range deckOrder[t] {
		n := d[t][card]
		if idx < n {
			return card
		}
		idx -= n
	}
	panic("cak: deck accounting broken")
}

// trackOf finds a card's home deck (for discards back to the bottom).
func trackOf(card ProgressCard) Track {
	for t := range deckComposition {
		if _, ok := deckComposition[t][card]; ok {
			return Track(t)
		}
	}
	return Trade
}

// vpCard reports cards that are pure VP and play themselves on draw.
func vpCard(card ProgressCard) bool {
	return card == CardConstitution || card == CardPrinter
}
