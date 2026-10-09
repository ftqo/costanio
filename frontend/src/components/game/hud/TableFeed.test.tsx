import { test, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as React from "react";
import { TableFeed } from "./TableFeed";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

/**
 * A stand-in for lib/stickyScroll's handle. Identity-stable, as the real one
 * is: TableFeed has these in an effect's deps, and a fresh object per render
 * would re-run it on every websocket frame.
 */
function stickyStub() {
  return {
    ref: React.createRef<HTMLDivElement>(),
    onScroll: () => {},
    setVisible: vi.fn(),
  };
}

function feed(props: Partial<React.ComponentProps<typeof TableFeed>> = {}) {
  const scroll = stickyStub;
  return (
    <TableFeed
      pane="log"
      log={<div>LOG ROWS</div>}
      chat={<div>CHAT ROWS</div>}
      chatBar={<div>COMPOSER</div>}
      logScroll={scroll()}
      chatScroll={scroll()}
      {...props}
    />
  );
}

// The controls outside the feed are the only switches; the surface just draws
// the pane it is handed.
test("the feed has no switch of its own", () => {
  const { el } = render(feed());
  expect(el.querySelector("[aria-expanded]")).toBeNull();
  expect(el.querySelector("button")).toBeNull();
  expect(el.textContent).toContain("Event log");
});

// Both panes stay in the DOM across a switch (a class change, not a rebuild of
// a thousand-row log); the prop only decides which is shown.
test("switching panes hides one rather than unmounting it", () => {
  const { el, root } = render(feed());
  expect(el.textContent).toContain("LOG ROWS");
  expect(el.textContent).toContain("CHAT ROWS");

  const shown = (text: string) =>
    [...el.querySelectorAll("div")].some(
      (d) => d.textContent === text && !d.closest(".hidden") && !d.className.includes("hidden"),
    );
  expect(shown("LOG ROWS")).toBe(true);
  expect(shown("CHAT ROWS")).toBe(false);

  act(() => root.render(feed({ pane: "chat" })));
  expect(shown("CHAT ROWS")).toBe(true);
  expect(shown("LOG ROWS")).toBe(false);
});

// The composer belongs to the chat pane only.
test("the composer belongs to the chat pane", () => {
  const { el, root } = render(feed());
  expect(el.textContent).not.toContain("COMPOSER");
  expect(el.textContent).toContain("Event log");

  act(() => root.render(feed({ pane: "chat" })));
  expect(el.textContent).toContain("COMPOSER");
  expect(el.textContent).toContain("Table chat");
});

// Unread clears while the chat pane is on screen, which needs it mounted: a
// feed switched off reads nothing, so the dot accumulates on the chat control.
test("marks chat read only while it is shown", () => {
  const onChatRead = vi.fn();
  const { el, root } = render(feed({ onChatRead }));
  expect(el.textContent).toContain("LOG ROWS");
  expect(onChatRead).not.toHaveBeenCalled();

  act(() => root.render(feed({ pane: "chat", onChatRead })));
  expect(onChatRead).toHaveBeenCalled();

  onChatRead.mockClear();
  act(() => root.render(feed({ pane: "log", onChatRead })));
  expect(onChatRead).not.toHaveBeenCalled();
});

// Only this component knows which pane is on screen, and the scroll boxes need
// it to open on their newest row. A hidden pane measures 0 for every scroll
// metric, and writes to it land nowhere.
test("each pane is told whether it is the one on screen", () => {
  const logScroll = stickyStub();
  const chatScroll = stickyStub();
  const { root } = render(feed({ logScroll, chatScroll }));
  expect(logScroll.setVisible).toHaveBeenLastCalledWith(true);
  expect(chatScroll.setVisible).toHaveBeenLastCalledWith(false);

  act(() => root.render(feed({ pane: "chat", logScroll, chatScroll })));
  expect(logScroll.setVisible).toHaveBeenLastCalledWith(false);
  expect(chatScroll.setVisible).toHaveBeenLastCalledWith(true);

  // When the surface is put away, the pane must not be written to, and must
  // open at the bottom next time.
  act(() => root.unmount());
  expect(logScroll.setVisible).toHaveBeenLastCalledWith(false);
  expect(chatScroll.setVisible).toHaveBeenLastCalledWith(false);
});

// The game view re-renders on every websocket frame; if this effect's inputs
// changed with it, the feed would re-pin every frame and yank a player reading
// back.
test("does not repeat the visibility report on re-render", () => {
  const logScroll = stickyStub();
  const chatScroll = stickyStub();
  const { root } = render(feed({ logScroll, chatScroll }));
  const before = logScroll.setVisible.mock.calls.length;
  act(() => root.render(feed({ logScroll, chatScroll, log: <div>LOG ROWS, ONE MORE</div> })));
  expect(logScroll.setVisible.mock.calls.length).toBe(before);
});

// The log is a live region, so screen readers hear each event's sentence.
//
// The region must be the scroll box, not the wrapper: a live region announces
// mutations inside it, and the rows are appended below the wrapper.
const box = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="log"]');

test("rows render inside a live region", () => {
  const { el } = render(feed());
  const log = box(el)!;
  expect(log).not.toBeNull();
  expect(log.getAttribute("aria-live")).toBe("polite");
  // Only additions (lib/fadingLog trims old rows, which isn't news). Not atomic,
  // so a new row doesn't re-read the forty above it.
  expect(log.getAttribute("aria-relevant")).toBe("additions");
  expect(log.getAttribute("aria-atomic")).toBe("false");
  expect(log.textContent).toContain("LOG ROWS");
  // It must be the box that owns the overflow, not ScrollFade's wrapper, which
  // would also announce the fade gradients and nudge arrows.
  expect(log.className).toContain("overflow-y-auto");
});

test("the pane's label is a heading, and it names the region", () => {
  // A labelled region, not an unnamed styled <div>.
  const { el, root } = render(feed());
  const h = el.querySelector("h2")!;
  expect(h.textContent).toBe("Event log");
  expect(box(el)!.getAttribute("aria-labelledby")).toBe(h.id);
  expect(h.id).toBeTruthy();

  act(() => root.render(feed({ pane: "chat" })));
  expect(el.querySelector("h2")!.textContent).toBe("Table chat");
});

// Both panes are mounted in the island and both carry the region; only the
// displayed one narrates, since a `display: none` subtree isn't exposed.
test("the pane that is put away is inside a hidden box", () => {
  const { el } = render(feed());
  const logs = [...el.querySelectorAll<HTMLElement>('[role="log"]')];
  expect(logs).toHaveLength(2);
  const hidden = logs.filter((l) => l.closest(".hidden") !== null);
  expect(hidden).toHaveLength(1);
  expect(hidden[0].textContent).toContain("CHAT ROWS");
});
