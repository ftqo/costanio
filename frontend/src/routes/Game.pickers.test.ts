import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PENDING_RESOLVED_BY } from "@/lib/autoResolveToast";

// Source-level guards for wiring a unit test cannot observe and whose loss is
// silent. Mounting the game screen (websocket, WebGL board, router, query
// client) in jsdom is not proportionate, but a rule about how the file is
// wired is something a source scan can hold, as in Game.hooks.test.ts.

/**
 * `indexOf`, but a marker missing from the file throws. Guards slice Game.tsx
 * between markers, and a -1 would make `slice` return the wrong text and let
 * the guard pass. Throwing turns "the code moved" into a failure naming the
 * marker.
 */
function idx(hay: string, marker: string, from = 0): number {
  const i = hay.indexOf(marker, from);
  if (i < 0) {
    throw new Error(`marker not found: ${JSON.stringify(marker)}; update the guard that uses it`);
  }
  return i;
}

function gameSource(): string {
  // vitest runs from the frontend package root.
  return readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");
}

/**
 * The board-tap half of the screen: what a vertex or edge tap sends, moved to
 * lib/boardTap so lib/boardTap.test.ts can tap it. Guards about which commands
 * the screen sends read both files.
 */
function boardTapSource(): string {
  return readFileSync(join(process.cwd(), "src/lib/boardTap.ts"), "utf8");
}

describe("force-resolve commands are routed through the dispatcher", () => {
  // The client cannot tell "you confirmed" from "the timer fired": the state
  // frame is identical. Only the sending client knows, so every submit path
  // must record it, which `cmd()` does via PENDING_RESOLVED_BY and a raw
  // `gameSocket.cmd` bypasses. A missed path toasts "Time ran out" at a player
  // who acted by hand.
  const src = gameSource();
  const commands = Object.keys(PENDING_RESOLVED_BY).concat("play_progress");

  for (const type of commands) {
    it(`${type} never goes out via a raw gameSocket.cmd`, () => {
      const raw = new RegExp(`gameSocket\\.cmd\\(\\s*["']${type}["']`, "g");
      const hits = src.match(raw) ?? [];
      expect(hits, `${type} sent via raw gameSocket.cmd; use cmd() or send()`).toEqual([]);
    });
  }

  it("every kind in the table is reachable from Game.tsx", () => {
    // A command in the table that the screen never sends means that pending
    // has no manual resolution at all.
    const screen = src + boardTapSource();
    const missing = Object.keys(PENDING_RESOLVED_BY).filter(
      (type) => !new RegExp(`["']${type}["']`).test(screen),
    );
    expect(missing).toEqual([]);
  });
});

describe("the Escape ladder covers every dismissable modal", () => {
  const src = gameSource();
  // Overlay handles Escape itself only while focus is inside the dialog. These
  // four modals (Crane, Spy victim, Alchemist, Monopoly) need a rung on the
  // window-level ladder to be dismissible from the keyboard.
  const ladder = src.slice(idx(src, "const onKey = (e: KeyboardEvent)"));
  const rung = ladder.slice(0, idx(ladder, "window.addEventListener"));

  for (const state of ["progressOverlay", "picker", "masterMerchant", "commercialHarbor"]) {
    it(`unwinds ${state}`, () => {
      expect(rung).toContain(state);
    });
  }
});

describe("turn-loss resets the dev-card picker", () => {
  it("clears `picker` alongside the build mode when the turn leaves", () => {
    // A turn lost to auto-pass or the turn timer must close the Monopoly / Year
    // of Plenty modal, or a click on it sends a command the server rejects.
    const src = gameSource();
    const eff = src.slice(idx(src, "if (myTurnNow) return;"));
    const body = eff.slice(0, idx(eff, "}, [myTurnNow]);"));
    expect(body).toContain('setMode("none")');
    expect(body).toContain("setPicker(null)");
  });
});

describe("Overlay is the shared dialog, not a local div", () => {
  it("Game.tsx imports Overlay rather than defining its own", () => {
    const src = gameSource();
    expect(src).toContain('import { Overlay } from "@/components/game/Overlay"');
    expect(src).not.toMatch(/^function Overlay\(/m);
  });

  it("the Monopoly picker has a way out", () => {
    const src = gameSource();
    const start = idx(src, '{picker === "mono" && (');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, idx(src, '{picker === "yop"', start));
    expect(block).toContain("onCancel=");
    expect(block).toContain("Cancel");
  });
});

