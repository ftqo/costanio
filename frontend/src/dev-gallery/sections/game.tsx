// Gallery section: game. Every component in components/game (outside hud/),
// the board chrome and the asset parts, each in every state it can show,
// drawn by the real components. See ../spec.tsx.
//
// Three techniques keep the real components inside their specimen:
//  - `Box`: a sized, clipped container with `transform: translateZ(0)`, which
//    becomes the containing block for `position: fixed` descendants (Overlay,
//    the floating prompts, the reveal and flight layers).
//  - `Captured`: components that portal to `document.body` (CardSheet,
//    AnchoredMenu, PieceInfoCard, LocationDial's menu) are called with
//    `document.body` pointed at a node inside the Box for the duration of the
//    render that creates the portal.
//  - `Drive`: internal state the component only reaches through input (a
//    stepped bid, a picked die face, a chosen tab) is reached by clicking the
//    real control once after mount.
import * as React from "react";
import { Group, State, Break } from "../spec";

import { ActiveOfferCard } from "@/components/game/ActiveOfferCard";
import { AnchoredMenu } from "@/components/game/AnchoredMenu";
import { CamelBidPanel } from "@/components/game/CamelBidPanel";
import { CamelMap, caravanColor } from "@/components/game/CamelMap";
import { CamelPlacePanel } from "@/components/game/CamelPlacePanel";
import { CardFlightLayer, type FlightBatch } from "@/components/game/CardFlightLayer";
import {
  CardRevealLayer,
  LastDrawnTab,
  RevealDock,
  type RevealBatch,
} from "@/components/game/CardRevealLayer";
import { CardSheet } from "@/components/game/CardSheet";
import { ChatText } from "@/components/game/ChatText";
import { CostChips } from "@/components/game/CostChips";
import { CurrencyTrade } from "@/components/game/CurrencyTrade";
import { DecisionClock, DecisionClockView } from "@/components/game/DecisionClock";
import { DicePicker } from "@/components/game/DicePicker";
import { DrawOfferCard } from "@/components/game/DrawOfferCard";
import { CargoSlots, ExplorerCargoPanel } from "@/components/game/ExplorerCargoPanel";
import { ExplorersPanel, ShipHold } from "@/components/game/ExplorersPanel";
import { FishSpendPanel, TilesSpent } from "@/components/game/FishSpendPanel";
import { CardFan, Icons, ResetView } from "@/components/game/hudIcons";
import { LocationDial } from "@/components/game/LocationDial";
import { CardToken, LogTokens } from "@/components/game/LogLine";
import { CamelGlyph, RobberGlyph, RouteGlyph } from "@/components/game/moduleGlyphs";
import {
  Glyph,
  MBar,
  MBtn,
  MChip,
  MCost,
  MHead,
  ResArt,
  type GlyphName,
} from "@/components/game/moduleUi";
import { Overlay } from "@/components/game/Overlay";
import { PieceArt, type ArtPiece } from "@/components/game/PieceIcon";
import { PieceChoice } from "@/components/game/PieceChoice";
import { PieceInfoCard } from "@/components/game/PieceInfoCard";
import { PillageBuyoutDialog } from "@/components/game/PillageBuyoutDialog";
import { PlayerCard, type PlayerCardData } from "@/components/game/PlayerCard";
import { PostGameScoreboard } from "@/components/game/PostGameScoreboard";
import { ProgressCardChoice } from "@/components/game/ProgressCardChoice";
import { RaidersCoast } from "@/components/game/RaidersCoast";
import { RaidersGoldPanel } from "@/components/game/RaidersGoldPanel";
import { RaidersMap } from "@/components/game/RaidersMap";
import { RaidersRidersPanel } from "@/components/game/RaidersRidersPanel";
import { RaidersTreasonPanel } from "@/components/game/RaidersTreasonPanel";
import { RiverCoinsPanel } from "@/components/game/RiverCoinsPanel";
import { ScenarioDialog } from "@/components/game/ScenarioDialog";
import { SeatChoice, SeatChoiceRow } from "@/components/game/SeatChoice";
import { Award, Stat } from "@/components/game/Stat";
import { StealPicker } from "@/components/game/StealPicker";
import { TableClosedScreen } from "@/components/game/TableClosedScreen";
import { Tip } from "@/components/game/Tip";
import { TrackPips } from "@/components/game/TrackPips";
import { WagonPanel } from "@/components/game/WagonPanel";
import { RollChart } from "@/components/game/charts/RollChart";
import { VPChart } from "@/components/game/charts/VPChart";
import { HudButton } from "@/components/game/hud/HudButton";

import { CheckList, CheckRow } from "@/components/board/CheckList";
import { Die, EventDie } from "@/components/board/Die";
import { MapPreview } from "@/components/board/MapPreview";
import { ZoomControls } from "@/components/board/ZoomControls";

import { CardFace, GoodIcon, ResIcon } from "@/components/asset/AssetParts";
import { CardTitlePlate } from "@/components/asset/CardTitlePlate";
import { TokenChipArt, TokenLabel, portInfo } from "@/components/asset/slotArt";

import { previewView } from "@/lib/board3d/previewFixture";
import all4Json from "@/lib/__fixtures__/scenarioAll4View.json";
import type { CardFlight } from "@/lib/board3d/cardflight";
import { createHudAnchors } from "@/lib/hudAnchors";
import type { Reveal } from "@/lib/cardReveal";
import { COMMOD, RES, comIconSlot, resIconSlot } from "@/lib/cardFace";
import { playedCardSlot } from "@/lib/cardText";
import { camelPathKey } from "@/lib/caravans";
import { rulesetCaps, gameCaps } from "@/lib/caps";
import { fishOffers, type FishMix } from "@/lib/fish";
import { hexKey, seatColor } from "@/lib/hexgeo";
import type { LocationAction } from "@/lib/locationActions";
import type { CheckResult } from "@/lib/preview/checks";
import { coastThreat, goldBuyOffers, goldSellOffers } from "@/lib/raiders";
import { coinTrades } from "@/lib/rivers";
import { usePieceIcons } from "@/lib/usePieceIcons";
import { usePieceThumbnails } from "@/lib/usePieceThumbnails";
import { CARGO, ROLE } from "@/lib/wagons";
import type {
  CamelPath,
  CaravansExt,
  Edge,
  FullView,
  Hand,
  Hex,
  PlayerStat,
  RaidersExt,
  RiderMoves,
  WagonsExt,
} from "@/lib/types";

export const title = "Game dialogs and panels";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NAMES = ["Mara", "Teo", "Ines", "Bram", "Lio", "Sanne", "Odile", "Pim"];
const seatName = (s: number) => NAMES[s] ?? `Seat ${s + 1}`;
const colorOf = (s: number) => seatColor(s);
const noop = () => {};

// Anchor points for the anchored menus: stable objects, as the screen's state
// is, since the menus re-place themselves whenever `at` changes identity.
const AT_DIAL = { x: 230, y: 230 };
const AT_MENU = { x: 40, y: 30 };
const AT_INFO = { x: 30, y: 30 };

/**
 * A sized, clipped stage. `translateZ(0)` makes it the containing block for
 * fixed-position descendants, so a full-screen dialog fills this box rather
 * than the window.
 */
function Box({
  w,
  h,
  children,
}: {
  w: number | string;
  h: number | string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        overflow: "hidden",
        transform: "translateZ(0)",
        borderRadius: 10,
        ["--hud-float-bottom" as string]: "12px",
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

/**
 * Renders a component that portals to `document.body` with its portal landing
 * here instead. `render` calls the component as a function, so its hooks run
 * as this component's (in a stable order) and its `createPortal(…,
 * document.body)` reads the redirected body.
 */
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

/**
 * Runs `run` once against the rendered subtree after mount: clicks a control,
 * focuses a card. Guarded by a ref so StrictMode's second effect pass doesn't
 * click twice.
 */
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

const click = (sel: string) => (el: HTMLElement) => {
  el.querySelector<HTMLElement>(sel)?.click();
};
/**
 * Runs steps one after another with a gap, so each click lands after React has
 * re-rendered from the last one (two synchronous clicks on a stepper both see
 * the same stale value).
 */
const seq =
  (steps: ((el: HTMLElement) => void)[], gap = 90) =>
  (el: HTMLElement) =>
    steps.forEach((f, i) => window.setTimeout(() => f(el), i * gap));
const clickAll = (sels: string[]) => seq(sels.map((s) => click(s)));
const svgClick = (sels: string[]) =>
  seq(
    sels.map((s) => (el: HTMLElement) => {
      el.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }),
  );

/** Re-issues a value on a fixed period, for components that animate once and clear. */
function useLoop<T>(make: (n: number) => T, periodMs: number): T | null {
  const [v, setV] = React.useState<T | null>(null);
  const makeRef = React.useRef(make);
  React.useEffect(() => {
    makeRef.current = make;
  });
  React.useEffect(() => {
    let n = 1;
    setV(makeRef.current(n++));
    const id = window.setInterval(() => setV(makeRef.current(n++)), periodMs);
    return () => window.clearInterval(id);
  }, [periodMs]);
  return v;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const all4 = all4Json as unknown as FullView;
const caravanBoard = all4.board;
const caravanExt = (all4.ext as { caravans?: CaravansExt }).caravans ?? {};
const caravanBuildings = all4.buildings;
const camelPaths: CamelPath[] = (caravanExt.caravans ?? [])
  .filter((c) => c.caravan > 0)
  .map((c) => ({ caravan: c.caravan, e: c.arrow }));

const pBoard = previewView.board;
const dist = (h: Hex) => (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
const ring2 = pBoard.tiles.map((t) => t.hex).filter((h) => dist(h) === 2);

const raidersExt: RaidersExt = {
  coast: ring2,
  raider_count: ring2.map((_, i) => [2, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0][i] ?? 0),
  castle: { q: 0, r: 0 },
  conquered: [ring2[5]],
  supply: 9,
};
const raidersView = (over: Partial<RaidersExt> = {}, ruleset = "base+raiders") =>
  ({
    ...previewView,
    config: { ...previewView.config, ruleset },
    ext: { raiders: { ...raidersExt, ...over } },
  }) as unknown as FullView;

const vx = (q: number, r: number, side: 0 | 1) => ({ q, r, side });
const edge = (q: number, r = 0): Edge => ({ a: vx(q, r, 0), b: vx(q + 1, r, 1) });

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function Section() {
  // Overlays focus their panel on mount and Drive focuses dial cards; once all
  // of that has settled, drop focus (so no ring is left behind) and put the
  // page back at the top.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo(0, 0);
    }, 900);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <>
      <ModuleUiGroups />
      <OfferGroups />
      <SeatAndPieceGroups />
      <DialogGroups />
      <CardGroups />
      <LayerGroups />
      <MenuGroups />
      <CaravanGroups />
      <ExplorerGroups />
      <FishGroups />
      <RaiderGroups />
      <RiverGroups />
      <WagonGroups />
      <PostGameGroups />
      <PlayerCardGroups />
      <SmallPartsGroups />
      <IconGroups />
      <BoardChromeGroups />
      <AssetGroups />
    </>
  );
}

// ---- moduleUi primitives --------------------------------------------------

const GLYPHS: GlyphName[] = [
  "rider",
  "wagon",
  "cship",
  "crew",
  "person",
  "hset",
  "flag",
  "raider",
  "fish",
  "spice",
  "castle",
  "delivery",
];

const BTN_STATES = [
  ["rest", undefined, false],
  ["hover", "hover", false],
  ["active", "active", false],
  ["focus-visible", "focus-visible", false],
  ["disabled", undefined, true],
] as const;

function ModuleUiGroups() {
  return (
    <>
      <Group id="game/moduleui-mbtn" title="MBtn (module panel button)" surface="hud">
        {(["primary", "secondary", "quiet"] as const).map((kind) => (
          <React.Fragment key={kind}>
            {BTN_STATES.map(([label, force, disabled]) => (
              <State key={label} label={`${kind}: ${label}`} force={force}>
                <MBtn primary={kind === "primary"} quiet={kind === "quiet"} disabled={disabled}>
                  {kind === "primary"
                    ? "Deliver"
                    : kind === "secondary"
                      ? "Buy for 2 gold"
                      : "Skip"}
                </MBtn>
              </State>
            ))}
            <Break />
          </React.Fragment>
        ))}
      </Group>

      <Group id="game/moduleui-parts" title="MHead, MChip, MBar, MCost, ResArt" surface="hud">
        <State label="MHead with chips">
          <div className="modp-panel w-[300px]">
            <MHead label="Coast">
              <MChip tone="bad" icon={<Glyph name="castle" size={12} />}>
                1 conquered
              </MChip>
              <MChip icon={<Glyph name="raider" size={12} />}>9 to land</MChip>
            </MHead>
          </div>
        </State>
        <State label="MHead, label only">
          <div className="modp-panel w-[220px]">
            <MHead label="Your riders" />
          </div>
        </State>
        <Break />
        <State label="MChip: default">
          <MChip icon={<Icons.gold size={12} />}>4</MChip>
        </State>
        <State label="MChip: good">
          <MChip tone="good" icon={<Glyph name="delivery" size={12} />}>
            3 delivered
          </MChip>
        </State>
        <State label="MChip: bad">
          <MChip tone="bad" icon={<Glyph name="castle" size={12} />}>
            2 conquered
          </MChip>
        </State>
        <State label="MChip: focus">
          <MChip tone="focus" icon={<Glyph name="wagon" size={12} />}>
            Level 3
          </MChip>
        </State>
        <Break />
        <State label="MBar: empty (0 of 7)">
          <div className="w-[160px]">
            <MBar value={0} max={7} />
          </div>
        </State>
        <State label="MBar: part (3 of 7)">
          <div className="w-[160px]">
            <MBar value={3} max={7} />
          </div>
        </State>
        <State label="MBar: full">
          <div className="w-[160px]">
            <MBar value={7} max={7} />
          </div>
        </State>
        <Break />
        <State label="MCost: affordable">
          <MCost cost={{ 3: 1, 4: 1, 5: 1 }} have={[0, 2, 2, 2, 2, 2]} />
        </State>
        <State label="MCost: short of ore">
          <MCost cost={{ 4: 2, 5: 3 }} have={[0, 0, 0, 0, 2, 1]} />
        </State>
        <State label="MCost: no hand given">
          <MCost cost={{ 1: 1, 2: 1 }} />
        </State>
        <State label="ResArt 1 to 5">
          <span className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <ResArt key={i} idx={i} size={20} />
            ))}
          </span>
        </State>
      </Group>

      <Group id="game/moduleui-glyph" title="Glyph (module glyphs)" surface="hud">
        {GLYPHS.map((g) => (
          <State key={g} label={g}>
            <span className="text-foreground">
              <Glyph name={g} size={20} />
            </span>
          </State>
        ))}
      </Group>
    </>
  );
}

