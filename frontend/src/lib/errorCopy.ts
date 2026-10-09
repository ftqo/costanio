/**
 * The words for every refusal the backend can send.
 *
 * The backend never sends prose for us to render. It sends a stable
 * SCREAMING_SNAKE code plus named, typed parameters, and this file turns them
 * into a sentence (see docs/user-facing-text.md). Parameters are named
 * ("2 more brick" as `{needed: 2, resource: "brick"}`) because word order
 * varies across languages.
 *
 * This is the i18n layer for refusals: every entry is a message descriptor
 * with an explicit `error.<CODE>` id, resolved at render time.
 *
 * Explicit ids rather than the English source text (used elsewhere):
 *
 *  - Distinct codes can share English. OCCUPIED and VERTEX_TAKEN both read
 *    "That spot is already taken." but are different refusals; keyed by their
 *    English they would merge into one catalogue entry.
 *  - The code is the semantic key, so translators need no reconstructed
 *    context.
 *
 * Adding a code: engine/ruletest asserts every registered code has an entry
 * here, so a missing one fails the backend build. Keep entries at two-space
 * indentation, which that check parses.
 *
 * House style: no em dashes in anything a player reads.
 */

import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { formatList } from "./intl";
import { selectionConflicts } from "./expansionCompat";

/** Named parameters carried by an error frame. */
export type ErrorParams = Record<string, unknown>;

/**
 * Either fixed copy or a function of the refusal's parameters. Descriptors, not
 * strings, so this module constant follows the current language via
 * `i18n._(descriptor)`.
 */
type Copy = MessageDescriptor | ((p: ErrorParams) => string);

/**
 * Render a descriptor in the active language. Values are always passed by
 * name, so each language places them itself.
 */
function say(d: MessageDescriptor, values?: Record<string, unknown>): string {
  return i18n._(values ? { ...d, values: { ...d.values, ...values } } : d);
}

/**
 * "You have no roads left.", written out per piece.
 *
 * Not a `{piece}` slot in one frame: the noun is the subject, so it governs
 * the verb's number in Spanish ("No te queda ninguna carretera"), takes a case
 * in German, Russian and Polish, and needs a gendered quantifier in several.
 * One message per piece, as lib/cardPhrases does for cards.
 */
const NO_PIECES_LEFT: Record<string, MessageDescriptor> = {
  road: msg({ id: "error.NO_PIECES.road", message: "You have no roads left." }),
  settlement: msg({ id: "error.NO_PIECES.settlement", message: "You have no settlements left." }),
  city: msg({ id: "error.NO_PIECES.city", message: "You have no cities left." }),
  ship: msg({ id: "error.NO_PIECES.ship", message: "You have no ships left." }),
  knight: msg({ id: "error.NO_PIECES.knight", message: "You have no knights left." }),
};

/**
 * "2 brick", with room for a measure word.
 *
 * Count and resource as one message: Chinese needs a measure word between
 * them, and languages with plural categories need agreement. `#` is the count.
 * The plural arm is written even though English does not inflect these
 * (2 brick), for the locales that do.
 */
const RESOURCE_COUNT: Record<string, (n: number) => MessageDescriptor> = {
  wood: (n) =>
    msg({ id: "resource.count.wood", message: plural(n, { one: "# wood", other: "# wood" }) }),
  brick: (n) =>
    msg({ id: "resource.count.brick", message: plural(n, { one: "# brick", other: "# brick" }) }),
  sheep: (n) =>
    msg({ id: "resource.count.sheep", message: plural(n, { one: "# sheep", other: "# sheep" }) }),
  wheat: (n) =>
    msg({ id: "resource.count.wheat", message: plural(n, { one: "# wheat", other: "# wheat" }) }),
  ore: (n) =>
    msg({ id: "resource.count.ore", message: plural(n, { one: "# ore", other: "# ore" }) }),
  gold: (n) =>
    msg({ id: "resource.count.gold", message: plural(n, { one: "# gold", other: "# gold" }) }),
};

/**
 * "2 brick", "2 brick and 1 ore", in the locale's own list grammar.
 *
 * Exported because lib/reachability needs the same phrasing before a command
 * (why a build tile is dark) as this file uses after a refusal.
 *
 * Keyed by resource name, the shape the error params use; `RES_NAME` in
 * lib/reachability maps from a `COST` table's indices.
 */
export function resourceShortfall(missing: Record<string, number> | undefined): string {
  if (!missing) return "";
  const parts = Object.entries(missing)
    .filter(([, n]) => n > 0)
    .map(([res, n]) => {
      const m = RESOURCE_COUNT[res];
      return m ? say(m(n)) : `${n} ${res}`;
    });
  return formatList(parts);
}

function shortfall(p: ErrorParams): string {
  return resourceShortfall(p.missing as Record<string, number> | undefined);
}

