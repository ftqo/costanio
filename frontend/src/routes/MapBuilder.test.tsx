import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultConfig } from "@/lib/format";
import { dismiss, undismiss } from "@/lib/dismissed";
import type { Board, MapRow } from "@/lib/types";

// A design board (pinned producing resource + number): detectMode gives "design".
const designBoard: Board = {
  radius: 2,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: [
    { hex: { q: 0, r: 0 }, res: "none", num: 0 },
    { hex: { q: 1, r: 0 }, res: "wood", num: 6 },
    { hex: { q: 0, r: 1 }, res: "brick", num: 8 },
  ],
};

// A blank board: generic land, no numbers, no ports. A drawn shape before any
// roll.
const blankLandBoard: Board = {
  radius: 2,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: [
    { hex: { q: 0, r: 0 }, res: "land", num: 0 },
    { hex: { q: 1, r: 0 }, res: "land", num: 0 },
    { hex: { q: 0, r: 1 }, res: "land", num: 0 },
    { hex: { q: -1, r: 0 }, res: "land", num: 0 },
  ],
};

// What a roll hands back: the same four hexes, resolved and numbered.
const rolledBoard: Board = {
  radius: 2,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: [
    { hex: { q: 0, r: 0 }, res: "none", num: 0 },
    { hex: { q: 1, r: 0 }, res: "wood", num: 6 },
    { hex: { q: 0, r: 1 }, res: "brick", num: 8 },
    { hex: { q: -1, r: 0 }, res: "ore", num: 5 },
  ],
};

// Hoisted spies so individual tests can vary the handoff / capture API + nav calls.
const h = vi.hoisted(() => ({
  takeBuilderBoard: vi.fn(),
  takeBuilderSource: vi.fn(),
  createGame: vi.fn(),
  updateConfig: vi.fn(),
  navigate: vi.fn(),
  maps: [] as any[],
  deleteMap: vi.fn(),
  randomizeMap: vi.fn(),
  harborsMap: vi.fn(),
}));

// Mock the provider-bound hooks so MapBuilder renders without app context.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { id: 1, name: "T" } }) }));
vi.mock("@/components/AbandonGuard", () => ({ useAbandonGuard: () => async () => true }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
}));
// The lobby handoff hands us the design board on mount, so the shell enters
// design mode and the design-only sidebar (Regenerate + WarningsPanel) renders.
vi.mock("@/lib/maps/handoff", () => ({
  takeBuilderBoard: h.takeBuilderBoard,
  takeBuilderSource: h.takeBuilderSource,
}));
vi.mock("@/lib/api", () => ({
  api: {
    createGame: h.createGame,
    updateConfig: h.updateConfig,
    randomizeMap: h.randomizeMap,
    saveMap: vi.fn(),
    encodeMap: vi.fn(),
    decodeMap: vi.fn(),
    listMaps: vi.fn(),
    deleteMap: h.deleteMap,
    // The live preview frames the built board (debounced); return it unchanged.
    frameMap: vi.fn((b) => Promise.resolve(b)),
    harborsMap: h.harborsMap,
    previewBoard: vi.fn(() => new Promise(() => {})),
  },
  ApiErr: class ApiErr extends Error {},
}));
// Keep lint quiet/deterministic; the panel still renders its empty state.
vi.mock("@/lib/maps/useLint", () => ({ useLint: () => [] }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { maps: h.maps }, refetch: vi.fn() }),
}));

// The canvas-size slider is a Radix primitive that measures its own thumb, and
// jsdom has no ResizeObserver. Nothing here depends on the measurement.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { MapBuilder } from "./MapBuilder";
import { ConfirmProvider } from "@/components/ui/confirm";

function mount(ui: React.ReactElement) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r: Root = createRoot(c);
  act(() => r.render(<ConfirmProvider>{ui}</ConfirmProvider>));
  return { c, r };
}

/**
 * Flip the "desert in the middle" switch. It is off by default, so this turns
 * it on: a roll then pins one desert on the centre tile.
 */
