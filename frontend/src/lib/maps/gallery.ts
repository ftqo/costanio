import type { Board, BoardTile, Resource } from "@/lib/types";
import { hexesInRadius } from "@/lib/hexgeo";
import { msg } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
// Ocean for every gallery map is computed by the Go `Frame` transform. Maps
// author land (plus gold and desert) only; previews frame on load
// (framed-gallery.ts) and games frame at start.

export interface GalleryMap {
  id: string;
  /**
   * What the map is called, in the player's language: a getter over a message
   * descriptor (see `named`), so it resolves against the active catalogue.
   */
  name: string;
  kind: "standard" | "islands" | "themed";
  ruleset: string; // "base" | "base+islands"
  board: Board;
  // Authored "best with" range for curated maps, overriding the tile-count
  // formula (recommendedPlayers; see mapPlayers in format.ts). A roomy board
  // may advertise a smaller table; fewer players just plays sparser.
  players?: { min: number; max: number };
}

/** Attach a live-rendered `name` to a gallery entry. */
function named(name: MessageDescriptor, rest: Omit<GalleryMap, "name">): GalleryMap {
  return Object.defineProperty(rest, "name", {
    get: () => i18n._(name),
    enumerable: true,
  }) as GalleryMap;
}

// A full radius-R hexagon of generic land. Resources and numbers are rolled at
// game start, so every standard map is a fresh shuffle.
export function fullLandBoard(radius: number): Board {
  const tiles: BoardTile[] = hexesInRadius(radius).map((hex) => ({ hex, res: "land", num: 0 }));
  return { radius, tiles, robber: { q: 0, r: 0 }, harbors: [] };
}

// Country maps are generated offline by rasterizing real coastline GeoJSON (the
// lower 48, China, Japan, the British Isles) at a coarse hex resolution, baked
// as centred "q,r" tile coordinates. Land only: the ocean (a coastline ring plus
// inter-island water) is computed by `Frame`, at game start and on preview load
// (framed-gallery.ts).
function geoBoard(radius: number, land: string): Board {
  const tiles: BoardTile[] = [];
  for (const p of land.split(" ")) {
    const [q, r] = p.split(",").map(Number);
    tiles.push({ hex: { q, r }, res: "land", num: 0 });
  }
  const firstLand = tiles.find((t) => t.res === "land")!;
  return { radius, tiles, robber: firstLand.hex, harbors: [] };
}

// Island-scenario maps: a dominant main island plus small islands to sail to
// (the first settlement on each scores a +2 island chip), with a couple of gold
// hexes. Geography is fixed; resources, numbers and the desert are dealt per
// game by the backend. Authored as "q,r" lists, land only; `Frame` computes the
// surrounding ocean so maps follow the island silhouette.
function isleBoard(radius: number, land: string, gold: string): Board {
  const tiles: BoardTile[] = [];
  const add = (spec: string, res: Resource) => {
    for (const p of spec.trim().split(/\s+/)) {
      if (!p) continue;
      const [q, r] = p.split(",").map(Number);
      tiles.push({ hex: { q, r }, res, num: 0 });
    }
  };
  add(land, "land");
  if (gold.trim()) add(gold, "gold");
  const firstLand = tiles.find((t) => t.res === "land")!;
  return { radius, tiles, robber: firstLand.hex, harbors: [] };
}

// Island maps drawn in the in-app map builder. Land is fixed; resources,
// numbers and the desert are dealt per game. "q,r" land lists, land only. Gold
// sits on the outer islets, never the home island, so gold yield is reachable.
// The Shores trio is a Small/Medium/Large tier (3-4 / 5-6 / 7-10 players, set
// on the GalleryMap below): shores = main island + 3 islets (1 gold);
// shores-expanded = larger main + 4 islets (2 gold); shores-large = a big main
// island + 4 outer islets (4 gold). archipelago = six roughly equal islands
// (2 gold). Gold coords are pulled out of the land strings, not duplicated.
const SHORES_LAND =
  "0,-3 2,-3 3,-3 3,-2 -1,-1 0,-1 1,-1 3,-1 -2,0 -1,0 0,0 1,0 -3,1 -2,1 -1,1 0,1 1,1 3,1 -3,2 -2,2 -1,2 0,2 2,2 -3,3 -2,3 -1,3 1,3";
