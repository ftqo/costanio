// One look for every colour swatch on the site pages (store shelf, profile
// seat colour, lobby seat dialog, map builder chips):
//
// - picked: a yellow tile behind the swatch (a 3px selected-yellow frame
//   touching it, no white gap, no second ring);
// - locked: a flat well with the colour smaller inside it, never faded (a
//   faded colour misrepresents what is for sale), never dashed;
// - a keyline only where the colour would vanish into the panel it sits on:
//   a near-white swatch in light mode, a near-black one in dark mode
//   (`data-swatch-edge`, drawn in pb-site.css).

/** Relative luminance (WCAG) of a #rgb/#rrggbb colour; null when unparseable. */
function luminance(hex: string): number | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Which theme's panel a colour is too close to: "light" for a near-white
 * swatch (lost on the white panel), "dark" for a near-black or deep navy one
 * (lost on the navy panel). Undefined when it stands out in both.
 */
export function swatchEdge(hex: string): "light" | "dark" | undefined {
  const l = luminance(hex);
  if (l == null) return undefined;
  if (l > 0.75) return "light";
  if (l < 0.045) return "dark";
  return undefined;
}

/** Class names for a swatch's picked frame. */
export const SWATCH_PICKED = "outline-3 outline-offset-0 outline-selected";

/** Class names for a locked swatch's well (its colour goes in a child). */
export const SWATCH_LOCKED_WELL = "bg-elev2 p-1.5";

/** Class names for the colour inside a locked swatch's well. */
export const SWATCH_LOCKED_CHIP = "block w-full h-full rounded-xs bg-(--swatch)";
