import type { Seat } from "./types";

/** A seat is "bot-controlled" in the voluntary-spectate sense when its owner used
 * "Leave & Spectate": the human keeps the seat but a bot plays it (status
 * "auto"). Original lobby bots are status "bot" and are excluded here. */
export function seatBotControlled(seat: Seat | undefined): boolean {
  return seat?.status === "auto";
}

/** Display name for a seat: prefix "Bot " when a human's seat is currently
 * played by a bot (status "auto"). Original lobby bots ("bot") already carry
 * "Bot" in their pool name, so they are left untouched. */
export function seatDisplayName(name: string, status: Seat["status"] | undefined): string {
  return status === "auto" ? `Bot ${name}` : name;
}

/**
 * The seat the local client is playing, as opposed to the one it owns.
 *
 * "Leave & Spectate" keeps your seat but marks it "auto" so a bot plays it, so
 * the view still carries your `viewer` index and every
 * `pending_discards?.[viewer]`-style lookup would render prompts for the bot's
 * moves. Returning the spectator sentinel (-1) routes that through the
 * existing no-seat path.
 *
 * Use this for "is this mine to act on". Keep the raw `viewer` for ownership
 * and display (hand, colour, improvement tracks), which the seat still owns.
 */
export function actingSeat(viewer: number, botControlled: boolean): number {
  return botControlled ? -1 : viewer;
}
