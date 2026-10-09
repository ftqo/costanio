import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useLint } from "./useLint";
import { api } from "@/lib/api";
import type { Board, MapIssue } from "@/lib/types";

const board: Board = { radius: 2, robber: { q: 0, r: 0 }, harbors: [], tiles: [] };

function mountHook(enabled: boolean, delayMs: number, ruleset = "base") {
  const result = { current: [] as MapIssue[] };
  function Harness() {
    result.current = useLint(board, enabled, ruleset, delayMs);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  return { result, root };
}

afterEach(() => vi.restoreAllMocks());

describe("useLint", () => {
  it("returns issues after a debounced call", async () => {
    vi.spyOn(api, "lintMap").mockResolvedValue({
      issues: [{ severity: "warning", code: "adjacent_red", hexes: [] }],
    });
    const { result, root } = mountHook(true, 10);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(result.current.length).toBe(1);
    expect(result.current[0].code).toBe("adjacent_red");
    act(() => root.unmount());
  });

  it("forwards the ruleset to the lint endpoint", async () => {
    const spy = vi.spyOn(api, "lintMap").mockResolvedValue({ issues: [] });
    const { root } = mountHook(true, 10, "base+islands");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(spy).toHaveBeenCalledWith(board, "base+islands");
    act(() => root.unmount());
  });

  it("stays empty when disabled", async () => {
    const spy = vi.spyOn(api, "lintMap").mockResolvedValue({ issues: [] });
    const { result, root } = mountHook(false, 10);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(result.current).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
