import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Board3D, type Board3DControls } from "@/components/board/Board3D";
import { LogSentence } from "@/components/game/LogLine";
import { describeEventLines } from "@/lib/eventlog";
import { seatColor } from "@/lib/hexgeo";
import { useCbMode, cbSeatColor } from "@/lib/colorblind";
import { usePieceIcons } from "@/lib/usePieceIcons";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { COLUMN_LAYOUT_QUERY } from "@/lib/hudChrome";
import { useReplay } from "@/lib/replay/useReplay";
import type { ReplayFrame, ReplaySource } from "@/lib/replay/types";
import { knightsExt, type FullView } from "@/lib/types";
import { formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { TrackTabs } from "@/components/TrackTabs";
import { Die } from "@/components/board/Die";
import { ResIcon } from "@/components/asset/AssetParts";
import { handChips } from "@/lib/cardFace";
import {
  CaretLeft,
  CaretRight,
  Moon,
  Pause,
  Play,
  SpeakerHigh,
  SpeakerSlash,
  Sun,
} from "@/lib/icons";
import { useAppSettings } from "@/components/SettingsPanel";
import { applyTheme, getStoredPref, resolveTheme } from "@/lib/theme";
import {
  diceSlot,
  eventSound,
  isRepeatPromotion,
  play,
  preload,
  GAME_SOUND_SLOTS,
} from "@/lib/sound";
import { robberAteRoll } from "@/lib/robber";

/**
 * Watching a finished game.
 *
 * The transport is `lib/replay`, the same reducer as the homepage's attract
 * loop; this one only passes different bounds and draws controls.
 *
 * The board is `Board3D`, the game screen's renderer, fed the authoritative
 * view from each frame. Nothing here computes a board.
 */

/** Speeds worth offering: half, real time, and three ways to skim. */
const SPEEDS = [0.5, 1, 2, 4, 8];

const noop = () => {};

export interface ReplaySeat {
  seat: number;
  name: string;
  color?: string;
}

export function ReplayPlayer({
  source,
  seats,
  /** Drawn above the controls: which game this is, and where it came from. */
  title,
}: {
  source: ReplaySource;
  /**
   * Who sat where, when the page knows. A stored game has its roster; an
   * uploaded file doesn't, and its seats are numbered. This only decides what
   * seats are called.
   */
  seats?: ReplaySeat[];
  title: React.ReactNode;
}) {
  const { t } = useLingui();
  const { frame, index, playing, speed, bounds, total, dispatch } = useReplay(source);

  /**
   * The persisted client settings. This screen has no site header, so nothing
   * else pushes the stored sound gate and volume into the audio manager, and
   * `lib/sound` starts muted.
   */
  const settings = useAppSettings();
  React.useEffect(() => {
    preload(GAME_SOUND_SLOTS);
  }, []);

  /**
   * The board's imperative handle, for what a replay has to signal rather than
   * show: chips turning over on a roll, and the robber answering a seven. See
   * `Board3DControls`.
   */
  const boardControls = React.useRef<Board3DControls | null>(null);

  /**
   * The last frame this screen sounded and animated. Cues fire only on a step
   * of exactly one forward (playback or the step button); scrubbing, jumping
   * and stepping back aren't events happening.
   */
  const cued = React.useRef(index);
  React.useEffect(() => {
    const from = cued.current;
    cued.current = index;
    if (index !== from + 1) return;
    const f = source.frames[index];
    const ev = f?.event;
    if (!ev) return;

    if (ev.type === "dice_rolled") {
      const d = ev.data as { d1?: number; d2?: number } | undefined;
      const roll = (d?.d1 ?? 0) + (d?.d2 ?? 0);
      // A different take each roll, jittered, via the same call the game screen
      // makes.
      play(diceSlot(), { jitterCents: 50 });
      if (roll === 7) play("sound_seven", { delay: 0.2 });
      // The board answers too: every chip showing the number turns over; a seven
      // (which no chip carries) turns the robber; and the robber's hex pulses if
      // it was owed something and paid nobody.
      boardControls.current?.flipChips(roll);
      if (roll === 7) boardControls.current?.flipRobber();
      const board = f.view?.board;
      if (board && robberAteRoll(board.tiles, board.robber, roll)) {
        boardControls.current?.pulseRobber();
      }
      return;
    }
    // One card, one thunk: a Smith's two promotions are one act (see
    // `isRepeatPromotion`), which needs the previous frame's index.
    if (isRepeatPromotion(source.frames[index - 1]?.event ?? undefined, ev)) return;
    const cue = eventSound(ev.type);
    if (cue) play(cue.slot, { semitones: cue.semitones });
  }, [index, source.frames]);
  // The same shape test as the homepage and game screen: a column beside the
  // board, or a band beneath it (a 360px rail on a 390px phone left no board).
  const columns = useMediaQuery(COLUMN_LAYOUT_QUERY);
  const cbMode = useCbMode();

  const seatName = React.useCallback(
    (seat: number) => seats?.find((s) => s.seat === seat)?.name ?? t`Seat ${seat + 1}`,
    [seats, t],
  );
  // The board and log agree on colour, and both defer to the viewer's
  // colourblind palette before players' picks: two seats that chose red are
  // still two reds.
  const colorOf = React.useCallback(
    (seat: number) =>
      cbMode !== "off"
        ? cbSeatColor(seat, cbMode)
        : (seats?.find((s) => s.seat === seat)?.color ?? seatColor(seat)),
    [seats, cbMode],
  );
  const pieceIcon = usePieceIcons(React.useMemo(() => (seats ?? []).map((s) => s.color), [seats]));

  // Keyboard controls, with the keys a video player uses.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while the viewer is typing in a field.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === " ") {
        e.preventDefault();
        dispatch({ t: "toggle" });
      } else if (e.key === "ArrowRight") {
        dispatch({ t: "step", by: 1 });
      } else if (e.key === "ArrowLeft") {
        dispatch({ t: "step", by: -1 });
      } else if (e.key === "Home") {
        dispatch({ t: "seek", to: bounds.first });
      } else if (e.key === "End") {
        dispatch({ t: "seek", to: bounds.last });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, bounds]);

  /**
   * The roll standing at the current frame, or none before the first.
   *
   * Searched backwards from the playhead rather than accumulated during
   * playback, since a replay is seekable and the frames give the same answer
   * from either direction.
   *
   * The seq comes with it so the dice are keyed on the roll: two fives in a row
   * are two rolls and must land twice.
   */
  const lastRoll = rollAt(source.frames, index, bounds.first);

  /**
   * Whose cards are open, or none. One seat at a time, off by default; every
   * hand open at once would be too much on screen.
   */
  const [shownSeat, setShownSeat] = React.useState<number | null>(null);

  const islands = source.meta.ruleset.includes("islands");

  return (
    <div className={cn("fixed inset-0 flex bg-background", columns ? "flex-row" : "flex-col")}>
      <div className={columns ? "flex-1 relative" : "relative flex-1 min-h-[46vh]"}>
        <Board3D
          view={frame.view}
          mode="none"
          onVertex={noop}
          onEdge={noop}
          onHex={noop}
          onInspect={noop}
          className="w-full h-full"
          controls
          controlsRef={boardControls}
          // The pieces take the legend's and log's colours, rather than the
          // default seat palette.
          colorOf={colorOf}
          // In bands the board owns its panel and the sheet sits below, so the
          // default bottom inset (HUD_BOTTOM_INSET, sized for the game's dock)
          // would only push the island up.
          hudChrome={columns ? undefined : { left: 0.02, right: 0.02, top: 0.03, bottom: 0.03 }}
        />
      </div>

      <aside
        // The region's one piece (pb-site.css): keyline and edge, drawn over
        // its rows so the log's fills never cover them.
        data-pb-panel="overlay"
        className={cn(
          // A board screen, so the column uses the HUD's material (solid panel,
          // hairline rows, amber primary) rather than a site card.
          "hud-root shrink-0 flex flex-col bg-(--hud-fill-solid) shadow-(--hud-shadow) z-[1]",
          columns ? "w-90 border-l border-(--hud-rim)" : "border-t border-(--hud-rim) max-h-[54vh]",
        )}
      >
        <div className="px-4 py-3.5 border-b border-line">{title}</div>

        <div className="px-4 py-3.5 border-b border-line flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              // 44px on a sideways phone. The one filled control on this screen.
              className="hud-primary h-8 px-4 grid place-items-center cursor-pointer squat:h-11 squat:px-5"
              onClick={() => dispatch({ t: "toggle" })}
              aria-label={playing ? t`Pause` : t`Play the replay`}
            >
              {/* Icon only, like the step buttons beside it: the transport glyphs
                  are universal, the aria-label carries the word, and the button
                  doesn't resize per toggle or language. */}
              {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
            </button>
            <button
              type="button"
              className="hud-secondary h-8 px-3 grid place-items-center cursor-pointer squat:h-11 squat:px-5"
              onClick={() => dispatch({ t: "step", by: -1 })}
              aria-label={t`Step back one move`}
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            <button
              type="button"
              className="hud-secondary h-8 px-3 grid place-items-center cursor-pointer squat:h-11 squat:px-5"
              onClick={() => dispatch({ t: "step", by: 1 })}
              aria-label={t`Step forward one move`}
            >
              <CaretRight size={16} weight="bold" />
            </button>
            {/* What the dice said. Keyed on the roll so it remounts and replays
                its landing animation every time, including a repeated pair. */}
            {lastRoll && (
              <span key={lastRoll.seq} className="die-tumble flex items-center gap-1 ml-1">
                <Die n={lastRoll.d1} variant="white" size={24} />
                <Die n={lastRoll.d2} variant="red" size={24} />
              </span>
            )}
            {/* Theme and sound switches. Elsewhere they are in the site header's
                Settings panel, but this screen has no header (a full-bleed board
                and scrubber), and watching is when they're most wanted. */}
            <span className="ml-auto flex items-center gap-1.5">
              <ThemeToggle />
              <SoundToggle on={settings.sounds} onChange={settings.toggleSounds} />
            </span>
            <span className="font-num text-[11px] text-muted tabular-nums">
              {formatNumber(index - bounds.first + 1)} / {formatNumber(total)}
            </span>
          </div>

          <input
            type="range"
            min={bounds.first}
            max={bounds.last}
            value={index}
            onChange={(e) => dispatch({ t: "seek", to: Number(e.target.value) })}
            className="w-full h-6 accent-(--hud-primary)"
            aria-label={t`Move through the game`}
          />

          <div className="flex items-center gap-2 text-[12px] font-semibold flex-wrap">
            <span className="hud-lab">
              <Trans context="playback speed">Speed</Trans>
            </span>
            {/* The track look every toggle group shares: a flat well, the
                chosen speed as the yellow tile. */}
            <TrackTabs
              size="sm"
              optionClassName="font-num tabular-nums squat:min-h-10 squat:min-w-10"
              options={SPEEDS.map((sp) => ({ label: <>{formatNumber(sp)}&times;</>, value: sp }))}
              value={speed}
              onChange={(to) => dispatch({ t: "speed", to })}
            />
          </div>
        </div>

        <HandPanel
          view={frame.view}
          seatName={seatName}
          colorOf={colorOf}
          open={shownSeat}
          onOpen={setShownSeat}
        />

        <ReplayFeed
          frames={source.frames}
          index={index}
          first={bounds.first}
          seatName={seatName}
          colorOf={colorOf}
          pieceIcon={pieceIcon}
          islands={islands}
          onSeek={(to) => dispatch({ t: "seek", to })}
        />
      </aside>
    </div>
  );
}

