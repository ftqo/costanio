import { CurrencyTrade } from "@/components/game/CurrencyTrade";
import { BoardEntryCover } from "@/components/game/BoardEntryCover";
import { CommandHoldContext, HeldActions } from "@/components/game/CommandHold";
import {
  scenarioCurrencies,
  currencyCount,
  tradeExtra,
  type CurrencyAmounts,
} from "@/lib/scenarioCurrency";
import * as React from "react";
import { wagonsExt, explorersExt, resIndexOf } from "@/lib/types";
import { Trans, Plural, useLingui } from "@lingui/react/macro";
import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  SiteHeader,
  ProfileMenu,
  HamburgerMenu,
  avatarColor,
  type SessionAction,
} from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";

import { Spinner } from "@/components/ui/spinner";
import { BrandPill } from "@/components/BrandPill";
import { LoadingScreen } from "@/components/LoadingScreen";
import { TableClosedScreen, tableClosed } from "@/components/game/TableClosedScreen";
import { inActivityMode } from "@/lib/activity";
import { errorText } from "@/lib/errorCopy";
import { actingSeat, seatBotControlled, seatDisplayName } from "@/lib/seat";
import { DecoratedName } from "@/components/DecoratedName";
import { HudLayer, HudCluster, HudTopRow, HudOrb, GLASS } from "@/components/game/hud/HudLayer";
import { SeatRail, type SeatChrome } from "@/components/game/hud/SeatRail";
import { TurnTimerEdge } from "@/components/game/hud/TurnTimerEdge";
import {
  DefaultRateChip,
  BankRow,
  DiscardLimit,
  selectBankCardShape,
  selectStatus,
} from "@/components/game/hud/TableStatus";
import { TableFeed } from "@/components/game/hud/TableFeed";
import { BarbarianRail } from "@/components/game/hud/BarbarianRail";
import { TurnBanner } from "@/components/game/hud/TurnBanner";
import { DiceRow, EndTurnPill, TurnControls } from "@/components/game/hud/TurnControls";
import { UtilityOrbs, TopPanelOrb } from "@/components/game/hud/UtilityOrbs";
import { DockPanels, DOCK_PILL, type DockPanel } from "@/components/game/hud/DockPanels";
import { ThemeOrb } from "@/components/game/hud/ThemeOrb";
import { ExplainOrb } from "@/components/game/hud/ExplainOrb";
import { CardSheet } from "@/components/game/CardSheet";
import { playedCardSlot } from "@/lib/cardText";
import { useNoHover, useTapOnly } from "@/lib/touch";
import { useExplaining, answerGiven } from "@/lib/explainMode";
import { Tip } from "@/components/game/Tip";
import type { BoardProps, BuildMode } from "@/components/board/props";
import { Board3D, type Board3DControls } from "@/components/board/Board3D";
import { CardFlightLayer, type FlightBatch } from "@/components/game/CardFlightLayer";
import { CardRevealLayer, RevealDock, type RevealBatch } from "@/components/game/CardRevealLayer";
import { revealsIn } from "@/lib/cardReveal";
import { supportsWebGL } from "@/lib/board3d/webgl";
import { HUD_BOTTOM_INSET, FLAT_VIEW_QUERY } from "@/lib/board3d/scene";
import { collapseSteps } from "@/lib/logCollapse";
import type { Projector } from "@/lib/board3d/project";
import { planBatch } from "@/lib/cardFlightPlan";
import { useHudAnchors } from "@/lib/hudAnchors";
import {
  ArrowCounterClockwise,
  Bank,
  ChatCircle,
  Eye,
  Flag,
  Handshake,
  LockSimple,
  Robot,
  Scroll,
  UsersThree,
} from "@/lib/icons";
import { Icons, ResetView } from "@/components/game/hudIcons";
import { Die, EventDie } from "@/components/board/Die";
import { Button, buttonLook } from "@/components/ui/button";
import { ActivitySafeLink } from "@/components/ActivitySafeLink";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { useToast, useToastInset } from "@/components/ui/toast";
import {
  aqueductResourceFrom,
  resolvesPending,
  autoResolveToasts,
  pendingSnapshot,
  resolvedKinds,
  type AutoResolveKind,
  type PendingSnapshot,
} from "@/lib/autoResolveToast";
import { aqueductBankEmpty, aqueductCanTake } from "@/lib/aqueduct";
import { api, isFatalApiError, retryUnlessFatal, retryBackoffMs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { gameSocket, useGameSocket, shallowEqual } from "@/lib/ws";
import { useRichPresence, type PresenceInput } from "@/lib/richPresence";
import { CMD_COST, NO_SPENT, addSpent, dropSpend, spentFor, type Spent } from "@/lib/optimistic";
import { isAckLost, useLinkDown } from "@/lib/link";
import {
  applyPending,
  dropByRef,
  dropSettled,
  isInFlight,
  nextCmdId,
  settleFor,
  takeExpired,
  INFLIGHT_TTL_MS,
  type InFlight,
} from "@/lib/inflight";
import { patchForCommand } from "@/lib/cmdPatch";
import { rulesetLabel, parseExpansions } from "@/lib/format";
import { seatColor, vertexKey, edgeKey, hexKey } from "@/lib/hexgeo";
import { revealActiveCard } from "@/lib/scrollReveal";
import { useStickyScroll } from "@/lib/stickyScroll";
import { useMeasure, readViewportMetrics, SKIP } from "@/lib/measure";
import {
  railFraction,
  tradePanelLift,
  quantiseFrac,
  dockPanelMaxH,
  hudViewport,
  feedIslandFits,
  feedHeightReserve,
  poppedCardMaxH,
  barbRailRight,
  bankCardNaturalH,
  bankCardOuterH,
  dockDieSize,
  turnControlsPlacement,
  parkedDieSize,
  dockYieldsToTrade,
  HOTBAR_TILE,
  TRADE_PANEL_WRAP,
  TRADE_PANEL_BUILDER,
  TRADE_PANEL_RAIL,
  TRADE_RAIL_ICON,
  TRADE_ROW,
  TRADE_SCROLL,
  TRADE_SCROLL_WRAP,
  FLOATING_PROMPT,
  dividerInked,
  shelfLead,
  type ShelfLead,
  COLUMN_LAYOUT_QUERY,
  SQUAT_QUERY,
  SQUAT_DOCK_COLUMN,
  SQUAT_DIE_SIZE,
  SQUAT_PROMPT,
  PROMPT_TOP,
  promptTopPx,
  squatPromptVars,
} from "@/lib/hudChrome";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useCbMode, cbSeatColor } from "@/lib/colorblind";
import { usePlacementMarks } from "@/lib/placementMarks";
import {
  robberVictimSeats,
  pirateVictimSeats,
  friendlyShieldMaxVP,
  robberAteRoll,
  robberBlockedTile,
  victimPromptStale,
} from "@/lib/robber";
import {
  progressPlayableNow,
  progressHasBoardTargets,
  progressPlayableReason,
  playableProgressCards,
  progressNoEffectReason,
  deserterTiers,
  spyVictimSeats,
  deserterVictimSeats,
  harborTargetCount,
  craneTracks,
  improvementBlockReason,
  buildBlockReason,
  costShortfall,
  type Buildable,
  improvementCost,
  wallShopIntent,
  canPlayDev as canPlayDevCard,
  devPlayableReason,
  devEffectWarning,
  devCardName,
  devCardHint,
  DEV_CARD_IDS,
  DEV_HELD_ID,
} from "@/lib/reachability";
import {
  progressCardName,
  progressCardHint,
  progressCardPrompt,
  progressDeckLook,
  progressSlot,
  progressInput,
  type ProgressInputKind as ProgressKind,
} from "@/lib/progressCards";
import { ProgressCardChoice } from "@/components/game/ProgressCardChoice";
import { HudButton } from "@/components/game/hud/HudButton";
import { Overlay } from "@/components/game/Overlay";
import { PillageBuyoutDialog } from "@/components/game/PillageBuyoutDialog";
import { RaidersGoldPanel } from "@/components/game/RaidersGoldPanel";
import { RaidersRidersPanel } from "@/components/game/RaidersRidersPanel";
import { RaidersTreasonPanel } from "@/components/game/RaidersTreasonPanel";
import { RaidersCoast } from "@/components/game/RaidersCoast";
import {
  canBuyRaidersCard,
  goldBuyOffers,
  goldBuysLeft,
  goldOf,
  goldSellOffers,
  landingNumber,
  pendHexes,
  prisonersOf,
  raidersAsking,
  raidersRole,
  riderMoves,
  ridersLeft,
  ridersMustLeave,
  stealVictims as raidersStealVictims,
  treasonDestinations,
  treasonMoveCount,
  treasonSources,
  resourceName as raidersResourceName,
  coastThreat as raidersCoastThreat,
  stealGate,
} from "@/lib/raiders";
import { SeatChoice, SeatChoiceRow } from "@/components/game/SeatChoice";
import { PieceChoice } from "@/components/game/PieceChoice";
import { RobberGlyph } from "@/components/game/moduleGlyphs";
import { sentences } from "@/lib/sentences";
import { FishSpendPanel } from "@/components/game/FishSpendPanel";
import {
  bootHolder,
  bootTargets,
  fishOffers,
  fishPriceRange,
  fishRoadNext,
  fishStealVictims,
  myFishMix,
  type FishRoadPending,
  type FishSpend,
} from "@/lib/fish";
import { RiverCoinsPanel } from "@/components/game/RiverCoinsPanel";
import {
  bridgeCost,
  bridgeSupply,
  coinTrades,
  buyoutWealthCost,
  pillageBuyoutOffer,
  seatBridgesLeft,
  seatCoins,
} from "@/lib/rivers";
import { CamelBidPanel } from "@/components/game/CamelBidPanel";
import { ExplorersPanel, ShipHold } from "@/components/game/ExplorersPanel";
import {
  EXPLORERS_COSTS,
  isExplorers,
  shipsOf as explorersShipsOf,
  setupStep as explorersSetupStep,
  pirateOwed as explorersPirateOwed,
  pirateVictimsAt as explorersPirateVictims,
} from "@/lib/explorers";
import type { ExplorerShipAct } from "@/lib/types";
import { CamelPlacePanel } from "@/components/game/CamelPlacePanel";
import { camelPaths, camelPending, camelRole, camelViewOutcome } from "@/lib/caravans";
import { WagonPanel } from "@/components/game/WagonPanel";
import {
  barbarianPlace,
  movableBarbarians,
  movementLeft as wagonMovementLeft,
  owedBarbarian,
  wagonRole,
  canUpgrade as canUpgradeWagon,
  upgradeCost as wagonUpgradeCost,
} from "@/lib/wagons";
import {
  moduleBlocksActions,
  moduleBlocksEndTurn,
  wagonMoveOnlyBlocksEnd,
  wagonMovingClosesBuilding,
} from "@/lib/moduleGates";
import { DicePicker } from "@/components/game/DicePicker";
import { ActiveOfferCard } from "@/components/game/ActiveOfferCard";
import { StealPicker } from "@/components/game/StealPicker";
import { DrawOfferCard } from "@/components/game/DrawOfferCard";
import { boardModeFor, type BoardMode } from "@/lib/boardTargets";
import { armedTargetsGone } from "@/lib/armedTargets";
import { bankTotal, commodityTrade, goodsBasket, maritimeTrade } from "@/lib/bank";
import { maritimeBlockedReason } from "@/lib/bankReason";
import { describeEventLines, resourceHandIndex, type LogMessage } from "@/lib/eventlog";
import { useFadingLog, LOG_FADE_MS } from "@/lib/fadingLog";
import { LogSentence } from "@/components/game/LogLine";
import { ChatText } from "@/components/game/ChatText";
import { usePieceIcons, type PieceIcons } from "@/lib/usePieceIcons";
import { useGameEntry } from "@/lib/useGameEntry";
import { COST } from "@/lib/costs";
// The card faces the hand shelf draws, shared with the cards that fly across
// the board (lib/cardFace) so a card leaves its hex in the same colour.
import {
  RES,
  COMMOD,
  COMMOD_ROW,
  resIconSlot,
  comIconSlot,
  isResKey,
  isComKey,
  type CardKey,
} from "@/lib/cardFace";
// One message per card rather than one frame with a card name inserted, since
// inflected languages need it (see lib/cardPhrases).
import {
  takeCard,
  giveCard,
  returnCard,
  requestCard,
  putBackCard,
  removeCard,
  giveTwoCards,
  takeEveryCard,
  spendCardOn,
  holdNoCards,
  victimHoldsNoCards,
  allTheirCards,
  bankOutOfCard,
  needTwoCards,
  takeTwoOfEach,
  takeOneOfEach,
  tradeCardAtTwo,
} from "@/lib/cardPhrases";
import { handStack } from "@/lib/handStack";
import { cardArtSlot } from "@/lib/resourceArt";
import { improvedLevel, nextImprovementReward, TRACK_ROW } from "@/lib/improvements";
import { TrackPips } from "@/components/game/TrackPips";
import { actionsAt, type BoardLocation, type LocationAction } from "@/lib/locationActions";
import { type ArmedEntry, type BoardTapCtx, edgeTap, routeTap, vertexTap } from "@/lib/boardTap";
import { LocationDial } from "@/components/game/LocationDial";
import { PieceInfoCard } from "@/components/game/PieceInfoCard";
import type { PieceInfo } from "@/lib/boardInfo";
import { hexLabel } from "@/lib/boardInfo";
import { cn } from "@/lib/utils";
import { usePieceThumbnails } from "@/lib/usePieceThumbnails";
import {
  CHAT_RATE_MS,
  eventsAfter,
  forcedTurnOver,
  lastEventSeq,
  type GameEvent,
} from "@/lib/gamestate";
import { useCooldown } from "@/lib/useCooldown";
import Confetti from "react-confetti";
import {
  type Hex,
  type Vertex,
  type Edge,
  type BoardTile,
  type PlayerView,
  islandsExt,
  knightsExt,
  caravansExt,
  raidersExt,
  type TreasonMove,
  publicVp,
} from "@/lib/types";
import { rulesetCaps } from "@/lib/caps";
import { setupPlacesCity } from "@/lib/board3d/ghost";
import { pieceSetAssetFile } from "@/lib/pieceSets";
import { PostGameScoreboard } from "@/components/game/PostGameScoreboard";
import { formatNumber } from "@/lib/intl";
import { ResIcon, CardFace } from "@/components/asset/AssetParts";
import {
  refreshMusic,
  stopMusic,
  setAudioHeld,
  play,
  preload,
  eventSound,
  improveSound,
  isRepeatPromotion,
  warlordSound,
  diceSlot,
  GAME_SOUND_SLOTS,
} from "@/lib/sound";

/**
 * Subscription refusals that mean this table is not ours to be at, so the
 * screen leaves rather than retrying. Copy lives in lib/errorCopy.
 */
const TERMINAL_SUB_CODES = new Set([
  "GAME_NOT_FOUND",
  "PRIVATE_GAME",
  "GUEST_NEEDS_INVITE",
  "SPECTATORS_FULL",
]);

/** How long the table refuses input at the start of a game. See `startHold`. */
const START_HOLD_MS = 500;

/** How far into a game the start cue may still play, in events. The client
 * keeps the whole log, so `board_generated` alone does not date a game (see
 * the sound effect below). */
const START_CUE_WINDOW = 50;

/**
 * The event log, drawn in full.
 *
 * A memoised component because the client keeps the whole log and Game.tsx
 * re-renders on every websocket frame; a `useMemo` is not possible where the
 * feed is assembled (below the loading early-returns). `React.memo` over props
 * that change only with the log or seat cosmetics rebuilds once per event.
 *
 * Rows are keyed by event seq, so a backfill of earlier history re-keys
 * nothing.
 */
export const EventLogFeed = React.memo(function EventLogFeed({
  events: rawEvents,
  seatName,
  islands,
  colorOf,
  pieceIcon,
  tiles,
  fadeAt,
}: {
  events: readonly GameEvent[];
  seatName: (seat: number) => string;
  islands: boolean;
  colorOf: (seat: number) => string;
  pieceIcon: PieceIcons;
  /**
   * The board's terrain, for lines about a hex: the tile the robber blocked
   * on a matching roll, and the hex a Raiders landing, battle or conquest
   * names. Held by content (see `logTiles` at the call site) so a fresh array
   * per frame does not defeat the memo.
   */
  tiles: readonly BoardTile[] | null;
  /**
   * Memory mode: when each row should start fading, as a timestamp; null when
   * the log is permanent. A deadline rather than a duration, so a rebuild does
   * not restart the fade of rows already on screen. See lib/fadingLog.
   */
  fadeAt: ((seq: number) => number) | null;
}) {
  const nodes: React.ReactNode[] = [];
  let pendingDivider = false;
  /**
   * Where the robber stands as the log is read forward, so a roll is judged
   * against the board as it was then. Starts undefined: the robber's starting
   * tile carries no number, so nothing before the first `robber_moved` can be
   * blocked.
   */
  let robber: Hex | undefined;
  // One line per voyage rather than per tap: see lib/logCollapse.
  const events = collapseSteps(rawEvents);
  for (const [i, e] of events.entries()) {
    if (e.type === "robber_moved") {
      const h = (e.data as { hex?: Hex } | undefined)?.hex;
      if (h) robber = h;
    }
    // turn_started marks a divider before this turn's first visible line
    // (suppressed at the very top).
    if (e.type === "turn_started") {
      pendingDivider = nodes.length > 0;
      continue;
    }
    // The Knights event die is its own event, emitted with its roll, and
    // belongs on that roll's line. Scan forward, stopping at the next roll or
    // turn boundary.
    let eventDie: string | undefined;
    // The production this roll did not pay: the tile under the robber, when
    // the roll was its number. Otherwise nothing in the log explains it.
    let blockedRes: number | undefined;
    let blockedNum: number | undefined;
    if (e.type === "dice_rolled") {
      const roll = e.data as { d1?: number; d2?: number } | undefined;
      const total = (roll?.d1 ?? 0) + (roll?.d2 ?? 0);
      const blocked = tiles ? robberBlockedTile(tiles, robber, total) : null;
      if (blocked) {
        const idx = resourceHandIndex(blocked.res);
        // 0 is desert/sea, which carries no number, so this cannot fire.
        if (idx) {
          blockedRes = idx;
          blockedNum = blocked.num;
        }
      }
      for (let j = i + 1; j < events.length; j++) {
        const t = events[j].type;
        if (t === "dice_rolled" || t === "turn_started" || t === "turn_ended") break;
        if (t === "cak_event_die") {
          const face = (events[j].data as { face?: unknown } | undefined)?.face;
          if (typeof face === "string") eventDie = face;
          break;
        }
      }
    }
    // The same scan over this roll's commodity conversions. A Knights city on
    // commodity terrain gets two of a resource with one turned into a
    // commodity, emitted as `cak_commodity_adjust` after
    // `resources_distributed`; without this the line would say "2 wood" for a
    // gain of one wood and one paper. There may be several (per player per
    // resource), so this collects them, within the same boundaries.
    let adjusts: GameEvent[] | undefined;
    if (e.type === "resources_distributed") {
      for (let j = i + 1; j < events.length; j++) {
        const t = events[j].type;
        if (
          t === "dice_rolled" ||
          t === "turn_started" ||
          t === "turn_ended" ||
          t === "resources_distributed"
        )
          break;
        if (t === "cak_commodity_adjust") (adjusts ??= []).push(events[j]);
      }
    }
    // Cached per event, so this is a lookup on every row but the newest; its
    // identity lets `LogRow` skip the row.
    const lines = describeEventLines(e, seatName, islands, {
      eventDie,
      adjusts,
      blockedRes,
      blockedNum,
      tiles: tiles ?? undefined,
    });
    if (!lines.length) continue;
    nodes.push(
      <LogRow
        key={e.seq}
        lines={lines}
        divider={pendingDivider}
        colorOf={colorOf}
        pieceIcon={pieceIcon}
        fadeAt={fadeAt ? fadeAt(e.seq) : null}
      />,
    );
    pendingDivider = false;
  }
  return <>{nodes}</>;
});

/**
 * One event's rows, and the turn rule that may precede them.
 *
 * Memoised per row as well as per feed, so appending a line re-renders only
 * that row rather than the whole log. Every prop is stable across a rebuild
 * (`lines` from `describeEventLines`'s cache, the feed's `colorOf` and
 * `pieceIcon`, and `divider`, which only moves at a turn boundary).
 *
 * The rule renders inside the row because only the row knows it has lines; a
 * Fragment adds no element to the flex column.
 */
export const LogRow = React.memo(function LogRow({
  lines,
  divider,
  colorOf,
  pieceIcon,
  fadeAt,
}: {
  lines: LogMessage[];
  divider: boolean;
  colorOf: (seat: number) => string;
  pieceIcon: PieceIcons;
  /** Memory mode: when this row starts to fade, as a timestamp. Null = never. */
  fadeAt: number | null;
}) {
  /**
   * The fade is CSS; React only supplies a delay off this row's deadline, once
   * at mount. Computed in a state initialiser so the memoised row never
   * re-renders (and restarts the animation) as the clock moves. A row past its
   * deadline (remounted when the pane reopens) gets a negative delay, which
   * starts the animation partway through.
   *
   * `forwards` holds opacity 0 until lib/fadingLog drops the row.
   */
  const [fadeDelay] = React.useState(() => (fadeAt === null ? null : fadeAt - Date.now()));
  const style =
    fadeDelay === null
      ? undefined
      : ({
          animation: `log-expire ${LOG_FADE_MS}ms linear ${fadeDelay}ms forwards`,
        } as React.CSSProperties);
  return (
    <>
      {divider && <hr className="border-0 border-t border-line mx-1 my-1" style={style} />}
      {lines.map((line, j) => (
        // A log line is plain text on the panel, not a bubble.
        <div
          key={j}
          style={style}
          className="rounded-[6px] px-1.5 py-[3px] text-[12.5px] leading-[1.35]"
        >
          <LogSentence line={line} colorOf={colorOf} pieceIcon={pieceIcon} />
        </div>
      ))}
    </>
  );
});

// The dock dice fill the hotbar row once End turn's band is taken out, so the
// turn cluster and hand shelf match in height. See `dockDieSize` in
// lib/hudChrome.

// Dev-card hand indices: 0=knight, 1=victory point, 2=road building, 3=year of plenty, 4=monopoly.
const DEV_SLOT = [
  "devcard_knight",
  "devcard_victorypoint",
  "devcard_roadbuilding",
  "devcard_yearofplenty",
  "devcard_monopoly",
];
function devSlot(idx: number): string {
  return DEV_SLOT[idx] ?? "devcard_back";
}

/**
 * The rule between your hand and the tiles beside it, drawn only once the two
 * are close enough to run together.
 *
 * Told rather than self-measuring: the gap between the groups is the shelf's
 * lead plus the row's gap, which the lead pass already computes.
 *
 * It always occupies its 2px and only changes colour (see `dividerInked`).
 */
export function ShelfDivider({ gapPx }: { gapPx: number }) {
  return (
    <div
      aria-hidden
      className={cn(
        // Across the column on a sideways phone, where hand and tiles are
        // stacked.
        "w-0.5 h-16 rounded-full shrink-0 transition-colors squat:w-full squat:h-0.5",
        dividerInked(gapPx) ? "bg-line" : "bg-transparent",
      )}
    />
  );
}

// One measurement pass over the shelf produces `ShelfLead`, declared with the
// arithmetic that produces it, including which number is layout px and which
// is on-screen px.

const SHELF_AT_REST: ShelfLead = { lead: 0, gap: 0 };

/**
 * The measurement behind `shelfLead`: how far the centred group is pushed off
 * the hand, so the buy tiles land in the middle of the window rather than the
 * shelf (see lib/hudChrome).
 *
 * Refs go on the hand, the group, and the tiles inside the group; the lead
 * comes back as a margin for the group, and the gap beside it drives the
 * divider.
 *
 * Everything read is either taken with no lead applied or independent of it,
 * so the answer never depends on the previous one and the loop cannot drift.
 *
 * Two triggers:
 *
 *  - A render (a card arriving or staged, a tile appearing) is read in the
 *    layout phase and written before the same paint, so the hand's new width
 *    and its compensating lead land together. `useMeasure`'s pass runs in a
 *    rAF, after paint, which would lag by a frame.
 *  - The window (drag, zoom, keyboard) goes through `useMeasure`, joining the
 *    app-wide coalesced pass. A frame of lag during a resize is invisible.
 */
function useShelfLead() {
  const hand = React.useRef<HTMLDivElement | null>(null);
  const group = React.useRef<HTMLDivElement | null>(null);
  const buy = React.useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = React.useState<ShelfLead>(SHELF_AT_REST);

  // A pure layout read shared by both triggers: no writes, no state.
  const read = React.useCallback((): ShelfLead | typeof SKIP => {
    const h = hand.current;
    const g = group.current;
    const b = buy.current;
    const track = g?.closest(".overflow-x-auto") as HTMLElement | null;
    const row = g?.parentElement;
    if (!h || !g || !b || !track || !row) return SKIP;
    const tRect = track.getBoundingClientRect();
    // On-screen px per layout px: a rect is on-screen px, `clientWidth` is
    // layout px, and past 1700px index.css zooms <html>. Read off the track so
    // no breakpoints are duplicated.
    const scale = track.clientWidth > 0 ? tRect.width / track.clientWidth : 1;
    // The row's gap changes per breakpoint, so read it; computed style is in
    // layout px, so scale it.
    const gap = (parseFloat(getComputedStyle(row).columnGap) || 0) * scale;
    const gRect = g.getBoundingClientRect();
    // Widths from rects, never `offsetWidth` (see `shelfLead`): everything is
    // on-screen px, the system the window width is measured in.
    return shelfLead({
      screenW: window.innerWidth,
      trackLeft: tRect.left,
      trackW: tRect.width,
      handW: h.getBoundingClientRect().width,
      gap,
      groupW: gRect.width,
      buyOffset: b.getBoundingClientRect().left - gRect.left,
      buyW: b.getBoundingClientRect().width,
      scale,
    });
  }, []);

  // Returning the previous object when nothing moved lets React bail, so
  // running this every render costs one layout read.
  const write = React.useCallback((next: ShelfLead) => {
    setMetrics((prev) => (prev.lead === next.lead && prev.gap === next.gap ? prev : next));
  }, []);

  React.useLayoutEffect(() => {
    const next = read();
    if (next !== SKIP) write(next);
  });

  // `equals: () => false`, as lib/measure documents for a write that does its
  // own bail. The scheduler caches the last value it wrote and skips a match,
  // but the layout effect above also writes, so that cache goes stale and an
  // emptied hand could be skipped and left at an old lead.
  useMeasure<ShelfLead>({ read, write, equals: () => false, deps: [] });

  return { hand, group, buy, lead: metrics.lead, gap: metrics.gap };
}

/**
 * The cards behind the front one in a pile: one inert layer per extra copy,
 * peeking out to the left (the pile fans left, so the front card is rightmost;
 * see lib/handStack). Drawn as the card's own face, so four wheat reads as
 * four cards.
 *
 * Inert (no pointer events, no text, aria-hidden), so a pile is one control
 * with one label; the count lives on the front card.
 *
 * Absolutely positioned, so they take no row width. Render them before the
 * front card's face: same stacking context, no z-index, so DOM order is paint
 * order.
 */
export function StackBacks({
  layers,
  className,
  color,
}: {
  layers: number[];
  className?: string;
  /** The card's colour, as the `--card-color` its back is painted from. */
  color?: string;
}) {
  return (
    <>
      {layers.map((off, i) => (
        <span
          key={i}
          aria-hidden
          className={cn("absolute top-0 h-full pointer-events-none", className)}
          style={{
            ...(color ? { "--card-color": color } : null),
            // Offsets are in card widths, resolved against `--cw`. Positioned
            // rather than translated because they sit in a slot wider than one
            // card and must be one card wide.
            width: "var(--cw)",
            left: `calc(var(--cw) * ${off})`,
          }}
        />
      ))}
    </>
  );
}

/**
 * The three sizes a resource card is drawn at, in one table so width, height,
 * `--cw`, art and type agree.
 *
 *  - `sm`   the recipe inside a price tooltip.
 *  - `lg`   the trade builder's lanes and the pickers. TRADE_LANE is built
 *           around its height; it is not the hand's size.
 *  - `hand` the hand shelf: one hotbar tile (HOTBAR_TILE), as tall as the shop
 *           tiles and development cards beside it. `hotbarTileParts` in
 *           lib/hudChrome.test checks the pair.
 */
const RES_CARD_SIZE = {
  sm: {
    w: "w-[46px]",
    h: "h-16",
    cw: "[--cw:46px]",
    well: "w-[32px] h-[32px]",
    icon: 24,
    name: "text-[7.5px]",
  },
  lg: {
    // `squat:` back to the phone's size on a sideways phone; see HOTBAR_TILE.
    w: "w-11 sm:w-14 squat:w-11",
    h: "h-[64px] sm:h-[80px] squat:h-[64px]",
    cw: "[--cw:44px] sm:[--cw:56px] squat:[--cw:44px]",
    well: "w-[32px] h-[32px] sm:w-[38px] sm:h-[38px] squat:w-[28px] squat:h-[28px]",
    icon: 28,
    name: "text-[8.5px] sm:text-[9px]",
  },
  hand: {
    w: "w-11 sm:w-[68px] squat:w-11",
    h: "h-[64px] sm:h-[96px] squat:h-[64px]",
    cw: "[--cw:44px] sm:[--cw:68px] squat:[--cw:44px]",
    well: "w-[30px] h-[30px] sm:w-[44px] sm:h-[44px] squat:w-[28px] squat:h-[28px]",
    icon: 40,
    name: "text-[9px] sm:text-[10px] squat:text-[9px]",
  },
} as const;

// ResCard is the resource-card primitive used everywhere a resource appears
// (build-cost recipes, the hand shelf, the trade panel): a printed card in the
// resource's colour, the art in a round well, the name on a plate along the
// foot, and a count in the top-right corner. Styles are `hud-card-*` tokens in
// index.css; this only arranges them.
//
//  - countMode "multi"    -> recipe style: a xN badge only when more than one.
//  - countMode "always"   -> picker style: the count badge is always shown.
//  - countMode "positive" -> trade style: the badge shows only when the count > 0.
//  - countMode "stack"    -> hand style: the pile is drawn, one card per copy,
//                            with the badge as well (see lib/handStack).
//
// The coloured face is a clipped inset layer so the corner badge (and the
// optional footer pill) can overhang the card edge.
export function ResCard({
  color,
  name,
  slot,
  count,
  countMode = "always",
  size = "sm",
  dimmed,
  selected,
  disabled,
  onClick,
  onBadgeClick,
  title,
  footer,
}: {
  color: string;
  name: string;
  slot: string;
  count?: number;
  countMode?: "multi" | "always" | "positive" | "stack";
  size?: keyof typeof RES_CARD_SIZE;
  dimmed?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onBadgeClick?: () => void;
  title?: string;
  footer?: React.ReactNode;
}) {
  const { t } = useLingui();
  // A lookup over a few precomputed shapes.
  const stack = countMode === "stack" ? handStack(count ?? 0) : null;
  // The stack shows depth at a glance; the corner badge still gives the exact
  // count (for trades or the discard threshold).
  const onFace = false;
  const showBadge =
    count != null &&
    (countMode === "multi" ? count > 1 : countMode === "positive" ? count > 0 : true);
  // Width and height are separate because with a stack the slot is as wide as
  // the pile while the card stays one card wide.
  //
  // `--cw` publishes that card width, so the stack geometry (in card widths,
  // since the card size changes across the breakpoint) can be resolved in CSS.
  const dims = RES_CARD_SIZE[size];
  const big = size !== "sm";
  const interactive = !!onClick && !disabled;
  const badgeCls = cn(
    "hud-badge hud-card-badge absolute -top-2 -right-2 z-10 flex items-center justify-center font-bold tabular-nums",
    big
      ? "min-w-[20px] h-[20px] px-1 text-[11px] sm:min-w-[22px] sm:h-[22px] sm:text-[12px]"
      : "min-w-[18px] h-[18px] px-1 text-[10px]",
  );
  const face = (
    <>
      {/* The printed face, from the `hud-card-face` tokens; `--card-color` on
          the root is its one input. */}
      <span className="hud-card-face" aria-hidden />
      <span
        className={cn(
          "hud-card-well relative flex shrink-0 items-center justify-center",
          dims.well,
        )}
      >
        {/* The card-sized render where there is one (lib/resourceArt); the small
            icon is baked for chip sizes. */}
        <ResIcon
          slot={size === "sm" ? slot : cardArtSlot(slot)}
          size={dims.icon}
          className="h-[74%] w-[74%] object-contain"
        />
      </span>
      {onFace && (
        <span
          className={cn(
            "relative font-semibold leading-none font-num tabular-nums text-[var(--card-ink)] text-[14px] sm:text-[19px]",
          )}
        >
          {count}
        </span>
      )}
      <span
        className={cn(
          // The name plate along the foot, inside the card's frame.
          "hud-card-label absolute inset-x-[4px] bottom-[4px] flex h-[14px] sm:h-[17px] items-center justify-center truncate px-0.5 leading-none",
          dims.name,
          // The 44x64 phone hand card has room for art and count only; the
          // name is in its title and accessible name.
          onFace && "max-sm:hidden",
        )}
      >
        {name}
      </span>
      {showBadge &&
        (onBadgeClick ? (
          <span
            role="button"
            tabIndex={0}
            aria-label={t({ message: "Remove one", context: "take one staged card back" })}
            title={t({ message: "Remove one", context: "take one staged card back" })}
            onKeyDown={pillKeys(onBadgeClick)}
            onClick={(e) => {
              e.stopPropagation();
              onBadgeClick();
            }}
            className={cn(badgeCls, "cursor-pointer hover:scale-110 transition-transform")}
          >
            {count}
          </span>
        ) : (
          <span className={badgeCls}>{countMode === "multi" ? `×${count}` : count}</span>
        ))}
      {footer}
    </>
  );
  // A column: the art in the upper middle, the plate at the foot (absolute, so
  // the well centres in the space above it).
  const faceLayout = "flex flex-col items-center justify-center pb-[14px] sm:pb-[17px]";
  // Without a stack the card is the slot. With one, the slot is wider than the
  // card and the backs fill the extra width, so the pile takes real room in
  // the row.
  const inner = stack ? (
    <>
      {/* Back-most first, so DOM order is paint order. Inside the slot, so they
          grey with the card when it is unaffordable. */}
      <StackBacks layers={stack.behind} className="hud-card-back" color={color} />
      {/* The front card takes the slot's right edge (the pile fans left; see
          lib/handStack). Its badge and footer pill overhang that edge as on a
          single card. */}
      <span className={cn("absolute right-0 top-0 h-full", faceLayout, dims.w)}>{face}</span>
    </>
  ) : (
    face
  );
  const cls = cn(
    "relative rounded-[var(--hud-card-radius)]",
    dims.h,
    dims.cw,
    // A slot with a stack positions its own contents; one without is the card
    // and centres them.
    //
    // `block`: a <button> defaults to `inline-block`, which sits on a text
    // baseline, so the parent reserves descender space below it and the card
    // rides high in its box.
    stack ? "block shrink-0" : cn(dims.w, faceLayout),
    // Dimmed (`data-dimmed`) and selected (`data-selected`) are drawn in
    // styles/pb-hud.css: a dimmed card takes the flat disabled face with grey
    // art and a muted name, never a fade, and keeps its yellow count; a
    // selected one (the trade and levy pickers) fills its name strip yellow
    // and stands lifted.
    interactive ? "cursor-pointer hud-lift" : "cursor-default",
  );
  // The slot is one card wide plus an eighth of a card per copy behind the
  // front one, in `--cw` units.
  const style = {
    "--card-color": color,
    ...(stack ? { width: `calc(var(--cw) * ${stack.width})` } : null),
  } as React.CSSProperties;
  const label = title;
  if (onClick) {
    return (
      <button
        type="button"
        disabled={disabled}
        title={label}
        onClick={onClick}
        className={cls}
        style={style}
        data-res-card
        data-dimmed={dimmed ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
      >
        {inner}
      </button>
    );
  }
  return (
    <span
      className={cls}
      title={label}
      style={style}
      data-res-card
      data-dimmed={dimmed ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
    >
      {inner}
    </span>
  );
}

/**
 * Enter and Space for a `role="button"` span.
 *
 * The staged-card pills below (the badge that takes one back, and CommitPill)
 * sit inside the card's `<button>`, so they cannot be buttons (nested buttons
 * are invalid HTML). A span gets no click from a key, so this supplies it;
 * discarding on a 7 is mandatory and timed.
 *
 * `stopPropagation`, as in their onClick: the card behind would stage another
 * copy.
 */
function pillKeys(run: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space scrolls the page, and the hand shelf is inside a scroll container.
    e.preventDefault();
    e.stopPropagation();
    run();
  };
}

// The trade panel's YOU GET / YOU GIVE lanes. Fixed height, not a minimum: the
// panel floats above the hand shelf, and a growing lane would shove the
// builder up the screen each time a card was staged. One row of `lg` cards
// (64/80px plus py-1.5) whether empty or full; the empty hint fits too.
// The fixed height also lets the caption wrap: its 56px column fits `You get`
// and `You give` but not `Du bekommst` or `Entregas`, and two 10px lines plus
// the arrow (~38px) fit the 76px lane. Captions carry `overflow-wrap:anywhere`
// so a single long word breaks rather than overlapping the cards.
// `squat:` returns to the phone's lane, where the cards are phone-sized too
// (see HOTBAR_TILE).
const TRADE_LANE = "flex items-center gap-2 px-2 py-1.5 h-[76px] sm:h-[92px] squat:h-[76px]";

// The row inside a lane, its scroll box and the panel's boxes live in
// lib/hudChrome with the rest of the HUD's measurements.

// A small pill overhanging the bottom of a hand card, showing how many of it
// are staged into a trade (green) or a discard (red). Clicking puts one back.
// Inside the card button, so it stops propagation.
export function CommitPill({
  n,
  tone,
  onRemove,
}: {
  n: number;
  tone: "give" | "discard";
  onRemove: () => void;
}) {
  const { t } = useLingui();
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t({ message: "Put one back", context: "return one staged card to your hand" })}
      title={t({ message: "Put one back", context: "return one staged card to your hand" })}
      onKeyDown={pillKeys(onRemove)}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className={cn(
        "hud-pill-count absolute -bottom-1.5 left-1/2 -translate-x-1/2 min-w-4.5 h-4 px-1 text-main-foreground flex items-center justify-center cursor-pointer hover:scale-110 transition-transform",
        tone === "give" ? "bg-green" : "bg-red",
      )}
    >
      {n}
    </span>
  );
}

// A read-only count pill in CommitPill's slot, for a card whose interesting
// number is not the badge. Only the Master Merchant uses it: the badge is how
// many you took (and gives one back), this is how many the revealed hand still
// holds. Inert: no role, handler or hover.
/** A card row whose cards carry a HoldPill: extra air under each line for it. */
const HOLD_ROW = "flex gap-x-2 gap-y-6 pb-3 justify-center flex-wrap";

export function HoldPill({ n }: { n: number }) {
  return (
    <span
      data-tone="hold"
      // Hung below the card so it does not cover the name plate; rows that
      // carry it leave room (`HOLD_ROW`).
      className="hud-pill-count absolute -bottom-3.25 left-1/2 -translate-x-1/2 min-w-4.5 h-4 px-1 flex items-center justify-center"
      aria-hidden
    >
      {n}
    </span>
  );
}

// RecipeCards is the build-cost display: one full card per required resource.
export function RecipeCards({ cost }: { cost: Record<number, number> }) {
  const items = RES.filter((r) => cost[r.idx]);
  return (
    <span className="flex gap-1.5">
      {items.map((r) => (
        <ResCard
          key={r.idx}
          color={r.color}
          name={r.name}
          slot={resIconSlot(r.idx)}
          count={cost[r.idx]}
          countMode="multi"
        />
      ))}
    </span>
  );
}

/**
 * A price as grouped resource art: one icon per kind with its count beside it
 * past one (2 wheat, 3 ore), so every cost row is one line. The kind you are
 * short of is drawn as a grey silhouette (`hud-cc[data-short]`, pb-hud.css).
 * `aria-hidden` because the tile's accessible name already carries the price
 * in words (`srHint`/`note`).
 */
export function CostRow({ cost, have }: { cost: Record<number, number>; have?: number[] }) {
  const items = RES.filter((r) => cost[r.idx]);
  if (!items.length) return null;
  return (
    <span
      aria-hidden
      className="hidden sm:flex h-4 w-full shrink-0 items-center justify-center gap-[3px]"
    >
      {items.map((r) => {
        const short = have ? (have[r.idx] ?? 0) < cost[r.idx] : false;
        return (
          <span key={r.idx} className="hud-cc hud-ic" data-short={short ? "true" : undefined}>
            <ResIcon slot={resIconSlot(r.idx)} size={15} />
            {cost[r.idx] > 1 && <sub>{cost[r.idx]}</sub>}
          </span>
        );
      })}
    </span>
  );
}

// ShopArt is the piece rendered locally in your seat colour
// (lib/board3d/thumbnail). While a render is in flight, or if the model fails
// to load, the slot stays blank: the tile's box keeps its size, so nothing
// moves when the render lands.
export function ShopArt({ slot, thumbs }: { slot: string; thumbs: Record<string, string> }) {
  const src = thumbs[slot];
  if (!src) return null;
  // Full-bleed, like the development-card tile: these are renders of the piece
  // framed as cards.
  return <img src={src} alt="" draggable={false} className="w-full h-full object-contain" />;
}

/**
 * One progress deck as a card to pick, for the tied-defender draw and the
 * 7-fish Fishermen draw without a development deck ("which deck?").
 *
 * The decks are the three city-upgrade tracks, so each is drawn like the
 * dock's track tile: the track's prop (book, scales, crown) on a card in its
 * commodity colour, with cards left as the corner count.
 *
 * Sized for a dialog: a 12px label floor and a phone-width target. Three at
 * 76px fit inside a 320px dialog (256px) with gaps.
 *
 * `track` is the engine track index the command carries; callers iterate in
 * TRACK_ROW (display) order.
 */
export function DeckChoiceTile({
  track,
  left,
  thumbs,
  onPick,
  ...rest
}: {
  track: number;
  left: number;
  thumbs: Record<string, string>;
  onPick: () => void;
} & { [data: `data-${string}`]: string | number }) {
  const com = COMMOD[TRACK_COMMOD[track]];
  const empty = left < 1;
  // The tile's label, where the track name stands alone (no sentence to
  // inflect it).
  const name = i18n._(TRACKS[track]);
  const says = i18n._(empty ? TRACK_DECK_EMPTY[track] : TRACK_DRAW[track](left));
  return (
    <button
      type="button"
      disabled={empty}
      title={says}
      aria-label={says}
      onClick={() => {
        if (!empty) onPick();
      }}
      {...rest}
      style={{ ["--card-color" as string]: com.color }}
      // An empty deck takes the flat disabled face and a red 0 (pb-hud.css),
      // never a fade.
      data-empty={empty ? "true" : undefined}
      className={cn(
        "hud-lift relative flex w-[76px] h-[100px] flex-col items-center justify-center gap-1.5 rounded-[9px]",
        empty ? "cursor-default" : "cursor-pointer",
      )}
    >
      {/* The hand's card anatomy (hud-card-face): the commodity colour with a
          thin inner frame, a white well under the prop so it reads on any
          face, the name on the foot plate, the count as the corner coin. */}
      <span className="hud-card-face" aria-hidden />
      <span className="hud-card-well relative flex items-center justify-center w-12 h-12 p-1">
        <ShopArt slot={IMPROVE_SLOT[track]} thumbs={thumbs} />
      </span>
      {/* `Wissenschaft` has no space: `hyphens-auto` breaks it using the `lang`
          the app sets, and `overflow-wrap:anywhere` is the fallback. */}
      <span
        aria-hidden
        className="hud-card-label relative mx-[4px] self-stretch py-[3px] text-center leading-[1.1] text-[12px] font-semibold hyphens-auto [overflow-wrap:anywhere]"
      >
        {name}
      </span>
      <span
        aria-hidden
        className="hud-card-badge absolute -top-1.5 -right-1.5 z-10 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] font-semibold flex items-center justify-center"
      >
        {left}
      </span>
    </button>
  );
}

// ShopTile presents a buildable as a card the size of a resource card. It shows
// the piece (or a passed-in art node) and reveals the recipe on hover, in a
// popover above the card. `recipe` overrides the resource-cost rendering (for
// commodity-priced city upgrades); `badge` is a small overhanging corner chip
// (the current upgrade level).
export function ShopTile({
  name,
  cost,
  free,
  selected,
  disabled,
  onClick,
  art,
  recipe,
  badge,
  note,
  srHint,
  left,
  showLeft = true,
  have,
  label,
  strip,
  price,
  anchorRef,
}: {
  name: string;
  cost?: Record<number, number>;
  free?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  art?: React.ReactNode;
  recipe?: React.ReactNode;
  badge?: React.ReactNode;
  note?: React.ReactNode;
  /**
   * How many of this piece you have left, as the count in the tile's corner.
   * At 0 the count turns red and the tile is hatched, so an out-of-pieces tile
   * never reads as merely unaffordable. Omitted for a tile with no supply.
   */
  left?: number | null;
  /** False keeps `left` driving the OUT state without printing the count:
   * a shared supply (the dev deck) is counted in the bank, not on the tile. */
  showLeft?: boolean;
  /**
   * Your hand, indexed 1..5 by resource, so the cost row can underline what you
   * are short of. Omitted where the tile's price is not in resources.
   */
  have?: number[];
  /**
   * The short name written on the tile, where `name` (the accessible name) is
   * longer than a 68px tile holds. Defaults to `name`.
   */
  label?: string;
  /**
   * A readout under the art that is not dimmed with it (the improvement
   * tracks' level pips), since it is what the player reads the tile for.
   */
  strip?: React.ReactNode;
  /**
   * A price printed on the tile in the cost row's place, for a tile whose
   * price is not in resources (the improvement tracks, priced in a
   * commodity). `recipe` still drives the popover.
   */
  price?: React.ReactNode;
  /**
   * The tile's price or range in words, for the accessible name.
   *
   * `recipe` and often `note` are pictures. The Tip's `aria-describedby` lands
   * on the wrapper span (the trigger, so an unaffordable tile still explains
   * itself on hover), and a description on an ancestor is not announced, so
   * the name is the only channel to assistive tech here.
   */
  srHint?: string;
  /**
   * Files the tile's button under a HUD anchor, for an overlay that animates
   * out of it (a card revealed off the tile it was bought from). See
   * lib/hudAnchors.
   */
  anchorRef?: (el: HTMLElement | null) => void;
}) {
  /**
   * A tap, not a swipe's leftovers. These tiles sit in the dock's horizontal
   * scroller, and some spend on the first press (development card, an
   * improvement track, the one-city wall shortcut). Applied to every tile so
   * the shelf behaves consistently. See `useTapOnly`.
   */
  const tap = useTapOnly();
  // A tile lit by something other than its own press must be scrolled into
  // view: the Crane lights the improvement tiles from a card elsewhere on the
  // shelf, and at 320px they may be off screen. `nearest` leaves a visible
  // tile alone.
  const btn = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (selected) btn.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selected]);
  // The recipe renders through Tip, which portals to <body> so the dock's
  // horizontal scroller does not clip it (overflow-x:auto forces overflow-y to
  // clip too). The trigger is the wrapper span, because a `disabled` button
  // gets no pointer events and an unaffordable tile should still show its
  // cost on hover.
  // From sm the tile prints its own name and price, so the tooltip does not
  // repeat them.
  const smUp = useMediaQuery("(min-width: 640px)");
  const printsOwn = smUp && art != null && !!cost && !free && recipe == null;
  const recipeContent = (
    <span className="flex flex-col items-center gap-1 whitespace-nowrap">
      <span className="text-[9.5px] font-extrabold">{name}</span>
      {recipe != null ? (
        recipe
      ) : free ? (
        <span className="text-[10.5px] font-extrabold text-green-ink leading-none">
          <Trans context="this build costs nothing">Free</Trans>
        </span>
      ) : cost ? (
        <RecipeCards cost={cost} />
      ) : null}
    </span>
  );
  // Which face the tile shows. OUT beats everything (no piece to place);
  // SHORT is disabled for price; LOCK is disabled for any other reason (not
  // your turn, no legal spot, an expansion rule). Pressable is OK.
  const short =
    !!cost &&
    !free &&
    recipe == null &&
    !!have &&
    RES.some((r) => (have[r.idx] ?? 0) < (cost[r.idx] ?? 0));
  const state = left === 0 ? "out" : !disabled ? "ok" : short ? "short" : "lock";
  const tile = (
    <span className="relative inline-flex" tabIndex={-1}>
      <button
        // The anchor rides the button, not the wrapper: Tip clones the wrapper
        // with a ref of its own, which would replace this one.
        ref={(el) => {
          btn.current = el;
          anchorRef?.(el);
        }}
        type="button"
        disabled={disabled}
        onClick={onClick}
        {...tap}
        // Joined with periods by `sentences`, so a screen reader pauses
        // between parts without doubling a stop.
        aria-label={sentences([name, srHint, typeof note === "string" ? note : null])}
        data-selected={selected ? "true" : undefined}
        data-state={state}
        className={cn(
          HOTBAR_TILE,
          // One box for every tile: art, then name, then price. The 6px foot
          // keeps a name's last line off the inner frame on the phone tile.
          "hud-tile flex flex-col items-center justify-start gap-0.5 overflow-hidden px-1 pt-1.5 pb-1.5 sm:pt-2",
          // `pointer-events-none` only: the face stays opaque; the content is
          // what dims.
          disabled ? "pointer-events-none" : "hud-lift cursor-pointer",
        )}
      >
        {/* The art. Short and locked tiles dim it; an out-of-pieces tile dims
              everything, under the hatching. */}
        <span
          data-dim={disabled ? "true" : undefined}
          // Dimming per state (and the dark theme's plinth under the render) is
          // `.hud-tile-art` in index.css, keyed off the tile's `data-state`.
          className="hud-tile-art flex min-h-0 w-full flex-1 items-center justify-center"
        >
          {art ?? (
            <span className="text-[9px] sm:text-[10px] font-semibold leading-[1.05] text-center px-0.5">
              {label ?? name}
            </span>
          )}
        </span>
        {strip != null && <span className="flex w-full shrink-0 px-[3px]">{strip}</span>}
        {/* Locked for a reason other than price: a small lock printed in the
            corner, so it never reads as merely unaffordable. */}
        {state === "lock" && (
          <span aria-hidden data-lock-chip>
            <LockSimple size={9} weight="bold" />
          </span>
        )}
        {/* The name, at every size, including the 44px phone tile, where it
              tells a road from a wall. (`line-clamp-*` sets `display:
              -webkit-box` after `hidden`, so `hidden sm:block` would not hide
              it anyway.) */}
        {art != null && (
          <span
            className={cn(
              // Wraps inside the tile's inner frame (36px on the 44px tile,
              // 60px on the 68px one); the art gives up the height. Clamped at
              // four lines because Explorers' long names need that on the
              // phone tile in French, Italian, Russian and Ukrainian.
              //
              // `Settlement` does not fit 36px at any legible size, so long
              // words hyphenate via `hyphens-auto` and the `lang` on <html>.
              // Chromium never hyphenates a capitalised word under `en` (it
              // treats it as a proper noun), so the English msgids that need a
              // break carry a soft hyphen. `break-words` is the last resort
              // for a browser with no dictionary.
              //
              // The size per tile is `.hud-tile-name` in index.css: 9px
              // semibold on the 44px tile, 10.5px medium on the 68px one.
              // Ink at 700; muted (never faded) on a locked or sold-out
              // tile, by `data-state` in pb-hud.css.
              "hud-tile-name max-w-full shrink-0 line-clamp-4 break-words hyphens-auto text-center",
            )}
          >
            {label ?? name}
          </span>
        )}
        {/* The price, on the tile, from sm. Not greyed on a short tile: what
              you are short of is what you read it for. */}
        {cost && !free && recipe == null && <CostRow cost={cost} have={have} />}
        {/* A free build (Road Building) says so where the price would be, as
            a free improvement does. */}
        {free && price == null && (
          <span
            aria-hidden
            className="hidden sm:flex h-4 w-full shrink-0 items-center justify-center"
          >
            <span data-free>
              <Trans context="this build costs nothing">Free</Trans>
            </span>
          </span>
        )}
        {price != null && (
          <span
            aria-hidden
            className="hidden sm:flex h-4 w-full shrink-0 items-center justify-center"
          >
            {price}
          </span>
        )}
      </button>
      {/* Pieces left, as a tab on the tile's top edge, outside the button so
            its overflow clip does not cut it. */}
      {left != null && showLeft && (
        <span className="hud-left" data-out={left === 0 ? "true" : undefined} aria-hidden>
          {left}
        </span>
      )}
      {badge != null && (
        // Top-right, the corner the pieces-left count takes (no tile carries
        // both); on the left it overlapped the neighbour's count.
        // `.hud-tile-badge` lifts it over a hovered tile, as `.hud-left` does.
        <span className="hud-badge hud-tile-badge absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 text-[10px] font-semibold flex items-center justify-center">
          {badge}
        </span>
      )}
    </span>
  );
  return printsOwn && note == null ? (
    tile
  ) : (
    <Tip
      // From sm the tile prints its own name and price, so the tip only says
      // why it is dark; below sm it carries the name and recipe too.
      title={printsOwn ? note : recipeContent}
      // Above the name and the price, not under them: see the note band in Tip.
      note={printsOwn ? undefined : (note ?? undefined)}
      className="text-center"
    >
      {tile}
    </Tip>
  );
}

// Descriptors, not strings: built once at import, and rendered through
// `i18n._` at each call site so they follow a language change.
const TRACKS: MessageDescriptor[] = [
  msg({ message: "Trade", context: "city improvement track" }),
  msg({ message: "Politics", context: "city improvement track" }),
  msg({ message: "Science", context: "city improvement track" }),
];

/**
 * Sentences that name a track, one message per track.
 *
 * `TRACKS` is only the track's name as a label. Each sentence ("Upgrade X",
 * "The X deck is empty", "Draw an X progress card", "X Metropolis") inflects
 * the noun differently in German, Russian and Polish, so each is written out
 * whole per track, as in lib/cardPhrases.
 */
const TRACK_DECK_EMPTY: MessageDescriptor[] = [
  msg({ id: "track.deckEmpty.trade", message: "The Trade deck is empty." }),
  msg({ id: "track.deckEmpty.politics", message: "The Politics deck is empty." }),
  msg({ id: "track.deckEmpty.science", message: "The Science deck is empty." }),
];

const TRACK_DRAW: ((left: number) => MessageDescriptor)[] = [
  (left) =>
    msg({
      id: "track.draw.trade",
      message: plural(left, {
        one: "Draw a Trade progress card (# left).",
        other: "Draw a Trade progress card (# left).",
      }),
    }),
  (left) =>
    msg({
      id: "track.draw.politics",
      message: plural(left, {
        one: "Draw a Politics progress card (# left).",
        other: "Draw a Politics progress card (# left).",
      }),
    }),
  (left) =>
    msg({
      id: "track.draw.science",
      message: plural(left, {
        one: "Draw a Science progress card (# left).",
        other: "Draw a Science progress card (# left).",
      }),
    }),
];

/**
 * The Commercial Harbor overlay title, one message per resource received,
 * indexed by engine resource index (1..5; 0 unused). The resource is an
 * inflected object with a gendered article in some languages, so each is
 * written out.
 */
const HARBOR_RECEIVE: MessageDescriptor[] = [
  msg({ id: "harbor.receive.none", message: "Commercial Harbor: return a commodity" }),
  msg({
    id: "harbor.receive.wood",
    message: "Commercial Harbor: return a commodity (you receive wood)",
  }),
  msg({
    id: "harbor.receive.brick",
    message: "Commercial Harbor: return a commodity (you receive brick)",
  }),
  msg({
    id: "harbor.receive.sheep",
    message: "Commercial Harbor: return a commodity (you receive sheep)",
  }),
  msg({
    id: "harbor.receive.wheat",
    message: "Commercial Harbor: return a commodity (you receive wheat)",
  }),
  msg({
    id: "harbor.receive.ore",
    message: "Commercial Harbor: return a commodity (you receive ore)",
  }),
];
const HARBOR_RECEIVE_ANY = HARBOR_RECEIVE[0];

const TRACK_METRO_EARNED: MessageDescriptor[] = [
  msg({
    id: "track.metroEarned.trade",
    message:
      "Trade metropolis earned. Tap one of your cities to build it on (the barbarians can never pillage that city)",
  }),
  msg({
    id: "track.metroEarned.politics",
    message:
      "Politics metropolis earned. Tap one of your cities to build it on (the barbarians can never pillage that city)",
  }),
  msg({
    id: "track.metroEarned.science",
    message:
      "Science metropolis earned. Tap one of your cities to build it on (the barbarians can never pillage that city)",
  }),
];
// The shop shot for each track's tile, by engine track index (like TRACKS and
// TRACK_COMMOD), so art follows its track through the display reorder. Each
// names one prop in improvements.glb: a book, scales, a crown
// (lib/board3d/thumbnail.ts SHOP_SHOTS).
const IMPROVE_SLOT = ["improve_trade", "improve_politics", "improve_science"];

// The two marks an upgrade tile can hang off its corner. Drawn here rather
// than taken from hudIcons because at 10px inside an 18px chip a bold glyph
// fills its counters.
//
// The chevron: the next level is legal, affordable and yours to buy this turn.
export function UpgradeChevron() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 7.5 L6 4 L9.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
// The metropolis replaces it: a star, for the one thing on the row that is
// awarded rather than bought. Whether it is permanent or stealable is shown by
// the pip row's solid/dashed underline (components/game/TrackPips).
export function MetropolisMark() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 1 L7.6 4.4 L11.2 4.9 L8.6 7.5 L9.3 11.1 L6 9.4 L2.7 11.1 L3.4 7.5 L0.8 4.9 L4.4 4.4 Z"
        fill="currentColor"
      />
    </svg>
  );
}
// The commodity each improvement track spends is not positional: Trade costs
// Cloth, Politics costs Coin, Science costs Paper. Indices into COMMOD
// (lib/cardFace).
const TRACK_COMMOD = [0, 2, 1];
// How each progress card is played (`progressInput`) lives with the rest of
// its metadata in lib/progressCards. Constitution and Printer score on draw and
// are never held (`vpCard`, engine/knights/progress.go), so they are typed `"vp"`.

/**
 * The tip on one face in the "name a resource or commodity" row.
 *
 * Like the Aqueduct, the tip names the consequence ("Take a Wood"), not the
 * card under the pointer. The three cards sharing this row use the answer
 * differently, so the sentence comes from the card.
 *
 * Wording follows the hints in lib/progressCards, which follow engine/knights
 * (Trade Monopoly takes exactly 1 per opponent). The fallback keeps this
 * total for a new `res`/`com`/`resorcom` card.
 *
 * Keyed by the card token: each sentence puts a number beside the noun, which
 * German and Spanish inflect, so they live one per card in lib/cardPhrases.
 * The fallback names no card, as `devNotHeld` does.
 */
function nameCardTip(card: string, key: CardKey): string {
  switch (card) {
    case "resource_monopoly":
      return isResKey(key) ? takeTwoOfEach(key) : unnamedPickTip();
    case "trade_monopoly":
      return isComKey(key) ? takeOneOfEach(key) : unnamedPickTip();
    case "merchant_fleet":
      return tradeCardAtTwo(key);
    default:
      return unnamedPickTip();
  }
}

/** The card-free tip: an unknown card, or a row drawing a good it cannot serve. */
const unnamedPickTip = (): string =>
  i18n._(msg({ message: "Name this card", context: "name a resource or commodity" }));

/**
 * Whether this client can draw the board. Without WebGL the screen says so;
 * there is no second board. Probed once per module load: it cannot change
 * within a page and costs a real GL context.
 */
const canRenderBoard = supportsWebGL();

export function Game() {
  const { g, inv } = useSearch({ strict: false });
  const sock = useGameSocket();
  // Both feeds are oldest-first, so they open at and stick to the bottom.
  // Owned here rather than in TableFeed because the surface mounts and
  // unmounts with its control, and the scroll position must survive the log
  // moving between the dock panel and the island. TableFeed reports which is
  // on screen; see lib/stickyScroll.
  const eventScroll = useStickyScroll<HTMLDivElement>(sock.events);
  const chatScroll = useStickyScroll<HTMLDivElement>(sock.chat);

  // Unread chat: the newest message against the newest one shown. The feed
  // starts closed on a phone and on the LOG tab everywhere, so this drives the
  // dot in TableFeed.
  //
  // Clearing on sight is safe because the chat pane pins to its newest message
  // whenever it is raised; the dot is only drawn on a control whose pane is
  // down.
  const lastChatId = React.useMemo(() => {
    for (let i = sock.chat.length - 1; i >= 0; i--) {
      if (sock.chat[i].scope === `game:${g}`) return sock.chat[i].id ?? null;
    }
    return null;
  }, [sock.chat, g]);
  const [seenChatId, setSeenChatId] = React.useState<number | null>(null);
  // Read through a ref so the callback stays identity-stable: it is an effect
  // dependency in TableFeed and would otherwise re-run every frame.
  const lastChatIdRef = React.useRef(lastChatId);
  lastChatIdRef.current = lastChatId;
  const onChatRead = React.useCallback(() => setSeenChatId(lastChatIdRef.current), []);
  const unreadChat = lastChatId != null && lastChatId !== seenChatId;

  // The bank strip is the panel's own trigger (see DockPanels). `DockPanels`'s
  // `openRef` remains for chrome that needs to raise a panel it does not own.

  // Discord Rich Presence (no-op outside the Activity). Derived from the live
  // full view so the profile card tracks ruleset, turn, own VP, and party size.
  const presence = React.useMemo<PresenceInput | null>(() => {
    const f = sock.full;
    if (!f) return null;
    return {
      gameId: g ?? "",
      status: f.phase === "finished" ? "finished" : "active",
      ruleset: f.config.ruleset,
      seatedPlayers: f.players.length,
      maxPlayers: f.config.players,
      viewerSeat: f.viewer,
      curSeat: f.cur,
      viewerVP: f.players.find((p) => p.seat === f.viewer)?.vp ?? null,
    };
  }, [sock.full, g]);
  useRichPresence(presence);
  const navigate = useNavigate();
  const toast = useToast();
  // Declared with the other unconditional hooks, above the loading
  // early-returns (see Game.hooks.test.ts).
  const { t } = useLingui();
  const { me: authMe } = useAuth();
  const [mode, setMode] = React.useState<BuildMode>("none");
  const [robberChoice, setRobberChoice] = React.useState<"robber" | "pirate">("robber");
  const [setupShip, setSetupShip] = React.useState(false); // Islands: open by sea at setup
  // Overlay / interaction state. All hooks must be declared before any early
  // return (Rules of Hooks); there is a loading early-return below.
  const [victimPrompt, setVictimPrompt] = React.useState<{
    hex: Hex;
    victims: number[];
    pirate?: boolean;
    chase?: Vertex;
    /** The board mode to restore when the player backs out (a chase disarms
     *  its mode to open this; the robber's own mode is derived and returns
     *  by itself). */
    backMode?: BuildMode;
  } | null>(null);
  const [picker, setPicker] = React.useState<"yop" | "mono" | null>(null);
  // Fishermen. `fishPanel` is the ladder of five spends; `fishPending` is the
  // chosen spend awaiting a target (hex, victim, resource, edge). Choosing
  // closes the panel, since the follow-up happens on the board or in another
  // prompt.
  const [fishPanel, setFishPanel] = React.useState(false);
  const [fishPending, setFishPending] = React.useState<FishSpend | null>(null);
  // The edge a 5-fish spend named, held until the credit it buys arrives and
  // the road can be sent for it (see lib/fish.fishRoadNext).
  const [fishRoad, setFishRoad] = React.useState<FishRoadPending | null>(null);
  const [bootPrompt, setBootPrompt] = React.useState(false);
  // Rivers. One flag: both coin trades resolve on the spot, so there is no
  // armed follow-up. The bridge is a build like any other and rides on `mode`.
  const [coinPanel, setCoinPanel] = React.useState(false);
  const [wagonPanel, setWagonPanel] = React.useState(false);
  // Caravans. The camel vote is a forced, timed decision, so its panels open
  // on their own. `camelStood` lets a player stand a panel down to look at the
  // board, leaving a prompt behind (as the over-limit progress hand does).
  // Keyed by phase, so standing down the bid does not hide the placement
  // picker that follows.
  const [camelStood, setCamelStood] = React.useState<"bid" | "place" | null>(null);
  // Rivers alongside Knights. The pillage buyout is answered by a button (pay)
  // or by tapping the city to give up instead. `Overlay` is a blocking modal,
  // so the offer must be dismissible to reach the board.
  //
  // Keyed by the attack it belongs to, like `raidersStood`: a boolean would
  // hide the offer at the next lost defense. Keying also avoids a reset effect
  // (all top-level hooks must sit above the loading early-returns; see
  // Game.hooks.test.ts).
  const [buyoutStood, setBuyoutStood] = React.useState<number | null>(null);
  // Explorers. `explorersPanel` is the fleet panel for the whole module (the
  // Movement phase is a second half of the turn). `explorersShip` and
  // `explorersJob` are what a panel button armed: the hull the board is
  // picking a destination or corner for, and which corner job, since two can
  // be legal at one corner and one spends the ship.
  const [explorersPanel, setExplorersPanel] = React.useState(false);
  const [explorersRecycling, setExplorersRecycling] = React.useState(false);
  const [explorersRecycle, setExplorersRecycle] = React.useState(0);
  const [explorersShip, setExplorersShip] = React.useState<number | null>(null);
  const [explorersJob, setExplorersJob] = React.useState<ExplorerShipAct["job"] | null>(null);
  // The road half of the module's third setup round, held while the player
  // picks the ship's sea edge; that round places both in one command.
  const [explorersRoad, setExplorersRoad] = React.useState<Edge | null>(null);
  // Which camel panel is on screen right now, for the Escape ladder. Declared
  // here and filled in below, where `camelRoleNow` is derived.
  const camelOpenRef = React.useRef<"bid" | "place" | null>(null);
  // Raiders. `raidersGold` and `raidersRiders` are voluntary panels, opened and
  // closed on a press like the fish shelf. `riderFrom` holds the first half of
  // a two-step move between the panel and the board press (like
  // `shipMoveFrom`). `raidersStood` lets a forced, timed panel (Treason, a
  // steal) be stood down to a prompt, keyed by panel like `camelStood`.
  const [raidersGold, setRaidersGold] = React.useState(false);
  const [raidersRiders, setRaidersRiders] = React.useState(false);
  const [riderFrom, setRiderFrom] = React.useState<Edge | null>(null);
  // Under Fishermen a rider's hurry may be paid with two fish instead of the
  // grain. This is the player's choice of currency for the move in progress;
  // it matters only when both are in hand.
  const [riderPayFish, setRiderPayFish] = React.useState(false);
  // Explorers: a pirate hex tapped with more than one ship owner beside it,
  // waiting for the player to say whom it robs.
  const [pirateChoice, setPirateChoice] = React.useState<{
    h: Hex;
    victims: number[];
    turn: number;
  } | null>(null);
  // Which barbarian a 7 or a Knight moves (the player's choice of three). A
  // drive-off names its own (`barb_index`) and this is ignored. Null means
  // the first, so the board is armed from the start.
  const [wagonBarbPick, setWagonBarbPick] = React.useState<number | null>(null);
  const [wagonDestination, setWagonDestination] = React.useState<{
    barb: number;
    e: Edge;
    hexes: Hex[];
  } | null>(null);
  const [raidersStood, setRaidersStood] = React.useState<string | null>(null);
  // Which forced Raiders panel is on screen, for the Escape ladder declared
  // far above. Must be written where it is derived, like `camelOpenRef`.
  const raidersOpenRef = React.useRef<string | null>(null);
  // Trade basket: give is built by clicking cards in hand, want by clicking
  // the basket popup's resource pills. One Trade button routes to the bank
  // (when the shape matches a maritime ratio) or to a table offer.
  const [currencyGive, setCurrencyGive] = React.useState<CurrencyAmounts>({});
  const [currencyWant, setCurrencyWant] = React.useState<CurrencyAmounts>({});
  const [tradeGive, setTradeGive] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [tradeWant, setTradeWant] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [tradeComGive, setTradeComGive] = React.useState<number[]>([0, 0, 0]); // Knights commodities offered
  const [tradeComWant, setTradeComWant] = React.useState<number[]>([0, 0, 0]); // Knights commodities wanted
  const [discardPick, setDiscardPick] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [discardComPick, setDiscardComPick] = React.useState<number[]>([0, 0, 0]); // Knights commodities
  // Optimistic spend overlay: subtracts a paid action's cost from the shown
  // hand at once and expires when a newer snapshot lands (seq-gated in
  // optimistic.ts, so never double-counted). See send() below.
  const [spent, setSpent] = React.useState<Spent>(NO_SPENT);
  // Commands sent and not yet answered. An entry gates the control that sent
  // it (no duplicate command) and, when the outcome is a server-published
  // position, carries the piece the board draws at once. Entries leave when
  // the view shows the result, on an `err` naming their id, or on the TTL.
  // See lib/inflight.
  const [inflight, setInflight] = React.useState<InFlight[]>([]);
  // Read by the TTL sweep without being its dependency: re-arming the interval
  // on every registry change would restart the clock indefinitely.
  const inflightRef = React.useRef(inflight);
  inflightRef.current = inflight;
  // The table stops taking input once the connection has been gone a moment
  // (see lib/link).
  const socketDown = useLinkDown();
  // The half-open case the socket status cannot see: one of our commands
  // expired with no reply. Raised by the TTL sweep, cleared by the next sign of
  // life. See lib/link.isAckLost.
  const [ackLost, setAckLost] = React.useState(false);
  const linkDown = socketDown || ackLost;
  // When any server frame last arrived. A ref: it is only read to judge a
  // timeout, and state would re-render on every frame.
  const lastFrameAt = React.useRef(0);
  React.useEffect(() => {
    lastFrameAt.current = Date.now();
    setAckLost(false);
  }, [sock]);
  // The repair. `ackLost` means we sent something and the server said nothing
  // for a full TTL (not even its resync hint), while `readyState` still says
  // OPEN, so no `onclose` or backoff happens. `reconnectNow` drops that socket
  // and dials a fresh one, which resubscribes and refetches. lib/ws's
  // heartbeat covers a player who is only watching; this is the fast path for
  // one who is playing.
  React.useEffect(() => {
    if (ackLost) gameSocket.reconnectNow();
  }, [ackLost]);
  // A clicked spot that affords more than one action, and the screen point to
  // anchor the choice to. A single-action spot is acted on directly.
  const [inspectAt, setInspectAt] = React.useState<{
    loc: BoardLocation;
    at: { x: number; y: number };
  } | null>(null);
  /**
   * The piece the pointer is resting on, and where the pointer was. Changes
   * only when the pointer reaches a different piece or leaves one; Board3D
   * handles pointermove imperatively. See `onHoverInfo` in
   * components/board/props.
   */
  const [hoverInfo, setHoverInfo] = React.useState<{
    info: PieceInfo;
    at: { x: number; y: number };
  } | null>(null);
  // Whether the screen can hover, and whether the player has asked for the
  // next press to be a question; together they pick which routes to a piece's
  // description are live (see lib/touch).
  const noHover = useNoHover();
  const explaining = useExplaining();
  /**
   * Hand cards share the shelf's horizontal scroller, and on a hover pointer
   * a press plays the card, so a flick must not spend a Monopoly. See
   * `useTapOnly`.
   */
  const handTap = useTapOnly();
  /**
   * The card the player is reading, on a screen that cannot hover. Holds the
   * resolved sheet, so the reason ladder and commit closure are computed once
   * with the tile's other facts. See components/game/CardSheet.
   */
  const [cardSheet, setCardSheet] = React.useState<React.ComponentProps<typeof CardSheet> | null>(
    null,
  );
  /**
   * An armed commit: run it, or offer it as a one-entry menu first.
   *
   * Every hex commit and every armed vertex or edge commit (lib/boardTap) comes
   * here, since only the handler can name the armed action (see `pendingHex`).
   * `placeOrAsk` keeps the unarmed setup placements.
   *
   * `id` names the piece so the menu can find its art (`CARD_ART` keys are the
   * placement ids), and doubles as the React key.
   */
  const hexOrAsk = React.useCallback(
    (spec: ArmedEntry, at: { x: number; y: number } | undefined, run: () => void) => {
      if (!noHover) {
        run();
        return;
      }
      setPendingHex({
        run,
        at: at ?? { x: 0, y: 0 },
        // `ready` by default because only spots the board offered reach here.
        // A plain build passes its roster status, so a short hand reads short.
        action: { ...spec, rank: 1, status: spec.status ?? "ready" },
      });
    },
    [noHover],
  );

  /**
   * Commit now, or hand the spot to the standard action menu.
   *
   * Touch does not place on the first tap: a finger aims and commits at once
   * and hides the target, and the same finger pans the camera. So on touch the
   * spot's action menu opens, narrowed by the armed or forced mode to one
   * entry; setup has its own entries (see lib/locationActions).
   *
   * Hexes are not `BoardLocation`s, so the robber, pirate and Inventor tokens
   * dispatch on the tap; none spends a resource.
   */
  const placeOrAsk = React.useCallback(
    (loc: BoardLocation | null, at: { x: number; y: number } | undefined, run: () => void) => {
      if (!noHover || !loc) {
        run();
        return;
      }
      // The menu anchors at the press. The fallback covers a host that
      // dispatched without a point.
      setInspectAt({ loc, at: at ?? { x: 0, y: 0 } });
    },
    [noHover],
  );

  /**
   * A hex the player has aimed at but not committed to.
   *
   * Vertex and edge commits use `actionsAt`, a function of the view. A hex's
   * action (robber, pirate, Bishop) depends on the armed mode, which lives
   * here, so the handler builds the entry and hands it to the same menu.
   * Moving the robber is the least reversible tap, on the surface where taps
   * compete with panning.
   */
  const [pendingHex, setPendingHex] = React.useState<{
    at: { x: number; y: number };
    action: LocationAction;
    run: () => void;
  } | null>(null);
  const [knightMoveFrom, setKnightMoveFrom] = React.useState<Vertex | null>(null);
  const [shipMoveFrom, setShipMoveFrom] = React.useState<Edge | null>(null);
  const [chaseFrom, setChaseFrom] = React.useState<Vertex | null>(null); // Knights chase-robber: the knight driving the robber
  const [diplomatFrom, setDiplomatFrom] = React.useState<Edge | null>(null); // Diplomat: your own open road, pending remove/relocate
  const [commercialHarbor, setCommercialHarbor] = React.useState(false); // Commercial Harbor: per-opponent resource allocation
  const [progressCard, setProgressCard] = React.useState<string | null>(null);
  const [progressOverlay, setProgressOverlay] = React.useState<{
    card: string;
    kind: ProgressKind;
  } | null>(null);
  const [tradingHouse, setTradingHouse] = React.useState(false); // Knights Trade-L3 commodity trade
  const [tradeOpen, setTradeOpen] = React.useState(false); // trade panel toggle
  const [inventorA, setInventorA] = React.useState<Hex | null>(null); // Inventor: first token hex
  const [masterMerchant, setMasterMerchant] = React.useState(false); // Master Merchant flow
  const [votedRematch, setVotedRematch] = React.useState(false); // local mirror of this client's rematch vote
  const [summaryOpen, setSummaryOpen] = React.useState(true); // post-game summary overlay visibility
  const [resetConfirm, setResetConfirm] = React.useState(false); // host "reset to lobby" confirm overlay
  const [leaveOpen, setLeaveOpen] = React.useState(false); // "leave game" confirm dialog visibility
  const [surrenderOpen, setSurrenderOpen] = React.useState(false); // duel "surrender" confirm dialog
  const [endGameOpen, setEndGameOpen] = React.useState(false); // "end the game against bots" confirm dialog
  const [drawOpen, setDrawOpen] = React.useState(false); // "offer a draw" confirm dialog
  // The over-limit progress-discard overlay was waved aside so the player can
  // get under the limit by playing a card instead. Reset once the hand is
  // legal (see the effect below).
  const [progressDiscardStood, setProgressDiscardStood] = React.useState(false);

  /**
   * The viewer's own equipped cosmetics. Only the robber is read, for the
   * preview the pointer carries (Board3D's `viewerRobber`); the robber on the
   * board wears `view.robber_skin`, whoever last moved it. Same query key as
   * the store, so it is usually cached; the stock robber shows until it lands.
   */
  const loadoutQ = useQuery({ queryKey: ["loadout"], queryFn: api.loadout });

  const seatQ = useQuery({
    queryKey: ["game", g],
    // `since` is read at request time, not in the key: the first fetch asks
    // for the whole log and later refetches (reconnect, gap, resync hint) ask
    // only for what is missing. The invite is likewise read at request time:
    // it belongs to the link this route was opened with, and without it a
    // spectator on a private table's watch link would be refused.
    queryFn: () => api.getGame(g!, gameSocket.logSince(), inv),
    enabled: !!g,
    // A missing game (404) or a private one you can't see (403) won't resolve on
    // retry; fail fast so the redirect below fires.
    //
    // Everything else backs off and retries, 429 especially: the event log is
    // metered server-side, and a rate limit must not evict a player from the
    // table.
    retry: retryUnlessFatal,
    retryDelay: retryBackoffMs,
  });
  // Seat names come from the lobby summary when readable; spectators of a
  // private game are refused that endpoint, so fall back to the live view's
  // names. Held by content: `sock.full` is a fresh object on every message, and
  // a new `seatName` identity defeats `EventLogFeed`'s memo and
  // `describeEventLines`'s cache, re-rendering the whole log every second.
  const seatNamesKey = JSON.stringify(sock.full?.seat_names ?? null);
  const viewSeatNames = React.useMemo(
    () => sock.full?.seat_names,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seatNamesKey],
  );
  const seatName = React.useCallback(
    (seat: number) => {
      const s = seatQ.data?.seats.find((s) => s.no === seat);
      const n = seat + 1;
      const base = s?.user_name ?? viewSeatNames?.[seat] ?? t`Seat ${n}`;
      return seatDisplayName(base, s?.status);
    },
    [seatQ.data, viewSeatNames, t],
  );
  // True when I own a seat a bot is playing because I chose to spectate
  // (status "auto"). Drives spectator mode and "Rejoin". Defined above
  // myTurn / myTurnNow, which use it.
  const myBotControlled =
    !!authMe && seatBotControlled(seatQ.data?.seats?.find((s) => s.user_id === authMe.id));
  const cbMode = useCbMode();
  const colorblind = cbMode !== "off";
  // Whether this viewer wants legal spots lit at rest. A module with its own
  // subscribers, set from the header's settings panel (lib/placementMarks).
  const placementMarks = usePlacementMarks();
  // A seat's chosen/default colour from the lobby summary, or the seat-order
  // palette before it loads. Colorblind mode replaces every colour with a
  // safe palette here, the single swap point for board, panels, modals and
  // post-game; custom picks are overridden since two reds stay two reds.
  const colorOf = React.useCallback(
    (seat: number) =>
      colorblind
        ? cbSeatColor(seat, cbMode)
        : seatQ.data?.seats.find((s) => s.no === seat)?.color || seatColor(seat),
    [seatQ.data, colorblind, cbMode],
  );

  // Everything the seat rail needs that the live view lacks. The rail's tiles
  // are memoised on this object's identity, so it depends only on the roster
  // and colour mode; `label` takes the fallback name as an argument because
  // `view.seat_names` is a fresh object every frame.
  const seatChrome = React.useMemo<SeatChrome>(
    () => ({
      label: (seat, viewName) => {
        const s = seatQ.data?.seats.find((x) => x.no === seat);
        const n = seat + 1;
        return seatDisplayName(s?.user_name ?? viewName ?? t`Seat ${n}`, s?.status);
      },
      decoration: (seat) => seatQ.data?.seats.find((x) => x.no === seat)?.decoration,
      color: colorOf,
    }),
    [seatQ.data, colorOf, t],
  );

  // No game id: nothing to rejoin, so go to the lobby.
  React.useEffect(() => {
    // The Activity always has a game id and no lobby to fall back to, so
    // these bounces are web-only.
    if (!g && !inActivityMode()) void navigate({ to: "/play" });
  }, [g, navigate]);

  // An unknown game id has no summary; bounce to the lobby rather than hang on
  // "Connecting to game..." (a lobby-status game sends no state frame).
  //
  // Only a terminal error leaves. A throttled or failed refetch is not proof
  // the table is gone: the websocket carries the game on its own. See
  // isFatalApiError.
  React.useEffect(() => {
    if (seatQ.isError && isFatalApiError(seatQ.error) && !inActivityMode())
      void navigate({ to: "/play" });
  }, [seatQ.isError, seatQ.error, navigate]);

  React.useEffect(() => {
    // Carry the invite so an unseated spectator of a private game passes the
    // WS `sub` gate, as in Lobby.
    if (g) gameSocket.follow(g, inv);
    return () => gameSocket.unfollow();
  }, [g, inv]);

  // Seed the live store from the HTTP response so the screen renders as soon
  // as the fetch resolves. seed() is seq-wins, so a newer ws frame is kept.
  React.useEffect(() => {
    if (seatQ.data) gameSocket.seed(seatQ.data);
  }, [seatQ.data]);

  // The socket requests a reconcile (reconnect, seq gap, resync hint) by
  // bumping `reconcile`; refetch, which reseeds via the effect above. `> 0`
  // skips the initial mount.
  React.useEffect(() => {
    if (sock.reconcile > 0) void seatQ.refetch();
    // Keyed on the bump alone: `seatQ` changes identity on every query state
    // change, including this refetch's, so depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sock.reconcile]);

  // A finished game streams a postgame frame (with the final board) instead
  // of a state frame, so fall back to that board; the endgame screen overlays
  // the final table.
  //
  // Declared here because the entry gate below needs it, and the sound cues
  // are gated on the entry gate.
  const view = sock.full ?? sock.postgame?.board ?? null;

  // The board's view: authoritative, plus any piece this client placed that
  // the server has not answered yet.
  //
  // For the board only: the dock, rail, log, VP column and location menu read
  // `view`, so a phantom piece is never counted.
  //
  // Drawn solid, not as a ghost (translucency means "not settled"; see
  // lib/board3d/ghost). The position came from a server-published target set.
  //
  // Memoised (so declared above the loading guards): `applyPending` allocates
  // a fresh FullView while an entry is outstanding, and Board3D memoises its
  // pick targets and piece serialization on `[view]` identity.
  const boardView = React.useMemo(
    () => (view ? applyPending(view, inflight) : null),
    [view, inflight],
  );

  // Every seat's colour, so the log draws each player's own pieces. Rendering
  // is lazy and cached per colour in the hook. Above the loading guards and
  // tolerant of a null view (no roster yet means no renders).
  const seatColors = React.useMemo(
    () => (view?.players ?? []).map((p) => colorOf(p.seat)),
    [view?.players, colorOf],
  );

  // The terrain, held by content for `EventLogFeed`'s robber line:
  // `sock.full` is a fresh object every frame, which would defeat the feed's
  // memo. The terrain changes about twice a game, so this is usually a cheap
  // string compare.
  const boardTilesKey = JSON.stringify(view?.board?.tiles ?? null);
  const logTiles = React.useMemo(
    () => view?.board?.tiles ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardTilesKey],
  );

  /**
   * The log as memory mode leaves it: a fifteen-second tail (see
   * lib/fadingLog). Only while the game is in play; afterwards the full log
   * returns for review. Reads `sock.full` rather than `view`, which falls back
   * to the postgame board. Tables without the mode get `sock.events` back
   * unchanged.
   */
  const memoryLog =
    !!sock.full?.config?.memory_mode && sock.postgame == null && sock.winner == null;
  const fadingLog = useFadingLog(sock.events, memoryLog);

  // The entry gate. Every path into this screen mounts this component (start,
  // refresh, reconnect, direct link, spectating), so gating here covers all.
  //
  // Must be above the `if (!view)` early return, like the hooks around it
  // (React #310).
  /**
   * Has the board drawn a frame? Vacuously true without WebGL, so such a
   * client is not held at the entry screen for a milestone that never comes.
   * The board mounts behind the entry cover (see BoardEntryCover in the main
   * return) so this can be true before the player is let in.
   */
  const [boardReady, setBoardReady] = React.useState(!canRenderBoard);
  const handleBoardReady = React.useCallback(() => setBoardReady(true), []);

  const entry = useGameEntry({
    viewReady: !!view,
    boardReady,
    ruleset: sock.summary?.game.ruleset ?? seatQ.data?.game.ruleset,
    ownColor: view ? colorOf(view.viewer) : null,
    seatColors,
  });

  // Silent until the board shows. The board mounts behind the entry card, so
  // the game may start and setup placements happen before the player sees
  // anything. The hold suspends the audio context rather than only skipping
  // `play`, which covers the music element and stops scheduling against a
  // clock about to jump (see lib/sound `setAudioHeld`).
  //
  // Released on unmount too, so leaving cannot strand the app in silence.
  /**
   * The game's own controls wait for the board too. The board layer is `inert`
   * until the gate opens, but the HUD stays live (header, menus, chat, log,
   * seat rail, settings, Leave), so every control that sends a game command or
   * arms a board placement is shown disabled instead: a player must not end a
   * turn or roll against a board they cannot see yet.
   *
   * Applied where the controls already take their state, so no button carries
   * it on its own: the turn gates (`canRoll`, `canTurnAction`, `canAct`,
   * `canPlayDev`, `canCounter`, which every shelf tile, card, the dice and End
   * turn derive from), `HeldActions` around the turn banner's choices and the
   * floating offers, and `Overlay` for every decision dialog (see
   * components/game/CommandHold). `cmd` refuses outright while it holds, so
   * nothing leaves even from a control none of those reach.
   */
  const entryHeld = !entry.ready;

  React.useEffect(() => {
    setAudioHeld(!entry.ready);
    return () => setAudioHeld(false);
  }, [entry.ready]);

  // --- Sound effects ---------------------------------------------------------
  // Slots resolve from the committed pack (see sound.ts); this only warms them
  // and runs the music, which stops when you leave. Muted unless the settings
  // toggle says otherwise.
  React.useEffect(() => {
    // Decode up front so a game's first placement is not late. The lobby
    // usually did this already.
    preload(GAME_SOUND_SLOTS);
    refreshMusic(); // start the music if it is on
    return () => {
      stopMusic();
    };
  }, []);

  // The opening hold: for half a second after a game begins the table takes
  // no input, so the start cue is heard before the first player can act.
  const [startHold, setStartHold] = React.useState(false);
  const beginGame = React.useCallback(() => {
    play("sound_start");
    setStartHold(true);
  }, []);
  React.useEffect(() => {
    if (!startHold) return;
    const t = setTimeout(() => setStartHold(false), START_HOLD_MS);
    return () => clearTimeout(t);
  }, [startHold]);

  // Play a sound for each newly arrived game event.
  //
  // Anchored like `flownSeq` below: the log a client arrives with is skipped.
  // `gameSocket.seed` injects the whole history at mount. A FullView's seq is
  // NextSeq, so seq - 1 is the last folded event, and a client joining a game
  // with an empty log still hears its first real event.
  const soundedSeq = React.useRef<number>(-1);
  const soundedGame = React.useRef<string | null>(null);
  const startedGame = React.useRef<string | null>(null);
  React.useEffect(() => {
    const seq = sock.full?.seq;
    if (seq == null) return;
    // Behind the entry screen nothing plays and the anchors do not move, so
    // this re-runs on release and re-anchors to the log then: events from the
    // load are skipped, not replayed. The opening cue survives because a game
    // that began behind the screen is still within START_CUE_WINDOW events of
    // `board_generated` when the gate opens.
    if (!entry.ready) return;
    const game = g ?? null;

    // The start cue, rechecked every pass because its two inputs arrive by
    // different routes: `full` from the websocket, the event log from a later
    // HTTP getGame (and the lobby's unfollow() cleared the earlier log).
    //
    // The client keeps the whole log, so `board_generated` is always present;
    // the cue plays only within START_CUE_WINDOW events of it. Once per game:
    // the ref is keyed by game id, so a reconcile that reseeds the log does not
    // replay it.
    const born = sock.events.find((e) => e.type === "board_generated");
    if (startedGame.current !== game && born && seq - born.seq <= START_CUE_WINDOW) {
      startedGame.current = game;
      beginGame();
    }

    if (soundedGame.current !== game) {
      soundedGame.current = game;
      soundedSeq.current = Math.max(seq - 1, lastEventSeq(sock.events));
      return;
    }
    // Sliced by binary search: the log is the whole game and this runs on
    // every event.
    const batch = eventsAfter(sock.events, soundedSeq.current);
    // The event before the batch, so a Smith whose two promotions straddle a
    // slice boundary is still collapsed (see `isRepeatPromotion`).
    let prev = sock.events[sock.events.length - batch.length - 1];
    for (const ev of batch) {
      soundedSeq.current = ev.seq;
      const last = prev;
      prev = ev;
      if (ev.type === "dice_rolled") {
        // A different take each roll, jittered, so the most repeated sound
        // never lands identically twice.
        play(diceSlot(), { jitterCents: 50 });
        const d = ev.data as { d1?: number; d2?: number } | undefined;
        if ((d?.d1 ?? 0) + (d?.d2 ?? 0) === 7) {
          // Layered under the tail of the dice, not queued after it.
          play("sound_seven", { delay: 0.2 });
        }
        continue;
      }
      if (ev.type === "cak_barbarian_attack") {
        // Payload-gated like the seven: the skipped first landfall
        // (`skip_first_barbarian_attack`) emits this type with no attack.
        const d = ev.data as { skipped?: boolean } | undefined;
        if (!d?.skipped) {
          play("sound_barbarians");
          // Every knight on the table lowers its sword. The board cannot infer
          // that from the diff (knights are deactivated constantly by being
          // spent), so the cue triggers it. A called-off landfall deactivated
          // nothing.
          boardControls.current?.standDownKnights();
        }
        continue;
      }
      if (ev.type === "cak_improved") {
        // One cue for all three tracks, climbing with the level reached (not
        // in the event; see `improveSound` and `improvedLevel`). A level 4 or
        // 5 buy is followed by `cak_metropolis`, whose cue stacks on this one.
        const d = ev.data as { player?: number; track?: number } | undefined;
        const up = improveSound(improvedLevel(sock.events, ev.seq, d?.player, d?.track));
        play(up.slot, { semitones: up.semitones, gain: up.gain });
        continue;
      }
      if (ev.type === "cak_knights_all_active") {
        // Warlord: one event for however many knights it woke, so the cue
        // comes from the payload; a Warlord that woke nobody is silent. See
        // `warlordSound`.
        const d = ev.data as { count?: number } | undefined;
        const w = warlordSound(typeof d?.count === "number" ? d.count : null);
        if (w) play(w.slot, { semitones: w.semitones });
        continue;
      }
      // Smith promotes two knights with two events: one card, one thunk.
      if (isRepeatPromotion(last, ev)) continue;
      const s = eventSound(ev.type);
      if (s) play(s.slot, { semitones: s.semitones });
    }
  }, [sock.events, sock.full?.seq, g, beginGame, entry.ready]);

  // Reset the robber/pirate toggle once a move resolves, so last turn's
  // pirate pick doesn't carry into the next 7.
  React.useEffect(() => {
    if (!sock.full?.robber_pending) setRobberChoice("robber");
  }, [sock.full?.robber_pending]);

  // Close a steal picker the server has overtaken (e.g. the timer moved the
  // robber). See lib/robber victimPromptStale.
  React.useEffect(() => {
    setVictimPrompt((p) => (victimPromptStale(p, !!sock.full?.robber_pending) ? null : p));
  }, [sock.full?.robber_pending]);

  // Chime when it becomes the local player's turn. Derived from the full view
  // (cur === viewer) rather than turn_started, so it fires only for your turn
  // and survives reconnects.
  const myTurnNow =
    !!sock.full && sock.full.cur === sock.full.viewer && sock.full.viewer >= 0 && !myBotControlled;
  const wasMyTurn = React.useRef(false);
  React.useEffect(() => {
    // Held at the entry screen like every cue, with `wasMyTurn` left alone, so
    // arriving into your own turn chimes when the board appears.
    if (!entry.ready) return;
    // After the opening cue: the first player's turn starts with the game, so
    // the two would overlap. Later turns are unaffected.
    if (myTurnNow && !wasMyTurn.current) play("sound_turn", { afterCue: true });
    wasMyTurn.current = myTurnNow;
  }, [myTurnNow, entry.ready]);

  // Clear any half-selected build mode when the turn leaves the local player,
  // so a stale selection does not re-light the shop tile and pips when your
  // next turn begins.
  React.useEffect(() => {
    if (myTurnNow) return;
    setMode("none");
    // And the dev-card pickers: a turn lost to auto-pass or the timer would
    // leave the Monopoly / Year of Plenty modal up over another player's turn,
    // and a click would send a refused `play_dev_card`.
    setPicker(null);
    // And the location menu, which renders on `inspectAt` alone and would
    // reappear on the same spot when the turn came back.
    setInspectAt(null);
    // And a staged hex, whose closure was captured on an earlier turn and
    // would send a refused robber move.
    setPendingHex(null);
    // And the Fishermen panels: every fish spend and the boot go through
    // RequireActionableTurn, so they are mid-turn decisions and die with the
    // turn (an armed `fishPending` would otherwise leave a target mode up).
    setFishPanel(false);
    setFishPending(null);
    setBootPrompt(false);
    // And the coins panel: both coin trades go through
    // RequireActionableTurn.
    setCoinPanel(false);
    // And the voluntary Raiders panels: buying or selling gold and moving a
    // rider go through RequireActionableTurn. `riderFrom` matters most, since
    // it leaves the board in a target mode.
    //
    // The forced ones (landing tie, Intrigue, Treason, the 7's steal) are not
    // cleared: they may be owed by a seat not on turn. They follow
    // `raidersRole` and clear when the pending does.
    setRaidersGold(false);
    setRaidersRiders(false);
    setRiderFrom(null);
  }, [myTurnNow]);

  // Win / lose: fire once when the game finishes, picking the slot by whether
  // the winner is the local viewer.
  const finishedWinner = sock.winner;
  const viewerSeat = sock.full?.viewer ?? null;
  const playedFinish = React.useRef(false);
  React.useEffect(() => {
    if (finishedWinner == null || playedFinish.current) return;
    playedFinish.current = true;
    // No winner is a draw, which neither slot fits (the defeat sting would
    // play for players who agreed to it). A draw finishes in silence; the
    // confetti gates the same way, on pgWinner >= 0.
    if (finishedWinner < 0) return;
    play(
      viewerSeat != null && viewerSeat >= 0 && finishedWinner === viewerSeat
        ? "sound_win"
        : "sound_lose",
    );
  }, [finishedWinner, viewerSeat]);

  // Rejoining a table that hasn't started (e.g. via the rejoin dock, which
  // only knows the game id) lands here, but a lobby-status game never sends a
  // state frame, so bounce to the waiting room.
  // Guard on !seatQ.isFetching: arriving from Lobby right after start, the
  // query cache still holds a stale "lobby" snapshot (same key), and acting on
  // it loops Lobby <-> Game, flooding the WS with sub/unsub and tripping the
  // rate limiter. Wait for the refetch to confirm "lobby".
  const gameStatus = seatQ.data?.game.status;
  React.useEffect(() => {
    if (g && gameStatus === "lobby" && !seatQ.isFetching)
      void navigate({ to: "/lobby", search: { g } });
  }, [g, gameStatus, seatQ.isFetching, navigate]);

  // A websocket subscription error leaves no state frame to render, while the
  // REST query may still succeed (so the redirect above never fires). While
  // still connecting, a game that is gone or off-limits goes back to the
  // lobby; INTERNAL/PAUSED errors get an escape hatch in the render.
  const connecting =
    !sock.full &&
    sock.postgame == null &&
    sock.winner == null &&
    sock.summary?.game.status !== "finished" &&
    gameStatus !== "lobby";
  React.useEffect(() => {
    if (connecting && TERMINAL_SUB_CODES.has(sock.error?.code ?? "") && !inActivityMode()) {
      void navigate({ to: "/play" });
    }
  }, [connecting, sock.error, navigate]);

  // Surface server `err` frames (illegal/out-of-turn moves, load failures) as
  // a transient toast. Keyed on errorSeq so a repeated identical error still
  // toasts.
  //
  // The frame carries a code and parameters; errorText turns them into copy
  // (lib/errorCopy). The server's `debug` string is never shown.
  React.useEffect(() => {
    if (sock.error) toast.error(errorText(sock.error.code, sock.error.params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sock.errorSeq]);

  // The "I answered this myself" flags. Declared above `rollbackCmd`, which
  // needs them; the effect that reads them lives with the auto-resolve
  // machinery below.
  const discardInitiated = React.useRef(false);
  const aqueductInitiated = React.useRef(false);
  // The other nine, as a set: they are read and cleared by the same loop.
  const initiatedOther = React.useRef<Set<AutoResolveKind>>(new Set());
  const markInitiated = React.useCallback((kind: AutoResolveKind) => {
    if (kind === "discard") discardInitiated.current = true;
    else if (kind === "aqueduct") aqueductInitiated.current = true;
    else initiatedOther.current.add(kind);
  }, []);
  /**
   * Take the claim back when the command that made it was refused. A refused
   * command answered nothing; leaving the flag set would suppress the "Time
   * ran out" toast when the timer later force-resolves the decision.
   */
  const unmarkInitiated = React.useCallback((kind: AutoResolveKind) => {
    if (kind === "discard") discardInitiated.current = false;
    else if (kind === "aqueduct") aqueductInitiated.current = false;
    else initiatedOther.current.delete(kind);
  }, []);

  /**
   * Undo everything a command staged, in one place, whether the server refused
   * it or it timed out unanswered. Anything `send` shows ahead of the server
   * must be undone here:
   *   - the in-flight entry (the control's gate and the optimistic piece);
   *   - that command's staged cost, by id, so other outstanding builds keep
   *     theirs;
   *   - the "I answered this myself" claim (see unmarkInitiated).
   *
   * The armed build mode is not restored: `keepMode` already keeps it across a
   * send, and re-arming one the player dropped would be a new decision.
   */
  const rollbackCmd = React.useCallback(
    (e: InFlight) => {
      setInflight((prev) => dropByRef(prev, e.id));
      setSpent((prev) => dropSpend(prev, e.id));
      if (e.kind) unmarkInitiated(e.kind);
    },
    [unmarkInitiated],
  );

  // A refused command produces no snapshot to supersede its optimistic
  // effects, so they are withdrawn here. The refusal names the command it
  // refused (`err.ref`, the id server/ws.go echoes back), so exactly that one
  // is rolled back. A ref matching nothing (not our command, a chat rate
  // limit, already swept by the TTL) changes nothing.
  React.useEffect(() => {
    if (sock.errorSeq === 0) return;
    const ref = sock.error?.ref;
    const rejected = ref ? inflight.find((e) => e.id === ref) : undefined;
    if (rejected) {
      rollbackCmd(rejected);
      return;
    }
    // A refusal naming nothing: the frame rate limiter (server/ws.go) drops
    // the frame before parsing it, as does a malformed frame, so the game
    // never saw that command. Quick placing in an armed mode can trip the
    // limiter. We cannot tell which command was dropped, so roll back all of
    // them; re-showing one that landed costs a resync.
    if (!ref && inflightRef.current.length) {
      for (const e of inflightRef.current) rollbackCmd(e);
      gameSocket.resync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sock.errorSeq]);

  // An outstanding command leaves the registry when the view answers it,
  // judged against the view so a fold (lib/ws), a snapshot and an optimistic
  // redraw all discharge it alike (see lib/inflight).
  //
  // `prune` returns the same array when it drops nothing, so this effect does
  // not loop.
  React.useEffect(() => {
    if (!view) return;
    setInflight((prev) => dropSettled(prev, view));
  }, [view]);

  // The TTL. A successful command is answered with silence, and a frame can be
  // dropped on a full send buffer, so without a timeout a gate could lock the
  // dice for the rest of the game. An expired command is rolled back like a
  // refused one, then a fresh view is pulled.
  const anyInflight = inflight.length > 0;
  React.useEffect(() => {
    if (!anyInflight) return;
    const t = setInterval(() => {
      const now = Date.now();
      const { expired } = takeExpired(inflightRef.current, now);
      if (!expired.length) return;
      for (const e of expired) rollbackCmd(e);
      // A command went unanswered and nothing else arrived either: the only
      // evidence that an open socket has died (see lib/link.isAckLost). Locks
      // the table until the next frame; the resync below is likely to bring one.
      if (isAckLost(expired.length, now - lastFrameAt.current, INFLIGHT_TTL_MS)) setAckLost(true);
      gameSocket.resync();
    }, INFLIGHT_TTL_MS / 3);
    return () => clearInterval(t);
  }, [anyInflight, rollbackCmd]);

  // When the host starts a rematch, the server pushes a `next` game id to
  // every post-game client, and everyone follows it.
  const rematchNext = sock.postgame?.rematch.next;
  const rematchInvite = sock.postgame?.rematch.next_invite;
  React.useEffect(() => {
    // Carry the new lobby's invite (private games) so a spectator can subscribe.
    if (rematchNext)
      void navigate({ to: "/lobby", search: { g: rematchNext, inv: rematchInvite } });
  }, [rematchNext, rematchInvite, navigate]);

  // When the host resets the game, the server pushes the fresh lobby id to
  // every client following it, and everyone follows.
  const resetNext = sock.next;
  // `undefined`, not the socket's `null`: the route search schema treats an
  // absent invite as undefined, and a null would land in the URL as `inv=null`.
  const resetInvite = sock.nextInvite ?? undefined;
  React.useEffect(() => {
    // With the invite, as for the rematch: the reset table is a new private
    // game with a new code.
    if (resetNext) void navigate({ to: "/lobby", search: { g: resetNext, inv: resetInvite } });
  }, [resetNext, resetInvite, navigate]);

  /**
   * Whether the armed build mode is still legal. Written during render below,
   * where the shop tiles compute the same gates, and read by the effect below,
   * so there is one definition while the hook stays above the loading guards
   * (Game.hooks.test.ts).
   */
  const modeLegal = React.useRef(true);
  // No deps: `modeLegal` is a ref written during render, so nothing reactive
  // marks the change. The guard fires the setState only on that transition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!modeLegal.current) setMode("none");
  });

  // Escape backs out one level at a time: the anchored menu, then an armed
  // build mode, then a half-finished multi-step move.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement;
      // Never steal Escape from the chat box or any other text entry.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // Nor from a dialog. Radix dismisses on Escape from a capture-phase
      // `document` listener without stopping propagation, so this would also
      // back the board out a level (e.g. closing the store mid-turn would drop
      // an armed road). Inside a focus-trapped dialog the active element is
      // not an input, so the check above does not cover it.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (pendingHex) {
        setPendingHex(null);
        return;
      }
      if (inspectAt) {
        setInspectAt(null);
        return;
      }
      // Blocking modals come off first. `Overlay` handles Escape itself when
      // given an `onCancel`, so this rung is the fallback for when focus is
      // outside the dialog (before it takes focus, or after a click on the
      // page). The Crane, Spy-victim, Alchemist and Monopoly modals rely on it.
      if (progressOverlay || picker || masterMerchant || commercialHarbor || tradingHouse) {
        setProgressOverlay(null);
        setPicker(null);
        setMasterMerchant(false);
        setCommercialHarbor(false);
        setTradingHouse(false);
        return;
      }
      // The scenario panels are on this rung too, so Escape with focus outside
      // a panel does not unwind the board underneath. Standing a camel panel
      // down sets `camelStood` (the vote is still owed; the reopen pill
      // stays). Read through a ref because `camelRoleNow` is derived far below
      // this effect.
      const camelOpen = camelOpenRef.current;
      const raidersOpen = raidersOpenRef.current;
      if (
        fishPanel ||
        coinPanel ||
        camelOpen ||
        raidersOpen ||
        raidersGold ||
        raidersRiders ||
        explorersPanel ||
        explorersShip !== null
      ) {
        if (fishPanel) setFishPanel(false);
        // The coins panel closes outright: nothing is owed, and the shelf tile
        // reopens it.
        if (coinPanel) setCoinPanel(false);
        // The fleet disarms a step at a time: an armed ship first, then the
        // panel.
        if (explorersShip !== null) {
          setExplorersShip(null);
          setExplorersJob(null);
        } else if (explorersPanel) setExplorersPanel(false);
        if (camelOpen) setCamelStood(camelOpen);
        // Voluntary panels close; a forced one stands down to its reopen pill,
        // like a camel panel. The table is still waiting and the clock runs.
        if (raidersGold) setRaidersGold(false);
        if (raidersRiders) setRaidersRiders(false);
        if (raidersOpen) setRaidersStood(raidersOpen);
        return;
      }
      // A rider chosen but not yet sent. Above the other half-finished moves
      // because it also leaves a prompt on screen.
      if (riderFrom) {
        setRiderFrom(null);
        return;
      }
      if (shipMoveFrom || knightMoveFrom || chaseFrom) {
        setShipMoveFrom(null);
        setKnightMoveFrom(null);
        setChaseFrom(null);
        setMode("none");
        return;
      }
      // A progress card that armed a board pick leaves a prompt (Diplomat's
      // panel is keyed on `diplomatFrom`, not the mode), so clear those too.
      if (progressCard || diplomatFrom || inventorA) {
        setProgressCard(null);
        setDiplomatFrom(null);
        setInventorA(null);
        setMode("none");
        return;
      }
      if (mode !== "none") setMode("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    inspectAt,
    pendingHex,
    mode,
    shipMoveFrom,
    knightMoveFrom,
    chaseFrom,
    progressCard,
    diplomatFrom,
    inventorA,
    progressOverlay,
    picker,
    masterMerchant,
    commercialHarbor,
    tradingHouse,
    fishPanel,
    coinPanel,
    raidersGold,
    raidersRiders,
    riderFrom,
    explorersPanel,
    explorersShip,
  ]);

  // Render the buildable pieces in the viewer's seat colour and piece set,
  // once per colour per tab. Above the early returns (React #310); the hook
  // accepts null before the colour is known.
  const thumbs = usePieceThumbnails(
    view ? colorOf(view.viewer) : null,
    pieceSetAssetFile(view?.seat_pieces?.[view.viewer] ?? ""),
  );
  const hostId = sock.summary?.game.created_by ?? seatQ.data?.game.created_by;
  const isHost = !!authMe && hostId != null && hostId === authMe.id;

  // Keep the active player's card on screen in the player rail, which scrolls
  // horizontally on mobile and vertically on desktop. On a turn change, scroll
  // whichever axis overflows, moving only the rail's own offset, never the
  // page. Above the loading early-returns (see Game.hooks.test).
  //
  // Also the measurement the board frames itself against: the cluster's outer
  // width, padding included.
  const railRef = React.useRef<HTMLDivElement>(null);
  // Callback ref into state, as `attachTopRow` does below (see the `deps` on
  // the measurements that read it).
  const [railEl, setRailEl] = React.useState<HTMLDivElement | null>(null);
  const attachRail = React.useCallback((el: HTMLDivElement | null) => {
    railRef.current = el;
    setRailEl(el);
  }, []);
  // The box inside the cluster that actually scrolls. Framing wants the outer
  // width and the reveal needs the overflowing child; the cluster itself
  // never overflows.
  const railScrollRef = React.useRef<HTMLDivElement>(null);

  // The top row's height, under which the seat rail is parked. `offsetHeight`
  // is in layout pixels like the `top` it feeds, so no zoom correction is
  // needed (index.css zooms the UI above 1700px).
  const topRowRef = React.useRef<HTMLDivElement | null>(null);
  const [topRowEl, setTopRowEl] = React.useState<HTMLDivElement | null>(null);
  // A callback ref that also lands in state: the HUD mounts after the loading
  // screen, so a subscription taken at mount would read a null ref and never
  // look again. The state makes the node's arrival a dependency.
  const attachTopRow = React.useCallback((el: HTMLDivElement | null) => {
    topRowRef.current = el;
    setTopRowEl(el);
  }, []);
  const [topRowH, setTopRowH] = React.useState(0);
  useMeasure<number>({
    read: () => {
      const el = topRowRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      return el.offsetHeight;
    },
    write: setTopRowH,
    // The row's height changes with its content too: islands wrap when a
    // button appears or a long seat name narrows the track, and the turn
    // banner grows a row of mode pickers.
    observe: topRowRef,
    deps: [topRowEl],
  });

  // The 3D board owns the camera, but the recentre button lives in the
  // top-right orb cluster, so the board hands the control outward. Not part
  // of `boardProps`, the renderer-agnostic contract (components/board/props).
  // Declared with the other unconditional hooks (see Game.hooks.test).
  const boardControls = React.useRef<Board3DControls | null>(null);

  // ---- dealt cards in flight ----
  //
  // Where each piece of chrome a card can land on currently is. Ref-backed, so
  // a coin or hand card publishing itself re-renders nothing.
  const anchors = useHudAnchors();
  // How far the shelf's centred group is pushed off your hand, so the buy
  // tiles sit mid-window. Declared with the unconditional hooks; its refs go
  // on the shelf far below.
  const shelf = useShelfLead();
  // Only the bank's trigger publishes itself, standing for the supply where
  // spent cards go and drawn ones come from. One ref for the two possible
  // triggers (the orb, or the counts pill above the hotbar), since only one
  // is ever on screen.
  const bankAnchor = anchors.ref("bank");
  // State, not a ref: the overlay must mount when the camera appears, which
  // the board's rig effect decides after this component renders.
  // `setProjector` is stable, so Board3D holds the callback in its own ref
  // (see Board3D's `onProjector`).
  const [projector, setProjector] = React.useState<Projector | null>(null);
  // A Projector is a function, so passing `setProjector` directly would make
  // React call it as a state updater and throw. Always store it behind a thunk.
  const holdProjector = React.useCallback((p: Projector | null) => setProjector(() => p), []);
  const [flightBatch, setFlightBatch] = React.useState<FlightBatch | null>(null);
  // Scenario cards turned over at the table (CardRevealLayer). Fed from the
  // same fresh-event watermark as the flights, including under reduced motion,
  // where the reveal falls back to a fade.
  const [revealBatch, setRevealBatch] = React.useState<RevealBatch | null>(null);
  const revealSeq = React.useRef(0);
  // The viewer's own card is still flying into the prompt, which keeps the
  // prompt's thumbnail empty until it lands.
  const [revealDocking, setRevealDocking] = React.useState(false);
  const flightSeq = React.useRef(0);
  const noMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // Tailwind's `lg`: the breakpoint where the seat rail is a column, not a strip.
  const wideLayout = useMediaQuery(COLUMN_LAYOUT_QUERY);
  // A phone held sideways, where the dock is the right column rather than a
  // bottom band. See SQUAT_QUERY.
  const squat = useMediaQuery(SQUAT_QUERY);
  // The rail's real width as a fraction of the viewport. Measured, because the
  // fraction runs from about 0.18 on a 1024px window to 0.09 on a wide one, and
  // index.css zooms it above 1600px.
  const [railFrac, setRailFrac] = React.useState(0);
  // Coalesced with every other layout read into one pass per frame (see
  // lib/measure).
  useMeasure<number>({
    read: () => {
      const el = railRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      // The lg-only rule and the quantisation live in lib/hudChrome, where
      // they are tested.
      return railFraction(el.getBoundingClientRect().width, window.innerWidth, wideLayout);
    },
    write: setRailFrac,
    // The rail's width also changes with its content, not just the window.
    observe: railRef,
    // `railEl`, for the reason `attachTopRow` gives: the rail mounts several
    // commits after this hook, so without it the subscription reads a null ref
    // and never retries, leaving `railFrac` at 0 and the camera uninset.
    deps: [wideLayout, railEl],
  });

  // The band the HUD takes along the top, as a fraction of viewport height:
  // the top row plus, below lg, the seat strip beneath it. Read off the rail
  // cluster's bottom edge.
  //
  // Only below lg: on desktop the top row is ~4% of the window, but on a
  // 390x844 phone it is over a quarter, and the camera must frame below it.
  const [topFrac, setTopFrac] = React.useState(0);
  useMeasure<number>({
    read: () => {
      const el = railRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      if (wideLayout) return 0;
      const h = window.innerHeight || 1;
      // Quantised like railFrac: this feeds the camera, and a raw float would
      // re-frame the board on every sub-pixel reflow.
      return quantiseFrac(el.getBoundingClientRect().bottom / h);
    },
    write: setTopFrac,
    observe: railRef,
    deps: [wideLayout, railEl],
  });

  // The band a target prompt takes off the top of the board while one is up.
  //
  // The prompt is a pill 96px down, which at desktop size covers the board's
  // top row. It reports its element (see `promptSlot`), and while mounted its
  // bottom edge counts as top chrome: the board recentres below it at the same
  // zoom (a changed dead band never moves the camera; see Board3D) and returns
  // when it closes.
  const [promptEl, setPromptEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    promptSlot.set = setPromptEl;
    return () => {
      if (promptSlot.set === setPromptEl) promptSlot.set = null;
    };
  }, []);
  const [promptFrac, setPromptFrac] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!promptEl) {
      setPromptFrac(0);
      return;
    }
    // Only where the band is a small part of the screen. On a sideways phone
    // reserving it as well as the dock would shrink the board too far, so the
    // pill covering a top row is the smaller cost.
    const measure = () => {
      const frac = quantiseFrac(
        promptEl.getBoundingClientRect().bottom / (window.innerHeight || 1),
      );
      const short = (window.innerHeight || 0) < SHORT_SCREEN_PX;
      setPromptFrac(!short && frac <= PROMPT_RESERVE_MAX ? frac : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(promptEl);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [promptEl]);

  // Where a target prompt stands on a sideways phone: over the top of the seat
  // rail's column (see SQUAT_PROMPT), passed as CSS variables on the root.
  const [squatPromptBox, setSquatPromptBox] = React.useState<Record<string, string> | null>(null);
  useMeasure<Record<string, string> | null>({
    read: () => {
      const el = railRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      if (!squat) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return squatPromptVars(
        r,
        {
          left: parseFloat(cs.paddingLeft) || 0,
          right: parseFloat(cs.paddingRight) || 0,
          bottom: parseFloat(cs.paddingBottom) || 0,
        },
        window.innerHeight,
      );
    },
    write: (v) =>
      setSquatPromptBox((prev) => ((prev && v && shallowEqual(prev, v)) || prev === v ? prev : v)),
    observe: railRef,
    deps: [squat, railEl],
  });

  // The seat strip's height below lg, so the barbarian rail sits under it.
  //
  // `offsetHeight` rather than the rect measured above: that is a fraction of
  // the visual viewport for the camera, while this feeds a CSS `top` beside
  // `topRowH` in layout pixels (see lib/seatPanels on mixing units). Zero from
  // lg, where the rail is a column.
  const [seatStripH, setSeatStripH] = React.useState(0);
  useMeasure<number>({
    read: () => {
      const el = railRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      return wideLayout ? 0 : el.offsetHeight;
    },
    write: setSeatStripH,
    observe: railRef,
    deps: [wideLayout, railEl],
  });

  // The barbarian fleet laid across the board under that strip in a Knights
  // game (see `barbAcross`), so a target prompt stands below it. Layout px,
  // like `seatStripH`.
  const barbAcrossRef = React.useRef<HTMLDivElement | null>(null);
  const [barbAcrossEl, setBarbAcrossEl] = React.useState<HTMLDivElement | null>(null);
  const attachBarbAcross = React.useCallback((el: HTMLDivElement | null) => {
    barbAcrossRef.current = el;
    setBarbAcrossEl(el);
  }, []);
  const [barbAcrossH, setBarbAcrossH] = React.useState(0);
  useMeasure<number>({
    read: () => {
      const el = barbAcrossRef.current;
      if (typeof ResizeObserver === "undefined") return SKIP;
      return el ? el.offsetHeight : 0;
    },
    write: setBarbAcrossH,
    observe: barbAcrossRef,
    deps: [barbAcrossEl],
  });

  // The band along the bottom, measured at every width. HUD_BOTTOM_INSET is a
  // constant fraction, wrong outside a portrait phone (0.12 of a 390px-tall
  // landscape phone is 47px against a ~90px shelf).
  //
  // Two numbers from one read, to avoid a second ResizeObserver: `frac` is of
  // the visual viewport (rect over innerHeight) and feeds the camera; `h` is
  // layout pixels (offsetHeight) for a CSS `bottom` and the seat rail's fit
  // arithmetic (see lib/seatPanels on mixing units).
  const bottomRowRef = React.useRef<HTMLDivElement>(null);
  const [bottomRowEl, setBottomRowEl] = React.useState<HTMLDivElement | null>(null);
  const attachBottomRow = React.useCallback((el: HTMLDivElement | null) => {
    bottomRowRef.current = el;
    setBottomRowEl(el);
  }, []);
  const [bottomFrac, setBottomFrac] = React.useState(HUD_BOTTOM_INSET);
  const [bottomRowH, setBottomRowH] = React.useState(0);
  // On a sideways phone the same cluster is a column down the right edge (see
  // `squat`), so it takes a width rather than a height. Read in the same pass;
  // the bottom band is then zero.
  const [dockColFrac, setDockColFrac] = React.useState(0);
  useMeasure<{ frac: number; h: number; col: number }>({
    read: () => {
      const el = bottomRowRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      const h = window.innerHeight || 1;
      if (squat) {
        const r = el.getBoundingClientRect();
        return { frac: 0, h: 0, col: quantiseFrac(r.width / (window.innerWidth || 1)) };
      }
      return {
        frac: quantiseFrac(el.getBoundingClientRect().height / h),
        h: el.offsetHeight,
        col: 0,
      };
    },
    write: (v) => {
      setBottomFrac(v.frac);
      setBottomRowH(v.h);
      setDockColFrac(v.col);
    },
    equals: (a, b) => a.frac === b.frac && a.h === b.h && a.col === b.col,
    observe: bottomRowRef,
    // As for the rail: the row mounts several commits after this hook.
    deps: [bottomRowEl, squat],
  });
  // The fleet's row along the foot of the board on a sideways phone (Knights
  // only), the one bottom band there. A camera fraction like the dock; zero
  // where it is not drawn.
  const [squatFleetEl, setSquatFleetEl] = React.useState<HTMLDivElement | null>(null);
  const squatFleetRef = React.useRef<HTMLDivElement | null>(null);
  const attachSquatFleet = React.useCallback((el: HTMLDivElement | null) => {
    squatFleetRef.current = el;
    setSquatFleetEl(el);
  }, []);
  const [squatFleetFrac, setSquatFleetFrac] = React.useState(0);
  useMeasure<number>({
    read: () => {
      const el = squatFleetRef.current;
      if (!el) return 0;
      return quantiseFrac(el.getBoundingClientRect().height / (window.innerHeight || 1));
    },
    write: setSquatFleetFrac,
    observe: squatFleetRef,
    deps: [squatFleetEl],
  });
  // Toasts ride above this row rather than in the corner, where they covered
  // the dice and End turn.
  useToastInset(bottomRowH);

  // Where a target prompt stands below lg in portrait: directly under the top
  // band (see `promptTopPx`), not inside the seat strip.
  const promptTop = promptTopPx({
    wide: wideLayout,
    squat,
    topRowH,
    seatStripH,
    barbAcrossH,
  });
  // The same condition places a standing offer above the dock (`bottomRowH`);
  // on a sideways phone it hangs from the top row. See FLOATING_OFFER_POS.
  const floatBottom = promptTop === null || !(bottomRowH > 0) ? null : bottomRowH;
  const topRowVar = squat && topRowH > 0 ? topRowH : null;
  const promptVars = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!squatPromptBox && promptTop === null && topRowVar === null) return undefined;
    return {
      ...squatPromptBox,
      ...(promptTop === null ? null : { "--hud-prompt-top": `${promptTop}px` }),
      ...(floatBottom === null ? null : { "--hud-float-bottom": `${floatBottom}px` }),
      ...(topRowVar === null ? null : { "--hud-top-row": `${topRowVar}px` }),
    };
  }, [squatPromptBox, promptTop, floatBottom, topRowVar]);

  // The HUD's height and how much of it is visible, so a panel raised from the
  // dock fits the screen the player actually has.
  //
  // Two things change these that nothing else sees. The on-screen keyboard
  // does not resize the layout viewport (no `resize`, same `innerHeight`,
  // `svh` unchanged); only `visualViewport` sees it, which lib/measure folds
  // into its shared source. And the UI zoom index.css applies past 1700px:
  // viewport values stay raw while the HUD lays out in zoomed pixels, hence
  // the layer's own `offsetHeight`, in the unit of topRowH and bottomRowH;
  // lib/hudChrome reconciles them. With no visual viewport the lift is zero,
  // and before the layer mounts the raw viewport is used.
  const hudLayerRef = React.useRef<HTMLDivElement | null>(null);
  const [hudLayerEl, setHudLayerEl] = React.useState<HTMLDivElement | null>(null);
  const attachHudLayer = React.useCallback((el: HTMLDivElement | null) => {
    hudLayerRef.current = el;
    setHudLayerEl(el);
  }, []);

  // Only the visible height and the keyboard's lift are state. Whether the
  // feed gets an island is decided against the shelf's top edge and the bank
  // card's height (see `attachShelfRow`), both in the same zoomed subtree.
  const [viewportH, setViewportH] = React.useState(0);
  const [keyboardH, setKeyboardH] = React.useState(0);
  useMeasure<{ hudH: number; visibleH: number; lift: number }>({
    read: () => {
      if (typeof window === "undefined") return SKIP;
      return hudViewport({
        layerH: hudLayerRef.current?.offsetHeight ?? 0,
        ...readViewportMetrics(),
      });
    },
    write: (v) => {
      setViewportH(v.visibleH);
      setKeyboardH(v.lift);
    },
    equals: (a, b) => a.hudH === b.hudH && a.visibleH === b.visibleH && a.lift === b.lift,
    // The layer mounts several commits after this hook (see `attachTopRow`).
    // It is `fixed inset-0`, so only the window moves it, which the shared
    // source reports.
    deps: [hudLayerEl],
  });

  // The top edge of the hand shelf, where the HUD's right-hand column ends:
  // the bank card's cap and the island's remaining room are measured against
  // it (see lib/hudChrome).
  //
  // The shelf, not the dock cluster: collapsing the island adds a ~40px
  // trigger row inside the cluster above the shelf, so reading the cluster's
  // height would flip the decision back and forth. The shelf's top edge does
  // not move either way.
  //
  // `offsetTop` twice rather than a rect, as for topRowH: the chain is in HUD
  // pixels (the cluster's offset parent is the `fixed inset-0` HUD layer), so
  // no zoom correction is needed. The observer catches the shelf growing a row;
  // the shared source catches the window.
  const shelfRowRef = React.useRef<HTMLDivElement>(null);
  const [shelfRowEl, setShelfRowEl] = React.useState<HTMLDivElement | null>(null);
  const [shelfTop, setShelfTop] = React.useState(0);
  // The shelf's offset inside the dock cluster, by which the trade builder is
  // lifted below lg (see `tradePanelLift`).
  const [shelfOffset, setShelfOffset] = React.useState(0);
  const attachShelfRow = React.useCallback((el: HTMLDivElement | null) => {
    shelfRowRef.current = el;
    setShelfRowEl(el);
  }, []);
  useMeasure<{ top: number; offset: number }>({
    read: () => {
      const el = shelfRowRef.current;
      const dock = bottomRowRef.current;
      if (!el || !dock || typeof ResizeObserver === "undefined") return SKIP;
      return { top: dock.offsetTop + el.offsetTop, offset: el.offsetTop };
    },
    write: (v) => {
      setShelfTop(v.top);
      setShelfOffset(v.offset);
    },
    equals: (a, b) => a.top === b.top && a.offset === b.offset,
    observe: shelfRowRef,
    // `viewportH` is a trigger, not an input: this row's box does not change
    // with window height, and the shared resize source alone could leave the
    // value a step behind during a drag. A dep change re-subscribes and
    // re-reads synchronously, so it converges in the same frame.
    deps: [shelfRowEl, bottomRowEl, bottomRowH, viewportH],
  });

  // What the bank's card needs, which the column reserves before the island
  // gets any room: the measured stack, floored by an estimate from the card's
  // shape. The estimate covers the frames before the first measurement (and
  // jsdom); `Math.max` because reserving too little scrolls half the bank off,
  // while too much costs the island a few pixels.
  const bankCardBodyRef = React.useRef<HTMLDivElement>(null);
  const [bankCardBodyEl, setBankCardBodyEl] = React.useState<HTMLDivElement | null>(null);
  const [bankCardMeasuredH, setBankCardMeasuredH] = React.useState(0);
  const attachBankCardBody = React.useCallback((el: HTMLDivElement | null) => {
    bankCardBodyRef.current = el;
    setBankCardBodyEl(el);
  }, []);
  /**
   * Whether the bank's card is open right now, as against whether the window
   * is wide enough to have one. Lifted out of the orb because the barbarian
   * rail is positioned against it (see `barbRailRight`). `pinned` only decides
   * how the card starts; the player may close it.
   *
   * Declared here, above `if (!view) return entryScreen`, since a hook below
   * that would change the hook count once the first state frame lands.
   */
  const [bankCardOpen, setBankCardOpen] = React.useState(false);
  useMeasure<number>({
    read: () => {
      const el = bankCardBodyRef.current;
      if (!el || typeof ResizeObserver === "undefined") return SKIP;
      return bankCardOuterH(el.offsetHeight);
    },
    write: setBankCardMeasuredH,
    observe: bankCardBodyRef,
    deps: [bankCardBodyEl],
  });

  /**
   * The highest event seq already flown.
   *
   * Like `soundedSeq`, the log a client arrives with is skipped, not replayed:
   * `gameSocket.seed` injects the history at mount and a reconcile refetches
   * gaps, and the board you arrive at is state, not a sequence of events (as
   * drop.ts treats its null `prev`).
   *
   * Anchored off the full view's seq: a FullView's seq is NextSeq, so seq - 1
   * is the last event folded into the board, and a client joining with an
   * empty log still animates its first real event.
   */
  const flownSeq = React.useRef<number>(-1);
  /** Which game that mark belongs to; seqs start again from zero in the next one. */
  const flownGame = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!view) return;
    if (flownGame.current !== (g ?? null)) {
      flownGame.current = g ?? null;
      flownSeq.current = Math.max(view.seq - 1, lastEventSeq(sock.events));
      return;
    }
    const fresh = eventsAfter(sock.events, flownSeq.current);
    if (!fresh.length) return;
    // Consumed whether or not anything flies, so a batch skipped under reduced
    // motion cannot return later as a burst.
    flownSeq.current = fresh[fresh.length - 1].seq;
    // Before the motion check: under reduced motion a reveal fades rather than
    // flies. Catch-up batches follow the flights' rule (two rolls means a
    // reconnect, not a turn).
    const reveals =
      fresh.filter((e) => e.type === "dice_rolled").length > 1 ? [] : revealsIn(fresh, view.viewer);
    if (reveals.length) setRevealBatch({ id: revealSeq.current++, reveals });
    if (noMotion) return;
    const flights = planBatch(fresh, {
      board: view.board,
      buildings: view.buildings,
      // This commit's dice_rolled is normally in `fresh` and wins; this covers
      // a reconcile that split the roll from its distribution.
      roll: sock.lastRoll ? sock.lastRoll.d1 + sock.lastRoll.d2 : null,
    });
    if (flights.length) setFlightBatch({ id: flightSeq.current++, flights });
  }, [sock.events, sock.lastRoll, view, noMotion, g]);

  /**
   * The Inventor's exchange, handed to the board.
   *
   * The card swaps the number tokens on two hexes; the resulting board does
   * not show the swap, so it goes through the imperative handle like
   * `flipChips`. Read off the log because the payload names the two hexes and
   * a state diff would have to guess.
   *
   * Its own seq mark and history skip, for `flownSeq`'s reason. Under reduced
   * motion the board refuses the swap and the numbers just change.
   */
  const swappedSeq = React.useRef<number>(-1);
  const swappedGame = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!view) return;
    if (swappedGame.current !== (g ?? null)) {
      swappedGame.current = g ?? null;
      swappedSeq.current = Math.max(view.seq - 1, lastEventSeq(sock.events));
      return;
    }
    const fresh = eventsAfter(sock.events, swappedSeq.current);
    if (!fresh.length) return;
    // Consumed whether or not anything is handed over, so a skipped batch
    // cannot return later as a burst.
    swappedSeq.current = fresh[fresh.length - 1].seq;
    for (const ev of fresh) {
      if (ev.type !== "cak_tokens_swapped") continue;
      // `a` and `b` are the two hexes; the board reads the numbers off the
      // tiles it was just given.
      const d = ev.data as { a?: { q: number; r: number }; b?: { q: number; r: number } } | null;
      if (!d?.a || !d?.b) continue;
      boardControls.current?.swapChips(d.a, d.b);
    }
  }, [sock.events, view, g]);

  // Keep the active seat centred in the rail, which matters most where only a
  // couple of cards fit (the phone strip, a short window).
  //
  // The deps include more than `activeSeat` because the rail's room is
  // measured a frame or more after mount and changes on resize, rotation or a
  // shelf growing a row. `railEl` covers the rail mounting after the loading
  // view.
  const activeSeat = view?.cur ?? null;
  React.useEffect(() => {
    const el = railScrollRef.current;
    if (el && activeSeat != null) revealActiveCard(el, activeSeat, noMotion ? "auto" : "smooth");
  }, [activeSeat, noMotion, railEl, viewportH, topRowH, bottomRowH]);

  // What the board is told about a roll: every chip showing the number turns
  // over, and if the robber's hex matched, the robber pulses to explain the
  // missing production.
  //
  // Imperative, through the handle the reset-view orb uses, because it is an
  // event and props are state (see `Board3DControls`). Declared with the other
  // unconditional hooks (see Game.hooks.test).
  //
  // The answered roll is remembered by seq: the socket rebuilds `lastRoll`
  // from every `dice_rolled` frame, and a re-subscribe or gap refetch
  // redelivers frames, so comparing objects would flip twice, and two sevens
  // in a row are two rolls. See ws.ts.
  const answeredRoll = React.useRef(sock.lastRoll?.seq ?? -1);
  React.useEffect(() => {
    const roll = sock.lastRoll;
    if (!roll || roll.seq <= answeredRoll.current) return;
    // A roll read back out of the history on load is shown, not answered.
    if (roll.seeded) {
      answeredRoll.current = roll.seq;
      return;
    }
    // Consumed whether or not it fires, so a roll seen before the board exists
    // does not pulse later.
    answeredRoll.current = roll.seq;
    const board = view?.board;
    if (!board) return;
    const total = roll.d1 + roll.d2;
    // Every chip showing the number turns over. The dock dice snap to the
    // result, and the flying cards only cover tiles that paid someone.
    boardControls.current?.flipChips(total);
    // No chip carries a seven, so the robber answers for it.
    if (total === 7) boardControls.current?.flipRobber();
    if (robberAteRoll(board.tiles, board.robber, total)) {
      boardControls.current?.pulseRobber();
    }
  }, [sock.lastRoll, view]);

  // `sm` is the breakpoint at which the dock's padding/gap and the hotbar tile
  // height change, so the dice (sized from the tile) and the turn cluster
  // switch on it too.
  const smUp = useMediaQuery("(min-width: 640px)");
  const diceSize = dockDieSize(smUp);
  // HUD breakpoints, declared with the other unconditional hooks above the
  // loading early-returns.
  /**
   * The breakpoint at which the seat rail is a column and the HUD has a
   * right-hand column: the bank's whole condition and half of the feed's. See
   * lib/hudChrome.
   */
  const lgUp = useMediaQuery(COLUMN_LAYOUT_QUERY);
  /**
   * Screen small enough that the board is certainly locked flat, so its reset
   * orb has nothing to undo. Uses height as well as width; see
   * `FLAT_VIEW_QUERY`.
   */
  const flatBoard = useMediaQuery(FLAT_VIEW_QUERY);
  /** Room to leave the bank's card pinned open without covering the board. */
  const wideHud = useMediaQuery("(min-width: 1280px)");
  /**
   * Which half of the table feed the island shows, or none.
   *
   * The feed is a reference surface like the bank, switched by orbs in the
   * top-right row, lit while up. Two orbs because log and chat are separate
   * things; pressing the lit one puts the island away.
   *
   * Desktop only. Where the island is not rendered the two are dock panels,
   * which toggle on their own, and this is not read.
   */
  const [feedPane, setFeedPane] = React.useState<"log" | "chat" | null>("log");
  // The tier the taker picked for an owed Deserter replacement; null = the
  // ceiling. Read only through `deserterLevel`, which drops a pick no longer
  // offered.
  const [deserterPick, setDeserterPick] = React.useState<number | null>(null);

  /**
   * Which blocks the bank's card draws, which the right-hand column must make
   * room for before it keeps the feed's island. See lib/hudChrome.
   */
  const bankCardShape = useGameSocket(selectBankCardShape, shallowEqual);
  // Knight pieces and walls still in hand, for the corners of their build tiles.
  const myStatus = useGameSocket(selectStatus, shallowEqual);

  const pieceIcon = usePieceIcons(seatColors);

  // A trade panel left open when a turn ended must not reappear when the turn
  // comes back. The panel shows only while you can build or counter; when
  // neither holds, clear the staged trade.
  //
  // Must be above the `if (!g)` / `if (!view)` early-returns (React #310/#300;
  // the Discord Activity always renders the loading state first). The gate
  // mirrors canBuild / canCounter computed for rendering.
  const canTrade = React.useMemo(() => {
    if (!view) return false;
    const turn = view.cur === view.viewer && view.viewer >= 0;
    const discarding = (view.pending_discards?.[view.viewer] ?? 0) > 0;
    // `moduleBlocksActions` as in canBuild, so the reset fires when a camel
    // vote opens rather than leaving a basket behind an unreachable panel.
    const build =
      turn &&
      view.phase === "play" &&
      view.rolled &&
      !view.robber_pending &&
      !discarding &&
      !moduleBlocksActions(view, actingSeat(view.viewer, myBotControlled)) &&
      !explorersExt(view)?.movement &&
      !wagonMovingClosesBuilding(view);
    const ao = view.active_offer;
    // Mirrors canCounter below: an answer (a counter included) can be
    // replaced while the offer stands, so answering does not close the panel.
    const counter = !!ao && view.viewer >= 0 && ao.by !== view.viewer;
    return (build || counter) && !myBotControlled;
  }, [view, myBotControlled]);
  React.useEffect(() => {
    if (canTrade) return;
    setTradeOpen(false);
    setTradeGive([0, 0, 0, 0, 0, 0]);
    setTradeWant([0, 0, 0, 0, 0, 0]);
    setTradeComGive([0, 0, 0]);
    setTradeComWant([0, 0, 0]);
    setCurrencyGive({});
    setCurrencyWant({});
  }, [canTrade]);

  // ---- Force-resolve feedback -----------------------------------------------
  //
  // Every timed decision is force-resolved by the server when the countdown
  // runs out (engine/knights/hooks.go `auto`, plus the 7-roll discard), and the
  // player only sees the prompt vanish. One loop over the table in
  // lib/autoResolveToast toasts each; the table is a
  // `Record<AutoResolveKind, ...>`, so a missing message fails the build.
  //
  // The wire cannot distinguish "cleared because you confirmed" from
  // "cleared because the timer fired", so every submit path calls
  // `markInitiated`; a missed path produces a false "Time ran out".
  //
  // Above the loading guards (see Game.hooks.test.ts).
  //
  // `acting` asks whether we are playing our seat, not merely holding it: a
  // bot-played seat still carries our viewer index. See lib/seat.actingSeat.
  const actingNow = React.useMemo(
    () => !!view && actingSeat(view.viewer, myBotControlled) >= 0,
    [view, myBotControlled],
  );
  // The log, readable from the effect without being a dependency: the
  // transition is the trigger, and re-running per event would consume it
  // against an already caught-up snapshot.
  const eventsRef = React.useRef(sock.events);
  eventsRef.current = sock.events;
  // "I'll play one instead" lasts as long as the over-limit hand: the next
  // time the hand goes over four, the overlay is owed again.
  const overProgressLimit = pendingSnapshot(view).progress_discard > 0;
  React.useEffect(() => {
    if (!overProgressLimit) setProgressDiscardStood(false);
  }, [overProgressLimit]);
  const prevPending = React.useRef<PendingSnapshot | null>(null);
  React.useEffect(() => {
    const prev = prevPending.current;
    const next = pendingSnapshot(view);
    prevPending.current = next;
    // Ceasing to act (leaving, handing the seat to a bot, or the post-game
    // spectator view) collapses every pending without a resolution; only
    // transitions seen while acting count. Returning after the ref update
    // keeps the snapshot current for a reclaimed seat.
    if (!actingNow) return;
    const done = resolvedKinds(prev, next);
    if (done.length === 0) return;

    const initiated: AutoResolveKind[] = [...initiatedOther.current];
    if (discardInitiated.current) initiated.push("discard");
    if (aqueductInitiated.current) initiated.push("aqueduct");
    const aqueductRes = done.includes("aqueduct")
      ? aqueductResourceFrom(eventsRef.current, view?.viewer)
      : "";
    for (const m of autoResolveToasts(prev, next, { initiated, aqueductRes })) toast.info(m);

    // A flag is cleared only by the transition it was set for; an unrelated
    // frame between send and resolution must not drop it. See resolvedKinds.
    for (const k of done) {
      if (k === "discard") {
        discardInitiated.current = false;
        // The staged basket is stale either way: the cards are gone.
        setDiscardPick([0, 0, 0, 0, 0, 0]);
        setDiscardComPick([0, 0, 0]);
      } else if (k === "aqueduct") aqueductInitiated.current = false;
      else initiatedOther.current.delete(k);
    }
  }, [view, actingNow, toast]);

  // Prompts driven by LOCAL state (a progress card mid-play, its follow-up
  // overlay, a dev-card picker, an armed board mode) have no view field that
  // disappears when the seat stops being ours, so tear them down on the same
  // signal the toasts use. Above the loading guards (see Game.hooks.test.ts).
  React.useEffect(() => {
    if (actingNow) return;
    setProgressCard(null);
    setProgressOverlay(null);
    setPicker(null);
    setMode("none");
    setDiplomatFrom(null);
    setInventorA(null);
    setKnightMoveFrom(null);
    setShipMoveFrom(null);
    setChaseFrom(null);
    setCommercialHarbor(false);
    setTradingHouse(false);
    setMasterMerchant(false);
    // Not the Fishermen panels: `actingNow` changes only on a bot takeover or
    // leaving, while a fish spend dies with the turn (see the myTurnNow
    // effect).
  }, [actingNow]);

  // Road Building owes free roads, so arm road mode for them; otherwise the
  // only sign was "FREE" in the Road tile's cost popover. The debt is not
  // optional, so arming it is safe; an explicitly chosen mode (e.g. ship, since
  // free builds may be either) is left alone. Above the loading guards (see
  // Game.hooks.test.ts).
  const owedFreeRoads = view?.free_roads ?? 0;
  React.useEffect(() => {
    if (!actingNow || owedFreeRoads <= 0) return;
    setMode((m) => (m === "none" ? "road" : m));
  }, [actingNow, owedFreeRoads]);

  // The second half of a 5-fish road. The spend named an edge and the engine
  // answered with a credit, not a road; this sends the road for that edge so
  // one click does what the prompt promised. If the edge becomes wrong (a
  // refusal, the turn ending, the edge no longer legal) it is dropped and the
  // armed road mode remains. `send` is declared below and only runs once the
  // view is loaded.
  const fishRoadInFlight = !!fishRoad && inflight.some((e) => e.id === fishRoad.ref);
  React.useEffect(() => {
    if (!fishRoad || !view) return;
    const next = fishRoadNext(fishRoad, view, actingNow, fishRoadInFlight);
    if (next === "wait") return;
    setFishRoad(null);
    if (next === "build") send("build_road", { e: fishRoad.e }, { keepMode: true });
    else if (next === "ship") send("build_ship", { e: fishRoad.e }, { keepMode: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fishRoad, view, actingNow, fishRoadInFlight]);

  // Only a seated human player can hand their seat to a bot and leave.
  const mySeated = !!authMe && (seatQ.data?.seats?.some((s) => s.user_id === authMe.id) ?? false);

  async function leaveGame() {
    if (!g) return;
    try {
      await api.leave(g);
    } catch {
      /* ignore; the roster refetch below reconciles the UI */
    }
    // Stay as a spectator on every platform: the refetched roster reports our
    // seat as "auto", which switches the UI to spectator mode.
    setLeaveOpen(false);
    await seatQ.refetch();
  }

  async function returnToGame() {
    if (!g) return;
    try {
      await api.rejoin(g);
    } catch {
      /* ignore; the roster refetch below reconciles the UI */
    }
    await seatQ.refetch();
  }

  // A finished game streams a postgame frame (never a state frame), so this is
  // driven off sock.postgame / sock.winner. The normal layout renders the final
  // board (via the view fallback above) and the endgame scoreboard floats over
  // it as a dismissible overlay.
  const finished =
    sock.postgame != null || sock.winner != null || sock.summary?.game.status === "finished";

  /**
   * The finished board turns slowly, behind the scoreboard and after it.
   *
   * Tied to the game being over, not to the overlay: "View board" asks to see
   * the board. Only a hand on the camera (drag, pinch, wheel, reset) stops it,
   * which the board detects itself (`Board3DControls.setAutoOrbit`). A no-op
   * before the board publishes its controls.
   */
  React.useEffect(() => {
    boardControls.current?.setAutoOrbit(finished);
    // Stopped on the way out (usually a rematch starting), so the next game
    // does not inherit a turning camera. Read at cleanup time: if the board
    // has unmounted, `.current` is null and this does nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => boardControls.current?.setAutoOrbit(false);
  }, [finished]);

  // The game-session actions, drawn as a section of the profile menu (see
  // ProfileMenu's `sessionActions`). Live-game only: after the game the
  // endgame overlay owns what happens next.
  //
  // At exactly two seats, "Leave & Spectate" becomes "Surrender": handing your
  // seat to a bot in a duel just leaves a bot finishing your side, so the
  // honest action is to concede. At three or more, leaving hands the seat over
  // so the others keep their game.
  //
  // The roster is the fallback so the menu does not briefly show "Leave &
  // Spectate" in a duel before the first state frame.
  const seatCount = view?.config?.players ?? seatQ.data?.seats?.length ?? 0;
  const isDuel = seatCount === 2;
  const iCanAct = mySeated && !myBotControlled && !finished;
  const canLeaveSeat = iCanAct && !isDuel;
  const canSurrender = iCanAct && isDuel;
  // How long the game must be before it can be ended by agreement. The server
  // sends both numbers; an old server sending neither hides these controls.
  const turnsDone = view?.turns_completed ?? 0;
  const drawMinTurns = view?.draw_min_turns ?? Number.POSITIVE_INFINITY;
  const longEnoughToEnd = turnsDone >= drawMinTurns;
  const canOfferDraw = iCanAct && longEnoughToEnd && !view?.draw_offer;
  // Only when every other seat is a bot, the server's own condition.
  const canEndVsBots = iCanAct && longEnoughToEnd && !!view?.bots_only;
  // Not on a ranked table: lobby.ResetToLobby refuses those (409
  // RANKED_NO_RESET), because the matchmaker makes the first-seated player the
  // host, who could otherwise delete a match they were losing.
  //
  // Read from the same payloads in the same order as hostId above, so isHost
  // is never known while this is not.
  const isRankedTable = sock.summary?.game.ranked ?? seatQ.data?.game.ranked ?? false;
  const canAbortToLobby = isHost && !finished && !isRankedTable;
  // Memoised because ProfileMenu is memoised and this screen re-renders on
  // every socket frame. Declared above the `if (!g)` / `if (!view)` early
  // returns because it is a hook.
  const sessionActions = React.useMemo<SessionAction[]>(() => {
    const out: SessionAction[] = [];
    // Ordered by consequence: the ways to end a game you are still playing (a
    // draw needs consent, a claim is only against bots) come first, and the
    // destructive, danger-toned entries form one block at the bottom. Leave and
    // Surrender never appear together.
    if (canOfferDraw)
      out.push({
        key: "draw",
        label: t({ message: "Offer a draw", context: "propose that the game ends level" }),
        icon: <Handshake weight="bold" size={15} />,
        onSelect: () => setDrawOpen(true),
      });
    if (canEndVsBots)
      out.push({
        key: "claim",
        label: t`End the game`,
        icon: <Robot weight="bold" size={15} />,
        onSelect: () => setEndGameOpen(true),
      });
    if (canLeaveSeat)
      out.push({
        key: "leave",
        label: t`Leave & Spectate`,
        icon: <Eye weight="bold" size={15} />,
        tone: "danger",
        onSelect: () => setLeaveOpen(true),
      });
    if (canSurrender)
      out.push({
        key: "surrender",
        label: t`Surrender`,
        icon: <Flag weight="bold" size={15} />,
        tone: "danger",
        onSelect: () => setSurrenderOpen(true),
      });
    if (canAbortToLobby)
      out.push({
        key: "reset",
        label: t`Reset to lobby`,
        icon: <ArrowCounterClockwise weight="bold" size={15} />,
        tone: "danger",
        onSelect: () => setResetConfirm(true),
      });
    return out;
  }, [canLeaveSeat, canSurrender, canOfferDraw, canEndVsBots, canAbortToLobby, t]);

  // An armed board mode whose targets are gone. A mode the player armed (a
  // rider, a wagon drive, a ship job, a fish bridge or road, a picked-up ship
  // or knight) is local state the server cannot clear; when its target is
  // resolved elsewhere (the timer moves the castle rider, the wagon runs out of
  // movement, the last bridge site goes), the prompt would stay over a board
  // with nothing lit. Checked against the board's own target plan
  // (lib/armedTargets), and cleared here because `effMode` is derived below
  // the early returns (Game.hooks.test).
  const armedStale: "rider" | "ship" | "fish" | "mode" | null = (() => {
    if (!view) return null;
    // Positional, and never spelled `moveFrom...:`, so the options object the
    // board receives stays the only place that names its origins.
    const gone = (m: BoardMode, edge?: Edge | null, vertex?: Vertex | null) =>
      armedTargetsGone({
        view,
        mode: m,
        ["moveFromEdge"]: edge ?? undefined,
        ["moveFromVertex"]: vertex ?? undefined,
        moveFromShip: explorersShip,
        shipJob: explorersJob,
      });
    if (riderFrom && gone("ridermove", riderFrom)) return "rider";
    if (explorersShip !== null && gone(explorersJob === null ? "sail" : "shipact")) return "ship";
    if (fishPending === "bridge" && gone("fishbridge")) return "fish";
    if (fishPending === "free_road" && gone("fishedge")) return "fish";
    if (mode === "wagonmove" && gone("wagonmove")) return "mode";
    if (mode === "shipmove" && shipMoveFrom && gone("shipmove", shipMoveFrom)) return "mode";
    if (mode === "knightmove" && knightMoveFrom && gone("knightmove", null, knightMoveFrom))
      return "mode";
    return null;
  })();
  React.useEffect(() => {
    if (armedStale === "rider") setRiderFrom(null);
    else if (armedStale === "ship") {
      setExplorersShip(null);
      setExplorersJob(null);
    } else if (armedStale === "fish") setFishPending(null);
    else if (armedStale === "mode") {
      setShipMoveFrom(null);
      setKnightMoveFrom(null);
      setMode("none");
    }
  }, [armedStale]);

  if (!g) {
    return (
      <Screen noFooter>
        <SiteHeader active="lobby" compact />
        <div
          role="status"
          aria-live="polite"
          /* Bare on the page ground, no card behind it: page ink, not card ink. */
          className="flex flex-col items-center gap-3 py-20 text-[14px] font-bold text-on-background-muted"
        >
          <Spinner size={26} />
          <Trans>Returning to lobby…</Trans>
        </div>
      </Screen>
    );
  }
  // The ["game", g] query is shared with the waiting room, so the roster (bots
  // included) is in hand before the first state frame.
  const roster = [...(seatQ.data?.seats ?? [])].sort((a, b) => a.no - b.no);
  /**
   * The entry screen, as a value rather than an early return. It is rendered
   * over the mounted board by BoardEntryCover, so the renderer,
   * meshes, shaders and first shadow pass are built behind it and `onReady`
   * means the board is ready.
   *
   * It uses the same `LoadingScreen` as the lobby and waiting room, so moving
   * from the waiting room to the board reads as one continuous wait.
   */
  const failed = sock.error || sock.stalled;
  const entryScreen = (
    <LoadingScreen
      // Either the server rejected the sub (sock.error) or never answered within
      // the watchdog window (sock.stalled: server down, actor wedged, sub
      // dropped).
      //
      // A refusal is an answer (the table is gone, private or not ours), so a
      // retry would get the same reply. Silence is re-asked by the socket on its
      // own backoff (see armStall) while this screen is open, so the copy says
      // so instead of offering Retry. Back to Play stays, except in the
      // Activity, which has no table browser.
      message={
        failed
          ? sock.error
            ? t`Couldn't load this game.`
            : t`Trouble reaching this table. Still trying…`
          : roster.length > 0
            ? // Once the state frame is in, the wait is the board itself: models
              // parsing and each seat's piece art resolving, a different wait
              // from the network one.
              view
              ? t`Preparing the board…`
              : t`Starting game…`
            : t`Connecting to game…`
      }
      // Wider than the default card so roster chips sit two or three to a row.
      className={roster.length > 0 ? "w-[min(92vw,480px)]" : undefined}
      actions={
        failed && !inActivityMode() ? (
          <div className="flex items-center justify-center gap-2">
            <Button asChild variant="secondary">
              <Link to="/play">
                <Trans>Back to Play</Trans>
              </Link>
            </Button>
          </div>
        ) : undefined
      }
    >
      {/* Hold the roster on screen while the first state frame is in flight.
          Navigating lobby to game tears down the lobby subscription, and without
          this the table blinks to bare text just before the map appears. */}
      {roster.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {roster.map((s) => (
            <div
              key={s.no}
              className="flex items-center gap-1.5 bg-background border-2 border-border rounded-full pl-2 pr-3 py-1.5"
            >
              <span className="w-4 h-4 rounded-full" style={{ background: colorOf(s.no) }} />
              <span className="text-[13px] font-extrabold flex items-center gap-1 text-on-background">
                <DecoratedName decoration={s.decoration}>
                  {seatDisplayName(s.user_name, s.status)}
                </DecoratedName>
              </span>
            </div>
          ))}
        </div>
      )}
    </LoadingScreen>
  );

  // No view means no board to put behind the entry screen: the "Connecting to
  // game..." state, with its own error and stall escapes. A table that closed
  // before this link was opened sends only `closed`, not a state frame, so say
  // so rather than wait. See tableClosed.
  if (!view && g && tableClosed(sock.closed, gameStatus))
    return <TableClosedScreen g={g} inv={inv} />;
  if (!view) return entryScreen;

  const myTurn = view.cur === view.viewer && view.viewer >= 0 && !myBotControlled;
  const me = view.players.find((p) => p.seat === view.viewer);
  // Does this client hold a seat? game.Spectator is -1 on the wire, so a
  // negative viewer is a spectator.
  //
  // The hand shelf belongs to a seat (hand, pieces, trades), so a spectator
  // gets none. This includes reloading onto a finished game, which
  // game.BuildBoardView renders as a spectator view; a player who played
  // through keeps their live view and shelf. Bot-controlled seats keep it too,
  // since the owner can take the seat back.
  const seated = view.viewer >= 0;
  // "Is this mine to act on": see lib/seat.actingSeat for how this differs
  // from `view.viewer` and which each call site wants.
  const actorSeat = actingSeat(view.viewer, myBotControlled);
  const needDiscard = (view.pending_discards?.[actorSeat] ?? 0) > 0;
  // Explorers' harbour-settlement setup round (the first, or the second with
  // Knights) is offered as `legal.harbours`, so it needs its own mode; as
  // "settlement" it would read the empty `legal.settlements`.
  const explorersStep = isExplorers(view) ? explorersSetupStep(view) : null;
  // The Knights pairing's forward leg is a city, so the road that follows is
  // beside a city rather than a settlement.
  const explorersKnights = isExplorers(view) && parseExpansions(view.config.ruleset).knights;
  const explorersHarbourSetup = explorersStep === "harbour";
  // The third round places a road and then a settler-loaded ship, offered as
  // `legal.roads` and `legal.ships` without `need_road`, so it needs its own
  // mode too.
  const explorersStartSetup = explorersStep === "start";
  const setupMode: BuildMode =
    view.phase === "setup" && myTurn
      ? explorersHarbourSetup
        ? "harbour"
        : explorersStartSetup
          ? explorersRoad
            ? "ship"
            : "road"
          : view.need_road
            ? setupShip
              ? "ship"
              : "road"
            : "settlement"
      : "none";
  // The pirate is a choice only where the engine offers it a destination:
  // `legal.pirate_hexes` is absent with the lobby's Pirate switch off (the
  // engine then refuses `move_pirate`) and in rulesets without it.
  const pirateOffered = (view.legal?.pirate_hexes?.length ?? 0) > 0;
  const robberMode: BuildMode =
    view.robber_pending && myTurn && !needDiscard
      ? pirateOffered && robberChoice === "pirate"
        ? "pirate"
        : "robber"
      : "none";
  // Deserter: while the taker owes the equal-strength replacement, the board is
  // forced into placement mode.
  const deserterKnights = knightsExt(view);
  const deserterPlacing =
    !!deserterKnights &&
    deserterKnights.deserter_taker >= 0 &&
    deserterKnights.deserter_taker === actorSeat &&
    (deserterKnights.deserter_level ?? 0) > 0;
  // reloc_player is -1 when no knight awaits relocation, the same as a
  // spectator's viewer, so check for a real seat or every spectator would be
  // put into relocate mode.
  const relocating =
    !!deserterKnights &&
    deserterKnights.reloc_player >= 0 &&
    deserterKnights.reloc_player === actorSeat;
  // A lost barbarian defense: this seat must give up one of its cities before
  // anything else. Often owed on another player's turn, so like the Deserter
  // placement it forces the board.
  //
  // A seat with one sacrificable city is listed only when the ruleset sells a
  // way out (Rivers, below), since that is a real choice; otherwise the engine
  // razes the single city without a prompt.
  const barbarianSacrifice =
    !!deserterKnights && (deserterKnights.barbarian_downgrade ?? []).includes(actorSeat);
  // A metropolis earned but not yet placed: this seat must name which of its
  // metropolis-free cities holds it. Always on your own turn, but like the
  // other forced steps it takes the board. With one eligible city the engine
  // places it without a prompt.
  const metropolisPicking =
    !!deserterKnights &&
    deserterKnights.metropolis_pick !== undefined &&
    deserterKnights.metropolis_pick.player === actorSeat;
  /**
   * Disarm the board as soon as the log says this seat's forced turn is over,
   * before the snapshot confirms it.
   *
   * Modes below `setupMode` come from phase flags, which `lib/foldEvent`
   * does not fold (that would be a second rules engine). So
   * between the timer taking a turn and the next snapshot, the view still
   * offers every vertex for the owed settlement.
   *
   * `forcedTurnOver` reads only what the events state outright and only ever
   * removes an offer. See its own note.
   */
  const takenOver = forcedTurnOver(sock.events, view.seq, actorSeat);

  // A chosen fish spend that needs a board target puts the board into the
  // mode that offers it. Only one does:
  //
  //   free_road    `fishedge` mode: the edge must be one this seat could build
  //                on now, from `legal.roads` or, under Islands, `legal.ships`
  //                (the credit buys either). The spend grants a credit, as
  //                Road Building does, and the `fishRoad` effect below spends
  //                it on the named edge, so the player presses once.
  //
  // The 2-fish spend removes the robber from the board, so it has no target
  // and the panel sends it outright.
  //
  // Below every forced step: a spend is voluntary, so an interrupted spend
  // waits.
  const fishMode: BuildMode =
    fishPending === "free_road" ? "fishedge" : fishPending === "bridge" ? "fishbridge" : "none";

  // Raiders. `raidersRoleNow` is the scenario's state machine for this seat,
  // read from `ext.pend.seat` (published to everyone so the table can say who
  // it is waiting on), never from `view.cur`: a landing interrupts the
  // builder's turn, an Intrigue is answered by its buyer, and the battle
  // sweep hands prisoners to seats not on turn.
  const raiders = raidersExt(view);
  // The coast readout the riders and gold panels carry (RaidersCoast).
  const raidersCoastNow = raidersCoastThreat(view);
  const raidersRoleNow = raidersRole(view, actorSeat);
  const raidersAskedSeat = raidersAsking(view);
  // The card whose step this seat is answering, for the thumbnail at the head
  // of its prompt; the revealed card lands there and stays until done.
  const raidersCardId = RAIDERS_CARD_OF_ROLE[raidersRoleNow];
  const raidersDock = raidersCardId ? (
    <RevealDock
      slot={playedCardSlot("raiders", raidersCardId)}
      anchors={anchors}
      waiting={revealDocking}
    />
  ) : undefined;
  // Publish the open forced panel to the Escape ladder declared far above.
  // Assigned during render, since the ladder only needs the value at the
  // keypress.
  const raidersPanelOpen =
    raidersRoleNow === "raiders_treason" || raidersRoleNow === "raiders_steal"
      ? raidersRoleNow
      : null;
  raidersOpenRef.current =
    raidersPanelOpen && raidersStood !== raidersPanelOpen ? raidersPanelOpen : null;

  // Raiders forces the board in three of its six pendings, only for the seat
  // being asked (per `raidersRole`, which reads `ext.pend.seat`, so this is
  // often a seat other than `view.cur`).
  //
  // The other three take no board target: Treason names its plan in one
  // message via its own planner, the 7's steal names a seat, and a declined
  // Swift Rider names nothing. They open panels below.
  const raidersPickMode: BuildMode =
    raidersRoleNow === "raiders_path" ||
    raidersRoleNow === "raiders_muster" ||
    raidersRoleNow === "raiders_swift"
      ? "riderplace"
      : raidersRoleNow === "raiders_landing" || raidersRoleNow === "raiders_intrigue"
        ? "raiderhex"
        : "none";
  // One voluntary step: a rider chosen in the riders panel, awaiting the board
  // press for its destination. Voluntary even when a castle rider must leave:
  // the engine refuses the pass, not the turn, so the player may keep building
  // and trading.
  const riderMoveMode: BuildMode = riderFrom ? "ridermove" : "none";

  // Wagons. The barbarian outranks the movement, as in the engine's
  // BlocksTurnActions: while a barbarian is owed, nothing else is legal.
  const wagonRoleNow = wagonRole(view, actorSeat);
  const wagonBarbIdx = owedBarbarian(view);
  // The choice a 7 or a Knight leaves open, so any of the three can be moved.
  const wagonBarbChoices = wagonBarbIdx === null ? movableBarbarians(view) : [];
  const wagonMpLeft = wagonMovementLeft(view, actorSeat);
  const wagonBarbMoving =
    wagonBarbIdx ??
    (wagonBarbChoices.find((b) => b.id === wagonBarbPick) ?? wagonBarbChoices[0])?.id ??
    0;

  // Explorers: the board mode a fleet-panel button armed. Voluntary, so below
  // every forced step. Sailing keeps its ship between steps (see the sail
  // handler), so the mode releases itself when the ship can go no further
  // (out of movement, or stopped by a discovery). Derived rather than cleared
  // in an effect, since this runs below the early returns.
  const sailingShipStuck =
    explorersShip !== null &&
    explorersJob === null &&
    !(view.legal?.explorer_ships ?? []).some(
      (g) => g.ship === explorersShip && (g.moves?.length ?? 0) > 0,
    );
  const explorersMode: BuildMode =
    explorersShip === null || sailingShipStuck
      ? "none"
      : explorersJob === null
        ? "sail"
        : "shipact";

  // Explorers' 7 moves a pirate ship, owed by whoever rolled. A forced step
  // like the robber, reusing the "pirate" hex mode (`legal.pirate_hexes`).
  const explorersPirate = explorersPirateOwed(view, actorSeat);
  // The forced steps, separate from the voluntary modes below. A voluntary step
  // (fish spend, rider move, fleet mode) is local state that survives an
  // arriving forced step and resumes after it, so its prompt must check that
  // its mode is the one in force, not just that it is armed; otherwise a
  // Knight played with a fish road armed draws two pills in one slot.
  const forcedMode: BuildMode = takenOver
    ? "none"
    : setupMode !== "none"
      ? setupMode
      : explorersPirate
        ? "pirate"
        : robberMode !== "none"
          ? robberMode
          : barbarianSacrifice
            ? "barbariandowngrade"
            : metropolisPicking
              ? "metropolispick"
              : deserterPlacing
                ? "deserterplace"
                : relocating
                  ? "relocateknight"
                  : raidersPickMode !== "none"
                    ? raidersPickMode
                    : // Wagons. The barbarian is a forced step and sits with the
                      // others; the movement is armed by the panel's Drive button
                      // and so sits with `mode`, below the voluntary spends.
                      wagonRoleNow === "barbarian"
                      ? "wagonbarbarian"
                      : "none";
  const effMode: BuildMode = takenOver
    ? "none"
    : forcedMode !== "none"
      ? forcedMode
      : fishMode !== "none"
        ? fishMode
        : riderMoveMode !== "none"
          ? riderMoveMode
          : // Explorers' fleet modes are voluntary, like a fish
            // spend, so they sit below every forced step above and
            // above the plain build `mode`.
            explorersMode !== "none"
            ? explorersMode
            : mode;
  // A voluntary step with no board mode of its own (the fish picker dialogs,
  // the castle-rider reminder) waits on the same condition.
  const voluntaryOpen = !takenOver && forcedMode === "none";

  // Withdraw a control while its own command is outstanding, so the dice stop
  // inviting a second `roll_dice` the server would refuse. See lib/inflight.
  // `linkDown` joins these so a control that cannot produce a move does not
  // look live; `cmd` already refuses from the first moment of a drop, and this
  // is the state the screen settles into if it lasts. See lib/link.
  const canRoll =
    myTurn &&
    view.phase === "play" &&
    !view.rolled &&
    !view.robber_pending &&
    !needDiscard &&
    !linkDown &&
    !entryHeld &&
    !isInFlight(inflight, "roll_dice");
  /**
   * A module has taken this seat's voluntary actions away.
   *
   * `engine.requireUninterruptedTurn` refuses build, trade and every module
   * command while a module's `BlocksTurnActions` is set (e.g. an open camel
   * vote under Caravans), so the client must not offer them.
   *
   * Folded into `canAct` and `canBuild` rather than each affordance, so Build,
   * Trade and Fish stay consistent. Rolling is not gated: `decideRoll`
   * (engine/turn.go) ignores module blocks, and a camel vote opens as the next
   * turn begins, so the seat on turn should roll while it owes a bid.
   */
  const moduleBlocked = moduleBlocksActions(view, actorSeat);
  const canTurnAction =
    myTurn &&
    view.phase === "play" &&
    view.rolled &&
    !view.robber_pending &&
    !needDiscard &&
    !moduleBlocked &&
    !linkDown &&
    !entryHeld;
  // `canSpend` gates the shelf's module tiles (fish, the wagon, Raiders gold
  // and riders), whose commands a moving wagon does not close, so the wagon
  // panel and two-fish boost stay reachable mid-drive. `canBuild` adds the
  // wagon's gate on building and trading (engine/wagons blocksBuildTrade,
  // BUILDING_OVER).
  const canSpend = canTurnAction && !explorersExt(view)?.movement;
  const canBuild = canSpend && !wagonMovingClosesBuilding(view);
  /**
   * A module refuses to let the turn pass, whoever owes it.
   *
   * `decideEndTurn` (engine/turn.go) checks the strict `Blocks` hook, which a
   * module may hold after releasing `BlocksTurnActions`. Caravans does this:
   * after bidding, the seat on turn may build and trade again, but the vote
   * must resolve before the turn passes (else `ErrModulePending`). See
   * lib/moduleGates.
   */
  const endBlocked = moduleBlocksEndTurn(view);
  // A wagon that has not moved does not stop the turn: ending it declines the
  // movement first (see wagonMoveOnlyBlocksEnd).
  const endDeclinesWagon = wagonMoveOnlyBlocksEnd(view);
  const canEnd =
    canTurnAction && (!endBlocked || endDeclinesWagon) && !isInFlight(inflight, "end_turn");
  const endTurn = () => {
    if (endDeclinesWagon) send("wagons_halt", {});
    send("end_turn");
  };
  // My play phase and not blocked by a forced step, rolled or not. Dev and
  // progress cards (except post-roll-only ones) may be played here; the engine
  // enforces one card per turn and not the turn bought. (See
  // lib/reachability.canPlayDev.)
  const canAct =
    myTurn &&
    view.phase === "play" &&
    !view.robber_pending &&
    !needDiscard &&
    !moduleBlocked &&
    !entryHeld;
  const canPlayDev =
    !entryHeld &&
    canPlayDevCard({
      myTurn,
      phase: view.phase,
      robberPending: !!view.robber_pending,
      needDiscard,
      playedDev: !!view.played_dev,
    });

  // A build is offered only when it would succeed: affordable (hand index 1..5
  // = wood/brick/sheep/wheat/ore), a piece left, and for placements a legal
  // spot. Road Building makes roads free. COST lives in lib/costs (shared with
  // the location menu). The optimistic spend overlay is subtracted so a button
  // disables as soon as a purchase is staged.
  const affords = (cost: Record<number, number>) =>
    Object.entries(cost).every(
      ([i, n]) => (me?.hand?.[+i] ?? 0) - spentFor(spent, view.seq, +i) >= n,
    );
  const freeRoads = (view.free_roads ?? 0) > 0;
  // A Road Building free build is placeable before the roll:
  // `freeRoadPlaceable` (engine/build.go) needs the play phase, the turn and no
  // robber/discard/module interrupt but not the roll, and `LegalForSeat` sends
  // the edges on the same predicate (engine/legal.go). Gating on `canBuild`
  // (which requires `rolled`) would leave the board with no target.
  const canPlaceFree = canAct && freeRoads;
  // Rivers, read here because the bridge is a build. `hasRivers` is the ruleset
  // question (the shelf tiles exist); the rest is state, as in the Fishermen
  // block below.
  //
  // The cost comes off the wire (`ext.rivers.bridge_cost`), not lib/costs, so
  // it matches what the server charges.
  const hasRivers = rulesetCaps(view.config.ruleset).hasRivers;
  const myCoins = seatCoins(view, actorSeat);
  const myBridgesLeft = seatBridgesLeft(view, actorSeat);
  /**
   * Rivers alongside Knights sells a way out of a sacrifice: 5 coins keeps the
   * city the barbarians came for.
   *
   * Gated on `hasRivers` because only some module sells it
   * (`engine.HasPillageBuyout`, currently Rivers alone); the wire publishes the
   * debt (`barbarian_downgrade`), not whether a buyout is offered.
   *
   * Affordability here only labels and disables the button; the engine
   * refuses a short seat with NO_COINS regardless.
   */
  const { offered: pillageBuyoutOffered, afford: canAffordBuyout } = pillageBuyoutOffer(
    view,
    actorSeat,
    hasRivers,
  );
  // Which attack this seat is answering. The stand-down is keyed to it, so the
  // dialog stays down for this debt and reopens at the next lost defense.
  const buyoutAttack = knightsExt(view)?.attacks ?? 0;
  const buyoutCost = buyoutWealthCost(view, actorSeat);
  const pillageBuyoutOpen = pillageBuyoutOffered && buyoutStood !== buyoutAttack;
  // Bound to a name so both numbers in "Bridge (1 of 3)" extract as named
  // placeholders; a call expression in a template becomes a positional `{0}`.
  const bridgeTotal = bridgeSupply(view);
  const bridgePrice = bridgeCost(view);
  // Both coin trades are turn actions (the sale as often as you like, the
  // purchase twice a turn), priced against the hand minus the optimistic spend
  // overlay, as `buildWhy`'s shortfall is.
  const coinTradesNow = coinTrades(
    view,
    actorSeat,
    (i) => (me?.hand?.[i] ?? 0) - spentFor(spent, view.seq, i),
    !!canBuild,
  );
  const canRoad =
    (canBuild || canPlaceFree) &&
    (me?.roads_left ?? 0) > 0 &&
    (freeRoads || affords(COST.road)) &&
    (view.legal?.roads?.length ?? 0) > 0;
  const canSettlement =
    canBuild &&
    (me?.settlements_left ?? 0) > 0 &&
    affords(COST.settlement) &&
    (view.legal?.settlements?.length ?? 0) > 0;
  const canCity =
    canBuild &&
    (me?.cities_left ?? 0) > 0 &&
    affords(COST.city) &&
    (view.legal?.cities?.length ?? 0) > 0;
  // Islands ship: a piece left, affordability and a legal sea edge, like the
  // base buildables (the server computes legal.ships). Road Building makes
  // ships free too, so honour freeRoads like canRoad does.
  const canShip =
    (canBuild || canPlaceFree) &&
    (islandsExt(view)?.ships_left?.[view.viewer] ?? 0) > 0 &&
    (freeRoads || affords(COST.ship)) &&
    (view.legal?.ships?.length ?? 0) > 0;
  // Rivers bridge: the base buildables' shape, but never `canPlaceFree` or
  // `freeRoads`. Road Building cannot pay for a bridge and the engine refuses
  // it (engine/rivers/decide.go does not consult FreeRoads).
  //
  // The cost comes off the wire (`ext.rivers.bridge_cost`), not lib/costs.
  const canBridge =
    canBuild && myBridgesLeft > 0 && affords(bridgePrice) && (view.legal?.bridges?.length ?? 0) > 0;
  // Whether this ruleset has the base development deck. Knights, Raiders and
  // Explorers remove it (NoDevCards), but the server still reports the unused
  // deck's depth, so `dev_deck_count` alone is not enough.
  const hasBaseDeck = rulesetCaps(view.config.ruleset).hasDevCards;
  const canBuyDev = hasBaseDeck && canBuild && affords(COST.dev) && view.dev_deck_count > 0;
  // Knights: affordability and a legal placement target, like the base
  // buildables (the server computes legal.knights/walls).
  const canKnight = canBuild && affords(COST.knight) && (view.legal?.knights?.length ?? 0) > 0;
  const canWall = canBuild && affords(COST.wall) && (view.legal?.walls?.length ?? 0) > 0;

  /**
   * Why a dark build tile is dark, for the popover over it.
   *
   * A separate pass over the same facts as the gates: the gates run every
   * frame and stay cheap, while this builds sentences only where a tooltip is
   * drawn. Computed beside the gates so they agree; the shortfall subtracts the
   * same optimistic spend overlay as `affords`. lib/reachability's
   * `buildBlockReason` picks the sentence.
   *
   * Null when the tile is live; then the tooltip shows the price.
   */
  const buildWhy = (
    what: Buildable,
    // `boolean | undefined`: some gates are built from optional view fields
    // (`view.rolled`), and undefined reads as "not ok", as at the tile.
    ok: boolean | undefined,
    opts: {
      pieces: number | null;
      cost: Record<number, number>;
      legal: number;
      deck?: number;
    },
  ): string | null =>
    ok
      ? null
      : buildBlockReason(what, view, {
          ready: !!ok,
          pieces: opts.pieces,
          short: costShortfall(
            opts.cost,
            (i) => (me?.hand?.[i] ?? 0) - spentFor(spent, view.seq, i),
          ),
          legal: opts.legal,
          deck: opts.deck,
        });

  // An armed build mode survives its own placement, so something must end it
  // when the player runs out of pieces, resources or legal spots. These are the
  // shop tiles' gates, so a mode never outlives the tile that armed it.
  //
  // Computed here but acted on by an effect declared above the loading guards
  // (see Game.hooks.test.ts).
  const modeStillLegal =
    mode === "road"
      ? canRoad
      : mode === "settlement"
        ? canSettlement
        : mode === "city"
          ? canCity
          : mode === "ship"
            ? canShip
            : mode === "knight"
              ? canKnight
              : mode === "wall"
                ? canWall
                : mode === "bridge"
                  ? canBridge
                  : true;
  modeLegal.current = modeStillLegal !== false;

  // Trade basket built by clicking held resource cards (give) and the want
  // pills in the basket popup (see the dock below).
  const tradeSum = tradeGive.reduce((a, b) => a + b, 0);
  const wantSum = tradeWant.reduce((a, b) => a + b, 0);
  const addGive = (idx: number) =>
    setTradeGive((g) => {
      const c = [...g];
      if (c[idx] < (me?.hand?.[idx] ?? 0)) c[idx]++;
      return c;
    });
  const removeGive = (idx: number) =>
    setTradeGive((g) => {
      const c = [...g];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  const addWant = (idx: number) =>
    setTradeWant((w) => {
      const c = [...w];
      c[idx]++;
      return c;
    });
  const removeWant = (idx: number) =>
    setTradeWant((w) => {
      const c = [...w];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  const comGiveSum = tradeComGive.reduce((a, b) => a + b, 0);
  const comWantSum = tradeComWant.reduce((a, b) => a + b, 0);
  const addComGive = (idx: number) =>
    setTradeComGive((g) => {
      const c = [...g];
      if (c[idx] < (myComm?.[idx] ?? 0)) c[idx]++;
      return c;
    });
  const removeComGive = (idx: number) =>
    setTradeComGive((g) => {
      const c = [...g];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  const addComWant = (idx: number) =>
    setTradeComWant((w) => {
      const c = [...w];
      c[idx]++;
      return c;
    });
  const removeComWant = (idx: number) =>
    setTradeComWant((w) => {
      const c = [...w];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  function clearTrade() {
    setTradeGive([0, 0, 0, 0, 0, 0]);
    setTradeWant([0, 0, 0, 0, 0, 0]);
    setTradeComGive([0, 0, 0]);
    setTradeComWant([0, 0, 0]);
    setCurrencyGive({});
    setCurrencyWant({});
  }
  /**
   * Whether this is a Knights game, as opposed to whether Knights state has
   * arrived. Every question about what the HUD contains asks this.
   *
   * `s.Ext["cak"]` is created by the module's first event (the event die on
   * the first roll), so `knightsExt(view)` is undefined through setup and the
   * first pre-roll turn; gating panels on it would draw the base-game layout
   * until then.
   *
   * Ruleset questions ask this; state questions ask `knState` (declared below).
   */
  const knights = parseExpansions(view.config.ruleset).knights;
  // The trade panel has two explicit actions over the same give/want trays: a
  // bank/maritime trade and a player offer. Whether the commodity lane exists
  // is the ruleset's answer, not `knightsExt`'s (which is absent during setup).
  const knightsActive = knights;
  const giveResTypes = RES.filter((r) => tradeGive[r.idx] > 0);
  const giveComTypes = knightsActive ? COMMOD_ROW.filter((c) => tradeComGive[c.idx] > 0) : [];
  const wantResTypes = RES.filter((r) => tradeWant[r.idx] > 0);
  const wantComTypes = knightsActive ? COMMOD_ROW.filter((c) => tradeComWant[c.idx] > 0) : [];
  const currencies = scenarioCurrencies(view, actorSeat);
  const currencyGiveSum = currencyCount(currencyGive),
    currencyWantSum = currencyCount(currencyWant);
  const offerReady =
    tradeSum + comGiveSum + currencyGiveSum > 0 &&
    wantSum + comWantSum + currencyWantSum > 0 &&
    currencies.every((c) => (currencyGive[c.key] ?? 0) <= c.held);
  // The viewer's Knights hand and improvement tracks, read inline rather than
  // from `myKnights` (declared below) because the bank lane needs the commodity
  // hand for affordability and the Trade level for the Trading House.
  const myKnightsPlayer = knightsActive ? knightsExt(view)?.players?.[view.viewer] : undefined;
  // Resource-to-resource is the base maritime lane, and it settles a whole
  // basket in one command: any mix of give kinds, each at its own ratio,
  // funding any mix of wanted kinds (2 wood + 2 brick at 2:1 each -> 2 sheep).
  // The server validates the basket as a unit, so a refused trade costs
  // nothing. Anything with a commodity is the Knights lane, priced one kind
  // to one kind.
  const bankInfo = (() => {
    if (currencyGiveSum + currencyWantSum > 0) return null;
    // Base maritime lane.
    if (giveComTypes.length === 0 && wantComTypes.length === 0) {
      const plan = maritimeTrade(tradeGive, tradeWant, view.bank_ratios, view.bank, me?.hand);
      if (!plan) return null;
      return {
        ok: plan.ok,
        why: maritimeBlockedReason(plan, me?.hand, view.bank),
        exec: () => cmd("bank_trade", plan.cmd),
      };
    }
    if (!knightsActive) return null;
    // A commodity basket: more than one kind on either side, settled in one
    // command priced per kind. Single kind to single kind falls through to
    // commodityTrade below, which can also reach the Trading House (metered at
    // one good per use, so never for a basket).
    if (
      giveResTypes.length + giveComTypes.length > 1 ||
      wantResTypes.length + wantComTypes.length > 1
    ) {
      const plan = goodsBasket({
        giveRes: tradeGive,
        giveCom: tradeComGive,
        wantRes: tradeWant,
        wantCom: tradeComWant,
        bankRatios: view.bank_ratios,
        goodRatios: view.good_ratios,
        goodMaritimeRatios: view.good_maritime_ratios,
        hand: me?.hand,
        commodities: myKnightsPlayer?.commodities,
        bank: view.bank,
        commoditySupply: knightsExt(view)?.commodity_supply,
      });
      if (!plan) return null;
      return {
        ok: plan.ok,
        exec: () => cmd(plan.cmd.type, plan.cmd.data),
      };
    }
    // The Knights single-kind lane gives exactly one kind and takes exactly one.
    if (giveResTypes.length + giveComTypes.length !== 1) return null;
    const gRes = giveResTypes[0],
      gCom = giveComTypes[0];
    // Knights commodity lane: one kind to one kind with a commodity on at least
    // one side. commodityTrade picks the cheaper of two server commands (the
    // Trade-3 Trading House takes 2 of a commodity for any 1 other good, which
    // beats every maritime rate) and quotes it, so the button lights only for
    // a trade the server will accept.
    if (wantResTypes.length + wantComTypes.length !== 1) return null;
    const wRes = wantResTypes[0],
      wCom = wantComTypes[0];
    const wantN = wRes ? tradeWant[wRes.idx] : tradeComWant[wCom.idx];
    const comPlan = commodityTrade({
      give: gRes ? { res: gRes.idx } : { com: gCom.idx },
      giveN: gRes ? tradeGive[gRes.idx] : tradeComGive[gCom.idx],
      want: wRes ? { res: wRes.idx } : { com: wCom.idx },
      wantN,
      bankRatios: view.bank_ratios,
      goodRatios: view.good_ratios,
      tradeLevel: myKnightsPlayer?.improve?.[0] ?? 0,
      hand: me?.hand,
      commodities: myKnightsPlayer?.commodities,
      bank: view.bank,
      commoditySupply: knightsExt(view)?.commodity_supply,
    });
    if (!comPlan) return null;
    // `comPlan.ok` is all this lane reports.
    return {
      ok: comPlan.ok,
      exec: () => cmd(comPlan.cmd.type, comPlan.cmd.data),
    };
  })();
  // A non-active player facing an unanswered standing offer can turn the same
  // trays into a counter-offer instead of an (illegal off-turn) offer.
  const ao = view.active_offer;
  // Answering does not close the trade panel: a counter replaces whatever this
  // seat said before, as a second Accept/Reject does.
  const canCounter =
    !!ao && view.viewer >= 0 && ao.by !== view.viewer && !myBotControlled && !entryHeld;
  function closeTrade() {
    clearTrade();
    setTradeOpen(false);
  }
  function execBank() {
    // A command that never left keeps the staged basket, so the player can
    // press again.
    //
    // A trade that left closes the panel, as an offer does; on a wide board
    // the panel covers the western build spots the player may want next.
    if (bankInfo?.ok && bankInfo.exec()) closeTrade();
  }
  function execOffer() {
    if (!offerReady) return;
    const basket = {
      give: tradeGive,
      want: tradeWant,
      give_com: tradeExtra(tradeComGive, currencyGive),
      want_com: tradeExtra(tradeComWant, currencyWant),
    };
    if (cmd(canCounter ? "counter_trade" : "offer_trade", basket)) closeTrade();
  }

  // Discard basket: the same click-the-card interaction, capped at the
  // required count. In Knights commodities count too, so the cap is on the
  // combined total.
  const discardNeed = view.pending_discards?.[actorSeat] ?? 0;
  const discardResSum = discardPick.reduce((a, b) => a + b, 0);
  const discardComSum = discardComPick.reduce((a, b) => a + b, 0);
  const discardSum = discardResSum + discardComSum;
  const addDiscard = (idx: number) =>
    setDiscardPick((p) => {
      const c = [...p];
      const res = c.reduce((a, b) => a + b, 0);
      if (res + discardComSum < discardNeed && c[idx] < (me?.hand?.[idx] ?? 0)) c[idx]++;
      return c;
    });
  const removeDiscard = (idx: number) =>
    setDiscardPick((p) => {
      const c = [...p];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  const myComm = knightsExt(view)?.players?.[view.viewer]?.commodities;
  const addDiscardCom = (idx: number) =>
    setDiscardComPick((p) => {
      const c = [...p];
      const com = c.reduce((a, b) => a + b, 0);
      if (discardResSum + com < discardNeed && c[idx] < (myComm?.[idx] ?? 0)) c[idx]++;
      return c;
    });
  const removeDiscardCom = (idx: number) =>
    setDiscardComPick((p) => {
      const c = [...p];
      if (c[idx] > 0) c[idx]--;
      return c;
    });
  function confirmDiscard() {
    send("discard_cards", { cards: discardPick, commodities: discardComPick });
    setDiscardPick([0, 0, 0, 0, 0, 0]);
    setDiscardComPick([0, 0, 0]);
  }

  const islands = islandsExt(view);
  // Caravans. `camelRoleNow` is the vote's state machine for this seat: owes a
  // bid, has answered, won the placement, or is watching. Both panels hang off
  // it.
  const caravans = caravansExt(view);
  const camelRoleNow = camelRole(view, actorSeat);
  // Publish it to the Escape ladder, declared far above, which cannot read the
  // derivation itself. Assigned during render because the ladder only needs
  // the value at the keypress. Game.pickers asserts this write exists: without
  // it the ref stays null and Escape over a camel panel disarms the build mode
  // beneath instead.
  camelOpenRef.current =
    (camelRoleNow === "bid" || camelRoleNow === "place") && camelStood !== camelRoleNow
      ? camelRoleNow
      : null;
  // Which of pickPlacer's outcomes gave this seat the camel. Only one is a
  // win; the others reach the finisher through the same `placer`.
  const camelOutcomeNow = camelViewOutcome(caravans);
  // Who has yet to answer, in asking order: clockwise from the finisher (the
  // round is sequential). Built from `bidded`, so a seat that bid nothing has
  // answered.
  //
  // Minus this seat: the panel renders only for the seat on the clock, and
  // `camelPending` (a table fact with no viewer) would list You first. The
  // line is about who comes after you.
  const camelPendingSeats = camelPending(view).filter((s) => s !== actorSeat);
  const camelPathsNow = camelPaths(view);
  // Knights state: absent until the module's first event. Read it for values
  // (levels, knight positions, pending decisions), never for "is this a
  // Knights game" (that is `knights`, above).
  const knState = knightsExt(view);
  // Fishermen. `fishCaps` is the ruleset question and `fishMix` the state: the
  // shelf tile exists because the game has fish, and what it buys depends on
  // this seat's holding.
  const fishCaps = rulesetCaps(view.config.ruleset);
  const hasFish = fishCaps.hasFish;
  const fishMix = myFishMix(view);
  const fishHeld = fishMix[0] + 2 * fishMix[1] + 3 * fishMix[2];
  // Raiders with Fishermen: two fish may pay for a rider's hurry instead of
  // grain. `riderHurryByFish` is the currency a tapped hurry destination
  // spends: fish when there is no grain, or when the player chose them.
  const myGrain = me?.hand?.[4] ?? 0;
  const fishHurry = hasFish && fishCaps.hasRaiders && fishHeld >= 2;
  const riderHurryByFish = fishHurry && (myGrain === 0 || riderPayFish);
  // The 7-fish draw needs a card left. `fishOffers` answers the ruleset
  // question (`hasDevCards`), not the running count; the engine refuses an
  // empty deck with ErrDeckEmpty. Dropped rather than dimmed because the deck
  // never refills (the shop tile reads the same field; see canBuyDev).
  //
  // `canBuild` tells fishOffers whether the server sends this seat `legal` at
  // all, distinguishing "no legal road edge" from "not your turn". See
  // fishOffers.
  const fishSpends = (hasFish ? fishOffers(view, fishCaps, fishMix, !!canBuild) : []).filter(
    (o) => o.spend !== "dev_card" || view.dev_deck_count > 0,
  );
  // What the shelf tile advertises, derived rather than a 2-to-7 constant (see
  // fishPriceRange).
  const fishRange = fishPriceRange(fishSpends) ?? { min: 0, max: 0 };
  const iHoldBoot = hasFish && bootHolder(view) === actorSeat;
  // What a seat holds that could be stolen. Like the engine's
  // DiscardableCount, module-aware: under Knights a player with only
  // commodities is still a legal victim.
  // `players` is keyed by `seat`, so look the seat up rather than indexing.
  const playerAt = (seat: number) => view.players.find((p) => p.seat === seat);
  const cardsHeld = (seat: number) =>
    (playerAt(seat)?.hand_count ?? 0) + (knState?.players?.[seat]?.commodity_count ?? 0);
  // Public VP per seat, which the friendly-robber shield and the boot handoff
  // compare. `publicVp` falls back for an older server.
  const seatPublicVp = (seat: number) => {
    const p = playerAt(seat);
    return p ? publicVp(p) : 0;
  };
  // Two checks: the seat holds something stealable, and it is outside the
  // friendly-robber shield.
  const fishVictims = fishStealVictims(view, actorSeat, cardsHeld, seatPublicVp);
  const bootSeats = iHoldBoot ? bootTargets(view, actorSeat, seatPublicVp) : [];

  const hasRaiders = fishCaps.hasRaiders;
  // The riders that may still move, and the subset the turn is refused for.
  // `ridersMustLeave` excludes a castle rider with nowhere legal to go: the
  // rules let that one stay and the turn end.
  const raidersMoves = riderMoves(view);
  const ridersOwed = ridersMustLeave(view);
  const myRaidersGold = goldOf(raiders, actorSeat);
  const myPrisoners = prisonersOf(raiders, actorSeat);
  const myRiders = ridersLeft(raiders, actorSeat);
  const raidersBuysLeft = goldBuysLeft(raiders);
  const raidersGoldBuys = hasRaiders ? goldBuyOffers(view, actorSeat) : [];
  const raidersGoldSells = hasRaiders ? goldSellOffers(view, me?.hand) : [];
  const canBuyRaiders = hasRaiders && canBuyRaidersCard(me?.hand);
  // The 7's victims, wider than the engine's list: the engine also applies the
  // friendly-robber shield from state this client cannot see. Offering a seat
  // the server rejects costs a toast; hiding a valid one costs the steal.
  const raidersVictims =
    raidersRoleNow === "raiders_steal" ? raidersStealVictims(view, actorSeat, cardsHeld) : [];
  // The 7's steal waits for every discard (the engine refuses it until then);
  // see the steal dialog.
  const raidersStealGate = stealGate(view, actorSeat);
  const raidersIDiscard = raidersStealGate === "hidden";
  const raidersDiscardsOpen = raidersStealGate === "waiting";
  const treasonCount = raidersRoleNow === "raiders_treason" ? treasonMoveCount(view, knights) : 0;
  const myGold = islands?.pending_gold?.[actorSeat] ?? 0;
  const myKnights = knState?.players?.[view.viewer]; // ownership, not action: feeds the shelf and tracks
  // Robber/pirate victims: in Knights a player holding only commodities is a
  // valid target (the engine steals from the combined pool), so carry the
  // per-seat commodity count with hand_count.
  const robberPlayers = view.players.map((p) => ({
    ...p,
    commodity_count: knState?.players?.[p.seat]?.commodity_count ?? 0,
  }));
  const knightsGive = knState?.pending_give?.[actorSeat] ?? 0; // Wedding: give N cards
  const knightsHarbor = knState?.harbor_give?.[actorSeat]; // Commercial Harbor: offered resource (return a commodity)
  const knightsAqueduct = (knState?.aqueduct ?? []).includes(actorSeat); // owed a free bank resource
  // The bank can be empty when the Aqueduct fires; the backend then accepts
  // only a "take nothing" (ResNone) pick, so the overlay offers it.
  const aqueductEmpty = knightsAqueduct && aqueductBankEmpty(view.bank);
  // Forced action, so it follows the acting seat even though `myKnights` is ours.
  const knightsDiscardProgress = actorSeat >= 0 && (myKnights?.progress_count ?? 0) > 4;
  /**
   * Whether settling the over-limit hand by playing a card is open right now.
   *
   * You may play down to the limit instead of discarding
   * (docs/rules/knights.md), but `decidePlayProgress` requires your turn, the
   * play phase and the roll (Alchemist inverts the last). Off-turn you must
   * discard to 4 at once, and off-turn is the common case: gate draws walk
   * `playersFromCurrent`, so players draw on anyone's roll, as do tied
   * defenders after a repelled attack.
   *
   * Uses lib/reachability's `progressPlayableReason`, the same check as the
   * dock's tiles, unit-tested there.
   */
  const canPlayInstead = playableProgressCards(view).length > 0;
  // Opponents the Deserter may target: the engine requires the victim to own
  // a knight (engine/knights/progress_play.go hasKnight).
  const deserterSeats = deserterVictimSeats(view);
  // Tracks a Crane play would be accepted on: structurally legal per the engine
  // and affordable at the discounted price. See lib/reachability.craneTracks.
  const craneLegalTracks = craneTracks(view);
  // The Crane is played from the dock's upgrade tiles (see playProgress), which
  // read this state. Derived from `progressCard`, so the Escape ladder (which
  // clears that) backs out of an armed Crane too.
  const craneArmed = progressCard === "crane";
  // Who the open "pick a victim" overlay may name. Spy is the only card with
  // that input kind and a constraint (the victim must hold a progress card);
  // any other card using the kind gets every opponent.
  const victimSeats =
    progressOverlay?.card === "spy"
      ? spyVictimSeats(view)
      : view.players.filter((p) => p.seat !== view.viewer).map((p) => p.seat);

  /**
   * Send a command, recording any forced decision it resolves.
   *
   * Every outgoing command goes through here, so the "I did this myself"
   * bookkeeping is a table lookup rather than a flag set at each call site.
   * `send` below adds build-mode and optimistic-spend behaviour; overlays that
   * want neither call this directly.
   */
  function cmd(type: string, data?: unknown): string | null {
    // The board is still loading behind its cover; see `entryHeld`. Silent:
    // the control that called this is already drawn disabled.
    if (entryHeld) return null;
    // Every command carries an id, which the server echoes as `err.ref`
    // (server/ws.go), so a rejection can be matched to its command.
    const id = nextCmdId();
    // The wire first; nothing is staged until it takes the frame. A socket
    // that is not open drops the frame (there is no outbound queue), so the
    // server would never answer, and staged effects would show a piece that
    // only disappears when the TTL sweeps it.
    if (!gameSocket.cmd(type, data, id)) {
      toast.error(errorText("LINK_DOWN"));
      return null;
    }
    const kind = resolvesPending(type, knightsDiscardProgress) ?? undefined;
    if (kind) markInitiated(kind);
    // `actorSeat` is the seat this client is playing, -1 for a bot-played seat
    // (lib/seat.actingSeat). Such a seat sends nothing, so it states no piece.
    const patch =
      actorSeat >= 0 ? (patchForCommand(type, data, actorSeat, view!) ?? undefined) : undefined;
    // How we will know it landed. A patch answers for itself; controls with no
    // position get the fact they are waiting for; everything else falls back
    // to "any view newer than the one we acted against", weak but never wrong.
    const settle = settleFor(type, kind, !!patch, view!);
    setInflight((prev) => [...prev, { id, type, sentAt: Date.now(), patch, kind, settle }]);
    return id;
  }

  /**
   * Put down every half-finished selection and leave the board unarmed. Used
   * when a send does not happen: call sites clear their own selection after
   * `send` regardless, and a mode without its selection looks armed but does
   * nothing.
   */
  function disarm() {
    setMode("none");
    setKnightMoveFrom(null);
    setShipMoveFrom(null);
    setDiplomatFrom(null);
    setChaseFrom(null);
    setInventorA(null);
    setProgressCard(null);
  }

  function send(type: string, data?: unknown, opts?: { keepMode?: boolean }): string | null {
    // The opening hold and the dropped link. Both have a pointer-swallowing lid
    // below; this enforces the same rule where every command leaves.
    //
    // A blocked send disarms rather than returning quietly. Call sites clear
    // their half of a multi-step selection unconditionally (a knight move's
    // source, the armed progress card, the Inventor's first hex), so returning
    // early would leave e.g. `mode === "knightmove"` with `knightMoveFrom ===
    // null`: a board that looks live and ignores every click.
    if (startHold || linkDown) {
      disarm();
      return null;
    }
    const id = cmd(type, data);
    if (!id) {
      disarm();
      return null; // never left the client; stage nothing
    }
    // Armed build modes stay armed, so placing three roads is three clicks.
    // Everything else clears the mode. The effect below drops the mode once it
    // stops being legal.
    if (!opts?.keepMode) setMode("none");
    // Optimistically deduct a known paid action's cost so the hand reacts at
    // once; the snapshot supersedes it, and a refusal naming this command's id
    // withdraws exactly this cost (see rollbackCmd).
    const cost = CMD_COST[type];
    const isFreeRoad = freeRoads && (type === "build_road" || type === "build_ship");
    if (cost) setSpent((prev) => addSpent(prev, sock.full?.seq, id, cost, isFreeRoad));
    return id;
  }

  // Dispatch a chosen location-menu action: one-shot command, or seed an
  // existing multi-step move mode from the clicked location.
  function runAction(a: LocationAction) {
    // The last gate before a command leaves. The dial only calls this for a
    // ready entry, but a short or blocked one must never become a command.
    if (a.status !== "ready") return;
    const loc = inspectAt?.loc ?? null;
    setInspectAt(null);
    runActionAt(loc, a);
  }

  /**
   * Dispatch a chosen action for an explicit location. Split from `runAction`
   * because the fast path (a spot affording one thing) acts straight from the
   * click without putting the location into state.
   */
  function runActionAt(loc: BoardLocation | null, a: LocationAction) {
    if (a.cmd) {
      send(a.cmd.type, a.cmd.data);
      return;
    }
    if (!loc) return;
    if (a.mode === "shipmove" && loc.kind === "edge") {
      setShipMoveFrom(loc.e);
      setMode("shipmove");
    } else if (a.mode === "knightmove" && loc.kind === "vertex") {
      setKnightMoveFrom(loc.v);
      setMode("knightmove");
    } else if ((a.mode === "chaserobber" || a.mode === "chasepirate") && loc.kind === "vertex") {
      // One knight, one command; the two modes differ only in which blocker's
      // destinations the board lights.
      setChaseFrom(loc.v);
      setMode(a.mode);
    }
  }

  // Robber: find opponents with a building on the chosen hex to steal from.
  // With the friendly-robber option, players at their starting score are
  // shielded (robberVictimSeats drops them), matching the server.
  function moveRobber(h: Hex) {
    const victims = robberVictimSeats(
      h,
      view!.buildings,
      robberPlayers,
      view!.viewer,
      friendlyShieldMaxVP(view!),
    );
    if (victims.length === 0) send("move_robber", { hex: h, victim: null });
    else if (victims.length === 1) send("move_robber", { hex: h, victim: victims[0] });
    else {
      setMode("none");
      setVictimPrompt({ hex: h, victims });
    }
  }

  // Knights chase-robber: an active, non-fresh knight adjacent to the robber
  // pushes it to a chosen land hex and may steal there. Victims are derived as
  // in the robber flow (robberVictimSeats); the engine re-derives them, so
  // this list only drives the picker.
  /** Close the steal picker without stealing: nothing has been sent, so the
   *  player is back to choosing a hex. */
  function backOutOfSteal() {
    if (victimPrompt?.backMode) setMode(victimPrompt.backMode);
    setVictimPrompt(null);
  }
  function resetChase() {
    setChaseFrom(null);
    setMode("none");
  }
  /** Put down a ship or knight picked up for a move, without moving it. */
  function resetMove() {
    setShipMoveFrom(null);
    setKnightMoveFrom(null);
    setMode("none");
  }
  function chaseRobber(h: Hex) {
    if (!chaseFrom) return;
    // A sea hex means the pirate: one command, and the named hex decides which
    // blocker moves. The pirate robs a player whose ship borders the hex rather
    // than a building owner, so the picker branches too.
    const onSea =
      view!.board.tiles.find((tl) => hexKey(tl.hex) === hexKey(h))?.res === ("sea" as const);
    const victims = onSea
      ? pirateVictimSeats(
          h,
          islands?.ships ?? [],
          robberPlayers,
          view!.viewer,
          friendlyShieldMaxVP(view!),
        )
      : robberVictimSeats(
          h,
          view!.buildings,
          robberPlayers,
          view!.viewer,
          friendlyShieldMaxVP(view!),
        );
    if (victims.length === 0) {
      send("chase_robber", { v: chaseFrom, hex: h });
      resetChase();
    } else if (victims.length === 1) {
      send("chase_robber", { v: chaseFrom, hex: h, victim: victims[0] });
      resetChase();
    } else {
      setMode("none");
      setVictimPrompt({ hex: h, victims, chase: chaseFrom, backMode: mode });
    }
  }

  // Diplomat: after tapping your own open road, you may remove it or relocate it.
  function resetDiplomat() {
    setDiplomatFrom(null);
    setProgressCard(null);
    setMode("none");
  }

  // Pirate (Islands): steal from an opponent whose ship borders the chosen sea
  // hex (both edge endpoints are corners of it).
  function movePirate(h: Hex) {
    const victims = pirateVictimSeats(
      h,
      islands?.ships ?? [],
      robberPlayers,
      view!.viewer,
      friendlyShieldMaxVP(view!),
    );
    if (victims.length === 0) send("move_pirate", { hex: h, victim: null });
    else if (victims.length === 1) send("move_pirate", { hex: h, victim: victims[0] });
    else {
      setMode("none");
      setVictimPrompt({ hex: h, victims, pirate: true });
    }
  }

  function playProgress(card: string, kind: ProgressKind) {
    if (kind === "noarg") send("play_progress", { card });
    else if (kind === "hex") {
      setProgressCard(card);
      setMode("phex");
    } else if (kind === "vertex") {
      setProgressCard(card);
      setMode("pvertex");
    } else if (kind === "edge") {
      setProgressCard(card);
      setMode("pedge");
    } else if (card === "inventor") {
      setProgressCard("inventor");
      setInventorA(null);
      setMode("inventor1");
    } else if (card === "crane") {
      // The Crane is answered at the improvement tiles: arming `progressCard`
      // makes the dock's three upgrade tiles re-price to the discount and send
      // the card instead of the paid buy (see the `crane` branch there), and
      // the Escape ladder already backs it out. No board mode: the card names
      // a track, not a spot.
      setProgressCard("crane");
    } else if (card === "deserter") {
      setMasterMerchant(false);
      setProgressCard("deserter");
    } else if (card === "master_merchant") {
      setMasterMerchant(true);
    } else if (card === "commercial_harbor") {
      setCommercialHarbor(true);
    } else setProgressOverlay({ card, kind });
  }

  // Top-right status chip: on your turn it names the action you owe;
  // otherwise whose turn it is. After the game it says so, since the final
  // board keeps rendering under the scoreboard.
  const curName = seatName(view.cur);
  /** The score this table plays to, named so the chip's message can carry it. */
  const targetVp = view.config.target_vp;
  // The reader's own target, one higher while they carry the boot. A separate
  // binding so the message gets a named placeholder (`{targetVp + 1}` would be
  // positional).
  const bootTargetVp = targetVp + 1;
  const turnLabel = finished
    ? t`Game over`
    : !myTurn
      ? t`${curName}'s turn`
      : needDiscard
        ? t({ message: `Discard ${discardNeed}`, context: "how many cards you owe" })
        : explorersPirate
          ? t`Move your pirate ship`
          : view.phase === "setup"
            ? explorersHarbourSetup
              ? t`Place a harbour settlement`
              : explorersStartSetup
                ? explorersRoad
                  ? t`Place your ship, with its settler, beside your harbour settlement`
                  : explorersKnights
                    ? t`Place a road beside your city`
                    : t`Place a road beside your settlement`
                : explorersStep === "city"
                  ? t`Place a city`
                  : view.need_road
                    ? // The Islands Road/Ship choice sits right under this chip;
                      // with Ship picked it went on saying "Place a road".
                      islands && setupShip && (view.legal?.ships?.length ?? 0) > 0
                      ? t`Place a ship`
                      : t`Place a road`
                    : setupPlacesCity(view)
                      ? t`Place a city`
                      : t`Place a settlement`
            : view.robber_pending
              ? pirateOffered && robberChoice === "pirate"
                ? t`Move the pirate`
                : t`Move the robber`
              : !view.rolled
                ? t`Roll the dice`
                : explorersExt(view)?.movement
                  ? // Explorers' third phase: building and trading are closed.
                    t`Move your ships`
                  : t`Build / Trade`;

  // The trade/discard interface opens above the dock when active; the
  // buildable tiles and playable cards live inline in the dock, each enabled
  // only when legal. The trade panel is available on your build turn or when
  // you can counter a standing offer; discard always preempts it.
  const tradePanelOpen = tradeOpen && !needDiscard && (canBuild || canCounter);

  // Endgame data (only used when `finished`); see the endgame overlay below.
  const pgWinner = sock.postgame?.winner ?? sock.winner ?? -1;
  const pgRows = sock.postgame?.scoreboard ?? [];
  const pgRolls = sock.postgame?.rolls ?? {};
  const pgRollCount = Object.values(pgRolls).reduce((a, b) => a + b, 0);
  const pgRematch = sock.postgame?.rematch;
  const pgCaps = rulesetCaps(view?.config?.ruleset ?? sock.summary?.game.ruleset ?? "base");
  // After the endgame overlay is dismissed ("View board"), a compact "Show
  // results" control sits in the top-left cluster.
  const resultsButton = finished && !summaryOpen;

  // Named locals for the two forced-step prompts below, so their messages carry
  // named placeholders rather than positional ones.
  const deserterOffer = deserterTiers(view);
  const deserterLevel =
    deserterPick !== null && deserterOffer.includes(deserterPick)
      ? deserterPick
      : (deserterOffer[deserterOffer.length - 1] ?? deserterKnights?.deserter_level ?? 1);
  const metropolisTrack = TRACK_METRO_EARNED[deserterKnights?.metropolis_pick?.track ?? 0];

  // What the open dial offers, computed once for the dial and for the board
  // (which holds its hover on the menu's spot). A spot with nothing to offer
  // draws no menu and holds no hover.

  // The menu reads the authoritative view, not the optimistic one: the
  // roster's entries are gated on the server's `legal` sets, which an
  // optimistic settlement lacks, so the menu would wrongly refuse "Upgrade to
  // city" on the player's own new piece. Nothing is lost: the board's
  // clickable set comes from `boardView`, whose `legal` already excludes a spot
  // with an outstanding piece.
  const dialActions = inspectAt ? actionsAt(inspectAt.loc, view) : [];
  // The aimed spot keeps its ghost while the prompt is up: `heldLoc` holds a
  // preview under a panel covering the pointer, and a confirm pill is one.
  const heldLoc = inspectAt && dialActions.length > 0 ? inspectAt.loc : null;

  // What a board tap reads and writes, for lib/boardTap. Built per render like
  // `boardProps` beside it, so a tap always sees this render's selections.
  const boardTapCtx: BoardTapCtx = {
    view,
    mode: effMode,
    send,
    setMode,
    knightMoveFrom,
    setKnightMoveFrom,
    shipMoveFrom,
    setShipMoveFrom,
    diplomatFrom,
    setDiplomatFrom,
    resetDiplomat,
    progressCard,
    setProgressCard,
    deserterLevel,
    setDeserterPick,
    setupShip,
    setSetupShip,
    explorersShip,
    setExplorersShip,
    explorersJob,
    setExplorersJob,
    explorersRoad,
    setExplorersRoad,
    explorersRecycle,
    fishPending,
    setFishPending,
    setFishRoad,
    raidersRole: raidersRoleNow,
    setRaidersStood,
    riderFrom,
    setRiderFrom,
    riderHurryByFish,
    wagonBarbMoving,
    setWagonDestination,
    setWagonBarbPick,
  };

  const boardProps: BoardProps = {
    view:
      effMode === "cargoship" && explorersRecycle
        ? {
            ...(boardView ?? view),
            legal: {
              ...view.legal,
              ships: view.legal?.ships?.filter(
                (e) =>
                  (explorersExt(view)?.ships ?? []).filter(
                    (ship) => ship.id !== explorersRecycle && edgeKey(ship.e) === edgeKey(e),
                  ).length < 2,
              ),
            },
          }
        : (boardView ?? view),
    // What the rail covers, measured; the board decides whether that needs a
    // shift. Only where the rail is a column; below lg it is a strip under the
    // turn banner, covered by the top band.
    hudChrome: {
      railFrac: wideLayout ? railFrac : 0,
      // Sideways phone: the rail and the dock column differ in width, so each
      // side gets its own.
      ...(squat ? { left: railFrac, right: dockColFrac } : null),
      bottom: squat ? squatFleetFrac : bottomFrac,
      // While a target prompt floats over the top of the board, the frame
      // starts below it.
      top: Math.max(topFrac, promptFrac),
    },
    // The resolved mode decides whether inspect gets the board (see
    // lib/boardTargets.boardModeFor). The armed `mode` would send forced steps
    // such as the Deserter taker's placement to inspect, which ignores the
    // placement vertices.
    mode: boardModeFor(effMode, !!canBuild),
    // A click on the board always opens the dial; a click never places
    // directly, since which entry it performs would depend on ruleset, terrain
    // and hand at once. Rapid repeat placement goes through the build shelf's
    // armed mode, one click each.
    onInspect: (loc, at) => setInspectAt({ loc, at }),
    // Which spot the open menu is about, so the board keeps it looking hovered
    // while the menu covers the pointer. See props.heldLoc.
    heldLoc,
    onHoverInfo: (info, at) => setHoverInfo(info ? { info, at } : null),
    // The two touch routes to the readout a mouse gets from hovering. Explain
    // mode takes the whole press and suppresses board actions; the long press
    // is the shortcut, only where there is no hover. See lib/explainMode and
    // lib/touch.
    explaining,
    onExplained: answerGiven,
    pressToExplain: noHover,
    colorOf,
    numberPieces: colorblind,
    // Every two-step edge move names its origin here, or the board offers no
    // destination: `ridermove` looks up its reach by this edge (see
    // lib/boardTargets).
    moveFromEdge: shipMoveFrom ?? diplomatFrom ?? riderFrom ?? undefined,
    moveFromVertex: knightMoveFrom ?? undefined,
    // Inventor's first token, so the second step cannot offer it again (the
    // engine would accept `{a: h, b: h}` and spend the card for nothing).
    moveFromHex: inventorA ?? undefined,
    // Explorers' two ship modes resolve their targets by ship id and job.
    moveFromShip: explorersShip,
    shipJob: explorersJob,
    progressCard,
    // Legal spots are lit (a pool of glow, a rim, a short column, rising motes)
    // rather than painted as a flat decal. See lib/board3d/pedestal. The board
    // picks resting loudness from its own set size (`restingForCount`).
    //
    // Resting marks show only when the board is asking a question: the player
    // committed (a piece armed from the shelf, or a card that wants a spot), or
    // the game demanded (setup, a seven, a knight owed a spot, a city owed to
    // the barbarians). `boardModeFor` resolves everything else to `inspect`,
    // the default state of your turn, which keeps its hover preview but lights
    // nothing at rest on any pointer (its target set is every spot your hand
    // can pay for, which would be noise).
    //
    // And only if the viewer wants them: `none` builds nothing; the hover
    // preview and the legal set are unchanged.
    markerStyle:
      !placementMarks || boardModeFor(effMode, !!canBuild) === "inspect" ? "none" : "pedestal",
    // One preview that travels between spots and persists through the gaps
    // between candidates (a vertex's snap radius is under a third of the
    // spacing).
    //
    // Not in inspect, whose ghost cycles through everything a spot could take
    // and would become a floating slideshow. A removal refuses the slide on
    // its own (see HoverEffect.leaving).
    slideGhost: boardModeFor(effMode, !!canBuild) !== "inspect",
    // The robber follows the pointer from hex to hex and lands with a drop
    // when you moved it. The board limits this to modes that move the robber.
    carryOnHover: true,
    viewerRobber: loadoutQ.data?.loadout?.robber,
    // A vertex or edge tap: lib/boardTap says what the armed mode commits and
    // under what name, and `routeTap` confirms it by that name on a screen
    // that cannot hover. See lib/boardTap for why `actionsAt` is wrong here.
    onVertex: (v, at) =>
      routeTap(vertexTap(v, boardTapCtx), noHover, {
        confirm: (entry, run) => hexOrAsk(entry, at, run),
        roster: (run) => placeOrAsk({ kind: "vertex", v }, at, run),
      }),
    onEdge: (e, at) =>
      routeTap(edgeTap(e, boardTapCtx), noHover, {
        confirm: (entry, run) => hexOrAsk(entry, at, run),
        roster: (run) => placeOrAsk({ kind: "edge", e }, at, run),
      }),
    onHex: (h, at) => {
      // A hex gets the same one-entry menu, built here because a hex tap's
      // meaning depends on the armed mode (see `hexOrAsk`). Moving the robber
      // is the least reversible single tap.
      // A landing tie and an Intrigue are the same command against the same
      // list, so one branch with two sentences. A tie is offered only when
      // real: the engine narrows to eligible hexes with the rolled number and
      // the fewest raiders, and places automatically if one remains.
      if (effMode === "raiderhex")
        hexOrAsk(
          {
            id: "raiders_pick_hex",
            label:
              raidersRoleNow === "raiders_intrigue"
                ? t({ message: "Take a raider from this hex", context: "board action" })
                : t({ message: "Land the raider on this hex", context: "board action" }),
            seatLabel: t({ message: "Raiders", context: "board action, short label" }),
          },
          at,
          () => {
            send("raiders_pick_hex", { hex: h });
            setRaidersStood(null);
          },
        );
      else if (effMode === "robber")
        hexOrAsk(
          {
            id: "move_robber",
            label: t({ message: "Move the robber here", context: "board action" }),
            seatLabel: t({ message: "Robber", context: "board action, short label" }),
          },
          at,
          () => moveRobber(h),
        );
      else if (effMode === "chaserobber")
        hexOrAsk(
          {
            id: "chase_robber",
            label: t({ message: "Send the robber here", context: "board action" }),
            seatLabel: t({ message: "Robber", context: "board action, short label" }),
          },
          at,
          () => chaseRobber(h),
        );
      else if (effMode === "chasepirate")
        hexOrAsk(
          {
            id: "chase_pirate",
            label: t({ message: "Send the pirate here", context: "board action" }),
            seatLabel: t({ message: "Pirate", context: "board action, short label" }),
          },
          at,
          () => chaseRobber(h),
        );
      else if (effMode === "pirate" && explorersPirate)
        hexOrAsk(
          {
            id: "explorers_move_pirate",
            label: t({ message: "Put the pirate ship here", context: "board action" }),
            seatLabel: t({ message: "Pirate", context: "board action, short label" }),
          },
          at,
          () => {
            // The engine wants the victim named whenever a ship owner is beside
            // the hex, and refuses one when nobody is.
            const victims = explorersPirateVictims(view, h, actorSeat);
            if (victims.length > 1)
              setPirateChoice({ h, victims, turn: view.turns_completed ?? 0 });
            else
              send(
                "explorers_move_pirate",
                victims.length === 1 ? { h, victim: victims[0] } : { h },
              );
          },
        );
      else if (effMode === "pirate")
        hexOrAsk(
          {
            id: "move_pirate",
            label: t({ message: "Move the pirate here", context: "board action" }),
            seatLabel: t({ message: "Pirate", context: "board action, short label" }),
          },
          at,
          () => movePirate(h),
        );
      else if (effMode === "phex" && progressCard)
        hexOrAsk(
          {
            id: `play_${progressCard}`,
            label: t`Play ${progressCardName(progressCard)} here`,
            seatLabel: progressCardName(progressCard),
          },
          at,
          () => {
            send("play_progress", { card: progressCard, hex: h });
            setProgressCard(null);
          },
        );
      else if (effMode === "inventor1") {
        // The first of two hexes: choosing, not committing (as with the
        // Diplomat's first pick above).
        setInventorA(h);
        setMode("inventor2");
      } else if (effMode === "inventor2" && inventorA)
        hexOrAsk(
          {
            id: "play_inventor",
            label: t({ message: "Swap the two number tokens", context: "board action" }),
            seatLabel: progressCardName("inventor"),
          },
          at,
          () => {
            send("play_progress", { card: "inventor", a: inventorA, b: h });
            setInventorA(null);
            setProgressCard(null);
            setMode("none");
          },
        );
    },
    onKnight:
      knState && knState.deserter_victim >= 0 && knState.deserter_victim === actorSeat
        ? (v) => {
            // Deserter: the victim taps one of their own knights to surrender
            // it. Only on an opponent's turn, so inspect mode is off and the
            // location menu (own-knight actions) does not overlap.
            const k = knState.knights.find((x) => vertexKey(x.v) === vertexKey(v));
            if (k && k.owner === view.viewer) send("deserter_surrender", { v });
          }
        : undefined,
    onShip:
      islands && canBuild
        ? (e) => {
            // Only enter move mode for a ship the server says can move; a
            // closed or pirate-locked ship has no destinations.
            const movable = (view.legal?.ship_moves ?? []).some(
              (g) => edgeKey(g.from) === edgeKey(e),
            );
            if (!movable) return;
            setShipMoveFrom(e);
            setMode("shipmove");
          }
        : undefined,
  };

  // --- HUD content -------------------------------------------------------------
  // The clusters below are positioned components; the state they display is
  // projected here, where the socket data and seat helpers live.

  const logNodes = (
    <EventLogFeed
      events={fadingLog.events}
      seatName={seatName}
      islands={!!islands}
      colorOf={colorOf}
      pieceIcon={pieceIcon}
      tiles={logTiles}
      fadeAt={fadingLog.fadeAt}
    />
  );

  const chatNodes = (() => {
    const chat = sock.chat.filter((c) => c.scope === `game:${g}`);
    if (chat.length === 0)
      return (
        <div className="text-muted text-[12px]">
          <Trans>Say something to the table…</Trans>
        </div>
      );
    return chat.map((c, i) => (
      <div key={c.id ?? i} className="group flex items-baseline gap-1 text-[12px] leading-snug">
        <span>
          {/* The sender in bold ink after a dot in their colour: a seat
              colour as type fails 4.5:1 on the panel (orange is ~1.9:1). */}
          <b data-chat-name>
            <span
              aria-hidden
              data-chat-dot
              style={{ "--swatch": avatarColor(c.user_id) } as React.CSSProperties}
            />
            {c.from}
          </b>
          :{" "}
          {/* Trade talk is drawn the way the log draws a trade. Commodities are
              cards only in a game that has them. */}
          <ChatText msg={c.msg} commodities={knights} />
        </span>
        {c.id != null && c.user_id !== authMe?.id && (
          <button
            type="button"
            aria-label={t`Report message`}
            className="opacity-0 group-hover:opacity-100 text-[var(--muted-foreground)] hover:text-[var(--destructive)] leading-none"
            onClick={() => {
              gameSocket.report(c.id!);
              toast.info(t`Report submitted`);
            }}
          >
            ⚑
          </button>
        )}
      </div>
    ));
  })();

  // ---- where the two reference surfaces go ----
  //
  // Each prefers a home and drops to the dock when the window cannot hold it,
  // under different conditions (see lib/hudChrome): the bank's card needs a
  // right-hand column (a width), the feed's island shares that column (a
  // width and a height). So a wide but short window (a 1366x768 laptop) has
  // the bank in the orb row and the feed on the dock.
  //
  // The height check protects the bank's card: the island stays only while
  // the column holds the card at its natural height and still leaves a usable
  // feed.
  // Not on a sideways phone: its right-hand column is the dock, so the bank
  // rides the dock's trigger row as in portrait.
  const bankAtTop = lgUp && !squat;
  // The fleet lies across wherever the seat cards do (the same `lg` query).
  const barbAcross = !lgUp;

  // Rejoin moves to the dock below lg, where the bank goes too: the top-left
  // island has little room there, and the dock is where pressable things are.
  // It sits at the far end of the dock's trigger row, opposite the bank, at
  // the row's 34px height.
  //
  // Not once the game is over: there is nothing left to take back.
  const rejoinable = myBotControlled && !finished;
  const rejoinAtDock = rejoinable && !bankAtTop;
  const bankCardH = Math.max(bankCardNaturalH(bankCardShape), bankCardMeasuredH);
  const feedAsIsland = lgUp && !squat && feedIslandFits({ shelfTop, topRowH, bankCardH });

  // The bank stays reachable whenever the panel has anything to show (trade
  // rates, a discard limit, your pieces, the barbarian track), which is wider
  // than `show_bank`. `show_bank` and memory mode only decide whether the
  // trigger shows the counts or the bank glyph. Kept in step with selectBank
  // in hud/TableStatus.
  const bankPublic = (view.config.show_bank ?? true) && !view.config.memory_mode;
  const bankReachable = bankPublic || !!me || knights;
  /**
   * Whether the bank is presented as a card off the orb row. Below lg the
   * panel is a dock sheet instead. The barbarian rail needs this as well as
   * the open state, because `bankCardOpen` survives a resize.
   */
  const bankShowsCard = bankReachable && bankAtTop;
  // Built once and handed to whichever presentation is on screen (the orb
  // row's card or the dock panel), so they stay one panel.
  const bankContent = (
    <>
      {/* Both read the live view themselves and are memoised, so rebuilding
          this element each render is cheap. */}
      <BankRow />
      {/* Your default rate is on the bank's header, a better rate is a badge on
          the card in your hand, and pieces left are on each build tile's
          corner. The discard readout collapses when there is no limit. */}
      <div className="flex items-start gap-2">
        {!bankPublic && <DefaultRateChip />}
        <DiscardLimit />
      </div>
    </>
  );
  // The trigger row stands down while an offer is being built, at widths where
  // the two compete for the same strip (see hudChrome). An empty list makes
  // DockPanels drop any open panel and draw no row.
  const yieldToTrade = dockYieldsToTrade({ tradePanelOpen, bankAtTop });
  // The dice always show the most recent roll; before the first roll they show
  // blank shapes (the Knights event die too), keeping the cluster's width.
  //
  // While pressable, the dice are the roll button in the corner nearest the
  // thumb; afterwards they park on the strip above the hotbar beside the bank
  // counts and feed buttons. `dicePlacement` in lib/hudChrome owns the rule
  // (including why the strip is not used on desktop or while an offer is
  // built). Parked dice do nothing on press.
  // The corner on a sideways phone, bank or no bank: the dock column has room
  // for the dice and End turn at its foot, and its trigger row has no room
  // for an End pill.
  const turnPlace = squat ? "corner" : turnControlsPlacement({ bankAtTop });
  // The roll the dice show. The socket only learns a roll from a live frame,
  // so after a reload fall back to the newest `dice_rolled` in the log.
  const shownRoll = sock.lastRoll ?? lastRollInLog(sock.events);
  const diceAt = (size: number) =>
    shownRoll ? (
      <DiceDisplay
        // Keyed on the roll so the dice remount and the tumble animation
        // replays. By seq, since two fives in a row are two rolls.
        //
        // The board's chip flip happens on the same beat: the chips show which
        // tiles, the dice show the number.
        key={shownRoll.seq}
        d1={shownRoll.d1}
        d2={shownRoll.d2}
        event={knights ? sock.lastEventDie : undefined}
        size={size}
      />
    ) : (
      <span className="flex items-center justify-center gap-1.5">
        <Die n={0} variant="white" size={size} />
        <Die n={0} variant="red" size={size} />
        {knights && <EventDie face="" size={size} />}
      </span>
    );
  const diceNode = diceAt(
    turnPlace === "corner" ? (squat ? SQUAT_DIE_SIZE : diceSize) : parkedDieSize(),
  );
  // End turn's home below lg, past the reference triggers. Not for a
  // spectator: `canEnd` false only greys it, which suits a waiting player but
  // not someone without a seat.
  const endPill =
    turnPlace === "dock" && seated ? (
      <EndTurnPill
        canEnd={!!canEnd}
        onEnd={endTurn}
        canRoll={canRoll}
        onRoll={() => send("roll_dice")}
      />
    ) : undefined;
  // Whatever is left over goes above the hotbar, a thumb's reach from the
  // shelf; possibly nothing on a big desktop (DockPanels then renders no
  // strip).
  const dockPanels: DockPanel[] = [];
  if (bankReachable && !bankAtTop && !yieldToTrade) {
    dockPanels.push({
      key: "table",
      // Phosphor, like every other orb, so it looks the same on every platform.
      icon: <Bank weight="bold" size={16} />,
      title: t`Bank & table status`,
      anchorRef: bankAnchor,
      // The trigger shows the five counts, so "is there any wheat left" costs
      // no tap. With counts hidden by config, `BankRow` renders nothing and the
      // trigger falls back to its glyph.
      //
      // Not on a sideways phone, whose dock column is too narrow for the counts
      // plus the feed buttons; the glyph opens the same panel.
      pill: bankPublic && !squat ? <BankRow compact /> : undefined,
      content: bankContent,
    });
  }
  if (!feedAsIsland && !yieldToTrade) {
    // Two buttons, not one with tabs: chat and log are separate destinations.
    // The unread dot rides the chat button.
    //
    // The same component as the island, so the sheet gets the sticky scroll
    // and unread dot too. `variant="sheet"` drops the island's glass and fixed
    // width to fill the panel.
    const feedSheet = (pane: "log" | "chat") => (
      <TableFeed
        variant="sheet"
        pane={pane}
        logScroll={eventScroll}
        chatScroll={chatScroll}
        chatBar={<ChatBar onSend={(m) => gameSocket.chat(`game:${g}`, m)} />}
        log={logNodes}
        chat={chatNodes}
        onChatRead={onChatRead}
      />
    );
    dockPanels.push({
      key: "log",
      icon: <Scroll weight="bold" size={16} />,
      title: t`Event log`,
      content: feedSheet("log"),
    });
    dockPanels.push({
      key: "chat",
      icon: <ChatCircle weight="bold" size={16} />,
      title: t`Table chat`,
      badge: unreadChat,
      content: feedSheet("chat"),
    });
  }

  const screen = (
    // The 3D scene owns the whole viewport and the chrome floats over it.
    // `fixed inset-0` lets the board run corner to corner; nothing below is in
    // normal document flow.
    // `bg-background`, not `bg-ocean`: this shows through the board's
    // transparent canvas, so it must be the colour the fog fades to (see
    // seaColor.ts), not the water's.
    <div
      className="fixed inset-0 overflow-hidden bg-background text-foreground select-none"
      style={promptVars}
    >
      {/* Layer 0: the board. Board3D sizes itself off this box with its own
          ResizeObserver. Inert until the entry gate opens, so nothing on it
          takes focus or keys under the cover. `isolate` keeps any z-index
          inside it below the cover. */}
      <div className="absolute inset-0 isolate" inert={!entry.ready || undefined}>
        {canRenderBoard ? (
          <Board3D
            {...boardProps}
            className="w-full h-full"
            controls
            controlsRef={boardControls}
            onProjector={holdProjector}
            onReady={handleBoardReady}
          />
        ) : (
          // No WebGL, so no board. The log, chat and hand still work, so say
          // what is wrong where the board would be rather than leaving a black
          // rectangle that reads as a crash.
          <div className="flex h-full w-full items-center justify-center p-6">
            <div className="max-w-sm rounded-base border-2 border-border bg-secondary-background p-5 text-center shadow-shadow">
              <p className="text-base font-bold">
                <Trans>This browser can't draw the board</Trans>
              </p>
              <p className="mt-2 text-sm text-muted">
                <Trans>
                  The board needs WebGL, which this browser has turned off or does not support. The
                  rest of the table still works, but you won't be able to see or click the map.
                </Trans>
              </p>
              <p className="mt-2 text-sm text-muted">
                <Trans>
                  Enabling hardware acceleration, or opening the game in a different browser,
                  usually fixes it.
                </Trans>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The opening hold: a lid over the board for half a second so the start
          cue is not stepped on. Under the HUD (z-10), so the header, menus and
          chat stay live; `send` refuses commands for the same window. */}
      {startHold && <div className="absolute inset-0 cursor-wait" />}

      {/* Layer 2: cards in the air, above the HUD: each flight ends at a piece
          of chrome (a seat coin, a hand card, the bank orb), and passing under
          its target would look broken. Only with a board, since a produced
          card starts at a hex and needs the camera. */}
      {canRenderBoard && (
        <CardFlightLayer
          batch={flightBatch}
          projector={projector}
          anchors={anchors}
          viewer={view.viewer}
        />
      )}
      {/* A Raiders card or a Swift Journey, turned over at the table. Works
          with or without a board: both ends are chrome. */}
      <CardRevealLayer
        batch={revealBatch}
        anchors={anchors}
        reduced={noMotion}
        hand={shelf.hand}
        seatName={seatName}
        seatColor={colorOf}
        onDocking={setRevealDocking}
      />

      {/* The link went away and stayed away. The same lid as the opening hold,
          but visible, since this can last.

          It carries its own words because ConnectionIndicator only renders
          while `status !== "open"`, and `ackLost` is the half-open socket that
          stays `open`. It is a live region. No Reload button: the effect on
          `ackLost` above already calls `gameSocket.reconnectNow()`, which
          replaces the socket without losing the board, log, sound or WebGL
          context, so this only needs to say the seat is safe.

          `send` refuses under the same condition, and `cmd` below it declines
          to stage anything the socket would not take. */}
      {linkDown && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 cursor-not-allowed"
          role="alert"
          aria-live="assertive"
        >
          <div className="pointer-events-auto mx-4 flex max-w-[min(28rem,calc(100vw-2rem))] flex-col items-center gap-3 rounded-[14px] border-2 border-border bg-secondary-background px-5 py-4 text-center shadow-hard">
            <span className="font-display text-[15px] font-heavy text-foreground">
              <Trans>Connection lost</Trans>
            </span>
            <span className="text-[13px] text-foreground/80">
              <Trans>
                Your moves aren't reaching the table. Reconnecting now; your seat is held, so
                nothing is lost.
              </Trans>
            </span>
          </div>
        </div>
      )}

      {/* Your own clock, mirrored across the top edge of the screen, since the
          rail's hairline is easy to miss. Reads the socket itself. */}
      <TurnTimerEdge frozen={finished} botControlled={myBotControlled} />

      {/* The layer's own box is measured: it is `fixed inset-0`, so it is the
          viewport in the HUD's laid-out pixels rather than the raw ones
          `innerHeight` reports through the UI zoom. See HudLayer. */}
      <HudLayer ref={attachHudLayer}>
        {/* The top row. Its three islands share one grid, so a wide left island
            wraps inside its own track rather than sliding under the turn pill,
            and all three align to the top: a wrapping island grows downward
            and cannot move the pill. See HudTopRow. */}
        <HudTopRow
          ref={attachTopRow}
          // Top-left: identity and the table's fixed facts.
          left={
            <>
              {/* The hamburger is always here, so the nav is reachable from a
              game at every width; the wordmark joins it when there is room. */}
              <HamburgerMenu />
              {/* The wordmark and ruleset chip are hidden below 720px so the
              turn pill gets the full row. Both pills spell out the GLASS
              material by hand (they are rounded-full) and omit
              `backdrop-blur-md`, as GLASS does; see HudLayer. */}
              <BrandPill className="hud-surf hidden min-[720px]:inline-block squat:hidden shrink-0 rounded-full px-3 sm:px-4 py-1.5 text-[14px] sm:text-[16px] font-extrabold tracking-[1px] [font-family:'Baloo_2',sans-serif]" />
              <div className="hud-surf hidden sm:flex rounded-full px-3.5 py-1.5 items-center gap-2">
                <span className="text-[12px] font-semibold">
                  {rulesetLabel(view.config.ruleset)}
                </span>
                {/* The target the reader is playing to, which may differ from
                    the table's: the old boot adds one to its holder's threshold
                    (the engine's WinThresholdDelta). Shown here, by the number
                    it changes, not near the VP chips where it would read as a
                    point. */}
                <span className="hud-lab">
                  {iHoldBoot ? (
                    <Trans id="hud.targetWithBoot">to {bootTargetVp} (the old boot)</Trans>
                  ) : (
                    <Trans>to {targetVp}</Trans>
                  )}
                </span>
              </div>
              {/* Table-level actions live here rather than in the profile menu:
              these are one-tap things players look for. */}
              {resultsButton && (
                <Button
                  size="sm"
                  className="shrink-0 bg-yellow"
                  onClick={() => setSummaryOpen(true)}
                >
                  <Trans>Results</Trans>
                </Button>
              )}
              {/* Only where this island has a column's worth of room; below lg
              the button is on the dock (see `rejoinAtDock`). */}
              {rejoinable && !rejoinAtDock && (
                <Button
                  size="sm"
                  className="shrink-0 bg-green text-main-foreground"
                  onClick={() => void returnToGame()}
                >
                  <Trans context="take your seat back from the bot">Rejoin</Trans>
                </Button>
              )}
            </>
          }
          // Top-center: whose turn, and the mode selectors for the next board
          // click.
          center={
            <TurnBanner
              turnLabel={turnLabel}
              color={finished ? undefined : colorOf(view.cur)}
              mine={myTurn && !finished}
            >
              {/* Not while a discard is owed: the 7's discard comes first and the
                  board cannot take the answer yet. */}
              {pirateOffered && view.robber_pending && myTurn && !needDiscard && (
                <PieceChoice
                  label={<Trans context="label before the robber/pirate choice">Move:</Trans>}
                  value={robberChoice}
                  onChange={setRobberChoice}
                  options={[
                    {
                      key: "robber",
                      label: <Trans context="the robber piece">Robber</Trans>,
                      icon: <RobberGlyph />,
                    },
                    {
                      key: "pirate",
                      label: <Trans context="the pirate piece">Pirate</Trans>,
                      icon: <Icons.ship size={14} />,
                    },
                  ]}
                />
              )}
              {/* Only where a ship can go: an inland settlement's free piece has
                  no sea edge. */}
              {islands &&
                view.phase === "setup" &&
                view.need_road &&
                myTurn &&
                (view.legal?.ships?.length ?? 0) > 0 && (
                  <PieceChoice
                    label={<Trans context="label before the road/ship choice">Place:</Trans>}
                    value={setupShip ? "ship" : "road"}
                    onChange={(k) => setSetupShip(k === "ship")}
                    options={[
                      {
                        key: "road",
                        label: <Trans context="a road piece">Road</Trans>,
                        icon: <Icons.road size={14} />,
                      },
                      {
                        key: "ship",
                        label: <Trans context="a ship piece">Ship</Trans>,
                        icon: <Icons.ship size={14} />,
                      },
                    ]}
                  />
                )}
            </TurnBanner>
          }
          // Top-right: the controls that act and, where the window has a
          // right-hand column, the switches for the reference surfaces in it.
          // Below lg those are raised from the dock instead (see `bankAtTop`
          // and `feedAsIsland`).
          right={
            <UtilityOrbs>
              {/* The bank, as a card hanging off the row's right edge. From lg,
                  pinned open from 1280px where it fits without covering the
                  board.

                  Its cap is the room down to the hand shelf, not to the island
                  (which yields; see lib/hudChrome), so it only binds without an
                  island and stops the card running over the hotbar and dice. */}
              {bankShowsCard && (
                <TopPanelOrb
                  title={t`Bank & table status`}
                  icon={<Bank weight="bold" size={16} />}
                  anchorRef={bankAnchor}
                  contentRef={attachBankCardBody}
                  onOpenChange={setBankCardOpen}
                  pinned={wideHud}
                  maxH={shelfTop > 0 ? poppedCardMaxH(shelfTop, topRowH) : undefined}
                >
                  {bankContent}
                </TopPanelOrb>
              )}
              {/* The feed's two switches. Plain orbs rather than `TopPanelOrb`s:
                  the island is its own cluster, and routing through the bank's
                  open state would close the pinned card whenever the log opened.

                  Two, as on the dock, because log and chat are different
                  things. The lit one closes the island; the other switches the
                  pane. */}
              {feedAsIsland &&
                (
                  [
                    { pane: "log", label: t`Event log`, icon: <Scroll weight="bold" size={16} /> },
                    {
                      pane: "chat",
                      label: t`Table chat`,
                      icon: <ChatCircle weight="bold" size={16} />,
                    },
                  ] as const
                ).map((f) => (
                  <HudOrb
                    key={f.pane}
                    title={f.label}
                    aria-label={f.label}
                    aria-pressed={feedPane === f.pane}
                    active={feedPane === f.pane}
                    onClick={() => setFeedPane((p) => (p === f.pane ? null : f.pane))}
                  >
                    {f.icon}
                    {/* The dot a dock trigger draws for its `badge`, drawn by
                        hand since this orb is not a panel. Hidden while the chat
                        is already up. */}
                    {f.pane === "chat" && unreadChat && feedPane !== "chat" && (
                      <span
                        aria-hidden
                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red border-2 border-border"
                      />
                    )}
                  </HudOrb>
                ))}
              {/* Reset the camera, only with a board. Hidden on `flatBoard` too:
                  a flat board does not rotate, its zoom is fenced, and its pan
                  leash keeps a tile under the frame's middle (see
                  `clampPanTarget`), so every pose is one gesture from any
                  other. */}
              {canRenderBoard && !flatBoard && (
                <HudOrb
                  title={t({ message: "Reset view", context: "recentre the board camera" })}
                  aria-label={t({ message: "Reset view", context: "recentre the board camera" })}
                  onClick={() => boardControls.current?.resetView()}
                >
                  <ResetView size={16} />
                </HudOrb>
              )}
              {/* "What does this do?", for pointers that cannot hover. Renders
                  nothing on one that can. See ExplainOrb for why it is bound to
                  the input rather than the viewport. */}
              <ExplainOrb />
              {/* Light/dark in one click. Last of the acting controls, before
                  the profile menu. */}
              <ThemeOrb />
              {/* Leave and reset live in a section of the profile menu; see
                  `sessionActions` above and SiteHeader for the drawing. */}
              {authMe && <ProfileMenu me={authMe} sessionActions={sessionActions} />}
            </UtilityOrbs>
          }
        />

        <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
          <DialogContent className="w-auto max-w-[360px] flex flex-col gap-4">
            <DialogTitle className="text-[17px] font-extrabold">
              <Trans>Leave &amp; Spectate?</Trans>
            </DialogTitle>
            <DialogDescription className="text-[13px] font-semibold text-muted">
              <Trans>
                A bot will take over your seat and you'll keep watching the table. If it makes a
                move, this game won't count toward your ranking.
              </Trans>
            </DialogDescription>
            <div className="flex items-center gap-2 justify-end">
              <DialogClose asChild>
                <Button size="sm" variant="secondary">
                  <Trans context="dismiss the leave-the-table prompt">Stay</Trans>
                </Button>
              </DialogClose>
              <Button
                size="sm"
                className="bg-red text-main-foreground"
                onClick={() => void leaveGame()}
              >
                <Trans>Leave &amp; Spectate</Trans>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Offering a draw is confirmed: it is not destructive (everyone else
            must agree), but it is public, once per turn, and prompts every
            other player. */}
        <Dialog open={drawOpen} onOpenChange={setDrawOpen}>
          <DialogContent className="w-auto max-w-[360px] flex flex-col gap-4">
            <DialogTitle className="text-[17px] font-extrabold">
              <Trans context="propose that the game ends level">Offer a draw?</Trans>
            </DialogTitle>
            <DialogDescription className="text-[13px] font-semibold text-muted">
              <Trans>
                Every other player has to accept. One refusal ends the offer, and so does the end of
                this turn. You get one offer per turn.
              </Trans>
            </DialogDescription>
            <div className="flex items-center gap-2 justify-end">
              <DialogClose asChild>
                <Button size="sm" variant="secondary">
                  <Trans>Cancel</Trans>
                </Button>
              </DialogClose>
              <Button
                size="sm"
                onClick={() => {
                  // Close only on a command that actually left; otherwise the
                  // dialog would confirm something that did not happen.
                  if (cmd("offer_draw")) setDrawOpen(false);
                }}
              >
                <Trans context="propose that the game ends level">Offer a draw</Trans>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Surrendering ends the game immediately, so it is confirmed. It is
            not a forfeit: conceding a decided duel is normal play, and
            penalising it would teach players to run out the clock. */}
        <Dialog open={surrenderOpen} onOpenChange={setSurrenderOpen}>
          <DialogContent className="w-auto max-w-[360px] flex flex-col gap-4">
            <DialogTitle className="text-[17px] font-extrabold">
              <Trans>Surrender?</Trans>
            </DialogTitle>
            <DialogDescription className="text-[13px] font-semibold text-muted">
              <Trans>
                The game ends now and your opponent wins. There's no penalty for conceding a game
                you've decided is over.
              </Trans>
            </DialogDescription>
            <div className="flex items-center gap-2 justify-end">
              <DialogClose asChild>
                <Button size="sm" variant="secondary">
                  <Trans>Keep playing</Trans>
                </Button>
              </DialogClose>
              <Button
                size="sm"
                className="bg-red text-main-foreground"
                onClick={() => {
                  if (cmd("surrender")) setSurrenderOpen(false);
                }}
              >
                <Trans>Surrender</Trans>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Ending a game whose every other seat is a bot. The server awards the
            win only if you are ahead, and a draw otherwise. */}
        <Dialog open={endGameOpen} onOpenChange={setEndGameOpen}>
          <DialogContent className="w-auto max-w-[360px] flex flex-col gap-4">
            <DialogTitle className="text-[17px] font-extrabold">
              <Trans>End the game?</Trans>
            </DialogTitle>
            <DialogDescription className="text-[13px] font-semibold text-muted">
              <Trans>
                Every other seat is played by a bot, so this table can end without their agreement.
                You win only if you're ahead on points everyone can see. Otherwise it's a draw.
              </Trans>
            </DialogDescription>
            <div className="flex items-center gap-2 justify-end">
              <DialogClose asChild>
                <Button size="sm" variant="secondary">
                  <Trans>Keep playing</Trans>
                </Button>
              </DialogClose>
              <Button
                size="sm"
                className="bg-red text-main-foreground"
                onClick={() => {
                  if (cmd("claim_game")) setEndGameOpen(false);
                }}
              >
                <Trans>End the game</Trans>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Left edge: every seat's card. Below lg the column becomes a strip
            under the turn banner. Anchored top-left: a ten-seat rail centred
            vertically would grow into the top cluster.

            The offset is the top row's measured height, so the rail sits
            directly beneath it at every size and whatever the row holds. */}
        {/* The barbarian fleet, mirroring the seat rail: below the measured top
            row, on the right, at every width and track length. See
            lib/barbRail for the fixed box and lib/hudChrome#barbRailRight for
            how it clears the bank card. */}
        {barbAcross ? (
          // Below lg the seat cards are a strip under the top row and the fleet
          // goes under them, full width and short (see the horizontal section
          // of lib/barbRail), rather than as a tall column over the board.
          <HudCluster
            ref={attachBarbAcross}
            at="top-row"
            className="pointer-events-none"
            // As for the seat rail: `seatStripH` already includes that
            // cluster's bottom padding, so no inset of its own.
            style={{ paddingTop: 0, top: topRowH + seatStripH }}
          >
            <div className="pointer-events-auto flex min-w-0 max-w-[520px] flex-1">
              <BarbarianRail across />
            </div>
          </HudCluster>
        ) : squat ? (
          // Sideways phone: the right-hand column is the dock, so the fleet lies
          // across the foot of the board, centred in the gap between the seat
          // rail and the dock.
          <HudCluster
            ref={attachSquatFleet}
            at="bottom-center"
            className="pointer-events-none"
            style={{
              left: `${(railFrac + (1 - railFrac - dockColFrac) / 2) * 100}vw`,
              width: `min(420px, calc(${(1 - railFrac - dockColFrac) * 100}vw - 8px))`,
            }}
          >
            <div className="pointer-events-auto flex min-w-0">
              <BarbarianRail across />
            </div>
          </HudCluster>
        ) : (
          <HudCluster
            at="top-right"
            style={{
              ...(topRowH ? { top: topRowH } : null),
              // The card's open state: it is the only thing in the top row that
              // reaches into this column. `bankShowsCard` keeps a stale open
              // state from reserving room after the card moved to the dock.
              right: barbRailRight(bankShowsCard && bankCardOpen),
            }}
          >
            <BarbarianRail />
          </HudCluster>
        )}
        <HudCluster
          ref={attachRail}
          at="top-left"
          // `paddingTop: 0`: `topRowH` already includes the top row's bottom
          // padding, so the cluster's own would double it. Inline so it beats
          // INSET_PAD's arbitrary property regardless of rule order.
          style={{ paddingTop: 0, ...(topRowH ? { top: topRowH } : null) }}
        >
          <SeatRail
            /* The rail reads the live view itself per seat, so one player's
               change does not rebuild the other cards. Everything here is
               stable between frames: `chrome` is memoised on the roster,
               `anchors` is a ref-held registry, and `finished` flips once. */
            chrome={seatChrome}
            anchors={anchors}
            frozen={finished}
            scrollRef={railScrollRef}
            /* Stop the column above the hand shelf. Only where the rail is a
               column; below lg it is a strip under the top row.

               The row's measured height is the whole inset: the bottom row is
               a HUD cluster whose height already includes the edge inset as
               padding, so adding the rail's own would double it. The gap left
               is the row's top padding, as for every other cluster. */
            bottomInset={squat ? 0 : lgUp ? bottomRowH : undefined}
            top={topRowH}
          />
        </HudCluster>

        {/* Bottom-center: the hand shelf. Hand, buildables and dev cards share
            one island, with the trade builder and discard box opening upward
            out of it. The inner box stays `relative` for those. */}
        {/* The bottom row spans the window at every size, and the shelf takes
            all of it the turn controls do not. Nothing needs padding: the dice
            are a laid-out sibling at every width, the feed floats above this
            row (offset by its measured height), and the seat rail stops above
            it using the same measurement. */}
        {/* The dock row must outrank every other island, since the trade
            builder grows out of it and must cover what it reaches, the feed
            included. The shelf carries GLASS, which opens a stacking context
            (`isolation: isolate`), so the panel's z-30 only sorts inside the
            shelf; the ordering has to be on this cluster. GLASS must keep
            opening a stacking context.

            Likewise the reference panels belong in this cluster: rendered in
            the top row (z-20), their own z-index could not lift them above
            the hand shelf. A surface belongs in the cluster of the button that
            raises it. */}
        {/* Sideways phone (`squat`): the same cluster stood on end as the
            right-hand column, from under the orbs to the bottom edge, packed
            to its foot (trigger row, hand, then dice and End turn in the
            thumb's corner). Nothing is re-parented: the rows stack (see the
            `squat:` classes), and the camera gets a right inset
            (`dockColFrac`). */}
        <HudCluster
          ref={attachBottomRow}
          at="bottom-row"
          className={cn("pointer-events-none z-30", SQUAT_DOCK_COLUMN)}
          style={squat ? { paddingTop: 0, ...(topRowH ? { top: topRowH } : null) } : undefined}
        >
          {/* Top of the stack below lg: the dice, hard right, on their own line
              (a wobbling control cannot share a baseline). From lg they are in
              the corner cluster with End turn. See `turnControlsPlacement`. */}
          {turnPlace === "dock" && (
            <div className="pointer-events-auto">
              <DiceRow dice={diceNode} canRoll={canRoll} onRoll={() => send("roll_dice")} />
            </div>
          )}
          {/* The reference buttons with no room elsewhere, and whichever panel
              is up. The panel is out of flow (`bottom: 100%` of this cluster),
              so it is bounded by the hotbar and dice and does not grow the row
              the camera and seat rail inset for. Renders nothing when both
              surfaces fit in the right-hand column. The bank's counts ride
              here at every width below lg. */}
          <DockPanels
            panels={dockPanels}
            trailing={endPill}
            // The bottom-left corner, opposite the bank. A pill rather than a
            // `Button` so the line keeps one height (see DOCK_PILL). Green, as
            // in the top row.
            leading={
              rejoinAtDock ? (
                <button
                  type="button"
                  onClick={() => void returnToGame()}
                  className={cn(
                    DOCK_PILL,
                    "bg-green text-main-foreground text-[13px] font-extrabold",
                  )}
                >
                  <Trans context="take your seat back from the bot">Rejoin</Trans>
                </button>
              ) : undefined
            }
            // Where the panel stops and how far it lifts off the dock.
            // `viewportH` is the HUD's visible height: the visual viewport
            // (which moves with the keyboard), in HUD pixels. See
            // lib/hudChrome.
            maxH={viewportH > 0 ? dockPanelMaxH(viewportH, topRowH, bottomRowH) : undefined}
            lift={keyboardH}
          />
          {/* justify-end only matters for a viewer with no seat: no shelf, so
              the dice keep their corner.

              Measured, because this row's top edge is where the HUD's
              right-hand column ends, and it does not move when the trigger row
              above comes and goes. See `attachShelfRow`. */}
          <div
            ref={attachShelfRow}
            className={cn(
              "flex items-end gap-2",
              !seated && "justify-end",
              "squat:flex-col squat:items-stretch squat:min-h-0",
            )}
          >
            {seated && (
              <div
                className={cn(
                  GLASS,
                  // flex-1: the shelf is the row, less the turn cluster from lg.
                  // Its contents stay centred until they outgrow it (`mx-auto`
                  // on the scroll track's inner row).
                  "pointer-events-auto flex-1 min-w-0",
                  "relative flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 sm:py-3",
                  // A column: as tall as the hand needs, scrolling once the
                  // column runs out.
                  "squat:flex-initial squat:min-h-0 squat:flex-col squat:items-stretch squat:px-1 squat:py-1.5",
                  // ...and not the containing block for the trade builder and
                  // discard box: they open beside the column, positioned
                  // against the dock cluster.
                  "squat:static",
                )}
                style={
                  {
                    "--trade-lift": `${tradePanelLift(shelfOffset, !lgUp && !squat)}px`,
                  } as React.CSSProperties
                }
              >
                {/* Discard box: opens above the hand. Discard always preempts trading. */}
                {needDiscard && (
                  // A fixed width so the row being tapped does not shift as
                  // cards are picked. From lg it covers your own seat panel; on
                  // a sideways phone it opens beside the dock.
                  <div className="hud-surf-solid absolute left-0 bottom-full mb-2 z-10 w-[26rem] max-w-[calc(100vw-var(--hud-inset,0.5rem)*2)] rounded-[14px] p-2.5 squat:top-0 squat:bottom-auto squat:left-auto squat:right-full squat:mb-0 squat:mr-2 squat:w-[min(22rem,56vw)] squat:max-w-none squat:max-h-full squat:overflow-y-auto">
                    <div className="flex flex-col gap-2">
                      {/* One line: the task and its count, red while short. */}
                      <span
                        data-discard-count
                        className={cn(
                          "px-1 text-[13px] font-semibold font-num tabular-nums leading-tight",
                          discardSum === discardNeed ? "text-foreground" : "text-red-ink",
                        )}
                      >
                        <Trans>
                          Discard {discardNeed} ({discardSum}/{discardNeed})
                        </Trans>
                      </span>
                      {/* Staged discards mirror the trade panel's "YOU GIVE" lane: same
                    ResCard treatment, tap a card to put it back in your hand. */}
                      <div
                        className="hud-lane flex items-center gap-2 px-2 py-1.5 min-h-[60px]"
                        data-empty={discardSum === 0 ? "true" : undefined}
                      >
                        {discardSum === 0 ? (
                          <span className="px-1 text-[12px] text-muted">
                            <Trans>Choose cards from your hand below.</Trans>
                          </span>
                        ) : (
                          <div className="flex gap-1.5 flex-wrap">
                            {RES.filter((r) => discardPick[r.idx] > 0).map((r) => (
                              <ResCard
                                key={r.idx}
                                size="lg"
                                color={r.color}
                                name={r.name}
                                slot={resIconSlot(r.idx)}
                                count={discardPick[r.idx]}
                                countMode="positive"
                                selected
                                onClick={() => removeDiscard(r.idx)}
                                title={putBackCard(r.key)}
                              />
                            ))}
                            {COMMOD_ROW.filter((c) => discardComPick[c.idx] > 0).map((c) => (
                              <ResCard
                                key={`c${c.idx}`}
                                size="lg"
                                color={c.color}
                                name={c.name}
                                slot={comIconSlot(c.idx)}
                                count={discardComPick[c.idx]}
                                countMode="positive"
                                selected
                                onClick={() => removeDiscardCom(c.idx)}
                                title={putBackCard(c.key)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <HudButton
                        kind="primary"
                        disabled={discardSum !== discardNeed || entryHeld}
                        onClick={confirmDiscard}
                        className="self-end"
                      >
                        <Trans>Confirm</Trans>
                      </HudButton>
                    </div>
                  </div>
                )}

                {/* Trade panel: a request palette on top (tap to add a want),
              the live offer in the middle (receive and give; tap a staged card to
              take it back), and an action rail on the right: Bank (with the real
              rate), Offer/Counter, and Cancel. You give by tapping your hand in
              the dock below. */}
                {tradePanelOpen && (
                  // The wrapper spans the dock's full width and floats above it.
                  // It is click-through (pointer-events-none) so board clicks
                  // land; the visible children opt back in.
                  // Below lg the shelf shares its row with the turn controls,
                  // so the panel takes the whole row rather than the shelf's
                  // width. The class strings live in lib/hudChrome.
                  <div className={TRADE_PANEL_WRAP}>
                    <div className={TRADE_PANEL_BUILDER}>
                      <CurrencyTrade
                        currencies={currencies}
                        give={currencyGive}
                        want={currencyWant}
                        onGive={setCurrencyGive}
                        onWant={setCurrencyWant}
                      />
                      {/* REQUEST palette */}
                      <div className="flex items-center gap-2 rounded-[12px] border-2 border-border bg-panel px-2 py-1.5">
                        <span className="shrink-0 w-[56px] text-[11px] font-extrabold text-muted">
                          <Trans context="header of the row of cards you can ask for">
                            Request
                          </Trans>
                        </span>
                        {/* Eight cards do not fit a phone, so the palette
                            scrolls, with the same fade and nudge arrows as the
                            hand shelf below. */}
                        <ScrollFade
                          wrapperClassName={TRADE_SCROLL_WRAP}
                          className={cn(TRADE_ROW, TRADE_SCROLL)}
                          fadeFrom="from-panel"
                          arrows
                        >
                          {RES.map((r) => (
                            <ResCard
                              key={r.idx}
                              size="lg"
                              color={r.color}
                              name={r.name}
                              slot={resIconSlot(r.idx)}
                              onClick={() => addWant(r.idx)}
                              title={requestCard(r.key)}
                            />
                          ))}
                          {knights &&
                            COMMOD_ROW.map((c) => (
                              <ResCard
                                key={`rq${c.idx}`}
                                size="lg"
                                color={c.color}
                                name={c.name}
                                slot={comIconSlot(c.idx)}
                                onClick={() => addComWant(c.idx)}
                                title={requestCard(c.key)}
                              />
                            ))}
                        </ScrollFade>
                      </div>
                      {/* Offer summary: you receive, you give (tap a card to remove) */}
                      <div className="flex flex-col rounded-[12px] border-2 border-border overflow-hidden">
                        <div className={TRADE_LANE}>
                          <span className="shrink-0 w-[56px] flex flex-col items-center text-green-ink leading-none">
                            <span className="text-[18px] font-black">↓</span>
                            <span className="text-[10px] font-extrabold text-center [overflow-wrap:anywhere]">
                              <Trans context="header of the cards this trade would bring you">
                                You get
                              </Trans>
                            </span>
                          </span>
                          {wantSum + comWantSum === 0 ? (
                            <span className="text-[11px] font-semibold text-muted">
                              <Trans>Choose cards above to ask for.</Trans>
                            </span>
                          ) : (
                            <ScrollFade
                              wrapperClassName={TRADE_SCROLL_WRAP}
                              className={cn(TRADE_ROW, TRADE_SCROLL)}
                              arrows
                            >
                              {wantResTypes.map((r) => (
                                <ResCard
                                  key={r.idx}
                                  size="lg"
                                  color={r.color}
                                  name={r.name}
                                  slot={resIconSlot(r.idx)}
                                  count={tradeWant[r.idx]}
                                  countMode="positive"
                                  onClick={() => removeWant(r.idx)}
                                  title={removeCard(r.key)}
                                />
                              ))}
                              {wantComTypes.map((c) => (
                                <ResCard
                                  key={`wg${c.idx}`}
                                  size="lg"
                                  color={c.color}
                                  name={c.name}
                                  slot={comIconSlot(c.idx)}
                                  count={tradeComWant[c.idx]}
                                  countMode="positive"
                                  onClick={() => removeComWant(c.idx)}
                                  title={removeCard(c.key)}
                                />
                              ))}
                            </ScrollFade>
                          )}
                        </div>
                        <div className="h-0.5 bg-border" />
                        <div className={TRADE_LANE}>
                          <span className="shrink-0 w-[56px] flex flex-col items-center text-red-ink leading-none">
                            <span className="text-[18px] font-black">↑</span>
                            <span className="text-[10px] font-extrabold text-center [overflow-wrap:anywhere]">
                              <Trans context="header of the cards this trade would cost you">
                                You give
                              </Trans>
                            </span>
                          </span>
                          {tradeSum + comGiveSum === 0 ? (
                            <span className="text-[11px] font-semibold text-muted">
                              <Trans>Choose cards from your hand below.</Trans>
                            </span>
                          ) : (
                            <ScrollFade
                              wrapperClassName={TRADE_SCROLL_WRAP}
                              className={cn(TRADE_ROW, TRADE_SCROLL)}
                              arrows
                            >
                              {giveResTypes.map((r) => (
                                <ResCard
                                  key={r.idx}
                                  size="lg"
                                  color={r.color}
                                  name={r.name}
                                  slot={resIconSlot(r.idx)}
                                  count={tradeGive[r.idx]}
                                  countMode="positive"
                                  onClick={() => removeGive(r.idx)}
                                  title={removeCard(r.key)}
                                />
                              ))}
                              {giveComTypes.map((c) => (
                                <ResCard
                                  key={`gg${c.idx}`}
                                  size="lg"
                                  color={c.color}
                                  name={c.name}
                                  slot={comIconSlot(c.idx)}
                                  count={tradeComGive[c.idx]}
                                  countMode="positive"
                                  onClick={() => removeComGive(c.idx)}
                                  title={removeCard(c.key)}
                                />
                              ))}
                            </ScrollFade>
                          )}
                        </div>
                      </div>
                      {/* Merchant Guild: the Knights Trade-L3 2:1 commodity lane.
                          The component and command keep the older "trading house"
                          name; see engine/knights/decide.go. Only on your own rolled
                          turn, where the engine accepts it; off-turn the panel is
                          for answering an offer. */}
                      {knState && canBuild && (myKnights?.improve?.[0] ?? 0) >= 3 && (
                        <button
                          type="button"
                          onClick={() => setTradingHouse(true)}
                          className="self-start text-[10px] font-extrabold text-muted underline underline-offset-2 hover:text-main-foreground cursor-pointer"
                        >
                          <Trans>Merchant Guild → give 2 of a commodity, take any 1</Trans>
                        </button>
                      )}
                    </div>
                    {/* Action rail: a column beside the trays from `lg`, a row
                        beneath them below it, where a 100px column would not fit
                        a phone. */}
                    <div className={TRADE_PANEL_RAIL}>
                      <button
                        type="button"
                        disabled={!bankInfo?.ok}
                        onClick={execBank}
                        className={cn(
                          "flex-1 rounded-[12px] flex flex-col items-center justify-center gap-0.5 px-1 py-2 transition-[filter]",
                          // Lit is a solid panel ringed in focus blue; dead is the
                          // panel with its content dimmed (the panel stays opaque).
                          bankInfo?.ok
                            ? "hud-surf-solid text-[var(--hud-focus)] shadow-[inset_0_0_0_2px_var(--hud-focus),var(--hud-shadow)] hover:brightness-105 cursor-pointer"
                            : "hud-surf text-muted cursor-default *:opacity-60",
                        )}
                      >
                        {/* The icon names the counterparty before the label does:
                            a bank here, three figures on Offer/Counter below. It
                            takes the button's top half (TRADE_RAIL_ICON).

                            No sub-line restating the trade: the trays show it.
                            The enabled state says whether the bank will take it. */}
                        <Bank weight="bold" className={TRADE_RAIL_ICON} />
                        <span className="text-[13px] font-extrabold leading-none">
                          <Trans context="trade with the bank">Bank</Trans>
                        </span>
                        {/* Only when dark, and only the reason (see
                            lib/bankReason). */}
                        {bankInfo && "why" in bankInfo && bankInfo.why && (
                          <span
                            data-bank-why
                            className="text-[8.5px] font-semibold text-center leading-tight"
                          >
                            {bankInfo.why}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!offerReady}
                        onClick={execOffer}
                        className={cn(
                          "flex-1 rounded-[12px] flex flex-col items-center justify-center gap-0.5 px-1 py-2 transition-[filter]",
                          offerReady
                            ? "hud-surf-solid text-[var(--rate-ink)] shadow-[inset_0_0_0_2px_var(--rate-ink),var(--hud-shadow)] hover:brightness-105 cursor-pointer"
                            : "hud-surf text-muted cursor-default *:opacity-60",
                        )}
                      >
                        <UsersThree weight="bold" className={TRADE_RAIL_ICON} />
                        <span className="text-[13px] font-extrabold leading-none">
                          {canCounter ? (
                            <Trans context="answer a standing trade offer with your own">
                              Counter
                            </Trans>
                          ) : (
                            <Trans context="put a trade to the table">Offer</Trans>
                          )}
                        </span>
                        <span className="text-[8.5px] font-semibold text-center leading-tight opacity-80">
                          {canCounter ? (
                            <Trans context="who a counter-offer is sent to">to that player</Trans>
                          ) : (
                            <Trans context="who a new offer is put to">to the table</Trans>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={closeTrade}
                        title={t`Cancel`}
                        // The glyph is the whole face; without a label a screen
                        // reader says "multiplication x".
                        aria-label={t`Cancel`}
                        // In the row it is a square on the end rather than a bar
                        // across the bottom: the one control that throws work
                        // away should not be the widest.
                        className="hud-secondary text-[var(--hud-bad)] w-11 flex items-center justify-center text-[16px] font-semibold hover:brightness-105 cursor-pointer transition-[filter] lg:h-9 lg:w-auto"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {/* Everything you hold or can buy lives in one horizontally
              scrollable shelf, so the turn controls stay pinned at the right
              edge however many cards and tiles a ruleset adds. The inner w-max
              row sizes to its content; the outer track scrolls when it
              overflows, and ScrollFade fades an edge with more content. -my-4 /
              py-4 reserves vertical room so the count badges (8px over the top)
              and the 4px hover lift are not clipped, since overflow-x:auto clips
              vertically too. */}
                <ScrollFade
                  wrapperClassName="flex-1 min-w-0 squat:flex squat:flex-col squat:min-h-0"
                  // Sideways phone: the track scrolls down, and the groups below
                  // wrap into it.
                  className="overflow-x-auto no-scrollbar -my-4 py-4 squat:my-0 squat:py-0.5 squat:min-h-0 squat:overflow-x-hidden squat:overflow-y-auto"
                  /* The scrollbar is hidden and a mouse wheel has no sideways
                 axis, so the shelf moves on wheel (see ScrollFade) and these
                 arrows show it can. */
                  arrows
                  // And vertical arrows on a sideways phone, where the track is a
                  // column and a third row of tiles can sit below the fold.
                  vArrows={squat}
                >
                  {/* `w-full min-w-max`, with centring on the inner group: the row
                  fills the track while the content fits and grows past it when
                  not, always starting at the left edge where scrolling expects
                  it. (A flex `justify-center` would overflow both ways and put
                  content where scrollLeft cannot reach.) */}
                  <div className="flex items-center gap-1 sm:gap-1.5 w-full min-w-max squat:min-w-0 squat:flex-wrap squat:justify-center">
                    {/* Hand: resources and (in Knights) commodities, all as ResCard.
              Each pile is drawn at its size, one card per copy (lib/handStack),
              with the corner count beside it. A click stages one into a
              trade/discard and the footer pill puts it back. Cards stay
              clickable whenever you can act so a fully staged card's pill still
              works; the add itself is capped (addGive/addDiscard). */}
                    {/* `items-center`: the cards sit in anchor spans (for the
                    card-flight overlay), and an unaligned flex item stretches to
                    the row's height, pinning the card to the top of a taller
                    span. */}
                    <div
                      ref={shelf.hand}
                      className="flex items-center gap-[3px] sm:gap-1 shrink-0 squat:w-full squat:shrink squat:flex-wrap squat:justify-center"
                    >
                      {RES.map((r) => {
                        const held = me?.hand?.[r.idx] ?? 0;
                        const moved = needDiscard ? discardPick[r.idx] : tradeGive[r.idx];
                        const remaining = Math.max(
                          0,
                          held - moved - spentFor(spent, view.seq, r.idx),
                        );
                        const active = needDiscard || canBuild || canCounter;
                        // A resource you do not hold draws no card. (A card
                        // flying to a pile not yet on screen lands on
                        // `fallbackPoint`, the hand region.)
                        if (held === 0) return null;
                        return (
                          // Wrapped so a card flying to the viewer lands on its
                          // pile: ResCard is shared by many call sites with no
                          // anchor. The span is the flex item the card was. Not
                          // `display: contents`, which has no box and would give
                          // the overlay a zero rect.
                          <span key={r.idx} ref={anchors.ref(`hand:res:${r.idx}`)}>
                            <ResCard
                              size="hand"
                              color={r.color}
                              name={r.name}
                              slot={resIconSlot(r.idx)}
                              count={remaining}
                              countMode="stack"
                              dimmed={remaining === 0}
                              // No ring: staging already shows in the corner
                              // count and the YOU GIVE lane or discard tray. The
                              // ring is kept where it is the only cue: the trade
                              // and levy pickers.
                              disabled={!active || held === 0}
                              onClick={() => {
                                if (needDiscard) {
                                  addDiscard(r.idx);
                                } else {
                                  setTradeOpen(true);
                                  addGive(r.idx);
                                }
                              }}
                              title={
                                needDiscard ? t`Click to discard` : t`Click to give in a trade`
                              }
                              footer={
                                needDiscard && moved > 0 ? (
                                  <CommitPill
                                    n={moved}
                                    tone="discard"
                                    onRemove={() => removeDiscard(r.idx)}
                                  />
                                ) : undefined
                              }
                            />
                          </span>
                        );
                      })}
                      {/* Drawn in COMMOD_ROW (display) order (paper, cloth, coin)
                          while every read and handler keys off `c.idx`, the
                          engine index.

                          Gated on the ruleset, not `myKnights?.commodities`, which
                          is absent until the module's first event. A commodity
                          you do not hold draws nothing, like a resource. */}
                      {knights &&
                        COMMOD_ROW.map((c) => {
                          const held = myKnights?.commodities?.[c.idx] ?? 0;
                          const moved = needDiscard ? discardComPick[c.idx] : tradeComGive[c.idx];
                          const remaining = held - moved;
                          const active = needDiscard || canBuild || canCounter;
                          if (held === 0) return null;
                          return (
                            <span key={`com${c.idx}`} ref={anchors.ref(`hand:com:${c.idx}`)}>
                              <ResCard
                                size="hand"
                                color={c.color}
                                name={c.name}
                                slot={comIconSlot(c.idx)}
                                count={remaining}
                                countMode="stack"
                                dimmed={remaining === 0}
                                disabled={!active || held === 0}
                                onClick={() => {
                                  if (needDiscard) {
                                    addDiscardCom(c.idx);
                                  } else {
                                    setTradeOpen(true);
                                    addComGive(c.idx);
                                  }
                                }}
                                title={
                                  needDiscard ? t`Click to discard` : t`Click to give in a trade`
                                }
                                footer={
                                  needDiscard && moved > 0 ? (
                                    <CommitPill
                                      n={moved}
                                      tone="discard"
                                      onRemove={() => removeDiscardCom(c.idx)}
                                    />
                                  ) : undefined
                                }
                              />
                            </span>
                          );
                        })}
                    </div>

                    {/* Everything that is not your hand, moved as one group until
                    the buy tiles inside it are centred on the window (see
                    `shelfLead` and `useShelfLead`). Not centred in the shelf,
                    whose middle shifts with the turn cluster, nor as a whole
                    group, whose size changes with the hand.

                    The hand stays anchored left because it changes size
                    constantly; otherwise every tile would slide under the
                    pointer.

                    A measured margin rather than `mx-auto`, which could only
                    split the free space of the wrong box. */}
                    <div
                      ref={shelf.group}
                      // `ml-0!` on a sideways phone: there is no single line to
                      // centre on there; each group is its own block.
                      className="flex items-center gap-1 sm:gap-1.5 shrink-0 squat:w-full squat:shrink squat:flex-wrap squat:justify-center squat:ml-0!"
                      style={{ marginLeft: shelf.lead }}
                    >
                      <ShelfDivider gapPx={shelf.gap} />

                      {/* Buildables: always inline as purchasable tiles, each
              showing the piece in your colour, enabled only when that build is
              legal, and revealing its cost on hover.

              This is the box the shelf centres on the window, so these tiles
              hold still while the cards around them come and go. */}
                      <div
                        ref={shelf.buy}
                        className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0 squat:w-full squat:shrink squat:flex-wrap squat:justify-center"
                      >
                        <ShopTile
                          name={t({ message: "Road", context: "a road piece" })}
                          left={me ? me.roads_left : null}
                          have={me?.hand}
                          cost={COST.road}
                          free={freeRoads}
                          selected={effMode === "road"}
                          disabled={!canRoad}
                          // A free build costs nothing, so no shortfall is
                          // priced against the hand.
                          note={buildWhy("road", canRoad, {
                            pieces: me?.roads_left ?? 0,
                            cost: freeRoads ? {} : COST.road,
                            legal: view.legal?.roads?.length ?? 0,
                          })}
                          onClick={() => setMode(mode === "road" ? "none" : "road")}
                          art={<ShopArt slot="build_road" thumbs={thumbs} />}
                        />
                        <ShopTile
                          // The soft hyphen (here, in "Harbour Settle-ment" and
                          // "Up-grade") gives the English word the break it
                          // needs on the 44px phone tile, which Chromium will
                          // not supply for a capitalised word under
                          // `lang="en"` (see ShopTile). A separate msgid so How
                          // to Play's "Settlement" is unaffected.
                          name={t({ message: "Settle\u00ADment", context: "a settlement piece" })}
                          left={me ? me.settlements_left : null}
                          have={me?.hand}
                          cost={COST.settlement}
                          selected={effMode === "settlement"}
                          disabled={!canSettlement}
                          note={buildWhy("settlement", canSettlement, {
                            pieces: me?.settlements_left ?? 0,
                            cost: COST.settlement,
                            legal: view.legal?.settlements?.length ?? 0,
                          })}
                          onClick={() => setMode(mode === "settlement" ? "none" : "settlement")}
                          art={<ShopArt slot="build_settlement" thumbs={thumbs} />}
                        />
                        {/* Explorers has no cities (a settlement upgrades to a
                          harbour settlement instead), except alongside Knights,
                          whose first combination rule restores them. */}
                        {!(isExplorers(view) && !knights) && (
                          <ShopTile
                            name={t({ message: "City", context: "a city piece" })}
                            left={me ? me.cities_left : null}
                            have={me?.hand}
                            cost={COST.city}
                            selected={effMode === "city"}
                            disabled={!canCity}
                            note={buildWhy("city", canCity, {
                              pieces: me?.cities_left ?? 0,
                              cost: COST.city,
                              legal: view.legal?.cities?.length ?? 0,
                            })}
                            onClick={() => setMode(mode === "city" ? "none" : "city")}
                            art={<ShopArt slot="build_city" thumbs={thumbs} />}
                          />
                        )}
                        {islands && (
                          <ShopTile
                            name={(() => {
                              const left = islands.ships_left[view.viewer];
                              return left != null
                                ? t({ message: `Ship (${left})`, context: "a ship piece" })
                                : t({ message: "Ship", context: "a ship piece" });
                            })()}
                            label={t({ message: "Ship", context: "a ship piece" })}
                            left={islands.ships_left[view.viewer] ?? null}
                            have={me?.hand}
                            cost={COST.ship}
                            selected={effMode === "ship"}
                            disabled={!canShip}
                            note={buildWhy("ship", canShip, {
                              pieces: islands.ships_left[view.viewer] ?? 0,
                              cost: freeRoads ? {} : COST.ship,
                              legal: view.legal?.ships?.length ?? 0,
                            })}
                            onClick={() => setMode(mode === "ship" ? "none" : "ship")}
                            art={<ShopArt slot="build_ship" thumbs={thumbs} />}
                          />
                        )}
                        {/* Rivers. "n of 3" rather than a bare remainder: three
                          bridges is the whole supply for the game and they never
                          come back. The total is off the wire
                          (`ext.rivers.bridge_supply`).

                          Present whenever the game has rivers, so the shelf does
                          not change shape mid-game. */}
                        {hasRivers && (
                          <ShopTile
                            name={t({
                              message: `Bridge (${myBridgesLeft} of ${bridgeTotal})`,
                              context: "a bridge piece (Rivers)",
                            })}
                            label={t({ message: "Bridge", context: "a bridge piece (Rivers)" })}
                            left={myBridgesLeft}
                            have={me?.hand}
                            cost={bridgePrice}
                            selected={effMode === "bridge"}
                            disabled={!canBridge}
                            note={buildWhy("bridge", canBridge, {
                              pieces: myBridgesLeft,
                              // Never `freeRoads ? {} : ...` as for road and ship:
                              // Road Building does not pay for a bridge.
                              cost: bridgePrice,
                              legal: view.legal?.bridges?.length ?? 0,
                            })}
                            onClick={() => setMode(mode === "bridge" ? "none" : "bridge")}
                            art={<ShopArt slot="build_bridge" thumbs={thumbs} />}
                          />
                        )}
                        {/* Absent rather than disabled where the ruleset has no
                      base development deck (Knights' progress decks, Raiders'
                      own deck on the Muster tile, Explorers), like the
                      Ship/Knight/Wall tiles elsewhere; a disabled tile would
                      still quote a price on hover. */}
                        {hasBaseDeck && (
                          <ShopTile
                            name={t`Development Card`}
                            cost={COST.dev}
                            // A dark tile says why; a live one says how deep the
                            // deck is, so an exhausted deck does not look like
                            // "you can't afford it". Uses the same reason ladder
                            // as every buildable (lib/reachability).
                            note={
                              buildWhy("dev", canBuyDev, {
                                pieces: null,
                                cost: COST.dev,
                                // A card off the deck needs no board; the only
                                // legality question is the deck's depth.
                                legal: 1,
                                deck: view.dev_deck_count,
                              }) ??
                              t`${plural(view.dev_deck_count, {
                                one: "# card left in the deck",
                                other: "# cards left in the deck",
                              })}`
                            }
                            disabled={!canBuyDev}
                            onClick={() => send("buy_dev_card")}
                            anchorRef={anchors.ref("shop:dev")}
                            label={t({
                              message: "Dev card",
                              context: "short build-tile label for a development card",
                            })}
                            // The deck is a shared supply counted in the bank,
                            // not in this corner; it still hatches the tile when
                            // empty.
                            left={view.dev_deck_count}
                            showLeft={false}
                            have={me?.hand}
                            art={
                              // Contained at 4/5 and centred: `cover` cropped
                              // the card back's top on the phone tile.
                              <CardFace
                                slot="devcard_back"
                                className="h-4/5 w-4/5 object-contain"
                              />
                            }
                          />
                        )}
                        {knights && (
                          <ShopTile
                            name={t({ message: "Knight", context: "a knight piece" })}
                            // Strength-1 pieces left: the ones a new knight is
                            // placed with (two per player, engine/knights).
                            left={myStatus.hasMine ? myStatus.knights1 : null}
                            have={me?.hand}
                            cost={COST.knight}
                            selected={effMode === "knight"}
                            disabled={!canKnight}
                            note={buildWhy("knight", canKnight, {
                              pieces: null,
                              cost: COST.knight,
                              legal: view.legal?.knights?.length ?? 0,
                            })}
                            onClick={() => setMode(mode === "knight" ? "none" : "knight")}
                            art={<ShopArt slot="build_knight" thumbs={thumbs} />}
                          />
                        )}
                        {knights && (
                          <ShopTile
                            name={t({ message: "Wall", context: "a city wall piece" })}
                            left={myStatus.hasMine ? myStatus.wallsLeft : null}
                            have={me?.hand}
                            cost={COST.wall}
                            selected={effMode === "wall"}
                            disabled={!canWall}
                            note={buildWhy("wall", canWall, {
                              pieces: null,
                              cost: COST.wall,
                              legal: view.legal?.walls?.length ?? 0,
                            })}
                            // One unwalled city is not a choice; two are. See
                            // lib/reachability `wallShopIntent`: sending the
                            // command bare would let the engine's board-order
                            // fallback pick the city.
                            onClick={() => {
                              if (mode === "wall") {
                                setMode("none");
                                return;
                              }
                              const intent = wallShopIntent(view.legal);
                              if (intent.kind === "build") send("build_wall", { v: intent.v });
                              else if (intent.kind === "select") setMode("wall");
                            }}
                            art={<ShopArt slot="build_wall" thumbs={thumbs} />}
                          />
                        )}
                        {/* Fish, on the shelf with the other things a turn can
                          buy: five priced actions, priced in fish. Present
                          whenever the game has fish, so the shelf does not
                          change shape mid-game and the 2-to-7 ladder is visible
                          before you can pay. Absent in rulesets without the
                          scenario.

                          `canBuild`, not `canAct`: every command behind this tile
                          (spend_fish, give_boot) goes through the engine's
                          RequireActionableTurn, which includes the roll. canAct
                          exists for Road Building's pre-roll free build (see
                          canPlaceFree). */}
                        {/* Raiders: the deck and the gold counter, two different
                          things a turn can spend.

                          Riders cost no resources; buying a card is how you
                          raise one (Muster is over half the deck). The card is
                          revealed and resolved on purchase, so the prompt that
                          follows is the card resolving.

                          `canBuild`, not `canAct`, as for the fish tile. */}
                        {hasRaiders && (
                          <ShopTile
                            name={t({
                              message: "Muster",
                              context: "shelf tile: buy a Raiders card",
                            })}
                            cost={COST.dev}
                            have={me?.hand}
                            // Lit while a card is resolving, not for every
                            // Raiders prompt (a landing tie or the 7's steal has
                            // nothing to do with the deck).
                            selected={
                              raidersAskedSeat === actorSeat &&
                              (raidersRoleNow === "raiders_muster" ||
                                raidersRoleNow === "raiders_swift" ||
                                raidersRoleNow === "raiders_treason" ||
                                raidersRoleNow === "raiders_intrigue")
                            }
                            disabled={!canBuild || !canBuyRaiders}
                            // Riders still off the board, in the corner where
                            // piece tiles count their supply.
                            left={myRiders.left}
                            note={
                              myRiders.left === 0
                                ? t`All six of your riders are on the board.`
                                : !canBuild || !canBuyRaiders
                                  ? // The same reason every other dark tile gives
                                    // (not your turn, roll first, the cards you
                                    // are short).
                                    (buildWhy("dev", canBuild && canBuyRaiders, {
                                      pieces: null,
                                      cost: COST.dev,
                                      legal: 1,
                                    }) ?? undefined)
                                  : t`The card is revealed and resolved at once. Nothing is held.`
                            }
                            onClick={() => send("raiders_buy_card")}
                            anchorRef={anchors.ref("shop:raiders")}
                            art={
                              // Contained at 4/5 and centred: `cover` cropped
                              // the card back's top on the phone tile.
                              <CardFace
                                slot="devcard_back"
                                className="h-4/5 w-4/5 object-contain"
                              />
                            }
                          />
                        )}
                        {hasRaiders && (
                          <ShopTile
                            name={t({
                              message: "Gold",
                              context: "shelf tile: spend Raiders gold",
                            })}
                            selected={raidersGold}
                            disabled={!canSpend}
                            badge={
                              myRaidersGold > 0 ? (
                                <span className="font-num tabular-nums">{myRaidersGold}</span>
                              ) : undefined
                            }
                            recipe={
                              <span className="text-[10px] font-bold leading-tight">
                                <Trans>2 gold buys a resource</Trans>
                              </span>
                            }
                            srHint={t`Spend gold: 2 for a resource`}
                            note={
                              myRaidersGold === 0
                                ? t`No gold yet. It comes from battles, from Treason, and from selling resources.`
                                : undefined
                            }
                            onClick={() => setRaidersGold((o) => !o)}
                            art={<ShopArt slot="scenario_gold" thumbs={thumbs} />}
                          />
                        )}
                        {hasRaiders && raidersMoves.length > 0 && (
                          <ShopTile
                            name={t({
                              message: "Riders",
                              context: "shelf tile: move your Raiders riders",
                            })}
                            selected={raidersRiders || !!riderFrom}
                            disabled={!canSpend}
                            badge={
                              <span className="font-num tabular-nums">{raidersMoves.length}</span>
                            }
                            recipe={
                              <span className="text-[10px] font-bold leading-tight">
                                <Trans>Move: 3 paths, 5 for a wheat</Trans>
                              </span>
                            }
                            srHint={t`Move your riders: 3 paths, or 5 for a wheat`}
                            note={
                              myPrisoners > 0
                                ? t`Prisoners held: ${myPrisoners}. Two are worth a point; one is worth nothing.`
                                : undefined
                            }
                            onClick={() => {
                              setRiderFrom(null);
                              setRaidersRiders((o) => !o);
                            }}
                            art={<ShopArt slot="scenario_rider" thumbs={thumbs} />}
                          />
                        )}
                        {/* Explorers' two board buys: a harbour settlement
                          upgrades one of your coastal settlements (2 VP, and the
                          only shipyard), and a cargo ship goes on a sea edge
                          beside one. Both arm a board mode; the pieces that go
                          into a hold (settlers, crews) are bought in the fleet
                          panel, where the hold is chosen. */}
                        {isExplorers(view) && (
                          <ShopTile
                            name={t({
                              message: "Harbour Settle\u00ADment",
                              context: "a building that upgrades a settlement (Explorers)",
                            })}
                            cost={EXPLORERS_COSTS.harbour}
                            art={<ShopArt slot="build_harbour" thumbs={thumbs} />}
                            selected={effMode === "harbour"}
                            left={explorersExt(view)?.seats?.[actorSeat]?.harbours_left ?? null}
                            disabled={
                              !canBuild ||
                              !affords(EXPLORERS_COSTS.harbour) ||
                              (view.legal?.harbours?.length ?? 0) === 0
                            }
                            note={buildWhy(
                              "harbour",
                              canBuild &&
                                affords(EXPLORERS_COSTS.harbour) &&
                                (view.legal?.harbours?.length ?? 0) > 0,
                              {
                                pieces:
                                  explorersExt(view)?.seats?.[actorSeat]?.harbours_left ?? null,
                                cost: EXPLORERS_COSTS.harbour,
                                legal: view.legal?.harbours?.length ?? 0,
                              },
                            )}
                            onClick={() => setMode(mode === "harbour" ? "none" : "harbour")}
                          />
                        )}
                        {isExplorers(view) && (
                          <ShopTile
                            name={t({
                              message: "Cargo Ship",
                              context: "a ship piece (Explorers)",
                            })}
                            cost={EXPLORERS_COSTS.ship}
                            art={<ShopArt slot="build_cargoship" thumbs={thumbs} />}
                            selected={effMode === "cargoship"}
                            disabled={
                              !canBuild ||
                              !affords(EXPLORERS_COSTS.ship) ||
                              (view.legal?.ships?.length ?? 0) === 0
                            }
                            // No piece count: with the supply empty a ship on
                            // the board is replaced instead.
                            note={buildWhy(
                              "cargoship",
                              canBuild &&
                                affords(EXPLORERS_COSTS.ship) &&
                                (view.legal?.ships?.length ?? 0) > 0,
                              {
                                pieces: null,
                                cost: EXPLORERS_COSTS.ship,
                                legal: view.legal?.ships?.length ?? 0,
                              },
                            )}
                            onClick={() => {
                              if (mode === "cargoship") {
                                setMode("none");
                                return;
                              }
                              if ((explorersExt(view)?.seats?.[actorSeat]?.ships_left ?? 0) === 0)
                                setExplorersRecycling(true);
                              else {
                                setExplorersRecycle(0);
                                setMode("cargoship");
                              }
                            }}
                          />
                        )}
                        {/* Explorers: one tile for the fleet, present whenever the
                          game is an Explorers game, so the shelf does not change
                          shape mid-game.

                          `canBuild`, not `canAct`: every command behind it goes
                          through the module's actionable-turn gate, which
                          includes the roll. */}
                        {isExplorers(view) && (
                          <ShopTile
                            name={t({
                              message: "Fleet",
                              context: "shelf tile: ships and the Movement phase (Explorers)",
                            })}
                            selected={explorersPanel}
                            art={<ShopArt slot="build_cargoship" thumbs={thumbs} />}
                            disabled={!canTurnAction}
                            badge={
                              <span className="font-num tabular-nums">
                                {explorersShipsOf(view, actorSeat).length}
                              </span>
                            }
                            recipe={
                              <span className="text-[10px] font-bold leading-tight">
                                <Trans>Sail, explore, deliver</Trans>
                              </span>
                            }
                            srHint={t`Your ships, the missions, and the Movement phase`}
                            onClick={() => setExplorersPanel((o) => !o)}
                          />
                        )}
                        {wagonsExt(view)?.has_trade && (
                          <ShopTile
                            name={t`Wagon`}
                            selected={wagonPanel}
                            disabled={!canSpend || !wagonsExt(view)?.started}
                            badge={wagonRoleNow === "move" ? <span>!</span> : undefined}
                            note={
                              wagonRoleNow === "move"
                                ? t`Your wagon may move this turn. Ending the turn leaves it where it is.`
                                : undefined
                            }
                            onClick={() => setWagonPanel((open) => !open)}
                            art={<ShopArt slot="scenario_wagon" thumbs={thumbs} />}
                            recipe={
                              <span className="text-[10px] font-bold">
                                <Trans>Drive, upgrade, buy, sell</Trans>
                              </span>
                            }
                          />
                        )}
                        {/* Wagons: the upgrade is a purchase, so it is a priced
                          tile; driving stays in the panel. At the top level it
                          is out, not short. */}
                        {wagonsExt(view)?.has_trade && (
                          <ShopTile
                            name={t({
                              message: "Up\u00ADgrade",
                              context: "shelf tile: upgrade your wagon (Wagons)",
                            })}
                            cost={wagonUpgradeCost(view, actorSeat) ?? undefined}
                            have={me?.hand}
                            left={wagonUpgradeCost(view, actorSeat) ? null : 0}
                            showLeft={false}
                            disabled={
                              !canBuild ||
                              !wagonsExt(view)?.started ||
                              !canUpgradeWagon(view, actorSeat)
                            }
                            note={
                              !wagonUpgradeCost(view, actorSeat)
                                ? t`The wagon is at the top level.`
                                : wagonsExt(view)?.move_open
                                  ? t`Upgrade before the wagon starts moving.`
                                  : undefined
                            }
                            onClick={() => send("wagons_upgrade", {})}
                            art={<ShopArt slot="scenario_wagon" thumbs={thumbs} />}
                          />
                        )}
                        {hasFish && (
                          <ShopTile
                            name={t({
                              message: "Fish",
                              context: "shelf tile: spend fish (Fishermen)",
                            })}
                            selected={fishPanel || fishPending !== null}
                            disabled={!canSpend}
                            badge={
                              fishHeld > 0 ? (
                                <span className="font-num tabular-nums">{fishHeld}</span>
                              ) : undefined
                            }
                            recipe={
                              <span className="text-[10px] font-bold leading-tight">
                                {/* Derived from what the panel offers, never a
                                    fixed 2-to-7: under base+cak+fishermen the
                                    robber move is filtered before the first
                                    barbarian attack and the dev-card row is
                                    gone. */}
                                {fishRange.min === fishRange.max ? (
                                  <Trans>Spend fish: {fishRange.min}</Trans>
                                ) : (
                                  <Trans>
                                    Spend fish: {fishRange.min} to {fishRange.max}
                                  </Trans>
                                )}
                              </span>
                            }
                            srHint={
                              fishRange.min === fishRange.max
                                ? t`Spend fish: ${fishRange.min}`
                                : t`Spend fish: ${fishRange.min} to ${fishRange.max}`
                            }
                            note={
                              fishHeld === 0
                                ? t`No fish yet. They come from the lake and the fishing grounds.`
                                : undefined
                            }
                            onClick={() => {
                              setFishPending(null);
                              setFishPanel((o) => !o);
                            }}
                            art={<ShopArt slot="scenario_fish" thumbs={thumbs} />}
                          />
                        )}
                        {/* Coins, beside the fish: a priced action not paid in
                          resources. `canBuild`, not `canAct`, because both
                          trades go through RequireActionableTurn.

                          The badge is the player's coin count. Shown from zero,
                          since selling to the supply is how coins are earned. */}
                        {hasRivers && (
                          <ShopTile
                            name={t({
                              message: "Coins",
                              context: "shelf tile: trade coins (Rivers)",
                            })}
                            selected={coinPanel}
                            disabled={!canBuild}
                            badge={
                              myCoins > 0 ? (
                                <span className="font-num tabular-nums">{myCoins}</span>
                              ) : undefined
                            }
                            recipe={
                              <span className="text-[10px] font-bold leading-tight">
                                <Trans>Sell for coins, or buy with them</Trans>
                              </span>
                            }
                            srHint={t`Sell resources for coins, or buy a resource with coins`}
                            note={
                              myCoins === 0
                                ? t`No coins yet. Build along the river, or sell to the supply.`
                                : undefined
                            }
                            onClick={() => setCoinPanel((o) => !o)}
                            art={<ShopArt slot="scenario_coins" thumbs={thumbs} />}
                          />
                        )}
                        {/* One tile per track, in TRACK_ROW (display) order
                          (science, trade, politics), with `i` still the engine
                          track index, so level, cost, commodity, art,
                          affordability, the `legal.improvements` check and the
                          `improve_city {track}` sent all match the named track.
                          Gated on the ruleset so the tiles exist from the first
                          frame.

                          The Crane is played here too: armed, the row re-prices
                          to the discount and sends the card. */}
                        {knights &&
                          TRACK_ROW.map((i) => {
                            // Named `track`, not `t`: `t` is the message tag from
                            // useLingui, and shadowing it would un-translate the
                            // row.
                            const track = i18n._(TRACKS[i]);
                            const lvl = myKnights?.improve?.[i] ?? 0;
                            const com = COMMOD[TRACK_COMMOD[i]];
                            // The Crane's discount applies to the price shown as
                            // well as charged. `improvementCost` is what
                            // `craneTracks` filters on, so the number and the
                            // enabled state agree.
                            const cost = improvementCost(lvl, craneArmed);
                            const maxed = lvl >= 5;
                            const afford = (myComm?.[TRACK_COMMOD[i]] ?? 0) >= cost;
                            // Legality (own a city; a free city for a metropolis
                            // level) comes from the backend per viewer, so the
                            // tile gates on the engine's own rule.
                            const legal = view.legal?.improvements?.includes(i) ?? false;
                            // An armed Crane: `craneTracks` is the engine's
                            // structural set at the discounted price, i.e. this
                            // tile's own two tests at the card's price. It skips
                            // `canBuild` because the hand card that armed the
                            // Crane was already gated on being playable.
                            const dis = craneArmed
                              ? !craneLegalTracks.includes(i)
                              : !canBuild || maxed || !afford || !legal;
                            const metro = myKnights?.metropolis?.[i] ?? false;
                            // Why the tile is dark, for its popover; otherwise a
                            // refusal such as needing a metropolis-free city is
                            // invisible. improvementBlockReason does not mention
                            // whose turn it is, since the greying already says so.
                            const whyNot = dis ? improvementBlockReason(i, view, craneArmed) : null;
                            return (
                              <ShopTile
                                key={i}
                                // The tile has no words, so this is its whole
                                // accessible name and its popover heading: the
                                // track, where it stands, and (when armed) that
                                // the click spends a Crane. One whole sentence per
                                // case, since clause order and shape differ across
                                // languages.
                                //
                                // The track name leads every arm, before a colon,
                                // so no grammar governs it and one catalogue entry
                                // serves all.
                                name={
                                  craneArmed
                                    ? metro
                                      ? t`${track}: level ${lvl} of 5, metropolis. Upgrade with the Crane.`
                                      : t`${track}: level ${lvl} of 5. Upgrade with the Crane.`
                                    : maxed
                                      ? metro
                                        ? t`${track}: level ${lvl} of 5, metropolis`
                                        : t`${track}: level ${lvl} of 5`
                                      : metro
                                        ? t`${track}: level ${lvl} of 5, metropolis. Upgrade.`
                                        : t`${track}: level ${lvl} of 5. Upgrade.`
                                }
                                // The tile shows only the track name; the level is
                                // the pip row.
                                label={track}
                                disabled={dis}
                                // The armed row is a one-of-three pick, so every
                                // tile still available is lit. A track the Crane
                                // cannot buy stays unlit and disabled.
                                selected={craneArmed && !dis}
                                note={whyNot ?? (maxed ? undefined : nextImprovementReward(i, lvl))}
                                onClick={() => {
                                  if (craneArmed) {
                                    send("play_progress", { card: "crane", track: i });
                                    setProgressCard(null);
                                    return;
                                  }
                                  send("improve_city", { track: i });
                                }}
                                // Overhangs the tile's top-right corner (where a
                                // piece tile's count sits). The chevron appears on
                                // exactly the button's enabled condition. A track
                                // holding the metropolis shows that instead.
                                badge={
                                  metro ? <MetropolisMark /> : dis ? undefined : <UpgradeChevron />
                                }
                                art={
                                  /* Layers rather than a column in the 44x64 box:
                                   the prop full-bleed down to the pips, the
                                   five-pip level on the floor, and the badge
                                   outside the box. As a column the prop would
                                   shrink to a smudge; layered it gives up only
                                   the pip row's 9px. */
                                  <span className="relative block h-full w-full">
                                    <span className="absolute inset-0 flex items-center justify-center">
                                      <ShopArt slot={IMPROVE_SLOT[i]} thumbs={thumbs} />
                                    </span>
                                  </span>
                                }
                                // The level, under the art and never greyed, so
                                // it reads even when the track cannot be bought.
                                strip={
                                  <TrackPips
                                    level={lvl}
                                    metropolis={metro}
                                    color={com.ink}
                                    size="tile"
                                  />
                                }
                                // The next level's price, in the same grouped-icon
                                // row as every other tile, underlined when short.
                                price={
                                  maxed ? null : cost === 0 ? (
                                    <span data-free>
                                      <Trans context="this build costs nothing">Free</Trans>
                                    </span>
                                  ) : (
                                    <span
                                      className="hud-cc hud-ic"
                                      data-short={afford ? undefined : "true"}
                                    >
                                      <ResIcon slot={comIconSlot(TRACK_COMMOD[i])} size={15} />
                                      {cost > 1 && <sub>{cost}</sub>}
                                    </span>
                                  )
                                }
                                recipe={
                                  maxed ? (
                                    <span className="text-[10.5px] font-extrabold text-green-ink leading-none">
                                      {myKnights?.metropolis?.[i] ? (
                                        <Trans context="this track holds the metropolis">
                                          Metropolis
                                        </Trans>
                                      ) : (
                                        <Trans context="this track is fully upgraded">
                                          Max level
                                        </Trans>
                                      )}
                                    </span>
                                  ) : cost === 0 ? (
                                    // A Crane on a track's first level makes it
                                    // free. A card with no number would read as
                                    // "one paper" (`countMode="multi"` hides a
                                    // 1), so say FREE, as other free builds do.
                                    <span className="text-[10.5px] font-extrabold text-green-ink leading-none">
                                      <Trans context="this build costs nothing">Free</Trans>
                                    </span>
                                  ) : (
                                    // Commodities get the same recipe-card treatment as resources.
                                    <ResCard
                                      color={com.color}
                                      name={com.name}
                                      slot={comIconSlot(TRACK_COMMOD[i])}
                                      count={cost}
                                      countMode="multi"
                                    />
                                  )
                                }
                              />
                            );
                          })}
                      </div>

                      {/* Cards in hand: every development card you hold, shown as
              soon as you get it (including ones bought this turn, locked until
              next turn, and the Victory Point card), plus Knights progress
              cards. Each is tappable only when it can be played now. */}
                      {([0, 1, 2, 3, 4].some(
                        (i) => (me?.dev_cards?.[i] ?? 0) + (me?.new_dev_cards?.[i] ?? 0) > 0,
                      ) ||
                        (myKnights?.progress?.length ?? 0) > 0) && (
                        <>
                          <div className="w-0.5 h-16 bg-line rounded-full shrink-0 squat:w-full squat:h-0.5" />
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap shrink-0 squat:w-full squat:shrink squat:flex-wrap squat:justify-center">
                            {(
                              [
                                { i: 0, act: () => send("play_dev_card", { card: 0 }) },
                                { i: 1, act: null },
                                { i: 2, act: () => send("play_dev_card", { card: 2 }) },
                                { i: 3, act: () => setPicker("yop") },
                                { i: 4, act: () => setPicker("mono") },
                              ] as { i: number; act: (() => void) | null }[]
                            ).map(({ i, act }) => {
                              const id = DEV_CARD_IDS[i];
                              const label = devCardName(id);
                              const ready = me?.dev_cards?.[i] ?? 0; // playable now (on your turn)
                              const locked = me?.new_dev_cards?.[i] ?? 0; // bought this turn, playable next
                              const total = ready + locked;
                              if (total === 0) return null;
                              // The Victory Point card is held, not played: it
                              // scores from the hand all game, so it gets its own
                              // look and sentence rather than a disabled state.
                              const held = id === DEV_HELD_ID;
                              // The rest need an unspent dev-card play this turn
                              // and at least one unlocked copy.
                              const playable = act != null && canPlayDev && ready > 0;
                              // Why it is dim, as for the progress cards below: a
                              // hard gate that disables, and a soft warning that
                              // does not, since a card with no legal effect still
                              // burns if the player spends it.
                              const reason =
                                held || playable
                                  ? null
                                  : devPlayableReason(id, view, { ready, locked });
                              const warn = playable ? devEffectWarning(id, view) : null;
                              // Two of the same card are two cards: drawn at its
                              // depth and keeping its number, as resource piles do.
                              const pile = handStack(total);
                              const split = ready > 0 && locked > 0;
                              const showCount = total > 1 || split;
                              // The stack is a picture; a screen reader gets the
                              // number in the tile's name.
                              const named = total > 1 ? t`${label}, ${total}` : label;
                              return (
                                <Tip
                                  key={`dev${i}`}
                                  title={label}
                                  hint={
                                    <>
                                      {devCardHint(id)}
                                      {held && (
                                        <span className="mt-1 block font-extrabold text-green-ink">
                                          <Trans>Already scoring, nothing to play.</Trans>
                                        </span>
                                      )}
                                      {reason && (
                                        <span className="mt-1 block font-extrabold text-foreground">
                                          <Trans>Can't play: {reason}</Trans>
                                        </span>
                                      )}
                                      {warn && (
                                        <span className="mt-1 block font-extrabold text-red-ink">
                                          ⚠ {warn}
                                        </span>
                                      )}
                                      {ready > 0 && locked > 0 && (
                                        <span className="mt-1 block text-muted">
                                          {/* Both counts carry their own ICU
                                              plural: a bare number beside a
                                              noun cannot be translated. */}
                                          {t`${plural(ready, {
                                            one: "# card playable now",
                                            other: "# cards playable now",
                                          })}, ${plural(locked, {
                                            one: "# bought this turn.",
                                            other: "# bought this turn.",
                                          })}`}
                                        </span>
                                      )}
                                    </>
                                  }
                                >
                                  {/* A wrapper span and `aria-disabled` rather than
                                `disabled`: Chrome drops pointer events on a disabled
                                control, which would hide the tooltip explaining it
                                (see ShopTile). */}
                                  {/* `--cw` is the tile's own width, which the backs
                                are placed against; the width below is the whole
                                pile, so a deep one pushes later tiles along. Both
                                match the button's `w-11 sm:w-[68px]`.

                                `justify-end` puts the face at the pile's right
                                edge with the backs fanning left, like a resource
                                pile on the same shelf. */}
                                  <span
                                    className="relative inline-flex justify-end shrink-0 [--cw:44px] sm:[--cw:68px] squat:[--cw:44px]"
                                    style={{ width: `calc(var(--cw) * ${pile.width})` }}
                                    tabIndex={-1}
                                  >
                                    {/* Outside the button: the tile clips its
                                  contents, so backs drawn inside would be cut off
                                  at the edge they peek past. */}
                                    <StackBacks
                                      layers={pile.behind}
                                      // The development deck's back, so a
                                      // pile reads as cards of this deck, as
                                      // a resource pile does in its colour.
                                      color="var(--card-back)"
                                      className={cn(
                                        "hud-card-back",
                                        !held && !playable && "grayscale",
                                      )}
                                    />
                                    <button
                                      type="button"
                                      {...handTap}
                                      aria-disabled={!playable}
                                      aria-label={
                                        reason
                                          ? t`${named}, can't play: ${reason}`
                                          : warn
                                            ? t`${named}, warning: ${warn}`
                                            : named
                                      }
                                      // Without hover, the first press reads
                                      // the card and the second plays it. A dim
                                      // card opens the sheet too, which shows
                                      // the reason.
                                      onClick={
                                        noHover
                                          ? () =>
                                              setCardSheet({
                                                slot: playedCardSlot("dev", id),
                                                title: label,
                                                text: devCardHint(id),
                                                note: held
                                                  ? t`This card is never played. It already counts toward your score.`
                                                  : reason,
                                                warn,
                                                action:
                                                  act && !held
                                                    ? {
                                                        label: t({
                                                          message: "Play",
                                                          context: "play this card now",
                                                        }),
                                                        onAct: act,
                                                      }
                                                    : undefined,
                                                onClose: () => setCardSheet(null),
                                              })
                                          : playable
                                            ? act
                                            : undefined
                                      }
                                      className={cn(
                                        "hud-card-frame relative w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px] overflow-hidden bg-panel flex items-center justify-center transition-transform",
                                        // A victory point card is never played,
                                        // so it is marked as kept (its keyline
                                        // drawn in green, `data-held` in
                                        // pb-hud.css) rather than lifted.
                                        held
                                          ? "cursor-default"
                                          : playable
                                            ? "hud-lift cursor-pointer"
                                            : "grayscale cursor-default",
                                      )}
                                      data-held={held ? "true" : undefined}
                                    >
                                      {/* Fills the tile: the art is 256x358
                                    (0.715) against a 0.6875 tile, so `cover`
                                    crops ~4% off each side and keeps the title
                                    band along the bottom. As for the progress-card
                                    tile below.

                                    `block h-full w-full`, not `absolute
                                    inset-0`: an untitled slot renders CardFace's
                                    `relative` wrapper, and Tailwind emits
                                    `.relative` after `.absolute`, so the latter
                                    would lose. The tile has no padding and the
                                    wrapper fills it. */}
                                      <CardFace slot={devSlot(i)} className="block h-full w-full" />
                                      {/* The badge never sums ready + locked: one
                                    playable Knight plus one bought this turn
                                    would read "2" on a tile playable once. Split
                                    when they differ, which the stack cannot
                                    draw. */}
                                      {showCount && (
                                        <span className="hud-badge absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] sm:text-[11px] font-extrabold tabular-nums leading-none">
                                          {split ? `${ready}+${locked}` : total}
                                        </span>
                                      )}
                                      {warn && (
                                        <span
                                          aria-hidden
                                          className="absolute top-0.5 left-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full border-2 border-border bg-red text-main-foreground text-[8px] leading-none"
                                        >
                                          !
                                        </span>
                                      )}
                                    </button>
                                  </span>
                                </Tip>
                              );
                            })}
                            {myKnights?.progress?.map((card, i, all) => {
                              const stackProgress = all.length >= 3;
                              // Pre-roll only Alchemist is legal; the rest need the
                              // roll (engine ErrMustRoll). A board-targeting card
                              // also needs the server to offer a target, or arming
                              // it would highlight nothing (e.g. Medicine with too
                              // little ore).
                              //
                              // A card the table can see would do nothing is dim
                              // too: the engine refuses it (ErrCardNoEffect).
                              const playable =
                                canAct &&
                                progressPlayableNow(card, !!view.rolled) &&
                                progressHasBoardTargets(card, view.legal) &&
                                progressNoEffectReason(card, view) === null;
                              // Why it is dim ("you haven't rolled", "no target",
                              // "not your turn").
                              const reason = playable ? null : progressPlayableReason(card, view);
                              // Deck of origin, as a stripe along the card's top
                              // edge in that deck's commodity colour (cloth / coin
                              // / papyrus); nothing else on the card says whether
                              // it came from Trade, Politics or Science.
                              const deck = progressDeckLook(card);
                              return (
                                <Tip
                                  key={`${card}${i}`}
                                  title={progressCardName(card)}
                                  hint={
                                    <>
                                      {progressCardHint(card)}
                                      {reason && (
                                        <span className="mt-1 block font-extrabold text-foreground">
                                          <Trans>Can't play: {reason}</Trans>
                                        </span>
                                      )}
                                    </>
                                  }
                                >
                                  <button
                                    type="button"
                                    {...handTap}
                                    aria-disabled={!playable}
                                    aria-label={((named: string) =>
                                      reason ? t`${named}, can't play: ${reason}` : named)(
                                      progressCardName(card),
                                    )}
                                    onClick={
                                      noHover
                                        ? () =>
                                            setCardSheet({
                                              slot: playedCardSlot("progress", card),
                                              title: progressCardName(card),
                                              text: progressCardHint(card) ?? undefined,
                                              note: reason,
                                              action: {
                                                label: t({
                                                  message: "Play",
                                                  context: "play this card now",
                                                }),
                                                onAct: () =>
                                                  playProgress(card, progressInput(card)),
                                              },
                                              onClose: () => setCardSheet(null),
                                            })
                                        : playable
                                          ? () => playProgress(card, progressInput(card))
                                          : undefined
                                    }
                                    className={cn(
                                      // `isolate` keeps the deck band's z-index
                                      // inside its card, so a stacked
                                      // neighbour's band cannot draw over the
                                      // lifted (z-index 5) card.
                                      "hud-card-frame relative isolate overflow-hidden w-11 h-[64px] sm:w-[68px] sm:h-[96px] squat:w-11 squat:h-[64px] flex items-center justify-center text-center bg-panel text-[9px] sm:text-[10px] font-extrabold leading-[1.05] transition-transform",
                                      playable ? "hud-lift cursor-pointer" : "cursor-default",
                                      // A long progress hand stacks: from the
                                      // third card on, each tucks under the one
                                      // before, leaving its deck band and the
                                      // left of its face showing, so five cards
                                      // take the width of three. Pointer or
                                      // focus lifts a card to the front
                                      // (hud-lift). Not on a sideways phone,
                                      // whose column wraps.
                                      stackProgress &&
                                        i > 0 &&
                                        "-ml-[22px] sm:-ml-[28px] squat:ml-0",
                                    )}
                                  >
                                    {/* The deck band sits above the face and is
                                  never greyed: an unplayable card still shows
                                  its deck. */}
                                    {deck && (
                                      <span
                                        role="img"
                                        aria-label={deck.aria}
                                        className="hud-deck-band"
                                        style={{ background: deck.color }}
                                      />
                                    )}
                                    {/* The baked face, blank until it loads; the
                                  card's name is the button's label and tip.

                                  Fills the tile via `block h-full w-full` on
                                  CardFace's wrapper; see the dev-card tile above
                                  for why not `absolute inset-0`. */}
                                    <CardFace
                                      slot={progressSlot(card)}
                                      className={cn(
                                        "block h-full w-full",
                                        !playable && "grayscale",
                                      )}
                                    />
                                  </button>
                                </Tip>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </ScrollFade>

                {/* Dice + End turn are a sibling of this shelf, at the end of
                this row, from lg. Below that the row is the shelf alone. */}
              </div>
            )}
            {/* The dice and End turn at the end of the hand row: the thumb's
              corner, a fixed spot, and as a laid-out sibling they cannot sit on
              the cards. From lg only; below it they take a line each in the dock
              (DiceRow, EndTurnPill) and the shelf gets the whole row. See
              `turnControlsPlacement`. */}
            {turnPlace === "corner" && (
              <TurnControls
                className="pointer-events-auto shrink-0"
                wide={smUp}
                row={squat}
                dice={diceNode}
                canRoll={canRoll}
                onRoll={() => send("roll_dice")}
                canEnd={!!canEnd}
                onEnd={endTurn}
                showEnd={seated}
              />
            )}
          </div>
        </HudCluster>

        {/* Bottom-right: the feed's island, sitting on top of the bottom row. Up
            while its orb in the top-right row is lit; see `feedOpen`.

            Only where the window has room in both axes; otherwise it becomes a
            dock panel. See `feedAsIsland` and lib/hudChrome.

            `bottom` is the row's measured height, so the feed follows the
            shelf as it grows; the cluster's bottom padding is the gap. The
            feed sits directly above the controls at the row's right end.

            The column's top belongs to the bank's card, so the feed's room is
            capped below it. Expressed as a percentage of the HUD layer (the
            viewport) rather than a viewport unit, so the UI zoom past 1700px
            cannot make the calc's terms disagree. See lib/hudChrome.

            Only once the top row has been measured: `topRowH` is 0 on the
            first frame, which would draw the cluster up through the orbs. */}
        {feedAsIsland && feedPane && (
          <HudCluster
            at="bottom-right"
            className="flex flex-col items-end gap-2"
            // A cap, not a height: the island is content-sized up to its pane
            // cap (TableFeed), and this stops it at the bank's card on a window
            // too short for both.
            style={{
              ...(bottomRowH ? { bottom: bottomRowH } : null),
              maxHeight: `calc(100% - ${feedHeightReserve(topRowH, bottomRowH, bankCardH)}px)`,
            }}
          >
            <TableFeed
              pane={feedPane}
              rootRef={anchors.ref("log")}
              logScroll={eventScroll}
              chatScroll={chatScroll}
              chatBar={<ChatBar onSend={(m) => gameSocket.chat(`game:${g}`, m)} />}
              log={logNodes}
              chat={chatNodes}
              onChatRead={onChatRead}
            />
          </HudCluster>
        )}
      </HudLayer>

      {/* The entry cover, over the board only. `z-0` paints it over the board
          layer and under the HUD (z-10), so the header, menus, chat and panels
          work while the board builds underneath. After the HUD in the DOM so
          Tab reaches the header first. Opaque, but the board is still laid
          out: Board3D reads its host box for framing. */}
      <BoardEntryCover ready={entry.ready} reduced={noMotion}>
        {entryScreen}
      </BoardEntryCover>

      {victimPrompt && (
        <StealPicker
          victims={victimPrompt.victims}
          seatName={seatName}
          colorOf={colorOf}
          cardsHeld={cardsHeld}
          onBack={backOutOfSteal}
          onPick={(v) => {
            if (victimPrompt.chase) {
              send("chase_robber", {
                v: victimPrompt.chase,
                hex: victimPrompt.hex,
                victim: v,
              });
              resetChase();
            } else
              send(victimPrompt.pirate ? "move_pirate" : "move_robber", {
                hex: victimPrompt.hex,
                victim: v,
              });
            setVictimPrompt(null);
          }}
        />
      )}

      {/* Monopoly. Cancel, backdrop dismiss and Escape all close it, since
          arming it is one tap beside four other cards, and it closes itself if
          the turn is lost while open (see the myTurnNow reset above). */}
      {picker === "mono" && (
        <Overlay title={t`Monopoly: take all of one resource`} onCancel={() => setPicker(null)}>
          {/* The card face, not its name: the same ResCard as the shelf, recipes
              and trade builder, so what you pick looks like what you get. */}
          <div className="flex gap-2 justify-center flex-wrap">
            {RES.map((r) => (
              <ResCard
                key={r.idx}
                color={r.color}
                name={r.name}
                slot={resIconSlot(r.idx)}
                size="lg"
                title={takeEveryCard(r.key)}
                onClick={() => {
                  send("play_dev_card", { card: 4, res: resName(r.idx) });
                  setPicker(null);
                }}
              />
            ))}
          </div>
          <HudButton kind="secondary" onClick={() => setPicker(null)}>
            <Trans>Cancel</Trans>
          </HudButton>
        </Overlay>
      )}

      {/* ---- Wagons: the wagon's turn ----------------------------------- */}

      {/* A sidebar rather than an overlay: the movement phase only holds the
          pass, so building, trading and playing cards stay open. It shows only
          for the seat whose phase it is, and closes when the wagon stops
          (halting, or entering a plaza).

          The barbarian half has no panel: while one is owed the board itself
          is the picker. */}
      {wagonsExt(view)?.started && canBuild && wagonPanel && (
        <WagonPanel
          onClose={() => setWagonPanel(false)}
          view={view}
          seat={actorSeat}
          onMove={() => {
            const arming = mode !== "wagonmove";
            setMode(arming ? "wagonmove" : "none");
            // On a phone the panel covers the intersections the player is about
            // to tap, so it steps aside; the prompt below carries the movement
            // left and the way back.
            if (arming && window.matchMedia?.("(max-width: 639px), (max-height: 499px)").matches)
              setWagonPanel(false);
          }}
          driving={effMode === "wagonmove"}
          onHalt={() => {
            setMode("none");
            send("wagons_halt", {});
          }}
          onBoost={() => send("wagons_boost", {})}
          onCharge={(barb) => send("wagons_charge", { barb })}
          onUpgrade={() => send("wagons_upgrade", {})}
          onBuy={(res) => send("wagons_buy", { res })}
          onSell={(res) => send("wagons_sell", { res })}
          onSwift={() => send("wagons_swift", {})}
        />
      )}

      {/* ---- Explorers: the fleet ------------------------------------- */}
      {explorersRecycling && canBuild && (
        <Overlay
          title={<Trans>Replace a cargo ship</Trans>}
          onCancel={() => setExplorersRecycling(false)}
        >
          <p className="max-w-sm text-sm">
            <Trans>
              All your ships are on the board. Choose one to return to supply, then choose where to
              build its replacement. Its cargo returns to supply too. Cost: 1 wood and 1 sheep.
            </Trans>
          </p>
          {explorersShipsOf(view, actorSeat).map((ship, i) => (
            <Button
              key={ship.id}
              variant="secondary"
              className="h-auto py-2"
              disabled={
                !(view.legal?.ships ?? []).some(
                  (e) =>
                    (explorersExt(view)?.ships ?? []).filter(
                      (other) => other.id !== ship.id && edgeKey(other.e) === edgeKey(e),
                    ).length < 2,
                )
              }
              onClick={() => {
                setExplorersRecycle(ship.id);
                setExplorersRecycling(false);
                setMode("cargoship");
              }}
            >
              {/* Numbered within the seat's own fleet, as the fleet panel does,
                  with its hold: the cargo is what is about to be lost and what
                  tells two hulls apart. */}
              <span className="flex flex-col items-center leading-tight">
                <Trans>Replace ship {i + 1}</Trans>
                <span className="text-xs font-normal">
                  <ShipHold ship={ship} />
                </span>
              </span>
            </Button>
          ))}
          <Button variant="quiet" onClick={() => setExplorersRecycling(false)}>
            <Trans>Cancel</Trans>
          </Button>
        </Overlay>
      )}
      {explorersPanel && canTurnAction && view.viewer >= 0 && (
        <ExplorersPanel
          view={view}
          seat={actorSeat}
          legal={view.legal}
          onArm={(m, ship, job) => {
            setExplorersShip(ship);
            setExplorersJob(job ?? null);
            // Armed modes send the player to the board, so the panel gets out of
            // the way of the hex they must tap.
            if (m) setExplorersPanel(false);
          }}
          onSend={(cmd, payload) => {
            send(cmd, payload ?? {});
          }}
          onClose={() => setExplorersPanel(false)}
        />
      )}

      {/* ---- Caravans: the camel vote ----------------------------------- */}

      {/* Both halves of the vote open by themselves: both are on a clock (20s to
          bid, 15s to place; see timings.ModuleCaps). Standing one down leaves the
          prompt below. */}
      {camelRoleNow === "bid" && camelStood !== "bid" && (
        <CamelBidPanel
          board={view.board}
          ext={caravans}
          buildings={view.buildings ?? []}
          colorOf={colorOf}
          hand={me?.hand ?? [0, 0, 0, 0, 0, 0]}
          paths={camelPathsNow}
          pending={camelPendingSeats}
          seatName={seatName}
          onBid={(cards, path) => {
            // `cards`, not `{wool, grain}`: the two piles are whatever the
            // ruleset bids in (brick and lumber alongside Knights), positional
            // against `ext.bid_resources`. `path` is the coalition mechanism:
            // seats naming the same placement pool their votes. Omitted, not
            // null, when the bidder named none, which the engine reads as no
            // coalition.
            send("bid_camel", path ? { cards, path } : { cards });
            setCamelStood(null);
          }}
          onClose={() => setCamelStood("bid")}
        />
      )}
      {camelRoleNow === "place" && camelStood !== "place" && (
        <CamelPlacePanel
          board={view.board}
          ext={caravans}
          buildings={view.buildings ?? []}
          colorOf={colorOf}
          paths={camelPathsNow}
          onPlace={(p) => {
            // The (caravan, edge) pair, always: one edge can extend two caravan
            // fronts, and the caravan decides which junctions become interior.
            send("place_camel", { caravan: p.caravan, e: p.e });
            setCamelStood(null);
          }}
          onClose={() => setCamelStood("place")}
        />
      )}
      {/* The way back to a stood-down vote panel. Same pill as the over-limit
          progress hand: the table is waiting on this seat. */}
      {camelRoleNow === "bid" && camelStood === "bid" && (
        <TargetPrompt
          action={{
            label: t({ id: "camel.reopen.bid", message: "Bid", context: "reopen the camel vote" }),
            onClick: () => setCamelStood(null),
          }}
        >
          <Trans id="camel.prompt.bid">It is your go to bid for the next camel.</Trans>
        </TargetPrompt>
      )}
      {camelRoleNow === "place" && camelStood === "place" && (
        <TargetPrompt
          action={{
            label: t({
              id: "camel.reopen.place",
              message: "Place",
              context: "reopen the camel placement picker",
            }),
            onClick: () => setCamelStood(null),
          }}
        >
          {camelOutcomeNow === "nobody" ? (
            <Trans id="camel.prompt.place.nobody">
              Nobody bid, so the camel is yours to place for ending the turn.
            </Trans>
          ) : camelOutcomeNow === "tie" ? (
            <Trans id="camel.prompt.place.tie">
              The vote was tied, so the camel is yours to place for ending the turn.
            </Trans>
          ) : (
            <Trans id="camel.prompt.place">You won the vote. The camel is yours to place.</Trans>
          )}
        </TargetPrompt>
      )}

      {/* ---- Rivers ------------------------------------------------------ */}
      {/*
        One panel for both trades, one decision: a coin is worth two resources
        out and four (or three, or two) in. Both resolve on the spot, so nothing
        here arms a board target.
      */}
      {coinPanel && (
        <RiverCoinsPanel
          trades={coinTradesNow}
          onSellGood={(good) => send("buy_coin", { good }, { keepMode: true })}
          onClose={() => setCoinPanel(false)}
          // The panel stays open after both, as `keepMode` does at the shelf:
          // selling is unlimited per turn and buying twice, so closing would
          // interrupt a trade in progress. Rows re-price from the next view,
          // and spend rows go dark when the cap runs out.
          onBuy={(idx) => send("buy_coin", { res: resName(idx) }, { keepMode: true })}
          onSpend={(idx) => send("spend_coins", { res: resName(idx) }, { keepMode: true })}
        />
      )}

      {/* ---- Fishermen ------------------------------------------------- */}

      {fishPanel && (
        <FishSpendPanel
          offers={fishSpends}
          mix={fishMix}
          riderHurry={fishCaps.hasRaiders}
          onClose={() => setFishPanel(false)}
          onGiveBoot={
            iHoldBoot && bootSeats.length > 0
              ? () => {
                  setFishPanel(false);
                  setBootPrompt(true);
                }
              : undefined
          }
          onSpend={(spend) => {
            setFishPanel(false);
            // The two that resolve on the spot go now; the rest arm a target
            // and are sent by the prompt or board press that answers it.
            // `remove_robber` takes the robber off the board, so it has no
            // target.
            if (spend === "dev_card") send("spend_fish", { use: "dev_card" });
            else if (spend === "remove_robber" || spend === "wagon_boost")
              send("spend_fish", { use: spend });
            else setFishPending(spend);
          }}
        />
      )}

      {/* Which resource the 4-fish spend takes: wood to ore only (the engine
          refuses anything outside the five). A resource the bank has run out
          of is dimmed rather than hidden. */}
      {fishPending === "take_resource" && voluntaryOpen && (
        <Overlay
          title={t({
            id: "fish.take.title",
            message: "Take a resource from the bank",
            context: "the 4-fish Fishermen spend",
          })}
          onCancel={() => setFishPending(null)}
        >
          <div className="flex gap-2 justify-center flex-wrap">
            {RES.map((r) => {
              const stock = view.bank?.[r.idx] ?? 0;
              return (
                <ResCard
                  key={r.idx}
                  color={r.color}
                  name={r.name}
                  slot={resIconSlot(r.idx)}
                  size="lg"
                  count={stock}
                  countMode="always"
                  dimmed={stock < 1}
                  onClick={() => {
                    if (stock < 1) return;
                    send("spend_fish", { use: "take_resource", res: resName(r.idx) });
                    setFishPending(null);
                  }}
                />
              );
            })}
          </div>
          <Button size="sm" variant="quiet" onClick={() => setFishPending(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </Overlay>
      )}

      {/* Who the 3-fish spend steals from. A seat with nothing to take is not a
          legal victim; under Knights commodities count, so a player holding
          only paper is a target. */}
      {fishPending === "steal" && voluntaryOpen && (
        <Overlay
          title={t({
            id: "fish.steal.title",
            message: "Steal a card: choose an opponent",
            context: "the 3-fish Fishermen spend",
          })}
          onCancel={() => setFishPending(null)}
        >
          {fishVictims.length === 0 && (
            <span className="text-xs text-muted text-center">
              <Trans id="fish.steal.none">No opponent is holding a card to steal.</Trans>
            </span>
          )}
          <SeatChoiceRow>
            {fishVictims.map((seat) => (
              <SeatChoice
                key={seat}
                seat={seat}
                name={seatName(seat)}
                color={colorOf(seat)}
                // Labelled, so the number reads as cards.
                detail={t`${plural(cardsHeld(seat), { one: "# card", other: "# cards" })}`}
                onSelect={() => {
                  send("spend_fish", { use: "steal", victim: seat });
                  setFishPending(null);
                }}
              />
            ))}
          </SeatChoiceRow>
          <Button size="sm" variant="quiet" onClick={() => setFishPending(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </Overlay>
      )}

      {/* Passing the old boot. The list uses public VP, which the engine
          compares (PublicVPWithModules); a hidden VP card would otherwise list
          seats the server refuses. */}
      {bootPrompt && (
        <Overlay
          title={t({
            id: "fish.boot.title",
            message: "Pass the old boot",
            context: "Fishermen: hand the old boot to another player",
          })}
          onCancel={() => setBootPrompt(false)}
        >
          <span className="text-xs text-muted text-center max-w-[280px]">
            <Trans id="fish.boot.rule">
              It may only go to a player doing at least as well as you. Its holder needs one extra
              point to win.
            </Trans>
          </span>
          {bootSeats.length === 0 && (
            <span className="text-xs text-muted text-center">
              <Trans id="fish.boot.none">Nobody is doing as well as you are. It stays.</Trans>
            </span>
          )}
          <SeatChoiceRow>
            {bootSeats.map((seat) => (
              <SeatChoice
                key={seat}
                seat={seat}
                name={seatName(seat)}
                color={colorOf(seat)}
                detail={((vp: number) => t`${vp} VP`)(publicVp(playerAt(seat)!))}
                onSelect={() => {
                  send("give_boot", { to: seat });
                  setBootPrompt(false);
                }}
              />
            ))}
          </SeatChoiceRow>
          <Button size="sm" variant="quiet" onClick={() => setBootPrompt(false)}>
            <Trans>Cancel</Trans>
          </Button>
        </Overlay>
      )}

      {/* Which deck the 7-fish draw takes, in a ruleset with no development
          deck. Drawn like the tied-defender draw (see the `defender_draws`
          overlay below): the track's prop on a card in its commodity colour,
          with the cards left as the corner count. */}
      {fishPending === "progress_card" && voluntaryOpen && (
        <Overlay
          title={t({
            id: "fish.progress.title",
            message: "Draw a progress card: choose a deck",
            context: "the 7-fish Fishermen spend, in a ruleset with no development deck",
          })}
          onCancel={() => setFishPending(null)}
        >
          <div className="flex gap-2 justify-center">
            {TRACK_ROW.map((i) => (
              <DeckChoiceTile
                key={i}
                track={i}
                left={knState?.decks?.[i] ?? 0}
                thumbs={thumbs}
                data-fish-progress-deck={i}
                onPick={() => {
                  send("spend_fish", { use: "progress_card", deck: i });
                  setFishPending(null);
                }}
              />
            ))}
          </div>
          <Button size="sm" variant="quiet" onClick={() => setFishPending(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </Overlay>
      )}

      {/* ---- Raiders --------------------------------------------------- */}

      {/* Treason names its whole plan in one message, so both picks are held
          and reviewed before sending; hence a planner instead of a board
          mode. */}
      {raidersRoleNow === "raiders_treason" && raidersStood !== "raiders_treason" && (
        <RaidersTreasonPanel
          board={view.board}
          ext={raiders}
          sources={treasonSources(view)}
          destinations={treasonDestinations(view)}
          count={treasonCount}
          card={raidersDock}
          onPlan={(moves: TreasonMove[]) => {
            send("raiders_treason", { moves });
            setRaidersStood(null);
          }}
          onClose={() => setRaidersStood("raiders_treason")}
        />
      )}

      {/* The 7. There is no robber, so nothing is moved or blocked: the active
          player takes one random card from a player of their choice. A seat
          holding nothing is not offered, and if nobody holds anything the
          answer is no victim at all. */}
      {/* Not over a discard this seat still owes: the engine refuses the steal
          until every discard is in. While other seats are discarding it opens
          with the choices dark and says why. */}
      {raidersRoleNow === "raiders_steal" &&
        raidersStood !== "raiders_steal" &&
        !raidersIDiscard && (
          <Overlay
            title={t({
              id: "raiders.steal.title",
              message: "Steal a card: choose an opponent",
              context: "the Raiders 7, which has no robber",
            })}
            onCancel={() => setRaidersStood("raiders_steal")}
          >
            <span className="text-xs text-muted text-center max-w-[280px]">
              <Trans id="raiders.steal.rule">
                One card at random. Nothing is moved and no hex is blocked: this scenario has no
                robber.
              </Trans>
            </span>
            {raidersVictims.length === 0 && (
              <span className="text-xs text-muted text-center">
                <Trans id="raiders.steal.none">No opponent is holding a card to steal.</Trans>
              </span>
            )}
            {raidersDiscardsOpen && (
              <span className="text-xs font-bold text-center" data-raiders-steal-waiting>
                <Trans id="raiders.steal.waiting">
                  Waiting for the other players to discard. Then choose.
                </Trans>
              </span>
            )}
            <SeatChoiceRow>
              {raidersVictims.map((seat) => (
                <SeatChoice
                  key={seat}
                  seat={seat}
                  name={seatName(seat)}
                  color={colorOf(seat)}
                  detail={t`${plural(cardsHeld(seat), { one: "# card", other: "# cards" })}`}
                  disabled={raidersDiscardsOpen}
                  onSelect={() => {
                    send("raiders_steal", { victim: seat });
                    setRaidersStood(null);
                  }}
                />
              ))}
            </SeatChoiceRow>
            {/* The empty table must still be answered or the turn never moves
              on; `victim: null` is the only shape the engine accepts then. */}
            {raidersVictims.length === 0 && (
              <Button
                size="sm"
                disabled={raidersDiscardsOpen}
                onClick={() => {
                  send("raiders_steal", { victim: null });
                  setRaidersStood(null);
                }}
              >
                <Trans id="raiders.steal.skip">Take nothing</Trans>
              </Button>
            )}
          </Overlay>
        )}

      {/* The way back into a stood-down forced panel. Same pill as the camel
          vote and the over-limit progress hand. */}
      {raidersPanelOpen && raidersStood === raidersPanelOpen && (
        <TargetPrompt
          card={raidersDock}
          action={{
            label: t({
              id: "raiders.reopen",
              message: "Answer",
              context: "reopen a Raiders decision that was stood down",
            }),
            onClick: () => setRaidersStood(null),
          }}
        >
          {raidersPanelOpen === "raiders_treason" ? (
            <Trans id="raiders.prompt.treason">Treason is yours to plan.</Trans>
          ) : (
            <Trans id="raiders.prompt.steal">
              You rolled a 7. Choose who to steal a card from.
            </Trans>
          )}
        </TargetPrompt>
      )}

      {/* The two board picks say what a tap will do: a lit hex under a landing
          means "the raider lands here", under an Intrigue "this one becomes
          your prisoner". */}
      {effMode === "raiderhex" && (
        <TargetPrompt card={raidersDock}>
          {raidersRoleNow === "raiders_intrigue" ? (
            <Trans id="raiders.prompt.intrigue">
              Intrigue: tap a hex to take one raider off it and add it to your prisoners.
            </Trans>
          ) : (
            (() => {
              // Name the number and the count; on larger boards the tie can be
              // three hexes.
              const n = landingNumber(view);
              const count = pendHexes(view).length;
              return n != null ? (
                <Trans id="raiders.prompt.landingNumber">
                  A raider is landing on a {n}. {count} coastal hexes show a {n} and hold equally
                  few raiders, so tap the one it lands on.
                </Trans>
              ) : (
                <Trans id="raiders.prompt.landing">
                  Two hexes carry that number and hold as few raiders as each other, so you choose
                  which one the raider lands on.
                </Trans>
              );
            })()
          )}
        </TargetPrompt>
      )}

      {effMode === "pirate" && explorersPirate && (
        <TargetPrompt>
          {pirateChoice && pirateChoice.turn === (view.turns_completed ?? 0) ? (
            <>
              <Trans id="explorers.prompt.pirateVictim">
                Two players have ships beside that hex. Whom does the pirate rob?
              </Trans>
              <div className="flex gap-2">
                {pirateChoice.victims.map((p) => (
                  <Button
                    key={p}
                    onClick={() => {
                      send("explorers_move_pirate", { h: pirateChoice.h, victim: p });
                      setPirateChoice(null);
                    }}
                  >
                    {seatName(p)}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <Trans id="explorers.prompt.pirate">
              You rolled a 7. Put your pirate ship on a highlighted sea hex: it steals a card from a
              player whose ship is beside it, and charges tribute to ships that sail past.
            </Trans>
          )}
        </TargetPrompt>
      )}

      {/* Explorers' fleet modes send the player to the board with the panel
          closed, so say which ship the lit edge or corner is for and how to
          stop. */}
      {effMode === "sail" && (
        <TargetPrompt
          onCancel={() => {
            setExplorersShip(null);
            setExplorersJob(null);
          }}
        >
          <Trans id="explorers.prompt.sail">
            Tap a lit edge to sail one step. The ship stays chosen until it runs out of movement or
            discovers a hex.
          </Trans>
        </TargetPrompt>
      )}
      {effMode === "shipact" && (
        <TargetPrompt
          onCancel={() => {
            setExplorersShip(null);
            setExplorersJob(null);
          }}
        >
          {explorersJob === "found" ? (
            <Trans id="explorers.prompt.found">
              Tap a lit intersection to land the settler there.
            </Trans>
          ) : explorersJob === "land_crew" ? (
            <Trans id="explorers.prompt.landCrew">
              Tap the lit intersection to put a crew ashore.
            </Trans>
          ) : explorersJob === "take_crew" ? (
            <Trans id="explorers.prompt.takeCrew">
              Tap the lit intersection to take a crew back aboard.
            </Trans>
          ) : (
            <Trans id="explorers.prompt.loadHaul">
              Tap the lit intersection to take the fish haul aboard.
            </Trans>
          )}
        </TargetPrompt>
      )}

      {/* Driving with the wagon panel put away (on a phone): what the lit spots
          mean, what is left to spend, and the way back to the panel. */}
      {effMode === "wagonmove" && !wagonPanel && (
        <TargetPrompt
          action={{
            label: t({ message: "Wagon", context: "reopen the wagon panel while driving" }),
            onClick: () => {
              setMode("none");
              setWagonPanel(true);
            },
          }}
        >
          <Trans id="wagons.prompt.drive">
            Tap a lit intersection to drive there. Movement left: {wagonMpLeft}.
          </Trans>
        </TargetPrompt>
      )}
      {effMode === "wagonbarbarian" && (
        <TargetPrompt>
          {wagonDestination ? (
            <span className="flex flex-col items-center gap-1.5 py-1 text-center">
              <Trans id="wagons.prompt.hex">
                That path borders two hexes. Choose which one the barbarian joins.
              </Trans>
              <div className="flex gap-2">
                {wagonDestination.hexes.map((hex) => (
                  <Button
                    key={hexKey(hex)}
                    onClick={() => {
                      send("wagons_barbarian", {
                        barb: wagonDestination.barb,
                        e: wagonDestination.e,
                        hex,
                      });
                      setWagonDestination(null);
                    }}
                  >
                    {hexLabel(
                      view.board.tiles.find((tile) => tile.hex.q === hex.q && tile.hex.r === hex.r),
                    )}
                  </Button>
                ))}
              </div>
            </span>
          ) : wagonBarbChoices.length > 1 ? (
            <span className="flex flex-col items-center gap-1.5 py-1 text-center">
              <Trans id="wagons.prompt.barbarianChoose">
                Choose which barbarian to move, then tap a highlighted empty path.
              </Trans>
              <div className="flex flex-wrap justify-center gap-2" data-wagons-barb-choice>
                {wagonBarbChoices.map((b) => (
                  <Button
                    key={b.id}
                    size="sm"
                    variant={b.id === wagonBarbMoving ? "primary" : "secondary"}
                    aria-pressed={b.id === wagonBarbMoving}
                    onClick={() => setWagonBarbPick(b.id)}
                  >
                    {/* Named by where it stands: the pieces are identical and
                        unnumbered. */}
                    {barbarianPlace(view, b.edge)}
                  </Button>
                ))}
              </div>
            </span>
          ) : (
            <Trans id="wagons.prompt.barbarian">
              Move the barbarian to a highlighted empty path.
            </Trans>
          )}
        </TargetPrompt>
      )}
      {effMode === "riderplace" && (
        <TargetPrompt
          card={raidersDock}
          action={
            // Only the Swift Rider is optional ("you MAY place one of your
            // riders"); the engine refuses a declined Muster.
            raidersRoleNow === "raiders_swift"
              ? {
                  label: t({
                    id: "raiders.decline",
                    message: "No thanks",
                    context: "decline the optional Raiders Swift Rider card",
                  }),
                  onClick: () => send("raiders_decline"),
                }
              : undefined
          }
        >
          {raidersRoleNow === "raiders_path" ? (
            <Trans id="raiders.prompt.path">
              Place the raider on a highlighted path of its hex.
            </Trans>
          ) : raidersRoleNow === "raiders_swift" ? (
            <Trans id="raiders.prompt.swift">
              Swift Rider: you may put one of your riders on any free path on the board.
            </Trans>
          ) : (
            <Trans id="raiders.prompt.muster">
              Muster: put one of your riders on a free path at the castle.
            </Trans>
          )}
        </TargetPrompt>
      )}

      {effMode === "ridermove" && riderFrom && (
        <TargetPrompt onCancel={() => setRiderFrom(null)}>
          {riderHurryByFish ? (
            <Trans id="raiders.prompt.riderMoveFish.tiles">
              Tap where that rider should end up. The paths beyond three cost two fish, paid for
              that one rider in whole tiles: a 3-fish tile is spent whole.
            </Trans>
          ) : (
            <Trans id="raiders.prompt.riderMove">
              Tap where that rider should end up. The paths beyond three cost one wheat, and the
              wheat is paid for that one rider.
            </Trans>
          )}
          {fishHurry && myGrain > 0 && (
            <button
              type="button"
              data-raiders-hurry-pay={riderPayFish ? "fish" : "grain"}
              className="ml-2 underline underline-offset-2 cursor-pointer"
              onClick={() => setRiderPayFish((v) => !v)}
            >
              {riderPayFish ? (
                <Trans id="raiders.prompt.payGrain">Pay with wheat instead</Trans>
              ) : (
                <Trans id="raiders.prompt.payFish">Pay with two fish instead</Trans>
              )}
            </button>
          )}
        </TargetPrompt>
      )}

      {/* A castle rider that must ride out. Not a forced mode: the engine
          refuses the pass, not the turn, so building and trading continue. It
          must be hard to miss, because the refusal only comes when ending the
          turn and does not name the rider. */}
      {ridersOwed.length > 0 && !raidersRiders && !riderFrom && voluntaryOpen && (
        <TargetPrompt
          action={{
            label: t({
              id: "raiders.riders.open",
              message: "Move",
              context: "open the Raiders rider panel",
            }),
            onClick: () => setRaidersRiders(true),
          }}
        >
          <Trans id="raiders.prompt.mustLeave">
            Your turn cannot end while a rider that could leave the castle is still standing there.
          </Trans>
        </TargetPrompt>
      )}

      {raidersRiders && (
        <RaidersRidersPanel
          moves={raidersMoves}
          grain={myGrain}
          fishHurry={fishHurry}
          onChoose={(from) => {
            setRaidersRiders(false);
            setRiderPayFish(false);
            setRiderFrom(from);
          }}
          onClose={() => setRaidersRiders(false)}
          gold={{
            gold: myRaidersGold,
            buysLeft: raidersBuysLeft,
            onOpen: () => {
              setRaidersRiders(false);
              setRaidersGold(true);
            },
          }}
          extra={raidersCoastNow && <RaidersCoast board={view.board} threat={raidersCoastNow} />}
        />
      )}

      {raidersGold && (
        <RaidersGoldPanel
          extra={raidersCoastNow && <RaidersCoast board={view.board} threat={raidersCoastNow} />}
          gold={myRaidersGold}
          buysLeft={raidersBuysLeft}
          buys={raidersGoldBuys}
          sells={raidersGoldSells}
          onBuy={(res) => {
            const name = raidersResourceName(res);
            if (name) send("raiders_buy_resource", { res: name });
          }}
          onSell={(res) => {
            const name = raidersResourceName(res);
            if (name) send("raiders_sell_for_gold", { res: name, count: 1 });
          }}
          onClose={() => setRaidersGold(false)}
        />
      )}

      {fishPending === "bridge" && effMode === "fishbridge" && (
        <TargetPrompt onCancel={() => setFishPending(null)}>
          <Trans id="fish.prompt.bridge">
            Tap a bridge site to build a bridge there for 6 fish. You still receive the bridge's
            coins.
          </Trans>
        </TargetPrompt>
      )}

      {fishPending === "free_road" && effMode === "fishedge" && (
        <TargetPrompt onCancel={() => setFishPending(null)}>
          {/* Under Islands the credit buys a ship too, and the engine accepts a
              ship edge, so the prompt offers both. */}
          {fishCaps.hasShips ? (
            <Trans id="fish.prompt.freeRoad.ships.placed">
              Tap where the road or ship should go. It is built there for 5 fish.
            </Trans>
          ) : (
            <Trans id="fish.prompt.freeRoad.placed">
              Tap where the road should go. It is built there for 5 fish.
            </Trans>
          )}
        </TargetPrompt>
      )}

      {picker === "yop" && (
        <YopPicker
          max={(i) => view.bank?.[i] ?? 0}
          onPick={(gain) => {
            send("play_dev_card", { card: 3, gain });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {/* The floating offers answer with game commands; see `entryHeld`. */}
      {view.active_offer && (
        <HeldActions>
          <ActiveOfferCard
            offer={view.active_offer}
            viewer={actorSeat}
            recipients={view.players.map((_, i) => i)}
            deadlineMs={view.offer_deadline_ms ?? null}
            seatName={seatName}
            colorOf={colorOf}
            onRespond={(accept) => cmd("respond_trade", { accept })}
            onRetract={() => cmd("respond_trade", { retract: true })}
            onExecute={(withSeat) => cmd("execute_trade", { with: withSeat })}
            onCancel={() => cmd("cancel_trade")}
          />
        </HeldActions>
      )}

      {/* An open draw offer, in the trade offer's floating slot. The two cannot
          both stand: either kind dies at the end of the turn, and a draw offer
          is answered in a click. */}
      {view.draw_offer && !view.active_offer && (
        <HeldActions>
          <DrawOfferCard
            offer={view.draw_offer}
            viewer={actorSeat}
            seatName={seatName}
            onRespond={(accept) => cmd("respond_draw", { accept })}
            onWithdraw={view.draw_offer.by === actorSeat ? () => cmd("cancel_draw") : undefined}
          />
        </HeldActions>
      )}

      {myGold > 0 && (
        <GoldPicker
          count={Math.min(myGold, bankTotal(view.bank))} // clamp to total stock
          max={(i) => view.bank?.[i] ?? 0} // clamp per-resource stock
          onPick={(gain) => cmd("choose_gold", { gain })}
        />
      )}

      {knightsGive > 0 && (
        <GiveCardsPicker
          count={knightsGive}
          // The Wedding is played on its owner's turn, so the seat on turn is the
          // one being paid.
          recipient={seatName(view.cur)}
          resMax={(i) => me?.hand?.[i] ?? 0}
          comMax={(i) => myComm?.[i] ?? 0}
          onPick={(cards, coms) => cmd("give_cards", { cards, coms })}
        />
      )}

      {knightsHarbor !== undefined && (
        <Overlay
          // Per resource rather than a name inserted into one sentence: "you
          // receive {res}" inflects its noun (German case; Spanish and Italian
          // article and gender).
          title={i18n._(HARBOR_RECEIVE[resIndexOf(knightsHarbor)] ?? HARBOR_RECEIVE_ANY)}
        >
          {/* Cards with counts: you are giving one away, so how many you hold
              matters. countMode "always" keeps a 0 visible on commodities you
              cannot give, so they read as empty. */}
          <div className="flex gap-2 justify-center">
            {COMMOD_ROW.map((c) => {
              const held = myComm?.[c.idx] ?? 0;
              return (
                <ResCard
                  key={c.idx}
                  color={c.color}
                  name={c.name}
                  slot={comIconSlot(c.idx)}
                  size="lg"
                  count={held}
                  countMode="always"
                  disabled={held < 1}
                  dimmed={held < 1}
                  title={held < 1 ? holdNoCards(c.key) : returnCard(c.key)}
                  onClick={() => cmd("harbor_give", { com: c.idx })}
                />
              );
            })}
          </div>
        </Overlay>
      )}

      {knightsAqueduct && (
        <Overlay
          title={
            aqueductEmpty
              ? t`Aqueduct: the bank is empty`
              : t`Aqueduct: take any 1 resource from the bank`
          }
        >
          {/* Why the card is offered: it opens unasked on someone else's roll,
              and the rule tells the player it will happen again. */}
          <p className="hud-dialog-note text-center max-w-sm self-center">
            <Trans>That roll paid you nothing, so your Aqueduct pays one card instead.</Trans>
          </p>
          <div className="flex gap-2 justify-center flex-wrap">
            {/* No stock counts: this is a pick-one. Stock only decides whether a
                resource can be taken at all (engine/knights decideAqueductPick
                refuses a pick it cannot cover), which the disabled state and
                its tip show. */}
            {RES.map((r) => {
              const canTake = aqueductCanTake(view.bank, r.idx);
              return (
                <ResCard
                  key={r.idx}
                  color={r.color}
                  name={r.name}
                  slot={resIconSlot(r.idx)}
                  size="lg"
                  disabled={!canTake}
                  dimmed={!canTake}
                  title={canTake ? takeCard(r.key) : bankOutOfCard(r.key)}
                  onClick={() => {
                    cmd("aqueduct_pick", { res: r.idx });
                  }}
                />
              );
            })}
          </div>
          {/* Below the row: with the bank empty every card is dead, so this is
              the only move left, not a sixth option. A plain button, since
              there is no card for "nothing". */}
          {aqueductEmpty && (
            <HudButton
              kind="secondary"
              onClick={() => {
                cmd("aqueduct_pick", { res: 0 });
              }}
            >
              <Trans>Take nothing</Trans>
            </HudButton>
          )}
        </Overlay>
      )}

      {/* Spy and the Master Merchant look below are the only prompts keyed to
          the viewer rather than a seat, so `actorSeat` (-1 once a bot has the
          seat) does not filter them on its own. The server withholds both from
          a bot-held seat; this is the second lock, for a stale frame. */}
      {actorSeat >= 0 && knState?.spy && (
        <Overlay
          title={((who: string) => t`Spy: take a card from ${who}`)(seatName(knState.spy.victim))}
        >
          <div className="flex gap-2 justify-center flex-wrap">
            {knState.spy.cards.map((card, i) => (
              <ProgressCardChoice
                key={`${card}${i}`}
                card={card}
                onSelect={(c) => cmd("spy_pick", { card: c })}
              />
            ))}
          </div>
        </Overlay>
      )}

      {tradingHouse && (
        <TradingHouse
          myComm={myComm}
          onClose={() => setTradingHouse(false)}
          onTrade={(give, out) => {
            cmd("trading_house", { give, ...out });
            setTradingHouse(false);
          }}
        />
      )}

      {masterMerchant && (
        <MasterMerchant
          players={view.players}
          viewer={view.viewer}
          seatName={seatName}
          colorOf={colorOf}
          commodityOf={(s) => knState?.players[s]?.commodity_count ?? 0}
          onClose={() => setMasterMerchant(false)}
          onChoose={(victim) => {
            cmd("play_progress", { card: "master_merchant", victim });
            setMasterMerchant(false);
          }}
        />
      )}

      {/* Master Merchant look: the server has revealed the victim's hand to us
          (resources via players[victim].hand, commodities via knState.players). Pick
          up to 2 actual cards and send master_merchant_pick. Gated on actorSeat
          as for the Spy overlay. */}
      {actorSeat >= 0 && knState?.master_merchant && (
        <MasterMerchantPick
          victim={knState.master_merchant.victim}
          victimHand={
            view.players.find((p) => p.seat === knState.master_merchant!.victim)?.hand ?? [
              0, 0, 0, 0, 0, 0,
            ]
          }
          victimComs={knState.players[knState.master_merchant.victim]?.commodities ?? [0, 0, 0]}
          seatName={seatName}
          onTake={(cards, coms) => cmd("master_merchant_pick", { cards, coms })}
        />
      )}

      {commercialHarbor && (
        <CommercialHarbor
          opponents={view.players
            .filter(
              (p) =>
                p.seat !== view.viewer && (knState?.players?.[p.seat]?.commodity_count ?? 0) > 0,
            )
            .map((p) => p.seat)}
          targetCount={harborTargetCount(view)}
          hand={me?.hand ?? [0, 0, 0, 0, 0, 0]}
          seatName={seatName}
          colorOf={colorOf}
          onAuto={() => {
            cmd("play_progress", { card: "commercial_harbor" });
            setCommercialHarbor(false);
          }}
          onConfirm={(gives) => {
            cmd("play_progress", { card: "commercial_harbor", gives });
            setCommercialHarbor(false);
          }}
          onClose={() => setCommercialHarbor(false)}
        />
      )}

      {progressCard === "deserter" && (
        <Overlay title={t`Deserter: choose an opponent`} onCancel={() => setProgressCard(null)}>
          {deserterSeats.length === 0 && (
            <span className="hud-dialog-note text-center">
              <Trans>No opponent has a knight to give up.</Trans>
            </span>
          )}
          <SeatChoiceRow>
            {/* Only opponents who own a knight are valid targets (the engine
                rejects the rest). */}
            {deserterSeats.map((seat) => {
              // The victim picks which knight to give up, so show their weakest
              // (what you can expect) and how many they field.
              const theirs = (deserterKnights?.knights ?? []).filter((k) => k.owner === seat);
              const weakest = Math.min(...theirs.map((k) => k.level));
              const fielded = theirs.length;
              return (
                <SeatChoice
                  key={seat}
                  seat={seat}
                  name={seatName(seat)}
                  color={colorOf(seat)}
                  detail={
                    <span className="flex flex-col items-center gap-0.5">
                      <span>{t`${plural(fielded, { one: "# knight", other: "# knights" })}`}</span>
                      <span>
                        {t({
                          message: `weakest: ${weakest}`,
                          context: "the lowest strength among an opponent's knights",
                        })}
                      </span>
                    </span>
                  }
                  title={((who: string) => t`${who} gives up a knight of their choice`)(
                    seatName(seat),
                  )}
                  onSelect={() => {
                    send("play_progress", { card: "deserter", victim: seat });
                    setProgressCard(null);
                  }}
                />
              );
            })}
          </SeatChoiceRow>
          <HudButton kind="secondary" onClick={() => setProgressCard(null)}>
            <Trans>Cancel</Trans>
          </HudButton>
        </Overlay>
      )}

      {diplomatFrom && effMode !== "diplomatto" && (
        // Escape and the backdrop cancel too: the dialog already offers a
        // Cancel, and the card is not spent until Remove or a destination.
        <Overlay title={t`Diplomat: your open road`} onCancel={resetDiplomat}>
          <div className="flex gap-2 justify-center flex-wrap">
            <HudButton
              kind="danger"
              onClick={() => {
                send("play_progress", { card: "diplomat", e: diplomatFrom });
                resetDiplomat();
              }}
            >
              <Trans context="take this road off the board">Remove</Trans>
            </HudButton>
            <HudButton kind="secondary" onClick={() => setMode("diplomatto")}>
              <Trans context="move this road to another edge">Relocate</Trans>
            </HudButton>
            <HudButton kind="secondary" onClick={resetDiplomat}>
              <Trans>Cancel</Trans>
            </HudButton>
          </div>
        </Overlay>
      )}

      {/* Road Building's outstanding free builds. No cancel: the roads are owed
          (the engine holds `FreeRoads` until placed or the turn ends). */}
      {canAct && owedFreeRoads > 0 && (
        <TargetPrompt>
          {islands ? (
            <Plural
              value={owedFreeRoads}
              one="Road Building: place # more free road or ship"
              other="Road Building: place # more free roads or ships"
            />
          ) : (
            <Plural
              value={owedFreeRoads}
              one="Road Building: place # more free road"
              other="Road Building: place # more free roads"
            />
          )}
        </TargetPrompt>
      )}

      {/* The robber move prompt. No cancel: a played Knight (or a rolled 7)
          makes the move mandatory. */}
      {robberMode !== "none" && effMode === robberMode && (
        <TargetPrompt>
          {robberMode === "pirate" ? (
            <Trans>Tap a sea hex to move the pirate</Trans>
          ) : (
            <Trans>Tap a land hex to move the robber, then pick who to rob</Trans>
          )}
        </TargetPrompt>
      )}

      {effMode === "diplomatto" && (
        <TargetPrompt onCancel={resetDiplomat}>
          <Trans>Diplomat: tap a highlighted spot to move your road there</Trans>
        </TargetPrompt>
      )}

      {/* The two "pick it up, then put it down" moves a piece's menu arms.
          Without text the second step is invisible (the turn chip still reads
          "Build / Trade"). Both are optional, so both can be cancelled. */}
      {effMode === "shipmove" && shipMoveFrom && (
        <TargetPrompt onCancel={resetMove}>
          <Trans>Move ship: tap a highlighted sea edge to sail it there</Trans>
        </TargetPrompt>
      )}

      {effMode === "knightmove" && knightMoveFrom && (
        <TargetPrompt onCancel={resetMove}>
          <Trans>Move knight: tap a highlighted spot to move it there</Trans>
        </TargetPrompt>
      )}

      {/* Other build modes need no prompt, since empty highlighted spots are
          self-explanatory. The wall's targets are your existing cities, so the
          highlights need a line of text to read as a question. */}
      {effMode === "wall" && (
        <TargetPrompt onCancel={() => setMode("none")}>
          <Trans>
            Tap the city to wall. A wall holds two extra cards and takes the first barbarian hit
          </Trans>
        </TargetPrompt>
      )}

      {effMode === "chaserobber" && (
        <TargetPrompt onCancel={resetChase}>
          <Trans>Chase: tap a land hex to push the robber</Trans>
        </TargetPrompt>
      )}

      {effMode === "chasepirate" && (
        <TargetPrompt onCancel={resetChase}>
          <Trans>Chase: tap a sea hex to push the pirate</Trans>
        </TargetPrompt>
      )}

      {knState && knState.deserter_victim >= 0 && knState.deserter_victim === actorSeat && (
        // No cancel: the Deserter's victim owes a knight and cannot decline.
        <TargetPrompt>
          {/* Named: the card is played on its owner's turn, so the seat on turn
              is the one taking the knight. */}
          {((who: string) =>
            t`${who} played the Deserter: tap one of your knights to surrender it`)(
            seatName(view.cur),
          )}
        </TargetPrompt>
      )}

      {(effMode === "inventor1" || effMode === "inventor2") && (
        <TargetPrompt
          onCancel={() => {
            setInventorA(null);
            setProgressCard(null);
            setMode("none");
          }}
        >
          {effMode === "inventor1" ? (
            <Trans>Inventor: tap the first number token to swap</Trans>
          ) : (
            <Trans>Inventor: tap the second number token to swap</Trans>
          )}
        </TargetPrompt>
      )}

      {effMode === "deserterplace" && (
        <TargetPrompt>
          {/* A column: the sentence, then the strengths under it, so the buttons
              do not squeeze the sentence off a phone screen. */}
          <span className="flex flex-col items-center gap-1.5 py-0.5 text-center">
            <Trans>
              Deserter: tap an intersection on your roads to place your strength {deserterLevel}{" "}
              replacement knight
            </Trans>
            {/* "The same strength or lower": the taker picks the tier. Shown
                only when there is more than one. */}
            {deserterOffer.length > 1 && (
              <span
                role="radiogroup"
                aria-label={t`Replacement knight strength`}
                className="flex gap-1"
              >
                {deserterOffer.map((lvl) => (
                  <HudButton
                    key={lvl}
                    role="radio"
                    aria-checked={lvl === deserterLevel}
                    // The chosen strength is the amber primary, the others glass
                    // secondary. A radio, so the fill is the selection.
                    kind={lvl === deserterLevel ? "primary" : "secondary"}
                    // 40px tall for a thumb, compact for a mouse.
                    className="h-7 px-2.5 text-[11px] pointer-coarse:min-h-10 pointer-coarse:px-3"
                    onClick={() => setDeserterPick(lvl)}
                  >
                    {((n: number) => t({ message: `Strength ${n}`, context: "knight tier" }))(lvl)}
                  </HudButton>
                ))}
              </span>
            )}
          </span>
        </TargetPrompt>
      )}

      {effMode === "relocateknight" && (
        <TargetPrompt>
          <Trans>
            Knight displaced. Tap an empty intersection along your routes to relocate it
          </Trans>
        </TargetPrompt>
      )}

      {/* No cancel: the barbarians take a city whether or not you choose one. */}
      {effMode === "barbariandowngrade" && (
        <TargetPrompt>
          <Trans>
            Barbarians broke through. Tap one of your cities to give up (it becomes a settlement)
          </Trans>
        </TargetPrompt>
      )}

      {/* Rivers alongside Knights: coins are the other answer to the debt
          above. Declining is not a command but tapping a city on the board, so
          this blocking `Overlay` can be stood down to reach the board. Only the
          seat that owes sees it, and it closes when the debt clears either way. */}
      {pillageBuyoutOpen && (
        <PillageBuyoutDialog
          coins={myCoins}
          afford={canAffordBuyout}
          cost={buyoutCost}
          onPay={() => cmd("pillage_buyout")}
          onStandDown={() => setBuyoutStood(buyoutAttack)}
        />
      )}

      {/* No cancel: the metropolis is already bought and has to stand somewhere. */}
      {effMode === "metropolispick" && <TargetPrompt>{i18n._(metropolisTrack)}</TargetPrompt>}

      {actorSeat >= 0 && knState?.defender_draws?.[0] === actorSeat && (
        <Overlay
          title={t`Tied for strongest defender: draw a progress card from a deck of your choice`}
        >
          {/* The three decks are the three city-upgrade tracks, drawn as the dock
              draws them: the track's prop (book, scales, crown) on a card in its
              commodity colour, with cards left as the corner count. In
              TRACK_ROW (display) order, with `i` the engine track index the
              command carries. */}
          <div className="flex gap-2 justify-center">
            {TRACK_ROW.map((i) => (
              <DeckChoiceTile
                key={i}
                track={i}
                left={knState.decks?.[i] ?? 0}
                thumbs={thumbs}
                onPick={() => cmd("defender_draw", { track: i })}
              />
            ))}
          </div>
        </Overlay>
      )}

      {/* Over the progress-card limit.

          The rules allow playing a card down to the limit instead of
          discarding: `decidePlayProgress` skips the over-limit check, and
          `blocksTurnActions` exempts the active player's own over-limit hand.
          The overlay covers the dock, so it can be stood down to reach the
          hand; that resolves nothing (the timer still owns it).

          Playing is only open on your own turn after the roll, and the usual
          way over the limit is a gate draw on someone else's roll. Standing
          down is not reversible while over the limit (and `blocks` holds
          end-turn for any over-limit seat), so `canPlayInstead` offers it only
          when a held card is playable right now, and the pill below brings the
          picker back. */}
      {knightsDiscardProgress && myKnights?.progress && !progressDiscardStood && (
        <Overlay
          title={t`Your progress hand is full`}
          onCancel={() => setProgressDiscardStood(true)}
        >
          <div className="hud-dialog-note text-center -mt-1">
            {canPlayInstead ? (
              <Trans>
                You may hold at most 4 progress cards. Discard one, or close this and play one
                instead, which counts just the same.
              </Trans>
            ) : (
              <Trans>
                You may hold at most 4 progress cards. Discard one. Playing a card counts too, but
                only on your own turn after the roll.
              </Trans>
            )}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {myKnights.progress.map((card, i) => (
              <ProgressCardChoice
                key={`${card}${i}`}
                card={card}
                onSelect={(c) => cmd("discard_progress", { card: c })}
              />
            ))}
          </div>
          {canPlayInstead && (
            <HudButton kind="secondary" onClick={() => setProgressDiscardStood(true)}>
              <Trans>Play a card instead</Trans>
            </HudButton>
          )}
          <span className="hud-dialog-note text-[11px] text-center">
            <Trans>The turn timer still resolves this for you if you do neither.</Trans>
          </span>
        </Overlay>
      )}

      {/* The way back. The stand-down only clears when the hand drops to four,
          so this pill returns to the discard picker, like every other owed
          action. */}
      {knightsDiscardProgress && myKnights?.progress && progressDiscardStood && (
        <TargetPrompt
          action={{
            label: t({ message: "Discard", context: "reopen the discard picker" }),
            onClick: () => setProgressDiscardStood(false),
          }}
        >
          <Trans>Your progress hand is over the limit.</Trans>
        </TargetPrompt>
      )}

      {/* Location-first action menu: clicking a board spot in inspect mode
          opens this with every legal action there (from view.legal in
          lib/locationActions). One-shot builds send immediately; move actions
          drop into the destination-pick flow. */}
      {/* What the pointer is resting on. Hidden while the action menu is open,
          since both anchor at the pointer and the menu is what was asked for.
          Only Board3D calls this back. */}
      {/* A card in hand, read before it is spent. Only on a pointer with no
          hover; see components/game/CardSheet. */}
      {cardSheet && <CardSheet {...cardSheet} />}
      {hoverInfo && !inspectAt && (
        <PieceInfoCard
          info={hoverInfo.info}
          at={hoverInfo.at}
          ownerName={
            hoverInfo.info.owner !== undefined ? seatName(hoverInfo.info.owner) : undefined
          }
          ownerColor={
            hoverInfo.info.owner !== undefined ? colorOf(hoverInfo.info.owner) : undefined
          }
        />
      )}

      {/* The location dial: the clicked spot's whole roster, in rank order,
          with what you cannot do greyed in place. Anchored at the click so the
          board stays readable around it. What a spot offers depends on the
          ruleset, the terrain and what stands there, so the ring's shape is a
          property of the spot, not the turn. */}
      {/* A hex commit, offered as the same one-entry menu a vertex gets. Built
          by the handler because a hex tap's meaning depends on the armed mode.
          See `hexOrAsk`. */}
      {pendingHex && (
        <LocationDial
          actions={[pendingHex.action]}
          at={pendingHex.at}
          thumbs={thumbs}
          onChoose={(a) => {
            // Clear first: the commit may open its own picker (a robber move
            // with two victims does), and this menu would be stale under it.
            const run = pendingHex.run;
            setPendingHex(null);
            if (a.status === "ready") run();
          }}
          onClose={() => setPendingHex(null)}
        />
      )}
      {inspectAt && dialActions.length > 0 && (
        <LocationDial
          actions={dialActions}
          at={inspectAt.at}
          thumbs={thumbs}
          onChoose={runAction}
          onClose={() => setInspectAt(null)}
        />
      )}

      {/* A host's table action, like Leave, so not held while the board loads
          (an `Overlay` holds its body otherwise; see `entryHeld`). */}
      {resetConfirm && (
        <CommandHoldContext value={false}>
          <Overlay title={t`Reset to lobby?`} onCancel={() => setResetConfirm(false)}>
            <div className="flex flex-col gap-3">
              <p className="hud-dialog-note text-center">
                <Trans>This ends the game for everyone and returns the table to the lobby.</Trans>
              </p>
              <div className="flex gap-2 justify-center">
                <HudButton
                  kind="danger"
                  onClick={() => {
                    void api.reset(g);
                    setResetConfirm(false);
                  }}
                >
                  <Trans context="send the table back to the lobby">Reset</Trans>
                </HudButton>
                <HudButton kind="secondary" onClick={() => setResetConfirm(false)}>
                  <Trans>Cancel</Trans>
                </HudButton>
              </div>
            </div>
          </Overlay>
        </CommandHoldContext>
      )}

      {progressCard && (effMode === "phex" || effMode === "pvertex" || effMode === "pedge") && (
        <TargetPrompt
          onCancel={() => {
            setProgressCard(null);
            setMode("none");
          }}
        >
          {progressCardPrompt(progressCard)}
        </TargetPrompt>
      )}

      {/* The armed Crane. The lit tiles say where to answer; this says what is
          being answered and how to cancel, and keeps the mode visible if the
          tiles scroll out of the dock. */}
      {craneArmed && voluntaryOpen && (
        <TargetPrompt onCancel={() => setProgressCard(null)}>
          <Trans>
            Crane: choose a city-improvement track to upgrade for one fewer commodity than normal.
          </Trans>
        </TargetPrompt>
      )}

      {progressOverlay && (
        <Overlay
          title={progressCardName(progressOverlay.card)}
          onCancel={() => setProgressOverlay(null)}
        >
          {/* Which card to name: Resource Monopoly (res), Trade Monopoly (com)
              and the Merchant Fleet (either). The Aqueduct's row: one
              flex-wrap line of `lg` ResCards, a tip naming what the pick does,
              the click sending the command.

              Unlike the Aqueduct, no counts (a pick-one) and no disabled
              state: the Aqueduct dims what the visible bank cannot cover,
              but a monopoly takes from opponents' redacted hands. */}
          {/* What the pick does, in the card's words: the tip is hover-only, so
              phones need this line (as the Master Merchant and Commercial
              Harbor dialogs have). */}
          {(progressOverlay.kind === "res" ||
            progressOverlay.kind === "com" ||
            progressOverlay.kind === "resorcom") &&
            progressCardHint(progressOverlay.card) && (
              <p className="hud-dialog-note max-w-[320px] self-center text-center">
                {progressCardHint(progressOverlay.card)}
              </p>
            )}
          {(progressOverlay.kind === "res" || progressOverlay.kind === "resorcom") && (
            <div className="flex gap-2 justify-center flex-wrap">
              {RES.map((r) => (
                <ResCard
                  key={`r${r.idx}`}
                  color={r.color}
                  name={r.name}
                  slot={resIconSlot(r.idx)}
                  size="lg"
                  title={nameCardTip(progressOverlay.card, r.key)}
                  onClick={() => {
                    cmd("play_progress", { card: progressOverlay.card, res: r.idx });
                    setProgressOverlay(null);
                  }}
                />
              ))}
              {/* The Fleet names one good of either kind, so its commodities
                  share the resources' row. */}
              {progressOverlay.kind === "resorcom" &&
                COMMOD_ROW.map((c) => (
                  <ResCard
                    key={`c${c.idx}`}
                    color={c.color}
                    name={c.name}
                    slot={comIconSlot(c.idx)}
                    size="lg"
                    title={nameCardTip(progressOverlay.card, c.key)}
                    onClick={() => {
                      cmd("play_progress", { card: progressOverlay.card, com: c.idx });
                      setProgressOverlay(null);
                    }}
                  />
                ))}
            </div>
          )}
          {progressOverlay.kind === "com" && (
            <div className="flex gap-2 justify-center flex-wrap">
              {COMMOD_ROW.map((c) => (
                <ResCard
                  key={`c${c.idx}`}
                  color={c.color}
                  name={c.name}
                  slot={comIconSlot(c.idx)}
                  size="lg"
                  title={nameCardTip(progressOverlay.card, c.key)}
                  onClick={() => {
                    cmd("play_progress", { card: progressOverlay.card, com: c.idx });
                    setProgressOverlay(null);
                  }}
                />
              ))}
            </div>
          )}
          {/* No `track` branch here: the Crane, the only card with that input,
              is answered at the dock's improvement tiles (see playProgress). */}
          {/* Spy is the only card with a bare "pick a victim" input, and the
              engine refuses a victim with an empty progress hand
              (engine/knights/progress_play.go, `case CardSpy`, ErrBadVictim).
              `progress_count` is public, so the legal set and hand sizes are
              known here. */}
          {progressOverlay.kind === "victim" && (
            <div className="flex flex-col gap-2 items-center">
              {victimSeats.length === 0 && (
                <span className="hud-dialog-note text-center">
                  <Trans>No opponent is holding a progress card.</Trans>
                </span>
              )}
              <SeatChoiceRow>
                {victimSeats.map((seat) => (
                  <SeatChoice
                    key={seat}
                    seat={seat}
                    name={seatName(seat)}
                    color={colorOf(seat)}
                    // The hand you would look through, the basis for choosing
                    // between legal victims.
                    detail={t`${plural(knState?.players?.[seat]?.progress_count ?? 0, {
                      one: "# card",
                      other: "# cards",
                    })}`}
                    title={((who: string) => t`Look at ${who}'s progress cards`)(seatName(seat))}
                    onSelect={() => {
                      cmd("play_progress", { card: progressOverlay.card, victim: seat });
                      setProgressOverlay(null);
                    }}
                  />
                ))}
              </SeatChoiceRow>
            </div>
          )}
          {progressOverlay.kind === "dice" && (
            <DicePicker
              onPick={(d1, d2) => {
                cmd("play_progress", { card: progressOverlay.card, d1, d2 });
                setProgressOverlay(null);
              }}
            />
          )}
          <HudButton kind="secondary" onClick={() => setProgressOverlay(null)}>
            <Trans>Cancel</Trans>
          </HudButton>
        </Overlay>
      )}

      {/* Confetti once on a win, for everyone celebrating: the winner and any
          spectator (viewer < 0 / null), not a player who lost.
          recycle=false emits once and stops; width/height default to the
          window. pointer-events none, above the overlay so it never blocks it. */}
      {/* Not under reduced motion. */}
      {finished &&
        pgWinner >= 0 &&
        !noMotion &&
        (viewerSeat == null || viewerSeat < 0 || viewerSeat === pgWinner) && (
          <Confetti
            recycle={false}
            numberOfPieces={450}
            tweenDuration={8000}
            style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none" }}
          />
        )}

      {/* Endgame: a solid overlay over the play area and hotbar (which stay
          rendered behind it from the final board view). Dismissible so the
          final board can be seen and screenshotted. */}
      {finished &&
        (summaryOpen ? (
          <div className="hud-root hud-dim fixed inset-0 z-50 flex items-start justify-center p-3 overflow-y-auto">
            {/* Marked as a modal so a screen reader does not announce the board
                behind it. */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="postgame-title"
              className="hud-dialog my-6 w-full max-w-[840px] rounded-[20px] p-6 max-sm:px-3 flex flex-col items-center gap-5"
            >
              <div className="flex flex-col items-center gap-1">
                <div
                  id="postgame-title"
                  className="font-display text-[26px] font-heavy text-center text-foreground"
                >
                  {/* No winner is a draw (agreed, or a claim with nobody ahead),
                      so say so rather than show an uncrowned scoreboard. */}
                  {pgWinner >= 0 ? (
                    ((who: string) => <Trans>{who} wins!</Trans>)(seatName(pgWinner))
                  ) : (
                    <Trans context="the game ended level">It's a draw</Trans>
                  )}
                </div>
                {/* How long it took, in rolls rather than turns (turns scale
                    with table size). The sum of the histogram below, so the two
                    agree; hidden if the game ended before anyone rolled. */}
                {pgRollCount > 0 && (
                  <div className="text-[13px] font-bold text-muted font-num tabular-nums">
                    <Trans>in {formatNumber(pgRollCount)} rolls</Trans>
                  </div>
                )}
              </div>
              <PostGameScoreboard
                players={pgRows}
                winner={pgWinner}
                caps={pgCaps}
                seatName={seatName}
                colorOf={colorOf}
                rolls={pgRolls}
                vpTrack={sock.postgame?.vp_track}
                targetVP={view?.config?.target_vp}
                diceMode={view?.config?.dice_mode}
              />
              <div className="flex flex-col items-center gap-2">
                {rematchNext ? (
                  <div className="text-[14px] font-bold text-muted">
                    <Trans>Starting rematch…</Trans>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 flex-wrap justify-center">
                      {/* The one amber action: Rematch is the filled button and
                          every other way out is quiet beside it. */}
                      <Button
                        onClick={() => {
                          if (!isHost) setVotedRematch((v) => !v);
                          gameSocket.requestRematch();
                        }}
                      >
                        {isHost ? (
                          <Trans>Rematch</Trans>
                        ) : votedRematch ? (
                          <Trans>Voted ✓</Trans>
                        ) : (
                          <Trans>Vote rematch</Trans>
                        )}
                      </Button>
                      {/* In the Activity you stay in the call's table; rematch or
                        view the board; exit by closing the Activity window. */}
                      {!inActivityMode() && (
                        <Button asChild variant="secondary">
                          <Link to="/play">
                            <Trans context="leave the finished table">Exit</Trans>
                          </Link>
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => setSummaryOpen(false)}>
                        <Trans>View board</Trans>
                      </Button>
                      {/* Watch it back. The replay is also linked from the
                          history list and match history; this puts it at the
                          moment the game ends.

                          Inside the Activity these website actions stay visible
                          with an explanation, but have no navigation target. */}
                      {g && (
                        <ActivitySafeLink>
                          {/* Carries `inv`: on a private table the replay
                              endpoint needs the same code the viewer used. */}
                          {/* New tab: the rematch vote, scoreboard and chat
                              live on this screen, and navigating away would
                              drop the socket the vote runs over. */}
                          <Link
                            {...buttonLook({ variant: "secondary" })}
                            to="/replay"
                            search={{ g, inv }}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Trans context="watch a replay of the game just finished">
                              Watch replay
                            </Trans>
                          </Link>
                        </ActivitySafeLink>
                      )}
                      {/* Check the dice, where doubts arise. The seeds are
                          released with the replay as soon as the game ends, so
                          the check is available now. New tab for the same
                          reason as the replay link. */}
                      {g && (
                        <ActivitySafeLink>
                          <Link
                            {...buttonLook({ variant: "secondary" })}
                            to="/verify"
                            search={{ g, inv }}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Trans context="check the finished game was not rigged">
                              Verify the dice
                            </Trans>
                          </Link>
                        </ActivitySafeLink>
                      )}
                    </div>
                    {pgRematch && (
                      <div className="text-[12px] font-bold text-muted">
                        {isHost && pgRematch.want > 0 ? (
                          <Trans>
                            {pgRematch.want}/{pgRematch.eligible} want a rematch, click Rematch to
                            start
                          </Trans>
                        ) : (
                          <Trans>
                            {pgRematch.want}/{pgRematch.eligible} want a rematch
                          </Trans>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null)}
    </div>
  );
  // The hold on the game's own controls while the board loads; see
  // `entryHeld`. Read by `HeldActions` and `Overlay`.
  return <CommandHoldContext value={entryHeld}>{screen}</CommandHoldContext>;
}

// MasterMerchant step 1: choose which higher-VP opponent to look at. Playing the
// card opens a server-side "look" that reveals that opponent's hand to us; the
// 2-card pick happens in MasterMerchantPick once the reveal arrives.
function MasterMerchant({
  players,
  viewer,
  seatName,
  colorOf,
  commodityOf,
  onClose,
  onChoose,
}: {
  players: PlayerView[];
  viewer: number;
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  commodityOf: (seat: number) => number;
  onClose: () => void;
  onChoose: (victim: number) => void;
}) {
  // Only opponents with strictly more public VP are valid: the engine compares
  // `PublicVPWithModules` on both sides (engine/knights/progress_play.go). Use
  // `public_vp`, not `p.vp`, which includes hidden VP cards on your own row
  // (game/views.go) and would drop opponents exactly one point ahead.
  const { t } = useLingui();
  const mine = players.find((p) => p.seat === viewer);
  const myVp = mine ? publicVp(mine) : 0;
  const victims = players.filter((p) => p.seat !== viewer && publicVp(p) > myVp);
  return (
    <Overlay title={t`Master Merchant: choose whose hand to look at`} onCancel={onClose}>
      <div className="flex flex-col gap-2 items-center">
        <span className="hud-dialog-note text-center">
          {victims.length > 0 ? (
            <Trans>
              Pick a player ahead of you in public victory points; you'll see their hand and take 2
              cards.
            </Trans>
          ) : (
            // Normally unreachable: the dock disables the card with nobody
            // ahead (progressNoEffectReason) and the engine refuses the play.
            // Kept so a stale view never draws an empty row.
            <Trans>
              Nobody is ahead of you in public victory points, so there is nobody to look at.
            </Trans>
          )}
        </span>
        <SeatChoiceRow>
          {victims.map((p) => (
            <SeatChoice
              key={p.seat}
              seat={p.seat}
              name={seatName(p.seat)}
              color={colorOf(p.seat)}
              // Two numbers decide this pick: how far ahead they are (why they
              // are a legal target) and how many cards there are to take.
              detail={((vp: number, cards: number) =>
                t`${vp} VP · ${plural(cards, { one: "# card", other: "# cards" })}`)(
                publicVp(p),
                p.hand_count + commodityOf(p.seat),
              )}
              title={((who: string) => t`Look at ${who}'s hand and take 2 cards`)(seatName(p.seat))}
              onSelect={onChoose}
            />
          ))}
        </SeatChoiceRow>
        <HudButton kind="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </HudButton>
      </div>
    </Overlay>
  );
}

// MasterMerchant step 2: the victim's hand is revealed, so pick up to 2 of their
// actual cards. Resources come from players[victim].hand, commodities from
// ext.cak.players[victim].commodities.
function MasterMerchantPick({
  victim,
  victimHand,
  victimComs,
  seatName,
  onTake,
}: {
  victim: number;
  victimHand: number[];
  victimComs: number[];
  seatName: (s: number) => string;
  onTake: (cards: number[], coms: number[]) => void;
}) {
  const { t } = useLingui();
  const [res, setRes] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [com, setCom] = React.useState<number[]>([0, 0, 0]);
  const total = res.reduce((a, b) => a + b, 0) + com.reduce((a, b) => a + b, 0);
  // The engine requires taking exactly min(2, victim's hand), not "up to 2".
  const victimTotal = victimHand.reduce((a, b) => a + b, 0) + victimComs.reduce((a, b) => a + b, 0);
  const need = Math.min(2, victimTotal);
  const victimName = seatName(victim);
  return (
    // The count carries its noun through an ICU plural: a bare number after
    // "take" reads as money in some languages.
    <Overlay
      title={t`Master Merchant: take ${plural(need, { one: "# card", other: "# cards" })} from ${victimName}`}
    >
      <div className="flex flex-col gap-2">
        {/* Cards, like every picker, with a second number: the revealed count
            of each the victim holds, in the footer pill, counting down as you
            take. The badge is what you have taken and gives one back on tap. */}
        <div className={HOLD_ROW}>
          {RES.map((r) => {
            const have = victimHand[r.idx] ?? 0;
            const took = res[r.idx];
            const canAdd = total < need && took < have;
            return (
              <ResCard
                key={`r${r.idx}`}
                color={r.color}
                name={r.name}
                slot={resIconSlot(r.idx)}
                size="lg"
                count={took}
                countMode="positive"
                // Dimmed, never disabled: the badge is inside this button.
                dimmed={!canAdd && took === 0}
                title={
                  have === 0
                    ? victimHoldsNoCards(r.key, victimName)
                    : canAdd
                      ? takeCard(r.key)
                      : took >= have
                        ? allTheirCards(r.key)
                        : t`You have taken all ${plural(need, {
                            one: "# card",
                            other: "# cards",
                          })}`
                }
                footer={<HoldPill n={have - took} />}
                onClick={() => {
                  if (!canAdd) return;
                  setRes((a) => a.map((n, i) => (i === r.idx ? n + 1 : n)));
                }}
                onBadgeClick={() =>
                  setRes((a) => a.map((n, i) => (i === r.idx && n > 0 ? n - 1 : n)))
                }
              />
            );
          })}
          {COMMOD_ROW.map((c) => {
            const have = victimComs[c.idx] ?? 0;
            const took = com[c.idx];
            const canAdd = total < need && took < have;
            return (
              <ResCard
                key={`c${c.idx}`}
                color={c.color}
                name={c.name}
                slot={comIconSlot(c.idx)}
                size="lg"
                count={took}
                countMode="positive"
                dimmed={!canAdd && took === 0}
                title={
                  have === 0
                    ? victimHoldsNoCards(c.key, victimName)
                    : canAdd
                      ? takeCard(c.key)
                      : took >= have
                        ? allTheirCards(c.key)
                        : t`You have taken all ${plural(need, {
                            one: "# card",
                            other: "# cards",
                          })}`
                }
                footer={<HoldPill n={have - took} />}
                onClick={() => {
                  if (!canAdd) return;
                  setCom((a) => a.map((n, i) => (i === c.idx ? n + 1 : n)));
                }}
                onBadgeClick={() =>
                  setCom((a) => a.map((n, i) => (i === c.idx && n > 0 ? n - 1 : n)))
                }
              />
            );
          })}
        </div>
        <div className="flex gap-2 justify-center">
          <HudButton
            kind="secondary"
            onClick={() => {
              setRes([0, 0, 0, 0, 0, 0]);
              setCom([0, 0, 0]);
            }}
          >
            <Trans context="empty the staged pick">Clear</Trans>
          </HudButton>
          <HudButton kind="primary" disabled={total !== need} onClick={() => onTake(res, com)}>
            <Trans>
              Take {total}/{need}
            </Trans>
          </HudButton>
        </div>
      </div>
    </Overlay>
  );
}

// CommercialHarbor: the active player (taker) chooses which resource they spend
// on each commodity-holding opponent, or skips that opponent; each one offered
// returns a commodity of their choice (the responder side is `harbor_give`).
// The default per opponent is the lowest-index resource held, matching the
// engine's auto-assignment, so confirming unchanged reproduces it. Only held
// resources are selectable. "Auto" sends no `gives` so the backend auto-picks.
function CommercialHarbor({
  opponents: holders,
  targetCount,
  hand,
  seatName,
  colorOf,
  onAuto,
  onConfirm,
  onClose,
}: {
  /** Every opponent holding a commodity, in seat order. All of them get a row. */
  opponents: number[];
  /**
   * How many of them this play could force: `harborTargetCount`, computed in
   * lib/reachability so this dialog and the dock's warning agree. A ceiling,
   * not a quota: it seeds which rows start offered, and any may be skipped.
   */
  targetCount: number;
  hand: number[];
  seatName: (s: number) => string;
  colorOf: (s: number) => string;
  onAuto: () => void;
  onConfirm: (gives: { player: number; res: number }[]) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const held = RES.filter((r) => hand[r.idx] > 0);
  const budget = hand.reduce((a, b) => a + b, 0);
  /**
   * Every commodity holder is a row, and each row may be skipped: the card
   * lets you offer each other player one resource, and skipping one you could
   * afford is a real play.
   *
   * `targetCount` sets the default: the first that many rows start with the
   * lowest held resource and the rest start skipped, matching Auto, so
   * confirming untouched reproduces the auto allocation.
   */
  const opponents = holders;
  const lowest = held[0]?.idx ?? 1;
  // Per-opponent chosen resource index; null means "make this seat no offer".
  const [pick, setPick] = React.useState<Record<number, number | null>>(() =>
    Object.fromEntries(holders.map((s, i) => [s, i < targetCount ? lowest : null])),
  );
  const chosen = (seat: number) => (seat in pick ? pick[seat] : null);
  const gives = opponents.filter((s) => chosen(s) !== null);
  // The active player must be able to pay the sum (each chosen resource <=
  // held), and the card may not be played to do nothing while a target is
  // affordable.
  const spent: Record<number, number> = {};
  for (const s of gives) {
    const r = chosen(s) as number;
    spent[r] = (spent[r] ?? 0) + 1;
  }
  const affordable =
    held.length > 0 &&
    gives.length > 0 &&
    RES.every((r) => (spent[r.idx] ?? 0) <= (hand[r.idx] ?? 0));
  return (
    <Overlay title={t`Commercial Harbor: choose what to spend on each opponent`} onCancel={onClose}>
      {/* Two dead ends share one panel: nobody holds a commodity, or you have
          nothing to offer. The dock disables the card for both
          (progressNoEffectReason) and the engine refuses the play
          (ErrCardNoEffect), so this only shows on a stale view. */}
      {opponents.length === 0 || held.length === 0 ? (
        <div className="flex flex-col gap-2 items-center">
          <span className="hud-dialog-note text-center">
            {holders.length === 0 ? (
              <Trans>No opponent holds a commodity to take.</Trans>
            ) : (
              // Holders exist but you have nothing to offer them: the play
              // would force nobody, and the engine refuses it.
              <Trans>You hold no resources to offer, so this would force nobody.</Trans>
            )}
          </span>
          <div className="flex gap-2">
            <HudButton kind="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </HudButton>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {budget < holders.length && (
            <span className="hud-dialog-note text-center">
              {/* No plural here: an untranslated msgstr falls back to the
                  English source, whose ICU plural has only `one`/`other` arms,
                  wrong in catalogues that use `few` and `many`
                  (scripts/po_verify.py flags this). */}
              {((all: number) =>
                t`Each offer costs one of your resources, so with a hand of ${budget} you can make at most ${budget} of these ${all} offers.`)(
                holders.length,
              )}
            </span>
          )}
          {opponents.map((s) => (
            <div key={s} className="flex items-center gap-2">
              {/* Seat colour as a swatch, not text colour: seat colours are
                  chosen for the board and can be unreadable as 12px type (amber
                  is 1.67:1 here). */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 border border-border"
                style={{ background: colorOf(s) }}
              />
              <span className="text-[13px] font-semibold w-24 truncate">{seatName(s)}</span>
              {/* Cards, matching the responder side of this card, which picks a
                  commodity as a ResCard.

                  No badge or count: a one-of-N choice. `selected` rings the
                  pick and the others dim. */}
              <div className="flex gap-1 flex-wrap items-center">
                {held.map((r) => (
                  <ResCard
                    key={r.idx}
                    color={r.color}
                    name={r.name}
                    slot={resIconSlot(r.idx)}
                    selected={chosen(s) === r.idx}
                    dimmed={chosen(s) !== r.idx}
                    title={spendCardOn(r.key, seatName(s))}
                    onClick={() => setPick((p) => ({ ...p, [s]: r.idx }))}
                  />
                ))}
                {/* Skipping is a choice the card grants, so it is a button on
                    the row, selected when this seat gets no offer. */}
                <HudButton
                  kind="secondary"
                  className="h-8 px-3 text-[12px]"
                  pressed={chosen(s) === null}
                  title={((who: string) => t`Make ${who} no offer`)(seatName(s))}
                  onClick={() => setPick((p) => ({ ...p, [s]: null }))}
                >
                  <Trans context="make this opponent no Commercial Harbor offer">Skip</Trans>
                </HudButton>
              </div>
            </div>
          ))}
          <div className="flex gap-2 justify-center pt-1">
            <HudButton
              kind="primary"
              disabled={!affordable}
              onClick={() => onConfirm(gives.map((s) => ({ player: s, res: chosen(s) as number })))}
            >
              <Trans>Confirm</Trans>
            </HudButton>
            <HudButton kind="secondary" onClick={onAuto}>
              <Trans context="let the game allocate for you">Auto</Trans>
            </HudButton>
            <HudButton kind="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </HudButton>
          </div>
        </div>
      )}
    </Overlay>
  );
}

function TradingHouse({
  myComm,
  onClose,
  onTrade,
}: {
  myComm: number[] | undefined;
  onClose: () => void;
  onTrade: (give: number, out: { get_res?: number } | { get_com?: number }) => void;
}) {
  const { t } = useLingui();
  // Give 2 of one commodity (you must hold 2); take any 1 resource or commodity.
  const [give, setGive] = React.useState<number | null>(null);
  const canGive = (c: number) => (myComm?.[c] ?? 0) >= 2;
  return (
    <Overlay title={t`Merchant Guild: give 2 of one commodity, take any 1`} onCancel={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="hud-lab">
            <Trans>Give 2 of one commodity</Trans>
          </span>
          {/* Cards on both halves, as in the Aqueduct's row.

              The give side uses the Aqueduct's disabled+dimmed pair and why-not
              tip, since what you may spend depends on what you hold. The count
              matters here (you must hold 2), and countMode "always" keeps a 0
              visible. `selected` shows the choice, which stays visible while
              the take row is answered. */}
          <div className="flex gap-2 justify-center">
            {COMMOD_ROW.map((c) => {
              const held = myComm?.[c.idx] ?? 0;
              return (
                <ResCard
                  key={c.idx}
                  color={c.color}
                  name={c.name}
                  slot={comIconSlot(c.idx)}
                  size="lg"
                  count={held}
                  countMode="always"
                  disabled={!canGive(c.idx)}
                  dimmed={!canGive(c.idx)}
                  selected={give === c.idx}
                  title={canGive(c.idx) ? giveTwoCards(c.key) : needTwoCards(c.key)}
                  onClick={() => setGive(c.idx)}
                />
              );
            })}
          </div>
        </div>
        {give !== null && (
          <div className="flex flex-col gap-1">
            <span className="hud-lab">
              <Trans>Take 1</Trans>
            </span>
            {/* No counts: this side comes from the bank. One-of-N, so no badge;
                the click is the commit. */}
            <div className="flex gap-2 justify-center flex-wrap">
              {RES.map((r) => (
                <ResCard
                  key={`r${r.idx}`}
                  color={r.color}
                  name={r.name}
                  slot={resIconSlot(r.idx)}
                  size="lg"
                  title={takeCard(r.key)}
                  onClick={() => onTrade(give, { get_res: r.idx })}
                />
              ))}
              {/* The output must differ from the spent commodity (the engine rejects the same). */}
              {COMMOD_ROW.filter((c) => c.idx !== give).map((c) => (
                <ResCard
                  key={`c${c.idx}`}
                  color={c.color}
                  name={c.name}
                  slot={comIconSlot(c.idx)}
                  size="lg"
                  title={takeCard(c.key)}
                  onClick={() => onTrade(give, { get_com: c.idx })}
                />
              ))}
            </div>
          </div>
        )}
        <HudButton kind="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </HudButton>
      </div>
    </Overlay>
  );
}

function GoldPicker({
  count,
  onPick,
  title,
  max,
}: {
  count: number;
  onPick: (gain: number[]) => void;
  title?: string;
  max?: (idx: number) => number;
}) {
  const { t } = useLingui();
  const [pick, setPick] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const total = pick.reduce((a, b) => a + b, 0);
  return (
    <Overlay
      title={title ?? t`Gold: pick ${plural(count, { one: "# resource", other: "# resources" })}`}
    >
      {/* Cards, like every other resource choice: the face adds and the count
          badge takes one back, as in the trade builder. */}
      {/* Why it opened: it arrives on any seat's roll, usually someone else's,
          so say what paid out. */}
      {!title && (
        <p className="hud-dialog-note text-center max-w-sm self-center">
          <Trans>
            A gold field you border produced. Gold pays in whichever resources you pick.
          </Trans>
        </p>
      )}
      <div className="flex gap-2 justify-center flex-wrap">
        {RES.map((r) => {
          const cap = max ? max(r.idx) : Infinity;
          const held = pick[r.idx];
          const canAdd = total < count && held < cap;
          return (
            <ResCard
              key={r.idx}
              color={r.color}
              name={r.name}
              slot={resIconSlot(r.idx)}
              size="lg"
              count={held}
              countMode="positive"
              // Never `disabled`: the badge lives inside the card's button and
              // Chrome drops pointer events on a disabled control, so a full
              // card could not be undone. Dim means "cannot add".
              dimmed={!canAdd && held === 0}
              title={
                cap === 0
                  ? bankOutOfCard(r.key)
                  : canAdd
                    ? takeCard(r.key)
                    : t`You have picked all ${plural(count, {
                        one: "# card",
                        other: "# cards",
                      })}`
              }
              onClick={() => {
                if (!canAdd) return;
                setPick((p) => p.map((n, i) => (i === r.idx ? n + 1 : n)));
              }}
              onBadgeClick={() =>
                setPick((p) => p.map((n, i) => (i === r.idx && n > 0 ? n - 1 : n)))
              }
            />
          );
        })}
      </div>
      <HudButton
        kind="primary"
        data-gold-take
        disabled={total !== count}
        onClick={() => onPick(pick)}
      >
        {/* The title holds the quota but does not change as you pick, so the
            button shows how far off you are, like the Master Merchant's
            confirm. */}
        <Trans>
          Take {total}/{count}
        </Trans>
      </HudButton>
    </Overlay>
  );
}

// GiveCardsPicker: Wedding "give N cards" (Knights). Unlike the gold picker it
// pays from resources and commodities, matching the engine's combined hand
// (engine decideGiveCards). The target is clamped to the total held, so a
// player holding fewer than `count` can still submit (the backend clamps give
// = min(owed, have)). Submit enables when the running total equals that
// target.
function GiveCardsPicker({
  count,
  recipient,
  resMax,
  comMax,
  onPick,
}: {
  count: number;
  /** Who the cards go to. */
  recipient: string;
  resMax: (idx: number) => number;
  comMax: (idx: number) => number;
  onPick: (cards: number[], coms: number[]) => void;
}) {
  const { t } = useLingui();
  const [res, setRes] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [coms, setComs] = React.useState<number[]>([0, 0, 0]);
  const held =
    RES.reduce((a, r) => a + resMax(r.idx), 0) + COMMOD.reduce((a, c) => a + comMax(c.idx), 0);
  const target = Math.min(count, held);
  const total = res.reduce((a, b) => a + b, 0) + coms.reduce((a, b) => a + b, 0);
  return (
    <Overlay
      title={t`Wedding: give ${plural(target, { one: "# card", other: "# cards" })} to ${recipient}`}
    >
      {/* Cards in both rows, as in the gold pick: the face adds and the badge
          takes exactly one back. */}
      <div className={HOLD_ROW}>
        {RES.map((r) => {
          const cap = resMax(r.idx);
          const held = res[r.idx];
          const canAdd = total < target && held < cap;
          return (
            <ResCard
              key={r.idx}
              color={r.color}
              name={r.name}
              slot={resIconSlot(r.idx)}
              size="lg"
              count={held}
              countMode="positive"
              dimmed={!canAdd && held === 0}
              // What you still hold of it, as the Master Merchant shows the
              // victim's: the badge is what you are giving, so the hand count
              // lives in the footer.
              footer={<HoldPill n={cap - held} />}
              title={
                cap === 0
                  ? holdNoCards(r.key)
                  : canAdd
                    ? giveCard(r.key)
                    : t`You have chosen all ${plural(target, { one: "# card", other: "# cards" })}`
              }
              onClick={() => {
                if (!canAdd) return;
                setRes((p) => p.map((n, i) => (i === r.idx ? n + 1 : n)));
              }}
              onBadgeClick={() =>
                setRes((p) => p.map((n, i) => (i === r.idx && n > 0 ? n - 1 : n)))
              }
            />
          );
        })}
      </div>
      <div className={HOLD_ROW}>
        {COMMOD_ROW.map((c) => {
          const cap = comMax(c.idx);
          const held = coms[c.idx];
          const canAdd = total < target && held < cap;
          return (
            <ResCard
              key={c.idx}
              color={c.color}
              name={c.name}
              slot={comIconSlot(c.idx)}
              size="lg"
              count={held}
              countMode="positive"
              dimmed={!canAdd && held === 0}
              footer={<HoldPill n={cap - held} />}
              title={
                cap === 0
                  ? holdNoCards(c.key)
                  : canAdd
                    ? giveCard(c.key)
                    : t`You have chosen all ${plural(target, { one: "# card", other: "# cards" })}`
              }
              onClick={() => {
                if (!canAdd) return;
                setComs((p) => p.map((n, i) => (i === c.idx ? n + 1 : n)));
              }}
              onBadgeClick={() =>
                setComs((p) => p.map((n, i) => (i === c.idx && n > 0 ? n - 1 : n)))
              }
            />
          );
        })}
      </div>
      <HudButton kind="primary" disabled={total !== target} onClick={() => onPick(res, coms)}>
        <Trans>
          Give {total}/{target}
        </Trans>
      </HudButton>
    </Overlay>
  );
}

const RES_NAMES = ["", "wood", "brick", "sheep", "wheat", "ore"];
function resName(idx: number) {
  return RES_NAMES[idx];
}

/** The deepest a target prompt may reach, as a fraction of the screen, and still be framed around. */
const PROMPT_RESERVE_MAX = 0.2;
/**
 * Below this height (a phone held sideways) the prompt is never framed around;
 * it sits under the turn banner instead (`TargetPrompt`), and the board keeps
 * what the dock leaves it. Matches the `lg` shape arm.
 */
const SHORT_SCREEN_PX = 600;
/** The prompt's one button: compact on a desktop, 40px tall on a phone either way up. */
const PROMPT_BUTTON = "h-7 px-3 text-[12px] max-sm:min-h-10 squat:min-h-10";
/**
 * Where a mounted TargetPrompt hands its element, so the board can frame below
 * it (see `promptFrac` in the game view, which owns `set` while it is mounted).
 * A module slot rather than a context because there is one game screen.
 */
const promptSlot: { set: ((el: HTMLElement | null) => void) | null } = { set: null };
const registerPrompt = (el: HTMLElement | null) => promptSlot.set?.(el);

/** The Raiders card behind each pending step that a card opens. */
const RAIDERS_CARD_OF_ROLE: Partial<Record<string, string>> = {
  raiders_muster: "muster",
  raiders_swift: "swift_rider",
  raiders_treason: "treason",
  raiders_intrigue: "intrigue",
};

/**
 * The "tap something on the board" prompt, with a way out.
 *
 * One component for every such prompt: the game is waiting on a pick, the
 * board shows where, and this says what and lets you back out. The way out is
 * the same quiet Cancel button as every other cancellable step; red would
 * read as an error, which a legal pick is not.
 */
function TargetPrompt({
  children,
  onCancel,
  action,
  card,
}: {
  children: React.ReactNode;
  onCancel?: () => void;
  /**
   * The card this step came from, at the head of the prompt (a Raiders card
   * just turned over: see CardRevealLayer). Pulls the text in from the left.
   */
  card?: React.ReactNode;
  /**
   * A button that takes the player somewhere, for a prompt that is not
   * cancellable but not inert either (the over-limit progress hand whose
   * picker was dismissed). `onCancel` would mean "you may decline", the
   * opposite.
   */
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useLingui();
  const button = action ?? (onCancel ? { label: t`Cancel`, onClick: onCancel } : null);
  return (
    <div
      ref={registerPrompt}
      data-hud-prompt
      className={cn(
        FLOATING_PROMPT,
        // `w-max`: a fixed box at `left-1/2` would shrink to the half of the
        // viewport right of its left edge, wrapping long prompts at half the
        // screen. A corner radius rather than `rounded-full`, so a wrapped
        // prompt reads as a card.
        "left-1/2 -translate-x-1/2 w-max max-w-[94vw] rounded-[20px] py-1.5 text-[12px] font-extrabold flex items-center gap-2",
        // Tighter on the button side so the pill hugs it; the text keeps its
        // full inset.
        card ? "pl-1.5" : button ? "pl-4" : "px-4",
        button ? "pr-1.5" : card ? "pr-4" : null,
        // Under the seat strip on a phone, measured (see `promptTopPx`).
        PROMPT_TOP,
        // A sideways phone has no band for it, so it stands over the seat
        // rail's column instead of the board's top row.
        SQUAT_PROMPT,
      )}
    >
      {card}
      <span>{children}</span>
      {button && (
        <HudButton
          kind="secondary"
          // 12px, the label floor, and a thumb's height on a phone either way
          // up.
          className={PROMPT_BUTTON}
          onClick={button.onClick}
        >
          {button.label}
        </HudButton>
      )}
    </div>
  );
}

function YopPicker({
  onPick,
  onClose,
  max,
}: {
  onPick: (gain: number[]) => void;
  onClose: () => void;
  max?: (idx: number) => number;
}) {
  const { t } = useLingui();
  const [pick, setPick] = React.useState<number[]>([0, 0, 0, 0, 0, 0]);
  const total = pick.reduce((a, b) => a + b, 0);
  return (
    <Overlay title={t`Year of Plenty: pick 2 resources`} onCancel={onClose}>
      {/* Same shape as the gold pick, the same question (take N resources from
          the bank): the face adds, the count badge takes one back. */}
      <div className="flex gap-2 justify-center flex-wrap">
        {RES.map((r) => {
          const held = pick[r.idx];
          const cap = max ? max(r.idx) : Infinity;
          const canAdd = total < 2 && held < cap;
          return (
            <ResCard
              key={r.idx}
              color={r.color}
              name={r.name}
              slot={resIconSlot(r.idx)}
              size="lg"
              count={held}
              countMode="positive"
              // Never `disabled` (see GoldPicker): the badge lives inside this
              // button, and Chrome drops pointer events on a disabled control.
              dimmed={!canAdd && held === 0}
              title={
                cap === 0
                  ? bankOutOfCard(r.key)
                  : canAdd
                    ? takeCard(r.key)
                    : t`You have picked both cards`
              }
              onClick={() => {
                if (!canAdd) return;
                setPick((p) => p.map((n, i) => (i === r.idx ? n + 1 : n)));
              }}
              onBadgeClick={() =>
                setPick((p) => p.map((n, i) => (i === r.idx && n > 0 ? n - 1 : n)))
              }
            />
          );
        })}
      </div>
      <div className="flex gap-2 justify-center">
        <HudButton kind="primary" disabled={total !== 2} onClick={() => onPick(pick)}>
          <Trans>Take {total}/2</Trans>
        </HudButton>
        <HudButton kind="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </HudButton>
      </div>
    </Overlay>
  );
}

/** The newest roll in a log, for dice that have not seen one arrive live. */
function lastRollInLog(
  events: readonly GameEvent[],
): { d1: number; d2: number; seq: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "dice_rolled") continue;
    const d = e.data as { d1?: number; d2?: number } | null;
    if (d && typeof d.d1 === "number" && typeof d.d2 === "number") {
      return { d1: d.d1, d2: d.d2, seq: e.seq };
    }
  }
  return undefined;
}

// Current turn's roll: white d1 + red d2, plus the Knights event die when present.
// `size` scales every die in the group (default 36px = the original dock size).
export function DiceDisplay({
  d1,
  d2,
  event,
  size = 36,
}: {
  d1: number;
  d2: number;
  event?: string;
  size?: number;
}) {
  return (
    // `die-tumble` (index.css) turns each die once as it lands, the second a
    // beat behind the first, so other seats' rolls catch the eye too.
    <span className="die-tumble flex items-center justify-center gap-1.5">
      <Die n={d1} variant="white" size={size} />
      <Die n={d2} variant="red" size={size} />
      {event && <EventDie face={event} size={size} />}
    </span>
  );
}

// onSend returns false when the client-side rate gate blocks the message; then
// the typed text is kept and Send is briefly disabled so the next message lands
// after the 1/sec window.
export function ChatBar({ onSend }: { onSend: (m: string) => boolean }) {
  const { t } = useLingui();
  const [v, setV] = React.useState("");
  const [cooling, setCooling] = useCooldown(CHAT_RATE_MS);
  function submit() {
    const msg = v.trim();
    if (!msg || cooling) return;
    if (onSend(msg)) {
      setV("");
      setCooling();
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex gap-1.5"
    >
      {/* min-w-0: a flex input otherwise will not shrink below its intrinsic
          size=20 width (~208px), pushing Send off the 260px side-panel card. */}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={t`Say something…`}
        maxLength={500}
        className="flex-1 min-w-0 bg-panel rounded-full px-3 py-1.5 text-[12px] focus:outline-none"
      />
      <Button type="submit" size="sm" tone="success" disabled={cooling}>
        <Trans context="send a chat message">Send</Trans>
      </Button>
    </form>
  );
}
