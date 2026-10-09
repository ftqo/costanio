// Package lobby manages games before and around play: creation, seats,
// browsing, and starting (which hands off to the game manager).
package lobby

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/cosmetics"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/ranked"
	"github.com/ftqo/costan.io/rating"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

var (
	ErrNotInLobby     = errors.New("lobby: game is not open for changes")
	ErrFull           = errors.New("lobby: game is full")
	ErrAlreadySeated  = errors.New("lobby: already seated in this game")
	ErrNotSeated      = errors.New("lobby: not seated in this game")
	ErrBadInvite      = errors.New("lobby: invalid invite code")
	ErrGuestNeedsLink = errors.New("lobby: guests can only join via invite link")
	ErrNotHost        = errors.New("lobby: only the host can do that")
	ErrCantKickHost   = errors.New("lobby: the host cannot be removed")
	ErrBadHostTarget  = errors.New("lobby: that player can't be made host")
	ErrColorTaken     = errors.New("lobby: that color is too close to another player's")
	ErrNotEnough      = errors.New("lobby: need at least 2 players to start")
	ErrBadConfig      = errors.New("lobby: invalid game config")
	// ErrRulesetConflict is a config naming two expansions the rules specs
	// say cannot share a board. Not wrapped around ErrBadConfig: the host
	// needs to be told which pair to separate. The wrapped
	// *engine.ConflictError carries the pair and the reason.
	ErrRulesetConflict = errors.New("lobby: those expansions cannot be combined")
	ErrNotFinished     = errors.New("lobby: game is not finished")
	ErrNotActive       = errors.New("lobby: game is not in progress")
	ErrRankedNoReset   = errors.New("lobby: a ranked game cannot be reset to the lobby")
	ErrSupporterOnly   = errors.New("lobby: starting a game with only bots requires supporter status")
)

// ColorGate is the cosmetics seam the seat path uses to gate color picks
// (supporter/ownership checks + "keep what you used"), to read a player's
// preferred loadout color for seeding a fresh seat, and to equip the name
// decoration (which a seat renders straight from the loadout). Optional: when
// nil, color/decoration picking is unavailable and seats render the defaults.
type ColorGate interface {
	UseColor(userID int64, colorID string) (cosmetics.Color, error)
	LoadoutColor(userID int64) (string, error)
	Equip(userID int64, slot, itemID string) error
	Unequip(userID int64, slot string) error
}

// SupporterGate reports whether a user currently holds active supporter
// status. The lobby uses it to gate the supporter perk of starting a game with
// no second human (the host alone against bots, or an all-bot table the host
// watches). Optional: when nil, the check is skipped.
type SupporterGate interface {
	IsSupporter(userID int64) (bool, error)
}

type Lobby struct {
	st         *store.Store
	mgr        *game.Manager
	colors     ColorGate
	supporters SupporterGate

	// browse is a short-TTL cache for the public game list, an
	// unauthenticated, frequently polled endpoint, so DB load is one pass per
	// TTL regardless of request volume. now is the clock seam for tests.
	browseMu    sync.Mutex
	browseCache []*Summary
	browseAt    time.Time
	now         func() time.Time

	// locks serialises the once-only transitions of a single game (Start,
	// ResetToLobby). Keyed by game id and refcounted, so an entry exists only
	// while somebody holds or waits for it.
	locksMu sync.Mutex
	locks   map[string]*gameLock
}

// gameLock is one game's transition mutex plus the count of callers holding or
// waiting for it, which is what lets lockGame drop the map entry when the last
// one leaves.
type gameLock struct {
	mu   sync.Mutex
	refs int
}

// lockGame takes a game's transition lock and returns its release.
//
// Start and ResetToLobby each read a status, rebuild the seat set and hand the
// game to the manager, so concurrent calls must not interleave. Join, AddBot
// and SetSeatColor take it too: each reads the colors at the table, checks its
// own against them, then writes, and two interleaved calls could put two seats
// on one color. The lock is per game, so only joins to one table serialise.
func (l *Lobby) lockGame(gameID string) func() {
	l.locksMu.Lock()
	if l.locks == nil {
		l.locks = map[string]*gameLock{}
	}
	gl := l.locks[gameID]
	if gl == nil {
		gl = &gameLock{}
		l.locks[gameID] = gl
	}
	gl.refs++
	l.locksMu.Unlock()

	gl.mu.Lock()
	return func() {
		gl.mu.Unlock()
		l.locksMu.Lock()
		gl.refs--
		if gl.refs == 0 {
			delete(l.locks, gameID)
		}
		l.locksMu.Unlock()
	}
}

func New(st *store.Store, mgr *game.Manager) *Lobby {
	return &Lobby{st: st, mgr: mgr, now: time.Now}
}

// SetColorGate wires per-seat color picking (used when cosmetics is configured).
func (l *Lobby) SetColorGate(g ColorGate) { l.colors = g }

// SetSupporterGate wires the supporter check used to gate all-bot game starts
// (set when cosmetics is configured). When unset, the gate is open.
func (l *Lobby) SetSupporterGate(g SupporterGate) { l.supporters = g }

// effectiveColor is the palette color a seat renders with: its chosen color, or
// the seat-order default when unpicked (or the pick is somehow unknown).
func effectiveColor(s *store.Seat) cosmetics.Color {
	if s.Color != "" {
		if c, ok := cosmetics.ColorByID(s.Color); ok {
			return c
		}
	}
	return cosmetics.DefaultSeatColor(s.No)
}

// fillColors stamps each seat's effective render hex for the wire.
func fillColors(seats []*store.Seat) []*store.Seat {
	for _, s := range seats {
		s.ColorHex = effectiveColor(s).Hex
	}
	return seats
}

// Summary is a game with its seats, as shown in the browser and lobby screen.
type Summary struct {
	Game  *store.Game   `json:"game"`
	Seats []*store.Seat `json:"seats"`
	// HostName is the creator's display name, resolved here so the UI need
	// not assume the host is seat 0; the host may hold any seat or none.
	HostName string `json:"host_name"`
	// HostDecoration is the creator's equipped name decoration, so the
	// "<host>'s table" label can render them.
	HostDecoration string `json:"host_decoration,omitempty"`
	// Timings is the clock policy for this table: the turn-timer presets and
	// bounds the host may choose from, and the caps that follow. Served so the
	// lobby UI offers exactly what the server accepts. Set on the single-game
	// summary only; in the browse list it would be identical in every entry.
	Timings *timings.Wire `json:"timings,omitempty"`
}

// hostName resolves a creator's display name (empty if the user is missing).
func (l *Lobby) hostName(createdBy int64) string {
	if u, err := l.st.UserByID(createdBy); err == nil {
		return u.Name
	}
	return ""
}

