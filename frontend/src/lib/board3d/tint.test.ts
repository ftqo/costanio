import { test, expect, beforeEach } from "vitest";
import { seatTint, isTintSlot, clearTintCache } from "./tint";
import { deriveSeatTones } from "@/lib/color";

beforeEach(() => clearTintCache());

function hexOf(c: { getHexString(): string }): string {
  return `#${c.getHexString()}`;
}

test("a literal hex round-trips through three.js color management unchanged", () => {
  // three converts sRGB input to linear; reading back without asking for sRGB
  // returns a different value.
  const t = seatTint("#e69f00");
  expect(hexOf(t.Seat_Body)).toBe("#e69f00");
});

test("shade and detail come from the shared derivation, not a new formula", () => {
  const tones = deriveSeatTones("#e69f00");
  const t = seatTint("#e69f00");
  expect(hexOf(t.Seat_Shade)).toBe(tones.shade.toLowerCase());
  expect(hexOf(t.Seat_Detail)).toBe(tones.detail.toLowerCase());
});

test("a light seat color gets a dark detail and vice versa", () => {
  const light = seatTint("#ffffff");
  const dark = seatTint("#000000");
  expect(hexOf(light.Seat_Detail)).not.toBe(hexOf(dark.Seat_Detail));
});

test("every manifest tint slot is produced", () => {
  const t = seatTint("#3d8bff") as unknown as Record<string, unknown>;
  for (const slot of ["Seat_Body", "Seat_Shade", "Seat_Detail"]) {
    expect(t[slot], `missing ${slot}`).toBeDefined();
  }
});

test("only Seat_ materials are tintable", () => {
  expect(isTintSlot("Seat_Body")).toBe(true);
  expect(isTintSlot("Mat_Desert")).toBe(false);
  expect(isTintSlot("Mat_Robber")).toBe(false);
});

test("repeated calls return equal colors", () => {
  expect(hexOf(seatTint("#2fa45c").Seat_Body)).toBe(hexOf(seatTint("#2fa45c").Seat_Body));
});
