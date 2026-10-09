import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColorView, CosmeticItem } from "@/lib/types";

// The store's shelves inside the Discord Activity.
//
// Nothing on this surface links to /support, since the Activity has no site
// nav to come back through. The gate labels ("Support to unlock") still show.
//
// routes/Store.test.tsx covers the same shelves on the web, where all three
// links are real.

const h = vi.hoisted(() => ({
  activity: true,
  items: [] as CosmeticItem[],
  colors: [] as ColorView[],
}));

vi.mock("@/lib/activity", () => ({ inActivityMode: () => h.activity }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: { id: 1, name: "T", supporter: false }, refresh: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    purchase: vi.fn(),
    setLoadout: vi.fn(),
    cosmetics: vi.fn(),
    wallet: vi.fn(),
    loadout: vi.fn(),
    colors: vi.fn(),
  },
  ApiErr: class ApiErr extends Error {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data =
      queryKey[0] === "wallet"
        ? { balance: 0, recent: [] }
        : queryKey[0] === "cosmetics"
          ? { items: h.items }
          : queryKey[0] === "loadout"
            ? { loadout: {} }
            : { colors: h.colors };
    return { data, refetch: vi.fn(), isLoading: false };
  },
}));

import { StoreContent, StoreDialog } from "./StoreShelves";
import { ToastProvider } from "@/components/ui/toast";

function mount() {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r: Root = createRoot(c);
  act(() =>
    r.render(
      <ToastProvider>
        <StoreContent>{(body) => <div>{body}</div>}</StoreContent>
      </ToastProvider>,
    ),
  );
  return { c, r };
}

beforeEach(() => {
  h.activity = true;
  h.items = [];
  h.colors = [];
  window.matchMedia = (() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe("store in the Discord Activity", () => {
  it("has no support links on cards, swatches or the pitch", () => {
    h.items = [
      {
        id: "robber.keg",
        slot: "robber",
        name: "Keg",
        price: 0,
        supporter: true,
        booster: false,
        kofi: false,
        staff: false,
        gift: false,
        owned: false,
        equipped: false,
        locked: true,
      },
    ];
    h.colors = [
      { id: "color.ff55ff", hex: "#ff55ff", name: "Pink", free: false, available: false, price: 0 },
    ];
    const { c, r } = mount();
    // Pick the supporter-only swatch first: its unlock link only renders once a
    // colour is selected.
    const swatch = [...c.querySelectorAll("button")].find(
      (b) => b.title === "Pink (supporter color)",
    )!;
    expect(swatch).toBeDefined();
    act(() => swatch.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(c.querySelectorAll('a[href="/support"]')).toHaveLength(0);
    // The gate still names itself, without a link.
    expect(c.textContent).toContain("Support to unlock");
    // The panel still says what supporting costs.
    expect(c.textContent).toContain("$4.99");
    expect(c.textContent).toContain("Supporting is set up on the website.");
    act(() => r.unmount());
  });

  it("still labels a boost-only item", () => {
    h.items = [
      {
        id: "pieces.cyclades",
        slot: "pieces",
        name: "Cyclades Set",
        price: 0,
        supporter: false,
        booster: true,
        kofi: false,
        staff: false,
        gift: false,
        owned: false,
        equipped: false,
        locked: true,
      },
    ];
    const { c, r } = mount();
    expect(c.textContent).toContain("Boost to unlock");
    expect(c.querySelectorAll('a[href="/support"]')).toHaveLength(0);
    act(() => r.unmount());
  });

  it("shows the support links on the web", () => {
    h.activity = false;
    h.colors = [
      { id: "color.ff55ff", hex: "#ff55ff", name: "Pink", free: false, available: false, price: 0 },
    ];
    h.items = [
      {
        id: "robber.keg",
        slot: "robber",
        name: "Keg",
        price: 0,
        supporter: true,
        booster: false,
        kofi: false,
        staff: false,
        gift: false,
        owned: false,
        equipped: false,
        locked: true,
      },
    ];
    const { c, r } = mount();
    // The card's link and the panel's pitch, which is the marked one.
    expect(c.querySelector('a[href="/support"]:not([data-supporter-pitch])')).not.toBeNull();
    expect(c.querySelector("a[data-supporter-pitch]")).not.toBeNull();
    // The swatch's link only renders once a colour is picked, so pick the
    // supporter colour and check it here.
    const swatch = [...c.querySelectorAll("button")].find(
      (b) => b.title === "Pink (supporter color)",
    )!;
    expect(swatch).toBeDefined();
    act(() => swatch.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect([...c.querySelectorAll('a[href="/support"]')].length).toBe(3);
    act(() => r.unmount());
  });
});

// The dialog surface itself (SiteHeader.test.tsx stubs it out).
describe("StoreDialog", () => {
  it("mounts the shelves only when open", () => {
    h.items = [
      {
        id: "robber.keg",
        slot: "robber",
        name: "Keg",
        price: 0,
        supporter: true,
        booster: false,
        kofi: false,
        staff: false,
        gift: false,
        owned: false,
        equipped: false,
        locked: true,
      },
    ];
    const c = document.createElement("div");
    document.body.appendChild(c);
    const r: Root = createRoot(c);

    // Closed: no portal. (Radix already skips a closed DialogContent, so this
    // does not pin StoreDialog's `open &&` guard.)
    act(() =>
      r.render(
        <ToastProvider>
          <StoreDialog open={false} onOpenChange={() => {}} />
        </ToastProvider>,
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() =>
      r.render(
        <ToastProvider>
          <StoreDialog open onOpenChange={() => {}} />
        </ToastProvider>,
      ),
    );
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toContain("Store");
    // A close button, since phones and the Activity have no Escape key.
    expect(dlg.querySelector('[aria-label="Close"]')).not.toBeNull();
    // The surface re-points the muted prose token for contrast in light mode.
    expect(dlg.style.getPropertyValue("--color-on-background-muted")).toBe("var(--muted)");

    act(() => r.unmount());
    c.remove();
  });
});