// hostDecoration resolves the creator's equipped name decoration ("" if none
// or on error; cosmetics are best-effort).
func (l *Lobby) hostDecoration(createdBy int64) string {
	lo, err := l.st.Loadout(createdBy)
	if err != nil {
		return ""
	}
	return lo["decoration"]
}

// defaultTurnTimerSec is applied when a config omits the turn timer. It
// matches the "Normal" preset served to the lobby UI.
const defaultTurnTimerSec = timings.DefaultTurnTimerSec

// validateConfig checks a game config and applies defaults in place.
func validateConfig(cfg *engine.GameConfig) error {
	if cfg.Players < 2 || cfg.Players > 10 {
		return fmt.Errorf("%w: players must be 2-10", ErrBadConfig)
	}
	// Every game must have a positive turn timer: an untimed game lets a human
	// seat stall the actor indefinitely, and budgetFor reads a non-positive
	// timer as "arm no clock", disabling every per-decision cap. Zero means
	// "use the default"; anything still non-positive is rejected rather than
	// defaulted.
	if cfg.TurnTimerSec == 0 {
		cfg.TurnTimerSec = defaultTurnTimerSec
	}
	if cfg.Ruleset == "" {
		cfg.Ruleset = "base"
	}
	// Two refusals with different transport codes: a ruleset combining two
	// incompatible expansions (the host has a choice to make, and the conflict
	// carries which pair and why), and one naming an unknown module.
	// engine.CheckRuleset holds both, so replay upload (replay.Fold) refuses
	// the same configs.
	if err := engine.CheckRuleset(cfg.Ruleset); err != nil {
		var ce *engine.ConflictError
		if errors.As(err, &ce) {
			return fmt.Errorf("%w: %w", ErrRulesetConflict, ce)
		}
		return fmt.Errorf("%w: unknown ruleset %q", ErrBadConfig, cfg.Ruleset)
	}
	// Pin the module order at creation. Module order decides which
	// DefaultConfig sets TargetVP first, so "base+cak+caravans" and
	// "base+caravans+cak" would otherwise play to different targets. Done here
	// and never at resolution time; see engine.CanonicalRuleset.
	cfg.Ruleset = engine.CanonicalRuleset(cfg.Ruleset)
	// The friendly robber means nothing without a robber (Wagons, Raiders,
	// Explorers); the lobby hides the switch and the engine ignores it
	// (State.FriendlyRobberActive). Cleared here so a stale value is not
	// stored as a table setting.
	if !engine.RulesetHasRobber(cfg.Ruleset) {
		cfg.FriendlyRobber = false
	}
	// Check the resolved target, not the one sent: server-side creators name
	// no target, and the game is played to the ruleset default plus module
	// adjustments. engine.ResolveTargetVP is the path State.New takes.
	if resolvedVP := engine.ResolveTargetVP(*cfg); cfg.TargetVP < 0 || resolvedVP > engine.MaxVPWithoutCards(*cfg) || cfg.TurnTimerSec < timings.TurnTimerSecMin || cfg.TurnTimerSec > timings.TurnTimerSecMax || cfg.DiscardLimit < 0 || cfg.DiscardLimit > 20 {
		return ErrBadConfig
	}
	if cfg.DiceMode != "" && cfg.DiceMode != engine.DiceRandom && cfg.DiceMode != engine.DiceFair {
		return fmt.Errorf("%w: dice_mode must be %q or %q", ErrBadConfig, engine.DiceRandom, engine.DiceFair)
	}
	if cfg.BoardMode != "" && cfg.BoardMode != board.BoardRandom && cfg.BoardMode != board.BoardFair {
		return fmt.Errorf("%w: board_mode must be %q or %q", ErrBadConfig, board.BoardRandom, board.BoardFair)
	}
	if cfg.TurnOrder != "" && cfg.TurnOrder != engine.TurnOrderLobby && cfg.TurnOrder != engine.TurnOrderRandom {
		return fmt.Errorf("%w: turn_order must be %q or %q", ErrBadConfig, engine.TurnOrderLobby, engine.TurnOrderRandom)
	}
	if cfg.Board != nil {
		// A custom inlined map wins over a named preset.
		cfg.Preset = ""
		if err := cfg.Board.ValidateLayout(); err != nil {
			return fmt.Errorf("%w: %w", ErrBadConfig, err)
		}
		if err := engine.ValidateMap(cfg.Board, cfg.Ruleset); err != nil {
			return fmt.Errorf("%w: %w", ErrBadConfig, err)
		}
		// ValidateLayout and ValidateMap take no player count, so check that
		// the table fits on an inlined board here, as the preset branch does.
		if err := board.ValidateSeats(cfg.Board, cfg.Players); err != nil {
			return fmt.Errorf("%w: %w", ErrBadConfig, err)
		}
	} else if cfg.Preset != "" {
		if err := board.ValidatePreset(cfg.Preset, cfg.Players); err != nil {
			return fmt.Errorf("%w: %w", ErrBadConfig, err)
		}
		if err := engine.ValidatePresetRuleset(cfg.Preset, cfg.Players, cfg.Ruleset); err != nil {
			return fmt.Errorf("%w: %w", ErrBadConfig, err)
		}
	} else {
		// Neither a custom board nor a preset: a server-side creator (e.g.
		// ActivityLobby for a Discord Activity) picked no map. Give it the
		// default a frontend create sends, a full-land board sized to the player
		// count, so the waiting room previews a real map and the engine resolves
		// it at start like any supplied board.
		//
		// Except for a scenario that deals its own map (Explorers), which must
		// have no board at all; a supplied board is refused for it.
		if _, ownMap := engine.DealsItsOwnMap(cfg.Ruleset); !ownMap {
			cfg.Board = fullLandBoard(board.RadiusFor(cfg.Players))
			if err := engine.ValidateMap(cfg.Board, cfg.Ruleset); err != nil {
				return fmt.Errorf("%w: %w", ErrBadConfig, err)
			}
		}
	}
	return nil
}

// fullLandBoard builds a generic full-land hexagon of the given radius: every
// hex is ResLand with no pinned number, robber on the center. It is the
// shape-only counterpart to the frontend's standard maps; the engine carves
// the desert and deals resources, numbers and harbors at start. Used when a
// config specifies no board or preset.
func fullLandBoard(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// Create validates the config and creates a lobby game; the host takes seat 0.
func (l *Lobby) Create(host *store.User, cfg engine.GameConfig, private bool) (*Summary, error) {
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}
	// Hosting requires a registered account. Guests only enter through an
	// invite link (see Join).
	if host.IsGuest {
		return nil, ErrGuestNeedsLink
	}

	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	seed, commit := newPublicSeed()
	g := &store.Game{
		ID:        randomID(10),
		Ruleset:   cfg.Ruleset,
		Config:    cfgJSON,
		CreatedBy: host.ID,
		// Committed now, revealed with the finished replay. See newPublicSeed.
		PublicSeed:       seed,
		PublicSeedCommit: commit,
	}
	// Every table gets a link, public or not: a public table is joinable from
	// the browser and by link, and making it private later keeps the link the
	// host already sent.
	g.InviteCode = randomID(8)
	g.Public = !private
	if err := l.st.CreateGame(g); err != nil {
		return nil, err
	}
	if err := l.st.AddSeat(g.ID, 0, host.ID); err != nil {
		return nil, err
	}
	l.stampSeatColor(host.ID, g.ID, 0)
	return l.Summary(g.ID)
}

