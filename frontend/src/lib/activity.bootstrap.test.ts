import { afterEach, describe, expect, it, vi } from "vitest";

// Routing is same-origin through the portal's root mapping, so the bootstrap
// must not patch URL mappings (a self-referential target turns `/api/token`
// into `/api/api/token`) and must fetch `/api/token` exactly once.

const ready = vi.fn().mockResolvedValue(undefined);
const authorize = vi.fn().mockResolvedValue({ code: "CODE" });
const authenticate = vi.fn().mockResolvedValue({});
const subscribe = vi.fn().mockResolvedValue(undefined);
const getInstanceConnectedParticipants = vi.fn().mockResolvedValue({ participants: [] });
const patchUrlMappings = vi.fn();

vi.mock("@discord/embedded-app-sdk", () => ({
  DiscordSDK: class {
    instanceId = "inst-1";
    ready = ready;
    subscribe = subscribe;
    commands = { authorize, authenticate, getInstanceConnectedParticipants };
  },
  patchUrlMappings,
}));

vi.mock("./session", () => ({ setBearer: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("runActivityBootstrap routing", () => {
  it("fetches /api/token undoubled and never patches URL mappings", async () => {
    vi.stubEnv("VITE_DISCORD_CLIENT_ID", "123456789012345678");

    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/token") {
        return { ok: true, json: async () => ({ access_token: "a", session_token: "s" }) };
      }
      if (url === "/api/activity/lobby") {
        return {
          ok: true,
          json: async () => ({ role: "host", summary: { game: { id: "g1", status: "lobby" } } }),
        };
      }
      if (url === "/api/activity/participants") {
        return { ok: true, status: 204, json: async () => ({}) };
      }
      throw new Error(`unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Dynamic import so the module's CLIENT_ID const reads the stubbed env.
    const { runActivityBootstrap } = await import("./activity");
    const res = await runActivityBootstrap();

    expect(res).toMatchObject({ gameId: "g1", role: "host" });
    expect(patchUrlMappings).not.toHaveBeenCalled();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/token");
    expect(urls.some((u) => u.includes("/api/api/"))).toBe(false);
  });

  it("reports live participants, excluding bots", async () => {
    vi.stubEnv("VITE_DISCORD_CLIENT_ID", "123456789012345678");
    getInstanceConnectedParticipants.mockResolvedValueOnce({
      participants: [
        { id: "10", bot: false },
        { id: "20", bot: true }, // a Discord bot, not a player: must be dropped
        { id: "30", bot: false },
      ],
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url === "/api/token")
        return { ok: true, json: async () => ({ access_token: "a", session_token: "s" }) };
      if (url === "/api/activity/lobby")
        return {
          ok: true,
          json: async () => ({ role: "host", summary: { game: { id: "g1", status: "lobby" } } }),
        };
      if (url === "/api/activity/participants")
        return { ok: true, status: 204, json: async () => ({}) };
      throw new Error(`unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { runActivityBootstrap } = await import("./activity");
    await runActivityBootstrap();

    // The seed report fires after bootstrap resolves (fire-and-forget); wait for it.
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/activity/participants")).toBe(true);
    });
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/activity/participants")!;
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body).toEqual({ instance_id: "inst-1", discord_ids: ["10", "30"] });
    expect(subscribe).toHaveBeenCalledWith(
      "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE",
      expect.any(Function),
    );
  });
});
