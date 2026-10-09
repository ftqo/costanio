import { test, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { KIND_BY_ID } from "./decorations";

// Every decoration kind must have its animated GIF and its reduced-motion
// first-frame still deployed under public/, or the name renders a broken image.
// The gif/png filename is the kind with dashes turned back into underscores
// (e.g. kind "fire-blue" -> fire_blue.gif / fire_blue_static.png).
const DIR = join(__dirname, "../../public/cosmetics/decorations");

test("every decoration kind has a deployed gif and static still", () => {
  const missing: string[] = [];
  for (const [id, kind] of Object.entries(KIND_BY_ID)) {
    const stem = kind.replaceAll("-", "_");
    for (const file of [`${stem}.gif`, `${stem}_static.png`]) {
      if (!existsSync(join(DIR, file))) missing.push(`${id} -> ${file}`);
    }
  }
  expect(missing).toEqual([]);
});
