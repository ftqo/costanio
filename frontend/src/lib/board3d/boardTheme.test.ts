import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOARD_LOOKS,
  DEFAULT_BOARD_POSTFX,
  boardLook,
  boardMode,
  isIdentityGrade,
  onBoardModeChange,
} from "./boardTheme";
import { PAGE_BLUE_HEX, SKY_HEX } from "./seaColor";
import { oceanSky } from "./oceanEnv";

/** The `.dark` block, which is where every night token lives. */
function darkBlock(): string {
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const at = css.indexOf(".dark {");
  expect(at, "index.css no longer has a .dark block").toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

test("fog colour equals the page colour in both looks", () => {
  // The fog colour must equal the page colour, because `oceanRadius` ends the
  // water where fog has faded it to the page. If they differ the sea shows a
  // rim. The game route must also paint `bg-background`, not `bg-ocean`.
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  const light = css.match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/);
  expect(light, "index.css no longer declares --background as a hex literal").toBeTruthy();
  expect(BOARD_LOOKS.light.pageHex.toLowerCase()).toBe(light![1].toLowerCase());

  const dark = darkBlock().match(/--background:\s*(#[0-9a-fA-F]{6})\s*;/);
  expect(dark, ".dark no longer declares --background as a hex literal").toBeTruthy();
  expect(BOARD_LOOKS.dark.pageHex.toLowerCase()).toBe(dark![1].toLowerCase());
});

test("the day look uses the base constants", () => {
  // Light mode is pinned to the module-level constants.
  const day = boardLook("light");
  expect(day.pageHex).toBe(PAGE_BLUE_HEX);
  expect(day.skyHex).toBe(SKY_HEX);
  expect(day.key.intensity).toBe(1.5);
  expect(day.key.hex).toBe(0xffffff);
  expect(day.ambient.hex).toBe(0xffffff);
  expect(day.ambient.intensity).toBe(0.35);
  // The day sea's roughness is 0.16.
  expect(day.water.roughness).toBe(0.16);
  // The other looks are scaled from it, keeping their ordering.
  expect(boardLook("dark").water.roughness).toBeGreaterThan(day.water.roughness);
  expect(boardLook("light", true).water.roughness).toBeLessThan(day.water.roughness);
});

test("only the day board casts shadows", () => {
  // A moon does not cast shadows. This also skips the shadow-map pass.
  expect(boardLook("light").key.castShadow).toBe(true);
  expect(boardLook("dark").key.castShadow).toBe(false);
});

test("night look differs from a dimmed day", () => {
  // Night is not a dimmed key: it is a cool cast and a dark sea, and the key
  // is brighter so the tiles stay legible.
  const day = boardLook("light");
  const night = boardLook("dark");
  expect(night.key.hex).not.toBe(day.key.hex);
  expect(night.ambient.hex).not.toBe(day.ambient.hex);
  expect(night.key.intensity).toBeGreaterThan(day.key.intensity);
  const lum = (c: readonly [number, number, number]) =>
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  expect(lum(night.water.color)).toBeLessThan(lum(day.water.color) / 4);
});

test("the night sea is rough enough not to glitter", () => {
  // A near-mirror sea turns a single light into a field of glitter, which is
  // all that shows against a dark sea. That is direct specular, so only
  // roughness fixes it.
  expect(boardLook("dark").water.roughness).toBeGreaterThan(boardLook("light").water.roughness * 3);
});

test("each look gets its own sky texture, built once", () => {
  // One stored sky per look. A fresh DataTexture per call would rebuild 128 KB
  // of float radiance and rerun the PMREM conversion each time.
  const day = oceanSky(boardLook("light"));
  const night = oceanSky(boardLook("dark"));
  expect(oceanSky(boardLook("light"))).toBe(day);
  expect(oceanSky(boardLook("dark"))).toBe(night);
  expect(night).not.toBe(day);

  // The post-processed look has its own sky.
  const post = oceanSky(boardLook("dark", true));
  expect(post).not.toBe(night);
  expect(oceanSky(boardLook("dark", true))).toBe(post);
});

test("post-processing does not change pageHex", () => {
  // `pageHex` comes from a per-mode constant no look spec can reach; this keeps
  // it that way. The grade breaks the same invariant through the shader, which
  // `gradedPageHex` handles and `postfx.test.ts` pins.
  for (const postFx of [false, true]) {
    expect(boardLook("light", postFx).pageHex).toBe(BOARD_LOOKS.light.pageHex);
    expect(boardLook("dark", postFx).pageHex).toBe(BOARD_LOOKS.dark.pageHex);
  }
});

test("the plain look has no grade, bloom, motes or emissive", () => {
  // A look that grades or blooms adds a render target and a full-screen pass
  // (see `oceanPass.ts`), about five times the cost of a water-only frame, so
  // the plain look must have neither.
  for (const mode of ["light", "dark"] as const) {
    const look = boardLook(mode, false);
    expect(isIdentityGrade(look.grade)).toBe(true);
    expect(look.bloom).toBeNull();
    expect(look.motes).toBeNull();
    expect(look.emissive).toBe(0);
  }
});

test("post-processing is off by default", () => {
  // Post-processing roughly quintuples the cost of the water-only frame the
  // ocean clock runs ~30 times a second, so it is off by default.
  expect(DEFAULT_BOARD_POSTFX).toBe(false);
  expect(boardLook("light")).toBe(BOARD_LOOKS.light);
  expect(boardLook("dark")).toBe(BOARD_LOOKS.dark);
});

test("both settings declare a day and a night", () => {
  // Post-processing is the viewer's choice and the mode follows the site
  // theme, so every combination must exist.
  for (const postFx of [false, true]) {
    for (const mode of ["light", "dark"] as const) {
      const look = boardLook(mode, postFx);
      expect(look.id).toBe(`${postFx ? "post" : "plain"}:${mode}`);
      expect(look.postFx).toBe(postFx);
      expect(look.mode).toBe(mode);
    }
  }
});

test("the night blooms lower than the day", () => {
  // The threshold is linear radiance and the looks differ a lot: the day peaks
  // at 1.29 and the night at 0.96 (medians 0.79 and 0.10). One threshold would
  // wash out the day or miss the night.
  const day = boardLook("light", true).bloom;
  const night = boardLook("dark", true).bloom;
  expect(day).not.toBeNull();
  expect(night).not.toBeNull();
  expect(night!.threshold).toBeLessThan(day!.threshold);
});

test("emissive glow is stronger at night", () => {
  // `emissive` scales the palette's emissive: dull at noon, bright at night.
  expect(boardLook("dark", true).emissive).toBeGreaterThan(boardLook("light", true).emissive);
});

test("boardMode reads the theme class", () => {
  // `lib/theme.ts` toggles a class on `documentElement`. WebGL has no cascade,
  // so the board reads that class.
  document.documentElement.classList.remove("dark");
  expect(boardMode()).toBe("light");
  document.documentElement.classList.add("dark");
  expect(boardMode()).toBe("dark");
  document.documentElement.classList.remove("dark");
});

test("notifies once per real mode change", () => {
  // The class list changes for unrelated reasons; only a real mode change
  // should rebuild.
  const seen: string[] = [];
  document.documentElement.classList.remove("dark");
  const stop = onBoardModeChange((m) => seen.push(m));
  document.documentElement.classList.add("unrelated");
  document.documentElement.classList.add("dark");
  document.documentElement.classList.add("also-unrelated");
  return new Promise<void>((done) => {
    setTimeout(() => {
      stop();
      document.documentElement.className = "";
      expect(seen).toEqual(["dark"]);
      done();
    }, 0);
  });
});
