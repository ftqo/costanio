import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rulesetCaps } from "@/lib/caps";
import type { PlayerStat } from "@/lib/types";
import { ChartBoundary, PostGameScoreboard } from "./PostGameScoreboard";

// The standings table claims its sources cover every way a seat can hold a
// point. These tests read the table back and check each row adds up, so an
// unlisted VP source fails here.

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

function render(players: PlayerStat[], ruleset: string) {
  act(() =>
    root.render(
      <PostGameScoreboard
        players={players}
        winner={players[0].seat}
        caps={rulesetCaps(ruleset)}
        seatName={(s) => `Seat ${s}`}
        colorOf={() => "var(--color-red)"}
        rolls={{ 6: 10, 7: 12, 8: 9 }}
      />,
    ),
  );
}

/**
 * The standings, read back: each row's total, and the points it names, as
 * [source key, points] pairs in the order they are drawn.
 */
function standings() {
  const rows = [...host.querySelectorAll("li.pg-row")].map((li) => ({
    vp: Number(li.querySelector("[data-vp]")!.getAttribute("data-vp")),
    rank: li.querySelector(".pg-rank")!.textContent,
    winner: li.getAttribute("data-winner") === "true",
    chips: [...li.querySelectorAll(".pg-src")].map(
      (c) => [c.getAttribute("data-source")!, Number(c.getAttribute("data-points"))] as const,
    ),
    labels: [...li.querySelectorAll(".pg-src-l")].map((c) => c.textContent ?? ""),
  }));
  return { rows };
}

const sum = (chips: readonly (readonly [string, number])[]) => chips.reduce((a, [, v]) => a + v, 0);

describe("PostGameScoreboard standings", () => {
  // A chip's figure is signed, so one city's "+2" reads as points, not two
  // cities.
  it("signs every chip as points", () => {
    render([stat({ seat: 0, vp: 3, settlements: 1, cities: 1 })], "base");
    const values = [...host.querySelectorAll(".pg-src-v")].map((v) => v.textContent);
    expect(values).toEqual(["+1", "+2"]);
  });

  it("columns add up to each seat's total in a base game", () => {
    const players = [
      stat({
        seat: 0,
        vp: 10,
        settlements: 2,
        cities: 3,
        roads: 9,
        has_longest_road: true,
        longest_road: 7,
        vp_breakdown: {
          settlements: 2,
          cities: 3,
          longest_road: 2,
          largest_army: 0,
          dev_vp: 0,
          island_vp: 0,
          metropolis: 0,
          defender: 0,
          merchant: 0,
          extra_cak: 0,
          caravan: 0,
        },
      }),
      stat({
        seat: 1,
        vp: 8,
        settlements: 3,
        cities: 1,
        has_largest_army: true,
        knights: 3,
        vp_breakdown: {
          settlements: 3,
          cities: 1,
          longest_road: 0,
          largest_army: 2,
          dev_vp: 1,
          island_vp: 0,
          metropolis: 0,
          defender: 0,
          merchant: 0,
          extra_cak: 0,
          caravan: 0,
        },
      }),
    ];
    render(players, "base");
    const { rows } = standings();
    for (const row of rows) expect(sum(row.chips)).toBe(row.vp);
    expect(rows.map((r) => r.vp)).toEqual([10, 8]);
    // Only the sources a seat scored in, by name; a zero is left out.
    expect(rows[0].labels).toEqual(["Settlements", "Cities", "Longest Road"]);
    expect(rows[1].chips).toEqual([
      ["settlements", 3],
      ["cities", 2],
      ["largest_army", 2],
      ["dev_vp", 1],
    ]);
    expect(rows[0].winner).toBe(true);
    expect(rows[1].winner).toBe(false);
  });

  it("columns every Knights point source and adds up", () => {
    const knightsStats = {
      knights_total: 4,
      knights_active: 2,
      knight_levels: [2, 1, 1] as [number, number, number],
      metropolis: 2,
      improve: [3, 4, 2] as [number, number, number],
      walls: 2,
      commodities_produced: 30,
      progress_played: 6,
      barbarian_defenses_won: 4,
      cities_lost_to_barbarians: 1,
      defender_vp: 2,
      merchant_vp: 1,
      extra_vp: 1,
    };
    const players = [
      stat({
        seat: 0,
        vp: 18,
        settlements: 2,
        cities: 3,
        cak: knightsStats,
        vp_breakdown: {
          settlements: 2,
          cities: 3,
          longest_road: 2,
          largest_army: 0,
          dev_vp: 0,
          island_vp: 0,
          metropolis: 4,
          defender: 2,
          merchant: 1,
          extra_cak: 1,
          caravan: 0,
        },
      }),
    ];
    render(players, "base+cak");
    const { rows } = standings();
    // No Largest Army and no VP cards under Knights; every module point instead.
    expect(rows[0].vp).toBe(18);
    expect(rows[0].chips).toEqual([
      ["settlements", 2],
      ["cities", 6],
      ["longest_road", 2],
      ["metropolis", 4],
      ["defender", 2],
      ["merchant", 1],
      ["extra_cak", 1],
    ]);
    expect(sum(rows[0].chips)).toBe(18);
  });

  it("shows an Other column when points escape every source", () => {
    // A total the breakdown cannot explain: the 3 stray points must be visible.
    const players = [stat({ seat: 0, vp: 9, settlements: 3, cities: 1, has_longest_road: false })];
    // No vp_breakdown, so it is reconstructed: 3 + 2 = 5 accounted, and a base
    // game has VP cards to absorb the remaining 4.
    render(players, "base");
    expect(standings().rows[0].chips.map(([k]) => k)).not.toContain("other");

    // Under Knights there is no card row to absorb them, so they surface.
    act(() => root.unmount());
    root = createRoot(host);
    render(players, "base+cak");
    const { rows } = standings();
    expect(rows[0].chips.at(-1)).toEqual(["other", 4]);
    expect(sum(rows[0].chips)).toBe(rows[0].vp);
  });
});

