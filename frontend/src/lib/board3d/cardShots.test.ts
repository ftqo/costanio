import { test, expect } from "vitest";
import { ICON_SHOTS, ICON_W, ICON_H } from "./cardShots";
import { SLOTS } from "@/lib/assets";
import manifest from "../../../public/assets/manifest.json";

test("every icon shot names a real 96x96 icon slot", () => {
  const icons = new Map(SLOTS.filter((s) => s.kind === "icon").map((s) => [s.id, s]));
  for (const shot of ICON_SHOTS) {
    expect(icons.has(shot.slot), shot.slot).toBe(true);
  }
  // The framing solve uses the frame's aspect, so a square slot must render
  // square.
  expect(ICON_W).toBe(ICON_H);
});

// Every icon slot must point at its baked prop, not fall back to SVG.
test("every icon slot resolves to the baked prop", () => {
  // The props are built to fill the cell and carry an inverted-hull contour,
  // and they separate better than the old glyphs at every size the game uses.
  const slots = manifest.slots as Record<string, { ext: string }>;
  for (const shot of ICON_SHOTS) {
    expect(slots[shot.slot]?.ext, shot.slot).toBe("webp");
  }
});
