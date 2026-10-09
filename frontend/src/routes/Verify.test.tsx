import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The audit page, over a real replay: a four-player game played by the Go
 * simulator and written in the shape the replay endpoint serves (regenerate
 * with the TestWriteFixture helper in verify/README.md). A real log exercises
 * a board, 120 rolls and two commitments; a hand-written one would not.
 *
 * These tests cover the page; the arithmetic is tested in Go by
 * verify/verify_test.go against every ruleset.
 */
const REPLAY = readFileSync(
  join(process.cwd(), "src/lib/__fixtures__/verifiedReplay.json"),
  "utf8",
);

interface Hoisted {
  search: { g?: string; inv?: string };
  replayText: Mock<(id: string, invite?: string) => Promise<string>>;
  /** Every query key the page asked for, so a test can read the cache key. */
  keys: unknown[][];
}

const h = vi.hoisted<Hoisted>(() => ({ search: {}, replayText: vi.fn(), keys: [] }));

vi.mock("@tanstack/react-router", () => ({
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
  useSearch: () => h.search,
}));
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return { ...real, api: { replayText: h.replayText } };
});
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/Screen", () => ({
  Screen: (p: { children?: React.ReactNode }) => React.createElement("div", null, p.children),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    queryKey,
    queryFn,
    enabled = true,
  }: {
    queryKey: unknown[];
    queryFn: () => Promise<unknown>;
    enabled?: boolean;
  }) => {
    h.keys.push(queryKey);
    const [state, setState] = React.useState<{
      data?: unknown;
      error?: unknown;
      isPending: boolean;
    }>({ isPending: enabled });
    React.useEffect(() => {
      if (!enabled) return;
      let live = true;
      queryFn().then(
        (data) => live && setState({ data, isPending: false }),
        (error) => live && setState({ error, isPending: false }),
      );
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
    return { ...state, isError: state.error !== undefined };
  },
}));

const { ApiErr } = await import("@/lib/api");
const { Verify } = await import("./Verify");

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  h.search = {};
  h.keys = [];
  h.replayText.mockReset();
});

async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(Verify));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return host.textContent ?? "";
}

describe("the audit page", () => {
  it("verifies a real game and shows what it checked", async () => {
    h.search = { g: "sim-4242" };
    h.replayText.mockResolvedValue(REPLAY);
    const text = await render();
    expect(text).toContain("Verified");
    expect(text).toContain("board built from the seed");
    expect(text).toContain("every roll follows from the seed");
    // The count matters: a page that compared nothing would otherwise look the
    // same.
    expect(text).toContain("120 rolls re-derived exactly");
  });

  it("reads the log through the raw-text endpoint, not a parsing one", async () => {
    // Seeds are uint64 and JSON.parse rounds them, so fetching through the
    // parsing `api` helper would fail the commitment check on large seeds (but
    // not on this fixture's small one). So the test checks which fetch the page
    // uses.
    h.search = { g: "sim-4242" };
    h.replayText.mockResolvedValue(REPLAY);
    await render();
    expect(h.replayText).toHaveBeenCalledWith("sim-4242", undefined);
  });

  it("carries a spectator's invite into the fetch", async () => {
    // A private table's replay is open to the players and to whoever holds the
    // invite, so the page must pass `inv` through or a spectator gets a 403.
    h.search = { g: "sim-4242", inv: "abc123" };
    h.replayText.mockResolvedValue(REPLAY);
    const text = await render();
    expect(h.replayText).toHaveBeenCalledWith("sim-4242", "abc123");
    expect(text).toContain("Verified");
  });

  it("keys the cache on the invite, not the game id alone", async () => {
    // The same game with and without a code are different answers (one a 403),
    // so the cache key must include the invite.
    h.search = { g: "sim-4242", inv: "abc123" };
    h.replayText.mockResolvedValue(REPLAY);
    await render();
    expect(h.keys.some((k) => k.includes("abc123"))).toBe(true);
  });

  it("hides the games link from a spectator", async () => {
    // "Back to your games" is no use to a reader with an invite: they did not
    // play, so it is hidden.
    h.search = { g: "sim-4242", inv: "abc123" };
    h.replayText.mockRejectedValue(new ApiErr(403, "PRIVATE_GAME"));
    const text = await render();
    expect(text).not.toContain("Back to your games");
  });

  it("shows the games link to a participant", async () => {
    h.search = { g: "sim-4242" };
    h.replayText.mockRejectedValue(new ApiErr(404, "NOT_FOUND"));
    const text = await render();
    expect(text).toContain("Back to your games");
  });

  it("shows an error when the check throws", async () => {
    // A verifier throw must be shown; otherwise every panel (guarded on the
    // result) renders nothing.
    h.search = { g: "sim-4242" };
    h.replayText.mockResolvedValue("{not json at all");
    const text = await render();
    expect(text).toContain("The check could not be run on this log.");
    // And it must not read as a finding about the game.
    expect(text).not.toContain("Does not check out");
  });

  it("rejects a log whose roll has been altered", async () => {
    h.search = { g: "sim-4242" };
    // Bump one die by one: the smallest change.
    const doctored = REPLAY.replace(
      /"d1":(\d),"d2":/,
      (_m, d: string) => `"d1":${(Number(d) % 6) + 1},"d2":`,
    );
    h.replayText.mockResolvedValue(doctored);
    const text = await render();
    expect(text).toContain("Does not check out");
  });

  it("declines to verify a game from an older derivation", async () => {
    h.search = { g: "sim-4242" };
    const older = REPLAY.replace(
      /"derivation_version":(\d+)/,
      (_m, version: string) => `"derivation_version":${Number(version) - 1}`,
    );
    expect(older).not.toBe(REPLAY);
    h.replayText.mockResolvedValue(older);
    const text = await render();
    expect(text).toContain("Not checked");
    expect(text).toContain("cannot reproduce what the seed decided");
    expect(text).not.toContain("Does not check out");
  });

  it("asks for a game when it has none", async () => {
    const text = await render();
    expect(text).toContain("Pick one of your finished games");
    expect(h.replayText).not.toHaveBeenCalled();
  });
});
