import { test, expect } from "vitest";
import {
  anchorIdFor,
  centerWithin,
  createHudAnchors,
  fallbackPoint,
  handAnchorId,
} from "./hudAnchors";
import type { CardFace, Endpoint } from "./board3d/cardflight";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

test("the registry files and releases elements by id", () => {
  const a = createHudAnchors();
  const el = {} as HTMLElement;
  expect(a.el("bank")).toBeNull();
  a.ref("bank")(el);
  expect(a.el("bank")).toBe(el);
  a.ref("bank")(null);
  expect(a.el("bank")).toBeNull();
});

test("a ref callback is the same function every time it is asked for", () => {
  // A fresh ref function each render would leave the registry briefly empty
  // during the re-render that starts a flight.
  const a = createHudAnchors();
  expect(a.ref("seat:2")).toBe(a.ref("seat:2"));
  expect(a.ref("seat:2")).not.toBe(a.ref("seat:3"));
});

test("ids do not collide across publishers", () => {
  const a = createHudAnchors();
  const coin = {} as HTMLElement;
  const card = {} as HTMLElement;
  a.ref("seat:2")(coin);
  a.ref("hand:res:2")(card);
  expect(a.el("seat:2")).toBe(coin);
  expect(a.el("hand:res:2")).toBe(card);
});

test("anchorIdFor: own cards to the hand, others to a coin", () => {
  const cases: [Endpoint, CardFace, number, string | null][] = [
    [{ k: "hex", hex: { q: 0, r: 0 } }, { k: "res", idx: 1 }, 1, null],
    [{ k: "seat", seat: 1 }, { k: "res", idx: 4 }, 1, "hand:res:4"],
    [{ k: "seat", seat: 1 }, { k: "com", idx: 2 }, 1, "hand:com:2"],
    [{ k: "seat", seat: 1 }, { k: "dev" }, 1, "hand:dev"],
    [{ k: "seat", seat: 1 }, { k: "hidden" }, 1, "hand"],
    [{ k: "seat", seat: 2 }, { k: "res", idx: 4 }, 1, "seat:2"],
    // A spectator has no seat, so nothing is ever "his" hand.
    [{ k: "seat", seat: 0 }, { k: "res", idx: 4 }, -1, "seat:0"],
    [{ k: "bank" }, { k: "res", idx: 4 }, 1, "bank"],
    // The deck has no permanent home on screen, so it borrows the bank orb.
    [{ k: "deck" }, { k: "dev" }, 1, "bank"],
  ];
  for (const [e, face, viewer, want] of cases) {
    expect(anchorIdFor(e, viewer, face), `${e.k}/${face.k}`).toBe(want);
  }
  expect(handAnchorId({ k: "progress" })).toBe("hand:dev");
});

test("fallbackPoint puts a missing anchor on the nearest edge", () => {
  expect(fallbackPoint("hand:res:1").fy).toBeGreaterThan(0.5);
  expect(fallbackPoint("hand").fy).toBeGreaterThan(0.5);
  expect(fallbackPoint("seat:4").fx).toBeLessThan(0.5);
  // The bank's counts sit centred above the hand shelf, so its fallback is low
  // and central.
  for (const id of ["bank", "deck"]) {
    expect(fallbackPoint(id).fy).toBeGreaterThan(0.5);
    // Below the hand shelf's own fallback, which is where the cards land.
    expect(fallbackPoint(id).fy).toBeLessThan(fallbackPoint("hand").fy);
  }
  // Every fallback is on screen.
  for (const id of ["hand", "seat:0", "bank"]) {
    const p = fallbackPoint(id);
    expect(p.fx).toBeGreaterThan(0);
    expect(p.fx).toBeLessThan(1);
    expect(p.fy).toBeGreaterThan(0);
    expect(p.fy).toBeLessThan(1);
  }
});

test("centerWithin is a pure ratio, so page zoom cancels out", () => {
  const el = rect(100, 50, 40, 40);
  const box = rect(0, 0, 800, 600);
  const plain = centerWithin(el, box);
  expect(plain.fx).toBeCloseTo(120 / 800, 10);
  expect(plain.fy).toBeCloseTo(70 / 600, 10);
  // Under `zoom: 2` every rect doubles, the overlay's included, so the ratio is
  // unchanged. That is why the overlay uses percentages.
  const zoomed = centerWithin(rect(200, 100, 80, 80), rect(0, 0, 1600, 1200));
  expect(zoomed.fx).toBeCloseTo(plain.fx, 10);
  expect(zoomed.fy).toBeCloseTo(plain.fy, 10);
});

test("centerWithin survives a zero-sized container", () => {
  // jsdom reports 0x0 for everything, as does a hidden overlay.
  expect(centerWithin(rect(0, 0, 0, 0), rect(0, 0, 0, 0))).toEqual({ fx: 0.5, fy: 0.5 });
});

test("centerWithin is relative to the container, not the page", () => {
  const inner = centerWithin(rect(140, 90, 20, 20), rect(100, 50, 400, 400));
  expect(inner.fx).toBeCloseTo(50 / 400, 10);
  expect(inner.fy).toBeCloseTo(50 / 400, 10);
});
