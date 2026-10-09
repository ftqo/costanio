package bot

import "sort"

// A Personality is a named version of Strong: a weight vector, any options the
// character needs, and one line of English describing how it plays. The lobby
// seats bots by personality so a table mixes strategies.
//
//   - A personality is data (Weights plus options). Nothing branches on the name
//     at decision time, so personalities can play each other in the ladder.
//   - Legality is unchanged: every candidate still goes through engine.Decide
//     (TestEveryPersonalityStaysLegal).
//   - Determinism is unchanged: vectors are static, and the personality is
//     recorded as the bot's display name (see DisplayNamePrefix), so replays
//     read it back rather than re-deriving it.
//
// Names are proper nouns and are not translated. Character is the English
// source; the frontend keys its localised copy off Name
// (frontend/src/lib/botPersonality.ts).
type Personality struct {
	// Name is the personality's proper noun, without the "Bot " prefix the
	// lobby adds. Never rename: it is persisted in display names and seat rows.
	Name string
	// Character is one line of English saying how this seat plays. No em dash
	// (it is player-facing copy).
	Character string
	// Weights is the vector this personality evaluates with.
	Weights Weights
	// Options are extra knobs on top of the weights. Usually nil.
	Options []Option
}

// New builds the bot this personality describes.
func (p Personality) New() *Strong {
	opts := make([]Option, 0, len(p.Options)+1)
	opts = append(opts, WithWeights(p.Weights))
	opts = append(opts, p.Options...)
	return NewStrong(opts...)
}

// winstonRouteWeight prices the acting seat's own longest route, in eval points
// per edge. It is set so one more edge outscores anything else a single action
// can produce: the spread between the best and worst non-route candidate peaks
// in the low hundreds under DefaultWeights, plus about 27 for module terms.
//
// A winning move still short-circuits the evaluator (see winningMove), so
// Winston takes the win over a road.
const winstonRouteWeight = 1000

// personalities is the registry, in a fixed order. Appending is safe; reordering
// or renaming is not (names are persisted).
//
// William is first and is exactly DefaultWeights (TestWilliamIsTheHouseStrategy);
// docs/bots.md measurements are against that vector. The others are stated as
// multiples of the default.
//
// The lobby gives every bot a distinct name (lobby.botNames), so a ten-seat
// table needs at least ten entries.
var personalities = []Personality{
	{
		Name:      "William",
		Character: "Plays a steady, standard game: take ground early, then convert it to points.",
		Weights:   DefaultWeights(),
	},
	{
		Name:      "Winston",
		Character: "Builds road, then more road. The long way round is the whole plan.",
		Weights:   winstonWeights(),
		// lrChase opens the road-candidate gate in bestPlay and stops Act
		// vetoing a road the Simple fallback proposes.
		Options: []Option{WithLongestRoad()},
	},
	{
		Name:      "Moriarty",
		Character: "Watches whoever is ahead, and puts the robber where it is felt.",
		Weights:   moriartyWeights(),
	},
	{
		Name:      "Happaya",
		Character: "Always has an offer for you. Usually a slightly bad one.",
		Weights:   happayaWeights(),
		// Ungating offers is what makes this seat talkative.
		Options: []Option{WithUngatedOffers()},
	},
	{
		Name:      "Bop",
		Character: "Would rather hold a card than build anything with it. Hoards the deck.",
		Weights:   bopWeights(),
	},
	{
		Name:      "Z",
		Character: "Two good intersections and a mountain of ore. Cities, then more cities.",
		Weights:   zWeights(),
	},
	{
		Name:      "B",
		Character: "Collects harbours, and trades at rates nobody else is getting.",
		Weights:   bWeights(),
	},
	{
		Name:      "Jester",
		Character: "Takes the open ground before anyone asks for it, and holds it.",
		Weights:   jesterWeights(),
	},
	{
		Name:      "Camembert",
		Character: "Hoards a full pantry and hates spending it. Would rather ask you.",
		Weights:   camembertWeights(),
	},
	{
		Name:      "Pika",
		Character: "In a hurry. Grabs the nearest points and worries about the board later.",
		Weights:   pikaWeights(),
	},
	{
		Name:      "Chu",
		Character: "Plays its own board and ignores yours entirely. Serenely unbothered.",
		Weights:   chuWeights(),
	},
}

