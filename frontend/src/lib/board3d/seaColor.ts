// The page behind the board, and the sky the water reflects.
//
// Both are per-look and live in `boardTheme.ts`; this file keeps the
// conversions and the day values other code still names directly.
//
//   pageHex  behind the transparent canvas, and what the fog fades to. The two
//            must be one value or the sea grows a rim (see oceanRadius).
//   skyHex   what the water reflects. Never drawn: there is no sky geometry,
//            so above the horizon you see pageHex.
//
// The sea itself is neither; making it equal to the sky flattens the reflection.
export const PAGE_BLUE_HEX = "#1159c1";
export const SKY_HEX = "#c2d4e6";

/** Linear-light RGB, which is the space radiance has to be computed in. */
export type RGB = [number, number, number];

/**
 * sRGB hex to linear RGB, using the full piecewise transfer function. A 2.2
 * power is off by nearly a third in the dark end, where this blue's red channel
 * (0.067 sRGB) sits.
 */
export function hexToLinear(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  const to = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [to((n >> 16) & 255), to((n >> 8) & 255), to(n & 255)];
}

/** The sky's colour, in the space the gradient is built in. */
export const SKY_LINEAR: RGB = hexToLinear(SKY_HEX);

/** Scale a radiance, keeping its hue. */
export function scaleRGB(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}
