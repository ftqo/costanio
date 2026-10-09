import { expect, test } from "vitest";
import { i18n } from "@lingui/core";
import { buildBlockReason } from "./reachability";
import { previewView } from "./board3d/previewFixture";
import type { FullView } from "./types";

i18n.load("en", {});
i18n.activate("en");

// Explorers' two board buys must say what is missing, like the Road and
// Settlement tiles beside them.
const view = (movement: boolean) =>
  ({
    ...previewView,
    viewer: 0,
    cur: 0,
    phase: "play",
    rolled: true,
    ext: { explorers: { movement } },
  }) as unknown as FullView;

test("a harbour settlement with no settlement to upgrade names the rule", () => {
  expect(
    buildBlockReason("harbour", view(false), { ready: false, pieces: 2, short: "", legal: 0 }),
  ).toMatch(/replaces one of your own settlements on the coast/);
});

test("a cargo ship with nowhere to launch names the rule", () => {
  expect(
    buildBlockReason("cargoship", view(false), { ready: false, pieces: null, short: "", legal: 0 }),
  ).toMatch(/beside one of your harbour settlements/);
});

test("once the ships sail, every tile says building is over", () => {
  for (const what of ["road", "settlement", "harbour", "cargoship"] as const)
    expect(
      buildBlockReason(what, view(true), { ready: false, pieces: 2, short: "", legal: 3 }),
    ).toMatch(/Movement phase/);
});
