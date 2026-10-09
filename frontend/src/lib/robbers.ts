// The robber skins this client can draw, keyed by catalog id.
//
// This table, the row in cosmetics/catalog.go and the model under
// public/models/robbers/ must agree; `robbers.assets.test.ts` checks them.
// The designs come from tools/blender/robber_designs.py, exported by
// tools/robbers/export_skins.py.
//
// A design is a shape; a chroma is one colourway of it. A chroma names the
// same file and carries three colours, so it adds no download. Colours are
// linear RGB, as in the glb's baseColorFactor and palette.json, so they are
// assigned without conversion. They are generated from
// `robber_designs.CHROMAS`, not typed by hand.
export interface RobberSkin {
  file: string;
  label: string;
  /** Per-slot override, linear RGB. Absent = the colour baked into the file. */
  colors?: {
    body: [number, number, number];
    shade: [number, number, number];
    detail: [number, number, number];
  };
}

export const ROBBERS: Record<string, RobberSkin> = {
  "robber.brigand": { file: "robbers/brigand.glb", label: "Brigand" },
  "robber.sentinel": { file: "robbers/sentinel.glb", label: "Sentinel" },
  "robber.keg": { file: "robbers/keg.glb", label: "Keg" },
  "robber.crow": { file: "robbers/crow.glb", label: "Crow" },
  "robber.hourglass": { file: "robbers/hourglass.glb", label: "Hourglass" },
  "robber.brazier": { file: "robbers/brazier.glb", label: "Brazier" },
  "robber.shard": { file: "robbers/shard.glb", label: "Crystal" },
  "robber.shard.rose": {
    file: "robbers/shard.glb",
    label: "Crystal Rose",
    colors: {
      body: [0.34, 0.085, 0.185],
      shade: [0.072, 0.028, 0.045],
      detail: [0.64, 0.37, 0.47],
    },
  },
  "robber.shard.verdant": {
    file: "robbers/shard.glb",
    label: "Crystal Verdant",
    colors: { body: [0.055, 0.245, 0.15], shade: [0.025, 0.062, 0.042], detail: [0.3, 0.575, 0.4] },
  },
};

/** Material names the skins ship with, one per slot. */
export const ROBBER_MATERIAL = {
  body: "Mat_RobberSkin_Body",
  shade: "Mat_RobberSkin_Shade",
  detail: "Mat_RobberSkin_Detail",
} as const;
