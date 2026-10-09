// Module board setup, ported from the SetupBoard hooks in engine/islands and
// engine/scenarios. These run after GenerateRadius and reshape the board, so a
// non-base ruleset's board is not reproducible without them.
//
// Each module receives a fresh rng at stream position 2 (engine/state.go calls
// rngFor(publicSeed, 2) once per module), so modules do not share a cursor.
//
// A second pass, FinishBoard (finishBoardFor), runs at stream position 3 for
// hooks that need the finished board. SetupBoard order is a name sort, so a
// survey done in pass one could be undone by a later module.

import {
  hexKey, hexesInRadius, hexEdges, hexVertices, edgeKey, edgeHexes, newEdge,
  neighbors, vert, vertKey, vertexHexes, N, S,
} from "./coords.mjs";
import {
  ResNone, Wood, Brick, Sheep, Wheat, Ore, Resources,
  Gold, Sea, Lake, Fog, ResLand, Border, Swamp,
  placeHarborsFor, producing, isLand, edgeSeaHex, pipValue, rebalanceNumbers, BoardFair,
} from "./board.mjs";
// The bundle concatenates modules into one scope (scripts/bundle-verify.mjs),
// so hexDist is imported rather than redeclared.
import { hexDist, frameBoard } from "./frame.mjs";

/** vertexHexesOf / vertexEdgesOf mirror Vertex.Hexes and Vertex.Edges. */
function vertexNeighbors(v) {
  if (v.side === N) {
    return [vert(v.q + 1, v.r - 1, S), vert(v.q, v.r - 1, S), vert(v.q + 1, v.r - 2, S)];
  }
  return [vert(v.q, v.r + 1, N), vert(v.q - 1, v.r + 1, N), vert(v.q - 1, v.r + 2, N)];
}

function vertexEdgesOf(v) {
  return vertexNeighbors(v).map((n) => newEdge(v, n));
}

function landVertex(b, v) {
  const hs = v.side === N
    ? [{ q: v.q, r: v.r }, { q: v.q, r: v.r - 1 }, { q: v.q + 1, r: v.r - 1 }]
    : [{ q: v.q, r: v.r }, { q: v.q, r: v.r + 1 }, { q: v.q - 1, r: v.r + 1 }];
  return hs.some((h) => isLand(b, h));
}

/**
 * landEdge mirrors board.LandEdge: one of the two hexes the edge separates is
 * land (derivation 12).
 */
function landEdge(b, e) {
  return edgeHexes(e).some((h) => isLand(b, h));
}

/**
 * spokeCount mirrors engine/scenarios.spokeCount: how many of the three caravans an
 * oasis at h can start. Each of corners 0, 2 and 4 needs an outward
 * (non-perimeter) land edge.
 */
function spokeCount(b, h) {
  const perim = new Set(hexEdges(h).map(edgeKey));
  const verts = hexVertices(h);
  let n = 0;
  for (const ci of [0, 2, 4]) {
    for (const ve of vertexEdgesOf(verts[ci])) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { n++; break; }
    }
  }
  return n;
}

function ringHexes(radius) {
  const out = [];
  for (const h of hexesInRadius(radius)) {
    const x = h.q, y = -h.q - h.r, z = h.r;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) === radius) out.push(h);
  }
  return out;
}

/**
 * OFF_BOARD is board.OffBoard's coordinate: where the robber stands while it is
 * off the board. No tile lookup can match it.
 */
const OFF_BOARD = -(2 ** 30);

/** robberOnBoard mirrors board.RobberOnBoard. */
function robberOnBoard(b) {
  return !(b.robber && b.robber.q === OFF_BOARD && b.robber.r === OFF_BOARD);
}

/**
 * robberOK mirrors board.RobberOK: the hexes the robber may sit on (producing
 * land, gold, desert, lake and swamp).
 */
function robberOK(b, h) {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined &&
    (producing(t.res) || t.res === ResNone || t.res === Gold || t.res === Lake ||
     t.res === Swamp);
}

/**
 * robberNeutral mirrors board.RobberNeutral: a hex that blocks nothing, which
 * setup and relocation prefer. Swamp counts, as in Go: an authored map with a
 * swamp and no desert would otherwise take relocateRobber's drawing branch
 * here and not in the engine.
 */
function robberNeutral(b, h) {
  const t = b.tiles.get(hexKey(h));
  return t !== undefined && (t.res === ResNone || t.res === Lake || t.res === Swamp);
}

/** hasNeutral: does any hex on the board block nothing? */
function hasNeutral(b) {
  for (const t of b.tiles.values()) {
    if (t.res === ResNone || t.res === Lake || t.res === Swamp) return true;
  }
  return false;
}

/** ringOf: a hex's distance from the centre, in rings. */
function ringOf(h) {
  return Math.max(Math.abs(h.q), Math.abs(-h.q - h.r), Math.abs(h.r));
}

/** pips mirrors board.Pips: dice combinations a token pays on, 0 for no token. */
function pips(n) {
  return (n <= 0 || n === 7) ? 0 : 6 - Math.abs(7 - n);
}

/**
 * oasisSites mirrors engine/scenarios.oasisSites: interior producing hexes with
 * enough land around them to start all three caravans, in board order. The
 * finishers draw from this list with the seeded rng.
 */
function oasisSites(b) {
  const all = [], spoked = [];
  for (const h of hexesInRadius(b.radius)) {
    if (ringOf(h) >= b.radius) continue;
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || !producing(t.res)) continue;
    all.push(h);
    if (spokeCount(b, h) === 3) spoked.push(h);
  }
  return spoked.length > 0 ? spoked : all;
}

/**
 * pickOasis mirrors engine/scenarios.pickOasis: the first desert in board order, else
 * the first lake.
 */
function pickOasis(b) {
  const hs = neutralHexes(b);
  return hs.length > 0 ? hs[0] : null;
}

/** neutralHexes mirrors engine/scenarios.neutralHexes: deserts, then lakes, each in board order. */
function neutralHexes(b) {
  const out = [];
  for (const want of [ResNone, Lake]) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && t.res === want) out.push(h);
    }
  }
  return out;
}

/** oasisCountFor mirrors engine/scenarios.oasisCountFor (derivation 13): 1, 2 or 3 oases. */
export function oasisCountFor(players) {
  return players <= 4 ? 1 : players <= 6 ? 2 : 3;
}

/**
 * pickOases mirrors engine/scenarios.pickOases: the neutral hexes in order, each
 * taken unless it clashes with one already taken, until there are n.
 */
function pickOases(b, n) {
  const out = [];
  for (const h of neutralHexes(b)) {
    if (out.length === n) break;
    if (!out.some((o) => oasesClash(b, h, o))) out.push(h);
  }
  return out;
}

/**
 * oasesClash mirrors engine/scenarios.oasesClash: two oases clash when they touch or
 * a spoke of one shares an intersection with a spoke of the other.
 */
function oasesClash(b, a, c) {
  if (hexDist(a, c) < 2) return true;
  const ends = new Set();
  for (const e of spokeEdges(b, a)) { ends.add(vertKey(e.a)); ends.add(vertKey(e.b)); }
  return spokeEdges(b, c).some((e) => ends.has(vertKey(e.a)) || ends.has(vertKey(e.b)));
}

/** spokeEdges is oasisSpokes' real arrows (the missing ones left out). */
function spokeEdges(b, oasis) {
  const perim = new Set(hexEdges(oasis).map(edgeKey));
  const verts = hexVertices(oasis);
  const out = [];
  for (const ci of [0, 2, 4]) {
    for (const ve of vertexEdgesOf(verts[ci])) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { out.push(ve); break; }
    }
  }
  return out;
}

/**
 * relocateRobber mirrors islands.relocateRobber: the first neutral hex (desert,
 * lake or swamp), else a seeded pick among the lowest-pip legal hexes.
 */
function relocateRobber(b, rng) {
  for (const h of hexesInRadius(b.radius)) {
    if (robberNeutral(b, h)) { b.robber = h; return; }
  }
  let cands = [], best = -1;
  for (const h of hexesInRadius(b.radius)) {
    if (!robberOK(b, h)) continue;
    const p = pips(b.tiles.get(hexKey(h)).number);
    if (best < 0 || p < best) { best = p; cands = [h]; }
    else if (p === best) cands.push(h);
  }
  if (cands.length > 0) b.robber = cands[rng.intN(cands.length)];
}

/**
 * ringWalk mirrors islands.ringWalk: the hexes at exactly `radius` in cyclic
 * order, each adjacent to the next (hexesInRadius is row-major).
 */
function ringWalk(radius) {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  let h = { q: dirs[4][0] * radius, r: dirs[4][1] * radius };
  const out = [];
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < radius; i++) {
      out.push(h);
      h = { q: h.q + dirs[d][0], r: h.r + dirs[d][1] };
    }
  }
  return out;
}

/** outerIslands mirrors islands.outerIslands: 1 island at radius 2, 2 at 3, 3 at 4. */
function outerIslands(radius) {
  return Math.max(1, Math.min(3, radius - 1));
}

/** arcSpan mirrors islands.arcSpan. It draws on larger boards, so call order
 *  matters. */
function arcSpan(radius, rng) {
  if (radius < 3) return 2;
  return 2 + rng.intN(2);
}

/**
 * islandsSetupBoard ports engine/islands.SetupBoard: it carves a mainland, one
 * to three outer islands parted from it by a sea channel, a notched mainland
 * coast and gold on the islands, then recomputes harbors.
 *
 * The caller skips it when cfg.preset or cfg.board is set, as the Go hook does.
 */
export function islandsSetupBoard(b, rng, fair = false) {
  const ring = ringWalk(b.radius);
  const l = ring.length;
  const k = outerIslands(b.radius);
  const slot = Math.floor(l / k);

  const off = rng.intN(l);
  const inArc = new Set();
  // key -> hex, so the drowned set can be both tested and walked.
  const drown = new Map();
  const arcs = [];
  for (let i = 0; i < k; i++) {
    const span = arcSpan(b.radius, rng);
    const jitter = slot > span ? rng.intN(slot - span) : 0;
    const start = off + i * slot + jitter;
    const arc = [];
    for (let j = 0; j < span; j++) {
      const h = ring[(start + j) % l];
      arc.push(h);
      inArc.add(hexKey(h));
    }
    arcs.push(arc);
    for (const h of [ring[(((start - 1) % l) + l) % l], ring[(start + span) % l]]) {
      if (!inArc.has(hexKey(h))) drown.set(hexKey(h), h);
    }
  }
  // The channel: an arc hex's only remaining land neighbours are at ring R-1.
  for (const arc of arcs) {
    for (const h of arc) {
      for (const n of neighbors(h)) {
        if (ringOf(n) === b.radius - 1) drown.set(hexKey(n), n);
      }
    }
  }
  // Notches: single-hex bays, never shoulder to shoulder, at most `radius` of
  // them. The draw happens for every candidate whether or not it is accepted.
  let notches = 0;
  const budget = b.radius;
  for (let i = 0; i < l; i++) {
    const key = hexKey(ring[i]);
    if (inArc.has(key) || drown.has(key)) continue;
    const hit = rng.intN(4) === 0;
    if (!hit || notches === budget) continue;
    if (drown.has(hexKey(ring[(i + l - 1) % l])) || drown.has(hexKey(ring[(i + 1) % l]))) continue;
    drown.set(key, ring[i]);
    notches++;
  }

  for (const h of drown.values()) b.tiles.set(hexKey(h), { res: Sea, number: 0 });

  // If the carve took the last desert, make a new one from the lowest-pip
  // surviving hex (seeded tie-break). Reviving a drowned hex could close the
  // channel.
  if (!hasNeutral(b)) {
    let cands = [], best = -1;
    for (const h of hexesInRadius(b.radius)) {
      const key = hexKey(h);
      if (drown.has(key) || inArc.has(key)) continue;
      const t = b.tiles.get(key);
      if (t === undefined || !producing(t.res)) continue;
      const p = pips(t.number);
      if (best < 0 || p < best) { best = p; cands = [h]; }
      else if (p === best) cands.push(h);
    }
    if (cands.length > 0) {
      b.tiles.set(hexKey(cands[rng.intN(cands.length)]), { res: ResNone, number: 0 });
    }
  }

  goldRush(b, arcs, rng);

  // Fair boards are rebalanced after the carve (derivation 13). rng-free;
  // every token is movable since a carved board is never authored. Runs after
  // gold and before FinishBoard, as in Go.
  if (fair) rebalanceNumbers(b, () => true);

  // The carve may have drowned the robber's hex. An off-board robber
  // (Fishermen) is left alone, as in Go, so no extra draw is spent.
  if (robberOnBoard(b) && !robberOK(b, b.robber)) relocateRobber(b, rng);
  b.harbors = placeHarborsFor(rng, b, b.harbors.length);
}

