import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WarningsPanel } from "./WarningsPanel";
import type { MapIssue } from "@/lib/types";

function mount(ui: React.ReactElement) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r: Root = createRoot(c);
  act(() => r.render(ui));
  return { c, r };
}

describe("WarningsPanel", () => {
  it("shows a clean message with no issues", () => {
    const { c, r } = mount(<WarningsPanel issues={[]} onHighlight={() => {}} />);
    expect(c.textContent?.toLowerCase()).toContain("no issues");
    act(() => r.unmount());
  });

  it("calls onHighlight with the issue's hexes on click", () => {
    const onHi = vi.fn();
    const issues: MapIssue[] = [
      {
        severity: "warning",
        code: "adjacent_red",
        hexes: [{ q: 0, r: 0 }],
      },
    ];
    const { c, r } = mount(<WarningsPanel issues={issues} onHighlight={onHi} />);
    const row = c.querySelector("button");
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onHi).toHaveBeenCalledWith([{ q: 0, r: 0 }]);
    act(() => r.unmount());
  });

  it("renders errors before warnings", () => {
    const onHi = vi.fn();
    const issues: MapIssue[] = [
      { severity: "warning", code: "adjacent_red", hexes: [] },
      { severity: "error", code: "no_desert", hexes: [] },
    ];
    const { c, r } = mount(<WarningsPanel issues={issues} onHighlight={onHi} />);
    const buttons = c.querySelectorAll("button");
    // The words are the client's, keyed off the code (see lib/errorCopy).
    expect(buttons[0].textContent).toContain("desert");
    expect(buttons[1].textContent).toContain("touching");
    act(() => r.unmount());
  });

  it("calls onHighlight with [] for an issue with no hexes", () => {
    const onHi = vi.fn();
    const issues: MapIssue[] = [
      { severity: "error", code: "no_desert", hexes: [{ q: 1, r: 2 }] },
      { severity: "warning", code: "adjacent_red", hexes: [] },
    ];
    const { c, r } = mount(<WarningsPanel issues={issues} onHighlight={onHi} />);
    // Click the warning row (hexes: []); onHighlight is called with its hexes.
    const buttons = c.querySelectorAll("button");
    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onHi).toHaveBeenCalledWith([]);
    act(() => r.unmount());
  });
});
