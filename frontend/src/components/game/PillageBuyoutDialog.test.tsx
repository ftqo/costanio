import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PillageBuyoutDialog } from "./PillageBuyoutDialog";
import { buyoutWealthCost } from "@/lib/rivers";
import type { FullView } from "@/lib/types";

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

const rivers = (coins: number[], extra: Record<string, unknown> = {}) =>
  ({ ext: { rivers: { coins, poorest_in_play: true, ...extra } } }) as unknown as FullView;

function render(v: FullView, afford = true, coins = 5) {
  const calls: string[] = [];
  act(() =>
    root.render(
      <PillageBuyoutDialog
        coins={coins}
        afford={afford}
        cost={buyoutWealthCost(v, 0)}
        onPay={() => calls.push("pay")}
        onStandDown={() => calls.push("down")}
      />,
    ),
  );
  return calls;
}
const warning = () => document.body.querySelector("[data-pillage-wealth-warning]");
const buttons = () => [...document.body.querySelectorAll("button")];

describe("pillage buyout VP warning", () => {
  it("names both tiles when the leader would drop to the fewest coins", () => {
    render(rivers([5, 1, 2], { wealthiest: 0, poorest: [false, true, false] }));
    expect(warning()?.textContent).toMatch(/lose the Wealthiest Settler \(\+1\)/);
    expect(warning()?.textContent).toMatch(/Poorest Settler tile \(-2\)/);
  });
  it("says nothing when paying moves no tile", () => {
    render(rivers([9, 1, 2], { wealthiest: 0, poorest: [false, true, false] }));
    expect(warning()).toBeNull();
  });
  it("shows no warning or pay button to a seat that cannot pay", () => {
    const calls = render(rivers([3, 1, 2], { wealthiest: 0 }), false, 3);
    expect(warning()).toBeNull();
    const pay = buttons().find((b) => /Pay 5 coins/.test(b.textContent ?? ""))!;
    expect(pay.disabled).toBe(true);
    expect(document.body.querySelector("[data-pillage-rule]")?.textContent).toMatch(/cannot pay/);
    buttons()
      .find((b) => /Give a city up instead/.test(b.textContent ?? ""))!
      .click();
    expect(calls).toEqual(["down"]);
  });
  it("reads at body size: no 11px copy", () => {
    render(rivers([5, 1, 2], { wealthiest: 0, poorest: [false, true, false] }));
    expect(document.body.querySelector('[class*="text-[11px]"]')).toBeNull();
  });
});
