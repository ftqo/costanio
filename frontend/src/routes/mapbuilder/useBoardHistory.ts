import * as React from "react";
import type { Board } from "@/lib/types";

type History = { past: Board[]; board: Board; future: Board[]; stroke: boolean; recorded: boolean };
const LIMIT = 100;

/** Immutable board snapshots, with a whole brush stroke counted as one edit. */
export function useBoardHistory(initial: () => Board) {
  const [history, setHistory] = React.useState<History>(() => ({
    stroke: false,
    recorded: false,
    past: [],
    board: initial(),
    future: [],
  }));
  const beginStroke = React.useCallback(() => {
    setHistory((h) => ({ ...h, stroke: true, recorded: false }));
  }, []);
  const endStroke = React.useCallback(() => {
    setHistory((h) => ({ ...h, stroke: false, recorded: false }));
  }, []);
  const setBoard = React.useCallback((board: Board) => {
    setHistory((h) => {
      if (JSON.stringify(h.board) === JSON.stringify(board)) return h;
      return {
        ...h,
        past: !h.stroke || !h.recorded ? [...h.past, h.board].slice(-LIMIT) : h.past,
        board,
        future: [],
        recorded: true,
      };
    });
  }, []);
  const reset = React.useCallback(
    (board: Board) => {
      endStroke();
      setHistory({ past: [], board, future: [], stroke: false, recorded: false });
    },
    [endStroke],
  );
  const undo = React.useCallback(() => {
    endStroke();
    setHistory((h) =>
      h.past.length
        ? {
            ...h,
            past: h.past.slice(0, -1),
            board: h.past[h.past.length - 1],
            future: [h.board, ...h.future],
          }
        : h,
    );
  }, [endStroke]);
  const redo = React.useCallback(() => {
    endStroke();
    setHistory((h) =>
      h.future.length
        ? {
            ...h,
            past: [...h.past, h.board],
            board: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }, [endStroke]);
  return {
    board: history.board,
    setBoard,
    reset,
    undo,
    redo,
    inStroke: history.stroke,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    beginStroke,
    endStroke,
  };
}
