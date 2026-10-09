import { test, expect } from "vitest";
import { LINK_GRACE_MS, isAckLost, isLinkDown } from "./link";
import { SHOW_AFTER_MS } from "@/components/ConnectionIndicator";

test("an open socket is never down", () => {
  expect(isLinkDown("open", true, 0)).toBe(false);
  expect(isLinkDown("open", true, 999_999)).toBe(false);
});

test("a blip inside the grace does not lock the table", () => {
  // Most drops are a deploy restart that reconnects in a few hundred ms.
  expect(isLinkDown("closed", true, 0)).toBe(false);
  expect(isLinkDown("connecting", true, LINK_GRACE_MS - 1)).toBe(false);
});

test("a drop that outlasts the grace locks the table", () => {
  expect(isLinkDown("closed", true, LINK_GRACE_MS)).toBe(true);
  expect(isLinkDown("connecting", true, LINK_GRACE_MS + 5000)).toBe(true);
});

test("an intentional teardown is not a lost connection", () => {
  // Logout sets wantOpen false: there is no table to lock.
  expect(isLinkDown("closed", false, 999_999)).toBe(false);
});

test("the lockout waits longer than the banner that explains it", () => {
  // Read from ConnectionIndicator, so raising the banner's delay past the grace
  // fails here.
  expect(LINK_GRACE_MS).toBeGreaterThan(SHOW_AFTER_MS);
});

// ---------------------------------------------------------------------------
// The half-open socket: OPEN, and nothing coming back
// ---------------------------------------------------------------------------

const TTL = 3000;

test("a command that expired in total silence means the link is dead", () => {
  // `readyState` stays OPEN through a pulled cable and the browser answers
  // pings itself, so this is the only evidence.
  expect(isAckLost(1, TTL, TTL)).toBe(true);
  expect(isAckLost(2, TTL + 9000, TTL)).toBe(true);
});

test("an expired command with frames arriving is not a dead link", () => {
  // A lost command on a live connection; the resync repairs it.
  expect(isAckLost(1, 0, TTL)).toBe(false);
  expect(isAckLost(1, TTL - 1, TTL)).toBe(false);
});

test("silence with nothing outstanding is just a quiet game", () => {
  // Nothing was asked, so nothing is owed; a quiet table is normal.
  expect(isAckLost(0, 60_000, TTL)).toBe(false);
});
