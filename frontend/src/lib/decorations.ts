// Maps a decoration cosmetic id to its CSS treatment. The GIFs live in
// /public/cosmetics/decorations and are referenced from index.css by class;
// DecoratedName is a thin wrapper. Supporter decorations are coloured
// sparkles, staff is the red fire, and the gift-role set adds the rest. Each
// kind is the gif filename stem with dashes and has a matching
// .decorated--<kind> rule in index.css.
type Kind = string;

export const KIND_BY_ID: Record<string, Kind> = {
  "decoration.booster": "sparkle-pink", // Nitro boost
  "decoration.supporter": "sparkle-blue", // Discord supporter
  "decoration.kofi": "sparkle-yellow", // Ko-fi supporter
  "decoration.staff": "fire-red", // staff
  // Gift-role decorations; hidden in the picker unless owned.
  "decoration.fire_black": "fire-black",
  "decoration.fire_blue": "fire-blue",
  "decoration.fire_green": "fire-green",
  "decoration.fire_grey": "fire-grey",
  "decoration.fire_lime": "fire-lime",
  "decoration.fire_orange": "fire-orange",
  "decoration.fire_purple": "fire-purple",
  "decoration.fire_teal": "fire-teal",
  "decoration.fire_white": "fire-white",
  "decoration.sparkle_blue_light": "sparkle-blue-light",
  "decoration.sparkle_brown": "sparkle-brown",
  "decoration.sparkle_green": "sparkle-green",
  "decoration.sparkle_green_light": "sparkle-green-light",
  "decoration.sparkle_grey": "sparkle-grey",
  "decoration.sparkle_lime": "sparkle-lime",
  "decoration.sparkle_orange": "sparkle-orange",
  "decoration.sparkle_purple": "sparkle-purple",
  "decoration.sparkle_red": "sparkle-red",
  "decoration.sparkle_teal": "sparkle-teal",
  "decoration.sparkle_white": "sparkle-white",
  "decoration.sparkle_yellow_light": "sparkle-yellow-light",
};

// decorationFor returns the class list for a decoration id, or null when the id
// is empty/unknown. Under reduced motion it adds `decorated--static`, which the
// CSS uses to swap the animated GIF for a static first-frame PNG.
export function decorationFor(
  id: string | undefined,
  reducedMotion: boolean,
): { className: string } | null {
  if (!id) return null;
  const kind = KIND_BY_ID[id];
  if (!kind) return null;
  const cls = ["decorated", `decorated--${kind}`];
  if (reducedMotion) cls.push("decorated--static");
  return { className: cls.join(" ") };
}
