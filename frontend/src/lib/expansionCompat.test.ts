import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { i18n } from "@lingui/core";
import {
  EXPANSION_MODULES,
  EXPANSION_CONFLICTS,
  EXPANSION_WARNINGS,
  conflictBetween,
  warningBetween,
  selectionConflicts,
  selectionWarnings,
  toggleCompat,
  type CompatPair,
} from "./expansionCompat";

/**
 * The Go table, as the engine test wrote it. `engine/compat.go` is the source;
 * its test writes the matrix to testdata and fails when the file is stale, and
 * this reads the same file. Either side moving alone fails here.
 */
const golden = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../..", join("engine", "testdata", "expansion_compat.json")),
    "utf8",
  ),
) as {
  modules: string[];
  conflicts: { a: string; b: string; reason: string }[];
  warnings: { a: string; b: string; reason: string }[];
  combination_examples: {
    a: CompatPair["a"];
    b: CompatPair["b"];
    also: CompatPair["also"];
    reason: string;
  }[];
};

/**
 * The English in this file's source, which is what the Go table holds.
 *
 * Compare `msg({id, message})`'s `message`, not `i18n._(descriptor)`: the
 * latter resolves against the `en` catalogue, which only updates when
 * `npm run i18n:extract` runs, so a reworded reason would still pass.
 */
const source = (p: CompatPair) => String(p.reason.message ?? "");

/** The English the catalogue actually renders, which is what a player reads. */
const rendered = (p: CompatPair) => i18n._(p.reason);

describe("the compatibility mirror", () => {
  it("names the same nine expansions the engine does", () => {
    expect([...EXPANSION_MODULES]).toEqual(golden.modules);
  });

  it("carries exactly the engine's conflicts, with the same wording", () => {
    expect(EXPANSION_CONFLICTS.map((p) => ({ a: p.a, b: p.b, reason: source(p) }))).toEqual(
      golden.conflicts,
    );
  });

  it("carries exactly the engine's warnings, with the same wording", () => {
    expect(EXPANSION_WARNINGS.map((p) => ({ a: p.a, b: p.b, reason: source(p) }))).toEqual(
      golden.warnings,
    );
  });

  it("has an `en` catalogue entry saying the same thing as the source", () => {
    // The catalogue is what a player reads and goes stale on its own (the
    // extractor is a separate command), so it must match the source too.
    for (const p of [...EXPANSION_CONFLICTS, ...EXPANSION_WARNINGS]) {
      expect(rendered(p), `${p.a}+${p.b}: run npm run i18n:extract`).toBe(source(p));
    }
  });

  it("keeps every pair sorted, distinct and known", () => {
    // The lookup sorts its arguments, so one stored row answers both orders;
    // an unsorted row would be unreachable and read as an allowed pair.
    for (const p of [...EXPANSION_CONFLICTS, ...EXPANSION_WARNINGS]) {
      expect(p.a < p.b, `${p.a}+${p.b} is not a sorted pair`).toBe(true);
      expect(EXPANSION_MODULES).toContain(p.a);
      expect(EXPANSION_MODULES).toContain(p.b);
    }
    const keys = [...EXPANSION_CONFLICTS, ...EXPANSION_WARNINGS].map((p) => `${p.a}+${p.b}`);
    expect(new Set(keys).size, "a pair is listed twice, or is both a conflict and a warning").toBe(
      keys.length,
    );
  });

  it("keeps em dashes out of every reason", () => {
    // No em dashes in anything a player reads.
    for (const p of [...EXPANSION_CONFLICTS, ...EXPANSION_WARNINGS]) {
      expect(source(p), `${p.a}+${p.b}`).not.toContain("\u2014");
      expect(rendered(p), `${p.a}+${p.b}`).not.toContain("\u2014");
      expect(source(p).length).toBeGreaterThan(0);
    }
  });
});

describe("compatibility lookups", () => {
  it("answers in either order", () => {
    for (const p of EXPANSION_CONFLICTS) {
      expect(conflictBetween(p.a, p.b)).toBe(p.reason);
      expect(conflictBetween(p.b, p.a)).toBe(p.reason);
    }
    for (const p of EXPANSION_WARNINGS) {
      expect(warningBetween(p.a, p.b)).toBe(p.reason);
      expect(warningBetween(p.b, p.a)).toBe(p.reason);
    }
  });

  it("does not confuse a conflict with a warning", () => {
    // Wagons plus Caravans is legal but degraded; as a conflict, the picker
    // would disable a pairing both specs call playable.
    expect(conflictBetween("wagons", "caravans")).toBeNull();
    expect(warningBetween("wagons", "caravans")).not.toBeNull();
    expect(warningBetween("explorers", "islands")).toBeNull();
    expect(conflictBetween("explorers", "islands")).not.toBeNull();
  });

  it("reports nothing for an unknown name or a pair with itself", () => {
    expect(conflictBetween("explorers", "explorers")).toBeNull();
    expect(conflictBetween("explorers", "nosuchmodule")).toBeNull();
  });

  // The full nine-name sweep, since the shipped picker's set is mutually
  // compatible and would exercise nothing.
  it("agrees with the golden file for all 36 pairs", () => {
    const refused = new Set(golden.conflicts.map((c) => `${c.a}+${c.b}`));
    const warned = new Set(golden.warnings.map((c) => `${c.a}+${c.b}`));
    let checked = 0;
    for (let i = 0; i < EXPANSION_MODULES.length; i++) {
      for (let j = i + 1; j < EXPANSION_MODULES.length; j++) {
        const key = `${EXPANSION_MODULES[i]}+${EXPANSION_MODULES[j]}`;
        expect(!!conflictBetween(EXPANSION_MODULES[i], EXPANSION_MODULES[j]), key).toBe(
          refused.has(key),
        );
        expect(!!warningBetween(EXPANSION_MODULES[i], EXPANSION_MODULES[j]), key).toBe(
          warned.has(key),
        );
        checked++;
      }
    }
    expect(checked).toBe(36);
  });
});

