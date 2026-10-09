# Bots

Bots are seat-takeover AIs in the `bot` package. A bot is a
`game.CommandSource` (`Act(state, seat) (Command, bool)`) plugged into the
game actor exactly where auto-pass would act (see [game-actor.md](game-actor.md)).
If a bot returns a command the engine rejects, the actor falls back to the
minimal legal move, so a buggy bot never stalls a game.

## bot.Simple

A greedy baseline: resolve obligations via the engine's auto logic, then on
its own turn buy in fixed priority (city → settlement → road → dev card →
4:1 trade) before ending the turn. Used as the always-legal fallback and as
the benchmark opponent.

**Its trade planner asks about placement, not affordability.**
`simpleBankDig` lists what the seat still wants by asking "is this build
usable?" for a city, a settlement, a road and a dev card. Those questions gate
the trade that would make the build affordable, so a cost check inside any of
them is circular: the seat cannot afford it, so it is not wanted, so nothing is
traded for, and the turn ends forever. `upgradableSettlement` (ownership) and
`settleableSpot` (`engine.CheckSettlementSpot`) are placement-only.
`extendingRoad` confirms candidates through `engine.Decide`, which rejects an
unaffordable road, so `extendingRoadSpot(s, seat, true)` asks the cost-blind
form by granting the clone one road's worth of resources first, the same trick
`Strong.evalAfterPaidBuild` uses.

The other two livelock guards are `simpleDefend` (under Knights, recruit or
activate a knight before buying, or every city is razed at landfall and rebuilt
forever) and `simpleBankDig` trading only toward a usable build. All three are
commented in `bot/simple.go`.

**Measure termination at the default victory target.**
`sim.TestSimpleTwoPlayerGamesTerminate` plays at `TargetVP: 8` for speed, where
the road livelock is nearly invisible (two-player base: 0/200 stuck at 8, 23/200
at 10). `sim.TestSimpleRoadStarvedGamesTerminate` pins the default target on
seeds that hit the cap before the fix.

**Simple is never seated in production.** `cmd/costan` seats Strong
personalities for every bot and takeover seat; `Simple` is reachable only through
`cmd/costan-sim`, `sim/`, and Strong's own internal fallback. A Simple-only
livelock is a harness defect, not a player-facing one.

## bot.Strong

Heuristic bot. Instead of fixed priorities it **scores candidate moves by
simulating each through the engine and evaluating the resulting position**,
then takes the best. No game-tree search beyond a one-ply lookahead.

- **Evaluation function** (`eval.go`): a weighted sum of expected production
  (pip-weighted, `pips(n) = 6 − |7 − n|`), resource diversity, victory points
  (convex, so the last points are urgent), hand utility (with a discard-risk
  penalty), expansion room, road reachability, robber denial, ports, and
  proximity to longest road / largest army. Resource weights shift from
  brick/wood (early expansion) to ore/wheat (late-game points) by game phase.
- **No development-card holding bonus.** `Weights.Dev` is 0. A flat bonus per
  dev card double-counts (a hidden VP card is already scored as VP minus
  PublicVP; a knight is already scored by `armyProximity`) and encourages buying
  dev cards instead of building. A weight sweep is monotone toward zero, and
  dropping the term is worth **+10 points** head to head
  (`sim.TestDevWeightZeroBeatsHolding`: 55.0% vs 45.0% over 600 games on unseen
  seeds). The field is kept because dev cards are mis-valued rather than
  worthless.
- **`reach` and `opp` are tuned.** 2x and 16x their original values, worth
  **+9.4 points** head to head against the hand-set pair
  (`sim.TestTunedWeightsBeatHandSet`). The comment on `Weights.Reach`/`Opp` in
  `bot/eval.go` records the same retune as 53.7% [52.8, 54.6] over 12000
  held-out games; the two are separate runs and have not been reconciled.
  `opp`'s response is a plateau from x8 to x32 rather than a peak; x16 is what
  was validated. Every other weight measured at or near its optimum.
- **Longest Road is counted but never chased.** `selfScore` counts the title's
  2 VP for every player, but the bot does not build toward it. Counting without
  chasing beats doing neither at 55.6% [54.1, 57.2] over 4000 games; chasing
  loses at 48.1% [46.6, 49.6]. `bot.WithLongestRoad()` re-enables chasing so the
  result can be rechecked; `sim.TestStrongDoesNotChaseLongestRoad` guards the
  road budget.
- **Fishermen: the bot spends its fish** (`bot/fishermen.go`). Fish convert to a
  robber banish (2), a steal (3), any bank resource (4), a free road (5) or a
  free dev card (7). Spending them is worth **+17 points** (58.6% [55.8, 61.3]
  against a hoarding bot, `sim.TestFishSpendingBeatsHoarding`).

  It also **passes the old boot** (`passBoot`), which costs its holder a victory
  point until passed. Worth **+6.8** (53.4% [51.4, 55.4],
  `sim.TestPassingBootBeatsKeepingIt`). It is a rule rather than a scored
  candidate because the handicap lives in the module's `WinThresholdDelta`,
  which the evaluator does not read. The passer's average VP is slightly lower
  while it wins more; raw VP is not comparable between a holder and a
  non-holder.

  Steal and the free dev card resolve a random draw inside `Decide`, so they
  are scored by **expectation** rather than simulation (which would condition on
  the exact card, the peek `expectedDevBuyValue` avoids). They add **+7.6** on
  top of the deterministic spends (53.8% [51.8, 55.7],
  `sim.TestFishChanceSpendsAddValue`). The steal's distribution is
  `publicHandEstimate`, so it sees neither the card drawn nor the hand drawn
  from.

  The five-fish spend grants a road credit (`State.FreeRoads`), which the
  evaluator prices (see "Free roads" below). Three 4-player `base+fishermen`
  games spend 4 free roads against 9 steals, 6 banishes and 2 take-resources.
- **Rivers: bridges and both coin conversions are scored candidates**
  (`bot/rivers.go`). A bridge is priced like any other build, by simulating it:
  its 3 coins move the wealth tiles and `PublicVPWithModules` reads every
  module's `VictoryCheck`. The coin conversions are offered per resource and the
  evaluator picks.

  Coins themselves get a hold term: linear, capped at four coins, at **half a
  resource card** (the exchange rate: two coins buy one card). Linear rather than
  the fish pile's quadratic, since coins spend two at a time at a flat rate with
  no higher rung.

  The weight is not tuned by self-play: identical bots tie on coins, and a tie
  awards no Wealthiest Settler, so a clone ladder would measure the tiles at
  zero.

  Simple has a minimal deterministic Rivers policy so that `sim`'s adversarial
  ledger, which audits card and coin bookkeeping over whole games, sees all
  three Rivers commands. Each moves base resources (a coin bought returns 2 to 4
  cards to the bank, a coin spent takes one out, a bridge pays brick and
  lumber).
- **The robber chase at landfall is ungated.** Chasing deactivates the knight,
  and the bot does it on the turn before the barbarians arrive 13 times out of
  44. `bot/knights.go` offers every chase as a scored candidate with no imminence
  gate; `barbarianImminence` (`bot/knights_eval.go`) only scales the knight-strength
  term. Gating the chase measured 50.3% (see "Knights evaluator: exhausted").
- **The knight backstop masks every knight weight.** `Strong` falls through to
  the baseline bot, whose `simpleDefendGated` activates and recruits on a hard
  rule whenever `bestPlay` returns nothing. Zeroing `cak_knight` changes a
  quarter of all decisions and moves no games. Any Knights weight study must pass
  `bot.WithoutSimpleDefend()` to every seat. `sim.TestSimpleDefendMasksTheKnightWeights`
  checks that removing the backstop changes the bot and that the shipped bot is
  not measurably weaker than the study arm.
- **A pending metropolis is credited** (`knightsEval`). `metropolisEvents` emits
  `EvMetropolisPending` rather than `EvMetropolis` whenever the earner has two or
  more metropolis-free cities (55% of grants), and `Apply` leaves
  `Metropolis[track]` false until a city is chosen, so the victory hook alone
  would score it as nothing. Worth **+5.6** (52.8% [50.7, 54.7]).
- **The Aqueduct's free resource is chosen** (`knightsAqueductPick`). The engine's
  auto-pass takes whatever the bank holds most of, which is close to the inverse
  of what a city-building bot wants (about 25 free cards a game). Worth **+6.8**
  (53.4% [51.4, 55.4]).
- **Knights progress cards played by rule where scoring cannot see them**
  (`knightsFreeProgressPlay`). Wedding and Road Building resolve through a pending,
  so as scored candidates they were never chosen. Played by rule they lift
  utilisation from 32% to 39% and are worth **+9.2** (54.6% [52.6, 56.6],
  `sim.TestFreeProgressPlaysWin`). Alchemist, Bishop, Deserter, Diplomat,
  Inventor and the rest have generators (`bot/knights_progress.go`,
  `bot/knights_progress2.go`); Constitution and Printer need none, since both
  resolve on draw.