/**
 * What has happened so far, newest last, scrolled to the frame in hand. Uses
 * the game screen's `describeEventLines` and `LogSentence`, so lines read as
 * they did at the table, in the viewer's language.
 */
function ReplayFeed({
  frames,
  index,
  first,
  seatName,
  colorOf,
  pieceIcon,
  islands,
  onSeek,
}: {
  frames: ReplayFrame[];
  index: number;
  first: number;
  seatName: (seat: number) => string;
  colorOf: (seat: number) => string;
  pieceIcon: ReturnType<typeof usePieceIcons>;
  islands: boolean;
  onSeek: (to: number) => void;
}) {
  const hereRef = React.useRef<HTMLButtonElement | null>(null);
  // Follow the playhead within the feed only: `block: "nearest"` scrolls the
  // pane, not the page, which in the bands layout would drag the board away.
  React.useEffect(() => {
    hereRef.current?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // Only what has been played, no spoilers.
  const rows: React.ReactNode[] = [];
  // The terrain for lines naming a hex (a Raiders landing, battle or conquest),
  // from the last frame: one stable object (a per-frame board would defeat
  // describeEventLines' cache), and any hex a line names is on it by then.
  const tiles = frames[frames.length - 1]?.view?.board?.tiles;
  for (let i = first; i <= index; i++) {
    const f = frames[i];
    if (!f.event) continue;
    const lines = describeEventLines(f.event, seatName, islands, { tiles });
    if (!lines.length) continue;
    rows.push(
      <button
        key={f.seq}
        ref={i === index ? hereRef : undefined}
        onClick={() => onSeek(i)}
        className={cn(
          "w-full text-left px-4 py-1.5 text-[12.5px] border-b border-line cursor-pointer",
          i === index ? "bg-(--hud-well) text-foreground" : "text-muted hover:text-foreground",
        )}
      >
        {lines.map((line, j) => (
          <LogSentence key={j} line={line} colorOf={colorOf} pieceIcon={pieceIcon} />
        ))}
      </button>,
    );
  }
  return (
    <div className="flex-1 overflow-auto min-h-0">
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-[13px] text-muted">
          <Trans>The game starts here. Press play.</Trans>
        </div>
      ) : (
        rows
      )}
    </div>
  );
}