/** Code to copy. Every entry is ours; nothing here came off the wire. */
export const ERROR_COPY: Record<string, Copy> = {
  // ---- turn and phase ----
  NOT_YOUR_TURN: msg({ id: "error.NOT_YOUR_TURN", message: "It's not your turn." }),
  WRONG_PHASE: msg({ id: "error.WRONG_PHASE", message: "You can't do that right now." }),
  MUST_ROLL: msg({ id: "error.MUST_ROLL", message: "Roll the dice first." }),
  ALREADY_ROLLED: msg({ id: "error.ALREADY_ROLLED", message: "You've already rolled this turn." }),
  ROBBER_PENDING: msg({ id: "error.ROBBER_PENDING", message: "Move the robber first." }),
  DISCARD_PENDING: msg({ id: "error.DISCARD_PENDING", message: "Waiting for players to discard." }),
  MODULE_PENDING: msg({
    id: "error.MODULE_PENDING",
    message: "Resolve your pending choice first.",
  }),
  GAME_FINISHED: msg({ id: "error.GAME_FINISHED", message: "This game is already over." }),
  UNKNOWN_COMMAND: msg({ id: "error.UNKNOWN_COMMAND", message: "That action isn't allowed." }),
  BAD_COMMAND: msg({ id: "error.BAD_COMMAND", message: "That action isn't allowed." }),
  PAUSED: msg({
    id: "error.PAUSED",
    message: "This game is paused because of a server error. Nothing you did caused it.",
  }),
  // The server could not write the move (the store failed), so it never
  // happened. The player broke no rule.
  STORAGE_ERROR: msg({
    id: "error.STORAGE_ERROR",
    message: "The server couldn't save that move, so nothing changed. Try again.",
  }),
  SEAT_BOT_CONTROLLED: msg({
    id: "error.SEAT_BOT_CONTROLLED",
    message: "A bot is playing your seat. Rejoin it before you make a move.",
  }),
  GAME_STOPPED: msg({
    id: "error.GAME_STOPPED",
    message: "This game is no longer running. Reload the page to continue.",
  }),
  RANKED_NO_RESET: msg({
    id: "error.RANKED_NO_RESET",
    message: "A ranked game can't be reset to the lobby.",
  }),

  // ---- building ----
  BAD_PLACEMENT: msg({ id: "error.BAD_PLACEMENT", message: "You can't build there." }),
  TOO_CLOSE: msg({ id: "error.TOO_CLOSE", message: "That's too close to another settlement." }),
  OCCUPIED: msg({ id: "error.OCCUPIED", message: "That spot is already taken." }),
  NO_PIECES: (p) => {
    const piece = NO_PIECES_LEFT[String(p.piece)];
    return piece
      ? say(piece)
      : say(msg({ id: "error.NO_PIECES", message: "You have no pieces left to build." }));
  },
  NO_RESOURCES: (p) => {
    const need = shortfall(p);
    // A colon rather than "You need {missing}.": a runtime noun phrase as a
    // verb's object takes case in German, Russian and Polish and affects verb
    // number in Spanish. After a colon the list is grammatically inert.
    return need
      ? say(msg({ id: "error.NO_RESOURCES.missing", message: "You are short of: {missing}" }), {
          missing: need,
        })
      : say(msg({ id: "error.NO_RESOURCES", message: "You don't have the resources for that." }));
  },

  // ---- the robber and discarding ----
  NO_DISCARD_NEEDED: msg({ id: "error.NO_DISCARD_NEEDED", message: "You don't need to discard." }),
  BAD_DISCARD: (p) =>
    typeof p.needed === "number"
      ? say(
          msg({
            id: "error.BAD_DISCARD.count",
            message: plural(p.needed, {
              one: "Discard exactly # card.",
              other: "Discard exactly # cards.",
            }),
          }),
        )
      : say(
          msg({
            id: "error.BAD_DISCARD",
            message: "That discard doesn't match what's required.",
          }),
        ),
  BAD_VICTIM: msg({ id: "error.BAD_VICTIM", message: "You can't steal from that player." }),

  // ---- trading ----
  NO_OFFER: msg({ id: "error.NO_OFFER", message: "There's no open trade offer." }),
  SAME_RESOURCE: msg({
    id: "error.SAME_RESOURCE",
    message: "You can't trade a resource for the same resource.",
  }),
  BAD_TRADE: msg({
    id: "error.BAD_TRADE",
    message: "Those cards don't pay for what you asked for.",
  }),
  ALREADY_RESPONDED: msg({
    id: "error.ALREADY_RESPONDED",
    message: "You've already answered this offer.",
  }),
  NO_RESPONSE: msg({
    id: "error.NO_RESPONSE",
    message: "You haven't answered this offer yet.",
  }),

  // ---- development cards ----
  DECK_EMPTY: msg({ id: "error.DECK_EMPTY", message: "The development card deck is empty." }),
  DEV_ALREADY_PLAYED: msg({
    id: "error.DEV_ALREADY_PLAYED",
    message: "You've already played a development card this turn.",
  }),
  NO_SUCH_CARD: msg({ id: "error.NO_SUCH_CARD", message: "You don't hold that card." }),

  // ---- conceding, draws, claims ----
  NOT_A_DUEL: msg({
    id: "error.NOT_A_DUEL",
    message: "You can only surrender in a two-player game.",
  }),
  DRAW_TOO_EARLY: msg({
    id: "error.DRAW_TOO_EARLY",
    message: "The game isn't long enough yet to offer a draw.",
  }),
  DRAW_PENDING: msg({ id: "error.DRAW_PENDING", message: "There's already an open draw offer." }),
  NO_DRAW_OFFER: msg({
    id: "error.NO_DRAW_OFFER",
    message: "There's no draw offer for you to answer.",
  }),
  DRAW_OFFER_USED: msg({
    id: "error.DRAW_OFFER_USED",
    message: "You've already offered a draw this turn.",
  }),
  SURRENDER_TOO_EARLY: msg({
    id: "error.SURRENDER_TOO_EARLY",
    message: "It's too early to surrender. The host can reset the game to the lobby instead.",
  }),
  CLAIM_NEEDS_BOTS: msg({
    id: "error.CLAIM_NEEDS_BOTS",
    message: "You can only end the game this way when every other seat is a bot.",
  }),

  // ---- Islands ----
  // "A coastal edge counts" is the important half. A sea edge is any edge with
  // water on one side, so the refusal players actually hit is two land hexes;
  // "ships can only go on water" would wrongly suggest coast is excluded. The
  // Explorers twin below uses the same wording.
  NOT_SEA_EDGE: msg({
    id: "error.NOT_SEA_EDGE",
    message: "Ships go on water. A coastal edge counts; two land hexes don't.",
  }),
  PIRATE_BLOCKS: msg({ id: "error.PIRATE_BLOCKS", message: "The pirate blocks that water." }),
  SHIP_NOT_OPEN: msg({
    id: "error.SHIP_NOT_OPEN",
    message: "Only a ship at an open end can move.",
  }),
  SHIP_JUST_BUILT: msg({
    id: "error.SHIP_JUST_BUILT",
    message: "A ship can't move the turn it was built.",
  }),
  SHIP_ALREADY_MOVED: msg({
    id: "error.SHIP_ALREADY_MOVED",
    message: "You can only move one ship per turn.",
  }),
  NO_GOLD_OWED: msg({ id: "error.NO_GOLD_OWED", message: "You have no gold to collect." }),
  BAD_GOLD_PICK: msg({
    id: "error.BAD_GOLD_PICK",
    message: "That doesn't match the gold you're owed.",
  }),

  // ---- Knights ----
  ALCHEMIST_DICE: msg({ id: "error.ALCHEMIST_DICE", message: "Each die must be between 1 and 6." }),
  NOT_BEFORE_ROLL: msg({
    id: "error.NOT_BEFORE_ROLL",
    message: "That card has to be played before you roll.",
  }),
  MERCHANT_TERRAIN: msg({
    id: "error.MERCHANT_TERRAIN",
    message: "The merchant needs a hex that produces a resource.",
  }),
  NO_OPEN_ROAD: msg({ id: "error.NO_OPEN_ROAD", message: "That road isn't an open end." }),
  // A progress card whose play would do nothing visible
  // (engine/knights/progress_play.go, ErrCardNoEffect). The card is not spent.
  CARD_NO_EFFECT: msg({
    id: "error.CARD_NO_EFFECT",
    message: "That card would do nothing right now, so it stays in your hand.",
  }),
  NEED_CITY: msg({ id: "error.NEED_CITY", message: "That needs a city." }),
  // Per knight, not per player: the cap is `Knight.PromotedThisTurn`
  // (`knights/decide.go`), so two different knights may both be promoted in one
  // turn (see knights.md).
  ALREADY_PROMOTED: msg({
    id: "error.ALREADY_PROMOTED",
    message: "That knight has already been promoted this turn.",
  }),
  MAX_IMPROVEMENT: msg({
    id: "error.MAX_IMPROVEMENT",
    message: "That improvement is already at its maximum.",
  }),
  NO_FREE_CITY: msg({
    id: "error.NO_FREE_CITY",
    message: "You need a city without a metropolis for that.",
  }),
  NO_COMMODITIES: msg({
    id: "error.NO_COMMODITIES",
    message: "You don't have enough commodities for that.",
  }),
  COMMODITY_SUPPLY_EMPTY: msg({
    id: "error.COMMODITY_SUPPLY_EMPTY",
    message: "The supply has run out of that commodity.",
  }),
  VERTEX_TAKEN: msg({ id: "error.VERTEX_TAKEN", message: "That spot is already taken." }),
  NO_KNIGHT: msg({ id: "error.NO_KNIGHT", message: "You don't have a knight there." }),
  KNIGHT_STATE: msg({ id: "error.KNIGHT_STATE", message: "That knight can't do that right now." }),
  MAX_WALLS: msg({ id: "error.MAX_WALLS", message: "You've reached the city wall limit." }),
  NO_PROGRESS_CARD: msg({
    id: "error.NO_PROGRESS_CARD",
    message: "You don't hold that progress card.",
  }),
  NOT_OWED: msg({ id: "error.NOT_OWED", message: "You don't owe anything." }),
  BAD_GIVE: msg({ id: "error.BAD_GIVE", message: "That doesn't match what you owe." }),
  HAND_NOT_OVER: msg({
    id: "error.HAND_NOT_OVER",
    message: "You aren't holding more progress cards than the limit allows.",
  }),
  // The code keeps the retired tier name `mighty` (renaming it would change the
  // wire on both sides). The copy uses strength ("Strength 2 of 3" on the
  // board), and Politics is capitalised as the track's name.
  MIGHTY_NEEDS_FORT: msg({
    id: "error.MIGHTY_NEEDS_FORT",
    message: "Strength 3 knights need Politics level 3, the Fortress.",
  }),
  NOT_SACRIFICABLE: msg({
    id: "error.NOT_SACRIFICABLE",
    message: "The barbarians can only raze a city of yours.",
  }),
  KNIGHT_IN_THE_FOG: msg({
    id: "error.KNIGHT_IN_THE_FOG",
    message: "A knight won't stand next to an unexplored hex.",
  }),

  // ---- Fishermen and Caravans ----
  // These would otherwise fall through to core sentences naming the wrong
  // rule: nothing is stolen when the boot moves, nothing is built when the
  // robber is driven, fish are not resources, and a bidding round is not
  // somebody else's turn.
  BOOT_RECIPIENT: msg({
    id: "error.BOOT_RECIPIENT",
    message: "The boot only goes to a player doing at least as well as you.",
  }),
  NO_FISH: msg({
    id: "error.NO_FISH",
    message: "You don't hold enough fish for that. You spend whole tiles and can't make change.",
  }),
  // Not "sealed": bidding is open and sequential (scenarios.md), every bid
  // face up as it lands. The engine's wording (`scenarios/usererr.go`) is "a bid
  // can't be changed".
  ALREADY_BID: msg({
    id: "error.ALREADY_BID",
    message: "You have already answered this vote. A bid can't be changed.",
  }),
  SPEND_UNAVAILABLE: msg({
    id: "error.SPEND_UNAVAILABLE",
    message: "This game's rules have taken that fish spend off the table.",
  }),

  // ---- Explorers ----
  // Refusals that involve no building. "You can't build there" is wrong for a
  // ship out of movement points, a full hold, or a crew landed on an unexplored
  // hex.
  BUILDING_OVER: msg({
    id: "error.BUILDING_OVER",
    message: "You can't build or trade any more this turn. The Movement phase is a one way door.",
  }),
  SHIP_NEEDS_WATER: msg({
    id: "error.SHIP_NEEDS_WATER",
    message: "Ships go on water. A coastal edge counts; two land hexes don't.",
  }),
  INTO_THE_FOG: msg({
    id: "error.INTO_THE_FOG",
    message: "You can't build a ship where it would be looking straight into the fog.",
  }),
  NO_SHIPYARD: msg({
    id: "error.NO_SHIPYARD",
    message:
      "Ships are built beside one of your harbour settlements. A plain coastal settlement isn't a shipyard.",
  }),
  NOT_COASTAL: msg({
    id: "error.NOT_COASTAL",
    message: "A harbour settlement needs open water beside it.",
  }),
  UPGRADE_IS_FINAL: msg({
    id: "error.UPGRADE_IS_FINAL",
    message:
      "That building has already been upgraded. A city and a harbour settlement can't be swapped for each other.",
  }),
  HOLD_FULL: msg({
    id: "error.HOLD_FULL",
    message: "There's no room for that. A hold takes one large piece or two small ones.",
  }),
  ROOM_REMAINS: msg({
    id: "error.ROOM_REMAINS",
    message: "You can only throw something overboard once you have nowhere left to put it.",
  }),
  NOT_AT_HARBOUR: msg({
    id: "error.NOT_AT_HARBOUR",
    message: "That ship isn't at one of your harbour settlements.",
  }),
  NOT_MOVEMENT: msg({
    id: "error.NOT_MOVEMENT",
    message: "You haven't started your Movement phase yet.",
  }),
  SHIP_NO_MOVEMENT: msg({
    id: "error.SHIP_NO_MOVEMENT",
    message: "That ship has finished moving for this turn.",
  }),
  STOPS_AT_THE_FOG: msg({
    id: "error.STOPS_AT_THE_FOG",
    message: "A ship stops as soon as it finds something, so the route can't carry on past it.",
  }),
  ALREADY_SPED: msg({
    id: "error.ALREADY_SPED",
    message: "That ship has already bought extra movement this turn.",
  }),
  NO_TRIBUTE: msg({
    id: "error.NO_TRIBUTE",
    message:
      "You don't have the gold to pass the pirate ship, so those edges are closed to you this turn.",
  }),
  PIRATE_PENDING: msg({
    id: "error.PIRATE_PENDING",
    message: "You must place your pirate ship first.",
  }),
  PIRATE_MUST_MOVE: msg({
    id: "error.PIRATE_MUST_MOVE",
    message: "Your own pirate ship has to move somewhere new.",
  }),
  NO_CHASE: msg({
    id: "error.NO_CHASE",
    message:
      "None of your ships is ready to chase the pirate. A ship that has moved this turn can't fight.",
  }),
  OUT_OF_REACH: msg({
    id: "error.OUT_OF_REACH",
    message: "That ship isn't touching the hex or intersection you chose.",
  }),
  NO_CREW: msg({
    id: "error.NO_CREW",
    message: "You have no crew there.",
  }),
  NO_SETTLER: msg({
    id: "error.NO_SETTLER",
    message: "That ship isn't carrying a settler.",
  }),
  LAIR_CAPTURED: msg({
    id: "error.LAIR_CAPTURED",
    message: "That pirate lair has already been stormed.",
  }),
  FARM_BEFRIENDED: msg({
    id: "error.FARM_BEFRIENDED",
    message:
      "You've already befriended that spice village. It's one crew and one sack per player, for the whole game.",
  }),
  // "Fish haul", as the rules chapter, event log and spec all say.
  NO_HAUL: msg({
    id: "error.NO_HAUL",
    message: "There's no fish haul on that shoal.",
  }),
  ALREADY_FISHED: msg({
    id: "error.ALREADY_FISHED",
    message: "You've already fished this turn.",
  }),
  NOT_AT_COUNCIL: msg({
    id: "error.NOT_AT_COUNCIL",
    message: "That ship isn't docked at the Council. Deliveries are made at either anchor.",
  }),
  NOTHING_TO_DELIVER: msg({
    id: "error.NOTHING_TO_DELIVER",
    message: "That ship has nothing the Council wants.",
  }),
  SHIP_NO_GOLD: msg({
    id: "error.SHIP_NO_GOLD",
    message: "You don't have enough gold for that.",
  }),
  GOLD_SPENT: msg({
    id: "error.GOLD_SPENT",
    message: "You've used that up for this turn.",
  }),
  NO_FAST_GOLD: msg({
    id: "error.NO_FAST_GOLD",
    message: "You need a Fast Gold village to sell a resource for gold.",
  }),

  // ---- Wagons ----
  // These would otherwise land on core sentences. Movement points and gold are
  // not resources ("you don't have the resources for that" suggests a trade
  // that cannot help), and an unpayable toll is part of the scenario, not an
  // illegal move.
  NO_WAGON: msg({
    id: "error.NO_WAGON",
    message: "Your wagon isn't on the board.",
  }),
  MOVEMENT_OVER: msg({
    id: "error.MOVEMENT_OVER",
    message: "Your wagon has finished moving for this turn.",
  }),
  NO_MOVEMENT: msg({
    id: "error.NO_MOVEMENT",
    message: "That path costs more movement than your wagon has left.",
  }),
  WAGON_NO_GOLD: msg({
    id: "error.WAGON_NO_GOLD",
    message: "You don't have the gold for that.",
  }),
  WAGON_LEVEL: msg({
    id: "error.WAGON_LEVEL",
    message: "Your wagon isn't upgraded enough to do that.",
  }),
  ALREADY_CHARGED: msg({
    id: "error.ALREADY_CHARGED",
    message: "You have already tried to drive that barbarian off this turn.",
  }),
  MAX_LEVEL: msg({
    id: "error.MAX_LEVEL",
    message: "Your wagon is already at the top of its track.",
  }),
  GOLD_LIMIT: msg({
    id: "error.GOLD_LIMIT",
    message: "You have already bought from the bank with gold twice this turn.",
  }),
  NO_SWIFT: msg({
    id: "error.NO_SWIFT",
    message: "You don't hold a Swift Journey you can play.",
  }),
  NO_JOURNEY: msg({
    id: "error.NO_JOURNEY",
    message: "A Swift Journey is a second trip, so finish the first one.",
  }),
  BARBARIAN_SPOT: msg({
    id: "error.BARBARIAN_SPOT",
    message: "A barbarian can't stand there.",
  }),
  NO_BARBARIAN: msg({
    id: "error.NO_BARBARIAN",
    message: "You have no barbarian to move right now.",
  }),

  // ---- transport: the socket ----
  // Frames a correct client never sends; a player seeing one has hit a bug or
  // a stale tab, so the copy says something went wrong.
  BAD_FRAME_JSON: msg({
    id: "error.BAD_FRAME_JSON",
    message: "Something went wrong talking to the server.",
  }),
  BAD_FRAME_TYPE: msg({
    id: "error.BAD_FRAME_TYPE",
    message: "Something went wrong talking to the server.",
  }),
  BAD_FRAME_MISSING_CMD: msg({
    id: "error.BAD_FRAME_MISSING_CMD",
    message: "Something went wrong talking to the server.",
  }),
  BAD_FRAME_MISSING_CHAT_ID: msg({
    id: "error.BAD_FRAME_MISSING_CHAT_ID",
    message: "Something went wrong filing that report.",
  }),
  BAD_CHAT_SCOPE: msg({
    id: "error.BAD_CHAT_SCOPE",
    message: "Something went wrong sending that message.",
  }),
  BODY_READ_FAILED: msg({
    id: "error.BODY_READ_FAILED",
    message: "Something went wrong. Try again in a moment.",
  }),
  MALFORMED_INTERACTION: msg({
    id: "error.MALFORMED_INTERACTION",
    message: "Something went wrong. Try again in a moment.",
  }),

  FRAME_RATE_LIMITED: msg({ id: "error.FRAME_RATE_LIMITED", message: "Slow down." }),
  WS_CONNECTION_RATE_LIMITED: msg({
    id: "error.WS_CONNECTION_RATE_LIMITED",
    message: "Too many connection attempts. Wait a moment.",
  }),
  SERVER_SHUTTING_DOWN: msg({
    id: "error.SERVER_SHUTTING_DOWN",
    message: "The server is restarting. Reconnecting in a moment.",
  }),
  AUTH_REQUIRED: msg({ id: "error.AUTH_REQUIRED", message: "Please sign in again." }),
  INVALID_SESSION: msg({
    id: "error.INVALID_SESSION",
    message: "Your session expired. Please sign in again.",
  }),
  UNAUTHENTICATED: msg({ id: "error.UNAUTHENTICATED", message: "Please sign in." }),
  // A game command before subscribing, which a player only hits in the gap
  // after a reconnect.
  NOT_SUBSCRIBED: msg({
    id: "error.NOT_SUBSCRIBED",
    message: "This table isn't connected yet. Try again in a moment.",
  }),
  // Client-side, not the server's: raised when a command cannot go out because
  // the socket is down, so a move made during a blip is not silently lost. See
  // lib/link.
  LINK_DOWN: msg({
    id: "error.LINK_DOWN",
    // Not "you're offline": the usual cause is a backend deploy or hang-up,
    // with the player's own connection fine.
    message: "The connection dropped, so that move wasn't sent. Try again in a moment.",
  }),
  // Not "Try reloading": a reload cannot fix a 403, and the one
  // connection-shaped source (a rejected WS origin) is retried by the socket.
  FORBIDDEN: msg({
    id: "error.FORBIDDEN",
    message: "Something went wrong connecting.",
  }),

  // ---- tables and seats ----
  GAME_NOT_FOUND: msg({ id: "error.GAME_NOT_FOUND", message: "That table no longer exists." }),
  PRIVATE_GAME: msg({ id: "error.PRIVATE_GAME", message: "That table is private." }),
  LOGIN_REQUIRED_TO_VIEW: msg({
    id: "error.LOGIN_REQUIRED_TO_VIEW",
    message: "Sign in to view this table.",
  }),
  GUEST_NEEDS_INVITE: msg({
    id: "error.GUEST_NEEDS_INVITE",
    message: "Guests can only watch a table through an invite link.",
  }),
  GUEST_NEEDS_LINK: msg({
    id: "error.GUEST_NEEDS_LINK",
    message: "Guests can only join through an invite link.",
  }),
  SPECTATORS_FULL: msg({
    id: "error.SPECTATORS_FULL",
    message: "This table has reached its spectator limit.",
  }),
  SPECTATOR_CANNOT_ACT: msg({
    id: "error.SPECTATOR_CANNOT_ACT",
    message: "You're watching this table, not playing in it.",
  }),
  NOT_IN_THAT_GAME: msg({ id: "error.NOT_IN_THAT_GAME", message: "You're not at that table." }),
  GAME_FULL: msg({ id: "error.GAME_FULL", message: "This table is full." }),
  ALREADY_SEATED: msg({
    id: "error.ALREADY_SEATED",
    message: "You're already seated at this table.",
  }),
  NOT_SEATED: msg({ id: "error.NOT_SEATED", message: "You're not seated at this table." }),
  NOT_IN_LOBBY: msg({
    id: "error.NOT_IN_LOBBY",
    message: "This table is no longer open for changes.",
  }),
  NOT_ACTIVE: msg({ id: "error.NOT_ACTIVE", message: "This game isn't in progress." }),
  // Sent when "return to your seat" is asked for a seat not in the
  // voluntary-leave state.
  NOT_SPECTATING: msg({
    id: "error.NOT_SPECTATING",
    message:
      "You can only take a seat back after leaving it with Leave & Spectate. If you're still seated, reload the table and keep playing.",
  }),
  CANT_KICK_HOST: msg({ id: "error.CANT_KICK_HOST", message: "The host can't be removed." }),
  NOT_HOST: msg({ id: "error.NOT_HOST", message: "Only the host can do that." }),
  BAD_HOST_TARGET: msg({ id: "error.BAD_HOST_TARGET", message: "That player can't be made host." }),
  NOT_ENOUGH_PLAYERS: msg({
    id: "error.NOT_ENOUGH_PLAYERS",
    message: "You need at least 2 players to start.",
  }),
  COLOR_TAKEN: msg({
    id: "error.COLOR_TAKEN",
    message: "That color is too close to another player's.",
  }),
  COLOR_LOCKED: msg({ id: "error.COLOR_LOCKED", message: "You don't have that color." }),
  BAD_COLOR: msg({ id: "error.BAD_COLOR", message: "That color doesn't exist." }),
  BAD_ITEM: msg({ id: "error.BAD_ITEM", message: "That decoration doesn't exist." }),
  BAD_SEAT: msg({ id: "error.BAD_SEAT", message: "That seat doesn't exist." }),
  BAD_CONFIG: msg({ id: "error.BAD_CONFIG", message: "That game setup isn't valid." }),
  // Islands on a map with no open water (engine MapIssueError,
  // module_needs_terrain islands/sea). The lobby steers the Islands switch
  // through the map picker first, so this is for a preset, a pasted config, or
  // an old client.
  ISLANDS_NEEDS_SEA: msg({
    id: "error.ISLANDS_NEEDS_SEA",
    message: "Islands needs a map with open sea. Choose an Islands map, or turn Islands off.",
  }),
  // Harbormaster on an authored map carrying fewer harbours than its card
  // needs (engine MapIssueError, module_needs_harbours): the card could never
  // be won while the target still rose by 1. The lobby says so inline too
  // (lib/format harbormasterMapWarning).
  HARBORMASTER_NEEDS_HARBOURS: (p) =>
    typeof p.min === "number"
      ? say(
          msg({
            id: "error.HARBORMASTER_NEEDS_HARBOURS.min",
            message: plural(p.min, {
              one: "Harbormaster needs a map with at least # harbour. Pick another map, or turn Harbormaster off.",
              other:
                "Harbormaster needs a map with at least # harbours. Pick another map, or turn Harbormaster off.",
            }),
          }),
        )
      : say(
          msg({
            id: "error.HARBORMASTER_NEEDS_HARBOURS",
            message:
              "Harbormaster needs a map with more harbours. Pick another map, or turn Harbormaster off.",
          }),
        ),
  // The map cannot seat the table (board.ValidateSeats). The lobby's slider
  // checks this itself before sending (lib/format playersChange), so this is
  // for everything else that can send a count: an old client, a pasted config.
  MAP_TOO_SMALL: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.MAP_TOO_SMALL.max",
            message: plural(p.max, {
              one: "This map seats up to # player. Pick a larger map to seat more.",
              other: "This map seats up to # players. Pick a larger map to seat more.",
            }),
          }),
        )
      : say(
          msg({
            id: "error.MAP_TOO_SMALL",
            message: "This map can't seat that many players. Pick a larger map.",
          }),
        ),
  // Two expansions that can't share a board. The backend sends the pair
  // (`{modules: ["explorers", "islands"]}`), not the reason; the reason comes
  // from expansionCompat.ts, which the lobby also uses to grey the switch out.
  // This covers an old client or a pasted config.
  RULESET_CONFLICT: (p) => {
    const mods = Array.isArray(p.modules) ? p.modules.map(String) : [];
    const reason = selectionConflicts(mods)[0]?.reason ?? null;
    return say(
      reason ??
        msg({
          id: "error.RULESET_CONFLICT",
          message: "Those expansions can't be combined. Turn one of them off.",
        }),
    );
  },
  BAD_INVITE: msg({ id: "error.BAD_INVITE", message: "That invite code isn't valid." }),
  BOT_GAME_SUPPORTER_ONLY: msg({
    id: "error.BOT_GAME_SUPPORTER_ONLY",
    message: "Starting a game against only bots is a supporter perk.",
  }),
  GAME_CREATE_RATE_LIMITED: msg({
    id: "error.GAME_CREATE_RATE_LIMITED",
    message: "You've created a lot of tables. Wait a moment.",
  }),
  GAME_NOT_FINISHED: msg({ id: "error.GAME_NOT_FINISHED", message: "This game isn't over yet." }),
  REPLAY_NOT_READY: msg({
    id: "error.REPLAY_NOT_READY",
    message: "The replay is available once the game is over.",
  }),
  // Three replay refusals because the player's next step differs for each.
  REPLAY_FILE_INVALID: msg({
    id: "error.REPLAY_FILE_INVALID",
    message: "That file isn't a replay.",
  }),
  // Unlike the above, this file is a replay but the game could not be played
  // back: a truncated download, a hand-edited log, or a much older version.
  REPLAY_NOT_FOLDABLE: msg({
    id: "error.REPLAY_NOT_FOLDABLE",
    message: "That replay can't be played back. The game in it is incomplete.",
  }),
  REPLAY_FILE_TOO_LONG: msg({
    id: "error.REPLAY_FILE_TOO_LONG",
    message: "That replay is too long to open.",
  }),
  REPLAY_FOLD_FAILED: msg({
    id: "error.REPLAY_FOLD_FAILED",
    message: "Couldn't rebuild that game. It has been logged.",
  }),
  REMATCH_FAILED: msg({ id: "error.REMATCH_FAILED", message: "Couldn't start the rematch." }),
  LOG_RATE_LIMITED: msg({
    id: "error.LOG_RATE_LIMITED",
    message: "Loading a lot of history. Try again shortly.",
  }),

  // ---- chat and reports ----
  CHAT_LENGTH: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.CHAT_LENGTH.max",
            message: plural(p.max, {
              one: "Messages can be up to # character.",
              other: "Messages can be up to # characters.",
            }),
          }),
        )
      : say(msg({ id: "error.CHAT_LENGTH", message: "That message is too long." })),
  CHAT_RATE_LIMITED: msg({ id: "error.CHAT_RATE_LIMITED", message: "One message per second." }),
  CHAT_LINK_REQUIRED: msg({
    id: "error.CHAT_LINK_REQUIRED",
    message: "Link your Discord account to chat.",
  }),
  CHAT_BANNED: msg({ id: "error.CHAT_BANNED", message: "Your chat privileges have been revoked." }),
  // Not CHAT_BANNED's sentence: a filter hit is held for human review, nothing
  // is revoked, and false positives are ordinary English ("nip it in the bud",
  // "spic and span").
  CHAT_FILTERED: msg({
    id: "error.CHAT_FILTERED",
    message: "That message was not sent. It has been flagged for review.",
  }),
  CHAT_NOT_FOUND: msg({ id: "error.CHAT_NOT_FOUND", message: "That message is gone." }),
  REPORT_LINK_REQUIRED: msg({
    id: "error.REPORT_LINK_REQUIRED",
    message: "Link your Discord account to report messages.",
  }),
  REPORT_SELF: msg({ id: "error.REPORT_SELF", message: "You can't report your own message." }),
  REPORT_REVOKED: msg({
    id: "error.REPORT_REVOKED",
    message: "Your reporting privileges are temporarily suspended.",
  }),
  REPORT_RATE_LIMITED: msg({ id: "error.REPORT_RATE_LIMITED", message: "One report at a time." }),

  // ---- feedback form ----
  FEEDBACK_REQUIRED: msg({ id: "error.FEEDBACK_REQUIRED", message: "Write something first." }),
  FEEDBACK_TOO_LONG: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.FEEDBACK_TOO_LONG.max",
            message: plural(p.max, {
              one: "That's too long. The limit is # character.",
              other: "That's too long. The limit is # characters.",
            }),
          }),
        )
      : say(msg({ id: "error.FEEDBACK_TOO_LONG", message: "That's too long." })),
  FEEDBACK_RATE_LIMITED: msg({
    id: "error.FEEDBACK_RATE_LIMITED",
    message: "You've sent a lot of feedback. Wait a minute and try again.",
  }),

  // ---- account, profile, auth ----
  NAME_REQUIRED: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.NAME_REQUIRED.max",
            message: plural(p.max, {
              one: "Pick a name, up to # character.",
              other: "Pick a name, up to # characters.",
            }),
          }),
        )
      : say(msg({ id: "error.NAME_REQUIRED", message: "Pick a name." })),
  NAME_TOO_LONG: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.NAME_TOO_LONG.max",
            message: plural(p.max, {
              one: "That name is too long. The limit is # character.",
              other: "That name is too long. The limit is # characters.",
            }),
          }),
        )
      : say(msg({ id: "error.NAME_TOO_LONG", message: "That name is too long." })),
  NAME_RESERVED: msg({ id: "error.NAME_RESERVED", message: "That name is reserved." }),
  NAME_LOCKED: msg({
    id: "error.NAME_LOCKED",
    message: "Your name is locked. Contact a moderator.",
  }),
  // Two failures a player can act on differently: a malformed id means a broken
  // link or paste; a missing user means the account is gone.
  BAD_USER_ID: msg({ id: "error.BAD_USER_ID", message: "That isn't a valid player id." }),
  USER_NOT_FOUND: msg({ id: "error.USER_NOT_FOUND", message: "That player doesn't exist." }),
  GUEST_NO_SETTINGS: msg({
    id: "error.GUEST_NO_SETTINGS",
    message: "Guests have no settings to save.",
  }),
  LAST_IDENTITY: msg({
    id: "error.LAST_IDENTITY",
    message: "You can't unlink your only way to sign in.",
  }),
  NOT_LINKED: msg({ id: "error.NOT_LINKED", message: "That account isn't linked." }),
  ALREADY_AUTHED: msg({ id: "error.ALREADY_AUTHED", message: "You're already signed in." }),
  MERGE_TOKEN_INVALID: msg({
    id: "error.MERGE_TOKEN_INVALID",
    message: "That merge request is invalid or expired.",
  }),
  MERGE_GONE: msg({
    id: "error.MERGE_GONE",
    message: "That account is no longer available to merge.",
  }),
  MERGE_BLOCKED_SHARED_GAME: msg({
    id: "error.MERGE_BLOCKED_SHARED_GAME",
    message: "These accounts have played together, so they can't be merged.",
  }),
  OAUTH_FAILED: msg({ id: "error.OAUTH_FAILED", message: "Discord sign-in failed. Try again." }),
  OAUTH_STATE_INVALID: msg({
    id: "error.OAUTH_STATE_INVALID",
    message: "Sign-in expired. Start again.",
  }),
  OAUTH_CODE_MISSING: msg({
    id: "error.OAUTH_CODE_MISSING",
    message: "Sign-in didn't complete. Try again.",
  }),
  OAUTH_CODE_REQUIRED: msg({
    id: "error.OAUTH_CODE_REQUIRED",
    message: "Sign-in didn't complete. Try again.",
  }),
  OAUTH_EXCHANGE_FAILED: msg({
    id: "error.OAUTH_EXCHANGE_FAILED",
    message: "Discord sign-in failed. Try again.",
  }),
  ROLE_REFRESH_RATE_LIMITED: msg({
    id: "error.ROLE_REFRESH_RATE_LIMITED",
    message: "Just synced. Try again in a moment.",
  }),

  // ---- maps ----
  MAP_NOT_FOUND: msg({ id: "error.MAP_NOT_FOUND", message: "That map is gone." }),
  MAP_LAYOUT_INVALID: msg({
    id: "error.MAP_LAYOUT_INVALID",
    message: "That map layout isn't valid.",
  }),
  MAP_NAME_AND_BOARD_REQUIRED: msg({
    id: "error.MAP_NAME_AND_BOARD_REQUIRED",
    message: "A map needs a name and a board.",
  }),
  MAP_NAME_TOO_LONG: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.MAP_NAME_TOO_LONG.max",
            message: plural(p.max, {
              one: "That map name is too long. The limit is # character.",
              other: "That map name is too long. The limit is # characters.",
            }),
          }),
        )
      : say(msg({ id: "error.MAP_NAME_TOO_LONG", message: "That map name is too long." })),
  MAP_CODE_REQUIRED: msg({ id: "error.MAP_CODE_REQUIRED", message: "Paste a map code first." }),
  BAD_CODE: msg({ id: "error.BAD_CODE", message: "That doesn't look like a valid map code." }),
  BOARD_REQUIRED: msg({ id: "error.BOARD_REQUIRED", message: "Design a board first." }),
  MAP_SAVE_RATE_LIMITED: msg({
    id: "error.MAP_SAVE_RATE_LIMITED",
    message: "Saving a lot of maps. Wait a moment.",
  }),
  MAP_TOOL_RATE_LIMITED: msg({
    id: "error.MAP_TOOL_RATE_LIMITED",
    message: "Editing faster than the server can keep up. Wait a moment.",
  }),
  MAP_LIMIT_REACHED: (p) =>
    typeof p.max === "number"
      ? say(
          msg({
            id: "error.MAP_LIMIT_REACHED.max",
            message: plural(p.max, {
              one: "You've saved # map. Delete one to save another.",
              other: "You've saved # maps. Delete one to save another.",
            }),
          }),
        )
      : say(msg({ id: "error.MAP_LIMIT_REACHED", message: "Delete a map before saving another." })),

  // ---- store, ranked, misc ----
  INSUFFICIENT_FUNDS: msg({
    id: "error.INSUFFICIENT_FUNDS",
    message: "You don't have enough Pips for that.",
  }),
  ITEM_NOT_FOUND: msg({ id: "error.ITEM_NOT_FOUND", message: "That item doesn't exist." }),
  NOT_OWNED: msg({ id: "error.NOT_OWNED", message: "You don't own that." }),
  NOT_PURCHASABLE: msg({ id: "error.NOT_PURCHASABLE", message: "That item isn't for sale." }),
  WRONG_SLOT: msg({ id: "error.WRONG_SLOT", message: "That item doesn't go in that slot." }),
  SUPPORTER_EXCLUSIVE_ITEM: msg({
    id: "error.SUPPORTER_EXCLUSIVE_ITEM",
    message: "That item is supporter-exclusive.",
  }),
  SLOT_REQUIRED: msg({ id: "error.SLOT_REQUIRED", message: "Pick a slot first." }),
  PURCHASE_RATE_LIMITED: msg({
    id: "error.PURCHASE_RATE_LIMITED",
    message: "Too many purchases. Wait a moment.",
  }),
  RANKED_REQUIRES_ACCOUNT: msg({
    id: "error.RANKED_REQUIRES_ACCOUNT",
    message: "Ranked needs an account. Sign in with Discord.",
  }),
  UNKNOWN_QUEUE: msg({ id: "error.UNKNOWN_QUEUE", message: "That queue doesn't exist." }),
  UNKNOWN_RULESET: msg({ id: "error.UNKNOWN_RULESET", message: "That mode has no leaderboard." }),
  ON_COOLDOWN: msg({ id: "error.ON_COOLDOWN", message: "You're on a ranked cooldown." }),
  ALREADY_QUEUED: msg({ id: "error.ALREADY_QUEUED", message: "You're already in the queue." }),
  MATCH_NOT_FOUND: msg({ id: "error.MATCH_NOT_FOUND", message: "That match doesn't exist." }),
  BAD_RECORD: msg({ id: "error.BAD_RECORD", message: "That match record is corrupt." }),
  PRESET_NOT_FOUND: msg({ id: "error.PRESET_NOT_FOUND", message: "That preset doesn't exist." }),
  INSTANCE_ID_REQUIRED: msg({
    id: "error.INSTANCE_ID_REQUIRED",
    message: "Something went wrong starting the Activity.",
  }),
  INVALID_JSON: msg({
    id: "error.INVALID_JSON",
    message: "Something went wrong. Try again in a moment.",
  }),
  GUEST_RATE_LIMITED: msg({
    id: "error.GUEST_RATE_LIMITED",
    message: "Too many guests from this address. Try again later.",
  }),
  RATE_LIMITED: msg({
    id: "error.RATE_LIMITED",
    message: "Too many requests. Try again in a moment.",
  }),
  INTERNAL: msg({ id: "error.INTERNAL", message: "Something went wrong. Try again in a moment." }),

  // ---- Rivers (engine/rivers) ----
  //
  // Each exists because the core sentinel it would fall through to says
  // something misleading. `engine/rivers/usererr.go` explains each; these
  // sentences say what to do instead where they can.
  //
  // "Coins" throughout, never "gold": Islands gold hexes are a different thing
  // and a player may have both in one game.
  BRIDGE_SITE_ONLY: msg({
    id: "error.BRIDGE_SITE_ONLY",
    message: "A river runs across that path. Only a bridge can cross it.",
  }),
  NOT_BRIDGE_SITE: msg({
    id: "error.NOT_BRIDGE_SITE",
    message: "A bridge only goes where a river crosses a path.",
  }),
  NO_BRIDGES: msg({
    id: "error.NO_BRIDGES",
    message: "You have built all three of your bridges.",
  }),
  NO_SETUP_BRIDGE: msg({
    id: "error.NO_SETUP_BRIDGE",
    message: "Bridges can't be built during setup. Place a road instead.",
  }),
  NO_COINS: msg({
    id: "error.NO_COINS",
    message: "You don't hold enough coins for that.",
  }),
  COIN_SPEND_CAP: msg({
    id: "error.COIN_SPEND_CAP",
    message: "You have already spent coins twice this turn.",
  }),
  SUPPLY_EMPTY: msg({
    id: "error.SUPPLY_EMPTY",
    message: "The supply has none of that resource left.",
  }),

  // ---- Raiders ----
  // Each exists because the core sentinel names a rule the player is not
  // breaking: nothing is built when a rider has already ridden, riders cost no
  // resources, and a seat with plenty of gold may have used both buys.
  //
  // A raider is a neutral enemy figure on a hex; a rider is your own figure on
  // a path. One letter apart, so every sentence uses the article and the whole
  // noun.
  RAIDERS_NO_REFUGE: msg({
    id: "error.RAIDERS_NO_REFUGE",
    message: "This map needs a larger mainland with productive interior terrain for Raiders.",
  }),
  RIDER_MOVED: msg({
    id: "error.RIDER_MOVED",
    message: "That rider has already moved this turn. Each of your riders moves once.",
  }),
  NO_RIDERS: msg({
    id: "error.NO_RIDERS",
    message: "You have no riders left to place. You get six, and they come back when one is lost.",
  }),
  NO_GOLD: msg({
    id: "error.NO_GOLD",
    message: "You don't have enough gold for that. A resource from the bank costs 2.",
  }),
  GOLD_BUYS_USED: msg({
    id: "error.GOLD_BUYS_USED",
    message: "You have already bought twice with gold this turn. That is the limit.",
  }),
  BAD_TREASON_PLAN: msg({
    id: "error.BAD_TREASON_PLAN",
    message:
      "Treason can't move the raiders that way. It takes two from different hexes and puts them on two other unconquered coastal hexes.",
  }),

  // ---- Map preview (server/preview.go) ----
  //
  // The two refusals /api/preview sends of its own. They live here rather than
  // inline in the tools screen so server/errframe_test.go's guard can see them.
  //
  // BAD_RULESET does not name the modules: the pair is a parameter, and a name
  // in a sentence means a sentence per name.
  PREVIEW_BAD_RULESET: msg({
    id: "error.PREVIEW_BAD_RULESET",
    message: "The preview can't build that combination.",
  }),
  PREVIEW_BAD_SEED: msg({ id: "error.PREVIEW_BAD_SEED", message: "A seed is a whole number." }),
};