- **Islands: the bot sails** (`bot/islands.go`). Ship builds are candidates like
  any other build, the reachability walk crosses sea edges, and a coastal spot
  reached by ship counts as settleable.

  Gated on the board having more than one island: procedural generation produces
  a single landmass, where sailing measures about **-3 points**. On gallery
  archipelagos it is worth **+3.4** on Shores (51.7% [50.4, 52.9]) and **+4.2**
  on archipelago (52.1% [50.9, 53.4]), lifting island chips from 0.64 to 1.01 per
  game. Measuring this needs `sim.Options.Board`; at 1200 games two runs
  disagreed on the sign, and 6000 settled it.

  **`islandPull` (`Weights.IslandPull`) sends the bot to the coast.**
  `reachableProduction` decays a spot five builds out to 0.07 of its pips and
  cannot see the island chip, and a ship leaves only from a coastal building, so
  on a home island with room inland the bot never sailed. Over every gallery
  Islands map at 2, 3 and 4 players (60 games a cell, house bot, start rule
  `auto`), ships a game and the share of games with any chip:

  | map | 2p before / after | 3p before / after | 4p before / after |
  | --- | --- | --- | --- |
  | Shores (Small) | 2.9, 12% / 4.8, 73% | 6.3, 50% / 8.9, 77% | 11.1, 73% / 10.8, 92% |
  | Shores (Medium) | 0.4, 2% / 3.5, 50% | 1.2, 8% / 6.3, 82% | 2.1, 12% / 8.4, 93% |
  | Shores (Large) | 0.0, 0% / 2.4, 30% | 0.1, 0% / 4.3, 67% | 0.6, 7% / 6.1, 82% |
  | Archipelago | 5.6, 42% / 6.1, 82% | 8.3, 52% / 10.1, 93% | 13.2, 77% / 14.3, 93% |
  | Japan | 0.3, 0% / 2.7, 28% | 1.1, 3% / 6.0, 42% | 2.5, 3% / 7.1, 58% |
  | UK & Ireland | 0.0, 0% / 0.8, 7% | 0.1, 0% / 2.7, 12% | 0.9, 0% / 3.3, 23% |

  `start_island: any` reads the same within noise: the Shores maps already open
  on the main island (720 of 720 setup settlements), and Archipelago has none.
  Japan and UK & Ireland are the maps the rule moves (about a fifth of opening
  settlements were off the main island). `bot.Simple` builds no ship on any map.

  The term prices the next chip along the plan a ship needs: a 0-1-2 shortest
  path over (vertex, afloat) states, roads to an open coastal spot, a settlement
  there (two steps), then ships to a legal spot on an island the seat has not
  reached. The chip's points fall off linearly over an 8-build horizon, so every
  build toward the island is worth the same step (a geometric decay made the
  first ship of a crossing worth almost nothing). Earned chips are banked at
  (w-1) chips each, because above 1 the pull on a spot one landing away exceeds
  the chip and the bot would refuse to land on its last island
  (`bot.TestBotLandsOnTheLastIsland`).

  The base road gate scores roads only while no settlement spot is open, so
  `islandRoadCandidates` offers the roads that shorten the plan. They are held
  back while a spot is open unless the hand pays for both (offering them anyway
  measured **41.5%** on Shores (Large): the road spends the settlement's wood
  and brick). The weight is a plateau from 5 to 12 (0.6 bought nothing). Against
  the same bot at `IslandPull = 0`, 1200 games each:

  | ruleset / map | players | 5 | 8 (default) | 12 |
  | --- | --- | --- | --- | --- |
  | Shores (Small) | 4 | 56.2% | 55.1% [52.3, 57.9] | 56.8% |
  | Shores (Large) | 4 | 55.2% | 61.8% [59.0, 64.5] | 63.4% |
  | Shores (Small) | 3 | | 41.2% [38.5, 44.1] (fair 33.3) | |
  | Shores (Large) | 3 | | 43.6% [40.8, 46.4] (fair 33.3) | |
  | Shores (Small) | 2 | | 52.2% [49.4, 55.1] | |
  | Shores (Large) | 2 | | 51.0% [48.2, 53.8] | |
  | Archipelago | 4 | 55.5% | 56.9% [54.1, 59.7] | |
  | Shores (Medium) | 4 | 60.1% | 61.1% [58.3, 63.8] | |
  | Japan | 4 | | 57.2% [54.4, 60.0] | |
  | UK & Ireland | 4 | | 54.6% [51.8, 57.4] | |
  | procedural base+islands | 4 | | 53.5% [50.7, 56.3] | |
  | procedural base+islands | 3 | | 36.9% [34.2, 39.7] (fair 33.3) | |
  | procedural base+cak+islands | 4 | | 52.9% [50.1, 55.7] | |

  One Strong seat against three Simple on Shores (Small) and on procedural
  base+islands wins 96.5% and 98.5% with the term, 97.0% and 99.0% without (200
  games each): saturated. Rulesets without Islands are untouched, since both
  halves are gated on `islandsActive`. `sim.TestShoresSmallBotsSail` pins the chip
  rate cheaply: 8 seeded games at 3 and 4 players, a chip in 8 of 8 at both,
  against 4 and 5 with the term off.
- **Robber denial** (`robberDenial`): production is docked by whatever the
  robber is blocking, so blocking an opponent's 6 scores more than blocking
  their 2 and `moveRobber` (which ranks hexes by eval delta) chooses on denial,
  not just the steal. Weighted below `prod`, because the robber is temporary.
- **Road reachability** (`reachableProduction`): production at settlement spots
  one or two new roads away, decayed by distance. It captures where the network
  is pointed, which no other term does. Scored for the acting player only: an
  opponent's network does not change across our candidate moves, and running the
  BFS for all seats cost 4x.
- **Weights are data, not code.** `bot.Weights` is exported and JSON-tagged, and
  `bot.WithWeights` overrides it per bot. A version of Strong is this binary plus
  a weight vector, so two versions can play each other in one process. New eval
  features must be **additive, with a zero weight reproducing the previous
  behavior exactly**; `bot.BaselineWeights` relies on that to reconstruct the
  pre-reachability evaluator.
- **Within-turn lookahead** (`deepen`, `bot.WithLookahead`): the ten strongest
  candidates are re-scored by the best position reachable one action later in the
  same turn, and the first move of the best two-move line is played. Worth
  **+3.3 points** (53.3% [51.5, 55.1] over 3000 games) for **+19%** decision cost
  (79.2us -> 94.5us per game).

  Scoring a move by the position immediately after it makes a road that opens a
  settlement, or a trade that completes a city, read as pure cost; the boot,
  Wedding, Road Building and the pending metropolis are all the same one-step
  blindness. Width saturates at ten (6, 10, 16 and 24 all measure 53.1-53.3) and
  depth 2 adds nothing over depth 1.
- **Decision loop**: each turn, generate legal candidates (city upgrades,
  frontier settlements/roads, dev card, knight), score each by cloning the
  state and evaluating, and take the best positive-delta action. The actor
  re-invokes `Act` after each move, so multi-step turns chain naturally.
- **Sub-policies** for the high-leverage decisions: initial placement
  (a network cloned from human play; see below), the robber (hit the leader,
  never your own production, steal from whoever is closest to winning),
  discarding (shed surplus), and bank/port trading toward the best unaffordable
  build.
- **Bank-trade dig** (`tradeTowardBuild`): when no other trade target exists,
  the bot trades toward a road to reopen a frontier. Otherwise a seat with every
  settlement upgraded and no open spot ends its turn forever (0.7% of 2-player
  self-play games, `sim.TestTwoPlayerGamesTerminate`). Gated on the target list
  being otherwise empty, so it only fires where the bot would do nothing.