/**
 * goldRush mirrors islands.goldRush: island tiles turn to gold at one in four,
 * keeping their token, and at least one always does.
 */
function goldRush(b, arcs, rng) {
  const cands = [];
  for (const arc of arcs) {
    for (const h of arc) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res) && t.number !== 0) cands.push(h);
    }
  }
  if (cands.length === 0) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res) && t.number !== 0) cands.push(h);
    }
  }
  let gold = 0;
  for (const h of cands) {
    if (rng.intN(4) !== 0) continue;
    b.tiles.set(hexKey(h), { res: Gold, number: b.tiles.get(hexKey(h)).number });
    gold++;
  }
  if (gold === 0 && cands.length > 0) {
    const h = cands[rng.intN(cands.length)];
    b.tiles.set(hexKey(h), { res: Gold, number: b.tiles.get(hexKey(h)).number });
  }
}

/**
 * fishermenSetupBoard turns every desert into a lake and puts the robber off
 * the board (it enters on the first 7), since on the lake it would block all
 * four lake numbers. It draws nothing.
 */
export function fishermenSetupBoard(b, rng) {
  for (const [k, t] of b.tiles) {
    // Number 0, as in Go: the lake pays on its four LakeNumbers, not a tile
    // token. Matters only for a config that numbered a desert.
    if (t.res === ResNone) b.tiles.set(k, { res: Lake, number: 0 });
  }
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * dealtTerrain is engine/scenarios/caravans.go's dealtTerrain: per hex, whether the
 * tile was dealt by the engine (movable) or pinned by the map author. Generic
 * land with a blank number was dealt; a named terrain or chosen token was
 * pinned, and a preset pins every tile.
 */
export function dealtTerrain(cfg) {
  // Board before preset, mirroring engine.State.New: an inlined board wins.
  if (cfg && cfg.board) {
    const src = new Map();
    for (const t of cfg.board.tiles || []) src.set(hexKey(t.hex), t);
    return (h) => {
      const t = src.get(hexKey(h));
      // Absent means Board.Frame added it as ocean: nobody's to promote.
      return t !== undefined && t.res === "land" && (t.num || 0) === 0;
    };
  }
  if (cfg && cfg.preset) return () => false;
  return () => true;
}

/**
 * caravansFinishBoard is engine/scenarios/caravans.go's FinishBoard: it ensures the
 * board has an oasis (a desert, or the lake Fishermen made of it) that can
 * start all three caravans. It runs after every SetupBoard because Islands may
 * drown the only desert.
 *
 * With no oasis left it promotes an interior producing hex (token removed) to
 * desert. The robber then goes off the board, since it may not start on the
 * oasis (derivation 10).
 *
 * It draws only when repairing: once for a promotion, once per swap, and once
 * per oasis fillOases promotes. The order of those draws on the position-3
 * stream must match Go.
 *
 * `dealt` says which hexes it may reshape (see dealtTerrain).
 */
export function caravansFinishBoard(b, rng, dealt = () => true, reserved = null, players = 0, fair = false) {
  finishOasis(b, rng, dealt, reserved, players, fair);
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/** finishOasis is engine/scenarios/caravans.go's finishOasis: the repair half. */
function finishOasis(b, rng, dealt, reserved = null, players = 0, fair = false) {
  // Hexes another module claims off the finished board (engine.ReservedHexes:
  // the Wagons trade-hex candidates). The oasis may not sit on one and no
  // repair moves it onto one (derivation 11).
  const isReserved = (h) => reserved !== null && reserved.has(hexKey(h));
  const n = oasisCountFor(players);
  if (pickOasis(b) === null && n === 1) {
    // No oasis: promote a seeded producing hex. Tables of five or more use
    // fillOases instead.
    const sites = oasisSites(b).filter((h) => dealt(h) && !isReserved(h));
    if (sites.length === 0) return;
    const h = sites[rng.intN(sites.length)];
    b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
    // Rebalance a fair board after removing a token (derivation 13). No
    // engine-dealt board reaches this today; oasischeck.mjs covers it.
    if (fair) rebalanceNumbers(b, dealt);
    return;
  }
  // Every oasis (derivation 13: two at 5-6 seats, three at 7-10) must start
  // three caravans and avoid reserved hexes. Each pass repairs the first bad
  // dealt oasis, else, while an oasis short, the first dealt neutral hex
  // pickOases skipped. The swap partner is an interior non-red hex that starts
  // three caravans and clashes with no other oasis; a hex with no partner is
  // marked stuck.
  const stuck = new Set();
  for (let i = 0; i < b.tiles.size; i++) {
    const oases = pickOases(b, n);
    let target = null;
    for (const o of oases) {
      if (stuck.has(hexKey(o)) || !dealt(o)) continue;
      if (spokeCount(b, o) !== 3 || isReserved(o)) { target = o; break; }
    }
    if (target === null && oases.length < n) {
      const taken = new Set(oases.map(hexKey));
      for (const h of neutralHexes(b)) {
        if (!taken.has(hexKey(h)) && !stuck.has(hexKey(h)) && dealt(h)) { target = h; break; }
      }
    }
    if (target === null) break;
    const others = oases.filter((o) => hexKey(o) !== hexKey(target));
    const sites = oasisSites(b).filter((h) => {
      if (!dealt(h) || isReserved(h) || spokeCount(b, h) !== 3) return false;
      const num = b.tiles.get(hexKey(h)).number;
      if (num === 6 || num === 8) return false;
      return !others.some((o) => oasesClash(b, h, o));
    });
    if (sites.length === 0) { stuck.add(hexKey(target)); continue; }
    const h = sites[rng.intN(sites.length)];
    const ta = b.tiles.get(hexKey(target)), tc = b.tiles.get(hexKey(h));
    b.tiles.set(hexKey(target), tc);
    b.tiles.set(hexKey(h), ta);
  }
  // Rebalance a fair board after a promotion (derivation 13).
  if (fillOases(b, rng, dealt, isReserved, n) && fair) rebalanceNumbers(b, dealt);
}

/**
 * fillOases is engine/scenarios.fillOases: for each oasis a table of five or more is
 * still short after the swaps (an Islands carve drowned a desert), promote an
 * interior, dealt, unreserved, non-red producing hex that starts three caravans
 * and clashes with no oasis, drawn from the finisher's stream after the swaps,
 * and only among the candidates that leave room for the rest (fillable). It
 * becomes a desert with no token. Reports whether it promoted any.
 */
function fillOases(b, rng, dealt, isReserved, n) {
  const oases = pickOases(b, n);
  let need = n - oases.length;
  if (need <= 0) return false;
  let cands = oasisSites(b).filter((h) => {
    if (!dealt(h) || isReserved(h) || spokeCount(b, h) !== 3) return false;
    const num = b.tiles.get(hexKey(h)).number;
    if (num === 6 || num === 8) return false;
    return !oases.some((o) => oasesClash(b, h, o));
  });
  while (need > 0 && !fillable(b, cands, need)) need--;
  for (let k = need; k > 0; k--) {
    const sites = cands.filter((h) => fillable(b, compatibleWith(b, cands, h), k - 1));
    const h = sites[rng.intN(sites.length)];
    b.tiles.set(hexKey(h), { res: ResNone, number: 0 });
    cands = compatibleWith(b, cands, h);
  }
  return need > 0;
}

/** compatibleWith is engine/scenarios.compatible: the candidates that do not clash with h. */
function compatibleWith(b, cands, h) {
  return cands.filter((c) => !oasesClash(b, c, h));
}

/** fillable is engine/scenarios.fillable: can k pairwise-compatible oases come from cands? */
function fillable(b, cands, k) {
  if (k <= 0) return true;
  for (let i = 0; i < cands.length; i++) {
    if (fillable(b, compatibleWith(b, cands.slice(i + 1), cands[i]), k - 1)) return true;
  }
  return false;
}

/**
 * fishermenFinishBoard is engine/scenarios/fishermen.go's FinishBoard: it ensures
 * the board still has a lake after every other module has run. It floods any
 * dealt desert that reappeared (Caravans' finisher makes one, and "caravans"
 * sorts first), and if no lake exists promotes a seeded interior hex. With
 * Caravans, the lake and the oasis are the same hex.
 */
export function fishermenFinishBoard(b, rng, dealt = () => true, reserved = null) {
  let lake = false;
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined) continue;
    if (t.res === ResNone) {
      // Only engine-dealt deserts are flooded.
      if (!dealt(h)) continue;
      b.tiles.set(hexKey(h), { res: Lake, number: 0 });
      lake = true;
    } else if (t.res === Lake) {
      lake = true;
    }
  }
  if (!lake) {
    const sites = oasisSites(b).filter(dealt);
    if (sites.length > 0) {
      const h = sites[rng.intN(sites.length)];
      b.tiles.set(hexKey(h), { res: Lake, number: 0 });
      if (robberOnBoard(b) && !robberNeutral(b, b.robber)) b.robber = h;
    }
  }
  keepLakesOffReserved(b, dealt, reserved);
}

/**
 * keepLakesOffReserved is engine/scenarios.keepLakesOffReserved (derivation 12): each
 * engine-dealt lake on a reserved hex (a Wagons trade-hex candidate) swaps
 * tiles with the nearest dealt, unreserved oasis site without a 6 or 8 (cube
 * distance, ties by board order). No draw.
 */
function keepLakesOffReserved(b, dealt, reserved) {
  if (reserved === null || reserved.size === 0) return;
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || t.res !== Lake || !reserved.has(hexKey(h)) || !dealt(h)) continue;
    let best = null, bestD = 0;
    for (const c of oasisSites(b)) {
      if (!dealt(c) || reserved.has(hexKey(c))) continue;
      const n = b.tiles.get(hexKey(c)).number;
      if (n === 6 || n === 8) continue;
      const d = hexDistOf(h, c);
      if (best === null || d < bestD) { best = c; bestD = d; }
    }
    if (best !== null) {
      const a = b.tiles.get(hexKey(h)), c = b.tiles.get(hexKey(best));
      b.tiles.set(hexKey(h), c);
      b.tiles.set(hexKey(best), a);
    }
  }
}

// ---------------------------------------------------------------------------
// Wagons (engine/wagons).
//
//   - SetupBoard removes the robber for the whole game; a 7 moves a barbarian.
//   - InitExtBoard derives the three trade hexes, which is the castle, and the
//     three barbarians' starts from the finished board and the public seed
//     (slot WagonsBoardSeq), recorded in EvBoardGenerated's ext blob.

/** WAGONS_BOARD_SEQ is engine.WagonsBoardSeq: the one public slot the board layer reads. */
export const WAGONS_BOARD_SEQ = -7_000_000;

/** TRADE_HEX_COUNT is three, at every player count. */
const TRADE_HEX_COUNT = 3;

/**
 * wagonsSetupBoard is engine/wagons.SetupBoard: the robber goes beside the
 * board and nothing brings it back.
 */
