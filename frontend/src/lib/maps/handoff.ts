import type { Board, GameConfig } from "@/lib/types";

// One-shot handoff of a board into the map builder, so "Map builder" from a
// lobby opens it pre-loaded with the selected map. sessionStorage rather than
// router state keeps it tab-scoped; the builder consumes and clears it on mount
// so a later plain visit starts blank.
const BOARD_KEY = "mapbuilder:initialBoard";
const SOURCE_KEY = "mapbuilder:sourceLobby";

// The lobby a builder session was opened from. When present, "Apply to lobby"
// patches that lobby's map instead of creating a new game. `cfg` is the lobby's
// config at hand-off time, re-sent with the new board so the server receives a
// complete GameConfig. Consumed once on mount, like the board.
export interface BuilderSource {
  id: string;
  cfg: GameConfig;
}

export function stashBuilderBoard(board: Board | null): void {
  try {
    if (board) sessionStorage.setItem(BOARD_KEY, JSON.stringify(board));
    else sessionStorage.removeItem(BOARD_KEY);
  } catch {
    // private mode / quota: the builder just opens blank.
  }
}

export function takeBuilderBoard(): Board | null {
  try {
    const raw = sessionStorage.getItem(BOARD_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(BOARD_KEY);
    return JSON.parse(raw) as Board;
  } catch {
    return null;
  }
}

export function stashBuilderSource(source: BuilderSource | null): void {
  try {
    if (source) sessionStorage.setItem(SOURCE_KEY, JSON.stringify(source));
    else sessionStorage.removeItem(SOURCE_KEY);
  } catch {
    // private mode / quota: falls back to creating a new game.
  }
}

export function takeBuilderSource(): BuilderSource | null {
  try {
    const raw = sessionStorage.getItem(SOURCE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SOURCE_KEY);
    return JSON.parse(raw) as BuilderSource;
  } catch {
    return null;
  }
}