// UpdateConfig lets the host change table settings while the game is still in
// the lobby. Player count may not drop below the number already seated.
func (l *Lobby) UpdateConfig(host *store.User, gameID string, cfg engine.GameConfig) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	if cfg.Players < len(seats) {
		return nil, fmt.Errorf("%w: players below seated count", ErrBadConfig)
	}
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	if err := l.st.UpdateGameConfig(gameID, cfgJSON); err != nil {
		return nil, err
	}
	if cfg.Ruleset != g.Ruleset {
		if err := l.st.UpdateGameRuleset(gameID, cfg.Ruleset); err != nil {
			return nil, err
		}
	}
	return l.Summary(gameID)
}

// Join seats a user. A correct invite code always admits its holder. Without
// one the table must be public, and a public table requires a Discord identity
// (guests come in via links).
func (l *Lobby) Join(u *store.User, gameID, invite string) (*Summary, error) {
	defer l.lockGame(gameID)()
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	// The code admits its holder to any table, listed or not. Without it the
	// table must be public, and guests need the code even then: a guest
	// account exists only because someone was sent a link.
	if byLink := invite != "" && invite == g.InviteCode; !byLink {
		if !g.Public {
			return nil, ErrBadInvite
		}
		if u.IsGuest {
			return nil, ErrGuestNeedsLink
		}
	}

	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return nil, err
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	for _, s := range seats {
		if s.UserID == u.ID {
			return nil, ErrAlreadySeated
		}
	}
	if len(seats) >= cfg.Players {
		return nil, ErrFull
	}

	// Next free seat number; PK collisions (concurrent joins) retry once.
	taken := map[int]bool{}
	for _, s := range seats {
		taken[s.No] = true
	}
	for range 2 {
		no := -1
		for i := range cfg.Players {
			if !taken[i] {
				no = i
				break
			}
		}
		if no == -1 {
			return nil, ErrFull
		}
		err := l.st.AddSeat(gameID, no, u.ID)
		if err == nil {
			l.stampSeatColor(u.ID, gameID, no)
			return l.Summary(gameID)
		}
		// A concurrent Join by this same user already seated them; fail rather
		// than retry into a second seat.
		if errors.Is(err, store.ErrSeatTaken) {
			return nil, ErrAlreadySeated
		}
		// Otherwise it was a seat_no collision; mark it taken and try the next.
		taken[no] = true
	}
	return nil, ErrFull
}

// SetPrivacy lists or unlists a lobby game. Host only. A game can't be made
// public while a non-bot guest is seated: guests are confined to tables you
// have to be invited to (mirrors the gates in Create and Join).
//
// Going public keeps the code, and the listed table shows it. Going private
// rotates it, so a link that circulated while the table was open stops
// working; anyone the host sent the old link needs the new one.
func (l *Lobby) SetPrivacy(host *store.User, gameID string, private bool) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	if g.Public == !private {
		return l.Summary(gameID) // already in the requested state
	}
	if !private {
		seats, err := l.st.Seats(gameID)
		if err != nil {
			return nil, err
		}
		for _, s := range seats {
			if s.IsGuest && s.Status != "bot" {
				return nil, ErrGuestNeedsLink
			}
		}
	}
	// Rotate when going private. This also covers pre-0029 public tables that
	// have no code yet.
	if private {
		if err := l.st.SetGameInvite(gameID, randomID(8)); err != nil {
			return nil, err
		}
	}
	if err := l.st.SetGamePublic(gameID, !private); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// AddBot seats a bot in a lobby game (host only).
func (l *Lobby) AddBot(host *store.User, gameID string) (*Summary, error) {
	defer l.lockGame(gameID)()
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return nil, err
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	if len(seats) >= cfg.Players {
		return nil, ErrFull
	}
	takenNames := map[string]bool{}
	for _, s := range seats {
		takenNames[s.UserName] = true
	}
	botUser, err := l.st.CreateGuest(pickBotName(takenNames))
	if err != nil {
		return nil, err
	}
	taken := map[int]bool{}
	for _, s := range seats {
		taken[s.No] = true
	}
	no := -1
	for i := range cfg.Players {
		if !taken[i] {
			no = i
			break
		}
	}
	if no == -1 {
		return nil, ErrFull
	}
	// Bots never pick a color, so assign one under the same distinctness rule
	// humans get. The seat-order default alone only avoids other defaults, so a
	// bot could otherwise clone a color a player picked or was seeded.
	var others []cosmetics.Color
	for _, s := range seats {
		others = append(others, effectiveColor(s))
	}
	// Seat, status and color in one transaction, so a partial write cannot
	// leave a "bot" seat that is really an empty human seat.
	if err := l.st.AddSeatFull(gameID, store.SeatPlacement{
		No: no, UserID: botUser.ID, Status: "bot", Color: cosmetics.PickSeatColor(others, no).ID,
	}); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// KickSeat removes a seat from a lobby game (host only). Works for both bots and
// human players; the host's own seat cannot be kicked. A kicked human's client
// sees itself drop out of the broadcast summary and returns to the lobby.
func (l *Lobby) KickSeat(host *store.User, gameID string, seatNo int) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	var target *store.Seat
	for _, s := range seats {
		if s.No == seatNo {
			target = s
			break
		}
	}
	if target == nil {
		return nil, ErrNotSeated
	}
	if target.UserID == g.CreatedBy {
		return nil, ErrCantKickHost
	}
	if err := l.st.RemoveSeat(gameID, seatNo); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// ReconcileActivityParticipants drops seated humans from a Discord Activity
// lobby whose Discord account is no longer present in the activity. The
// Embedded App SDK keeps the iframe and its websocket alive when a participant
// switches away, so the normal disconnect path never fires; the host's client
// reports the live participant set and this prunes the rest.
//
// Host only and lobby only: an active game handles absence via the grace
// window and bot takeover. The host's seat and bot seats are kept. discordIDs
// are the snowflakes currently in the activity; unlinked IDs are ignored.
func (l *Lobby) ReconcileActivityParticipants(host *store.User, instanceID string, discordIDs []string) (*Summary, error) {
	gameID, err := l.st.ActivityGame(instanceID)
	if err != nil {
		return nil, err
	}
	if gameID == "" {
		return nil, store.ErrNotFound
	}
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}

	// Resolve the Discord snowflakes to local user IDs. An unlinked ID is not
	// counted as present.
	present := make(map[int64]bool, len(discordIDs))
	for _, did := range discordIDs {
		if did == "" {
			continue
		}
		u, err := l.st.UserByDiscordID(did)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		present[u.ID] = true
	}

	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	for _, s := range seats {
		if s.Status == "bot" || s.UserID == g.CreatedBy {
			continue // bots aren't participants; the host is never reconciled away
		}
		if present[s.UserID] {
			continue
		}
		if err := l.st.RemoveSeat(gameID, s.No); err != nil {
			return nil, err
		}
	}
	return l.Summary(gameID)
}