export function wagonsSetupBoard(b) {
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * capeOutward mirrors engine/wagons.capeOutward: a cape is land with exactly
 * three consecutive non-land neighbours; returns the middle one's direction,
 * or -1. On a full hexagon the capes are the six corners.
 */
function capeOutward(b, h) {
  if (!isLand(b, h)) return -1;
  const water = neighbors(h).map((nb) => !isLand(b, nb));
  if (water.filter(Boolean).length !== 3) return -1;
  for (let s = 0; s < 6; s++) {
    if (water[s] && water[(s + 1) % 6] && water[(s + 2) % 6]) return (s + 1) % 6;
  }
  return -1; // three, but not consecutive: a strait, not a cape
}

// hexDistOf is the cube distance between two hexes. It cannot be named
// hexDist: the bundle shares one scope with frame.mjs.
function hexDistOf(a, c) {
  const dq = a.q - c.q, dr = a.r - c.r, ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** MAX_CAPES bounds the triple enumeration, as engine/wagons.maxCapes does. */
const MAX_CAPES = 20;

/**
 * wagonsTrade is engine/wagons.deriveTrade: the triple of capes with the
 * largest minimum pairwise distance, the tie broken by the seeded rng, and the
 * three roles permuted over it.
 */
function wagonsTrade(b, rng, raiders = false, caravans = false, fishermen = false, castleAvoid = null, players = 0) {
 // Caravans' TradeHexAllowed: no oasis is a trade hex (derivation 11; every
 // oasis of a larger table since derivation 13).
 const oasis = caravans ? caravansOasis(b, players) : null;
 const oasisKeys = new Set(oasis && oasis.HasOasis ? oasis.Oases.map(hexKey) : []);
 const land = raiders ? raidersMainLandmass(b) : [];
 const landSet = new Set(land.map(hexKey));
 // Raiders' TradeHexAllowed: the castle, which avoids the watercourse and the
 // reserved hexes (derivation 12), is never a trade hex.
 const castle = raiders ? raidersCastleHex(b,land,landSet,castleAvoid) : null;
 // Fishermen's TradeHexAllowed: no lake is a trade hex (derivation 12).
 const isLake = (h) => { const t = b.tiles.get(hexKey(h)); return fishermen && t !== undefined && t.res === Lake; };
  let capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0 && (!raiders || (landSet.has(hexKey(h)) && (!castle || hexKey(h)!==hexKey(castle)))) && !oasisKeys.has(hexKey(h)) && !isLake(h)) capes.push(h);
  }
  if (capes.length > MAX_CAPES) capes = capes.slice(0, MAX_CAPES);
  if (capes.length < TRADE_HEX_COUNT) return null;
  let best = -1;
  let pick = [];
  for (let i = 0; i < capes.length; i++) {
    for (let j = i + 1; j < capes.length; j++) {
      for (let k = j + 1; k < capes.length; k++) {
        const d = Math.min(
          hexDistOf(capes[i], capes[j]), hexDistOf(capes[i], capes[k]), hexDistOf(capes[j], capes[k]),
        );
        if (d > best) { best = d; pick = []; }
        if (d === best) pick.push([capes[i], capes[j], capes[k]]);
      }
    }
  }
  if (pick.length === 0) return null;
  const hexes = pick[rng.intN(pick.length)];
  const roles = rng.perm(TRADE_HEX_COUNT);
  return { hexes, roles };
}

/** seawardEdgesOf are a trade hex's three blocked coastal edges. */
function seawardEdgesOf(b, h) {
  const out = [];
  for (const e of hexEdges(h)) {
    for (const hh of edgeHexes(e)) {
      if (hexKey(hh) !== hexKey(h) && !isLand(b, hh)) { out.push(e); break; }
    }
  }
  return out;
}

/** sharedEdgeOf is the edge two adjacent hexes share, or null. */
function sharedEdgeOf(a, c) {
  for (const e of hexEdges(a)) {
    for (const hh of edgeHexes(e)) {
      if (hexKey(hh) === hexKey(c)) return e;
    }
  }
  return null;
}

/** boardEdgesOf lists every edge of the board once, in board order. */
function boardEdgesOf(b) {
  const seen = new Set();
  const out = [];
  for (const h of hexesInRadius(b.radius)) {
    if (!b.tiles.has(hexKey(h))) continue;
    for (const e of hexEdges(h)) {
      const k = edgeKey(e);
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
  }
  return out;
}

/**
 * wagonsBarbarians is engine/wagons.deriveBarbarians: per trade hex, the path
 * shared by the hex one ring in along its outward direction and the hex one step
 * around from that, with a walk of the board's edge order as the fallback.
 */
function wagonsBarbarians(b, hexes) {
  const all = boardEdgesOf(b);
  const index = new Map(all.map((e, i) => [edgeKey(e), i]));
  const taken = new Set();
  const blocked = new Set();
  for (const h of hexes) for (const e of seawardEdgesOf(b, h)) blocked.add(edgeKey(e));
  const legal = (e) => {
    const k = edgeKey(e);
    return landEdge(b, e) && !blocked.has(k) && !taken.has(k);
  };
  const out = [];
  for (const h of hexes) {
    let start = 0;
    let placed = null;
    const dir = capeOutward(b, h);
    if (dir >= 0) {
      const d = neighbors({ q: 0, r: 0 });
      const inner = { q: h.q - d[dir].q, r: h.r - d[dir].r };
      const round = d[(dir + 1) % 6];
      const around = { q: inner.q + round.q, r: inner.r + round.r };
      const e = sharedEdgeOf(inner, around);
      if (e) {
        if (legal(e)) placed = e;
        else if (index.has(edgeKey(e))) start = index.get(edgeKey(e));
      }
    }
    if (!placed) {
      for (let n = 0; n < all.length; n++) {
        const e = all[(start + n) % all.length];
        if (legal(e)) { placed = e; break; }
      }
    }
    out.push(placed || { a: { q: 0, r: 0, side: N }, b: { q: 0, r: 0, side: N } });
    if (placed) taken.add(edgeKey(placed));
  }
  return out;
}

/**
 * wagonsFinishBoard is engine/wagons.FinishBoard (derivation 12): a harbour
 * whose ends are both a cape's sea-only corners (which a trade hex blocks for
 * building) moves to the first of the cape's other seaward edges, in the
 * cape's edge order, that shares no corner or dock hex with another harbour.
 * Covers every cape Wagons could pick, in board order; no draw.
 */
export function wagonsFinishBoard(b) {
  const capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0) capes.push(h);
  }
  const touchesLand = (c, v) => vertexHexes(v).some((hh) => hexKey(hh) !== hexKey(c) && isLand(b, hh));
  const fits = (i, e) => {
    const sea = harborSeaHex(b, { verts: [e.a, e.b] });
    if (sea === null) return false;
    for (let j = 0; j < b.harbors.length; j++) {
      if (j === i) continue;
      const o = b.harbors[j];
      const ov = o.verts.map(vertKey);
      if (ov.includes(vertKey(e.a)) || ov.includes(vertKey(e.b))) return false;
      const os = harborSeaHex(b, o);
      if (os !== null && hexKey(os) === hexKey(sea)) return false;
    }
    return true;
  };
  for (const c of capes.slice(0, MAX_CAPES)) {
    const corners = new Set(hexVertices(c).map(vertKey));
    for (let i = 0; i < b.harbors.length; i++) {
      const hb = b.harbors[i];
      if (!hb.verts.every((v) => corners.has(vertKey(v)) && !touchesLand(c, v))) continue;
      const own = edgeKey(newEdge(hb.verts[0], hb.verts[1]));
      for (const e of seawardEdgesOf(b, c)) {
        if (edgeKey(e) === own || !fits(i, e)) continue;
        b.harbors[i] = { ...hb, verts: [e.a, e.b] };
        break;
      }
    }
  }
}

/**
 * wagonsBoardExt is the audited half of the wagons ext blob: the three trade
 * hexes, their roles, and the three barbarian start paths. Field names and
 * shapes match engine/wagons.WagonsExt, since the check compares by key.
 */
export function wagonsBoardExt(b, publicSeed, rngFor, raiders = false, caravans = false, fishermen = false, castleAvoid = null, players = 0) {
  const t = wagonsTrade(b, rngFor(publicSeed, WAGONS_BOARD_SEQ), raiders, caravans, fishermen, castleAvoid, players);
  if (!t) return { Trade: [], Roles: [], HasTrade: false, Barbarians: [] };
  return {
    Trade: t.hexes.map((h) => ({ q: h.q, r: h.r })),
    Roles: t.roles,
    HasTrade: true,
    Barbarians: wagonsBarbarians(b, t.hexes),
  };
}

// ---------------------------------------------------------------------------
// The Rivers watercourse (engine/rivers/board.go)
// ---------------------------------------------------------------------------
//
// Everything from here to riversFinishBoard transcribes engine/rivers/board.go
// function for function and draw for draw; docs/rules/rivers.md ("Deriving the
// river on a generated board") specifies both. Where they disagree, Go wins.
//
// The derivation: one source-to-sea chain of land hexes per 30 land hexes,
// each chosen from the best-scoring candidates with one seeded draw. The board
// is then painted: the estuary becomes a swamp with no token and the source
// becomes mountains (see paintRivers). A second, cosmetic draw per east-west
// hex picks one of two meanders.
//
// It runs twice and both runs must agree: FinishBoard derives and paints, then
// InitExtBoard derives again off the painted board, and that second result is
// what the ext blob records. Both mint a fresh generator on the same slot, and
// the derivation reads no terrain, so painting cannot change the answer.
//
// Three names differ from Go to avoid collisions in the bundle's shared scope:
// newRiverGrid (newGrid), enumerateChains (enumerate), riverEligible
// (eligible).

/**
 * RIVERS_BOARD_SEQ is the reserved public slot the watercourse derivation
 * reads; must match engine.RiversBoardSeq. Rivers draws on every board, so on
 * the shared slot 3 its first draw would equal the Caravans repair draw.
 */
export const RIVERS_BOARD_SEQ = -4000000;

/**
 * RIVERS_VARIANT_SEQ is the public slot for the tile variant choice: which of
 * two east-west meanders each straight river hex draws (engine.RiversVariantSeq).
 * It is separate from RIVERS_BOARD_SEQ so it does not shift the chain draws.
 * The result is visible and recorded in the ext blob, so it is audited.
 */
export const RIVERS_VARIANT_SEQ = -4000001;

/** EW_VARIANTS is how many authored meanders the east-west straight has. */
const EW_VARIANTS = 2;

/**
 * BOARD_FINISH_SEQ is the shared position-3 slot for finishers without a
 * reserved slot of their own (engine's boardFinishSeq).
 */
export const BOARD_FINISH_SEQ = 3;

/**
 * riverCount is how many watercourses a board of this many land hexes carries:
 * 1 + (land-1)/30 (Go integer division). One river at radius 2 (19 hexes), two
 * at radius 3 (37), three at radius 4 (61).
 */
function riverCount(land) {
  if (land < 1) return 0;
  return 1 + Math.floor((land - 1) / 30);
}

/**
 * chainLenCeiling caps maxChainLen at its radius-4 value (11), the largest
 * procedural board. An authored map may be radius 16, and the search is
 * exponential in the cap.
 */
const chainLenCeiling = 11;

/** maxChainLen is the cap on a chain, 2*radius+3. */
function maxChainLen(radius) {
  return Math.min(2 * radius + 3, chainLenCeiling);
}

/** minChainLen is the shortest chain that reads as a river. */
const minChainLen = 4;

/**
 * searchNodeBudget bounds the chain enumeration for a whole derivation (all
 * rivers), so the counter is threaded through rather than reset per river.
 * Procedural boards peak around 1.5M nodes at radius 4, so 16M leaves about
 * 4x headroom; the bound exists for large authored maps.
 *
 * It is part of the derivation: when it runs out, the engine keeps the
 * candidates found so far, so a different budget would pick a different river.
 */
const searchNodeBudget = 16000000;

/**
 * riverEligible reports whether hex h may carry a channel (engine/rivers's
 * `eligible`). Excluded: sea, border, fog, generic land, desert, lake and gold.
 * Swamp stays eligible because the first pass paints one at the mouth and the
 * second pass must agree with it.
 */
function riverEligible(b, h) {
  const t = b.tiles.get(hexKey(h));
  if (t === undefined) return false;
  switch (t.res) {
    case Sea: case Border: case Fog: case ResNone:
    case Lake: case Gold: case ResLand:
      return false;
    default:
      return true;
  }
}

/**
 * openWater reports whether hex h borders sea or the board's edge (a missing
 * tile is not land), i.e. the coast a chain must reach.
 */
function openWater(b, h) {
  for (const n of neighbors(h)) {
    if (!isLand(b, n)) return true;
  }
  return false;
}

/**
 * dirTo returns the index in neighbors() of neighbour n of h, and whether n is
 * a neighbour at all.
 */
function dirTo(h, n) {
  const ns = neighbors(h);
  for (let i = 0; i < 6; i++) {
    if (ns[i].q === n.q && ns[i].r === n.r) return { dir: i, ok: true };
  }
  return { dir: 0, ok: false };
}

/**
 * drawable reports whether two channel directions out of one hex are a shape a
 * tile can draw: opposite (straight) or two apart (a bend). Adjacent directions
 * would be a 60 degree hairpin.
 */
function drawable(a, b) {
  const d = (((a - b) % 6) + 6) % 6;
  return d === 2 || d === 3 || d === 4;
}