describe("the two progress-deck pickers share one dialog-sized tile", () => {
  // The tied-defender draw and the Fishermen 7-fish draw both ask "which
  // deck?" and share one button body, sized to the 12px label floor and a
  // phone-width target.
  const src = gameSource();
  const tileStart = idx(src, "function DeckChoiceTile(");
  const tile = src.slice(tileStart, idx(src, "\n}\n", tileStart));

  for (const [name, marker] of [
    ["tied defender", "{actorSeat >= 0 && knState?.defender_draws?.[0] === actorSeat && ("],
    ["7-fish progress draw", '{fishPending === "progress_card" && voluntaryOpen && ('],
  ] as const) {
    it(`the ${name} picker renders DeckChoiceTile`, () => {
      const start = idx(src, marker);
      expect(src.slice(start, start + 2500)).toContain("<DeckChoiceTile");
    });
  }

  it("the tile's text is at least 12px and the tile at least 40px", () => {
    const sizes = [...tile.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    // The corner count is a badge, not a label; every label is 12px or more.
    expect(sizes.filter((n) => n < 11)).toEqual([]);
    const label = tile.slice(idx(tile, "{name}") - 400, idx(tile, "{name}"));
    expect(label).toMatch(/text-\[1[2-9]px\]/);
    const w = Number(/w-\[(\d+)px\]/.exec(tile)?.[1]);
    expect(w).toBeGreaterThanOrEqual(40);
  });
});

describe("a picker that asks for a card shows the card", () => {
  // Pickers that ask "which resource?" draw ResCard faces, like the hand
  // shelf, recipes and trade builder, so the pick looks like what it hands
  // you.
  const src = gameSource();
  const blocks: Record<string, [string, string]> = {
    // [start marker, end marker): the end is whatever renders next.
    Monopoly: ['{picker === "mono" && (', '{picker === "yop"'],
    // The spy block's opening is matched without its leading brace: an
    // `actorSeat >= 0 &&` guard (pinned further down) sits between them.
    Aqueduct: ["{knightsAqueduct && (", "knState?.spy && ("],
    "Commercial Harbor give": ["{knightsHarbor !== undefined && (", "{knightsAqueduct && ("],
  };

  for (const [name, [from, to]] of Object.entries(blocks)) {
    const start = idx(src, from);
    const block = src.slice(start, idx(src, to, start));

    it(`${name} renders ResCard`, () => {
      expect(start).toBeGreaterThan(0);
      expect(block).toContain("<ResCard");
    });

    it(`${name} does not name a resource on a bare Button`, () => {
      // A Button tinted with the card's colour standing in for the card;
      // `fill={r.color}` / `fill={c.color}` is the tell.
      expect(block).not.toMatch(/fill=\{[rc]\.color\}/);
    });
  }

  it("an unavailable card is disabled AND dimmed, not merely inert", () => {
    // ResCard drops the hover lift without onClick, but only `dimmed` says
    // "you cannot have this". The Aqueduct (bank out of stock) and the Harbor
    // (you hold none of that commodity) can render a dead card.
    for (const marker of ["{knightsAqueduct && (", "{knightsHarbor !== undefined && ("]) {
      const start = idx(src, marker);
      const block = src.slice(start, start + 1600);
      expect(block).toMatch(/disabled=\{/);
      expect(block).toMatch(/dimmed=\{/);
    }
  });
});

describe("force-resolve toasts respect the acting seat", () => {
  // A bot-played seat still carries our viewer index, so the pending snapshot
  // keeps reporting what "we" owe while the bot answers it. Without this guard,
  // a bot-played seat toasts every force-resolve, and leaving the table toasts
  // them all at once.
  const src = gameSource();
  const effect = src.slice(
    idx(src, "const prevPending = React.useRef"),
    idx(src, "// Prompts driven by LOCAL state"),
  );

  it("the effect bails out when we are not the one playing our seat", () => {
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).toContain("if (!actingNow) return;");
  });

  it("the snapshot is updated before that bail-out", () => {
    // Returning without advancing the ref would leave a stale snapshot, so
    // reclaiming the seat would toast resolutions from while we were away.
    const update = idx(effect, "prevPending.current = next");
    const bail = idx(effect, "if (!actingNow) return;");
    expect(update).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(update);
  });
});

describe("the base development cards are wired to the shared card vocabulary", () => {
  // These five cards use the dock's shared Tip with lib/cardText's name and
  // effect sentence, like every other card, rather than a native `title=`.
  const src = gameSource();
  const shelf = src.slice(idx(src, "{/* Cards in hand:"), idx(src, "{myKnights?.progress?.map"));

  it("the shelf exists and is the block under test", () => {
    expect(shelf.length).toBeGreaterThan(500);
  });

  it("tiles hang their text off Tip, not a native title attribute", () => {
    // A `title=` is a short label with a browser-controlled delay; Tip is the
    // shared popover that can carry the effect sentence and the reason.
    expect(shelf).toContain("<Tip");
    // That fact is a `reason` string from lib/reachability.
    expect(shelf).not.toContain("bought this turn, playable next turn");
  });

  it("the name and hint come from the card table, never hardcoded here", () => {
    expect(shelf).toContain("devCardName(id)");
    expect(shelf).toContain("devCardHint(id)");
    expect(shelf).not.toContain('label: "Year of Plenty"');
  });

  it("uses aria-disabled inside a wrapper span, never the real attribute", () => {
    // Chrome drops pointer events on a disabled control, so `disabled` would
    // suppress the tooltip that explains it (as ShopTile documents).
    expect(shelf).toContain("aria-disabled={!playable}");
    expect(shelf).not.toMatch(/\n\s*disabled=\{!playable\}/);
    // Matched loosely on classes since the wrapper also carries the pile's
    // width. The point is the shape: a non-focusable span around the button.
    expect(shelf).toMatch(/<span\s+className="relative inline-flex[^"]*"/);
    expect(shelf).toContain("tabIndex={-1}");
  });

  it("shows why a tile is dim, and warns without gating", () => {
    expect(shelf).toContain("devPlayableReason(id, view, { ready, locked })");
    expect(shelf).toContain("devEffectWarning(id, view)");
    // The warning must never feed `playable`: a card with no legal effect still
    // burns if the player chooses to spend it.
    expect(shelf).not.toMatch(/playable\s*=[^;]*warn/);
  });

  it("the count badge does not add locked copies to playable ones", () => {
    // 1 playable + 1 bought-this-turn Knight must not badge "2" on a tile that
    // can be played once.
    expect(shelf).toContain("`${ready}+${locked}`");
  });

  it("the Victory Point card is styled as held, not as disabled", () => {
    expect(shelf).toContain("DEV_HELD_ID");
    expect(shelf).toContain("Already scoring");
  });
});

describe("Road Building leads somewhere", () => {
  const src = gameSource();

  it("free roads arm road mode rather than leaving the board inert", () => {
    expect(src).toContain("const owedFreeRoads = view?.free_roads ?? 0;");
    expect(src).toMatch(/setMode\(\(m\) => \(m === "none" \? "road" : m\)\)/);
  });

  it("the outstanding count gets the shared prompt pill, with no cancel", () => {
    const start = idx(src, "{canAct && owedFreeRoads > 0 && (");
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, idx(src, "</TargetPrompt>", start));
    expect(block).toContain("<TargetPrompt>");
    // Owed, not offered: there is nothing here to decline.
    expect(block).not.toContain("onCancel");
    expect(block).toContain("{owedFreeRoads}");
  });

  it("free builds are placeable before the roll", () => {
    // engine/build.go freeRoadPlaceable and engine/legal.go both allow it, so
    // gating on canBuild (which requires `rolled`) would block it pre-roll.
    expect(src).toContain("const canPlaceFree = canAct && freeRoads;");
    const roads = src.slice(idx(src, "const canRoad ="), idx(src, "const canBuyDev"));
    expect(roads).not.toMatch(/const canRoad =\s*\n\s*canBuild &&/);
    expect((roads.match(/\(canBuild \|\| canPlaceFree\)/g) ?? []).length).toBe(2);
  });
});

describe("moving the robber gets the shared prompt pill", () => {
  const src = gameSource();

  it("robber mode renders a TargetPrompt with no cancel", () => {
    const start = idx(src, '{robberMode !== "none" && effMode === robberMode && (');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, idx(src, "</TargetPrompt>", start));
    expect(block).toContain("<TargetPrompt>");
    // A played Knight (or a rolled 7) makes the move mandatory.
    expect(block).not.toContain("onCancel");
  });
});

describe("the development shop tile shows the deck", () => {
  const src = gameSource();

  it("an empty deck reads differently from an unaffordable one", () => {
    // Anchored on the tile's translated name.
    const start = idx(src, "t`Development Card`");
    expect(start).toBeGreaterThan(0);
    // A generous window: the tile carries rationale between its name and the
    // note it builds.
    const block = src.slice(start, start + 1600);
    // The deck's depth reaches the reason ladder, which tells "the deck is
    // empty" apart from "you cannot afford it" (sentence in lib/reachability).
    expect(block).toContain("deck: view.dev_deck_count");
    // A tile that is not refused still says how deep the deck is.
    expect(block).toContain("left in the deck");
  });

  it("the empty deck has a sentence of its own", () => {
    const reach = readFileSync(resolve(process.cwd(), "src/lib/reachability.ts"), "utf8");
    expect(reach).toContain("The development deck is empty.");
  });
});

