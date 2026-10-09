import { describe, expect, test, beforeEach, vi, afterEach } from "vitest";
import {
  shotKey,
  readShots,
  writeShots,
  sweepStaleShots,
  shotsToURLs,
  SHOT_BAKE_VERSION,
  __resetShotStore,
} from "./shotStore";

// jsdom has no IndexedDB, which is the environment the store must survive
// (private browsing, sandboxed frames). Without a fake DB these tests pin the
// degradation path: a miss, never a throw.

beforeEach(() => {
  __resetShotStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shotKey", () => {
  test("includes the bake version, so a bump abandons old entries", () => {
    expect(shotKey("icon", "#ff0000", 1)).toBe("1|icon|#ff0000");
    expect(shotKey("icon", "#ff0000", 2)).not.toBe(shotKey("icon", "#ff0000", 1));
  });

  test("separates the shot sets, which render the same colour differently", () => {
    expect(shotKey("icon", "#ff0000")).not.toBe(shotKey("shop", "#ff0000"));
  });

  test("normalises case, since a colour reaches us from several places", () => {
    expect(shotKey("icon", "#FF0000")).toBe(shotKey("icon", "#ff0000"));
  });

  test("defaults to the current bake version", () => {
    expect(shotKey("icon", "#ff0000")).toBe(`${SHOT_BAKE_VERSION}|icon|#ff0000`);
  });
});

describe("without IndexedDB", () => {
  test("a read is a miss, not a throw", async () => {
    await expect(readShots("icon", "#ff0000")).resolves.toBeNull();
  });

  test("a write is a no-op, not a throw", async () => {
    await expect(writeShots("icon", "#ff0000", { a: new Blob(["x"]) })).resolves.toBeUndefined();
  });

  test("a sweep drops nothing and does not throw", async () => {
    await expect(sweepStaleShots()).resolves.toBe(0);
  });
});

describe("when opening is refused", () => {
  test("a throwing indexedDB.open degrades to a miss", async () => {
    // Firefox private browsing throws here rather than firing onerror.
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    await expect(readShots("icon", "#ff0000")).resolves.toBeNull();
  });

  test("an open that never settles does not wedge callers forever", async () => {
    vi.useFakeTimers();
    // A request that fires no event at all, as Safari has done on a fresh
    // profile. Without the timeout callers would wait forever.
    vi.stubGlobal("indexedDB", { open: () => ({}) as IDBOpenDBRequest });
    const p = readShots("icon", "#ff0000");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe("shotsToURLs", () => {
  test("maps every slot to a URL", () => {
    const createObjectURL = vi.fn((_: Blob) => "blob:fake");
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    const out = shotsToURLs({ a: new Blob(["1"]), b: new Blob(["2"]) });
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  test("an empty set yields an empty map rather than undefined entries", () => {
    expect(shotsToURLs({})).toEqual({});
  });
});
