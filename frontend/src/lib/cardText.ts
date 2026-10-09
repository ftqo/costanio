// What a card is and what it does, in one line each.
//
// The log draws cards rather than naming them, which leaves a beginner without
// a caption. Every card face the log can draw resolves here to a name and a
// sentence, and LogLine hangs a Tip off it.
//
// Progress cards keep their own table (lib/progressCards), which also feeds the
// play prompts; this module delegates to it.
import { progressCardName, progressCardHint, isProgressCardId } from "./progressCards";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

export interface CardText {
  name: string;
  hint: string;
}

/**
 * The authored form of a caption: two message descriptors. Tables here are
 * module constants evaluated at import, so `rendered` turns each into the
 * exported `CardText` with live getters that follow the current language.
 */
interface CardTextSrc {
  name: MessageDescriptor;
  hint: MessageDescriptor;
}

function rendered(src: CardTextSrc): CardText {
  return Object.defineProperties({} as CardText, {
    name: { get: () => i18n._(src.name), enumerable: true },
    hint: { get: () => i18n._(src.hint), enumerable: true },
  });
}

/**
 * Base-game development cards, keyed by wire name rather than the engine's
 * numeric `DevCard` index, which is unreadable in a transcript and would shift
 * if the enum grew.
 */
export const DEV_CARDS: Record<string, CardText> = {
  // Every name has `context: "development card"` (the progress deck has its
  // own): Road Building is in both decks and Knight is also a board piece, so
  // translators need separate entries.
  knight: rendered({
    name: msg({ message: "Knight", context: "development card" }),
    hint: msg({
      message:
        "Move the robber and steal a random card from a player beside it. Three played takes Largest Army.",
    }),
  }),
  victory_point: rendered({
    name: msg({ message: "Victory Point", context: "development card" }),
    hint: msg({
      message: "Worth 1 victory point. Stays hidden in your hand until the game ends.",
    }),
  }),
  road_building: rendered({
    name: msg({ message: "Road Building", context: "development card" }),
    hint: msg({ message: "Build 2 roads for free." }),
  }),
  year_of_plenty: rendered({
    name: msg({ message: "Year of Plenty", context: "development card" }),
    hint: msg({ message: "Take any 2 resources from the bank." }),
  }),
  monopoly: rendered({
    name: msg({ message: "Monopoly", context: "development card" }),
    hint: msg({ message: "Name a resource; every other player hands you all of theirs." }),
  }),
  // Wagons shuffles its card into the base deck (engine/wagons drawSwift) and
  // it is bought, held and played like a base card, so it lives here. The count
  // per seat is public by rule (docs/rules/wagons.md).
  swift_journey: rendered({
    name: msg({ message: "Swift Journey", context: "development card" }),
    hint: msg({
      message: "After your wagon's trip this turn, take a second trip with fresh movement.",
    }),
  }),
};

/**
 * Raiders' four-card deck, keyed by the wire name `raiders_card` carries
 * (engine/raiders/events.go).
 *
 * Separate from DEV_CARDS because `intrigue` is also a Knights progress card
 * that can share a ruleset; the contexts keep the two apart in the catalogue.
 *
 * Each is revealed and resolved on purchase, so the hint is the rule applied
 * right then.
 */
export const RAIDERS_CARDS: Record<string, CardText> = {
  muster: rendered({
    name: msg({ message: "Muster", context: "Raiders card" }),
    hint: msg({ message: "Put one of your riders on a free path at the castle." }),
  }),
  swift_rider: rendered({
    name: msg({ message: "Swift Rider", context: "Raiders card" }),
    hint: msg({
      message: "You may put one of your riders on any free path on the board.",
    }),
  }),
  treason: rendered({
    name: msg({ message: "Treason", context: "Raiders card" }),
    hint: msg({
      message: "Take 2 gold, then move 2 raiders onto 2 other unconquered coastal hexes.",
    }),
  }),
  intrigue: rendered({
    name: msg({ message: "Intrigue", context: "Raiders card" }),
    hint: msg({
      message: "Take 1 raider off a hex of your choice and add it to your prisoners.",
    }),
  }),
};

/** Which deck a named card belongs to. See `playedCardText` for why it travels. */
export type CardKind = "dev" | "progress" | "raiders";

