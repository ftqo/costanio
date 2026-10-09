import { describe, expect, it } from "vitest";
import { needsAbandonWarning } from "./abandonGuard";
import type { Me } from "./types";

const me = (over: Partial<Me>): Me => ({
  id: 1,
  name: "u",
  avatar: "",
  guest: false,
  stats: null,
  online: true,
  game: "",
  ...over,
});

describe("needsAbandonWarning", () => {
  it("does not warn when there is no signed-in user", () => {
    expect(needsAbandonWarning(null, "g_other")).toBe(false);
  });

  it("does not warn when the user holds no seat", () => {
    expect(needsAbandonWarning(me({ game: "", game_status: "" }), "g_other")).toBe(false);
  });

  it("does not warn when the seated game is only a waiting lobby", () => {
    expect(needsAbandonWarning(me({ game: "g_lobby", game_status: "lobby" }), "g_other")).toBe(
      false,
    );
  });

  it("warns when joining another game while seated in an active one", () => {
    expect(needsAbandonWarning(me({ game: "g_active", game_status: "active" }), "g_other")).toBe(
      true,
    );
  });

  it("does not warn when re-entering the same active game", () => {
    expect(needsAbandonWarning(me({ game: "g_active", game_status: "active" }), "g_active")).toBe(
      false,
    );
  });

  it("warns when creating a game while seated in an active one", () => {
    expect(needsAbandonWarning(me({ game: "g_active", game_status: "active" }))).toBe(true);
  });
});
