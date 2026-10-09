// Gallery section: expansions. Every UI element that exists only because of an
// expansion module (Knights, Islands, Fishermen, Caravans, Harbormaster,
// Rivers, Raiders, Wagons, Explorers) and is NOT already shown by the hud, game
// or site sections, drawn by the real components. See ../spec.tsx.
//
// Already covered elsewhere, so not repeated here: the module panels (camels,
// explorers, fish, raiders, rivers, wagons), ScenarioDialog's shell, the
// Knights shop tiles, the deck choice tiles, the barbarian rail, the player
// card's module variants, the module glyphs, TrackPips, the event die faces,
// PieceArt at one size, and the ExpansionCard / ExpansionShelf samples.
//
// What this section adds:
//  - every progress card, per deck (tile, face, picker, title plate, sheet);
//  - every expansion good (commodities, gold, fish, boot, rivercoin, spice,
//    marble, glass, sand, tools) at every size, plus its card-sized art;
//  - every expansion event the log can describe, one State per sentence, drawn
//    by the real EventLogFeed;
//  - the post-game scoreboard (overview and details) per expansion;
//  - ruleset badges, filter pills and the expansion shelf per module;
//  - map previews per expansion board (fixtures, the framed Islands gallery,
//    and boards dealt by the real /api/preview).
import * as React from "react";
import { Group, State, Break } from "../spec";

import { EventLogFeed } from "@/routes/Game";
import { CardSheet } from "@/components/game/CardSheet";
import { ProgressCardChoice } from "@/components/game/ProgressCardChoice";
import { CardToken } from "@/components/game/LogLine";
import { PieceArt, type ArtPiece } from "@/components/game/PieceIcon";
import { PostGameScoreboard } from "@/components/game/PostGameScoreboard";
import { Icons } from "@/components/game/hudIcons";
import { Glyph } from "@/components/game/moduleUi";
import { MapPreview } from "@/components/board/MapPreview";
import { CardFace, GoodIcon, ResIcon } from "@/components/asset/AssetParts";
import { CardTitlePlate } from "@/components/asset/CardTitlePlate";
import { ExpansionShelf } from "@/components/lobby/ExpansionShelf";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";

import type { GameEvent } from "@/lib/gamestate";
import { usePieceIcons } from "@/lib/usePieceIcons";
import { seatColor } from "@/lib/hexgeo";
import { COMMOD, comIconSlot } from "@/lib/cardFace";
import { cardArtSlot } from "@/lib/resourceArt";
import {
  PROGRESS_DECKS,
  PROGRESS_DECK_LOOK,
  progressCardHint,
  progressCardName,
  progressDeckCards,
  progressDeckLook,
  progressSlot,
  type ProgressDeck,
} from "@/lib/progressCards";
import { rulesetCaps } from "@/lib/caps";
import {
  EXPANSION_MODULE,
  FILTER_MODULES,
  moduleColor,
  moduleLabel,
  rulesetLabel,
  rulesetTags,
  type Expansions,
} from "@/lib/format";
import { fullLandBoard, GALLERY } from "@/lib/maps/gallery";
import { loadFramedGallery } from "@/lib/maps/framed-gallery";
import { api } from "@/lib/api";
import { previewView as basePreview } from "@/lib/board3d/previewFixture";
import all4Json from "@/lib/__fixtures__/scenarioAll4View.json";
import knightsRiversJson from "@/lib/__fixtures__/scenarioKnightsRiversView.json";
import previewBoardJson from "@/lib/__fixtures__/previewBoard.json";
import { cn } from "@/lib/utils";
import type { Board, BoardTile, PlayerStat, VPBreakdown } from "@/lib/types";

export const title = "Expansions";

// ---------------------------------------------------------------------------
// Harness (copied from the game section's patterns)
// ---------------------------------------------------------------------------

const NAMES = ["Mara", "Teo", "Ines", "Bram", "Lio", "Sanne", "Odile", "Pim"];
const seatName = (s: number) => NAMES[s] ?? `Seat ${s + 1}`;
const colorOf = (s: number) => seatColor(s);
const SEAT_COLORS = [0, 1, 2, 3].map(colorOf);
const noop = () => {};

/**
 * A sized, clipped stage. `translateZ(0)` makes it the containing block for
 * fixed-position descendants (CardSheet's dim and panel).
 */
function Box({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        overflow: "hidden",
        transform: "translateZ(0)",
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

/** Point `document.body` at `target` while `f` runs (a render that portals). */
function inBody<T>(target: HTMLElement, f: () => T): T {
  Object.defineProperty(document, "body", { configurable: true, get: () => target });
  try {
    return f();
  } finally {
    Reflect.deleteProperty(document, "body");
  }
}

/** Renders a component that portals to `document.body` with its portal landing here. */
function Captured({ render }: { render: () => React.ReactNode }) {
  const [target] = React.useState(() => {
    const d = document.createElement("div");
    d.style.display = "contents";
    return d;
  });
  const host = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    host.current?.appendChild(target);
  }, [target]);
  const out = inBody(target, render);
  return <div ref={host}>{out}</div>;
}

/** Runs `run` once against the rendered subtree after mount (a click). */
function Drive({
  run,
  delay = 80,
  children,
}: {
  run: (el: HTMLElement) => void;
  delay?: number;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    done.current = true;
    window.setTimeout(() => {
      if (ref.current) run(ref.current);
    }, delay);
  }, [run, delay]);
  return <div ref={ref}>{children}</div>;
}

const clickDetailsTab = (el: HTMLElement) =>
  el.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click();

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function Section() {
  // CardSheet focuses its panel on mount; once that has settled, drop focus so
  // no ring is left behind, and put the page back at the top.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo(0, 0);
    }, 900);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <>
      <LobbyGroups />
      <GoodsGroups />
      <KnightsCardGroups />
      <PieceGroups />
      <LogGroups />
      <PostGameGroups />
      <MapGroups />
    </>
  );
}

// ===========================================================================
// Lobby: ruleset badges, filter pills, the shelf per module
// ===========================================================================

const RULESETS = [
  "base",
  "base+cak",
  "base+islands",
  "base+fishermen",
  "base+caravans",
  "base+harbormaster",
  "base+rivers",
  "base+raiders",
  "base+wagons",
  "explorers",
  "base+cak+islands",
  "base+cak+fishermen+rivers",
  "base+caravans+fishermen+harbormaster+rivers",
  "base+caravans+fishermen+raiders+rivers+wagons",
  "cak+explorers",
  "base+cak+raiders",
  "base+future_module",
];

function RulesetBadges({ ruleset, label }: { ruleset: string; label?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {rulesetTags(ruleset).map((tag) => (
        <Badge
          key={tag.label}
          tone="ruleset"
          type={label ? "label" : undefined}
          size="xs"
          style={{ "--badge-fill": tag.bg } as React.CSSProperties}
        >
          {tag.label}
        </Badge>
      ))}
    </span>
  );
}

const NO_EXP: Expansions = {
  islands: false,
  knights: false,
  fishermen: false,
  caravans: false,
  harbormaster: false,
  rivers: false,
  raiders: false,
  wagons: false,
  explorers: false,
};

function ShelfDemo({ initial }: { initial: Partial<Expansions> }) {
  const [exp, setExp] = React.useState<Expansions>({ ...NO_EXP, ...initial });
  return (
    <div className="w-95 flex flex-col gap-2.5">
      <ExpansionShelf
        exp={exp}
        onToggle={(k, on) => setExp((e) => ({ ...e, [k]: !on }))}
        disabled={false}
      />
    </div>
  );
}

