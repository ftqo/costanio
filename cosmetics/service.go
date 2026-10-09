package cosmetics

import (
	"context"
	"fmt"
	"time"

	"github.com/ftqo/costan.io/econ"
	"github.com/ftqo/costan.io/store"
)

// SupporterRefresher re-syncs a user's supporter status from Discord (by pull)
// when the cached snapshot is stale, so a supporter-gated action can re-verify
// roles at point of use without a gateway. Optional: nil trusts the snapshot.
type SupporterRefresher interface {
	EnsureFresh(ctx context.Context, userID int64) error
	// Refresh is an unconditional pull (bypasses the TTL); used by the explicit
	// "sync my roles" path, which is rate-limited instead.
	Refresh(ctx context.Context, userID int64) error
}

// Service is the cosmetics application layer: catalog views, purchases, loadout,
// supporter gating, and color availability. Persistence is store, currency is
// econ.
type Service struct {
	st      *store.Store
	led     *econ.Ledger
	refresh SupporterRefresher
}

func New(st *store.Store, led *econ.Ledger) *Service { return &Service{st: st, led: led} }

// SetRefresher wires point-of-use supporter re-verification (used when Discord
// is configured). Without it, gating trusts the cached snapshot.
func (s *Service) SetRefresher(r SupporterRefresher) { s.refresh = r }

// ensureFresh re-pulls supporter status before a supporter-gated decision.
// Best-effort: if Discord is unreachable we fall back to the cached snapshot
// rather than blocking the user on an outage.
func (s *Service) ensureFresh(userID int64) {
	if s.refresh != nil {
		_ = s.refresh.EnsureFresh(context.Background(), userID)
	}
}

// ItemView is a catalog item annotated for one user.
type ItemView struct {
	Item
	Owned    bool `json:"owned"`
	Equipped bool `json:"equipped"`
	Locked   bool `json:"locked"` // supporter-exclusive and the user isn't an active supporter
}

// owns reports whether the user owns item, given their entitlement set and their
// role-derived perk flags. Role-gated items are owned only while the role is
// held, so they revert without any deletion.
func owns(it Item, ent map[string]bool, sup store.Supporter) bool {
	if ent[it.ID] {
		return true
	}
	return (it.Supporter && sup.Active) ||
		(it.Booster && sup.Boosting) ||
		(it.Kofi && sup.Kofi) ||
		(it.Staff && sup.Staff) ||
		(it.Gift && sup.Gift)
}

// itemLocked reports whether an item is out of the user's reach entirely.
//
// A role gate grants an item free; a price sells it to everyone else. So a
// priced item is never locked, only unbought. Multiple gates are alternatives
// (the keg is supporter, booster or Ko-fi), so locked is "gated, and no held
// role opens it".
func itemLocked(it Item, ent map[string]bool, sup store.Supporter) bool {
	// Reserved items have no art, so they are locked even with an entitlement.
	if it.Reserved {
		return true
	}
	if ent[it.ID] || it.Price > 0 {
		return false
	}
	gated := it.Supporter || it.Booster || it.Kofi || it.Staff || it.Gift
	return gated && !owns(it, ent, sup)
}

// Catalog returns every item annotated with ownership/equip/lock for the user.
func (s *Service) Catalog(userID int64) ([]ItemView, error) {
	ent, err := s.st.Entitlements(userID)
	if err != nil {
		return nil, err
	}
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return nil, err
	}
	lo, err := s.st.Loadout(userID)
	if err != nil {
		return nil, err
	}
	out := make([]ItemView, 0, len(Catalog))
	for _, it := range Catalog {
		out = append(out, ItemView{
			Item:     it,
			Owned:    owns(it, ent, sup),
			Equipped: lo[string(it.Slot)] == it.ID,
			Locked:   itemLocked(it, ent, sup),
		})
	}
	return out, nil
}