const SHORES_GOLD = "4,-1";
const SHORES_EXP_LAND =
  "-2,-3 0,-3 1,-3 2,-3 3,-3 5,-3 -3,-2 -1,-2 0,-2 1,-2 2,-2 3,-2 5,-2 -2,-1 -1,-1 0,-1 1,-1 2,-1 3,-1 -3,0 -2,0 -1,0 0,0 1,0 2,0 3,0 -5,1 -3,1 -2,1 -1,1 0,1 1,1 2,1 4,1 -5,2 -3,2 -2,2 -1,2 0,2 1,2 3,2 -5,3 -3,3 -2,3 -1,3 0,3 2,3";
const SHORES_EXP_GOLD = "-4,-1 5,-1";
// A large radius-6 home island ringed by a sea moat, with four outer islets
// reached only by ship, one gold hex on each. 81 buildable tiles (77 land + 4
// gold) across 5 landmasses; seats up to 10. Decoded from a map builder share
// code.
const SHORES_LARGE_LAND =
  "-6,1 -6,3 -6,4 -6,5 -5,-1 -4,-2 -4,0 -4,1 -4,2 -4,3 -4,4 -3,-3 -3,-1 -3,0 -3,1 -3,2 -3,3 -3,4 -2,-4 -2,-2 -2,-1 -2,0 -2,1 -2,2 -2,3 -2,4 -1,-3 -1,-2 -1,-1 -1,0 -1,1 -1,2 -1,3 -1,4 0,-4 0,-3 0,-2 0,-1 0,0 0,1 0,2 0,3 0,4 1,-4 1,-3 1,-2 1,-1 1,0 1,1 1,2 1,3 2,-4 2,-3 2,-2 2,-1 2,0 2,1 2,2 2,4 3,-4 3,-3 3,-2 3,-1 3,0 3,1 3,3 4,-4 4,-3 4,-2 4,-1 4,0 4,2 5,1 6,-5 6,-4 6,-2 6,-1";
const SHORES_LARGE_GOLD = "-6,2 -1,-5 1,5 6,-3";
const ARCHIPELAGO_LAND =
  "0,-3 3,-3 5,-3 -1,-2 0,-2 2,-2 3,-2 5,-2 6,-2 -2,-1 -1,-1 1,-1 2,-1 5,-1 -2,1 1,1 2,1 4,1 5,1 -3,2 -2,2 0,2 1,2 3,2 4,2 -3,3 -2,3 0,3 2,3 3,3";
const ARCHIPELAGO_GOLD = "1,-3 6,-3";

const ISLANDS = "base+islands";

const US_LAND =
  "-8,-5 -8,-4 -9,-3 -9,-2 -10,-1 -10,0 -10,1 -10,2 -9,2 -8,1 -7,0 -6,-1 -5,-2 -4,-3 -3,-4 -2,-5 -1,-5 -1,-4 -2,-3 -3,-2 -4,-1 -5,0 -6,1 -7,2 -8,3 -7,3 -6,3 -5,2 -4,1 -3,0 -2,-1 -1,-2 0,-3 1,-4 2,-5 3,-5 3,-4 2,-3 1,-2 0,-1 -1,0 -2,1 -3,2 -4,3 -5,4 -4,4 -4,5 -3,5 -2,4 -1,3 0,2 1,1 2,0 3,-1 4,-2 5,-3 6,-4 5,-4 5,-5 4,-3 5,-2 5,-1 4,0 3,1 2,2 1,3 0,4 1,4 2,4 3,3 4,2 5,1 6,0 7,-1 8,-2 9,-3 10,-3 8,-3 9,-2 7,-2 6,1 5,2 2,5 2,3 3,2 4,1 5,0 6,-1 6,-2 3,-2 4,-1 2,-1 3,0 1,0 2,1 0,1 1,2 -1,2 0,3 -2,3 -1,4 -3,4 -3,3 -2,2 -1,1 0,0 1,-1 2,-2 3,-3 4,-4 4,-5 1,-5 2,-4 1,-3 0,-2 -1,-1 -2,0 -3,1 -4,2 -5,3 -6,2 -5,1 -4,0 -3,-1 -2,-2 -1,-3 0,-4 0,-5 -3,-5 -4,-5 -5,-4 -6,-3 -7,-2 -8,-1 -7,-3 -6,-4 -6,-5 -5,-5 -2,-4 -4,-4 -3,-3 -5,-3 -4,-2 -6,-2 -5,-1 -7,-1 -6,0 -8,0 -7,1 -8,2 -9,1 -9,0 -9,-1 -8,-2 -8,-3 -7,-4 -7,-5";