/**
 * Shown when the backend sends a code with no copy here. Worded so it does not
 * claim the player broke a rule.
 */
const FALLBACK = msg({ id: "error.fallback", message: "That isn't allowed right now." });

/**
 * The sentence for a refusal.
 *
 * `fallback` lets a caller keep a sharper default for its own screen (the lobby
 * saying "Could not start"). Never renders the raw code or backend text.
 */
export function errorText(
  code: string | undefined,
  params?: ErrorParams,
  fallback?: string,
): string {
  const shrug = () => fallback ?? say(FALLBACK);
  if (!code) return shrug();
  const copy = ERROR_COPY[code];
  if (copy === undefined) return shrug();
  return typeof copy === "function" ? copy(params ?? {}) : say(copy);
}

/**
 * The sentence for a failed API call. Duck-typed on `code`/`params` so lib/api
 * imports nothing. `fallback` is the screen's own default, used for a code we
 * have no copy for.
 */
export function apiErrorText(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code?: string; params?: ErrorParams };
    return errorText(e.code, e.params, fallback);
  }
  return fallback;
}

/**
 * Map builder lint issues.
 *
 * Same contract, separate namespace: lint codes are lowercase snake_case
 * (engine/board/lint.go), and they describe a board rather than refusing a
 * command. The wire carries `code`, optional `params`, and a `debug` string the
 * builder must not render.
 */