describe("the wall shop tile asks which city", () => {
  const src = gameSource();

  it("never sends build_wall with an empty payload", () => {
    // `send("build_wall")` with no data makes the engine wall the first
    // unwalled city in board order (engine/knights/decide.go `decideBuildWall`),
    // choosing for the player; the wall decides the discard limit and the
    // barbarians' pillage.
    expect(src).not.toMatch(/send\(\s*["']build_wall["']\s*\)/);
    // Every remaining send names a vertex, whether by shorthand or by key.
    const sends = src.match(/send\(\s*["']build_wall["'][^)]*/g) ?? [];
    expect(sends.length).toBeGreaterThan(0);
    for (const s of sends) expect(s).toMatch(/,\s*\{[^}]*\bv\b/);
  });

  it("the tile routes through wallShopIntent rather than deciding inline", () => {
    // 0 / 1 / 2+ is stated once, in lib/reachability, where it is unit-tested.
    const start = idx(src, 'message: "Wall"');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, start + 1400);
    expect(block).toContain("wallShopIntent(view.legal)");
    expect(block).toContain('setMode("wall")');
    expect(block).toContain('send("build_wall", { v: intent.v })');
  });

  it("wall mode places on the tapped vertex and can be cancelled", () => {
    // The vertex is named explicitly; an empty payload would hand the choice to
    // the engine's board-order fallback. The tap lives in lib/boardTap, where
    // boardTap.test.ts taps it and reads the command back, confirm included.
    expect(boardTapSource()).toContain('send("build_wall", { v }, { keepMode: true })');
    const start = idx(src, '{effMode === "wall" && (');
    expect(start).toBeGreaterThan(0);
    const block = src.slice(start, idx(src, "</TargetPrompt>", start));
    // Unlike the robber, walling is a purchase you may back out of.
    expect(block).toContain("onCancel");
  });
});

describe("the over-limit progress prompt offers only moves that exist", () => {
  // 1. "Play a card instead" must be conditional: `decidePlayProgress` needs
  //    your turn, the play phase and the roll, and the usual way over the
  //    4-card limit is a draw on someone else's roll (engine/knights/hooks.go walks
  //    playersFromCurrent), where the engine answers ErrNotYourTurn.
  // 2. Standing the overlay down must be reversible while the hand stays over
  //    the limit (`progressDiscardStood` clears only at four); otherwise an
  //    off-turn stand-down hides the discard picker and stalls the table until
  //    the seat timer (`blocks` holds end-turn for any over-limit seat).
  const src = gameSource();
  const start = idx(
    src,
    "{knightsDiscardProgress && myKnights?.progress && !progressDiscardStood && (",
  );
  const block = src.slice(start, idx(src, "</Overlay>", start));

  it("the overlay exists and is the block under test", () => {
    expect(start).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(200);
  });

  it("the play offer is gated on a card being playable this instant", () => {
    expect(block).toContain("canPlayInstead");
    const offer = idx(block, "Play a card instead");
    expect(offer).toBeGreaterThan(-1);
    expect(block.slice(0, offer)).toContain("{canPlayInstead && (");
  });

  it("the copy does not promise the play when it is unavailable", () => {
    // Both branches must be present.
    expect(block).toContain("only on your own turn after the roll");
  });

  it("the rule is read from lib/reachability, not restated here", () => {
    // Game.tsx must not re-derive turn/phase/roll gating; the dock's tiles and
    // this prompt must answer "playable now?" the same way.
    expect(src).toContain("playableProgressCards(view)");
  });

  it("a dismissed prompt can be brought back", () => {
    // Without this the dismissal is one-way and only the timer ends it.
    const pill = idx(
      src,
      "{knightsDiscardProgress && myKnights?.progress && progressDiscardStood && (",
    );
    expect(pill).toBeGreaterThan(0);
    const body = src.slice(pill, idx(src, "</TargetPrompt>", pill));
    expect(body).toContain("setProgressDiscardStood(false)");
    // It is owed, not offered: no Cancel rung.
    expect(body).not.toContain("onCancel");
  });
});

describe("picking a player shows the player, not a coloured word", () => {
  // Six prompts ask you to choose an opponent: the robber steal, pirate steal
  // and knight chase (sharing `victimPrompt`), the Deserter, the Spy and the
  // Master Merchant. SeatChoice draws the seat's own settlement in its colour,
  // matching how a player is identified on the board.
  const src = gameSource();

  it("no seat-choosing prompt still tints a Button with a seat colour", () => {
    // `colorOf` is still used for swatches and the board, so this is scoped to
    // the Button `fill` prop.
    expect(src).not.toMatch(/fill=\{colorOf\(/);
  });

  const prompts: Record<string, string> = {
    Deserter: '{progressCard === "deserter" && (',
    Spy: '{progressOverlay.kind === "victim" && (',
  };

  for (const [name, marker] of Object.entries(prompts)) {
    it(`${name} draws SeatChoice`, () => {
      const start = idx(src, marker);
      expect(start).toBeGreaterThan(0);
      expect(src.slice(start, start + 1400)).toContain("<SeatChoice");
    });
  }

  it("steal / pirate / chase draws SeatChoice", () => {
    // Its own component (components/game/StealPicker), so hand sizes and the
    // way back can be tested; Game renders it for all three.
    expect(src).toContain("<StealPicker");
    const picker = readFileSync(join(process.cwd(), "src/components/game/StealPicker.tsx"), "utf8");
    expect(picker).toContain("<SeatChoice");
    expect(picker).toContain("<SeatChoiceRow>");
  });

  it("Master Merchant draws SeatChoice", () => {
    // Its own component, so it is found by name.
    const start = idx(src, "function MasterMerchant(");
    expect(start).toBeGreaterThan(0);
    expect(src.slice(start, idx(src, "function MasterMerchantPick", start))).toContain(
      "<SeatChoice",
    );
  });

  it("they share one row component, so the prompts cannot drift apart", () => {
    // Every seat prompt (now including the Fishermen steal, the old boot and
    // the Raiders 7) uses the shared row rather than its own layout. The
    // steal's row lives in StealPicker, asserted above.
    expect((src.match(/<SeatChoiceRow>/g) ?? []).length).toBe(6);
  });

  // Closing a trade is the seventh seat prompt, identifying the opponent by
  // seat rather than a name in a button ("Deal w/ Robin"). It lives in
  // components/game/ActiveOfferCard, where the seat-to-command mapping is
  // tested; this checks the vocabulary stays shared.
  const offerSrc = readFileSync(
    join(process.cwd(), "src/components/game/ActiveOfferCard.tsx"),
    "utf8",
  );

  it("the trade offer's deal row draws SeatChoice", () => {
    expect(offerSrc).toContain("<SeatChoice");
    expect(offerSrc).toContain("<SeatChoiceRow>");
  });

  it("no opponent is named inside a button", () => {
    for (const [where, text] of [
      ["Game.tsx", src],
      ["ActiveOfferCard.tsx", offerSrc],
    ] as const) {
      // Matches the interpolation rather than the words.
      expect(text, `${where} labels a control with an opponent's name`).not.toMatch(/Deal w\/ \{/);
      expect(text, `${where} tints a control with a seat colour`).not.toMatch(/fill=\{colorOf\(/);
    }
  });

  it("the trade offer takes the seat colours it draws from the game screen", () => {
    // Its own palette would drift when a player changes colour, and colourblind
    // mode remaps seats through `colorOf` (lib/colorblind).
    expect(offerSrc).toContain("colorOf: (s: number) => string");
    expect(src).toMatch(/<ActiveOfferCard[\s\S]*?colorOf=\{colorOf\}/);
  });
});

describe("the gold picker builds a hand out of cards", () => {
  // Adding and removing are separate gestures, so one tap never changes
  // meaning at a hidden threshold.
  const src = gameSource();
  const start = idx(src, "function GoldPicker(");
  const block = src.slice(start, idx(src, "function GiveCardsPicker", start));

  it("draws ResCard rather than a tinted button", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("<ResCard");
    expect(block).not.toContain("seatSurface(r.color)");
  });

  it("adding and removing are separate gestures", () => {
    // onClick adds, the count badge removes.
    expect(block).toContain("onBadgeClick");
    expect(block).toMatch(/if \(!canAdd\) return;/);
  });

  it("a full card is dimmed, never disabled", () => {
    // The badge is inside the card's button, and Chrome drops pointer events on
    // a disabled control, so a disabled full card could not be undone. Scoped
    // to the card: the Take button below is disabled until the quota is met.
    const card = block.slice(idx(block, "<ResCard"), idx(block, "/>", idx(block, "<ResCard")));
    expect(card).toContain("dimmed=");
    expect(card).not.toMatch(/\bdisabled=/);
  });

  it("the confirm button reports progress toward the quota", () => {
    expect(block).toContain("Take {total}/{count}");
  });
});

describe("every quota picker speaks the gold picker's vocabulary", () => {
  // Every resource picker uses one gesture: the face adds, the badge removes.
  // Stated per component so a regression names the picker it broke.
  const src = gameSource();
  const region = (from: string, to: string) => {
    const start = idx(src, from);
    expect(start, `${from} not found`).toBeGreaterThan(0);
    const end = idx(src, to, start);
    expect(end, `${to} not found after ${from}`).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  // [component, start marker, end marker, confirm label]
  const pickers: [string, string, string, string][] = [
    ["Year of Plenty", "function YopPicker(", "// Current turn's roll", "Take {total}/2"],
    ["Wedding give", "function GiveCardsPicker(", "const RES_NAMES = [", "Give {total}/{target}"],
    [
      "Master Merchant",
      "function MasterMerchantPick(",
      "// CommercialHarbor:",
      "Take {total}/{need}",
    ],
  ];

  for (const [name, from, to, label] of pickers) {
    const block = () => region(from, to);

    it(`${name} draws ResCard, not a tinted button`, () => {
      expect(block()).toContain("<ResCard");
      expect(block()).not.toContain("seatSurface(");
    });

    it(`${name} adds with the face and removes with the badge`, () => {
      const b = block();
      expect(b).toContain("onBadgeClick");
      // The add path is guarded rather than wrapping round to a decrement.
      expect(b).toMatch(/if \(!canAdd\) return;/);
    });

    it(`${name} never disables a card`, () => {
      // The badge is inside the card's button and Chrome drops pointer events
      // on a disabled control, so a disabled full card cannot be undone. Scoped
      // to the cards; the confirm button is disabled until the quota is met.
      for (const m of block().matchAll(/<ResCard[\s\S]*?\/>/g)) {
        expect(m[0], `${name} disables a ResCard`).not.toMatch(/\bdisabled=/);
        expect(m[0], `${name} has a card with no dimmed state`).toMatch(/dimmed=/);
      }
    });

    it(`${name} reports progress toward its quota on the confirm button`, () => {
      expect(block()).toContain(label);
    });
  }

  it("the Commercial Harbor taker rows draw cards, selected not counted", () => {
    // A one-of-N choice per opponent: card and ring, but no badge or quota.
    // Its responder side already draws ResCard, so both halves match.
    const block = region("function CommercialHarbor(", "function TradingHouse(");
    expect(block).toContain("<ResCard");
    expect(block).not.toContain("seatSurface(");
    expect(block).toContain("selected={chosen(s) === r.idx}");
    // A radio has nothing to give back, so it must not grow a remove gesture.
    expect(block).not.toContain("onBadgeClick");
  });

  it("no picker overlay is left tinting a button with a card colour", () => {
    // `seatSurface` survives for seat swatches elsewhere, but a resource or
    // commodity must not wear it in place of its own face.
    for (const [name, from, to] of [
      ...pickers.map(([n, f, t]) => [n, f, t] as const),
      ["Commercial Harbor", "function CommercialHarbor(", "function TradingHouse("] as const,
      ["Gold", "function GoldPicker(", "function GiveCardsPicker("] as const,
    ]) {
      expect(region(from, to), `${name} tints a button`).not.toMatch(/seatSurface\([rc]\.color\)/);
    }
  });
});

describe("naming a resource or commodity is picking its card", () => {
  // Resource Monopoly, Trade Monopoly and the Merchant Fleet share one block
  // keyed off `ProgressInputKind` (res / com / resorcom, lib/progressCards);
  // the Trading House has a give row and a take row.
  //
  // The Aqueduct is the reference shape: one flex-wrap row of `lg` ResCards, a
  // tip naming the consequence rather than the card, and the click as the
  // commit.
  const src = gameSource();
  const region = (from: string, to: string) => {
    const start = idx(src, from);
    expect(start, `${from} not found`).toBeGreaterThan(0);
    const end = idx(src, to, start);
    expect(end, `${to} not found after ${from}`).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  const blocks: Record<string, [string, string]> = {
    // [start marker, end marker): the end is whatever renders next.
    "Resource Monopoly and Merchant Fleet": [
      '{(progressOverlay.kind === "res" ||',
      '{progressOverlay.kind === "com" && (',
    ],
    "Trade Monopoly": ['{progressOverlay.kind === "com" && (', "{/* No `track` branch here"],
    "Trading House": ["function TradingHouse(", "function GoldPicker("],
  };

  for (const [name, [from, to]] of Object.entries(blocks)) {
    it(`${name} renders ResCard`, () => {
      expect(region(from, to)).toContain("<ResCard");
    });

    it(`${name} does not name a card on a bare Button`, () => {
      // A Button tinted with the card's colour standing in for the card, or the
      // Trading House's variant with the colour on the style prop.
      const block = region(from, to);
      expect(block).not.toMatch(/fill=\{[rc]\.color\}/);
      expect(block).not.toMatch(/background: [rc]\.color/);
    });

    it(`${name} is a one-of-N pick, with no quota gesture`, () => {
      // These commit on click and count up to nothing, so a remove badge would
      // do nothing.
      expect(region(from, to)).not.toContain("onBadgeClick");
    });

    it(`${name} lays the cards out the way the Aqueduct does`, () => {
      // The reference row: one wrapping line of full-size cards. A picker with
      // its own container or card size is drift.
      const block = region(from, to);
      expect(block).toContain('className="flex gap-2 justify-center flex-wrap"');
      for (const m of block.matchAll(/<ResCard[\s\S]*?\/>/g)) {
        expect(m[0], `${name} draws a card at the wrong size`).toContain('size="lg"');
        expect(m[0], `${name} has a card with no tip`).toMatch(/title=/);
      }
    });
  }

  it("the tip on a named card says what naming it does", () => {
    // The tip is "Take a Wood", not "Wood": the card under the pointer is
    // already visible. These three use the answer differently, so the sentence
    // comes from the card.
    const tip = src.slice(idx(src, "function nameCardTip("));
    const body = tip.slice(0, idx(tip, "\n}"));
    for (const card of ["resource_monopoly", "trade_monopoly", "merchant_fleet"]) {
      expect(body, `${card} has no tip of its own`).toContain(`case "${card}":`);
    }
    // Total, so a new res/com/resorcom card cannot fall through to undefined.
    expect(body).toContain("default:");
  });

  it("a named card is never dimmed on a guess", () => {
    // Unlike the Aqueduct, no disabled state: the bank is on the view, but what
    // a monopoly catches is in opponents' redacted hands.
    for (const [from, to] of [
      ['{(progressOverlay.kind === "res" ||', '{progressOverlay.kind === "com" && ('],
      ['{progressOverlay.kind === "com" && (', "{/* No `track` branch here"],
    ]) {
      const block = region(from, to);
      for (const m of block.matchAll(/<ResCard[\s\S]*?\/>/g)) {
        expect(m[0]).not.toMatch(/\bdisabled=/);
        expect(m[0]).not.toMatch(/\bdimmed=/);
      }
    }
  });

  it("the Merchant Fleet offers commodities beside its resources", () => {
    // `resorcom` names one good of either kind, so the two rows are one row,
    // via the shared res branch.
    const block = region(
      '{(progressOverlay.kind === "res" ||',
      '{progressOverlay.kind === "com" && (',
    );
    expect(block).toContain('progressOverlay.kind === "resorcom" &&');
    expect(block).toContain("comIconSlot(c.idx)");
    expect(block).toContain("resIconSlot(r.idx)");
  });

  it("the Trading House shows what you hold on the side that spends it", () => {
    // You must hold 2 to give, so the give row shows counts, zero included. The
    // take row draws from the bank and carries no count.
    const block = region("function TradingHouse(", "function GoldPicker(");
    const give = block.slice(idx(block, "Give 2 of"), idx(block, "Take 1"));
    const take = block.slice(idx(block, "Take 1"));
    expect(give).toContain('countMode="always"');
    expect(give).toContain("selected={give === c.idx}");
    expect(give).toMatch(/disabled=\{!canGive/);
    expect(give).toMatch(/dimmed=\{!canGive/);
    expect(take).not.toContain("countMode");
  });
});

describe("the Crane is bought where every other improvement is bought", () => {
  // The Crane buys a level on one of the three city-improvement tracks, one
  // commodity cheaper. Playing it arms the dock's upgrade tiles (with their
  // props, level pips, reward line and commodity-card price) instead of
  // opening an overlay. This guards the wiring: armed, discounted price, the
  // card rather than the paid buy.
  const src = gameSource();

  it("has no track overlay", () => {
    // The Crane was the only `track` input kind.
    expect(src).not.toContain('progressOverlay.kind === "track"');
  });

  it("arms the tiles rather than opening a dialog", () => {
    const body = src.slice(idx(src, "function playProgress("));
    const fn = body.slice(0, idx(body, "\n  }"));
    expect(fn).toContain('card === "crane"');
    expect(fn).toContain('setProgressCard("crane")');
    // No board mode: the card names a track, not a spot.
    const crane = fn.slice(idx(fn, 'card === "crane"'));
    expect(crane.slice(0, idx(crane, "} else"))).not.toContain("setMode(");
  });

  it("prices the armed tiles at the discount, and gates them on it", () => {
    // Matched without pinning indentation, so wrapping the shelf in another
    // div does not slice an empty string.
    const at = src.search(/\{knights &&\s*\n\s*TRACK_ROW\.map/);
    expect(at).toBeGreaterThan(-1);
    const row = src.slice(at);
    const end = idx(row, "{/* Cards in hand");
    expect(end).toBeGreaterThan(-1);
    const tile = row.slice(0, end);
    // One cost expression taking the discount from the armed flag, so the tile
    // matches what the click charges.
    expect(tile).toContain("improvementCost(lvl, craneArmed)");
    // The armed tile's legality is craneTracks (the engine's structural set at
    // the discounted price), not the paid buy's tests.
    expect(tile).toContain("craneLegalTracks.includes(i)");
    // A Crane to level 1 costs nothing, and `countMode="multi"` hides a 1, so a
    // zero-count card would read as "one paper". It says FREE instead.
    expect(tile).toContain("cost === 0");
    // The click sends the card, and disarms.
    expect(tile).toContain('send("play_progress", { card: "crane", track: i })');
    expect(tile).toContain("setProgressCard(null)");
    // A track that cannot be taken says why in the tile's popover, armed or
    // not (the paid buy is refused by the same rules).
    expect(tile).toContain("improvementBlockReason(i, view, craneArmed)");
  });

  it("says on screen that a Crane is waiting, and offers a way out", () => {
    // The lit tiles say where to answer; the pill keeps an armed Crane visible
    // if the dock scrolls.
    const pill = src.slice(idx(src, "{craneArmed && voluntaryOpen && ("));
    expect(pill.slice(0, 400)).toContain("<TargetPrompt");
    expect(pill.slice(0, 400)).toContain("onCancel={() => setProgressCard(null)}");
  });

  it("backs out on Escape with the other armed progress cards", () => {
    // `craneArmed` derives from `progressCard`, which the ladder already
    // clears, so one rung covers it.
    expect(src).toContain('const craneArmed = progressCard === "crane"');
  });
});

describe("touch placement goes through the standard action menu", () => {
  const src = gameSource();

  // Tapping a spot opens its action menu, which an armed or forced mode has
  // narrowed to one entry; there is no separate yes/no prompt.
  it("has no separate placement prompt", () => {
    expect(src).not.toContain("PlaceConfirm");
    expect(src).not.toContain("pendingPlace");
  });

  it("a committing tap opens the menu on a pointer with no hover", () => {
    const at = idx(src, "const placeOrAsk");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 700);
    // Hover places outright; no hover hands the spot to the menu.
    expect(block).toContain("!noHover");
    expect(block).toContain("setInspectAt");
  });

  it("every board vertex and edge tap routes through lib/boardTap", () => {
    // Armed taps go through lib/boardTap, whose test taps every mode. This
    // holds that the screen hands its taps to it rather than branching itself:
    // an armed entry goes to the one-entry confirm (`hexOrAsk`), and only the
    // setup roster to `placeOrAsk`.
    for (const [handler, fn] of [
      ["onVertex: (v, at) =>", "vertexTap(v, boardTapCtx)"],
      ["onEdge: (e, at) =>", "edgeTap(e, boardTapCtx)"],
    ] as const) {
      const at = idx(src, handler);
      const body = src.slice(at, idx(src, "}),", at));
      expect(body, handler).toContain(`routeTap(${fn}, noHover, {`);
      expect(body, handler).toMatch(/confirm: \(entry, run\) => hexOrAsk\(entry, at, run\)/);
      expect(body, handler).toMatch(/roster: \(run\) => placeOrAsk\(/);
      expect(body, handler).not.toContain("send(");
    }
  });

  it("an intermediate pick is not sent to the menu", () => {
    // The Inventor's first hex is a choice within a step, not the step.
    const inv = idx(src, 'effMode === "inventor1"');
    expect(inv).toBeGreaterThan(0);
    const block = src.slice(inv, idx(src, "} else if", inv));
    expect(block).toContain("setInventorA(h)");
    expect(block).not.toContain("ask(");
  });
});

describe("inspect is unlit, on every pointer", () => {
  const src = gameSource();

  // Targets are not lit at rest for no-hover pointers: inspect's target set is
  // every spot the hand can pay for, which is noise keyed to the wallet.
  it("the only gate is the viewer's own setting", () => {
    const at = idx(src, "markerStyle:");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 200);
    expect(block).toContain("!placementMarks");
    expect(block).toContain('=== "inspect" ? "none" : "pedestal"');
    // No pointer-dependent branch, and no ambient brightness.
    expect(block).not.toContain("noHover");
  });

  it("has no ambient resting brightness", () => {
    expect(src).not.toContain("REST_AMBIENT");
    expect(src).not.toContain("restingMarkers:");
  });
});

describe("the viewer-keyed prompts are gated on acting, not on holding a seat", () => {
  const src = gameSource();

  // Leaving to spectate keeps the seat, so `view.viewer` is still the seat and
  // the server keeps sending its private view. `actorSeat` collapses to -1 when
  // a bot has the seat, and every owed action is keyed by seat index.
  //
  // Spy and the Master Merchant look are keyed to the viewer, with no seat
  // index to filter on, so they would show the victim's hand to the spectating
  // owner over a pick the server refuses (game.ErrSeatBotControlled). The
  // server withholds both from a bot-held seat; this is a second lock for a
  // stale frame.
  for (const field of ["spy", "master_merchant"]) {
    it(`renders the ${field} look only for a seat this client is playing`, () => {
      const at = idx(src, `knState?.${field} && (`);
      expect(at).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, at - 20), at)).toContain("actorSeat >= 0 &&");
    });
  }
});

describe("the Escape ladder's camel rung is wired", () => {
  // `camelOpenRef` is read by the Escape ladder but written far below, where
  // `camelRoleNow` is derived. A ref that is declared and read but never
  // assigned compiles fine and stays null, so the rung never fires and Escape
  // over a camel panel disarms the build mode beneath it instead.
  const src = gameSource();

  it("camelOpenRef is assigned, not merely declared and read", () => {
    expect(src).toMatch(/camelOpenRef\.current\s*=[^=]/);
  });

  it("the write reads the open panel and the stood-down flag", () => {
    // Standing a panel down (`camelStood`) leaves a reopen pill, not an
    // overlay; ignoring it would make Escape swallow a keypress for a panel
    // that is not on screen.
    const at = src.search(/camelOpenRef\.current\s*=[^=]/);
    const write = src.slice(at, idx(src, ";", at));
    expect(write).toContain("camelRoleNow");
    expect(write).toContain("camelStood");
  });
});

describe("the Fishermen panels die with the turn, not with the seat", () => {
  // Fish spends and the boot go through the engine's RequireActionableTurn,
  // so they are mid-turn decisions. Keyed on `actingNow` (seat occupancy), a
  // turn lost to the timer would leave the spend panel and an armed
  // `fishPending` mode live over the next player's turn, sending refused
  // commands.
  const src = gameSource();
  const turnLoss = (() => {
    const eff = src.slice(idx(src, "if (myTurnNow) return;"));
    return eff.slice(0, idx(eff, "}, [myTurnNow]);"));
  })();
  const seatLoss = (() => {
    const eff = src.slice(idx(src, "if (actingNow) return;"));
    return eff.slice(0, idx(eff, "}, [actingNow]);"));
  })();

  for (const [setter, what] of [
    ["setFishPanel(false)", "the spend panel"],
    ["setFishPending(null)", "an armed spend"],
    ["setBootPrompt(false)", "the boot prompt"],
  ]) {
    it(`the turn-loss effect clears ${what}`, () => {
      expect(turnLoss.length).toBeGreaterThan(0);
      expect(turnLoss).toContain(setter);
    });

    it(`the seat-loss effect does not clear ${what}`, () => {
      // A copy there would mask a regression in the turn-loss effect.
      expect(seatLoss.length).toBeGreaterThan(0);
      expect(seatLoss).not.toContain(setter);
    });
  }
});

describe("the fish panel does not sell what the bank cannot deliver", () => {
  it("the 7-fish draw is gated on a non-empty dev deck", () => {
    // `fishOffers` filters the draw on `hasDevCards`, a ruleset question that
    // does not know the running count. The engine refuses an empty deck
    // (ErrDeckEmpty), and the shop tile reads `view.dev_deck_count` (see
    // canBuyDev).
    const src = gameSource();
    const at = idx(src, "const fishSpends =");
    expect(at).toBeGreaterThan(0);
    const decl = src.slice(at, idx(src, "const fishRange", at));
    expect(decl).toContain("dev_card");
    expect(decl).toContain("dev_deck_count");
  });

  it("passes the build gate to fishOffers", () => {
    // `legal.roads` reaches only the seat on turn, and `legal` is omitted when
    // every list is empty (game/views.go). `canBuild` tells off-turn from
    // boxed-in, so the 5-fish road row does not vanish off turn. The filter
    // itself lives in lib/fish and is unit-tested there.
    const src = gameSource();
    const at = idx(src, "const fishSpends =");
    const decl = src.slice(at, idx(src, "const fishRange", at));
    expect(decl).toMatch(/fishOffers\(view, fishCaps, fishMix, !!canBuild\)/);
  });
});

describe("the Fish shelf tile waits for the roll", () => {
  it("is disabled on canBuild, not on canAct", () => {
    // Both commands the tile leads to (spend_fish, give_boot) require the dice
    // thrown (RequireActionableTurn). `canAct` omits the roll (it exists for
    // Road Building's pre-roll build). `canSpend` carries the roll like
    // `canBuild` but stays open while a Wagons wagon moves, since the two-fish
    // boost is spent mid-move (lib/moduleGates.ts, wagonMovingClosesBuilding).
    const src = gameSource();
    const at = idx(src, 'context: "shelf tile: spend fish (Fishermen)"');
    const tile = src.slice(at, at + 500);
    expect(tile).toContain("disabled={!canSpend}");
    expect(tile).not.toContain("disabled={!canAct}");
    const gate = src.slice(idx(src, "const canSpend ="), idx(src, "const canBuild ="));
    expect(src.slice(idx(src, "const canTurnAction ="), idx(src, "const canSpend ="))).toContain(
      "view.rolled",
    );
    expect(gate).toContain("canTurnAction");
  });
});

describe("the bid panel does not list the viewer as still to answer", () => {
  it("the outstanding list drops the acting seat", () => {
    // `camelPending` is about the table and has no viewer, and the panel shows
    // only to a seat that has not answered, so the viewer must be filtered out
    // of "Still to answer".
    const src = gameSource();
    const at = idx(src, "const camelPendingSeats =");
    expect(at).toBeGreaterThan(0);
    const decl = src.slice(at, idx(src, ";", at));
    expect(decl).toContain("actorSeat");
  });
});

describe('every role="button" in the game screen answers the keyboard', () => {
  // The staged-card pills (the badge that removes one, CommitPill that puts
  // one back) sit inside the card's <button>, so they are spans with a role.
  // A span gets no click from Enter or Space and no focus by default, so each
  // needs a tabIndex and key handling; discarding on a 7 is mandatory and
  // timed.
  const src = gameSource();
  // Every `role="button"` with its opening tag. Line-based because a prop
  // value can hold a `>` (an arrow function); the tag ends at the first line
  // whose only content is `>` or `/>`.
  const lines = src.split("\n");
  // The prop on its own line, not a comment mentioning it; matching anywhere
  // on the line would catch a doc comment and scan past the top of the file.
  const roles = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim() === 'role="button"');

  it("finds the role=button pills", () => {
    expect(roles.length).toBeGreaterThanOrEqual(2);
  });

  for (const [, i] of roles) {
    let from = i;
    while (from > 0 && !lines[from].trimStart().startsWith("<")) from--;
    let to = i;
    while (to < lines.length - 1 && !/^(\/?)>$/.test(lines[to].trim())) to++;
    const el = lines.slice(from, to + 1).join("\n");
    it(`Game.tsx:${i + 1} is focusable and fires from Enter/Space`, () => {
      expect(el).toContain("tabIndex");
      expect(el).toContain("onKeyDown");
    });
  }
});

describe("the 5-fish road is placed on the edge the spend named", () => {
  // The engine answers a free_road spend with a credit (free_roads goes up),
  // not a road, so the screen must remember the clicked edge and send the
  // build itself. The decision lives in lib/fish.fishRoadNext; this holds the
  // wiring: the spend records its edge and command id, and an effect above
  // the loading guards turns the credit into `build_road` for that edge.
  it("records the spend's edge and builds it when the credit lands", () => {
    const src = gameSource();
    // The spend half is in lib/boardTap (tapped by boardTap.test.ts): the edge
    // and command id are handed to `setFishRoad` there.
    const tap = boardTapSource();
    const spend = tap.slice(idx(tap, 'send("spend_fish", { use: "free_road", e })'));
    expect(spend.slice(0, 400)).toMatch(
      /setFishRoad\(\{ e, ref, owed: view\.free_roads \?\? 0 \}\)/,
    );
    const effect = src.slice(idx(src, "fishRoadNext(fishRoad, view, actingNow, fishRoadInFlight)"));
    expect(effect.slice(0, 300)).toMatch(/send\("build_road", \{ e: fishRoad\.e \}/);
    // The effect must sit above the `if (!view) return` guard, like every other
    // top-level hook (Game.hooks.test.ts holds the general rule).
    expect(idx(src, "fishRoadNext(fishRoad, view")).toBeLessThan(
      idx(src, "if (!view) return entryScreen;"),
    );
  });
});

describe("the Raiders wiring", () => {
  const src = gameSource();

  // As with `camelOpenRef`: a ref read by the Escape ladder but never assigned
  // stays null, so the rung never fires.
  it("raidersOpenRef is assigned, not merely declared and read", () => {
    expect(src).toMatch(/raidersOpenRef\.current\s*=[^=]/);
  });

  it("the write reads the open panel and the stood-down flag", () => {
    const at = src.search(/raidersOpenRef\.current\s*=[^=]/);
    const write = src.slice(at, idx(src, ";", at));
    expect(write).toContain("raidersPanelOpen");
    expect(write).toContain("raidersStood");
  });

  // Whose decision it is comes from `ext.pend.seat`, never `view.cur`: a
  // landing interrupts the builder's turn, an Intrigue is answered by its
  // buyer, and the battle sweep hands prisoners to seats not on turn.
  it("reads the pending seat off the wire rather than deriving it", () => {
    const at = idx(src, "const raidersRoleNow");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, idx(src, ";", at))).toContain("raidersRole(view, actorSeat)");
  });

  // A forced Raiders pick sits above the voluntary fish spend and below every
  // core forced step: an interrupt the engine enforces outranks one the
  // player chose to start.
  it("puts the forced pick above the fish spend and the rider move below it", () => {
    // Two statements: the forced steps (`forcedMode`), then the voluntary ones
    // (`effMode`).
    const at = idx(src, "const forcedMode: BuildMode");
    const ladder = src.slice(at, idx(src, "const voluntaryOpen", at));
    expect(ladder.indexOf("raidersPickMode")).toBeGreaterThan(ladder.indexOf("relocating"));
    expect(ladder.indexOf("raidersPickMode")).toBeLessThan(ladder.indexOf("fishMode"));
    expect(ladder.indexOf("riderMoveMode")).toBeGreaterThan(ladder.indexOf("fishMode"));
  });

  // The voluntary panels and a half-finished rider move die with the turn.
  // The forced ones do not: they may be owed by a seat not on turn, the one
  // player the table is waiting for.
  it("clears the voluntary panels on the turn, and never the forced ones", () => {
    const at = idx(src, "setRaidersGold(false);\n    setRaidersRiders(false);");
    expect(at).toBeGreaterThan(0);
    const tail = src.slice(at, idx(src, "}, [myTurnNow]);", at));
    expect(tail).toContain("setRiderFrom(null)");
    expect(tail).not.toContain("setRaidersStood");
  });

  // Only the Swift Rider is optional ("you MAY place one of your riders"), so
  // only it gets a decline; the engine refuses one on a Muster.
  it("offers the decline on the Swift Rider alone", () => {
    const at = idx(src, "raiders_decline");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at - 600, at)).toContain('raidersRoleNow === "raiders_swift"');
  });
});

describe("picking a piece up to move it says so, and can be put back", () => {
  // "Move ship" and a knight's "Move" arm a second step with no other change
  // on screen (the turn chip still says "Build / Trade"), so they need a
  // visible prompt and a way back besides Escape.
  const src = gameSource();

  for (const [mode, from] of [
    ["shipmove", "shipMoveFrom"],
    ["knightmove", "knightMoveFrom"],
  ] as const) {
    it(`${mode} renders a TargetPrompt with a cancel`, () => {
      const start = idx(src, `{effMode === "${mode}" && ${from} && (`);
      const block = src.slice(start, idx(src, "</TargetPrompt>", start));
      expect(block).toContain("<TargetPrompt onCancel={resetMove}>");
    });
  }

  it("the cancel drops both halves of the selection, not only the mode", () => {
    const start = idx(src, "function resetMove() {");
    const body = src.slice(start, idx(src, "}", start));
    expect(body).toContain("setShipMoveFrom(null)");
    expect(body).toContain("setKnightMoveFrom(null)");
    expect(body).toContain('setMode("none")');
  });
});

describe("every two-step edge move hands the board its origin", () => {
  // `ridermove` looks up a rider's reach by its starting edge
  // (lib/boardTargets allowedEdgeKeys), which reaches the board only through
  // `moveFromEdge`. Raiders' `riderFrom` must feed it, or a rider chosen in the
  // panel lights no destination.
  const src = gameSource();
  it("moveFromEdge includes the chosen rider", () => {
    const at = idx(src, "moveFromEdge:");
    const line = src.slice(at, src.indexOf("\n", at));
    expect(line).toContain("riderFrom");
    expect(line).toContain("shipMoveFrom");
    expect(line).toContain("diplomatFrom");
  });
});

describe("the base Development Card tile exists only where the base deck does", () => {
  // Raiders and Explorers remove the base deck (NoDevCards), but the server
  // still reports its depth, so the tile must not key on `dev_deck_count`
  // alone.
  const src = gameSource();
  it("is gated on the ruleset's hasDevCards cap", () => {
    expect(src).toMatch(/const hasBaseDeck = rulesetCaps\(view\.config\.ruleset\)\.hasDevCards;/);
    const tile = idx(src, "name={t`Development Card`}");
    const before = src.slice(Math.max(0, tile - 900), tile);
    expect(before).toContain("{hasBaseDeck && (");
    expect(src).toMatch(/const canBuyDev = hasBaseDeck && /);
  });
});

describe("Explorers' own setup draft arms the board", () => {
  // Explorers owns its setup (engine Hooks.OwnsSetup): a harbour settlement,
  // then a settlement, then a road and a settler-loaded ship. The base board
  // mode would read the empty legal.settlements in round one and light nothing
  // in round three.
  const src = gameSource();
  it("arms harbour, then road and ship, during setup", () => {
    // Which round is the harbour one is lib/explorers' `explorersSetupStep`
    // (tested there); this pins that the screen arms from it.
    expect(src).toMatch(
      /const explorersStep = isExplorers\(view\) \? explorersSetupStep\(view\) : null;/,
    );
    expect(src).toMatch(/const explorersHarbourSetup = explorersStep === "harbour";/);
    expect(src).toMatch(/const explorersStartSetup = explorersStep === "start";/);
    const at = idx(src, "const setupMode: BuildMode =");
    const block = src.slice(at, at + 400);
    expect(block).toMatch(/explorersHarbourSetup\s*\?\s*"harbour"/);
    expect(block).toMatch(/explorersStartSetup\s*\?\s*explorersRoad\s*\?\s*"ship"\s*:\s*"road"/);
  });
  it("hides the City tile unless Knights hands cities back", () => {
    expect(src).toContain("{!(isExplorers(view) && !knights) && (");
  });
});

describe("Explorers ships reach the board and stay chosen", () => {
  const src = gameSource();
  it("hands the chosen ship and job to the board", () => {
    expect(src).toContain("moveFromShip: explorersShip,");
    expect(src).toContain("shipJob: explorersJob,");
  });
  it("keeps the ship armed after a step", () => {
    // The tap is in lib/boardTap (and tapped by its test).
    expect(boardTapSource()).toMatch(
      /send\("explorers_move_ship", \{ ship_id: ship, path: \[e\] \}, \{ keepMode: true \}\)/,
    );
  });
});

describe("the Explorers pirate ship is placed by the player who rolled the 7", () => {
  const src = gameSource();
  it("forces the pirate hex mode while the move is owed", () => {
    expect(src).toContain("const explorersPirate = explorersPirateOwed(view, actorSeat);");
    const at = idx(src, "const forcedMode: BuildMode = takenOver");
    expect(src.slice(at, at + 300)).toMatch(/explorersPirate\s*\?\s*"pirate"/);
    expect(src).toMatch(/send\(\s*"explorers_move_pirate"/);
  });
});

describe("hand-lane hints and the discard box", () => {
  const src = gameSource();

  // Empty-lane hints are standalone sentences: they start with a capital and
  // name no input device.
  it("no lane hint starts lowercase or says tap", () => {
    expect(src).not.toMatch(/<Trans>tap /);
    expect(src).toContain("<Trans>Choose cards from your hand below.</Trans>");
  });

  // A content-sized discard box grows as cards are picked, sliding the row
  // under the finger.
  it("the discard box has a fixed width, capped at the viewport", () => {
    const at = src.indexOf("Discard box: opens above the hand");
    expect(at).toBeGreaterThan(0);
    const box = src.slice(at, at + 1600);
    expect(box).toMatch(/w-\[26rem\] max-w-\[calc\(100vw/);
  });
});

describe("the steal picker closes when the server moves the robber", () => {
  // The picker is local state between choosing a hex and choosing a victim.
  // If the move timer expires and the server moves the robber, the effect
  // keyed on robber_pending closes it; otherwise it offers a refused steal.
  const src = gameSource();
  it("clears victimPrompt when robber_pending ends", () => {
    const at = idx(src, "victimPromptStale(p, !!sock.full?.robber_pending)");
    const tail = src.slice(at, idx(src, "}, [sock.full?.robber_pending]);", at));
    expect(tail).not.toContain("React.useEffect");
    expect(src.slice(at - 200, at)).toContain("setVictimPrompt(");
  });
});
