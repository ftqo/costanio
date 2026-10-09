// Everything the UI knows about a Knights progress card, in one total table.
//
// Keyed by the snake_case wire id from engine/knights/progress.go, with every field
// required, so adding a card to the engine fails the build here until its name,
// hint, deck, input, board prompt and preview are written down. `null` is an
// explicit "none".
//
// Hints describe what engine/knights actually does; where that differs from the
// card text (Master Merchant's exact two), the engine wins.

// Type-only import, erased at compile time, so there is no runtime cycle with
// ghost.ts (which imports `progressGhost` from here).
import type { GhostPreview } from "./board3d/ghost";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";

/**
 * Every progress card id, mirroring the constants in engine/knights/progress.go.
 * The string form is wire vocabulary and is append-only.
 */
export type ProgressCardId =
  // Trade (cloth) deck.
  | "commercial_harbor"
  | "master_merchant"
  | "merchant"
  | "merchant_fleet"
  | "resource_monopoly"
  | "trade_monopoly"
  // Politics (coin) deck.
  | "bishop"
  | "constitution"
  | "deserter"
  | "diplomat"
  | "intrigue"
  | "saboteur"
  | "spy"
  | "warlord"
  | "wedding"
  // Science (paper) deck.
  | "alchemist"
  | "crane"
  | "engineer"
  | "inventor"
  | "irrigation"
  | "medicine"
  | "mining"
  | "printer"
  | "road_building"
  | "smith";

/** The three progress decks, one per city-improvement discipline. */
export type ProgressDeck = "trade" | "politics" | "science";

/**
 * What playing the card asks the player for, and therefore which UI opens.
 *
 * - `noarg`: plays immediately with just `{card}`. Irrigation and Mining are
 *   here because the backend fixes the resource and ignores any `res`.
 * - `res` / `com` / `resorcom` / `track` / `victim` / `dice`: a small overlay.
 * - `hex` / `vertex` / `edge`: arms a board picking mode.
 * - `complex`: multi-step, opens its own flow.
 * - `vp`: not playable. The card scores when drawn and never enters a hand
 *   (`vpCard`, engine/knights/progress.go).
 */
export type ProgressInputKind =
  | "noarg"
  | "res"
  | "com"
  | "resorcom"
  | "track"
  | "victim"
  | "dice"
  | "hex"
  | "vertex"
  | "edge"
  | "complex"
  | "vp";

export interface ProgressCardInfo {
  /**
   * Display name in the player's language. A getter over a message descriptor,
   * so it resolves against the active catalogue rather than the one at import.
   */
  name: string;
  /** Plain-language description of what the engine actually does. */
  hint: string;
  /** Deck of origin, the only thing that distinguishes a Trade card visually. */
  deck: ProgressDeck;
  /** What playing it asks for. */
  input: ProgressInputKind;
  /**
   * Whether the server publishes legal positions for this card in
   * `legal.progress_targets`, so an empty list disables it. Not derivable from
   * `input`: Inventor is `complex` and target-published, Deserter is `complex`
   * and is not.
   */
  boardTargets: boolean;
  /**
   * What to tap, for cards whose play begins by pointing at the board. Names
   * the valid target, not the card's effect (that is on the hover hint).
   *
   * `null` for cards that never ask the board a bare question, and for
   * multi-step flows with their own copy.
   */
  prompt: string | null;
  /**
   * The piece a translucent preview shows at a hovered board target.
   *
   * `null` when the target is not a destination: Intrigue targets the enemy
   * knight there, Diplomat the road being removed (relocation is its own mode,
   * `diplomatto`), Inventor swaps number tokens. Cards that never reach a board
   * mode are `null`. Bishop is not: its hex is where the robber will land (see
   * MODE_GHOST in board3d/ghost).
   */
  ghost: GhostPreview;
}

/**
 * The authored table: the same record with its player-facing text fields as
 * message descriptors.
 *
 * Every name carries `context: "progress card"`: several are ordinary words
 * used elsewhere (Merchant is a board piece; Road Building is also a base
 * development card), and without context they would share one catalogue entry.
 */
interface ProgressCardSrc extends Omit<ProgressCardInfo, "name" | "hint" | "prompt"> {
  name: MessageDescriptor;
  hint: MessageDescriptor;
  prompt: MessageDescriptor | null;
}

