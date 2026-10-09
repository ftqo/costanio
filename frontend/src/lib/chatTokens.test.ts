import { describe, expect, it } from "vitest";
import { parseChatLine, hasCards } from "./chatTokens";
import type { LogLine } from "./eventlog";

/** Compact rendering of a parse, so the tables below read like the chat line. */
function render(line: LogLine): string {
  return line
    .map((tok) => {
      switch (tok.k) {
        case "t":
          return tok.s;
        case "res":
          return `[${tok.n}×r${tok.idx}]`;
        case "com":
          return `[${tok.n}×c${tok.idx}]`;
        default:
          return `[${tok.k}]`;
      }
    })
    .join("");
}

const r = { wood: 1, brick: 2, sheep: 3, wheat: 4, ore: 5 };

describe("parseChatLine", () => {
  it("draws the canonical trade", () => {
    expect(render(parseChatLine("2 sheep for 3 wood"))).toBe("[2×r3] for [3×r1]");
  });

  it("keeps a message with no resources as one text token", () => {
    const line = parseChatLine("hey everyone, good luck");
    expect(line).toEqual([{ k: "t", s: "hey everyone, good luck" }]);
    expect(hasCards(line)).toBe(false);
  });

  describe("vocabulary", () => {
    const cases: [string, number][] = [
      // The common player vocabulary.
      ["wood", r.wood],
      ["lumber", r.wood],
      ["tree", r.wood],
      ["timber", r.wood],
      ["brick", r.brick],
      ["wool", r.sheep],
      ["sheep", r.sheep],
      ["grain", r.wheat],
      ["wheat", r.wheat],
      ["ore", r.ore],
      ["stone", r.ore],
      ["rock", r.ore],
      // Plus clay for brick.
      ["clay", r.brick],
      ["mud", r.brick],
      ["logs", r.wood],
      ["corn", r.wheat],
      ["iron", r.ore],
      ["metal", r.ore],
      ["lamb", r.sheep],
    ];
    it.each(cases)("%s is resource %i", (word, idx) => {
      expect(render(parseChatLine(word))).toBe(`[1×r${idx}]`);
    });

    it("matches regardless of case", () => {
      expect(render(parseChatLine("SHEEP Wheat"))).toBe("[1×r3] [1×r4]");
    });

    it("takes plurals", () => {
      expect(render(parseChatLine("3 bricks"))).toBe("[3×r2]");
    });
  });

  describe("quantities", () => {
    it.each([
      ["2 ore", "[2×r5]"],
      ["a wood", "[1×r1]"],
      ["an ore", "[1×r5]"],
      ["two sheep", "[2×r3]"],
      ["ten wheat", "[10×r4]"],
      ["wood", "[1×r1]"],
    ])("%s → %s", (msg, want) => {
      expect(render(parseChatLine(msg))).toBe(want);
    });

    it("reads a big count rather than capping it", () => {
      // Rendering decides when a run collapses to a number; parsing does not.
      expect(render(parseChatLine("9 wheat"))).toBe("[9×r4]");
    });

    it("leaves a number that is not a quantity alone", () => {
      // Three digits is a year or an id, not a hand.
      expect(render(parseChatLine("2026 ore"))).toBe("2026 [1×r5]");
    });

    it("does not read across punctuation", () => {
      expect(render(parseChatLine("3, wood"))).toBe("3, [1×r1]");
    });

    it("does not read across a wide gap", () => {
      expect(render(parseChatLine("3  wood"))).toBe("3  [1×r1]");
    });
  });

  describe("short forms", () => {
    it.each([
      ["2s for 3w", "[2×r3] for 3w"], // w is ambiguous and stays text
      ["1b", "[1×r2]"],
      ["2o", "[2×r5]"],
      ["3wh", "[3×r4]"],
      ["2wd", "[2×r1]"],
      ["4sh", "[4×r3]"],
      ["2br", "[2×r2]"],
      ["1cl", "[1×r2]"],
      ["2gr", "[2×r4]"],
      ["3or", "[3×r5]"],
      ["2l", "[2×r1]"],
    ])("%s → %s", (msg, want) => {
      expect(render(parseChatLine(msg))).toBe(want);
    });

    it("needs the number glued on", () => {
      // A bare letter is a letter: `s` is not sheep and `or` is a conjunction.
      expect(render(parseChatLine("2 s"))).toBe("2 s");
      expect(render(parseChatLine("wood or ore"))).toBe("[1×r1] or [1×r5]");
      expect(render(parseChatLine("b"))).toBe("b");
    });

    it("chains without spaces", () => {
      expect(render(parseChatLine("2s3o"))).toBe("[2×r3][3×r5]");
    });
  });

  describe("word boundaries", () => {
    // Each is a false positive for a substring matcher.
    it.each([
      "I need more than that",
      "before you ask",
      "what is the score",
      "down the street",
      "coincidentally",
      "explorers",
      "anymore",
      "the store",
      "foreign",
    ])("%s draws nothing", (msg) => {
      expect(hasCards(parseChatLine(msg))).toBe(false);
      expect(render(parseChatLine(msg))).toBe(msg);
    });

    it("converts ore at the start of a message", () => {
      // Keying ore as " ore" to dodge *more* would break this message.
      expect(render(parseChatLine("ore anyone?"))).toBe("[1×r5] anyone?");
    });

    it("survives rock paper scissors", () => {
      // Three false icons at once on a substring matcher.
      expect(render(parseChatLine("rock paper scissors"))).toBe("[1×r5] paper scissors");
    });
  });

  describe("commodities", () => {
    it("is off by default", () => {
      expect(render(parseChatLine("2 paper"))).toBe("2 paper");
    });
    it.each([
      ["2 paper", "[2×c1]"],
      ["cloth", "[1×c0]"],
      ["3 coins", "[3×c2]"],
    ])("%s → %s with commodities on", (msg, want) => {
      expect(render(parseChatLine(msg, { commodities: true }))).toBe(want);
    });
  });

  describe("escaping", () => {
    it("leaves an escaped word as text without the backslash", () => {
      expect(render(parseChatLine("the \\wood is real"))).toBe("the wood is real");
    });
    it("skips resources inside a URL", () => {
      const msg = "see https://example.com/wood-and-ore for it";
      expect(render(parseChatLine(msg))).toBe(msg);
    });
  });

  describe("phrasings players actually type", () => {
    it.each([
      ["anyone got wood?", "anyone got [1×r1]?"],
      ["need 1 brick", "need [1×r2]"],
      ["2 wood 4 ore", "[2×r1] [4×r5]"],
      ["1 for 1 wheat?", "1 for [1×r4]?"],
      ["have wood need ore", "have [1×r1] need [1×r5]"],
      ["who has ore", "who has [1×r5]"],
      ["trade 2 brick", "trade [2×r2]"],
    ])("%s → %s", (msg, want) => {
      expect(render(parseChatLine(msg))).toBe(want);
    });

    it("leaves port ratios alone", () => {
      expect(render(parseChatLine("i have 2:1 ore"))).toBe("i have 2:1 [1×r5]");
      expect(render(parseChatLine("3:1 anyone"))).toBe("3:1 anyone");
    });
  });

  it("preserves the original text exactly where it draws nothing", () => {
    const msg = "  spaced   out,  really!!  ";
    expect(render(parseChatLine(msg))).toBe(msg);
  });
});
