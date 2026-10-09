import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DicePicker } from "./DicePicker";

// The Alchemist picker. The engine honours the faces it is handed
// (engine/knights/alchemist_test.go); the risk is the UI sending different ones.
//
// `Row` must stay at module scope. Declared inside `DicePicker`, it is a new
// component type each render, so React replaces the face buttons; a re-render
// between mousedown and mouseup (the game screen re-renders on every socket
// frame) then drops the click and the previous face stays selected. jsdom
// doesn't synthesise `click` from mousedown/mouseup, so this pins the
// underlying invariant: a parent re-render must not replace the face buttons.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const face = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

const pressed = () =>
  [...host.querySelectorAll("button[aria-pressed='true']")].map((b) =>
    b.getAttribute("aria-label"),
  );

const click = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("DicePicker", () => {
  it("keeps the same face buttons across an unrelated parent re-render", () => {
    // A parent that re-renders on its own, as the game screen does on every
    // socket frame.
    function Parent({ tick }: { tick: number }) {
      return (
        <div>
          <span>{tick}</span>
          <DicePicker onPick={() => {}} />
        </div>
      );
    }
    act(() => root.render(<Parent tick={0} />));
    const before = face("White die: 4");
    act(() => root.render(<Parent tick={1} />));
    act(() => root.render(<Parent tick={2} />));
    const after = face("White die: 4");

    expect(
      after,
      "the face buttons were re-created by a parent re-render, so a re-render " +
        "landing between mousedown and mouseup swallows the player's pick",
    ).toBe(before);
    expect(before.isConnected).toBe(true);
  });

  it("keeps the same face buttons when the other die is picked", () => {
    act(() => root.render(<DicePicker onPick={() => {}} />));
    const white4 = face("White die: 4");
    click(face("Red die: 3"));
    expect(face("White die: 4")).toBe(white4);
  });

  it("sends the faces as [white, red]", () => {
    // Order matters: the second face is the red production die, which gates
    // the progress-card draw (`red := d2`, engine/knights/hooks.go). 3-then-4 and
    // 4-then-3 are different plays with the same total.
    const picks: Array<[number, number]> = [];
    act(() => root.render(<DicePicker onPick={(a, b) => picks.push([a, b])} />));

    click(face("White die: 2"));
    expect(pressed()).toEqual(["White die: 2"]);
    click(face("Red die: 5"));
    expect(pressed()).toEqual(["White die: 2", "Red die: 5"]);

    const submit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Set dice")!;
    expect(submit.disabled).toBe(false);
    click(submit);
    expect(picks).toEqual([[2, 5]]);
  });

  it("re-picking a face replaces that die and leaves the other alone", () => {
    const picks: Array<[number, number]> = [];
    act(() => root.render(<DicePicker onPick={(a, b) => picks.push([a, b])} />));
    click(face("White die: 2"));
    click(face("Red die: 5"));
    click(face("White die: 6")); // changed my mind
    expect(pressed()).toEqual(["White die: 6", "Red die: 5"]);
    const submit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Set dice")!;
    click(submit);
    expect(picks).toEqual([[6, 5]]);
  });

  it("cannot submit until both dice are named", () => {
    act(() => root.render(<DicePicker onPick={() => {}} />));
    const submit = () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === "Set dice")!;
    expect(submit().disabled).toBe(true);
    click(face("White die: 1"));
    expect(submit().disabled).toBe(true);
    click(face("Red die: 1"));
    expect(submit().disabled).toBe(false);
  });
});