// Purchase buys a Pip-priced item for the user. Idempotent: re-buying an item you
// already own succeeds without a second charge.
func (s *Service) Purchase(userID int64, itemID string) error {
	it, ok := ItemByID(itemID)
	if !ok {
		// A palette color with no catalog row exists but is not sold.
		if _, isColor := ColorByID(itemID); isColor {
			return ErrNotPurchasable
		}
		return ErrUnknownItem
	}
	// A reserved id has a price but no art; the price gate below would allow it.
	if it.Reserved {
		return ErrNotPurchasable
	}
	// Price decides purchasability, not the role flags: an item can be free for
	// a role and for sale to everyone else (the Brigand robber).
	if it.Price <= 0 {
		if it.Supporter {
			return ErrSupporterExclusive
		}
		return ErrNotPurchasable
	}
	has, err := s.st.HasEntitlement(userID, itemID)
	if err != nil {
		return err
	}
	if has {
		return nil // already owned
	}
	key := fmt.Sprintf("purchase:%d:%s", userID, itemID)
	if _, err := s.led.Spend(userID, it.Price, "purchase", key); err != nil {
		return err // includes econ.ErrInsufficientFunds
	}
	return s.st.GrantEntitlement(userID, itemID, "purchase")
}

// Loadout returns the user's equipped item per slot.
func (s *Service) Loadout(userID int64) (map[string]string, error) {
	return s.st.Loadout(userID)
}

// LoadoutColor returns the user's globally-equipped color id, or "" if none is
// equipped. Used to seed a fresh seat with the player's preferred color.
func (s *Service) LoadoutColor(userID int64) (string, error) {
	lo, err := s.st.Loadout(userID)
	if err != nil {
		return "", err
	}
	return lo[string(SlotColor)], nil
}

// Equip equips itemID in slot for the user, validating ownership. The color slot
// is validated against the palette; equipping a supporter color you have via
// active status grants a "color-use" entitlement so you keep it after a lapse.
func (s *Service) Equip(userID int64, slot, itemID string) error {
	if Slot(slot) == SlotColor {
		return s.equipColor(userID, itemID)
	}
	it, ok := ItemByID(itemID)
	if !ok {
		return ErrUnknownItem
	}
	if string(it.Slot) != slot {
		return ErrWrongSlot
	}
	if it.Supporter || it.Booster || it.Kofi || it.Staff || it.Gift {
		s.ensureFresh(userID) // re-verify roles before granting a role-gated perk
	}
	ent, err := s.st.Entitlements(userID)
	if err != nil {
		return err
	}
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return err
	}
	if !owns(it, ent, sup) {
		return ErrNotOwned
	}
	return s.st.SetLoadoutSlot(userID, slot, itemID)
}

func (s *Service) equipColor(userID int64, colorID string) error {
	col, ok := ColorByID(colorID)
	if !ok {
		return ErrUnknownColor
	}
	if !col.Free {
		s.ensureFresh(userID) // re-verify roles before granting a supporter color
	}
	ent, err := s.st.Entitlements(userID)
	if err != nil {
		return err
	}
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return err
	}
	if !HasColor(col, ent, sup.Active) {
		return ErrNotOwned
	}
	// Keep what you used: lock in a supporter color the first time it's equipped.
	// (A shelf color is already an entitlement here.)
	if !col.Free && !ent[col.ID] {
		if err := s.st.GrantEntitlement(userID, col.ID, "color-use"); err != nil {
			return err
		}
	}
	return s.st.SetLoadoutSlot(userID, string(SlotColor), colorID)
}

// UseColor gates a color for in-game (per-seat) use and returns the resolved
// palette Color so the caller can run the distinctness check. It is the seat
// path's counterpart to equipColor: it re-verifies supporter status at point of
// use and grants the "keep what you used" entitlement for supporter colors, but
// does not touch the loadout slot, since a seat color is per-game.
func (s *Service) UseColor(userID int64, colorID string) (Color, error) {
	col, ok := ColorByID(colorID)
	if !ok {
		return Color{}, ErrUnknownColor
	}
	if col.Free {
		return col, nil
	}
	s.ensureFresh(userID) // re-verify roles before granting a supporter color
	ent, err := s.st.Entitlements(userID)
	if err != nil {
		return Color{}, err
	}
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return Color{}, err
	}
	if !HasColor(col, ent, sup.Active) {
		return Color{}, ErrNotOwned
	}
	// Keep what you used: lock in the supporter color the first time it's used.
	if !ent[col.ID] {
		if err := s.st.GrantEntitlement(userID, col.ID, "color-use"); err != nil {
			return Color{}, err
		}
	}
	return col, nil
}