describe("PostGameScoreboard ranks and details", () => {
  it("ranks a tie as a tie", () => {
    render(
      [
        stat({ seat: 2, vp: 10, settlements: 10 }),
        stat({ seat: 0, vp: 7, settlements: 7 }),
        stat({ seat: 1, vp: 7, settlements: 7 }),
        stat({ seat: 3, vp: 4, settlements: 4 }),
      ],
      "base",
    );
    expect(standings().rows.map((r) => r.rank)).toEqual(["1", "2", "2", "4"]);
  });

  function details(players: PlayerStat[], ruleset: string) {
    render(players, ruleset);
    const btn = [...host.querySelectorAll("button[role=tab]")].find((b) =>
      /details/i.test(b.textContent ?? ""),
    )!;
    act(() => (btn as HTMLButtonElement).click());
    return [...host.querySelectorAll("td.pg-stat")].map((td) => td.textContent);
  }

  // Both are game-wide counts the server repeats on every seat's line, so they
  // aren't per-player matrix rows.
  it("keeps table-wide counts out of the per-seat matrix", () => {
    const knightsStats = {
      knights_total: 0,
      knights_active: 0,
      knight_levels: [0, 0, 0] as [number, number, number],
      metropolis: 0,
      improve: [0, 0, 0] as [number, number, number],
      walls: 0,
      commodities_produced: 0,
      progress_played: 0,
      barbarian_defenses_won: 3,
      cities_lost_to_barbarians: 0,
      defender_vp: 0,
      merchant_vp: 0,
      extra_vp: 0,
    };
    const labels = details([stat({ seat: 0, vp: 5, cak: knightsStats })], "base+cak");
    expect(labels).not.toContain("Barbarian defenses");
    expect(host.querySelector(".pg-facts")?.textContent).toContain("Barbarian attacks repelled: 3");
  });

  // No "Longest road length" row without Longest Road, and no "Lost to robber"
  // without a robber (e.g. Explorers).
  it("drops the rows for pieces the ruleset does not have", () => {
    const explorers = details([stat({ seat: 0, vp: 17, robber_loss: 4 })], "explorers");
    expect(explorers).not.toContain("Longest road length");
    expect(explorers).not.toContain("Longest trade route length");
    expect(explorers).not.toContain("Lost to robber");
    expect(explorers).toContain("Discarded on a 7");
    act(() => root.unmount());
    root = createRoot(host);
    const base = details([stat({ seat: 0, vp: 10 })], "base");
    expect(base).toContain("Longest road length");
    expect(base).toContain("Lost to robber");
    act(() => root.unmount());
    root = createRoot(host);
    expect(details([stat({ seat: 0, vp: 10 })], "base+islands")).toContain(
      "Longest trade route length",
    );
  });

  it("names the fish counts as tiles held, not caught", () => {
    const labels = details(
      [
        stat({
          seat: 0,
          vp: 10,
          fish: { caught: [0, 0, 0], value: 0, spent: 11, has_boot: false },
        }),
      ],
      "base+fishermen",
    );
    expect(labels).toEqual(
      expect.arrayContaining(["1-fish tiles held", "2-fish tiles held", "3-fish tiles held"]),
    );
    expect(labels.some((l) => /caught/i.test(l ?? ""))).toBe(false);
  });

  it("draws the Raiders and Wagons blocks the server sends", () => {
    const row = {
      ...stat({ seat: 0, vp: 5 }),
      raiders: {
        prisoners: 5,
        prisoner_vp: 2,
        gold: 3,
        riders_on_board: 4,
        buildings_conquered: 1,
      },
      wagons: { delivered: 2, level: 3, gold: 1, tolls: 4, paid: 0 },
    };
    const labels = details([row], "base+raiders+wagons");
    expect(labels).toEqual(
      expect.arrayContaining(["Prisoners taken", "Loads delivered", "Tolls taken"]),
    );
    const prisoners = [...host.querySelectorAll("tr")].find(
      (tr) => tr.querySelector("td.pg-stat")?.textContent === "Prisoners taken",
    )!;
    expect(prisoners.querySelectorAll("td")[1].textContent).toBe("5");
  });
});

describe("a chart that cannot load", () => {
  it("fails in place without breaking the screen", () => {
    // A pre-deploy chunk 404s and the lazy import rethrows at render; the
    // boundary keeps the end screen up.
    const Missing = () => {
      throw new Error("Failed to fetch dynamically imported module: /assets/RollChart-old.js");
    };
    const quiet = console.error;
    console.error = () => {};
    try {
      act(() =>
        root.render(
          <div>
            <p>standings</p>
            <ChartBoundary>
              <Missing />
            </ChartBoundary>
          </div>,
        ),
      );
    } finally {
      console.error = quiet;
    }
    expect(host.textContent).toContain("standings");
    expect(host.textContent).toContain("This chart could not be loaded.");
  });
});
