import { describe, it, expect } from "vitest";
import { wasKickedFromLobby } from "./lobbyNav";

describe("wasKickedFromLobby", () => {
  const base = { everSeated: true, spectating: false, inActivity: false, isHost: false };

  it("bounces a player who held a seat and lost it (kicked)", () => {
    expect(wasKickedFromLobby(base)).toBe(true);
  });

  it("never bounces the host", () => {
    // A host who dropped their seat to spectate, used the map builder and
    // applied a map must not be bounced off their own table.
    expect(wasKickedFromLobby({ ...base, isHost: true })).toBe(false);
  });

  it("doesn't bounce someone who deliberately chose to spectate", () => {
    expect(wasKickedFromLobby({ ...base, spectating: true })).toBe(false);
  });

  it("doesn't bounce a never-seated watcher", () => {
    expect(wasKickedFromLobby({ ...base, everSeated: false })).toBe(false);
  });

  it("doesn't bounce inside the Discord Activity (it owns its own routing)", () => {
    expect(wasKickedFromLobby({ ...base, inActivity: true })).toBe(false);
  });
});
