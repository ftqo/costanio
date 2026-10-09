import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";

/**
 * The one-line character of each bot personality, keyed by its proper name.
 *
 * The server (bot/personality.go) owns which personality sat down; its
 * `character` field from `GET /api/bots` is English only, since the backend
 * sends codes, not prose. This file owns the translatable text.
 *
 * `bot.TestFrontendCopyCoversEveryPersonality` parses this file and fails when
 * a registered personality has no entry, since a missing one would otherwise
 * just show a name with no character.
 *
 * Keys are the proper noun without the seat's "Bot " prefix. Names are never
 * translated: they are persisted as the bot's account name and read back by
 * replays.
 */
export const BOT_CHARACTERS: Record<string, MessageDescriptor> = {
  William: msg({
    id: "bot.character.William",
    message: "Plays a steady, standard game: take ground early, then convert it to points.",
  }),
  Winston: msg({
    id: "bot.character.Winston",
    message: "Builds road, then more road. The long way round is the whole plan.",
  }),
  Moriarty: msg({
    id: "bot.character.Moriarty",
    message: "Watches whoever is ahead, and puts the robber where it is felt.",
  }),
  Happaya: msg({
    id: "bot.character.Happaya",
    message: "Always has an offer for you. Usually a slightly bad one.",
  }),
  Bop: msg({
    id: "bot.character.Bop",
    message: "Would rather hold a card than build anything with it. Hoards the deck.",
  }),
  Z: msg({
    id: "bot.character.Z",
    message: "Two good intersections and a mountain of ore. Cities, then more cities.",
  }),
  B: msg({
    id: "bot.character.B",
    message: "Collects harbours, and trades at rates nobody else is getting.",
  }),
  Jester: msg({
    id: "bot.character.Jester",
    message: "Takes the open ground before anyone asks for it, and holds it.",
  }),
  Camembert: msg({
    id: "bot.character.Camembert",
    message: "Hoards a full pantry and hates spending it. Would rather ask you.",
  }),
  Pika: msg({
    id: "bot.character.Pika",
    message: "In a hurry. Grabs the nearest points and worries about the board later.",
  }),
  Chu: msg({
    id: "bot.character.Chu",
    message: "Plays its own board and ignores yours entirely. Serenely unbothered.",
  }),
};

/** The prefix the lobby puts in front of a personality name. Mirrors
 * `bot.DisplayNamePrefix`. */
const BOT_PREFIX = "Bot ";

/**
 * The personality a seat's display name records, or undefined. Undefined is
 * normal: a human seat, a takeover bot (which keeps the human's name), or a
 * personality retired since the game was created.
 */
export function botPersonalityName(displayName: string | undefined): string | undefined {
  if (!displayName?.startsWith(BOT_PREFIX)) return undefined;
  const name = displayName.slice(BOT_PREFIX.length);
  return name in BOT_CHARACTERS ? name : undefined;
}

/** The character line for a seat's display name, or undefined if it is not a
 * known personality. Returns the descriptor; the caller runs it through `i18n._`
 * (or `<Trans>`) so it re-renders on a language change. */
export function botCharacter(displayName: string | undefined): MessageDescriptor | undefined {
  const name = botPersonalityName(displayName);
  return name ? BOT_CHARACTERS[name] : undefined;
}
