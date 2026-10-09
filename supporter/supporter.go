// Package supporter resolves a user's supporter entitlement from the Discord
// roles they hold. Supporter status is granted by any role in a configured
// allowlist, which covers three earning paths:
//
//   - a paid Discord Server Subscription role,
//   - the managed Nitro "Server Booster" role (boosting our guild), and
//   - a manually assigned gift role.
//
// Evaluate is pure (no Discord or DB calls). The Refresher reads the member's
// role IDs over REST (no gateway) on login, before granting a perk, and in a
// periodic sweep. See refresher.go and docs/cosmetics.md §5/§7.
package supporter

import (
	"fmt"
	"maps"
	"strings"
)

// Kind labels how a granting role was earned. Supporter status itself is binary;
// the kind is kept for analytics and to differentiate perks later (e.g. a
// boost-only cosmetic). When several granting roles are held, the strongest wins.
type Kind string

const (
	// Supporter kinds: any of these makes the member an active supporter.
	KindSubscription Kind = "subscription"
	KindBoost        Kind = "boost"
	KindGift         Kind = "gift"
	// Perk kinds: role-gated cosmetics that do not confer supporter status; each
	// lights up its own decoration (Ko-fi green, staff fire).
	KindKofi  Kind = "kofi"
	KindStaff Kind = "staff"
)

// precedence ranks the supporter kinds so a paying subscriber who also boosts
// is not labeled a booster. Higher wins. Perk kinds are not ranked.
var precedence = map[Kind]int{KindGift: 1, KindBoost: 2, KindSubscription: 3}

var perkKinds = map[Kind]bool{KindKofi: true, KindStaff: true}

func validKind(k Kind) bool { _, sup := precedence[k]; return sup || perkKinds[k] }

// ValidKind reports whether k is a recognized role kind (exported for the
// /setrole command to validate input).
func ValidKind(k Kind) bool { return validKind(k) }

// Kinds returns every recognized role kind, for command choices / validation.
func Kinds() []string {
	return []string{
		string(KindSubscription), string(KindBoost), string(KindGift),
		string(KindKofi), string(KindStaff),
	}
}

// Config is the allowlist of Discord role IDs that grant supporter status, each
// tagged with its Kind.
type Config struct {
	Roles map[string]Kind // role ID -> kind
}

// Empty reports whether no granting roles are configured (supporter is then off).
func (c Config) Empty() bool { return len(c.Roles) == 0 }

// withDBRoles returns a config that unions the static (env) roles with the
// runtime DB-managed mapping (set via /setrole). DB entries win on conflict;
// entries with an unknown kind are skipped. The receiver is not mutated.
func (c Config) withDBRoles(db map[string]string) Config {
	merged := Config{Roles: make(map[string]Kind, len(c.Roles)+len(db))}
	maps.Copy(merged.Roles, c.Roles)
	for id, kind := range db {
		if k := Kind(kind); validKind(k) {
			merged.Roles[id] = k
		}
	}
	return merged
}

// Status is the result of evaluating a member's roles.
type Status struct {
	Active bool
	Via    Kind // the strongest granting role's kind; "" when inactive
	// Boosting is true when the member holds a boost-kind role, tracked
	// independently of Via's precedence so a subscriber who also boosts is
	// still recognized as boosting (e.g. for the booster-only name decoration).
	Boosting bool
	// Kofi/Staff are role-gated perks that do not confer supporter status; each
	// lights up its own name decoration (green / fire).
	Kofi  bool
	Staff bool
	// Gift records that supporter status came from the gift role specifically.
	// The gift role is a supporter kind, so it also sets Active, but it is
	// tracked separately so the gift-only decorations gate on it alone.
	Gift bool
}

// Evaluate reports the perks a member's roles grant. Supporter kinds set Active +
// Via (highest precedence wins) and boost also sets Boosting; the perk kinds set
// their own flag without conferring supporter status.
func (c Config) Evaluate(memberRoleIDs []string) Status {
	best := Status{}
	for _, rid := range memberRoleIDs {
		k, ok := c.Roles[rid]
		if !ok {
			continue
		}
		switch k {
		case KindKofi:
			best.Kofi = true
		case KindStaff:
			best.Staff = true
		default: // supporter kinds
			if k == KindBoost {
				best.Boosting = true
			}
			if k == KindGift {
				best.Gift = true
			}
			if !best.Active || precedence[k] > precedence[best.Via] {
				best.Active = true
				best.Via = k
			}
		}
	}
	return best
}

// ParseConfig reads an allowlist from a comma-separated env string of
// "roleID:kind" entries, e.g. "123:subscription,456:boost,789:gift". A bare
// "roleID" (no kind) defaults to a gift/manual grant. Whitespace is ignored.
func ParseConfig(s string) (Config, error) {
	cfg := Config{Roles: map[string]Kind{}}
	for part := range strings.SplitSeq(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, kind := part, KindGift
		if before, after, ok := strings.Cut(part, ":"); ok {
			id = strings.TrimSpace(before)
			kind = Kind(strings.TrimSpace(after))
		}
		if id == "" {
			return Config{}, fmt.Errorf("supporter: empty role id in %q", part)
		}
		if !validKind(kind) {
			return Config{}, fmt.Errorf("supporter: unknown role kind %q (want subscription|boost|gift|kofi|staff)", kind)
		}
		cfg.Roles[id] = kind
	}
	return cfg, nil
}
