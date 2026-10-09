import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ColorView, CosmeticItem } from "@/lib/types";

function item(over: Partial<CosmeticItem> & { id: string; slot: string }): CosmeticItem {
  return {
    name: over.id,
    price: 0,
    supporter: false,
    booster: false,
    kofi: false,
    staff: false,
    gift: false,
    owned: false,
    equipped: false,
    locked: false,
    ...over,
  };
}

function color(over: Partial<ColorView> & { id: string; hex: string }): ColorView {
  return {
    name: over.id,
    free: false,
    available: false,
    price: 0,
    ...over,
  };
}

// Three colours standing for the palette's three classes: one free preset, one
// on the shelf, one that only supporting opens.
const palette = () => [
  color({ id: "color.ff0000", hex: "#ff0000", name: "Red", free: true, available: true }),
  color({ id: "color.55aaff", hex: "#55aaff", name: "Sky", price: 2000 }),
  color({ id: "color.ff55ff", hex: "#ff55ff", name: "Pink" }),
];

const h = vi.hoisted(() => {
  const items: CosmeticItem[] = [];
  const colors: ColorView[] = [];
  const loadout: Record<string, string> = {};
  return {
    purchase: vi.fn(),
    setLoadout: vi.fn(),
    balance: 0,
    items,
    colors,
    loadout,
    refetch: vi.fn(),
    supporter: false,
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: { id: 1, name: "T", supporter: h.supporter }, refresh: vi.fn() }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
  useNavigate: () => vi.fn(),
}));
// The real gallery, wrapped so a test can read the colour it was asked to draw
// the piece sets in. Mocking it entirely would remove the previews.
vi.mock("@/components/CosmeticGallery", async (orig) => {
  const real = await orig<typeof import("@/components/CosmeticGallery")>();
  return {
    ...real,
    CosmeticGallery: (p: { children: React.ReactNode; seatColor?: string }) =>
      React.createElement(
        "div",
        { "data-seat-color": p.seatColor },
        React.createElement(real.CosmeticGallery, p),
      ),
  };
});
vi.mock("@/lib/api", () => ({
  api: {
    purchase: h.purchase,
    setLoadout: h.setLoadout,
    cosmetics: vi.fn(),
    wallet: vi.fn(),
    loadout: vi.fn(),
    colors: vi.fn(),
    updateMe: vi.fn(),
  },
  ApiErr: class ApiErr extends Error {},
}));
// One fake per query key, so a test can pose any wallet/catalog state.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data =
      queryKey[0] === "wallet"
        ? { balance: h.balance, recent: [] }
        : queryKey[0] === "cosmetics"
          ? { items: h.items }
          : queryKey[0] === "loadout"
            ? { loadout: h.loadout }
            : { colors: h.colors };
    return { data, refetch: h.refetch, isLoading: false };
  },
}));

import { Store } from "./Store";
import { seatColor } from "@/lib/hexgeo";
import { ToastProvider } from "@/components/ui/toast";

function mount(ui: React.ReactElement) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r: Root = createRoot(c);
  act(() => r.render(<ToastProvider>{ui}</ToastProvider>));
  return { c, r };
}

// The link a locked card or swatch offers, not the one in the supporter panel
// at the top of the page. Both point at /support; these tests are about the
// card's.
function supportLink(c: HTMLElement): HTMLAnchorElement | null {
  return c.querySelector('a[href="/support"]:not([data-supporter-pitch])');
}

function findButton(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
}