- **Player-to-player trading is on** (`bot/offer.go`, `bot/respond.go`). The bot
  offers when it is one card from the build it wants, answers offers by what
  they would let it build rather than by comparing card weights, settles against
  an acceptance or a counter, and refuses any partner one build from winning.
  `bot.WithoutPlayerTrades()` turns it off.

  **Trading is worth about 5 points.** Against `diversePool`, the shipped bot is
  28.7% and the same bot with `WithoutPlayerTrades` is 23.6%, below the 25% fair
  share. Self-play cannot price trading: four copies of one evaluator want the
  same cards at the same time (against clones it measures 48.7% [46.7, 50.7]).

  **A cloned acceptance policy is neutral on base and mildly positive on
  Knights.** The network reaches AUC 0.780 on held-out human games against 0.634
  for "accept if it completes a build". Against `diversePool` at 4000 games an
  arm: base 28.0% (evaluator) / 28.0% (threshold 0.15) / 28.4% (0.35), and
  Knights 26.2% / 27.7% / 27.7%. Underpowered, so it stays off behind
  `WithLearnedAccept`. Compare arms only within one run: every arm of a ladder
  must see the same seeds.

  Re-measured at production pacing, trading on vs off is 27.8% / 29.5% (base /
  Knights) against 28.2% / 26.8%, at 2000 games an arm: base neutral, Knights
  +2.7 with intervals that barely separate. Unresolved; at that power, results
  in this project have flipped sign five times. Do not read a one-SE difference
  as a signal.

  **`BotDelay: 0` and trade responses.** Inside the actor's tick handler
  `runAutoSeats` plays a batch of up to 64 actions. With no pacing the offerer
  could play its whole batch and replace its own offer (`State.ActiveOffer` is a
  single slot) before any seat answered. `game/actor.go` runs
  `runOfferResponses` first when `botDelay == 0`. The server defaults to 1500ms
  (`COSTAN_BOT_DELAY`); setting `BotDelay` on `Options`/`LadderOptions` is the
  closer match to production for anything measuring responses. Measured over 30
  games without that ordering:

      BotDelay 0     6.83 offers/game   0.07 responded   0.03 countered   0.03 executed
      BotDelay 2ms   6.37 offers/game   0.63 responded   0.40 countered   0.33 executed

  Identical avgVP across arms (7.34 in all three) means identical games: the arm
  changed nothing.

  A feature can measure zero against clones while hiding a cost as well as a
  benefit: an offer nobody accepts is free.

  **Trading cannot be measured on the headless fast path.** Offer responses are
  driven by the actor's `runOfferResponses`, not by `engine.PendingDeciders`, so
  a headless runner that folds commands straight through the engine shows offers
  made and none ever answered. Use `sim.RunGame`.

### Four fixed defects, not yet priced

None of these has been through a ladder, and `diversePool` cannot decide them:
it is three `NewStrong` variants differing only in weights, so a structural
blind spot is shared by the candidate and all three opponents and cancels. Where
a fix is behind an option or a weight, the A/B is named.

- **Four progress cards were played unconditionally**
  (`bot/knights_progress2.go`). `ruleScore = 1e-6` was meant to sit just above the
  do-nothing baseline, but `bestPlay` seeds `bestScore` with `b.eval` of the
  current position, which runs several hundred negative for most of the game.
  So `1e-6` always won for every card `knightsProgressCandidates2` proposed through
  it (Spy 9/9, Merchant Fleet 9/9, Commercial Harbor 7/7 drawn then played over
  three `base+cak` games, against 0-of-2 to 5-of-6 for scored cards).
  `withFollowUp` (`bot/respond.go`) and `deepen` (`bot/strong.go`) also took
  `bestPlay`'s answer as the best follow-up, so trade acceptance and lookahead
  went blind with one of these in hand. Fixed by proposing
  `baseline + ruleScore` (`ruleFloor`);
  `bot.TestRuleProgressCardsScoreFromBaseline` and
  `TestRuleProgressCardYieldsToARealMove` pin it. No ablation option exists.

- **Free roads were invisible, so Road Building was never played**
  (`Weights.FreeRoad`, `freeRoadCredit` in `bot/eval.go`). Playing the card moves
  no piece and `Weights.Dev` is 0, so its eval delta was exactly zero and
  `strong.go`'s strict `sc > bestScore+1e-9` dropped it (0 plays in six base
  games, against 51 knights, 9 year-of-plenty and 7 monopoly). The same cause hit
  the Fishermen five-fish road and Knights `CardRoadBuilding`, whose roads were
  often carried into `EndTurn` because the anti-sprawl road gate closes when an
  open spot is reachable; the gate now also opens on a pending credit. A credit is
  priced at the cards it saves, as a floor: the road is scored by expansion and
  reach once placed, so a higher price would make spending the credit read as a
  loss. After: 6 plays in the same six games, both roads spent every time.

  A/B without new code: `COSTAN_LADDERS=1 go test ./sim -run 'AgainstPool' -count=1`
  with a contender built from `bot.WithWeights(w)` where `w.FreeRoad = 0`, on
  `base` and `base+cak`. The scale (1.0x the cards saved) is untuned and the same
  run should sweep it.

- **The robber peeked at hidden hands** (`expectedStealScore` in
  `bot/robber.go`). `engine.decideMoveRobber` resolves the steal inside `Decide`,
  from `RandomCard(rngFor(s.Seed, s.NextSeq+1), s.Players[victim].Hand)`, so
  simulating a candidate hex revealed the victim's hand and the drawn card.
  `bot/knights.go`'s `CmdChaseRobber` did too (Bishop and `expectedStealValue`
  already avoided this). Now scored by expectation over
  `publicHandEstimate`, with everything else the command does still simulated.
  `bot.TestRobberDoesNotPeekAtHiddenHands` and
  `TestKnightsChaseDoesNotPeekAtHiddenHands` hold the score invariant to hand
  contents at fixed card count.

  `WithHiddenInfo` restores the peek at both sites:
  `COSTAN_LADDERS=1 go test ./sim -run 'TestInformationRulesCost' -count=1`. The
  existing figure (54.0% against 46.0% over 1200 games) predates this fix and
  understates the constraint.

- **`alchemistPlay` used `Weights.Opp` as a per-building multiplier**
  (`bot/knights_progress2.go`), comparing our buildings on a dice total against
  `9.6 *` every opponent's. It played 0 of 2 drawn. `Weights.Opp` is a ranking
  discount tuned over our own candidate moves, where the opponent term is
  near-constant; it does not apply when both sides sit on the shared board. The
  same error was fixed for the camel bid, so `camelBidOpp` is now
  `oppNeutralWeight` (`bot/eval.go`). After: 6 of 6 drawn and played across three
  `base+cak` games. No other `b.w.Opp` read has the problem. No ablation option
  exists short of `bot.WithoutProgressBatch3`, which disables the whole batch.

Two smaller ones:

- **`expansionPotential` now sees ships.** It seeded only from `s.Roads`, while
  `reachableProduction` seeds distance 0 from buildings, roads and ships and then
  skips `d = 0` (`reachDecay[0]` is zero because `expansionPotential` owns that
  distance), so a spot at the end of your own ship was priced by neither.
  `Expansion` is the largest weight by ablation (-39.9). Price it on an
  archipelago: `COSTAN_LADDERS=1 go test ./sim -run 'TestExpansionAgainstPool' -count=1`
  with `Options.Board` set to a multi-island map, against `bot.WithLandOnly`.

- **`knightsImproveValue` is now `Weights.KnightsImprove`.** Up to 27 eval points (9.0 on
  each of three tracks) were added outside the weight vector, so no sweep could
  touch the largest Knights term. 1.0 reproduces the old behavior, and
  `BaselineWeights` carries 1.0 too, since the term is not new.
  `COSTAN_LADDERS=1 go test ./sim -run 'AgainstPool' -count=1` with `KnightsImprove`
  swept on `base+cak` is its first measurement.

**Strength:** in self-play (`sim.TestStrongBeatsSimple`, 24 games with Strong's
seat rotated to cancel first-mover advantage) Strong beats three Simple
baselines decisively. The test is saturated (Strong wins 24/24), so it catches a
serious regression but cannot measure an improvement. Use the ladder for that.

## What the evaluator runs on

Ablating each weight (zero it, play 2000 games against the intact vector)
shows **the evaluator is positional, not economic.**

| term | effect of removing | |
| ---- | ------------------ | - |
| `expansion` | **-39.9** | the whole bot, essentially |
| `reach` | -8.9 | |
| `opp` | -6.4 | and it wants ~16x its original weight |
| `hand`, `blocked` | -2.3, -2.2 | marginal |
| `prod`, `diversity`, `port`, `army`, `threat`, `vp`, `vp_rush` | ~0 | inert across a **16x** range |

Two results back up the inert column:

- **Resource pricing does nothing.** Flat pricing (every resource worth 1.0,
  dropping the `earlyResW`/`lateResW` schedule) measures 49.8% against the tuned
  schedule's 50.2% over 4000 games (`sim.TestResourcePricingMatters`, via
  `bot.WithFlatResourceWeights()`). Do not spend compute tuning those ten
  constants. (Flattening them at placement is a different question; see below.)
- **Victory points are inert too.** `expansion` and `reach` are pip-weighted, so
  they already price production and points positionally, and `winningMove`
  short-circuits the evaluator whenever a win is available.

**Coefficients are exhausted; structure is not.** The entire 13-weight space is
worth about +3.7 points end to end. Single structural decisions have been worth
+5.6 (seeing Longest Road), +10 (the dev-card double-count) and +22.6 (robber
denial plus reachability). Look for what the evaluator cannot see before
changing what it weighs.

Measured and rejected:

- **Chasing Longest Road**: 48.1% [46.6, 49.6].
- **Eval-scored opening placement** (replacing `setupVertexScore` with the full
  evaluator): 49.2% [47.7, 50.7].
