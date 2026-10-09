// React binding for the replay transport. The reducer in `driver.ts` owns every
// decision; this owns the clock. The homepage loop and the /replay scrubber
// both use it with different bounds and controls.
import * as React from "react";
import { holdMs, initial, reduce, type Action, type Bounds, type DriverState } from "./driver";
import type { ReplayFrame, ReplaySource } from "./types";

export interface UseReplayOptions {
  /** Start playing on mount. The homepage does; /replay does not. */
  autoplay?: boolean;
  /** Return to the start instead of stopping at the end. */
  loop?: boolean;
  /** Play only a window of the recording. */
  from?: number;
  to?: number;
  speed?: number;
}

export interface Replay {
  frame: ReplayFrame;
  index: number;
  playing: boolean;
  speed: number;
  bounds: Bounds;
  /** Total frames in the window, for a progress readout. */
  total: number;
  dispatch: (a: Action) => void;
}

export function useReplay(source: ReplaySource, opts: UseReplayOptions = {}): Replay {
  const frames = source.frames;

  // Start at the first frame with a board. A log opens with the seed and the
  // config, which draw nothing; recorded files are usually trimmed already.
  const bounds = React.useMemo<Bounds>(() => {
    const firstDrawn = Math.max(
      0,
      frames.findIndex((f) => (f.view?.board?.tiles?.length ?? 0) > 0),
    );
    return {
      first: Math.max(opts.from ?? 0, firstDrawn),
      last: Math.min(opts.to ?? frames.length - 1, frames.length - 1),
      loop: opts.loop,
    };
  }, [frames, opts.from, opts.to, opts.loop]);

  const [state, setState] = React.useState<DriverState>(() =>
    initial(bounds, { playing: opts.autoplay, speed: opts.speed }),
  );

  const dispatch = React.useCallback(
    (a: Action) => setState((s) => reduce(s, a, bounds)),
    [bounds],
  );

  // One timer per frame, sized to what it shows (see `holdMs`).
  React.useEffect(() => {
    if (!state.playing) return;
    const id = window.setTimeout(
      () => dispatch({ t: "tick" }),
      holdMs(frames[state.index]?.type, state.speed),
    );
    return () => window.clearTimeout(id);
  }, [state.playing, state.index, state.speed, frames, dispatch]);

  return {
    frame: frames[state.index],
    index: state.index,
    playing: state.playing,
    speed: state.speed,
    bounds,
    total: bounds.last - bounds.first + 1,
    dispatch,
  };
}
