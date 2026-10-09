# Base game rules spec

Original description of the base settlement game mechanics for implementation.

## Components & board

- Hex tiles: 4 forest (lumber), 4 pasture (wool), 4 field (grain), 3 hill
  (brick), 3 mountain (ore), 1 desert. 19 hexes for 3–4 players.
- Number chits 2–12 except 7 (one each of 2 and 12, two each of 3–6 and 8–11).
  The two 6 and two 8 chits ("red numbers") may not be placed adjacent to each
  other in the variable setup.
- Harbors around the coast: four 3:1 generic, and one 2:1 each for lumber,
  brick, wool, grain, ore.
- Per player: 5 settlements, 4 cities, 15 roads.
- Bank: 19 cards of each resource; development-card deck (below).

## Setup

1. Build the board (fixed beginner layout or shuffled variable layout with the
   no-adjacent-red-numbers rule).
2. Placement in snake order: each player, in turn order, places 1 settlement +
   1 adjacent road; then in reverse order each places a second settlement + road.
   (The Knights ruleset makes the second placement a **city**; see
   `knights.md`.)
3. A settlement must obey the **distance rule**: no settlement may be on a
   vertex adjacent (one edge away) to another settlement/city.
4. The **second** settlement immediately yields one resource for each adjacent
   resource hex. The first settlement grants no starting resources.
5. The desert starts with the robber; it produces nothing.

## Turn structure

On your turn, in order:
1. **Roll** the two dice (mandatory; you cannot build/trade before rolling).
2. **Production**: every player collects resources from hexes matching the roll
   on which they have a building: 1 card per adjacent settlement, 2 per city.
   The robber's hex produces nothing.
3. **Action phase**: trade (with the bank/harbors and with other players) and
   build/buy (roads, settlements, cities, development cards), plus playing one
   development card (see timing below).

There is one Action phase, not a trade step followed by a build step: within it
you may trade and build as often as you like and in any order.

### Rolling a 7

No production. Instead:
1. **Discard**: every player holding more than 7 resource cards (8 or more)
   discards half of them (rounded down), of their own choice. Development cards
   do not count toward the hand size.
2. **Move the robber** to any other land hex (it may sit on the desert). It must
   move; it cannot stay on its current hex.
3. **Steal**: take one random card from another player with a building adjacent
   to the robber's new hex (you cannot steal from yourself). If any such opponent
   has cards you must steal from one; if none have cards, no steal.

### Friendly robber (table option)

With the host's **friendly robber** switch on, a player still at the **starting
score** cannot be robbed: at or below `State.FriendlyRobberMaxVP`, which is the
ruleset's starting public VP (`State.StartingVP`: 2 for two settlements, 3 when
a module makes the second setup placement a city, as Knights, Wagons and Raiders
do). The robber may not be parked where it reaches only shielded players while an
unshielded one is reachable, and every other steal that asks the same question
(the pirate, a Knights chase or Bishop, the Fishermen three-fish spend) uses the
same shield. It reads public VP only, never hidden VP cards.

**Decision: starting VP + 0.** The option protects "players still at their
starting score" (`GameConfig.FriendlyRobber`), which is 2 only in the base game;
under Knights every seat leaves setup on 3. The threshold is served to clients
(`friendly_robber_max_vp` in the view) rather than re-derived there. Tested by
`ruletest.TestFriendlyRobberShieldsStartingScore`.

**Decision: no robber, no setting.** In a ruleset where a
module declares `Hooks.RobberNeverInPlay` (Wagons, Raiders, Explorers;
`engine.RulesetHasRobber`) the lobby hides the switch, `lobby.validateConfig`
clears it, and the engine ignores a stored true (`State.FriendlyRobberActive`).
That also takes the shield off the steals those rulesets still have (a Raiders 7,
a Wagons+Fishermen three-fish spend). Tested by
`ruletest.TestFriendlyRobberIsIgnoredWithoutARobber` and
`ruletest.TestEveryRulesetsRobberAnswer` (whose fixture the frontend's
`hasRobber` is held to).

## Production shortage (bank limit)

If the bank cannot pay every claimant of a given resource for a roll:
- if exactly one player would receive that resource, they take whatever the
  bank has left;