// TransferHost hands lobby ownership (CreatedBy and all host powers) to
// another seated player (host only). The new host must be a registered
// (non-guest) human, mirroring the create-time guard. The former host keeps
// their seat.
func (l *Lobby) TransferHost(host *store.User, gameID string, newHostID int64) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	if newHostID == g.CreatedBy || !hostEligible(seats, newHostID) {
		return nil, ErrBadHostTarget
	}
	if err := l.st.SetGameHost(gameID, newHostID); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// hostEligible reports whether userID holds a seat that qualifies to host: a
// registered (non-guest) human, never a bot.
func hostEligible(seats []*store.Seat, userID int64) bool {
	for _, s := range seats {
		if s.UserID == userID {
			return s.Status != "bot" && !s.IsGuest
		}
	}
	return false
}

// hostSuccessor picks the seat that should inherit the host role when the current
// host leaves: the lowest-seat-number eligible player (registered human, not a
// bot or guest), excluding the leaving host. Returns nil if none qualifies.
func hostSuccessor(seats []*store.Seat, leavingHostID int64) *store.Seat {
	var best *store.Seat
	for _, s := range seats {
		if s.UserID == leavingHostID || s.Status == "bot" || s.IsGuest {
			continue
		}
		if best == nil || s.No < best.No {
			best = s
		}
	}
	return best
}

// SetSeatColor sets the caller's own seat color in a lobby game. The pick is
// gated by cosmetics (free, active-supporter, or previously-kept colors) and
// must stay perceptually distinct from every other seated color (first-come
// lock). Supporter colors used here are kept forever (see docs/cosmetics.md §6).
func (l *Lobby) SetSeatColor(u *store.User, gameID, colorID string) (*Summary, error) {
	defer l.lockGame(gameID)()
	if l.colors == nil {
		return nil, ErrColorTaken // colors disabled; treat as unavailable
	}
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	mine, err := l.st.SeatForUser(gameID, u.ID)
	if err != nil {
		return nil, ErrNotSeated
	}
	col, err := l.colors.UseColor(u.ID, colorID)
	if err != nil {
		return nil, err // cosmetics.ErrUnknownColor / ErrNotOwned
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	var others []cosmetics.Color
	for _, s := range seats {
		if s.No != mine.No {
			others = append(others, effectiveColor(s))
		}
	}
	if !cosmetics.AllowedColor(others, col, cosmetics.ColorThreshold) {
		return nil, ErrColorTaken
	}
	if err := l.st.SetSeatColor(gameID, mine.No, col.ID); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// SetSeatName sets the caller's own per-game seat name in a lobby game. An empty
// name clears the override, reverting the seat to the user's account name. It is
// a presentational per-seat field and never touches the user's account identity.
func (l *Lobby) SetSeatName(u *store.User, gameID, name string) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	mine, err := l.st.SeatForUser(gameID, u.ID)
	if err != nil {
		return nil, ErrNotSeated
	}
	if err := l.st.SetSeatDisplayName(gameID, mine.No, name); err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// SetSeatDecoration equips (or clears, with "") the player's name decoration.
// Decoration has no per-seat override; a seat renders it from the user's
// loadout. So this equips into the loadout, like the account cosmetics menu,
// and the rebuilt Summary reflects it. The cosmetics service enforces
// ownership and role gating.
func (l *Lobby) SetSeatDecoration(u *store.User, gameID, decoration string) (*Summary, error) {
	if l.colors == nil {
		return nil, ErrNotInLobby // cosmetics disabled; nothing to equip
	}
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.Status != "lobby" {
		return nil, ErrNotInLobby
	}
	if _, err := l.st.SeatForUser(gameID, u.ID); err != nil {
		return nil, ErrNotSeated
	}
	if decoration == "" {
		err = l.colors.Unequip(u.ID, string(cosmetics.SlotDecoration))
	} else {
		err = l.colors.Equip(u.ID, string(cosmetics.SlotDecoration), decoration)
	}
	if err != nil {
		return nil, err
	}
	return l.Summary(gameID)
}

// stampSeatColor gives a freshly seated player an explicit color: their
// preferred loadout color when they own it and it clears every other seat,
// otherwise the closest free preset that does (PickSeatColor, which prefers
// the seat's order default).
//
// It always stamps. Resolving an empty column to DefaultSeatColor(seat_no) at
// read time only avoids other defaults, so a seat could clone a color another
// player had already picked, and Start pins colors as they stand. Best-effort:
// a store failure leaves the seat on its default.
//
// With colors unconfigured (l.colors == nil) there is no loadout and the
// preset stands alone; the distinctness rule does not depend on cosmetics.
func (l *Lobby) stampSeatColor(userID int64, gameID string, seatNo int) {
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return
	}
	var others []cosmetics.Color
	for _, s := range seats {
		if s.No != seatNo {
			others = append(others, effectiveColor(s))
		}
	}
	col := cosmetics.PickSeatColor(others, seatNo)
	if l.colors != nil {
		if id, err := l.colors.LoadoutColor(userID); err == nil && id != "" {
			// UseColor keeps a supporter color once worn, so only call it for a
			// color the player asked for.
			if pref, err := l.colors.UseColor(userID, id); err == nil &&
				cosmetics.AllowedColor(others, pref, cosmetics.ColorThreshold) {
				col = pref
			}
		}
	}
	_ = l.st.SetSeatColor(gameID, seatNo, col.ID)
}

// keepDistinct returns want when it clears every color already assigned, and
// otherwise a free preset that does (preferring seatNo's order default).
//
// Used where a color is carried rather than chosen: a reseat keeps each
// player's color, which is only distinct if the original table was.
func keepDistinct(placed []cosmetics.Color, want cosmetics.Color, seatNo int) cosmetics.Color {
	if cosmetics.AllowedColor(placed, want, cosmetics.ColorThreshold) {
		return want
	}
	return cosmetics.PickSeatColor(placed, seatNo)
}

// Leave drops the caller from a lobby game. The host leaving is special: the
// host role auto-transfers to the lowest-seat eligible player (registered human)
// so the table survives. Only when no eligible successor remains does the whole
// lobby close (every seat dropped, game abandoned, closed=true). A regular
// player just vacates their own seat.
func (l *Lobby) Leave(u *store.User, gameID string) (closed bool, err error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return false, err
	}
	if g.Status != "lobby" {
		return false, ErrNotInLobby
	}
	if g.CreatedBy == u.ID {
		seats, err := l.st.Seats(gameID)
		if err != nil {
			return false, err
		}
		successor := hostSuccessor(seats, u.ID)
		if successor == nil {
			// No one can take over: tear the table down for everyone.
			return true, l.Close(gameID)
		}
		if err := l.st.SetGameHost(gameID, successor.UserID); err != nil {
			return false, err
		}
		// Vacate the departing host's own seat, if they held one.
		if seat, err := l.st.SeatForUser(gameID, u.ID); err == nil {
			if err := l.st.RemoveSeat(gameID, seat.No); err != nil {
				return false, err
			}
		} else if !errors.Is(err, store.ErrNotFound) {
			return false, err
		}
		return false, nil
	}
	seat, err := l.st.SeatForUser(gameID, u.ID)
	if errors.Is(err, store.ErrNotFound) {
		return false, ErrNotSeated
	}
	if err != nil {
		return false, err
	}
	return false, l.st.RemoveSeat(gameID, seat.No)
}

