package supporter

import (
	"context"
	"errors"
	"time"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/store"
)

// RolesFetcher reads a Discord user's current role IDs in the guild. Satisfied by
// *discord.Client; an interface so the refresher is testable without Discord.
type RolesFetcher interface {
	GuildMemberRoles(ctx context.Context, discordUserID string) ([]string, error)
}

// RefreshStore is the slice of the store the refresher needs.
type RefreshStore interface {
	UserByID(id int64) (*store.User, error)
	Supporter(userID int64) (store.Supporter, error)
	SetSupporter(userID int64, active, boosting, kofi, staff, gift bool, periodEnd int64) error
	StaleSupporters(before int64, limit int) ([]int64, error)
	// PerkRoles is the runtime role-ID to kind map managed by /setrole, unioned
	// with the static env config when evaluating a member's roles.
	PerkRoles() (map[string]string, error)
}

// Refresher resolves supporter status by pulling the user's Discord roles (no
// gateway). A supporter-gated action calls EnsureFresh, which re-pulls roles
// when the cached snapshot is older than maxAge, so a lapse locks the perks out
// within maxAge.
type Refresher struct {
	cfg      Config
	fetch    RolesFetcher
	st       RefreshStore
	maxAge   time.Duration
	now      func() int64       // unix seconds; injectable for tests
	onChange func(userID int64) // fired when a Refresh changes the snapshot; nil-safe
}

func NewRefresher(cfg Config, fetch RolesFetcher, st RefreshStore, maxAge time.Duration) *Refresher {
	return &Refresher{cfg: cfg, fetch: fetch, st: st, maxAge: maxAge, now: func() int64 { return time.Now().Unix() }}
}

// SetOnChange registers a callback fired (after the write) whenever a Refresh
// changes a user's role-derived status, never on a no-op refresh. Used to push
// the updated status to that user's own live connections. nil-safe.
func (r *Refresher) SetOnChange(fn func(userID int64)) { r.onChange = fn }

// EnsureFresh re-pulls and persists the user's status when the cached snapshot is
// older than maxAge; within maxAge it is a no-op.
func (r *Refresher) EnsureFresh(ctx context.Context, userID int64) error {
	sup, err := r.st.Supporter(userID)
	if err != nil {
		return err
	}
	if sup.UpdatedAt > 0 && r.now()-sup.UpdatedAt < int64(r.maxAge.Seconds()) {
		return nil
	}
	return r.Refresh(ctx, userID)
}

// Refresh unconditionally pulls the user's roles and writes the resolved status.
// A "not in guild" result means inactive; a transient fetch error keeps the
// cached status rather than flipping someone to inactive on a Discord error.
func (r *Refresher) Refresh(ctx context.Context, userID int64) error {
	u, err := r.st.UserByID(userID)
	if err != nil {
		return err
	}
	if u.DiscordID == "" {
		return nil // guests cannot hold guild roles
	}
	roles, err := r.fetch.GuildMemberRoles(ctx, u.DiscordID)
	switch {
	case errors.Is(err, discord.ErrNotMember):
		roles = nil // not in the guild: no granting roles, inactive
	case err != nil:
		return err // transient: leave the cached snapshot untouched
	}
	// Union the static env config with the DB-managed /setrole mapping. A DB read
	// error is non-fatal: fall back to the env config.
	db, _ := r.st.PerkRoles()
	st := r.cfg.withDBRoles(db).Evaluate(roles)
	// Diff against the prior snapshot so OnChange fires only on a real change.
	prev, _ := r.st.Supporter(userID)
	if err := r.st.SetSupporter(userID, st.Active, st.Boosting, st.Kofi, st.Staff, st.Gift, 0); err != nil {
		return err
	}
	changed := prev.Active != st.Active || prev.Boosting != st.Boosting ||
		prev.Kofi != st.Kofi || prev.Staff != st.Staff || prev.Gift != st.Gift
	if changed && r.onChange != nil {
		r.onChange(userID)
	}
	return nil
}

// Sweep re-pulls every active supporter whose snapshot is older than olderThan,
// so lapses are caught even for users who never trigger a point-of-use check.
// olderThan is the sweep's own cadence (independent of the point-of-use maxAge).
// Returns how many were refreshed. Best-effort: a per-user error is skipped.
func (r *Refresher) Sweep(ctx context.Context, olderThan time.Duration) (int, error) {
	before := r.now() - int64(olderThan.Seconds())
	ids, err := r.st.StaleSupporters(before, 0)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if err := r.Refresh(ctx, id); err == nil {
			n++
		}
	}
	return n, nil
}
