/**
 * Sentences that name a card, one message per card.
 *
 * A frame like `t`Take a ${r.name}`` cannot be translated into inflected
 * languages, because article, number and agreement follow from a noun that
 * only arrives at runtime:
 *
 *   German  "kein" has to agree:  kein Holz, keinen Ziegel, keine Schafe.
 *   Spanish splits both ways at once, by gender AND by mass vs count:
 *           un ladrillo / una oveja, but madera and lana are not counted at all.
 *
 * So, as with `resource.count.*` in lib/errorCopy, each message is per card,
 * keyed by its stable token, with the noun written in. This also fixes the
 * English mass/count split ("Take wood", "Take a brick", "You hold no
 * bricks").
 *
 * Passing an already-inflected noun would need every call site to know its
 * grammatical context, which tooltips assembled far from the sentence do not.
 *
 * Explicit ids, as in lib/errorCopy: the id names the sense, and
 * near-identical English across cards ("Take cloth" / "Take paper") stays two
 * entries.
 *
 * To add a card kind, add it to `CardKey` in lib/cardFace; the compiler names
 * every table missing an arm.
 */
import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import type { CardKey, ComKey, ResKey } from "./cardFace";

/** Render one of the tables below in the active language. */
function say(d: MessageDescriptor, values?: Record<string, unknown>): string {
  return i18n._(values ? { ...d, values: { ...d.values, ...values } } : d);
}

type Phrases<K extends string> = Record<K, MessageDescriptor>;

/**
 * The same table when the sentence also carries a count.
 *
 * `{n} {card}` is no more translatable than `a {card}`: German inflects the
 * noun for the count (2 Ziegel, 2 Schafe), Spanish also agrees the article (2
 * ladrillos, 2 ovejas), and Polish has a third form at 5. So the count is an
 * ICU plural argument (`#`) inside a per-card message, and each locale writes
 * its own arms.
 *
 * In English, "1 brick" / "2 bricks" inflect, while wood, wheat, ore, cloth,
 * paper and sheep do not.
 */
type Counted<K extends string> = Record<K, (n: number) => MessageDescriptor>;

// ---------------------------------------------------------------------------
// Tips on a card you can tap. The card draws its own name, so the tip says what
// tapping it does; the noun is in the sentence so the sentence translates.
// ---------------------------------------------------------------------------

/** "Take a brick": gain one of this card from the bank or the supply. */
const TAKE: Phrases<CardKey> = {
  wood: msg({ id: "card.take.wood", message: "Take wood" }),
  brick: msg({ id: "card.take.brick", message: "Take a brick" }),
  sheep: msg({ id: "card.take.sheep", message: "Take a sheep" }),
  wheat: msg({ id: "card.take.wheat", message: "Take wheat" }),
  ore: msg({ id: "card.take.ore", message: "Take ore" }),
  cloth: msg({ id: "card.take.cloth", message: "Take cloth" }),
  paper: msg({ id: "card.take.paper", message: "Take paper" }),
  coin: msg({ id: "card.take.coin", message: "Take a coin" }),
};

/** "Give a brick": hand one of this card over. */
const GIVE: Phrases<CardKey> = {
  wood: msg({ id: "card.give.wood", message: "Give wood" }),
  brick: msg({ id: "card.give.brick", message: "Give a brick" }),
  sheep: msg({ id: "card.give.sheep", message: "Give a sheep" }),
  wheat: msg({ id: "card.give.wheat", message: "Give wheat" }),
  ore: msg({ id: "card.give.ore", message: "Give ore" }),
  cloth: msg({ id: "card.give.cloth", message: "Give cloth" }),
  paper: msg({ id: "card.give.paper", message: "Give paper" }),
  coin: msg({ id: "card.give.coin", message: "Give a coin" }),
};

/** Commercial Harbor's responder side: hand a commodity back. Commodities only. */
const RETURN: Phrases<ComKey> = {
  cloth: msg({ id: "card.return.cloth", message: "Return cloth" }),
  paper: msg({ id: "card.return.paper", message: "Return paper" }),
  coin: msg({ id: "card.return.coin", message: "Return a coin" }),
};

