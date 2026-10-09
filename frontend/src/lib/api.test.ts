import { describe, expect, it, vi, afterEach } from "vitest";
import { api } from "@/lib/api";

/** Captures the URL of the next fetch and answers with an empty JSON body. */
function captureFetch(): { url: () => string } {
  let seen = "";
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      seen = url;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }),
  );
  return { url: () => seen };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// `inv` authorizes reading a private table (the same code the WS `sub` frame
// carries); without it a spectator gets a 403.
describe("getGame query", () => {
  it("carries the invite", async () => {
    const f = captureFetch();
    await api.getGame("g1", undefined, "abc123");
    expect(f.url()).toBe("/api/games/g1?inv=abc123");
  });

  it("carries the log cursor and the invite together", async () => {
    const f = captureFetch();
    await api.getGame("g1", 42, "abc123");
    expect(f.url()).toBe("/api/games/g1?since=42&inv=abc123");
  });

  it("asks for the bare game when it has neither", async () => {
    const f = captureFetch();
    await api.getGame("g1");
    expect(f.url()).toBe("/api/games/g1");
  });

  it("escapes an invite that needs it", async () => {
    const f = captureFetch();
    await api.getGame("g1", undefined, "a b&c");
    expect(f.url()).toBe("/api/games/g1?inv=a+b%26c");
  });
});