// Spectate drops the user's player seat so they watch the lobby without holding
// a slot. The host may opt out too (e.g. to host an all-bot table and watch it);
// they stay the CreatedBy owner and keep lobby control. A user with no seat is
// already a spectator: no-op.
func (l *Lobby) Spectate(u *store.User, gameID string) error {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return err
	}
	if g.Status != "lobby" {
		return ErrNotInLobby
	}
	seat, err := l.st.SeatForUser(gameID, u.ID)
	if errors.Is(err, store.ErrNotFound) {
		return nil // not seated -> already spectating
	}
	if err != nil {
		return err
	}
	return l.st.RemoveSeat(gameID, seat.No)
}

// Close abandons a lobby game: every seat is dropped and the game is marked
// "abandoned" (excluded from Browse and rejoin lookups). Used when the host
// leaves and nobody can be promoted.
func (l *Lobby) Close(gameID string) error {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return err
	}
	if g.Status != "lobby" {
		return ErrNotInLobby
	}
	// Dropping the seats and marking the table gone happen together, so a
	// failure cannot leave a browsable, seatless lobby.
	return l.st.ReplaceSeats(store.ReplaceSeatsInput{GameID: gameID, Status: "abandoned"})
}

// AbandonActive tears down a live game: stop its actor, mark the row abandoned.
// Runs off the actor loop, so Release's Stop join can't self-deadlock.
func (l *Lobby) AbandonActive(gameID string) error {
	l.mgr.Release(gameID)
	return l.st.SetGameStatus(gameID, "abandoned")
}

// Start moves a lobby game into play. Host only; at least 2 seated. The
// config's player count shrinks to the seated count so partial lobbies play.
func (l *Lobby) Start(u *store.User, gameID string) error {
	// Held across the whole transition: the seat rebuild happens between the
	// status check and the manager handoff.
	defer l.lockGame(gameID)()
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return err
	}
	if g.Status != "lobby" {
		return ErrNotInLobby
	}
	if g.CreatedBy != u.ID {
		return ErrNotHost
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return err
	}
	if len(seats) < 2 {
		return ErrNotEnough
	}

	// Starting with fewer than two human seats (the host alone against bots,
	// or an all-bot table the host watches) is a supporter perk. Skipped when
	// no SupporterGate is wired.
	if l.supporters != nil {
		humans := 0
		for _, s := range seats {
			if s.Status != "bot" {
				humans++
			}
		}
		if humans < 2 {
			ok, err := l.supporters.IsSupporter(u.ID)
			if err != nil {
				return err
			}
			if !ok {
				return ErrSupporterOnly
			}
		}
	}

	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return err
	}
	cfg.Players = len(seats)
	// Canonicalise before writing the config back, so the stored ruleset (and
	// so the stats bucket and leaderboard category) matches what
	// Manager.Start plays, even for rows that bypassed validateConfig.
	cfg.Ruleset = engine.CanonicalRuleset(cfg.Ruleset)
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	ruleset := ""
	if cfg.Ruleset != g.Ruleset {
		ruleset = cfg.Ruleset // the games.ruleset column follows the config
	}

	// Finalize seats into turn order 0..n-1. Seats may have gaps and, for
	// random turn order, need shuffling. The whole seat set is rebuilt so each
	// player keeps their status, color and name at their new seat.
	seeds, err := seedsFor(g)
	if err != nil {
		return err
	}
	order := make([]int, len(seats))
	for i := range order {
		order[i] = i
	}
	var roster []int64
	if cfg.TurnOrder == engine.TurnOrderRandom {
		// Derived from the public seed committed when the table opened, so a
		// finished game's seating can be checked like its dice (verify/). A
		// legacy game with no committed seed keeps the crypto/rand shuffle.
		if g.PublicSeed != "" {
			order = seatOrder(seeds.Public, len(seats))
			// Record what the permutation was applied to; without the input the
			// derived seating cannot be checked.
			roster = make([]int64, len(seats))
			for i, st := range seats {
				roster[i] = st.UserID
			}
		} else {
			order = shuffleOrder(len(seats))
		}
	}
	placements := make([]store.SeatPlacement, len(order))
	var placed []cosmetics.Color
	for newNo, idx := range order {
		s := seats[idx]
		// An unpicked seat has an empty Color and renders its seat-order
		// default. Carrying the empty value across the renumber would make the
		// color follow the seat, not the player, so pin the color the player was
		// shown. Seats are stamped at creation now, so this only matters for
		// older lobbies; keepDistinct changes a color only if pinning would give
		// two seats the same one.
		shown := effectiveColor(s) // s still carries its pre-shuffle seat number
		col := keepDistinct(placed, shown, newNo)
		placed = append(placed, col)
		// Keep the seat's own value unless something forced a change, so a
		// color id this build does not recognise survives the reseat.
		color := s.Color
		if color == "" || col.ID != shown.ID {
			color = col.ID
		}
		placements[newNo] = store.SeatPlacement{
			No: newNo, UserID: s.UserID, Status: s.Status, Color: color, DisplayName: s.DisplayName,
		}
	}
	// One transaction for the handover: player count, canonical ruleset,
	// pre-shuffle roster and rebuilt seats. A partial failure must not leave a
	// lobby with a changed config and missing seats.
	if err := l.st.ReplaceSeats(store.ReplaceSeatsInput{
		GameID:          gameID,
		Seats:           placements,
		Config:          cfgJSON,
		Ruleset:         ruleset,
		PreShuffleSeats: roster,
	}); err != nil {
		return err
	}

	return l.mgr.Start(gameID, cfg, seeds)
}