- **A better Largest Army term** (counting held knights and the real threshold
  rather than played knights against a fixed ladder): +6 points on one seed,
  **50.6% [49.0, 52.1] on another**, so noise. The bot buys 20.7 dev cards and
  plays 11 knights a game and holds the title 1.22 times a game; the better term
  does not change outcomes.

## Information rules

**The bot may be superhuman at memory and processing. It may not have extra
information.** Bots run server-side on authoritative state, so nothing stops them
reading every hand and the whole deck; that they must not is a rule.

The line is between inference from public history and reading hidden state:

| the bot may use | because |
| --------------- | ------- |
| Hand **sizes**, cards played, buildings, board, dice history | all visible at the table |
| Dev deck **composition** (`DevDeck` counts) | derivable by counting what has been revealed (card counting) |
| Its own hand, dev cards, commodities | its own |
| `publicHandEstimate` | card count (public) spread by production (public), which is what a strong human tracks |

| the bot may not use | where this was violated |
| ------------------- | ----------------------- |
| Opponents' hand **contents** | `handValue` scored opponents off their exact hands; `monopolyResource` picked off exact holdings |
| Opponents' held commodities | `knightsEval` scored them; a Knights progress card targeted off them |
| Dev deck **order** | simulating a purchase resolves the draw, so `score()` saw the exact next card |
| The card a robber steal is about to yield | `Decide` resolves the steal, so `moveRobber` and `CmdChaseRobber` scored a hex through the victim's real hand and the actual draw |

`engine.decideBuyDevCard` draws deterministically from the seed and log
position, so any code that scores a dev-card purchase by simulating it is
conditioning on the card that comes up (victory-point cards were 21.6% [20.7,
22.5] of the bot's purchases against a 20% deck share). `expectedDevBuyValue`
scores by expectation over the deck instead, and `sim.TestNoDeckPeek` guards it.

**Cost: about 10 points of win rate.** Restoring the hidden reads wins 54.0%
against 46.0% over 1200 games (`sim.TestInformationRulesCost`, via
`bot.WithHiddenInfo()`), and closing the deck peek cost a further 2.2. The knob
keeps the price measurable.

**Effects that resolve through a pending are invisible to the evaluator.** The
bot scores a candidate by simulating it, so anything whose effect lands later (a
pending, a credit, a threshold change) scores zero and is never chosen. Passing
the boot (penalty in `WinThresholdDelta`), Wedding (an owed-cards pending) and
Road Building (a road credit) all had to be written as rules. When a plainly good
action is never taken, check whether its effect is observable at decision time.

**A rule-played action must check its own legality.** `score()` runs `Decide` and
drops anything illegal; anything played by rule skips that, and the bot's cheap
preconditions never cover everything `Decide` checks (a module pending is the
usual gap). A refused move is absorbed silently by the actor's fallback.

**Measure what a policy is worth before tuning a weight.** Replacing each
hand-written sub-policy with a poor version (`bot.WithNaivePolicy`,
`sim.TestPolicyAblation`) prices it:

| policy | replaced with | worth |
| ------ | ------------- | ----- |
| opening placement | first legal spot | **+42.8** |
| bank trade toward a build | never trade | +12.2 |
| robber placement | first legal hex | +10.2 |
| opening road | first legal edge | **-1.5** |

Placement alone is worth more than every other policy combined, and ten times
the whole weight vector. The opening road is slightly negative: it scored edges
by the pips of the vertex the road runs into, which the distance rule makes
unbuildable. Fixing that measured 51.8% [50.0, 53.6] at 3000 games and **49.9%
[48.6, 51.3] at 5000 on a fresh seed**: neutral, because the opening road barely
matters.

**Knights evaluator: exhausted.** Every hypothesis from a dedicated audit
measured neutral: defender pricing at x1/x5/x15 (48.8, 48.1, 49.8, with the
knight backstop removed from both sides), the robber chase gated at landfall
(50.3%), sufficiency-capped knight strength (48.4%), and Largest Army priced as
real victory points at seven scales against both clones and a mixed pool. Any
Knights weight study must pass `bot.WithoutSimpleDefend()`
(`sim.TestSimpleDefendMasksTheKnightWeights`).

**Builds respect module pendings.** While a module pending is outstanding
(metropolis pick, deserter replacement, barbarian sacrifice) `LegalTargetsFor`
surfaces only the owed placement. `decideBuild` goes through
`requireActionableTurn` (`engine/build.go`), which consults each module's
`Blocks`/`BlocksTurnActions` hook and returns `ErrModulePending`, so a bot,
replay or hand-built request cannot build either.

**A difference from human play is a hypothesis, not a deficiency.** Across 2315
human winners in recorded games, people held Largest Army in 56.7% of their wins
against the bot's 40.8%. Repricing the title as two victory points in the
evaluator's convex units (roughly forty times the old value) measures **50.1% /
50.4% / 49.2% / 50.8%** at scales of 0.25 / 0.5 / 1 / 2 against no army term:
inert at every magnitude. A clone ladder cannot price a contested title, since
pressure only changes which identical bot takes it, so re-test against
`diversePool` (`TestArmyAgainstPool`). Human data generates hypotheses; only an
arbiter that differs from the candidate can decide them.

**Correlation with winning is not usefulness at placement.** `earlyResW`
discounts ore to 0.85 and sheep to 0.9. Across tens of thousands of human games,
opening pips of every resource correlate with winning almost equally (wood
+0.296, brick +0.315, sheep +0.300, wheat +0.367, ore +0.382 per SD).
Flattening the discount measures **24.7% on base against the tuned 28.2%**, and
27.1% against 28.2% on Knights. Keep it: opening ore predicts winning because it
pays later, in cities, but nothing in the first turns is built from it.
`WithFlatResourceWeights` keeps the ablation.

(A published 108-game study reports wheat +0.72 and ore -0.55; neither
replicates here. What does replicate is that concentration hurts: a >=50% share
of any single resource wins 20-23% against a 25% base, and 0% wheat wins 20.1%,
a diversity effect the evaluator already prices.)

**A model that predicts outcomes is not a function to steer by.** The linear
win-probability model is wired into `eval` as an additive term (`Weights.Learned`,
zero by default). It costs +14% per game end to end after dropping its most
expensive features, and it is monotonically harmful: on base, weight 0 measures
28.6%, weight 1 26.4%, weight 3 26.6%, weight 10 25.1%.

Reading the model's coefficients individually failed three times (dev cards held,
roads built, production pips), and using the whole vector as a term fails too.
What worked was cloning a decision (what a strong player chose, given the
alternatives they rejected): the opening placement clone, +5.0/+6.4.

**Measure a feature's cost in the hot path, not its usefulness to the model.**
Longest road ran a graph search per seat and was 40% of the learned term's cost;
removing it changes the model's validation Brier from 0.1644 to 0.1643. The
harbor features were free to drop too. `dev_played` costs +0.0011 when dropped,
so it stayed. Retrain without the feature rather than reasoning about it, and
measure end to end: the term is 2.3x on `eval` but +14% on a whole game.

**Human games generate hypotheses; the pool decides them.** A win-probability
model fit to recorded strong human games (public features only) reaches
validation Brier 0.1621 against 0.1875 for the base rate. A logistic regression
on the same features scores 0.1643, so the signal is mostly linear and its
coefficients read as log-odds of winning per standard deviation. The training
pipeline is not part of this repository; its output is, embedded in
`bot/*_net.json`.

It disagreed with `bot/eval.go` in three places:

  `me_dev_held` **+0.575**, the second largest term, against our `Dev = 0`.
  **Rejected.** Against the pool, Dev=0 is 28.4% and Dev=2.0 is 25.7%. Holding
  dev cards correlates with winning without causing it: winners can afford them.

  `me_roads` +0.331 with no direct term in the evaluator. Untested; probably
  already captured by Expansion.

  Production pips ranking last among own-player facts (+0.08..+0.14) against our
  substantial `Prod` weight. **Rejected.** x1.0 measures 28.5% against the pool,
  x0.6 28.1%, x0.3 27.3%. Production is upstream of every piece, so an outcome
  model credits the pieces it bought.

All three fail the same way: the model scores a position to predict an outcome,
the evaluator scores one to choose a move, and credit for a cause flows to its
effects in the first job but not the second. Recorded games also contain hidden
information (every hand, dev-card hand and unplayed VP card), so the feature
extractor refuses it: card counts are public and used, identities are not.

**Weights that are inert by construction read as identical numbers.** Under
Knights, `army x4`, `army x16` and baseline all measure 27.9%, and Dev at 0 /
0.25 / 0.75 all measure 28.0%: identical games. Knights replaces the development
deck and Largest Army, so both terms are dead there. For that reason the
human-calibrated pool's "army-racer" arm (used by
`TestAgainstHumanCalibratedPool` on `base+cak`) also scales `KnightsLevel`, the
term Knights reads, and `sim.TestPoolArmsPlayDifferently` requires every
arm of every pool to play a different game from the baseline across five seeds
(one seed is not enough: arms can match on one deal and diverge on the next).

