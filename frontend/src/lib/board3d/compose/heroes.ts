// Hero props: the few base props that carry a terrain's identity (the kiln, the
// barn, the mine head, a stand of trees). A composer never drops one; it moves
// each to the spot authored for it on this variant, as one rigid body, and
// re-seats it on the composed ground. Shared by the trade and river composers.
import { hexApothem, hull, insideDepth, KeepOut, HeightField, type Cluster } from "./fields.ts";
import type { Box } from "./model.ts";
import { heroPlace, placedBox, placedPoints, type Place } from "./place.ts";
import type { GroundSpots, SpotSpec } from "./recipe.ts";
import { isWaterBody } from "./water.ts";

export const CHIP_XZ: [number, number] = [0, -1.5];
export const CHIP_KEEP = 1.05;
/** Where clamped ground and paving sit: a millimetre under the chip's underside. */
export const CHIP_CLAMP_Y = 0.249;
/** A hero spot must clear what the composer added by this, inside this apothem (the contract). */
export const HERO_CLEAR = 0.08;
export const PAVING_CLEAR = 0.08;
export const HERO_APOTHEM = 2.36;
/**
 * The keep-out raster's error: covered cells are stamped whole (2.5 cm), so a
 * distance can read up to about a cell short. The parts lane's fitter measures
 * exactly, so a spot it cleared by 0.08 must not fail here at 0.06 and swap in
 * an unrequested `_alt`.
 */
export const RASTER_SLACK = 0.035;

/** Two heroes' feet may touch; one inside another by more than this is a clash. */
export const HERO_GAP = 0.02;
/** A hero stuck in another steps out this far at a time, at most this far. */
export const PUSH_STEP = 0.02;
export const PUSH_MAX = 0.6;

/** A placed part's foot (its vertices within 0.1 of its lowest), as a plan hull and its points. */
function footOf(p: Place): {
  hull: [number, number][];
  pts: [number, number][];
  all: [number, number][];
  c: [number, number];
} {
  const all = [...placedPoints(p)];
  let lo = Infinity;
  for (const [, y] of all) lo = Math.min(lo, y);
  let hi = -Infinity;
  for (const [, y] of all) hi = Math.max(hi, y);
  const cut = lo + Math.min(0.1, (hi - lo) / 2);
  const pts = all.filter(([, y]) => y <= cut).map(([x, , z]) => [x, z] as [number, number]);
  const h = hull(pts);
  const c: [number, number] = [
    pts.reduce((s, q) => s + q[0], 0) / (pts.length || 1),
    pts.reduce((s, q) => s + q[1], 0) / (pts.length || 1),
  ];
  return { hull: h, pts, all: all.map(([x, , z]) => [x, z] as [number, number]), c };
}

export const chipDist = (x: number, z: number) => Math.hypot(x - CHIP_XZ[0], z - CHIP_XZ[1]);

export interface HeroLog {
  hero: string;
  spot: string;
  parts: number;
  stays: boolean;
  /** Why the chosen spot fails the contract's checks, if it does. Shown on the review sheet. */
  collides?: string;
  /** No spot was authored for this variant, so the ordinary drop rule decided. */
  unplaced?: boolean;
  /** A pool no spot could hold level: dropped rather than floated. */
  dropped?: string;
  /** Stepped this far off its spot to clear the town, the channel or another hero. */
  pushed?: number;
}

export interface HeroResult {
  places: Place[];
  claimed: Set<Cluster>;
  boxes: Box[];
  log: HeroLog[];
  /** Where each hero ended up, for the rules that clip paving over one. */
  footprints: {
    hero: string;
    x: number;
    z: number;
    r: number;
    moved: boolean;
    /** The plan hull of everything it placed. */
    hull: [number, number][];
  }[];
  /** Each hero's places: one body, seated with one lift. */
  groups: { hero: string; places: Place[]; moved: boolean }[];
  /** Hero parts dropped (a pool with no level spot). */
  dropped: Set<Cluster>;
  /** Hero parts that moved off their anchor. */
  movedClusters: Set<Cluster>;
  /** Heroes stepped off a failing spot, and by how much. */
  pushed: string[];
}