export const MAP_ISSUE_COPY: Record<string, Copy> = {
  // structural errors
  number_on_nonproducing: msg({
    id: "mapIssue.number_on_nonproducing",
    message: "A tile that produces nothing has a number token.",
  }),
  few_land: msg({ id: "mapIssue.few_land", message: "A map needs at least 3 land tiles." }),
  no_desert: msg({
    id: "mapIssue.no_desert",
    message: "A map needs at least one desert for the robber to start on.",
  }),
  harbor_shared_hex: msg({
    id: "mapIssue.harbor_shared_hex",
    message: "Two harbours would put their docks on the same water hex.",
  }),
  bad_ruleset: msg({
    id: "mapIssue.bad_ruleset",
    message: "This map's expansion set isn't valid.",
  }),
  // One expansion deals its own map, so a chosen map cannot apply. Written per
  // module like the pairs below; only one module can be named today.
  module_refuses_map: (p: ErrorParams) =>
    p.module === "explorers"
      ? say(
          msg({
            id: "mapIssue.module_refuses_map.explorers",
            message: "Explorers deals its own map, so it can't be played on a chosen or drawn one.",
          }),
        )
      : say(
          msg({
            id: "mapIssue.module_refuses_map",
            message: "That expansion deals its own map, so it can't be played on this one.",
          }),
        ),
  // Written out per (terrain, expansion) pair, with a label-shaped fallback,
  // rather than one frame with two runtime nouns (and no `.toLowerCase()`: JS
  // case methods are locale-invariant, and lower-casing is no substitute for
  // grammatical case).
  //
  // Only two pairs are reachable: the engine registers gold to Islands and
  // lake to Fishermen (engine.RegisterTerrain), and the only module demanding
  // terrain is Islands demanding sea.
  terrain_needs_module: (p) => {
    const pair = TERRAIN_NEEDS_MODULE[`${String(p.terrain)}:${String(p.module)}`];
    if (pair) return say(pair);
    // Unreachable in shipped rulesets. For new terrain, both nouns sit after a
    // colon as labels, where nothing governs them.
    return say(
      msg({
        id: "mapIssue.terrain_needs_module",
        message:
          "This map uses terrain from an expansion that is off. Terrain: {terrain}. Expansion: {module}.",
      }),
      { terrain: terrainName(p.terrain), module: moduleName(p.module) },
    );
  },
  module_needs_terrain: (p) =>
    p.module === "islands" && p.terrain === "sea"
      ? say(
          msg({
            id: "mapIssue.module_needs_terrain.islands",
            message: "Islands maps need open water. Paint some sea tiles.",
          }),
        )
      : say(
          msg({
            id: "mapIssue.module_needs_terrain",
            message:
              "An expansion that is on needs terrain this map has none of. Expansion: {module}. Terrain: {terrain}.",
          }),
          { module: moduleName(p.module), terrain: terrainName(p.terrain) },
        ),
  // Harbormaster needs a second harbour on an authored map (engine/harbormaster
  // MapIssues). A map with none is dealt a full set, so this only fires for
  // exactly one.
  module_needs_harbours: (p) =>
    typeof p.min === "number"
      ? say(
          msg({
            id: "mapIssue.module_needs_harbours.min",
            message: plural(p.min, {
              one: "Harbormaster needs at least # harbour on the map. Add another harbour, or remove them all to have them placed for you.",
              other:
                "Harbormaster needs at least # harbours on the map. Add another harbour, or remove them all to have them placed for you.",
            }),
          }),
        )
      : say(
          msg({
            id: "mapIssue.module_needs_harbours",
            message: "Harbormaster needs more harbours on this map.",
          }),
        ),

  // balance warnings
  disconnected: msg({
    id: "mapIssue.disconnected",
    message: "The land is split into separate pieces. Ships (Islands) are needed to connect them.",
  }),
  adjacent_red: msg({
    id: "mapIssue.adjacent_red",
    message: "Two high-probability numbers (6 or 8) are touching.",
  }),
  adjacent_duplicate: msg({
    id: "mapIssue.adjacent_duplicate",
    message: "Two tiles with the same number are touching.",
  }),
  pip_imbalance: msg({
    id: "mapIssue.pip_imbalance",
    message: "Some resources are much richer than others.",
  }),
  broken_spot: msg({
    id: "mapIssue.broken_spot",
    message: "A settlement spot collects more than its share of the board.",
  }),
  resource_clump: msg({
    id: "mapIssue.resource_clump",
    message: "Several tiles of the same resource are bunched together.",
  }),
};

