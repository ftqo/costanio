// What a card looks like: its name, its colour and the art slot for its icon.
//
// Shared by routes/Game and CardFlightLayer: a flying card must match the hand
// shelf exactly for the move to read as one object.
import type { CardFace } from "@/lib/board3d/cardflight";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

/**
 * A card's name, live against the active catalogue. The tables below are
 * module constants evaluated at import, so `name` is a getter over a message
 * descriptor: consumers read a plain string off `RES[i].name` that follows the
 * current language.
 */
function named<T extends object>(name: MessageDescriptor, rest: T): T & { name: string } {
  return Object.defineProperty(rest, "name", {
    get: () => i18n._(name),
    enumerable: true,
  }) as T & { name: string };
}

/**
 * The stable token for one kind of card, resource or commodity. Not the
 * display name (translated) or `idx` (two overlapping index spaces): the key
 * lib/cardPhrases looks messages up by, unique across both rows.
 */
export type ResKey = "wood" | "brick" | "sheep" | "wheat" | "ore";
export type ComKey = "cloth" | "paper" | "coin";
export type CardKey = ResKey | ComKey;

/**
 * Which row a token belongs to. Some phrase tables in lib/cardPhrases cover
 * one row only (only a resource sits in the bank), so callers holding a
 * `CardKey` or a wire string narrow first. Derived from the tables below.
 */
export function isResKey(k: string): k is ResKey {
  return RES.some((r) => r.key === k);
}
export function isComKey(k: string): k is ComKey {
  return COMMOD.some((c) => c.key === k);
}

/**
 * The five bankable resources, indexed as a Hand is (0 unused).
 *
 * Each `key` carries `as const` because `named` infers from the literal, and
 * otherwise `RES[i].key` widens to `string`, which the ResKey lookups reject.
 */
export const RES = [
  named(msg({ message: "Wood", context: "resource" }), {
    idx: 1,
    key: "wood" as const,
    color: "var(--color-green)",
  }),
  named(msg({ message: "Brick", context: "resource" }), {
    idx: 2,
    key: "brick" as const,
    color: "var(--color-orange)",
  }),
  named(msg({ message: "Sheep", context: "resource" }), {
    idx: 3,
    key: "sheep" as const,
    color: "var(--color-sheep)",
  }),
  named(msg({ message: "Wheat", context: "resource" }), {
    idx: 4,
    key: "wheat" as const,
    // Its own card token (styles/pb-hud.css): the terrain yellow is also the
    // selected and count yellow, so a wheat card hid the count on it. The
    // fallback keeps a page without that stylesheet drawing wheat.
    color: "var(--card-wheat, var(--color-yellow))",
  }),
  named(msg({ message: "Ore", context: "resource" }), {
    idx: 5,
    key: "ore" as const,
    color: "var(--color-ore)",
  }),
];

/**
 * Knights commodities, in engine order: ext.cak `commodities` is
 * [cloth, paper, coin] and every wire field (`improve` costs, `harbor_give`,
 * `play_progress {com}`, the discard payload) indexes into it. Never reorder;
 * to draw them differently, iterate COMMOD_ROW and key off `c.idx`.
 *
 * `color` is the card face fill, where a pastel works. `ink` is for a commodity
 * drawn as colour alone (the 10px metropolis pips on a seat card), where the
 * pastels are too faint (paper measured 1.21:1 against an unfilled pip). One
 * object so the two cannot drift apart.
 */
export const COMMOD = [
  named(msg({ message: "Cloth", context: "commodity" }), {
    idx: 0,
    key: "cloth" as const,
    color: "var(--color-cloth)",
    ink: "var(--color-cloth-ink)",
  }),
  named(msg({ message: "Paper", context: "commodity" }), {
    idx: 1,
    key: "paper" as const,
    color: "var(--color-papyrus)",
    ink: "var(--color-papyrus-ink)",
  }),
  named(msg({ message: "Coin", context: "commodity" }), {
    idx: 2,
    key: "coin" as const,
    color: "var(--color-coin)",
    ink: "var(--color-coin-ink)",
  }),
];

