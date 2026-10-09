// Which cards moved, from where, to whom.
//
// No production event carries a hex: `resources_distributed` is
// `{gains: [{player, gain}]}`, and `distribute` (engine/turn.go) discards the
// attribution. So the client reproduces that walk against the board and
// buildings it already holds.
//
// Deriving rather than adding a wire field: the event log is append-only, so
// existing games and replays would still need the walk. The derivation is
// exact except when a barbarian landfall downgrades a city in the same commit
// (production uses the post-event-die state); `attributeGain` reconciles any
// gap against the authoritative gain.
//
// Timing and ordering live in lib/board3d/cardflight, and screen positions in
// the overlay. This module knows only the game.
import type { Board, BuildingView, Hand, Hex, Resource, Vertex } from "@/lib/types";
import { RES_INDEX, resIndexOf } from "@/lib/types";
import { hexKey, vertexHexes, vertexKey } from "@/lib/hexgeo";
import { COST } from "@/lib/costs";
import type { GameEvent } from "@/lib/gamestate";
import {
  choreograph,
  type CardFace,
  type CardFlight,
  type Endpoint,
} from "@/lib/board3d/cardflight";

/** Everything the planner needs about the table, from the viewer's full view. */
export interface FlightCtx {
  board: Pick<Board, "tiles" | "robber">;
  buildings: readonly BuildingView[];
  /**
   * The roll in force, for a batch without its own `dice_rolled`. A roll and
   * its distribution normally arrive together; a reconcile can split them.
   */
  roll?: number | null;
}

/** One hex that paid a player, and how many cards of it. */
export interface HexSource {
  hex: Hex;
  res: Resource;
  n: number;
}

/** One card, and where it came from. `from` is the bank when nothing derived. */
export interface AttributedCard {
  from: Endpoint;
  idx: number;
}

const BANK: Endpoint = { k: "bank" };
const DECK: Endpoint = { k: "deck" };
const seatAt = (seat: number): Endpoint => ({ k: "seat", seat });
const fromHex = (hex: Hex): Endpoint => ({ k: "hex", hex });

/** Wood through ore, the five that index into a Hand. Mirrors Resource.Producing. */
export function producing(res: Resource): boolean {
  return resIndexOf(res) > 0;
}

/**
 * The hexes that paid `seat` on this roll, reproducing `distribute`'s walk:
 * tiles whose number came up, without the robber, whose terrain pays; then
 * each corner holding one of the seat's buildings, a city counting double.
 * `wants` lets the Islands gold walk (engine/islands/hooks.go) reuse it.
 *
 * Sorted by hex so a re-render cannot reshuffle a stagger already in flight.
 */
export function producingHexes(
  board: Pick<Board, "tiles" | "robber">,
  buildings: readonly BuildingView[],
  roll: number,
  seat: number,
  wants: (res: Resource) => boolean = producing,
): HexSource[] {
  const mine = new Map<string, BuildingView>();
  for (const b of buildings) if (b.owner === seat) mine.set(vertexKey(b.v), b);
  if (!mine.size) return [];
  const robber = board.robber ? hexKey(board.robber) : null;
  const out: HexSource[] = [];
  for (const t of board.tiles) {
    if (t.num !== roll || !wants(t.res)) continue;
    const key = hexKey(t.hex);
    if (key === robber) continue;
    let n = 0;
    // Walk the seat's (few) buildings and the hexes each touches, rather than
    // every corner of every rolled tile.
    for (const b of mine.values()) {
      if (!vertexHexes(b.v).some((h) => hexKey(h) === key)) continue;
      n += b.city ? 2 : 1;
    }
    if (n > 0) out.push({ hex: t.hex, res: t.res, n });
  }
  return out.sort((a, b) => (hexKey(a.hex) < hexKey(b.hex) ? -1 : 1));
}

