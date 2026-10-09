import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { DecisionClockView } from "./DecisionClock";

i18n.load("en", {});
i18n.activate("en");

// A decision panel shows the viewer's own countdown, ticking, rather than
// relying on the strip along the screen's top edge behind the dialog.
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (remainingMs: number | null) =>
  act(() =>
    root.render(
      <I18nProvider i18n={i18n}>
        <DecisionClockView remainingMs={remainingMs} budgetMs={20000} />
      </I18nProvider>,
    ),
  );
const secs = () => host.querySelector("[data-decision-clock-secs]")?.textContent;

describe("DecisionClockView", () => {
  it("shows the seconds left and counts them down", () => {
    render(12_000);
    expect(secs()).toBe("12 seconds left");
    act(() => vi.advanceTimersByTime(3_000));
    expect(secs()).toBe("9 seconds left");
    act(() => vi.advanceTimersByTime(20_000));
    expect(secs()).toBe("0 seconds left");
  });

  it("draws nothing when the viewer is not on the clock", () => {
    render(null);
    expect(host.querySelector("[data-decision-clock]")).toBeNull();
  });
});
