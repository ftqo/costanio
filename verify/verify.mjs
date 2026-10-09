// The fairness audit.
//
// Feed it the JSON from `GET /api/games/{id}/replay` of a finished game you
// played in, and it re-derives, from the revealed public seed, every outcome
// that seed was supposed to decide: the board, the fishing grounds, caravan
// spokes and river channels that hang off it, the seating, every dice roll,
// every Knights event die, the Fishermen old boot. Then it checks each one
// against what the log says actually happened, and checks the seed itself
// against the commitment that was published when the table opened.
//
// A clean result proves:
//
//   - The seed hashes to the commitment published before anyone joined the
//     table, so the server did not pick or change the seed after seeing who
//     was playing.
//   - Every visible outcome follows from that seed by a published rule.
//
// It does not prove the server did not draw and discard seeds before
// publishing the commitment. That needs player-supplied entropy (see
// docs/dice.md).
//
// Hidden outcomes (which card a steal took, which card a draw dealt, which fish
// tiles a seat drew) use a second, independent seed and are outside this
// audit; tying them to the public seed would reveal every hand mid-game. The
// split is by visibility: any outcome the table sees belongs on the public seed
// and needs a check here.

import { PCG, Rand, MASK64 } from "./rand.mjs";
import { seedCommitment } from "./sha256.mjs";
import { radiusFor } from "./coords.mjs";
import {
  generateRadius, boardToWire, BoardFair, resolveBoard, ensureHarbors,
  presetBoard, resourcesByName,
} from "./board.mjs";
import { frameBoard } from "./frame.mjs";
import { setupBoardFor, finishBoardFor, dealtTerrain, boardExtFor, boardRadiusFor, bootSupplyFor } from "./modules.mjs";

const GOLDEN = 0x9e3779b97f4a7c15n;

/**
 * rngFor is engine.rngFor: PCG seeded (seed, seq*golden+1). Frozen: every past
 * game is audited against it.
 */
function rngFor(seed, seq) {
  const s2 = (BigInt.asUintN(64, BigInt(seq)) * GOLDEN + 1n) & MASK64;
  return new Rand(new PCG(seed, s2));
}

// seatOrderSeq: the reserved stream slot for the lobby's turn-order shuffle.
// Must match engine/seeds.go.
const SEAT_ORDER_SEQ = -1000000;

// fishBootSeqBase: the base of the Fishermen old boot's descending run of public
// stream slots, one per roll. Must match engine.FishBootSeq.
const FISH_BOOT_SEQ_BASE = -3000000;

// Board slots (BOARD_FINISH_SEQ, RIVERS_BOARD_SEQ) live in modules.mjs beside
// the hooks that use them. engine/seeds.go (seatOrderSeq) lists every slot.

/**
 * exactSeeds recovers the seeds from the replay's raw text. Seeds are uint64
 * and JSON.parse rounds them to doubles, which breaks the commitment check on
 * large seeds.
 *
 * It uses the reviver's `context.source` where available (Node 24, current
 * Chrome/Safari), otherwise a regex over the text. `"seed"` and
 * `"public_seed"` appear only in game_created's payload, so the first match
 * of each is the right one.
 */