/**
 * Match an authoritative gain against derived sources, resource by resource.
 *
 * Derived more than granted (the bank-shortage clamp, or a city downgraded in
 * the same commit): the extra sources are dropped. Derived less (a rule the
 * walk does not model): the rest flies from the bank. The cards on screen
 * always equal the cards received.
 */
export function attributeGain(
  gain: readonly number[] | undefined,
  sources: readonly HexSource[],
): AttributedCard[] {
  const budget = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i <= 5; i++) budget[i] = Math.max(0, gain?.[i] ?? 0);
  const out: AttributedCard[] = [];
  for (const s of sources) {
    const idx = resIndexOf(s.res);
    if (idx === 0) continue;
    const take = Math.min(s.n, budget[idx]);
    for (let i = 0; i < take; i++) out.push({ from: fromHex(s.hex), idx });
    budget[idx] -= take;
  }
  for (let idx = 1; idx <= 5; idx++) {
    for (let i = 0; i < budget[idx]; i++) out.push({ from: BANK, idx });
  }
  return out;
}

/**
 * Match a gain against sources that do not name a resource. Gold: the hex owed
 * the pick but the player chose the cards. Slots fill in source order; the rest
 * comes from the bank.
 */
export function attributeAny(
  gain: readonly number[] | undefined,
  sources: readonly HexSource[],
): AttributedCard[] {
  const slots: Endpoint[] = [];
  for (const s of sources) for (let i = 0; i < s.n; i++) slots.push(fromHex(s.hex));
  const out: AttributedCard[] = [];
  for (let idx = 1; idx <= 5; idx++) {
    for (let i = 0; i < Math.max(0, gain?.[idx] ?? 0); i++) {
      out.push({ from: slots[out.length] ?? BANK, idx });
    }
  }
  return out;
}

// ---- event decoding ----

type Blob = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const seatOf = (v: unknown): number | null => (typeof v === "number" && v >= 0 ? v : null);

/** One `CardFace` per card in a resource Hand. */
function handFaces(h: unknown): CardFace[] {
  const arr = Array.isArray(h) ? (h as number[]) : [];
  const out: CardFace[] = [];
  for (let idx = 1; idx <= 5; idx++) {
    for (let i = 0; i < Math.max(0, arr[idx] ?? 0); i++) out.push({ k: "res", idx });
  }
  return out;
}

/** One `CardFace` per card in a commodity hand ([cloth, paper, coin]). */
function comFaces(h: unknown): CardFace[] {
  const arr = Array.isArray(h) ? (h as number[]) : [];
  const out: CardFace[] = [];
  for (let idx = 0; idx <= 2; idx++) {
    for (let i = 0; i < Math.max(0, arr[idx] ?? 0); i++) out.push({ k: "com", idx });
  }
  return out;
}

/** The cards a purchase cost, as faces. `COST` is the shared price list. */
function costFaces(kind: string): CardFace[] {
  const cost = COST[kind] ?? {};
  const out: CardFace[] = [];
  for (let idx = 1; idx <= 5; idx++) {
    for (let i = 0; i < (cost[idx] ?? 0); i++) out.push({ k: "res", idx });
  }
  return out;
}

/** What the walk carries between the events of one commit. */
interface Walk {
  roll: number | null;
  /** The vertex of the settlement just placed, for `starting_resources`. */
  lastSettlement: Vertex | null;
  /** Commodity conversions to fold back into this batch's production. */
  adjusts: {
    seat: number;
    resIdx: number;
    comIdx: number;
    count: number;
    short: number;
    /** The commodity is paid on top of the resource, not by converting one. */
    minted: boolean;
  }[];
}

function push(out: CardFlight[], from: Endpoint, to: Endpoint, faces: readonly CardFace[]): void {
  for (const face of faces) out.push({ from, to, face, count: 1, delayMs: 0 });
}

function repeat(face: CardFace, n: number): CardFace[] {
  return Array.from({ length: Math.max(0, n) }, () => face);
}

