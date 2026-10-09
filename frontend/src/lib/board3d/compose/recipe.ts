// Recipes and the component files they name.
//
// A recipe is one composed tile, `art/recipes/<key>.json`. The key says what
// the tile is (`trade_<ground>_<dir>` or `river_<ground>_<shape>`), and the
// file holds only per-tile fixes from review. Everything else comes from
// `art/recipes/parts.json` (which component files exist) and the trade-parts
// contract's `spots.json` (hero anchors and spots, part roles, the
// direction-to-layout table), so a recipe cannot restate another file's facts.

/** The six seaward directions, in `DIRS` order (coords.ts). */
export const DIRECTIONS = ["e", "se", "sw", "w", "nw", "ne"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * World bearing of each direction, atan2(z, x) in degrees with north -z:
 * `hexToWorld(DIRS[i])` points that way.
 */
export const WORLD_BEARING: Record<Direction, number> = {
  e: 0,
  se: 60,
  sw: 120,
  w: 180,
  nw: 240,
  ne: 300,
};

/**
 * The same direction in the FILE frame. The board draws every tile at
 * `TILE_ROTATION_Y` = pi, which maps file (x, z) to world (-x, -z).
 */
export function fileBearing(d: Direction): number {
  return (WORLD_BEARING[d] + 180) % 360;
}

/**
 * A turn applied to a layout, in the contract's order: rotate first, then
 * mirror (tile = Mx^mirror . Rz(rotate) . layout).
 */
export interface Placement {
  rotate: number;
  mirror: boolean;
}

/** Where a file bearing goes under a placement. makeRotationY(a) maps b to b - a; Mx maps b to 180 - b. */
export function placeBearing(bearing: number, p: Placement): number {
  const r = bearing - p.rotate;
  const b = p.mirror ? 180 - r : r;
  return ((b % 360) + 360) % 360;
}

// ------------------------------------------------------------ the contract --

/**
 * `paint` is what the trade-parts contract calls `drape` (a plaza, a spoke, a
 * yard floor): the composer paints it into the ground's own triangles rather
 * than laying it over them (paint.ts), so a listed `drape` reads as `paint`.
 */
export type PartRole = "bed" | "paint" | "fixed" | "rigid";

export interface HeroSpec {
  nodes: string[];
  anchor: { file: [number, number] };
  select_r: number | null;
  footprint_r: number;
  /** Keeps its authored height (floats at a fixed water level). */
  fixed?: boolean;
  /** Re-draped on the composed ground after moving (a flat pool). */
  drape?: boolean;
  /** The ground is dug for it: it never moves. */
  ground_bound?: boolean;
}

export interface SpotSpec {
  file: [number, number];
  yaw: number;
  scale: number;
  stays?: boolean;
}

export interface GroundSpots {
  yard_material?: string;
  heroes: Record<string, HeroSpec>;
  keep?: Record<string, unknown>;
  /** Trade towns: keyed by direction (`W`). */
  spots: Record<string, Record<string, SpotSpec>>;
  /** Rivers: keyed by channel shape (`e_w_a`). */
  river_spots?: Record<string, Record<string, SpotSpec>>;
}

/** `spots.json`, as the trade-parts lane writes it. */
export interface SpotsFile {
  version: number;
  layout?: Record<string, [string, number, boolean]>;
  parts?: Record<string, { role: PartRole | "drape"; tris?: number; footprint_r?: number }>;
  grounds: Record<string, GroundSpots>;
}

/** The role of a layout part: the contract's table, else its part word. */
export function partRole(name: string, spots?: SpotsFile): PartRole {
  const listed = spots?.parts?.[name]?.role;
  if (listed) return listed === "drape" ? "paint" : listed;
  const m = /^(?:Town_[A-Z]+|LakeTown_[A-Z]+)_([a-z]+)(?:_\d+)?$/.exec(name);
  const word = m ? m[1] : name;
  if (word === "bed") return "bed";
  if (["plaza", "paving", "yardfloor", "path"].includes(word)) return "paint";
  if (["deck", "boardwalk", "quay", "pier", "stilts"].includes(word)) return "fixed";
  return "rigid";
}

// --------------------------------------------------------------- parts.json --

export interface GroundEntry {
  /** The blend's terrain name, which `spots.json` keys its grounds by. */
  terrain: string;
  /** The shipped base tile, relative to the repo root. */
  file: string;
}

export interface Parts {
  grounds: Record<string, GroundEntry>;
  trade?: {
    spots: string;
    /** Layout family (`W`, `SW`) -> file. */
    layouts: Record<string, string>;
    /** The parts every direction shares, laid down unturned (the plaza). */
    shared?: string;
    /** Yard material per ground, until spots.json carries its own. */
    yard?: Record<string, string>;
    /** The lake towns, `{dir}` replaced by the upper-case direction's lower case. */
    lake: string;
  };
  river?: {
    /** The hand-made channel the kit is lifted from, `{shape}` replaced. */
    template: string;
    /** The ground the template is authored on (a key of `grounds`): its plain tile maps the rim. */
    templateGround: string;
    /** Hero spots for river grounds: spots.json's `river_spots`, keyed by shape. */
    spots?: string;
    /** Per ground: template material -> this ground's material. */
    swap: Record<string, Record<string, string>>;
    /** Per ground: template material -> this ground's, for the wet margin beside the cut. */
    margin?: Record<string, Record<string, string>>;
  };
}

// ---------------------------------------------------------------- recipes --

export type Selector = string;

export interface Recipe {
  key: string;
  kind: "trade" | "river";
  ground: string;
  /** Direction for a trade town, channel shape for a river. */
  variant: string;
  keep?: Selector[];
  drop?: Selector[];
  nudge?: Record<Selector, [number, number]>;
  /** Raise the town's bed by this much where it meets the base ground (trade only). */
  offset?: number;
}

/** The composed tile's terrain name: `trade_hills_nw` -> `Trade_Hills_NW`. */
export function terrainForKey(key: string): string {
  return key
    .split("_")
    .map((s) => (s.length <= 2 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)))
    .join("_");
}