/** The trade builder's REQUEST palette: add one to what you are asking for. */
const REQUEST: Phrases<CardKey> = {
  wood: msg({ id: "card.request.wood", message: "Request wood" }),
  brick: msg({ id: "card.request.brick", message: "Request a brick" }),
  sheep: msg({ id: "card.request.sheep", message: "Request a sheep" }),
  wheat: msg({ id: "card.request.wheat", message: "Request wheat" }),
  ore: msg({ id: "card.request.ore", message: "Request ore" }),
  cloth: msg({ id: "card.request.cloth", message: "Request cloth" }),
  paper: msg({ id: "card.request.paper", message: "Request paper" }),
  coin: msg({ id: "card.request.coin", message: "Request a coin" }),
};

/** Take a staged discard back out of the tray. */
const PUT_BACK: Phrases<CardKey> = {
  wood: msg({ id: "card.putBack.wood", message: "Put back wood" }),
  brick: msg({ id: "card.putBack.brick", message: "Put back a brick" }),
  sheep: msg({ id: "card.putBack.sheep", message: "Put back a sheep" }),
  wheat: msg({ id: "card.putBack.wheat", message: "Put back wheat" }),
  ore: msg({ id: "card.putBack.ore", message: "Put back ore" }),
  cloth: msg({ id: "card.putBack.cloth", message: "Put back cloth" }),
  paper: msg({ id: "card.putBack.paper", message: "Put back paper" }),
  coin: msg({ id: "card.putBack.coin", message: "Put back a coin" }),
};

/** Drop one card out of a staged trade offer. */
const REMOVE: Phrases<CardKey> = {
  wood: msg({ id: "card.remove.wood", message: "Remove wood" }),
  brick: msg({ id: "card.remove.brick", message: "Remove a brick" }),
  sheep: msg({ id: "card.remove.sheep", message: "Remove a sheep" }),
  wheat: msg({ id: "card.remove.wheat", message: "Remove wheat" }),
  ore: msg({ id: "card.remove.ore", message: "Remove ore" }),
  cloth: msg({ id: "card.remove.cloth", message: "Remove cloth" }),
  paper: msg({ id: "card.remove.paper", message: "Remove paper" }),
  coin: msg({ id: "card.remove.coin", message: "Remove a coin" }),
};

/** Merchant Guild: spend two of one commodity. Commodities only. */
const GIVE_TWO: Phrases<ComKey> = {
  cloth: msg({ id: "card.giveTwo.cloth", message: "Give 2 cloth" }),
  paper: msg({ id: "card.giveTwo.paper", message: "Give 2 paper" }),
  coin: msg({ id: "card.giveTwo.coin", message: "Give 2 coins" }),
};

/**
 * Monopoly: a quantifier agreeing with a runtime noun, which even English does
 * not do uniformly ("every brick", but "all the wood"). Resources only; the
 * deck names no commodity.
 */
const TAKE_EVERY: Phrases<ResKey> = {
  wood: msg({ id: "card.takeEvery.wood", message: "Take all the wood in play" }),
  brick: msg({ id: "card.takeEvery.brick", message: "Take every brick in play" }),
  sheep: msg({ id: "card.takeEvery.sheep", message: "Take every sheep in play" }),
  wheat: msg({ id: "card.takeEvery.wheat", message: "Take all the wheat in play" }),
  ore: msg({ id: "card.takeEvery.ore", message: "Take all the ore in play" }),
};

/** Commercial Harbor's taker side: which resource goes to this opponent. */
const SPEND_ON: Phrases<ResKey> = {
  wood: msg({ id: "card.spendOn.wood", message: "Spend wood on {who}" }),
  brick: msg({ id: "card.spendOn.brick", message: "Spend a brick on {who}" }),
  sheep: msg({ id: "card.spendOn.sheep", message: "Spend a sheep on {who}" }),
  wheat: msg({ id: "card.spendOn.wheat", message: "Spend wheat on {who}" }),
  ore: msg({ id: "card.spendOn.ore", message: "Spend ore on {who}" }),
};

// ---------------------------------------------------------------------------
// Why a card is dead. A negation agrees with its noun in more languages than an
// article does.
// ---------------------------------------------------------------------------

