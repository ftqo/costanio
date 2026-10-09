// Seat numerals: the non-colour half of colorblind mode on the 3D board.
//
// Ten distinguishable colours do not exist under a colour vision deficiency
// (see lib/colorblind), so past six or seven seats the owner's seat number is
// stamped over each building, as the flat board did.
//
// Sprites, because the camera orbits and tilts and the label must stay upright
// and facing the viewer. Drawn with `depthTest: false`, like the legal-move
// markers, so a numeral is never half-buried in the city it labels.
import * as THREE from "three";
import type { Placement } from "./instancing";

/** Height above the piece's top that the numeral floats, in world units. A
 * digit resting on the apex reads as part of the model. */
const HOVER = 0.34;
/**
 * On-screen size of the numeral, in world units. A bit smaller than a number
 * chip; half this size was only legible when zoomed in.
 */
export const NUMERAL_SIZE = 0.8;
/** Texture resolution. */
const TEX = 128;

/** `--color-main-foreground` / `--color-ink`: the 2D board's digit treatment. */
const FILL = "#ffffff";
const INK = "#1c2b4a";

/**
 * The digit as a texture: white numeral, heavy dark outline. The outline works
 * over every seat colour (like the 2D board's `paintOrder="stroke"`), so all
 * seats share one texture per digit.
 */
function numeralTexture(n: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, TEX, TEX);
    ctx.font = `900 ${TEX * 0.72}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    // Stroke first, then fill, so the outline grows outward and the white core
    // keeps its full width.
    ctx.strokeStyle = INK;
    ctx.lineWidth = TEX * 0.17;
    ctx.strokeText(String(n), TEX / 2, TEX * 0.54);
    ctx.fillStyle = FILL;
    ctx.fillText(String(n), TEX / 2, TEX * 0.54);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps stop the small mark crawling when zoomed out.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/**
 * One sprite per placement, all sharing one material for this seat number.
 * `topY` is the height of the labelled piece.
 */
export function buildSeatNumerals(
  seatNo: number,
  placements: Placement[],
  topY: number,
): THREE.Sprite[] {
  if (!placements.length) return [];
  const material = new THREE.SpriteMaterial({
    map: numeralTexture(seatNo),
    transparent: true,
    depthTest: false,
    // Overlapping numerals would punch holes in each other if this wrote depth.
    depthWrite: false,
  });
  return placements.map((p) => {
    const s = new THREE.Sprite(material);
    s.position.set(p.position[0], topY + HOVER, p.position[2]);
    s.scale.setScalar(NUMERAL_SIZE);
    // Drawn last, above the board and the markers both.
    s.renderOrder = 10;
    // The bounding sphere comes from the unit quad, so board-extent culling
    // hides numerals near the rim.
    s.frustumCulled = false;
    return s;
  });
}

/** Frees the sprites' material and texture. Geometry is three's shared unit quad. */
export function disposeSeatNumerals(sprites: THREE.Sprite[]): void {
  const seen = new Set<THREE.SpriteMaterial>();
  for (const s of sprites) {
    const m = s.material;
    if (!seen.has(m)) {
      seen.add(m);
      m.map?.dispose();
      m.dispose();
    }
    s.removeFromParent();
  }
}
