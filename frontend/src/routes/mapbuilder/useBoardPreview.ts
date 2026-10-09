import * as React from "react";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { useLingui } from "@lingui/react/macro";
import { previewView } from "@/lib/preview/view";
import { runChecks, failingHexes, type CheckResult } from "@/lib/preview/checks";
import type { Board, FullView, Hex, PreviewEnvelope } from "@/lib/types";

export interface BoardPreview {
  view: FullView | null;
  envelope: PreviewEnvelope | null;
  results: CheckResult[];
  flagged: Hex[];
  loading: boolean;
  error: string | null;
}

/** Boards already dealt this session, so stepping back through seeds is instant. */
const cache = new Map<string, PreviewEnvelope>();
const CACHE_MAX = 64;

/**
 * The builder's board, dealt by the server as a table would deal it, and
 * checked. Debounced on the board (the editor changes it every brush stroke)
 * and keyed on ruleset and seed, which change what the modules lay over it.
 * While `enabled` is false nothing is fetched and the last answer is kept.
 *
 * A plain effect rather than react-query, like `useLint`: the request id stops
 * a slow earlier deal from landing after a newer one.
 */
export function useBoardPreview(
  board: Board | null,
  ruleset: string,
  seed: string,
  players: number,
  enabled: boolean,
  delayMs = 300,
): BoardPreview {
  const { t } = useLingui();
  const [state, setState] = React.useState<{
    key: string;
    envelope: PreviewEnvelope | null;
    error: string | null;
  }>({ key: "", envelope: null, error: null });
  const reqId = React.useRef(0);
  const key = board ? JSON.stringify({ b: board, r: ruleset, s: seed, p: players }) : "";

  React.useEffect(() => {
    if (!enabled || !board) return;
    const id = ++reqId.current;
    const hit = cache.get(key);
    if (hit) {
      setState({ key, envelope: hit, error: null });
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .previewBoard({ ruleset, seed, board, players })
        .then((env) => {
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
          cache.set(key, env);
          if (id === reqId.current) setState({ key, envelope: env, error: null });
        })
        .catch((e: unknown) => {
          if (id === reqId.current)
            setState({
              key,
              envelope: null,
              error: apiErrorText(e, t`That board could not be dealt.`),
            });
        });
    }, delayMs);
    return () => clearTimeout(timer);
    // `board`, `ruleset`, `seed` and `players` are all folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, delayMs]);

  const envelope = state.envelope;
  const view = React.useMemo(() => (envelope ? previewView(envelope) : null), [envelope]);
  const results = React.useMemo(() => (view ? runChecks(view) : []), [view]);
  const flagged = React.useMemo(() => failingHexes(results), [results]);
  return {
    view,
    envelope,
    results,
    flagged,
    loading: enabled && !!board && state.key !== key,
    error: state.key === key ? state.error : null,
  };
}