- if two or more players would receive it and the bank is short, none of them
  receive that resource (the others' resources are unaffected).

## Building costs & limits

| Build | Cost | Limit |
|---|---|---|
| Road | 1 lumber + 1 brick | 15 |
| Settlement | 1 lumber + 1 brick + 1 wool + 1 grain | 5 |
| City (upgrade a settlement) | 2 grain + 3 ore | 4 |
| Development card | 1 ore + 1 wool + 1 grain | deck size |

- A road must connect to your own road, settlement, or city, and may not cross
  an opponent's building (it can't continue through a vertex with an opponent
  settlement/city). Edges are single-occupancy.
- A settlement needs the distance rule satisfied **and** must touch your own
  road. A city upgrades one of your existing settlements (returns the
  settlement piece to your supply).

## Development cards

Deck (3-4 players): 14 knights, 5 victory point, 2 road building, 2 year of
plenty, 2 monopoly. The deck grows with the table, along two of those five
only: 5-6 players add 6 knights and 3 victory-point cards and no
progress cards, so 5-6 is 20/8/2/2/2, and 7-10 extrapolate the same step
(26/11 and 32/14).

- A card drawn this turn cannot be played the same turn (exception: you may keep
  and play it from a later turn). Victory-point cards are an exception in that
  they are never "played": they count secretly toward your total and are only
  revealed when they bring you to the winning score.
- You may play at most **one** development card per turn, at any point on your
  turn; **any** development card may be played before rolling. The only limits
  are one per turn and not on the turn it was bought.
- **Knight**: move the robber and steal (as on a 7, but without the discard
  step). Counts toward Largest Army.
- **Road building**: place 2 roads for free (respecting connectivity and the
  road limit).
- **Year of plenty**: take any 2 resources from the bank (bank must have them).
- **Monopoly**: name **one** resource; every other player gives you all cards of
  that resource they hold. You may not name two.
- **Victory point**: +1 VP, kept hidden.

**Two edge cases:**
- **Year of plenty against a short bank.** The supply is finite and you take
  what is there: a bank holding one of the two cards you named pays one.
- **Road building with nowhere legal to go.** You place what you legally can
  and the rest is wasted; the card is not refunded and the turn is not blocked.

## Special cards (2 VP each)

- **Largest Army**: the first player to play 3 knights takes it; it passes only
  to a player who has played strictly more knights.
- **Longest Road**: the first player with a continuous road of 5+ segments takes
  it; it passes only to a strictly longer road. A tie keeps the current holder.
  Only the single longest continuous branch counts; forks are not added
  together. An opponent's settlement/city built on a vertex of your road breaks
  the road there (your own buildings do not); if a break drops the holder out of
  the lead, the card goes to the sole new leader (5+) or is set aside if two or
  more tie.

## Trading

- Bank: 4 identical cards of one resource for any 1 other resource (4:1). Always
  available, even without a harbor.
- Harbor: 3:1 at a generic harbor, 2:1 at the matching specific harbor (that
  resource only), if you have a building on that harbor's vertex. You trade at
  your best applicable rate per resource: 2:1 if you hold that special harbor,
  else 3:1 with any generic harbor, else 4:1.
- Player trades: only on the active player's turn, only resources (not dev
  cards). Each side must put up at least one card. **The active player is one
  side of every trade**: two other players may not trade with each other on
  someone else's turn, and nobody but the active player may trade with the bank. You may not give cards away,
  and you may not trade matching resources: the same resource type can't appear
  on both sides of a trade (e.g. "2 wool for 1 wool"). This applies to maritime
  trade too: the resource received must differ from the one paid.
- Answering an offer (costan): a seat's accept / reject / counter is its *latest*
  word, not a one-shot vote. While the offer stands a seat may switch its answer,
  replace its counter with different terms, or withdraw the answer entirely
  (`respond_trade {retract:true}`), as often as it likes; only re-sending the
  answer already on record is refused (`ALREADY_RESPONDED`), so a stuck client
  cannot pump the log. The offerer settles against whatever is on record at the
  moment they execute: an acceptance withdrawn first is not there to execute
  against. This differs from the physical game, where saying "yes" out loud is
  not undoable, so that a mis-click does not cost a player the whole offer.
- An offer dies when its own stake does: if the offerer spends the cards they put
  up (a build, a dev card, a maritime trade), the offer is closed with a logged
  `trade_cancelled` rather than left on the table. Execution re-validates both
  hands regardless; this only stops the table being shown a deal that can no
  longer settle.
- Basket maritime trades (costan): several separate maritime trades may be made
  as one action, so a player with a 2:1 wood harbor and a 2:1 brick harbor may
  pay 2 wood + 2 brick for 2 wool at once. Each given resource is still priced at
  its own best rate and must be a whole multiple of it: a basket is exactly a
  set of ordinary maritime trades settled together, never a discount and never a
  way to hand over a partial payment. Because every sub-trade must still differ
  on its two sides, no resource may appear on both sides of the basket; buying
  and selling the same resource is two actions, not one.

