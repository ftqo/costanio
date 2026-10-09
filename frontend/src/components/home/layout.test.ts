import { describe, it, expect } from "vitest";
import { HOME_GAP_FRAC, HOME_STACKED_BAND_MIN, homeChrome } from "./layout";

describe("homeChrome", () => {
  it("frames a stacked island wholly below the copy the page measured", () => {
    // 390x844 in English: the copy ends at 436px (0.517) and the footer starts
    // 94px from the bottom (0.111), so the island is framed between them.
    const c = homeChrome("stacked", 0.517, 0.111);
    expect(c.top).toBeCloseTo(0.517 + HOME_GAP_FRAC, 5);
    expect(c.bottom).toBeCloseTo(0.111 + HOME_GAP_FRAC, 5);
  });

  it("keeps a minimum band when the copy leaves little room", () => {
    const c = homeChrome("stacked", 0.8, 0.12);
    expect(1 - c.top! - c.bottom!).toBeCloseTo(HOME_STACKED_BAND_MIN, 5);
  });

  it("clears the header in the columns arrangement", () => {
    // 844x390: a 50px header is 0.128 of the height, more than the 0.08 floor.
    expect(homeChrome("short", 0.5, 0.2, 0.128).top).toBeCloseTo(0.128 + HOME_GAP_FRAC, 5);
    // A header shorter than the floor keeps the floor.
    expect(homeChrome("wide", 0.3, 0.1, 0.04).top).toBe(0.08);
  });
});
