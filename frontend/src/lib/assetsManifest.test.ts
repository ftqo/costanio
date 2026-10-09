import { test, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { ART_SLOT_IDS } from "./assets";

const MANIFEST_PATH = join(__dirname, "../../public/assets/manifest.json");

// Slots intentionally left unbaked. Empty now; kept so the next one has a home.
const INTENTIONALLY_BLANK = new Set<string>([]);

function loadManifest(): { version: number; slots: Record<string, { ext: string }> } {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw);
}

test("every art slot is in the manifest or intentionally blank", () => {
  const manifest = loadManifest();
  const manifestSlots = new Set(Object.keys(manifest.slots));
  const gaps: string[] = [];
  for (const id of ART_SLOT_IDS) {
    if (!manifestSlots.has(id) && !INTENTIONALLY_BLANK.has(id)) {
      gaps.push(id);
    }
  }
  expect(
    gaps,
    `Missing from manifest and not intentionally blank: ${gaps.join(", ")}`,
  ).toHaveLength(0);
});

// Each slot declares its extension (sounds are mp3), so resolve the file by
// that and only check SVG validity on SVGs.
test("every manifest slot has a file with its declared ext", () => {
  const manifest = loadManifest();
  const ASSETS_DIR = join(__dirname, "../../public/assets");
  for (const [key, entry] of Object.entries(manifest.slots)) {
    const filePath = join(ASSETS_DIR, `${key}.${entry.ext}`);
    expect(existsSync(filePath), `Missing file: ${filePath}`).toBe(true);
    if (entry.ext === "svg") {
      const contents = readFileSync(filePath, "utf-8");
      expect(contents, `File does not contain <svg: ${filePath}`).toContain("<svg");
    }
  }
});