describe("a selection of expansions", () => {
  it("finds every refused pair in it, sorted", () => {
    const found = selectionConflicts(["islands", "cak", "explorers", "wagons"]).map(
      (p) => `${p.a}+${p.b}`,
    );
    // cak+explorers is absent: Explorers takes Knights under its own
    // combination rules, so only the other partners are refused.
    expect(found).toEqual(["explorers+islands", "explorers+wagons", "islands+wagons"]);
  });

  // The lobby greys a switch exactly when selectionConflicts names it, so this
  // decides whether the pairing can be started. Checked on the real table (the
  // shelf's own tests inject one).
  it("leaves Knights selectable beside Explorers, and refuses the rest", () => {
    expect(selectionConflicts(["cak", "explorers"])).toEqual([]);
    for (const other of [
      "islands",
      "fishermen",
      "caravans",
      "harbormaster",
      "rivers",
      "raiders",
      "wagons",
    ]) {
      expect(selectionConflicts([other, "explorers"]), other).toHaveLength(1);
    }
  });

  it("finds nothing in the set the lobby actually offers", () => {
    const shipped = ["cak", "islands", "fishermen", "caravans"];
    expect(selectionConflicts(shipped)).toEqual([]);
    expect(selectionWarnings(shipped)).toEqual([]);
  });

  it("reports the degraded pair without refusing it", () => {
    const notes = selectionWarnings(["caravans", "wagons"]);
    expect(notes.map((n) => `${n.a}+${n.b}`)).toEqual(["caravans+wagons"]);
    expect(selectionConflicts(["caravans", "wagons"])).toEqual([]);
  });

  it("ignores duplicates", () => {
    expect(selectionConflicts(["explorers", "explorers", "islands"])).toHaveLength(1);
  });
});

describe("one toggle's state", () => {
  const selected = ["islands"];

  it("blocks a conflicting off switch and names the partner", () => {
    const { blockedBy } = toggleCompat(selected, "explorers", false);
    expect(blockedBy?.a).toBe("explorers");
    expect(blockedBy?.b).toBe("islands");
    expect(i18n._(blockedBy!.reason)).toContain("Explorers");
  });

  it("never blocks a switch that is already on", () => {
    // A host who somehow has both on (an old lobby, a shared config) must be
    // able to turn one off.
    expect(toggleCompat(["islands", "explorers"], "explorers", true).blockedBy).toBeNull();
    expect(toggleCompat(["islands", "explorers"], "islands", true).blockedBy).toBeNull();
  });

  it("leaves a warning pair alone", () => {
    expect(toggleCompat(["caravans"], "wagons", false).blockedBy).toBeNull();
  });

  it("leaves every shipped toggle alone", () => {
    for (const m of ["cak", "islands", "fishermen", "caravans"]) {
      const others = ["cak", "islands", "fishermen", "caravans"].filter((x) => x !== m);
      expect(toggleCompat(others, m, false).blockedBy, m).toBeNull();
    }
  });
});

describe("combinations wider than pairs", () => {
  const entries: CompatPair[] = golden.combination_examples.map((entry) => ({
    ...entry,
    reason: { id: entry.reason, message: entry.reason },
  }));
  it("matches full combinations and supersets, not subsets", () => {
    for (const entry of entries) {
      const names = [entry.a, entry.b, ...(entry.also ?? [])];
      for (const omitted of names) {
        expect(
          selectionConflicts(
            names.filter((n) => n !== omitted),
            [entry],
          ),
        ).toEqual([]);
      }
      expect(selectionConflicts([...names].reverse(), [entry])).toEqual([entry]);
      expect(selectionWarnings([...names, ...names, "harbormaster"], [entry])).toEqual([entry]);
      for (const name of names) {
        const rest = names.filter((n) => n !== name);
        expect(toggleCompat(rest, name, false, [entry]).blockedBy).toEqual(entry);
        expect(toggleCompat(names, name, true, [entry]).blockedBy).toBeNull();
      }
    }
  });
  it("keeps distinct combinations sharing their first two names", () => {
    const extra: CompatPair = { ...entries[0], also: ["rivers"] };
    expect(selectionWarnings(["cak", "islands", "raiders", "rivers"], [extra, entries[0]])).toEqual(
      [entries[0], extra],
    );
  });
});