/**
 * Directions: neighbors() runs {+1,0} {+1,-1} {0,-1} {-1,0} {-1,+1} {0,+1},
 * which the client draws as east, north-east, north-west, west, south-west and
 * south-east (bearings 0, 60, 120, 180, 240, 300). A chain may step in all
 * six; the step rule decides which chains exist, so it must match the engine.
 */

/**
 * edgeIndexForDir maps a neighbour direction (index in neighbors()) to the
 * index in hexEdges() of the shared edge: e = (1 - d) mod 6. hexEdges runs
 * clockwise from the north-east edge, neighbors anticlockwise from east.
 */
function edgeIndexForDir(d) {
  return (((1 - d) % 6) + 6) % 6;
}

/** seamEdge is the edge hexes a and b share. a and b must be neighbours. */
function seamEdge(a, b) {
  const { dir, ok } = dirTo(a, b);
  if (!ok) return null;
  return hexEdges(a)[edgeIndexForDir(dir)];
}

/**
 * outerEdge picks the coastal outlet at a chain's estuary: the edge shared with
 * a non-land neighbour whose direction is opposite or two apart from the seam
 * with its chain neighbour. The source end has no outlet.
 *
 * With several candidates, the first sea neighbour in board order (Q, R) wins;
 * the candidates are distinct, so the order is total.
 */
function outerEdge(b, end, inward) {
  const seam = dirTo(end, inward);
  if (!seam.ok) return { edge: null, dir: 0, ok: false };
  const cands = [];
  const ns = neighbors(end);
  for (let d = 0; d < 6; d++) {
    // drawable excludes the 60 degree hairpin at an end hex.
    if (isLand(b, ns[d]) || !drawable(d, seam.dir)) continue;
    cands.push({ hex: ns[d], dir: d });
  }
  if (cands.length === 0) return { edge: null, dir: 0, ok: false };
  cands.sort((x, y) => (x.hex.q !== y.hex.q ? x.hex.q - y.hex.q : x.hex.r - y.hex.r));
  const d = cands[0].dir;
  return { edge: hexEdges(end)[edgeIndexForDir(d)], dir: d, ok: true };
}

/** hexLess is board order over one hex: Q, then R. */
function hexLess(a, b) {
  if (a.q !== b.q) return a.q < b.q;
  return a.r < b.r;
}

/**
 * chainLess is board order over whole chains: h1's (Q, R), then h2's, and so
 * on. The candidate list is sorted by it so the seeded pick is stable.
 */
function chainLess(a, b) {
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (a[i].q !== b[i].q || a[i].r !== b[i].r) return hexLess(a[i], b[i]);
  }
  return a.length < b.length;
}

/**
 * newRiverGrid (engine/rivers's `newGrid`) flattens the board into
 * index-addressed arrays, in board order, for the chain walk, which visits
 * millions of nodes on the largest board.
 */
function newRiverGrid(b, reserved = null) {
  const all = hexesInRadius(b.radius);
  const g = {
    hexes: all,
    index: new Map(),
    // nbr[i][d] is the index of hex i's neighbour in direction d, or -1 when
    // that neighbour is off the board or ineligible.
    nbr: [],
    coastal: [],
    eligible: [],
  };
  all.forEach((h, i) => g.index.set(hexKey(h), i));
  for (let i = 0; i < all.length; i++) {
    const h = all[i];
    const free = (x) => !reserved || !reserved.has(hexKey(x));
    g.eligible[i] = riverEligible(b, h) && free(h);
    g.coastal[i] = openWater(b, h);
    const row = [-1, -1, -1, -1, -1, -1];
    const ns = neighbors(h);
    for (let d = 0; d < 6; d++) {
      const j = g.index.get(hexKey(ns[d]));
      if (j === undefined || !riverEligible(b, ns[d]) || !free(ns[d])) continue;
      row[d] = j;
    }
    g.nbr[i] = row;
  }
  return g;
}

/**
 * enumerateChains walks candidate chains and keeps only the best-scoring ones:
 * longest, then coastal ends farthest apart. `blocked` is earlier rivers and
 * their neighbours; `nodes` is the budget counter shared across the whole
 * derivation (a box, as Go passes a pointer). Discarding worse candidates as
 * it goes matters once the budget runs out.
 *
 * The walk starts at the estuary (a coastal hex) and each candidate is
 * reversed so `hexes` reads source to sea. A chain and its reverse are two
 * candidates when both ends are coastal; do not dedupe them.
 *
 * `maxLen` comes from deriveRivers, which lowers it pass by pass.
 */
function enumerateChains(b, g, blocked, minLen, maxLen, nodes) {
  const n = g.hexes.length;

  const chain = [];
  const onChain = new Array(n).fill(false);
  let best = [];
  let bestLen = 0, bestDist = 0;

  // touchesChain reports whether hex i touches a chain hex other than the
  // chain's last. This is the hairpin rule: if h(k-1) and h(k+1) were
  // adjacent, h(k)'s channel edges would be 60 degrees apart.
  const touchesChain = (i, last) => {
    for (const j of g.nbr[i]) {
      if (j >= 0 && j !== last && onChain[j]) return true;
    }
    return false;
  };

  const record = (outDir) => {
    const first = chain[0], last = chain[chain.length - 1];
    const fh = g.hexes[first], lh = g.hexes[last];
    const dist = hexDist(fh, lh);
    if (chain.length < bestLen || (chain.length === bestLen && dist < bestDist)) return;
    if (chain.length > bestLen || dist > bestDist) {
      bestLen = chain.length;
      bestDist = dist;
      best = [];
    }
    // Reversed so the candidate reads source to sea.
    best.push({
      hexes: chain.map((ci) => g.hexes[ci]).reverse(),
      outDir,
      endDist: dist,
    });
  };

  // walk extends the chain by one hex, away from the estuary. outDir/outOK are
  // the estuary's (chain[0]) coastal outlet, fixed once the chain has a second
  // hex.
  const walk = (outDir, outOK, inFrom) => {
    if (nodes.n > searchNodeBudget) return;
    if (outOK && chain.length >= minLen) record(outDir);
    if (chain.length >= maxLen) return;
    const last = chain[chain.length - 1];
    for (let d = 0; d < 6; d++) {
      const j = g.nbr[last][d];
      // Count every direction examined, as the engine does.
      nodes.n++;
      if (nodes.n > searchNodeBudget) return;
      if (j < 0 || blocked[j] || onChain[j]) continue;
      // The channel through `last` must be drawable.
      if (inFrom >= 0 && !drawable(inFrom, d)) continue;
      if (touchesChain(j, last)) continue;
      let nextOut = outDir, nextOK = outOK;
      if (chain.length === 1) {
        // The estuary's outlet depends on the chain's first step; without a
        // drawable outlet the subtree is dead.
        const oe = outerEdge(b, g.hexes[chain[0]], g.hexes[j]);
        if (!oe.ok) continue;
        nextOut = oe.dir;
        nextOK = true;
      }
      chain.push(j);
      onChain[j] = true;
      // j's seam back toward `last` is direction d+3.
      walk(nextOut, nextOK, (d + 3) % 6);
      onChain[j] = false;
      chain.pop();
    }
  };

  // Roots are coastal eligible hexes (estuaries).
  for (let i = 0; i < g.hexes.length; i++) {
    if (blocked[i] || !g.eligible[i] || !g.coastal[i]) continue;
    chain.length = 0;
    chain.push(i);
    onChain[i] = true;
    walk(0, false, -1);
    onChain[i] = false;
  }
  // Board order, matching Go's sort.SliceStable (Array.sort is stable).
  best.sort((x, y) => (chainLess(x.hexes, y.hexes) ? -1 : chainLess(y.hexes, x.hexes) ? 1 : 0));
  return best;
}

/**
 * buildRiver turns a chosen candidate into the stored River: channel edges per
 * hex, the mouth and the bridge sites. hexes[0] is the source and hexes[n-1]
 * the estuary (the mouth). The source has one opening, recorded as
 * in[0] === out[0], so there are n bridge sites: n-1 seams plus the outlet.
 *
 * Key order must match Go's field order (hexes, mouth, in, out, sites,
 * variants) because verifyBoardExt compares with JSON.stringify.
 */
function buildRiver(b, c) {
  const n = c.hexes.length;
  const hexes = c.hexes.slice();
  const inEdges = new Array(n).fill(null);
  const outEdges = new Array(n).fill(null);
  for (let i = 0; i < n - 1; i++) {
    const seam = seamEdge(hexes[i], hexes[i + 1]);
    // Unreachable: chain hexes are neighbours.
    if (seam === null) continue;
    outEdges[i] = seam;
    inEdges[i + 1] = seam;
  }
  outEdges[n - 1] = hexEdges(hexes[n - 1])[edgeIndexForDir(c.outDir)];
  // The source's single opening serves as both channel edges (after the loop,
  // so a one-hex chain gets its outlet).
  inEdges[0] = outEdges[0];
  // Bridge sites are exactly `out`, in chain order.
  const sites = outEdges.slice();
  const mouth = n - 1;
  return { hexes, mouth, in: inEdges, out: outEdges, sites, variants: new Array(n).fill(0) };
}

/**
 * isEastWest reports whether hex h's two channel edges are east and west, the
 * only shape with more than one meander (engine/rivers's isEastWest). The full
 * shape table is not needed to reproduce the variant.
 */
function isEastWest(h, inE, outE) {
  const es = hexEdges(h);
  const e = es[edgeIndexForDir(0)], w = es[edgeIndexForDir(3)];
  const same = (a, x) => a !== null && edgeKey(a) === edgeKey(x);
  return (same(inE, e) && same(outE, w)) || (same(inE, w) && same(outE, e));
}

/**
 * assignVariants picks each east-west hex's meander (engine/rivers's
 * assignVariants): one draw per such hex, in river then chain order, off
 * RIVERS_VARIANT_SEQ. Other hexes get 0.
 */
function assignVariants(rivers, rng) {
  for (const r of rivers) {
    r.variants = r.hexes.map((h, i) => (isEastWest(h, r.in[i], r.out[i]) ? rng.intN(EW_VARIANTS) : 0));
  }
}

/**
 * deriveRivers is the whole derivation (engine/rivers.DeriveRivers), a pure
 * function of the finished board and the reserved public stream.
 *
 * One draw per river: rng.intN indexes the best-scoring candidates (longest,
 * then ends farthest apart), sorted by board order.
 *
 * If the board cannot fit all its rivers, the whole derivation is rerun with a
 * lower length cap, and the first cap that fits wins. Failed passes still
 * spend draws from the same generator, so they must be reproduced.
 */
export function deriveRivers(b, rng, reserved = null) {
  if (!b) return [];
  let land = 0;
  for (const h of hexesInRadius(b.radius)) {
    if (isLand(b, h)) land++;
  }
  const want = riverCount(land);
  if (want === 0) return [];
  const g = newRiverGrid(b, reserved);
  // One budget for every pass and river, as in engine/rivers.
  const nodes = { n: 0 };
  let best = [];
  for (let cap = maxChainLen(b.radius); cap >= minChainLen; cap--) {
    const out = deriveAtCap(b, g, rng, want, minChainLen, cap, nodes);
    if (out.length === want) return out;
    if (out.length > best.length) best = out;
    if (nodes.n > searchNodeBudget) return best;
  }
  return best;
}

/** deriveAtCap chooses up to `want` rivers with chains of at most `cap` hexes. */
function deriveAtCap(b, g, rng, want, minLen, cap, nodes) {
  const blocked = new Array(g.hexes.length).fill(false);
  const out = [];
  for (let k = 0; k < want; k++) {
    // The seed picks one of the best-scoring chains.
    const best = enumerateChains(b, g, blocked, minLen, cap, nodes);
    if (best.length === 0) break;
    const r = buildRiver(b, best[rng.intN(best.length)]);
    out.push(r);
    // Later rivers may not touch this one, so each edge has at most one
    // channel.
    for (const h of r.hexes) {
      const j = g.index.get(hexKey(h));
      if (j !== undefined) blocked[j] = true;
      for (const nb of neighbors(h)) {
        const jn = g.index.get(hexKey(nb));
        if (jn !== undefined) blocked[jn] = true;
      }
    }
  }
  return out;
}

/**
 * swapPartner is engine/rivers's swapPartner: the mountain hex a headwater
 * trades terrain with. Preference: off-river first, then closest pips to the
 * headwater's token, then nearest, then board order. Never a source or mouth.
 */
