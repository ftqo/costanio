import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The rules page's claims, checked against what the engine does. Each row is
// one rule in the words a player sees, with the engine symbol that decides it
// noted beside it. An `absent` entry is wrong wording the page must not
// contain.
//
// Strings are short substrings of the rendered text, not whole paragraphs: each
// `present` string is the shortest span that would have to change for the rule
// to change, so the test does not break on every comma.
const h = vi.hoisted(() => ({ navigate: vi.fn(), search: {} }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  useSearch: () => h.search,
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
}));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/asset/AssetParts", () => ({
  ResIcon: () => null,
  CardFace: () => null,
}));
vi.mock("@/components/game/PieceIcon", () => ({ PieceArt: () => null }));
vi.mock("@/lib/useRulesProps", () => ({ useRulesProps: () => ({}) }));

import { HowToPlay } from "./HowToPlay";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  container.remove();
});

/**
 * Every word of one tab, with runs of whitespace flattened (JSX line breaks
 * render as whitespace). The tab is selected through `?tab=`, which the page
 * reads from the router; clicking is tested in the sibling file.
 */
function tabText(tab: string): string {
  h.search = { tab };
  act(() => root.render(React.createElement(HowToPlay)));
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

interface RuleCase {
  /** What the page must say, in the player's own words. */
  present: string[];
  /** Wording that was here and stated a rule the engine does not have. */
  absent?: string[];
}

const CHAPTERS: Record<string, RuleCase> = {
  islands: {
    present: [
      // `islands/decide.go:73-86` exempts the free ship from the actionable-turn
      // test, and `TestFreeShipPlaceableBeforeRolling` pins it.
      "Either free build may be placed before you roll",
      // Lobby games always carry a map (lobby.go gives every config a board or
      // preset), and islands.SetupBoard never carves one, so the help sends
      // players to a map with sea rather than describing a carve they never see.
      "requires a map with sea",
      // The pin is a building at one end and your own continuing ship at the
      // other, not two buildings (`decide.go:263-283`).
      "a ship with neither end open can't move at all",
      // The knight rule, shared with the Knights chapter.
      "chases the pirate",
    ],
    absent: [
      // Wording that contradicts the code.
      "a free ship cannot",
      "about half the outer ring becomes water",
      "gold appears only on the carved outer ring",
      "the generator carves it in",
      "gold usually appears on the carved outer ring",
    ],
  },

  knights: {
    present: [
      // `knightReachable` (`knights/decide.go:1083`) walks roads and ships, joining
      // at the owner's own buildings.
      "Knights travel your routes",
      "in an Islands game your ships as well",
      "travel along your connected routes, roads and ships alike",
      "any empty intersection their own routes still reach",
      // `decideChaseRobber` drives the pirate off a sea destination
      // (`decide.go:1329-1338`), pinned by `knights_at_sea_test.go:348`.
      "A knight standing on a sea intersection chases the pirate",
      // A harbour prices the give side (`decide.go:479`, knights.md:330-338).
      "A harbour prices what you give",
      "2 wood at a wood harbour buys 1 paper",
      // `decide.go:729` emits EvImproved regardless; only the metropolis is withheld.
      "still gets you the level",
      // `knights/apply.go:249-254` returns early on Skipped.
      "no knight stands down and no Defender token is awarded",
      // `cardEffects` refuses a dead play with ErrCardNoEffect
      // (`knights/progress_play.go`), pinned by TestProgressCardWithNoEffectIsRefused;
      // the monopolies are refused only on a public zero count.
      "cannot be played",
      "a monopoly naming a good nobody turns out to hold",
      // `weakest` ranges only over downgradable cities (`knights/hooks.go`), pinned
      // by TestPillageAllMetropolises.
      "If every city on the board is a metropolis, nobody loses anything",
      // `decideDeserterPlace` takes any tier up to the ceiling.
      "of the same strength or lower",
    ],
    absent: [
      // A no-op card is refused, not spent.
      "The card is still gone",
      "a strength 1 knight if that tier is full",
      "Knights use roads only",
      "cannot travel along your ships",
      "It can never chase the pirate",
      "2:1 harbors are for resources only",
    ],
  },

  scenarios: {
    present: [
      // Fishermen. The 7-fish rung is replaced under Knights
      // (`fishermen.go:1034`, :1166-1182).
      "The 7-fish rung is replaced, not removed",
      // `fishermen.go:727-729` tests Supply + Used.
      "the supply and the spent pile together",
      // scenarios.md:66-68 adds "traded" to the list.
      "can't be stolen, discarded or traded",
      // Caravans. `caravans.go:1333`: b.seats >= 2 && b.votes*2 > total.
      "a majority of every vote cast",
      // scenarios.md:137.
      "win or lose",
      // scenarios.md:117; `sim.TestCaravansHasThreeSpokes` fatals on a missing spoke.
      "three spokes are guaranteed",
      // `tab.fillOases`: a drowned desert's oasis is promoted out of a
      // producing hex, never a red one (`ruletest.TestEveryCaravansTableGetsItsOases`).
      "becomes the missing oasis instead",
      // Rivers. Source to sea with one outlet (`rivers/board.go:692-730`).
      "from a mountain headwater down to the sea",
      // Derivation 11 repaints only the headwater (`rivers/board.go` paint).
      "repaints only its source",
      "keeps the terrain it was dealt",
      // The Diplomat's river-road coin is the card player's
      // (`TestDiplomatRemovalIsPaidByTheCardPlayer`).
      "whoever's road it was",
      // The rule prices the currency at the seat's own harbour rate.
      "2 at that resource's own 2:1 harbour",
      // Harbormaster. harbormaster.md:73-74 rule 3.
      "a tie the holder is not part of leaves it held by nobody",
      "A building counts once",
      "no victory points is worth no harbour points",
      "a table that names its own target",
      // harbormaster.md:188-191: Raiders is the second such module.
      "One of the two pairings where harbour points can fall",
      // Explorers. explorers.md:826-838 banks the win.
      "you only ever win on your own turn",
      // `explorers/apply.go:235-243` returns both figures to supply.
      "both pieces go back to your supply",
      // Roads and settlements are built normally on explored land (explorers.md:421-440).
      "no settler or crew reaches land except aboard a ship",
      // `chaseHits` (`explorers/rules.go`): a village adds its own face, north 5,
      // south 4, and not everything above it.
      "the southern alone on a 4 or a 6",
      // cak+explorers: city first, harbour second.
      "Setup places a city first",
      // cak+explorers rule I: the Aqueduct keeps the Knights exception for a
      // rolled 7.
      "The Aqueduct works as in Knights, never on a 7",
    ],
    absent: [
      "On a 7, a player with the Aqueduct",
      "on a 4 or higher",
      "Your second starting building is a city",
      "plays with one oasis fewer",
      "The 7-fish card is gone for the whole game",
      "no one draws; spent tiles reshuffle",
      "never starts at all",
      "from one coast to another",
      "become mountain, clay or pasture",
      "2:1 harbor does not help here",
      "a tie leaves it exactly where it is",
      "The only pairing where harbour points can fall",
      "Both the settler and the ship are spent",
      "no piece is ever placed on land except by ship",
    ],
  },

  raiders: {
    present: [
      // raiders.md:537-546. The fleet is dropped, with these consequences.
      "The barbarian fleet is gone",
      "Defender of the Realm can never be scored",
      "never enters play at all",
      // raiders.md:566-573: two extra landing triggers under Knights.
      "Landings get two extra triggers",
      "city improvement",
      // raiders.md:522-531.
      "Ships may be built on the edges of a conquered hex, and roads may not",
      "outer island still triggers a full landing",
      // raiders.md:28-32, :45-66: centre hex, no chip, produces nothing.
      "The castle sits at the centre of the board",
      // raiders.md:309-310: the roll-off and the 3 gold.
      "the tied players roll for it",
      // raiders.md:386-394.
      "draws no fish under Fishermen",
      "contributes no harbour points under Harbormaster",
    ],
    absent: ["The target is 12 points, or 13 alongside Knights"],
  },

  online: {
    present: [
      // Explorers deals two thirds of its map face down (`MaskBoard`).
      "in every ruleset except Explorers",
    ],
    absent: ["There is no fog of war anywhere in the game"],
  },
};

describe("the rules page states the rules the engine implements", () => {
  for (const [tab, rules] of Object.entries(CHAPTERS)) {
    it(`${tab}: states every rule`, () => {
      const text = tabText(tab);
      for (const want of rules.present) {
        expect(text, `${tab} must say: ${want}`).toContain(want);
      }
    });

    const absent = rules.absent;
    if (absent) {
      it(`${tab}: omits the wrong wording`, () => {
        const text = tabText(tab);
        for (const gone of absent) {
          expect(text, `${tab} must not say: ${gone}`).not.toContain(gone);
        }
      });
    }
  }

  it("shows the coalition majority on both sides of the edge", () => {
    // The condition is `pool * 2 > total`, so 4/3/3 passes (12 > 10) and 5/2/2
    // fails (8 > 9 is false). The page must state the edge, not only the
    // passing case.
    const text = tabText("scenarios");
    expect(text).toContain("the two threes agreeing take it from the four");
    expect(text).toContain("At 5 / 2 / 2 the two twos are not a majority, so the five wins");
  });

  it("does not contradict itself about knights at sea", () => {
    // Neither chapter may say knights cannot use ships or chase the pirate.
    for (const tab of ["islands", "knights"]) {
      const text = tabText(tab);
      expect(text, tab).not.toContain("cannot travel along your ships");
      expect(text, tab).not.toContain("never chase the pirate");
    }
  });
});
