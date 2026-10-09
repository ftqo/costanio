// The board's code-drawn furniture: number tokens and harbor labels, which are
// per-tile data overlays rather than baked assets. Slots the pack bakes have no
// drawn stand-ins here.
import { pips } from "@/lib/hexgeo";
const S = 44; // board hex circumradius; token geometry is sized in board units

// --- Number token: chip background + data overlay ---
export function TokenChipArt({ cx, cy }: { cx: number; cy: number }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={S * 0.34}
      fill="var(--color-main-foreground)"
      stroke="var(--color-ink)"
      strokeWidth={2}
    />
  );
}
export function TokenLabel({ cx, cy, num }: { cx: number; cy: number; num: number }) {
  const red = num === 6 || num === 8;
  const fill = red ? "var(--color-red)" : "var(--color-ink)";
  return (
    <g transform={`translate(${cx},${cy})`} className="pointer-events-none">
      <text y={2} textAnchor="middle" fontSize={15} fontWeight={800} fill={fill}>
        {num}
      </text>
      <text y={13} textAnchor="middle" fontSize={7} fill={fill}>
        {"•".repeat(pips(num))}
      </text>
    </g>
  );
}

// --- Harbor: data overlay ---
const PORT_RES: Record<string, { label: string; color: string }> = {
  wood: { label: "WOOD", color: "var(--color-green)" },
  brick: { label: "BRICK", color: "var(--color-orange)" },
  sheep: { label: "SHEEP", color: "var(--color-sheep)" },
  wheat: { label: "WHEAT", color: "var(--color-yellow)" },
  ore: { label: "ORE", color: "var(--color-ore)" },
};
export function portInfo(res: string) {
  return PORT_RES[res] ?? { label: "ANY", color: "var(--color-port-any)" };
}
