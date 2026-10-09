import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { TableClosedScreen, tableClosed } from "./TableClosedScreen";

const h = vi.hoisted(() => ({ activity: false }));
vi.mock("@/lib/activity", () => ({ inActivityMode: () => h.activity }));
vi.mock("@tanstack/react-router", () => ({
  Link: (p: { children?: React.ReactNode; to: string; search?: Record<string, string> }) =>
    React.createElement(
      "a",
      { href: p.to + (p.search ? "?" + new URLSearchParams(p.search).toString() : "") },
      p.children,
    ),
}));

// An old /game link to an abandoned table must stop waiting: the socket answers
// with `{"closed":true}` and no view, and the REST read says abandoned. Either
// signal alone is enough, since either can land first.
describe("tableClosed", () => {
  it("is true on the socket's closed frame alone", () => {
    expect(tableClosed(true, undefined)).toBe(true);
    expect(tableClosed(true, "active")).toBe(true);
  });
  it("is true on the REST status alone", () => {
    expect(tableClosed(false, "abandoned")).toBe(true);
  });
  it("is false for a table that is merely still loading", () => {
    expect(tableClosed(false, undefined)).toBe(false);
    expect(tableClosed(false, "active")).toBe(false);
    expect(tableClosed(false, "finished")).toBe(false);
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  act(() =>
    r.render(
      <I18nProvider i18n={i18n}>
        <TableClosedScreen g="abc123" inv="code" />
      </I18nProvider>,
    ),
  );
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  h.activity = false;
});

describe("TableClosedScreen", () => {
  it("says the table closed and offers the lobby and the replay", () => {
    render();
    expect(host!.textContent).toContain("This table has closed");
    const hrefs = [...host!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/play");
    expect(hrefs).toContain("/replay?g=abc123&inv=code");
    // Not a spinner: the card carries actions, so it is not busy.
    expect(host!.querySelector('[aria-busy="false"]')).not.toBeNull();
  });
  it("drops Back to Play inside the Activity", () => {
    h.activity = true;
    render();
    const hrefs = [...host!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/play");
  });
});