// Rematch creates a fresh lobby from a finished game, reusing its config and
// roster: the host takes seat 0, every still-present human (in `present`) is
// reseated, and each bot seat is recreated as a new bot. Humans who already
// left are dropped. Seats bypass Join's guest/invite gates: this is a host
// recreating a roster that already played together.
func (l *Lobby) Rematch(host *store.User, finishedGameID string, present map[int64]bool) (*Summary, error) {
	g, err := l.st.GameByID(finishedGameID)
	if err != nil {
		return nil, err
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	if g.Status != "finished" {
		return nil, ErrNotFinished
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return nil, err
	}
	oldSeats, err := l.st.Seats(finishedGameID)
	if err != nil {
		return nil, err
	}
	return l.recreateLobby(host, g.ID, cfg, oldSeats, !g.Public, present)
}

// ResetToLobby sends an in-progress game back to a fresh lobby with the same
// roster. Host only, and never for a ranked game. The new lobby is built from
// the still-present roster (as Rematch does), and only then is the live game
// torn down: its actor stopped and the row marked "abandoned" (events stay on
// disk). Finished games use Rematch.
func (l *Lobby) ResetToLobby(host *store.User, gameID string, present map[int64]bool) (*Summary, error) {
	defer l.lockGame(gameID)()
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	if g.CreatedBy != host.ID {
		return nil, ErrNotHost
	}
	if g.Status != "active" {
		return nil, ErrNotActive
	}
	// Reset is the only host power that accepts a live game, and a ranked
	// table's "host" exists only because created_by is a required foreign key.
	// Allowing it would let that player abandon a rated game they were losing,
	// skipping ratings, stats, strikes and the match record.
	if g.Ranked {
		return nil, ErrRankedNoReset
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return nil, err
	}
	oldSeats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	// Rebuild before tearing down, so a failed rebuild leaves the game running
	// and costs at most an empty lobby (which the orphan-lobby sweep closes).
	// Stopping the actor runs off the actor loop, so Release won't self-join.
	sum, err := l.recreateLobby(host, g.ID, cfg, oldSeats, !g.Public, present)
	if err != nil {
		return nil, err
	}
	if err := l.AbandonActive(gameID); err != nil {
		return nil, err
	}
	return sum, nil
}

// recreateLobby builds a fresh lobby game from an existing roster: Create seats
// the host at 0, then each still-present human is reseated and each bot seat
// is recreated as a new bot, in old-seat order, up to cfg.Players. Humans
// absent from `present` are dropped. Shared by Rematch and ResetToLobby.
//
// Each carried seat keeps the color it rendered with, stamped explicitly
// because seat numbers shift when players are dropped. Colors still go
// through keepDistinct, since an older table may carry a clash.
//
// The new table is always casual: Create never sets Ranked. Rated matches come
// from the matchmaker, which is why ResetToLobby refuses ranked games.
func (l *Lobby) recreateLobby(host *store.User, oldID string, cfg engine.GameConfig, oldSeats []*store.Seat, private bool, present map[int64]bool) (*Summary, error) {
	sum, err := l.Create(host, cfg, private)
	if err != nil {
		return nil, err
	}
	newID := sum.Game.ID
	// A Discord Activity instance points at one table, so move the pointer to
	// the replacement; otherwise later joiners would land in the ended game.
	if err := l.st.FollowActivityGame(oldID, newID); err != nil {
		return nil, err
	}

	// Create seats the host at 0, but a host who was spectating the old game
	// (see Spectate) stays out of the seats: the roster below omits seat 0 and
	// the whole-set replace drops the one Create made.
	var placements []store.SeatPlacement
	// Colors already placed, to check each carried one against. The host goes
	// first and always keeps theirs.
	var placed []cosmetics.Color
	carry := func(s *store.Seat, no int) string {
		col := keepDistinct(placed, effectiveColor(s), no)
		placed = append(placed, col)
		return col.ID
	}
	for _, s := range oldSeats {
		if s.UserID == host.ID {
			// Create seeded seat 0 from the host's loadout color; their old
			// color wins so the host's color does not change across a reset.
			placements = append(placements, store.SeatPlacement{No: 0, UserID: host.ID, Color: carry(s, 0)})
			break
		}
	}
	no := len(placements) // 1 if the host is seated, else 0
	// Track bot names taken in the new game so each rematched bot gets a distinct
	// name from the pool, matching AddBot's behavior.
	takenNames := map[string]bool{}
	for _, s := range oldSeats {
		if no >= cfg.Players {
			break
		}
		if s.UserID == host.ID {
			continue
		}
		switch {
		case s.Status == "bot":
			name := pickBotName(takenNames)
			takenNames[name] = true
			// The guest row cannot join the transaction below (it returns the
			// id the seats need). An unused guest is inert, so a later failure
			// leaks a row rather than a half-built table.
			// botUser, not bot: the bot package is imported here.
			botUser, err := l.st.CreateGuest(name)
			if err != nil {
				return nil, err
			}
			placements = append(placements, store.SeatPlacement{
				No: no, UserID: botUser.ID, Status: "bot", Color: carry(s, no),
			})
			no++
		case present[s.UserID]:
			placements = append(placements, store.SeatPlacement{
				No: no, UserID: s.UserID, Color: carry(s, no),
			})
			no++
		}
	}
	// One transaction for the whole roster, so the new table is either
	// complete or has only Create's host seat.
	if err := l.st.ReplaceSeats(store.ReplaceSeatsInput{GameID: newID, Seats: placements}); err != nil {
		return nil, err
	}
	return l.Summary(newID)
}

// activityDefaultConfig is the table a Discord Activity opens with, and what it
// re-opens with when the call's previous table is gone.
func activityDefaultConfig() engine.GameConfig {
	return engine.GameConfig{Players: 4, TargetVP: 10, DiscardLimit: 7, Ruleset: "base", DiceMode: "fair", BoardMode: "fair", TurnOrder: "random"}
}

// activityTableGone reports whether an instance's mapped table can no longer
// be entered or watched, so the next opener needs a fresh one.
//
// "abandoned" is common: the orphan-lobby sweep closes deserted activity
// lobbies, presence teardown abandons deserted active games, and a host reset
// abandons the old row. "paused-error" is frozen for diagnosis. "lobby",
// "active" and "finished" are not gone (waiting room, board, scoreboard).
func activityTableGone(status string) bool {
	return status == "abandoned" || status == "paused-error"
}

// replaceActivityTable gives an instance whose table is gone a fresh one and
// returns the game id to use. The repoint is guarded on the dead id, so
// simultaneous openers all get the winner's game; a loser's own creation is
// left behind.
func (l *Lobby) replaceActivityTable(u *store.User, instanceID, deadGameID string) (string, error) {
	sum, err := l.Create(u, activityDefaultConfig(), true)
	if err != nil {
		return "", err
	}
	won, err := l.st.RepointActivity(instanceID, deadGameID, sum.Game.ID)
	if err != nil {
		return "", err
	}
	if won {
		return sum.Game.ID, nil
	}
	_, _ = l.Leave(u, sum.Game.ID)
	return l.st.ActivityGame(instanceID)
}

// ActivityLobby maps a Discord Activity instance to a game: the first opener
// creates a private game (host); later openers join as a player, or spectate
// when the table is full or in progress. role is "host"/"player"/"spectator".
//
// When the mapped table is gone (see activityTableGone), the opener creates a
// replacement and repoints the instance, so a call is not stuck with a dead
// room.
func (l *Lobby) ActivityLobby(u *store.User, instanceID string) (*Summary, string, error) {
	gid, err := l.st.ActivityGame(instanceID)
	if err != nil {
		return nil, "", err
	}
	if gid != "" {
		// A mapping to a row that no longer exists reads the same as a dead one.
		g, gErr := l.st.GameByID(gid)
		dead := errors.Is(gErr, store.ErrNotFound)
		switch {
		case gErr != nil && !dead:
			return nil, "", gErr
		case dead || activityTableGone(g.Status):
			// Won or lost the repoint, the code below resolves our role in
			// whichever table the instance now points at (seat 0 of our own
			// creation reads back as "host").
			if gid, err = l.replaceActivityTable(u, instanceID, gid); err != nil {
				return nil, "", err
			}
		}
	}
	if gid == "" {
		sum, err := l.Create(u, activityDefaultConfig(), true)
		if err != nil {
			return nil, "", err
		}
		created, err := l.st.MapActivity(instanceID, sum.Game.ID)
		if err != nil {
			return nil, "", err
		}
		if created {
			return sum, "host", nil
		}
		// Lost the create race: abandon our just-created game and use the winner.
		_, _ = l.Leave(u, sum.Game.ID)
		gid, err = l.st.ActivityGame(instanceID)
		if err != nil || gid == "" {
			return nil, "", err
		}
	}

	g, err := l.st.GameByID(gid)
	if err != nil {
		return nil, "", err
	}
	seats, err := l.st.Seats(gid)
	if err != nil {
		return nil, "", err
	}
	for _, s := range seats {
		if s.UserID == u.ID {
			role := "player"
			if s.No == 0 {
				role = "host"
			}
			sum, err := l.Summary(gid)
			return sum, role, err
		}
	}
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil {
		return nil, "", err
	}
	if g.Status == "lobby" && len(seats) < cfg.Players {
		sum, err := l.Join(u, gid, g.InviteCode)
		if err != nil {
			return nil, "", err
		}
		return sum, "player", nil
	}
	sum, err := l.Summary(gid)
	return sum, "spectator", err
}

func (l *Lobby) Summary(gameID string) (*Summary, error) {
	g, err := l.st.GameByID(gameID)
	if err != nil {
		return nil, err
	}
	seats, err := l.st.Seats(gameID)
	if err != nil {
		return nil, err
	}
	seats = fillColors(seats)
	l.attachRatings(seats, g.Ruleset)
	deco := l.hostDecoration(g.CreatedBy)
	tw := timings.For(cfgTurnTimerSec(g))
	return &Summary{Game: g, Seats: seats, HostName: l.hostName(g.CreatedBy), HostDecoration: deco, Timings: &tw}, nil
}

// attachRatings fills each non-guest seat's display rating for the game's
// ruleset for the waiting room. Bots and guests are left unrated, as are
// players with no rated game in this ruleset (zero UpdatedAt), who show as
// "Unrated" like on the profile rather than the seeded 1000. Best-effort: a
// lookup error leaves a seat unrated.
func (l *Lobby) attachRatings(seats []*store.Seat, ruleset string) {
	for _, s := range seats {
		if s.IsGuest {
			continue
		}
		r, err := l.st.RatingRow(s.UserID, ruleset)
		if err != nil || r.UpdatedAt == 0 {
			continue
		}
		s.Rating = r.Display
		s.Provisional = rating.Provisional(rating.Player{Mu: r.Mu, Sigma: r.Sigma})
	}
}

// browseCacheTTL bounds how stale the public game list may be. Hosts and
// seated players see their own changes immediately via responses and
// broadcasts, so this only delays other observers.
const browseCacheTTL = 2 * time.Second

// Browse lists public games waiting for players. Results are cached for
// browseCacheTTL; concurrent callers within the window share one DB pass.
func (l *Lobby) Browse() ([]*Summary, error) {
	l.browseMu.Lock()
	defer l.browseMu.Unlock()
	if l.browseCache != nil && l.now().Sub(l.browseAt) < browseCacheTTL {
		return l.browseCache, nil
	}
	out, err := l.summariesForStatus("lobby")
	if err != nil {
		return nil, err
	}
	l.browseCache = out
	l.browseAt = l.now()
	return out, nil
}

// LiveGames returns summaries of in-progress public games available to
// spectate (status 'active'). Private games are never included. Not cached, so
// the homepage "live now" list stays current; callers should rate-limit by IP
// at the HTTP edge.
func (l *Lobby) LiveGames() ([]*Summary, error) {
	return l.summariesForStatus("active")
}

// summariesForStatus builds public-game summaries for one game status, attaching
// seats and host cosmetics.
func (l *Lobby) summariesForStatus(status string) ([]*Summary, error) {
	games, err := l.st.ListGames(status, false)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(games))
	for i, g := range games {
		ids[i] = g.ID
	}
	seatsByGame, err := l.st.SeatsForGames(ids)
	if err != nil {
		return nil, err
	}
	out := make([]*Summary, 0, len(games))
	for _, g := range games {
		deco := l.hostDecoration(g.CreatedBy)
		out = append(out, &Summary{Game: g, Seats: fillColors(seatsByGame[g.ID]), HostName: l.hostName(g.CreatedBy), HostDecoration: deco})
	}
	return out, nil
}