/** `spots.json`'s per-ground `keep` rules (the trade-parts contract). */
export interface KeepRules {
  /** Base nodes always dropped. */
  drop_always?: string[];
  /** Base nodes never dropped, and never moved: kept exactly as authored. */
  never_drop?: string[];
  /** Base nodes the town CLIPS (only the covered triangles go) instead of dropping whole. */
  clip_nodes?: string[];
  /** Base nodes dropped in this order, whole, until the tile is inside its triangle budget. */
  budget_drop_order?: string[];
  /** Heroes whose footprint no paving may cross: those paving triangles go. */
  clip_paving_over?: string[];
  /** Heroes re-draped on the ground after moving, rather than seated rigidly. */
  drape_heroes?: string[];
  /** `min_<what>`: at least this many loose parts of <what> must survive. */
  [min: `min_${string}`]: number;
}

/** The loose parts a hero is made of: its nodes, near its anchor if `select_r` says so. */
export function heroClusters(
  props: Cluster[],
  spec: { nodes: string[]; anchor: { file: [number, number] }; select_r: number | null },
): Cluster[] {
  return props.filter((c) => {
    if (!spec.nodes.includes(c.node)) return false;
    if (spec.select_r == null) return true;
    const cx = (c.box[0] + c.box[3]) / 2,
      cz = (c.box[2] + c.box[5]) / 2;
    return Math.hypot(cx - spec.anchor.file[0], cz - spec.anchor.file[1]) <= spec.select_r;
  });
}

/**
 * Place every hero of a ground for one variant (`key`: a direction or a
 * shape). The spot is tried, then its `_alt`; the first that passes wins. If
 * neither passes, the primary is used and the reason logged: the composer
 * never searches for spots, so a failing spot is a review note.
 */
