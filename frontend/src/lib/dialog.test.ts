import { describe, it, expect, beforeEach } from "vitest";
import { focusableIn, initialFocus, isFocusable, nextFocus } from "./dialog";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isFocusable", () => {
  it("rejects a disabled control", () => {
    const root = mount(`<button id="a">a</button><button id="b" disabled>b</button>`);
    expect(isFocusable(root.querySelector("#a")!)).toBe(true);
    expect(isFocusable(root.querySelector("#b")!)).toBe(false);
  });

  it("rejects hidden controls", () => {
    // Pickers here have conditionally present buttons (the Aqueduct's "Take
    // nothing") or disable rather than remove them; Tab must skip invisible ones.
    const root = mount(
      `<button id="a">a</button>
       <button id="b" hidden>b</button>
       <button id="c" style="display:none">c</button>
       <button id="d" style="visibility:hidden">d</button>
       <button id="e" aria-hidden="true">e</button>`,
    );
    expect(isFocusable(root.querySelector("#a")!)).toBe(true);
    for (const id of ["#b", "#c", "#d", "#e"]) {
      expect(isFocusable(root.querySelector(id)!), id).toBe(false);
    }
  });
});

describe("focusableIn", () => {
  it("returns the focusable descendants in document order", () => {
    const root = mount(
      `<button id="one">1</button>
       <div><a id="two" href="#x">2</a></div>
       <input id="three" />
       <span id="not">plain</span>`,
    );
    expect(focusableIn(root).map((e) => e.id)).toEqual(["one", "two", "three"]);
  });

  it("skips the disabled and the invisible", () => {
    const root = mount(
      `<button id="one">1</button><button disabled>x</button><button id="two">2</button>`,
    );
    expect(focusableIn(root).map((e) => e.id)).toEqual(["one", "two"]);
  });

  it("does not count a tabindex=-1 container as a stop", () => {
    // The panel is programmatically focusable so focus never falls to <body>,
    // but it is not a tab stop.
    const root = mount(`<div tabindex="-1"><button id="one">1</button></div>`);
    expect(focusableIn(root).map((e) => e.id)).toEqual(["one"]);
  });

  it("is empty for nothing", () => {
    expect(focusableIn(null)).toEqual([]);
    expect(focusableIn(mount("<p>text</p>"))).toEqual([]);
  });
});

describe("initialFocus", () => {
  it("focuses the first control", () => {
    const root = mount(`<button id="one">1</button><button id="two">2</button>`);
    expect(initialFocus(root)!.id).toBe("one");
  });

  it("falls back to the panel when a dialog offers no controls", () => {
    const root = mount(`<p>nothing to press</p>`);
    expect(initialFocus(root)).toBe(root);
  });
});

describe("nextFocus", () => {
  const items = () => {
    const root = mount(`<button id="a"></button><button id="b"></button><button id="c"></button>`);
    return focusableIn(root);
  };

  it("advances and wraps at the end", () => {
    const xs = items();
    expect(nextFocus(xs, xs[0], false)!.id).toBe("b");
    expect(nextFocus(xs, xs[2], false)!.id).toBe("a");
  });

  it("retreats and wraps at the start", () => {
    const xs = items();
    expect(nextFocus(xs, xs[2], true)!.id).toBe("b");
    expect(nextFocus(xs, xs[0], true)!.id).toBe("c");
  });

  it("pulls focus back in when it is currently outside the dialog", () => {
    const xs = items();
    expect(nextFocus(xs, document.body, false)!.id).toBe("a");
    expect(nextFocus(xs, null, true)!.id).toBe("c");
  });

  it("has nowhere to go in an empty dialog", () => {
    expect(nextFocus([], null, false)).toBeNull();
  });

  it("a single control is its own next and previous", () => {
    const root = mount(`<button id="only"></button>`);
    const xs = focusableIn(root);
    expect(nextFocus(xs, xs[0], false)).toBe(xs[0]);
    expect(nextFocus(xs, xs[0], true)).toBe(xs[0]);
  });
});
