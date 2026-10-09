# Knights (design)

The largest rules addition. Ruleset `"base+cak"` (combinable with islands as
`"base+islands+cak"`). Its signature config option is skipping the first barbarian attack.

## Rules scope

- **Event die**: rolled with the dice (third die via `rngFor`). Ship face →
  barbarian fleet advances; gate faces → progress card draws for matching city
  improvements.
- **Commodities**: cities on pasture/forest/mountain produce cloth/paper/coin
  alongside resources. Module-owned `Commodities Hand3` per player.
- **City improvements** (trade/politics/science): paid in commodities, grant
  progress-card eligibility, defender bonuses at levels 4-5 (metropolis: +2 VP,
  stealable by higher level). The owner chooses which of their
  metropolis-free cities holds it (`metropolis_pick`; 25s budget, first free city
  in board order on timeout; a player with only one eligible city is never
  asked). Until they answer, the metropolis is unplaced and unscored and the
  table is blocked.
- **Knights**: separate pieces on vertices (`build_knight`, `activate_knight`,
  `promote_knight`, `move_knight`). Active knights chase the robber and count
  toward barbarian defense; any knight (active or not) blocks opponent routes
  through its vertex. Replaces base-game dev-card knights and largest army
  entirely.
- **Barbarian fleet**: advances on ship faces; on arrival, attack strength =
  cities+metropolises vs. sum of active knight levels. Loss: each weakest-defended
  player downgrades a city, choosing which of their own non-metropolis cities
  goes (`barbarian_downgrade`; simultaneous, 30s budget, since under Rivers the
  same prompt offers the 5-coin pillage buyout; heuristically auto-picked on
  timeout; a player with only one sacrificable city is never asked). Win: top
  defender(s) draw Defender VP. Knights deactivate after the attack.
- **Progress cards**: three decks (trade/politics/science), drawn on event-die
  gates by improvement level; hand limit 4; many are play-anytime, modeled as
  commands valid on the holder's own turn (true interrupts like "Alchemist"
  set a pending-action, same machinery as discards).
- **VP target 13**; city walls (+2 discard limit each); no dev cards: the base
  deck is disabled under this module.

## Config (`knights.Config`)

```go
type Config struct {
    SkipFirstBarbarianAttack bool // ignore the fleet's first landfall
    BarbarianDistance        int  // ship advances before an attack (4–12, default 7)
}
```

`SkipFirstBarbarianAttack` skips the first attack.
`BarbarianDistance` overrides the track length; values outside `[4, 12]` fall
back to the default `barbarianTrack` (7) via `Config.barbarianDistance()`, so no
lobby-side validation is needed. The VP target is not module config: it lives on
`GameConfig.TargetVP`; the lobby surfaces a recommended value but the host sets it.

## Implementation notes

**Faithful:** a separate event die is rolled alongside the two production dice
(3 barbarian-ship faces, 3 gate faces); `d2` serves as the red production die;
on a gate, a player with at least level 1 in that discipline draws when the red
die is at most their level plus one (`red ≤ level + 1`, `engine/knights/hooks.go`),
so a level-1 city draws on red 1–2 and level 5 draws on every value. The
barbarian attack awards the Defender VP to a sole strongest defender; on a tie
for strongest, each tied defender gets a progress-card draw and no VP.

**Faithful card interactions:**
- Master Merchant takes up to two *chosen* cards from a player who out-scores
  you (the command names the cards; they are validated against the victim's
  hand).
- Merchant Fleet is a turn-scoped 2:1 trading mode on a chosen resource or
  commodity: it sets a per-turn flag the bank-trade ratio honors until the
  turn ends. Commodities have their own maritime route (`CmdCommodityTrade`,
  4:1, or 3:1 with a generic port), so both halves of the card are live.
- Commercial Harbor is an interactive exchange: the active player offers each
  opponent 1 resource from their own hand, and each opponent returns 1
  commodity of their choice (via `harbor_give`), using the same pending/auto
  machinery as Wedding.
- Bishop takes one random card from each adjacent player.
- Spy lets the player look at an opponent's progress hand and choose one card to
  take (VP cards excepted).
- Deserter is interactive: the victim chooses which knight to surrender, then the
  taker places a replacement of the same strength or lower, their choice of tier
  (`deserter_place` carries an optional `level`, defaulting to the highest tier
  they can field), on a vacant intersection of their roads. It is forfeited
  only if no piece at or below that tier, or no legal spot, remains.
- A progress card that public information proves would do nothing is refused
  (`ErrCardNoEffect`) and stays in the hand; see "Two things you may not do
  with a card" in `docs/rules/knights.md` for the list and the monopoly
  exception.
- Knights are limited to the piece supply (2 basic, 2 strong, 2 mighty per
  player), gated on build (a free basic piece) and promotion (a free piece at
  the destination tier). A player's metropolises occupy distinct cities, and
  which city each stands on is the owner's choice.

**Remaining simplifications:**
- Progress cards play on the holder's turn (Alchemist before the roll); the
  "play between turns" timing variants are out of scope.

## Engine impact

- Pending-action machinery generalizes (discards → a `Pending` set: discards,
  gold picks, progress interrupts, barbarian resolution choices).
- `OnDiceRolled` hook carries the event die result in module state.
- Redaction: progress cards hidden like dev cards; barbarian position public.
