import { i18n } from "@lingui/core";
import type { MessageDescriptor } from "@lingui/core";
import { describe, it, expect } from "vitest";
import { ERROR_COPY, errorText, apiErrorText } from "./errorCopy";

describe("errorCopy", () => {
  it("renders fixed copy for a plain code", () => {
    expect(errorText("NOT_YOUR_TURN")).toBe("It's not your turn.");
  });

  it("composes the shortfall from named parameters", () => {
    // The server sends {missing: {...}}, never a sentence, so assert the
    // composition.
    expect(errorText("NO_RESOURCES", { missing: { brick: 2 } })).toBe("You are short of: 2 brick");
    expect(errorText("NO_RESOURCES", { missing: { brick: 1, ore: 2 } })).toBe(
      "You are short of: 1 brick and 2 ore",
    );
    // Oxford comma from Intl.ListFormat's CLDR rule for `en`; other locales
    // (including Chinese and Japanese separators) get their own rules.
    expect(errorText("NO_RESOURCES", { missing: { wood: 1, sheep: 1, ore: 3 } })).toBe(
      "You are short of: 1 wood, 1 sheep, and 3 ore",
    );
  });

  it("falls back to generic copy when a parameter is missing", () => {
    expect(errorText("NO_RESOURCES")).toBe("You don't have the resources for that.");
    expect(errorText("NO_PIECES")).toBe("You have no pieces left to build.");
    expect(errorText("BAD_DISCARD")).toBe("That discard doesn't match what's required.");
  });

  it("names the piece that ran out", () => {
    expect(errorText("NO_PIECES", { piece: "city" })).toBe("You have no cities left.");
    expect(errorText("NO_PIECES", { piece: "road" })).toBe("You have no roads left.");
  });

  it("agrees the discard count with its noun", () => {
    expect(errorText("BAD_DISCARD", { needed: 1 })).toBe("Discard exactly 1 card.");
    expect(errorText("BAD_DISCARD", { needed: 4 })).toBe("Discard exactly 4 cards.");
  });

  it("says why Islands was refused instead of that the setup is invalid", () => {
    const out = apiErrorText({ code: "ISLANDS_NEEDS_SEA" }, "Could not save that change");
    expect(out).toBe(
      "Islands needs a map with open sea. Choose an Islands map, or turn Islands off.",
    );
    expect(out).not.toBe(errorText("BAD_CONFIG"));
  });

  it("says why Harbormaster was refused, with the minimum", () => {
    const out = apiErrorText(
      { code: "HARBORMASTER_NEEDS_HARBOURS", params: { min: 2 } },
      "Could not save that change",
    );
    expect(out).toBe(
      "Harbormaster needs a map with at least 2 harbours. Pick another map, or turn Harbormaster off.",
    );
    expect(out).not.toContain("\u2014");
  });

  it("never renders an unknown code as a raw token", () => {
    const out = errorText("SOME_CODE_THE_BACKEND_ADDED_TODAY");
    expect(out).not.toContain("SOME_CODE");
    // See FALLBACK.
    expect(out).toBe("That isn't allowed right now.");
    expect(errorText(undefined)).toBe("That isn't allowed right now.");
  });

  it("prefers the calling screen's own fallback", () => {
    expect(errorText("UNKNOWN", undefined, "Could not start")).toBe("Could not start");
    expect(apiErrorText(new Error("boom"), "Could not start")).toBe("Could not start");
    expect(apiErrorText({ code: "GAME_FULL" }, "Could not start")).toBe(
      i18n._(ERROR_COPY.GAME_FULL as MessageDescriptor),
    );
  });

  it("keeps every entry free of em dashes", () => {
    // House rule: no em dashes in anything a player reads.
    for (const [code, copy] of Object.entries(ERROR_COPY)) {
      const text = typeof copy === "function" ? copy({}) : i18n._(copy);
      expect(text, code).not.toContain("\u2014");
      expect(text.length, code).toBeGreaterThan(0);
    }
  });

  it("explains a refused expansion pairing from the module names alone", () => {
    // The backend sends the pair, never the sentence, so the reason comes from
    // the client's table and can be translated.
    expect(errorText("RULESET_CONFLICT", { modules: ["explorers", "islands"] })).toBe(
      "Explorers and Islands both use ships and a pirate, and their rules for both are different.",
    );
    // Either order: the table sorts before it looks.
    expect(errorText("RULESET_CONFLICT", { modules: ["islands", "explorers"] })).toBe(
      errorText("RULESET_CONFLICT", { modules: ["explorers", "islands"] }),
    );
    // A pair with no row (a newer server, a hand-made request) still gets a
    // sentence saying what to do.
    const generic = "Those expansions can't be combined. Turn one of them off.";
    expect(errorText("RULESET_CONFLICT", { modules: ["islands", "cak"] })).toBe(generic);
    expect(errorText("RULESET_CONFLICT")).toBe(generic);
    expect(errorText("RULESET_CONFLICT", { modules: "explorers+islands" })).toBe(generic);
  });

  it("has no entry that looks like a raw code", () => {
    // A key pasted as its own value would pass the Go coverage check but show
    // the player a token.
    for (const [code, copy] of Object.entries(ERROR_COPY)) {
      const text = typeof copy === "function" ? copy({}) : i18n._(copy);
      expect(text, code).not.toBe(code);
      expect(text, code).not.toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});
