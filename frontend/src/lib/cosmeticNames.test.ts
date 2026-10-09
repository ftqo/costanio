// The shop's item names are client copy keyed by the catalog's ids, and the
// catalog is in Go. Every static row must have a name here in the same
// English, and nothing here may name an item the catalog dropped.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COSMETIC_NAMES, cosmeticName } from "./cosmeticNames";

const CATALOG = join(__dirname, "..", "..", "..", "cosmetics", "catalog.go");

function staticRows(): Map<string, string> {
  const src = readFileSync(CATALOG, "utf8");
  const rows = new Map<string, string>();
  for (const m of src.matchAll(/\{ID: "([^"]+)", Slot: \w+, Name: "([^"]+)"/g))
    rows.set(m[1], m[2]);
  return rows;
}

describe("cosmetic names", () => {
  test("the catalog parses (a blind guard passes everything)", () => {
    expect(staticRows().size).toBeGreaterThan(30);
  });

  test("every catalog row has client copy, in the same English", () => {
    const drift: string[] = [];
    for (const [id, name] of staticRows()) {
      const d = COSMETIC_NAMES[id];
      if (!d) drift.push(`${id}: no entry in COSMETIC_NAMES`);
      else if (d.message !== name)
        drift.push(`${id}: catalog says "${name}", client says "${d.message}"`);
    }
    expect(drift).toEqual([]);
  });

  test("no entry names an item the catalog no longer has", () => {
    const rows = staticRows();
    expect(Object.keys(COSMETIC_NAMES).filter((id) => !rows.has(id))).toEqual([]);
  });

  test("an id this bundle does not know falls back to the server's name", () => {
    expect(cosmeticName({ id: "robber.future", name: "Future Robber" })).toBe("Future Robber");
    expect(cosmeticName({ id: "robber.crow", name: "ignored" })).toBe("Crow");
  });
});
