import { describe, it, expect } from "vitest";
import { sentences } from "./sentences";

describe("sentences", () => {
  it("does not double a stop a part already ends with", () => {
    // The Knights improvement tile.
    expect(sentences(["Science: level 0 of 5. Upgrade.", "Needs 1 paper, you hold 0."])).toBe(
      "Science: level 0 of 5. Upgrade. Needs 1 paper, you hold 0.",
    );
  });

  it("joins bare phrases with a stop, none at the end", () => {
    expect(sentences(["Road", "You need 1 brick."])).toBe("Road. You need 1 brick.");
    expect(sentences(["Fish", "Spend fish: 2 to 7"])).toBe("Fish. Spend fish: 2 to 7");
  });

  it("skips the parts a tile does not have", () => {
    expect(sentences(["City", null, undefined, false, ""])).toBe("City");
    expect(sentences([])).toBe("");
  });

  it("leaves a question or exclamation alone", () => {
    expect(sentences(["Ready?"])).toBe("Ready?");
  });
});