const CHINA_LAND =
  "7,-7 6,-6 5,-5 4,-4 3,-3 2,-2 1,-1 0,0 -1,1 -2,2 -3,3 -4,4 -5,5 -6,6 -7,7 -7,6 -5,6 -5,7 -4,7 -3,6 -2,5 -1,4 0,3 1,2 2,1 2,0 3,-1 4,-2 5,-3 6,-4 7,-5 8,-6 8,-5 8,-4 7,-3 8,-3 9,-4 10,-5 9,-5 7,-4 6,-3 5,-2 1,1 2,2 0,2 1,3 1,4 0,5 -1,6 -1,3 0,4 -2,4 -1,5 -3,5 -2,6 -3,7 -4,6 -6,5 -6,4 -5,3 -4,2 -3,1 -2,0 -1,-1 0,-2 -1,-2 -2,-2 -3,-1 -4,0 -5,1 -6,2 -7,3 -8,3 -9,4 -10,4 -10,3 -9,2 -8,1 -7,0 -6,-1 -5,-2 -4,-3 -5,-3 -6,-3 -7,-2 -8,-1 -9,0 -10,1 -11,2 -11,1 -11,0 -10,-1 -9,-2 -8,-3 -7,-4 -6,-5 -5,-5 -9,-3 -10,-2 -11,-1 -10,0 -9,-1 -8,-2 -6,-4 -7,-3 -4,-2 -6,-2 -5,-1 -7,-1 -6,0 -8,0 -7,1 -9,1 -10,2 -11,3 -11,4 -8,2 -9,3 -7,2 -6,1 -5,0 -4,-1 -3,-2 -2,-1 -3,0 -4,1 -5,2 -6,3 -7,4 -4,5 -5,4 -3,4 -4,3 -2,3 -3,2 -1,2 -2,1 0,1 -1,0 1,0 0,-1 2,-1 1,-2 3,-2 2,-3 4,-3 3,-4 5,-4 6,-5 7,-6 8,-7";
const JAPAN_LAND =
  "9,-12 9,-11 8,-10 7,-9 6,-8 7,-8 7,-7 8,-7 9,-8 10,-9 11,-10 12,-10 12,-9 10,-10 11,-9 9,-9 10,-8 8,-8 8,-9 9,-10 10,-11 10,-12 3,-4 3,-3 2,-2 1,-1 1,0 0,1 -1,2 -2,3 -3,4 -4,5 -5,6 -6,7 -7,7 -8,8 -9,9 -10,9 -11,9 -11,8 -10,7 -9,6 -8,6 -7,5 -6,5 -5,4 -10,6 -11,6 -9,7 -11,7 -9,8 -7,6 -8,7 -5,7 -4,7 -3,6 -2,5 -1,4 0,3 -1,5 -2,6 -3,7 -6,6 -4,6 -5,5 -3,5 -4,4 -2,4 -3,3 -1,3 -2,2 0,2 1,1 2,0 3,-1 4,-2 2,-1 3,-2 4,-3 4,-4 4,-5 5,-5 4,-6 5,-6 -6,10 -7,10 -6,11 -11,11 -12,11 -11,12 -12,12 -13,12";
