import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMediaQuery } from "./useMediaQuery";

type Listener = () => void;

// jsdom ships no matchMedia, so install a controllable stub: flip `matches` then
// emit() to fire the change event, mirroring a viewport crossing the breakpoint.
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  window.matchMedia = ((_q: string) => mql) as unknown as typeof window.matchMedia;
  return {
    set(v: boolean) {
      matches = v;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
}

function mountHook(query: string) {
  const result = { current: false };
  function Harness() {
    result.current = useMediaQuery(query);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  return { result, root };
}

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error allow clearing the stub between tests
  delete window.matchMedia;
});

describe("useMediaQuery", () => {
  it("reports the initial match state", () => {
    stubMatchMedia(true);
    const { result, root } = mountHook("(min-width: 640px)");
    expect(result.current).toBe(true);
    act(() => root.unmount());
  });

  it("updates when the query starts matching", () => {
    const ctl = stubMatchMedia(false);
    const { result, root } = mountHook("(min-width: 640px)");
    expect(result.current).toBe(false);
    act(() => ctl.set(true));
    expect(result.current).toBe(true);
    act(() => root.unmount());
  });

  it("unsubscribes on unmount", () => {
    const ctl = stubMatchMedia(true);
    const { root } = mountHook("(min-width: 640px)");
    expect(ctl.listenerCount()).toBe(1);
    act(() => root.unmount());
    expect(ctl.listenerCount()).toBe(0);
  });

  it("returns false when matchMedia is unavailable", () => {
    const { result, root } = mountHook("(min-width: 640px)");
    expect(result.current).toBe(false);
    act(() => root.unmount());
  });
});