`sim.TestNaivePoliciesChangeGame` is the same check for
`WithNaivePolicy`, and an unknown policy name panics.

## What humans do that this bot does not

Measured against recorded human games, base ruleset. The bot half is
`sim.TestTradeRatesAgainstHumanBaseline`: 1424 human games (4 players, base, at
least 20 turns) against 40 bot games.

| per game unless noted     | humans | this bot |            |
| ------------------------- | -----: | -------: | ---------- |
| turns                     |   74.8 |     81.5 | 9% longer  |
| player offers, per turn   |   0.47 |     0.07 | 6.7x fewer |
| trades executed, per turn |   0.09 |     0.04 | 2.2x fewer |
| bank/port trades per turn |   0.24 |     0.31 | 1.3x MORE  |
| offer to accept rate      |  19.1% |    49.4% |            |
| games with a player trade |  99.2% |          |            |

**The bot trades with the bank where humans trade with each other.** Humans
offer about seven times as often, have four fifths refused, and still land more
than twice as many trades. The bot's 49.4% acceptance rate reflects
`offerTrade`'s gating: it proposes only when a trade is clearly good for it,
which is when it is clearly good for the counterparty too.

Self-play cannot arbitrate this: every pool arm shares the same evaluator, so
they under-offer together. These are hypotheses, and testing them means a ladder
run (`COSTAN_LADDERS=1`), which the slow gate does not do. In order of promise:

1. Raise offer volume and accept a much lower hit rate.
2. Prefer a player trade over a bank trade at equal value.
3. Study what the refused human offers asked for.

**Limits of this data:** every game is base ruleset (`extensionSetting` and
`scenarioSetting` are 0 throughout), and every game carries `isRanked: false`,
so "strong human play" is an assumption about the population.

**Re-audit against the pool.** Every opponent-dependent conclusion first made on
a clone ladder was re-decided against `diversePool`. Largest Army stays inert
(26.7% baseline, 26.5% at x4, 25.8% at x16). Longest Road chasing is badly
negative (21.3% against a 25% fair share). Opponent-awareness at x4 is flat to
slightly negative. Only Expansion changed, and it shipped.

**Cloning decisions from human play:**

  **Opening placement: shipped, +5.0 base and +6.4 Knights** against
  `diversePool`, replicated on two seeds (the first gave +2.9/+4.4). A network
  scores each legal corner and the best is taken; it matches a strong human's
  pick 50.7% of the time against ~41 options, where a pips-plus-diversity rule
  shaped like `setupVertexScore` manages 36.0%. `WithHandPlacement` restores the
  old scorer.

  **Robber placement: rejected.** 740228 human robber moves, same architecture:
  0.372 top-1 against 0.371 for "block the most production", and worse on top-3
  (0.664 to 0.722). `robberDenial` already does what humans do.

  **Build choice: rejected.** 2357092 in-turn decisions, including when to
  stop. It imitates well (67.2% of choices against a mean 7.6 options, where
  "take the most production" gets 48.6%) and plays far worse: 19.4% against the
  evaluator's 27.1% on base. (The Knights figure, 12.1%, is not evidence: the
  net was trained on base.)

Two rules follow. **Clone decisions where self-play had no signal to tune
against**: opening placement had been tuned against clones, which cannot price
taking a spot before a rival does. **Cloning transfers for one-shot decisions
and compounds errors on sequential ones**: placement happens four times from a
fixed candidate set, while build choice happens ~50 times a game and each
deviation moves the bot away from the states the policy was fit to. Fixing that
would mean training on the bot's own states (DAgger-style), not more data.

