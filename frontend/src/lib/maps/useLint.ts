import * as React from "react";
import { api } from "@/lib/api";
import type { Board, MapIssue } from "@/lib/types";

/**
 * Lint a board on the server, debounced, returning the latest issues. While
 * `enabled` is false it stays quiet (shape mode shows its own simpler check).
 * A monotonically increasing request id guards against out-of-order responses
 * so a slow earlier lint can never overwrite a newer one.
 */
export function useLint(
  board: Board | null,
  enabled: boolean,
  ruleset = "base",
  delayMs = 150,
): MapIssue[] {
  const [issues, setIssues] = React.useState<MapIssue[]>([]);
  const reqId = React.useRef(0);
  // Serialize the board so the effect only re-fires on real changes. The
  // ruleset is in the key so flipping islands on or off (e.g. painting gold or
  // sea) re-lints terrain/ruleset eligibility.
  const key = board
    ? JSON.stringify(board.tiles) + "|" + JSON.stringify(board.harbors) + "|" + ruleset
    : "";

  React.useEffect(() => {
    if (!enabled || !board) {
      setIssues([]);
      return;
    }
    const id = ++reqId.current;
    const timer = window.setTimeout(() => {
      api
        .lintMap(board, ruleset)
        .then((r) => {
          if (id === reqId.current) setIssues(r.issues);
        })
        .catch(() => {
          if (id === reqId.current) setIssues([]);
        });
    }, delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, delayMs]);

  return issues;
}
