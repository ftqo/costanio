// Compose a trade town onto a base tile.
//
// The base tile keeps what identifies it (slab, rim, ground sheet with its own
// material split, and every prop the town does not land on), and the town
// brings its buildings, paving and the bed it was authored on. Four steps:
//
//   1. GROUND. The base's own sheet, vertex for vertex (every shipped land
//      tile shares one 631-vertex grid), pulled to the bed's heights inside
//      the bed's footprint and feathered back outside it. Its materials stay
//      the base's.
//   2. TOWN. Each part by its role (the trade-parts contract). Paving is
//      painted into the ground's triangles: the ground set to a road-like
//      surface (drape.ts), then the triangles in the paving's footprint
//      recoloured (the plaza a lattice hexagon, each spoke a band of lattice
//      rows, kerb stones along their edges; paint.ts). Lake decks keep their
//      authored height; everything else moves as one rigid body on its own
//      foot (place.ts), so nothing floats or is buried.
//   3. PROPS. The base's props split into loose parts (a sheep, a tree, a
//      house). A part the town lands on is dropped with the parts it belongs
//      with, a dune melts under the town, and the rest are re-seated.
//   4. HEROES. Props that carry the terrain's identity (the kiln, the barn,
//      the mine head) are never dropped: each goes to its authored spot for
//      this direction (stepped a few centimetres aside if that spot fails a
//      check). A pool is a hero with its own rules (water.ts): set level, its
//      basin carved, dropped where no spot can hold it.
//
// The chip never moves, so nothing above its underside may enter its
// keep-clear disc: a town part turned into it is culled (a guard; the
// contract's layouts keep the disc clear), ground there is clamped under the
// chip, painting never raises it, and no kerb stone goes in it.
import {
  HeightField,
  KeepOut,
  clusterCentre,
  clustersOf,
  hexApothem,
  insideDepth,
  type Cluster,
} from "./fields.ts";
import {
  CHIP_CLAMP_Y,
  CHIP_KEEP,
  CHIP_XZ,
  HERO_APOTHEM,
  HERO_CLEAR,
  chipDist,
  heroClusters,
  placeHeroes,
  type HeroLog,
  type HeroResult,
  type KeepRules,
} from "./heroes.ts";
import { checkMinimums, fitBudget, selects, sortProps } from "./props.ts";
import {
  boxOfPrims,
  clonePart,
  faceNormal,
  mirrorPrimsX,
  partsWithRole,
  rotatePrimsY,
  smoothstep,
  terrainOf,
  translatePrims,
  type MaterialDef,
  type Part,
  type Prim,
  type TileModel,
} from "./model.ts";
import {
  drapeCorners,
  drapeSurfaces,
  groundUnderDrapes,
  hideUnder,
  vkey,
  DRAPE_REACH,
} from "./drape.ts";
import { kerbStones, paintGround, planPaint, saltOf, trisUnder, type PaintLabel } from "./paint.ts";
import {
  emitPlaces,
  planPoint,
  placedPoints,
  keepInside,
  seatGroup,
  seatOne,
  stay,
  type Place,
  latticeSnap,
  latticePoints,
} from "./place.ts";
import {
  FLOAT_TOL,
  MAX_CARVE,
  WATER_MATERIAL,
  WATER_RIM,
  basinOf,
  carve,
  carveCost,
  fill,
  fillOf,
  isWaterBody,
  seatWater,
  type Basin,
  type Fill,
  underSheets,
} from "./water.ts";
import {
  partRole,
  type GroundSpots,
  type Placement,
  type Selector,
  type SpotsFile,
} from "./recipe.ts";

export { CHIP_XZ, CHIP_KEEP, CHIP_CLAMP_Y };
export const CHIP_UNDERSIDE = 0.25;

/** A base prop vertex this close to the town's footprint drops its part. */
export const DROP_DISTANCE = 0.06;
/** The ground blends from the bed (inside its footprint) back to its own over this band. */
export const BLEND_NEAR = 0.0;
export const BLEND_FAR = 0.3;
/** The composed tile's triangle budget (the contract). */
export const TRI_BUDGET = 3634;

/** The plane paving and buildings are authored on. */
export const DRAPE_PLANE = 0.25;

/**
 * The bed as flat pads. Each loose island of the bed is one pad (the plaza's
 * disc, one quad per building), flattened to one height: the median of the
 * base ground under it plus the recipe's offset. On a slope the houses step
 * with the ground instead of the town becoming one terrace (the contract).
 */
export function padPrims(
  bed: Part[],
  Gb: HeightField,
  offset: number,
  /** Buildings that were not built: their pads go with them. */
  gone?: KeepOut,
): Prim[] {
  const out: Prim[] = [];
  for (const island of bed.flatMap((p) => clustersOf("bed", p.prims, false))) {
    if (gone) {
      const cx = (island.box[0] + island.box[3]) / 2,
        cz = (island.box[2] + island.box[5]) / 2;
      if (gone.at(cx, cz) === 0) continue;
    }
    const ys: number[] = [];
    for (const t of island.tris) {
      const P = t.prim.pos,
        i = t.start;
      for (let a = 0; a <= 4; a++) {
        for (let b = 0; a + b <= 4; b++) {
          const u = a / 4,
            v = b / 4,
            w = 1 - u - v;
          const x = P[i] * w + P[i + 3] * u + P[i + 6] * v,
            z = P[i + 2] * w + P[i + 5] * u + P[i + 8] * v;
          const g = Gb.sample(x, z);
          if (g) ys.push(g.y);
        }
      }
    }
    ys.sort((a, b) => a - b);
    const y = (ys.length ? ys[ys.length >> 1] : DRAPE_PLANE) + offset;
    const pos = new Float32Array(island.tris.length * 9),
      nrm = new Float32Array(island.tris.length * 9);
    island.tris.forEach((t, n) => {
      for (let k = 0; k < 3; k++) {
        pos.set([t.prim.pos[t.start + k * 3], y, t.prim.pos[t.start + k * 3 + 2]], n * 9 + k * 3);
        nrm.set([0, 1, 0], n * 9 + k * 3);
      }
    });
    out.push({ material: "bed", pos, nrm });
  }
  return out;
}

