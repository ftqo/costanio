import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { cn } from "@/lib/utils";

// Pip layout per face on a 3×3 grid (indices 0..8, row-major).
const DIE_PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// A code-drawn pip die. Two dice per roll: white (d1) and red (d2); the engine
// designates d2 as red. Always code-drawn, since a per-face asset slot can't
// encode the red/white pairing. `size` scales the whole die (default 36px, the
// dock size).
export function Die({
  n,
  variant = "white",
  size = 36,
}: {
  n: number;
  variant?: "white" | "red";
  size?: number;
}) {
  const { t } = useLingui();
  const red = variant === "red";
  // Dice keep their colours in both themes (the face dims a step at night).
  // Tokens live in index.css.
  const pip = red ? "var(--die-red-pip)" : "var(--die-pip)";
  const dot = Math.round(size * 0.139);
  return (
    <div
      // One message per die rather than a "red " prefix, since word order
      // differs between languages.
      aria-label={red ? t`red die: ${n}` : t`die: ${n}`}
      className={cn("grid grid-cols-3 grid-rows-3")}
      // A dock die is a piece; the log's inline die is print (index.css).
      data-die={size >= 30 ? "dock" : "inline"}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        padding: dot,
        background: red ? "var(--die-red)" : "var(--die-face)",
        // Drop shadow only at dock size, not the log's inline die.
        boxShadow:
          size >= 30
            ? "0 0 0 1px var(--card-edge), 0 4px 10px rgb(0 0 0 / 0.22)"
            : "0 0 0 1px var(--card-edge)",
      }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="flex items-center justify-center">
          {DIE_PIPS[n]?.includes(i) && (
            <span className="rounded-full" style={{ width: dot, height: dot, background: pip }} />
          )}
        </span>
      ))}
    </div>
  );
}

// Knights event die: a coloured face (ship/trade/politics/science) rolled
// alongside the number dice. Shared by the dock and the log so both agree on
// face colours.
const EVENT_DIE_COLOR: Record<string, string> = {
  // Its own token (styles/pb-hud.css), lifted a step at night so the navy
  // face still separates from a dark panel.
  ship: "var(--event-ship, var(--color-ink))",
  trade: "var(--color-yellow)",
  politics: "var(--color-blue)",
  science: "var(--color-green)",
};

/**
 * What each face is called. Descriptors rather than strings because this table
 * is evaluated once at import, and a string would freeze the language then.
 */
const EVENT_FACE_NAME: Record<string, MessageDescriptor> = {
  ship: msg({ message: "ship", context: "event die face" }),
  trade: msg({ message: "trade", context: "event die face" }),
  politics: msg({ message: "politics", context: "event die face" }),
  science: msg({ message: "science", context: "event die face" }),
};

export function EventDie({ face, size = 36 }: { face: string; size?: number }) {
  const { t } = useLingui();
  // Empty face = unrolled: a blank light face matching the white die.
  const background = face ? (EVENT_DIE_COLOR[face] ?? EVENT_DIE_COLOR.ship) : "var(--die-face)";
  // An unknown face falls back to the wire value.
  const name = face ? (EVENT_FACE_NAME[face] ? i18n._(EVENT_FACE_NAME[face]) : face) : "";
  const glyph = Math.round(size * 0.62);
  return (
    <div
      title={face ? t`event: ${name}` : t`event die`}
      aria-label={face ? t`event die: ${name}` : t`event die: unrolled`}
      className="hud-event-die"
      data-face={face || undefined}
      // A dock die is a piece, the log's inline die print, as for Die.
      data-die={size >= 30 ? "dock" : "inline"}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        background,
        boxShadow:
          size >= 30
            ? "0 0 0 1px var(--card-edge), 0 4px 10px rgb(0 0 0 / 0.22)"
            : "0 0 0 1px var(--card-edge)",
      }}
    >
      {/* A glyph as well as the colour, for players who can't tell the track
          colours apart. Ship is the fleet silhouette; the three tracks share
          the city gate. */}
      {face === "ship" ? (
        <EventShip size={glyph} />
      ) : face && EVENT_DIE_COLOR[face] ? (
        <EventGate size={glyph} />
      ) : null}
    </div>
  );
}

function EventShip({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="-10 -11 20 20" aria-hidden fill="currentColor">
      <path d="M -8 2.5 L 8 2.5 L 5.4 8 L -5.4 8 Z" />
      <path d="M -0.8 -10 L 0.8 -10 L 0.8 2.5 L -0.8 2.5 Z" />
      <path d="M 0.8 -9 L 6.6 1 L 0.8 1 Z" />
      <path d="M -0.8 -6.6 L -5.2 1 L -0.8 1 Z" opacity="0.6" />
    </svg>
  );
}

function EventGate({ size }: { size: number }) {
  // A gatehouse: two towers, the arch between them, crenels on top.
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden fill="currentColor">
      <path
        fillRule="evenodd"
        d="M3 18 V5 H5 V3.5 H7 V5 H9 V3.5 H11 V5 H13 V3.5 H15 V5 H17 V18 Z M7.5 18 V12 A2.5 2.5 0 0 1 12.5 12 V18 Z"
      />
    </svg>
  );
}