/** You hold none of this card, so you cannot offer or spend it. */
const HOLD_NONE: Phrases<CardKey> = {
  wood: msg({ id: "card.holdNone.wood", message: "You hold no wood" }),
  brick: msg({ id: "card.holdNone.brick", message: "You hold no bricks" }),
  sheep: msg({ id: "card.holdNone.sheep", message: "You hold no sheep" }),
  wheat: msg({ id: "card.holdNone.wheat", message: "You hold no wheat" }),
  ore: msg({ id: "card.holdNone.ore", message: "You hold no ore" }),
  cloth: msg({ id: "card.holdNone.cloth", message: "You hold no cloth" }),
  paper: msg({ id: "card.holdNone.paper", message: "You hold no paper" }),
  coin: msg({ id: "card.holdNone.coin", message: "You hold no coins" }),
};

/** Master Merchant: the revealed hand has none of this card. */
const VICTIM_HOLDS_NONE: Phrases<CardKey> = {
  wood: msg({ id: "card.victimHoldsNone.wood", message: "{victimName} holds no wood" }),
  brick: msg({ id: "card.victimHoldsNone.brick", message: "{victimName} holds no bricks" }),
  sheep: msg({ id: "card.victimHoldsNone.sheep", message: "{victimName} holds no sheep" }),
  wheat: msg({ id: "card.victimHoldsNone.wheat", message: "{victimName} holds no wheat" }),
  ore: msg({ id: "card.victimHoldsNone.ore", message: "{victimName} holds no ore" }),
  cloth: msg({ id: "card.victimHoldsNone.cloth", message: "{victimName} holds no cloth" }),
  paper: msg({ id: "card.victimHoldsNone.paper", message: "{victimName} holds no paper" }),
  coin: msg({ id: "card.victimHoldsNone.coin", message: "{victimName} holds no coins" }),
};

/** Master Merchant: you have already taken everything they had of this card. */
const ALL_THEIRS: Phrases<CardKey> = {
  wood: msg({ id: "card.allTheirs.wood", message: "That is all their wood" }),
  brick: msg({ id: "card.allTheirs.brick", message: "That is all their bricks" }),
  sheep: msg({ id: "card.allTheirs.sheep", message: "That is all their sheep" }),
  wheat: msg({ id: "card.allTheirs.wheat", message: "That is all their wheat" }),
  ore: msg({ id: "card.allTheirs.ore", message: "That is all their ore" }),
  cloth: msg({ id: "card.allTheirs.cloth", message: "That is all their cloth" }),
  paper: msg({ id: "card.allTheirs.paper", message: "That is all their paper" }),
  coin: msg({ id: "card.allTheirs.coin", message: "That is all their coins" }),
};

/** The bank's stack is empty, so there is nothing to take. Resources only. */
const BANK_OUT: Phrases<ResKey> = {
  wood: msg({ id: "card.bankOut.wood", message: "The bank is out of wood" }),
  brick: msg({ id: "card.bankOut.brick", message: "The bank is out of bricks" }),
  sheep: msg({ id: "card.bankOut.sheep", message: "The bank is out of sheep" }),
  wheat: msg({ id: "card.bankOut.wheat", message: "The bank is out of wheat" }),
  ore: msg({ id: "card.bankOut.ore", message: "The bank is out of ore" }),
};

/**
 * Merchant Guild wants two of one commodity and you are short. "You don't hold
 * 2" avoids choosing between "fewer" (count) and "less" (mass).
 */
const NEED_TWO: Phrases<ComKey> = {
  cloth: msg({ id: "card.needTwo.cloth", message: "You don't hold 2 cloth" }),
  paper: msg({ id: "card.needTwo.paper", message: "You don't hold 2 paper" }),
  coin: msg({ id: "card.needTwo.coin", message: "You don't hold 2 coins" }),
};

// ---------------------------------------------------------------------------
// Fixed counts. The number is part of the rule, so it is written into the
// English ("Take 1 cloth"); it still needs one message per card, since a fixed
// 2 inflects its noun like a variable one.
// ---------------------------------------------------------------------------