// Unequip clears a slot.
func (s *Service) Unequip(userID int64, slot string) error {
	return s.st.ClearLoadoutSlot(userID, slot)
}

// ColorView is a palette color annotated with availability for one user.
type ColorView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Hex       string `json:"hex"`
	Free      bool   `json:"free"`
	Available bool   `json:"available"`
	// Price in Pips, 0 for a color that cannot be bought. Shown even when the
	// user already has the color.
	Price int `json:"price"`
}

// Colors returns the palette annotated with availability (free, active
// supporter, or previously-used colors are available) and its shelf price.
func (s *Service) Colors(userID int64) ([]ColorView, error) {
	ent, err := s.st.Entitlements(userID)
	if err != nil {
		return nil, err
	}
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return nil, err
	}
	out := make([]ColorView, 0, len(Palette))
	for _, c := range Palette {
		out = append(out, ColorView{
			ID:        c.ID,
			Name:      c.Name,
			Hex:       c.Hex,
			Free:      c.Free,
			Available: HasColor(c, ent, sup.Active),
			Price:     c.Price,
		})
	}
	return out, nil
}

// SupporterView is the user-facing supporter state, including a derived tenure
// badge. Buckets are derived (not stored) so they can be retuned freely.
type SupporterView struct {
	Active   bool   `json:"active"`
	Boosting bool   `json:"boosting"` // currently boosting (gates the booster decoration)
	Kofi     bool   `json:"kofi"`     // holds the Ko-fi role (green decoration)
	Staff    bool   `json:"staff"`    // holds the staff role (fire decoration)
	Since    int64  `json:"since"`
	Tier     string `json:"tier"`  // "supporter" | "former" | ""
	Badge    string `json:"badge"` // "" | "bronze" | "silver" | "gold"
}

// IsSupporter reports whether the user currently holds active supporter status,
// re-verifying against Discord first (best-effort) so the decision uses the
// freshest available state. Used to gate supporter-only actions outside the
// cosmetics catalog, such as starting an all-bot game.
func (s *Service) IsSupporter(userID int64) (bool, error) {
	s.ensureFresh(userID)
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return false, err
	}
	return sup.Active, nil
}

// RefreshAndView re-pulls the user's role-derived status from Discord and returns
// the resulting view. force=true does an unconditional pull (the explicit "sync
// roles" path); force=false is TTL-gated (cheap automatic refresh). Best-effort:
// a Discord error falls back to the cached snapshot rather than failing the call.
func (s *Service) RefreshAndView(ctx context.Context, userID int64, force bool) (SupporterView, error) {
	if s.refresh != nil {
		if force {
			_ = s.refresh.Refresh(ctx, userID)
		} else {
			_ = s.refresh.EnsureFresh(ctx, userID)
		}
	}
	return s.SupporterView(userID)
}

// SupporterView reads and annotates a user's supporter status.
func (s *Service) SupporterView(userID int64) (SupporterView, error) {
	sup, err := s.st.Supporter(userID)
	if err != nil {
		return SupporterView{}, err
	}
	v := SupporterView{Active: sup.Active, Boosting: sup.Boosting, Kofi: sup.Kofi, Staff: sup.Staff, Since: sup.Since}
	switch {
	case sup.Active:
		v.Tier = "supporter"
	case sup.Since > 0:
		v.Tier = "former"
	}
	v.Badge = tenureBadge(sup.Since)
	return v, nil
}

func tenureBadge(since int64) string {
	if since <= 0 {
		return ""
	}
	months := time.Since(time.Unix(since, 0)).Hours() / 24 / 30
	switch {
	case months >= 12:
		return "gold"
	case months >= 6:
		return "silver"
	case months >= 1:
		return "bronze"
	default:
		return ""
	}
}