// ---- trade and draw offers ----------------------------------------------

const OFFER = { by: 0, give: [0, 0, 2, 0, 0, 0], want: [0, 0, 0, 0, 1, 1] };

function offerCard(o: Partial<React.ComponentProps<typeof ActiveOfferCard>>) {
  return (
    <ActiveOfferCard
      offer={OFFER}
      viewer={0}
      recipients={[0, 1, 2, 3]}
      deadlineMs={null}
      seatName={seatName}
      colorOf={colorOf}
      onRespond={noop}
      onRetract={noop}
      onExecute={noop}
      onCancel={noop}
      {...o}
    />
  );
}

function OfferGroups() {
  return (
    <>
      <Group id="game/active-offer-offerer" title="ActiveOfferCard: offerer's view" surface="hud">
        <State label="waiting on everyone, clock running">
          <Box w={520} h={170}>
            {offerCard({ deadlineMs: 90_000 })}
          </Box>
        </State>
        <State label="clock under 10s (red)">
          <Box w={520} h={170}>
            {offerCard({ deadlineMs: 9_000 })}
          </Box>
        </State>
        <State label="one accepted, one declined, one waiting">
          <Box w={520} h={320}>
            {offerCard({ offer: { ...OFFER, accepted: [2], declined: [1] }, deadlineMs: 60_000 })}
          </Box>
        </State>
        <State label="an acceptance and a counter-offer">
          <Box w={520} h={300}>
            {offerCard({
              offer: {
                ...OFFER,
                accepted: [1],
                declined: [3],
                counters: [{ by: 2, give: [0, 0, 0, 0, 1, 0], want: [0, 0, 3, 0, 0, 0] }],
              },
            })}
          </Box>
        </State>
        <State label="everyone declined">
          <Box w={520} h={200}>
            {offerCard({ offer: { ...OFFER, declined: [1, 2, 3] } })}
          </Box>
        </State>
        <State label="scenario currency in the offer">
          <Box w={520} h={200}>
            {offerCard({
              offer: { ...OFFER, give_com: { coins: 2 }, want: [0, 0, 0, 0, 0, 2] },
            })}
          </Box>
        </State>
      </Group>

      <Group
        id="game/active-offer-responder"
        title="ActiveOfferCard: responder's view"
        surface="hud"
      >
        <State label="fresh">
          <Box w={520} h={180}>
            {offerCard({ viewer: 1, deadlineMs: 45_000 })}
          </Box>
        </State>
        <State label="accepted (held down)">
          <Box w={520} h={180}>
            {offerCard({ viewer: 1, offer: { ...OFFER, accepted: [1] }, deadlineMs: 45_000 })}
          </Box>
        </State>
        <State label="rejected (held down)">
          <Box w={520} h={180}>
            {offerCard({ viewer: 1, offer: { ...OFFER, declined: [1] }, deadlineMs: 45_000 })}
          </Box>
        </State>
        <State label="countered">
          <Box w={520} h={180}>
            {offerCard({
              viewer: 1,
              offer: {
                ...OFFER,
                counters: [{ by: 1, give: [0, 0, 0, 1, 0, 0], want: [0, 0, 2, 0, 0, 0] }],
              },
              deadlineMs: 45_000,
            })}
          </Box>
        </State>
        <State label="spectator (no controls)">
          <Box w={520} h={130}>
            {offerCard({ viewer: -1, deadlineMs: 45_000 })}
          </Box>
        </State>
        <State label="Knights: commodities in the offer">
          <Box w={520} h={180}>
            {offerCard({
              viewer: 1,
              offer: { ...OFFER, give_com: [1, 0, 2], want: [0, 0, 0, 0, 0, 1] },
            })}
          </Box>
        </State>
      </Group>

      <Group id="game/draw-offer" title="DrawOfferCard" surface="hud">
        <State label="mine, nobody accepted yet">
          <Box w={520} h={150}>
            <DrawOfferCard
              offer={{ by: 0 }}
              viewer={0}
              seatName={seatName}
              onRespond={noop}
              onWithdraw={noop}
            />
          </Box>
        </State>
        <State label="mine, two accepted">
          <Box w={520} h={170}>
            <DrawOfferCard
              offer={{ by: 0, accepted: [1, 2] }}
              viewer={0}
              seatName={seatName}
              onRespond={noop}
              onWithdraw={noop}
            />
          </Box>
        </State>
        <State label="someone else's, to answer">
          <Box w={520} h={150}>
            <DrawOfferCard offer={{ by: 2 }} viewer={0} seatName={seatName} onRespond={noop} />
          </Box>
        </State>
        <State label="I accepted">
          <Box w={520} h={150}>
            <DrawOfferCard
              offer={{ by: 2, accepted: [0] }}
              viewer={0}
              seatName={seatName}
              onRespond={noop}
            />
          </Box>
        </State>
        <State label="spectator">
          <Box w={520} h={130}>
            <DrawOfferCard
              offer={{ by: 2, accepted: [1] }}
              viewer={-1}
              seatName={seatName}
              onRespond={noop}
            />
          </Box>
        </State>
      </Group>

      <Group id="game/currency-trade" title="CurrencyTrade" surface="hud">
        <State label="coins, nothing set">
          <div className="w-[440px]">
            <CurrencyTrade
              currencies={[{ key: "coins", held: 4 }]}
              give={{}}
              want={{}}
              onGive={noop}
              onWant={noop}
            />
          </div>
        </State>
        <State label="two purses, amounts set, give at its cap">
          <div className="w-[440px]">
            <CurrencyTrade
              currencies={[
                { key: "gold", held: 2 },
                { key: "coins", held: 5 },
              ]}
              give={{ gold: 2 }}
              want={{ coins: 3 }}
              onGive={noop}
              onWant={noop}
            />
          </div>
        </State>
        <State label="nothing held (give disabled)">
          <div className="w-[440px]">
            <CurrencyTrade
              currencies={[{ key: "wagon_gold", held: 0 }]}
              give={{}}
              want={{ wagon_gold: 1 }}
              onGive={noop}
              onWant={noop}
            />
          </div>
        </State>
      </Group>
    </>
  );
}

// ---- seat choice, piece choice, steal picker ------------------------------

function SeatAndPieceGroups() {
  const robberOpts = [
    { key: "robber" as const, label: "Robber", icon: <RobberGlyph /> },
    { key: "pirate" as const, label: "Pirate", icon: <Icons.ship size={14} /> },
  ];
  return (
    <>
      <Group id="game/seat-choice" title="SeatChoice and SeatChoiceRow" surface="hud">
        <State label="rest">
          <SeatChoice seat={1} name="Teo" color={colorOf(1)} onSelect={noop} />
        </State>
        <State label="with detail">
          <SeatChoice seat={2} name="Ines" color={colorOf(2)} detail="5 cards" onSelect={noop} />
        </State>
        <State label="hover" force="hover">
          <SeatChoice seat={3} name="Bram" color={colorOf(3)} detail="2 cards" onSelect={noop} />
        </State>
        <State label="active" force="active">
          <SeatChoice seat={1} name="Teo" color={colorOf(1)} detail="2 cards" onSelect={noop} />
        </State>
        <State label="focus-visible" force="focus-visible">
          <SeatChoice seat={4} name="Lio" color={colorOf(4)} detail="7 VP" onSelect={noop} />
        </State>
        <State label="disabled">
          <SeatChoice
            seat={5}
            name="Sanne"
            color={colorOf(5)}
            detail="0 cards"
            disabled
            onSelect={noop}
          />
        </State>
        <State label="long two-word bot name">
          <SeatChoice
            seat={6}
            name="Bot Camembert Grandville"
            color={colorOf(6)}
            detail="3 cards"
            onSelect={noop}
          />
        </State>
        <Break />
        <State label="SeatChoiceRow, every seat colour">
          <SeatChoiceRow>
            {NAMES.map((n, s) => (
              <SeatChoice key={s} seat={s} name={n} color={colorOf(s)} onSelect={noop} />
            ))}
          </SeatChoiceRow>
        </State>
      </Group>

      <Group id="game/piece-choice" title="PieceChoice" surface="hud">
        <State label="Move: robber chosen">
          <PieceChoice label="Move:" value="robber" onChange={noop} options={robberOpts} />
        </State>
        <State label="Move: pirate chosen">
          <PieceChoice label="Move:" value="pirate" onChange={noop} options={robberOpts} />
        </State>
        <State label="Place: road chosen">
          <PieceChoice
            label="Place:"
            value="road"
            onChange={noop}
            options={[
              { key: "road", label: "Road", icon: <Icons.road size={14} /> },
              { key: "ship", label: "Ship", icon: <Icons.ship size={14} /> },
            ]}
          />
        </State>
        <State label="no icons">
          <PieceChoice
            label="Place:"
            value="ship"
            onChange={noop}
            options={[
              { key: "road", label: "Road" },
              { key: "ship", label: "Ship" },
            ]}
          />
        </State>
      </Group>

      <Group id="game/steal-picker" title="StealPicker (in Overlay)" surface="hud">
        <State label="three victims">
          <Box w={520} h={300}>
            <StealPicker
              victims={[1, 2, 3]}
              seatName={seatName}
              colorOf={colorOf}
              cardsHeld={(s) => [0, 1, 6, 3][s] ?? 0}
              onPick={noop}
              onBack={noop}
            />
          </Box>
        </State>
        <State label="two victims">
          <Box w={420} h={300}>
            <StealPicker
              victims={[2, 5]}
              seatName={seatName}
              colorOf={colorOf}
              cardsHeld={(s) => (s === 2 ? 9 : 1)}
              onPick={noop}
              onBack={noop}
            />
          </Box>
        </State>
      </Group>
    </>
  );
}