/** Resource Monopoly: name a resource, take up to 2 of it from each opponent. */
const TAKE_TWO_EACH: Phrases<ResKey> = {
  wood: msg({ id: "card.takeTwoEach.wood", message: "Take up to 2 wood from every opponent" }),
  brick: msg({ id: "card.takeTwoEach.brick", message: "Take up to 2 bricks from every opponent" }),
  sheep: msg({ id: "card.takeTwoEach.sheep", message: "Take up to 2 sheep from every opponent" }),
  wheat: msg({ id: "card.takeTwoEach.wheat", message: "Take up to 2 wheat from every opponent" }),
  ore: msg({ id: "card.takeTwoEach.ore", message: "Take up to 2 ore from every opponent" }),
};

/** Trade Monopoly: name a commodity, take exactly 1 of it from each opponent. */
const TAKE_ONE_EACH: Phrases<ComKey> = {
  cloth: msg({ id: "card.takeOneEach.cloth", message: "Take 1 cloth from every opponent" }),
  paper: msg({ id: "card.takeOneEach.paper", message: "Take 1 paper from every opponent" }),
  coin: msg({ id: "card.takeOneEach.coin", message: "Take 1 coin from every opponent" }),
};

/** Merchant Fleet: one named good trades at 2:1 for the rest of the turn. */
const TRADE_TWO_TO_ONE: Phrases<CardKey> = {
  wood: msg({
    id: "card.tradeTwoToOne.wood",
    message: "Trade wood at 2:1 for the rest of this turn",
  }),
  brick: msg({
    id: "card.tradeTwoToOne.brick",
    message: "Trade bricks at 2:1 for the rest of this turn",
  }),
  sheep: msg({
    id: "card.tradeTwoToOne.sheep",
    message: "Trade sheep at 2:1 for the rest of this turn",
  }),
  wheat: msg({
    id: "card.tradeTwoToOne.wheat",
    message: "Trade wheat at 2:1 for the rest of this turn",
  }),
  ore: msg({ id: "card.tradeTwoToOne.ore", message: "Trade ore at 2:1 for the rest of this turn" }),
  cloth: msg({
    id: "card.tradeTwoToOne.cloth",
    message: "Trade cloth at 2:1 for the rest of this turn",
  }),
  paper: msg({
    id: "card.tradeTwoToOne.paper",
    message: "Trade paper at 2:1 for the rest of this turn",
  }),
  coin: msg({
    id: "card.tradeTwoToOne.coin",
    message: "Trade coins at 2:1 for the rest of this turn",
  }),
};

/**
 * The Aqueduct's timeout pick, after the server has chosen for you. A fixed 1,
 * phrased per card ("received 1 wood" is not English).
 */
const AUTO_RECEIVED: Phrases<ResKey> = {
  wood: msg({
    id: "card.autoReceived.wood",
    message: "Time ran out. Automatically received wood (Aqueduct).",
  }),
  brick: msg({
    id: "card.autoReceived.brick",
    message: "Time ran out. Automatically received a brick (Aqueduct).",
  }),
  sheep: msg({
    id: "card.autoReceived.sheep",
    message: "Time ran out. Automatically received a sheep (Aqueduct).",
  }),
  wheat: msg({
    id: "card.autoReceived.wheat",
    message: "Time ran out. Automatically received wheat (Aqueduct).",
  }),
  ore: msg({
    id: "card.autoReceived.ore",
    message: "Time ran out. Automatically received ore (Aqueduct).",
  }),
};

// ---------------------------------------------------------------------------
// Variable counts: each card's message carries the number as an ICU plural
// argument.
// ---------------------------------------------------------------------------

/** How much of one resource the bank still has. */
const BANK_LEFT: Counted<ResKey> = {
  wood: (n) =>
    msg({
      id: "card.bankLeft.wood",
      message: plural(n, { one: "# wood left in the bank", other: "# wood left in the bank" }),
    }),
  brick: (n) =>
    msg({
      id: "card.bankLeft.brick",
      message: plural(n, { one: "# brick left in the bank", other: "# bricks left in the bank" }),
    }),
  sheep: (n) =>
    msg({
      id: "card.bankLeft.sheep",
      message: plural(n, { one: "# sheep left in the bank", other: "# sheep left in the bank" }),
    }),
  wheat: (n) =>
    msg({
      id: "card.bankLeft.wheat",
      message: plural(n, { one: "# wheat left in the bank", other: "# wheat left in the bank" }),
    }),
  ore: (n) =>
    msg({
      id: "card.bankLeft.ore",
      message: plural(n, { one: "# ore left in the bank", other: "# ore left in the bank" }),
    }),
};