export function exactSeeds(text) {
  const found = { seed: null, public_seed: null };
  try {
    JSON.parse(text, function (k, v, ctx) {
      if ((k === "seed" || k === "public_seed") && found[k] === null &&
          ctx && typeof ctx.source === "string" && /^\d+$/.test(ctx.source)) {
        found[k] = BigInt(ctx.source);
      }
      return v;
    });
  } catch {
    // fall through to the text scan
  }
  for (const k of ["seed", "public_seed"]) {
    if (found[k] !== null) continue;
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*(\\d+)`));
    if (m) found[k] = BigInt(m[1]);
  }
  return found;
}

/**
 * DERIVATION_VERSION is the set of published derivations this verifier
 * implements (board generation, module board hooks, and the public stream
 * slots for dice, fair deck, seat shuffle and event die). It must equal
 * engine.DerivationVersion. Only one version is implemented; games built by
 * any other are reported unauditable (see derivationSupport).
 */
const DERIVATION_VERSION = 13;

/**
 * derivationSupport says whether this verifier can reproduce the derivations a
 * game was built with, and if not, why, in words a player can read. Without it
 * a game from an older generator would report a false board failure.
 */
function derivationSupport(created) {
  const got = created.derivation_version;
  if (got === undefined || got === null) {
    return {
      ok: false,
      why: "this game predates derivation versioning, so its log does not say which generator built it and this auditor cannot know whether it is the one implemented here",
    };
  }
  if (got !== DERIVATION_VERSION) {
    return {
      ok: false,
      why: `this game was built by derivation version ${got} and this auditor implements version ${DERIVATION_VERSION}, so it cannot reproduce what the seed decided here (this is not a claim that anything is wrong with the game)`,
    };
  }
  return { ok: true, why: "" };
}

/** BOARD_CHECK is shared because verify() checks whether this check ran. */
const BOARD_CHECK = "board built from the seed";

/**
 * BOARD_EXT_CHECK names the board's second layer: the rules-bearing state each
 * module derives from the finished board and the log carries beside it. The
 * detail line says what was compared per module.
 */
const BOARD_EXT_CHECK = "scenario state derived from the board";

const ok = (name, detail) => ({ name, status: "ok", detail });
const bad = (name, detail) => ({ name, status: "FAILED", detail });
const skip = (name, detail) => ({ name, status: "skipped", detail });

/**
 * verify audits a replay. Returns
 *   {game, verdict, checks: [{name, status, detail}], rolls: [...]}
 * where verdict is "verified" (every applicable check passed), "failed" (at
 * least one check failed) or "unauditable" (nothing could be checked, e.g. a
 * spectator's redacted copy, or a game older than the commitment scheme).
 *
 * Skipped checks never fail a verdict, but they are always reported so they
 * cannot be mistaken for passes.
 */
export function verify(input) {
  // Accepts raw response text or a parsed object. Only text keeps large seeds
  // exact (see exactSeeds).
  const isText = typeof input === "string";
  const replay = isText ? JSON.parse(input) : input;
  const exact = isText ? exactSeeds(input) : { seed: null, public_seed: null };
  const checks = [];
  const events = replay.events || [];
  const audit = replay.audit || {};

  const createdEv = events.find((e) => e.type === "game_created");
  if (!createdEv) {
    return { game: replay.game, verdict: "unauditable", checks: [skip("game_created", "no game_created event in this log")], rolls: [] };
  }
  const created = createdEv.data || {};
  const cfg = created.config || {};
  // Derived outcomes are checkable only if this build implements the game's
  // derivation version; the commitments are checked regardless.
  const support = derivationSupport(created);

  // --- the seeds ----------------------------------------------------------
  if (!created.public_seed_commit) {
    checks.push(skip("public seed commitment",
      "this game predates the split seeds (migration 0030): it ran on one undivided seed with no pre-committed public seed, so its board and seating cannot be audited"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }
  if (created.public_seed === undefined || created.public_seed === null) {
    checks.push(skip("public seed",
      "the seed is absent from this copy of the log. Only a participant's replay reveals it; a spectator copy is redacted"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }

  if (exact.public_seed === null && !Number.isSafeInteger(created.public_seed)) {
    checks.push(skip("public seed",
      "this replay was handed over already parsed, and the seed is larger than a JavaScript number can hold exactly. Pass the raw response text instead"));
    return { game: replay.game, verdict: "unauditable", checks, rolls: [] };
  }
  const pub = exact.public_seed !== null ? exact.public_seed : BigInt(created.public_seed);
  const derivedCommit = seedCommitment(pub);
  if (derivedCommit === created.public_seed_commit) {
    checks.push(ok("public seed matches its commitment", `sha256(seed) = ${derivedCommit}`));
  } else {
    checks.push(bad("public seed matches its commitment",
      `sha256(seed) = ${derivedCommit}, but the log commits to ${created.public_seed_commit}`));
  }

  // The log's commitment must equal the one stored when the lobby opened;
  // otherwise a commitment written at game start proves nothing.
  if (audit.public_seed_commit) {
    if (audit.public_seed_commit === created.public_seed_commit) {
      checks.push(ok("commitment published at table creation", audit.public_seed_commit));
    } else {
      checks.push(bad("commitment published at table creation",
        `the table was opened committing to ${audit.public_seed_commit}, but the game log commits to ${created.public_seed_commit}`));
    }
  } else {
    checks.push(skip("commitment published at table creation", "the replay carries no audit block"));
  }

  const priv = exact.seed !== null ? exact.seed
    : Number.isSafeInteger(created.seed) ? BigInt(created.seed) : null;
  if (priv !== null && created.seed_commit) {
    const c = seedCommitment(priv);
    checks.push(c === created.seed_commit
      ? ok("private seed matches its commitment", `sha256(seed) = ${c}`)
      : bad("private seed matches its commitment", `sha256(seed) = ${c}, committed ${created.seed_commit}`));
  }

  // --- the board ----------------------------------------------------------
  const board = verifyBoard(pub, cfg, events, support);
  checks.push(board.check);
  // The board's second layer (fishing grounds, oasis, rivers, raiders coast,
  // trade hexes, Explorers' face-down hexes). Apply runs off the logged copy,
  // so it needs its own check; see verifyBoardExt.
  checks.push(verifyBoardExt(cfg, events, support, board.derived, pub));

  // --- the seating --------------------------------------------------------
  checks.push(verifySeating(pub, cfg, audit, support));

  // --- the dice -----------------------------------------------------------
  const { check: diceCheck, rolls } = verifyDice(pub, cfg, events, support);
  checks.push(diceCheck);
  checks.push(verifyEventDie(pub, events, support));
  checks.push(verifyFishBoot(pub, cfg, events, support));

  const failed = checks.some((c) => c.status === "FAILED");
  const anyOk = checks.some((c) => c.status === "ok");
  const boardChecked = checks.some((c) => c.name === BOARD_CHECK && c.status === "ok");
  // An unsupported version or a skipped board check makes the game
  // unauditable even when the commitments pass: the commitments only show the
  // seeds were fixed in advance, not what they produced.
  if (!failed && (!support.ok || !boardChecked)) {
    return { game: replay.game, verdict: "unauditable", checks, rolls };
  }
  return {
    game: replay.game,
    verdict: failed ? "failed" : anyOk ? "verified" : "unauditable",
    checks,
    rolls,
  };
}

/**
 * verifyBoard returns the check and the board it derived, which verifyBoardExt
 * builds on. `derived` is null when no board could be derived.
 */
function verifyBoard(pub, cfg, events, support) {
  const name = BOARD_CHECK;
  if (!support.ok) {
    return { check: skip(name, support.why), derived: null };
  }
  const boardEv = events.find((e) => e.type === "board_generated");
  if (!boardEv || !boardEv.data || !boardEv.data.board) {
    return { check: skip(name, "no board in this log (a fog-of-war ruleset hides it, and a spectator copy is redacted)"), derived: null };
  }
  const mode = cfg.board_mode || BoardFair;
  let derived;
  try {
    if (cfg.board) {
      // A lobby table (the common case). Its config carries a shape (generic
      // land, blank numbers); the seed decides resources, numbers, deserts
      // and harbors.
      derived = inlineBoard(cfg.board);
      if (derived === null) {
        return { check: skip(name, "this map carries a terrain this build does not know, so its board is not checked here"), derived: null };
      }
      // Frame before minting the rng, as engine.New does, so harbors follow
      // the computed coast. Frame draws nothing.
      frameBoard(derived);
      const rng = rngFor(pub, 1);
      resolveBoard(rng, derived, mode);
      ensureHarbors(rng, derived);
    } else if (cfg.preset) {
      // A curated table. Tiles and numbers are fixed, but PresetBoard deals
      // harbors off the same stream slot as a procedural board.
      derived = presetBoard(rngFor(pub, 1), cfg.preset);
      if (derived === null) {
        return { check: skip(name, `this table used the curated map "${cfg.preset}", which this build does not carry, so its board is not checked here`), derived: null };
      }
    } else {
      derived = generateRadius(rngFor(pub, 1), cfg.players,
        boardRadiusFor(cfg.ruleset, cfg.players, radiusFor(cfg.players)), mode);
    }
    // Each module gets a fresh stream at position 2, then FinishBoard hooks
    // get one at position 3; see modules.mjs.
    // `supplied` means the board was authored (preset or inlined map). Modules
    // use it differently:
    //
    //   - islands SetupBoard skips when supplied.
    //   - fishermen FinishBoard skips when supplied; its SetupBoard (desert to
    //     lake) always runs.
    //   - caravans FinishBoard ignores it and uses dealtTerrain instead.
    const supplied = Boolean(cfg.board || cfg.preset);
    setupBoardFor(cfg.ruleset, derived, () => rngFor(pub, 2), supplied,
      cfg.players, (seq) => rngFor(pub, seq), mode);
    // Finishers get rngAt(seq) because each may use its own reserved slot
    // (BoardFinisherSlot): Caravans and Fishermen share slot 3, Rivers uses
    // RIVERS_BOARD_SEQ. finishBoardFor mints a fresh generator per hook.
    finishBoardFor(cfg.ruleset, derived, (seq) => rngFor(pub, seq), supplied, dealtTerrain(cfg), cfg.board_mode || BoardFair, cfg.players);
  } catch (err) {
    return { check: bad(name, `could not re-derive the board: ${err.message}`), derived: null };
  }

  const got = JSON.stringify(boardToWire(derived));
  const want = JSON.stringify(normalizeBoard(boardEv.data.board));
  return {
    check: got === want
      ? ok(name, `${derived.tiles.size} tiles and ${derived.harbors.length} harbors re-derived exactly`)
      : bad(name, "the logged board is not the board this seed produces"),
    // Passed on even on a mismatch so the ext layer is still reported.
    derived,
  };
}

/**
 * verifyBoardExt audits the module state derived from the finished board and
 * logged in board_generated's `ext` blob (engine.BoardGeneratedData.Ext).
 *
 * engine.Apply unmarshals that blob over the value it derives, so a game
 * replays as played and the log, not the derivation, is what the game runs on.
 * The blob decides scoring (fishing grounds, the oasis and its spokes, river
 * hexes and bridge sites, and so on), so the audit re-derives it from the same
 * board and requires the log to agree. Rivers picks its watercourse from a
 * reserved public slot, hence the rng passed to boardExtFor.
 *
 * Reported for every ruleset, as a skip when there is nothing to check.
 */
function verifyBoardExt(cfg, events, support, derived, pub) {
  const name = BOARD_EXT_CHECK;
  const parts = String(cfg.ruleset || "base").split("+");
  const wanted = ["fishermen", "caravans", "rivers", "raiders", "wagons", "explorers"].filter((m) => parts.includes(m));
  if (wanted.length === 0) {
    return skip(name, "this ruleset derives nothing from the board beyond the board (Fishermen, Caravans, Rivers, Raiders, Wagons and Explorers do)");
  }
  if (!support.ok) return skip(name, support.why);
  if (derived === null) {
    return skip(name, "the board itself could not be re-derived here, so what hangs off it cannot be either");
  }
  const boardEv = events.find((e) => e.type === "board_generated");
  const logged = (boardEv && boardEv.data && boardEv.data.ext) || null;
  if (logged === null) {
    // Not a skip: every game of these rulesets records this blob.
    return bad(name, "this ruleset derives scenario state from the board and the log carries none, so the game was not built the way this auditor derives it");
  }

  let want;
  try {
    want = boardExtFor(cfg.ruleset, derived, pub, rngFor, cfg.players);
  } catch (err) {
    return bad(name, `could not re-derive the scenario state: ${err.message}`);
  }
  const mismatched = [];
  const summary = [];
  for (const mod of wanted) {
    const got = logged[mod];
    if (got === undefined || got === null) {
      mismatched.push(`${mod}: the log carries no scenario state for it`);
      continue;
    }
    // Compare only the fields the board decided (see boardExtFor), keyed from
    // the derived side so logged key order does not matter.
    for (const [key, value] of Object.entries(want[mod])) {
      if (JSON.stringify(value) !== JSON.stringify(got[key])) {
        mismatched.push(`${mod}.${key}`);
      }
    }
    if (mod === "fishermen") summary.push(`${want.fishermen.Grounds.length} fishing grounds`);
    if (mod === "caravans") summary.push(want.caravans.HasOasis ? "the oasis and its 3 caravan spokes" : "no oasis on this board");
    if (mod === "rivers") {
      const rs = want.rivers.rivers || [];
      const sites = rs.reduce((n, r) => n + r.sites.length, 0);
      summary.push(rs.length === 1
        ? `1 river of ${rs[0].hexes.length} hexes and its ${sites} bridge sites`
        : `${rs.length} rivers and their ${sites} bridge sites`);
    }
    if (mod === "raiders") {
      summary.push(want.raiders.has_castle
        ? `the castle and the ${want.raiders.coast.length} coastal hexes raiders land on`
        : "no castle on this board");
    }
    if (mod === "wagons") summary.push(want.wagons.HasTrade ? "the 3 trade hexes, their roles and their 3 barbarians" : "no trade hexes on this board");
    if (mod === "explorers") {
      summary.push(`the home island, ${want.explorers.pool.length} face-down hexes and both chit stacks`);
    }
  }
  return mismatched.length === 0
    ? ok(name, `${summary.join(" and ")} re-derived exactly`)
    : bad(name, `the log does not match what this board produces: ${mismatched.join(", ")}`);
}

/**
 * verifyFishBoot audits the Fishermen old boot: whether a catch turned it up.
 * The boot is public and decides games, so it draws from a reserved public
 * slot (engine.FishBootSeq), one per roll.
 *
 * Everything needed is in the public log: `total` is on the catch event;
 * `tiles_left` counts down from the table's supply (30 at 2-4 seats, 44 at
 * 5-6, 58 at 7-10) by each catch's total and resets when it would reach zero;
 * a catch is keyed on the roll's position, or the placement's for the setup
 * bonus; and drawing stops once the boot is out. The audit folds these forward
 * and checks each catch's first draw.
 *
 * It does not check which seat received the boot. That second draw is weighted
 * by each seat's draw count, which would need the base game's building state
 * ported here; the detail line says so.
 */
function verifyFishBoot(pub, cfg, events, support) {
  const name = "the old boot follows from the seed";
  if (!String(cfg.ruleset || "base").split("+").includes("fishermen")) {
    return skip(name, "no old boot in this game (it is a Fishermen ruleset feature)");
  }
  if (!support.ok) return skip(name, support.why);

  // engine/scenarios.bootSupplyFor: every token of the table's supply plus the boot
  // (30 at 2-4 seats, 44 at 5-6, 58 at 7-10; derivation 13).
  const BOOT_SUPPLY = bootSupplyFor(cfg.players || 0);
  let tilesLeft = BOOT_SUPPLY;
  let inPlay = false;
  // The log position the catch's streams are keyed on: a roll's dice_rolled,
  // or, for the setup bonus (derivation 13: a second settlement beside a ground
  // or a lake draws one token), the placement that earned it.
  let lastRollSeq = null;
  let checked = 0, mismatches = 0;
  for (const e of events) {
    if (e.type === "dice_rolled" || e.type === "settlement_placed" || e.type === "setup_city_placed") {
      lastRollSeq = e.seq;
      continue;
    }
    if (e.type !== "tab_fish_caught") continue;
    const d = e.data || {};
    if (d.total === undefined || d.boot_to === undefined) continue; // redacted copy
    const gotBoot = d.boot_to !== -1;
    if (!inPlay && lastRollSeq !== null) {
      // engine/scenarios.fishCatch: rng.IntN(max(TilesLeft, total)) < total.
      const left = Math.max(tilesLeft, d.total);
      const draw = rngFor(pub, FISH_BOOT_SEQ_BASE - lastRollSeq).intN(left);
      checked++;
      if ((draw < d.total) !== gotBoot) mismatches++;
    }
    tilesLeft -= d.total;
    if (tilesLeft < 1) tilesLeft = BOOT_SUPPLY;
    if (gotBoot) inPlay = true;
  }
  if (checked === 0) {
    return skip(name, "no fish were caught before the boot came into play, so the seed decided nothing here");
  }
  return mismatches === 0
    ? ok(name, `${checked} catches: whether the boot turned up re-derived exactly (which seat received it is weighted by that roll's draw counts and is not re-derived here)`)
    : bad(name, `on ${mismatches} of ${checked} catches the boot did not do what this seed says it should`);
}

/**
 * inlineBoard reads the shape out of a config, as engine.New does with
 * cfg.Board.Clone(). Returns null only when the config names a terrain this
 * build does not know. Land-only gallery maps are framed by the caller
 * (frame.mjs).
 */
function inlineBoard(raw) {
  const b = {
    radius: raw.radius,
    tiles: new Map(),
    robber: raw.robber ? { q: raw.robber.q, r: raw.robber.r } : { q: 0, r: 0 },
    harbors: (raw.harbors || []).map((h) => ({
      verts: h.verts.map((v) => ({ q: v.q, r: v.r, side: v.side })),
      ratio: h.ratio,
      res: resourcesByName[h.res],
    })),
  };
  for (const t of raw.tiles || []) {
    const res = resourcesByName[t.res];
    if (res === undefined) return null; // a terrain this build does not know
    b.tiles.set(`${t.hex.q},${t.hex.r}`, { res, number: t.num });
  }
  return b;
}

/**
 * normalizeBoard re-emits a logged board in the same key order boardToWire
 * uses, so the two can be compared as strings. It does not reorder tiles: the
 * server emits them in HexesInRadius order and a differing order is itself a
 * mismatch worth reporting.
 */
function normalizeBoard(b) {
  return {
    radius: b.radius,
    tiles: (b.tiles || []).map((t) => ({ hex: { q: t.hex.q, r: t.hex.r }, res: t.res, num: t.num })),
    robber: { q: b.robber.q, r: b.robber.r },
    harbors: (b.harbors || []).map((h) => ({
      verts: h.verts.map((v) => ({ q: v.q, r: v.r, side: v.side })),
      ratio: h.ratio,
      res: h.res,
    })),
  };
}

function verifySeating(pub, cfg, audit, support) {
  const name = "seating derived from the seed";
  if (!support.ok) {
    return skip(name, support.why);
  }
  if (cfg.turn_order === "lobby") {
    return skip(name, "this table kept lobby order, so no shuffle happened");
  }
  const pre = audit.pre_shuffle_seats;
  const final = audit.final_seats;
  if (!pre || !final) {
    return skip(name, "the replay carries no pre-shuffle roster, so the permutation has nothing to be checked against");
  }
  if (pre.length !== final.length) {
    return bad(name, `roster sizes disagree: ${pre.length} before the shuffle, ${final.length} after`);
  }
  const order = rngFor(pub, SEAT_ORDER_SEQ).perm(pre.length);
  const want = order.map((idx) => pre[idx]);
  return JSON.stringify(want) === JSON.stringify(final)
    ? ok(name, `seats ${order.join(", ")}: the permutation this seed produces`)
    : bad(name, `this seed seats the roster as [${want.join(", ")}], but the game was played as [${final.join(", ")}]`);
}

function verifyDice(pub, cfg, events, support) {
  const name = "every roll follows from the seed";
  if (!support.ok) {
    return { check: skip(name, support.why), rolls: [] };
  }
  const fairMode = cfg.dice_mode === "fair";
  const rolls = [];
  let rollCount = 0; // mirrors State.RollCount: incremented for every logged roll
  let mismatches = 0, checked = 0, declared = 0;

  // An Alchemist roll is not decided by the seed, so a `fixed` flag is only
  // accepted when a preceding public `cak_dice_fixed` event declared those two
  // numbers in a Knights ruleset. Each declaration covers one roll, as in the
  // engine (AlchemistD1 is cleared on use, engine/knights/apply.go).
  const knights = (cfg.ruleset || "").split("+").includes("cak");
  const declarations = [];
  for (const e of events) {
    if (e.type !== "cak_dice_fixed") continue;
    const d = e.data || {};
    if (d.d1 === undefined) continue;
    declarations.push({ seq: e.seq, d1: d.d1, d2: d.d2, used: false });
  }
  const claimDeclaration = (seq, logged) => {
    for (let i = declarations.length - 1; i >= 0; i--) {
      const c = declarations[i];
      if (c.used || c.seq >= seq) continue;
      if (c.d1 !== logged[0] || c.d2 !== logged[1]) return { ok: false, why: `an Alchemist declared ${c.d1}+${c.d2}` };
      c.used = true;
      return { ok: true };
    }
    return { ok: false, why: "no Alchemist declared it" };
  };
  let forged = 0;

  for (const e of events) {
    if (e.type !== "dice_rolled") continue;
    const d = e.data || {};
    if (d.d1 === undefined) continue; // redacted copy

    let expect = null;
    if (fairMode) {
      // The fair deck: all 36 ordered outcomes, shuffled once per 36-roll
      // epoch on its own reserved (negative) stream slot, dealt without
      // replacement.
      const epoch = Math.floor(rollCount / 36);
      const pos = rollCount % 36;
      const perm = rngFor(pub, -(epoch + 1)).perm(36);
      const outcome = perm[pos];
      expect = [Math.floor(outcome / 6) + 1, (outcome % 6) + 1];
    } else {
      const rng = rngFor(pub, e.seq);
      expect = [rng.intN(6) + 1, rng.intN(6) + 1];
    }

    const logged = [d.d1, d.d2];
    if (d.fixed) {
      // An Alchemist roll: reported but not counted, once its declaration is
      // found.
      const claim = knights ? claimDeclaration(e.seq, logged) : { ok: false, why: "this ruleset has no Alchemist" };
      if (!claim.ok) {
        forged++;
        rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: null, status: `UNDECLARED (${claim.why})` });
      } else {
        declared++;
        rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: null, status: "declared (Alchemist)" });
      }
    } else {
      checked++;
      const same = expect[0] === logged[0] && expect[1] === logged[1];
      if (!same) mismatches++;
      rolls.push({ seq: e.seq, n: rollCount + 1, logged, expected: expect, status: same ? "ok" : "MISMATCH" });
    }
    rollCount++;
  }

  if (forged > 0) {
    return { check: bad(name, `${forged} of ${rollCount} rolls claim to be Alchemist rolls with nothing in the log declaring them`), rolls };
  }
  if (checked === 0 && rollCount > 0) {
    // Not a skip: a skip would let an all-Alchemist log pass while deriving
    // nothing from the seed.
    return { check: bad(name, `all ${rollCount} rolls were declared by an Alchemist, so no roll in this game came from the seed`), rolls };
  }
  if (checked === 0) {
    return { check: skip(name, "this game logged no rolls"), rolls };
  }
  const suffix = declared > 0 ? `; ${declared} declared by an Alchemist and not derivable` : "";
  return {
    check: mismatches === 0
      ? ok(name, `${checked} rolls re-derived exactly${suffix}`)
      : bad(name, `${mismatches} of ${checked} rolls are not what this seed produces${suffix}`),
    rolls,
  };
}

