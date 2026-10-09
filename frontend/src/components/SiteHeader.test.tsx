import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Me } from "@/lib/types";

// Hoisted so a test can flip the Activity on for one render. Mocking
// `inActivityMode` avoids importing the Discord SDK.
const h = vi.hoisted(() => ({ activity: false, logout: vi.fn(), navigate: vi.fn() }));

vi.mock("@/lib/activity", () => ({ inActivityMode: () => h.activity }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ logout: h.logout, me: null, loading: false }) }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => h.navigate,
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
}));
// The menu's only query is the cosmetics loadout, which decorates the name; an
// empty result renders the undecorated default.
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
// Both dialogs are closed for every assertion here, so the panels never mount;
// stubbing them keeps the audio/settings machinery out of the test.
vi.mock("@/components/SettingsPanel", () => ({
  SettingsPanel: () => null,
  useAppSettings: () => ({}),
}));
vi.mock("@/lib/api", () => ({ api: { loadout: vi.fn() } }));
// Closed for every assertion here, and it mounts the whole store when open.
vi.mock("@/components/StoreShelves", () => ({ StoreDialog: () => null }));

// vitest hoists the vi.mock calls above this, so the real module never loads
// its provider-bound dependencies.
import { HamburgerMenu, ProfileMenu, type SessionAction } from "./SiteHeader";

const ME = { id: 7, name: "Tester", guest: false } as Me;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.activity = false;
  // jsdom ships no matchMedia, and the decorated name asks it about
  // prefers-reduced-motion on mount. Nothing here depends on the answer.
  window.matchMedia = ((q: string) => ({
    media: q,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  // Put jsdom back the way it ships: other suites read the absence of
  // matchMedia as "system resolves light".
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.clearAllMocks();
});

// The dropdown only exists in the DOM while open, and the trigger is the one
// button rendered before it.
function open() {
  act(() => host.querySelector("button")!.click());
  return host.querySelector<HTMLElement>('[role="menu"]')!;
}

function item(menu: HTMLElement, label: string) {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === label,
  );
}

describe("ProfileMenu session actions", () => {
  test("has no game section outside a game", () => {
    act(() => root.render(<ProfileMenu me={ME} />));
    const menu = open();
    expect(item(menu, "Settings")).toBeDefined();
    expect(item(menu, "Send feedback")).toBeDefined();
    // Cosmetics are reached through the single Store item.
    expect(item(menu, "Cosmetics")).toBeUndefined();
    expect(item(menu, "Store")).toBeDefined();
    // Nothing game-shaped leaks onto the lobby, leaderboard or profile routes.
    expect(menu.textContent).not.toContain("This game");
    expect(item(menu, "Leave & Spectate")).toBeUndefined();
    expect(item(menu, "Reset to lobby")).toBeUndefined();
  });

  test("treats an empty action list as none", () => {
    act(() => root.render(<ProfileMenu me={ME} sessionActions={[]} />));
    expect(open().textContent).not.toContain("This game");
  });

  test("renders the game section and fires its items", () => {
    const fired: string[] = [];
    const actions: SessionAction[] = [
      {
        key: "leave",
        label: "Leave & Spectate",
        tone: "danger",
        onSelect: () => fired.push("leave"),
      },
      {
        key: "reset",
        label: "Reset to lobby",
        tone: "danger",
        onSelect: () => fired.push("reset"),
      },
    ];
    act(() => root.render(<ProfileMenu me={ME} sessionActions={actions} />));

    let menu = open();
    expect(menu.textContent).toContain("This game");
    expect(item(menu, "Leave & Spectate")).toBeDefined();
    expect(item(menu, "Reset to lobby")).toBeDefined();

    act(() => item(menu, "Leave & Spectate")!.click());
    expect(fired).toEqual(["leave"]);
    // Selecting an item closes the menu, the same as every other row here.
    expect(host.querySelector('[role="menu"]')).toBeNull();

    menu = open();
    act(() => item(menu, "Reset to lobby")!.click());
    expect(fired).toEqual(["leave", "reset"]);
  });

  test("keeps the game section in the Discord Activity", () => {
    h.activity = true;
    const actions: SessionAction[] = [
      { key: "leave", label: "Leave & Spectate", onSelect: () => {} },
    ];
    act(() => root.render(<ProfileMenu me={ME} sessionActions={actions} />));
    const menu = open();

    // Session actions stay in the Activity since neither leaves the table;
    // the two escapes go.
    expect(item(menu, "Leave & Spectate")).toBeDefined();
    expect(item(menu, "View profile")).toBeUndefined();
    expect(item(menu, "Log out")).toBeUndefined();
    // The in-place dialogs stay.
    expect(item(menu, "Settings")).toBeDefined();
    // This menu is the only way to the store inside the Activity.
    expect(item(menu, "Store")).toBeDefined();
  });
});

// The two round triggers at either end of the mobile header should match in
// size and stroke. jsdom has no layout, so this pins the avatar's inline ring
// style and the hamburger's classes.
describe("mobile header triggers", () => {
  test("hamburger matches the avatar size", () => {
    act(() => root.render(<ProfileMenu me={ME} />));
    // Punchboard: the avatar disc is itself the piece (keyline and edge from
    // pb-site.css on `data-pb-avatar-trigger`), so it carries no ring.
    const avatar = host.querySelector<HTMLElement>("button [data-pb-avatar-trigger] > div")!;
    expect(avatar.style.borderWidth).toBe("0px");
    expect(avatar.style.width).toBe("36px");

    act(() => root.render(<HamburgerMenu />));
    const trigger = host.querySelector("button")!.className;
    // On the site the hamburger takes a 1px rim and a lift; inside a game the
    // HUD restores its 3px ring via `[data-ui-menu-trigger].border` (index.css).
    expect(trigger).toMatch(/(^| )border( |$)/);
    expect(trigger).not.toContain("border-2");
    expect(host.querySelector("button")!.hasAttribute("data-ui-menu-trigger")).toBe(true);
    // Same box as the avatar.
    expect(trigger).toContain("w-9");
    expect(trigger).toContain("h-9");
  });
});

// Both are icon-only, so each needs an accessible name.
describe("icon-only menu labels", () => {
  test("labels the hamburger and account menu", () => {
    act(() => root.render(<HamburgerMenu />));
    expect(host.querySelector("button")!.getAttribute("aria-label")).toBe("Menu");
    act(() => root.render(<ProfileMenu me={ME} />));
    expect(host.querySelector("button")!.getAttribute("aria-label")).toBe("Account menu");
  });
});

// The game screen cannot mount in jsdom, so this checks its source: the
// session actions go through the profile menu.
describe("game screen utility row", () => {
  const src = readFileSync(join(__dirname, "..", "routes", "Game.tsx"), "utf8");

  test("has no separate game-actions menu", () => {
    expect(src).not.toContain('aria-label="Game menu"');
    expect(src).not.toContain("⋯");
    expect(src).toContain("sessionActions={sessionActions}");
    // Matched on the words, since the labels sit inside a `t` macro.
    expect(src).toContain("Leave & Spectate");
    expect(src).toContain("Reset to lobby");
  });

  test("hides reset to lobby on ranked tables", () => {
    // Ranked tables refuse a reset (409 RANKED_NO_RESET), so the item is hidden.
    expect(src).toContain("!isRankedTable");
    // Read from the same payloads, in the same order, as hostId.
    expect(src).toContain("sock.summary?.game.ranked ?? seatQ.data?.game.ranked");
  });

  test("camera orb draws the reticle icon", () => {
    expect(src).toContain("<ResetView size={16} />");
    expect(src).not.toContain("FrameCorners");
  });
});