// winstonWeights is the Longest Road maximalist (see winstonRouteWeight). It
// also needs WithLongestRoad, and halves Expansion and Reach, which compete with
// roads for wood and brick.
func winstonWeights() Weights {
	w := DefaultWeights()
	w.Route = winstonRouteWeight
	w.Expansion *= 0.5
	w.Reach *= 0.5
	return w
}

// moriartyWeights is the blocker: it prices what the robber denies, and it reads
// the field harder than anyone else.
//
// Blocked (robber denial) x5 makes denial a goal rather than a tiebreak. Opp x2
// stays inside the measured plateau (x8 to x32). Threat sharpens attention on
// whoever is closest to winning.
func moriartyWeights() Weights {
	w := DefaultWeights()
	w.Blocked *= 5
	w.Opp *= 2
	w.Threat *= 1.5
	return w
}

// happayaWeights is the trader. Mostly the ungated offer gate; the vector values
// a mixed hand so it has something to offer.
func happayaWeights() Weights {
	w := DefaultWeights()
	w.Hand *= 3
	w.Diversity *= 1.5
	w.Port *= 1.5
	return w
}

// bopWeights holds development cards instead of playing them.
//
// Dev is 0 in the default vector because a flat per-card bonus mis-values the
// cards; Bop is expected to be weaker than William.
//
// At Dev = 25 the seat builds less of everything (cities 0.059/turn vs 0.080,
// settlements 0.079 vs 0.106, roads 0.202 vs 0.249) while dev purchases barely
// move (0.226 vs 0.212). Army is not raised: docs/bots.md finds it inert.
func bopWeights() Weights {
	w := DefaultWeights()
	w.Dev = 25
	return w
}

// zWeights is the city builder: points early, breadth late, and never a road it
// does not have to build.
func zWeights() Weights {
	w := DefaultWeights()
	w.VP *= 2
	w.VPRush *= 2
	w.Prod *= 1.5
	w.Expansion *= 0.4
	w.Reach *= 0.4
	return w
}

// bWeights is the port hoarder. Port prices owned harbours; the two Setup port
// weights are what steer the opening toward a coast, which is the only moment a
// 2:1 is reliably available. Diversity is discounted because a harbour strategy
// wants a flood of one resource, which is the opposite of what the diversity
// bonus rewards.
func bWeights() Weights {
	w := DefaultWeights()
	w.Port *= 4
	w.SetupPort2 *= 3
	w.SetupPort3 *= 3
	w.Diversity *= 0.5
	return w
}

// jesterWeights is the defensive expander: the widest-sprawling vector in the
// registry, on the term docs/bots.md prices as the whole bot (-39.9 to remove),
// plus a heavier endgame watch on the leader.
func jesterWeights() Weights {
	w := DefaultWeights()
	w.Expansion *= 2.5
	w.Reach *= 2.5
	w.Threat *= 2
	return w
}

// camembertWeights is the hoarder: it prices a full, broad hand far above what
// the house vector does, and the effect is that it asks the table for cards
// instead of taking them off the board.
//
// 4x produced no visible change; at 20x trade offers rise to 0.104/turn (vs
// 0.072) and settlements and roads fall. It fights handValue's discard-risk
// penalty, so it is not a strong bot.
func camembertWeights() Weights {
	w := DefaultWeights()
	w.Hand *= 20
	w.Diversity *= 3
	return w
}