/**
 * The (terrain, expansion) pairs the engine can produce, as whole sentences.
 * Keyed `terrain:module`, matching the wire tokens.
 *
 * Explorers adds none: `engine.RegisterTerrain` is called only by Islands
 * (Gold) and Fishermen (Lake), and Explorers' gold fields, shoals and spice
 * farms are a `Special` on a hidden hex, not terrain, so no wire resource names
 * them (likewise for TERRAIN_NAMES, keyed by `board.Resource`'s JSON names in
 * engine/board/resource_json.go). Explorers also refuses authored maps, so it
 * never reaches the linter.
 */
const TERRAIN_NEEDS_MODULE: Record<string, MessageDescriptor> = {
  "gold:islands": msg({
    id: "mapIssue.terrain_needs_module.gold_islands",
    message: "Gold tiles need the Islands expansion turned on.",
  }),
  "lake:fishermen": msg({
    id: "mapIssue.terrain_needs_module.lake_fishermen",
    message: "Lake tiles need the Fishermen scenario turned on.",
  }),
  // Swamp is generated terrain registered to Rivers (engine.RegisterTerrain),
  // so a map with one and Rivers off lands here. The Caravans oasis has no row:
  // it is derived at setup from a desert, and no resource names it.
  "swamp:rivers": msg({
    id: "mapIssue.terrain_needs_module.swamp_rivers",
    message: "Swamp tiles need the Rivers scenario turned on.",
  }),
};

