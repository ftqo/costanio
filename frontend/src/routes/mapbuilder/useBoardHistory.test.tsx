import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect } from "vitest";
import { blankBoard, addLand } from "@/lib/maps/board";
import { useBoardHistory } from "./useBoardHistory";

describe("board history", () => {
  it("groups a stroke from unchanged land and branches after undo", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let history!: ReturnType<typeof useBoardHistory>;
    function Harness() {
      history = useBoardHistory(() => blankBoard(2));
      return null;
    }
    act(() => root.render(<Harness />));
    const original = history.board;
    const first = addLand(original, { q: 3, r: 0 });
    const second = addLand(first, { q: 4, r: 0 });
    act(() => {
      history.beginStroke();
      history.setBoard(original);
      history.setBoard(first);
      history.setBoard(second);
      history.endStroke();
    });
    expect(history.board).toEqual(second);
    act(() => history.undo());
    expect(history.board).toEqual(original);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    act(() => history.redo());
    expect(history.board).toEqual(second);
    act(() => history.undo());
    act(() => history.setBoard(first));
    expect(history.canRedo).toBe(false);
    act(() => history.undo());
    expect(history.board).toEqual(original);
    act(() => history.reset(second));
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    act(() => root.unmount());
  });
});