/**
 * Light and dark, one click, for a screen with no Settings panel. Writes
 * through `lib/theme` (localStorage "theme" and the root class) with the same
 * two-way cycle as the in-game HUD orb; "system" stays in Settings. A click
 * flips away from what `system` currently resolves to, so it always changes
 * the theme.
 */
function ThemeToggle() {
  const { t } = useLingui();
  const [, forceRender] = React.useState(0);
  const prefersDark =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(getStoredPref(), prefersDark);
  const label = resolved === "dark" ? t`Switch to light mode` : t`Switch to dark mode`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        applyTheme(resolved === "dark" ? "light" : "dark");
        // Flipping the DOM class doesn't schedule a render, and this button draws
        // its icon from the theme it just changed.
        forceRender((n) => n + 1);
      }}
      className="hud-secondary h-7 w-7 grid place-items-center text-muted hover:text-foreground cursor-pointer"
    >
      {resolved === "dark" ? <Moon weight="bold" size={14} /> : <Sun weight="bold" size={14} />}
    </button>
  );
}

/**
 * The sound gate, written through the same persisted setting the Settings
 * panel owns, so muting here is muting everywhere and survives the tab.
 */
function SoundToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const { t } = useLingui();
  const label = on ? t`Mute the replay` : t`Turn the sound on`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className="hud-secondary h-7 w-7 grid place-items-center text-muted hover:text-foreground cursor-pointer"
    >
      {on ? <SpeakerHigh weight="bold" size={14} /> : <SpeakerSlash weight="bold" size={14} />}
    </button>
  );
}