/**
 * The flights one event implies, before ordering.
 *
 * Hidden payloads are recognised by a missing field: `card_stolen` redacted is
 * `{thief, victim}` without `res`, and `cak_cards_taken` is `{from, to, count}`
 * without `cards`. A viewer who was not told sees a card back, with no
 * separate permission branch.
 */
function planEvent(ev: GameEvent, ctx: FlightCtx, walk: Walk): CardFlight[] {
  const d = (ev.data ?? {}) as Blob;
  const out: CardFlight[] = [];
  const player = seatOf(d.player);

  switch (ev.type) {
    // ---- production ----
    case "resources_distributed": {
      const gains = (d.gains as { player: number; gain: Hand }[] | undefined) ?? [];
      for (const g of gains) {
        const to = seatOf(g.player);
        if (to == null) continue;
        const src =
          walk.roll == null ? [] : producingHexes(ctx.board, ctx.buildings, walk.roll, to);
        for (const c of attributeGain(g.gain, src)) {
          out.push({
            from: c.from,
            to: seatAt(to),
            face: { k: "res", idx: c.idx },
            count: 1,
            delayMs: 0,
          });
        }
      }
      return out;
    }
    case "starting_resources": {
      // One card per producing hex around the settlement just placed. Exact:
      // there is no shortage rule on the opening grant.
      if (player == null) return out;
      const v = walk.lastSettlement;
      const src: HexSource[] = [];
      if (v) {
        for (const h of vertexHexes(v)) {
          const t = ctx.board.tiles.find((x) => hexKey(x.hex) === hexKey(h));
          if (t && producing(t.res)) src.push({ hex: t.hex, res: t.res, n: 1 });
        }
      }
      for (const c of attributeGain(d.gain as Hand | undefined, src)) {
        out.push({
          from: c.from,
          to: seatAt(player),
          face: { k: "res", idx: c.idx },
          count: 1,
          delayMs: 0,
        });
      }
      return out;
    }
    case "gold_chosen": {
      // Islands. The gold hex owed the pick and the player chose the cards, so
      // slots fill in source order. A setup grant has no roll, so it falls back
      // to the gold hexes around the settlement just placed.
      if (player == null) return out;
      const src: HexSource[] =
        walk.roll == null
          ? []
          : producingHexes(ctx.board, ctx.buildings, walk.roll, player, (r) => r === "gold");
      if (!src.length && walk.lastSettlement) {
        for (const h of vertexHexes(walk.lastSettlement)) {
          const t = ctx.board.tiles.find((x) => hexKey(x.hex) === hexKey(h));
          if (t && t.res === "gold") src.push({ hex: t.hex, res: t.res, n: 1 });
        }
      }
      for (const c of attributeAny(d.gain as Hand | undefined, src)) {
        out.push({
          from: c.from,
          to: seatAt(player),
          face: { k: "res", idx: c.idx },
          count: 1,
          delayMs: 0,
        });
      }
      return out;
    }

    // ---- the bank ----
    case "year_of_plenty":
      if (player != null) push(out, BANK, seatAt(player), handFaces(d.gain));
      return out;
    case "cards_discarded":
      if (player != null) push(out, seatAt(player), BANK, handFaces(d.cards));
      return out;
    case "bank_traded":
      if (player != null) {
        push(out, seatAt(player), BANK, handFaces(d.give));
        push(out, BANK, seatAt(player), handFaces(d.get));
      }
      return out;

    // ---- between players ----
    case "trade_executed": {
      const by = seatOf(d.by);
      const wth = seatOf(d.with);
      if (by == null || wth == null) return out;
      push(out, seatAt(by), seatAt(wth), handFaces(d.give));
      push(out, seatAt(wth), seatAt(by), handFaces(d.want));
      return out;
    }
    case "card_stolen": {
      const thief = seatOf(d.thief);
      const victim = seatOf(d.victim);
      if (thief == null || victim == null) return out;
      const idx = resIndexOf(d.res);
      // From the victim's seat, not the bank.
      push(out, seatAt(victim), seatAt(thief), [idx ? { k: "res", idx } : { k: "hidden" }]);
      return out;
    }
    case "monopoly_resolved": {
      if (player == null) return out;
      const idx = resIndexOf(d.res);
      const takes = (d.takes as { player: number; count: number }[] | undefined) ?? [];
      for (const t of takes) {
        const victim = seatOf(t.player);
        if (victim == null) continue;
        push(
          out,
          seatAt(victim),
          seatAt(player),
          repeat(idx ? { k: "res", idx } : { k: "hidden" }, num(t.count) ?? 0),
        );
      }
      return out;
    }

    // ---- purchases ----
    // A Wagons Swift Journey is bought from the same deck at the same price but
    // arrives as its own event; its cost flies the same way. The card itself
    // does not fly as a back: it is public by rule and CardRevealLayer carries
    // it face up.
    case "wagons_swift_bought":
      if (player != null && !d.free) push(out, seatAt(player), BANK, costFaces("dev"));
      return out;
    case "dev_card_bought":
      if (player != null) {
        if (!d.free) push(out, seatAt(player), BANK, costFaces("dev"));
        // Always a back, even for the buyer: a face would spoil it for anyone
        // reading over their shoulder.
        push(out, DECK, seatAt(player), [{ k: "dev" }]);
      }
      return out;
    case "road_built":
      if (player != null && !d.free) push(out, seatAt(player), BANK, costFaces("road"));
      return out;
    case "settlement_built":
      if (player != null) push(out, seatAt(player), BANK, costFaces("settlement"));
      return out;
    case "city_built":
      if (player != null) push(out, seatAt(player), BANK, costFaces("city"));
      return out;
    case "ship_built":
      if (player != null && !d.free) push(out, seatAt(player), BANK, costFaces("ship"));
      return out;
    // `free` is set by cards that grant the piece outright (Engineer's wall, the
    // Deserter's replacement knight); no cost flies then. Same guard as
    // road/ship.
    case "cak_knight_built":
      if (player != null && !d.free) push(out, seatAt(player), BANK, costFaces("knight"));
      return out;
    case "cak_wall_built":
      if (player != null && !d.free) push(out, seatAt(player), BANK, costFaces("wall"));
      return out;
    case "cak_cheap_city":
      // Medicine: a city for 1 wheat + 2 ore instead of 2+3
      // (engine/knights/decide.go's costMedicineCity).
      if (player != null) {
        push(out, seatAt(player), BANK, [
          { k: "res", idx: RES_INDEX.wheat },
          { k: "res", idx: RES_INDEX.ore },
          { k: "res", idx: RES_INDEX.ore },
        ]);
      }
      return out;

    // ---- Knights ----
    case "cak_harvest":
      if (player != null) {
        const idx = resIndexOf(d.res);
        if (idx) push(out, BANK, seatAt(player), repeat({ k: "res", idx }, num(d.count) ?? 0));
      }
      return out;
    case "cak_aqueduct_taken": {
      // ResNone ("none") means the bank was empty and nothing was taken.
      const idx = resIndexOf(d.res);
      if (player != null && idx) push(out, BANK, seatAt(player), [{ k: "res", idx }]);
      return out;
    }
    case "cak_resource_levy": {
      if (player == null) return out;
      const idx = resIndexOf(d.res);
      for (const t of (d.takes as { player: number; count: number }[] | undefined) ?? []) {
        const victim = seatOf(t.player);
        if (victim == null) continue;
        push(
          out,
          seatAt(victim),
          seatAt(player),
          repeat(idx ? { k: "res", idx } : { k: "hidden" }, num(t.count) ?? 0),
        );
      }
      return out;
    }
    case "cak_commodity_levy": {
      if (player == null) return out;
      const com = num(d.commodity);
      for (const t of (d.takes as { player: number; count: number }[] | undefined) ?? []) {
        const victim = seatOf(t.player);
        if (victim == null) continue;
        push(
          out,
          seatAt(victim),
          seatAt(player),
          repeat(com == null ? { k: "hidden" } : { k: "com", idx: com }, num(t.count) ?? 0),
        );
      }
      return out;
    }
    case "cak_cards_taken":
    case "cak_cards_given":
    case "cak_commodity_taken": {
      const from = seatOf(d.from);
      const to = seatOf(d.to);
      if (from == null || to == null) return out;
      // Redacted for non-parties to `{from, to, count}`, so they see card backs.
      const faces = Array.isArray(d.cards)
        ? ev.type === "cak_commodity_taken"
          ? comFaces(d.cards)
          : handFaces(d.cards)
        : repeat({ k: "hidden" }, num(d.count) ?? 0);
      push(out, seatAt(from), seatAt(to), faces);
      return out;
    }
    case "cak_commodity_stolen": {
      const thief = seatOf(d.thief);
      const victim = seatOf(d.victim);
      if (thief == null || victim == null) return out;
      const com = num(d.com);
      push(out, seatAt(victim), seatAt(thief), [
        com == null ? { k: "hidden" } : { k: "com", idx: com },
      ]);
      return out;
    }
    case "cak_commodity_discarded":
      if (player != null) push(out, seatAt(player), BANK, comFaces(d.cards));
      return out;
    case "cak_commodity_traded": {
      if (player == null) return out;
      const give: CardFace = d.give_is_com
        ? { k: "com", idx: num(d.give_com) ?? 0 }
        : { k: "res", idx: resIndexOf(d.give_res) };
      const get: CardFace = d.get_is_com
        ? { k: "com", idx: num(d.get_com) ?? 0 }
        : { k: "res", idx: resIndexOf(d.get_res) };
      // Commodities come from a separate supply but still fly via the bank orb,
      // which stands for "the supply"; a second anchor would teach a
      // distinction the rules never require.
      push(out, seatAt(player), BANK, repeat(give, num(d.give_n) ?? 0));
      push(out, BANK, seatAt(player), repeat(get, num(d.count) ?? 0));
      return out;
    }
    case "cak_commodity_basket_traded": {
      if (player == null) return out;
      // One flight each way for the whole basket; commodities use the bank orb
      // as above.
      push(out, seatAt(player), BANK, [...handFaces(d.spend_res), ...comFaces(d.spend_com)]);
      push(out, BANK, seatAt(player), [...handFaces(d.get_res), ...comFaces(d.get_com)]);
      return out;
    }
    case "cak_trading_house": {
      if (player == null) return out;
      // Trade level 3: always two of one commodity in, one card out.
      push(out, seatAt(player), BANK, repeat({ k: "com", idx: num(d.give) ?? 0 }, 2));
      const get: CardFace = d.com_out
        ? { k: "com", idx: num(d.get_com) ?? 0 }
        : { k: "res", idx: resIndexOf(d.get_res) };
      push(out, BANK, seatAt(player), [get]);
      return out;
    }
    case "cak_harbor_given": {
      const taker = seatOf(d.taker);
      const giver = seatOf(d.giver);
      if (taker == null || giver == null) return out;
      const idx = resIndexOf(d.res);
      if (idx) push(out, seatAt(taker), seatAt(giver), [{ k: "res", idx }]);
      // The commodity is hidden from non-parties; its absence is the cue.
      const com = num(d.com);
      push(out, seatAt(giver), seatAt(taker), [
        com == null ? { k: "hidden" } : { k: "com", idx: com },
      ]);
      return out;
    }

    // Everything else moves no cards. A new event type animates nothing until
    // someone decides what it means.
    default:
      return out;
  }
}

