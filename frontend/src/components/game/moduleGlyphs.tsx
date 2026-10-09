/**
 * Glyphs for the expansion modules' own subjects where neither the icon pack
 * nor the HUD glyph set has one: the robber on an Islands 7, a camel, a
 * sea-and-land route. Drawn on a 16px grid as a single filled path in
 * `currentColor`, so they take the surrounding ink.
 */
function Glyph({ d, size }: { d: string; size: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className="shrink-0">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** The robber, as a pawn: the shape of the board's own model. */
export function RobberGlyph({ size = 14 }: { size?: number }) {
  return <Glyph size={size} d="M8 1.5a3 3 0 0 1 1.6 5.5l1.6 7.5H4.8L6.4 7A3 3 0 0 1 8 1.5z" />;
}

/** A camel (Caravans): the camel supply, and a seat's points from camels. */
export function CamelGlyph({ size = 14 }: { size?: number }) {
  return (
    <Glyph
      size={size}
      d="M1 11c1-3 2-5.2 4-5.2s2 2.2 3 2.2 1-3.2 3-3.2 2 2 2.5 3.2H15v2h-1v4h-1.4v-3H9v3H7.6v-3H4v3H2.6v-3.4z"
    />
  );
}

/**
 * A route that keeps going: the Islands counter, where roads and ships are one
 * network and a road bar would show only half of it.
 */
export function RouteGlyph({ size = 14 }: { size?: number }) {
  return <Glyph size={size} d="M1.5 12.5 7 7l2 2 5.5-5.5 1 1-6.5 6.5-2-2-4.5 4.5z" />;
}
