import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { CardRevealLayer, LastDrawnTab, RevealDock, type RevealBatch } from "./CardRevealLayer";
import { revealDurationMs, revealsIn, REVEAL_TRAVEL_MS } from "@/lib/cardReveal";
import { createHudAnchors } from "@/lib/hudAnchors";
import { PlayerCard, type PlayerCardData } from "./PlayerCard";

i18n.load("en", {});
i18n.activate("en");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const NAMES = ["Ada", "Bea", "Cy"];
function mount(
  batch: RevealBatch | null,
  opts: { reduced?: boolean; onDocking?: (p: boolean) => void } = {},
) {
  const anchors = createHudAnchors();
  const hand = { current: null };
  act(() =>
    root.render(
      <I18nProvider i18n={i18n}>
        <CardRevealLayer
          batch={batch}
          anchors={anchors}
          reduced={opts.reduced ?? false}
          hand={hand}
          seatName={(s) => NAMES[s] ?? "?"}
          seatColor={() => "#c33"}
          onDocking={opts.onDocking}
        />
      </I18nProvider>,
    ),
  );
  return anchors;
}
// Frame by frame, each in its own act: a frame's state update (the card
// mounting) has to commit before the next frame can place it, as in a browser.
const advance = (ms: number) => {
  for (let t = 0; t < ms; t += 16) act(() => vi.advanceTimersByTime(Math.min(16, ms - t)));
};
const reveal = () => document.body.querySelector<HTMLElement>("[data-card-reveal]");

describe("the reveal layer", () => {
  test("flips the buyer's card with drawer and rule, then clears", () => {
    const reveals = revealsIn(
      [{ seq: 5, type: "raiders_card", data: { player: 0, card: "muster" } }],
      0,
    );
    const docking = vi.fn();
    mount({ id: 1, reveals }, { onDocking: docking });
    // The card mounts on the first frame and is placed from the second.
    advance(40);
    expect(reveal()?.getAttribute("data-card-reveal")).toBe("raiders:muster");
    expect(reveal()?.getAttribute("data-reveal-mine")).toBe("true");
    expect(document.body.textContent).toContain("You drew this card");
    expect(document.body.textContent).toContain(
      "Put one of your riders on a free path at the castle.",
    );
    expect(docking).toHaveBeenLastCalledWith(true);
    // Face down as it leaves the tile.
    const turn = reveal()!.firstElementChild as HTMLElement;
    expect(turn.style.transform).toBe("rotateY(180deg)");
    advance(REVEAL_TRAVEL_MS + 200);
    expect(turn.style.transform).toBe("rotateY(0deg)");
    advance(revealDurationMs(false));
    expect(reveal()).toBeNull();
    expect(docking).toHaveBeenLastCalledWith(false);
  });

  test("an opponent's card names the seat and is drawn smaller", () => {
    const reveals = revealsIn(
      [{ seq: 6, type: "raiders_card", data: { player: 1, card: "treason" } }],
      0,
    );
    mount({ id: 1, reveals });
    advance(REVEAL_TRAVEL_MS + 400);
    expect(reveal()?.getAttribute("data-reveal-mine")).toBeNull();
    expect(document.body.textContent).toContain("Bea drew this card");
    expect(reveal()!.style.transform).toContain("scale(0.8)");
  });

  test("reduced motion: fades without flipping", () => {
    const reveals = revealsIn([{ seq: 7, type: "wagons_swift_played", data: { player: 2 } }], 0);
    mount({ id: 1, reveals }, { reduced: true });
    for (const step of [40, 60, 400, 1000]) {
      advance(step);
      const turn = reveal()!.firstElementChild as HTMLElement;
      expect(turn.style.transform).toBe("rotateY(0deg)");
    }
    expect(document.body.textContent).toContain("Cy played this card");
    advance(revealDurationMs(true));
    expect(reveal()).toBeNull();
  });

  test("a void card says it did nothing in place of its rule", () => {
    const reveals = revealsIn(
      [{ seq: 8, type: "raiders_card", data: { player: 0, card: "intrigue", void: true } }],
      0,
    );
    mount({ id: 1, reveals });
    advance(REVEAL_TRAVEL_MS + 400);
    expect(document.body.textContent).toContain("another is drawn");
  });

  test("nothing is drawn for a batch with no reveals", () => {
    mount({
      id: 1,
      reveals: revealsIn(
        [{ seq: 9, type: "dev_card_bought", data: { player: 0, card: "knight" } }],
        0,
      ),
    });
    advance(100);
    expect(reveal()).toBeNull();
  });
});

describe("the dock and the tab", () => {
  test("the prompt thumbnail stays empty while its card is in flight", () => {
    const anchors = createHudAnchors();
    act(() => root.render(<RevealDock slot="raiders_muster" anchors={anchors} waiting />));
    const dock = document.body.querySelector("[data-reveal-dock]")!;
    expect(dock.getAttribute("data-waiting")).toBe("true");
    expect(anchors.el("reveal:dock")).toBe(dock);
    act(() => root.render(<RevealDock slot="raiders_muster" anchors={anchors} waiting={false} />));
    expect(dock.getAttribute("data-waiting")).toBeNull();
  });

  test("the seat card draws the last-drawn tab beside the name", () => {
    const p: PlayerCardData = {
      seat: 1,
      name: "Bea",
      color: "#33c",
      vp: 3,
      active: false,
      handCount: 2,
      devCount: 0,
      knightsPlayed: 0,
      routeLength: 1,
      longestRoad: false,
      longestRoadLabel: "ROAD",
      largestArmy: false,
      islandVp: 0,
      islands: false,
    };
    act(() =>
      root.render(
        <I18nProvider i18n={i18n}>
          <PlayerCard p={p} tab={<LastDrawnTab kind="raiders" id="treason" />} />
        </I18nProvider>,
      ),
    );
    const tab = document.body.querySelector("[data-last-drawn]")!;
    expect(tab.getAttribute("data-last-drawn")).toBe("raiders:treason");
    expect(tab.getAttribute("aria-label")).toBe("Last drawn: Treason");
  });
});
