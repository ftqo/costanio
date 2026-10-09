import { test, expect, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Lobby pulls in the router, the socket and the query client at import time;
// the hook under test needs none of them.
vi.mock("@/lib/ws", () => ({ gameSocket: {} }));

import { useBottomClearance } from "./Lobby";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

// The hook's answer, written out where the test can read it.
function Harness({ late = false }: { late?: boolean }) {
  const [el, setEl] = React.useState<HTMLDivElement | null>(null);
  const px = useBottomClearance(el);
  // `late`: the row is not in the first render, as in the Lobby, which shows
  // its loading card until the table arrives.
  const [shown, setShown] = React.useState(!late);
  React.useEffect(() => setShown(true), []);
  return (
    <>
      <span id="px" data-px={px} />
      {shown && <div ref={setEl} id="row" />}
    </>
  );
}
const seen = () => Number(host!.querySelector("#px")!.getAttribute("data-px"));

function mountAt(top: number, height = 80, late = false) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const spy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ top, bottom: top + height, left: 0, right: 0, width: 0, height } as DOMRect);
  try {
    root = createRoot(host);
    act(() => root!.render(<Harness late={late} />));
  } finally {
    spy.mockRestore();
  }
}

// The Start game row sits in the bottom-right corner of a desktop lobby, where
// toasts stack, so they must ride above it.
test("lifts the toasts above a visible Start row", () => {
  window.innerHeight = 800;
  mountAt(700);
  expect(seen()).toBe(100);
});

test("requests no inset when the Start row is off screen", () => {
  window.innerHeight = 800;
  mountAt(1200);
  expect(seen()).toBe(0);
});

// The Lobby's case: the Start row mounts after the table loads, so the hook
// must measure an element that appears after the first render.
test("lifts the toasts for a Start row mounted later", () => {
  window.innerHeight = 800;
  mountAt(700, 80, true);
  expect(seen()).toBe(100);
});