/** The five resources, by Hand index (0 unused), and what they buy. */
const RESOURCE_TEXT: (CardTextSrc | null)[] = [
  null,
  {
    name: msg({ message: "Wood", context: "resource" }),
    hint: msg({ message: "Builds roads, settlements and ships." }),
  },
  {
    name: msg({ message: "Brick", context: "resource" }),
    hint: msg({ message: "Builds roads, settlements and city walls." }),
  },
  {
    name: msg({ message: "Sheep", context: "resource" }),
    hint: msg({ message: "Builds settlements, ships, development cards and knights." }),
  },
  {
    name: msg({ message: "Wheat", context: "resource" }),
    hint: msg({
      message: "Builds settlements, cities and development cards; activates knights.",
    }),
  },
  {
    name: msg({ message: "Ore", context: "resource" }),
    hint: msg({ message: "Builds cities and development cards, and builds and promotes knights." }),
  },
];

/** The three commodities, indexed as the Knights commodities array is (0=cloth). */
const COMMODITY_TEXT: CardTextSrc[] = [
  {
    name: msg({ message: "Cloth", context: "commodity" }),
    hint: msg({ message: "Pays for Trade city improvements. Made by your cities on pasture." }),
  },
  {
    name: msg({ message: "Paper", context: "commodity" }),
    hint: msg({ message: "Pays for Science city improvements. Made by your cities on forest." }),
  },
  {
    name: msg({ message: "Coin", context: "commodity" }),
    hint: msg({
      message: "Pays for Politics city improvements. Made by your cities on mountains.",
    }),
  },
];

export function resourceText(idx: number): CardText | undefined {
  const c = RESOURCE_TEXT[idx];
  return c ? rendered(c) : undefined;
}

export function commodityText(idx: number): CardText | undefined {
  const c = COMMODITY_TEXT[idx];
  return c ? rendered(c) : undefined;
}

/**
 * A dev or progress card by wire id. `road_building` is a different card in
 * each vocabulary, so the kind is part of the lookup.
 */
export function playedCardText(kind: CardKind, id: string): CardText {
  if (kind === "dev") {
    return DEV_CARDS[id] ?? { name: titleCase(id), hint: "" };
  }
  if (kind === "raiders") {
    return RAIDERS_CARDS[id] ?? { name: titleCase(id), hint: "" };
  }
  return { name: progressCardName(id), hint: progressCardHint(id) ?? "" };
}

/**
 * The art slot holding this card's baked face, for either vocabulary; callers
 * want it alongside `playedCardText`. The dev deck needs a table (its slot names
 * predate the wire ids and drop the underscores); progress cards derive theirs.
 */
const DEV_SLOT: Record<string, string> = {
  knight: "devcard_knight",
  victory_point: "devcard_victorypoint",
  road_building: "devcard_roadbuilding",
  year_of_plenty: "devcard_yearofplenty",
  monopoly: "devcard_monopoly",
  swift_journey: "devcard_swiftjourney",
};

/**
 * Raiders' faces. Prefixed by the deck (see lib/assets), and spelled out since
 * nothing promises the wire id and slot name will stay aligned.
 */
const RAIDERS_SLOT: Record<string, string> = {
  muster: "raiders_muster",
  swift_rider: "raiders_swift_rider",
  treason: "raiders_treason",
  intrigue: "raiders_intrigue",
};

export function playedCardSlot(kind: CardKind, id: string): string {
  if (kind === "dev") return DEV_SLOT[id] ?? "devcard_back";
  if (kind === "raiders") return RAIDERS_SLOT[id] ?? "devcard_back";
  return `progress_${id}`;
}

function titleCase(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The name to draw over an art slot, or null if that slot has no name. The
 * inverse of `playedCardSlot`, so the card-face component can depend on the
 * slot alone. `devcard_back` has no name.
 */
export function slotCardTitle(slot: string): string | null {
  for (const [id, s] of Object.entries(DEV_SLOT)) {
    if (s === slot) return playedCardText("dev", id).name;
  }
  for (const [id, s] of Object.entries(RAIDERS_SLOT)) {
    if (s === slot) return playedCardText("raiders", id).name;
  }
  if (slot.startsWith("progress_")) {
    const id = slot.slice("progress_".length);
    return isProgressCardId(id) ? progressCardName(id) : null;
  }
  return null;
}