// ---- dialogs -------------------------------------------------------------

function AlchemistDialog() {
  return (
    <Box w={420} h={380}>
      <Overlay title="Alchemist: set the dice">
        <DicePicker onPick={noop} />
      </Overlay>
    </Box>
  );
}

function DialogGroups() {
  return (
    <>
      <Group id="game/overlay" title="Overlay (dialog shell)" surface="hud">
        <State label="title and body, dismissed by the backdrop">
          <Box w={420} h={240}>
            <Overlay title="Monopoly: take all of one resource" onCancel={noop}>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <HudButton key={i}>
                    <ResArt idx={i} size={18} />
                  </HudButton>
                ))}
              </div>
            </Overlay>
          </Box>
        </State>
        <State label="with note">
          <Box w={420} h={260}>
            <Overlay title="Year of Plenty" onCancel={noop}>
              <p className="hud-dialog-note text-center">Take any two resources from the bank.</p>
              <div className="flex justify-center gap-2">
                <HudButton kind="secondary">Wood</HudButton>
                <HudButton kind="secondary">Ore</HudButton>
              </div>
            </Overlay>
          </Box>
        </State>
        <State label="with dismiss button">
          <Box w={420} h={240}>
            <Overlay title="Reset the game?" onCancel={noop} dismissLabel="Close">
              <p className="hud-dialog-note text-center">Everyone returns to the lobby.</p>
              <HudButton kind="danger">Reset</HudButton>
            </Overlay>
          </Box>
        </State>
        <State label="with pinned footer">
          <Box w={420} h={300}>
            <Overlay
              title="Commercial Harbor"
              onCancel={noop}
              dismissLabel="Close"
              footer={
                <>
                  <div className="w-full max-w-80">
                    <DecisionClockView remainingMs={42_000} budgetMs={60_000} />
                  </div>
                  <HudButton kind="primary">Confirm</HudButton>
                </>
              }
            >
              <p className="hud-dialog-note text-center">
                Offer each opponent a resource; each gives you a commodity back.
              </p>
            </Overlay>
          </Box>
        </State>
        <State label="cannot be declined (no exit)">
          <Box w={420} h={240}>
            <Overlay title="Deserter: give up one knight">
              <p className="hud-dialog-note text-center">
                Mara played the Deserter. Pick one of your knights on the board.
              </p>
            </Overlay>
          </Box>
        </State>
        <State label="dismiss button: hover" force="hover">
          <button
            type="button"
            className="hud-dismiss relative grid size-9 shrink-0 place-items-center text-[18px] leading-none"
          >
            <span aria-hidden>×</span>
          </button>
        </State>
      </Group>

      <Group id="game/scenario-dialog" title="ScenarioDialog" surface="hud">
        <State label="body and footer">
          <Box w={560} h={360}>
            <ScenarioDialog title="Wagon trade" onCancel={noop} footer={<MBtn>Load sand</MBtn>}>
              <p className="hudx-note">
                The quarry ships marble and sand. Load one onto your wagon and drive it to a hex
                that takes it.
              </p>
              <MBtn>Load marble</MBtn>
            </ScenarioDialog>
          </Box>
        </State>
      </Group>

      <Group id="game/pillage-buyout" title="PillageBuyoutDialog" surface="hud">
        <State label="can pay, no wealth effect">
          <Box w={440} h={300}>
            <PillageBuyoutDialog
              coins={9}
              afford
              cost={{ losesWealthiest: false, gainsPoorest: false, after: 4 }}
              onPay={noop}
              onStandDown={noop}
            />
          </Box>
        </State>
        <State label="can pay, loses the Wealthiest Settler">
          <Box w={440} h={320}>
            <PillageBuyoutDialog
              coins={6}
              afford
              cost={{ losesWealthiest: true, gainsPoorest: false, after: 1 }}
              onPay={noop}
              onStandDown={noop}
            />
          </Box>
        </State>
        <State label="can pay, takes the Poorest Settler">
          <Box w={440} h={320}>
            <PillageBuyoutDialog
              coins={5}
              afford
              cost={{ losesWealthiest: false, gainsPoorest: true, after: 0 }}
              onPay={noop}
              onStandDown={noop}
            />
          </Box>
        </State>
        <State label="can pay, both tiles">
          <Box w={440} h={320}>
            <PillageBuyoutDialog
              coins={5}
              afford
              cost={{ losesWealthiest: true, gainsPoorest: true, after: 0 }}
              onPay={noop}
              onStandDown={noop}
            />
          </Box>
        </State>
        <State label="cannot pay (disabled)">
          <Box w={440} h={300}>
            <PillageBuyoutDialog
              coins={3}
              afford={false}
              cost={{ losesWealthiest: false, gainsPoorest: false, after: 0 }}
              onPay={noop}
              onStandDown={noop}
            />
          </Box>
        </State>
      </Group>

      <Group id="game/dice-picker" title="DicePicker (Alchemist)" surface="hud">
        <State label="nothing picked">
          <AlchemistDialog />
        </State>
        <State label="white die only">
          <Drive run={click('button[aria-label="White die: 4"]')}>
            <AlchemistDialog />
          </Drive>
        </State>
        <State label="both picked: rolls 9">
          <Drive
            run={clickAll(['button[aria-label="White die: 5"]', 'button[aria-label="Red die: 4"]'])}
          >
            <AlchemistDialog />
          </Drive>
        </State>
        <State label="both picked: a 7">
          <Drive
            run={clickAll(['button[aria-label="White die: 3"]', 'button[aria-label="Red die: 4"]'])}
          >
            <AlchemistDialog />
          </Drive>
        </State>
      </Group>

      <Group id="game/decision-clock" title="DecisionClock" surface="hud">
        <State label="plenty left">
          <div className="w-[300px]">
            <DecisionClockView remainingMs={48_000} budgetMs={60_000} />
          </div>
        </State>
        <State label="running low">
          <div className="w-[300px]">
            <DecisionClockView remainingMs={7_000} budgetMs={60_000} />
          </div>
        </State>
        <State label="no clock (draws nothing)">
          <div className="w-[300px] min-h-4">
            <DecisionClockView remainingMs={null} budgetMs={null} />
            <DecisionClock />
          </div>
        </State>
      </Group>
    </>
  );
}

// ---- cards -----------------------------------------------------------------

const SPY_HAND = ["crane", "intrigue", "merchant_fleet", "irrigation", "bishop", "printer"];