function toggleCenterDesert(c: HTMLElement) {
  const sw = c.querySelector('[data-testid="center-desert"]');
  expect(sw, "center-desert switch present").toBeTruthy();
  return act(async () => {
    sw!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickTestId(c: HTMLElement, id: string) {
  const el = c.querySelector(`[data-testid="${id}"]`);
  expect(el, `${id} present`).toBeTruthy();
  return act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function clickButton(c: HTMLElement, label: string) {
  const btn = [...c.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(btn, `button "${label}" present`).toBeTruthy();
  return act(async () => {
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("MapBuilder shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.maps = [];
    h.takeBuilderBoard.mockReturnValue(designBoard);
    h.takeBuilderSource.mockReturnValue(null);
  });

  it("loads the handoff board fully rolled", () => {
    const { c, r } = mount(<MapBuilder />);
    const text = c.textContent ?? "";
    expect(text).toContain("Randomize");
    // Nothing has been typed, so no seed is owed a roll and no apply button shows.
    expect(c.querySelector('[data-testid="tile-seed-apply"]')).toBeNull();
    expect(c.querySelector('[data-testid="port-seed-apply"]')).toBeNull();
    // WarningsPanel header. Case-insensitive because CSS draws it in caps; the
    // DOM text is whatever the active catalogue holds.
    expect(text.toLowerCase()).toContain("issues");
    // The three tool tabs and the preview button are there.
    expect(c.querySelector("[data-tooltab=shape]")).toBeTruthy();
    expect(c.querySelector("[data-tooltab=tiles]")).toBeTruthy();
    expect(c.querySelector("[data-tooltab=harbors]")).toBeTruthy();
    expect(c.querySelector('[data-testid="open-preview"]')).toBeTruthy();
    act(() => r.unmount());
  });

  // A fresh builder opens on a blank hexagon, and the roll reads as Generate.
  it("opens on a blank hexagon of land when there is no handoff", () => {
    h.takeBuilderBoard.mockReturnValue(null);
    const { c, r } = mount(<MapBuilder />);
    expect(c.querySelectorAll("[data-hex]:not([data-water])").length).toBe(19);
    // The canvas opens with room around the hexagon: size 3 is 15 x 7 cells.
    expect(c.querySelectorAll("[data-hex]").length).toBe(105);
    act(() => r.unmount());
  });

  // Preview on a board with blank tiles rolls it first, so what is previewed
  // is what Play sends; the overlay then opens on the rolled board.
  it("Preview generates a half-rolled board before opening", async () => {
    h.takeBuilderBoard.mockReturnValue(null);
    const rolled: Board = {
      radius: 2,
      robber: { q: 1, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "ore", num: 5 },
        { hex: { q: 1, r: 0 }, res: "none", num: 0 },
        { hex: { q: 0, r: 1 }, res: "sheep", num: 9 },
      ],
    };
    h.randomizeMap.mockResolvedValue({ board: rolled, seed: "7", harbor_seed: "7" });
    const { c, r } = mount(<MapBuilder />);
    await act(async () => {
      c.querySelector('[data-testid="open-preview"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(h.randomizeMap).toHaveBeenCalledTimes(1);
    expect(c.querySelector("[data-preview-overlay]")).toBeTruthy();
    // And once every tile is set, opening again rolls nothing.
    await act(async () => {
      c.querySelector('[data-testid="close-preview"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(c.querySelector("[data-preview-overlay]")).toBeNull();
    await act(async () => {
      c.querySelector('[data-testid="open-preview"]')!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(h.randomizeMap).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  // Regenerate is a new map, not a repaint. The endpoint pins deserts (an
  // author's painted desert survives a re-roll), and every desert on a design
  // board came from the previous roll, so the shell sends the bare silhouette,
  // as a fresh Shape -> Design promotion does. With "desert in the middle" off,
  // no desert is pinned.
  it("Regenerate posts a bare silhouette", async () => {
    const rolled: Board = {
      radius: 2,
      robber: { q: 1, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "ore", num: 5 },
        { hex: { q: 1, r: 0 }, res: "none", num: 0 },
        { hex: { q: 0, r: 1 }, res: "sheep", num: 9 },
      ],
    };
    h.randomizeMap.mockResolvedValue({ board: rolled, seed: "5", harbor_seed: "5" });

    const { c, r } = mount(<MapBuilder />);
    await clickTestId(c, "randomize");

    expect(h.randomizeMap).toHaveBeenCalledTimes(1);
    const sent: Board = h.randomizeMap.mock.calls[0][0];
    // No resource and no number survives: the desert at (0,0) is generic land
    // again, so the roll is free to carve its deserts anywhere.
    expect(sent.tiles.map((t) => t.res)).toEqual(["land", "land", "land"]);
    expect(sent.tiles.every((t) => t.num === 0)).toBe(true);
    // The outline itself is untouched: same hexes, same count.
    expect(sent.tiles.map((t) => t.hex)).toEqual(designBoard.tiles.map((t) => t.hex));
    // A seed still goes with it (the shell mints one per roll); the person is
    // never shown it.
    expect(h.randomizeMap.mock.calls[0][1].seed).toMatch(/^[0-9]+$/);
    // The board that comes back is the one the editor holds, and Play ships
    // it, numbers and all.
    h.createGame.mockResolvedValue({ game: { id: "new1" } });
    await clickButton(c, "Play this map");
    expect(h.createGame.mock.calls[0][0].board).toEqual(rolled);
    act(() => r.unmount());
  });

  // Water and gold are structural, not fill: nothing rolls gold (the solver
  // fills generic land with the five producing resources), so stripping it
  // would delete the author's Islands terrain.
  it("Regenerate keeps water and gold while stripping the fill", async () => {
    const islands: Board = {
      radius: 2,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [
        { hex: { q: 0, r: 0 }, res: "sea", num: 0 },
        { hex: { q: 1, r: 0 }, res: "gold", num: 4 },
        { hex: { q: 0, r: 1 }, res: "wheat", num: 10 },
        { hex: { q: 1, r: 1 }, res: "wood", num: 3 },
      ],
    };
    h.takeBuilderBoard.mockReturnValue(islands);
    h.randomizeMap.mockResolvedValue({ board: islands, seed: "1", harbor_seed: "1" });

    const { c, r } = mount(<MapBuilder />);
    await clickTestId(c, "randomize");

    const sent: Board = h.randomizeMap.mock.calls[0][0];
    expect(sent.tiles.map((t) => t.res)).toEqual(["sea", "gold", "land", "land"]);
    // Gold's token is fill all the same, so it re-rolls with the rest.
    expect(sent.tiles.every((t) => t.num === 0)).toBe(true);
    act(() => r.unmount());
  });

  // With "desert in the middle" on, the roll is sent one pinned desert on the
  // tile nearest the land's centre, and the server carves no others. It is
  // pinned after the strip, so the previous roll's desert cannot survive by
  // already sitting on the centre.
  it("pins one central desert on the silhouette when the switch is on", async () => {
    const wide: Board = {
      radius: 3,
      robber: { q: -3, r: 0 },
      harbors: [],
      tiles: [-3, -2, -1, 0, 1, 2, 3].map((q) => ({
        hex: { q, r: 0 },
        res: q === -3 ? "none" : "wood",
        num: q === -3 ? 0 : 6,
      })),
    };
    h.takeBuilderBoard.mockReturnValue(wide);
    h.randomizeMap.mockResolvedValue({ board: wide, seed: "1", harbor_seed: "1" });

    const { c, r } = mount(<MapBuilder />);
    await toggleCenterDesert(c);
    await clickTestId(c, "randomize");

    const sent: Board = h.randomizeMap.mock.calls[0][0];
    expect(sent.tiles.map((t) => t.res)).toEqual([
      "land",
      "land",
      "land",
      "none",
      "land",
      "land",
      "land",
    ]);
    expect(sent.robber).toEqual({ q: 0, r: 0 });
    act(() => r.unmount());
  });

  // Play opens a lobby with the chosen expansions on, and only map-changing
  // expansions are offered here.
  it("opens the new table with the chosen expansions", async () => {
    h.createGame.mockResolvedValue({ game: { id: "new1" } });
    const { c, r } = mount(<MapBuilder />);
    // Only map-changing expansions are offered: Knights is a lobby choice.
    expect(c.querySelector('[data-expansion="cak"]')).toBeNull();
    // Rivers sits on the collapsed scenarios shelf.
    await act(async () => {
      c.querySelector("[data-scenarios-toggle]")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const rivers = c.querySelector('[data-expansion="rivers"] button[role="switch"]')!;
    await act(async () => {
      rivers.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Islands is a live switch that installs its own map; left alone here, so
    // the ruleset below is the base game plus Rivers.
    const islands = c.querySelector('[data-expansion="islands"]')!;
    expect(islands.querySelector("[data-locked]")).toBeNull();
    expect(islands.querySelector('button[role="switch"]')!.getAttribute("disabled")).toBeNull();
    await clickButton(c, "Play this map");
    expect(h.createGame.mock.calls[0][0].ruleset).toBe("base+rivers");
    act(() => r.unmount());
  });

  it("standalone visit creates a new game and goes to its waiting room", async () => {
    h.createGame.mockResolvedValue({ game: { id: "new1" } });
    const { c, r } = mount(<MapBuilder />);
    await clickButton(c, "Play this map");
    expect(h.createGame).toHaveBeenCalledTimes(1);
    expect(h.updateConfig).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith({ to: "/lobby", search: { g: "new1" } });
    act(() => r.unmount());
  });

  it("keeps the lobby source under StrictMode", () => {
    // The handoff is one-shot (sessionStorage is read then cleared). StrictMode
    // mounts effects twice in dev/preview builds; without the guard the second
    // (null) read would drop a spectating host onto the create-new path (a
    // duplicate lobby) instead of "Apply to lobby".
    const cfg = { ...defaultConfig(), ruleset: "base+cak" };
    h.takeBuilderSource.mockReturnValueOnce({ id: "lob1", cfg }).mockReturnValue(null);
    h.takeBuilderBoard.mockReturnValueOnce(designBoard).mockReturnValue(null);

    const c = document.createElement("div");
    document.body.appendChild(c);
    const r: Root = createRoot(c);
    act(() =>
      r.render(
        <React.StrictMode>
          <ConfirmProvider>
            <MapBuilder />
          </ConfirmProvider>
        </React.StrictMode>,
      ),
    );

    const labels = [...c.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Apply to lobby");
    expect(labels).not.toContain("Play this map");
    act(() => r.unmount());
  });

  it("applies the map to the source lobby", async () => {
    const cfg = { ...defaultConfig(), ruleset: "base+cak" }; // a Knights lobby
    h.takeBuilderSource.mockReturnValue({ id: "lob1", cfg });
    h.updateConfig.mockResolvedValue({ game: { id: "lob1" } });

    const { c, r } = mount(<MapBuilder />);
    // The action relabels for the in-lobby flow.
    await clickButton(c, "Apply to lobby");

    expect(h.createGame).not.toHaveBeenCalled();
    expect(h.updateConfig).toHaveBeenCalledTimes(1);
    const [id, sent] = h.updateConfig.mock.calls[0];
    expect(id).toBe("lob1");
    expect(sent.board).toEqual(designBoard);
    expect(sent.preset).toBe("");
    // Other expansions preserved; Islands follows the board (no sea or gold here).
    expect(sent.ruleset).toBe("base+cak");
    expect(h.navigate).toHaveBeenCalledWith({ to: "/lobby", search: { g: "lob1" } });
    act(() => r.unmount());
  });

  it("lists only the current user's maps with a delete control", async () => {
    const minimalBoard: Board = {
      radius: 2,
      robber: { q: 0, r: 0 },
      harbors: [],
      tiles: [],
    };
    const ownedMap: MapRow = {
      id: "m1",
      name: "Mine",
      board: minimalBoard,
      created_by: 1,
      created_at: 1000,
    };
    const otherMap: MapRow = {
      id: "m2",
      name: "Theirs",
      board: minimalBoard,
      created_by: 2,
      created_at: 2000,
    };
    h.maps = [ownedMap, otherMap];

    const { c, r } = mount(<MapBuilder />);

    // Only the owned map's name appears in the panel.
    const text = c.textContent ?? "";
    expect(text).toContain("Mine");
    expect(text).not.toContain("Theirs");

    // A delete control is present for the owned map.
    expect(c.querySelector("[data-deletemap]")).toBeTruthy();

    act(() => r.unmount());
  });
});

// Arriving in a tab rolls what that tab edits, once, if it is empty
// (`rollForTool`). The cases test the guard: a tab switch must never
// overwrite a painted board.
describe("MapBuilder tab rolls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.maps = [];
    h.takeBuilderSource.mockReturnValue(null);
    h.randomizeMap.mockResolvedValue({ board: rolledBoard, seed: "111", harbor_seed: "222" });
    h.harborsMap.mockResolvedValue({ board: { ...rolledBoard, harbors: [] }, seed: "333" });
    // Tiles and Harbors warn on the way in (see the hand-edit suite). These
    // tests are about what the tab does, so the warning is pre-dismissed.
    dismiss("builder-hand-edit");
  });

  /** Click a tool tab by name. */
  function clickTab(c: HTMLElement, tab: "shape" | "tiles" | "harbors") {
    const el = c.querySelector(`[data-tooltab=${tab}]`);
    expect(el, `${tab} tab present`).toBeTruthy();
    return act(async () => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("rolls a blank board with its own seed on opening Tiles", async () => {
    h.takeBuilderBoard.mockReturnValue(blankLandBoard);
    const { c, r } = mount(<MapBuilder />);
    expect(h.randomizeMap).not.toHaveBeenCalled();

    await clickTab(c, "tiles");
    expect(h.randomizeMap).toHaveBeenCalledTimes(1);
    // A seed of its own, not the empty "surprise me" the button sends.
    const [, opts] = h.randomizeMap.mock.calls[0];
    expect(opts.seed, "a random tile seed was spent").toMatch(/^[0-9]+$/);
    act(() => r.unmount());
  });

  it("keeps painted tiles across a tab round trip", async () => {
    h.takeBuilderBoard.mockReturnValue(blankLandBoard);
    const { c, r } = mount(<MapBuilder />);

    await clickTab(c, "tiles");
    expect(h.randomizeMap).toHaveBeenCalledTimes(1);
    // The board that came back has no blanks, so the second arrival must pass.
    await clickTab(c, "shape");
    await clickTab(c, "tiles");
    expect(h.randomizeMap, "re-rolled on a tab round trip").toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  it("does not reroll a rolled board on opening Tiles", async () => {
    h.takeBuilderBoard.mockReturnValue(designBoard);
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    expect(h.randomizeMap).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it("lays ports on opening Harbors with no ports", async () => {
    h.takeBuilderBoard.mockReturnValue(designBoard);
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "harbors");
    expect(h.harborsMap).toHaveBeenCalledTimes(1);
    expect(h.harborsMap.mock.calls[0][1], "a random port seed was spent").toMatch(/^[0-9]+$/);
    act(() => r.unmount());
  });

  it("leaves a coast that already has ports alone", async () => {
    h.takeBuilderBoard.mockReturnValue({
      ...designBoard,
      harbors: [
        {
          verts: [
            { q: 0, r: 0, side: 0 },
            { q: 0, r: 0, side: 1 },
          ],
          res: "any",
        },
      ],
    });
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "harbors");
    expect(h.harborsMap).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it("ignores a click on the open tab", async () => {
    h.takeBuilderBoard.mockReturnValue(blankLandBoard);
    const { c, r } = mount(<MapBuilder />);
    // The shell opens on Shape, and Shape rolls nothing whatever is clicked.
    await clickTab(c, "shape");
    expect(h.randomizeMap).not.toHaveBeenCalled();
    expect(h.harborsMap).not.toHaveBeenCalled();
    act(() => r.unmount());
  });
});

// Islands installs a map: taking the switch replaces the board with that
// mode's default, so the ruleset and the canvas never disagree.
describe("MapBuilder islands switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.maps = [];
    h.takeBuilderSource.mockReturnValue(null);
    h.takeBuilderBoard.mockReturnValue(null);
    h.createGame.mockResolvedValue({ game: { id: "new1" } });
    // Pinned here rather than inherited: opening Tiles on a blank board rolls
    // it, which makes the board dirty so the switch asks before replacing it.
    // Relying on earlier tests made this suite order-dependent.
    h.randomizeMap.mockResolvedValue({ board: rolledBoard, seed: "111", harbor_seed: "222" });
    h.harborsMap.mockResolvedValue({ board: rolledBoard, seed: "333" });
    // Tiles and Harbors warn on the way in (see the hand-edit suite). These
    // tests are about what the tab does, so the warning is pre-dismissed.
    dismiss("builder-hand-edit");
  });

  /** The confirm dialog portals to document.body, not into the mount container. */
  function confirmDialogButton(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll("button")].find((b) => b.textContent === label);
  }
  function answerConfirm(label: "Replace" | "Cancel") {
    const btn = confirmDialogButton(label);
    expect(btn, `confirm dialog "${label}" present`).toBeTruthy();
    return act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  /**
   * Toggle, and take the offer if one is made. Whether a confirm appears
   * depends on the board (it asks only when the canvas differs from the
   * installed default), so this asserts neither way; `asksToReplace` is tested
   * separately.
   */
  async function toggleIslandsTakingTheOffer(c: HTMLElement) {
    await toggleIslands(c);
    if (confirmDialogButton("Replace")) await answerConfirm("Replace");
  }

  const islandsSwitch = (c: HTMLElement) =>
    c.querySelector('[data-expansion="islands"] button[role="switch"]')!;

  const goldCount = (c: HTMLElement) => c.querySelectorAll('[data-restool="gold"]').length;
  const landHexes = (c: HTMLElement) => c.querySelectorAll("[data-hex]:not([data-water])").length;

  function toggleIslands(c: HTMLElement) {
    return act(async () => {
      islandsSwitch(c).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  /** Open the Tiles tab, where the resource palette lives. */
  function openTiles(c: HTMLElement) {
    return act(async () => {
      c.querySelector("[data-tooltab=tiles]")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
  }

  it("is live on the blank board the builder opens with", () => {
    const { c, r } = mount(<MapBuilder />);
    expect(islandsSwitch(c).getAttribute("disabled")).toBeNull();
    act(() => r.unmount());
  });

  it("switches between the islands map and a blank board", async () => {
    const { c, r } = mount(<MapBuilder />);
    const blank = landHexes(c);

    await toggleIslands(c);
    // Shores (Small) is a bigger, many-piece board. Assert on the board, not
    // the switch: the switch moving without the board is the failure.
    expect(landHexes(c), "the islands map was not installed").toBeGreaterThan(blank);

    await toggleIslands(c);
    expect(landHexes(c), "the blank board did not come back").toBe(blank);
    act(() => r.unmount());
  });

  it("puts gold on the palette only while Islands is on", async () => {
    const { c, r } = mount(<MapBuilder />);
    await openTiles(c);
    expect(goldCount(c), "gold is offered with Islands off").toBe(0);

    await toggleIslandsTakingTheOffer(c);
    await openTiles(c);
    expect(goldCount(c), "gold is missing with Islands on").toBe(1);

    await toggleIslandsTakingTheOffer(c);
    await openTiles(c);
    expect(goldCount(c)).toBe(0);
    act(() => r.unmount());
  });

  it("plays the islands ruleset once the switch is on", async () => {
    const { c, r } = mount(<MapBuilder />);
    await toggleIslands(c);
    await clickButton(c, "Play this map");
    expect(h.createGame.mock.calls[0][0].ruleset).toBe("base+islands");
    act(() => r.unmount());
  });

  it("confirms before replacing an edited board", async () => {
    const { c, r } = mount(<MapBuilder />);
    // Opening Tiles rolls the blank board, which is work worth keeping.
    await openTiles(c);
    const rolled = landHexes(c);

    await toggleIslands(c);
    await answerConfirm("Cancel");
    expect(landHexes(c), "a cancelled switch replaced the board").toBe(rolled);
    expect(islandsSwitch(c).getAttribute("aria-checked"), "Islands on after cancel").toBe("false");

    // And taking the same offer through does replace it.
    await toggleIslands(c);
    await answerConfirm("Replace");
    expect(landHexes(c)).toBeGreaterThan(rolled);
    expect(islandsSwitch(c).getAttribute("aria-checked")).toBe("true");
    act(() => r.unmount());
  });
});

// The roll is two buttons and no seed fields: Play sends the resolved board,
// and "Copy map code" already preserves a board.
describe("MapBuilder roll controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.maps = [];
    h.takeBuilderSource.mockReturnValue(null);
    h.takeBuilderBoard.mockReturnValue(designBoard);
    h.randomizeMap.mockResolvedValue({ board: designBoard, seed: "1", harbor_seed: "2" });
    h.harborsMap.mockResolvedValue({ board: designBoard, seed: "3" });
  });

  it("shows no seed fields at all", () => {
    const { c, r } = mount(<MapBuilder />);
    expect(c.querySelector('[data-testid="tile-seed-field"]')).toBeNull();
    expect(c.querySelector('[data-testid="port-seed-field"]')).toBeNull();
    expect(c.querySelector('[data-testid="tile-seed-apply"]')).toBeNull();
    expect(c.querySelector('[data-testid="port-seed-apply"]')).toBeNull();
    // Generation remains; harbor randomization has been removed.
    expect(c.querySelector('[data-testid="randomize"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="randomize-harbors"]')).toBeNull();
    act(() => r.unmount());
  });

  it("defaults the center desert switch to off", async () => {
    const { c, r } = mount(<MapBuilder />);
    expect(
      c.querySelector('[data-testid="center-desert"]')!.getAttribute("aria-checked"),
      "center desert switch default",
    ).toBe("false");

    await clickTestId(c, "randomize");
    // Nothing is pinned: every tile goes up as bare land for the roll to fill.
    const sent: Board = h.randomizeMap.mock.calls[0][0];
    expect(sent.tiles.some((t) => t.res === "none")).toBe(false);
    act(() => r.unmount());
  });

  it("undoes and redoes generation but not text input", async () => {
    h.randomizeMap.mockResolvedValue({ board: rolledBoard, seed: "42" });
    const { c, r } = mount(<MapBuilder />);
    const tiles = () => c.querySelectorAll("[data-hex]:not([data-water])").length;
    const button = (label: string) =>
      [...c.querySelectorAll("button")].find((b) => b.textContent === label)!;
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(true);
    expect(c.querySelector('[data-testid="open-preview"]')!.nextElementSibling).toBe(
      button("Play this map"),
    );
    await clickTestId(c, "randomize");
    expect(tiles()).toBe(4);
    await clickButton(c, "Undo");
    expect(tiles()).toBe(3);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true }),
      );
    });
    expect(tiles()).toBe(4);
    await act(async () => {
      c.querySelector("input")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }),
      );
    });
    expect(tiles()).toBe(4);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    });
    expect(tiles()).toBe(3);
    act(() => r.unmount());
  });
});

// Hand editing warns on the way in, once, and can be turned off. Tested: a
// declined warning vetoes the tab, only the two hand-editing tabs warn, and
// "don't show this again" sticks.
describe("MapBuilder warns before hand editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.maps = [];
    h.takeBuilderSource.mockReturnValue(null);
    h.takeBuilderBoard.mockReturnValue(blankLandBoard);
    h.randomizeMap.mockResolvedValue({ board: rolledBoard, seed: "111", harbor_seed: "222" });
    h.harborsMap.mockResolvedValue({ board: { ...rolledBoard, harbors: [] }, seed: "333" });
    undismiss("builder-hand-edit");
  });

  function clickTab(c: HTMLElement, tab: "shape" | "tiles" | "harbors") {
    const el = c.querySelector(`[data-tooltab=${tab}]`);
    expect(el, `${tab} tab present`).toBeTruthy();
    return act(async () => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  /** The dialog portals to document.body, not into the mount container. */
  function dialogButton(label: string): HTMLElement | undefined {
    return [...document.querySelectorAll("button")].find((b) => b.textContent === label);
  }
  function answer(label: string) {
    const btn = dialogButton(label);
    expect(btn, `dialog "${label}" present`).toBeTruthy();
    return act(async () => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  /** Which tab the editor is actually showing, by the tab's own selected style. */
  function openTab(c: HTMLElement): string | undefined {
    return (
      [...c.querySelectorAll("[data-tooltab]")]
        .find((el) => el.className.includes("bg-selected"))
        ?.getAttribute("data-tooltab") ?? undefined
    );
  }

  it("warns on the way into Tiles instead of opening it", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    expect(dialogButton("Edit tiles"), "the tiles warning is up").toBeTruthy();
    expect(openTab(c), "tab changed before the viewer decided").toBe("shape");
    expect(h.randomizeMap, "nothing rolled").not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it("stays on Shape with nothing rolled when declined", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    await answer("Keep shaping");
    expect(openTab(c)).toBe("shape");
    expect(h.randomizeMap).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it("opens and rolls the tab when accepted", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    await answer("Edit tiles");
    expect(openTab(c)).toBe("tiles");
    expect(h.randomizeMap, "tab roll after the warning").toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  it("warns for Harbors with its own copy", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "harbors");
    expect(dialogButton("Edit harbours"), "the harbors warning is up").toBeTruthy();
    act(() => r.unmount());
  });

  it("never warns on the way back to Shape", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    await answer("Edit tiles");
    await clickTab(c, "shape");
    expect(dialogButton("Edit tiles"), "no warning for the tab we recommend").toBeFalsy();
    expect(openTab(c)).toBe("shape");
    act(() => r.unmount());
  });

  // The checkbox outlives the dialog that set it and covers both tabs.
  it("'Don't show this again' stops the warning, for both tabs", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    const box = document.querySelector<HTMLInputElement>("[data-testid=confirm-dont-ask]");
    expect(box, "the checkbox is offered").toBeTruthy();
    // A real click, not `checked = true`: the box is a controlled input, so only
    // the event React is listening for moves its state.
    await act(async () => {
      box!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(box!.checked, "the box is ticked").toBe(true);
    await answer("Edit tiles");

    await clickTab(c, "shape");
    await clickTab(c, "harbors");
    expect(dialogButton("Edit harbours"), "one dismissal covers the other tab").toBeFalsy();
    expect(openTab(c), "and the tab opens straight through").toBe("harbors");
    act(() => r.unmount());
  });

  // Ticking the box and then cancelling must not remember it: the viewer only
  // declined this tab.
  it("cancelling does not remember the checkbox", async () => {
    const { c, r } = mount(<MapBuilder />);
    await clickTab(c, "tiles");
    const box = document.querySelector<HTMLInputElement>("[data-testid=confirm-dont-ask]");
    // A real click, not `checked = true`: the box is a controlled input, so only
    // the event React is listening for moves its state.
    await act(async () => {
      box!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(box!.checked, "the box is ticked").toBe(true);
    await answer("Keep shaping");

    await clickTab(c, "tiles");
    expect(dialogButton("Edit tiles"), "still asks after an abandoned trip").toBeTruthy();
    act(() => r.unmount());
  });
});
