import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CrownSimple,
  Plus,
  X,
  Sparkle,
  Eye,
  Robot,
  DotsThreeVertical,
  Globe,
  LockSimple,
} from "@/lib/icons";
import { ProfileMenu, avatarColor } from "@/components/SiteHeader";
import { ActivitySafeLink } from "@/components/ActivitySafeLink";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { ExpansionShelf } from "@/components/lobby/ExpansionShelf";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { IconButton, iconButtonVariants } from "@/components/ui/iconButton";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DecoratedName, DecorationPreview } from "@/components/DecoratedName";
import { ChatText } from "@/components/game/ChatText";
import { LoadingScreen } from "@/components/LoadingScreen";
import { inActivityMode } from "@/lib/activity";
import { shouldEnterGame } from "@/lib/enterGame";
import { wasKickedFromLobby } from "@/lib/lobbyNav";
import { usePendingEdits, pick } from "@/lib/lobbyOptimistic";
import { Pill } from "@/components/ui/pill";
import { RatingBadge } from "@/components/RatingBadge";
import { Slider } from "@/components/ui/slider";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { ScrollFade } from "@/components/ui/scroll-fade";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, isFatalApiError, retryUnlessFatal, retryBackoffMs } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { rulesetCaps } from "@/lib/caps";
import { useAuth } from "@/lib/auth";
import { useAbandonGuard } from "@/components/AbandonGuard";
import { gameSocket, useGameSocket } from "@/lib/ws";
import { useRichPresence, type PresenceInput } from "@/lib/richPresence";
import { CHAT_RATE_MS } from "@/lib/gamestate";
import { useCooldown } from "@/lib/useCooldown";
import {
  assembleRuleset,
  dealsItsOwnMap,
  parseExpansions,
  defaultConfig,
  mapPlayers,
  recommendedVP,
  retargetVP,
  maxVP,
  recommendedBarbarianDistance,
  recommendedDiscardLimit,
  recommendedMap,
  mapSupportsIslands,
  mapNeedsShips,
  boardWithoutIslandsTerrain,
  islandsMapWarning,
  harbormasterMapWarning,
  type Expansions,
  MIN_PLAYERS,
  MAX_PLAYERS,
  playersChange,
  boardSeats,
} from "@/lib/format";
import { MapPreview } from "@/components/board/MapPreview";
import { preloadBoardModels } from "@/lib/board3d/loader";
import { warmSeatShots, warmFreeColorsWhenIdle } from "@/lib/board3d/shotCache";
import { SHOP_SET, ICON_SET } from "@/lib/board3d/shotSets";
import { supportsWebGL } from "@/lib/board3d/webgl";
import { preload as preloadSounds, GAME_SOUND_SLOTS } from "@/lib/sound";
import { GALLERY, type GalleryMap } from "@/lib/maps/gallery";
import { useFramedGallery } from "@/lib/maps/framed-gallery";
import { stashBuilderBoard, stashBuilderSource } from "@/lib/maps/handoff";
import { startIslandRule, type StartIsland } from "@/lib/maps/mainIsland";
import type { KnightsOptions, IslandsOptions, GameConfig, Seat, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  SWATCH_LOCKED_CHIP,
  SWATCH_LOCKED_WELL,
  SWATCH_PICKED,
  swatchEdge,
} from "@/components/swatchLook";
import { useToast, useToastInset } from "@/components/ui/toast";
import { tooSimilar } from "@/lib/color";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Display names for the server's turn-timer presets. The backend sends an
 * English `label` and does not localize, so the label is mapped to a message
 * here. Keyed by the server's label, the only stable identifier on the wire;
 * an unknown preset falls back to the server's word.
 */
const TURN_TIMER_LABELS: Record<string, MessageDescriptor> = {
  Relaxed: msg({ message: "Relaxed", context: "turn timer preset" }),
  Normal: msg({ message: "Normal", context: "turn timer preset" }),
  Blitz: msg({ message: "Blitz", context: "turn timer preset" }),
};

// A settings section's head: the small semibold label (`ui-label`), in the
// catalogue's sentence case.
const SectionLabel = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <div id={id} className="ui-label">
    {children}
  </div>
);

// A settings row's name: body type at body size, so the muted section heads
// read as structure and the rows as content.
const RowLabel = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <div id={id} className="text-[14px] font-medium text-foreground">
    {children}
  </div>
);

// The id of the label on the SettingRow a control sits in, so a switch there
// is named by the words beside it.
const RowLabelId = React.createContext<string | undefined>(undefined);

/** A Switch named by the SettingRow it sits in. */
function RowSwitch(props: React.ComponentProps<typeof Switch>) {
  const id = React.useContext(RowLabelId);
  return <Switch aria-labelledby={id} {...props} />;
}

// A single row in the settings panel: label on the left, control on the right.
//
// Translated labels can be much longer (`Turn timer` is `Temporizador de
// turno` in Spanish), and the Segmented or Stepper beside them is
// content-sized and should not be squeezed. So the row wraps: when the pair no
// longer fits, the control drops to its own line, still right-aligned
// (`ml-auto`, which `justify-between` cannot do for a lone wrapped item). The
// `shrink-0` wrapper stops the control giving up width before the label.
const SettingRow = ({
  label,
  title,
  children,
}: {
  label: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) => {
  const id = React.useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5" title={title}>
      <RowLabel id={id}>{label}</RowLabel>
      <div className="ml-auto shrink-0">
        <RowLabelId.Provider value={id}>{children}</RowLabelId.Provider>
      </div>
    </div>
  );
};

// Guests have no account, so their chosen name is remembered locally and
// reused across games (the server stores it only per seat).
const GUEST_NAME_KEY = "costan.guestName";

function boardShapeKey(b?: { tiles: { hex: { q: number; r: number }; res: string }[] }): string {
  if (!b) return "";
  return b.tiles
    .map((t) => `${t.hex.q},${t.hex.r}:${t.res}`)
    .sort()
    .join("|");
}
function matchGalleryMap(board?: GameConfig["board"]): GalleryMap | undefined {
  if (!board) return undefined;
  const key = boardShapeKey(board);
  return GALLERY.find((m) => boardShapeKey(m.board) === key);
}