function FilterPill({ m, active }: { m: string; active: boolean }) {
  return (
    <Pill interactive size="md" tone={active ? "active" : "neutral"} aria-pressed={active}>
      <span
        aria-hidden
        className="size-2 rounded-full shrink-0 bg-(--swatch)"
        style={{ "--swatch": moduleColor(m) } as React.CSSProperties}
      />
      {moduleLabel(m)}
    </Pill>
  );
}

function LobbyGroups() {
  return (
    <>
      <Group
        id="expansions/ruleset-badges"
        title="Ruleset badges (rulesetTags + Badge tone=ruleset): every module and common combinations"
        wide
      >
        {RULESETS.map((r) => (
          <State key={r} label={r}>
            <RulesetBadges ruleset={r} />
          </State>
        ))}
        <Break />
        {RULESETS.slice(0, 10).map((r) => (
          <State key={`l-${r}`} label={`type=label (table browser): ${r}`}>
            <RulesetBadges ruleset={r} label />
          </State>
        ))}
      </Group>

      <Group
        id="expansions/ruleset-badges-ground"
        title="Ruleset badges on the page ground"
        surface="ground"
        wide
      >
        {RULESETS.slice(0, 10).map((r) => (
          <State key={r} label={r}>
            <RulesetBadges ruleset={r} />
          </State>
        ))}
      </Group>

      <Group
        id="expansions/ruleset-label"
        title="rulesetLabel (the ruleset as one line of text)"
        wide
      >
        {RULESETS.map((r) => (
          <State key={r} label={r}>
            <span className="text-[14px] font-semibold text-foreground">{rulesetLabel(r)}</span>
          </State>
        ))}
      </Group>

      <Group
        id="expansions/module-filter-pills"
        title="Table browser module filters (Pill + module colour dot), every module"
        wide
      >
        {FILTER_MODULES.map((m) => (
          <State key={m} label={`${m}: off`}>
            <FilterPill m={m} active={false} />
          </State>
        ))}
        <Break />
        {FILTER_MODULES.map((m) => (
          <State key={`a-${m}`} label={`${m}: on`}>
            <FilterPill m={m} active />
          </State>
        ))}
        <Break />
        <State label="off: hover" force="hover">
          <FilterPill m="rivers" active={false} />
        </State>
        <State label="off: focus-visible" force="focus-visible">
          <FilterPill m="rivers" active={false} />
        </State>
        <State label="on: hover" force="hover">
          <FilterPill m="raiders" active />
        </State>
        <State label="unknown module (raw key)">
          <FilterPill m="stars" active={false} />
        </State>
      </Group>

      <Group
        id="expansions/shelf-per-module"
        title="ExpansionShelf with each module switched on alone (its conflicts and warnings)"
        wide
      >
        {(Object.keys(EXPANSION_MODULE) as (keyof Expansions)[]).map((k) => (
          <State key={k} label={`${k} on`}>
            <ShelfDemo initial={{ [k]: true }} />
          </State>
        ))}
        <State label="both core expansions on">
          <ShelfDemo initial={{ knights: true, islands: true }} />
        </State>
        <State label="four compatible scenarios on">
          <ShelfDemo
            initial={{ fishermen: true, caravans: true, harbormaster: true, rivers: true }}
          />
        </State>
      </Group>
    </>
  );
}

// ===========================================================================
// Goods: commodities and scenario goods at every size
// ===========================================================================

const GOODS = [
  "gold",
  "fish",
  "boot",
  "rivercoin",
  "spice",
  "marble",
  "glass",
  "sand",
  "tools",
] as const;
type Good = (typeof GOODS)[number];
const GOOD_OWNER: Record<Good, string> = {
  gold: "Islands, Raiders, Wagons, Explorers",
  fish: "Fishermen",
  boot: "Fishermen",
  rivercoin: "Rivers",
  spice: "Caravans, Explorers",
  marble: "Wagons",
  glass: "Wagons",
  sand: "Wagons",
  tools: "Wagons",
};
type SizedIcon = React.ComponentType<{ size?: number }>;
const GOOD_GLYPH: Partial<Record<Good, SizedIcon>> = {
  gold: Icons.gold as SizedIcon,
  fish: Icons.fish as SizedIcon,
  boot: Icons.boot as SizedIcon,
  rivercoin: Icons.coin as SizedIcon,
};
const SIZES = [12, 16, 20, 24, 32, 48, 64];

function goodFallback(g: Good, size: number) {
  const G = GOOD_GLYPH[g];
  return G ? (
    <span className="text-foreground">
      <G size={size} />
    </span>
  ) : g === "spice" ? (
    <span className="text-foreground">
      <Glyph name="spice" size={size} />
    </span>
  ) : (
    // WagonPanel passes no fallback for cargo, so in a game this draws nothing.
    <span className="hud-lab text-foreground">no art in pack</span>
  );
}

function GoodsGroups() {
  return (
    <>
      <Group
        id="expansions/good-icons"
        title="Expansion goods (GoodIcon) at every size. No goods art is in this pack, so each shows the fallback its callers pass (HUD glyph; spice: module glyph)"
        surface="hud"
        wide
      >
        {GOODS.map((g) => (
          <React.Fragment key={g}>
            {SIZES.map((s) => (
              <State key={s} label={`${g} ${s}px${s === 12 ? ` (${GOOD_OWNER[g]})` : ""}`}>
                <GoodIcon id={g} size={s} fallback={goodFallback(g, s)} />
              </State>
            ))}
            <Break />
          </React.Fragment>
        ))}
      </Group>

      <Group
        id="expansions/commodity-icons"
        title="Knights commodities (ResIcon) at every size"
        surface="hud"
        wide
      >
        {COMMOD.map((c) => (
          <React.Fragment key={c.key}>
            {SIZES.map((s) => (
              <State key={s} label={`${c.key} ${s}px`}>
                <ResIcon slot={comIconSlot(c.idx)} size={s} />
              </State>
            ))}
            <Break />
          </React.Fragment>
        ))}
      </Group>

      <Group
        id="expansions/good-card-art"
        title="Card-sized art for expansion goods (cardArtSlot; the icon when no card render exists)"
        surface="hud"
        wide
      >
        {[...COMMOD.map((c) => c.key), ...GOODS].map((g) => (
          <State key={g} label={`${g}: ${cardArtSlot(`icon_${g}`)}`}>
            <ResIcon
              slot={cardArtSlot(`icon_${g}`)}
              size={96}
              className="object-contain"
              fallback={<span className="hud-lab text-foreground">no art in pack</span>}
            />
          </State>
        ))}
      </Group>

      <Group
        id="expansions/commodity-tokens"
        title="CardToken for commodities (log and chat): gain, counts, loss"
        surface="hud"
      >
        {COMMOD.map((c) => (
          <React.Fragment key={c.key}>
            <State label={`${c.key}: 1`}>
              <CardToken tok={{ k: "com", idx: c.idx, n: 1 }} />
            </State>
            <State label={`${c.key}: 3`}>
              <CardToken tok={{ k: "com", idx: c.idx, n: 3 }} />
            </State>
            <State label={`${c.key}: lost 2`}>
              <CardToken tok={{ k: "com", idx: c.idx, n: 2, loss: true }} />
            </State>
            <Break />
          </React.Fragment>
        ))}
      </Group>
    </>
  );
}

// ===========================================================================
// Knights: progress cards
// ===========================================================================

const PROGRESS_FRAME =
  "hud-card-frame relative isolate overflow-hidden w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px] flex items-center justify-center text-center bg-panel text-[9px] sm:text-[10px] font-extrabold leading-[1.05] transition-transform";

