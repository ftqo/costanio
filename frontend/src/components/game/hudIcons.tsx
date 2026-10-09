import type { ReactNode } from "react";
import {
  Boot,
  Bridge,
  Coins,
  Fish,
  LockSimple,
  Stack,
  Wall,
  Skull,
  Path,
  House,
  Buildings,
  Boat,
  Compass,
  HandDeposit,
  Certificate,
  ShieldCheck,
  ShieldWarning,
} from "@/lib/icons";
import type { Icon } from "@phosphor-icons/react";

// One icon per game concept, in a single weight, so the HUD shares one visual
// language. Game art (resource/commodity/piece slots) is used directly where it
// exists; these cover abstract concepts with no card art.
const W = "bold" as const;
const mk = (I: Icon) =>
  function HudIcon({ size = 14 }: { size?: number }) {
    return <I size={size} weight={W} />;
  };

// A few glyphs are vendored from Tabler (MIT) rather than adding a second icon
// dependency: playing cards for the card counts, crossed swords, a shielded
// house.
//
// Tabler draws at stroke-width 2 on a 24px grid, which looks lighter than the
// Phosphor `bold` icons beside it at 11-14px; 2.5 matches by eye at those
// sizes. The arithmetic match (Phosphor bold's 24/256 stroke on Tabler's 24) is
// 2.25, which reads right from 16px up, so callers drawing bigger pass their
// own.
const tabler = (body: ReactNode, filled = false, stroke = 2.5) =>
  function TablerIcon({ size = 14 }: { size?: number }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? "currentColor" : "none"}
        stroke={filled ? "none" : "currentColor"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {body}
      </svg>
    );
  };

// tabler/play-card (filled)
const PlayCard = tabler(
  <path d="M17 2a2.995 2.995 0 0 1 2.995 2.898q .005 .05 .005 .102v14a3 3 0 0 1 -3 3h-10a3 3 0 0 1 -3 -3v-14a3 3 0 0 1 3 -3zm-.99 15h-.01a1 1 0 0 0 0 2h.01a1 1 0 0 0 0 -2m-3.21 -9.6a1 1 0 0 0 -1.6 0l-3 4a1 1 0 0 0 0 1.2l2.988 3.984l.012 .016q .007 .01 .017 .02a.5 .5 0 0 0 .077 .086l.016 .018l.018 .016q .025 .024 .052 .043l.025 .02a.5 .5 0 0 0 .084 .056l.056 .03q .016 .01 .033 .018l.043 .017a.4 .4 0 0 0 .074 .028a.9 .9 0 0 0 .305 .047h.047a1 1 0 0 0 .095 -.01a1 1 0 0 0 .163 -.037l.025 -.008l.049 -.02a.3 .3 0 0 0 .076 -.034a.5 .5 0 0 0 .08 -.046a1 1 0 0 0 .085 -.06a.5 .5 0 0 0 .086 -.078l.018 -.016l.016 -.018l.043 -.052l.017 -.02l.009 -.012l2.991 -3.988a1 1 0 0 0 0 -1.2zm-4.79 -2.4h-.01a1 1 0 1 0 0 2h.01a1 1 0 1 0 0 -2" />,
  true,
);

// tabler/play-card-star (outline), kept as an outline: in a base game it sits
// beside the filled hand-count card, and two solid cards differing only by a
// punched glyph are hard to tell apart at 14px.
const PlayCardStar = tabler(
  <>
    <path d="M19 5v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2" />
    <path d="M8 6h.01" />
    <path d="M16 18h.01" />
    <path d="M11.75 14.112l-1.63 .853a.294 .294 0 0 1 -.425 -.307l.31 -1.808l-1.317 -1.28a.292 .292 0 0 1 .163 -.499l1.82 -.264l.815 -1.644a.294 .294 0 0 1 .527 0l.814 1.644l1.82 .264a.292 .292 0 0 1 .164 .499l-1.318 1.28l.31 1.807a.292 .292 0 0 1 -.425 .308l-1.628 -.853" />
  </>,
);

// tabler/swords
const Swords = tabler(
  <>
    <path d="M21 3v5l-11 9l-4 4l-3 -3l4 -4l9 -11l5 0" />
    <path d="M5 13l6 6" />
    <path d="M14.32 17.32l3.68 3.68l3 -3l-3.365 -3.365" />
    <path d="M10 5.5l-2 -2.5h-5v5l3 2.5" />
  </>,
);

// tabler/road, for the route-length counter: a carriageway with its centre
// line, the thing being measured. Phosphor's Path (Icons.road below) suits the
// title chip.
const Road = tabler(
  <>
    <path d="M4 19l4 -14" />
    <path d="M16 5l4 14" />
    <path d="M12 8v-2" />
    <path d="M12 13v-2" />
    <path d="M12 18v-2" />
  </>,
);

// tabler/anchor, for the Harbormaster card and the harbour-point counter. A
// symbol that reads at 11-14px and can't be confused with Islands' boat or the
// fish in the same row.
const Anchor = tabler(
  <>
    <path d="M12 9v12m-8 -8a8 8 0 0 0 16 0m1 0h-2m-14 0h-2" />
    <path d="M12 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
  </>,
);

// tabler/home-shield
const HomeShield = tabler(
  <>
    <path d="M5 12h-2l9 -9l7.636 7.636" />
    <path d="M5 12v7a2 2 0 0 0 2 2h5" />
    <path d="M9 21v-6a2 2 0 0 1 2 -2h1.5" />
    <path d="M22 16c0 4 -2.5 6 -3.5 6s-3.5 -2 -3.5 -6c1 0 2.5 -.5 3.5 -1.5c1 1 2.5 1.5 3.5 1.5" />
  </>,
);