function CardGroups() {
  const anchors = React.useMemo(() => createHudAnchors(), []);
  return (
    <>
      <Group id="game/progress-card-choice" title="ProgressCardChoice" surface="hud">
        <State label="rest">
          <ProgressCardChoice card="crane" onSelect={noop} />
        </State>
        <State label="hover" force="hover">
          <ProgressCardChoice card="merchant_fleet" onSelect={noop} />
        </State>
        <State label="focus-visible" force="focus-visible">
          <ProgressCardChoice card="spy" onSelect={noop} />
        </State>
        <State label="disabled">
          <ProgressCardChoice card="irrigation" disabled onSelect={noop} />
        </State>
        <State label="no art (text fallback)">
          <ProgressCardChoice card="future_card" onSelect={noop} />
        </State>
        <Break />
        <State label="Spy's pick, in a dialog">
          <Box w={420} h={640}>
            <Overlay
              title="Spy: take a progress card from Teo"
              onCancel={noop}
              dismissLabel="Close"
            >
              <div className="flex flex-wrap justify-center gap-2">
                {SPY_HAND.map((c) => (
                  <ProgressCardChoice key={c} card={c} disabled={c === "printer"} onSelect={noop} />
                ))}
              </div>
            </Overlay>
          </Box>
        </State>
      </Group>

      <Group id="game/card-sheet" title="CardSheet (phone card detail)" surface="hud">
        <State label="playable">
          <Box w={340} h={540}>
            <Captured
              render={() =>
                CardSheet({
                  slot: playedCardSlot("dev", "monopoly"),
                  title: "Monopoly",
                  text: "Name a resource. Every other player gives you all of theirs.",
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="refused (note replaces the action)">
          <Box w={340} h={560}>
            <Captured
              render={() =>
                CardSheet({
                  slot: playedCardSlot("dev", "knight"),
                  title: "Knight",
                  text: "Move the robber and steal one card from a player beside it.",
                  note: "You bought this card this turn. Play it from your next turn.",
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="futile (warning above the action)">
          <Box w={340} h={560}>
            <Captured
              render={() =>
                CardSheet({
                  slot: playedCardSlot("dev", "road_building"),
                  title: "Road Building",
                  text: "Place two roads for free.",
                  warn: "You have no roads left to place.",
                  action: { label: "Play it", onAct: noop },
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
        <State label="never played (Victory Point)">
          <Box w={340} h={520}>
            <Captured
              render={() =>
                CardSheet({
                  slot: playedCardSlot("dev", "victory_point"),
                  title: "Victory Point",
                  text: "Worth one point. Kept hidden until it wins you the game.",
                  onClose: noop,
                })
              }
            />
          </Box>
        </State>
      </Group>

      <Group id="game/reveal-dock" title="RevealDock and LastDrawnTab" surface="hud">
        <State label="RevealDock: landed">
          <div className="hud-surf flex items-center gap-2 px-3 py-2">
            <RevealDock
              slot={playedCardSlot("raiders", "treason")}
              anchors={anchors}
              waiting={false}
            />
            <span className="text-[13px] font-semibold text-foreground">
              Treason: move two raiders
            </span>
          </div>
        </State>
        <State label="RevealDock: waiting (card in flight)">
          <div className="hud-surf flex items-center gap-2 px-3 py-2">
            <RevealDock slot={playedCardSlot("raiders", "muster")} anchors={anchors} waiting />
            <span className="text-[13px] font-semibold text-foreground">Muster: place a rider</span>
          </div>
        </State>
        <State label="LastDrawnTab: raiders card">
          <span className="flex items-center gap-1.5 text-foreground text-[13px] font-semibold">
            Teo <LastDrawnTab kind="raiders" id="intrigue" />
          </span>
        </State>
        <State label="LastDrawnTab: development card">
          <span className="flex items-center gap-1.5 text-foreground text-[13px] font-semibold">
            Ines <LastDrawnTab kind="dev" id="swift_journey" />
          </span>
        </State>
      </Group>
    </>
  );
}

// ---- animated layers -----------------------------------------------------

function RevealLoop({ reveal }: { reveal: Omit<Reveal, "key"> }) {
  const anchors = React.useMemo(() => createHudAnchors(), []);
  const hand = React.useRef<HTMLElement | null>(null);
  // Reduced motion: no flight, the face fades in where it is held, holds for
  // 1.5s and fades. Re-issued as it ends, so the held card is nearly always up.
  const batch = useLoop<RevealBatch>(
    (n) => ({ id: n, reveals: [{ ...reveal, key: `${n}:0` }] }),
    1850,
  );
  return (
    <CardRevealLayer
      batch={batch}
      anchors={anchors}
      reduced
      hand={hand}
      seatName={seatName}
      seatColor={colorOf}
    />
  );
}

const REST_FACES: CardFlight["face"][] = [
  { k: "res", idx: 1 },
  { k: "res", idx: 3 },
  { k: "res", idx: 5 },
  { k: "com", idx: 1 },
  { k: "dev" },
  { k: "hidden" },
];

function FlightLoop({ kind }: { kind: "travel" | "rest" }) {
  const anchors = React.useMemo(() => createHudAnchors(), []);
  const flights: CardFlight[] = React.useMemo(
    () =>
      kind === "travel"
        ? [1, 2, 3, 4, 5].map((idx, i) => ({
            from: { k: "bank" },
            to: { k: "seat", seat: 2 },
            face: { k: "res", idx },
            count: 1,
            delayMs: i * 60,
          }))
        : // Each card from and to the same seat: it holds still, showing the
          // face and the count badge.
          REST_FACES.map((face, i) => ({
            from: { k: "seat", seat: i + 1 },
            to: { k: "seat", seat: i + 1 },
            face,
            count: [1, 2, 3, 4, 1, 12][i],
            delayMs: 0,
          })),
    [kind],
  );
  const batch = useLoop<FlightBatch>((n) => ({ id: n, flights }), kind === "travel" ? 900 : 480);
  return (
    <>
      {kind === "travel" ? (
        <>
          <span
            ref={anchors.ref("bank")}
            className="absolute left-6 bottom-6 hud-lab text-foreground"
          >
            bank
          </span>
          <span
            ref={anchors.ref("seat:2")}
            className="absolute right-6 top-6 hud-lab text-foreground"
          >
            Ines
          </span>
        </>
      ) : (
        [1, 2, 3, 4, 5, 6].map((s) => (
          <span
            key={s}
            ref={anchors.ref(`seat:${s}`)}
            className="absolute top-1/2 size-1"
            style={{ left: `${s * 14}%` }}
          />
        ))
      )}
      <CardFlightLayer batch={batch} projector={null} anchors={anchors} viewer={0} />
    </>
  );
}

function LayerGroups() {
  const tall = "calc(42vh + 250px)";
  return (
    <>
      <Group
        id="game/card-reveal-layer"
        title="CardRevealLayer (reduced motion, looped: the held card and its caption)"
        surface="hud"
        wide
      >
        <State label="your card (drew Muster)">
          <Box w={1060} h={tall}>
            <RevealLoop
              reveal={{
                kind: "raiders",
                id: "muster",
                seat: 0,
                mine: true,
                act: "drew",
                from: "shop",
                to: "prompt",
                void: false,
              }}
            />
          </Box>
        </State>
        <State label="an opponent's card (Teo bought Swift Journey)">
          <Box w={1060} h={tall}>
            <RevealLoop
              reveal={{
                kind: "dev",
                id: "swift_journey",
                seat: 1,
                mine: false,
                act: "bought",
                from: "seat",
                to: "seat",
                void: false,
              }}
            />
          </Box>
        </State>
        <State label="a void card (Intrigue, discarded and redrawn)">
          <Box w={1060} h={tall}>
            <RevealLoop
              reveal={{
                kind: "raiders",
                id: "intrigue",
                seat: 2,
                mine: false,
                act: "drew",
                from: "seat",
                to: "log",
                void: true,
              }}
            />
          </Box>
        </State>
      </Group>

      <Group id="game/card-flight-layer" title="CardFlightLayer (looped)" surface="hud">
        <State label="in flight: bank to a seat">
          <Box w={520} h={220}>
            <FlightLoop kind="travel" />
          </Box>
        </State>
        <State label="faces and the count badge (held still)">
          <Box w={520} h={120}>
            <FlightLoop kind="rest" />
          </Box>
        </State>
      </Group>
    </>
  );
}

// ---- anchored menus --------------------------------------------------------

const KNIGHT_ACTIONS: LocationAction[] = [
  {
    id: "activate_knight",
    rank: 1,
    label: "Activate",
    seatLabel: "Activate",
    status: "ready",
    cost: { 4: 1 },
  },
  {
    id: "promote_knight",
    rank: 2,
    label: "Promote to strength 2",
    seatLabel: "Strength 2",
    status: "short",
    cost: { 3: 1, 5: 1 },
    missing: [5],
    reason: "You need 1 more ore.",
  },
  {
    id: "move_knight",
    rank: 3,
    label: "Move",
    seatLabel: "Move",
    status: "blocked",
    reason: "Activate this knight first.",
  },
  {
    id: "chase_robber",
    rank: 4,
    label: "Chase robber",
    seatLabel: "Chase robber",
    status: "blocked",
    reason: "The robber is not next to this knight.",
  },
];

const VERTEX_ACTIONS: LocationAction[] = [
  {
    id: "build_city",
    rank: 1,
    label: "Upgrade to a city",
    seatLabel: "City",
    status: "ready",
    cost: { 4: 2, 5: 3 },
  },
  {
    id: "build_city_wall",
    rank: 2,
    label: "Build a city wall",
    seatLabel: "Wall",
    status: "short",
    cost: { 2: 2 },
    missing: [2],
    reason: "You need 2 more brick.",
  },
];

const SETTLE_ACTION: LocationAction[] = [
  {
    id: "build_settlement",
    rank: 1,
    label: "Build a settlement",
    seatLabel: "Settlement",
    status: "ready",
    cost: { 1: 1, 2: 1, 3: 1, 4: 1 },
  },
];

function Dial({
  actions,
  focus,
  touch,
}: {
  actions: LocationAction[];
  focus?: string;
  touch?: boolean;
}) {
  const thumbs = usePieceThumbnails(colorOf(0));
  const run = React.useCallback(
    (el: HTMLElement) => {
      const card = el.querySelector<HTMLElement>(`[data-action="${focus ?? actions[0].id}"]`);
      if (!card) return;
      if (touch) {
        card.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
        );
        card.click();
      } else card.focus();
    },
    [actions, focus, touch],
  );
  const menu = (
    <Captured
      render={() => {
        // LocationDial renders an AnchoredMenu, which portals; unwrap it so the
        // portal is created inside this render.
        const el = LocationDial({
          actions,
          at: AT_DIAL,
          thumbs,
          onChoose: noop,
          onClose: noop,
        }) as React.ReactElement<React.ComponentProps<typeof AnchoredMenu>>;
        return AnchoredMenu(el.props);
      }}
    />
  );
  return focus || touch ? <Drive run={run}>{menu}</Drive> : menu;
}

function MenuGroups() {
  return (
    <>
      <Group id="game/location-dial" title="LocationDial (the board's location menu)" surface="hud">
        <State label="knight roster, nothing pointed at">
          <Box w={460} h={270}>
            <Dial actions={KNIGHT_ACTIONS} />
          </Box>
        </State>
        <State label="pointed at a card you are short for">
          <Box w={460} h={270}>
            <Dial actions={KNIGHT_ACTIONS} focus="promote_knight" />
          </Box>
        </State>
        <State label="pointed at a blocked card">
          <Box w={460} h={270}>
            <Dial actions={KNIGHT_ACTIONS} focus="chase_robber" />
          </Box>
        </State>
        <State label="pointed at a ready card">
          <Box w={460} h={270}>
            <Dial actions={VERTEX_ACTIONS} focus="build_city" />
          </Box>
        </State>
        <State label="one card, touch: tap again to confirm">
          <Box w={460} h={270}>
            <Dial actions={SETTLE_ACTION} touch />
          </Box>
        </State>
      </Group>

      <Group id="game/anchored-menu" title="AnchoredMenu and PieceInfoCard" surface="hud">
        <State label="AnchoredMenu (bare panel)">
          <Box w={300} h={160}>
            <Captured
              render={() =>
                AnchoredMenu({
                  at: AT_MENU,
                  onClose: noop,
                  children: (
                    <div className="flex flex-col gap-1">
                      <MBtn quiet>Build a road</MBtn>
                      <MBtn quiet>Build a ship</MBtn>
                    </div>
                  ),
                })
              }
            />
          </Box>
        </State>
        <State label="PieceInfoCard: owned piece">
          <Box w={300} h={160}>
            <Captured
              render={() =>
                PieceInfoCard({
                  info: {
                    title: "Knight",
                    owner: 1,
                    facts: ["Strength 2", "Active", "Can chase the robber"],
                  },
                  at: AT_INFO,
                  ownerName: "Teo",
                  ownerColor: colorOf(1),
                })
              }
            />
          </Box>
        </State>
        <State label="PieceInfoCard: neutral, no facts">
          <Box w={300} h={110}>
            <Captured
              render={() => PieceInfoCard({ info: { title: "Robber", facts: [] }, at: AT_INFO })}
            />
          </Box>
        </State>
        <State label="PieceInfoCard: harbour">
          <Box w={300} h={130}>
            <Captured
              render={() =>
                PieceInfoCard({
                  info: { title: "Harbour", facts: ["2 sheep for 1 of anything"] },
                  at: AT_INFO,
                })
              }
            />
          </Box>
        </State>
      </Group>
    </>
  );
}

// ---- Caravans ---------------------------------------------------------------

const camelHand: Hand = [0, 0, 0, 3, 2, 0];

function camelBid(o: Partial<React.ComponentProps<typeof CamelBidPanel>> = {}) {
  return (
    <CamelBidPanel
      board={caravanBoard}
      ext={caravanExt}
      buildings={caravanBuildings}
      colorOf={colorOf}
      hand={camelHand}
      paths={camelPaths}
      pending={[]}
      seatName={seatName}
      onBid={noop}
      onClose={noop}
      {...o}
    />
  );
}

function camelPlace(ext: CaravansExt) {
  return (
    <CamelPlacePanel
      board={caravanBoard}
      ext={ext}
      buildings={caravanBuildings}
      colorOf={colorOf}
      paths={camelPaths}
      onPlace={noop}
      onClose={noop}
    />
  );
}

function CaravanGroups() {
  const voting: CaravansExt = {
    ...caravanExt,
    voting: true,
    finisher: 3,
    placer: -1,
    bidded: [3, 1],
    bids: [
      { player: 3, cards: [2, 0], path: camelPaths[0] },
      { player: 1, cards: [0, 0] },
    ],
  };
  const plusA = click('[data-camel-bid-plus="3"]');
  const plusB = click('[data-camel-bid-plus="4"]');
  const stepAndName = seq([
    plusA,
    plusA,
    plusB,
    (el) => el.querySelectorAll<HTMLElement>("[data-camel-bid-path]")[1]?.click(),
  ]);
  const atCap = seq([plusA, plusA, plusA, plusB, plusB, click("details summary")]);
  return (
    <>
      <Group id="game/camel-bid" title="CamelBidPanel (Caravans vote)" surface="hud" wide>
        <State label="first to bid, nothing named">
          <Box w={520} h={760}>
            {camelBid({ paths: [], pending: [1, 2] })}
          </Box>
        </State>
        <State label="bids cast, others waiting, placements offered">
          <Box w={520} h={760}>
            {camelBid({ ext: voting, pending: [2] })}
          </Box>
        </State>
        <State label="votes stepped up, a placement named">
          <Drive run={stepAndName}>
            <Box w={520} h={760}>
              {camelBid({ ext: voting, pending: [2] })}
            </Box>
          </Drive>
        </State>
        <State label="at the hand cap (plus disabled), explainer open">
          <Drive run={atCap}>
            <Box w={520} h={760}>
              {camelBid({ ext: voting })}
            </Box>
          </Drive>
        </State>
        <State label="answer sent (buttons locked)">
          <Drive run={click("[data-camel-bid-abstain]")}>
            <Box w={520} h={760}>
              {camelBid({ ext: voting })}
            </Box>
          </Drive>
        </State>
        <State label="Knights: bid in lumber and brick">
          <Box w={520} h={760}>
            {camelBid({
              ext: { ...caravanExt, bid_resources: ["wood", "brick"] },
              hand: [0, 4, 1, 0, 0, 0],
            })}
          </Box>
        </State>
      </Group>

      <Group id="game/camel-place" title="CamelPlacePanel" surface="hud" wide>
        <State label="won the vote, choose a placement">
          <Box w={520} h={640}>
            {camelPlace({
              ...caravanExt,
              placer: 0,
              finisher: 3,
              bids: [
                { player: 0, cards: [3, 1] },
                { player: 1, cards: [1, 0] },
              ],
            })}
          </Box>
        </State>
        <State label="the placement named in the bid, lit">
          <Box w={520} h={640}>
            {camelPlace({
              ...caravanExt,
              placer: 0,
              finisher: 0,
              bids: [{ player: 0, cards: [2, 0], path: camelPaths[1] }],
            })}
          </Box>
        </State>
        <State label="placed (rows locked)">
          <Drive run={click("[data-camel-path]")}>
            <Box w={520} h={640}>
              {camelPlace({ ...caravanExt, placer: 0, finisher: 2 })}
            </Box>
          </Drive>
        </State>
      </Group>

      <Group id="game/camel-map" title="CamelMap" surface="hud">
        <State label="camels and buildings">
          <CamelMap
            board={caravanBoard}
            ext={caravanExt}
            buildings={caravanBuildings}
            colorOf={colorOf}
            className="w-70 h-45"
          />
        </State>
        <State label="with candidates">
          <CamelMap
            board={caravanBoard}
            ext={caravanExt}
            candidates={camelPaths}
            className="w-70 h-45"
          />
        </State>
        <State label="one candidate highlighted">
          <CamelMap
            board={caravanBoard}
            ext={caravanExt}
            candidates={camelPaths}
            highlight={camelPaths[0] ? camelPathKey(camelPaths[0]) : null}
            className="w-70 h-45"
          />
        </State>
        <State label="caravan colours">
          <span className="flex gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <span
                key={i}
                className="size-4 rounded-full"
                style={{ background: caravanColor(i) }}
              />
            ))}
          </span>
        </State>
      </Group>
    </>
  );
}

// ---- Explorers --------------------------------------------------------------

const xa = { q: 0, r: 0, side: 0 } as const;
const xb = { q: 0, r: 0, side: 1 } as const;

function explorersView(movement: boolean, change?: (x: Record<string, unknown>) => void): FullView {
  const x: Record<string, unknown> = {
    movement,
    anchors: [],
    ships: [
      { id: 1, owner: 0, e: { a: xa, b: xb }, left: 4, hold: { haul: 1 } },
      {
        id: 4,
        owner: 0,
        e: { a: xa, b: xb },
        left: 0,
        hold: { crew: 1, spice: 1 },
        moved: true,
      },
    ],
    seats: [
      {
        gold: 4,
        track: [2, 1, 3],
        villages: [[], [], []],
        gold_buys: 0,
        fast_gold: 0,
        mission_vp: 3,
        ships_left: 2,
        settlers_left: 2,
        crews_left: 4,
        harbours_left: 2,
      },
    ],
    harbours: [{ v: xa, owner: 0, basin: { settler: 1 } }],
  };
  change?.(x);
  return {
    ...previewView,
    config: { ...previewView.config, ruleset: "base+explorers" },
    players: [{ ...previewView.players[0], hand: [0, 4, 4, 4, 4, 4] }],
    bank: [0, 19, 0, 19, 19, 19],
    ext: { explorers: x },
  } as unknown as FullView;
}

function explorers(view: FullView) {
  return <ExplorersPanel view={view} seat={0} onArm={noop} onSend={noop} onClose={noop} />;
}

function ExplorerGroups() {
  const openAll = (el: HTMLElement) =>
    el.querySelectorAll<HTMLElement>("summary").forEach((s) => s.click());
  return (
    <>
      <Group id="game/explorers-panel" title="ExplorersPanel" surface="hud" wide>
        <State label="Action phase">
          <Box w={540} h={800}>
            {explorers(explorersView(false))}
          </Box>
        </State>
        <State label="Action phase, disclosures open">
          <Drive run={openAll}>
            <Box w={540} h={800}>
              {explorers(explorersView(false))}
            </Box>
          </Drive>
        </State>
        <State label="Movement phase, away from the Council">
          <Box w={540} h={720}>
            {explorers(explorersView(true))}
          </Box>
        </State>
        <State label="Movement, docked at the Council, speed bought">
          <Box w={540} h={720}>
            {explorers(
              explorersView(true, (x) => {
                x.anchors = [xa];
                (x.ships as { sped?: boolean }[])[0].sped = true;
              }),
            )}
          </Box>
        </State>
      </Group>

      <Group
        id="game/explorer-cargo"
        title="ExplorerCargoPanel, CargoSlots, ShipHold"
        surface="hud"
      >
        <State label="ExplorerCargoPanel">
          <div className="hud-dialog w-[480px] p-4">
            <ExplorerCargoPanel view={explorersView(false)} seat={0} onSend={noop} />
          </div>
        </State>
        <State label="ExplorerCargoPanel: supply nearly gone, no gold">
          <div className="hud-dialog w-[480px] p-4">
            <ExplorerCargoPanel
              view={explorersView(false, (x) => {
                const s = (x.seats as Record<string, number>[])[0];
                s.settlers_left = 0;
                s.crews_left = 1;
                s.gold = 0;
              })}
              seat={0}
              onSend={noop}
            />
          </div>
        </State>
        <Break />
        <State label="CargoSlots: empty">
          <CargoSlots cargo={{}} />
        </State>
        <State label="CargoSlots: one small">
          <CargoSlots cargo={{ crew: 1 }} />
        </State>
        <State label="CargoSlots: two small">
          <CargoSlots cargo={{ crew: 1, spice: 1 }} />
        </State>
        <State label="CargoSlots: settler">
          <CargoSlots cargo={{ settler: 1 }} />
        </State>
        <State label="CargoSlots: fish haul">
          <CargoSlots cargo={{ haul: 1 }} />
        </State>
        <Break />
        <State label="ShipHold: empty">
          <span className="text-[13px] text-foreground">
            <ShipHold ship={{ id: 1, owner: 0, e: { a: xa, b: xb }, left: 3, hold: {} }} />
          </span>
        </State>
        <State label="ShipHold: mixed">
          <span className="text-[13px] text-foreground">
            <ShipHold
              ship={{ id: 1, owner: 0, e: { a: xa, b: xb }, left: 3, hold: { crew: 1, spice: 1 } }}
            />
          </span>
        </State>
      </Group>
    </>
  );
}

// ---- Fishermen --------------------------------------------------------------

const fishView = (ruleset: string) =>
  ({
    config: { ruleset },
    ext: {},
    board: { tiles: [{ hex: { q: 0, r: 0 }, res: "wood", num: 5 }], robber: { q: 0, r: 0 } },
    legal: { roads: [{ a: { q: 0, r: 0, d: 0 }, b: { q: 1, r: 0, d: 0 } }] },
    players: [{}, {}, {}],
  }) as unknown as FullView;

function fishPanel(
  mix: FishMix,
  o: Partial<React.ComponentProps<typeof FishSpendPanel>> = {},
  ruleset = "base+fishermen",
) {
  const fv = fishView(ruleset);
  return (
    <FishSpendPanel
      offers={fishOffers(fv, gameCaps(fv), mix, true)}
      mix={mix}
      onSpend={noop}
      onClose={noop}
      {...o}
    />
  );
}

function FishGroups() {
  return (
    <>
      <Group id="game/fish-spend" title="FishSpendPanel" surface="hud" wide>
        <State label="no fish">
          <Box w={500} h={640}>
            {fishPanel([0, 0, 0])}
          </Box>
        </State>
        <State label="some fish, no rung chosen">
          <Box w={500} h={640}>
            {fishPanel([2, 1, 1])}
          </Box>
        </State>
        <State label="rung chosen">
          <Drive run={click("[data-fish-spend]:not([disabled])")}>
            <Box w={500} h={700}>
              {fishPanel([2, 1, 1])}
            </Box>
          </Drive>
        </State>
        <State label="chosen rung wastes fish">
          <Drive run={click("[data-fish-spend]:not([disabled])")}>
            <Box w={500} h={700}>
              {fishPanel([0, 0, 2])}
            </Box>
          </Drive>
        </State>
        <State label="holding the boot, Raiders hurry note">
          <Box w={500} h={720}>
            {fishPanel([1, 2, 0], { onGiveBoot: noop, riderHurry: true }, "base+fishermen+raiders")}
          </Box>
        </State>
        <State label="Knights: progress-card rung">
          <Box w={500} h={660}>
            {fishPanel([3, 2, 2], {}, "base+cak+fishermen")}
          </Box>
        </State>
      </Group>

      <Group id="game/fish-tiles" title="TilesSpent" surface="hud">
        <State label="nothing (unaffordable)">
          <TilesSpent pay={null} />
        </State>
        <State label="one 1-fish">
          <TilesSpent pay={[1, 0, 0]} />
        </State>
        <State label="mixed">
          <TilesSpent pay={[2, 1, 1]} />
        </State>
        <State label="two 3-fish">
          <TilesSpent pay={[0, 0, 2]} />
        </State>
      </Group>
    </>
  );
}

// ---- Raiders ---------------------------------------------------------------

function goldPanel(o: {
  gold: number;
  buysLeft: number;
  bank?: number[];
  hand?: Hand;
  extra?: React.ReactNode;
}) {
  const gv = {
    ext: { raiders: { gold: [o.gold, 0], gold_buys_left: o.buysLeft } },
    bank: o.bank ?? [0, 5, 5, 5, 5, 5],
    bank_ratios: [0, 4, 4, 2, 4, 3],
    players: [{ seat: 0 }, { seat: 1 }],
  } as unknown as FullView;
  return (
    <RaidersGoldPanel
      gold={o.gold}
      buysLeft={o.buysLeft}
      buys={goldBuyOffers(gv, 0)}
      sells={goldSellOffers(gv, o.hand ?? [0, 4, 1, 3, 0, 2])}
      onBuy={noop}
      onSell={noop}
      onClose={noop}
      extra={o.extra}
    />
  );
}

const RIDERS: RiderMoves[] = [
  { from: edge(0), to: [edge(1), edge(2)], hurry: [edge(3)] },
  { from: edge(-2, 1), to: [edge(-1, 1)] },
  { from: edge(1, -2), to: [] },
];

function RaiderGroups() {
  const threat = coastThreat(raidersView());
  const coast = threat ? <RaidersCoast board={pBoard} threat={threat} /> : null;
  const knightsThreat = coastThreat(raidersView({ conquered: [] }, "base+cak+raiders"));
  const counts = raidersExt.raider_count ?? [];
  const sources = ring2.filter((_, i) => (counts[i] ?? 0) > 0);
  const dests = ring2.filter((_, i) => (counts[i] ?? 0) === 0 && i !== 5).slice(0, 5);
  const pick = (h: Hex | undefined) => `[data-raiders-pick="${h ? hexKey(h) : ""}"]`;
  const treason = (card?: React.ReactNode) => (
    <RaidersTreasonPanel
      board={pBoard}
      ext={raidersExt}
      sources={sources}
      destinations={dests}
      count={2}
      onPlan={noop}
      onClose={noop}
      card={card}
    />
  );
  return (
    <>
      <Group id="game/raiders-gold" title="RaidersGoldPanel" surface="hud" wide>
        <State label="gold to spend, cards to sell">
          <Box w={520} h={680}>
            {goldPanel({ gold: 6, buysLeft: 2 })}
          </Box>
        </State>
        <State label="no gold, empty hand">
          <Box w={520} h={620}>
            {goldPanel({ gold: 0, buysLeft: 2, hand: [0, 0, 0, 0, 0, 0] })}
          </Box>
        </State>
        <State label="buys used up, bank out of ore">
          <Box w={520} h={620}>
            {goldPanel({ gold: 5, buysLeft: 0, bank: [0, 5, 5, 5, 5, 0] })}
          </Box>
        </State>
        <State label="with the coast readout">
          <Box w={520} h={780}>
            {goldPanel({ gold: 4, buysLeft: 1, extra: coast })}
          </Box>
        </State>
      </Group>

      <Group id="game/raiders-riders" title="RaidersRidersPanel" surface="hud" wide>
        <State label="riders to move, one stuck">
          <Box w={520} h={580}>
            <RaidersRidersPanel moves={RIDERS} grain={2} onChoose={noop} onClose={noop} />
          </Box>
        </State>
        <State label="no wheat for the hurry, fish can pay">
          <Box w={520} h={580}>
            <RaidersRidersPanel
              moves={RIDERS.slice(0, 2)}
              grain={0}
              fishHurry
              onChoose={noop}
              onClose={noop}
            />
          </Box>
        </State>
        <State label="a rider must leave the castle">
          <Box w={520} h={580}>
            <RaidersRidersPanel
              moves={[{ from: edge(0), to: [edge(1)], must_leave: true }, RIDERS[1]]}
              grain={1}
              onChoose={noop}
              onClose={noop}
            />
          </Box>
        </State>
        <State label="none can move, gold line and coast">
          <Box w={520} h={640}>
            <RaidersRidersPanel
              moves={[]}
              grain={1}
              gold={{ gold: 3, buysLeft: 2, onOpen: noop }}
              extra={coast}
              onChoose={noop}
              onClose={noop}
            />
          </Box>
        </State>
      </Group>

      <Group id="game/raiders-treason" title="RaidersTreasonPanel" surface="hud" wide>
        <State label="nothing picked">
          <Box w={540} h={700}>
            {treason()}
          </Box>
        </State>
        <State label="first move half built">
          <Drive run={svgClick([pick(sources[0])])}>
            <Box w={540} h={700}>
              {treason()}
            </Box>
          </Drive>
        </State>
        <State label="plan complete (send enabled)">
          <Drive
            run={svgClick([
              pick(sources[0]),
              pick(dests[0]),
              pick(sources[1] ?? sources[0]),
              pick(dests[1]),
            ])}
          >
            <Box w={540} h={700}>
              {treason()}
            </Box>
          </Drive>
        </State>
        <State label="with the turned-over card">
          <Box w={540} h={720}>
            {treason(
              <CardFace
                slot={playedCardSlot("raiders", "treason")}
                className="hud-card-frame w-16 overflow-hidden"
              />,
            )}
          </Box>
        </State>
      </Group>

      <Group id="game/raiders-map" title="RaidersMap and RaidersCoast" surface="hud">
        <State label="RaidersMap: picture">
          <RaidersMap board={pBoard} ext={raidersExt} className="w-70 h-60" />
        </State>
        <State label="RaidersMap: sources and destinations">
          <RaidersMap
            board={pBoard}
            ext={raidersExt}
            sources={sources}
            destinations={dests}
            onPick={noop}
            pickLabel={() => "Take a raider from here"}
            className="w-70 h-60"
          />
        </State>
        <State label="RaidersMap: a pair chosen">
          <RaidersMap
            board={pBoard}
            ext={raidersExt}
            sources={sources}
            destinations={dests}
            chosen={[sources[0], dests[0]].filter((h): h is Hex => !!h)}
            onPick={noop}
            className="w-70 h-60"
          />
        </State>
        <Break />
        <State label="RaidersCoast: threats, conquered, supply">
          <div className="modp-panel w-[320px]">{coast}</div>
        </State>
        <State label="RaidersCoast: clear">
          <div className="modp-panel w-[320px]">
            <RaidersCoast board={pBoard} threat={{ hexes: [], conquered: 0, supply: 18 }} />
          </div>
        </State>
        <State label="RaidersCoast: with Knights (no supply)">
          <div className="modp-panel w-[320px]">
            {knightsThreat && <RaidersCoast board={pBoard} threat={knightsThreat} />}
          </div>
        </State>
      </Group>
    </>
  );
}

// ---- Rivers ---------------------------------------------------------------

function riverView(over: Record<string, unknown> = {}, bank = [0, 19, 19, 19, 19, 19]): FullView {
  return {
    ext: { rivers: { coins: [4], coin_per_res: 2, spends_left: 2, ...over } },
    bank,
    bank_ratios: [0, 4, 3, 2, 4, 4],
  } as unknown as FullView;
}

function rivers(rv: FullView, held: (i: number) => number, onTurn = true) {
  return (
    <RiverCoinsPanel
      trades={coinTrades(rv, 0, held, onTurn)}
      onBuy={noop}
      onSpend={noop}
      onClose={noop}
    />
  );
}

function RiverGroups() {
  return (
    <Group id="game/river-coins" title="RiverCoinsPanel" surface="hud" wide>
      <State label="on your turn, coins to spend">
        <Box w={520} h={660}>
          {rivers(riverView(), () => 4)}
        </Box>
      </State>
      <State label="no coins, a resource you lack">
        <Box w={520} h={660}>
          {rivers(riverView({ coins: [0] }), (i) => (i === 2 ? 0 : 3))}
        </Box>
      </State>
      <State label="purchases used up">
        <Box w={520} h={660}>
          {rivers(riverView({ coins: [7], spends_left: 0 }), () => 2)}
        </Box>
      </State>
      <State label="not your turn">
        <Box w={520} h={660}>
          {rivers(riverView(), () => 4, false)}
        </Box>
      </State>
      <State label="bank out of brick">
        <Box w={520} h={660}>
          {rivers(riverView({}, [0, 19, 0, 19, 19, 19]), () => 4)}
        </Box>
      </State>
    </Group>
  );
}

// ---- Wagons ----------------------------------------------------------------

const TRADE = [
  {
    hex: { q: -2, r: 2 },
    role: ROLE.castle,
    plaza: { q: -2, r: 2, side: 2 },
    accepts: [CARGO.marble, CARGO.glass],
    ships: [CARGO.tools, CARGO.sand],
    left: 12,
  },
  {
    hex: { q: 0, r: -2 },
    role: ROLE.quarry,
    plaza: { q: 0, r: -2, side: 2 },
    accepts: [CARGO.tools],
    ships: [CARGO.marble, CARGO.sand],
    left: 12,
  },
  {
    hex: { q: 2, r: 0 },
    role: ROLE.glassworks,
    plaza: { q: 2, r: 0, side: 2 },
    accepts: [CARGO.sand],
    ships: [CARGO.glass, CARGO.tools],
    left: 12,
  },
];

const WAGON_BASE = {
  has_trade: true,
  started: true,
  turn_seat: 0,
  barb_seat: -1,
  barb_index: -1,
  gold: [5],
  level: [1],
  cargo: [CARGO.none],
  delivered: [0],
  mp_track: [4, 5, 6, 7, 7],
  drive_floors: [7, 6, 5, 4, 3],
  gold_price: 2,
  buys_a_turn: 2,
  bought: 0,
  trade: TRADE,
  wagons: [{ player: 0, v: { q: 0, r: 0, side: 0 } }],
  barbarians: [
    { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } },
    { a: { q: 0, r: 0, side: 0 }, b: { q: 1, r: 0, side: 1 } },
    { a: { q: 2, r: 0, side: 0 }, b: { q: 2, r: 0, side: 1 } },
  ],
} as unknown as Partial<WagonsExt>;

function wagon(ext: Partial<WagonsExt>, o: { ruleset?: string; driving?: boolean } = {}) {
  const view = {
    config: { ruleset: o.ruleset ?? "base+wagons" },
    board: {
      tiles: [
        { hex: { q: -2, r: 2 }, res: "none", num: 0 },
        { hex: { q: 0, r: -2 }, res: "wheat", num: 6 },
        { hex: { q: 2, r: 0 }, res: "ore", num: 5 },
      ],
    },
    ext: { wagons: ext },
    players: [{ hand: [0, 4, 4, 4, 4, 4] }],
    bank: [0, 19, 19, 19, 19, 19],
    legal: { wagon_steps: [{ q: 1, r: 0, side: 0 }] },
  } as unknown as FullView;
  return (
    <WagonPanel
      view={view}
      seat={0}
      driving={o.driving}
      onMove={noop}
      onHalt={noop}
      onBoost={noop}
      onCharge={noop}
      onUpgrade={noop}
      onBuy={noop}
      onSell={noop}
      onSwift={noop}
      onClose={noop}
    />
  );
}

function WagonGroups() {
  return (
    <Group id="game/wagon-panel" title="WagonPanel" surface="hud" wide>
      <State label="empty wagon, start of turn">
        <Box w={520} h={740}>
          {wagon(WAGON_BASE)}
        </Box>
      </State>
      <State label="driving (armed), carrying sand">
        <Box w={520} h={740}>
          {wagon({ ...WAGON_BASE, cargo: [CARGO.sand] }, { driving: true })}
        </Box>
      </State>
      <State label="level 3, a barbarian to charge, one tried">
        <Box w={520} h={740}>
          {wagon({ ...WAGON_BASE, level: [3], tried: [true, false, false] })}
        </Box>
      </State>
      <State label="boosted, gold buys spent, Swift Journey held">
        <Box w={520} h={740}>
          {wagon({ ...WAGON_BASE, boosted: true, bought: 2, swift: 1 })}
        </Box>
      </State>
      <State label="moved, Swift Journey bought this turn (locked)">
        <Box w={520} h={740}>
          {wagon({ ...WAGON_BASE, moved: true, move_done: true, swift: 0, swift_new: 1 })}
        </Box>
      </State>
      <State label="level 5, little gold">
        <Box w={520} h={740}>
          {wagon({ ...WAGON_BASE, level: [5], gold: [1], delivered: [4] })}
        </Box>
      </State>
      <State label="with Rivers (coins) and Fishermen">
        <Box w={520} h={740}>
          {wagon(
            { ...WAGON_BASE, shared_currency: true },
            { ruleset: "base+fishermen+rivers+wagons" },
          )}
        </Box>
      </State>
    </Group>
  );
}

// ---- post-game --------------------------------------------------------------

function stat(over: Partial<PlayerStat> & { seat: number; vp: number }): PlayerStat {
  return {
    settlements: 0,
    cities: 0,
    roads: 0,
    knights: 0,
    dev_cards: 0,
    longest_road: 0,
    has_longest_road: false,
    has_largest_army: false,
    produced: 0,
    expected: 0,
    robber_loss: 0,
    stolen: 0,
    steals: 0,
    bank_trades: 0,
    player_trades: 0,
    luck_rel: 0,
    ...over,
  };
}

const bd = (o: Partial<NonNullable<PlayerStat["vp_breakdown"]>>) => ({
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

const PG_PLAYERS: PlayerStat[] = [
  stat({
    seat: 0,
    vp: 10,
    settlements: 2,
    cities: 3,
    roads: 11,
    knights: 1,
    dev_cards: 4,
    longest_road: 8,
    has_longest_road: true,
    produced: 61,
    expected: 54.2,
    robber_loss: 4,
    stolen: 2,
    steals: 3,
    bank_trades: 5,
    player_trades: 4,
    luck_rel: 0.13,
    vp_breakdown: bd({ settlements: 2, cities: 6, longest_road: 2 }),
  }),
  stat({
    seat: 1,
    vp: 8,
    settlements: 2,
    cities: 2,
    roads: 7,
    knights: 3,
    dev_cards: 5,
    longest_road: 5,
    has_largest_army: true,
    produced: 49,
    expected: 51.8,
    robber_loss: 7,
    stolen: 3,
    steals: 4,
    bank_trades: 3,
    player_trades: 6,
    luck_rel: -0.05,
    vp_breakdown: bd({ settlements: 2, cities: 4, largest_army: 2 }),
  }),
  stat({
    seat: 2,
    vp: 7,
    settlements: 3,
    cities: 2,
    roads: 8,
    dev_cards: 2,
    longest_road: 6,
    produced: 44,
    expected: 47.1,
    robber_loss: 2,
    stolen: 1,
    steals: 1,
    bank_trades: 7,
    player_trades: 2,
    luck_rel: -0.07,
    vp_breakdown: bd({ settlements: 3, cities: 4 }),
  }),
  stat({
    seat: 3,
    vp: 4,
    settlements: 4,
    roads: 6,
    dev_cards: 1,
    longest_road: 3,
    produced: 31,
    expected: 39.5,
    robber_loss: 9,
    stolen: 4,
    bank_trades: 2,
    player_trades: 3,
    luck_rel: -0.22,
    vp_breakdown: bd({ settlements: 4 }),
  }),
];

const PG_ROLLS: Record<number, number> = {
  2: 2,
  3: 4,
  4: 6,
  5: 9,
  6: 11,
  7: 12,
  8: 10,
  9: 8,
  10: 6,
  11: 3,
  12: 1,
};

/** Four seats climbing from 2 to their final scores over 18 turns, unevenly. */
const PG_TRACK: number[][] = Array.from({ length: 19 }, (_, t) =>
  [10, 8, 7, 4].map((end, s) => {
    const pace = [1, 1.3, 0.9, 1.6][s];
    return Math.min(end, 2 + Math.floor((end - 2) * Math.pow(t / 18, pace)));
  }),
);

/**
 * The end-of-game panel that routes/Game.tsx wraps the scoreboard in is not
 * exported; this is its dialog surface and heading, around the real scoreboard.
 */
function PostGameShell({ winner, children }: { winner: number; children: React.ReactNode }) {
  return (
    <div className="hud-dialog w-[840px] max-w-full rounded-[20px] p-6 flex flex-col items-center gap-5">
      <div className="font-display text-[26px] font-heavy text-center text-foreground">
        {winner >= 0 ? `${seatName(winner)} wins!` : "It's a draw"}
      </div>
      {children}
    </div>
  );
}

function scoreboard(o: Partial<React.ComponentProps<typeof PostGameScoreboard>> = {}) {
  return (
    <PostGameScoreboard
      players={PG_PLAYERS}
      winner={0}
      caps={rulesetCaps("base")}
      seatName={seatName}
      colorOf={colorOf}
      rolls={PG_ROLLS}
      vpTrack={PG_TRACK}
      targetVP={10}
      diceMode="random"
      {...o}
    />
  );
}

function PostGameGroups() {
  return (
    <>
      <Group
        id="game/postgame-overview"
        title="PostGameScoreboard: overview (winner row, standings, charts)"
        surface="hud"
        wide
      >
        <State label="winner, standings, rolls and race">
          <PostGameShell winner={0}>{scoreboard()}</PostGameShell>
        </State>
      </Group>
      <Group id="game/postgame-details" title="PostGameScoreboard: details tab" surface="hud" wide>
        <State label="details matrix">
          <Drive run={(el) => el.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click()}>
            <PostGameShell winner={0}>{scoreboard()}</PostGameShell>
          </Drive>
        </State>
      </Group>
      <Group
        id="game/postgame-variants"
        title="PostGameScoreboard: draw, no race, empty"
        surface="hud"
        wide
      >
        <State label="draw, balanced dice, no race recorded">
          <PostGameShell winner={-1}>
            {scoreboard({ winner: -1, vpTrack: undefined, diceMode: "fair" })}
          </PostGameShell>
        </State>
        <State label="standings unavailable">
          <PostGameShell winner={1}>{scoreboard({ players: [], winner: 1 })}</PostGameShell>
        </State>
      </Group>
      <Group id="game/charts" title="RollChart and VPChart" surface="hud" wide>
        <State label="RollChart: random dice">
          <div className="hud-dialog w-[520px] p-4">
            <RollChart rolls={PG_ROLLS} diceMode="random" />
          </div>
        </State>
        <State label="RollChart: balanced dice">
          <div className="hud-dialog w-[520px] p-4">
            <RollChart rolls={PG_ROLLS} diceMode="fair" />
          </div>
        </State>
        <State label="RollChart: nobody rolled">
          <div className="hud-dialog w-[520px] p-4">
            <RollChart rolls={{}} />
          </div>
        </State>
        <State label="VPChart: four seats to 10">
          <div className="hud-dialog w-[520px] p-4">
            <VPChart
              track={PG_TRACK}
              winner={0}
              seatName={seatName}
              colorOf={colorOf}
              target={10}
            />
          </div>
        </State>
      </Group>
      <Group id="game/table-closed" title="TableClosedScreen" surface="ground">
        <State label="table closed">
          <div className="w-[520px] h-[380px]">
            <TableClosedScreen g="demo" />
          </div>
        </State>
      </Group>
    </>
  );
}

// ---- PlayerCard ------------------------------------------------------------

const PC_BASE: PlayerCardData = {
  seat: 0,
  name: "Mara",
  color: colorOf(0),
  vp: 7,
  active: false,
  handCount: 4,
  devCount: 2,
  knightsPlayed: 1,
  routeLength: 5,
  longestRoad: false,
  longestRoadLabel: "ROAD",
  largestArmy: false,
  islandVp: 0,
  islands: false,
  harbormaster: false,
  harbourPoints: 0,
  hasHarbormaster: false,
};

const pc = (seat: number, over: Partial<PlayerCardData> = {}): PlayerCardData => ({
  ...PC_BASE,
  seat,
  name: seatName(seat),
  color: colorOf(seat),
  ...over,
});

function PlayerCardGroups() {
  return (
    <Group id="game/player-card" title="PlayerCard" surface="hud" wide>
      <State label="idle">
        <div className="w-[252px]">
          <PlayerCard p={pc(0)} />
        </div>
      </State>
      <State label="active, mine, both awards">
        <div className="w-[252px]">
          <PlayerCard
            p={pc(0, { active: true, mine: true, longestRoad: true, largestArmy: true, vp: 9 })}
          />
        </div>
      </State>
      <State label="over the discard limit">
        <div className="w-[252px]">
          <PlayerCard p={pc(1, { handCount: 9 })} />
        </div>
      </State>
      <State label="micro density">
        <div className="w-[252px]">
          <PlayerCard p={pc(2)} density="micro" />
        </div>
      </State>
      <State label="memory mode">
        <div className="w-[252px]">
          <PlayerCard p={pc(3)} memory />
        </div>
      </State>
      <State label="Raiders counters, last-drawn tab">
        <div className="w-[252px]">
          <PlayerCard
            p={pc(4, {
              devDeckInPlay: false,
              largestArmyInPlay: false,
              gold: 3,
              prisoners: 1,
              prisonersPerVp: 2,
              ridersOut: 2,
              ridersPerSeat: 6,
            })}
            tab={<LastDrawnTab kind="raiders" id="muster" />}
          />
        </div>
      </State>
      <State label="Knights variant">
        <div className="w-[252px]">
          <PlayerCard
            variant="knights"
            p={pc(5, {
              knights: {
                commodityCount: 3,
                progressCount: 2,
                knightsActive: 2,
                knightsTotal: 3,
                defenderVp: 1,
                extraVp: 0,
                tracks: [],
              },
            })}
          />
        </div>
      </State>
      <State label="Islands, Fishermen, Harbormaster">
        <div className="w-[252px]">
          <PlayerCard
            p={pc(6, {
              islands: true,
              islandVp: 2,
              fishermen: true,
              fish: 3,
              harbormaster: true,
              harbourPoints: 3,
              hasHarbormaster: true,
            })}
          />
        </div>
      </State>
      <State label="Wagons and Explorers counters">
        <div className="w-[252px]">
          <PlayerCard
            p={pc(7, {
              longestRoadInPlay: false,
              wagonLevel: 3,
              deliveries: 2,
              ships: 2,
              missionVp: 3,
              gold: 5,
            })}
          />
        </div>
      </State>
    </Group>
  );
}

// ---- small parts: Stat, Award, TrackPips, ChatText, LogTokens, CostChips --

function SmallPartsGroups() {
  const icons = usePieceIcons([colorOf(0), colorOf(1), colorOf(2)]);
  return (
    <>
      <Group id="game/stat-award" title="Stat and Award" surface="hud">
        <State label="Stat">
          <Stat icon={<Icons.hand />} value={4} title="Cards in hand" hint="Resource cards held." />
        </State>
        <State label="Stat: hot (over the limit)">
          <Stat icon={<Icons.hand />} value={9} title="Cards in hand" hot />
        </State>
        <State label="Stat: toned">
          <Stat icon={<Icons.gold />} value={5} title="Gold" tone="var(--color-amber)" />
        </State>
        <State label="Stat: focus-visible" force="focus-visible">
          <Stat icon={<Icons.knight />} value="2/3" title="Knights" />
        </State>
        <Break />
        <State label="Award: held">
          <Award icon={<Icons.road />} title="Longest Road" label="2" name="longest_road" />
        </State>
        <State label="Award: not held">
          <Award
            icon={<Icons.knightShield />}
            title="Largest Army"
            label="2"
            name="largest_army"
            held={false}
          />
        </State>
        <State label="Award: captioned">
          <Award
            icon={<Icons.road />}
            title="Longest Road"
            label="2"
            name="longest_road"
            caption="Longest Road"
          />
        </State>
        <State label="Award: penalty, held">
          <Award icon={<Icons.boot />} title="Old boot" label="-1" name="boot" penalty />
        </State>
      </Group>

      <Group id="game/track-pips" title="TrackPips" surface="hud">
        {COMMOD.map((c) => (
          <React.Fragment key={c.key}>
            {[0, 2, 5].map((lvl) => (
              <State key={lvl} label={`${c.key} ${lvl}`}>
                <div className="w-[120px] flex">
                  <TrackPips level={lvl} metropolis={false} color={c.ink} />
                </div>
              </State>
            ))}
            <State label={`${c.key} metropolis`}>
              <div className="w-[120px] flex">
                <TrackPips level={5} metropolis color={c.ink} />
              </div>
            </State>
            <State label={`${c.key} tile size`}>
              <div className="w-[80px] flex">
                <TrackPips level={3} metropolis={false} color={c.ink} size="tile" />
              </div>
            </State>
            <Break />
          </React.Fragment>
        ))}
      </Group>

      <Group id="game/log-tokens" title="ChatText, CardToken, LogTokens, CostChips" surface="hud">
        <State label="ChatText: plain">
          <span className="text-[13px] text-foreground">
            <ChatText msg="good luck everyone" />
          </span>
        </State>
        <State label="ChatText: cards">
          <span className="text-[13px] text-foreground">
            <ChatText msg="2 sheep for 3 wood?" />
          </span>
        </State>
        <State label="ChatText: past five collapses">
          <span className="text-[13px] text-foreground">
            <ChatText msg="anyone need 9 wheat" />
          </span>
        </State>
        <Break />
        <State label="CardToken: gain">
          <CardToken tok={{ k: "res", idx: 4, n: 2 }} />
        </State>
        <State label="CardToken: loss">
          <CardToken tok={{ k: "res", idx: 1, n: 3, loss: true }} />
        </State>
        <State label="CardToken: commodity">
          <CardToken tok={{ k: "com", idx: 1, n: 1 }} />
        </State>
        <Break />
        <State label="LogTokens: dice, event die, piece, card">
          <span className="text-[13px] text-foreground">
            <LogTokens
              colorOf={colorOf}
              pieceIcon={icons}
              line={[
                { k: "t", s: "Mara rolled" },
                { k: "die", n: 4 },
                { k: "die", n: 3, red: true },
                { k: "edie", face: "politics" },
                { k: "t", s: "(7)", dim: true },
                { k: "t", s: "and built" },
                { k: "piece", piece: "city", seat: 0 },
                { k: "card", kind: "progress", id: "crane" },
              ]}
            />
          </span>
        </State>
        <Break />
        <State label="CostChips: city">
          <span className="text-foreground">
            <CostChips cost={{ 4: 2, 5: 3 }} />
          </span>
        </State>
        <State label="CostChips: settlement, 16px">
          <span className="text-foreground">
            <CostChips cost={{ 1: 1, 2: 1, 3: 1, 4: 1 }} size={16} />
          </span>
        </State>
      </Group>

      <Group
        id="game/tip-trigger"
        title="Tip (trigger at rest; the open tip needs a real hover)"
        surface="hud"
      >
        <State label="trigger">
          <Tip title="Longest Road" hint="The longest continuous road of 5 or more.">
            <span className="hud-chip px-2 py-1 text-[12px] text-foreground">Longest Road</span>
          </Tip>
        </State>
      </Group>
    </>
  );
}

// ---- icons ---------------------------------------------------------------

const PIECES: ArtPiece[] = [
  "road",
  "ship",
  "settlement",
  "city",
  "metro_trade",
  "metro_politics",
  "metro_science",
  "wall",
  "knight",
  "knight_strong",
  "knight_mighty",
  "bridge",
];

function IconGroups() {
  return (
    <>
      <Group
        id="game/piece-icon"
        title="PieceArt (PieceIcon): every piece in four seat colours"
        surface="hud"
        wide
      >
        {[0, 1, 2, 3].map((s) => (
          <React.Fragment key={s}>
            {PIECES.map((p) => (
              <State key={p} label={`${seatName(s)}: ${p}`}>
                <span className="block size-10">
                  <PieceArt piece={p} color={colorOf(s)} />
                </span>
              </State>
            ))}
            <Break />
          </React.Fragment>
        ))}
      </Group>

      <Group id="game/hud-icons" title="hudIcons: Icons, ResetView, CardFan" surface="hud">
        {Object.entries(Icons).map(([k, C]) => {
          const I = C as React.ComponentType<{ size?: number }>;
          return (
            <State key={k} label={k}>
              <span className="text-foreground">
                <I size={20} />
              </span>
            </State>
          );
        })}
        <State label="ResetView">
          <span className="text-foreground">
            <ResetView size={20} />
          </span>
        </State>
        <Break />
        {[0, 1, 3, 6].map((n) => (
          <State key={n} label={`CardFan ${n}`}>
            <span className="text-foreground">
              <CardFan n={n} />
            </span>
          </State>
        ))}
      </Group>

      <Group id="game/module-glyphs" title="moduleGlyphs" surface="hud">
        <State label="RobberGlyph">
          <span className="text-foreground">
            <RobberGlyph size={22} />
          </span>
        </State>
        <State label="CamelGlyph">
          <span className="text-foreground">
            <CamelGlyph size={22} />
          </span>
        </State>
        <State label="RouteGlyph">
          <span className="text-foreground">
            <RouteGlyph size={22} />
          </span>
        </State>
        <State label="at 14px in a figure chip">
          <span className="hudx-figure">
            <CamelGlyph /> Camels left: 17
          </span>
        </State>
      </Group>
    </>
  );
}

// ---- board chrome ----------------------------------------------------------

const CHECKS: CheckResult[] = [
  {
    id: "a",
    label: "No adjacent red numbers",
    status: "pass",
    detail: "6 and 8 tokens: 4, none touching",
    hexes: [],
  },
  { id: "b", label: "Harbours on the coast", status: "pass", detail: "9 of 9", hexes: [] },
  {
    id: "c",
    label: "Resource spread",
    status: "fail",
    detail: "3 wood tiles share a corner",
    hexes: [],
  },
  { id: "d", label: "Desert placement", status: "info", detail: "Centre hex", hexes: [] },
];

function BoardChromeGroups() {
  return (
    <>
      <Group id="game/zoom-controls" title="ZoomControls" surface="hud">
        <State label="cluster">
          <div className="relative w-[80px] h-[120px]">
            <ZoomControls onZoomIn={noop} onZoomOut={noop} onReset={noop} />
          </div>
        </State>
      </Group>

      <Group id="game/check-list" title="CheckList and CheckRow" surface="panel">
        <State label="one failing">
          <div className="w-[280px]">
            <CheckList results={CHECKS} onReport={noop} reported={false} />
          </div>
        </State>
        <State label="all clear, report copied">
          <div className="w-[280px]">
            <CheckList
              results={CHECKS.filter((c) => c.status !== "fail")}
              onReport={noop}
              reported
            />
          </div>
        </State>
        <State label="no results">
          <div className="w-[280px]">
            <CheckList results={[]} onReport={noop} reported={false} />
          </div>
        </State>
        <State label="CheckRow: fail">
          <div className="w-[260px]">
            <CheckRow result={CHECKS[2]} />
          </div>
        </State>
        <State label="CheckRow: info">
          <div className="w-[260px]">
            <CheckRow result={CHECKS[3]} />
          </div>
        </State>
      </Group>

      <Group id="game/map-preview" title="MapPreview" surface="panel">
        <State label="base board">
          <MapPreview board={pBoard} className="w-[260px] h-[230px]" />
        </State>
        <State label="scenario board (lake, fish grounds)">
          <MapPreview board={caravanBoard} className="w-[260px] h-[230px]" />
        </State>
      </Group>

      <Group id="game/dice" title="Die and EventDie" surface="hud">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`w${n}`} label={`white ${n}`}>
            <Die n={n} />
          </State>
        ))}
        <Break />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <State key={`r${n}`} label={`red ${n}`}>
            <Die n={n} variant="red" />
          </State>
        ))}
        <Break />
        {["", "ship", "trade", "politics", "science"].map((f) => (
          <State key={f || "none"} label={f || "unrolled"}>
            <EventDie face={f} />
          </State>
        ))}
        <State label="small (24px)">
          <Die n={5} size={24} />
        </State>
      </Group>
    </>
  );
}