/** The shapes a river key may name: the nine channels, `e_w` as its two meanders. */
export const RIVER_SHAPES = [
  "e_w_a",
  "e_w_b",
  "ne_sw",
  "nw_se",
  "ne_w",
  "e_nw",
  "e_sw",
  "w_se",
  "ne_se",
  "nw_sw",
] as const;

/** Parse and check one recipe. Throws on anything malformed, naming the file. */
export function parseRecipe(key: string, raw: unknown, parts: Parts): Recipe {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error(`${key}: not an object`);
  const r = raw as Record<string, unknown>;
  const known = new Set(["keep", "drop", "nudge", "offset", "note"]);
  for (const k of Object.keys(r))
    if (!known.has(k)) throw new Error(`${key}: unknown field "${k}"`);
  const m = /^(trade|river)_([a-z]+)_([a-z_]+)$/.exec(key);
  if (!m)
    throw new Error(`${key}: a recipe is named trade_<ground>_<dir> or river_<ground>_<shape>`);
  const [, kind, ground, variant] = m as unknown as [string, "trade" | "river", string, string];
  if (!parts.grounds[ground]) throw new Error(`${key}: no ground "${ground}" in parts.json`);
  if (kind === "trade" && !(DIRECTIONS as readonly string[]).includes(variant)) {
    throw new Error(`${key}: "${variant}" is not a direction (${DIRECTIONS.join(", ")})`);
  }
  if (kind === "river" && !(RIVER_SHAPES as readonly string[]).includes(variant)) {
    throw new Error(`${key}: "${variant}" is not a channel shape`);
  }
  const list = (v: unknown, what: string): string[] | undefined => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((s) => typeof s !== "string"))
      throw new Error(`${key}: ${what} must be a list of names`);
    return v as string[];
  };
  let nudge: Record<string, [number, number]> | undefined;
  if (r.nudge !== undefined) {
    nudge = {};
    for (const [sel, v] of Object.entries(r.nudge as Record<string, unknown>)) {
      if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== "number")) {
        throw new Error(`${key}: nudge ${sel} must be [dx, dz]`);
      }
      const [dx, dz] = v as number[];
      nudge[sel] = [dx, dz];
    }
  }
  if (r.offset !== undefined && typeof r.offset !== "number")
    throw new Error(`${key}: offset must be a number`);
  return {
    key,
    kind,
    ground,
    variant,
    keep: list(r.keep, "keep"),
    drop: list(r.drop, "drop"),
    nudge,
    offset: r.offset,
  };
}
