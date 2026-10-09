// Getting a shot set for a list of colours, from the cheapest source:
//   1. memory: already resolved in this tab.
//   2. disk: rendered on a previous visit; a blob read, no GPU.
//   3. render: one batched WebGL pass for every missing colour.
//
// Only free seat colours reach disk. Supporter colours are rendered and kept in
// memory for the tab's lifetime, so storage does not grow without bound.
import { renderShotBlobs, type PieceShot } from "./thumbnail";
import { isFreeSeatColor, FREE_SEAT_COLORS } from "./freeColors";
import { readShots, writeShots, shotsToURLs } from "./shotStore";
import { supportsWebGL } from "./webgl";

export interface ShotSet {
  /** Distinguishes one set's renders from another's on disk. */
  id: string;
  shots: PieceShot[];
  size: { w: number; h: number };
  /** Device pixel ratio cap. Small icons gain nothing from 2x. */
  pixelRatio?: number;
}

/** slot -> object URL, per colour. */
export type ShotURLs = Record<string, Record<string, string>>;

const memory = new Map<string, Record<string, string>>();
const inflight = new Map<string, Promise<void>>();

function memKey(setID: string, color: string): string {
  return `${setID}|${color.toLowerCase()}`;
}

/** What is already resolved for these colours, with no work and no awaiting. */
export function cachedShots(setID: string, colors: string[]): ShotURLs {
  const out: ShotURLs = {};
  for (const c of colors) {
    const hit = memory.get(memKey(setID, c));
    if (hit) out[c] = hit;
  }
  return out;
}

/**
 * Make sure every colour in `colors` is resolved, then report whether anything
 * new landed so a caller can skip a re-render.
 *
 * Never throws. Each tier falls through to the next, and a total failure leaves
 * the colour absent, which callers already handle for clients without WebGL.
 */
export async function ensureShots(set: ShotSet, colors: string[]): Promise<boolean> {
  const wanted = Array.from(new Set(colors.filter(Boolean)));
  const missing = wanted.filter((c) => !memory.has(memKey(set.id, c)));
  if (!missing.length) return false;

  // Coalesce: concurrent requests for the same colour await one render.
  const started: Promise<void>[] = [];
  const toResolve: string[] = [];
  for (const c of missing) {
    const key = memKey(set.id, c);
    const running = inflight.get(key);
    if (running) started.push(running);
    else toResolve.push(c);
  }

  if (toResolve.length) {
    const job = resolve(set, toResolve).finally(() => {
      for (const c of toResolve) inflight.delete(memKey(set.id, c));
    });
    for (const c of toResolve) inflight.set(memKey(set.id, c), job);
    started.push(job);
  }

  await Promise.allSettled(started);
  return missing.some((c) => memory.has(memKey(set.id, c)));
}

async function resolve(set: ShotSet, colors: string[]): Promise<void> {
  // Disk first, for free colours only. A failed or empty read is a miss.
  const needRender: string[] = [];
  await Promise.all(
    colors.map(async (color) => {
      if (!isFreeSeatColor(color)) {
        needRender.push(color);
        return;
      }
      const stored = await readShots(set.id, color);
      if (stored) {
        memory.set(memKey(set.id, color), shotsToURLs(stored));
      } else {
        needRender.push(color);
      }
    }),
  );
  if (!needRender.length) return;

  // One WebGL context for every colour still missing, not one per colour.
  if (!supportsWebGL()) return;
  const rendered = await renderShotBlobs(needRender, {
    shots: set.shots,
    size: set.size,
    pixelRatio: set.pixelRatio,
  });

  for (const [color, blobs] of rendered) {
    memory.set(memKey(set.id, color), shotsToURLs(blobs));
    // Persisted in the background; a slow disk must not delay the frame.
    if (isFreeSeatColor(color)) void writeShots(set.id, color, blobs);
  }
}

/**
 * Render the art this table is about to need, from the lobby. Free colours
 * land on disk, so they are warm for future games too.
 *
 * Only the seated colours are rendered here; the rest of the free palette is
 * left to `warmFreeColorsWhenIdle` so it never competes with the table.
 */
export async function warmSeatShots(
  own: string | null | undefined,
  seated: string[],
  sets: { shop: ShotSet; icon: ShotSet },
): Promise<void> {
  if (!supportsWebGL()) return;
  await ensureShots(sets.icon, seated);
  if (own) await ensureShots(sets.shop, [own]);
}

/**
 * Fill in the remaining free colours when the browser is idle. Fire-and-forget.
 * Browsers without requestIdleCallback (Safari) skip it rather than guess with
 * setTimeout.
 */
export function warmFreeColorsWhenIdle(sets: { shop: ShotSet; icon: ShotSet }): void {
  if (!supportsWebGL()) return;
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (!ric) return;
  ric(() => {
    void ensureShots(sets.icon, [...FREE_SEAT_COLORS]).then(() =>
      ensureShots(sets.shop, [...FREE_SEAT_COLORS]),
    );
  });
}