/** How much of one commodity the supply still has. Commodities only. */
const SUPPLY_LEFT: Counted<ComKey> = {
  cloth: (n) =>
    msg({
      id: "card.supplyLeft.cloth",
      message: plural(n, {
        one: "# cloth left in the supply",
        other: "# cloth left in the supply",
      }),
    }),
  paper: (n) =>
    msg({
      id: "card.supplyLeft.paper",
      message: plural(n, {
        one: "# paper left in the supply",
        other: "# paper left in the supply",
      }),
    }),
  coin: (n) =>
    msg({
      id: "card.supplyLeft.coin",
      message: plural(n, { one: "# coin left in the supply", other: "# coins left in the supply" }),
    }),
};

/** A harbour rate on a resource: what the bank charges, in that resource. */
const HARBOR_RES: Counted<ResKey> = {
  wood: (n) =>
    msg({
      id: "card.harborRate.wood",
      message: plural(n, {
        one: "Give the bank # wood for any 1 resource.",
        other: "Give the bank # wood for any 1 resource.",
      }),
    }),
  brick: (n) =>
    msg({
      id: "card.harborRate.brick",
      message: plural(n, {
        one: "Give the bank # brick for any 1 resource.",
        other: "Give the bank # bricks for any 1 resource.",
      }),
    }),
  sheep: (n) =>
    msg({
      id: "card.harborRate.sheep",
      message: plural(n, {
        one: "Give the bank # sheep for any 1 resource.",
        other: "Give the bank # sheep for any 1 resource.",
      }),
    }),
  wheat: (n) =>
    msg({
      id: "card.harborRate.wheat",
      message: plural(n, {
        one: "Give the bank # wheat for any 1 resource.",
        other: "Give the bank # wheat for any 1 resource.",
      }),
    }),
  ore: (n) =>
    msg({
      id: "card.harborRate.ore",
      message: plural(n, {
        one: "Give the bank # ore for any 1 resource.",
        other: "Give the bank # ore for any 1 resource.",
      }),
    }),
};

/** The same rate on a commodity, which buys a commodity back as well. */
const HARBOR_COM: Counted<ComKey> = {
  cloth: (n) =>
    msg({
      id: "card.harborRate.cloth",
      message: plural(n, {
        one: "Give the bank # cloth for any 1 resource or commodity.",
        other: "Give the bank # cloth for any 1 resource or commodity.",
      }),
    }),
  paper: (n) =>
    msg({
      id: "card.harborRate.paper",
      message: plural(n, {
        one: "Give the bank # paper for any 1 resource or commodity.",
        other: "Give the bank # paper for any 1 resource or commodity.",
      }),
    }),
  coin: (n) =>
    msg({
      id: "card.harborRate.coin",
      message: plural(n, {
        one: "Give the bank # coin for any 1 resource or commodity.",
        other: "Give the bank # coins for any 1 resource or commodity.",
      }),
    }),
};

/** What the next level of an improvement track charges. Commodities only. */
const IMPROVE_COST: Counted<ComKey> = {
  cloth: (n) =>
    msg({
      id: "card.improveCost.cloth",
      message: plural(n, { one: "Costs # cloth", other: "Costs # cloth" }),
    }),
  paper: (n) =>
    msg({
      id: "card.improveCost.paper",
      message: plural(n, { one: "Costs # paper", other: "Costs # paper" }),
    }),
  coin: (n) =>
    msg({
      id: "card.improveCost.coin",
      message: plural(n, { one: "Costs # coin", other: "Costs # coins" }),
    }),
};

/**
 * The same price when you cannot pay it, with what you do hold. `{held}` is a
 * bare number; the priced half already names the noun.
 */