/**
 * Fold this commit's commodity conversions back into its production.
 *
 * A Knights city on commodity terrain converts one produced resource into the
 * commodity, reported as a separate event beside the full
 * `resources_distributed`. Rather than show both cards, the conversion
 * rewrites the flight in place (same hex, different face).
 *
 * `short` is the part the commodity stack could not pay. Those cards are
 * removed, not flipped: the resource went back to the bank and no commodity
 * came, so an empty cloth stack animates one wool only. Events logged before
 * the supply was finite have no `short` (reads 0).
 */
function foldCommodityAdjusts(flights: CardFlight[], walk: Walk): void {
  for (const a of walk.adjusts) {
    if (a.minted) {
      // The current engine pays the commodity on top of the resource, so it is
      // an extra card. It flies from the hex that paid the resource if any,
      // otherwise from the supply.
      const src = flights.find(
        (f) =>
          f.to.k === "seat" &&
          f.to.seat === a.seat &&
          f.face.k === "res" &&
          f.face.idx === a.resIdx,
      );
      for (let i = 0; i < Math.max(0, a.count - a.short); i++) {
        flights.push({
          from: src ? src.from : BANK,
          to: seatAt(a.seat),
          face: { k: "com", idx: a.comIdx },
          count: 1,
          delayMs: 0,
        });
      }
      continue;
    }
    let toFlip = Math.max(0, a.count - a.short);
    let toDrop = a.count - toFlip;
    const dropped: CardFlight[] = [];
    for (const f of flights) {
      if (toFlip <= 0 && toDrop <= 0) break;
      if (f.to.k !== "seat" || f.to.seat !== a.seat) continue;
      if (f.face.k !== "res" || f.face.idx !== a.resIdx) continue;
      // Flip first, then drop, so a partial shortage keeps as many cards in
      // flight as the player receives.
      if (toFlip > 0) {
        f.face = { k: "com", idx: a.comIdx };
        toFlip--;
      } else {
        dropped.push(f);
        toDrop--;
      }
    }
    for (const f of dropped) {
      const i = flights.indexOf(f);
      if (i >= 0) flights.splice(i, 1);
    }
    // No matching production (the core's shortage rule withheld it but the
    // adjust arrived anyway): fly it from the supply.
    for (let i = 0; i < toFlip; i++) {
      flights.push({
        from: BANK,
        to: seatAt(a.seat),
        face: { k: "com", idx: a.comIdx },
        count: 1,
        delayMs: 0,
      });
    }
  }
}

