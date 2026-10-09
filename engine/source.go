package engine

// Source is an event's provenance: whether a seated human decided it or the
// server decided it in their place. (Whose seat it concerns is in Event.Data.)
//
// It lives on Event because Event is the log record that store/ writes, the
// replay API serves and the websocket streams. The engine never sets it (Decide
// leaves it zero) and Apply never reads it, so replay(eventLog) == live state
// holds regardless of provenance. See TestApplyIgnoresSource.
//
// The game layer stamps it, since only it knows seat status, and that knowledge
// stays out of the engine (see game.ErrClaimNeedsBots).
type Source uint8

const (
	// SourceUnrecorded is the zero value and means the event was logged before
	// provenance existed; every new event carries a real source (see
	// TestCommittedEventsCarrySource). Treat it as unknown, not as human.
	SourceUnrecorded Source = 0

	// SourceHuman is a command a seated player sent over the wire and the engine
	// accepted. It is the only source that represents a human decision.
	SourceHuman Source = 1

	// SourceTimeout is the server playing the minimal legal move for a seat whose
	// decision clock ran out (engine.AutoCommand via the turn timer). The player is
	// still seated. It is a server default, not a preference: a discard here is
	// spreadDiscard's round-robin.
	SourceTimeout Source = 2

	// SourceAuto is the server playing the minimal legal move because nobody chose
	// one: an auto-pass seat with no one in it (disconnected, kicked, or left to
	// spectate before a bot took over), or a bot seat whose bot declined to act or
	// produced a refused move. Same moves as SourceTimeout, but it records that the
	// seat was unattended rather than slow.
	SourceAuto Source = 3

	// SourceBot is a bot that has held the seat since the game began. Its moves are
	// real decisions, unlike SourceAuto's minimal-legal filler.
	SourceBot Source = 4

	// SourceBotTakeover is a bot playing a seat a human started in: the player
	// disconnected for a full round or left to spectate. Kept apart from SourceBot
	// because the seat's earlier events are human decisions and its later ones are
	// not.
	SourceBotTakeover Source = 5

	// SourceServer is housekeeping attributable to no seat: an unanswered trade or
	// draw offer expiring, the event-cap force-finish. No seat was owed a decision.
	SourceServer Source = 6
)

// String renders a source for logs and the replay API's JSON. The strings are
// wire vocabulary, so renaming one is a protocol change.
func (s Source) String() string {
	switch s {
	case SourceHuman:
		return "human"
	case SourceTimeout:
		return "timeout"
	case SourceAuto:
		return "auto"
	case SourceBot:
		return "bot"
	case SourceBotTakeover:
		return "bot_takeover"
	case SourceServer:
		return "server"
	default:
		return "unrecorded"
	}
}

// Human reports whether a seated player made this decision. It is the predicate
// a training-data extractor needs, kept in one place so a new source declares its
// side once. An unrecorded source is not human: samples of unknown provenance
// should be dropped.
func (s Source) Human() bool { return s == SourceHuman }

// ServerActed reports whether the server produced this event in a seat's place.
// The complement of Human over recorded sources; false for SourceUnrecorded,
// which asserts nothing either way.
func (s Source) ServerActed() bool {
	switch s {
	case SourceTimeout, SourceAuto, SourceBot, SourceBotTakeover, SourceServer:
		return true
	default:
		return false
	}
}

// StampSource marks every event in a batch with its provenance. A batch comes from
// one command and has one cause, so every event gets the same stamp and readers
// need not regroup the log into commands.
//
// Called by the game layer between Decide and the store write; the engine does
// not know seat status.
func StampSource(events []Event, src Source) {
	for i := range events {
		events[i].Src = src
	}
}
