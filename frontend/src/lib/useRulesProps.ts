import * as React from "react";
import { cachedShots, ensureShots } from "@/lib/board3d/shotCache";
import { RULES_SET } from "@/lib/board3d/rulesShots";

/**
 * The neutral props (robber, pirate, barbarian ship, merchant) as slot -> URL.
 *
 * None has a seat tint (their materials sit outside Seat_*), so every render
 * is the same image. One fixed key is passed because the shot pipeline is
 * organised by colour, and every visitor shares one cached copy.
 *
 * Empty until the render resolves, and forever without WebGL, so callers keep
 * their fallback art.
 */
export function useRulesProps(color: string): Record<string, string> {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    let alive = true;
    void ensureShots(RULES_SET, [color]).then((changed) => {
      if (alive && changed) bump();
    });
    return () => {
      alive = false;
    };
  }, [color]);

  return cachedShots(RULES_SET.id, [color])[color] || EMPTY;
}

const EMPTY: Record<string, string> = {};
