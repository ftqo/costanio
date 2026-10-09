import { test, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createHudAnchors } from "@/lib/hudAnchors";
import { FLIGHT_MS, choreograph, type CardFlight } from "@/lib/board3d/cardflight";
import type { Projector } from "@/lib/board3d/project";

// The asset primitives decode real images over fetch, which jsdom can't, and
// none of it matters here.
vi.mock("@/components/asset/AssetParts", () => ({
  ResIcon: () => null,
}));

const { CardFlightLayer } = await import("./CardFlightLayer");

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

const cards = (el: HTMLElement) => el.querySelectorAll("[aria-hidden]");

const flight = (over: Partial<CardFlight> = {}): CardFlight => ({
  from: { k: "bank" },
  to: { k: "seat", seat: 2 },
  face: { k: "res", idx: 4 },
  count: 1,
  delayMs: 0,
  ...over,
});

/** A camera stand-in: everything lands dead centre and in front. */
const centre: Projector = () => ({ fx: 0.5, fy: 0.5, behind: false });

test("an empty overlay draws nothing and starts no loop", () => {
  const raf = vi.spyOn(globalThis, "requestAnimationFrame");
  const { el, root } = render(
    <CardFlightLayer batch={null} projector={centre} anchors={createHudAnchors()} viewer={1} />,
  );
  expect(cards(el)).toHaveLength(0);
  expect(raf).not.toHaveBeenCalled();
  raf.mockRestore();
  act(() => root.unmount());
});

test("a batch mounts one node per flight and drains when the last one lands", () => {
  vi.useFakeTimers();
  const batch = { id: 1, flights: choreograph([flight(), flight({ to: { k: "seat", seat: 3 } })]) };
  const { el, root } = render(
    <CardFlightLayer batch={batch} projector={centre} anchors={createHudAnchors()} viewer={1} />,
  );
  expect(cards(el)).toHaveLength(2);
  // Past the last card's delay plus its whole flight.
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS * 3);
  });
  expect(cards(el)).toHaveLength(0);
  act(() => root.unmount());
});

test("a flight is positioned in percentages, never in pixels", () => {
  // index.css zooms the UI past 1700px, and under `zoom` a px length in
  // style.left is read at a different scale than the rect it came from.
  // Percentages of the overlay's own box avoid that.
  vi.useFakeTimers();
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight()] }}
      projector={centre}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 2);
  });
  const card = cards(el)[0] as HTMLElement;
  expect(card.style.left.endsWith("%")).toBe(true);
  expect(card.style.top.endsWith("%")).toBe(true);
  expect(card.style.transform).toContain("translate(-50%, -50%)");
  act(() => root.unmount());
});

test("hides a hex-sourced card when there is no camera", () => {
  vi.useFakeTimers();
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ from: { k: "hex", hex: { q: 0, r: 0 } } })] }}
      projector={null}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 2);
  });
  expect((cards(el)[0] as HTMLElement).style.opacity).toBe("0");
  // Still cleaned up on schedule; an unplaceable card must not pin the loop.
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS * 2);
  });
  expect(cards(el)).toHaveLength(0);
  act(() => root.unmount());
});

test("hides a source behind the camera", () => {
  vi.useFakeTimers();
  const behind: Projector = () => ({ fx: 0.5, fy: 0.5, behind: true });
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ from: { k: "hex", hex: { q: 0, r: 0 } } })] }}
      projector={behind}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 2);
  });
  expect((cards(el)[0] as HTMLElement).style.opacity).toBe("0");
  act(() => root.unmount());
});

test("a second batch joins the first instead of replacing it", () => {
  vi.useFakeTimers();
  const anchors = createHudAnchors();
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight()] }}
      projector={centre}
      anchors={anchors}
      viewer={1}
    />,
  );
  expect(cards(el)).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 4);
  });
  act(() => {
    root.render(
      <CardFlightLayer
        batch={{ id: 2, flights: [flight(), flight()] }}
        projector={centre}
        anchors={anchors}
        viewer={1}
      />,
    );
  });
  expect(cards(el)).toHaveLength(3);
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS * 3);
  });
  expect(cards(el)).toHaveLength(0);
  act(() => root.unmount());
});

test("aims own cards at the hand and opponents' at their coin", () => {
  vi.useFakeTimers();
  const anchors = createHudAnchors();
  const hand = document.createElement("div");
  const coin = document.createElement("div");
  document.body.append(hand, coin);
  const seen: string[] = [];
  // Both anchors report where they were asked from, the only difference between
  // the two routes under jsdom's zero rects.
  hand.getBoundingClientRect = () => {
    seen.push("hand");
    return new DOMRect(0, 0, 10, 10);
  };
  coin.getBoundingClientRect = () => {
    seen.push("coin");
    return new DOMRect(0, 0, 10, 10);
  };
  anchors.ref("hand:res:4")(hand);
  anchors.ref("seat:2")(coin);

  const { root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ to: { k: "seat", seat: 1 } }), flight()] }}
      projector={centre}
      anchors={anchors}
      viewer={1}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 2);
  });
  expect(seen).toContain("hand");
  expect(seen).toContain("coin");
  act(() => root.unmount());
});

test("unmounting mid-flight cancels the loop", () => {
  vi.useFakeTimers();
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
  const { root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight()] }}
      projector={centre}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  act(() => {
    vi.advanceTimersByTime(FLIGHT_MS / 4);
  });
  act(() => root.unmount());
  expect(cancel).toHaveBeenCalled();
  cancel.mockRestore();
});

test("a counted card shows its count and a single card does not", () => {
  vi.useFakeTimers();
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ count: 7 })] }}
      projector={centre}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  expect(el.textContent).toContain("7");
  act(() => root.unmount());

  const solo = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ count: 1 })] }}
      projector={centre}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  expect(solo.el.textContent).toBe("");
  act(() => solo.root.unmount());
});

test("a hidden face draws a card back", () => {
  vi.useFakeTimers();
  const { el, root } = render(
    <CardFlightLayer
      batch={{ id: 1, flights: [flight({ face: { k: "hidden" } })] }}
      projector={centre}
      anchors={createHudAnchors()}
      viewer={1}
    />,
  );
  expect(el.textContent).toContain("?");
  act(() => root.unmount());
});
