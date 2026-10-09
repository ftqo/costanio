package explorers

// DecisionPirate is the only obligation this module ever owes a seat outside its
// own turn actions: the pirate activation a rolled 7 demands. It is a placement
// plus, when the hex has ships on it, a victim, so it is a one-tap pick with a
// list to read rather than a plan to make.
const DecisionPirate = "explorers_pirate"

// Decisions is every id this module can emit, for the cap drift test in
// timings/.
var Decisions = []string{DecisionPirate}
