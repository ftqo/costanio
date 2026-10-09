// The base tile's ordinary props (everything that is not a hero): which go,
// which stay, and what a ground's rules add to that. Shared by the trade and
// river composers, which differ only in what the props have to keep clear of.
import {
  HeightField,
  KeepOut,
  clusterCentre,
  clusterPlan,
  hull,
  insideDepth,
  type Cluster,
} from "./fields.ts";
import type { HeroResult, KeepRules } from "./heroes.ts";
import { smoothstep } from "./model.ts";
import { isLongLow, minLift, stay, type Place } from "./place.ts";
import { isWaterBody } from "./water.ts";
import type { Selector } from "./recipe.ts";

/**
 * Loose parts of one prop node closer than this in plan are one thing (the
 * blades of a sedge tuft, a fence and its posts): they stay or go together,
 * so a drop never leaves a stub.
 */
export const GROUP_GAP = 0.03;

/** Does `sel` pick this part? A node name picks all its parts; an id picks one. */
export function selects(sel: Selector, c: Cluster): boolean {
  return sel === c.node || sel === c.id;
}

export interface PropLog {
  dropped: string[];
  clipped: string[];
  forcedKeep: string[];
  forcedDrop: string[];
}

export interface PropInput {
  props: Cluster[];
  heroes: HeroResult;
  /** What the props must keep clear of (the town, the water). */
  mask: KeepOut;
  /** A vertex this close to the mask drops its part. */
  distance: number;
  rules: KeepRules;
  keep?: Selector[];
  drop?: Selector[];
  Gb: HeightField;
  Gn: HeightField;
  used: { drop: Set<string>; keep: Set<string> };
  log: PropLog;
}

/** Does a plan box reach into a circle? */
function boxCircle(b: Cluster["box"], x: number, z: number, r: number): boolean {
  const cx = Math.max(b[0], Math.min(x, b[3])),
    cz = Math.max(b[2], Math.min(z, b[5]));
  return Math.hypot(cx - x, cz - z) < r;
}

/**
 * Loose parts of the same node that are one thing: single linkage by the
 * plan gap between their boxes. Returns a group id per part.
 */
export function groupsOf(props: Cluster[]): Map<Cluster, number> {
  const id = props.map((_, i) => i);
  const find = (i: number): number => (id[i] === i ? i : (id[i] = find(id[i])));
  for (let i = 0; i < props.length; i++) {
    for (let j = i + 1; j < props.length; j++) {
      if (props[i].node !== props[j].node) continue;
      const a = props[i].box,
        b = props[j].box;
      const gx = Math.max(0, a[0] - b[3], b[0] - a[3]),
        gz = Math.max(0, a[2] - b[5], b[2] - a[5]);
      if (Math.hypot(gx, gz) < GROUP_GAP) id[find(i)] = find(j);
    }
  }
  return new Map(props.map((c, i) => [c, find(i)]));
}

function boxOfTris(tris: Cluster["tris"]): Cluster["box"] {
  const box: Cluster["box"] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = t.start + k * 3;
      for (let a = 0; a < 3; a++) {
        box[a] = Math.min(box[a], t.prim.pos[i + a]);
        box[a + 3] = Math.max(box[a + 3], t.prim.pos[i + a]);
      }
    }
  }
  return box;
}

/** A kept part this close to a moved hero's shape goes: the hero wins. */
export const HERO_WINS_GAP = 0.03;

/** A rider's centre may be this far outside its water's plan hull (a reed at the water's edge). */
export const RIDER_REACH = 0.05;

/**
 * What rides on a body of water: every other loose part whose centre is over
 * it (a lily pad, the reeds at its edge, a dead tree standing in it). A
 * rider moves with its pool and goes when its pool goes, so a pool never
 * leaves its lilies on the grass.
 */
export function ridersOf(props: Cluster[]): Map<Cluster, Cluster> {
  const hosts = props.filter(isWaterBody).map((h) => ({
    h,
    poly: hull([...clusterPlan(h)].map(([x, , z]) => [x, z] as [number, number])),
  }));
  const out = new Map<Cluster, Cluster>();
  for (const c of props) {
    if (hosts.some((h) => h.h === c)) continue;
    const [cx, cz] = clusterCentre(c);
    let best: Cluster | null = null,
      depth = -RIDER_REACH;
    for (const h of hosts) {
      const d = insideDepth(h.poly, cx, cz);
      if (d > depth) {
        depth = d;
        best = h.h;
      }
    }
    if (best) out.set(c, best);
  }
  return out;
}

