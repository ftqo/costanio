import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HOME_COLUMNS_QUERY, HOME_SHORT_QUERY } from "@/components/home/layout";

// The scene is mocked to a marker: jsdom has no WebGL, and these tests are
// about where the page put it and what it told it about the copy. The marker
// carries the insets out so they can be asserted. Default export, because
// Landing reaches it via React.lazy.
vi.mock("@/components/home/HomeScene", () => ({
  default: ({ chrome }: { chrome: Record<string, number> }) =>
    React.createElement("div", {
      "data-testid": "home-scene",
      "data-left": String(chrome.left),
      "data-top": String(chrome.top),
      "data-bottom": String(chrome.bottom),
    }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
  useNavigate: () => vi.fn(),
}));

// Header and footer chrome are tested elsewhere and pull in the whole
// session/menu/language stack.
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/Screen", () => ({
  Screen: (p: { children?: React.ReactNode }) => React.createElement("div", null, p.children),
}));

// Throws rather than returning nothing: this route must have no queries, and a
// quiet mock would let one be added back unnoticed.
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => {
    throw new Error("the landing page must not query the backend");
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ me: null, ensureSession: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));
vi.mock("@/components/AbandonGuard", () => ({ useAbandonGuard: () => vi.fn() }));

const { Landing } = await import("./Landing");

// jsdom has no matchMedia, which `useMediaQuery` reads as "no match" (the bands
// arrangement), so every arrangement is requested explicitly.
function stubMedia(matching: string[]) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: matching.includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function teardown() {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

async function render() {
  teardown(); // so a test can render both arrangements in turn
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  await act(async () => {
    r.render(React.createElement(Landing));
  });
  // A second flush: the scene is lazy, so its first paint is one microtask
  // after the render that asked for it.
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(teardown);

describe("Landing layout", () => {
  it("places the board beside the copy in landscape", async () => {
    stubMedia([HOME_COLUMNS_QUERY]);
    await render();
    const scene = host!.querySelector("[data-testid=home-scene]");
    expect(scene).not.toBeNull();
    // Framed off the left, where the column is.
    expect(Number(scene!.getAttribute("data-left"))).toBeGreaterThan(0.2);
  });

  it("places the board below the copy in portrait", async () => {
    // Portrait at every width: the copy goes above the island, and the board
    // is told so on its `top` rather than `left`.
    stubMedia([]);
    await render();
    const scene = host!.querySelector("[data-testid=home-scene]");
    expect(scene).not.toBeNull();
    expect(Number(scene!.getAttribute("data-left"))).toBeLessThan(0.1);
    expect(Number(scene!.getAttribute("data-top"))).toBeGreaterThan(0.2);
  });

  it("hides the log-in note on a landscape phone", async () => {
    // The short tier is still columns: a phone on its side has width to spare
    // and little height, so only the spacing tightens.
    stubMedia([HOME_COLUMNS_QUERY, HOME_SHORT_QUERY]);
    await render();
    expect(host!.querySelector("[data-testid=home-scene]")).not.toBeNull();
    expect(host!.textContent).not.toContain("to host a table");
  });

  it("always renders the board", async () => {
    // No device case: a narrow window gets a small island, not a different
    // page.
    for (const media of [
      [HOME_COLUMNS_QUERY],
      [HOME_COLUMNS_QUERY, HOME_SHORT_QUERY],
      [HOME_SHORT_QUERY],
      [],
    ]) {
      stubMedia(media);
      await render();
      expect(host!.querySelector("[data-testid=home-scene]")).not.toBeNull();
    }
  });

  it("renders the site footer and frames the island above it", async () => {
    // The same footer as every other page, so Terms, Privacy and Discord are
    // where visitors expect.
    stubMedia([HOME_COLUMNS_QUERY]);
    await render();
    expect(host!.textContent).toContain("Discord");
    expect(host!.textContent).toContain("Terms");
    expect(host!.textContent).toContain("Privacy");
    // And the board is told about it. jsdom lays nothing out, so this pins
    // that a nonzero inset is passed; zero would put the coast behind the
    // footer.
    const scene = host!.querySelector("[data-testid=home-scene]");
    expect(Number(scene!.getAttribute("data-bottom"))).toBeGreaterThan(0);
  });

  it("keeps the headline and code box in both layouts", async () => {
    for (const media of [[HOME_COLUMNS_QUERY], []]) {
      stubMedia(media);
      await render();
      expect(host!.textContent).toContain("Trade and settle the land of Costanio");
      expect(host!.querySelector("input[name=table-invite]")).not.toBeNull();
    }
  });

  it("makes no backend requests", async () => {
    // The front page works without the API: the board is bundled and the copy
    // static, so there is no session, table list or 401 to wait on. `useQuery`
    // is mocked to throw, so a query added back here fails loudly.
    stubMedia([HOME_COLUMNS_QUERY]);
    await render();
    expect(host!.textContent).toContain("Trade and settle the land of Costanio");
  });
});
