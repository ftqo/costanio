import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ME_CACHE_KEY } from "./session";

// The socket is the module's only output, so it is faked. Hoisted because
// lib/preconnect dials at import time.
const ensureOpen = vi.hoisted(() => vi.fn());
vi.mock("./ws", () => ({ gameSocket: { ensureOpen } }));

/** Fresh module instance each time, so the import-time call runs again against
 * whatever storage the case has just set up. */
async function importPreconnect() {
  vi.resetModules();
  return import("./preconnect");
}

describe("preconnectSession", () => {
  beforeEach(() => {
    ensureOpen.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("dials for a visitor who looked logged in last time", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ id: 1, name: "Tester" }));
    const { preconnectSession } = await importPreconnect();
    // Once from the module's own import-time call.
    expect(ensureOpen).toHaveBeenCalledTimes(1);
    expect(preconnectSession()).toBe(true);
    expect(ensureOpen).toHaveBeenCalledTimes(2);
  });

  // Otherwise every logged-out visitor would open a socket the hub never admits.
  it("does not dial with no cached identity", async () => {
    const { preconnectSession } = await importPreconnect();
    expect(ensureOpen).not.toHaveBeenCalled();
    expect(preconnectSession()).toBe(false);
    expect(ensureOpen).not.toHaveBeenCalled();
  });

  // In the Activity, GameSocket.open sends the auth frame from getBearer() at
  // open time, so a socket dialled before the SDK bootstrap never authenticates.
  it("does not dial inside the Discord Activity", async () => {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ id: 1, name: "Tester" }));
    window.history.replaceState({}, "", "/lobby?frame_id=abc");
    const { preconnectSession } = await importPreconnect();
    expect(ensureOpen).not.toHaveBeenCalled();
    expect(preconnectSession()).toBe(false);
  });

  it("stays silent when storage is unavailable rather than throwing", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      const { preconnectSession } = await importPreconnect();
      expect(preconnectSession()).toBe(false);
      expect(ensureOpen).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the entry module imports it first", () => {
  // The saving depends on evaluating before the rest of the graph, and ES
  // modules evaluate depth-first in import order. Moved below react-dom or the
  // router it still connects, just late, with every other test green, so the
  // position is asserted.
  it("as its very first import, ahead of react and the router", () => {
    const src = readFileSync(join(__dirname, "../main.tsx"), "utf-8");
    const imports = [...src.matchAll(/^import\s.*?["'](.+?)["'];?$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(1);
    expect(imports[0]).toBe("@/lib/preconnect");
  });
});
