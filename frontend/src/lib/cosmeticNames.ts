/**
 * The shop's item names, in the player's language.
 *
 * `cosmetics/catalog.go` sends each item with an English `name`. The item id
 * is the stable code (docs/user-facing-text.md, "Cosmetic catalog names"), so
 * translations live here keyed by it, and the server's `name` is the fallback
 * for an id this client does not know yet.
 *
 * Not the colour names (`Midnight`, `Periwinkle`), which come from
 * `cosmetics/color.go` and stay untranslated as brand flavour per the
 * docs/i18n glossaries.
 *
 * `cosmeticNames.test.ts` reads catalog.go and fails when an item has no name
 * here or the English differs.
 */
import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const COSMETIC_NAMES: Record<string, MessageDescriptor> = {
  "decoration.booster": msg({
    id: "cosmetic.decoration.booster",
    message: "Booster",
    comment:
      "store item name: a name decoration, an animated effect behind a username. Named for the role that grants it",
  }),
  "decoration.supporter": msg({
    id: "cosmetic.decoration.supporter",
    message: "Supporter",
    comment:
      "store item name: a name decoration, an animated effect behind a username. Named for the role that grants it",
  }),
  "decoration.kofi": msg({
    id: "cosmetic.decoration.kofi",
    message: "Ko-fi",
    comment:
      "store item name: a name decoration, an animated effect behind a username. Ko-fi is the donation platform, keep the name as written",
  }),
  "decoration.staff": msg({
    id: "cosmetic.decoration.staff",
    message: "Staff",
    comment:
      "store item name: a name decoration, an animated effect behind a username. Named for the role that grants it",
  }),
  "decoration.fire_black": msg({
    id: "cosmetic.decoration.fire_black",
    message: "Black Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_blue": msg({
    id: "cosmetic.decoration.fire_blue",
    message: "Blue Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_green": msg({
    id: "cosmetic.decoration.fire_green",
    message: "Green Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_grey": msg({
    id: "cosmetic.decoration.fire_grey",
    message: "Grey Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_lime": msg({
    id: "cosmetic.decoration.fire_lime",
    message: "Lime Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_orange": msg({
    id: "cosmetic.decoration.fire_orange",
    message: "Orange Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_purple": msg({
    id: "cosmetic.decoration.fire_purple",
    message: "Purple Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_teal": msg({
    id: "cosmetic.decoration.fire_teal",
    message: "Teal Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.fire_white": msg({
    id: "cosmetic.decoration.fire_white",
    message: "White Fire",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_blue_light": msg({
    id: "cosmetic.decoration.sparkle_blue_light",
    message: "Blue Light Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_brown": msg({
    id: "cosmetic.decoration.sparkle_brown",
    message: "Brown Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_green": msg({
    id: "cosmetic.decoration.sparkle_green",
    message: "Green Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_green_light": msg({
    id: "cosmetic.decoration.sparkle_green_light",
    message: "Green Light Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_grey": msg({
    id: "cosmetic.decoration.sparkle_grey",
    message: "Grey Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_lime": msg({
    id: "cosmetic.decoration.sparkle_lime",
    message: "Lime Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_orange": msg({
    id: "cosmetic.decoration.sparkle_orange",
    message: "Orange Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_purple": msg({
    id: "cosmetic.decoration.sparkle_purple",
    message: "Purple Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_red": msg({
    id: "cosmetic.decoration.sparkle_red",
    message: "Red Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_teal": msg({
    id: "cosmetic.decoration.sparkle_teal",
    message: "Teal Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_white": msg({
    id: "cosmetic.decoration.sparkle_white",
    message: "White Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "decoration.sparkle_yellow_light": msg({
    id: "cosmetic.decoration.sparkle_yellow_light",
    message: "Yellow Light Sparkle",
    comment: "store item name: a name decoration, an animated effect behind a username",
  }),
  "robber.brigand": msg({
    id: "cosmetic.robber.brigand",
    message: "Brigand",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.sentinel": msg({
    id: "cosmetic.robber.sentinel",
    message: "Sentinel",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.keg": msg({
    id: "cosmetic.robber.keg",
    message: "Keg",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.crow": msg({
    id: "cosmetic.robber.crow",
    message: "Crow",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.hourglass": msg({
    id: "cosmetic.robber.hourglass",
    message: "Hourglass",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.brazier": msg({
    id: "cosmetic.robber.brazier",
    message: "Brazier",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.shard": msg({
    id: "cosmetic.robber.shard",
    message: "Crystal",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.shard.verdant": msg({
    id: "cosmetic.robber.shard.verdant",
    message: "Crystal Verdant",
    comment: "store item name: a skin for the robber piece",
  }),
  "robber.shard.rose": msg({
    id: "cosmetic.robber.shard.rose",
    message: "Crystal Rose",
    comment: "store item name: a skin for the robber piece",
  }),
  "dice.bone": msg({
    id: "cosmetic.dice.bone",
    message: "Bone Dice",
    comment: "store item name: a dice skin",
  }),
  "dice.gem": msg({
    id: "cosmetic.dice.gem",
    message: "Gem Dice",
    comment: "store item name: a dice skin",
  }),
  "pieces.driftwood": msg({
    id: "cosmetic.pieces.driftwood",
    message: "Driftwood Set",
    comment: "store item name: a set of settlement, city and road pieces",
  }),
  "pieces.obsidian": msg({
    id: "cosmetic.pieces.obsidian",
    message: "Obsidian Set",
    comment: "store item name: a set of settlement, city and road pieces",
  }),
  "board.parchment": msg({
    id: "cosmetic.board.parchment",
    message: "Parchment",
    comment: "store item name: a board skin",
  }),
  "board.aurora": msg({
    id: "cosmetic.board.aurora",
    message: "Aurora Board",
    comment: "store item name: a board skin",
  }),
  "pieces.cyclades": msg({
    id: "cosmetic.pieces.cyclades",
    message: "Cyclades Set",
    comment: "store item name: a set of settlement, city and road pieces",
  }),
  "pieces.classic": msg({
    id: "cosmetic.pieces.classic",
    message: "Classic Set",
    comment: "store item name: a set of settlement, city and road pieces",
  }),
};

/** The item's name in the active locale, or the server's own for an id we lack. */
export function cosmeticName(item: { id: string; name: string }): string {
  const d = COSMETIC_NAMES[item.id];
  return d ? i18n._(d) : item.name;
}
