// Flat hex-cluster thumbnails for the mode pickers and the rules page.

export const SEA = "var(--color-sea)";
export const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

interface Cell {
  left: number;
  top: number;
}

/** Lay out hex rows centered; W = horizontal step, rowY = vertical step. */
function mkCells(rows: number[], W: number, rowY: number): Cell[] {
  const maxN = Math.max(...rows);
  const cells: Cell[] = [];
  for (let r = 0; r < rows.length; r++) {
    const n = rows[r];
    const x0 = ((maxN - n) / 2) * W;
    for (let c = 0; c < n; c++) {
      cells.push({ left: Math.round(x0 + c * W) + 2, top: r * rowY });
    }
  }
  return cells;
}

// ---- Mini 7-hex clusters (mode thumbnails) ----
const miniCells = mkCells([2, 3, 2], 34, 29);
export const mkMini = (colors: string[]): { left: number; top: number; color: string }[] =>
  miniCells.map((p, i) => ({ left: p.left, top: p.top, color: colors[i] }));

export const modeClassic = mkMini([
  "var(--color-green)",
  "var(--color-yellow)",
  "var(--color-orange)",
  "var(--color-sheep)",
  "var(--color-ore)",
  "var(--color-yellow)",
  "var(--color-green)",
]);
export const modeSea = mkMini([
  SEA,
  "var(--color-green)",
  SEA,
  "var(--color-desert)",
  SEA,
  "var(--color-sheep)",
  SEA,
]);
export const modeKnights = mkMini([
  "var(--color-ore)",
  "var(--color-purple)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-yellow)",
  "var(--color-orange)",
  "var(--color-ore)",
]);
