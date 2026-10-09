import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReplaySource } from "@/lib/replay/types";

// The player is mocked to a marker: it mounts Board3D, which needs WebGL. The
// tests are about which of the page's three states shows and what reaches the
// player, so the marker reports the frame count and seat names.
vi.mock("@/components/replay/ReplayPlayer", () => ({
  ReplayPlayer: ({
    source,
    seats,
  }: {
    source: ReplaySource;
    seats?: { seat: number; name: string }[];
  }) =>
    React.createElement("div", {
      "data-testid": "player",
      "data-frames": String(source.frames.length),
      "data-seats": (seats ?? []).map((s) => s.name).join(","),
    }),
}));

// Typed by hand so the mocks stay callable; `vi.fn()` inference widens into a
// signature TypeScript will not let a test call.
interface Hoisted {
  search: { g?: string; inv?: string };
  gameFrames: Mock<(id: string) => Promise<unknown>>;
  foldReplay: Mock<(file: unknown) => Promise<unknown>>;
  match: Mock<(id: string) => Promise<unknown>>;
  matches: Mock<(id: number) => Promise<unknown>>;
  me: { id: number } | null;
  ensureSession: Mock<() => Promise<unknown>>;
}

const h = vi.hoisted<Hoisted>(() => ({
  search: {},
  gameFrames: vi.fn(),
  foldReplay: vi.fn(),
  match: vi.fn(),
  matches: vi.fn(),
  me: null,
  ensureSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: (p: { children?: React.ReactNode }) => React.createElement("a", null, p.children),
  useNavigate: () => vi.fn(),
  useSearch: () => h.search,
}));
vi.mock("@/lib/api", async (orig) => {
  const real = await orig<typeof import("@/lib/api")>();
  return {
    ...real,
    api: { gameFrames: h.gameFrames, foldReplay: h.foldReplay },
  };
});
vi.mock("@/lib/matches", () => ({
  fetchMatch: (id: string) => h.match(id),
  fetchUserMatches: (id: number) => h.matches(id),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: h.me, ensureSession: h.ensureSession }),
}));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/components/Screen", () => ({
  Screen: (p: { children?: React.ReactNode }) => React.createElement("div", null, p.children),
}));

// react-query reduced to "call the function and return its result": the page's
// logic is which query is enabled and what it does with the answer.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    queryFn,
    enabled = true,
  }: {
    queryFn: () => Promise<unknown>;
    enabled?: boolean;
  }) => {
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
    return state;
  },
}));

const { Replay } = await import("./Replay");

function source(frames = 3): ReplaySource {
  return {
    meta: {
      game_id: "g1",
      players: 2,
      ruleset: "base",
      winner: 0,
      scores: [10, 4],
      events: frames,
    },
    frames: Array.from({ length: frames }, (_, i) => ({
      seq: i,
      type: "turn_started",
      event: null,
      // The player is mocked, so nothing reads the view here.
      view: {} as never,
    })),
  };
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
  teardown();
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  await act(async () => {
    r.render(React.createElement(Replay));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(teardown);

describe("the replay page", () => {
  beforeEach(() => {
    h.search = {};
    h.me = null;
    h.gameFrames.mockReset();
    h.foldReplay.mockReset();
    h.match.mockReset();
    h.matches.mockReset();
    h.ensureSession.mockReset();
    h.ensureSession.mockResolvedValue(null);
    // Defaults, so a test only states the query it is about. A bare `mockReset`
    // returns undefined, which the query wrapper then tries to `.then`.
    h.match.mockResolvedValue({ seats: [] });
    h.matches.mockResolvedValue([]);
  });

  it("plays a game named in the URL, with the roster's names", async () => {
    h.search = { g: "g1" };
    h.gameFrames.mockResolvedValue(source(4));
    h.match.mockResolvedValue({
      seats: [
        { seat: 0, name: "Iris" },
        { seat: 1, name: "Marco" },
      ],
    });
    await render();
    const player = host!.querySelector("[data-testid=player]");
    expect(player).not.toBeNull();
    expect(player!.getAttribute("data-frames")).toBe("4");
    expect(player!.getAttribute("data-seats")).toBe("Iris,Marco");
    expect(h.gameFrames).toHaveBeenCalledWith("g1", undefined);
  });

  // A private game's replay uses the code that admitted the viewer, so the page
  // passes `inv` to the request; otherwise invited viewers get a 403 (server:
  // mayReadOver).
  it("carries the invite code into the frames request", async () => {
    h.search = { g: "g1", inv: "wcode123" };
    h.gameFrames.mockResolvedValue(source(3));
    h.match.mockResolvedValue({ seats: [] });
    await render();
    expect(h.gameFrames).toHaveBeenCalledWith("g1", "wcode123");
  });

  // A failed roster load costs seat names, never the replay.
  it("still plays when the roster cannot be loaded", async () => {
    h.search = { g: "g1" };
    h.gameFrames.mockResolvedValue(source(2));
    h.match.mockRejectedValue(new Error("nope"));
    await render();
    const player = host!.querySelector("[data-testid=player]");
    expect(player).not.toBeNull();
    expect(player!.getAttribute("data-seats")).toBe("");
  });

  it("shows an error when the replay fails to load", async () => {
    h.search = { g: "gone" };
    h.gameFrames.mockRejectedValue(new Error("nope"));
    await render();
    expect(host!.querySelector("[data-testid=player]")).toBeNull();
    expect(host!.textContent).toContain("Could not load that replay");
  });

  it("offers the file box and the history when no game is named", async () => {
    h.me = { id: 7 };
    h.matches.mockResolvedValue([]);
    await render();
    expect(host!.querySelector("[data-testid=player]")).toBeNull();
    expect(host!.querySelector("input[type=file]")).not.toBeNull();
    expect(h.gameFrames).not.toHaveBeenCalled();
    expect(h.matches).toHaveBeenCalledWith(7);
  });

  // A visitor with no account can open a file: the upload endpoint needs a
  // session, so the page mints a guest.
  it("opens a file and folds it on the server", async () => {
    h.foldReplay.mockResolvedValue(source(5));
    await render();

    const input = host!.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([JSON.stringify({ game: "g9", events: [{ seq: 0 }] })], "mine.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.ensureSession).toHaveBeenCalled();
    expect(h.foldReplay).toHaveBeenCalledWith({ game: "g9", events: [{ seq: 0 }] });
    const player = host!.querySelector("[data-testid=player]");
    expect(player).not.toBeNull();
    expect(player!.getAttribute("data-frames")).toBe("5");
    // An uploaded file says nothing about who sat where, so its seats stay
    // numbered rather than taking names from the game in the URL.
    expect(player!.getAttribute("data-seats")).toBe("");
  });

  it("rejects a non-replay file without a server call", async () => {
    await render();
    const input = host!.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["this is not json"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.foldReplay).not.toHaveBeenCalled();
    expect(host!.textContent).toContain("not a replay");
  });
});
