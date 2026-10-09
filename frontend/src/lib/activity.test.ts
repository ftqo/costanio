import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activityResult, activityRoute, inActivityMode } from "./activity";

describe("inActivityMode", () => {
  const realSearch = window.location.search;
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    setSearch(realSearch);
    sessionStorage.clear();
  });
  function setSearch(search: string) {
    Object.defineProperty(window, "location", {
      value: { ...window.location, search },
      writable: true,
      configurable: true,
    });
  }

  it("is false on the web (no frame_id ever present)", () => {
    setSearch("?g=abc");
    expect(inActivityMode()).toBe(false);
  });

  it("detects the Activity from Discord's frame_id query param", () => {
    setSearch("?frame_id=123&g=abc");
    expect(inActivityMode()).toBe(true);
  });

  // Client-side navigation replaces the query string and drops frame_id, so
  // detection must latch.
  it("stays true after the frame_id is dropped by navigation", () => {
    setSearch("?frame_id=123&g=abc");
    expect(inActivityMode()).toBe(true); // initial load latches it
    setSearch("?g=abc"); // router navigated, frame_id gone
    expect(inActivityMode()).toBe(true);
  });
});

describe("activityResult", () => {
  it("carries the private game's invite so a spectator can subscribe", () => {
    const r = activityResult({
      role: "spectator",
      summary: { game: { id: "g1", status: "active", invite_code: "abc123" } },
    });
    expect(r).toMatchObject({
      gameId: "g1",
      role: "spectator",
      invite: "abc123",
      status: "active",
    });
  });

  it("leaves the invite undefined for a public game", () => {
    const r = activityResult({
      role: "host",
      summary: { game: { id: "g2", status: "lobby" } },
    });
    expect(r.invite).toBeUndefined();
  });
});

describe("activityRoute", () => {
  // A spectator of a private game needs the invite code in the route, or the
  // WS `sub` is rejected.
  it("routes an active-game spectator to /game with the invite", () => {
    expect(
      activityRoute({ gameId: "g1", role: "spectator", invite: "abc123", status: "active" }),
    ).toEqual({ to: "/game", search: { g: "g1", inv: "abc123" } });
  });

  // An overflow opener of an unstarted, full lobby is a spectator while status
  // is "lobby"; they belong in the waiting room.
  it("routes a lobby spectator to the waiting room with the invite", () => {
    expect(
      activityRoute({ gameId: "g1", role: "spectator", invite: "abc123", status: "lobby" }),
    ).toEqual({ to: "/lobby", search: { g: "g1", inv: "abc123" } });
  });

  it("routes a host/player to the waiting room with the invite", () => {
    expect(
      activityRoute({ gameId: "g1", role: "host", invite: "abc123", status: "lobby" }),
    ).toEqual({ to: "/lobby", search: { g: "g1", inv: "abc123" } });
  });

  // Status decides, not role: a finished table goes to the scoreboard, which
  // carries the rematch tally.
  it("routes a finished-game spectator to the scoreboard", () => {
    expect(
      activityRoute({ gameId: "g1", role: "spectator", invite: "abc123", status: "finished" }),
    ).toEqual({ to: "/game", search: { g: "g1", inv: "abc123" } });
  });

  // A seated player of a live game goes straight to the board.
  it("routes a seated player of a live game to the board", () => {
    expect(
      activityRoute({ gameId: "g1", role: "player", invite: "abc123", status: "active" }),
    ).toEqual({ to: "/game", search: { g: "g1", inv: "abc123" } });
  });
});