// Max players slider. Radix's onValueChange fires on every pointer move, so
// track the live value locally for the thumb and badge and only patch on
// release (onValueCommit).
// `floor` is the lowest value the host may pick now (the seated count). It is
// enforced by clamping the dragged value, not by raising the slider's `min`,
// so the track stays 2..max and its mapping does not shift as players join.
function MaxPlayers({
  value,
  floor,
  min,
  max,
  disabled,
  onCommit,
}: {
  value: number;
  floor: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [live, setLive] = React.useState(value);
  React.useEffect(() => setLive(value), [value]);
  const clamp = (v: number) => Math.max(floor, v);
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center">
        <RowLabel>
          <Trans>Max players</Trans>
        </RowLabel>
        <div className="ml-auto min-w-7 text-center bg-elev2 text-foreground rounded-md px-1.5 py-0.5 font-num text-[12px] tabular-nums">
          {live}
        </div>
      </div>
      <Slider
        value={[live]}
        onValueChange={(v) => !disabled && setLive(clamp(v[0]))}
        onValueCommit={(v) => {
          if (disabled) return;
          onCommit(clamp(v[0]));
          // Back to the committed value: if the commit did not change it (the
          // map could not seat the count), this stops the thumb resting on an
          // unsaved number.
          setLive(value);
        }}
        min={min}
        max={max}
        step={1}
        thumbSize={18}
        disabled={disabled}
      />
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  // 28x28 drawn (the -my-0.5 keeps the row's height as it was at 24px);
  // still small for a thumb (WCAG 2.2 asks 24px, the
  // iOS HIG 44). The pseudo-element enlarges the hit area on touch pointers
  // only, without changing what is drawn; `-inset-2` reaches 36px, overlapping
  // the non-interactive value pill but never the other button. On a phone the
  // drawn button is 32px too (`max-sm`). The glyphs "−" and "+" are not names,
  // so the buttons get labels.
  const { t } = useLingui();
  const btn =
    "relative w-7 h-7 -my-0.5 max-sm:w-8 max-sm:h-8 max-sm:my-0 rounded-[8px] border border-transparent bg-secondary-background text-foreground text-[16px] max-sm:text-[17px] font-bold leading-none flex items-center justify-center cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']";
  return (
    <div className="flex items-center gap-1.5 max-sm:gap-2">
      <button
        data-pb-piece=""
        className={btn}
        aria-label={t({ message: "Decrease", context: "lobby number setting" })}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <div className="bg-elev2 text-foreground rounded-md w-8.5 py-0.5 max-sm:py-1 text-center font-num text-[13px] tabular-nums">
        {value}
      </div>
      <button
        data-pb-piece=""
        className={btn}
        aria-label={t({ message: "Increase", context: "lobby number setting" })}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

// A subtle recommendation under a setting. With `onUse` (host) it's a button that
// applies the suggestion; otherwise it's static informational text.
function RecHint({ label, onUse }: { label: React.ReactNode; onUse?: () => void }) {
  const base = "self-end text-[12px] text-muted";
  return onUse ? (
    <button onClick={onUse} className={cn(base, "hover:text-blue-ink cursor-pointer")}>
      {label} · <Trans context="apply the recommended value to this setting">use</Trans>
    </button>
  ) : (
    <span className={base}>{label}</span>
  );
}

// Stand-in config for renders before a summary exists. The overlay hook needs
// an identity-stable object and runs before the loading guard returns; nothing
// is drawn from it.
const LOADING_CONFIG: GameConfig = defaultConfig();

export function Lobby() {
  const { g, inv } = useSearch({ strict: false });
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const guard = useAbandonGuard();
  const sock = useGameSocket();
  /**
   * Whether this client is attached to the table: the socket is open and
   * subscribed to this game. Both are needed, since only the subscription
   * carries the `started` frame.
   */
  const socketReady = sock.status === "open" && sock.gameId === g;
  const toast = useToast();
  // State, not a ref: the row is not in the first render (the loading card
  // shows first), and a ref's effect would only see null.
  const [startRow, setStartRow] = React.useState<HTMLDivElement | null>(null);
  useToastInset(useBottomClearance(startRow));
  const { t } = useLingui();
  const [mapCode, setMapCode] = React.useState("");
  // A flag, not a sentence, so the words are chosen at render and follow a
  // language change.
  const [mapErr, setMapErr] = React.useState(false);
  const [showCode, setShowCode] = React.useState(false);
  const [mapPickerOpen, setMapPickerOpen] = React.useState(false);
  // Flipping the Islands switch can require a different map in either
  // direction: on from a sea-less map, or off from a map whose land only ships
  // can join. The picker then opens showing only maps that resolve the toggle;
  // backing out leaves the ruleset alone.
  const [pickPending, setPickPending] = React.useState<"islands" | "standard" | null>(null);
  // True once the user deliberately drops to spectator, so the "lost my seat ->
  // bounce to lobby" guard doesn't kick them out of the room they're watching.
  const [spectating, setSpectating] = React.useState(false);
  // The seat the host is about to promote, pending confirmation in a dialog.
  const [promoteTarget, setPromoteTarget] = React.useState<Seat | null>(null);
  // Named, so the confirmation reads `{promoteName} will become the host`.
  const promoteName = promoteTarget?.user_name ?? "";
  const creatingRef = React.useRef(false);
  const savedMaps = useQuery({ queryKey: ["maps"], queryFn: api.listMaps, enabled: !!me });
  // Display-only framed boards for the map picker previews (ocean computed by
  // the Go `Frame`), keyed by map id. The picker still sends the land-only
  // gallery board; the backend frames it at game start.
  const framedGallery = useFramedGallery();
  const framedBoardById = React.useMemo(
    () => new Map(framedGallery.map((m) => [m.id, m.board])),
    [framedGallery],
  );

  // Visiting /waiting-room with no table spins up a fresh private table and drops
  // the host straight into it (replacing the URL). Hosting requires a registered
  // account; a guest/anonymous visitor is sent to log in instead.
  React.useEffect(() => {
    if (g || loading) return;
    // In the Discord Activity the bootstrap always arrives with a game id, so
    // a mount without one must not escape to /login or /lobby; the Activity
    // owns its routing.
    if (inActivityMode()) return;
    if (creatingRef.current) return;
    if (!me || me.guest) {
      void navigate({ to: "/login" });
      return;
    }
    creatingRef.current = true;
    api
      .createGame(defaultConfig(), true)
      .then((s) => void navigate({ to: "/lobby", search: { g: s.game.id }, replace: true }))
      .catch(() => {
        creatingRef.current = false;
        void navigate({ to: "/play" });
      });
  }, [g, loading, me, navigate]);

  const query = useQuery({
    queryKey: ["game", g],
    // The invite is not in the key: it authorizes reading a private table
    // (like the WS `sub` below) and belongs to the link, not the game.
    queryFn: () => api.getGame(g!, undefined, inv),
    enabled: !!g,
    // A 404 or 403 won't resolve on retry, so fail fast and let the redirect
    // below fire. A 429 backs off instead: this query shares its cache entry
    // with the game screen and the same metered endpoint (see
    // isFatalApiError).
    retry: retryUnlessFatal,
    retryDelay: retryBackoffMs,
  });

  // An unknown game id has no table to show; go back to the lobby rather than
  // load forever. Only a terminal error leaves; a throttled or flaky fetch
  // keeps retrying behind the loading state.
  React.useEffect(() => {
    // In the Activity there's no lobby to bounce to; stay on the contained
    // table (its own loading/error UI handles a genuinely dead game).
    if (query.isError && isFatalApiError(query.error) && !inActivityMode())
      void navigate({ to: "/play" });
  }, [query.isError, query.error, navigate]);

  React.useEffect(() => {
    if (g) gameSocket.follow(g, inv);
    return () => gameSocket.unfollow();
  }, [g, inv]);

  // Warm the game screen's caches while the table fills: otherwise the
  // board's models load on the game's first frame and the start cue is late.
  // Not cleaned up on unmount; the caches are module-level and are what the
  // game screen reads next.
  React.useEffect(() => {
    preloadSounds(GAME_SOUND_SLOTS);
  }, []);

  const summary: Summary | undefined = sock.summary ?? query.data;

  /**
   * The settings panel draws from these rather than `summary.game.config`, so
   * a host's edit shows immediately and is replaced by the server's answer a
   * round trip later, without flicker as the summary arrives by REST and by
   * broadcast. See lib/lobbyOptimistic for the expiry rules. Called before the
   * loading guards, like every hook here; until a summary lands it overlays a
   * placeholder.
   */
  const cfgEdits = usePendingEdits(summary?.game.config ?? LOADING_CONFIG, () =>
    toast.error(t`Could not save that change`),
  );
  // Privacy is a field of the game, not its config, so it gets its own
  // one-key overlay. Keyed on `public`: since migration 0029 a public table
  // also has an invite code, so the code's presence says nothing about
  // privacy.
  const serverPrivacy = React.useMemo(
    () => ({ private: summary?.game.public === false }),
    [summary?.game.public],
  );
  const privacyEdits = usePendingEdits(serverPrivacy, () =>
    toast.error(t`Could not save that change`),
  );

  // The board's glTF models, keyed on the ruleset because Knights loads three
  // extra files and the host can still change it here.
  const preloadRuleset = summary?.game.ruleset;
  React.useEffect(() => {
    // A client with no WebGL draws no board at all, so it needs no models.
    if (!preloadRuleset || !supportsWebGL()) return;
    void preloadBoardModels(preloadRuleset);
  }, [preloadRuleset]);

  // Render the piece art (shop tiles and log icons, drawn from the models in
  // each seat's colour) here rather than on the game's first frame; the free
  // colours are rendered only once ever. Keyed on the colours so a rename or
  // ready toggle does not re-run it. Not cleaned up on unmount; the caches are
  // module-level and are what the game screen reads next.
  const seatColorKey = (summary?.seats ?? [])
    .map((s) => s.color)
    .filter(Boolean)
    .sort()
    .join("|");
  const ownColor = summary?.seats?.find((s) => s.user_id === me?.id)?.color;
  React.useEffect(() => {
    if (!seatColorKey) return;
    void warmSeatShots(ownColor, seatColorKey.split("|"), {
      shop: SHOP_SET,
      icon: ICON_SET,
    }).then(() => {
      // The rest of the free palette waits until the table's colours are done,
      // so it never delays this game.
      warmFreeColorsWhenIdle({ shop: SHOP_SET, icon: ICON_SET });
    });
  }, [seatColorKey, ownColor]);

  // Discord Rich Presence while sitting in the lobby (no-op outside the
  // Activity). The Game view takes over once play starts.
  const presence = React.useMemo<PresenceInput | null>(() => {
    if (!summary || summary.game.status !== "lobby") return null;
    return {
      gameId: g ?? summary.game.id,
      status: "lobby",
      ruleset: summary.game.ruleset,
      seatedPlayers: (summary.seats ?? []).length,
      maxPlayers: summary.game.config.players,
      viewerSeat: -1,
      curSeat: 0,
      viewerVP: null,
    };
  }, [summary, g]);
  useRichPresence(presence);

  // A websocket subscription error with no REST result either means the table
  // can't load, so go back to the lobby rather than hang. A REST success
  // keeps us here.
  React.useEffect(() => {
    if (g && sock.error && !summary && !inActivityMode()) void navigate({ to: "/play" });
  }, [g, sock.error, summary, navigate]);

  // Route into the game once started, using three signals (see
  // shouldEnterGame): the one-shot `started` broadcast can be missed by a
  // client that reconnected around the start, but the full `state` frame sent
  // on every subscribe to an active game recovers it. Status is the more
  // advanced of the live summary and the REST result, since the live lobby
  // summary stays "lobby" until a fresh frame arrives.
  const statusActive =
    sock.summary?.game.status === "active" || query.data?.game.status === "active";
  React.useEffect(() => {
    if (
      shouldEnterGame(sock.started, statusActive ? "active" : summary?.game.status, !!sock.full) &&
      g &&
      summary
    ) {
      void navigate({ to: "/game", search: { g } });
    }
  }, [sock.started, statusActive, summary?.game.status, sock.full, g, summary, navigate]);

  // The `started` broadcast may be dropped to a busy connection (hub
  // trySend), and the lobby subscription does not re-subscribe on its own.
  // While the table is still a lobby, periodically (and on tab refocus)
  // re-subscribe; the server answers a sub to an active game with
  // `started:true` and full state, which the effect above keys off.
  React.useEffect(() => {
    if (!g || summary?.game.status !== "lobby") return;
    const tick = () => gameSocket.resync();
    const id = setInterval(tick, 4000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
  }, [g, summary?.game.status]);

  // The host kicked us (or we lost our seat): drop back to the lobby once we see
  // ourselves missing from a still-open table.
  const everSeatedRef = React.useRef(false);
  React.useEffect(() => {
    if (inActivityMode()) return;
    if (!me || !summary || !summary.seats || summary.game.status !== "lobby") return;
    if (summary.seats.some((s) => s.user_id === me.id)) {
      everSeatedRef.current = true;
      return;
    }
    // Not seated. Leave only if we held a seat and were kicked: never after
    // choosing to spectate, never in the Activity, and never as the host (an
    // unseated host is spectating their own table). See wasKickedFromLobby,
    // including the stale REST-cache race.
    if (
      wasKickedFromLobby({
        everSeated: everSeatedRef.current,
        spectating,
        inActivity: inActivityMode(),
        isHost: summary.game.created_by === me.id,
      })
    ) {
      void navigate({ to: "/play" });
    }
  }, [me, summary, navigate, spectating]);

  // The host closed the table (live "closed" frame), or we loaded one that was
  // already abandoned: there's nothing to wait in; refresh the session (clears
  // the rejoin dock) and head back to the lobby.
  const tableGone = sock.closed || summary?.game.status === "abandoned";
  React.useEffect(() => {
    if (!tableGone) return;
    void refresh();
    if (!inActivityMode()) void navigate({ to: "/play" });
  }, [tableGone, refresh, navigate]);

  // A returning guest with a remembered name gets it applied to their fresh seat
  // automatically (they can still change it). Only kicks in while the seat still
  // shows the "Guest" fallback, so it never clobbers a name they just set.
  const appliedNameRef = React.useRef(false);
  React.useEffect(() => {
    if (appliedNameRef.current || !me?.guest || !summary || !summary.seats || !g) return;
    const mine = summary.seats.find((s) => s.user_id === me.id);
    if (!mine || mine.user_name !== "Guest") return;
    const saved = localStorage.getItem(GUEST_NAME_KEY);
    if (!saved) return;
    appliedNameRef.current = true;
    api.setSeatName(g, saved).catch(() => {});
  }, [me, summary, g]);

  if (!g) {
    return <LoadingScreen />;
  }
  if (!summary) {
    return <LoadingScreen />;
  }

  const game = summary.game;
  const cfg = cfgEdits.value;
  // The ruleset the settings describe. During an in-flight expansion change
  // this is the config's rather than the game row's (UpdateConfig writes both,
  // so they agree a round trip later). Everything derived from the ruleset
  // follows this value so the whole panel updates together.
  const ruleset = cfg.ruleset || game.ruleset;
  // The server's clock policy. Absent only on the browse list and from a
  // server older than the timings block; then the turn-timer control is not
  // offered.
  const timings = summary.timings;
  // Go marshals a nil slice as null, so normalize seats to an array.
  const seats = [...(summary.seats ?? [])].sort((a, b) => a.no - b.no);
  const isHost = !!me && game.created_by === me.id;
  // The caller's own (non-bot) seat, if any; gates the seat-settings button.
  const mySeat = me ? seats.find((s) => s.user_id === me.id && s.status !== "bot") : undefined;
  const exp = parseExpansions(ruleset);
  const knightsOpts = (cfg.modules?.cak ?? {}) as KnightsOptions;
  const islandsOpts = (cfg.modules?.islands ?? {}) as IslandsOptions;
  // Which starting rule the chosen map gets: the main island, or any island
  // because the map is an archipelago (lib/maps/mainIsland.ts mirrors the
  // engine's definition).
  const startRule = startIslandRule(cfg.board, islandsOpts.start_island);
  const recVP = recommendedVP(cfg.players, ruleset);
  const vpMax = maxVP(ruleset, cfg.players);
  const recBarbDist = recommendedBarbarianDistance(cfg.players);
  const recDiscard = recommendedDiscardLimit(cfg.players);
  // Plain computation (not useMemo): this code runs only after the early-return
  // loading guards above, so a hook here would change hook order between renders.
  const selectedMap = matchGalleryMap(cfg.board);
  const recMap = recommendedMap(cfg.players, ruleset, cfg.board);
  // Only nudge toward a different map when the host is on a standard/island map
  // that no longer fits; never override a chosen themed/country or custom pick.
  const showMapRec =
    recMap && selectedMap && selectedMap.kind !== "themed" && recMap.id !== selectedMap.id;
  // Named, so the hint's message reads `recommended: {recMapName}`.
  const recMapName = recMap?.name ?? "";
  const islandsWarning = islandsMapWarning(cfg);
  const harbourWarning = harbormasterMapWarning(cfg);

  async function pickMap(m: GalleryMap) {
    if (!isHost) return;
    const wantIslands = m.ruleset.includes("islands");
    // A map carries its own Islands answer, so picking one is an expansion
    // change too: use the same prune-and-clamp as the switch so island
    // options do not linger. Close the picker first: the panel already shows
    // the new map (the patch is optimistic).
    setMapPickerOpen(false);
    setPickPending(null);
    await patch({
      board: m.board,
      preset: "",
      ...expPatch({ ...exp, islands: wantIslands }),
    });
  }
  // The host may hold no seat (spectating their own table), so use the
  // creator's name from the summary rather than assuming seat 0 is the host.
  const host = summary.host_name || "–";
  const openSeats = Math.max(0, cfg.players - seats.length);
  // A local so the message gets a named `{seatedCount}` placeholder; a member
  // expression would extract as positional `{0}`.
  const seatedCount = seats.length;
  const inviteLink = game.invite_code ? `https://costan.io/g/${game.invite_code}` : "";
  // A seated human guest blocks going public (bots are guest accounts too, but
  // are allowed in public games).
  const hasGuest = seats.some((s) => s.is_guest && s.status !== "bot");
  // Read once: two settings rows use it, and the bank-supply row goes dark
  // when it is set.
  const memoryMode = cfg.memory_mode ?? false;
  const isPrivate = privacyEdits.value.private;

  // Resolves true when the server took the change. A refusal is toasted here,
  // with the server's reason, so callers only need the answer to decide what
  // to keep (the map-code box keeps a code the server refused).
  async function patch(next: Partial<GameConfig>): Promise<boolean> {
    if (!isHost) return false;
    // Built on the optimistic config so two quick edits compose.
    const merged = { ...cfg, ...next };
    const edit = cfgEdits.begin(next);
    try {
      const sum = await api.updateConfig(g!, merged);
      // The server's values for these fields replace the overlay, so anything
      // it clamped or normalised corrects immediately.
      cfgEdits.settle(edit, pick(sum.game.config, next));
      gameSocket.applySummary(sum);
      return true;
    } catch (e) {
      cfgEdits.drop(edit);
      toast.error(apiErrorText(e, t`Could not save that change`));
      return false;
    }
  }
  // The config fields that follow an expansion change, shared by the switches
  // and by picking a map (which decides Islands for itself).
  function expPatch(next: Expansions): Partial<GameConfig> {
    // Drop module options for deselected expansions so no stale config
    // remains. `nextRuleset` avoids shadowing the outer `ruleset`, which the
    // retarget below compares against.
    const nextRuleset = assembleRuleset(next);
    const active = new Set(nextRuleset.split("+"));
    const modules = Object.fromEntries(
      Object.entries(cfg.modules ?? {}).filter(([k]) => active.has(k)),
    );
    // Move the VP target to the new ruleset's default when the host has not
    // set one, and clamp a host-set one only if the new ceiling cannot hold
    // it. See `retargetVP`.
    const target_vp = retargetVP(cfg.target_vp, cfg.players, ruleset, nextRuleset);
    return { ruleset: nextRuleset, modules, target_vp };
  }
  function setExp(next: Expansions) {
    // A scenario that deals its own map (Explorers) must arrive with no
    // board, or the engine refuses the config. Clearing it here works because
    // the server no longer invents a board (lobby.validateConfig).
    if (dealsItsOwnMap(assembleRuleset(next))) {
      // `patch` sends { ...cfg, ...next } as the whole config, so an explicit
      // undefined drops the map: JSON omits the key.
      void patch({ ...expPatch(next), board: undefined });
      return;
    }
    // Islands-only terrain leaves with the expansion, or the engine rejects
    // the config ("Gold tiles need the Islands expansion enabled"). The map is
    // kept; gold becomes plain land. Leaving a standalone scenario, a board
    // comes back, since every other ruleset needs one.
    const restored = cfg.board ?? recommendedMap(cfg.players, assembleRuleset(next))?.board;
    const board = next.islands ? restored : boardWithoutIslandsTerrain(restored);
    void patch({ ...expPatch(next), ...(board ? { board } : {}) });
  }
  // Max players, checked against the map before sending. The server refuses a
  // count the map cannot seat (board.ValidateSeats); see playersChange for
  // how that is handled here.
  function setPlayers(v: number) {
    const change = playersChange(v, ruleset, cfg.board, selectedMap);
    if (change.kind === "switch") {
      const mapName = change.map.name;
      const fromName = selectedMap?.name ?? "";
      const fromSeats = boardSeats(cfg.board);
      void patch({ players: change.players, board: change.map.board, preset: "" });
      toast.info(t`Moved to the ${mapName} map: ${fromName} only seats ${fromSeats}.`);
      return;
    }
    if (change.kind === "capped") {
      const seatsN = change.seats;
      toast.info(t`This map seats up to ${seatsN} players. Pick a larger map to seat more.`);
    }
    if (change.players !== cfg.players) void patch({ players: change.players });
  }
  // Merge a partial update into one module's options slice (cfg.modules[name]).
  function patchModule(name: string, opts: Record<string, unknown>) {
    const current = (cfg.modules?.[name] as Record<string, unknown>) ?? {};
    void patch({ modules: { ...(cfg.modules ?? {}), [name]: { ...current, ...opts } } });
  }
  async function setPrivacy(priv: boolean) {
    if (!isHost) return;
    const edit = privacyEdits.begin({ private: priv });
    try {
      const sum = await api.setPrivacy(g!, priv);
      privacyEdits.settle(edit, { private: sum.game.public === false });
      gameSocket.applySummary(sum);
    } catch (e) {
      privacyEdits.drop(edit);
      toast.error(apiErrorText(e, t`Could not save that change`));
    }
  }
  async function loadMapCode() {
    const c = mapCode.trim();
    if (!c) return;
    setMapErr(false);
    try {
      const { board } = await api.decodeMap(c);
      // A code the server refuses stays in the box; patch has already shown
      // why.
      if (await patch({ board, preset: "" })) setMapCode("");
    } catch {
      setMapErr(true);
    }
  }

  async function start() {
    try {
      await api.start(g!);
      // A 204 confirms the start, so the host navigates in without waiting for
      // the `started` broadcast, which can be dropped to a busy connection. The
      // game screen re-subscribes and pulls full state.
      if (g && summary) void navigate({ to: "/game", search: { g } });
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not start the game`));
    }
  }
  async function addBot() {
    try {
      gameSocket.applySummary(await api.addBot(g!));
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not add bot`));
    }
  }
  async function kick(seat: number) {
    try {
      gameSocket.applySummary(await api.kick(g!, seat));
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not remove that seat`));
    }
  }
  async function transferHost(newHostID: number) {
    setPromoteTarget(null);
    try {
      gameSocket.applySummary(await api.transferHost(g!, newHostID));
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not transfer host`));
    }
  }
  async function setColor(colorID: string) {
    try {
      gameSocket.applySummary(await api.setSeatColor(g!, colorID));
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not set color`));
    }
  }
  async function setName(name: string) {
    try {
      gameSocket.applySummary(await api.setSeatName(g!, name));
      if (me?.guest && name) localStorage.setItem(GUEST_NAME_KEY, name);
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not set name`));
    }
  }
  async function setDecoration(id: string) {
    try {
      gameSocket.applySummary(await api.setSeatDecoration(g!, id));
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not set decoration`));
    }
  }
  async function leave() {
    if (inActivityMode()) return;
    try {
      await api.leave(g!);
    } catch {
      /* ignore */
    }
    // Refresh the session so the now-left game stops showing as the active
    // game (otherwise the "rejoin" dock lingers on a table you've left).
    await refresh();
    void navigate({ to: "/play" });
  }
  // Drop my seat but keep watching. Applying the returned summary updates the
  // UI immediately instead of waiting for the websocket echo.
  async function spectate() {
    // Set the guard before the request: the server rebroadcasts the summary
    // (without our seat) while we await, and the bounce-on-missing-seat effect
    // could fire before a post-await setSpectating. Reverted if the call fails.
    setSpectating(true);
    try {
      gameSocket.applySummary(await api.spectate(g!));
    } catch (e) {
      setSpectating(false);
      toast.error(apiErrorText(e, t`Could not switch to spectator`));
    }
  }
  // Claim an open seat as a spectator (opt in). Public tables need no invite;
  // private ones reuse this lobby's code.
  async function takeSeat() {
    if (!(await guard(g))) return;
    try {
      // Apply the seated summary before clearing the spectating guard; clearing
      // it while the summary still shows us unseated would trip the bounce
      // effect.
      gameSocket.applySummary(await api.join(g!, game.invite_code || undefined));
      setSpectating(false);
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not take a seat`));
    }
  }

  const chat = sock.chat.filter((c) => c.scope === `game:${g}`);

  // Header pieces shared by the mobile (two-row) and desktop (one-row) layouts.
  const seatButtons = (
    <>
      {!inActivityMode() && (
        <Button onClick={() => void leave()} variant="secondary" size="sm">
          <ArrowLeft weight="bold" />
          <Trans context="leave the table">Leave</Trans>
        </Button>
      )}
      {mySeat && (
        <Button
          onClick={() => void spectate()}
          variant="secondary"
          size="sm"
          title={t`Drop your seat and watch`}
        >
          <Trans>Spectate</Trans>
        </Button>
      )}
      {!mySeat && me && openSeats > 0 && (
        <Button onClick={() => void takeSeat()} size="sm">
          <Trans>Take a seat</Trans>
        </Button>
      )}
    </>
  );

  /* The avatar menu, at the right end of both header layouts, so Settings and
     the store are reachable from the waiting room too (the Activity opens
     straight into it and hides the site nav). ProfileMenu decides its own
     contents, including what it hides in the Activity. No `sessionActions`:
     leave and spectate are buttons in this header, and the game-screen
     actions mean nothing before the game starts. */
  const profileMenu = me ? <ProfileMenu me={me} /> : null;

  /* Whether the table is findable, at the top of the screen next to the
     invite code and copy link, since it answers the same question (who can
     walk in) and is not a game rule. It has its own endpoint and pending-edit
     tracker rather than going through `patch`. Non-hosts see a read-only
     pill. */
  const privacyControl = isHost ? (
    <Segmented<"private" | "public">
      variant="joined"
      value={isPrivate ? "private" : "public"}
      onChange={(v) => {
        void setPrivacy(v === "private");
      }}
      options={[
        { label: t({ message: "Private", context: "table privacy" }), value: "private" },
        {
          label: t({ message: "Public", context: "table privacy" }),
          value: "public",
          // A seated human guest blocks going public. Hover explains it on
          // desktop; the line under the header explains it everywhere.
          title: hasGuest ? t`A guest is seated; public is Discord-only` : undefined,
        },
      ]}
    />
  ) : (
    <div
      className="inline-flex items-center gap-1.5 bg-secondary-background border border-border rounded-control px-3 py-1.5 text-[13px] font-medium text-muted"
      title={isPrivate ? t`Invite only` : t`Anyone can find and join this table`}
    >
      {isPrivate ? <LockSimple weight="bold" /> : <Globe weight="bold" />}
      {isPrivate ? (
        <Trans context="table privacy">Private</Trans>
      ) : (
        <Trans context="table privacy">Public</Trans>
      )}
    </div>
  );

  // Why Public is refused, shown as text, since the Segmented's `title` only
  // helps on desktop hover.
  const guestBlocksPublic =
    isHost && hasGuest && isPrivate ? (
      <div className="px-3 sm:px-5 text-[12px] font-semibold text-on-background-muted shrink-0">
        <Trans>A guest is seated. Remove them to make this table public.</Trans>
      </div>
    ) : null;

  // Shown whenever the server disclosed a code, listed or not: this answers
  // "what link do I send", and the toggle beside it "who can walk in without
  // one".
  const inviteControls = game.invite_code ? (
    <>
      {/* Desktop (>=720px): inline controls. Below that, and on a phone held
          sideways (`squat`, which uses the phone header), they collapse to a
          kebab. */}
      <div className="hidden min-[720px]:flex squat:hidden! items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowCode((v) => !v)}
          title={showCode ? t`Hide code` : t`Show code`}
        >
          {showCode ? (
            <span className="font-num tabular-nums">{game.invite_code}</span>
          ) : (
            <Trans>Show code</Trans>
          )}
        </Button>
        {/* Clipboard writes silently no-op inside Discord's sandboxed iframe,
            so the Copy link button is web-only. */}
        {!inActivityMode() && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(inviteLink);
            }}
          >
            <Trans>Copy link</Trans>
          </Button>
        )}
      </div>
      {/* Mobile (<720px): same controls behind a 3-dot menu. "Show code" keeps
          the menu open so the revealed code stays visible. */}
      <Menu
        className="min-[720px]:hidden squat:block!"
        align="end"
        contentClassName="min-w-45"
        // eslint-disable-next-line shadcn/require-static-classes -- the trigger is drawn as an IconButton, by that primitive's own variant function.
        triggerClassName={iconButtonVariants({ size: "sm" })}
        triggerLabel={t`Invite options`}
        trigger={<DotsThreeVertical weight="bold" aria-hidden />}
      >
        <MenuItem keepOpen onSelect={() => setShowCode((v) => !v)}>
          {showCode ? (
            <span className="font-num tabular-nums">{game.invite_code}</span>
          ) : (
            <Trans>Show code</Trans>
          )}
        </MenuItem>
        {!inActivityMode() && (
          <MenuItem
            onSelect={() => {
              void navigator.clipboard?.writeText(inviteLink);
            }}
          >
            <Trans>Copy link</Trans>
          </MenuItem>
        )}
      </Menu>
    </>
  ) : // No code was disclosed to this viewer: a spectator, or a table created
  // before 0029 that was public and so never had one. Nothing to show.
  null;

  return (
    // `squat:h-auto`: a phone held sideways keeps two columns but drops the
    // one-screen fit, which left the settings card only a few px of scroll
    // port; the page scrolls instead. `overflow-x-clip` rather than `hidden`
    // there, since `hidden` would make this a scroll container and break the
    // sticky Start row.
    <div className="min-h-full lg:h-full squat:h-auto w-full bg-background text-on-background overflow-x-hidden squat:overflow-x-clip! flex flex-col select-none">
      <div className="w-full flex-1 min-h-0 flex flex-col gap-3 pb-3.5">
        <LobbyHeader
          host={host}
          seatButtons={seatButtons}
          privacyControl={privacyControl}
          inviteControls={inviteControls}
          profileMenu={profileMenu}
        />
        {guestBlocksPublic}

        <div className="flex-1 min-h-0 flex flex-col gap-3 px-3 sm:px-5 pb-1 lg:grid lg:grid-cols-[1fr_380px] lg:gap-3.5 lg:items-stretch squat:grid-cols-2 squat:items-start">
          {/* left: players */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="grid grid-cols-3 gap-3 max-[640px]:grid-cols-2 squat:grid-cols-2 shrink-0">
              {seats.map((s) => (
                <div
                  key={s.no}
                  className="relative min-h-47 bg-secondary-background border border-rim rounded-card shadow-hard p-4 flex flex-col items-center justify-center gap-2"
                >
                  {mySeat && s.no === mySeat.no && (
                    <SeatSettings
                      seat={mySeat}
                      taken={seats.filter((o) => o.no !== mySeat.no).map((o) => o.color)}
                      onSetName={(n) => {
                        void setName(n);
                      }}
                      onSetColor={(id) => {
                        void setColor(id);
                      }}
                      onSetDecoration={(id) => {
                        void setDecoration(id);
                      }}
                    />
                  )}
                  {isHost && s.user_id !== game.created_by && (
                    <button
                      onClick={() => {
                        void kick(s.no);
                      }}
                      title={s.status === "bot" ? t`Remove bot` : t`Remove player`}
                      // A small round control, with the colour in the glyph and
                      // hover tint.
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-secondary-background text-red-ink border border-border shadow-hard-sm flex items-center justify-center cursor-pointer transition-colors hover:bg-red-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X weight="bold" />
                    </button>
                  )}
                  {/* Promote to host: only registered humans (never bots or
                      guests) are eligible, mirroring the server-side guard. */}
                  {isHost && s.user_id !== game.created_by && s.status !== "bot" && !s.is_guest && (
                    <button
                      onClick={() => setPromoteTarget(s)}
                      title={t`Make host`}
                      /* The crown in amber-ink on the panel: amber's mark form,
                         which clears 4.5:1 on the surface in both themes. */
                      className="absolute top-2 left-2 w-7 h-7 rounded-full bg-secondary-background text-amber-ink border border-border shadow-hard-sm flex items-center justify-center cursor-pointer transition-colors hover:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CrownSimple weight="fill" />
                    </button>
                  )}
                  <Avatar
                    color={s.color || avatarColor(s.user_id)}
                    src={s.avatar || undefined}
                    name={s.user_name}
                    size={54}
                  />
                  {/* Name row: a balanced 3-column grid keeps the name centered
                      whether or not a leading icon is present. The host crown or
                      bot symbol sits left, the right cell is an equal spacer, and
                      the name truncates to fit the seat box. */}
                  <div className="grid w-full grid-cols-[minmax(1.25rem,1fr)_auto_minmax(1.25rem,1fr)] items-center text-[16px] font-semibold">
                    <span className="flex items-center justify-end pr-1">
                      {s.user_id === game.created_by ? (
                        <CrownSimple
                          weight="fill"
                          className="text-amber-ink shrink-0"
                          aria-label={t({
                            message: "Host",
                            context: "the player who owns the table",
                          })}
                        />
                      ) : s.status === "bot" ? (
                        <Robot weight="fill" className="text-muted shrink-0" aria-label={t`Bot`} />
                      ) : null}
                    </span>
                    <span className="flex items-center justify-center gap-1.5 min-w-0">
                      <DecoratedName decoration={s.decoration} className="truncate min-w-0">
                        {s.user_name}
                      </DecoratedName>
                    </span>
                    <span aria-hidden />
                  </div>
                  {typeof s.rating === "number" ? (
                    <RatingBadge elo={s.rating} provisional={!!s.provisional} size="md" />
                  ) : (
                    <Badge tone="muted" size="md">
                      <Trans>Unrated</Trans>
                    </Badge>
                  )}
                  {/* Your own seat shows the session socket's status, the one
                      readiness fact this client knows. Other seats keep a
                      constant badge: per-seat presence is not on the summary,
                      and a guess would look like a measurement. */}
                  {me && s.user_id === me.id && s.status !== "bot" ? (
                    <Badge
                      tone={socketReady ? "ready" : "muted"}
                      data-status={socketReady ? "ready" : undefined}
                      size="md"
                      title={
                        socketReady ? t`Connected to the table` : t`Still connecting to the table`
                      }
                    >
                      {/* This "Ready" is the socket being up; the one below is a
                          player declaring they are ready. Separate contexts let
                          translators use different words. */}
                      {socketReady ? (
                        <Trans context="connection to the table is established">Ready</Trans>
                      ) : (
                        <Trans>Connecting…</Trans>
                      )}
                    </Badge>
                  ) : (
                    <Badge tone="ready" data-status="ready" size="md">
                      <Trans context="player is ready to start">Ready</Trans>
                    </Badge>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }).map((_, i) => (
                <div
                  key={`open${i}`}
                  // An empty seat is a slot in the ground, not a panel: faint
                  // fill and dashed rim from the on-background pair, so it reads
                  // on both the ocean and the navy.
                  className="min-h-47 bg-page-well border border-dashed border-page-dash rounded-card p-4 flex flex-col items-center justify-center gap-2 text-on-background-muted"
                >
                  <div className="w-13.5 h-13.5 rounded-full border border-dashed border-page-dash-strong" />
                  <div className="text-[14px] font-medium">
                    <Trans context="an empty seat at the table">Open seat</Trans>
                  </div>
                  {isHost && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void addBot();
                      }}
                    >
                      <Plus weight="bold" />
                      <Trans>Add bot</Trans>
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {/* on-background, not the card inks: this row sits on the page
                ground, where text-muted (#495f79 on #1159c1) is 1.01:1 and
                text-foreground 2.16:1. */}
            {sock.spectators.length > 0 && (
              <div className="text-[13px] font-medium text-on-background-muted px-1 flex items-center gap-1.5 flex-wrap shrink-0">
                <Eye weight="bold" />
                <span>
                  <Trans context="label before the list of spectators">Watching:</Trans>
                </span>
                {sock.spectators.map((s) => (
                  <span key={s.user_id} className="text-on-background font-semibold">
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* right: settings + map picker, with start pinned to the bottom */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1 squat:overflow-visible squat:flex-none">
              {mapPickerOpen ? (
                /* map picker; takes over the whole settings area */
                <div className="bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3.5 flex flex-col gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setMapPickerOpen(false);
                        setPickPending(null);
                      }}
                    >
                      <ArrowLeft weight="bold" />
                      <Trans context="return to the settings panel">Back</Trans>
                    </Button>
                    {pickPending && (
                      <SectionLabel>
                        {pickPending === "islands" ? (
                          <Trans>Pick an Islands map</Trans>
                        ) : (
                          <Trans>Pick a standard map</Trans>
                        )}
                      </SectionLabel>
                    )}
                    <ActivitySafeLink>
                      <Link
                        to="/map-builder"
                        onClick={() => {
                          stashBuilderBoard(cfg.board ?? null);
                          stashBuilderSource(isHost ? { id: g, cfg } : null);
                        }}
                        className="ml-auto text-[12px] font-semibold text-blue-ink hover:underline underline-offset-2"
                      >
                        <Trans>Map builder →</Trans>
                      </Link>
                    </ActivitySafeLink>
                  </div>

                  {pickPending && (
                    <div className="text-[12px] text-muted bg-elev rounded-base px-3 py-2">
                      {pickPending === "islands" ? (
                        <Trans>
                          Islands needs open sea. Choose one of these maps to turn Islands on, or go
                          Back to leave Islands off.
                        </Trans>
                      ) : (
                        <Trans>
                          Without Islands there are no ships, so this map's outer land can't be
                          reached. Choose one of these maps to turn Islands off, or go Back to leave
                          Islands on.
                        </Trans>
                      )}
                    </div>
                  )}

                  <ScrollFade
                    wrapperClassName=""
                    className="grid grid-cols-2 gap-2 max-h-75 overflow-y-auto pr-1 lg:max-h-none lg:overflow-visible lg:pr-0"
                  >
                    {(pickPending
                      ? GALLERY.filter(
                          (m) => m.ruleset.includes("islands") === (pickPending === "islands"),
                        )
                      : GALLERY
                    ).map((m) => {
                      const rec = mapPlayers(m);
                      const range = rec.min === rec.max ? `${rec.min}` : `${rec.min}–${rec.max}`;
                      const active = selectedMap?.id === m.id;
                      return (
                        <button
                          key={m.id}
                          // Test hook, like data-expansion on the shelf:
                          // frontend/dev/ui-smoke.mjs picks a map when turning
                          // Islands on.
                          data-gallery-map={m.id}
                          disabled={!isHost}
                          onClick={() => {
                            void pickMap(m);
                          }}
                          className={cn(
                            // The picked map is ringed in the selected ink; the
                            // rest lift on hover.
                            "flex flex-col gap-1 border rounded-base p-1.5 text-left cursor-pointer transition-shadow disabled:opacity-70",
                            active
                              ? "bg-secondary-background border-selected shadow-[0_0_0_1px_var(--color-selected)]"
                              : "bg-secondary-background border-line enabled:hover:shadow-hard-sm",
                          )}
                        >
                          <div className="rounded-lg overflow-hidden bg-ocean aspect-[4/3]">
                            {/* Framed board for display (computed ocean); falls
                                back to the land-only board until framing resolves. */}
                            <MapPreview
                              board={framedBoardById.get(m.id) ?? m.board}
                              className="w-full h-full"
                            />
                          </div>
                          <div className="text-[12px] font-semibold leading-tight">{m.name}</div>
                          <div className="text-[12px] text-muted">
                            <Trans>best with {range}</Trans>
                          </div>
                        </button>
                      );
                    })}
                  </ScrollFade>

                  {isHost && (savedMaps.data?.maps?.length ?? 0) > 0 && (
                    <div className="flex flex-col gap-1 w-full">
                      <div className="ui-label">
                        <Trans>Saved maps</Trans>
                      </div>
                      <div className="flex flex-col gap-1">
                        {savedMaps.data!.maps.slice(0, 8).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              void patch({ board: m.board, preset: "" });
                            }}
                            className="text-left text-[13px] font-medium rounded-lg px-2 py-1.5 hover:bg-elev cursor-pointer"
                          >
                            {m.name}{" "}
                            <span className="text-muted text-[12px] font-semibold">
                              ·{" "}
                              <Trans context="map size, r = board radius in rings, compact">
                                r{m.board.radius}
                              </Trans>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isHost && (
                    <div className="flex gap-1.5 w-full">
                      <input
                        id="map-code"
                        name="map-code"
                        type="text"
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                        value={mapCode}
                        onChange={(e) => {
                          setMapCode(e.target.value);
                          setMapErr(false);
                        }}
                        placeholder={t`Paste a map code`}
                        className="flex-1 min-w-0 bg-secondary-background border border-border rounded-lg px-2.5 py-1.5 text-[13px] font-medium placeholder:text-muted2 shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 select-text"
                      />
                      <Button
                        variant="secondary"
                        size="field"
                        pill={false}
                        onClick={() => {
                          void loadMapCode();
                        }}
                        disabled={!mapCode.trim()}
                      >
                        <Trans context="load a pasted map code">Load</Trans>
                      </Button>
                    </div>
                  )}
                  {mapErr && (
                    <div className="text-[12px] font-medium text-red-ink w-full">
                      <Trans>That isn't a valid map code.</Trans>
                    </div>
                  )}
                </div>
              ) : (
                /* settings */
                <div className="bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3.5 flex flex-col gap-3 shrink-0 lg:flex-1 lg:min-h-0 lg:overflow-hidden squat:flex-none squat:overflow-visible">
                  <div className="flex items-start gap-2 shrink-0">
                    <SectionLabel>
                      <Trans>Game settings</Trans>
                    </SectionLabel>
                    <div className="ml-auto text-[12px] text-muted max-w-42.5 text-right leading-[1.3]">
                      {isHost ? (
                        <Trans>Settings update live.</Trans>
                      ) : (
                        <Trans>Only the host can change settings.</Trans>
                      )}
                    </div>
                  </div>
                  {/* only the rows scroll; the box and its header stay pinned, and a
                    gradient fades whichever edge still has rows out of view */}
                  {/* `lg:pb-4`: the last control clears the scroller's 6px hard edge
                      band at the bottom rather than being cut by it. */}
                  <ScrollFade className="flex flex-col gap-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:-mr-2 lg:pr-2 lg:pb-4 squat:overflow-visible squat:flex-none">
                    <div className="flex flex-col gap-1">
                      <SettingRow label={<Trans context="the board a table plays on">Map</Trans>}>
                        <button
                          onClick={() => setMapPickerOpen(true)}
                          title={t`Choose map`}
                          className="group flex items-center gap-2 cursor-pointer"
                        >
                          <span className="text-[13px] font-semibold text-foreground group-hover:text-blue-ink">
                            {selectedMap?.name ?? t`Custom map`}
                          </span>
                          <div className="w-10 h-7.5 rounded-md overflow-hidden ring-1 ring-line bg-ocean shrink-0 transition-shadow group-hover:ring-2 group-hover:ring-blue">
                            {cfg.board ? (
                              <MapPreview board={cfg.board} className="w-full h-full" />
                            ) : (
                              <div className="w-full h-full" />
                            )}
                          </div>
                        </button>
                      </SettingRow>
                      {showMapRec && recMap && (
                        <RecHint
                          label={<Trans>recommended: {recMapName}</Trans>}
                          onUse={
                            isHost
                              ? () => {
                                  void pickMap(recMap);
                                }
                              : undefined
                          }
                        />
                      )}
                    </div>
                    {/* Expansions sit under the map: they decide which rows
                        below exist and which maps are playable. */}
                    <ExpansionShelf
                      exp={exp}
                      disabled={!isHost}
                      onToggle={(key, on) => {
                        // Either direction of the Islands switch can need a
                        // different map (on needs sea, off needs land that
                        // holds together without ships), so send the host to
                        // the picker. Backing out leaves the switch as it was.
                        const needsSea = key === "islands" && !on && !mapSupportsIslands(cfg.board);
                        const strandsLand = key === "islands" && on && mapNeedsShips(cfg.board);
                        if (needsSea || strandsLand) {
                          setPickPending(needsSea ? "islands" : "standard");
                          setMapPickerOpen(true);
                        } else {
                          setExp({ ...exp, [key]: !on });
                        }
                      }}
                    />
                    {islandsWarning && (
                      <div
                        className={cn(
                          "text-[12px] rounded-base px-3 py-2",
                          islandsWarning.severity === "block"
                            ? "text-red-ink bg-red-tint"
                            : "text-muted bg-elev",
                        )}
                      >
                        {islandsWarning.text}
                      </div>
                    )}
                    {harbourWarning && (
                      <div
                        className="text-xs rounded-base px-3 py-2 text-red-ink bg-red-tint"
                        data-testid="harbormaster-map-warning"
                      >
                        {harbourWarning.text}
                      </div>
                    )}
                    <MaxPlayers
                      value={cfg.players}
                      floor={Math.max(MIN_PLAYERS, seats.length)}
                      min={MIN_PLAYERS}
                      max={MAX_PLAYERS}
                      disabled={!isHost}
                      onCommit={(v) => setPlayers(v)}
                    />
                    <div className="h-px bg-line" />
                    {timings && (
                      <SettingRow label={<Trans>Turn timer</Trans>}>
                        <Segmented
                          variant="joined"
                          disabled={!isHost}
                          value={cfg.turn_timer_sec || timings.default_turn_sec}
                          onChange={(secs) => {
                            void patch({ turn_timer_sec: secs });
                          }}
                          options={timings.turn_timer_presets.map((p) => ({
                            label: TURN_TIMER_LABELS[p.label]
                              ? i18n._(TURN_TIMER_LABELS[p.label])
                              : p.label,
                            value: p.sec,
                          }))}
                        />
                      </SettingRow>
                    )}
                    <div className="flex flex-col gap-1">
                      <SettingRow label={<Trans>Target VP</Trans>}>
                        <Stepper
                          value={cfg.target_vp || recVP}
                          onChange={(v) => {
                            void patch({ target_vp: v });
                          }}
                          min={5}
                          max={vpMax}
                          disabled={!isHost}
                        />
                      </SettingRow>
                      {(cfg.target_vp || recVP) !== recVP && (
                        <RecHint
                          label={<Trans>recommended: {recVP}</Trans>}
                          onUse={
                            isHost
                              ? () => {
                                  void patch({ target_vp: recVP });
                                }
                              : undefined
                          }
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <SettingRow label={<Trans>Discard limit</Trans>}>
                        <Stepper
                          value={cfg.discard_limit || 7}
                          onChange={(v) => {
                            void patch({ discard_limit: v });
                          }}
                          min={5}
                          max={15}
                          disabled={!isHost}
                        />
                      </SettingRow>
                      {(cfg.discard_limit || 7) !== recDiscard && (
                        <RecHint
                          label={<Trans>recommended: {recDiscard}</Trans>}
                          onUse={
                            isHost
                              ? () => {
                                  void patch({ discard_limit: recDiscard });
                                }
                              : undefined
                          }
                        />
                      )}
                    </div>
                    <SettingRow label={<Trans>Turn order</Trans>}>
                      <Segmented<"lobby" | "random">
                        variant="joined"
                        disabled={!isHost}
                        value={cfg.turn_order ?? "random"}
                        onChange={(to) => {
                          void patch({ turn_order: to });
                        }}
                        /* "random" here is a turn order and two rows down a
                           dice mode, so each has its own context. */
                        options={[
                          {
                            label: t({ message: "Random", context: "turn order is shuffled" }),
                            value: "random",
                            title: t`Shuffle turn order at start`,
                          },
                          {
                            label: t({
                              message: "Seating",
                              context: "turn order follows the seating order",
                            }),
                            value: "lobby",
                            title: t`Play in seating order`,
                          },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow label={<Trans>Dice</Trans>}>
                      <Segmented
                        variant="joined"
                        disabled={!isHost}
                        value={cfg.dice_mode ?? "random"}
                        onChange={(dm) => {
                          void patch({ dice_mode: dm });
                        }}
                        options={[
                          {
                            label: t({ message: "Fair", context: "dice roll distribution" }),
                            value: "fair",
                          },
                          {
                            label: t({ message: "Random", context: "dice roll distribution" }),
                            value: "random",
                          },
                        ]}
                      />
                    </SettingRow>
                    <SettingRow label={<Trans>Board numbers</Trans>}>
                      <Segmented<"random" | "fair">
                        variant="joined"
                        disabled={!isHost}
                        value={cfg.board_mode ?? "fair"}
                        onChange={(bm) => {
                          void patch({ board_mode: bm });
                        }}
                        options={[
                          {
                            label: t({
                              message: "Fair",
                              context: "board number placement",
                            }),
                            value: "fair",
                            title: t`Balanced number spread`,
                          },
                          {
                            label: t({
                              message: "Random",
                              context: "board number placement",
                            }),
                            value: "random",
                            title: t`Numbers may clump; some spots get hot`,
                          },
                        ]}
                      />
                    </SettingRow>
                    {/* Only where there is a robber: Wagons, Raiders and
                        Explorers have none, and the server ignores and clears
                        the switch there (engine.RulesetHasRobber). */}
                    {rulesetCaps(ruleset).hasRobber && (
                      <SettingRow
                        label={<Trans>Friendly robber</Trans>}
                        title={t`Players still at their starting score (2 points, or 3 where you start with a city) can't be robbed`}
                      >
                        <RowSwitch
                          checked={cfg.friendly_robber ?? false}
                          disabled={!isHost}
                          onCheckedChange={(v) => {
                            void patch({ friendly_robber: v });
                          }}
                        />
                      </SettingRow>
                    )}
                    {/* Memory mode already hides the bank and wins at the table
                        (the game reads `show_bank && !memory_mode`,
                        hud/TableStatus.tsx), so this row shows that rather than
                        a switch that changes nothing.

                        It reads the stored value but does not patch it: the
                        engine keeps the two keys independent
                        (engine/config_showbank_test.go), so turning memory mode
                        off restores the host's bank setting. */}
                    <SettingRow
                      label={<Trans>Show bank supply</Trans>}
                      title={
                        memoryMode
                          ? t`Memory mode hides the bank supply. Turn memory mode off to change this.`
                          : t`Show how many of each resource the bank has left. Turn off for a harder game where players track the bank themselves.`
                      }
                    >
                      <RowSwitch
                        checked={!memoryMode && (cfg.show_bank ?? true)}
                        disabled={!isHost || memoryMode}
                        onCheckedChange={(v) => {
                          void patch({ show_bank: v });
                        }}
                      />
                    </SettingRow>
                    <SettingRow
                      label={<Trans>Memory mode</Trans>}
                      title={t`Nobody's counting for you: no bank supply, no scores or card counts on the player cards, and the event log fades as it goes. What stays is what the board can't tell you.`}
                    >
                      <RowSwitch
                        checked={memoryMode}
                        disabled={!isHost}
                        onCheckedChange={(v) => {
                          void patch({ memory_mode: v });
                        }}
                      />
                    </SettingRow>
                    {(() => {
                      // Per-expansion house options: one entry per selected
                      // expansion, writing into cfg.modules[<module>].
                      const panels: { key: keyof Expansions; node: React.ReactNode }[] = [
                        {
                          key: "islands",
                          node: (
                            <>
                              <SettingRow
                                label={<Trans>Island bonus VP</Trans>}
                                title={t`Points for a player's first settlement on each island they reach after setup. 0 turns exploration scoring off.`}
                              >
                                <Stepper
                                  value={islandsOpts.island_vp ?? 2}
                                  onChange={(v) => patchModule("islands", { island_vp: v })}
                                  min={0}
                                  max={4}
                                  disabled={!isHost}
                                />
                              </SettingRow>
                              <div className="flex flex-col gap-1">
                                <SettingRow
                                  label={<Trans>Starting island</Trans>}
                                  title={t`Main island: every starting settlement goes on the main island, and the small islands are what the ships are for. A map of similar-sized islands has no main island, so any island is allowed there. Any island: start wherever you like.`}
                                >
                                  <Segmented<StartIsland>
                                    variant="joined"
                                    disabled={!isHost}
                                    value={islandsOpts.start_island ?? "auto"}
                                    onChange={(v) => patchModule("islands", { start_island: v })}
                                    options={[
                                      {
                                        label: t({
                                          message: "Main island",
                                          context: "starting island setting",
                                        }),
                                        value: "auto",
                                      },
                                      {
                                        label: t({
                                          message: "Any island",
                                          context: "starting island setting",
                                        }),
                                        value: "any",
                                      },
                                    ]}
                                  />
                                </SettingRow>
                                {startRule === "archipelago" && (
                                  <span className="self-end text-xs text-muted">
                                    <Trans>
                                      This map has no main island, so any island is allowed
                                    </Trans>
                                  </span>
                                )}
                              </div>
                              <SettingRow
                                label={<Trans>Pirate</Trans>}
                                title={t`Off: a 7 always moves the land robber, and there is no pirate at sea.`}
                              >
                                <RowSwitch
                                  checked={islandsOpts.pirate ?? true}
                                  disabled={!isHost}
                                  onCheckedChange={(v) => patchModule("islands", { pirate: v })}
                                />
                              </SettingRow>
                            </>
                          ),
                        },
                        {
                          key: "knights",
                          node: (
                            <>
                              <SettingRow
                                label={<Trans context="table setting">Skip first attack</Trans>}
                                title={t`The barbarians' first landfall does no harm: no city is razed and no defender is rewarded.`}
                              >
                                <RowSwitch
                                  checked={!!knightsOpts.skip_first_barbarian_attack}
                                  disabled={!isHost}
                                  onCheckedChange={(v) =>
                                    patchModule("cak", { skip_first_barbarian_attack: v })
                                  }
                                />
                              </SettingRow>
                              <div className="flex flex-col gap-1">
                                <SettingRow
                                  label={<Trans>Barbarian distance</Trans>}
                                  title={t`How many ship faces of the event die the fleet needs to reach the island. Shorter means earlier and more frequent attacks.`}
                                >
                                  <Stepper
                                    value={knightsOpts.barbarian_distance || 7}
                                    onChange={(v) => patchModule("cak", { barbarian_distance: v })}
                                    min={4}
                                    max={12}
                                    disabled={!isHost}
                                  />
                                </SettingRow>
                                {(knightsOpts.barbarian_distance || 7) !== recBarbDist && (
                                  <RecHint
                                    label={<Trans>recommended: {recBarbDist}</Trans>}
                                    onUse={
                                      isHost
                                        ? () =>
                                            patchModule("cak", { barbarian_distance: recBarbDist })
                                        : undefined
                                    }
                                  />
                                )}
                              </div>
                              {/* A display switch among rules switches: the
                                  tracks it hides exist only under Knights, so it
                                  appears and disappears with the expansion. */}
                              <SettingRow
                                label={<Trans>Show city improvements</Trans>}
                                title={t`Show every player's Trade / Politics / Science levels on their card in the player rail. Turn off to keep the race to each metropolis to yourselves.`}
                              >
                                <RowSwitch
                                  checked={cfg.show_improvements ?? true}
                                  disabled={!isHost}
                                  onCheckedChange={(v) => {
                                    void patch({ show_improvements: v });
                                  }}
                                />
                              </SettingRow>
                            </>
                          ),
                        },
                      ];
                      const active = panels.filter((p) => exp[p.key]);
                      if (active.length === 0) return null;
                      return (
                        <div className="flex flex-col gap-1.5">
                          <SectionLabel>
                            <Trans>Expansion options</Trans>
                          </SectionLabel>
                          {/* rows sit gap-3 apart to match the rest of the settings list */}
                          <div className="flex flex-col gap-3">
                            {active.map((p) => (
                              <React.Fragment key={p.key}>{p.node}</React.Fragment>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </ScrollFade>
                </div>
              )}
            </div>

            {/* table chat; sits directly under the settings panel */}
            <div
              className={cn(
                "bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3 flex flex-col gap-1.5 text-[13px] shrink-0 min-h-45",
                /* In the column layout chat gets up to 240px and settings take
                   the rest. On a landscape phone that starved the settings, so
                   the height is capped at 35% of the column, and the base
                   min-height is lowered too (a min-height beats a max-height).
                   Above ~700px of column the cap never binds. */
                "lg:max-h-[35%] lg:min-h-27.5",
                /* An empty chat is one placeholder line and a composer, so it
                   stays short until someone speaks, leaving room for the
                   settings above. */
                chat.length === 0 ? "lg:h-32.5" : "lg:h-60",
                // The page scrolls on a sideways phone, so there is no column
                // height for the percentage: the pane keeps the fixed height and
                // scrolls inside.
                "squat:max-h-none!",
              )}
            >
              <div className="ui-label shrink-0">
                <Trans>Table chat</Trans>
              </div>
              <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-y-auto">
                {chat.length === 0 && (
                  <div className="text-muted2 text-[13px]">
                    <Trans>Say hi to your table…</Trans>
                  </div>
                )}
                {chat.map((c, i) => (
                  <div key={c.id ?? i} className="group flex items-baseline gap-1 text-[13px]">
                    <span>
                      <b
                        className="font-semibold text-(--swatch)"
                        style={{ "--swatch": avatarColor(c.user_id) } as React.CSSProperties}
                      >
                        {c.from}
                      </b>
                      :{" "}
                      {/* Same drawing as the in-game feed: the table already
                          talks trade before the first roll. */}
                      <ChatText msg={c.msg} commodities={exp.knights} />
                    </span>
                    {c.id != null && c.user_id !== me?.id && (
                      <button
                        type="button"
                        aria-label={t`Report message`}
                        className="opacity-0 group-hover:opacity-100 text-(--muted-foreground) hover:text-(--destructive) leading-none"
                        onClick={() => {
                          gameSocket.report(c.id!);
                          toast.info(t`Report submitted`);
                        }}
                      >
                        ⚑
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <ChatInput onSend={(msg) => gameSocket.chat(`game:${g}`, msg)} />
            </div>

            {/* Start and status, pinned to the bottom of the side panel. On a
                phone held sideways the page scrolls (see the root), so the row
                is pinned to the bottom of the screen instead. */}
            <div
              ref={setStartRow}
              className="shrink-0 flex flex-col gap-1.5 squat:sticky squat:bottom-0 squat:z-10 squat:bg-background squat:pt-2 squat:pb-1"
            >
              {isHost ? (
                <Button
                  onClick={() => {
                    void start();
                  }}
                  // The screen's one filled action: amber (Button's default).
                  className="w-full"
                  size="lg"
                  // The host's own socket must be up: the `started` frame
                  // moves everyone into the game, and a host who missed it
                  // would wait in the lobby for the resync poll.
                  disabled={seats.length < MIN_PLAYERS || !socketReady}
                >
                  {socketReady ? <Trans>Start game</Trans> : <Trans>Connecting…</Trans>}
                </Button>
              ) : (
                <div className="w-full bg-page-inset border border-rim rounded-control py-3 text-center text-[14px] font-medium text-muted">
                  <Trans>Waiting for host…</Trans>
                </div>
              )}
              <div className="text-[12px] text-on-background-muted text-center">
                {/* Same gate as the Start button, from the same constant. */}
                <Trans>
                  {seatedCount} seated · {openSeats} open
                </Trans>{" "}
                {seats.length < MIN_PLAYERS && <Trans>· need {MIN_PLAYERS} to start</Trans>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!promoteTarget} onOpenChange={(o) => !o && setPromoteTarget(null)}>
        <DialogContent className="w-95 flex flex-col gap-3">
          <DialogTitle size="lg">
            <Trans>Make host?</Trans>
          </DialogTitle>
          <DialogDescription className="leading-[1.4]">
            <Trans>
              {promoteName} will become the host and take over the lobby controls. You'll keep your
              seat but lose host powers.
            </Trans>
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPromoteTarget(null)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              size="sm"
              /* Fill only. `text-main-foreground` would override the primary
                 variant's `text-ink` through tailwind-merge and put white on
                 amber at 1.83:1; see button.tsx's `fill` prop. */
              className="bg-amber"
              onClick={() => {
                if (promoteTarget) void transferHost(promoteTarget.user_id);
              }}
            >
              <Trans>Make host</Trans>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// SeatSettings is the player's own name, color and decoration controls, behind
// a sparkle button in the top-left of their seat card.
//
// It is the table's counterpart to the store (components/StoreShelves.tsx):
// it picks from what you already own, for this table, and knows which colours
// other seats have taken. Name is a per-game override (it never changes a
// registered account's name); color availability (free / supporter / kept)
// comes from the server with seated colours disabled; decoration comes from the
// loadout, so picking one equips it on the account and the server broadcasts
// the change.
function SeatSettings({
  seat,
  taken,
  onSetName,
  onSetColor,
  onSetDecoration,
}: {
  seat: Seat;
  taken: string[];
  onSetName: (name: string) => void;
  onSetColor: (id: string) => void;
  onSetDecoration: (id: string) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(seat.user_name);
  React.useEffect(() => setName(seat.user_name), [seat.user_name]);
  const { data } = useQuery({
    queryKey: ["colors"],
    queryFn: api.colors,
    staleTime: 60_000,
    enabled: open,
  });
  const cosmeticsQ = useQuery({
    queryKey: ["cosmetics"],
    queryFn: api.cosmetics,
    staleTime: 60_000,
    enabled: open,
  });
  const colors = data?.colors ?? [];
  // Show every decoration as a teaser except staff-only ones, which stay
  // hidden unless owned (as on the store's shelves: no player can get one).
  // Current = the seat's live decoration.
  const decorations = (cosmeticsQ.data?.items ?? []).filter(
    (i) => i.slot === "decoration" && (!i.staff || i.owned),
  );
  const currentDecoration = seat.decoration ?? "";

  function commitName() {
    const n = name.trim();
    if (n !== seat.user_name) onSetName(n);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        title={t`Your name, color & decoration`}
        aria-label={t`Seat cosmetics`}
        className="absolute top-2 left-2 w-7 h-7 rounded-full bg-secondary-background text-foreground border border-border flex items-center justify-center shadow-hard-sm transition-colors hover:bg-elev cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkle weight="bold" size={13} />
      </button>
      <DialogContent className="w-105 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <DialogTitle size="lg">
            <Trans>Your seat</Trans>
          </DialogTitle>
          {/* The one dialog close: an IconButton piece, top right. */}
          <DialogClose asChild>
            <IconButton aria-label={t`Close`} title={t`Close`} className="ml-auto">
              <X weight="bold" size={16} />
            </IconButton>
          </DialogClose>
        </div>

        <div className="text-[13px] font-semibold">
          <Trans context="the player's display name">Name</Trans>
        </div>
        <div className="flex gap-1.5">
          <input
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
            }}
            placeholder={t`Your name`}
            className="flex-1 min-w-0 bg-secondary-background border border-border rounded-lg px-2.5 py-1.5 text-[14px] font-medium placeholder:text-muted2 shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          />
          <Button
            variant="secondary"
            size="field"
            pill={false}
            onClick={commitName}
            disabled={name.trim() === seat.user_name}
          >
            <Trans>Save</Trans>
          </Button>
        </div>

        <div className="text-[13px] font-semibold mt-1">
          <Trans context="the player's piece color">Color</Trans>
        </div>
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5">
          {colors.map((c) => {
            const isCurrent = c.hex.toLowerCase() === seat.color.toLowerCase();
            // Mirror the server's distinctness gate (cosmetics ΔE2000 ≥
            // threshold): a swatch too close to another player's color is not
            // selectable.
            const isClash = !isCurrent && tooSimilar(c.hex, taken);
            const disabled = !c.available || isClash;
            return (
              <button
                key={c.id}
                disabled={disabled}
                onClick={() => onSetColor(c.id)}
                /* The catalog color name stays English; only the parenthetical
                   reason is translated. */
                title={
                  !c.available
                    ? t`${c.name} (supporter color)`
                    : isClash
                      ? t`${c.name} (too close to another player's color)`
                      : c.name
                }
                data-swatch-edge={disabled ? undefined : swatchEdge(c.hex)}
                className={cn(
                  "aspect-square w-full min-w-0 rounded-[5px]",
                  isCurrent && SWATCH_PICKED,
                  disabled
                    ? cn(SWATCH_LOCKED_WELL, "cursor-not-allowed")
                    : "bg-(--swatch) hover:scale-110 transition-transform",
                )}
                style={{ "--swatch": c.hex } as React.CSSProperties}
              >
                {disabled && (
                  <span data-swatch-edge={swatchEdge(c.hex)} className={SWATCH_LOCKED_CHIP} />
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[12px] text-muted leading-[1.45]">
          <Trans>
            Free colors plus your supporter colors. Faded swatches are locked, or too close to
            another player's color.
          </Trans>
        </div>

        <div className="text-[13px] font-semibold mt-1">
          <Trans>Name decoration</Trans>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill
            interactive
            size="md"
            tone={currentDecoration === "" ? "active" : "neutral"}
            aria-pressed={currentDecoration === ""}
            onClick={() => onSetDecoration("")}
          >
            <Trans context="no name decoration equipped">None</Trans>
          </Pill>
          {decorations.map((d) => {
            const active = d.id === currentDecoration;
            if (!d.owned) {
              return (
                <Pill
                  key={d.id}
                  size="md"
                  tone="neutral"
                  /* One message per branch rather than a sentence assembled from
                     a ternary, so translators see each sentence whole. */
                  title={
                    d.booster
                      ? t`${d.name} (boost the server to unlock)`
                      : t`${d.name} (support to unlock)`
                  }
                  caps={false}
                  locked
                >
                  <DecorationPreview decoration={d.id} />
                  {d.name}
                </Pill>
              );
            }
            return (
              <Pill
                key={d.id}
                interactive
                size="md"
                tone={active ? "active" : "neutral"}
                aria-pressed={active}
                title={d.name}
                caps={false}
                onClick={() => onSetDecoration(d.id)}
              >
                <DecorationPreview decoration={d.id} />
                {d.name}
              </Pill>
            );
          })}
        </div>
        <DialogDescription size="note">
          <Trans>
            A sparkle per way you support: pink for boosting, blue for Discord, yellow for Ko-fi.
          </Trans>{" "}
          {/* The /support page links to external payment; hidden inside the
              Discord Activity, where that is broken and against policy. */}
          {!inActivityMode() && (
            <a className="underline" href="/support">
              <Trans>Support →</Trans>
            </a>
          )}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

// onSend returns false when the client-side rate gate blocks the message; the
// typed text is kept and Send is briefly disabled until the 1/sec window
// passes.
function ChatInput({ onSend }: { onSend: (msg: string) => boolean }) {
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
      className="flex gap-2 items-center"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={t`Say something…`}
        maxLength={500}
        className="flex-1 min-w-0 bg-secondary-background border border-border rounded-control px-3.5 py-2 text-[14px] font-medium placeholder:text-muted2 shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 select-text"
      />
      <Button type="submit" size="sm" variant="secondary" className="h-9" disabled={cooling}>
        <Trans context="send a chat message">Send</Trans>
      </Button>
    </form>
  );
}

/**
 * How far above the bottom of the screen a toast has to sit to clear `el`, in
 * layout px, or 0 while `el` is not on screen.
 *
 * The toast stack lives in the bottom-right corner, where the lobby's Start
 * game row is at desktop sizes. That row is the end of a column that scrolls on
 * a phone, so this measures where it is and follows scrolls and resizes (the
 * game screen uses `useToastInset`). Rects and `innerHeight` are in screen px
 * while the stack sits inside the root `zoom` (index.css), so the distance is
 * divided by `--ui-zoom`.
 */
export function useBottomClearance(el: HTMLElement | null): number {
  const [px, setPx] = React.useState(0);
  React.useEffect(() => {
    // Takes the element, not a ref: the Start row mounts after the loading
    // card, and an effect keyed on a ref object would only ever see null.
    if (!el) {
      setPx(0);
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const zoom =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")) || 1;
      const onScreen = r.top < vh && r.bottom > 0;
      // At most half the screen: a row scrolled up to the middle of a phone is
      // not worth lifting every toast over.
      setPx(onScreen ? Math.round(Math.min(vh - r.top, vh / 2) / zoom) : 0);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    // Capture: the lobby scrolls inside an element on a phone, and scroll
    // events do not bubble to the window.
    document.addEventListener("scroll", measure, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [el]);
  return px;
}
