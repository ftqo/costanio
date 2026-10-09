// Photograph the robber prototypes through the game's own shot rig
// (`renderShotBlobs` in `thumbnail.ts`), framed, lit and encoded exactly as
// the knight's build tile.
//
// Dev-only: it ships nothing. Drive it with:
//
//     cd frontend && npx vite --port 6789
//     open http://localhost:6789/dev/robber-shots.html
//
// The pieces come from `frontend/public/models/robbers.glb`
// (`tools/blender/export_robbers_glb.py`).
import { renderShotBlobs, THUMB_W, THUMB_H, type PieceShot } from "../src/lib/board3d/thumbnail";
import { SHOP_SHOTS } from "../src/lib/board3d/thumbnail";

const DESIGNS = [
  "classic",
  "hooded",
  "brigand",
  "wraith",
  "sentinel",
  "menhir",
  "cairn",
  "keg",
  "lantern",
  "swagbag",
  "bruin",
  "skullpost",
  "anvil",
  "toadstool",
  "crow",
  "hourglass",
  "brazier",
  "shard",
  "padlock",
  "scarecrow",
  "ashcone",
];

// Design -> the chromas it ships with, mirroring `robber_designs.CHROMAS`.
// Every design has a base; only the crystal has more so far.
const CHROMAS: Record<string, string[]> = {
  shard: ["base", "verdant", "rose"],
};

const variants = DESIGNS.flatMap((name) =>
  (CHROMAS[name] ?? ["base"]).map((chroma) => ({ name, chroma })),
);

// The knight's tile, rendered alongside as the reference.
const KNIGHT = SHOP_SHOTS.filter((s) => s.slot === "build_knight");

// 20 degrees, as for the knight, turns each piece's asymmetric feature (beak,
// snout, horn, all facing +X) off square so it is neither shadowed nor
// edge-on.
const YAW = 20;

// A shade above the knight's 0.58. These are single upright pieces with no
// outstretched parts, so they can sit larger in the frame before the contact
// shadow clips.
const FILL = 0.64;

// The designs that carry their own palette (`robber_designs.PALETTE`). Kept as
// a plain list because this harness reads the .glb, not the Python.
const COLORED = new Set(["shard", "hourglass", "brazier", "crow", "keg", "sentinel", "brigand"]);

// Exposure lift. The rig is balanced for 0.3-0.5 albedo; `Mat_Robber` is 0.08
// and reads as a black shape at 1.0, while painted designs (around 0.23) need
// barely any lift and wash out at 1.9.
const LIFT_BLACK = 1.9;
const LIFT_COLORED = 1.25;

// `?exposure=` overrides both, for comparing stops.
const OVERRIDE = new URLSearchParams(location.search).get("exposure");

const SHOTS: PieceShot[] = variants.map(({ name, chroma }) => ({
  slot: chroma === "base" ? `robber_${name}` : `robber_${name}_${chroma}`,
  // The double underscore is part of the node name, so `Robber_shard` does not
  // also match its chromas. See `build_robbers.node_name`.
  parts: [{ file: "robbers.glb", prefix: `Robber_${name}__${chroma}` }],
  yawDeg: YAW,
  fill: FILL,
  exposure: OVERRIDE ? Number(OVERRIDE) : COLORED.has(name) ? LIFT_COLORED : LIFT_BLACK,
}));

const SEAT = new URLSearchParams(location.search).get("seat") ?? "#c9553d";

async function main() {
  const byColor = await renderShotBlobs([SEAT], {
    shots: [...KNIGHT, ...SHOTS],
    size: { w: THUMB_W, h: THUMB_H },
  });
  const shots = byColor.get(SEAT) ?? {};
  const grid = document.getElementById("grid")!;
  const out: Record<string, string> = {};

  for (const [slot, blob] of Object.entries(shots)) {
    const url = await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(blob);
    });
    out[slot] = url;
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = url;
    img.id = `shot_${slot}`;
    const cap = document.createElement("figcaption");
    cap.textContent = slot;
    fig.append(img, cap);
    grid.append(fig);
  }

  // Where the driver picks them up; it waits on the "done" flag.
  (window as unknown as Record<string, unknown>).SHOTS = out;
  (window as unknown as Record<string, unknown>).SHOTS_DONE = true;
  document.title = `Robber shots (${Object.keys(out).length})`;
}

void main();