const UK_LAND =
  "5,-9 4,-8 3,-7 2,-6 2,-5 2,-4 1,-3 2,-3 2,-2 1,-1 2,-1 2,0 2,1 2,2 1,3 0,4 -1,5 -2,6 -2,7 -3,8 -2,8 -1,8 0,7 1,6 2,5 3,4 4,3 4,2 5,1 5,0 4,0 4,-1 4,-2 5,-3 4,-3 4,-4 5,-5 6,-6 7,-7 6,-7 5,-7 4,-6 5,-6 4,-5 4,1 5,3 5,4 4,5 3,6 2,7 3,7 3,3 4,4 2,4 3,5 1,5 2,6 0,6 1,7 0,8 -1,7 -1,6 -2,5 0,5 1,4 0,3 2,3 3,2 3,1 3,0 3,-1 3,-2 3,-3 3,-4 3,-5 3,-6 2,-7 2,-8 1,-7 4,-7 5,-8 6,-9 -1,-2 -2,-1 -3,0 -4,1 -5,2 -6,3 -6,4 -7,5 -8,6 -7,6 -6,5 -5,4 -4,3 -3,2 -2,1 -1,0 -3,3 -4,4 -5,3 -6,2 -4,2 -5,1 -3,1 -2,0 -3,-1 -1,-1";
// The curated map gallery. Standard maps are full-hexagon shuffles. Country and
// islands maps are land only; their ocean is computed by `Frame` (at game start,
// and on preview load via useFramedGallery / framed-gallery.ts).
export const GALLERY: GalleryMap[] = [
  named(msg({ message: "Small", context: "map name" }), {
    id: "small",
    kind: "standard",
    ruleset: "base",
    board: fullLandBoard(2),
  }),
  named(msg({ message: "Medium", context: "map name" }), {
    id: "medium",
    kind: "standard",
    ruleset: "base",
    board: fullLandBoard(3),
  }),
  named(msg({ message: "Large", context: "map name" }), {
    id: "large",
    kind: "standard",
    ruleset: "base",
    board: fullLandBoard(4),
  }),

  named(msg({ message: "Shores (Small)", context: "map name" }), {
    id: "shores",
    kind: "islands",
    ruleset: ISLANDS,
    players: { min: 3, max: 4 },
    board: isleBoard(4, SHORES_LAND, SHORES_GOLD),
  }),
  named(msg({ message: "Shores (Medium)", context: "map name" }), {
    id: "shores-expanded",
    kind: "islands",
    ruleset: ISLANDS,
    players: { min: 5, max: 6 },
    board: isleBoard(5, SHORES_EXP_LAND, SHORES_EXP_GOLD),
  }),
  named(msg({ message: "Shores (Large)", context: "map name" }), {
    id: "shores-large",
    kind: "islands",
    ruleset: ISLANDS,
    players: { min: 7, max: 10 },
    board: isleBoard(6, SHORES_LARGE_LAND, SHORES_LARGE_GOLD),
  }),
  named(msg({ message: "Archipelago", context: "map name" }), {
    id: "archipelago",
    kind: "islands",
    ruleset: ISLANDS,
    players: { min: 5, max: 7 },
    board: isleBoard(6, ARCHIPELAGO_LAND, ARCHIPELAGO_GOLD),
  }),

  named(msg({ message: "United States", context: "map name" }), {
    id: "united-states",
    kind: "themed",
    ruleset: "base",
    board: geoBoard(13, US_LAND),
  }),
  named(msg({ message: "China", context: "map name" }), {
    id: "china",
    kind: "themed",
    ruleset: "base",
    board: geoBoard(12, CHINA_LAND),
  }),
  named(msg({ message: "Japan", context: "map name" }), {
    id: "japan",
    kind: "themed",
    ruleset: ISLANDS,
    board: geoBoard(14, JAPAN_LAND),
  }),
  named(msg({ message: "UK & Ireland", context: "map name" }), {
    id: "uk-ireland",
    kind: "themed",
    ruleset: ISLANDS,
    board: geoBoard(11, UK_LAND),
  }),
];