/** The placeholder a yard floor is authored in; the ground's own yard material replaces it. */
export const YARD_PLACEHOLDER = "Mat_Trade_yard";

export interface TradeInput {
  base: TileModel;
  layout: TileModel;
  placement: Placement;
  /** Parts every direction shares, never turned (the contract's `Town_Tile` plaza). */
  shared?: TileModel;
  /** The composed tile's terrain name (`Trade_Hills_W`): every part is prefixed with it. */
  terrain: string;
  /** The seaward direction, upper case, as the contract keys spots (`NW`). */
  dir: string;
  /** This ground's entry in spots.json. */
  ground?: GroundSpots;
  spots?: SpotsFile;
  keep?: Selector[];
  drop?: Selector[];
  nudge?: Record<Selector, [number, number]>;
  offset?: number;
  /** The yard material when the ground's spots name none. */
  yard?: string;
}

export interface TradeLog {
  culled: string[];
  dropped: string[];
  kept: number;
  heroes: HeroLog[];
  forcedKeep: string[];
  forcedDrop: string[];
  nudged: string[];
  clipped: string[];
  budgetDropped: string[];
  /** Floaters (the swamp's punt) set on a pool's water, or dropped for want of one. */
  moored: string[];
  /** Ground triangles painted, by what they were painted as. */
  painted: Record<PaintLabel, number>;
  /** Kerb stones set. */
  kerbs: number;
  /** Props standing where paint was planned, which it was left off (and how many triangles). */
  unpainted: string[];
  tris: number;
}

export interface TradeResult {
  model: TileModel;
  log: TradeLog;
}

export { selects };

