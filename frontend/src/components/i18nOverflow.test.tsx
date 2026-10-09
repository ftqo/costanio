import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rulesetCaps } from "@/lib/caps";
import type { PlayerStat } from "@/lib/types";

// The dock's Rejoin control is a `Button asChild` wrapping a router Link, and
// the button's classes must reach the anchor, so this stub forwards
// `className` (unlike SiteHeader.test.tsx's).
vi.mock("@tanstack/react-router", () => ({
  Link: (p: { className?: string; children?: React.ReactNode }) =>
    React.createElement("a", { className: p.className }, p.children),
}));

import { Button } from "@/components/ui/button";
import { GameDock } from "@/components/GameDock";
import { SiteFooter } from "@/components/SiteFooter";
import { PostGameScoreboard } from "@/components/game/PostGameScoreboard";

/**
 * The overflow contract for chrome that translation grows.
 *
 * jsdom has no layout, so nothing here can prove a German string fits. What it
 * can prove is that the mechanism letting it fit is still attached: each case
 * is a box that may not size itself from its text alone, and the class that
 * enforces it. The pixel figures were measured against the real strings in
 * `src/locales/{de,es,ja,zh-Hans}/messages.po` and noted at each case.
 */

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

describe("Button's wrap variant", () => {
  it("keeps nowrap by default", () => {
    act(() => root.render(<Button>Boost to unlock</Button>));
    const b = host.querySelector("button")!;
    expect(b.className).toContain("whitespace-nowrap");
    expect(b.className).not.toContain("whitespace-normal");
  });

  it("lets the label wrap with the wrap prop", () => {
    // `Boost to unlock` (15 characters) is `Mejora el servidor para
    // desbloquear` (34) in Spanish, inside a ~180px store card; with nowrap it
    // would draw outside the card.
    act(() => root.render(<Button wrap>Boost to unlock</Button>));
    const b = host.querySelector("button")!;
    expect(b.className).toContain("whitespace-normal");
  });

  it("passes the wrap class through asChild", () => {
    act(() =>
      root.render(
        <Button asChild wrap>
          <a href="/support">Boost to unlock</a>
        </Button>,
      ),
    );
    const a = host.querySelector("a")!;
    expect(a.className).toContain("whitespace-normal");
  });
});

describe("GameDock", () => {
  // Pinned bottom-right, so it grows leftward unchecked. The subtitle `Tap to
  // rejoin` (13) is `Tippen, um erneut beizutreten` (29), and `Rejoin` (6) is
  // `Platz zurücknehmen` (18) and `Recuperar asiento` (17).
  it("caps its width to the viewport and shrinks the text column", () => {
    act(() => root.render(<GameDock gameId="abc" />));
    const dock = host.firstElementChild as HTMLElement;
    expect(dock.className).toMatch(/max-w-\[calc\(100vw/);
    // The 46px board thumbnail must not shrink; the text beside it must.
    const thumb = dock.querySelector(".w-\\[46px\\]")!;
    expect(thumb.className).toContain("shrink-0");
    expect(dock.querySelector(".min-w-0")).not.toBeNull();
  });

  it("has no input-specific wording", () => {
    act(() => root.render(<GameDock gameId="abc" />));
    expect(host.textContent).not.toMatch(/tap|click/i);
  });

  it("sets --game-dock-h while mounted and clears it on unmount", () => {
    act(() => root.render(<GameDock gameId="abc" />));
    expect(document.documentElement.style.getPropertyValue("--game-dock-h")).toMatch(/px$/);
    act(() => root.render(<div />));
    expect(document.documentElement.style.getPropertyValue("--game-dock-h")).toBe("");
  });

  it("pads the page footer by --game-dock-h", () => {
    act(() => root.render(<SiteFooter />));
    expect((host.firstElementChild as HTMLElement).className).toContain("var(--game-dock-h");
  });

  it("lets the Rejoin button wrap", () => {
    act(() => root.render(<GameDock gameId="abc" />));
    expect(host.querySelector("a")!.className).toContain("whitespace-normal");
  });
});

describe("PostGameScoreboard details matrix", () => {
  function stat(over: Partial<PlayerStat> & { seat: number; vp: number }): PlayerStat {
    return {
      settlements: 0,
      cities: 0,
      roads: 0,
      knights: 0,
      dev_cards: 0,
      longest_road: 0,
      has_longest_road: false,
      has_largest_army: false,
      produced: 0,
      expected: 0,
      robber_loss: 0,
      stolen: 0,
      steals: 0,
      bank_trades: 0,
      player_trades: 0,
      luck_rel: 0,
      ...over,
    };
  }

  function renderDetails() {
    act(() =>
      root.render(
        <PostGameScoreboard
          players={[stat({ seat: 0, vp: 10 }), stat({ seat: 1, vp: 7 })]}
          winner={0}
          caps={rulesetCaps("base")}
          seatName={(s) => `Seat ${s}`}
          colorOf={() => "var(--color-red)"}
          rolls={{ 7: 3 }}
        />,
      ),
    );
    // Switch to the Details view, where the stat names are a frozen column.
    const details = [...host.querySelectorAll("button")].find((b) =>
      /details/i.test(b.textContent ?? ""),
    )!;
    act(() => details.click());
  }

  it("wraps the frozen stat-name column instead of widening it", () => {
    // `Dev cards held` is 14 characters in English and 28 in German
    // (`Gehaltene Entwicklungskarten`) and Spanish (`Cartas de desarrollo en
    // mano`). The column is sticky, so its width comes off every player column.
    renderDetails();
    // The row labels, not section headings: both are sticky, but only labels
    // share a row with the per-player figures.
    const labels = [...host.querySelectorAll("td.sticky")].filter(
      (td) => !td.hasAttribute("colspan"),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const td of labels) {
      expect(td.className).not.toContain("whitespace-nowrap");
      expect(td.querySelector("span")!.className).toMatch(/max-w-\[\d+px\]/);
    }
  });

  it("keeps the view switcher from shrinking", () => {
    // `Detailed stats` (14) is `Detaillierte Statistiken` (24) and
    // `Estadísticas detalladas` (23), drawn uppercase with tracking.
    renderDetails();
    const seg = host.querySelector(".shrink-0")!;
    expect(seg).not.toBeNull();
  });
});