function swapPartner(b, h, onRiver, ends) {
  let best = null, bestKey = null;
  const want = pipValue((b.tiles.get(hexKey(h)) || { number: 0 }).number || 0);
  for (const c of hexesInRadius(b.radius)) {
    const key = hexKey(c);
    if (ends.has(key)) continue;
    const t = b.tiles.get(key);
    if (t === undefined || t.res !== Ore) continue;
    const k = [onRiver.has(key) ? 1 : 0, Math.abs(pipValue(t.number || 0) - want), hexDist(h, c)];
    if (best === null || k[0] < bestKey[0] || (k[0] === bestKey[0] && (k[1] < bestKey[1] ||
        (k[1] === bestKey[1] && k[2] < bestKey[2])))) {
      best = c;
      bestKey = k;
    }
  }
  return best;
}

/**
 * paintRivers applies a derived layout (engine/rivers's `paint`): a swamp with
 * no chit at each estuary, mountains at each source, and every hex between
 * left as dealt (derivation 11).
 *
 * The headwater tile exists only for mountains, so the source swaps terrain
 * with a mountains hex (swapPartner), keeping its own if there is none. Chits
 * stay put, except the mouth's, which is discarded. Idempotent.
 */
export function paintRivers(b, rivers) {
  const onRiver = new Set();
  const ends = new Set();
  for (const r of rivers) {
    for (const h of r.hexes) onRiver.add(hexKey(h));
    ends.add(hexKey(r.hexes[0]));
    ends.add(hexKey(r.hexes[r.mouth]));
  }
  for (const r of rivers) {
    for (let i = 0; i < r.hexes.length; i++) {
      const h = r.hexes[i];
      const key = hexKey(h);
      if (i === r.mouth) {
        b.tiles.set(key, { res: Swamp, number: 0 });
        continue;
      }
      if (i !== 0) continue; // the channel runs through whatever was dealt
      // Mirrors Go's zero Tile; unreachable for a chain hex.
      const t = b.tiles.get(key) || { res: ResNone, number: 0 };
      if (t.res === Ore) continue;
      const partner = swapPartner(b, h, onRiver, ends);
      if (partner === null) continue;
      const pkey = hexKey(partner);
      const pt = b.tiles.get(pkey);
      b.tiles.set(key, { res: pt.res, number: t.number });
      b.tiles.set(pkey, { res: t.res, number: pt.number });
    }
  }
}

/**
 * riversFinishBoard is engine/rivers's FinishBoard: derive the watercourses and
 * paint them. Like the Go hook it has no authored-board guard.
 */
export function riversFinishBoard(b, rng, reserved = null, fair = false, movable = () => true) {
  paintRivers(b, deriveRivers(b, rng, reserved));
  // engine/rivers FinishBoard: a fair-mode board has the tokens the engine
  // dealt rebalanced over what painting left (derivation 11).
  if (fair) rebalanceNumbers(b, movable);
}

/**
 * reservedHexesFor is engine.ReservedHexes: hexes a module claims before other
 * derivations build on the board, as a set of hexKeys, or null. Only Wagons
 * reserves: its first MAX_CAPES capes in board order. Rivers routes around
 * them (derivation 11). It depends only on the land mask, so both Rivers
 * passes see the same set.
 */
export function reservedHexesFor(ruleset, b) {
  if (!String(ruleset || "").split("+").includes("wagons")) return null;
  const capes = [];
  for (const h of hexesInRadius(b.radius)) {
    if (capeOutward(b, h) >= 0) capes.push(h);
  }
  const out = new Set(capes.slice(0, MAX_CAPES).map(hexKey));
  return out.size === 0 ? null : out;
}

/**
 * setupBoardFor applies the ruleset's SetupBoard hooks, in ruleset order.
 *
 * `newRng` must mint a fresh generator per call (rngFor(publicSeed, 2) once
 * per module, as in engine/state.go).
 *
 * `supplied` is true when the config carried its own board (preset or inlined
 * map); terrain-reshaping hooks skip those, as in Go.
 *
 * Modules without a SetupBoard hook are omitted; verify_test.go's registry
 * check catches a new engine hook missing here.
 */
export function setupBoardFor(ruleset, b, newRng, supplied = false, players = 0, rngAt = null, mode = BoardFair) {
  for (const part of String(ruleset || "base").split("+")) {
    switch (part) {
      case "islands":
        if (!supplied) islandsSetupBoard(b, newRng(), mode === BoardFair);
        break;
      case "fishermen":
        fishermenSetupBoard(b, newRng());
        break;
      case "wagons":
        // Runs on authored boards too; it only removes the robber.
        wagonsSetupBoard(b, newRng());
        break;
      case EXPLORERS:
        // Explorers reads six reserved slots, hence `rngAt` (see BoardSeeder).
        // The Knights flag applies rule B (one starting-island forest becomes
        // fields).
        if (rngAt) {
          explorersSetupBoard(b, players, rngAt, String(ruleset || "").split("+").includes("cak"));
        }
        break;
      default:
        break; // base, Knights, Caravans: no SetupBoard hook
    }
  }
}

/**
 * finishBoardFor applies the ruleset's FinishBoard hooks, in ruleset order,
 * after every SetupBoard (engine/state.go's second board loop).
 *
 * `rngAt(seq)` mints a fresh generator on the given slot. Each finisher gets
 * its own generator, and its slot comes from engine.BoardFinisherSlot:
 * Caravans, Fishermen and Raiders share position 3, Rivers uses
 * RIVERS_BOARD_SEQ.
 *
 * Caravans and Fishermen only reshape tiles the engine dealt (`dealt`, see
 * dealtTerrain); without `dealt`, `supplied` decides. Rivers, Wagons and
 * Raiders have no guard, as in Go.
 */
export function finishBoardFor(ruleset, b, rngAt, supplied = false, dealt = null, mode = BoardFair, players = 0) {
  const may = dealt || (() => !supplied);
  for (const part of String(ruleset || "base").split("+")) {
    switch (part) {
      case "caravans":
        // Restricted to engine-dealt tiles; see dealtTerrain.
        caravansFinishBoard(b, rngAt(BOARD_FINISH_SEQ), may, reservedHexesFor(ruleset, b), players, mode === BoardFair);
        break;
      case "fishermen":
        // Gated by `dealt`, as in Go (derivation 12).
        fishermenFinishBoard(b, rngAt(BOARD_FINISH_SEQ), may, reservedHexesFor(ruleset, b));
        break;
      case "wagons":
        // Draws nothing and runs on every board: see wagonsFinishBoard.
        wagonsFinishBoard(b);
        break;
      case "rivers":
        // Own reserved slot, no authored-board guard.
        riversFinishBoard(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b), mode === BoardFair, may);
        break;
      case "raiders":
        // Runs on authored boards too: it only reclaims sea left by an Islands
        // carve and removes the robber. Raiders has no BoardFinisherSlot, so it
        // uses the shared position-3 slot.
        raidersFinishBoard(b, rngAt(BOARD_FINISH_SEQ));
        break;
      default:
        break; // nothing else finishes the board
    }
  }
}

// ---------------------------------------------------------------------------
// The board's second layer: rules-bearing module state derived from the
// finished board and carried in EvBoardGenerated's `ext` blob (fishing grounds,
// oases and spokes, rivers and bridge sites, and so on). Some parts are pure
// functions of the board; others draw from reserved public slots, hence the
// rng passed to boardExtFor. engine.Apply runs off the logged blob, so
// verifyBoardExt re-derives it here.

/** groundNumbers mirrors engine/scenarios.groundNumbers: the six grounds' tokens at 2-4 seats. */
const groundNumbers = [4, 5, 6, 8, 9, 10];

/** LAKE_NUMBERS and SECOND_LAKE_NUMBERS mirror engine/scenarios' two lake sets. */
const LAKE_NUMBERS = [2, 3, 11, 12];
const SECOND_LAKE_NUMBERS = [4, 10];

/**
 * fishTableFor mirrors engine/scenarios.fishTableFor (derivation 13): the grounds'
 * numbers and the lakes' number sets per table size. 2-4 seats: the base set;
 * 5-6: 8 grounds (5 and 9 added) and a second lake on 4 and 10; 7-10: 10
 * grounds and a third lake on 4 and 10.
 */
export function fishTableFor(players) {
  if (players <= 4) return { grounds: groundNumbers, lakes: [LAKE_NUMBERS] };
  if (players <= 6) {
    return { grounds: [4, 5, 5, 6, 8, 9, 9, 10], lakes: [LAKE_NUMBERS, SECOND_LAKE_NUMBERS] };
  }
  return {
    grounds: [4, 5, 5, 5, 6, 8, 9, 9, 9, 10],
    lakes: [LAKE_NUMBERS, SECOND_LAKE_NUMBERS, SECOND_LAKE_NUMBERS],
  };
}

/**
 * bootSupplyFor is engine/scenarios.fishTableFor's supply total plus the boot: 29
 * tokens (11/10/8) at 2-4 seats, 43 (15/15/13) at 5-6, 57 (19/20/18) at 7-10.
 */
export function bootSupplyFor(players) {
  const supply = players <= 4 ? [11, 10, 8] : players <= 6 ? [15, 15, 13] : [19, 20, 18];
  return supply[0] + supply[1] + supply[2] + 1;
}

/**
 * FISH_LAKES_SEQ is engine.FishLakesSeq: the one public slot the lakes' number
 * deal reads (derivation 13).
 */
export const FISH_LAKES_SEQ = -10_000_001;

/**
 * dealLakeNumbers mirrors engine/scenarios.dealLakeNumbers: the lakes in board order,
 * one Shuffle of their indices, then the first of the shuffled order takes the
 * first set and every other lake the last. Returned in board order.
 */
function dealLakeNumbers(b, players, rng) {
  const lakes = [];
  for (const h of hexesInRadius(b.radius)) {
    const t = b.tiles.get(hexKey(h));
    if (t !== undefined && t.res === Lake) lakes.push({ hex: { q: h.q, r: h.r }, numbers: null });
  }
  const sets = fishTableFor(players).lakes;
  const order = lakes.map((_, i) => i);
  rng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
  order.forEach((i, k) => { lakes[i].numbers = sets[Math.min(k, sets.length - 1)].slice(); });
  // Go's nil slice marshals as null, and the audit compares JSON text.
  return lakes.length === 0 ? null : lakes;
}

/**
 * FISH_GROUNDS_SEQ is engine.FishGroundsSeq: the one public slot the fishing
 * grounds' number deal reads (derivation 12).
 */
export const FISH_GROUNDS_SEQ = -10_000_000;

/**
 * dealGroundNumbers mirrors engine/scenarios.dealGroundNumbers: one Shuffle of the
 * numbers deriveGrounds placed, over the grounds in deriveGrounds' own order,
 * then re-sorted by number. Placement is untouched.
 */
function dealGroundNumbers(grounds, rng) {
  const nums = grounds.map((g) => g.number);
  rng.shuffle(nums.length, (i, j) => { const t = nums[i]; nums[i] = nums[j]; nums[j] = t; });
  const out = grounds.map((g, i) => ({ ...g, number: nums[i] }));
  out.sort((a, c) => a.number - c.number);
  return out;
}

/** groundCorners mirrors engine/scenarios.groundCorners. */
const groundCorners = 3;

/** harborSeaHex mirrors Board.HarborSeaHex: the water hex a harbor's dock sits on. */
function harborSeaHex(b, hb) {
  return edgeSeaHex(b, newEdge(hb.verts[0], hb.verts[1]));
}

/**
 * shoreRun mirrors engine/scenarios.shoreRun: the corners a fishing ground on sea hex
 * h would touch, i.e. the longest run of consecutive land corners around h,
 * trimmed to its first three and returned in ascending ring order (not from
 * the run's head). Returns null for fewer than two contiguous corners.
 */
function shoreRun(b, h) {
  const ring = hexVertices(h);
  const land = ring.map((v) => landVertex(b, v));
  const n = land.reduce((a, x) => a + (x ? 1 : 0), 0);
  if (n < 2) return null;
  // Fully enclosed: every index starts a maximal run, so pick index 0.
  if (n === 6) return [ring[0], ring[1], ring[2]];

  let bestStart = 0, bestLen = 0;
  for (let s = 0; s < 6; s++) {
    if (!land[s] || land[(s + 5) % 6]) continue; // not land, or not a run's head
    let l = 0;
    while (l < 6 && land[(s + l) % 6]) l++;
    if (l > bestLen) { bestStart = s; bestLen = l; }
  }
  if (bestLen < 2) return null;
  bestLen = Math.min(bestLen, groundCorners);
  const keep = [false, false, false, false, false, false];
  for (let i = 0; i < bestLen; i++) keep[(bestStart + i) % 6] = true;
  return ring.filter((_, i) => keep[i]);
}

