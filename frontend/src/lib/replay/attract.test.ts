import { describe, it, expect } from "vitest";
import { holdMs, DEFAULT_HOLD_MS } from "./driver";
import { ATTRACT, ATTRACT_SPEED } from "./attract";

/**
 * The homepage's recording, checked for the properties it was chosen for, so
 * a regeneration that loses one fails instead of shipping a duller loop.
 *
 * To regenerate, see `attract.ts`, which has the commands.
 */
const SOURCE = ATTRACT;

/** Everything a trimmed recording is allowed to contain: pieces moving. */
const PLACEMENT = new Set([
  "settlement_placed",
  "setup_city_placed",
  "road_placed",
  "settlement_built",
  "city_built",
  "road_built",
  "robber_moved",
]);

/**
 * Playback time to a frame, in seconds, at the page's actual speed. The speed
 * is imported because the budget is in seconds on screen.
 */
function secondsTo(index: number): number {
  let ms = 0;
  for (let i = 0; i <= index; i++) ms += holdMs(SOURCE.frames[i]?.type, ATTRACT_SPEED);
  return ms / 1000;
}

const count = (type: string) => SOURCE.frames.filter((f) => f.type === type).length;

describe("the homepage's attract loop", () => {
  // No bookkeeping at all (rolls, trades, discards, card draws): only pieces
  // arriving, from the first setup settlement to the win. That is what lets a
  // whole game play in under three minutes; see `replay.Trim`.
  it("contains nothing but placements, and the win", () => {
    const strays = SOURCE.frames
      .map((f, i) => ({ i, type: f.type }))
      .filter(({ i, type }) => !PLACEMENT.has(type) && !(i === SOURCE.frames.length - 1));
    expect(strays, `not a placement: ${strays.map((s) => `${s.i}:${s.type}`).join(", ")}`).toEqual(
      [],
    );
  });

  it("opens on an empty board and plays the game from its first placement", () => {
    // After trimming the opening is the densest part, so the loop starts at the
    // beginning of the game.
    const first = SOURCE.frames[0];
    expect(first.view.board?.tiles.length ?? 0).toBeGreaterThan(0);
    expect(first.type).toBe("settlement_placed");
    expect(first.view.buildings.length).toBeLessThanOrEqual(1);
    expect(first.view.roads.length).toBe(0);
  });

  it("plays through to somebody winning", () => {
    const last = SOURCE.frames[SOURCE.frames.length - 1];
    expect(last.type).toBe("game_finished");
    expect(SOURCE.meta.winner).toBeGreaterThanOrEqual(0);
    expect(Math.max(...SOURCE.meta.scores)).toBeGreaterThanOrEqual(10);
  });

  // Several of each piece, so it reads as a game being played.
  it("builds roads, settlements and cities, several of each", () => {
    expect(count("city_built")).toBeGreaterThanOrEqual(3);
    expect(count("settlement_built")).toBeGreaterThanOrEqual(3);
    expect(count("road_built")).toBeGreaterThanOrEqual(6);
  });

  it("gets to a city while a visitor is still looking", () => {
    const at = SOURCE.frames.findIndex((f) => f.type === "city_built");
    expect(at, "no city in the recording").toBeGreaterThan(-1);
    expect(secondsTo(at)).toBeLessThan(60);
  });

  it("keeps every seat in the game", () => {
    // One seat building everything would leave most of the board empty.
    const builders = new Set(
      SOURCE.frames
        .filter((f) => f.type === "settlement_built" || f.type === "city_built")
        .map((f) => (f.event?.data as { player: number } | undefined)?.player),
    );
    expect(builders.size).toBe(SOURCE.meta.players);
  });

  it("never loses a city once it is up", () => {
    let most = 0;
    for (const f of SOURCE.frames) {
      const cities = f.view.buildings.filter((b) => b.city).length;
      expect(cities).toBeGreaterThanOrEqual(most);
      most = cities;
    }
    expect(most).toBeGreaterThanOrEqual(3);
  });

  it("loops soon enough to come round again", () => {
    const whole = secondsTo(SOURCE.frames.length - 1);
    // Long enough to be a game, short enough not to drag. Every frame is a
    // placement after the trim, so seconds are the thing to bound.
    expect(whole).toBeGreaterThan(45);
    expect(whole).toBeLessThan(210);
  });

  // The frames ship in the page's lazy chunk. Raw size overstates the download
  // (328 KB raw is 6.3 KB served), so this is a loose net; the real budget is
  // `-max-gzip` in the search that produced the file.
  it("stays small enough to ship in the page", () => {
    expect(JSON.stringify(SOURCE).length).toBeLessThan(1_200_000);
  });

  it("is paced by the driver's own table, not by a default", () => {
    // Every placement type should have an entry in HOLD_MS; a miss falls back
    // to the default beat.
    const paced = SOURCE.frames.filter(
      (f) => holdMs(f.type, ATTRACT_SPEED) !== DEFAULT_HOLD_MS / ATTRACT_SPEED,
    );
    expect(paced.length).toBe(SOURCE.frames.length);
  });
});
