import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReplayFrame, ReplaySource } from "@/lib/replay/types";
import type { FullView } from "@/lib/types";

/**
 * When a replay plays sounds and animations. Scrubbing, jumping to the end
 * and stepping backwards aren't events happening, so cues fire only on a step
 * of exactly one forward (playback and the step button). Otherwise a scrubber
 * drag would fire dozens of thunks and a step back would rebuild a settlement.
 */

interface Hoisted {
  play: Mock<(slot: string, opts?: unknown) => void>;
  flipChips: Mock<(total: number) => void>;
  flipRobber: Mock<() => void>;
  pulseRobber: Mock<() => void>;
  colorOf: ((seat: number) => string) | null;
}
const h = vi.hoisted<Hoisted>(() => ({
  play: vi.fn(),
  flipChips: vi.fn(),
  flipRobber: vi.fn(),
  pulseRobber: vi.fn(),
  colorOf: null,
}));

// Board3D needs a WebGL context jsdom lacks, so this marker publishes the
// imperative handle the player drives.
vi.mock("@/components/board/Board3D", () => ({
  Board3D: (p: { controlsRef?: React.RefObject<unknown>; colorOf?: (seat: number) => string }) => {
    h.colorOf = p.colorOf ?? null;
    if (p.controlsRef && "current" in p.controlsRef) {
      (p.controlsRef as { current: unknown }).current = {
        flipChips: h.flipChips,
        flipRobber: h.flipRobber,
        pulseRobber: h.pulseRobber,
        resetView: vi.fn(),
        swapChips: vi.fn(),
        standDownKnights: vi.fn(),
        setAutoOrbit: vi.fn(),
      };
    }
    return React.createElement("div", { "data-testid": "board" });
  },
}));

vi.mock("@/lib/sound", async (orig) => {
  const real = await orig<typeof import("@/lib/sound")>();
  return { ...real, play: h.play, preload: vi.fn(), diceSlot: () => "sound_dice-0" };
});

// The persisted settings hook reaches localStorage and the audio manager; the
// player only needs the sound gate.
vi.mock("@/components/SettingsPanel", () => ({
  useAppSettings: () => ({ sounds: true, toggleSounds: vi.fn() }),
}));

const { ReplayPlayer } = await import("./ReplayPlayer");

const board = {
  tiles: [{ hex: { q: 0, r: 0 }, num: 8, res: 1 }],
  robber: { q: 5, r: 5 },
} as unknown as FullView["board"];

// Two seats with hands, as a revealed fold provides (replay.FoldRevealed). Seat
// 1 holds nothing, so the empty case shows too.
const players = [
  { seat: 0, hand_count: 3, hand: [0, 2, 1, 0, 0, 0], vp: 4, dev_cards: [1, 0, 0, 0, 0] },
  { seat: 1, hand_count: 0, hand: [0, 0, 0, 0, 0, 0], vp: 2 },
] as unknown as FullView["players"];

function frame(seq: number, type: string, data?: unknown): ReplayFrame {
  return {
    seq,
    type,
    event: { seq, type, data },
    view: { board, players } as unknown as FullView,
  };
}

// A short log: a board to draw, then a settlement, an 8, and a seven.
const SOURCE: ReplaySource = {
  meta: { game_id: "g", players: 2, ruleset: "base", winner: 0, scores: [], events: 4 },
  frames: [
    frame(0, "board_generated"),
    frame(1, "settlement_built", { player: 0 }),
    frame(2, "dice_rolled", { player: 0, d1: 4, d2: 4 }),
    frame(3, "dice_rolled", { player: 1, d1: 3, d2: 4 }),
  ],
};

// jsdom has no layout, so the feed's follow-the-playhead scroll is stubbed
// here rather than guarded in the component.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

let host: HTMLDivElement;
let root: Root;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(React.createElement(ReplayPlayer, { source: SOURCE, title: null }));
  });
}

/** The step-forward control, found by the label it carries for screen readers. */
function press(label: string) {
  const el = [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label,
  );
  if (!el) throw new Error(`no control labelled ${label}`);
  act(() => el.click());
}

beforeEach(() => {
  h.play.mockClear();
  h.flipChips.mockClear();
  h.flipRobber.mockClear();
  h.pulseRobber.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("hand reveal", () => {
  // The seat chips show the public count whether or not the hand is open; it
  // tells you which hand is worth opening.
  it("opens one seat at a time and toggles it closed", () => {
    mount();
    const chip = (seat: number) =>
      [...host.querySelectorAll("button")].filter((b) =>
        b.textContent?.includes(`Seat ${seat + 1}`),
      )[0];

    // Nothing is open until asked.
    expect(host.textContent).not.toContain("VP");

    act(() => chip(0).click());
    expect(host.textContent).toContain("4 VP");
    expect(host.textContent).toContain("1 dev");

    // The other seat replaces it rather than joining it.
    act(() => chip(1).click());
    expect(host.textContent).toContain("2 VP");
    expect(host.textContent).toContain("Empty hand");

    // And clicking the open seat puts it away.
    act(() => chip(1).click());
    expect(host.textContent).not.toContain("VP");
  });
});

describe("replay cues", () => {
  it("plays nothing on the opening frame", () => {
    mount();
    expect(h.play).not.toHaveBeenCalled();
    expect(h.flipChips).not.toHaveBeenCalled();
  });

  it("plays one cue per forward step and flips chips on a roll", () => {
    mount();
    press("Step forward one move"); // the settlement
    expect(h.play).toHaveBeenCalledTimes(1);
    expect(h.play.mock.calls[0][0]).toBe("sound_place");

    h.play.mockClear();
    press("Step forward one move"); // an 8
    expect(h.play.mock.calls.map((c) => c[0])).toEqual(["sound_dice-0"]);
    expect(h.flipChips).toHaveBeenCalledWith(8);
    // No chip carries a seven, so nothing turns the robber over for an 8.
    expect(h.flipRobber).not.toHaveBeenCalled();
  });

  it("plays the seven cue and flips the robber on a seven", () => {
    mount();
    press("Step forward one move");
    press("Step forward one move");
    h.play.mockClear();
    h.flipRobber.mockClear();
    press("Step forward one move"); // the seven
    expect(h.play.mock.calls.map((c) => c[0])).toContain("sound_seven");
    expect(h.flipRobber).toHaveBeenCalledTimes(1);
  });

  it("plays nothing when stepping back", () => {
    mount();
    press("Step forward one move");
    h.play.mockClear();
    press("Step back one move");
    expect(h.play).not.toHaveBeenCalled();
    expect(h.flipChips).not.toHaveBeenCalled();
  });

  // The End key seeks to the last frame, three events away in one move. The
  // scrubber is covered too: both go through `seek`, which isn't a step.
  it("plays nothing when seeking", () => {
    mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    });
    expect(h.play).not.toHaveBeenCalled();
    expect(h.flipChips).not.toHaveBeenCalled();
  });
});

it("draws each seat in its legend colour", () => {
  // The board must get the players' own colours, as the legend and log do (a
  // guest who played cyan must not be drawn purple).
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      React.createElement(ReplayPlayer, {
        source: SOURCE,
        title: null,
        seats: [
          { seat: 0, name: "A", color: "#ff0000" },
          { seat: 1, name: "B", color: "#00ffff" },
        ],
      }),
    );
  });
  expect(h.colorOf).not.toBeNull();
  expect(h.colorOf!(1)).toBe("#00ffff");
  expect(h.colorOf!(0)).toBe("#ff0000");
});
