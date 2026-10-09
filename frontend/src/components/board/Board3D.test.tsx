import { test, expect, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Board3D, type Board3DControls } from "./Board3D";
import type { FullView } from "@/lib/types";

afterEach(() => {
  document.body.innerHTML = "";
});

// jsdom has no WebGL, so these assert only that the component mounts, sizes
// itself and tears down without throwing.
const view = {
  board: {
    radius: 2,
    tiles: [
      { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
      { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
    ],
    robber: { q: 0, r: 0 },
    harbors: [],
  },
  buildings: [],
  roads: [],
} as unknown as FullView;

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

test("mounts without throwing when WebGL is unavailable", () => {
  const { el, root } = render(<Board3D view={view} />);
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

test("unmounting twice does not throw", () => {
  const { root } = render(<Board3D view={view} />);
  act(() => root.unmount());
  expect(() => act(() => root.unmount())).not.toThrow();
});

test("mounts and tears down with fogged hexes", () => {
  // `fog` is what Explorers masks an unrevealed hex to (`lib/board3d/layers/fog.ts`).
  // This only checks the fog path does not throw without GL; the mist itself is
  // tested in layers/fog.test.ts.
  const masked = {
    ...view,
    board: {
      ...view.board,
      tiles: [...view.board.tiles, { hex: { q: 0, r: 1 }, res: "fog", num: 0 }],
    },
  } as unknown as FullView;
  const { el, root } = render(<Board3D view={masked} />);
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

test("accepts a custom seat color resolver", () => {
  const { el, root } = render(<Board3D view={view} colorOf={() => "#ff0000"} />);
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

test("mounts and tears down in build mode with input", () => {
  // The picking maths is tested in lib/board3d/{picking,targets,markers}; this
  // only checks the interaction props survive without GL.
  const playable = {
    ...view,
    viewer: 0,
    legal: { settlements: [{ q: 0, r: 0, side: 0 }] },
  } as unknown as FullView;
  const { el, root } = render(
    <Board3D
      view={playable}
      mode="settlement"
      onVertex={() => {}}
      onEdge={() => {}}
      onHex={() => {}}
      onInspect={() => {}}
      controls
    />,
  );
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

// Who draws the reset button: the board, unless a host takes the handle and
// draws it in its own HUD.
const RESET = 'button[aria-label="Reset view"]';

test("shows the reset button only when it owns the controls", () => {
  const cases: { name: string; controls: boolean; hosted: boolean; want: boolean }[] = [
    { name: "no controls at all", controls: false, hosted: false, want: false },
    {
      name: "controls, no host chrome (the preview route)",
      controls: true,
      hosted: false,
      want: true,
    },
    {
      name: "controls, host holding the handle (the game HUD)",
      controls: true,
      hosted: true,
      want: false,
    },
    // A handle without controls: the camera cannot move, so neither shows one.
    { name: "handle but no controls", controls: false, hosted: true, want: false },
  ];
  for (const c of cases) {
    const ref = React.createRef<Board3DControls>();
    const { el, root } = render(
      <Board3D view={view} controls={c.controls} controlsRef={c.hosted ? ref : undefined} />,
    );
    expect(el.querySelector(RESET) != null, c.name).toBe(c.want);
    act(() => root.unmount());
    document.body.innerHTML = "";
  }
});

test("gives a host a callable controls handle", () => {
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(ref.current).not.toBeNull();
  expect(typeof ref.current!.resetView).toBe("function");
  // Without WebGL the rig never ran, so the reset is still a no-op; calling it
  // early must be harmless.
  expect(() => ref.current!.resetView()).not.toThrow();
  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

test("showcase turn is safe before the rig exists", () => {
  // The endgame overlay may call this before the board has built, or with no
  // WebGL at all; both must be harmless.
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(typeof ref.current!.setAutoOrbit).toBe("function");
  expect(() => ref.current!.setAutoOrbit(true)).not.toThrow();
  expect(() => ref.current!.setAutoOrbit(false)).not.toThrow();
  act(() => root.unmount());
});

test("robber pulse is safe before the rig exists", () => {
  // Called when the rolled number is under the robber; may fire before any GL
  // context exists and must be a no-op then. The animation is tested in
  // lib/board3d/robberMotion.
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(typeof ref.current!.pulseRobber).toBe("function");
  expect(() => {
    ref.current!.pulseRobber();
    ref.current!.pulseRobber();
  }).not.toThrow();
  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

test("chip flip is safe before the rig exists", () => {
  // Called on every roll; a no-op without GL. The animation is tested in
  // lib/board3d/flip.
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(typeof ref.current!.flipChips).toBe("function");
  expect(() => {
    ref.current!.flipChips(8);
    ref.current!.flipChips(7);
  }).not.toThrow();
  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

test("robber seven is safe before the rig exists", () => {
  // The seven's counterpart to the chip flip; a no-op without GL.
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(typeof ref.current!.flipRobber).toBe("function");
  expect(() => {
    ref.current!.flipRobber();
    ref.current!.flipRobber();
  }).not.toThrow();
  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

test("Inventor swap is safe before the rig exists", () => {
  // Like the flips, but the swap is recorded for the next build commit, so a
  // call with no rig must leave nothing pending. The animation is tested in
  // lib/board3d/chipSwap.
  const ref = React.createRef<Board3DControls>();
  const { root } = render(<Board3D view={view} controls controlsRef={ref} />);
  expect(typeof ref.current!.swapChips).toBe("function");
  expect(() => {
    ref.current!.swapChips({ q: 0, r: 0 }, { q: 1, r: 0 });
    ref.current!.swapChips({ q: 1, r: 0 }, { q: 0, r: 0 });
  }).not.toThrow();
  act(() => root.unmount());
  expect(ref.current).toBeNull();
});

// The number chips are on the board's static half, rebuilt only when its key
// changes. The Inventor swaps numbers without touching terrain or harbours.
test("re-renders and tears down after a number swap", () => {
  const before = {
    ...view,
    board: {
      ...view.board,
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 5 },
        { hex: { q: 1, r: 0 }, res: "brick", num: 9 },
        { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
      ],
    },
  } as unknown as FullView;
  const after = {
    ...before,
    board: {
      ...before.board,
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 9 },
        { hex: { q: 1, r: 0 }, res: "brick", num: 5 },
        { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
      ],
    },
  } as unknown as FullView;
  const ref = React.createRef<Board3DControls>();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<Board3D view={before} controls controlsRef={ref} />));
  act(() => {
    ref.current!.swapChips({ q: 0, r: 0 }, { q: 1, r: 0 });
    root.render(<Board3D view={after} controls controlsRef={ref} />);
  });
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

test("mounts with pieces, harbours and a robber", () => {
  const full = {
    board: {
      radius: 2,
      tiles: [
        { hex: { q: 0, r: 0 }, res: "wood", num: 8 },
        { hex: { q: 1, r: 0 }, res: "sea", num: 0 },
        { hex: { q: 1, r: -1 }, res: "sea", num: 0 },
      ],
      robber: { q: 0, r: 0 },
      harbors: [
        {
          verts: [
            { q: 0, r: 0, side: 0 },
            { q: 1, r: -1, side: 1 },
          ],
          ratio: 3,
          res: "none",
        },
      ],
    },
    buildings: [{ v: { q: 0, r: 0, side: 0 }, owner: 0, city: false }],
    roads: [{ e: { a: { q: 0, r: 0, side: 0 }, b: { q: 0, r: 0, side: 1 } }, owner: 1 }],
  } as unknown as FullView;
  const { el, root } = render(<Board3D view={full} />);
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  act(() => root.unmount());
});

// The projector exists only while the rig does. Without WebGL there is none,
// which the flight overlay must survive (it is also the SVG fallback's case).
test("mounts without a projector when there is no camera", () => {
  const seen: unknown[] = [];
  const { el, root } = render(<Board3D view={view} onProjector={(p) => seen.push(p)} />);
  expect(el.querySelector("[data-board3d]")).not.toBeNull();
  expect(seen).toEqual([]);
  act(() => root.unmount());
  expect(seen).toEqual([]);
});
