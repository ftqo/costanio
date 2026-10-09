import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_PLACEMENT_MARKS,
  PLACEMENT_MARKS_LABEL,
  placementMarks,
  setPlacementMarks,
  subscribePlacementMarks,
} from "./placementMarks";

afterEach(() => {
  localStorage.clear();
});

test("an untouched setting is on", () => {
  // Unlike post-processing, on by default: the marks tell a player a forced
  // placement has options to choose from.
  expect(DEFAULT_PLACEMENT_MARKS).toBe(true);
  expect(placementMarks()).toBe(true);
});

test("a value storage does not recognise falls back rather than throwing", () => {
  // A stored value from some other shape of this setting must yield the
  // default, not throw during render.
  localStorage.setItem("costan.placementmarks", "swarm");
  expect(placementMarks()).toBe(true);
});

test("the choice survives a round trip", () => {
  setPlacementMarks(false);
  expect(placementMarks()).toBe(false);
  setPlacementMarks(true);
  expect(placementMarks()).toBe(true);
});

test("subscribers hear about a change, and unsubscribing detaches", () => {
  // The settings panel (site header) and the game route are connected only by
  // this subscription.
  let calls = 0;
  const stop = subscribePlacementMarks(() => calls++);
  setPlacementMarks(false);
  setPlacementMarks(true);
  expect(calls).toBe(2);
  stop();
  setPlacementMarks(false);
  expect(calls).toBe(2);
});

test("the settings copy exists and uses no em dash", () => {
  // No em dashes in anything a player reads. These are descriptors, so the
  // source string is checked.
  expect(PLACEMENT_MARKS_LABEL.name.message).toBeTruthy();
  expect(PLACEMENT_MARKS_LABEL.hint.message).toBeTruthy();
  expect(PLACEMENT_MARKS_LABEL.name.message).not.toContain("\u2014");
  expect(PLACEMENT_MARKS_LABEL.hint.message).not.toContain("\u2014");
});