**The decision also has to matter.** The opening road has been scored three
ways: the shipped rule (28.8% base / 27.8% Knights), the "score what it opens"
fix (27.0/28.1 against 27.4/28.3), and a policy cloned from 322632 human roads
that imitates far better (0.670 top-1 against 0.468) and measures 27.4/27.2. All
the same: the candidate directions out of a fresh settlement are near-equivalent.
`setupRoad` does lead with the pips of an unbuildable vertex, and humans agree
that is wrong ("point at the richest far corner" scores 0.232 top-1, below
random's 0.348), but fixing it is worth nothing. Reachable via
`WithLearnedSetupRoad` and `WithRoadOpens`.

**The road gate is right.** `bestPlay` only considers roads when no open spot is
reachable and the network is proportional to settlements. Humans build roads
that rule forbids, but tested on its own the gate measures 27.1% on base and
26.0% on Knights, ungated 21.6% and 24.6%. Removing it costs 5.5 points.

**A dead mechanic is a candidate, not an answer.** Enabling commodity conversion
toward city improvements (`CmdCommodityTrade` / `CmdTradingHouse`) measured
**-10.8 points**: at 4:1 or worse, with `knightsEval` pricing any commodity held
toward the next improvement, the bot traded 19 times a game. Restricting it to
trades that complete an improvement (as `tradeTowardBuild` does for resources)
measured **49.9% [48.6, 51.1] over 6000 games**, so it was dropped. The other
dead mechanics (fish spends, the boot, the progress deck) were worth +17, +6.8
and +42.4.

**Adding a module? Count its events, do not read its win rate.** Strong beats
Simple 98-100% in every ruleset, including while building zero ships and
spending zero fish. A blind spot both bots share is invisible in a head-to-head;
counting the events a mechanic emits finds it. Every mechanic across the shipped
rulesets reads non-zero.

**Count the event that means the thing.** `EvCamelBuilt` is not a camel:
`engine/scenarios/caravans.go` comments it `marker: builder acted this turn`, so it
counts turns somebody built in, even on a board with no oasis.
`EvCamelPlaced` is the event that means a camel; `sim.TestCamelsGetPlaced` and
`sim.TestCaravansAlwaysHasOasis` assert both halves (the Islands carve used to
drown the only desert on some `base+islands+caravans` boards).

## Caravans

**The bot chooses camel placements and can price a bid** (`bot/caravans.go`).
Bidding is off by default (`bot.WithCamelBids`; see "Two features are off by
default" below).
`Caravans.auto` bids `{wool: 0, grain: 0}` and places on `legalPaths(...)[0]`,
and `pickPlacer` sends an all-zero round to the seat that ended the turn.

Measured over 40 games per ruleset (`sim.TestCamelEconomyAcrossRulesets`), per
game:

| ruleset | rounds | cards paid | rounds won on a bid | placements off `paths[0]` |
| --- | --- | --- | --- | --- |
| `base+caravans` | 14.22 | 27.23 | 3.65 | 2.90 |
| `base+caravans+islands` | 12.55 | 19.80 | 2.83 | 1.70 |
| `base+caravans+fishermen` | 14.53 | 22.32 | 3.30 | 2.25 |
| `base+caravans+fishermen+islands` | 14.12 | 22.62 | 3.55 | 2.67 |
| `base+cak+caravans` | 11.55 | 16.73 | 2.45 | 2.17 |

Every column is zero under `auto` by construction.
`sim.TestBotsPriceTheCamelAuction` asserts that as an A/B against
`bot.WithoutCamelPlay()`, which restores `auto`. (These figures predate bidding
being switched off by default; see below.)

How the mechanic shapes the policy:

- **A camel is worth what it does to this board.** A building between two camels
  of one caravan is +1 VP and a road sharing a camel's path counts double for
  the route, so the value of a placement depends on what is already built. It is
  priced by placing the camel on a clone and evaluating. The counterfactual is
  the mean over the legal paths: losing the round means a camel lands somewhere
  we did not choose.
- **Wool and grain are real cards.** A bid's cost is measured by taking the
  cards off a clone and evaluating; the split between the piles is chosen
  greedily.
- **It is a sealed, all-pay auction.** Bids are hidden until the round closes,
  so rivals are modelled from `publicHandEstimate`. A server-side bot acts on the
  authoritative state, so `CaravansExt.Bids` is a field access away from
  `camelBid`; two tests in `bot/camelseal_test.go` guard it (no file in `bot/`
  names the sealed field, and scrambling rival bids must not move the bot's
  command). `settle` charges every bidder, so the bid maximises
  `P(win | k) * gain - cost(k)` with the cost unconditional. Ties fall to the
  finisher, whose zero bid is a free entry, so it should bid less than everyone
  else.

**What the lane decides.** From instrumenting `camelBid` (1691 bid decisions in
36 seeded 4-player games, and 1760 over 30 games across `base+caravans`,
`base+islands+caravans`, `base+cak+caravans`) and the
`TestCamelEconomyAcrossRulesets` sweep:

- **The entry gate does most of the work.** 1280 of 1691 decisions (76%) never
  price anything: `camelGain` returns zero and the bot passes.
- **The bid must be priced in the units it is paid in.** With the production
  `Weights.Opp` (9.6), `camelGain` mixed a ranking discount into a price. A
  camel lands on a shared board, so the opponent term varies most across
  candidates (through a `max`), while dropping a card from our hand leaves every
  rival's `selfScore` untouched: the 9.6x survives in the gain and cancels from
  the cost. On the 443 of 1760 decisions where the gate fired, median gain was
  157.6 with that weight against 4.0 with the opponent term zeroed, while a card
  costs 0.54, and 44.7% of firing bids had zero or negative self-gain.

  The fix (`bot.camelBidOpp`, `bot.camelCardPrice`) prices the auction with
  `Opp = 1.0`: denial is real, but a point is worth the same on either side of
  the table. The card price comes from the rules: a settlement is four cards and
  worth at least a point, so a card is a quarter of the next victory point, taken
  convexly at the current VP. `handValue` cannot do this (it prices the fourth
  card of a resource at zero). Where the evaluator prices a card higher (the card
  that completes a build), the higher price stands.
- **The cap sweep is inert once priced.** Unpriced, cap 2 beat cap 4 by 4.8
  points and `bestK == maxK` on 349 of 372 bids (the hand was the bound). Priced,
  all four caps overlap the 25.0% fair share (cap2 24.5%, cap4 26.3%, cap8 24.0%,
  cap64 25.2%), so `camelBidCap` is a backstop that never binds.
- **Placement matters for one camel in five.** 14.22 camels placed per game in
  `base+caravans`, 2.90 of them off the first legal path. The rest tie, and
  `camelPlace` keeps the first path on a tie, matching `Caravans.auto`. Every one
  is still stamped `SourceBot`, which is why the sim gate is on `offFirst`.

**The lane, measured** (`sim/camellane_test.go`). 22000 games, seats rotated,
Wilson 95%, no `-race`, across two player counts, a null arm and the cap sweep.
The null arm read 49.3% against 50.7%, so the noise floor is about +/-1.6
points.

| arm | 4p `base+caravans`, 8000 games | 6p `base+caravans`, 6000 games |
| --- | --- | --- |
| priced | 27.2% [26.2, 28.2], avgVP 9.02 | 38.5% [37.3, 39.8], avgVP 8.54 |
| no-bid | 27.7% [26.8, 28.7], avgVP 9.04 | – |
| off | 26.7% [25.7, 27.7], avgVP 9.00 | 38.6% [37.4, 39.8], avgVP 8.56 |
| legacy | **18.4%** [17.6, 19.3], avgVP 8.19 | **22.9%** [21.8, 23.9], avgVP 7.63 |

Fair share is 25.0% at four players and 33.3% at six. The unpriced (legacy)
lane cost 8.8 points at 4p and 15.6 at 6p; pricing removes that. Priced, no-bid
and off are indistinguishable at both counts, so the lane is not a gain.
Placement stays on; bidding was later measured as a loss with a corrected rival
model and is now opt-in (`bot.WithCamelBids`).

**Ladders never run in the gates.** Ladders skip under `-race` and require
`COSTAN_LADDERS=1` (`sim/ladder_race_test.go`), and both gates pass `-race`, so
neither answers "did the bot get stronger". What the default gate can check is
cost: `sim.TestCamelLaneAffordable` bounds cards-per-round at 0.7,
asserts the unpriced arm fails that bound, and asserts the priced lane spends
under half what the unpriced one does on the same seeds (a same-run ratio is
robust to board changes where an absolute ceiling is not). A bot lane that pays a
resource cost should get a cheap affordability assertion like this; the ladder
decides whether a plausibly priced lane is an improvement.

**The evaluator has no caravan term.** `bot/eval.go` sees a camel only through
side effects of the simulated placement (a building between two camels, a road
doubling for the route), so `gain` is zero on three quarters of rounds and large
on the rest. A camel that moves a caravan one edge closer to our settlement is
worth zero until it completes the pair. A positional term (camel approach to our
buildings, caravan proximity, denial of a rival's pending pair) is the most
plausible route to a positive lane, and needs its own ladder.

**Adding an eval term? Check what it reads.** Anything indexed by an opponent's
seat that is not in the "may use" table above needs a public estimate instead.

## The ladder (`sim/ladder.go`)

`sim.Run` plays a seat-rotated head-to-head between named contenders and reports
win rates with 95% Wilson confidence intervals. It is the measurement instrument
for any bot change, and the fitness function a weight-tuning run calls.

- **Seats rotate.** Seat 0 measured 29% of a 4-player field over 200 games
  against a 25% fair share. Every contender occupies every seat equally often,
  and seats must divide evenly among contenders.
- **Intervals, not raw counts.** `Ladder.Beats` requires non-overlapping Wilson
  intervals. At 200 games a 4-point gap is noise.
- **Wins are per game, not per seat.** A contender holding two of four seats
  still wins at most once, so the denominator is games played.

`sim.Contender.New` is a constructor rather than a bot instance so an
out-of-process contender (a neural policy in another language) could use the
same interface.

**Measured:** robber denial + road reachability against the evaluator that
predates them (`bot.BaselineWeights`), 2999 games, 4 players, base ruleset:

| contender | win rate | 95% CI | avg VP |
| --------- | -------- | ------ | ------ |
| current   | 61.3%    | 59.5–63.0% | 7.48 |
| legacy    | 38.7%    | 37.0–40.5% | 6.83 |

Cost: `BenchmarkScore` went 8.8µs → 12.3µs per evaluation (+40%), at ~70
games/s on 8 workers, after scratch buffers on `boardInfo` and scoring
reachability for one seat rather than all four.

## Knights

Strong plays the full Knights game. The same candidate-generate-and-evaluate
loop is extended (`bot/knights.go`, `bot/knights_eval.go`, `bot/knights_progress.go`):

- **Module-aware VP.** The eval counts VP through `PublicVPWithModules`, so
  metropolises, defender/merchant VP, and Constitution/Printer cards are valued
  everywhere the bot reasons (scoring, winning move, threat).
- **Positional eval terms** (`evalModule` → `knightsEval`): city-improvement
  infrastructure (monotone, with the ability jump at level 3), the commodity
  engine (producing cities + held commodities toward the next improvement),
  knight strength scaled by barbarian imminence, a barbarian term that rewards
  the likely sole defender and penalizes the player who would lose a city when
  the city side is under-defended, progress-card optionality, and walls. None of
  it re-prices VP.
- **Candidate set:** city improvements, knight recruit/activate/promote, city
  walls, and progress-card plays (scored where the effect is immediate, by rule
  where it resolves through a pending; see `knightsFreeProgressPlay` above). A
  commodity-aware 7-discard sheds least-useful resources and only surplus
  commodities.
- **Forced module picks** are answered before the turn gate (they block
  everything else): the barbarian city sacrifice gives up the least valuable
  city, and the metropolis placement takes the most valuable one, since a
  metropolis city can never be pillaged.

The barbarian penalty makes the scorer defend on its own: activating or
recruiting knights when an attack looms removes the city-loss penalty, so it
shows a positive eval delta.

**Strength:** `sim.TestStrongBeatsSimpleKnights` (24 seat-rotated games on base+cak
at the full 13-VP target) has Strong beating three Simple baselines decisively,
and the all-bot completion test runs base+cak to 13 VP.

**Expansion coverage.** Islands ships are Strong's own candidates, priced by
`islandPull`, though no Strong seat moves a ship yet. `bot/fishermen.go` spends
fish and passes the boot, and `bot/caravans.go` handles the camel auction.

**Two features are off by default, and both defaults are measurements.**

- **The camel bid** (`bot.WithCamelBids`). A uniform rival model puts a one-card
  bid's win chance at `(1/5)^3 = 0.008` at four seats, so the bid almost never
  fired (8146 of 8185 bid decisions named nothing over 200 games, and 2007 of
  2037 placements resolved `reason:nobody`). With `camelZeroBidMass` (0.9 mass
  on abstaining) the bid fires, and over 4000 seat-rotated games it loses by
  about five points: bidding 23.9% [22.7, 25.3] against no-bid 29.1% [27.7,
  30.6] and off 28.4% [27.0, 29.8]. Placement stays on; bidding is opt-in.
  `camelGain` probably overprices a placement against a wool or grain card.
- **The held-fish term** (`bot.WithFishHoldWeight`). Making held fish worth
  something makes the top rung less reachable, because a state value on a
  resource charges each spend for what it consumes, so the most expensive rung is
  charged most. With the rung gate in place, the 7-fish dev card was used 14, 9
  and 5 times per hundred games at weights 0, 0.25 and 0.5. What made the top
  rung reachable is a rule (`fishRungFloor`: a pile of five or six fish may not be
  spent at the cheap rungs while the dev deck is live) plus pricing the 3-fish
  steal on the neutral opponent scale (it is the only fish spend with a denial
  term). Seat-games ever holding seven fish went from 65 in 400 to 140, and the
  top rung from 4 uses per hundred games to 14.

**A ladder over a feature that rarely activates measures nothing**, and reports
it as a clean neutral. Report the activation rate next to the win rate.

`bot.Simple` has a minimal Fishermen policy too (`bot/simple_fish.go`): cheapest
affordable rung with a legal target, boot passed when allowed. It exists for
reach: `sim.TestAdversarialAcrossRulesets` is where `checkRuleInvariants` runs,
and the 4-fish bank withdrawal must reach the resource ledger. That battery runs
the three tab rulesets with Strong as well, and asserts that both of
`engine/scenarios`'s base-resource paths (the bank withdrawal and the auction payment)
were reached.

## Harbormaster

Harbormaster adds no command, so Simple needs no policy, Strong needs no
candidate generator, and no new illegal move is possible. The card's 2 VP and the
module's extra point on the target are already counted by `PublicVPWithModules`
(which sums every `VictoryCheck`) and `threatExcess` (which reads
`engine.WinThreshold` per opponent).

What remains is the gap `armyProximity` fills for Largest Army: an evaluator that
scores a title only once held cannot tell a harbour settlement from an inland
one. `harbourProximity` (`bot/harbormaster.go`) is a ramp from 0 to 1 over the
threshold of 3 harbour points, returning 0 once the card is held.

**`Weights.Harbour` is 2.0, hand-set and unmeasured.** No ladder plays a
Harbormaster ruleset. It is half of `Army`, on the argument that a harbour
building already pays through `Prod` and `Port` while a played knight pays only
toward the title. Zero reproduces the previous evaluator exactly.

It is not a chase-the-leader term: as with Longest Road, chasing a title
measured as a loss while valuing progress toward it paid. It stops at the
threshold.

## Where bots run

Server-side, on the authoritative state, installed per seat by the game
manager's bot factory. The `costan-sim` CLI and the `sim` package drive full
bot-vs-bot games end to end; pass `-bot strong` or `-bot simple`.

## Raiders

The target is 12 VP (13 under Knights), with no Largest Army and no dev-card
points, and every settlement or city triggers a landing on the coast it produces
from. A bot that only builds never finishes (four Strong seats on seed 7 without
`bot/raiders.go` ran to the event cap with nobody past 8 points). Prisoners make
the difference; they come from riders, which come from the scenario's own
development deck.

Two decisions are made by rule rather than by scoring:

- **Rider movement.** A battle resolves at the end of the turn, so
  `DecideForEval` folds a march onto a position that looks unchanged. A
  destination that completes a victory (riders on that hex outnumbering its
  raiders once this one arrives) beats everything; otherwise the rider moves
  closer to the nearest raided hex. The grain for two extra paths is paid only
  when those paths reach a victory.
- **Buying a card.** It is revealed and resolved on purchase, so simulating it
  would peek at the deck (see `expectedDevBuyValue`).

The baseline has its own policy (`simpleRaidersPlay`), because
`engine.AutoCommand` covers only decisions the module is waiting on, and hiring,
marching and spending gold are voluntary. **Every Simple rider marches at the
same hex**: a victory needs riders to outnumber the raiders on one hex, so
spreading out wins nothing.

**Where the baseline is weak.** `base+cak+raiders` is the hardest ruleset for
Simple: prisoners score `floor(n/3)` rather than `floor(n/2)`, the target is 13,
and dropping the Knights barbarian fleet takes the Defender VP with it. Four
Simple seats finish 22 of 48 there, while four Strong seats finish 8 of 8. The
`verify/` gate picks a seed that finishes.

**A seat locked out of building still has a move.** A conquered hex refuses
every build on its corners, city upgrades included, so on a small Islands main
landmass a saturated coast can leave every seat with no legal settlement or city.
Interior and outer-island hexes still produce, gold still buys two resources a
turn, the bank still trades, and the card still musters riders that can win a hex
back. The trade planner (`wantedCost`) prices only builds, so
`raidersSaveForCard` (Strong) and the card want in `simpleBankDig` plus the gold
priority in `simpleRaidersPlay` (Simple) work toward the card, gated on the lock
so they never compete with a build. Over 128 four-seat Strong seeds on each of
base+cak+islands+raiders, +harbormaster and +fishermen+harbormaster, 128/128
finish (seed 6 previously stalled in all three).

## Wagons

Both bots drive. Obligations are dispatched by rule; purchases go through the
evaluator.

Simple runs its wagon lane **before** `engine.AutoCommand`: the movement phase
blocks the pass, so the module's `Auto` (which declines) is what `AutoCommand`
returns every turn, and a baseline reaching it first would never move its wagon.
Its policy: upgrade before setting out, drive off an adjacent barbarian (free,
and it saves 2 MP on every later crossing), drive toward the nearest delivery,
then spend leftover gold on a resource or a surplus resource on gold.

Strong plans the circuit rather than the step. `wagons.Distances` is a Dijkstra
over the engine's own prices (including the rule that a toll a seat cannot pay
makes the path impassable), run once from each place the wagon wants to reach,
and the bot takes the step that shortens the whole remaining route. Movement is
by rule because a wagon's value is a plan several turns long. The track and the
two gold lanes go through `consider` like any other spend.

Neither bot can propose an illegal move: every step comes from
`wagons.LegalSteps`, the set the engine accepts, and every other candidate is
confirmed with a clone plus `Decide`. `WithoutWagonPlay()` drops the lane for an
ablation, measuring a table that owns wagons and never uses them.

**The second trip is by rule too.** The position after Swift Journey is the
position before it with a fresh allowance, which a position score cannot price.
Both bots play it (`swiftJourney` in `bot/wagons.go`, called from
`simpleWagonPlay`, which Strong reaches through its baseline fall-through after
its builds) when the second trip arrives: a delivery, or a pick-up for an empty
wagon, within a fresh allowance at the current level, plus the grain boost when a
grain is in hand. The second trip may buy the boost again (`EvSwiftPlayed` clears
`Boosted`). A trip that only gets closer is not worth the card. The same arrival
rule buys the boost itself (`boostToArrive`, both bots, either trip): one grain
only when the plaza is beyond the movement left and within it plus 2. Pinned by
`TestBotsPlaySwiftJourneyForDelivery`.

Measured on `base+wagons`, seeds 1000 onward, `WithoutSwiftJourney()` as the
before arm. Plays per game, all seats the same bot, 100 games: Strong 0 to 0.85
(3 seats) and 0 to 1.06 (4 seats); Simple 0 to 0.57 and 0 to 0.94. Win rate of
one new seat among old ones, 600 paired games each (same seeds, same seat, SE
about 1.9 points): Strong 31.3% to 32.7% (3 seats), 23.5% to 25.0% (4 seats);
Simple 36.2% to 37.8%, 26.0% to 23.5%. Neutral within noise, and every game
finished in every arm.

## Explorers

Both bots sail, and this is the only lane where the module answers for the whole
turn. `simpleExplorersPlay` and `StrongExplorersPlay` both answer every call once
the turn is in the Movement phase, because that phase closes building
(`Hooks.BlocksBuildTrade`): the base build ladder would propose refused builds,
and `AutoCommand` would return the module's decline.

The buy order follows the missions: a crew is the cheapest piece that moves a
mission marker (a lair takes three, a farm one), so crews come before settlers
before ships, except that a seat with no ship cannot explore, carry a crew or
deliver, so Strong buys the first ship ahead of everything. A harbour settlement
is two points for the cost of a settlement and is the only shipyard, so it
outranks a plain settlement.

Both bots leave the pirate activation to `AutoCommand`: it can be owed by a seat
not on turn.

Movement is by rule, as with Wagons; crews, settlers, the two gold lanes and the
harbour upgrade go through the evaluator.

Every destination comes from the engine's published sets
(`legal.explorer_ships`, `HarbourUpgrades`), so neither bot can propose an
illegal command.

**Simple stalls came from the Action phase's trades.** At the default target of
17, two-player Simple stalled 38 of 200 games in `explorers` and 23 of 200
in `cak+explorers` (13 and 5, 14 and 9, at three and four players; Strong
stalled none): every settlement placed, no road left to build toward, and a hand
with no ore while a harbour settlement or a crew sat one 3:1 trade away. Three
fixes in `bot/explorers.go`:

- `simpleBankDig` trades only toward a city, a settlement, a road or a dev card,
  all removed or exhausted under Explorers. `explorersBankDig` trades toward
  `explorersWants` (harbour settlement, settler, crew, settlement, ship),
  placement-only like the road want above, at the seat's real 3:1 rather than the
  base four-card floor.
- `explorersBuildShip` recycles only a ship with no route back to a harbour,
  not any empty hull (which swapped empty ships every turn and spent the wool a
  crew needed).
- Over the discard limit the order is buy, trade, sell (selling first sold the
  grain a trade needed). Under `cak+explorers` the city is one of the lane's
  wants, because the sale answers before the base ladder's city dig is reached.

Both pairings now finish 200 of 200. `sim.TestSimpleExplorersStalledSeedsTerminate`
pins nine seeds that stalled (default gate), and `sim.TestExplorersGamesTerminate`
sweeps both rulesets, both bots and two to four players at a budget of zero
(slow gate).

`StrongExplorersPlay` also defers to any module pending
(`engine.RequireActionableTurn`), since it runs before the part of Strong that
answers a Knights Defender draw or a progress discard.

Explorers runs in `sim/adversarial_test.go` with the Strong arm set: the
baseline cannot reach ships, crews, settlers or the Movement phase, and the
conservation ledger only prices the three base-resource movements (a reveal
paying out of the bank, a gold purchase taking from it, a Fast Gold sale putting
one back) once a bot reaches them.

## Personalities (`bot/personality.go`)

A **personality** is a named `Strong`: a weight vector, the options that
character needs, and one line of English saying how it plays. The lobby seats
bots by personality, drawing without replacement, so a table mixes strategies.
Since a version of Strong is the binary plus a weight vector, a personality can
also be a `sim.Contender` with no new plumbing.

**The name is the personality.** There is no personality column.
`lobby.AddBot` creates the bot's guest account under the display name
(`"Bot Winston"`), so the choice lands in `users.name`, comes back on every seat
row as `Seat.UserName`, rides into the game view in `SeatNames`, and is what a
replay reads. `bot.PersonalityForDisplayName` is the inverse. So names are
frozen (renaming orphans every game a personality played;
`bot.TestDisplayNameRoundTrips` guards the mapping), and an unknown name must be
survivable: a forfeit takeover uses the human's own name, so
`bot.NewPersonalityFor` falls back to plain `NewStrong`.

**The draw is from `crypto/rand`, not from the game seed.** The public seed is
under commitment until the finished game reveals it, and a bot's name is on
screen from the moment it sits down, so deriving it from the seed would leak bits
of the dice source. Determinism is not needed: the choice is persisted, so
replays, reconnects and restarts read it back, and the game itself stays
reproducible from its event log. `lobby.randomIndex` uses rejection sampling
rather than a modulo, so no personality is drawn more often.

**There are eleven because a ten-seat table needs at least ten.**

### Winston and `Weights.Route`

`Weights.Route` prices the acting seat's own longest route, in edges. It is zero
in `DefaultWeights` and `BaselineWeights` and not computed at all when zero, per
the additive rule. It exists because who holds the title is a step function and
nothing else in the evaluator sees the distance to it. Chasing measured 48.1%
against clones and 21.3% against the pool, so it stays out of the default vector.

At `Route = 1000`, one further edge outweighs the best any other term can produce
from a single action, so whenever a legal affordable road exists it is the
top-scoring candidate. An illegal road is still dropped by `Decide`, an
unaffordable one is never a candidate, and `winningMove` still short-circuits the
evaluator, so Winston takes a win over a road. Winston also needs
`WithLongestRoad()`: without it `bestPlay` only offers road candidates when no
frontier spot is reachable.

Measured over 100 games, 4-player base, seat rotated, one Winston against three
house bots (`sim.TestWinstonChasesLongestRoad`):

| per 100 games | Winston | William |
| ------------- | ------: | ------: |
| roads built | **843** | 494 |
| total route length | **808** | 477 |
| held Longest Road | **67** | 32 |
| settlements built | 33 | **210** |
| cities built | 84 | **159** |
| games won | 4 | **34** |

Winston does what it says and is much weaker for it, as expected. A personality
is a different opponent, not a better one.

### The roster, measured

Per turn, 100 games each, 4-player base, seat rotated, one personality against
three house bots. `sim.TestEveryPersonalityPlaysItsCharacter` logs every row.
"LR" is games out of 100 finished holding Longest Road.

| | settle | city | road | dev | knight | bank | offer | LR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| William (house) | 0.106 | 0.080 | 0.249 | 0.212 | 0.107 | 0.328 | 0.072 | 32 |
| Winston | 0.016 | 0.040 | **0.405** | 0.211 | 0.114 | 0.219 | 0.059 | **67** |
| Happaya | 0.098 | 0.084 | 0.223 | 0.193 | 0.108 | 0.315 | **0.173** | 21 |
| Camembert | 0.084 | 0.085 | 0.213 | 0.196 | 0.097 | 0.315 | **0.104** | 33 |
| Bop | 0.079 | **0.059** | 0.202 | 0.226 | 0.108 | 0.287 | 0.059 | 18 |
| Moriarty | 0.100 | 0.086 | 0.249 | 0.220 | 0.108 | 0.340 | 0.074 | 26 |
| Z | 0.106 | 0.077 | 0.246 | 0.216 | 0.112 | 0.304 | 0.069 | 31 |
| B | 0.104 | 0.078 | 0.246 | 0.221 | 0.110 | 0.333 | 0.069 | 29 |
| Jester | 0.092 | 0.077 | 0.225 | 0.215 | 0.115 | 0.307 | 0.071 | 19 |
| Pika | 0.103 | 0.078 | 0.246 | 0.228 | 0.115 | 0.322 | 0.076 | 28 |
| Chu | 0.096 | 0.081 | 0.232 | 0.217 | 0.105 | 0.307 | 0.064 | 16 |

**Most of these vectors barely change what the bot does.** Moriarty, Z, B,
Jester, Pika and Chu sit within a few percent of the house bot on every counter,
at 2x to 5x on the term each is named for: coefficients are exhausted. The three
that move a lot move for structural reasons: Winston carries a new term, Happaya
an option (`WithUngatedOffers`), and Camembert needed 20x on `Hand`.

So `sim.TestEveryPersonalityPlaysItsCharacter` gates only rows where a statistic
moves, and logs the rest. The others are kept because a distinct vector still
makes a distinct game (`bot.TestEveryPersonalityIsADistinctVector`).

**Gated rows must hold at the sample size they run at.** Any change to the event
log re-rolls the rest of a game: random-mode dice, dev draws and robber steals
are all `rngFor(seed, NextSeq)`, so adding an event (such as an explicit trade
decline) turns seeds 1000-1015 into sixteen different games. Over 500 games per
personality, with declines on and then suppressed, every offer rate agrees to
within 0.007 per turn:

| offers per turn, 500 games | William | Winston | Moriarty | Happaya | Bop | Z | B | Jester | Camembert | Pika | Chu |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| declines silent | 0.076 | 0.054 | 0.073 | 0.163 | 0.062 | 0.065 | 0.078 | 0.068 | 0.098 | 0.072 | 0.068 |
| declines out loud | 0.075 | 0.047 | 0.074 | 0.156 | 0.065 | 0.071 | 0.080 | 0.071 | 0.101 | 0.072 | 0.071 |

Cut into every seat-aligned 16-game window, those 500 games invert Camembert's
offer row 21% of the time, Camembert's settlement row 16%, Bop's 9% and Winston's
city row 4%; at 100 games, 1%, 0%, 0%, 0%. Winston's roads and Happaya's offers
never invert at 16. So those two whole-game rows gate at the default sample and
the other four only at 100 (`wholeGameRowGames`). The default gate checks every
character it can resolve through `sim.TestEveryPersonalityDecidesInCharacter`
instead: the house bot plays every seat, and at each turn decision both the
personality and William are asked what they would do from that position. A
paired count over identical positions has no trajectory variance; over 300 games
in 16-game windows no row inverted, the thinnest margin being Camembert's 15
offers. (Camembert's fewer settlements is not paired-gated: it inverted in 4 of
285 windows, since a hoard is a whole-game shape.) The default sample is 16
games; `COSTAN_SIM_SLOW=1` runs 100.

**Bop.** At 100 games per arm, dev purchases per turn barely move with
`Weights.Dev`: **0.212, 0.223, 0.221, 0.226 at Dev = 0 / 3 / 8 / 25** (an
eight-game probe suggested otherwise). What the weight does is cost games
monotonically (34 wins in 100 at Dev = 0, then 30, 26, 16) and suppress building:
at Dev = 25, cities 0.059 against 0.080, settlements 0.079 against 0.106, roads
0.202 against 0.249. Bop ships at 25.

`Weights.Army` is absent from every personality: it is inert at every magnitude
against clones and the pool, and a probe here agrees (knights played per turn
0.107 at x1, 0.097 at x8).

**No personality has been through a ladder.** These are behaviour counts, cheap
and deterministic on a seed; strength needs `COSTAN_LADDERS=1`. The only strength
claim here is that Winston is much weaker than William, from a raw win count.
`bot_stats` (see docs/storage.md) accumulates each personality's casual
four-player record from real games.

### Two factories

`Manager.SetBotFactory` takes a seat index, and is what `sim/`, the ladder and
the other commands use. `Manager.SetSeatBotFactory` additionally passes the
seat's display name and takes precedence where both are set; `cmd/costan` uses
it and resolves the name through `bot.NewPersonalityFor`. It is a second field
rather than a wider signature because the existing call sites seat a bot that
does not care which seat it is, and `game/` does not import `bot`, so the
name-to-strategy mapping lives in the caller.