/**
 * Plan a whole commit's events at once. They only make sense together:
 * `resources_distributed` needs the preceding `dice_rolled`,
 * `starting_resources` needs the settlement placement, and
 * `cak_commodity_adjust` consumes a card another event reported. One roll is
 * one gesture, so the stagger is shared too.
 */
export function planBatch(evs: readonly GameEvent[], ctx: FlightCtx): CardFlight[] {
  const walk: Walk = { roll: ctx.roll ?? null, lastSettlement: null, adjusts: [] };
  let rolls = 0;
  const out: CardFlight[] = [];
  for (const ev of evs) {
    const d = (ev.data ?? {}) as Blob;
    switch (ev.type) {
      case "dice_rolled": {
        rolls++;
        const d1 = num(d.d1);
        const d2 = num(d.d2);
        walk.roll = d1 != null && d2 != null ? d1 + d2 : walk.roll;
        continue;
      }
      case "settlement_placed":
      case "settlement_built":
      case "setup_city_placed":
        walk.lastSettlement = (d.v as Vertex | undefined) ?? walk.lastSettlement;
        break;
      case "cak_commodity_adjust": {
        const seat = seatOf(d.player);
        const comIdx = num(d.commodity);
        const resIdx = resIndexOf(d.res);
        if (seat != null && comIdx != null && resIdx)
          walk.adjusts.push({
            seat,
            resIdx,
            comIdx,
            count: num(d.count) ?? 0,
            short: num(d.short) ?? 0,
            minted: d.minted === true,
          });
        continue;
      }
    }
    out.push(...planEvent(ev, ctx, walk));
  }
  // Two rolls in one batch is a catch-up (a reconcile after a drop, or a
  // spectator joining a running game), not a turn. As with `newlyPlaced`, show
  // none of it.
  if (rolls > 1) return [];
  foldCommodityAdjusts(out, walk);
  return choreograph(out);
}
