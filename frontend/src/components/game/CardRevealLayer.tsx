import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { CardFace } from "@/components/asset/AssetParts";
import { playedCardSlot, playedCardText, type CardKind } from "@/lib/cardText";
import { Tip } from "./Tip";
import { arcPoint } from "@/lib/board3d/cardflight";
import {
  REVEAL_OPPONENT_SCALE,
  dockPending,
  revealDurationMs,
  revealPose,
  schedule,
  type Reveal,
  type RevealEnd,
  type Scheduled,
} from "@/lib/cardReveal";
import type { HudAnchors } from "@/lib/hudAnchors";

/**
 * A scenario card turned over at the table.
 *
 * The card leaves the tile it was bought from (or, for anyone else's card, the
 * seat that drew it) face down, turns over above the board, and is held for
 * about 1.5s with who drew it and what it does. Then the buyer's shrinks into
 * the prompt for the step it starts and stays as its thumbnail until that step
 * is done; anyone else's settles toward the event log, whose line carries the
 * face on hover. A bought Swift Journey flies to the hand.
 *
 * Nothing waits on it: it is click-through, the prompt beneath stays live, and
 * a second card queues behind the first. Under reduced motion the face just
 * fades in and out where it is held.
 *
 * What is revealed is decided by lib/cardReveal from payloads sent to this
 * viewer; this layer only draws it. Positions are written to the DOM from a
 * requestAnimationFrame loop, as in CardFlightLayer.
 */

/** One batch of reveals, handed over as a unit. A new `id` is a new batch. */
export interface RevealBatch {
  id: number;
  reveals: readonly Reveal[];
}

/** The held card's width, in px: `w-40` on a phone, `w-52` from `sm` up. */
const HELD_W_PHONE = 160;
const HELD_W = 208;
const SM = 640;

interface Px {
  x: number;
  y: number;
  /** The width of whatever is there, when something is, for the resting scale. */
  w?: number;
}

function centre(el: HTMLElement | null): Px | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}