export interface SortResult {
  kept: Place[];
  /** Kept parts that are one thing, to be seated with one lift. */
  groups: Place[][];
  /** Riders of a hero pool that MOVED: they go where it went (the caller moves them). */
  riders: { rider: Cluster; host: Cluster }[];
}

/** A melting dune is flattened over this band beyond the drop distance. */
export const MELT_BAND = 0.25;

export function sortProps(input: PropInput): SortResult {
  const { props, heroes, mask, distance, rules, log, used, Gb, Gn } = input;
  const dropAlways = new Set(rules.drop_always ?? []);
  const neverDrop = new Set(rules.never_drop ?? []);
  const clipNodes = new Set(rules.clip_nodes ?? []);
  const free = props.filter((c) => !heroes.claimed.has(c));
  const riders = ridersOf(props);
  const group = groupsOf(free);
  const movedFeet = heroes.footprints.filter((f) => f.moved);
  type Verdict = { c: Cluster; keep: boolean; place?: Place; hit: boolean };
  const verdicts: Verdict[] = [];
  for (const c of free) {
    // The ground's own rules first: what it says is structural (the lake's
    // water and banks) beats anything a recipe or the mask could say.
    if (neverDrop.has(c.node)) {
      verdicts.push({ c, keep: true, place: stay(c, 0), hit: false });
      continue;
    }
    if (dropAlways.has(c.node)) {
      log.dropped.push(c.id);
      verdicts.push({ c, keep: false, hit: false });
      continue;
    }
    const forceDrop = input.drop?.find((s) => selects(s, c));
    if (forceDrop) {
      used.drop.add(forceDrop);
      log.forcedDrop.push(c.id);
      verdicts.push({ c, keep: false, hit: false });
      continue;
    }
    let hit = false;
    for (const t of c.tris) {
      for (let k = 0; k < 3 && !hit; k++) {
        const i = t.start + k * 3;
        if (mask.at(t.prim.pos[i], t.prim.pos[i + 2]) < distance) hit = true;
      }
      if (hit) break;
    }
    // A part clear of the mask can still be under a moved hero, and the hero
    // wins (the contract): its footprint circle at its new spot clears what it
    // lands on. A hero that stays put already stood among these parts.
    if (!hit) hit = movedFeet.some((f) => boxCircle(c.box, f.x, f.z, f.r));
    // ...and its actual shape where it reaches past that circle (a kiln's
    // chimney, a barn's lean-to).
    if (!hit)
      hit = movedFeet.some((f) => {
        for (const [x, , z] of clusterPlan(c))
          if (insideDepth(f.hull, x, z) > -HERO_WINS_GAP) return true;
        return false;
      });
    const forceKeep = input.keep?.find((s) => selects(s, c));
    if (hit && forceKeep) {
      used.keep.add(forceKeep);
      log.forcedKeep.push(c.id);
      hit = false;
    }
    // A clip node (a dune) is not cut where the town covers it, since a cut
    // dune is an open shell. It melts instead: each vertex keeps its height
    // over the ground in proportion to its distance from the town, and is sunk
    // under it on the town, so it runs out under the paving whole. Water bodies
    // and their riders are never clipped (a pool cut in half has an open side).
    if (hit && clipNodes.has(c.node) && !isWaterBody(c) && !riders.has(c)) {
      log.clipped.push(c.id);
      const melt = (x: number, z: number) => {
        let m = smoothstep(distance, distance + MELT_BAND, mask.at(x, z));
        for (const f of movedFeet)
          m = Math.min(m, smoothstep(f.r, f.r + MELT_BAND, Math.hypot(x - f.x, z - f.z)));
        return m;
      };
      // A triangle melted flat at all three corners is under the ground
      // everywhere: it goes, and its edge with it is underground.
      const tris = c.tris.filter((t) => {
        for (let k = 0; k < 3; k++) {
          const i = t.start + k * 3;
          if (melt(t.prim.pos[i], t.prim.pos[i + 2]) > 0) return true;
        }
        return false;
      });
      if (tris.length === 0) {
        log.dropped.push(c.id);
        verdicts.push({ c, keep: false, hit: false });
        continue;
      }
      const rest: Cluster =
        tris.length === c.tris.length ? c : { ...c, tris, box: boxOfTris(tris) };
      verdicts.push({
        c,
        keep: true,
        hit: false,
        place: { ...stay(rest, 0), mode: "follow", grounds: { Gb, Gn }, melt },
      });
      continue;
    }
    if (hit) {
      log.dropped.push(c.id);
      verdicts.push({ c, keep: false, hit: true });
      continue;
    }
    verdicts.push({ c, keep: true, hit: false, place: prop(c, Gb, Gn) });
  }
  // A group goes whole: one tuft blade the town lands on takes the tuft.
  const hitGroups = new Set(verdicts.filter((v) => v.hit).map((v) => group.get(v.c)));
  for (const v of verdicts) {
    if (!v.keep || (v.place?.mode === "follow" && v.place.melt)) continue;
    if (neverDrop.has(v.c.node)) continue;
    if (hitGroups.has(group.get(v.c)) && !input.keep?.some((s) => selects(s, v.c))) {
      v.keep = false;
      log.dropped.push(`${v.c.id} (with its group)`);
    }
  }
  // Riders follow their water: gone with it, moved with it.
  const fate = new Map(verdicts.map((v) => [v.c, v.keep]));
  const out: SortResult = { kept: [], groups: [], riders: [] };
  for (const v of verdicts) {
    const host = riders.get(v.c);
    if (host && v.keep) {
      const hostKept = heroes.claimed.has(host) ? !heroes.dropped.has(host) : fate.get(host);
      if (!hostKept) {
        v.keep = false;
        log.dropped.push(`${v.c.id} (with its water)`);
      } else if (heroes.claimed.has(host) && heroes.movedClusters.has(host)) {
        v.keep = false;
        out.riders.push({ rider: v.c, host });
      }
    }
  }
  const byGroup = new Map<number, Place[]>();
  for (const v of verdicts) {
    if (!v.keep || !v.place) continue;
    out.kept.push(v.place);
    if (v.place.mode === "follow" || v.place.mode === "fixed" || neverDrop.has(v.c.node)) continue;
    const g = group.get(v.c)!;
    const l = byGroup.get(g);
    if (l) l.push(v.place);
    else byGroup.set(g, [v.place]);
  }
  out.groups = [...byGroup.values()];
  return out;
}

