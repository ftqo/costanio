import { describe, it, expect, beforeEach } from "vitest";
import {
  stashBuilderBoard,
  takeBuilderBoard,
  stashBuilderSource,
  takeBuilderSource,
} from "./handoff";
import type { Board } from "@/lib/types";
import { defaultConfig } from "@/lib/format";

const board: Board = { radius: 2, tiles: [], robber: { q: 0, r: 0 }, harbors: [] };

describe("builder board handoff", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a stashed board, once", () => {
    stashBuilderBoard(board);
    expect(takeBuilderBoard()).toEqual(board);
    // one-shot: consumed on first take
    expect(takeBuilderBoard()).toBeNull();
  });

  it("clears any stashed board when given null", () => {
    stashBuilderBoard(board);
    stashBuilderBoard(null);
    expect(takeBuilderBoard()).toBeNull();
  });

  it("returns null when nothing is stashed", () => {
    expect(takeBuilderBoard()).toBeNull();
  });
});

describe("builder source-lobby handoff", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips a stashed source lobby, once", () => {
    const source = { id: "g123", cfg: defaultConfig() };
    stashBuilderSource(source);
    expect(takeBuilderSource()).toEqual(source);
    // one-shot: consumed on first take so a later plain visit creates a new game
    expect(takeBuilderSource()).toBeNull();
  });

  it("clears any stashed source when given null", () => {
    stashBuilderSource({ id: "g123", cfg: defaultConfig() });
    stashBuilderSource(null);
    expect(takeBuilderSource()).toBeNull();
  });

  it("returns null when nothing is stashed", () => {
    expect(takeBuilderSource()).toBeNull();
  });

  it("returns null on corrupt stored data", () => {
    sessionStorage.setItem("mapbuilder:sourceLobby", "{not json");
    expect(takeBuilderSource()).toBeNull();
  });
});