export function CardRevealLayer({
  batch,
  anchors,
  reduced,
  hand,
  seatName,
  seatColor,
  onDocking,
}: {
  batch: RevealBatch | null;
  anchors: HudAnchors;
  reduced: boolean;
  /** The viewer's hand shelf, where a held card lives. */
  hand: React.RefObject<HTMLElement | null>;
  seatName: (seat: number) => string;
  seatColor: (seat: number) => string;
  /**
   * Whether the viewer's own card is still on its way to the prompt. The
   * prompt keeps its thumbnail empty until then, so the card lands in it.
   */
  onDocking?: (pending: boolean) => void;
}) {
  const [queue, setQueue] = React.useState<Scheduled[]>([]);
  const [current, setCurrent] = React.useState<Scheduled | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const turnRef = React.useRef<HTMLDivElement | null>(null);
  const capRef = React.useRef<HTMLDivElement | null>(null);
  const docking = React.useRef(false);
  const onDockingRef = React.useRef(onDocking);
  React.useEffect(() => {
    onDockingRef.current = onDocking;
  }, [onDocking]);

  React.useEffect(() => {
    if (!batch?.reveals.length) return;
    const now = performance.now();
    setQueue((q) => schedule(q, batch.reveals, now, reduced));
  }, [batch, reduced]);

  React.useEffect(() => {
    if (!queue.length) return;
    let handle = 0;
    const dur = revealDurationMs(reduced);

    const resolve = (end: RevealEnd, r: Reveal): Px | null => {
      switch (end) {
        case "shop":
          return (
            centre(anchors.el(r.kind === "raiders" ? "shop:raiders" : "shop:dev")) ??
            centre(hand.current)
          );
        case "seat":
          return centre(anchors.el(`seat:${r.seat}`));
        case "hand":
          return centre(hand.current) ?? centre(anchors.el(`seat:${r.seat}`));
        case "prompt":
          return centre(anchors.el("reveal:dock"));
        case "log":
          // The log when it is on screen; otherwise the drawing seat (a phone
          // keeps the log in the dock), which is where the tab is.
          return centre(anchors.el("log")) ?? centre(anchors.el(`seat:${r.seat}`));
      }
    };

    const step = () => {
      const now = performance.now();
      const live = queue.find((s) => now >= s.startAt && now < s.startAt + dur) ?? null;
      const pending = dockPending(queue, now, reduced);
      if (pending !== docking.current) {
        docking.current = pending;
        onDockingRef.current?.(pending);
      }
      setCurrent((c) => (c?.reveal.key === live?.reveal.key ? c : live));

      const card = cardRef.current;
      const turn = turnRef.current;
      const cap = capRef.current;
      if (live && card && turn && cap && card.dataset.key === live.reveal.key) {
        const r = live.reveal;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const phone = vw < SM;
        const heldW = (phone ? HELD_W_PHONE : HELD_W) * (r.mine ? 1 : REVEAL_OPPONENT_SCALE);
        const heldH = (heldW * 7) / 5;
        const hold: Px = { x: vw / 2, y: vh * (phone ? 0.4 : 0.42) };
        const from = resolve(r.from, r) ?? { x: vw / 2, y: vh - 60 };
        const to = resolve(r.to, r) ?? from;
        const rest = to.w ? Math.min(0.6, Math.max(0.12, to.w / heldW)) : undefined;
        const pose = revealPose(now - live.startAt, { reduced, to: r.to, rest });
        const at =
          pose.phase === "travel"
            ? lerpArc(from, hold, pose.t)
            : pose.phase === "exit"
              ? lerpArc(hold, to, pose.t)
              : hold;
        const opp = r.mine ? 1 : REVEAL_OPPONENT_SCALE;
        card.style.left = `${at.x}px`;
        card.style.top = `${at.y}px`;
        card.style.opacity = `${pose.opacity}`;
        card.style.transform = `translate(-50%, -50%) scale(${pose.scale * opp})`;
        turn.style.transform = `rotateY(${pose.rotY}deg)`;
        // The caption hangs under the held card only while it is held, so
        // there is never a caption moving across the board.
        cap.style.left = `${hold.x}px`;
        cap.style.top = `${hold.y + heldH / 2 + 10}px`;
        cap.style.opacity = pose.caption ? `${pose.opacity}` : "0";
      }

      if (queue.some((s) => now < s.startAt + dur)) handle = requestAnimationFrame(step);
      else {
        if (docking.current) {
          docking.current = false;
          onDockingRef.current?.(false);
        }
        setCurrent(null);
        setQueue([]);
      }
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [queue, reduced, anchors, hand]);

  if (!current) return null;
  const r = current.reveal;
  const text = playedCardText(r.kind, r.id);
  return (
    // Above a dialog (Overlay is z-50): Treason opens its planner at once, and
    // the card that opened it turns over in front of it and then lands in it.
    <div className="hud-root pointer-events-none fixed inset-0 z-60 overflow-hidden" aria-hidden>
      {/* Off screen until the first frame places it, so it never flashes in
          the corner. */}
      <div
        key={r.key}
        ref={cardRef}
        data-key={r.key}
        data-card-reveal={`${r.kind}:${r.id}`}
        data-reveal-mine={r.mine ? "true" : undefined}
        data-reveal-act={r.act}
        className="fixed -left-full -top-full w-40 opacity-0 perspective-distant sm:w-52"
      >
        <div ref={turnRef} className="relative aspect-5/7 transform-3d">
          <span className="absolute inset-0 backface-hidden">
            <CardFace
              slot={playedCardSlot(r.kind, r.id)}
              className="hud-card-frame block h-full w-full overflow-hidden"
            />
          </span>
          {/* The back art has a transparent ground, so a card is drawn behind
              it. */}
          <span className="hud-card-frame absolute inset-0 overflow-hidden bg-panel rotate-y-180 backface-hidden">
            <CardFace
              slot="devcard_back"
              className="hud-card-frame block h-full w-full overflow-hidden object-cover"
            />
          </span>
        </div>
      </div>
      <div
        ref={capRef}
        className="hud-surf-solid fixed -left-full -top-full flex w-80 max-w-11/12 -translate-x-1/2 flex-col items-center gap-1 px-3.5 py-2.5 text-center opacity-0"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold leading-tight text-muted">
          <span
            className="size-2.5 rounded-full bg-(--seat) ring-2 ring-secondary-background"
            style={{ "--seat": seatColor(r.seat) } as React.CSSProperties}
          />
          <RevealWho reveal={r} name={seatName(r.seat)} />
        </span>
        <span className="text-sm leading-snug text-pretty text-foreground">
          {r.void ? <VoidNote id={r.id} /> : text.hint}
        </span>
      </div>
    </div>
  );
}

/** Along the same lobbed arc the resource flights take, in px. */
function lerpArc(a: Px, b: Px, t: number): Px {
  const p = arcPoint({ fx: a.x, fy: a.y }, { fx: b.x, fy: b.y }, t);
  return { x: p.fx, y: p.fy };
}

/**
 * Who, and what they did with it. The card's name is on its title plate, so
 * the sentence names no card.
 */
function RevealWho({ reveal, name }: { reveal: Reveal; name: string }) {
  if (reveal.mine) {
    switch (reveal.act) {
      case "drew":
        return <Trans id="reveal.you.drew">You drew this card</Trans>;
      case "bought":
        return <Trans id="reveal.you.bought">You bought this card</Trans>;
      case "played":
        return <Trans id="reveal.you.played">You played this card</Trans>;
    }
  }
  switch (reveal.act) {
    case "drew":
      return <Trans id="reveal.other.drew">{name} drew this card</Trans>;
    case "bought":
      return <Trans id="reveal.other.bought">{name} bought this card</Trans>;
    case "played":
      return <Trans id="reveal.other.played">{name} played this card</Trans>;
  }
}

/** A card revealed and discarded with no effect says so, in place of its rule. */
function VoidNote({ id }: { id: string }) {
  return id === "intrigue" ? (
    <Trans id="reveal.void.redraw">
      No raider to take, so it is discarded and another is drawn.
    </Trans>
  ) : (
    <Trans id="reveal.void">Nothing to do with it, so it is discarded.</Trans>
  );
}

/**
 * The card in the prompt it started: a small face at the prompt's head while
 * the step is open. Empty (but holding its place) while the reveal is on its
 * way, so the card lands here; it is also that journey's anchor.
 */
export function RevealDock({
  slot,
  anchors,
  waiting,
}: {
  slot: string;
  anchors: HudAnchors;
  waiting: boolean;
}) {
  return (
    <span
      ref={anchors.ref("reveal:dock")}
      data-reveal-dock={slot}
      data-waiting={waiting ? "true" : undefined}
      className="w-7 shrink-0"
    >
      <CardFace slot={slot} className="hud-card-frame block w-full overflow-hidden" />
    </span>
  );
}

/**
 * The seat's "last drawn" tab: the face of the card this seat drew most
 * recently, beside its name, until its next turn begins (see lib/cardReveal
 * `lastDrawn`). Hover shows the face with its name and rule, for a player who
 * looked away.
 */
export function LastDrawnTab({ kind, id }: { kind: CardKind; id: string }) {
  const { t } = useLingui();
  const text = playedCardText(kind, id);
  return (
    <Tip
      title={text.name}
      note={t({ message: "Last drawn", context: "a seat's most recently drawn card" })}
      hint={
        <span className="flex flex-col items-center gap-1.5">
          <CardFace
            slot={playedCardSlot(kind, id)}
            className="hud-card-frame block w-26 overflow-hidden"
          />
          <span>{text.hint}</span>
        </span>
      }
      tapToOpen
      focusable
    >
      <span
        data-last-drawn={`${kind}:${id}`}
        aria-label={t({
          message: `Last drawn: ${text.name}`,
          context: "a seat's most recently drawn card",
        })}
        className="block w-4 shrink-0 -rotate-6 cursor-help"
      >
        <CardFace
          slot={playedCardSlot(kind, id)}
          className="hud-card-frame block w-full overflow-hidden"
        />
      </span>
    </Tip>
  );
}