/**
 * deriveGrounds mirrors engine/scenarios.deriveGrounds: fishing grounds on coastal
 * notches, no two sharing a vertex, never on a harbor's dock hex.
 *
 * Candidates are sorted by anchor (Q, R), then stably by notch width (Go's
 * sort.SliceStable; Array.sort is stable). Candidates come from land's
 * neighbours, so they include off-map ocean hexes, as in the engine.
 */
export function deriveGrounds(b, numbers = groundNumbers) {
  const docked = new Set();
  for (const hb of b.harbors || []) {
    const sea = harborSeaHex(b, hb);
    if (sea !== null) docked.add(hexKey(sea));
  }
  const seen = new Set();
  const cands = [];
  for (const h of hexesInRadius(b.radius)) {
    if (!isLand(b, h)) continue;
    for (const nb of neighbors(h)) {
      const key = hexKey(nb);
      if (isLand(b, nb) || seen.has(key)) continue;
      seen.add(key);
      if (docked.has(key)) continue;
      const lv = shoreRun(b, nb);
      if (lv !== null && lv.length >= 2) cands.push({ anchor: nb, verts: lv });
    }
  }
  cands.sort((a, c) => (a.anchor.q !== c.anchor.q ? a.anchor.q - c.anchor.q : a.anchor.r - c.anchor.r));
  const order = cands.slice().sort((a, c) => c.verts.length - a.verts.length);

  // take mirrors deriveGrounds' take: keep each candidate that shares no corner
  // with one already kept, and with `trim` keep an overlapping three-corner
  // notch as its first two corners, else its last two, when that pair is free
  // and adjacent on the hex's ring.
  const take = (ord, trim) => {
    const out = [];
    const used = new Set();
    const free = (vs) => !vs.some((v) => used.has(vertKey(v)));
    for (const c of ord) {
      if (out.length === numbers.length) break;
      let verts = c.verts;
      if (!free(verts)) {
        if (!trim || verts.length !== groundCorners) continue;
        if (free(verts.slice(0, 2)) && ringAdjacent(c.anchor, verts[0], verts[1])) verts = verts.slice(0, 2);
        else if (free(verts.slice(1)) && ringAdjacent(c.anchor, verts[1], verts[2])) verts = verts.slice(1);
        else continue;
      }
      for (const v of verts) used.add(vertKey(v));
      out.push({ v: verts, hex: c.anchor, number: numbers[out.length] });
    }
    return out;
  };
  let out = take(order, false);
  // Short of the table's count: the thin notches first, with trimming, used
  // only when it places more (derivation 13; see engine/scenarios.deriveGrounds).
  if (out.length < numbers.length) {
    const thin = cands.slice().sort((a, c) => a.verts.length - c.verts.length);
    const alt = take(thin, true);
    if (alt.length > out.length) out = alt;
  }
  out.sort((a, c) => a.number - c.number);
  return out;
}

/** ringAdjacent mirrors engine/scenarios.ringAdjacent. */
function ringAdjacent(h, a, c) {
  const ring = hexVertices(h);
  const ka = vertKey(a), kc = vertKey(c);
  for (let i = 0; i < 6; i++) {
    const x = vertKey(ring[i]), y = vertKey(ring[(i + 1) % 6]);
    if ((x === ka && y === kc) || (x === kc && y === ka)) return true;
  }
  return false;
}

/**
 * oasisSpokes mirrors engine/scenarios.oasisSpokes: one spoke per corner 0, 2 and 4,
 * each that corner's first outward (non-perimeter) land edge. A corner without
 * one gets Go's zero value, vertices at (0, 0, N).
 */
function oasisSpokes(b, oasis) {
  const zeroVert = () => vert(0, 0, N);
  const arrows = [], corners = [];
  const perim = new Set(hexEdges(oasis).map(edgeKey));
  const verts = hexVertices(oasis);
  for (const ci of [0, 2, 4]) {
    const v = verts[ci];
    let arrow = null;
    for (const ve of vertexEdgesOf(v)) {
      if (!perim.has(edgeKey(ve)) && landEdge(b, ve)) { arrow = ve; break; }
    }
    arrows.push(arrow === null ? { a: zeroVert(), b: zeroVert() } : arrow);
    corners.push(arrow === null ? zeroVert() : v);
  }
  return { arrows, corners };
}

/**
 * caravansOasis mirrors engine/scenarios.freshCaravans' board-derived half: the oases
 * and their spokes. Oases come from pickOases (deserts, then lakes); an
 * authored map with neither falls back to the first producing hex.
 */
function caravansOasis(b, players = 0) {
  let oases = pickOases(b, oasisCountFor(players));
  if (oases.length === 0) {
    for (const h of hexesInRadius(b.radius)) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && producing(t.res)) { oases = [h]; break; }
    }
  }
  if (oases.length === 0) {
    return { Oasis: { q: 0, r: 0 }, HasOasis: false, Oases: null };
  }
  const arrows = [], corners = [];
  for (const o of oases) {
    const sp = oasisSpokes(b, o);
    arrows.push(...sp.arrows);
    corners.push(...sp.corners);
  }
  return {
    Oasis: { q: oases[0].q, r: oases[0].r },
    HasOasis: true,
    Oases: oases.map((o) => ({ q: o.q, r: o.r })),
    Arrows: arrows,
    ArrowCorner: corners,
  };
}

/**
 * boardExtFor derives the audited part of EvBoardGenerated's ext layer: one
 * entry per module with board-derived state, holding only the fields the board
 * and seed decide. Opening bookkeeping in the blob (bid maps, supplies) depends
 * only on ruleset and player count and is not compared.
 */
export function boardExtFor(ruleset, b, publicSeed, rngFor, players = 0) {
  // Takes the seed and factory so each arm below names its reserved slot at
  // the call.
  const rngAt = (seq) => rngFor(publicSeed, seq);
  const parts = String(ruleset || "base").split("+");
  // The Raiders castle avoids river and reserved hexes (derivation 12,
  // raiders.castleAvoid), and Wagons reads that castle, so both need the
  // watercourse. A fresh generator on the same slot gives the same rivers.
  let castleAvoid = null;
  if (parts.includes("raiders")) {
    castleAvoid = new Set();
    if (parts.includes("rivers") && typeof rngFor === "function") {
      for (const r of deriveRivers(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b))) {
        for (const h of r.hexes) castleAvoid.add(hexKey(h));
      }
    }
    for (const k of reservedHexesFor(ruleset, b) || []) castleAvoid.add(k);
  }
  const out = {};
  for (const part of parts) {
    switch (part) {
      case "fishermen": {
        // Ground numbers are shuffled off FISH_GROUNDS_SEQ (derivation 12),
        // lake numbers dealt off FISH_LAKES_SEQ (derivation 13).
        const table = fishTableFor(players);
        out.fishermen = typeof rngFor === "function"
          ? {
            Grounds: dealGroundNumbers(deriveGrounds(b, table.grounds), rngAt(FISH_GROUNDS_SEQ)),
            Lakes: dealLakeNumbers(b, players, rngAt(FISH_LAKES_SEQ)),
          }
          : { Grounds: deriveGrounds(b, table.grounds) };
        break;
      }
      case "caravans":
        out.caravans = caravansOasis(b, players);
        break;
      case "rivers": {
        // A fresh generator on the paint pass's slot, as in
        // engine/rivers.InitExtBoard, so both passes agree. Only the "rivers"
        // key of the blob is compared; the rest is opening bookkeeping.
        if (typeof rngFor !== "function") {
          // Throw rather than derive "no rivers", which would falsely report
          // tampering; verifyBoardExt reports the error.
          throw new Error("rivers: boardExtFor needs rngFor to read the reserved stream slot");
        }
        const rs = deriveRivers(b, rngAt(RIVERS_BOARD_SEQ), reservedHexesFor(ruleset, b));
        // Meander variants, on their own slot (see RIVERS_VARIANT_SEQ).
        assignVariants(rs, rngAt(RIVERS_VARIANT_SEQ));
        // Go's nil slice marshals as null, and the comparison is on JSON text.
        out.rivers = { rivers: rs.length === 0 ? null : rs };
        break;
      }
      case "raiders":
        out.raiders = raidersBoardExt(b, parts.includes("cak"),
          parts.includes("wagons")
            ? wagonsBoardExt(b, publicSeed, rngFor, true, parts.includes("caravans"), parts.includes("fishermen"), castleAvoid, players)
            : null,
          castleAvoid);
        break;
      case "wagons":
        // Trade hexes and roles draw from WAGONS_BOARD_SEQ.
        out.wagons = wagonsBoardExt(b, publicSeed, rngFor, parts.includes("raiders"),
          parts.includes("caravans"), parts.includes("fishermen"), castleAvoid, players);
        break;
      case EXPLORERS:
        if (typeof rngFor === "function") out.explorers = explorersLayout(b, players, rngAt);
        break;
      default:
        break; // base, Knights, Islands: no board-derived module state
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raiders.
//
// The ext layer records the castle, the raiders' landmass, the coastal hexes
// they may land on, and where they start. The castle is not a tile: like the
// Caravans oasis it is recorded in the ext blob and the tile is untouched. The
// only board changes are growing a landmass Islands carved too small and
// removing the robber.

/** RAIDERS_MIN_COAST mirrors raiders.minCoastHexes. */
const RAIDERS_MIN_COAST = 8;

/** RAIDERS_REPAIR_NUMBERS mirrors raiders.repairNumbers: never a 6 or an 8. */
const RAIDERS_REPAIR_NUMBERS = [3, 4, 5, 9, 10, 11];

// sortHexes mirrors raiders.sortHexes, using the hexLess declared above.
function sortHexes(hs) {
  return hs.slice().sort((a, c) => (hexLess(a, c) ? -1 : hexLess(c, a) ? 1 : 0));
}

/** hexDist mirrors raiders.hexDist. */
function raidersHexDist(a, c) {
  return (Math.abs(a.q - c.q) + Math.abs(a.r - c.r) + Math.abs(a.q + a.r - c.q - c.r)) / 2;
}

/**
 * raidersMainLandmass mirrors raiders.mainLandmass (via Board.Islands): the
 * largest connected land component, ties by lowest (Q, R), returned ascending.
 * The flood fill walks hexesInRadius in board order so component ids match.
 */
function raidersMainLandmass(b) {
  const comp = new Map();
  const byID = [];
  let next = 0;
  for (const h of hexesInRadius(b.radius)) {
    if (!isLand(b, h) || comp.has(hexKey(h))) continue;
    const id = next++;
    byID.push([]);
    const stack = [h];
    comp.set(hexKey(h), id);
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const n of neighbors(cur)) {
        if (isLand(b, n) && !comp.has(hexKey(n))) {
          comp.set(hexKey(n), id);
          stack.push(n);
        }
      }
    }
  }
  // Group in board order, so each component's first member is its lowest (Q, R).
  for (const h of hexesInRadius(b.radius)) {
    const id = comp.get(hexKey(h));
    if (id !== undefined) byID[id].push(h);
  }
  let best = 0, bestID = -1;
  for (let id = 0; id < byID.length; id++) {
    const hs = byID[id];
    if (hs.length > best) { best = hs.length; bestID = id; }
    else if (hs.length === best && bestID >= 0 && hexLess(hs[0], byID[bestID][0])) bestID = id;
  }
  return bestID < 0 ? [] : sortHexes(byID[bestID]);
}

/** raidersIsCoastal mirrors raiders.isCoastal: a neighbouring position off the landmass. */
function raidersIsCoastal(land, h) {
  return neighbors(h).some((n) => !land.has(hexKey(n)));
}

/**
 * raidersNumberedCoast mirrors raiders.numberedCoast: the landing-eligible
 * hexes, ascending (Q, R): numbered, coastal, on the main landmass, and not
 * the castle.
 */