export function placeHeroes(
  where: string,
  props: Cluster[],
  ground: GroundSpots | undefined,
  key: string,
  clear: KeepOut,
  Gb: HeightField,
  Gn: HeightField,
  paving?: KeepOut,
  /** What `clear` is, for the log: the town's buildings, or a river's channel. */
  clearLabel = "town",
  /**
   * An extra check for a hero that must also FIT its spot (a pool needs
   * level enough ground). A hero failing it on every spot is dropped rather
   * than placed where it cannot sit.
   */
  fits?: (places: Place[]) => string | null,
  /**
   * Where a body of water may land: its placements moved onto the base
   * ground's own lattice (`latticeSnap`), so its sheet stays whole lattice
   * triangles instead of a polygon laid across them at an angle.
   */
  snap?: (places: Place[]) => Place[],
): HeroResult {
  const out: HeroResult = {
    places: [],
    claimed: new Set(),
    boxes: [],
    log: [],
    footprints: [],
    groups: [],
    dropped: new Set(),
    movedClusters: new Set(),
    pushed: [],
  };
  const pushed = out.pushed;
  const snapWater = (ps: Place[]): Place[] =>
    snap && ps.length && ps.every((p) => isWaterBody(p.c)) ? snap(ps) : ps;
  const spots = ground?.spots?.[key] ?? {};
  const keep = (ground?.keep ?? {}) as KeepRules;
  const dropAlways = new Set(keep.drop_always ?? []);
  const drapeHeroes = new Set(keep.drape_heroes ?? []);
  // The contract's checks, per vertex: inside apothem 2.36, nothing in the
  // chip's disc, and 0.08 clear of what the composer added (town buildings and
  // paving, a river's channel). Heroes' spots are authored together, so they
  // are not checked against each other here.
  const check = (pl: Place): string | null => {
    for (const [x, , z] of placedPoints(pl)) {
      if (hexApothem(x, z) > HERO_APOTHEM) return "rim";
      if (chipDist(x, z) < CHIP_KEEP) return "chip";
      if (clear.at(x, z) < HERO_CLEAR - RASTER_SLACK) return clearLabel;
      if (paving && paving.at(x, z) < PAVING_CLEAR - RASTER_SLACK) return "paving";
    }
    return null;
  };
  // Heroes placed so far, as plan hulls of their feet. A later hero may not
  // stand in an earlier one (which loose parts make up each hero is decided
  // here, first come).
  const feet: { hull: [number, number][]; all: [number, number][]; c: [number, number] }[] = [];
  const overlap = (places: Place[]): { depth: number; from: [number, number] } | null => {
    // A pool may have a stilt hut standing in it, and a punt on it.
    if (places.every((p) => isWaterBody(p.c))) return null;
    let worst: { depth: number; from: [number, number] } | null = null;
    const mine = places.map(footOf);
    for (const f of feet) {
      for (const m of mine) {
        // Any part of either standing inside the other's foot (a sheep's
        // body between another's legs, a shed wall inside a kiln).
        let d = -Infinity;
        for (const [x, z] of m.all) d = Math.max(d, insideDepth(f.hull, x, z));
        for (const [x, z] of f.all) d = Math.max(d, insideDepth(m.hull, x, z));
        if (d > HERO_GAP && (!worst || d > worst.depth)) worst = { depth: d, from: f.c };
      }
    }
    return worst;
  };
  for (const [hero, spec] of Object.entries(ground?.heroes ?? {})) {
    // A hero the ground always drops (the lake's jetty, replaced by the lake
    // town's boardwalks) is left to the drop rule.
    if (spec.nodes.every((n) => dropAlways.has(n))) continue;
    // Clusters are claimed first come: two heroes may share a merged node (the
    // hills' shed and kiln are both in `Hills_kiln`), and a part moves once.
    const cs = heroClusters(props, spec).filter((c) => !out.claimed.has(c));
    if (cs.length === 0)
      throw new Error(`${where}: hero ${hero} (${spec.nodes.join(", ")}) selects no part`);
    const candidates: [string, SpotSpec][] = [];
    if (spots[hero]) candidates.push([hero, spots[hero]]);
    if (spots[`${hero}_alt`]) candidates.push([`${hero}_alt`, spots[`${hero}_alt`]]);
    // No spot on this variant means the hero may drop here; the ordinary rule
    // keeps it if it is clear.
    if (candidates.length === 0) {
      out.log.push({ hero, spot: "-", parts: 0, stays: false, unplaced: true });
      continue;
    }
    let chosen: { name: string; places: Place[]; why: string | null } | null = null;
    // Still water moves rigid and level (water.ts); re-draping a pool vertex
    // by vertex warps it. `drape` is for flat decals that are not water.
    const mode: Place["mode"] = spec.fixed
      ? "fixed"
      : (spec.drape || drapeHeroes.has(hero)) && !cs.every(isWaterBody)
        ? "drape"
        : "rigid";
    // A ground-bound hero (the pasture's pond, dug into the ground mesh) never
    // moves, so there is nothing to check; the town gives way to it
    // (`clip_paving_over`).
    for (const [name, s] of candidates) {
      const places = snapWater(
        cs.map((c) => {
          const pl = heroPlace(
            c,
            spec.anchor.file,
            s.file,
            s.yaw,
            s.scale,
            spec.footprint_r,
            Gb,
            Gn,
          );
          // A ground-bound hero keeps its original height. Seated on the
          // composed ground, the pond sank under its own bank wherever the town
          // lowered part of the ring.
          if (spec.ground_bound) pl.yNew = pl.yOld;
          return { ...pl, mode, grounds: { Gb, Gn } };
        }),
      );
      let why = spec.ground_bound ? null : (places.map(check).find((w) => w) ?? null);
      const mustFit = !spec.ground_bound && fits && cs.every(isWaterBody);
      const unfit = mustFit ? fits(places) : null;
      if (!why && unfit) why = unfit;
      if (!why && !spec.ground_bound && overlap(places)) why = "hero";
      if (!chosen || (chosen.why && !why)) chosen = { name, places, why };
      if (!why) break;
    }
    let { name, places, why } = chosen!;
    // A spot that fails a check by a little (inside an earlier hero, or in the
    // clearance round the town or channel) is stepped out by the smallest step,
    // in any of twelve directions, that passes every check. Heroes are tried
    // nearest the authored spot first, so this repairs a spot rather than
    // inventing one. A pool must still fit where it lands.
    const water = cs.every(isWaterBody);
    const fails = (ps: Place[]) =>
      ps.map(check).find((w) => w) ??
      (!spec.ground_bound && overlap(ps) ? "hero" : null) ??
      (water && fits ? fits(ps) : null);
    if (!spec.ground_bound && fails(places)) {
      const tries = candidates.map(([n, sp]) => {
        const ps = snapWater(
          cs.map((c) => ({
            ...heroPlace(c, spec.anchor.file, sp.file, sp.yaw, sp.scale, spec.footprint_r, Gb, Gn),
            mode,
            grounds: { Gb, Gn },
          })),
        );
        return { n, ps };
      });
      let best: { n: string; ps: Place[]; step: number } | null = null;
      for (const t of tries) {
        search: for (let step = PUSH_STEP; step <= PUSH_MAX + 1e-9; step += PUSH_STEP) {
          if (best && step >= best.step) break;
          for (let k = 0; k < 12; k++) {
            const a2 = (k * Math.PI) / 6;
            const moved = snapWater(
              t.ps.map((p) => ({
                ...p,
                sx: p.sx + Math.cos(a2) * step,
                sz: p.sz + Math.sin(a2) * step,
              })),
            );
            if (!fails(moved)) {
              best = { n: t.n, ps: moved, step };
              break search;
            }
          }
        }
      }
      if (best) {
        name = best.n;
        places = best.ps;
        why = null;
        pushed.push(`${hero} ${best.step.toFixed(2)}`);
      } else why = fails(places) ?? why;
    }
    // A pool no spot can hold level is dropped rather than left standing on
    // its downhill edge.
    if (why && fits && !spec.ground_bound && cs.every(isWaterBody) && fits(places)) {
      for (const c of cs) {
        out.claimed.add(c);
        out.dropped.add(c);
      }
      out.log.push({ hero, spot: name, parts: 0, stays: false, dropped: why });
      continue;
    }
    for (const pl of places) {
      out.places.push(pl);
      out.boxes.push(placedBox(pl));
      out.claimed.add(pl.c);
    }
    const at = spots[name];
    const off: [number, number] = [places[0].sx - at.file[0], places[0].sz - at.file[1]];
    const wasPushed = Math.hypot(off[0], off[1]) > 1e-9;
    const moved =
      wasPushed ||
      !(
        at.stays ||
        (at.file[0] === spec.anchor.file[0] &&
          at.file[1] === spec.anchor.file[1] &&
          !at.yaw &&
          at.scale === 1)
      );
    out.groups.push({ hero, places, moved });
    if (!places.every((p) => isWaterBody(p.c))) for (const pl of places) feet.push(footOf(pl));
    if (moved) for (const pl of places) out.movedClusters.add(pl.c);
    out.footprints.push({
      hero,
      x: at.file[0] + off[0],
      z: at.file[1] + off[1],
      r: spec.footprint_r * at.scale,
      moved,
      hull: hull(
        places.flatMap((p) => [...placedPoints(p)].map(([x, , z]) => [x, z] as [number, number])),
      ),
    });
    out.log.push({
      hero,
      spot: name,
      parts: places.length,
      stays: !!spots[name]?.stays && !wasPushed,
      ...(why ? { collides: why } : {}),
      ...(wasPushed ? { pushed: Math.round(Math.hypot(off[0], off[1]) * 100) / 100 } : {}),
    });
  }
  return out;
}
