import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrackPips } from "./TrackPips";

// TrackPips at both sizes. PlayerCardTracks.test.tsx covers `size="card"`
// through the real seat card; this covers the hotbar's `size="tile"`, where
// the underline must not fill but the reserved row stays.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

function rule() {
  return host.querySelector<HTMLElement>("span[aria-hidden]")!;
}

describe('TrackPips at size="tile" (the hotbar)', () => {
  it("reserves the underline row but never fills it, permanent metropolis", () => {
    act(() => {
      root.render(
        <TrackPips level={5} metropolis={true} color="var(--color-cloth-ink)" size="tile" />,
      );
    });
    expect(rule()).toBeTruthy();
    expect(rule().style.background).toBe("");
  });

  it("reserves the underline row but never fills it, steal-able metropolis", () => {
    act(() => {
      root.render(
        <TrackPips level={4} metropolis={true} color="var(--color-cloth-ink)" size="tile" />,
      );
    });
    expect(rule()).toBeTruthy();
    expect(rule().style.background).toBe("");
  });

  it('draws nothing when the track holds no metropolis, same as size="card"', () => {
    act(() => {
      root.render(
        <TrackPips level={2} metropolis={false} color="var(--color-cloth-ink)" size="tile" />,
      );
    });
    expect(rule().style.background).toBe("");
  });
});

describe('TrackPips at size="card" (the sidebar)', () => {
  it("fills the underline", () => {
    act(() => {
      root.render(
        <TrackPips level={5} metropolis={true} color="var(--color-cloth-ink)" size="card" />,
      );
    });
    expect(rule().style.background).toBe("var(--color-cloth-ink)");
  });
});
