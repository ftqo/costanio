import { afterEach, expect, test } from "vitest";
import {
  BOARD_POSTFX_LABEL,
  DEFAULT_BOARD_POSTFX,
  boardPostFx,
  currentBoardLook,
  onBoardPostFxChange,
  setBoardPostFx,
  subscribeBoardPostFx,
} from "./boardPostFx";

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("an untouched setting is off", () => {
  // Post-processing roughly quintuples the cost of the water-only frame the
  // ocean clock runs ~30 times a second, so it must be opted into.
  expect(DEFAULT_BOARD_POSTFX).toBe(false);
  expect(boardPostFx()).toBe(false);
});

test("a value storage does not recognise falls back rather than throwing", () => {
  // An earlier version of this key held style names; those must fall back
  // rather than throw inside GL setup.
  localStorage.setItem("costan.boardpostfx", "vibrant");
  expect(boardPostFx()).toBe(false);
});

test("the choice survives a round trip", () => {
  setBoardPostFx(true);
  expect(boardPostFx()).toBe(true);
  setBoardPostFx(false);
  expect(boardPostFx()).toBe(false);
});

test("subscribers hear about a change", () => {
  // The board subscribes to this module directly rather than through React,
  // so a missed notification would leave the switch and canvas disagreeing.
  const seen: boolean[] = [];
  const stop = onBoardPostFxChange((on) => seen.push(on));
  setBoardPostFx(true);
  setBoardPostFx(false);
  stop();
  setBoardPostFx(true);
  expect(seen).toEqual([true, false]);
});

test("unsubscribing actually detaches", () => {
  let calls = 0;
  const stop = subscribeBoardPostFx(() => calls++);
  setBoardPostFx(true);
  expect(calls).toBe(1);
  stop();
  setBoardPostFx(false);
  expect(calls).toBe(1);
});

test("the live look combines both axes", () => {
  // The switch is the viewer's and the mode is the site's; dropping one gives
  // a half-themed board (e.g. a night board coloured for noon).
  setBoardPostFx(true);
  expect(currentBoardLook().id).toBe("post:light");
  document.documentElement.classList.add("dark");
  expect(currentBoardLook().id).toBe("post:dark");
  setBoardPostFx(false);
  expect(currentBoardLook().id).toBe("plain:dark");
});

test("the settings copy exists and uses no em dash", () => {
  // The repo rule for player-facing text, checked on the descriptors' source
  // strings.
  expect(BOARD_POSTFX_LABEL.name.message).toBeTruthy();
  expect(BOARD_POSTFX_LABEL.hint.message).toBeTruthy();
  expect(BOARD_POSTFX_LABEL.name.message).not.toContain("\u2014");
  expect(BOARD_POSTFX_LABEL.hint.message).not.toContain("\u2014");
});