/**
 * The roll standing at `index`, searched backwards to `first`, or none before
 * the game's first. A plain function rather than `useMemo`: the React compiler
 * memoises derived values, and won't preserve a hand-written memo here. See
 * `lastRoll` for why it is a search.
 */
function rollAt(
  frames: ReplayFrame[],
  index: number,
  first: number,
): { seq: number; d1: number; d2: number } | null {
  for (let i = index; i >= first; i--) {
    const ev = frames[i]?.event;
    if (ev?.type !== "dice_rolled") continue;
    const d = ev.data as { d1?: number; d2?: number } | undefined;
    return { seq: frames[i].seq, d1: d?.d1 ?? 0, d2: d?.d2 ?? 0 };
  }
  return null;
}

/**
 * Whose hand, on demand. The server folds a finished game with nothing hidden
 * (replay.FoldRevealed), so a replay can show what each player held.
 *
 * One seat at a time, closed until asked; clicking the open seat closes it.
 * Every hand open at once would crowd out the log.
 *
 * The cards come from the frame, so they are the hand at the playhead;
 * scrubbing back through a trade shows the hand before it.
 */
function HandPanel({
  view,
  seatName,
  colorOf,
  open,
  onOpen,
}: {
  view: FullView;
  seatName: (seat: number) => string;
  colorOf: (seat: number) => string;
  open: number | null;
  onOpen: (seat: number | null) => void;
}) {
  const players = view.players ?? [];
  if (players.length === 0) return null;
  const shown = open != null ? players[open] : undefined;
  // Commodities too when the ruleset has them, so a Knights hand is complete.
  // `handChips` draws whichever are non-empty.
  const coms = open != null ? knightsExt(view)?.players?.[open]?.commodities : undefined;
  const chips = shown ? handChips(shown.hand, coms) : [];
  const devs = shown
    ? (shown.dev_cards?.reduce((a, b) => a + b, 0) ?? 0) +
      (shown.new_dev_cards?.reduce((a, b) => a + b, 0) ?? 0)
    : 0;

  return (
    <div className="px-4 py-3 border-b border-line flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {players.map((p, seat) => (
          <button
            key={seat}
            type="button"
            onClick={() => onOpen(open === seat ? null : seat)}
            aria-pressed={open === seat}
            className={cn(
              "flex items-center gap-1.5 rounded-lg pl-2 pr-2.5 py-1 text-[12px] font-semibold max-w-[46%] cursor-pointer",
              open === seat
                ? "bg-(--hud-raised) text-foreground shadow-[inset_0_0_0_1px_var(--hud-edge)]"
                : "bg-(--hud-well) text-muted hover:text-foreground",
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0 bg-(--swatch)"
              style={{ "--swatch": colorOf(seat) } as React.CSSProperties}
            />
            <span className="truncate">{seatName(seat)}</span>
            {/* The count is public, so it stays on the chip for closed seats too;
                it tells you which hand is worth opening. */}
            <span className="font-num tabular-nums opacity-70">{p.hand_count}</span>
          </button>
        ))}
      </div>
      {shown && (
        <div className="flex items-center gap-2.5 flex-wrap text-[12px] font-semibold">
          {chips.length === 0 ? (
            <span className="text-muted font-normal">
              <Trans context="a player is holding no resource cards">Empty hand</Trans>
            </span>
          ) : (
            chips.map((c) => (
              <span key={c.key} className="flex items-center gap-0.5" title={c.name}>
                <ResIcon slot={c.slot} size={18} />
                <span className="font-num tabular-nums">{formatNumber(c.n)}</span>
              </span>
            ))
          )}
          <span className="ml-auto text-muted font-normal font-num tabular-nums">
            <Trans>
              {formatNumber(devs)} dev, {formatNumber(shown.vp)} VP
            </Trans>
          </span>
        </div>
      )}
    </div>
  );
}