function raidersNumberedCoast(b, land, landSet, castle) {
  const out = [];
  for (const h of land) {
    if (castle !== null && h.q === castle.q && h.r === castle.r) continue;
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || !producing(t.res) || t.number === 0) continue;
    if (raidersIsCoastal(landSet, h)) out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Explorers (engine/explorers/board.go)
// ---------------------------------------------------------------------------
//
// The whole Explorers map derives from the public seed: a sea rim, a home
// island taken in a fixed order off the west, a ring of home waters, and a
// face-down pool split into two regions, each with nine special hexes, a shoal
// numbering and a number-chit stack.
//
// It reads six reserved slots (engine/seeds.go: ExplorersBoardSeqs) instead of
// the shared position-2 one, so its hooks take `rngAt(seq)`.

const EXPLORERS = "explorers";

/** The reserved public stream slots, from engine.ExplorersBoardSeqs. */
const EXPLORERS_SEQ = {
  region: -8000000,
  special: -8000001,
  shoal: -8000002,
  chitNorth: -8000003,
  chitSouth: -8000004,
  terrain: -8000005,
};

const EXP_REGION_NORTH = 0;
const EXP_REGION_SOUTH = 1;
const EXP_REGIONS = 2;
const EXP_SPECIAL_NONE = 0;
const EXP_SPECIAL_GOLD = 1;
const EXP_SPECIAL_SHOAL = 2;
const EXP_SPECIAL_SPICE = 3;
const EXP_VILLAGE_SWIFT = 0;
const EXP_VILLAGE_PIRATE = 1;
const EXP_VILLAGE_GOLD = 2;
const EXP_PER_REGION = 3; // gold fields, shoals and farms, three of each
const EXP_PLACEMENT_ATTEMPTS = 32;

/** doubled coordinates: X = 2q + r (a vertical column), Y = r. */
function expDoubled(h) {
  return [2 * h.q + h.r, h.r];
}

function expDist(h) {
  const x = h.q;
  const z = h.r;
  const y = -x - z;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
}

function expHexLess(a, b) {
  if (a.q !== b.q) return a.q - b.q;
  return a.r - b.r;
}

/** boardRadiusFor is the module BoardRadiuser hook: Explorers needs three more. */
export function boardRadiusFor(ruleset, players, base) {
  for (const part of String(ruleset || "base").split("+")) {
    if (part === EXPLORERS) return base + 3;
  }
  return base;
}

/** expHexDirs mirrors board's own direction order, which Neighbors walks. */
const EXP_HEX_DIRS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

/**
 * EXP_CORNER_BETWEEN[i] is the index into hexVertices() of the corner between
 * the neighbours in directions i and i+1, copied from engine/explorers/board.go.
 */
const EXP_CORNER_BETWEEN = [1, 0, 5, 4, 3, 2];

/** expPartition is the pure-geometry half: rim, island, waters, pool, council. */
function expPartition(radius, players) {
  const interior = hexesInRadius(radius - 1);
  const ordered = interior.slice().sort((a, b) => {
    const [ax, ay] = expDoubled(a);
    const [bx, by] = expDoubled(b);
    if (ax !== bx) return ax - bx;
    if (Math.abs(ay) !== Math.abs(by)) return Math.abs(ay) - Math.abs(by);
    return ay - by;
  });
  const size = Math.min(Math.floor((7 * players + 1) / 2), ordered.length);
  const home = ordered.slice(0, size);
  const inHome = new Set(home.map(hexKey));

  const inWater = new Set();
  const waters = [];
  for (const h of home) {
    for (const nb of neighbors(h)) {
      const k = hexKey(nb);
      if (inHome.has(k) || inWater.has(k) || expDist(nb) >= radius) continue;
      inWater.add(k);
      waters.push(nb);
    }
  }
  waters.sort(expHexLess);

  const pool = interior.filter((h) => !inHome.has(hexKey(h)) && !inWater.has(hexKey(h)));
  pool.sort(expHexLess);

  const { council, anchors } = expCouncil(home, waters);
  return { home, waters, pool, council, anchors };
}

function expCouncil(home, waters) {
  if (waters.length === 0) return { council: { q: 0, r: 0 }, anchors: [] };
  let best = waters[0];
  for (const h of waters.slice(1)) {
    const [hx, hy] = expDoubled(h);
    const [bx, by] = expDoubled(best);
    if (hx !== bx) {
      if (hx > bx) best = h;
      continue;
    }
    if (Math.abs(hy) !== Math.abs(by)) {
      if (Math.abs(hy) < Math.abs(by)) best = h;
      continue;
    }
    if (hy < by) best = h;
  }
  const d = expDirectionToward(best, home);
  const verts = hexVertices(best);
  return {
    council: best,
    anchors: [
      verts[EXP_CORNER_BETWEEN[(d + 1) % 6]],
      verts[EXP_CORNER_BETWEEN[(d + 4) % 6]],
    ],
  };
}

/**
 * expDirectionToward is the hex direction from `from` toward the centroid of
 * `at`, by largest cube dot product, ties to the lowest index. The centroid is
 * scaled by the count to stay in integers.
 */
function expDirectionToward(from, at) {
  if (at.length === 0) return 0;
  let sq = 0;
  let sr = 0;
  for (const h of at) { sq += h.q; sr += h.r; }
  const n = at.length;
  const dx = sq - from.q * n;
  const dz = sr - from.r * n;
  const dy = -dx - dz;
  let bestIdx = 0;
  let bestDot = 0;
  EXP_HEX_DIRS.forEach((dir, i) => {
    const ex = dir.q;
    const ez = dir.r;
    const ey = -ex - ez;
    const dot = dx * ex + dy * ey + dz * ez;
    if (i === 0 || dot > bestDot) { bestIdx = i; bestDot = dot; }
  });
  return bestIdx;
}

/**
 * expSplitRegions divides the pool about the equator, dealing the equator row
 * in ascending X to whichever region holds fewer (ties to north).
 */
function expSplitRegions(pool) {
  const out = [[], []];
  const equator = [];
  for (const h of pool) {
    const [, y] = expDoubled(h);
    if (y < 0) out[EXP_REGION_NORTH].push(h);
    else if (y > 0) out[EXP_REGION_SOUTH].push(h);
    else equator.push(h);
  }
  equator.sort((a, b) => {
    const [ax] = expDoubled(a);
    const [bx] = expDoubled(b);
    if (ax !== bx) return ax - bx;
    return expHexLess(a, b);
  });
  for (const h of equator) {
    if (out[EXP_REGION_SOUTH].length < out[EXP_REGION_NORTH].length) out[EXP_REGION_SOUTH].push(h);
    else out[EXP_REGION_NORTH].push(h);
  }
  out[EXP_REGION_NORTH].sort(expHexLess);
  out[EXP_REGION_SOUTH].sort(expHexLess);
  return out;
}

function expAdjacentCount(h, chosen) {
  let n = 0;
  for (const nb of neighbors(h)) if (chosen.has(hexKey(nb))) n++;
  return n;
}

function expAdjacentPairs(hexes) {
  const set = new Set(hexes.map(hexKey));
  let n = 0;
  for (const h of hexes) n += expAdjacentCount(h, set);
  return n / 2;
}

/** expOnePlacement is one greedy pass: an independent set, then cheapest-first. */
function expOnePlacement(order, want) {
  const chosen = new Set();
  const out = [];
  for (const h of order) {
    if (out.length === want) break;
    if (expAdjacentCount(h, chosen) === 0) { chosen.add(hexKey(h)); out.push(h); }
  }
  while (out.length < want) {
    let best = null;
    let bestCost = 0;
    for (const h of order) {
      if (chosen.has(hexKey(h))) continue;
      const cost = expAdjacentCount(h, chosen);
      if (best === null || cost < bestCost) { best = h; bestCost = cost; }
    }
    if (best === null) break;
    chosen.add(hexKey(best));
    out.push(best);
  }
  return out;
}

/**
 * raidersCastleHex mirrors raiders.castleHex: find the centre-most hex of the
 * main landmass (minimising the maximum distance to its coast, ties by
 * ascending (Q, R)), then take the nearest ordinary interior hex to it, else
 * the nearest ordinary hex, else the centre.
 */
function raidersCastleHex(b, land, landSet, avoid = null) {
  if (land.length === 0) return null;
  const coastal = land.filter((h) => raidersIsCoastal(landSet, h));
  let centre = land[0], bestScore = -1;
  for (const h of land) {
    let worst = 0;
    for (const c of coastal) {
      const d = raidersHexDist(h, c);
      if (d > worst) worst = d;
    }
    if (bestScore < 0 || worst < bestScore) { centre = h; bestScore = worst; }
  }
  const pick = (want) => {
    let best = null, bestD = 0;
    for (const h of land) {
      if (!want(h)) continue;
      const d = raidersHexDist(h, centre);
      if (best === null || d < bestD) { best = h; bestD = d; }
    }
    return best;
  };
  const ordinary = (h) => {
    const t = b.tiles.get(hexKey(h));
    return t !== undefined && producing(t.res);
  };
  // Derivation 12: avoid river and reserved hexes (raiders.castleAvoid) when
  // possible.
  const free = (h) => avoid === null || !avoid.has(hexKey(h));
  return pick((h) => ordinary(h) && free(h) && !raidersIsCoastal(landSet, h)) ??
    pick((h) => ordinary(h) && free(h)) ?? pick(ordinary) ?? centre;
}

/**
 * raidersSeedSites mirrors raiders.seedSites: one raider on each of the
 * max(2, round(coast/5)) numbered coastal hexes with the lowest pips, ties by
 * ascending (Q, R) (stable sort over a sorted list). Returns ascending indexes
 * into coast.
 */
function raidersSeedSites(b, coast) {
  if (coast.length === 0) return [];
  let n = Math.max(2, Math.floor((coast.length + 2) / 5)); // round(coast/5), half up
  n = Math.min(n, coast.length);
  const idx = coast.map((_, i) => i);
  idx.sort((a, c) => pips(b.tiles.get(hexKey(coast[a])).number) - pips(b.tiles.get(hexKey(coast[c])).number));
  return idx.slice(0, n).sort((a, c) => a - c);
}

/**
 * raidersFinishBoard mirrors raiders.Module.FinishBoard: it grows the main
 * landmass if its numbered coast is too short (in practice only after an
 * Islands carve), then removes the robber, which Raiders never uses.
 *
 * Patch selection is deterministic: fewest new tiles, then centre (Q, R).
 * New tiles draw a resource and token in board order; harbours are redealt
 * after framing. The patch preserves channels separating other islands.
 */
export function raidersFinishBoard(b, rng) {
  const land = raidersMainLandmass(b);
  const landSet = new Set(land.map(hexKey));
  const castle = raidersCastleHex(b, land, landSet);
  const refuge = land.some((h) => {
    const t = b.tiles.get(hexKey(h));
    return (castle === null || hexKey(h) !== hexKey(castle)) && producing(t.res) && t.number > 0 && !raidersIsCoastal(landSet, h);
  });
  if (land.length > 0 && !(refuge && raidersNumberedCoast(b, land, landSet, castle).length >= RAIDERS_MIN_COAST)) {
    let patch = [], best = -1;
    for (const centre of hexesInRadius(b.radius + 3)) {
      const missing = [];
      let touches = false, allowed = true;
      for (const offset of hexesInRadius(2)) {
        const h = { q: centre.q + offset.q, r: centre.r + offset.r };
        if (landSet.has(hexKey(h))) { touches = true; continue; }
        const t = b.tiles.get(hexKey(h));
        if (t !== undefined && t.res !== Sea) { allowed = false; break; }
        if (neighbors(h).some((n) => isLand(b, n) && !landSet.has(hexKey(n)))) { allowed = false; break; }
        missing.push(h);
      }
      if (allowed && touches && (best < 0 || missing.length < best)) { patch = missing; best = missing.length; }
    }
    if (best >= 0) {
      for (const h of patch) {
        const res = Resources[rng.intN(Resources.length)];
        b.tiles.set(hexKey(h), { res, number: RAIDERS_REPAIR_NUMBERS[rng.intN(RAIDERS_REPAIR_NUMBERS.length)] });
      }
      frameBoard(b);
      b.harbors = placeHarborsFor(rng, b, b.harbors.length);
    }
  }
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };
}

/**
 * raidersBoardExt mirrors raiders.deriveBoard: the board-derived ext fields.
 *
 * The supply is 3 x the numbered coastal hexes, minus the raiders seeded at
 * setup. Under Knights it is unbounded, so `knights` zeroes it.
 */
