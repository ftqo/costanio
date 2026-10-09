import { test, expect, describe, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useLongPress, useTapOnly, LONG_PRESS_MS, LONG_PRESS_SLOP_PX } from "./touch";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

/** A button wired to the hook, with its own click handler underneath it. */
function mount(onFire: () => void, onClick: () => void) {
  function Probe() {
    const { handlers } = useLongPress(onFire);
    return (
      <button type="button" onClick={onClick} {...handlers}>
        hold me
      </button>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
  return host.querySelector("button")!;
}

function down(el: Element, x = 0, y = 0) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: "touch",
      }),
    );
  });
}
function move(el: Element, x: number, y: number) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerType: "touch",
      }),
    );
  });
}
function up(el: Element) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("press and hold", () => {
  test("a held press fires", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    down(el);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).toHaveBeenCalledTimes(1);
  });

  test("a short press does not", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    down(el);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 50));
    up(el);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).not.toHaveBeenCalled();
  });

  // A player who held a build tile to ask what it costs must not have bought it.
  test("a press that fired eats the click that follows", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const click = vi.fn();
    const el = mount(fire, click);
    down(el);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    up(el);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  test("an ordinary tap still clicks", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const el = mount(() => {}, click);
    down(el);
    up(el);
    expect(click).toHaveBeenCalledTimes(1);
  });

  // A finger that has travelled is panning the board, not holding a piece.
  test("drifting past the slop cancels the hold", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    down(el, 100, 100);
    move(el, 100 + LONG_PRESS_SLOP_PX + 5, 100);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).not.toHaveBeenCalled();
  });

  test("jitter inside the slop does not", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    down(el, 100, 100);
    move(el, 102, 101);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).toHaveBeenCalledTimes(1);
  });

  // `pointercancel` is how a scroll gesture takes the pointer away mid-press.
  test("a cancelled pointer cancels the hold", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    down(el);
    act(() => {
      el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }));
    });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).not.toHaveBeenCalled();
  });

  // A mouse has hover; binding the hold would turn a slow click on a hex into
  // a description instead of a robber move.
  test("a mouse press is ignored", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const el = mount(fire, () => {});
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }),
      );
    });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(fire).not.toHaveBeenCalled();
  });
});

/** A button wired to the tap guard, with its own click handler. */
function mountTap(onClick: () => void) {
  function Probe() {
    const tap = useTapOnly();
    return (
      <button type="button" onClick={onClick} {...tap}>
        press me
      </button>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe />));
  return host.querySelector("button")!;
}

describe("a tap, not a swipe's leftovers", () => {
  // The shelf scrolls sideways on a phone and some tiles spend on the first
  // press, so a flick must not count as a click.
  test("a still press clicks", () => {
    const click = vi.fn();
    const el = mountTap(click);
    down(el, 100, 100);
    up(el);
    expect(click).toHaveBeenCalledTimes(1);
  });

  test("a press that travelled does not", () => {
    const click = vi.fn();
    const el = mountTap(click);
    down(el, 100, 100);
    move(el, 100 + LONG_PRESS_SLOP_PX + 4, 100);
    up(el);
    expect(click).not.toHaveBeenCalled();
  });

  test("jitter inside the slop still clicks", () => {
    const click = vi.fn();
    const el = mountTap(click);
    down(el, 100, 100);
    move(el, 102, 101);
    up(el);
    expect(click).toHaveBeenCalledTimes(1);
  });

  // `pointercancel` is the scroller taking the gesture away.
  test("a cancelled pointer does not click", () => {
    const click = vi.fn();
    const el = mountTap(click);
    down(el, 100, 100);
    act(() => {
      el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }));
    });
    up(el);
    expect(click).not.toHaveBeenCalled();
  });

  // One swipe must not poison the next press.
  test("the guard resets between gestures", () => {
    const click = vi.fn();
    const el = mountTap(click);
    down(el, 100, 100);
    move(el, 140, 100);
    up(el);
    expect(click).not.toHaveBeenCalled();
    down(el, 100, 100);
    up(el);
    expect(click).toHaveBeenCalledTimes(1);
  });

  // A mouse drag is not a click either, and a trackpad flick scrolls the same
  // shelf.
  test("it guards a mouse too", () => {
    const click = vi.fn();
    const el = mountTap(click);
    act(() => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
          pointerType: "mouse",
          button: 0,
        }),
      );
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 60,
          clientY: 10,
          pointerType: "mouse",
        }),
      );
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(click).not.toHaveBeenCalled();
  });
});