/**
 * Player-facing terrain name, from the wire's stable resource token. The map
 * builder names tiles ("Forest") differently from what they produce ("wood"),
 * so these have their own ids.
 */
const TERRAIN_NAMES: Record<string, MessageDescriptor> = {
  wood: msg({ id: "terrain.wood", message: "Forest" }),
  brick: msg({ id: "terrain.brick", message: "Clay" }),
  sheep: msg({ id: "terrain.sheep", message: "Pasture" }),
  wheat: msg({ id: "terrain.wheat", message: "Field" }),
  ore: msg({ id: "terrain.ore", message: "Mountain" }),
  gold: msg({ id: "terrain.gold", message: "Gold" }),
  sea: msg({ id: "terrain.sea", message: "Sea" }),
  lake: msg({ id: "terrain.lake", message: "Lake" }),
  fog: msg({ id: "terrain.fog", message: "Fog" }),
  land: msg({ id: "terrain.land", message: "Land" }),
  border: msg({ id: "terrain.border", message: "Border" }),
  none: msg({ id: "terrain.none", message: "Desert" }),
  // The tile's name, not its yield: a swamp pays nothing.
  swamp: msg({ id: "terrain.swamp", message: "Swamp" }),
};

function terrainName(id: unknown): string {
  const m = TERRAIN_NAMES[String(id)];
  return m ? say(m) : String(id);
}

/**
 * Player-facing expansion name, from the wire's stable module token. Only this
 * table is read by `moduleName`; the Go guard's regex
 * (`^\s{2}([A-Z][A-Z0-9_]*):`) does not check lowercase keys, so a module put
 * in ERROR_COPY by mistake renders as the raw token unnoticed.
 */
const MODULE_NAMES: Record<string, MessageDescriptor> = {
  islands: msg({ id: "module.islands", message: "Islands" }),
  cak: msg({ id: "module.cak", message: "Knights" }),
  tab: msg({ id: "module.tab", message: "Scenarios" }),
  rivers: msg({ id: "module.rivers", message: "Rivers" }),
  explorers: msg({ id: "module.explorers", message: "Explorers" }),
};

function moduleName(id: unknown): string {
  const m = MODULE_NAMES[String(id)];
  return m ? say(m) : String(id);
}

/** The sentence for a map lint issue. */
export function mapIssueText(code: string, params?: ErrorParams): string {
  const copy = MAP_ISSUE_COPY[code];
  if (copy === undefined)
    return say(
      msg({
        id: "mapIssue.fallback",
        message: "This map has a problem the builder can't describe yet.",
      }),
    );
  return typeof copy === "function" ? copy(params ?? {}) : say(copy);
}