// tabler/focus-2, a reticle on its subject: the HUD's "Reset view" orb.
// Exported separately because it names chrome (a camera control), not a game
// concept. Phosphor's FrameCorners reads as "go fullscreen"; the reticle
// points at a centre.
export const ResetView = tabler(
  <>
    {/* The centre dot is a filled sub-path in Tabler's source; this attribute
        overrides the svg's fill="none" for that path alone. */}
    <path d="M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" />
    <path d="M5 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
    <path d="M12 3l0 2" />
    <path d="M3 12l2 0" />
    <path d="M12 19l0 2" />
    <path d="M19 12l2 0" />
  </>,
  false,
  // Drawn at 16px in an orb beside Phosphor `bold` glyphs, so it takes the
  // arithmetic match rather than the small-size default above.
  2.25,
);

// Seat-stat glyphs on a 16px grid, as filled shapes so they read at 13-16px on
// the smoked panel: a development card with a punched star, a knight's shield,
// a road bar. Punched details use the panel's solid fill, so they read as holes
// in either theme.
function filledGlyph(body: ReactNode) {
  return function FilledGlyph({ size = 16 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        {body}
      </svg>
    );
  };
}
const DevCardGlyph = filledGlyph(
  <>
    <rect x="3" y="1.5" width="10" height="13" rx="2" fill="currentColor" />
    <path
      d="M8 5l1 2 2 .3-1.5 1.4.4 2.1L8 9.8 6.1 10.8l.4-2.1L5 7.3 7 7z"
      fill="var(--hud-fill-solid)"
    />
  </>,
);
const KnightShield = filledGlyph(
  <>
    <path d="M8 1.5 13.5 3.5v4c0 3.4-2.4 5.9-5.5 7-3.1-1.1-5.5-3.6-5.5-7v-4z" fill="currentColor" />
    <path
      d="M8 4.5v7M5.5 7h5"
      stroke="var(--hud-fill-solid)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </>,
);
const RoadBar = filledGlyph(
  <rect
    x="1"
    y="6.5"
    width="14"
    height="3.4"
    rx="1.2"
    transform="rotate(-30 8 8)"
    fill="currentColor"
  />,
);

/**
 * Gold: three bars of bullion stacked two and one, with a glint.
 *
 * Drawn on Phosphor's 256 grid at `bold` weight (24-unit stroke, round caps and
 * joins) to match `coin`, `fish` and `boot`. Bars rather than a coin because
 * gold and Rivers coins can share a screen and must differ in silhouette. The
 * filled glint is what says "gold" rather than "bricks" at 14px.
 */
function GoldBars({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={24}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-glyph="gold"
    >
      <path d="M22 214 44 152h66l22 62Z" />
      <path d="M124 214 146 152h66l22 62Z" />
      <path d="M72 152 94 90h66l22 62" />
      <path
        d="M206 20q5.4 24.6 30 30-24.6 5.4-30 30-5.4-24.6-30-30 24.6-5.4 30-30Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/**
 * A hand's size as a small fan of card backs: one to four, so a glance says
 * "a few" or "a lot" before the number beside it is read. Decorative; the
 * count and its label carry the meaning.
 */
export function CardFan({ n }: { n: number }) {
  const backs = Math.max(1, Math.min(4, n));
  return (
    // An empty hand still draws one back, faded, so the stat keeps its shape.
    <span className="hud-fan" aria-hidden style={n <= 0 ? { opacity: 0.35 } : undefined}>
      {Array.from({ length: backs }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

export const Icons = {
  hand: PlayCard, // resource cards held
  dev: PlayCardStar, // development cards
  progress: PlayCardStar, // progress cards (Knights)
  commodity: mk(Stack), // commodity cards (Knights)
  knight: Swords, // knights
  // The seat panel's stat row: card with a star, shield, road.
  devCard: DevCardGlyph,
  knightShield: KnightShield,
  roadBar: RoadBar,
  wall: mk(Wall), // city walls
  defender: HomeShield, // Defender of the realm (the award chip on a seat card)
  // The raid verdict, as a pair that differs in shape as well as colour: a tick
  // when the knights cover the cities, a warning when they don't. Same family
  // as the award glyph above but a different picture.
  shieldOk: mk(ShieldCheck), // the cities hold
  shieldWarn: mk(ShieldWarning), // the cities are short
  barbarian: mk(Skull), // barbarian fleet
  road: mk(Path), // roads
  routeLength: Road, // longest continuous route (the counter, not the title)
  ship: mk(Boat), // ships (Islands)
  settlement: mk(House), // settlements
  city: mk(Buildings), // cities
  island: mk(Compass), // island discovery
  fish: mk(Fish), // fish tiles held (Fishermen)
  // Rivers. An arch over water tells a bridge from a road at glyph size;
  // Phosphor's `Path` (Icons.road) would say "road" twice.
  bridge: mk(Bridge),
  // Coins, the Rivers side currency. Not the Islands gold hex (terrain that pays
  // a free resource); the two share no picture, as they share no noun.
  coin: mk(Coins),
  // Gold (Raiders, Wagons, Explorers), never the coin. Under Wagons + Rivers
  // the two are one purse called coins, and the coin stays (see PlayerCard and
  // WagonPanel).
  gold: GoldBars,
  prisoner: mk(LockSimple), // prisoners held (Raiders)
  boot: mk(Boot), // the old boot (Fishermen): not a point, a longer road to the win
  // The Harbormaster card and the harbour-point counter (Harbormaster). One
  // glyph for both: the counter is how close a seat is to the card.
  harbor: Anchor,
  // Kept VP cards (the Printer, the Constitution): a sealed charter, since they
  // never enter a hand and must not read as a playable card.
  keptVp: mk(Certificate),
  discard: mk(HandDeposit), // the 7-roll discard
};