## Victory

First to the target VP (10 in the standard game) **on their own turn** wins.
VP sources: settlement 1, city 2, Largest Army 2, Longest Road 2, each hidden
VP development card 1.

## Five to ten players

costan scales the components for 5-10 players (see "Engine conformance").
There is no special building phase between turns and no paired second seat
acting alongside each turn: every seat gets an ordinary turn in ordinary turn
order, and a big table only gets more pieces and a bigger board. The discard threshold, the
robber, the victory target and the one-development-card-per-turn cap are all
unchanged, and the development deck grows as described in
"Development cards".

## Ending a game nobody can win

Some positions are unwinnable for everyone (the Fishermen old boot is the
documented case: a sole leader holding it needs a VP they can no longer get).
There is **no automatic stalemate detector**: "turns with no VP change" has no
stable maximum across simulated games (p50 22, p99.9 82, and the max keeps
growing with the sample size), so no threshold is safe. Players end the game
themselves instead, in one of three ways, each a logged event
(`engine/concede.go`):

- **Surrender** (`surrender`): legal only at exactly 2 seats, only in the play
  phase, only after `engine.SurrenderMinTurns` (6) completed turns, on or off
  turn. The game finishes immediately with the opponent as winner. The floor is
  well below `DrawMinTurns`: conceding a decided duel early is legitimate, while
  conceding before anyone has moved is an abort and belongs on the host's
  reset-to-lobby path. The floor also stops farming, since a finished game is a
  credited game (match payouts, daily streak).
  It records **no forfeit**: conceding a decided duel is normal play, and
  penalising it would teach players to sit out the clock instead. At 3+ seats
  leaving still hands the seat to a bot, so the other players keep their game.
- **Draw** (`offer_draw` / `respond_draw`): after `engine.DrawMinTurns` (200)
  completed turns, any seat may offer; the game is drawn (winner
  `engine.NoPlayer`) when every other seat has accepted. One decline ends the
  offer, and so does the end of the turn. **One offer per player per turn**
  (`State.DrawOffersUsed`, cleared at `EvTurnEnded`): a decline clears the offer,
  so without the cap offer/decline is an unbounded event loop. An offer is also
  refused while any seat owes a forced decision (discards, robber, a module
  block; `ErrModulePending`), and it can be withdrawn by its owner
  (`cancel_draw`), which is what the actor's expiry timer issues on their behalf
  so an offer cannot stand forever on a table with no turn timer. Bot and auto
  seats accept on the actor's behalf (`game.Actor.runDrawResponses`), one
  acceptance per pass at the bot pacing delay, so in practice only the other
  human seats have to agree. There is no unilateral draw claim: a fair one would
  need the objective non-progress condition that, as above, does not exist.
- **Claim against bots** (`claim_game`): after the same threshold, a player
  whose every other seat is bot-controlled ends the game without consent (a bot
  cannot meaningfully agree). They win only if strictly ahead on
  `VPWithModules`: true victory points, hidden VP cards included, because
  dev-card purchases are public log events and a public-only comparison would let
  a player who knew an opponent held unplayed cards claim and win from behind. A
  tie resolves as a draw. Without the ahead test it would be a win farm: stall to
  the threshold, claim, repeat. The engine enforces the
  threshold and the ahead test; the game layer enforces the all-bots
  precondition (`game.ErrClaimNeedsBots`), because the engine never learns seat
  status.

`State.TurnsCompleted` (folded on `EvTurnEnded`) is the threshold's counter, so
it replays exactly. A drawn game stores `games.winner_user_id` NULL and counts
as a **draw** in stats (`stats.draws`, disjoint from wins). A ranked draw is
rated as a **tie**: the drawn seats go into the openskill update at equal rank,
since skipping the update would make a draw strictly better than a loss for
everyone not leading. Ranked forfeit strikes apply however the game ended, and
the play faucets pay nothing for a game shorter than `matchMinRounds` rounds.

## Engine conformance

- 3–4 players use the exact counts above; costan additionally scales components
  for 5–10 players (house rule); base counts must hold at 3–4.

- All costs, limits, the distance rule, road connectivity, the bank-shortage
  rule, dev-card timing, and the title rules above must match.
- Determinism: dice, shuffles, and steals derive from the committed seed.