// CreateRankedMatch creates a ranked game with the locked tournament config for
// the queue, seats the matched users in a shuffled order (so turn order is not
// correlated with rating), and starts it immediately. It implements
// ranked.Matcher so Service can call it without importing lobby.
//
// validateConfig is bypassed: the config comes from ranked.ConfigFor, a
// trusted hardcoded config, and engine.New validates it at start.
func (l *Lobby) CreateRankedMatch(queueKey string, userIDs []int64) (string, error) {
	cfg, ok := ranked.ConfigFor(queueKey)
	if !ok {
		return "", ranked.ErrUnknownQueue
	}
	if len(userIDs) != cfg.Players {
		return "", ErrBadConfig
	}
	// Ranked bypasses validateConfig (trusted hardcoded config), so it
	// canonicalises its own ruleset string here.
	cfg.Ruleset = engine.CanonicalRuleset(cfg.Ruleset)
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return "", err
	}
	seed, commit := newPublicSeed()
	g := &store.Game{
		ID:      randomID(10),
		Ruleset: cfg.Ruleset,
		Config:  cfgJSON,
		Ranked:  true,

		PublicSeed:       seed,
		PublicSeedCommit: commit,
	}
	seeds, err := seedsFor(g)
	if err != nil {
		return "", err
	}
	// Shuffle seats so turn order is not correlated with rating (the engine
	// expects the lobby to realise TurnOrder by permuting seats). Derived from
	// the committed public seed so ranked seating is auditable too.
	order := seatOrder(seeds.Public, len(userIDs))
	// CreatedBy must reference a real user (FK). A ranked game has no human
	// host, so use whoever the seed seated first. userIDs arrives sorted by
	// rating, so userIDs[0] would always name the weakest player. No host power
	// applies to a ranked game anyway.
	g.CreatedBy = userIDs[order[0]]
	if err := l.st.CreateGame(g); err != nil {
		return "", err
	}
	seats := make([]store.SeatPlacement, len(order))
	for seatNo, idx := range order {
		seats[seatNo] = store.SeatPlacement{No: seatNo, UserID: userIDs[idx]}
	}
	// Roster and seats in one transaction: a half-seated ranked table has no
	// host or lobby screen to fix it from.
	if err := l.st.ReplaceSeats(store.ReplaceSeatsInput{
		GameID: g.ID, Seats: seats, PreShuffleSeats: userIDs,
	}); err != nil {
		return "", err
	}
	if err := l.mgr.Start(g.ID, cfg, seeds); err != nil {
		return "", err
	}
	return g.ID, nil
}