export function raidersBoardExt(b, knights, wagons = null, castleAvoid = null) {
  const land = raidersMainLandmass(b);
  const landSet = new Set(land.map(hexKey));
  const castle = raidersCastleHex(b, land, landSet, castleAvoid);
  const coast = raidersNumberedCoast(b, land, landSet, castle);
  const raider_count = coast.map(() => 0);
  let supply = knights ? 0 : 3 * coast.length;
  for (const i of (wagons?.HasTrade ? [] : raidersSeedSites(b, coast))) {
    raider_count[i]++;
    if (!knights) supply--;
  }
 const extra={};
 if(wagons?.HasTrade) {
  extra.shared_paths=true;
  extra.path_figures=wagons.Trade.filter((_,i)=>wagons.Roles[i]===0 || wagons.Roles[i]===2).map(hex=>({hex,edge:{a:{q:0,r:0,side:0},b:{q:0,r:0,side:0}},alive:true,on_path:false}));
  for(const r of extra.path_figures) { const i=coast.findIndex(h=>hexKey(h)===hexKey(r.hex)); if(i>=0) raider_count[i]++; if(!knights) supply--; }
 }
 return {
 ...extra,
    // Zero hex when absent; has_castle disambiguates.
    castle: castle === null ? { q: 0, r: 0 } : { q: castle.q, r: castle.r },
    has_castle: castle !== null,
    land: land.map((h) => ({ q: h.q, r: h.r })),
    coast: coast.map((h) => ({ q: h.q, r: h.r })),
    raider_count,
    supply,
  };
}

/**
 * expPlaceSpecials spreads the nine specials as far apart as the region allows:
 * the best of 32 seeded shuffles, ties to the earlier attempt. A four-player
 * region cannot fit nine non-adjacent hexes, so some adjacency is normal.
 */
function expPlaceSpecials(hexes, rng) {
  const want = EXP_PER_REGION * 3;
  let best = [];
  let bestCost = -1;
  for (let attempt = 0; attempt < EXP_PLACEMENT_ATTEMPTS; attempt++) {
    const order = hexes.slice();
    rng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
    const got = expOnePlacement(order, want);
    const cost = expAdjacentPairs(got);
    if (bestCost < 0 || cost < bestCost) { best = got; bestCost = cost; }
    if (bestCost === 0) break;
  }
  return best;
}

/**
 * expAssignKinds assigns kinds to both regions' specials so no two of a kind
 * touch, across the equator too. Exhaustive search, since greedy can dead-end.
 */
function expAssignKinds(specials) {
  const kinds = [EXP_SPECIAL_GOLD, EXP_SPECIAL_SHOAL, EXP_SPECIAL_SPICE];
  const left = [
    { [EXP_SPECIAL_GOLD]: EXP_PER_REGION, [EXP_SPECIAL_SHOAL]: EXP_PER_REGION, [EXP_SPECIAL_SPICE]: EXP_PER_REGION },
    { [EXP_SPECIAL_GOLD]: EXP_PER_REGION, [EXP_SPECIAL_SHOAL]: EXP_PER_REGION, [EXP_SPECIAL_SPICE]: EXP_PER_REGION },
  ];
  const slots = [];
  for (let region = 0; region < EXP_REGIONS; region++) {
    for (const h of specials[region]) slots.push({ region, h });
  }
  const index = new Map();
  slots.forEach((sl, i) => index.set(hexKey(sl.h), i));
  const before = slots.map((sl, i) => {
    const out = [];
    for (const nb of neighbors(sl.h)) {
      const j = index.get(hexKey(nb));
      if (j !== undefined && j < i) out.push(j);
    }
    return out;
  });
  const painted = new Array(slots.length).fill(EXP_SPECIAL_NONE);
  const walk = (i) => {
    if (i === slots.length) return true;
    const region = slots[i].region;
    for (const k of kinds) {
      if (left[region][k] === 0) continue;
      if (before[i].some((j) => painted[j] === k)) continue;
      left[region][k]--;
      painted[i] = k;
      if (walk(i + 1)) return true;
      left[region][k]++;
    }
    return false;
  };
  const out = [[], []];
  if (!walk(0)) {
    for (let region = 0; region < EXP_REGIONS; region++) {
      for (const k of kinds) {
        for (let i = 0; i < left[region][k]; i++) out[region].push(k);
      }
      while (out[region].length < specials[region].length) out[region].push(EXP_SPECIAL_GOLD);
      out[region] = out[region].slice(0, specials[region].length);
    }
    return out;
  }
  slots.forEach((sl, i) => out[sl.region].push(painted[i]));
  return out;
}

function expShoalFaces(region) {
  return region === EXP_REGION_NORTH ? [1, 2, 3] : [4, 5, 6];
}

/** expProducingBag deals n producing tiles at the base weights, with no desert. */
function expProducingBag(n) {
  const order = [Wood, Sheep, Wheat, Brick, Ore];
  const weights = [4, 4, 4, 3, 3];
  const counts = order.map((_, i) => Math.floor((n * weights[i]) / 18));
  let assigned = counts.reduce((a, c) => a + c, 0);
  for (let i = 0; assigned < n; i++) { counts[i % order.length]++; assigned++; }
  const bag = [];
  order.forEach((r, i) => { for (let k = 0; k < counts[i]; k++) bag.push(r); });
  return bag;
}

/** The base distribution with 2 and 12 removed, in the generator's deal order. */
const EXP_CHIT_VALUES = [3, 11, 4, 10, 5, 9, 6, 8];

function expChitStack(n, rng) {
  if (n <= 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(EXP_CHIT_VALUES[i % EXP_CHIT_VALUES.length]);
  rng.shuffle(out.length, (i, j) => { const t = out[i]; out[i] = out[j]; out[j] = t; });
  return out;
}

/**
 * expDerivePool is the seeded half: region membership, the nine specials, the
 * shoal numbering, the terrain and the two chit stacks. Pure in (pool, rngAt).
 */
function expDerivePool(pool, rngAt) {
  const regions = expSplitRegions(pool);
  const specialRng = rngAt(EXPLORERS_SEQ.special);
  const shoalRng = rngAt(EXPLORERS_SEQ.shoal);
  const terrainRng = rngAt(EXPLORERS_SEQ.terrain);
  const chitRng = [rngAt(EXPLORERS_SEQ.chitNorth), rngAt(EXPLORERS_SEQ.chitSouth)];

  const specials = [];
  for (let region = 0; region < EXP_REGIONS; region++) {
    specials.push(expPlaceSpecials(regions[region], specialRng));
  }
  const kindsOf = expAssignKinds(specials);

  const hexes = [];
  const chits = [];
  const res = new Map();
  const sea = new Set();
  for (let region = 0; region < EXP_REGIONS; region++) {
    const kind = new Map();
    const shoals = [];
    const farms = [];
    specials[region].forEach((h, i) => {
      kind.set(hexKey(h), kindsOf[region][i]);
      if (kindsOf[region][i] === EXP_SPECIAL_SHOAL) shoals.push(h);
      if (kindsOf[region][i] === EXP_SPECIAL_SPICE) farms.push(h);
    });
    const faces = expShoalFaces(region);
    shoalRng.shuffle(faces.length, (i, j) => { const t = faces[i]; faces[i] = faces[j]; faces[j] = t; });
    const shoalOf = new Map();
    shoals.forEach((h, i) => { if (i < faces.length) shoalOf.set(hexKey(h), faces[i]); });
    const villages = [EXP_VILLAGE_SWIFT, EXP_VILLAGE_PIRATE, EXP_VILLAGE_GOLD];
    const villageOf = new Map();
    farms.forEach((h, i) => { if (i < villages.length) villageOf.set(hexKey(h), villages[i]); });

    const rest = regions[region].filter((h) => (kind.get(hexKey(h)) ?? EXP_SPECIAL_NONE) === EXP_SPECIAL_NONE);
    const order = rest.slice();
    terrainRng.shuffle(order.length, (i, j) => { const t = order[i]; order[i] = order[j]; order[j] = t; });
    const seaWanted = Math.min(
      Math.max(1, Math.floor((regions[region].length + 8) / 16)),
      order.length,
    );
    for (const h of order.slice(0, seaWanted)) sea.add(hexKey(h));
    const land = order.slice(seaWanted);
    const bag = expProducingBag(land.length);
    terrainRng.shuffle(bag.length, (i, j) => { const t = bag[i]; bag[i] = bag[j]; bag[j] = t; });
    land.forEach((h, i) => res.set(hexKey(h), bag[i]));

    for (const h of regions[region]) {
      const k = kind.get(hexKey(h)) ?? EXP_SPECIAL_NONE;
      const p = { h: { q: h.q, r: h.r }, region };
      if (k !== EXP_SPECIAL_NONE) p.kind = k;
      if (k === EXP_SPECIAL_SHOAL) p.shoal = shoalOf.get(hexKey(h));
      if (k === EXP_SPECIAL_SPICE) {
        const v = villageOf.get(hexKey(h));
        if (v) p.village = v; // VillageSwift is 0 and omitempty drops it
      }
      hexes.push(p);
    }
    chits.push(expChitStack(land.length + EXP_PER_REGION, chitRng[region]));
  }
  hexes.sort((a, b) => expHexLess(a.h, b.h));
  return { hexes, chits, res, sea };
}

/**
 * explorersSetupBoard reshapes the generated full hexagon into the Explorers
 * map. It mirrors engine/explorers.Module.SetupBoardSeeded exactly, including
 * the order the six streams are read in.
 */
export function explorersSetupBoard(b, players, rngAt, withKnights = false) {
  const l = expPartition(b.radius, players);
  const plan = expDerivePool(l.pool, rngAt);

  // No ports and no robber: bank trade is a flat 3:1 for everyone, and a 7 moves
  // a pirate ship on the water.
  b.harbors = [];
  b.robber = { q: OFF_BOARD, r: OFF_BOARD };

  for (const h of hexesInRadius(b.radius)) {
    if (expDist(h) === b.radius) b.tiles.set(hexKey(h), { res: Sea, number: 0 });
  }
  for (const h of l.waters) b.tiles.set(hexKey(h), { res: Sea, number: 0 });

  // The island keeps its dealt tiles, except a desert, which is re-dealt as
  // producing terrain with a non-red chit so no 6/8 adjacency is created.
  const fill = rngAt(EXPLORERS_SEQ.terrain);
  const safe = [3, 4, 5, 9, 10, 11];
  for (const h of l.home) {
    const t = b.tiles.get(hexKey(h));
    if (t === undefined || producing(t.res)) continue;
    const res = Resources[fill.intN(Resources.length)];
    b.tiles.set(hexKey(h), { res, number: safe[fill.intN(safe.length)] });
  }

  // cak+explorers rule B: the island's first forest in (X, |Y|, Y) order
  // becomes fields, keeping its chit. No draw.
  if (withKnights) {
    for (const h of l.home) {
      const t = b.tiles.get(hexKey(h));
      if (t !== undefined && t.res === Wood) {
        b.tiles.set(hexKey(h), { res: Wheat, number: t.number });
        break;
      }
    }
  }

  for (const p of plan.hexes) {
    const k = hexKey(p.h);
    const kind = p.kind ?? EXP_SPECIAL_NONE;
    if (kind === EXP_SPECIAL_GOLD) b.tiles.set(k, { res: Gold, number: 0 });
    else if (kind === EXP_SPECIAL_SHOAL) b.tiles.set(k, { res: Sea, number: 0 });
    else if (kind === EXP_SPECIAL_SPICE) b.tiles.set(k, { res: ResNone, number: 0 });
    else if (plan.sea.has(k)) b.tiles.set(k, { res: Sea, number: 0 });
    else b.tiles.set(k, { res: plan.res.get(k), number: 0 });
  }
}

/**
 * explorersLayout is the board-derived state board_generated carries: the
 * partition, the dealt pool, the two chit stacks and the Council with its
 * anchors. The pool is redacted from live clients
 * (engine/explorers/views.go); the audit uses the post-game log.
 */
export function explorersLayout(b, players, rngAt) {
  const l = expPartition(b.radius, players);
  const plan = expDerivePool(l.pool, rngAt);
  return {
    home: l.home.map((h) => ({ q: h.q, r: h.r })),
    waters: l.waters.map((h) => ({ q: h.q, r: h.r })),
    pool: plan.hexes,
    chits: plan.chits,
    council: { q: l.council.q, r: l.council.r },
    anchors: l.anchors.map((v) => ({ q: v.q, r: v.r, side: v.side })),
  };
}