/** Turn a layout onto its bearing: rotate, then mirror, origins included. */
export function placeLayout(layout: TileModel, p: Placement): Part[] {
  const a = (p.rotate * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return layout.parts.map((part) => {
    const out = clonePart(part);
    rotatePrimsY(out.prims, p.rotate);
    if (p.mirror) mirrorPrimsX(out.prims);
    if (out.origin) {
      const [x, y, z] = out.origin;
      const rx = x * c + z * s,
        rz = -x * s + z * c;
      out.origin = [p.mirror ? -rx : rx, y, rz];
    }
    return out;
  });
}

export function composeTrade(input: TradeInput): TradeResult {
  const { base, layout, terrain } = input;
  const baseT = terrainOf(base);
  const log: TradeLog = {
    culled: [],
    dropped: [],
    kept: 0,
    heroes: [],
    forcedKeep: [],
    forcedDrop: [],
    nudged: [],
    clipped: [],
    budgetDropped: [],
    moored: [],
    painted: { plaza: 0, spoke: 0, yard: 0 },
    kerbs: 0,
    unpainted: [],
    tris: 0,
  };
  const used = { drop: new Set<string>(), keep: new Set<string>(), nudge: new Set<string>() };
  const yard = input.ground?.yard_material ?? input.yard;

  // --- the town, turned onto its bearing ----------------------------------
  const placed = [
    ...placeLayout(layout, input.placement),
    ...(input.shared ? placeLayout(input.shared, { rotate: 0, mirror: false }) : []),
  ];
  const roleOf = (p: Part) => partRole(p.name, input.spots);
  const bed = placed.filter((p) => roleOf(p) === "bed");
  if (bed.length === 0) throw new Error(`${layout.root}: no bed part`);
  const baseGround = partsWithRole(base, "ground");
  if (baseGround.length === 0) throw new Error(`${base.root}: no ${baseT}_ground`);
  const Gb = new HeightField(baseGround.flatMap((p) => p.prims));
  let pads = padPrims(bed, Gb, input.offset ?? 0);
  let Gt = new HeightField(pads);

  let town = placed.filter((p) => roleOf(p) !== "bed" && p.prims.length > 0);
  town = town.filter((p) => {
    if (input.drop?.includes(p.name)) {
      used.drop.add(p.name);
      log.forcedDrop.push(p.name);
      return false;
    }
    if (roleOf(p) !== "rigid") return true;
    // The contract's rule: no vertex above the chip's underside inside its
    // disc. (A bounding box is too blunt: a house turned 60 degrees has box
    // corners it does not reach.)
    for (const prim of p.prims) {
      for (let i = 0; i < prim.pos.length; i += 3) {
        if (
          prim.pos[i + 1] > CHIP_UNDERSIDE &&
          chipDist(prim.pos[i], prim.pos[i + 2]) < CHIP_KEEP
        ) {
          log.culled.push(p.name);
          return false;
        }
      }
    }
    return true;
  });
  for (const p of town) {
    for (const prim of p.prims) {
      if (prim.material !== YARD_PLACEHOLDER) continue;
      if (!yard)
        throw new Error(
          `${terrain}: ${p.name} wears ${YARD_PLACEHOLDER} and the ground names no yard_material`,
        );
      prim.material = yard;
    }
  }
  // --- the base's props, as loose parts ------------------------------------
  const props = partsWithRole(base, "prop").flatMap((p) => clustersOf(p.name, p.prims));
  const rules = (input.ground?.keep ?? {}) as KeepRules;

  // A ground-bound hero (the pasture's pond) has its basin dug into the base
  // ground and cannot move. Where town buildings would stand in its water, one
  // gives way: a building or two is not built (its pad goes too), but if the
  // pond would cost the hall or more than POND_MAX_CULL buildings, the pond
  // goes instead and its basin is filled, since the town is the tile's point.
  // A pond that stays keeps its authored ground, and paving over it is
  // clipped (`clip_paving_over`).
  const boundHeroes = Object.entries(input.ground?.heroes ?? {}).filter(([, h]) => h.ground_bound);
  let boundWater = boundHeroes.flatMap(([, h]) => heroClusters(props, h)).filter(isWaterBody);
  const waterOf = (cs: Cluster[]) =>
    new KeepOut()
      .add(emitPlaces(cs.map((c) => stay(c, 0))).filter((p) => WATER_MATERIAL.test(p.material)))
      .finish();
  let keepMask = waterOf(boundWater);
  const pondFills: Fill[] = [];
  const pondGone = new Set<Cluster>();
  if (boundWater.length) {
    const inWater = (p: Part) => {
      if (roleOf(p) !== "rigid") return false;
      for (const prim of p.prims)
        for (let i = 0; i < prim.pos.length; i += 3)
          if (keepMask.at(prim.pos[i], prim.pos[i + 2]) < BOUND_CLEAR) return true;
      return false;
    };
    const gone = town.filter(inWater);
    if (gone.length > POND_MAX_CULL || gone.some((p) => /_hall$/.test(p.name))) {
      for (const [hero, h] of boundHeroes) {
        for (const c of heroClusters(props, h)) pondGone.add(c);
        log.culled.push(
          `${hero} (gave way to the town: it would have taken ${gone.map((p) => p.name).join(", ")})`,
        );
      }
      for (const c of boundWater) {
        const [cx, cz] = clusterCentre(c);
        const f = fillOf(cx, cz, Math.max(c.box[3] - c.box[0], c.box[5] - c.box[2]) / 2 + 0.1, Gb);
        if (f) pondFills.push(f);
      }
      boundWater = [];
      keepMask = waterOf([]);
    } else if (gone.length) {
      for (const p of gone) log.culled.push(`${p.name} (gave way to the pond)`);
      town = town.filter((p) => !gone.includes(p));
      pads = padPrims(
        bed,
        Gb,
        input.offset ?? 0,
        new KeepOut().add(gone.flatMap((p) => p.prims)).finish(),
      );
      Gt = new HeightField(pads);
    }
  }

  // What the paving paints, decided on the ground's plan (paint.ts): the
  // plaza a lattice hexagon, each spoke a band of lattice rows, a yard floor
  // the triangles under it. A pond the paving is clipped at keeps its own
  // ground's colours: nothing is painted within BOUND_NEAR of its water.
  const isPlaza = (p: Part) => /_plaza$/.test(p.name);
  const labelOf = (p: Part): PaintLabel =>
    isPlaza(p) ? "plaza" : /_yardfloor$/.test(p.name) ? "yard" : "spoke";
  const paintSrc = town.filter((p) => roleOf(p) === "paint").map((p) => clonePart(p));
  hideUnder(paintSrc, isPlaza);
  // (A clipped hero with no water to measure from keeps its footprint.)
  const clipped = boundHeroes.filter(([h]) => rules.clip_paving_over?.includes(h));
  const dryClip = clipped.filter(([, h]) => !heroClusters(props, h).some(isWaterBody));
  const plan = planPaint({
    ground: baseGround.flatMap((p) => p.prims),
    sources: paintSrc.map((part) => ({ part, label: labelOf(part) })),
    exclude: clipped.length
      ? (x, z) =>
          (boundWater.length > 0 && keepMask.at(x, z) < BOUND_NEAR) ||
          dryClip.some(
            ([, h]) => Math.hypot(x - h.anchor.file[0], z - h.anchor.file[1]) < h.footprint_r,
          )
      : undefined,
    colours: yard ? [yard] : [],
  });
  const paintPrims = [...plan.regions.plaza, ...plan.regions.spoke, ...plan.regions.yard];

  const bedMask = new KeepOut().add(pads).finish((x, z) => Gt.sample(x, z)?.y ?? null);
  const townMask = new KeepOut().add([...town.flatMap((p) => p.prims), ...paintPrims]).finish();
  // The hero checks separate the buildings from the paving (the contract
  // clears the one by 0.08 and the other by 0.06).
  const buildingMask = new KeepOut()
    .add(town.filter((p) => roleOf(p) !== "paint").flatMap((p) => p.prims))
    .finish();
  // (The heroes keep PAVING_CLEAR from the sheets the paint replaces, which
  // the painted bands stay within a few centimetres of; a base prop is
  // dropped from the paint itself, through `townMask`.)
  const pavingMask = new KeepOut()
    .add(town.filter((p) => roleOf(p) === "paint").flatMap((p) => p.prims))
    .finish();

  // --- the ground, 1: the town's pads --------------------------------------
  const townWeight = (x: number, z: number) =>
    1 - smoothstep(BLEND_NEAR, BLEND_FAR, bedMask.at(x, z));
  const padY = (x: number, z: number, yb0: number): number => {
    const yb = pondFills.length ? fill(pondFills, x, z, yb0) : yb0;
    const w = townWeight(x, z);
    let y = yb;
    if (w > 0) {
      // Outside a pad the feather blends toward the pad's height at its
      // nearest edge (carried out by the distance transform), so there is no
      // step where the pad ends.
      const bedY = Gt.sample(x, z)?.y ?? bedMask.nearestValue(x, z);
      if (bedY !== null) y = yb + (bedY - yb) * w;
    }
    // The pond keeps the ground it was dug into.
    if (boundWater.length) {
      const k = 1 - smoothstep(BOUND_NEAR, BOUND_FAR, keepMask.at(x, z));
      y += (yb - y) * k;
    }
    if (chipDist(x, z) < CHIP_KEEP + 0.05) y = Math.min(y, Math.max(yb, CHIP_CLAMP_Y));
    return y;
  };
  const ground1 = reheight(baseGround, (x, z, y) => padY(x, z, y));
  const G1 = new HeightField(ground1);

  // --- heroes and props: where each goes -----------------------------------
  // A pool must also FIT its spot: the ground there has to be level enough
  // to carve its basin into (water.ts).
  const fits = (places: Place[]): string | null => {
    const wl = seatWater(places, G1);
    if (wl === null) return "no ground";
    const prims = emitPlaces(places);
    const b = boxOfPrims(prims);
    return carveCost(basinOf(prims), G1, [b[0], b[2], b[3], b[5]]) > MAX_CARVE ? "slope" : null;
  };
  const heroes = placeHeroes(
    terrain,
    props,
    input.ground,
    input.dir,
    buildingMask,
    Gb,
    G1,
    pavingMask,
    "town",
    fits,
    latticeSnap(latticePoints(baseGround.flatMap((p) => p.prims))),
  );
  log.heroes = heroes.log;
  if (pondGone.size) {
    heroes.places = heroes.places.filter((p) => !pondGone.has(p.c));
    heroes.groups = heroes.groups.filter((g) => !g.places.some((p) => pondGone.has(p.c)));
    heroes.footprints = heroes.footprints.filter((f) => !boundHeroes.some(([h]) => h === f.hero));
    for (const c of pondGone) {
      heroes.claimed.add(c);
      heroes.dropped.add(c);
    }
  }
  const sorted = sortProps({
    props,
    heroes,
    mask: townMask,
    distance: DROP_DISTANCE,
    rules,
    keep: input.keep,
    drop: input.drop,
    Gb,
    Gn: G1,
    used,
    log,
  });
  let kept: Place[] = [...heroes.places, ...sorted.kept];
  // The pond's own dressing (its reeds and stones) gives way to the town
  // like any prop; its water never moves.
  kept = kept.filter((p) => {
    if (!boundWater.length || isWaterBody(p.c) || !heroes.claimed.has(p.c)) return true;
    const bound = Object.values(input.ground?.heroes ?? {}).some(
      (h) => h.ground_bound && heroClusters(props, h).includes(p.c),
    );
    if (!bound) return true;
    for (const [x, , z] of placedPoints(p))
      if (townMask.at(x, z) < DROP_DISTANCE) {
        log.dropped.push(`${p.c.id} (gave way to the town)`);
        return false;
      }
    return true;
  });

  // --- the recipe's nudges -------------------------------------------------
  for (const [sel, [dx, dz]] of Object.entries(input.nudge ?? {})) {
    for (const p of kept) {
      if (!selects(sel, p.c)) continue;
      used.nudge.add(sel);
      p.sx += dx;
      p.sz += dz;
      log.nudged.push(p.c.id);
    }
    for (const part of town) {
      if (part.name !== sel) continue;
      used.nudge.add(sel);
      translatePrims(part.prims, dx, 0, dz);
      if (part.origin) part.origin = [part.origin[0] + dx, part.origin[1], part.origin[2] + dz];
      log.nudged.push(part.name);
    }
  }
  // A recipe line that no longer picks anything is a recipe that has rotted.
  for (const [what, list] of [
    ["drop", input.drop],
    ["keep", input.keep],
    ["nudge", Object.keys(input.nudge ?? {})],
  ] as const) {
    for (const sel of list ?? []) {
      if (!used[what].has(sel)) throw new Error(`${terrain}: ${what} "${sel}" picks nothing`);
    }
  }

  // Every kept pool, moved or not, is set level on the ground under it and its
  // basin carved there (the hand-made swamp's pools float at their downhill
  // edges; these do not). The carving is the last thing done to the ground,
  // below. Where a pool left, its dip is filled.
  const neverDrop = new Set(rules.never_drop ?? []);
  const waterGroups: Place[][] = [];
  for (const g of heroes.groups)
    if (g.places.every((p) => isWaterBody(p.c)) && !isBound(g.places, boundWater))
      waterGroups.push(g.places);
  for (const p of sorted.kept)
    if (isWaterBody(p.c) && !neverDrop.has(p.c.node) && !boundWater.includes(p.c))
      waterGroups.push([p]);
  for (const g of waterGroups) seatWater(g, G1);
  let basins: Basin[] = waterGroups.map((g) => basinOf(emitPlaces(g)));
  const fills: Fill[] = [];
  for (const g of heroes.groups) {
    if (!g.moved || !g.places.every((p) => isWaterBody(p.c))) continue;
    const spec = input.ground?.heroes?.[g.hero];
    if (!spec) continue;
    const f = fillOf(spec.anchor.file[0], spec.anchor.file[1], spec.footprint_r, G1);
    if (f) fills.push(f);
  }
  for (const c of heroes.dropped) {
    // A pool that could not fit anywhere leaves its dip too.
    const [cx, cz] = clusterCentre(c);
    const r = Math.max(c.box[3] - c.box[0], c.box[5] - c.box[2]) / 2;
    const f = fillOf(cx, cz, r, G1);
    if (f) fills.push(f);
  }
  const ground2 = reheight(ground1, (x, z, y) => {
    let v = y;
    if (fills.length) {
      // Only where the town has not already set the ground.
      const w = 1 - townWeight(x, z);
      if (w > 0) v = v + (fill(fills, x, z, v) - v) * w;
    }
    return v;
  });
  const G2 = new HeightField(ground2);

  // Riders of a pool that moved go with it (a lily pad, a reed at its
  // edge), unless where it went puts them on the town.
  const hostOf = new Map<Cluster, Place>(heroes.places.map((p) => [p.c, p]));
  const riderOf: [Place, Place][] = [];
  for (const { rider, host } of sorted.riders) {
    const h = hostOf.get(host);
    if (!h) continue;
    const pl: Place = { ...h, c: rider, mode: "rigid" };
    let ok = true;
    for (const [x, , z] of placedPoints(pl)) {
      if (
        buildingMask.at(x, z) < DROP_DISTANCE ||
        pavingMask.at(x, z) < DROP_DISTANCE ||
        chipDist(x, z) < CHIP_KEEP ||
        hexApothem(x, z) > HERO_APOTHEM
      ) {
        ok = false;
        break;
      }
    }
    if (ok) {
      kept.push(pl);
      riderOf.push([pl, h]);
    } else log.dropped.push(`${rider.id} (its pool moved onto the town)`);
  }

  // A clipped pond: paving triangles over a ground-bound hero go.
  const noPaving = heroes.footprints.filter((f) => rules.clip_paving_over?.includes(f.hero));
  if (noPaving.length) {
    for (const part of town) {
      if (roleOf(part) !== "paint") continue;
      part.prims = part.prims.map((prim) => {
        const keepTri: number[] = [];
        for (let i = 0; i < prim.pos.length; i += 9) {
          const cx = (prim.pos[i] + prim.pos[i + 3] + prim.pos[i + 6]) / 3,
            cz = (prim.pos[i + 2] + prim.pos[i + 5] + prim.pos[i + 8]) / 3;
          if (!noPaving.some((f) => Math.hypot(cx - f.x, cz - f.z) < f.r)) keepTri.push(i);
        }
        const pos = new Float32Array(keepTri.length * 9),
          nrm = new Float32Array(keepTri.length * 9);
        keepTri.forEach((i, n) => {
          pos.set(prim.pos.subarray(i, i + 9), n * 9);
          nrm.set(prim.nrm.subarray(i, i + 9), n * 9);
        });
        if (keepTri.length * 9 !== prim.pos.length) log.clipped.push(part.name);
        return { material: prim.material, pos, nrm };
      });
    }
  }

  // Each paint part gets a surface smooth at the ground's scale (drape.ts: a
  // plane for the plaza, a graded profile for a spoke), and the ground under
  // and beside it is set to that surface. The sheet itself is not laid: the
  // ground's triangles in its footprint take its colour (paint.ts), so nothing
  // can float over the ground or be pierced by it.
  const townOut: Part[] = town.map((p) => clonePart(p));
  const drapeParts = townOut.filter((p) => roleOf(p) === "paint");
  hideUnder(drapeParts, (p) => /_plaza$/.test(p.name));
  const surfaces = drapeSurfaces(drapeParts, G2, (p) => /_plaza$/.test(p.name), Gt);
  const touching = drapeCorners(ground2, surfaces);
  // A pool beside a road sits no higher than the road; a pool rim above it
  // would stand clear of the bank. (Lowering the water cuts deeper; it never
  // floats an edge.)
  let reseated = false;
  for (const g of waterGroups) {
    let cap = Infinity;
    for (const prim of emitPlaces(g))
      for (let i = 0; i < prim.pos.length; i += 3) {
        const x = prim.pos[i],
          z = prim.pos[i + 2];
        for (const sfc of surfaces)
          if (sfc.foot.at(x, z) < DRAPE_REACH + 0.1)
            cap = Math.min(cap, sfc.line(x, z) - WATER_RIM);
      }
    const wl = g[0].yNew;
    if (cap < wl) {
      for (const p of g) p.yNew = cap;
      reseated = true;
    }
  }
  if (reseated) basins = waterGroups.map((g) => basinOf(emitPlaces(g)));
  for (const [r, h] of riderOf) Object.assign(r, { yOld: h.yOld, yNew: h.yNew });
  // The pools' basins are carved last, into everything but the paving
  // and the ground faces that reach under it: a pool is clear of the paving,
  // but its shelf can reach the feather the paving blends back over.
  const drapeAt = new HeightField(drapeParts.flatMap((p) => p.prims));
  const groundSet = reheight(ground2, (x, z, y) => {
    // The pond keeps its dug ground from the paving too: its bank is what
    // holds its water in, and the paving over it is clipped (above).
    const keep = boundWater.length ? 1 - smoothstep(BOUND_NEAR, BOUND_FAR, keepMask.at(x, z)) : 0;
    let t = groundUnderDrapes(surfaces, touching, x, z, y);
    if (keep < 1 && (touching.has(vkey(x, z)) || drapeAt.sample(x, z)))
      return underSheets(basins, x, z, t);
    t += (y - t) * keep;
    return basins.length ? carve(basins, x, z, t) : t;
  });
  // Evening the paint never moves a point a pool's or the pond's water is
  // tucked against: their banks hold the water in.
  const waterNear = new KeepOut().add(waterGroups.flatMap((g) => emitPlaces(g))).finish();
  const paintIn = {
    ground: groundSet,
    plan,
    path: yard,
    salt: saltOf(terrain),
    still: (x: number, z: number) =>
      waterNear.at(x, z) < WATER_STILL || (boundWater.length > 0 && keepMask.at(x, z) < BOUND_FAR),
  };
  let paint = paintGround(paintIn);
  let groundOut = paint.ground;
  const Gn = new HeightField(groundOut);

  // --- everything seated on the finished ground -----------------------------
  const fixedPrims = townOut.filter((p) => roleOf(p) === "fixed").flatMap((p) => p.prims);
  const waterPrims = waterGroups.flatMap((g) => emitPlaces(g));
  // The lake's own bed and banks are props the composer never moves
  // (`never_drop`): the reeds and stones on them stand on them.
  const structural = emitPlaces(props.filter((c) => neverDrop.has(c.node)).map((c) => stay(c, 0)));
  const support = new HeightField([...groundOut, ...fixedPrims, ...waterPrims, ...structural]);
  // What the base's props stood on: its ground, its pools' water, its banks.
  const Sb = new HeightField([
    ...baseGround.flatMap((p) => p.prims),
    ...emitPlaces(props.filter(isWaterBody).map((c) => stay(c, 0))).filter((p) =>
      WATER_MATERIAL.test(p.material),
    ),
    ...structural,
  ]);
  for (const out of townOut) {
    if (roleOf(out) !== "rigid") continue;
    // Authored standing on the 0.25 plane (local z 0 is its ground line): it
    // stands on whatever it lands on (ground, plaza, a lake town's deck),
    // touching it and not sunk.
    let authoredMin = Infinity,
      placedMin = Infinity;
    for (const prim of out.prims)
      for (let i = 0; i < prim.pos.length; i += 3) {
        authoredMin = Math.min(authoredMin, prim.pos[i + 1]);
        const s = support.sample(prim.pos[i], prim.pos[i + 2]);
        if (s) placedMin = Math.min(placedMin, prim.pos[i + 1] - s.y);
      }
    if (!Number.isFinite(placedMin)) continue;
    const dy = Math.min(0, authoredMin - DRAPE_PLANE) - placedMin;
    translatePrims(out.prims, 0, dy, 0);
    if (out.origin) out.origin = [out.origin[0], out.origin[1] + dy, out.origin[2]];
  }
  // "fixed" keeps its authored height: a lake town's deck is level with the
  // lake's water, which the ground under it does not move.
  const inWater = new Set(waterGroups.flat());
  for (const g of heroes.groups) {
    if (g.places.some((p) => inWater.has(p) || p.mode === "fixed")) continue;
    if (isBound(g.places, boundWater)) continue;
    keepInside(g.places);
    seatGroup(g.places, support, Sb);
  }
  for (const g of sorted.groups) {
    if (g.some((p) => inWater.has(p))) continue;
    keepInside(g);
    seatGroup(g, support, Sb);
  }
  // A rider goes where its pool went and stands (or floats) on what it lands
  // on there as it did on the base: a lily pad on the water, a reed on the bank.
  for (const [r] of riderOf) seatOne(r, support, Sb);
  for (const p of kept) {
    // A long, low body lies on the ground vertex by vertex and is in no
    // group, so the border keep-out takes it on its own (place.ts).
    if (p.mode === "follow") keepInside([p]);
    if (p.mode === "follow") p.grounds = { Gb, Gn };
    else if (p.mode === "drape") p.grounds = { Gb, Gn };
  }
  // A hero that floats on water in the base is set on the water of the
  // nearest kept pool, or dropped.
  kept = moorFloaters(kept, heroes, basins, props, buildingMask, pavingMask, log);

  // A prop standing on the paint (a hero whose spot reaches under a pocket the
  // paint closed) keeps its own ground colour under its foot; only the colour
  // is removed. (A foot is the unburied vertices near its lowest; a dune
  // melted under the town lies under the ground, not on it.)
  const bare = new Set<number>();
  for (const p of kept) {
    // A pool's foot is its own edge, a run of lattice edges shared with the
    // surrounding ground, so every triangle beyond it would lose its paint. The
    // hero checks keep pools clear of the paving instead.
    if (isWaterBody(p.c)) continue;
    const pts = [...placedPoints(p)];
    const low = Math.min(...pts.map((q) => q[1]));
    const feet: [number, number][] = [];
    for (const [x, y, z] of pts) {
      const g = Gn.sample(x, z);
      if (y <= low + FOOT_BAND && (!g || y > g.y - FOOT_BAND)) feet.push([x, z]);
    }
    const under = trisUnder(plan, feet);
    if (!under.size) continue;
    for (const t of under) bare.add(t);
    log.unpainted.push(`${p.c.id} (${under.size})`);
  }
  if (bare.size) {
    paint = paintGround({ ...paintIn, bare });
    groundOut = paint.ground;
  }
  log.painted = paint.painted;

  // Kerb stones on the plaza's edge and the spokes', clear of everything
  // that stands on the ground: the town's buildings and decks, every kept
  // prop where it now is, and the water.
  const standing = new KeepOut()
    .add([
      ...townOut.filter((p) => roleOf(p) !== "paint").flatMap((p) => p.prims),
      ...emitPlaces(kept),
      ...waterPrims,
    ])
    .finish();
  const kerbs = kerbStones(
    paint,
    Gn,
    (x, z) => standing.at(x, z) < KERB_CLEAR,
    saltOf(terrain),
    (i) => `${terrain}_town_kerb_${String(i + 1).padStart(2, "0")}`,
  );
  log.kerbs = kerbs.length;
  const townParts = townOut.filter((p) => roleOf(p) !== "paint");

  // The ground's budget rule: drop its listed nodes, whole and in order,
  // until the tile fits (the desert base alone is over the budget).
  if (rules.budget_drop_order?.length) {
    const fixed =
      [...townParts, ...kerbs].reduce(
        (n, p) => n + p.prims.reduce((m, q) => m + q.pos.length / 9, 0),
        0,
      ) +
      groundOut.reduce((n, q) => n + q.pos.length / 9, 0) +
      [...partsWithRole(base, "slab"), ...partsWithRole(base, "rim")].reduce(
        (n, p) => n + p.prims.reduce((m, q) => m + q.pos.length / 9, 0),
        0,
      );
    const fit = fitBudget(kept, fixed, TRI_BUDGET - 1, rules.budget_drop_order);
    kept = fit.kept;
    log.budgetDropped = fit.dropped;
  }
  checkMinimums(terrain, kept, rules);
  log.kept = kept.length;

  // --- assembly --------------------------------------------------------------
  // `Town_W_house_01` -> `town_house_01`, `LakeTown_W_deck` -> `town_deck`.
  const townName = (name: string) =>
    `${terrain}_town_${name.replace(/^(Town_[A-Za-z]+|LakeTown_[A-Z]+)_/, "")}`;
  const parts: Part[] = [];
  for (const s of partsWithRole(base, "slab")) parts.push(clonePart(s, `Hex_${terrain}`));
  for (const r of partsWithRole(base, "rim")) parts.push(clonePart(r, `${terrain}_rim`));
  parts.push({ name: `${terrain}_ground`, prims: groundOut });
  for (const p of townParts) parts.push({ name: townName(p.name), prims: p.prims });
  parts.push(...kerbs);
  const byNode = new Map<string, Place[]>();
  for (const p of kept) {
    const l = byNode.get(p.c.node);
    if (l) l.push(p);
    else byNode.set(p.c.node, [p]);
  }
  parts.push(
    ...propParts(terrain, baseT, byNode, new Set(parts.map((p) => p.name)), countNodes(props)),
  );
  return finish(terrain, parts, [base, layout, ...(input.shared ? [input.shared] : [])], base, log);
}

/** Loose parts per node. */
export function countNodes(props: { node: string }[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const c of props) n.set(c.node, (n.get(c.node) ?? 0) + 1);
  return n;
}

/**
 * The kept base props as parts, one per loose part as the hand-made tiles ship
 * them (a flock is `_sheep_01` .. `_sheep_09`, not one mesh), named after the
 * base node with the composed terrain's prefix. A node that is one part on the
 * base keeps its name; one that splits is numbered from 01 in placement order
 * regardless of how many survive, so `_undergrowth_01` means the same thing
 * on every tile. A name the tile already uses (a town part, the channel) gets
 * `_base`.
 */
export function propParts(
  terrain: string,
  baseT: string,
  byNode: Map<string, Place[]>,
  taken: Set<string>,
  /** How many loose parts each node has on the BASE tile, so a name does not depend on how many survived. */
  authored: Map<string, number>,
): Part[] {
  const out: Part[] = [];
  for (const [node, places] of byNode) {
    const stem = `${terrain}_${node.startsWith(`${baseT}_`) ? node.slice(baseT.length + 1) : node}`;
    places.forEach((pl, i) => {
      let name =
        (authored.get(node) ?? places.length) === 1
          ? stem
          : `${stem}_${String(i + 1).padStart(2, "0")}`;
      if (taken.has(name)) name = `${name}_base`;
      taken.add(name);
      out.push({ name, prims: emitPlaces([pl]) });
    });
  }
  return out;
}

/** Names, materials and socket for a composed tile; shared with the river composer. */
export function finish<L extends { tris: number }>(
  terrain: string,
  parts: Part[],
  sources: TileModel[],
  socketFrom: TileModel,
  log: L,
  budget = TRI_BUDGET,
): { model: TileModel; log: L } {
  const names = new Set<string>();
  for (const p of parts) {
    if (names.has(p.name)) throw new Error(`${terrain}: two parts named ${p.name}`);
    names.add(p.name);
  }
  const materials = new Map<string, MaterialDef>();
  for (const p of parts) {
    for (const prim of p.prims) {
      if (prim.material === YARD_PLACEHOLDER)
        throw new Error(`${terrain}: ${YARD_PLACEHOLDER} survived into ${p.name}`);
      const def = sources.map((s) => s.materials.get(prim.material)).find(Boolean);
      if (!def) throw new Error(`${terrain}: no definition for material ${prim.material}`);
      materials.set(prim.material, def);
    }
  }
  const socket = socketFrom.socket ? { ...socketFrom.socket, name: `Token_${terrain}` } : null;
  log.tris = parts.reduce((n, p) => n + p.prims.reduce((m, q) => m + q.pos.length / 9, 0), 0);
  if (log.tris > budget)
    throw new Error(`${terrain}: ${log.tris} triangles, over the ${budget} budget`);
  return { model: { root: `Hex_${terrain}`, parts, socket, materials }, log };
}

/** A pond that would cost the town more buildings than this (or its hall) gives way instead. */
export const POND_MAX_CULL = 2;
/** A building this close to a ground-bound hero's water is not built. */
export const BOUND_CLEAR = 0.05;
/** The ground-bound hero keeps its base ground to this far out, blending back over BOUND_FAR. */
export const BOUND_NEAR = 0.2;
export const BOUND_FAR = 0.5;
/** A prop's foot: its vertices this close to its lowest. */
export const FOOT_BAND = 0.02;
/** Painted ground this near a pool's water is not evened. */
export const WATER_STILL = 0.3;
/** A kerb stone stands this far from anything else standing on the ground. */
export const KERB_CLEAR = 0.1;
/** A floater moored on a pool sits this far inside its water's edge. */
export const MOOR_INSET = 0.15;

/**
 * Re-height a ground sheet vertex by vertex. Flat-shaded like the sheet it
 * came from: a moved face gets its own new normal, an untouched one keeps
 * the authored one exactly.
 */
export function reheight(
  src: Part[] | Prim[],
  f: (x: number, z: number, y: number) => number,
): Prim[] {
  const prims: Prim[] = (src as (Part | Prim)[]).flatMap((s) => ("prims" in s ? s.prims : [s]));
  return prims.map((prim) => {
    const pos = new Float32Array(prim.pos),
      nrm = new Float32Array(prim.nrm);
    for (let t = 0; t < pos.length / 9; t++) {
      let moved = false;
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        const y = Math.fround(f(pos[i], pos[i + 2], pos[i + 1]));
        if (y !== pos[i + 1]) moved = true;
        pos[i + 1] = y;
      }
      if (moved) {
        const n = faceNormal(pos, t);
        for (let k = 0; k < 3; k++) nrm.set(n, t * 9 + k * 3);
      }
    }
    return { material: prim.material, pos, nrm };
  });
}

