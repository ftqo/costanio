package knights

import (
	"maps"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// PlayerExtView is one player's Knights state as a viewer may see it.
type PlayerExtView struct {
	CommodityCount int                      `json:"commodity_count"`
	Commodities    *CommodityHand           `json:"commodities,omitempty"` // own seat only
	Improve        [trackKinds]int          `json:"improve"`
	ProgressCount  int                      `json:"progress_count"`
	Progress       []ProgressCard           `json:"progress,omitempty"` // own seat only
	Metropolis     [trackKinds]bool         `json:"metropolis"`
	MetropolisAt   [trackKinds]board.Vertex `json:"metropolis_at"`
	Walls          int                      `json:"walls"`
	DefenderVP     int                      `json:"defender_vp"`
	MerchantVP     int                      `json:"merchant_vp"`
	ExtraVP        int                      `json:"extra_vp"`
	// LaidCity is a city the barbarians pillaged when the player had no
	// settlement piece left in supply: it lies on its side and must be upgraded
	// back before anything else is built (see the pin in hooks.go). Public so the
	// client can explain the restriction. Zero vertex when LaidCityActive is false.
	LaidCity       board.Vertex `json:"laid_city"`
	LaidCityActive bool         `json:"laid_city_active"`
}

type KnightView struct {
	V                board.Vertex    `json:"v"`
	Owner            engine.PlayerID `json:"owner"`
	Level            int             `json:"level"`
	Active           bool            `json:"active"`
	FreshlyActivated bool            `json:"freshly_activated"`
	// PromotedThisTurn lets the client stop offering Promote on this knight while
	// still offering it on the player's others. Public, as it is visible on the
	// board.
	PromotedThisTurn bool `json:"promoted_this_turn"`
}

type ExtView struct {
	Players []PlayerExtView `json:"players"`
	Knights []KnightView    `json:"knights"`
	// CommoditySupply is how many of each commodity are left to hand out, the
	// counterpart of FullView.Bank. Public like the bank, since a low stack
	// changes whether a city pays out.
	CommoditySupply CommodityHand                      `json:"commodity_supply"`
	Barbarians      int                                `json:"barbarians"`
	Attacks         int                                `json:"attacks"`
	Merchant        *board.Hex                         `json:"merchant,omitempty"`
	Walled          []board.Vertex                     `json:"walled,omitempty"`
	Decks           [trackKinds]int                    `json:"decks"` // remaining counts
	PendingGive     map[engine.PlayerID]int            `json:"pending_give,omitempty"`
	HarborGive      map[engine.PlayerID]board.Resource `json:"harbor_give,omitempty"`
	Aqueduct        []engine.PlayerID                  `json:"aqueduct,omitempty"`
	Spy             *SpyView                           `json:"spy,omitempty"`             // thief-only: victim's progress hand to choose from
	MasterMerchant  *MasterMerchantView                `json:"master_merchant,omitempty"` // thief-only: victim whose combined hand is revealed
	// Deserter interaction. DeserterVictim must surrender a knight; once they do,
	// DeserterTaker owes a replacement of DeserterLevel strength. -1 means none.
	DeserterVictim engine.PlayerID `json:"deserter_victim"`
	DeserterTaker  engine.PlayerID `json:"deserter_taker"`
	DeserterLevel  int             `json:"deserter_level,omitempty"`
	// Tied-defender draw queue (front seat draws next, current-player order).
	DefenderDraws []engine.PlayerID `json:"defender_draws,omitempty"`
	// Players who lost the barbarian defense and still owe a choice of which of
	// their own cities is razed. Public: everyone can see who is deciding.
	BarbarianDowngrade []engine.PlayerID `json:"barbarian_downgrade,omitempty"`
	// A metropolis earned but not yet placed: its owner still has to name the
	// city. Public (the track bought is already on the wire via Improve); absent
	// when nothing is pending.
	MetropolisPick *MetropolisPick `json:"metropolis_pick,omitempty"`
	// A displaced knight awaiting relocation by its owner. RelocPlayer is -1 when
	// none. RelocFrom is not published: the engine sends `knight_relocations`, the
	// legal destinations, which the board highlights directly
	// (lib/boardTargets.ts).
	RelocPlayer engine.PlayerID `json:"reloc_player"`
}

// SpyView reveals the victim's progress hand, but only to the spying thief.
type SpyView struct {
	Victim engine.PlayerID `json:"victim"`
	Cards  []ProgressCard  `json:"cards"`
}

// MasterMerchantView names the victim whose combined resource+commodity hand is
// revealed to the thief mid-look. The thief reads the victim's resource
// breakdown from the base PlayerView.Hand (exposed via the RevealHands hook) and
// their commodity breakdown from this view's revealed PlayerExtView.Commodities.
type MasterMerchantView struct {
	Victim engine.PlayerID `json:"victim"`
}

// ViewExt implements engine.Viewable, for a viewer who is playing their seat.
func (e *Ext) ViewExt(viewer engine.PlayerID) any {
	return e.viewExt(viewer, true)
}

// ViewExtIdle implements engine.IdleViewable: the view for a viewer whose seat
// a bot is playing. Spy and Master Merchant put a look in front of the thief
// only, and those fields carry no seat index a client could filter by, so they
// are dropped here; otherwise the owner would see the victim's hand and a pick
// they cannot make (game.ErrSeatBotControlled). Everything else stays.
func (e *Ext) ViewExtIdle(viewer engine.PlayerID) any {
	return e.viewExt(viewer, false)
}

// viewExt renders the module view. `acting` is false when the viewer holds this
// seat but is not the one playing it; it gates the two thief-only looks.
//
// Every map, slice and pointer published here is copied out of the live Ext.
// The view is built on the actor goroutine but serialized later on the
// connection goroutine while the actor folds the next command, so a shared
// slice is a data race and a shared map is a fatal concurrent map read/write
// that takes down every game. game/views.go copies the base State's fields for
// the same reason.
func (e *Ext) viewExt(viewer engine.PlayerID, acting bool) any {
	v := &ExtView{
		CommoditySupply: e.CommoditySupply,
		Barbarians:      e.Barbarians,
		Attacks:         e.Attacks,
		Knights:         []KnightView{},
		DeserterVictim:  e.DeserterVictim,
		DeserterTaker:   e.DeserterTaker,
		DeserterLevel:   e.DeserterLevel,
		RelocPlayer:     e.RelocPlayer,
	}
	if e.Merchant != nil {
		// Copied rather than shared. Apply only replaces the pointer today, but that is
		// a property of the fold, not the type. CloneExt does the same.
		m := *e.Merchant
		v.Merchant = &m
	}
	if len(e.DefenderDraws) > 0 {
		v.DefenderDraws = append([]engine.PlayerID(nil), e.DefenderDraws...)
	}
	if len(e.PendingDowngrade) > 0 {
		v.BarbarianDowngrade = append([]engine.PlayerID(nil), e.PendingDowngrade...)
	}
	if e.MetropolisPending != nil {
		mp := *e.MetropolisPending
		v.MetropolisPick = &mp
	}
	for t := range trackKinds {
		v.Decks[t] = e.Decks.remaining(t) + len(e.Under[t])
	}
	for i := range e.Players {
		px := e.Players[i]
		pv := PlayerExtView{
			CommodityCount: px.Commodities.Count(),
			Improve:        px.Improve,
			ProgressCount:  len(px.Progress),
			Metropolis:     px.Metropolis,
			MetropolisAt:   px.MetropolisAt,
			Walls:          px.Walls,
			DefenderVP:     px.DefenderVP,
			MerchantVP:     px.MerchantVP,
			ExtraVP:        px.ExtraVP,
			LaidCity:       px.LaidCity,
			LaidCityActive: px.LaidCityActive,
		}
		if engine.PlayerID(i) == viewer {
			c := px.Commodities
			pv.Commodities = &c
			pv.Progress = append([]ProgressCard(nil), px.Progress...)
		} else if acting && e.MMThief == viewer && e.MMThief != engine.NoPlayer && engine.PlayerID(i) == e.MMVictim {
			// Master Merchant look: the thief sees the victim's commodity
			// breakdown (the resource half comes via the RevealHands hook).
			c := px.Commodities
			pv.Commodities = &c
		}
		v.Players = append(v.Players, pv)
	}
	for kv, k := range e.Knights {
		v.Knights = append(v.Knights, KnightView{V: kv, Owner: k.Owner, Level: k.Level, Active: k.Active,
			FreshlyActivated: k.FreshlyActivated, PromotedThisTurn: k.PromotedThisTurn})
	}
	sort.Slice(v.Knights, func(i, j int) bool { return vertexLess(v.Knights[i].V, v.Knights[j].V) })
	for wv := range e.Walled {
		v.Walled = append(v.Walled, wv)
	}
	sort.Slice(v.Walled, func(i, j int) bool { return vertexLess(v.Walled[i], v.Walled[j]) })
	if len(e.PendingGive) > 0 {
		v.PendingGive = maps.Clone(e.PendingGive)
	}
	if len(e.HarborGive) > 0 {
		v.HarborGive = maps.Clone(e.HarborGive)
	}
	if len(e.Aqueduct) > 0 {
		v.Aqueduct = slices.Clone(e.Aqueduct)
	}
	// Only the thief mid-Spy sees the victim's progress hand.
	if acting && e.SpyThief != engine.NoPlayer && e.SpyThief == viewer && e.SpyVictim != engine.NoPlayer {
		v.Spy = &SpyView{Victim: e.SpyVictim, Cards: append([]ProgressCard(nil), e.Players[e.SpyVictim].Progress...)}
	}
	// Only the thief mid-Master-Merchant sees which victim's hand is revealed.
	if acting && e.MMThief != engine.NoPlayer && e.MMThief == viewer && e.MMVictim != engine.NoPlayer {
		v.MasterMerchant = &MasterMerchantView{Victim: e.MMVictim}
	}
	return v
}