/** The hand tile, as routes/Game.tsx draws it (copied from the hud section). */
function ProgressTile({ card: id, playable = true }: { card: string; playable?: boolean }) {
  const deck = progressDeckLook(id);
  return (
    <button
      type="button"
      aria-disabled={!playable}
      className={cn(PROGRESS_FRAME, playable ? "hud-lift cursor-pointer" : "cursor-default")}
    >
      {deck && (
        <span
          role="img"
          aria-label={deck.aria}
          className="hud-deck-band"
          style={{ background: deck.color }}
        />
      )}
      <CardFace
        slot={progressSlot(id)}
        className={cn("block h-full w-full", !playable && "grayscale opacity-60")}
      />
    </button>
  );
}

const DECK_TITLE: Record<ProgressDeck, string> = {
  trade: "Trade deck (cloth)",
  politics: "Politics deck (coin)",
  science: "Science deck (paper)",
};

function KnightsCardGroups() {
  return (
    <>
      {PROGRESS_DECKS.map((deck) => (
        <Group
          key={deck}
          id={`expansions/knights-progress-${deck}`}
          title={`${DECK_TITLE[deck]}: every card as its hand tile (deck band) and its full face`}
          surface="hud"
          wide
        >
          {progressDeckCards(deck).map((c) => (
            <State key={c} label={`tile: ${progressCardName(c)}`}>
              <ProgressTile card={c} />
            </State>
          ))}
          <State label="tile: can't play">
            <ProgressTile card={progressDeckCards(deck)[0]} playable={false} />
          </State>
          <Break />
          {progressDeckCards(deck).map((c) => (
            <State key={c} label={`face: ${progressCardName(c)}`}>
              <CardFace
                slot={progressSlot(c)}
                className="hud-card-frame block w-[130px] overflow-hidden"
                fallback={<span className="hud-lab text-foreground">{c}</span>}
              />
            </State>
          ))}
        </Group>
      ))}

      <Group
        id="expansions/knights-deck-bands"
        title="Deck bands (hud-deck-band) alone, per deck"
        surface="hud"
      >
        {PROGRESS_DECKS.map((d) => (
          <State key={d} label={PROGRESS_DECK_LOOK[d].label}>
            <span className={PROGRESS_FRAME}>
              <span
                role="img"
                aria-label={PROGRESS_DECK_LOOK[d].aria}
                className="hud-deck-band"
                style={{ background: PROGRESS_DECK_LOOK[d].color }}
              />
            </span>
          </State>
        ))}
      </Group>

      <Group
        id="expansions/knights-progress-choice"
        title="ProgressCardChoice (Spy, Master Merchant, hand-limit pickers): every card"
        surface="hud"
        wide
      >
        {PROGRESS_DECKS.map((deck) => (
          <React.Fragment key={deck}>
            {progressDeckCards(deck).map((c) => (
              <State key={c} label={progressCardName(c)}>
                <ProgressCardChoice card={c} onSelect={noop} />
              </State>
            ))}
            <Break />
          </React.Fragment>
        ))}
        <State label="active" force="active">
          <ProgressCardChoice card="warlord" onSelect={noop} />
        </State>
      </Group>

      <Group
        id="expansions/knights-title-plates"
        title="CardTitlePlate with every progress card's name (English)"
        surface="hud"
        wide
      >
        {PROGRESS_DECKS.flatMap((d) => progressDeckCards(d)).map((c) => (
          <State key={c} label={c}>
            <span className="relative block w-[120px] aspect-[5/7] overflow-hidden rounded-[8px] bg-ink">
              <CardTitlePlate title={progressCardName(c)} locale="en" />
            </span>
          </State>
        ))}
      </Group>

      <Group
        id="expansions/knights-progress-sheet"
        title="CardSheet (phone card detail) for progress cards"
        surface="hud"
      >
        <State label="playable (Merchant Fleet)">
          <Box w={340} h={580}>
            <Captured
              render={() =>
                CardSheet({
                  slot: progressSlot("merchant_fleet"),
                  title: progressCardName("merchant_fleet"),
                  text: progressCardHint("merchant_fleet"),
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="refused: note replaces the action (Inventor)">
          <Box w={340} h={600}>
            <Captured
              render={() =>
                CardSheet({
                  slot: progressSlot("inventor"),
                  title: progressCardName("inventor"),
                  text: progressCardHint("inventor"),
                  note: "Progress cards are played on your own turn.",
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="futile: warning above the action (Deserter)">
          <Box w={340} h={600}>
            <Captured
              render={() =>
                CardSheet({
                  slot: progressSlot("deserter"),
                  title: progressCardName("deserter"),
                  text: progressCardHint("deserter"),
                  warn: "No opponent has a knight to give up.",
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="never played (Constitution)">
          <Box w={340} h={560}>
            <Captured
              render={() =>
                CardSheet({
                  slot: progressSlot("constitution"),
                  title: progressCardName("constitution"),
                  text: progressCardHint("constitution"),
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
      </Group>
    </>
  );
}

// ===========================================================================
// Expansion pieces at sizes
// ===========================================================================

const EXP_PIECES: [ArtPiece, string][] = [
  ["knight", "Knights, strength 1"],
  ["knight_strong", "Knights, strength 2"],
  ["knight_mighty", "Knights, strength 3"],
  ["wall", "Knights"],
  ["metro_trade", "Knights"],
  ["metro_politics", "Knights"],
  ["metro_science", "Knights"],
  ["ship", "Islands, Explorers"],
  ["bridge", "Rivers"],
];

function PieceGroups() {
  return (
    <Group
      id="expansions/pieces-sizes"
      title="Expansion pieces (PieceArt): knight strengths, wall, metropolises, ship, bridge, at 20/32/56px"
      surface="hud"
      wide
    >
      {EXP_PIECES.map(([p, owner]) => (
        <React.Fragment key={p}>
          {[20, 32, 56].map((s) => (
            <State key={s} label={`${p} ${s}px${s === 20 ? ` (${owner})` : ""}`}>
              <span className="block" style={{ width: s, height: s }}>
                <PieceArt piece={p} color={colorOf(1)} />
              </span>
            </State>
          ))}
        </React.Fragment>
      ))}
    </Group>
  );
}

// ===========================================================================
// Event log lines
// ===========================================================================

let SEQ = 5000;
const E = (type: string, data: unknown): GameEvent => ({ seq: SEQ++, type, data });
type LogCase = [label: string, events: GameEvent[]];
const one = (label: string, type: string, data: unknown): LogCase => [label, [E(type, data)]];

/** A Hand: index 0 unused, then wood, brick, sheep, wheat, ore. */
const H = (...n: number[]) => [0, ...n];

// The preview board's tiles, for the lines that name a hex (Raiders).
const pTiles: BoardTile[] = basePreview.board.tiles;
const numbered = pTiles.filter((t) => t.num > 0);
const hexA = numbered[0].hex;
const hexB = numbered[3].hex;

// ---- Knights ---------------------------------------------------------------

const KNIGHTS_ROLL: LogCase[] = [
  ...(["ship", "trade", "politics", "science"] as const).map(
    (face): LogCase => [
      `roll with event die: ${face}`,
      [E("dice_rolled", { player: 1, d1: 3, d2: 5 }), E("cak_event_die", { face })],
    ],
  ),
  [
    "production with a commodity folded in",
    [
      E("resources_distributed", {
        gains: [
          { player: 0, gain: H(2, 0, 0, 0, 0) },
          { player: 2, gain: H(0, 0, 0, 1, 0) },
        ],
      }),
      E("cak_commodity_adjust", { player: 0, res: "wood", commodity: 1, count: 1, minted: true }),
    ],
  ],
  one("7: the robber stays out of play", "cak_robber_idle", {}),
];

const KNIGHTS_BARB: LogCase[] = [
  one("repelled, sole defender", "cak_barbarian_attack", {
    win: true,
    strength: 6,
    cities: 4,
    defender: 2,
  }),
  one("repelled, tied defenders", "cak_barbarian_attack", {
    win: true,
    strength: 5,
    cities: 5,
    tied_defenders: [0, 3],
  }),
  one("nothing to raid", "cak_barbarian_attack", { win: true, strength: 0, cities: 0 }),
  one("broke through: city lost, city owed", "cak_barbarian_attack", {
    win: false,
    strength: 2,
    cities: 5,
    downgraded: [{ player: 1 }],
    pending_downgrade: [3],
  }),
  one("broke through, no city could be taken", "cak_barbarian_attack", {
    win: false,
    strength: 1,
    cities: 3,
  }),
  one("gave a city", "cak_barbarian_downgraded", { player: 3 }),
  one("no city left (forfeit)", "cak_barbarian_downgraded", { player: 3, forfeit: true }),
  one("bought out with coins (with Rivers)", "cak_pillage_bought_out", { player: 1 }),
  one("toppled city stood back up", "cak_laid_city_restored", { player: 1 }),
];

const KNIGHTS_PIECES_LOG: LogCase[] = [
  one("knight built", "cak_knight_built", { player: 0 }),
  one("knight activated", "cak_knight_activated", { player: 0 }),
  one("knight promoted", "cak_knight_promoted", { player: 0 }),
  one("knight moved", "cak_knight_moved", {
    player: 0,
    from: { q: 0, r: 0, side: 0 },
    to: { q: 1, r: 0, side: 1 },
  }),
  one("knight sent to give chase (in place)", "cak_knight_moved", {
    player: 0,
    from: { q: 0, r: 0, side: 0 },
    to: { q: 0, r: 0, side: 0 },
  }),
  one("knight lost (Deserter)", "cak_knight_removed", { owner: 2 }),
  one("knight removed, owner unknown", "cak_knight_removed", {}),
  one("knight displaced", "cak_knight_displaced", { mover: 1 }),
  one("displaced knight relocated", "cak_knight_relocated", { player: 3 }),
  one("Warlord: 2 knights", "cak_knights_all_active", { player: 1, count: 2 }),
  one("Warlord: 0 knights", "cak_knights_all_active", { player: 1, count: 0 }),
  one("Warlord: older log, no count", "cak_knights_all_active", { player: 1 }),
  one("city wall", "cak_wall_built", { player: 2 }),
  one("merchant placed", "cak_merchant_placed", { player: 2 }),
  ...[0, 1, 2].map((t) =>
    one(`metropolis built, track ${t}`, "cak_metropolis", { track: t, holder: 0 }),
  ),
  ...[0, 1, 2].map((t) =>
    one(`metropolis taken, track ${t}`, "cak_metropolis", { track: t, holder: 1, prev: 0 }),
  ),
  ...[0, 1, 2].map((t) =>
    one(`metropolis pending, track ${t}`, "cak_metropolis_pending", { track: t, holder: 2 }),
  ),
  one("Medicine: cheap city", "cak_cheap_city", { player: 3 }),
  one("Medicine: cheap harbour (with Explorers)", "cak_cheap_harbour", { player: 3 }),
];

const KNIGHTS_PROGRESS_LOG: LogCase[] = [
  one("drew (card shown)", "cak_progress_drawn", { player: 0, card: "alchemist" }),
  ...[0, 1, 2].map((t) =>
    one(`drew (redacted), track ${t}`, "cak_progress_drawn", { player: 1, track: t }),
  ),
  one("discarded (card shown)", "cak_progress_discarded", { player: 0, card: "spy" }),
  ...[0, 1, 2].map((t) =>
    one(`discarded (redacted), track ${t}`, "cak_progress_discarded", { player: 1, track: t }),
  ),
  one("Spy: stole, card shown", "cak_progress_stolen", { thief: 0, victim: 1, card: "bishop" }),
  one("Spy: stole, card hidden", "cak_progress_stolen", { thief: 2, victim: 3 }),
  one("played (card shown)", "cak_progress_played", { player: 2, card: "warlord" }),
  one("played (card unknown)", "cak_progress_played", { player: 2 }),
  ...[0, 1, 2].map((t) =>
    one(`improved track ${t}, paid 3`, "cak_improved", { player: 0, track: t, cost: 3 }),
  ),
  one("improved, free (Crane)", "cak_improved", { player: 0, track: 2, cost: 0 }),
];

const KNIGHTS_TRADE_LOG: LogCase[] = [
  one("Resource Monopoly", "cak_resource_levy", {
    player: 0,
    res: "wheat",
    takes: [
      { player: 1, count: 2 },
      { player: 2, count: 1 },
    ],
  }),
  one("Resource Monopoly, nobody held it", "cak_resource_levy", {
    player: 0,
    res: "ore",
    takes: [],
  }),
  one("Trade Monopoly", "cak_commodity_levy", {
    player: 0,
    commodity: 2,
    takes: [
      { player: 1, count: 1 },
      { player: 3, count: 1 },
    ],
  }),
  one("Trade Monopoly, nobody held it", "cak_commodity_levy", {
    player: 0,
    commodity: 0,
    takes: [],
  }),
  one("commodities discarded on a 7", "cak_commodity_discarded", { player: 1, cards: [1, 0, 2] }),
  one("Bishop: commodity stolen", "cak_commodity_stolen", { thief: 0, victim: 2, com: 1 }),
  one("Master Merchant: took cards", "cak_cards_taken", {
    to: 0,
    from: 3,
    cards: H(0, 1, 0, 1, 0),
    count: 2,
  }),
  one("Master Merchant: count only", "cak_cards_taken", { to: 0, from: 3, count: 2 }),
  one("Wedding: gave cards", "cak_cards_given", {
    from: 2,
    to: 0,
    cards: H(1, 0, 0, 0, 1),
    count: 2,
  }),
  one("commodity taken", "cak_commodity_taken", { to: 1, from: 0, cards: [0, 1, 0], count: 1 }),
  one("Commercial Harbor: both seen", "cak_harbor_given", {
    giver: 1,
    taker: 0,
    res: "sheep",
    com: 0,
  }),
  one("Commercial Harbor: for nothing", "cak_harbor_given", { giver: 1, taker: 0, com: 2 }),
  one("Commercial Harbor: hidden commodity", "cak_harbor_given", {
    giver: 1,
    taker: 0,
    res: "ore",
  }),
  one("Commercial Harbor: hidden, for nothing", "cak_harbor_given", { giver: 1, taker: 0 }),
  one("Merchant Fleet: resource", "cak_merchant_fleet", { player: 2, is_com: false, res: "brick" }),
  one("Merchant Fleet: commodity", "cak_merchant_fleet", { player: 2, is_com: true, com: 1 }),
  one("Merchant Fleet: unknown", "cak_merchant_fleet", { player: 2 }),
  one("Inventor: tokens named", "cak_tokens_swapped", { an: 6, bn: 11 }),
  one("Inventor: older log", "cak_tokens_swapped", {}),
  one("Irrigation / Mining harvest", "cak_harvest", { player: 1, res: "wheat", count: 4 }),
  one("harvest, nothing", "cak_harvest", { player: 1, res: "ore", count: 0 }),
  one("Diplomat: removed another's road", "cak_road_relocated", { player: 0, owner: 2 }),
  one("Diplomat: moved own road", "cak_road_relocated", { player: 0, owner: 0, to: {} }),
  one("Diplomat: removed own road", "cak_road_relocated", { player: 0, owner: 0 }),
  one("Diplomat: owner unknown", "cak_road_relocated", { player: 0 }),
  one("commodity trade with the bank", "cak_commodity_traded", {
    player: 3,
    give_is_com: true,
    give_com: 0,
    give_n: 2,
    get_is_com: false,
    get_res: "ore",
    count: 1,
  }),
  one("basket trade with the bank", "cak_commodity_basket_traded", {
    player: 3,
    spend_res: H(2, 0, 0, 0, 0),
    spend_com: [0, 2, 0],
    get_res: H(0, 0, 0, 1, 1),
    get_com: [0, 0, 0],
  }),
  one("Trading House (Merchant Guild)", "cak_trading_house", {
    player: 3,
    give: 1,
    com_out: true,
    get_com: 2,
  }),
  one("Aqueduct", "cak_aqueduct_taken", { player: 0, res: "brick" }),
  one("Aqueduct, bank empty", "cak_aqueduct_taken", { player: 0, res: "none" }),
  one("Fast Gold: commodity sold (with Explorers)", "cak_commodity_sold", {
    player: 1,
    commodity: 2,
  }),
];

// ---- Islands -----------------------------------------------------------------

const ISLANDS_LOG: LogCase[] = [
  one("island chip +2", "island_chip", { player: 0, vp: 2 }),
  one("island chip +1", "island_chip", { player: 0, vp: 1 }),
  one("gold owed, one seat", "gold_owed", { owed: [{ player: 1 }] }),
  one("gold owed, several", "gold_owed", { owed: [{ player: 1 }, { player: 2 }, { player: 3 }] }),
  one("gold chosen", "gold_chosen", { player: 1, gain: H(0, 1, 0, 0, 1) }),
  one("gold chosen, cards hidden", "gold_chosen", { player: 1 }),
  one("ship built", "ship_built", { player: 2 }),
  one("ship moved", "ship_moved", { player: 2 }),
  one("pirate moved", "pirate_moved", { player: 3 }),
  one("Longest Trade Route (Islands wording)", "longest_road", { holder: 0 }),
];

// ---- Fishermen ---------------------------------------------------------------

const FISH_USES = [
  "wagon_boost",
  "rider_hurry",
  "remove_robber",
  "move_robber",
  "steal",
  "take_resource",
  "free_road",
  "bridge",
  "dev_card",
  "progress_card",
];

const FISH_LOG: LogCase[] = [
  one("fish caught, three seats", "tab_fish_caught", { draws: [1, 0, 2, 1] }),
  one("fish caught with the old boot", "tab_fish_caught", { draws: [0, 1, 0, 0], boot_to: 1 }),
  ...FISH_USES.map((u) => one(`spent: ${u}`, "tab_fish_spent", { player: 0, use: u, tiles: 2 })),
  one("spent: one tile", "tab_fish_spent", { player: 0, use: "steal", tiles: 1 }),
  one("old boot handed over", "tab_boot_given", { player: 3 }),
];

// ---- Caravans ----------------------------------------------------------------

const CARAVANS_LOG: LogCase[] = [
  one("vote opens", "tab_camel_vote", { finisher: 2 }),
  one("bid", "tab_camel_bid", { player: 1, cards: [3, 2] }),
  one("bid, one vote", "tab_camel_bid", { player: 1, cards: [1, 0] }),
  one("bid naming a caravan", "tab_camel_bid", {
    player: 3,
    cards: [2, 0],
    path: { caravan: 1, e: {} },
  }),
  one("bid nothing", "tab_camel_bid", { player: 0, cards: [0, 0] }),
  one("resolved: majority", "tab_camel_resolved", {
    placer: 1,
    reason: "majority",
    paid: [
      { player: 1, cards: [2, 1] },
      { player: 2, cards: [1, 0] },
    ],
  }),
  one("resolved: coalition", "tab_camel_resolved", {
    placer: -1,
    reason: "coalition",
    paid: [
      { player: 1, cards: [1, 1] },
      { player: 3, cards: [1, 1] },
    ],
  }),
  one("resolved: tie", "tab_camel_resolved", {
    placer: 2,
    reason: "tie",
    paid: [
      { player: 0, cards: [1, 0] },
      { player: 1, cards: [0, 1] },
    ],
  }),
  one("resolved: nobody bid", "tab_camel_resolved", { placer: 2, reason: "nobody", paid: [] }),
  one("camel placed", "tab_camel_placed", { caravan: 0, e: {} }),
];

// ---- Harbormaster ------------------------------------------------------------

const HARBOR_LOG: LogCase[] = [
  one("taken (first holder)", "harbormaster_standings", { holder: 1, prev: -1 }),
  one("taken from another seat", "harbormaster_standings", { holder: 2, prev: 1 }),
  one("up for grabs (tie)", "harbormaster_standings", { holder: -1, prev: 2 }),
];

// ---- Rivers ------------------------------------------------------------------

const RIVERS_LOG: LogCase[] = [
  one("bridge built", "rivers_bridge_built", { player: 0 }),
  one("coins earned (building)", "rivers_coins_changed", { player: 0, reason: "build", delta: 2 }),
  one("coin earned (one)", "rivers_coins_changed", { player: 0, reason: "build", delta: 1 }),
  one("coin returned", "rivers_coins_changed", { player: 0, reason: "build", delta: -1 }),
  one("coin bought", "rivers_coin_bought", { player: 1, res: "wood", paid: 3 }),
  one("resource bought with coins", "rivers_coins_spent", { player: 1, res: "ore" }),
  one("coins given in a trade", "rivers_coin_traded", { from: 2, to: 3, coins: 2 }),
  one("wealth: one Wealthiest, one Poorest", "rivers_wealth_changed", {
    wealthiest: 0,
    poorest: [3],
  }),
  one("wealth: several Poorest", "rivers_wealth_changed", { wealthiest: 1, poorest: [0, 2, 3] }),
  one("wealth: tied lead", "rivers_wealth_changed", { wealthiest: -1, poorest: [] }),
];

// ---- Raiders -----------------------------------------------------------------

const RAIDERS_LOG: LogCase[] = [
  one("landing numbers", "raiders_landing", { player: 1, numbers: [5, 9, 11] }),
  one("raider took a path", "raiders_path_placed", {}),
  one("raider came ashore (named hex)", "raiders_landed", { hex: hexA }),
  one("raider came ashore (hex unnamed)", "raiders_landed", { hex: { q: 9, r: 9 } }),
  one("number found no coast", "raiders_landed", {}),
  ...(["muster", "swift_rider", "treason", "intrigue"] as const).map((c) =>
    one(`drew ${c}`, "raiders_card", { player: 2, card: c, gold: c === "treason" ? 2 : 0 }),
  ),
  ...(["muster", "swift_rider", "intrigue"] as const).map((c) =>
    one(`drew ${c}, void`, "raiders_card", { player: 2, card: c, void: true }),
  ),
  one("rider on the castle (Muster)", "raiders_rider_placed", { player: 0, card: "muster" }),
  one("rider anywhere (Swift Rider)", "raiders_rider_placed", { player: 0, card: "swift_rider" }),
  one("rider moved", "raiders_rider_moved", { player: 0 }),
  one("rider hurried (wheat)", "raiders_rider_moved", { player: 0, hurry: true }),
  one("rider moved (paid in fish)", "raiders_rider_moved", { player: 0, hurry: true, fish: true }),
  one("declined the Swift Rider", "raiders_declined", { player: 1 }),
  one("Treason: moved two", "raiders_treason", { player: 3, moves: [{}, {}] }),
  one("Treason: moved one", "raiders_treason", { player: 3, moves: [{}] }),
  one("Intrigue: prisoner", "raiders_intrigue", { player: 3 }),
  one("conquest: hex and buildings", "raiders_conquest", {
    conquered: [hexA],
    lost: [
      { player: 1, city: false, vp: 1 },
      { player: 2, city: true, vp: 2 },
    ],
  }),
  one("liberation: hex and building", "raiders_conquest", {
    liberated: [hexB],
    restored: [{ player: 1, city: false, vp: 1 }],
  }),
  one("restored city", "raiders_conquest", { restored: [{ player: 2, city: true, vp: 2 }] }),
  one("conquest: hex unnamed", "raiders_conquest", { conquered: [{ q: 9, r: 9 }] }),
  one("liberation: hex unnamed", "raiders_conquest", { liberated: [{ q: 9, r: 9 }] }),
  one("battle won: prisoners, gold, losses", "raiders_battle", {
    hex: hexA,
    raiders: 2,
    strength: 3,
    prisoners: [{ player: 0, count: 2 }],
    gold: [{ player: 1, count: 1 }],
    lost: [{ player: 1 }, { player: 1 }, { player: 2 }],
  }),
  one("battle won, one raider, hex unnamed", "raiders_battle", { raiders: 1, strength: 2 }),
  one("a 7: steal", "raiders_seven", { player: 2 }),
  one("stole a card", "raiders_stolen", { thief: 2, victim: 0, res: "sheep" }),
  one("stole, card hidden", "raiders_stolen", { thief: 2, victim: 0 }),
  one("nobody to steal from", "raiders_stolen", { thief: 2, nothing: true }),
  one("gold spent on a resource", "raiders_gold_spent", { player: 0, res: "brick", gold: 2 }),
  one("cards sold for gold", "raiders_gold_gained", {
    player: 0,
    give: H(0, 0, 0, 0, 2),
    gold: 1,
  }),
  one("gold given in a trade", "raiders_gold_moved", { from: 1, to: 0, gold: 3 }),
];

// ---- Wagons ------------------------------------------------------------------

const WAGONS_LOG: LogCase[] = [
  one("Swift Journey bought", "wagons_swift_bought", { player: 1 }),
  one("Swift Journey played", "wagons_swift_played", { player: 1 }),
  one("toll paid", "wagons_moved", { player: 0, toll: 2, paid: 3 }),
  one("toll paid, one gold", "wagons_moved", { player: 0, toll: 1, paid: 3 }),
  one("boost paid in wheat", "wagons_boosted", { player: 0 }),
  one("charge won", "wagons_charged", { player: 2, die: 5, drove: true }),
  one("charge lost", "wagons_charged", { player: 2, die: 2 }),
  one("barbarian moved", "wagons_barbarian_moved", { player: 2 }),
  ...[1, 2, 3, 4].map((c) => one(`loaded cargo ${c}`, "wagons_loaded", { player: 3, cargo: c })),
  ...[1, 2, 3, 4].map((c) =>
    one(`delivered cargo ${c}`, "wagons_delivered", {
      player: 3,
      cargo: c,
      gold: c === 1 ? 1 : 3,
    }),
  ),
  one("upgraded", "wagons_upgraded", { player: 0, level: 4 }),
  one("resource bought for gold", "wagons_bought", { player: 1, res: "ore", gold: 2 }),
  one("resources sold for gold", "wagons_sold", { player: 1, res: "wood", count: 3, gold: 1 }),
  one("gold given in a trade", "wagons_gold_moved", { from: 2, to: 0, gold: 2 }),
];

// ---- Explorers ---------------------------------------------------------------

const EXPLORERS_LOG: LogCase[] = [
  one("harbour settlement placed", "explorers_harbour_placed", { player: 0 }),
  one("settlement placed, with grant", "explorers_settlement_placed", {
    player: 0,
    gain: H(1, 0, 1, 1, 0),
  }),
  one("city placed (with Knights)", "explorers_settlement_placed", { player: 0, city: true }),
  one("start: road and ship", "explorers_start_placed", { player: 0 }),
  one("harbour settlement built", "explorers_harbour_built", { player: 1 }),
  one("ship built", "explorers_ship_built", { player: 1 }),
  one("ship scrapped and rebuilt", "explorers_ship_built", { player: 1, recycled: 2 }),
  one("ship moved", "explorers_ship_moved", { player: 1 }),
  one("ship moved, paid tribute", "explorers_ship_moved", { player: 1, tribute: 1 }),
  one("ship sped up", "explorers_ship_sped", { player: 1 }),
  one("revealed: land with chit", "explorers_hex_revealed", {
    player: 2,
    res: "wheat",
    number: 8,
  }),
  one("revealed: land, no chit", "explorers_hex_revealed", { player: 2, res: "ore", number: 0 }),
  one("revealed: open sea", "explorers_hex_revealed", { player: 2, res: "none" }),
  one("revealed: gold field with lair", "explorers_hex_revealed", { player: 2, kind: 1 }),
  one("revealed: fish shoal", "explorers_hex_revealed", { player: 2, kind: 2, shoal: 4 }),
  ...[0, 1, 2].map((v) =>
    one(`revealed: spice farm, village ${v}`, "explorers_hex_revealed", {
      player: 2,
      kind: 3,
      village: v,
    }),
  ),
  one("bought a settler", "explorers_cargo_bought", {
    player: 3,
    cargo: { settler: 1 },
    cost: H(1, 1, 1, 1, 0),
  }),
  one("bought a crew", "explorers_cargo_bought", {
    player: 3,
    cargo: { crew: 1 },
    cost: H(0, 0, 1, 0, 1),
  }),
  ...(["settler", "haul", "crew", "spice"] as const).map((c) =>
    one(`jettisoned ${c}`, "explorers_jettisoned", { player: 3, cargo: { [c]: 1 } }),
  ),
  one("cargo loaded at a harbour", "explorers_cargo_moved", { player: 0, to_ship: true }),
  one("cargo unloaded", "explorers_cargo_moved", { player: 0 }),
  one("cargo swapped", "explorers_cargo_moved", { player: 0, back: { crew: 1 } }),
  one("crew landed on a lair", "explorers_crew_landed", { player: 1 }),
  ...[0, 1, 2].map((v) =>
    one(`crew befriended village ${v}`, "explorers_crew_landed", {
      player: 1,
      sack: true,
      village: v,
    }),
  ),
  one("crew picked up", "explorers_crew_taken", { player: 1 }),
  one("fished: haul appeared", "explorers_haul_placed", { player: 2, die: 3 }),
  one("fished: nothing", "explorers_haul_missed", { player: 2, die: 6 }),
  one("haul loaded", "explorers_haul_loaded", { player: 2 }),
  one("delivered hauls and sacks", "explorers_delivered", { player: 3, hauls: 2, sacks: 1 }),
  one("delivered one haul", "explorers_delivered", { player: 3, hauls: 1 }),
  one("delivered sacks", "explorers_delivered", { player: 3, sacks: 2 }),
  one("settler founded a settlement", "explorers_founded", { player: 0 }),
  one("lair fell (rolls, hero, chit)", "explorers_lair_resolved", {
    involved: [0, 2],
    rolls: [5, 3],
    crews: [2, 1],
    hero: 0,
    number: 9,
  }),
  one("lair fell, no chit left", "explorers_lair_resolved", {
    involved: [1],
    rolls: [4],
    crews: [3],
  }),
  one("pirate ship placed", "explorers_pirate_moved", { player: 1 }),
  one("pirate ship moved, stole a card", "explorers_pirate_moved", {
    player: 1,
    from: {},
    victim: 2,
    res: "brick",
  }),
  one("pirate ship moved, took gold", "explorers_pirate_moved", {
    player: 1,
    from: {},
    victim: 2,
    gold: 1,
  }),
  one("displaced a rival pirate, scattered a haul", "explorers_pirate_moved", {
    player: 1,
    displaced: 3,
    haul: true,
  }),
  one("chase won", "explorers_pirate_chased", {
    player: 0,
    rolls: [6, 2],
    hits: [5, 6],
    won: true,
  }),
  one("chase lost", "explorers_pirate_chased", { player: 0, rolls: [3, 1], need: 6 }),
  one("gold: consolation, gold field, reveal", "explorers_gold_changed", {
    gains: [
      { player: 0, amount: 1, reason: "consolation" },
      { player: 1, amount: 2, reason: "gold_field" },
      { player: 2, amount: 1, reason: "reveal" },
    ],
  }),
  one("gold: took and paid", "explorers_gold_changed", {
    gains: [
      { player: 3, amount: 2 },
      { player: 1, amount: -1 },
    ],
  }),
  one("gold traded: bought", "explorers_gold_traded", {
    player: 0,
    reason: "buy",
    gold: 2,
    get: H(0, 0, 0, 1, 0),
  }),
  one("gold traded: sold", "explorers_gold_traded", {
    player: 0,
    reason: "sell",
    gold: 1,
    give: H(0, 0, 2, 0, 0),
  }),
  one("gold traded: banked", "explorers_gold_traded", {
    player: 0,
    reason: "bank",
    gold: 1,
    give: H(3, 0, 0, 0, 0),
  }),
];

function LogGroup({
  id,
  title,
  cases,
  islands = false,
  tiles = null,
}: {
  id: string;
  title: string;
  cases: LogCase[];
  islands?: boolean;
  tiles?: readonly BoardTile[] | null;
}) {
  const pieceIcon = usePieceIcons(SEAT_COLORS);
  return (
    <Group id={id} title={title} surface="hud" wide>
      {cases.map(([label, evs]) => (
        <State key={label} label={label}>
          <div className="hud-surf flex w-[320px] flex-col px-2.5 py-2" data-log-case>
            <EventLogFeed
              events={evs}
              seatName={seatName}
              islands={islands}
              colorOf={colorOf}
              pieceIcon={pieceIcon}
              tiles={tiles}
              fadeAt={null}
            />
          </div>
        </State>
      ))}
    </Group>
  );
}

function LogGroups() {
  return (
    <>
      <LogGroup
        id="expansions/knights-log-roll"
        title="Knights log: the roll with each event-die face, commodity production, the idle robber"
        cases={KNIGHTS_ROLL}
      />
      <LogGroup
        id="expansions/knights-log-barbarians"
        title="Knights log: every barbarian attack outcome and its consequences"
        cases={KNIGHTS_BARB}
      />
      <LogGroup
        id="expansions/knights-log-pieces"
        title="Knights log: knights, walls, merchant, metropolises"
        cases={KNIGHTS_PIECES_LOG}
      />
      <LogGroup
        id="expansions/knights-log-progress"
        title="Knights log: progress cards drawn, discarded, stolen, played; city improvements"
        cases={KNIGHTS_PROGRESS_LOG}
      />
      <LogGroup
        id="expansions/knights-log-cards"
        title="Knights log: progress card effects and commodity trades"
        cases={KNIGHTS_TRADE_LOG}
      />
      <LogGroup id="expansions/islands-log" title="Islands log" cases={ISLANDS_LOG} islands />
      <LogGroup
        id="expansions/fishermen-log"
        title="Fishermen log (every spend)"
        cases={FISH_LOG}
      />
      <LogGroup
        id="expansions/caravans-log"
        title="Caravans log (the vote's four outcomes)"
        cases={CARAVANS_LOG}
      />
      <LogGroup id="expansions/harbormaster-log" title="Harbormaster log" cases={HARBOR_LOG} />
      <LogGroup id="expansions/rivers-log" title="Rivers log" cases={RIVERS_LOG} />
      <LogGroup
        id="expansions/raiders-log"
        title="Raiders log (hexes named from the preview board)"
        cases={RAIDERS_LOG}
        tiles={pTiles}
      />
      <LogGroup id="expansions/wagons-log" title="Wagons log" cases={WAGONS_LOG} />
      <LogGroup id="expansions/explorers-log" title="Explorers log" cases={EXPLORERS_LOG} />
    </>
  );
}

// ===========================================================================
// Post-game scoreboard per expansion
// ===========================================================================

const bd = (o: Partial<VPBreakdown>): VPBreakdown => ({
  settlements: 0,
  cities: 0,
  longest_road: 0,
  largest_army: 0,
  dev_vp: 0,
  island_vp: 0,
  metropolis: 0,
  defender: 0,
  merchant: 0,
  extra_cak: 0,
  caravan: 0,
  ...o,
});

/** A scoreboard line. `over` may carry the Raiders and Wagons blocks the shared type lacks. */
function stat(seat: number, vp: number, over: Record<string, unknown>): PlayerStat {
  return {
    seat,
    vp,
    settlements: 2,
    cities: 2,
    roads: 8,
    knights: 0,
    dev_cards: 0,
    longest_road: 5,
    has_longest_road: false,
    has_largest_army: false,
    produced: 40 + seat * 3,
    expected: 42,
    robber_loss: seat,
    stolen: 1,
    steals: 2 - (seat % 2),
    bank_trades: 3,
    player_trades: 2,
    luck_rel: [0.12, -0.04, 0.02, -0.1][seat] ?? 0,
    ...over,
  };
}

interface PgSpec {
  key: string;
  name: string;
  ruleset: string;
  target: number;
  players: PlayerStat[];
}

const SEATS = [0, 1, 2, 3];

const PG: PgSpec[] = [
  {
    key: "knights",
    name: "Knights",
    ruleset: "base+cak",
    target: 13,
    players: SEATS.map((s) =>
      stat(s, [13, 10, 9, 6][s], {
        cak: {
          knights_total: 3 + s,
          knights_active: 2,
          knight_levels: [2, 1, s % 2],
          metropolis: s === 0 ? 1 : 0,
          improve: [4 - s, 2, s],
          walls: s % 3,
          commodities_produced: 9 - s,
          progress_played: 5 - s,
          barbarian_defenses_won: 2,
          cities_lost_to_barbarians: s === 3 ? 1 : 0,
          defender_vp: s === 0 ? 1 : 0,
          merchant_vp: s === 1 ? 1 : 0,
          extra_vp: 0,
        },
        vp_breakdown: bd({
          settlements: 1,
          cities: [3, 3, 3, 2][s],
          metropolis: s === 0 ? 2 : 0,
          defender: s === 0 ? 1 : 0,
          merchant: s === 1 ? 1 : 0,
          longest_road: s === 1 ? 2 : 0,
        }),
      }),
    ),
  },
  {
    key: "islands",
    name: "Islands",
    ruleset: "base+islands",
    target: 12,
    players: SEATS.map((s) =>
      stat(s, [12, 9, 8, 5][s], {
        islands: { island_vp: [4, 2, 2, 0][s], ships: 6 - s, gold_gained: 3 - (s % 3) },
        dev_cards: 2,
        vp_breakdown: bd({
          settlements: 2,
          cities: [2, 2, 2, 1][s],
          island_vp: [4, 2, 2, 0][s],
          longest_road: s === 0 ? 2 : 0,
        }),
      }),
    ),
  },
  {
    key: "fishermen-caravans-harbormaster",
    name: "Fishermen, Caravans, Harbormaster",
    ruleset: "base+caravans+fishermen+harbormaster",
    target: 12,
    players: SEATS.map((s) =>
      stat(s, [12, 10, 7, 6][s], {
        fish: { caught: [2 - (s % 2), 1, s % 2], value: 5 - s, spent: 6 + s, has_boot: s === 2 },
        caravans: {
          camels_placed: 7,
          caravan_vp: s === 0 ? 2 : 1,
          route_bonus: s,
          votes_cast: 4 + s,
        },
        vp_breakdown: bd({
          settlements: 2,
          cities: [3, 3, 2, 2][s],
          caravan: s === 0 ? 2 : 1,
          harbormaster: s === 1 ? 2 : 0,
        }),
      }),
    ),
  },
  {
    key: "rivers",
    name: "Rivers",
    ruleset: "base+rivers",
    target: 10,
    players: SEATS.map((s) =>
      stat(s, [10, 8, 6, 3][s], {
        vp_breakdown: bd({ settlements: 2, cities: [3, 3, 2, 2][s], wealth: [1, 0, 0, -2][s] }),
      }),
    ),
  },
  {
    key: "raiders",
    name: "Raiders",
    ruleset: "base+raiders",
    target: 12,
    players: SEATS.map((s) =>
      stat(s, [12, 9, 8, 4][s], {
        raiders: {
          prisoners: [6, 4, 2, 1][s],
          prisoner_vp: [3, 2, 1, 0][s],
          gold: s + 1,
          riders_on_board: 4 - s,
          buildings_conquered: s === 3 ? 2 : 0,
        },
        vp_breakdown: bd({
          settlements: 2,
          cities: [3, 3, 3, 2][s],
          prisoners: [3, 2, 1, 0][s],
          conquered: s === 3 ? -2 : 0,
        }),
      }),
    ),
  },
  {
    key: "wagons",
    name: "Wagons",
    ruleset: "base+wagons",
    target: 12,
    players: SEATS.map((s) =>
      stat(s, [12, 10, 7, 5][s], {
        wagons: { delivered: 4 - s, level: 5 - s, gold: s * 2, tolls: 3 - s, paid: s },
        vp_breakdown: bd({
          settlements: 2,
          cities: [2, 2, 2, 1][s],
          delivered: 4 - s,
          wagon_level: s === 0 ? 1 : 0,
        }),
      }),
    ),
  },
  {
    key: "explorers",
    name: "Explorers",
    ruleset: "explorers",
    target: 12,
    players: SEATS.map((s) =>
      stat(s, [12, 9, 7, 6][s], {
        cities: 0,
        vp_breakdown: bd({
          settlements: [4, 4, 3, 3][s],
          explorer_harbours: [2, 2, 1, 1][s],
          missions: [6, 3, 3, 2][s],
        }),
      }),
    ),
  },
];

const PG_ROLLS: Record<number, number> = {
  2: 1,
  3: 3,
  4: 5,
  5: 8,
  6: 10,
  7: 11,
  8: 9,
  9: 7,
  10: 5,
  11: 3,
  12: 1,
};

function pgTrack(ends: number[]): number[][] {
  return Array.from({ length: 17 }, (_, t) =>
    ends.map((end, s) => Math.min(end, 2 + Math.floor((end - 2) * Math.pow(t / 16, 1 + s * 0.2)))),
  );
}

/** The end-of-game dialog surface routes/Game.tsx wraps the scoreboard in (not exported). */
function PostGameShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="hud-dialog w-[840px] max-w-full rounded-[20px] p-6 flex flex-col items-center gap-5">
      <div className="font-display text-[26px] font-heavy text-center text-foreground">
        {`${seatName(0)} wins!`}
      </div>
      {children}
    </div>
  );
}

function scoreboard(p: PgSpec) {
  return (
    <PostGameScoreboard
      players={p.players}
      winner={0}
      caps={rulesetCaps(p.ruleset)}
      seatName={seatName}
      colorOf={colorOf}
      rolls={PG_ROLLS}
      vpTrack={pgTrack(p.players.map((x) => x.vp))}
      targetVP={p.target}
      diceMode="random"
    />
  );
}

function PostGameGroups() {
  return (
    <>
      {PG.map((p) => (
        <Group
          key={p.key}
          id={`expansions/postgame-${p.key}`}
          title={`PostGameScoreboard, ${p.name} (${p.ruleset}): overview with the module's VP columns, details with its section`}
          surface="hud"
          wide
        >
          <State label="overview">
            <PostGameShell>{scoreboard(p)}</PostGameShell>
          </State>
          <State label="details">
            <Drive run={clickDetailsTab}>
              <PostGameShell>{scoreboard(p)}</PostGameShell>
            </Drive>
          </State>
        </Group>
      ))}
    </>
  );
}

// ===========================================================================
// Map previews per expansion board
// ===========================================================================

const all4Board = (all4Json as unknown as { board: Board }).board;
const knightsRiversBoard = (knightsRiversJson as unknown as { board: Board }).board;
const fivePackBoard = (previewBoardJson as unknown as { board: Board }).board;

const DEALT: { ruleset: string; board: () => Board }[] = [
  { ruleset: "base+cak", board: () => fullLandBoard(2) },
  { ruleset: "base+islands", board: () => GALLERY.find((m) => m.id === "shores")!.board },
  { ruleset: "base+fishermen", board: () => fullLandBoard(2) },
  { ruleset: "base+caravans", board: () => fullLandBoard(2) },
  { ruleset: "base+harbormaster", board: () => fullLandBoard(2) },
  { ruleset: "base+rivers", board: () => fullLandBoard(2) },
  { ruleset: "base+raiders", board: () => fullLandBoard(2) },
  { ruleset: "base+wagons", board: () => fullLandBoard(2) },
];

type Dealt = { ruleset: string; board: Board | null; error?: string };

/** Each module's board as the real /api/preview deals it (nothing is saved). */
function useDealtBoards(): Dealt[] {
  const [out, setOut] = React.useState<Dealt[]>(() =>
    DEALT.map((d) => ({ ruleset: d.ruleset, board: null })),
  );
  React.useEffect(() => {
    let live = true;
    DEALT.forEach((d, i) => {
      api
        .previewBoard({ ruleset: d.ruleset, seed: "4242", board: d.board(), players: 4 })
        .then((env) => {
          if (live) setOut((o) => o.map((x, j) => (j === i ? { ...x, board: env.board } : x)));
        })
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          if (live) setOut((o) => o.map((x, j) => (j === i ? { ...x, error } : x)));
        });
    });
    return () => {
      live = false;
    };
  }, []);
  return out;
}

function useIslandsMaps() {
  const [maps, setMaps] = React.useState(() =>
    GALLERY.filter((m) => m.ruleset.includes("islands")),
  );
  React.useEffect(() => {
    let live = true;
    void loadFramedGallery().then((all) => {
      if (live) setMaps(all.filter((m) => m.ruleset.includes("islands")));
    });
    return () => {
      live = false;
    };
  }, []);
  return maps;
}

const PREVIEW = "w-[240px] h-[210px]";

function MapGroups() {
  const dealt = useDealtBoards();
  const islands = useIslandsMaps();
  return (
    <>
      <Group
        id="expansions/map-preview-fixtures"
        title="MapPreview: scenario boards from the test fixtures"
      >
        <State label="Knights + Fishermen + Rivers (scenarioKnightsRiversView)">
          <MapPreview board={knightsRiversBoard} className={PREVIEW} />
        </State>
        <State label="Caravans + Fishermen + Harbormaster + Rivers (scenarioAll4View)">
          <MapPreview board={all4Board} className={PREVIEW} />
        </State>
        <State label="five scenarios dealt together (previewBoard.json)">
          <MapPreview board={fivePackBoard} className={PREVIEW} />
        </State>
      </Group>

      <Group
        id="expansions/map-preview-dealt"
        title="MapPreview: each module's board as /api/preview deals it (seed 4242)"
        wide
      >
        {dealt.map((d) => (
          <State key={d.ruleset} label={d.ruleset}>
            {d.board ? (
              <MapPreview board={d.board} className={PREVIEW} />
            ) : (
              <div className={cn(PREVIEW, "grid place-items-center text-[12px] text-muted")}>
                {d.error ? `refused: ${d.error}` : "dealing"}
              </div>
            )}
          </State>
        ))}
      </Group>

      <Group
        id="expansions/map-preview-islands"
        title="MapPreview: the Islands gallery maps (framed by /api/maps/frame)"
        wide
      >
        {islands.map((m) => (
          <State key={m.id} label={`${m.name} (${m.id})`}>
            <MapPreview board={m.board} className={PREVIEW} />
          </State>
        ))}
      </Group>
    </>
  );
}