// pikaWeights is the rusher: the convex victory-point term turned up so the next
// point always looks urgent, with the positional terms that pay off later turned
// down.
//
// VPRush multiplies vp squared, so raising it steepens the curve. Threat is cut.
func pikaWeights() Weights {
	w := DefaultWeights()
	w.VPRush *= 3
	w.VP *= 1.5
	w.Reach *= 0.5
	w.Threat *= 0.5
	return w
}

// chuWeights is the solipsist: Opp is zero, so the field is invisible and the
// bot maximises its own board with no reference to anyone else's.
//
// This is diversePool's "selfish" arm; docs/bots.md records Opp as worth -6.4
// to remove.
func chuWeights() Weights {
	w := DefaultWeights()
	w.Opp = 0
	return w
}

// Personalities returns the registry in its fixed order. The slice is a copy;
// the Options slices inside it are shared and must not be appended to in place
// (Personality.New copies before it appends).
func Personalities() []Personality {
	out := make([]Personality, len(personalities))
	copy(out, personalities)
	return out
}

// PersonalityNames returns every registered name, in registry order.
func PersonalityNames() []string {
	out := make([]string, 0, len(personalities))
	for _, p := range personalities {
		out = append(out, p.Name)
	}
	return out
}

// PersonalityByName looks a personality up by its proper noun. Names come from
// persisted rows, so callers must handle an unknown name (fall back to
// NewStrong).
func PersonalityByName(name string) (Personality, bool) {
	for _, p := range personalities {
		if p.Name == name {
			return p, true
		}
	}
	return Personality{}, false
}

// DefaultPersonality is the one a seat falls back to when a stored name no
// longer resolves. It is the house strategy.
const DefaultPersonality = "William"

// NewPersonality builds the bot for a name, falling back to the house strategy
// (plain Strong on DefaultWeights) when the name is not registered.
func NewPersonality(name string) *Strong {
	if p, ok := PersonalityByName(name); ok {
		return p.New()
	}
	return NewStrong()
}

// SortedPersonalityNames is the registry sorted, for tests and for any caller
// that wants a stable display order independent of the registry's own.
func SortedPersonalityNames() []string {
	out := PersonalityNames()
	sort.Strings(out)
	return out
}

// DisplayNamePrefix is what the lobby puts in front of a personality name to
// make the display name a player sees ("Winston" -> "Bot Winston").
//
// The display name is where the personality is recorded (there is no
// personality column): it lands in users.name and comes back as Seat.UserName
// and in SeatNames. Renaming a personality orphans every game it played.
const DisplayNamePrefix = "Bot "

// DisplayName is the name the lobby seats this personality under.
func (p Personality) DisplayName() string { return DisplayNamePrefix + p.Name }

// NewPersonalityFor builds the bot for a seat's display name ("Bot Winston"),
// falling back to the house strategy for any name that is not a registered
// personality. This is the server's bot factory.
func NewPersonalityFor(display string) *Strong {
	if p, ok := PersonalityForDisplayName(display); ok {
		return p.New()
	}
	return NewStrong()
}

// PersonalityForDisplayName resolves a seat's display name back to the
// personality it was seated as. It returns false for a human's seat, a takeover
// bot using a human's name, or a retired personality.
func PersonalityForDisplayName(display string) (Personality, bool) {
	if len(display) <= len(DisplayNamePrefix) || display[:len(DisplayNamePrefix)] != DisplayNamePrefix {
		return Personality{}, false
	}
	return PersonalityByName(display[len(DisplayNamePrefix):])
}

// PersonalityByNameOrSkip is PersonalityByName with the lookup failure turned
// into a fatal, for tests that name a personality inline. Not in a _test.go
// file because sim/ uses it too.
func PersonalityByNameOrSkip(t interface{ Fatalf(string, ...any) }, name string) Personality {
	p, ok := PersonalityByName(name)
	if !ok {
		t.Fatalf("%s is not a registered personality", name)
	}
	return p
}