function isBound(places: Place[], bound: Cluster[]): boolean {
  return places.some((p) => bound.includes(p.c));
}

function moorFloaters(
  kept: Place[],
  heroes: HeroResult,
  basins: Basin[],
  props: Cluster[],
  buildings: KeepOut,
  paving: KeepOut,
  log: TradeLog,
): Place[] {
  const baseWater = new HeightField(
    emitPlaces(props.filter(isWaterBody).map((c) => stay(c, 0))).filter((p) =>
      WATER_MATERIAL.test(p.material),
    ),
  );
  const drop = new Set<Place>();
  for (const g of heroes.groups) {
    if (g.places.some((p) => isWaterBody(p.c) || p.mode === "fixed")) continue;
    const floats = g.places.every((p) => {
      const [cx, cz] = clusterCentre(p.c);
      const w = baseWater.sample(cx, cz);
      return !!w && Math.abs(p.c.box[1] - w.y) < FLOAT_TOL;
    });
    if (!floats) continue;
    const p0 = g.places[0];
    const [ax, az] = clusterCentre(p0.c);
    // The other heroes it may not moor inside (a pool is water, and a punt
    // belongs on it).
    const others = heroes.footprints
      .filter(
        (f) =>
          f.hero !== g.hero &&
          !heroes.groups.some((q) => q.hero === f.hero && q.places.every((p) => isWaterBody(p.c))),
      )
      .map((f) => f.hull);
    const off = p0.c.box[1] - baseWater.sample(ax, az)!.y;
    const at = planPoint(p0, ax, az);
    // Already on water: set it on that water's level.
    let best: { b: Basin; x: number; z: number; d: number } | null = null;
    for (const b of basins) {
      if (b.inWater.at(at[0], at[1]) > MOOR_INSET) {
        best = { b, x: at[0], z: at[1], d: 0 };
        break;
      }
    }
    if (!best) {
      for (const b of basins) {
        for (let x = -2.4; x <= 2.4; x += 0.05) {
          for (let z = -2.4; z <= 2.4; z += 0.05) {
            if (b.inWater.at(x, z) < MOOR_INSET) continue;
            const d = Math.hypot(x - at[0], z - at[1]);
            if (best && d >= best.d) continue;
            const moved = g.places.map((p) => ({
              ...p,
              sx: p.sx + x - at[0],
              sz: p.sz + z - at[1],
            }));
            const clear = moved.every((p) => {
              for (const [px, , pz] of placedPoints(p))
                if (
                  buildings.at(px, pz) < HERO_CLEAR ||
                  paving.at(px, pz) < HERO_CLEAR ||
                  chipDist(px, pz) < CHIP_KEEP ||
                  hexApothem(px, pz) > HERO_APOTHEM ||
                  others.some((h) => insideDepth(h, px, pz) > -HERO_CLEAR)
                )
                  return false;
              return true;
            });
            if (clear) best = { b, x, z, d };
          }
        }
      }
      if (best) {
        for (const p of g.places) {
          p.sx += best.x - at[0];
          p.sz += best.z - at[1];
        }
        log.moored.push(`${g.hero} (${best.d.toFixed(2)} to water)`);
      }
    }
    if (!best) {
      for (const p of g.places) drop.add(p);
      log.moored.push(`${g.hero} dropped (no water it can reach)`);
      continue;
    }
    // y' = yNew + scale * y: its bottom `off` from the water line, as authored.
    let minY = Infinity;
    for (const p of g.places) minY = Math.min(minY, p.c.box[1]);
    for (const p of g.places) {
      p.yOld = 0;
      p.yNew = best.b.wl + off - p.scale * minY;
    }
  }
  return kept.filter((p) => !drop.has(p));
}