/** An ordinary kept prop: lying on the ground if it is long and low, standing on it otherwise. */
function prop(c: Cluster, Gb: HeightField, Gn: HeightField): Place {
  if (isLongLow(c)) return { ...stay(c, 0), mode: "follow", grounds: { Gb, Gn } };
  return stay(c, minLift(c, Gn, Gb));
}

/**
 * The `budget_drop_order` rule: drop those nodes, whole and in order, until
 * the tile fits its budget. Returns the nodes it dropped.
 */
export function fitBudget(
  kept: Place[],
  fixedTris: number,
  budget: number,
  order: string[],
): { kept: Place[]; dropped: string[] } {
  const tris = (ps: Place[]) => ps.reduce((n, p) => n + p.c.tris.length, 0);
  let out = kept;
  const dropped: string[] = [];
  for (const node of order) {
    if (fixedTris + tris(out) <= budget) break;
    if (!out.some((p) => p.c.node === node)) continue;
    out = out.filter((p) => p.c.node !== node);
    dropped.push(node);
  }
  return { kept: out, dropped };
}

/** What a `min_<what>` rule counts. */
const COUNTED: Record<string, RegExp> = {
  trees: /conifer|broadleaf|tree/i,
};

/**
 * The `min_<what>` rules: at least that many loose parts of <what> survive.
 * A failure is an error (it is what keeps a forest a forest).
 */
export function checkMinimums(where: string, kept: Place[], rules: KeepRules): void {
  for (const [k, v] of Object.entries(rules)) {
    if (!k.startsWith("min_") || typeof v !== "number") continue;
    const what = k.slice(4);
    const re = COUNTED[what] ?? new RegExp(what.replace(/s$/, ""), "i");
    const n = kept.filter((p) => re.test(p.c.node)).length;
    if (n < v) throw new Error(`${where}: ${k} is ${v}, and only ${n} survive`);
  }
}