/**
 * The same three commodities in display order: paper, cloth, coin. Every row
 * of commodities iterates this so the layout is consistent (hand shelf, trade
 * builder, discard and give pickers, Commercial Harbor / Trading House /
 * progress overlays, bank rate strip).
 *
 * The same objects as COMMOD, so `c.idx` is still the engine index. Positional
 * reads against engine-order slices (`comList[i]`) must become
 * `comList[c.idx]` before a call site switches over.
 */
export const COMMOD_ROW = [COMMOD[1], COMMOD[0], COMMOD[2]];

/**
 * "Wood ×2": one card and a count, as a quantity rather than a sentence.
 *
 * For tallies (price lines, trade summaries, chip labels, log runs), where
 * "2 Wood" would need inflecting in German or Spanish over a runtime name. The
 * multiplier suffix has no agreement to get wrong, and matches the icon plus
 * `×n` the UI already draws. Counts inside a sentence use lib/cardPhrases.
 */
export function goodCount(name: string, n: number): string {
  return `${name} ×${n}`;
}

// Slot mapping for swappable art. RES is indexed 1..5 = wood/brick/sheep/wheat/ore
// (index 0 unused, matching the engine/board resource convention).
const RES_SLOT = ["", "icon_wood", "icon_brick", "icon_sheep", "icon_wheat", "icon_ore"];
export function resIconSlot(idx: number): string {
  return RES_SLOT[idx] ?? "";
}

const COM_SLOT = ["icon_cloth", "icon_paper", "icon_coin"];
export function comIconSlot(idx: number): string {
  return COM_SLOT[idx] ?? "";
}

/** One kind of card in a pile, ready to draw as its icon art plus a count. */
export interface HandChip {
  /** Stable React key; resources and commodities share an index space otherwise. */
  key: string;
  /** Asset slot for the icon art. */
  slot: string;
  name: string;
  n: number;
}

/**
 * The distinct cards in one side of a trade offer, in table order (the five
 * resources, then in Knights the three commodities), skipping absent kinds.
 *
 * Both arguments are the numeric arrays the wire carries for a pile: `hand` is
 * `engine.Hand` (1..5, slot 0 unused) and `coms` is `knights.CommodityHand` (0..2).
 * A scalar resource field (a harbour's kind, a bank trade's give) serializes
 * as a string and must not be passed here.
 */
export function handChips(hand: number[] | undefined, coms?: number[]): HandChip[] {
  const chips: HandChip[] = [];
  for (const r of RES) {
    const n = hand?.[r.idx] ?? 0;
    if (n > 0) chips.push({ key: `r${r.idx}`, slot: resIconSlot(r.idx), name: r.name, n });
  }
  // COMMOD_ROW so commodities read in shelf order; `c.idx` still indexes the
  // wire array.
  for (const c of COMMOD_ROW) {
    const n = coms?.[c.idx] ?? 0;
    if (n > 0) chips.push({ key: `c${c.idx}`, slot: comIconSlot(c.idx), name: c.name, n });
  }
  return chips;
}

export interface FaceLook {
  name: string;
  color: string;
  /** Asset slot for the icon, or "" for a face with no art (a card back). */
  slot: string;
}

/**
 * How to draw one card face. `hidden` is a real face (a steal seen by anyone
 * but the two players), drawn in paper colour with no icon.
 */
export function faceLook(face: CardFace): FaceLook {
  switch (face.k) {
    case "res": {
      const r = RES[face.idx - 1];
      return r
        ? { name: r.name, color: r.color, slot: resIconSlot(face.idx) }
        : { name: "", color: "var(--color-paper)", slot: "" };
    }
    case "com": {
      const c = COMMOD[face.idx];
      return c
        ? { name: c.name, color: c.color, slot: comIconSlot(face.idx) }
        : { name: "", color: "var(--color-paper)", slot: "" };
    }
    case "dev":
    case "progress":
      return { name: "", color: "var(--color-purple)", slot: "devcard_back" };
    default:
      return { name: "", color: "var(--color-paper)", slot: "" };
  }
}