const PROGRESS_SOURCE: Record<ProgressCardId, ProgressCardSrc> = {
  // ---- Trade (cloth) deck ----
  commercial_harbor: {
    name: msg({ message: "Commercial Harbor", context: "progress card" }),
    hint: msg({
      message:
        "Offer each opponent one of your resources; each must return a commodity of their choice.",
    }),
    deck: "trade",
    input: "complex",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  master_merchant: {
    // Engine: `decideMasterMerchantPick` requires exactly `min(2, victim's
    // combined hand)`, not "up to 2".
    name: msg({ message: "Master Merchant", context: "progress card" }),
    hint: msg({
      message:
        "Look at the hand of a player ahead of you in public victory points and take 2 cards of your choice, or their whole hand if they hold fewer than 2.",
    }),
    deck: "trade",
    input: "complex",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  merchant: {
    // The hint names the 2:1 rate, which is half the card's value.
    name: msg({ message: "Merchant", context: "progress card" }),
    hint: msg({
      message:
        "Place the merchant on a resource-producing hex next to one of your buildings: worth 1 VP while you hold it, and you trade that hex's resource with the bank at 2:1. Gold, desert and lake hexes produce no resource, so they cannot take it.",
    }),
    deck: "trade",
    input: "hex",
    boardTargets: true,
    prompt: msg({ message: "tap a resource-producing hex next to one of your buildings" }),
    ghost: "merchant",
  },
  merchant_fleet: {
    name: msg({ message: "Merchant Fleet", context: "progress card" }),
    hint: msg({
      message:
        "Trade one chosen resource or commodity at 2:1 with the bank for the rest of this turn.",
    }),
    deck: "trade",
    input: "resorcom",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  resource_monopoly: {
    name: msg({ message: "Resource Monopoly", context: "progress card" }),
    hint: msg({ message: "Name a resource; take up to 2 of it from every opponent." }),
    deck: "trade",
    input: "res",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  trade_monopoly: {
    // Engine takes exactly 1 per opponent (progress_play.go, `Count: 1`).
    name: msg({ message: "Trade Monopoly", context: "progress card" }),
    hint: msg({ message: "Name a commodity; take 1 of it from every opponent who has any." }),
    deck: "trade",
    input: "com",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },

  // ---- Politics (coin) deck ----
  bishop: {
    // `randomCombinedCard` draws from the victim's resources AND commodities.
    name: msg({ message: "Bishop", context: "progress card" }),
    hint: msg({
      message:
        "Move the robber, then steal one random card (resource or commodity) from each player with a building next to its new hex.",
    }),
    deck: "politics",
    input: "hex",
    boardTargets: true,
    prompt: msg({ message: "tap a hex to move the robber to" }),
    // The target is where the robber is going; same destination ghost as the
    // `robber` mode.
    ghost: "robber",
  },
  constitution: {
    name: msg({ message: "Constitution", context: "progress card" }),
    hint: msg({
      message:
        "Scores the moment you draw it: 1 victory point, kept face-up. It is never held in hand and cannot be played.",
    }),
    deck: "politics",
    input: "vp",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  deserter: {
    // `decideDeserterSurrender` / `decideDeserterPlace`: any tier at or below
    // the removed knight with a free piece, the taker's choice (a mighty one
    // needs no Fortress here); nothing at all with no spot or no piece.
    name: msg({ message: "Deserter", context: "progress card" }),
    hint: msg({
      message:
        "An opponent removes a knight of their choice; you place one of your own of the same strength or lower, with the same active or inactive state. A strength 3 knight needs no politics level 3 this way. If you have no free knight at or below that strength, or nowhere to put it, you place none.",
    }),
    deck: "politics",
    input: "complex",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  diplomat: {
    name: msg({ message: "Diplomat", context: "progress card" }),
    hint: msg({
      message: "Remove any open-ended road; if it's your own, you may rebuild it elsewhere.",
    }),
    deck: "politics",
    input: "edge",
    boardTargets: true,
    prompt: msg({ message: "tap an open-ended road to remove or relocate" }),
    // The road you point at, going. Relocating it is its own step
    // (`diplomatto`), which previews the arrival.
    ghost: "standing",
  },
  intrigue: {
    // No strength requirement, and `EvKnightDisplaced` deletes the knight
    // outright when `firstReachableSpot` finds nowhere for it to go.
    name: msg({ message: "Intrigue", context: "progress card" }),
    // "Routes", not roads: the card covers roads or shipping routes
    // (knights.md:518-522). `touchesOwnRoute` (`knights/decide.go:1036`) tests
    // `ModuleRouteEdge`; `TestIntrigueReachesAKnightOnYourShip` pins it.
    hint: msg({
      message:
        "Force an enemy knight of any strength off one of your routes. It retreats along its owner's routes, and is removed from the board entirely if it has nowhere to go.",
    }),
    deck: "politics",
    input: "vertex",
    boardTargets: true,
    prompt: msg({ message: "tap an enemy knight standing on one of your routes" }),
    // The knight you point at, going: it retreats along its owner's routes, or
    // leaves the board when it has nowhere to go.
    ghost: "standing",
  },
  saboteur: {
    name: msg({ message: "Saboteur", context: "progress card" }),
    hint: msg({
      message:
        "Every opponent with at least as many victory points as you discards half their hand.",
    }),
    deck: "politics",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  spy: {
    // VP cards score on draw (`vpCard`) and never enter a hand, so the hint
    // needs no exception for them.
    name: msg({ message: "Spy", context: "progress card" }),
    hint: msg({ message: "Look at an opponent's progress cards and take one of your choice." }),
    deck: "politics",
    input: "victim",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  warlord: {
    // `EvKnightsAllActive` sets Free and FreshlyActivated, and a freshly
    // activated knight cannot act this turn. Both halves are in the hint.
    name: msg({ message: "Warlord", context: "progress card" }),
    hint: msg({
      message:
        "Activate all of your knights at once, for free, but they come up freshly activated, so none of them can act until your next turn.",
    }),
    deck: "politics",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  wedding: {
    // The giver chooses (CmdGiveCards, driven by PendingGive).
    name: msg({ message: "Wedding", context: "progress card" }),
    hint: msg({
      message:
        "Each opponent ahead of you in public victory points gives you 2 cards of their own choosing, or everything they hold, if that is less.",
    }),
    deck: "politics",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },

  // ---- Science (paper) deck ----
  alchemist: {
    name: msg({ message: "Alchemist", context: "progress card" }),
    hint: msg({
      message:
        "Before rolling, set both dice to any values yourself. Must be played before the roll.",
    }),
    deck: "science",
    input: "dice",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  crane: {
    name: msg({ message: "Crane", context: "progress card" }),
    hint: msg({
      message: "Upgrade one city-improvement track for one fewer commodity than normal.",
    }),
    deck: "science",
    input: "track",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  engineer: {
    name: msg({ message: "Engineer", context: "progress card" }),
    hint: msg({ message: "Build a city wall on one of your cities for free." }),
    deck: "science",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  inventor: {
    name: msg({ message: "Inventor", context: "progress card" }),
    hint: msg({ message: "Swap the number tokens on two hexes (not 2, 6, 8 or 12)." }),
    deck: "science",
    input: "complex",
    boardTargets: true,
    prompt: null,
    ghost: null,
  },
  // Irrigation and Mining name the terrain (`terrain.wheat` is Field,
  // `terrain.ore` is Mountain) rather than the resource, matching how the rest
  // of the product names those tiles.
  irrigation: {
    name: msg({ message: "Irrigation", context: "progress card" }),
    hint: msg({
      message:
        "Take 2 wheat for each Field hex you border. A hex pays once, however many buildings you have on it.",
    }),
    deck: "science",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  medicine: {
    name: msg({ message: "Medicine", context: "progress card" }),
    hint: msg({
      message: "Upgrade a settlement to a city for 2 ore and 1 wheat instead of the usual 3 and 2.",
    }),
    deck: "science",
    input: "vertex",
    boardTargets: true,
    // The one prompt that names a price: Medicine is not free, and a player who
    // cannot pay would otherwise look for a settlement that never lights up.
    prompt: msg({ message: "tap one of your settlements to upgrade it for 2 ore and 1 wheat" }),
    // Upgrades a settlement to a city on a vertex through the shape-only
    // `pvertex` mode, so the ghost has to say "city".
    ghost: "city",
  },
  mining: {
    name: msg({ message: "Mining", context: "progress card" }),
    hint: msg({
      message:
        "Take 2 ore for each Mountain hex you border. A hex pays once, however many buildings you have on it.",
    }),
    deck: "science",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  printer: {
    name: msg({ message: "Printer", context: "progress card" }),
    hint: msg({
      message:
        "Scores the moment you draw it: 1 victory point, kept face-up. It is never held in hand and cannot be played.",
    }),
    deck: "science",
    input: "vp",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  road_building: {
    name: msg({ message: "Road Building", context: "progress card" }),
    hint: msg({ message: "Build 2 roads for free." }),
    deck: "science",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
  smith: {
    name: msg({ message: "Smith", context: "progress card" }),
    hint: msg({ message: "Promote up to 2 of your knights for free." }),
    deck: "science",
    input: "noarg",
    boardTargets: false,
    prompt: null,
    ghost: null,
  },
};

/**
 * Render one authored entry into the shape consumers read. The text fields are
 * enumerable getters, so `PROGRESS_CARDS[id].name` is a plain string resolved
 * against the active catalogue when read.
 */
function rendered(src: ProgressCardSrc): ProgressCardInfo {
  const base = {
    deck: src.deck,
    input: src.input,
    boardTargets: src.boardTargets,
    ghost: src.ghost,
  };
  return Object.defineProperties(base, {
    name: { get: () => i18n._(src.name), enumerable: true },
    hint: { get: () => i18n._(src.hint), enumerable: true },
    prompt: { get: () => (src.prompt ? i18n._(src.prompt) : null), enumerable: true },
  }) as ProgressCardInfo;
}

/**
 * The one table, total over `ProgressCardId`: an id without an entry is a type
 * error.
 */
export const PROGRESS_CARDS: Record<ProgressCardId, ProgressCardInfo> = Object.fromEntries(
  (Object.keys(PROGRESS_SOURCE) as ProgressCardId[]).map((id) => [
    id,
    rendered(PROGRESS_SOURCE[id]),
  ]),
) as Record<ProgressCardId, ProgressCardInfo>;

/**
 * How many of each card the deck holds, mirroring `deckComposition` in
 * engine/knights/progress.go. 18 per deck, 54 in all. Total over ProgressCardId so
 * a new card needs a count; the weights matter (Merchant at 6, Spy at 3).
 */
export const PROGRESS_COUNTS: Record<ProgressCardId, number> = {
  // Trade: 18.
  commercial_harbor: 2,
  master_merchant: 2,
  merchant: 6,
  merchant_fleet: 2,
  resource_monopoly: 4,
  trade_monopoly: 2,
  // Politics: 18.
  bishop: 2,
  constitution: 1,
  deserter: 2,
  diplomat: 2,
  intrigue: 2,
  saboteur: 2,
  spy: 3,
  warlord: 2,
  wedding: 2,
  // Science: 18.
  alchemist: 2,
  crane: 2,
  engineer: 1,
  inventor: 2,
  irrigation: 2,
  medicine: 2,
  mining: 2,
  printer: 1,
  road_building: 2,
  smith: 2,
};

/** The deck ids in engine order. */
export const PROGRESS_DECKS: readonly ProgressDeck[] = ["trade", "politics", "science"];

/** Every card in one deck, in the engine's stable draw order. */
export function progressDeckCards(deck: ProgressDeck): ProgressCardId[] {
  return (Object.keys(PROGRESS_CARDS) as ProgressCardId[]).filter(
    (id) => PROGRESS_CARDS[id].deck === deck,
  );
}

/**
 * How a deck presents itself. The colour is the commodity its improvement track
 * spends (Trade: Cloth, Politics: Coin, Science: Paper), so it reuses colours
 * the player already knows.
 */
const DECK_LABEL: Record<ProgressDeck, MessageDescriptor> = {
  trade: msg({ message: "Trade", context: "progress card deck" }),
  politics: msg({ message: "Politics", context: "progress card deck" }),
  science: msg({ message: "Science", context: "progress card deck" }),
};

/**
 * The deck stripe's accessible name, one whole message per deck.
 *
 * `DECK_LABEL` stays a bare label. "{deck} deck" is a compound that German
 * closes into one word, Polish and Ukrainian put in the genitive, and Turkish
 * suffixes, so each is written out whole. Same pattern as `track.deckEmpty.*`
 * in routes/Game.tsx and lib/cardPhrases.
 */
const DECK_ARIA: Record<ProgressDeck, MessageDescriptor> = {
  trade: msg({ id: "deck.aria.trade", message: "Trade deck" }),
  politics: msg({ id: "deck.aria.politics", message: "Politics deck" }),
  science: msg({ id: "deck.aria.science", message: "Science deck" }),
};

export const PROGRESS_DECK_LOOK: Record<
  ProgressDeck,
  { label: string; aria: string; color: string }
> = {
  trade: deckLook("trade", "var(--color-cloth)"),
  politics: deckLook("politics", "var(--color-coin)"),
  science: deckLook("science", "var(--color-papyrus)"),
};

/** Same live-getter trick as `rendered`, for the same reason. */
function deckLook(
  deck: ProgressDeck,
  color: string,
): { label: string; aria: string; color: string } {
  return Object.defineProperties(
    { color },
    {
      label: { get: () => i18n._(DECK_LABEL[deck]), enumerable: true },
      aria: { get: () => i18n._(DECK_ARIA[deck]), enumerable: true },
    },
  ) as { label: string; aria: string; color: string };
}

/**
 * The art slot holding this card's baked face, derived from the wire id: a new
 * card only needs a `progress_<id>.webp` in the pack. An unknown id has no
 * file in the pack, so its face is blank and its name is carried by the label.
 */
export function progressSlot(card: string): string {
  return `progress_${card}`;
}

/** Whether an arbitrary wire string is a card we know. */
export function isProgressCardId(card: string): card is ProgressCardId {
  return Object.prototype.hasOwnProperty.call(PROGRESS_CARDS, card);
}

/** The whole entry for a card, or undefined for an id we have never heard of. */
export function progressCardInfo(card: string): ProgressCardInfo | undefined {
  return isProgressCardId(card) ? PROGRESS_CARDS[card] : undefined;
}

// Proper display name for a progress card id, falling back to a title-cased
// version of the raw id for anything not in the table.
export function progressCardName(card: string): string {
  const info = progressCardInfo(card);
  if (info) return info.name;
  return card.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function progressCardHint(card: string): string | undefined {
  return progressCardInfo(card)?.hint;
}

/** Deck of origin, or undefined for an unknown id. */
export function progressCardDeck(card: string): ProgressDeck | undefined {
  return progressCardInfo(card)?.deck;
}

/** The deck mark's colour and label, or undefined for an unknown id. */
export function progressDeckLook(
  card: string,
): { label: string; aria: string; color: string } | undefined {
  const deck = progressCardDeck(card);
  return deck ? PROGRESS_DECK_LOOK[deck] : undefined;
}

/** What playing the card asks for. Unknown ids get the multi-step fallback. */
export function progressInput(card: string): ProgressInputKind {
  return progressCardInfo(card)?.input ?? "complex";
}

/**
 * Whether the server publishes board targets for this card, and so whether an
 * empty target list means "not playable right now".
 */
export function progressCardTargetsBoard(card: string): boolean {
  return progressCardInfo(card)?.boardTargets ?? false;
}

/** The piece a hovered board target would place, if any. */
export function progressGhost(card: string): GhostPreview {
  return progressCardInfo(card)?.ghost ?? null;
}

/**
 * The full board-targeting prompt for a card: "Name: tap ...". A card with no
 * written prompt still gets its display name and a generic instruction, never
 * a raw identifier.
 */
export function progressCardPrompt(card: string): string {
  const name = progressCardName(card);
  const instruction =
    progressCardInfo(card)?.prompt ?? i18n._(msg({ message: "tap a spot on the board" }));
  // One message with two named values, so the translator controls punctuation
  // and order. Values are merged into the descriptor (as in lib/errorCopy) in a
  // local: the message extractor crashes on a spread inside an object literal
  // passed to `i18n._`.
  const line = msg({ message: "{name}: {instruction}", context: "progress card board prompt" });
  const filled = { ...line, values: { name, instruction } };
  return i18n._(filled);
}
