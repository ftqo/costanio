import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CosmeticSlot, GalleryContext } from "./CosmeticGallery";

/**
 * How a card's turning subject is reached, including on touch devices, where
 * hover does not exist and a tap must not leave the slot half-activated by
 * focus.
 *
 * The rig needs WebGL, so the slot runs against a fake context.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "robber.classic";
const STILL = "data:image/webp;base64,AA";

let host: HTMLDivElement;
let root: Root;
let hover: ReturnType<typeof vi.fn<(id: string | null, host: HTMLElement | null) => void>>;

beforeEach(() => {
  hover = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <GalleryContext.Provider
        value={{
          // Both cache-key shapes, so the test does not depend on whether this
          // family wears a seat colour.
          stills: { [ID]: STILL, [`${ID}|red`]: STILL },
          seatColor: "red",
          register: () => {},
          hover,
        }}
      >
        <CosmeticSlot id={ID} />
      </GalleryContext.Provider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const slot = () => host.firstElementChild as HTMLElement;
/** The still is hidden rather than unmounted while the live canvas is over it,
 *  so its visibility (the `invisible` class) is what "the turning subject is
 *  showing" looks like. */
const live = () => host.querySelector("img")!.classList.contains("invisible");

/** jsdom has no PointerEvent in every version, and React only needs the
 *  `pointerType` field off the event object. */
function pointer(type: string, pointerType: string) {
  const e = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  act(() => {
    slot().dispatchEvent(e);
  });
}

describe("CosmeticSlot", () => {
  it("goes live on mouse hover and stops on leave", () => {
    pointer("pointerover", "mouse");
    pointer("pointerenter", "mouse");
    expect(hover).toHaveBeenCalledWith(ID, slot());
    expect(live()).toBe(true);

    pointer("pointerout", "mouse");
    pointer("pointerleave", "mouse");
    expect(hover).toHaveBeenLastCalledWith(null, null);
    expect(live()).toBe(false);
  });

  it("does not treat a touch as hover", () => {
    // Touch "enters" on contact and "leaves" on release, so it must not count
    // as hover.
    pointer("pointerover", "touch");
    pointer("pointerenter", "touch");
    expect(hover).not.toHaveBeenCalled();
    expect(live()).toBe(false);
  });

  it("toggles on each touch tap", () => {
    pointer("pointerover", "touch");
    pointer("pointerenter", "touch");
    pointer("pointerdown", "touch");
    expect(hover).toHaveBeenCalledWith(ID, slot());
    expect(live()).toBe(true);

    pointer("pointerdown", "touch");
    expect(hover).toHaveBeenLastCalledWith(null, null);
    expect(live()).toBe(false);
  });

  it("does not toggle on a mouse press", () => {
    pointer("pointerover", "mouse");
    pointer("pointerenter", "mouse");
    expect(live()).toBe(true);
    pointer("pointerdown", "mouse");
    expect(live()).toBe(true);
  });

  it("is reachable from the keyboard", () => {
    expect(slot().tabIndex).toBe(0);
    act(() => slot().focus());
    expect(hover).toHaveBeenCalledWith(ID, slot());
    expect(live()).toBe(true);

    act(() => slot().blur());
    expect(live()).toBe(false);
  });
});