// botNames are the display names a bot seat can be created under: one per
// personality in bot's registry, in registry order. A game seats at most one
// bot per name (host + up to 9 bots ≤ 10 seats ≤ 11 names), so pickBotName
// always finds an unused one.
//
// The name is the personality; there is no personality column. The bot is a
// guest account under this name, so the choice is read back from users.name
// on every seat row, in the view's SeatNames, and in replays. See
// bot.DisplayNamePrefix.
func botNames() []string {
	ps := bot.Personalities()
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.DisplayName())
	}
	return out
}

// pickBotName returns a random personality not already seated at this table,
// so tables mix strategies. taken is keyed by seat UserName and every caller
// adds the name it gets, so there are no repeats at a table.
//
// The draw uses crypto/rand, not the game's public seed: the seed is under
// commitment until the game ends, and a bot's name is visible immediately.
// Determinism is not needed either, because the name is persisted as the
// bot's identity and read back by replays and views.
//
// Falls back to the first name if every name is in use, which cannot happen
// within one ≤10-seat game.
func pickBotName(taken map[string]bool) string {
	pool := botNames()
	free := pool[:0:0]
	for _, n := range pool {
		if !taken[n] {
			free = append(free, n)
		}
	}
	if len(free) == 0 {
		return pool[0]
	}
	return free[randomIndex(len(free))]
}

// randomIndex draws a uniform index in [0,n) from crypto/rand, by rejection
// sampling rather than a modulo of one byte, which would favour the first few
// personalities.
func randomIndex(n int) int {
	if n <= 1 {
		return 0
	}
	limit := 256 - (256 % n) // the largest multiple of n that fits in a byte
	var b [1]byte
	for {
		if _, err := rand.Read(b[:]); err != nil {
			panic(err)
		}
		if int(b[0]) < limit {
			return int(b[0]) % n
		}
	}
}

const idAlphabet = "abcdefghjkmnpqrstuvwxyz23456789" // no lookalikes

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = idAlphabet[int(b[i])%len(idAlphabet)]
	}
	return string(b)
}

func randomSeed() uint64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return binary.LittleEndian.Uint64(b[:])
}

// newPublicSeed draws the verifiable seed and its commitment. Called when a
// table is created, not when it starts: committing at start would only prove
// the seed did not change after the board was dealt, not that the server did
// not deal boards until it liked one. At creation nobody has joined and the
// config can still change. Returned as a decimal string, as stored (see
// store.Game.PublicSeed).
func newPublicSeed() (seed, commit string) {
	n := randomSeed()
	return strconv.FormatUint(n, 10), engine.SeedCommitment(n)
}

// seedsFor assembles the pair a game starts on: the public seed committed at
// creation and a private seed drawn here, two independent crypto/rand draws
// (see engine.Seeds).
//
// A game created before migration 0030 has no stored public seed. It starts
// with both streams on one fresh seed and its log records no commitment,
// which is how the fold and verify/ recognise it as legacy.
func seedsFor(g *store.Game) (engine.Seeds, error) {
	if g.PublicSeed == "" {
		n := randomSeed()
		return engine.Seeds{Public: n, Private: n}, nil
	}
	pub, err := strconv.ParseUint(g.PublicSeed, 10, 64)
	if err != nil {
		return engine.Seeds{}, fmt.Errorf("game %s: unreadable public seed: %w", g.ID, err)
	}
	return engine.Seeds{Public: pub, Private: randomSeed()}, nil
}

// seatOrder is the turn-order permutation for a game with a committed public
// seed, derived so a finished game's seating can be checked against the
// commitment (engine.SeatOrder, docs/dice.md). A package var so tests can pin
// the permutation.
var seatOrder = engine.SeatOrder

// shuffleOrder returns a permutation of 0..n-1 (Fisher-Yates over crypto/rand).
// A package var so tests can pin it. Legacy path only, for games created
// before migration 0030 that have no commitment to derive seating from.
var shuffleOrder = func(n int) []int {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}
	for i := n - 1; i > 0; i-- {
		j := int(randomSeed() % uint64(i+1))
		p[i], p[j] = p[j], p[i]
	}
	return p
}

// cfgTurnTimerSec reads a game's configured turn timer, falling back to the
// default when the config cannot be parsed; a summary is display data and
// should not fail the read.
func cfgTurnTimerSec(g *store.Game) int {
	var cfg engine.GameConfig
	if err := json.Unmarshal(g.Config, &cfg); err != nil || cfg.TurnTimerSec <= 0 {
		return timings.DefaultTurnTimerSec
	}
	return cfg.TurnTimerSec
}