// "Equip" is a prefix of "Equipped", and the Default card sits first in its
// grid, so match the whole label where it matters.
function findExactButton(c: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...c.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

/** The colour the gallery is currently drawing the seat-coloured sets in. */
function gallerySeatColor(c: HTMLElement): string | null {
  return c.querySelector("[data-seat-color]")?.getAttribute("data-seat-color") ?? null;
}

function click(el: Element) {
  return act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Store", () => {
  beforeEach(() => {
    h.supporter = false;
    // jsdom ships no matchMedia, and the decoration cards render DecoratedName,
    // which asks about reduced motion. Reduced, so nothing animates in a test.
    window.matchMedia = (() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    vi.clearAllMocks();
    h.balance = 0;
    h.items = [];
    h.colors = [];
    h.loadout = {};
  });

  it("shows the balance", () => {
    h.balance = 275;
    const { c, r } = mount(<Store />);
    expect(c.textContent).toContain("275");
    act(() => r.unmount());
  });

  // A price you cannot meet must say how short you are, not just show a dead
  // button.
  it("refuses an item you cannot afford and says by how much", () => {
    h.balance = 50;
    h.items = [item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 })];
    const { c, r } = mount(<Store />);

    expect(c.textContent).toContain("350");
    const buy = findButton(c, "Buy");
    expect(buy?.disabled ?? true).toBe(true);
    act(() => r.unmount());
  });

  it("buys an item you can afford, once the confirm is answered", async () => {
    h.balance = 500;
    h.items = [item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 })];
    h.purchase.mockResolvedValue({ owned: true, balance: 300 });
    const { c, r } = mount(<Store />);

    await click(findButton(c, "Buy")!);
    // Spending is confirmed before it happens: a mis-click must not cost 200.
    expect(h.purchase).not.toHaveBeenCalled();
    await click(findButton(c, "Confirm")!);
    expect(h.purchase).toHaveBeenCalledWith("robber.sentinel");
    act(() => r.unmount());
  });

  it("equips something you already own", async () => {
    h.items = [item({ id: "robber.keg", slot: "robber", name: "Keg", price: 900, owned: true })];
    h.setLoadout.mockResolvedValue({ loadout: { robber: "robber.keg" } });
    const { c, r } = mount(<Store />);

    await click(findExactButton(c, "Equip")!);
    expect(h.setLoadout).toHaveBeenCalledWith("robber", "robber.keg");
    act(() => r.unmount());
  });

  // In a section with a Default card, taking something off is putting the
  // stock art back on, so there is no Unequip button.
  it("goes back to the stock art by equipping Default", async () => {
    h.items = [
      item({
        id: "robber.keg",
        slot: "robber",
        name: "Keg",
        price: 900,
        owned: true,
        equipped: true,
      }),
    ];
    h.setLoadout.mockResolvedValue({ loadout: {} });
    const { c, r } = mount(<Store />);

    expect(findButton(c, "Unequip")).toBeUndefined();
    expect(c.textContent).toContain("Equipped");
    await click(findExactButton(c, "Equip")!); // the Default card's, the only one left
    expect(h.setLoadout).toHaveBeenCalledWith("robber", "");
    act(() => r.unmount());
  });

  // With nothing bought, the stock art is still what you wear, and the page
  // says so.
  it("shows Default as equipped when the slot is empty", () => {
    h.items = [item({ id: "robber.keg", slot: "robber", name: "Keg", price: 900, owned: true })];
    const { c, r } = mount(<Store />);
    expect(c.textContent).toContain("Default");
    expect(findExactButton(c, "Equipped")?.disabled).toBe(true);
    act(() => r.unmount());
  });

  it("sells only piece sets that have art", () => {
    h.items = [
      item({ id: "pieces.cyclades", slot: "pieces", name: "Cyclades Set", price: 1000 }),
      // Reserved in the catalog since cosmetics shipped, never modelled.
      item({ id: "pieces.obsidian", slot: "pieces", name: "Obsidian Set", price: 800 }),
    ];
    const { c, r } = mount(<Store />);
    expect(c.textContent).toContain("Piece sets");
    expect(c.textContent).toContain("Cyclades Set");
    expect(c.textContent).not.toContain("Obsidian Set");
    act(() => r.unmount());
  });

  // The Default card is not for sale, so it alone does not make a section
  // appear.
  it("renders no piece section when no set has art yet", () => {
    h.items = [item({ id: "pieces.driftwood", slot: "pieces", name: "Driftwood Set", price: 600 })];
    const { c, r } = mount(<Store />);
    expect(c.textContent).not.toContain("Piece sets");
    act(() => r.unmount());
  });

  // No robber models have shipped, and an empty heading reads as a bug. A
  // section appears only when it has something in it.
  it("renders no section for a slot with nothing in it", () => {
    h.items = [item({ id: "decoration.x", slot: "decoration", name: "Sparkle", price: 2500 })];
    const { c, r } = mount(<Store />);
    expect(c.textContent).not.toContain("Robbers");
    act(() => r.unmount());
  });

  it("renders a robber section once skins exist", () => {
    h.items = [item({ id: "robber.test", slot: "robber", name: "Test Robber", price: 400 })];
    const { c, r } = mount(<Store />);
    expect(c.textContent).toContain("Robbers");
    act(() => r.unmount());
  });

  // The store answers the question a locked card raises: what supporting costs
  // and what it gives, here rather than only on /support.
  describe("the supporter panel", () => {
    it("names the price and what it buys", () => {
      h.colors = palette();
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text).toContain("$4.99");
      expect(text).toContain("10,000"); // the monthly stipend, in Pips
      expect(c.querySelector('a[href="/support"][data-supporter-pitch]')).not.toBeNull();
      act(() => r.unmount());
    });

    // Counted from the palette rather than written into the copy, so the number
    // stays right as colours move.
    it("counts the supporter colors it is offering", () => {
      // Two gated swatches, not one: the panel really prints 54, and "1" would
      // take the plain-number branch out of the test.
      h.colors = [...palette(), color({ id: "color.55ffaa", hex: "#55ffaa", name: "Mint" })];
      const supporterCount = h.colors.filter((x) => !x.free && x.price <= 0).length;
      const { c, r } = mount(<Store />);
      expect(c.textContent).toContain(`${supporterCount} more seat colors`);
      act(() => r.unmount());
    });

    // A supporter is thanked, not sold to.
    it("confirms rather than sells to a supporter", () => {
      h.supporter = true;
      h.colors = palette();
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text).toContain("You are a supporter");
      expect(text).not.toContain("$4.99");
      expect(c.querySelector('a[href="/support"][data-supporter-pitch]')).toBeNull();
      act(() => r.unmount());
    });
  });

  describe("shelf groups", () => {
    it("splits Pips items from the rest", () => {
      h.items = [
        item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 }),
        item({ id: "robber.keg", slot: "robber", name: "Keg", supporter: true, locked: true }),
      ];
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text).toContain("For Pips");
      expect(text).toContain("Not for Pips");
      // One heading, two grids: the slot does not become two sections.
      expect(text.match(/Robbers/g)?.length).toBe(1);
      // The shelf group comes first: it is the one with something to do.
      expect(text.indexOf("For Pips")).toBeLessThan(text.indexOf("Not for Pips"));
      expect(text.indexOf("Sentinel")).toBeLessThan(text.indexOf("Keg"));
      act(() => r.unmount());
    });

    // Price alone decides the split, as on the server and in the catalog:
    // robber.brigand is free for staff and 350 for everyone else, so a role
    // gate beside a price is a discount. The fixture is the server's real shape
    // (cosmetics/service.go's itemLocked returns false for anything priced), and
    // the test checks the buy button as well as the heading.
    it("puts a priced-but-gated item on the Pips shelf, with a working price", () => {
      h.balance = 10_000;
      h.items = [
        item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 }),
        // What /api/cosmetics returns for robber.brigand to a non-staff
        // account: priced, staff-gated, not locked.
        item({
          id: "robber.brigand",
          slot: "robber",
          name: "Brigand",
          price: 350,
          staff: true,
          locked: false,
        }),
      ];
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text).toContain("Brigand");
      expect(text.indexOf("For Pips")).toBeLessThan(text.indexOf("Brigand"));
      // Nothing may sit under "Not for Pips" here; showing the price is not
      // enough.
      expect(text).not.toContain("Not for Pips");
      act(() => r.unmount());
    });

    // A price with no art behind it is `reserved`: the server refuses to sell
    // it, and the card says so rather than offering it for Pips.
    it("keeps a reserved id off the Pips shelf", () => {
      h.balance = 10_000;
      h.items = [
        item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 }),
        item({
          id: "robber.someday",
          slot: "robber",
          name: "Someday",
          price: 900,
          reserved: true,
          locked: true,
        }),
      ];
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text.indexOf("Not for Pips")).toBeLessThan(text.indexOf("Someday"));
      expect(text).toContain("Unavailable");
      // Not "Support to unlock": supporting will not conjure art nobody made.
      expect(text).not.toContain("Support to unlock");
      // No price is printed for it anywhere.
      expect(text).not.toContain("900");
      act(() => r.unmount());
    });

    // An empty group heading reads as a bug. A slot that is all shelf looks as
    // it did before the split.
    it("drops a group with nothing in it", () => {
      h.items = [item({ id: "robber.sentinel", slot: "robber", name: "Sentinel", price: 400 })];
      const { c, r } = mount(<Store />);
      expect(c.textContent).not.toContain("Not for Pips");
      act(() => r.unmount());
    });
  });

  // Everything shows; what differs is what the card can offer.
  it("shows every item, including the ones it cannot sell", () => {
    h.items = [
      item({
        id: "decoration.staff",
        slot: "decoration",
        name: "Staff",
        staff: true,
        locked: true,
      }),
      item({ id: "decoration.fire_blue", slot: "decoration", name: "Blue Fire", price: 5000 }),
      item({ id: "decoration.supporter", slot: "decoration", name: "Supporter", supporter: true }),
    ];
    const { c, r } = mount(<Store />);
    const text = c.textContent ?? "";
    expect(text).toContain("Staff");
    expect(text).toContain("Blue Fire");
    expect(text).toContain("Supporter");
    act(() => r.unmount());
  });

  // Handed out, not earned and not sold: nothing the reader can do, so the card
  // says so instead of linking to a page that would not help.
  it("says unavailable for staff and the gift fires", () => {
    h.balance = 10_000;
    h.items = [
      item({
        id: "decoration.staff",
        slot: "decoration",
        name: "Staff",
        staff: true,
        locked: true,
      }),
      item({
        id: "decoration.fire_black",
        slot: "decoration",
        name: "Black Fire",
        gift: true,
        locked: true,
      }),
    ];
    const { c, r } = mount(<Store />);
    expect(findButton(c, "Buy")).toBeUndefined();
    expect(supportLink(c), "no support link on a handout").toBeNull();
    expect((c.textContent ?? "").match(/Unavailable/g)?.length).toBe(2);
    act(() => r.unmount());
  });

  // Every effect that is not handed out is bought like anything else.
  it("sells the effects", async () => {
    h.balance = 10_000;
    h.items = [
      item({ id: "decoration.fire_blue", slot: "decoration", name: "Blue Fire", price: 5000 }),
    ];
    h.purchase.mockResolvedValue({ owned: true, balance: 5000 });
    const { c, r } = mount(<Store />);
    await click(findButton(c, "Buy")!);
    await click(findButton(c, "Confirm")!);
    expect(h.purchase).toHaveBeenCalledWith("decoration.fire_blue");
    act(() => r.unmount());
  });

  // Price 0 means "not Pip-purchasable", not "free": a Buy button would fail
  // server-side with ErrNotPurchasable.
  it("offers no buy button for an unpriced item", () => {
    h.balance = 10_000;
    h.items = [item({ id: "decoration.odd", slot: "decoration", name: "Oddity", price: 0 })];
    const { c, r } = mount(<Store />);
    expect(findButton(c, "Buy")).toBeUndefined();
    expect(c.textContent).toContain("Unavailable");
    act(() => r.unmount());
  });

  // Role-gated items are not for sale at any price.
  it("offers no buy button for a role-locked item", () => {
    h.balance = 10_000;
    h.items = [
      item({
        id: "decoration.supporter",
        slot: "decoration",
        name: "Supporter",
        supporter: true,
        locked: true,
      }),
    ];
    const { c, r } = mount(<Store />);
    expect(findButton(c, "Buy")).toBeUndefined();
    act(() => r.unmount());
  });

  // The store sells the palette, so it shows all of it: owned colours, the
  // ones on the shelf, and the supporter half.
  describe("seat colors", () => {
    it("shows every color, the locked half included", () => {
      h.colors = palette();
      const { c, r } = mount(<Store />);
      expect(c.textContent).toContain("Seat colors");
      expect(c.querySelectorAll("button[aria-pressed]").length).toBe(3);
      act(() => r.unmount());
    });

    // The palette splits too, with a third class the item slots lack (the ten
    // free presets), grouped with the ones you can buy.
    it("splits the palette into what you can have and what supporting adds", () => {
      h.colors = palette();
      const { c, r } = mount(<Store />);
      const text = c.textContent ?? "";
      expect(text).toContain("Free and for Pips");
      expect(text).toContain("Not for Pips");
      // Every swatch still shows, in two grids rather than one.
      expect(c.querySelectorAll("button[aria-pressed]").length).toBe(3);
      expect(c.querySelectorAll(".grid").length).toBeGreaterThanOrEqual(2);
      act(() => r.unmount());
    });

    it("sells a color on the shelf, once the confirm is answered", async () => {
      h.balance = 10_000;
      h.colors = palette();
      h.purchase.mockResolvedValue({ owned: true, balance: 8000 });
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[1]);
      expect(c.textContent).toContain("Sky");
      await click(findButton(c, "Buy")!);
      expect(h.purchase).not.toHaveBeenCalled();
      await click(findButton(c, "Confirm")!);
      expect(h.purchase).toHaveBeenCalledWith("color.55aaff");
      act(() => r.unmount());
    });

    // Short of the price is not the same as unavailable: say by how much.
    it("refuses a color you cannot afford and says by how much", async () => {
      h.balance = 500;
      h.colors = palette();
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[1]);
      expect(c.textContent).toContain("1,500");
      expect(findButton(c, "Buy")?.disabled).toBe(true);
      act(() => r.unmount());
    });

    // The supporter half is not for sale at any balance, so its swatch points
    // at the support page, as a locked name effect does.
    it("sends a supporter-only color to the support page", async () => {
      h.balance = 10_000;
      h.colors = palette();
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[2]);
      expect(findButton(c, "Buy")).toBeUndefined();
      expect(supportLink(c)?.textContent).toContain("Support to unlock");
      act(() => r.unmount());
    });

    it("equips a color you already have", async () => {
      h.colors = palette();
      h.setLoadout.mockResolvedValue({ loadout: { color: "color.ff0000" } });
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[0]);
      await click(findExactButton(c, "Equip")!);
      expect(h.setLoadout).toHaveBeenCalledWith("color", "color.ff0000");
      act(() => r.unmount());
    });

    // After equipping, the row still names the colour, now marked Equipped.
    it("keeps the color named after you equip it", async () => {
      h.colors = palette();
      h.setLoadout.mockResolvedValue({ loadout: { color: "color.ff0000" } });
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[0]);
      await click(findExactButton(c, "Equip")!);
      expect(c.textContent).toContain("Red");
      act(() => r.unmount());
    });

    it("disables Equip for the equipped color", async () => {
      h.colors = palette();
      h.loadout = { color: "color.ff0000" };
      const { c, r } = mount(<Store />);

      await click(c.querySelectorAll("button[aria-pressed]")[0]);
      expect(findExactButton(c, "Equipped")?.disabled).toBe(true);
      act(() => r.unmount());
    });

    // Picking a swatch re-renders the piece sets below in it, bought or not, so
    // the gallery must be handed the picked colour.
    it("previews the piece sets in the color under the pointer", async () => {
      h.colors = palette();
      h.items = [
        item({ id: "pieces.cyclades", slot: "pieces", name: "Cyclades Set", price: 1000 }),
      ];
      const { c, r } = mount(<Store />);

      // Nothing picked and nothing equipped: the seat-order default, as a table
      // would give this player.
      expect(gallerySeatColor(c)).toBe(seatColor(0));
      await click(c.querySelectorAll("button[aria-pressed]")[1]);
      expect(gallerySeatColor(c)).toBe("#55aaff");
      act(() => r.unmount());
    });
  });
});