function verifyEventDie(pub, events, support) {
  const name = "every event die follows from the seed";
  // The event die's slot has moved before (engine.EventDieSeq); the version
  // check covers older games.
  if (!support.ok) {
    return skip(name, support.why);
  }
  const faces = { 3: "trade", 4: "politics", 5: "science" };
  let checked = 0, mismatches = 0;
  // The event die uses its own reserved slot: -2000000 minus the roll event's
  // log position. A positive offset from the roll's seq would collide with a
  // later roll's dice stream (see engine.EventDieSeq).
  const eventDieSeq = (rollSeq) => -2000000 - rollSeq;
  let lastRollSeq = null;
  for (const e of events) {
    if (e.type === "dice_rolled") { lastRollSeq = e.seq; continue; }
    if (e.type !== "cak_event_die") continue;
    if (lastRollSeq === null || !e.data || e.data.face === undefined) continue;
    const die = rngFor(pub, eventDieSeq(lastRollSeq)).intN(6);
    const want = faces[die] || "ship";
    checked++;
    if (want !== e.data.face) mismatches++;
  }
  if (checked === 0) return skip(name, "no event die in this game (it is a Knights ruleset feature)");
  return mismatches === 0
    ? ok(name, `${checked} event dice re-derived exactly`)
    : bad(name, `${mismatches} of ${checked} event dice are not what this seed produces`);
}

/** format renders a verify() result as plain text. */
export function format(result) {
  const lines = [];
  lines.push(`game ${result.game}: ${result.verdict.toUpperCase()}`);
  lines.push("");
  for (const c of result.checks) {
    const mark = c.status === "ok" ? "PASS" : c.status === "FAILED" ? "FAIL" : "----";
    lines.push(`  [${mark}] ${c.name}`);
    if (c.detail) lines.push(`         ${c.detail}`);
  }
  if (result.rolls.length > 0) {
    lines.push("");
    lines.push(`  rolls (${result.rolls.length}):`);
    for (const r of result.rolls) {
      const exp = r.expected ? ` expected ${r.expected[0]}+${r.expected[1]}` : "";
      lines.push(`    #${String(r.n).padStart(3)} seq ${String(r.seq).padStart(5)}  rolled ${r.logged[0]}+${r.logged[1]} = ${r.logged[0] + r.logged[1]}${exp}  ${r.status}`);
    }
  }
  return lines.join("\n");
}
