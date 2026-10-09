import * as React from "react";
import { ResIcon } from "@/components/asset/AssetParts";
import { faceLook } from "@/lib/cardFace";
import {
  FLIGHT_MS,
  arcPoint,
  flightPose,
  type CardFace,
  type CardFlight,
  type Endpoint,
  type ScreenPoint,
} from "@/lib/board3d/cardflight";
import { hexToWorld } from "@/lib/board3d/coords";
import { SURFACE } from "@/lib/board3d/seating";
import type { Projector } from "@/lib/board3d/project";
import { anchorIdFor, centerWithin, fallbackPoint, type HudAnchors } from "@/lib/hudAnchors";

/**
 * The cards in the air.
 *
 * A sibling of HudLayer, one layer above it (z-30 vs z-10), because a card
 * arrives at chrome and must not slide under the seat coin it flies to.
 * Click-through, like the HUD layer, so it doesn't swallow camera drags.
 *
 * Positions are written straight onto the DOM from a requestAnimationFrame
 * loop; React only sees a batch arriving and draining.
 */

/** One commit's worth of cards, handed over as a unit. A new `id` is a new batch. */
export interface FlightBatch {
  id: number;
  flights: readonly CardFlight[];
}

/** A flight that has been given a start time. */
interface Live {
  key: string;
  flight: CardFlight;
  /** When the batch started, in the same clock the loop reads. */
  bornAt: number;
}

/**
 * How high above a tile's face a card leaves from, in world units. Roughly a
 * settlement's height, so the first frames aren't hidden behind the number
 * chip and pieces on the hex.
 */
const CARD_LIFT = 0.6;

export function CardFlightLayer({
  batch,
  projector,
  anchors,
  viewer,
}: {
  batch: FlightBatch | null;
  /** Null until the 3D rig has published its camera; hex sources cannot resolve without it. */
  projector: Projector | null;
  anchors: HudAnchors;
  viewer: number;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const nodes = React.useRef(new Map<string, HTMLElement>());
  const [live, setLive] = React.useState<Live[]>([]);

  React.useEffect(() => {
    if (!batch?.flights.length) return;
    // One start time for the whole batch: per-card offsets are already in
    // `delayMs`, and stamping on mount would let a slow frame stretch the stagger.
    const bornAt = performance.now();
    setLive((prev) => [
      ...prev,
      ...batch.flights.map((flight, i) => ({ key: `${batch.id}:${i}`, flight, bornAt })),
    ]);
  }, [batch]);

  React.useEffect(() => {
    if (!live.length) return;
    let handle = 0;

    const step = () => {
      const host = hostRef.current;
      if (!host) return;
      const box = host.getBoundingClientRect();
      const now = performance.now();
      // Anchor rects, measured once per frame rather than per card (cards
      // landing on the same seat coin share one), since each read after a style
      // write forces a synchronous layout. The cache alone isn't enough, hence
      // the split loop below.
      const rects = new Map<string, ScreenPoint>();

      const resolve = (e: Endpoint, face: CardFace): ScreenPoint | null => {
        if (e.k === "hex") {
          // Re-projected every frame: the player can orbit the board while a
          // card is in the air.
          if (!projector) return null;
          const [x, , z] = hexToWorld(e.hex);
          const p = projector([x, SURFACE.land + CARD_LIFT, z]);
          return p.behind ? null : p;
        }
        const id = anchorIdFor(e, viewer, face);
        if (!id) return null;
        const cached = rects.get(id);
        if (cached) return cached;
        const el = anchors.el(id);
        const at = el ? centerWithin(el.getBoundingClientRect(), box) : fallbackPoint(id);
        rects.set(id, at);
        return at;
      };

      // Read, then write, never interleaved: every measurement is taken while
      // layout is still clean, and only then are styles touched. Merging the
      // two loops costs a layout flush per card.
      const placed: {
        el: HTMLElement;
        elapsed: number;
        from: ScreenPoint | null;
        to: ScreenPoint | null;
      }[] = [];
      let anyLive = false;
      for (const l of live) {
        const elapsed = now - l.bornAt - l.flight.delayMs;
        const done = elapsed >= FLIGHT_MS;
        if (!done) anyLive = true;
        const el = nodes.current.get(l.key);
        if (!el) continue;
        placed.push({
          el,
          elapsed,
          from: done ? null : resolve(l.flight.from, l.flight.face),
          to: done ? null : resolve(l.flight.to, l.flight.face),
        });
      }

      for (const p of placed) {
        if (!p.from || !p.to) {
          // Either end unplaceable (the source hex is behind the camera, or
          // there is no camera). Hide rather than guess.
          p.el.style.opacity = "0";
          continue;
        }
        const pose = flightPose(p.elapsed);
        const at = arcPoint(p.from, p.to, pose.t);
        p.el.style.left = `${at.fx * 100}%`;
        p.el.style.top = `${at.fy * 100}%`;
        // A hard cut, never a fade: the card shows for the whole flight and
        // shrinks into its slot (pose.scale), then is gone.
        p.el.style.opacity = pose.opacity > 0 ? "1" : "0";
        p.el.style.transform = `translate(-50%, -50%) scale(${pose.scale})`;
      }

      if (anyLive) handle = requestAnimationFrame(step);
      // Cleared in one go: dropping each card as it lands would re-render the
      // overlay once per card.
      else setLive([]);
    };

    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [live, projector, anchors, viewer]);

  return (
    <div ref={hostRef} className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
      {live.map((l) => (
        <div
          key={l.key}
          ref={(el) => {
            if (el) nodes.current.set(l.key, el);
            else nodes.current.delete(l.key);
          }}
          // Off screen and invisible until the first frame places it, so a card
          // never flashes in the top-left corner.
          style={{ position: "absolute", left: "-100%", top: "-100%", opacity: 0 }}
          aria-hidden
        >
          <FlightCard face={l.flight.face} count={l.flight.count} />
        </div>
      ))}
    </div>
  );
}

/**
 * The card itself: the hand shelf's ResCard, shrunk. Same face, light well and
 * border, so it reads as the card about to appear in the hand. Smaller than
 * the real one (30x42 vs 46x64), since at full size it covers a hex and a half.
 */
function FlightCard({ face, count }: { face: CardFace; count: number }) {
  const look = faceLook(face);
  return (
    <span
      data-flight-card=""
      className="relative block w-7.5 h-10.5"
      style={{ "--card-color": look.color, "--hud-card-radius": "6px" } as React.CSSProperties}
    >
      <span className="hud-card-face flex items-center justify-center">
        {look.slot ? (
          <span className="hud-card-well flex items-center justify-center w-5.5 h-5.5 overflow-hidden">
            {/* object-cover: the well is square and the card back (256x340) is
              not, so crop rather than stretch. Resource icons are square. */}
            <ResIcon slot={look.slot} size={18} className="object-cover rounded-[3px]" />
          </span>
        ) : (
          // A face-down card. The engine redacts a steal for everyone but the two
          // players involved.
          <span className="text-[14px] font-extrabold leading-none text-ink">?</span>
        )}
      </span>
      {count > 1 && (
        <span className="hud-badge absolute -top-1.5 -right-1.5 z-10 min-w-4 h-4 px-1 text-[9px] font-extrabold flex items-center justify-center">
          {count}
        </span>
      )}
    </span>
  );
}