const IMPROVE_SHORT: Counted<ComKey> = {
  cloth: (n) =>
    msg({
      id: "card.improveShort.cloth",
      message: plural(n, {
        one: "Needs # cloth, you hold {held}.",
        other: "Needs # cloth, you hold {held}.",
      }),
    }),
  paper: (n) =>
    msg({
      id: "card.improveShort.paper",
      message: plural(n, {
        one: "Needs # paper, you hold {held}.",
        other: "Needs # paper, you hold {held}.",
      }),
    }),
  coin: (n) =>
    msg({
      id: "card.improveShort.coin",
      message: plural(n, {
        one: "Needs # coin, you hold {held}.",
        other: "Needs # coins, you hold {held}.",
      }),
    }),
};

// ---------------------------------------------------------------------------
// The accessors. One per phrase, taking the card's `key`.
// ---------------------------------------------------------------------------

export const takeCard = (k: CardKey): string => say(TAKE[k]);
export const giveCard = (k: CardKey): string => say(GIVE[k]);
export const returnCard = (k: ComKey): string => say(RETURN[k]);
export const requestCard = (k: CardKey): string => say(REQUEST[k]);
export const putBackCard = (k: CardKey): string => say(PUT_BACK[k]);
export const removeCard = (k: CardKey): string => say(REMOVE[k]);
export const giveTwoCards = (k: ComKey): string => say(GIVE_TWO[k]);
export const takeEveryCard = (k: ResKey): string => say(TAKE_EVERY[k]);
export const spendCardOn = (k: ResKey, who: string): string => say(SPEND_ON[k], { who });
export const holdNoCards = (k: CardKey): string => say(HOLD_NONE[k]);
export const victimHoldsNoCards = (k: CardKey, victimName: string): string =>
  say(VICTIM_HOLDS_NONE[k], { victimName });
export const allTheirCards = (k: CardKey): string => say(ALL_THEIRS[k]);
export const bankOutOfCard = (k: ResKey): string => say(BANK_OUT[k]);
export const needTwoCards = (k: ComKey): string => say(NEED_TWO[k]);
export const takeTwoOfEach = (k: ResKey): string => say(TAKE_TWO_EACH[k]);
export const takeOneOfEach = (k: ComKey): string => say(TAKE_ONE_EACH[k]);
export const tradeCardAtTwo = (k: CardKey): string => say(TRADE_TWO_TO_ONE[k]);
export const autoReceivedCard = (k: ResKey): string => say(AUTO_RECEIVED[k]);
export const cardsLeftInBank = (k: ResKey, n: number): string => say(BANK_LEFT[k](n));
export const cardsLeftInSupply = (k: ComKey, n: number): string => say(SUPPLY_LEFT[k](n));
export const harborRateRes = (k: ResKey, rate: number): string => say(HARBOR_RES[k](rate));
export const harborRateCom = (k: ComKey, rate: number): string => say(HARBOR_COM[k](rate));
export const improvementCostText = (k: ComKey, n: number): string => say(IMPROVE_COST[k](n));
export const improvementShortText = (k: ComKey, n: number, held: number): string =>
  say(IMPROVE_SHORT[k](n), { held });

// ---------------------------------------------------------------------------
// Development cards.
// ---------------------------------------------------------------------------

/**
 * "You don't hold a Knight."
 *
 * The Victory Point card is refused earlier (it scores from the hand), so it
 * has no entry. Unlisted cards fall back to a sentence naming no card.
 */
const DEV_NOT_HELD: Record<string, MessageDescriptor> = {
  knight: msg({ id: "dev.notHeld.knight", message: "You don't hold a Knight card." }),
  road_building: msg({
    id: "dev.notHeld.road_building",
    message: "You don't hold a Road Building card.",
  }),
  year_of_plenty: msg({
    id: "dev.notHeld.year_of_plenty",
    message: "You don't hold a Year of Plenty card.",
  }),
  monopoly: msg({ id: "dev.notHeld.monopoly", message: "You don't hold a Monopoly card." }),
};

export function devNotHeld(card: string): string {
  const m = DEV_NOT_HELD[card];
  return m ? say(m) : say(msg({ id: "dev.notHeld", message: "You don't hold that card." }));
}