// ---- asset parts -----------------------------------------------------------

const CARD_SLOTS = [
  playedCardSlot("dev", "knight"),
  playedCardSlot("dev", "victory_point"),
  playedCardSlot("dev", "road_building"),
  playedCardSlot("dev", "year_of_plenty"),
  playedCardSlot("dev", "monopoly"),
  playedCardSlot("dev", "swift_journey"),
  playedCardSlot("raiders", "muster"),
  playedCardSlot("raiders", "swift_rider"),
  playedCardSlot("raiders", "treason"),
  playedCardSlot("raiders", "intrigue"),
  "progress_crane",
  "progress_alchemist",
  "devcard_back",
];

const TITLES: { locale: string; title: string }[] = [
  { locale: "en", title: "Year of Plenty" },
  { locale: "de", title: "Monopol" },
  { locale: "es", title: "Construcción de carreteras" },
  { locale: "tr", title: "İnşaat" },
  { locale: "ru", title: "Монополия" },
  { locale: "ja", title: "独占" },
  { locale: "zh-Hans", title: "丰收之年" },
  { locale: "vi", title: "Độc quyền" },
];

function AssetGroups() {
  return (
    <>
      <Group id="game/asset-icons" title="ResIcon and GoodIcon" surface="hud">
        {RES.map((r) => (
          <State key={r.key} label={r.key}>
            <ResIcon slot={resIconSlot(r.idx)} size={32} />
          </State>
        ))}
        {COMMOD.map((c) => (
          <State key={c.key} label={c.key}>
            <ResIcon slot={comIconSlot(c.idx)} size={32} />
          </State>
        ))}
        <Break />
        {["fish", "gold", "rivercoin", "spice", "marble", "glass", "sand", "tools"].map((g) => (
          <State key={g} label={`good: ${g}`}>
            <GoodIcon
              id={g}
              size={28}
              fallback={<span className="hud-lab text-foreground">none</span>}
            />
          </State>
        ))}
        <State label="missing slot (fallback)">
          <ResIcon
            slot="icon_does_not_exist"
            size={32}
            fallback={<span className="hud-lab text-foreground">?</span>}
          />
        </State>
      </Group>

      <Group
        id="game/card-face"
        title="CardFace (baked faces with title plates)"
        surface="hud"
        wide
      >
        {CARD_SLOTS.map((s) => (
          <State key={s} label={s}>
            <CardFace slot={s} className="hud-card-frame block w-[110px] overflow-hidden" />
          </State>
        ))}
        <State label="missing art (fallback)">
          <CardFace
            slot="progress_future_card"
            className="hud-card-frame block w-[110px] overflow-hidden"
            fallback={<span className="hud-card-frame block w-[110px] aspect-[5/7] bg-panel" />}
          />
        </State>
      </Group>

      <Group
        id="game/card-title-plate"
        title="CardTitlePlate, several languages"
        surface="hud"
        wide
      >
        {TITLES.map((t) => (
          <State key={t.locale} label={t.locale}>
            <span className="relative block w-[140px] aspect-[5/7] overflow-hidden rounded-[8px] bg-ink">
              <CardTitlePlate title={t.title} locale={t.locale} />
            </span>
          </State>
        ))}
        <State label="long English title">
          <span className="relative block w-[140px] aspect-[5/7] overflow-hidden rounded-[8px] bg-ink">
            <CardTitlePlate title="Commercial Harbor" locale="en" />
          </span>
        </State>
      </Group>

      <Group id="game/slot-art" title="slotArt: number tokens and harbour labels" surface="panel">
        <State label="number tokens 2 to 12">
          <svg viewBox="0 0 440 50" width={440} height={50}>
            {[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((n, i) => (
              <g key={n}>
                <TokenChipArt cx={22 + i * 44} cy={25} />
                <TokenLabel cx={22 + i * 44} cy={25} num={n} />
              </g>
            ))}
          </svg>
        </State>
        <State label="harbour labels">
          <span className="flex gap-2">
            {["wood", "brick", "sheep", "wheat", "ore", "any"].map((r) => {
              const p = portInfo(r);
              return (
                <span
                  key={r}
                  className="rounded-[6px] px-1.5 py-0.5 text-[11px] font-extrabold text-ink"
                  style={{ background: p.color }}
                >
                  {p.label}
                </span>
              );
            })}
          </span>
        </State>
      </Group>
    </>
  );
}
